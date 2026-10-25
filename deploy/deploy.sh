#!/usr/bin/env bash
# ============================================================================
# Blue/green switch. Runs ON THE SERVER; CI invokes it over SSH.
#
#   deploy.sh <image-ref> <expected-commit-sha>
#
# The contract: this script either promotes the new image or leaves the edge
# exactly as it found it, with the previously serving container untouched.
#   - one deploy at a time: a second deploy.sh (CI, a manual rollback,
#     bring-up) refuses while one runs, before it changes anything;
#   - every failure before the switch tears the new colour down and never
#     touches the edge;
#   - a failed edge config test puts the upstream file back byte for byte,
#     with its owner and mode (or removes it, if there was none), and
#     re-tests, before anything reloads;
#   - a failed smoke test after the switch restores the previous upstream and
#     reloads; on a first deploy there is none, so the file is removed and the
#     edge reloaded without it. Either way the new colour is torn down;
#   - so does any other exit between the upstream write and a passing smoke
#     test: a failing command under `set -e`, or a signal (CI cancelled, the
#     SSH session gone);
#   - a redeploy of the commit that is already live cannot be told apart by
#     the smoke test, so the old colour is paused while it runs: only the new
#     colour can answer, and a switch that did not take effect fails.
#
# The upstream file is replaced by a rename, so it gets a new inode: a proxy
# in a container must mount the directory that holds it, not the file.
#
# All the logic is in functions, and the script only runs when executed, not
# when sourced: deploy/test/guard.test.sh sources it and drives each path
# against stub docker, curl and edge commands.
# ============================================================================

APP_DIR=/opt/solutionmines
HEALTH_TIMEOUT=90
SMOKE_TIMEOUT=20
DRAIN_SECONDS=15
POLL_SECONDS=2

SM_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { log "FAILED: $*"; exit 1; }

port_for() { if [ "$1" = blue ]; then echo 3001; else echo 3002; fi; }

# The commit a /api/health body reports. One parser for the pre-switch check
# and the smoke test, so the two can never disagree about what "this build"
# means.
health_commit() { printf '%s' "$1" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p'; }

# --- the edge ---------------------------------------------------------------
# With no edge.env: the nginx install bootstrap.sh performs on a dedicated
# box. With edge.env: exactly the five values it sets, after sm_check_edge_env
# has passed, and NEVER the nginx defaults for anything it leaves out. Those
# defaults would write into, and reload, another site's proxy.
load_edge_config() {
  unset UPSTREAM_FILE UPSTREAM_LINE EDGE_TEST_CMD EDGE_RELOAD_CMD SMOKE_URL
  local edge_env="$APP_DIR/edge.env"
  if [ -e "$edge_env" ] || [ -L "$edge_env" ]; then
    EDGE_MODE=yes
    sm_check_edge_env "$edge_env" || fail "$edge_env is not usable (see above); nothing was changed"
    # shellcheck source=/dev/null
    . "$edge_env"
  else
    EDGE_MODE=no
    UPSTREAM_FILE=/etc/nginx/solutionmines/upstream.conf
    UPSTREAM_LINE='server 127.0.0.1:__PORT__;'
    EDGE_TEST_CMD='nginx -t'
    EDGE_RELOAD_CMD='nginx -s reload'
    SMOKE_URL=http://127.0.0.1/api/health
  fi
}

render_upstream() { # <colour> <port>
  printf '%s\n' "$UPSTREAM_LINE" | sed -e "s/__COLOUR__/$1/g" -e "s/__PORT__/$2/g"
}

# Write via a temp file in the same directory and rename, so nothing ever
# reads a half-written upstream. The temp file is created by mktemp (a new,
# unpredictable name, opened O_EXCL: nothing planted under a known name can
# redirect root's write), and its name ends in .sm-tmp, which no *.conf /
# *.caddy glob matches. An existing file keeps its owner and mode (on a
# shared edge it may belong to the proxy's admin, mode 0640); a new one is
# created 0644. Either the rename happens and the file is new, or
# UPSTREAM_FILE is exactly as it was and the temp file is gone.
write_upstream_from() { # <source file>
  local dir tmp
  dir="$(dirname -- "$UPSTREAM_FILE")"
  tmp="$(mktemp --suffix=.sm-tmp "$dir/.$(basename -- "$UPSTREAM_FILE").XXXXXX")" || return 1
  if ! cp -- "$1" "$tmp"; then rm -f -- "$tmp"; return 1; fi
  if [ -e "$UPSTREAM_FILE" ]; then
    chown --reference="$UPSTREAM_FILE" -- "$tmp" 2>/dev/null || true
    if ! chmod --reference="$UPSTREAM_FILE" -- "$tmp"; then rm -f -- "$tmp"; return 1; fi
  elif ! chmod 644 -- "$tmp"; then
    rm -f -- "$tmp"; return 1
  fi
  if ! mv -f -- "$tmp" "$UPSTREAM_FILE"; then rm -f -- "$tmp"; return 1; fi
}

# The deploy lock is file descriptor 9 (deploy_main). No child may inherit
# it: a process the edge's reload leaves behind (`... || caddy start`), or a
# daemonising credential helper, would hold the lock after this script
# exits, and every later deploy would refuse as "another deploy is running".
edge_test() { eval "$EDGE_TEST_CMD" 9>&-; }
edge_reload() { eval "$EDGE_RELOAD_CMD" 9>&-; }
# shellcheck disable=SC2032  # xargs runs the real docker; it gets 9>&- itself
docker() { command docker "$@" 9>&-; }
curl() { command curl "$@" 9>&-; }

# Puts the upstream file back as it was before this deploy: the byte-for-byte
# backup (its owner and mode carried by the current file, which kept them),
# or no file at all if there was none. If that fails (a full disk, an I/O
# error, a read-only remount), the file still holds THIS deploy's line:
# UPSTREAM_STUCK=1 then keeps the backup (on_exit does not delete it) and the
# new colour (on_exit does not tear down what the file points at), and says
# how to finish the restore by hand.
restore_upstream() {
  local ok=yes
  if [ "$HAD_PREV_UPSTREAM" = 1 ]; then
    write_upstream_from "$UPSTREAM_BACKUP" || ok=no
  else
    rm -f -- "$UPSTREAM_FILE" || ok=no
  fi
  [ "$ok" = yes ] && return 0
  UPSTREAM_STUCK=1
  log "WARNING: could not put $UPSTREAM_FILE back; it still holds this deploy's line for $TARGET."
  if [ "$HAD_PREV_UPSTREAM" = 1 ]; then
    log "         The previous file is kept as $UPSTREAM_BACKUP. Put it back by hand"
    log "         before anything reloads the edge: cp -p $UPSTREAM_BACKUP $UPSTREAM_FILE"
  else
    log "         There was no such file before this deploy: rm -f $UPSTREAM_FILE"
  fi
  return 1
}

# Points the edge at <colour>. Returns non-zero, with the edge as it was, if
# the edge's own config test rejects the change.
switch_edge() { # <colour> <port>
  UPSTREAM_BACKUP="$(mktemp "$APP_DIR/.upstream.prev.XXXXXX")"
  HAD_PREV_UPSTREAM=0
  if [ -f "$UPSTREAM_FILE" ]; then
    if ! cp -p -- "$UPSTREAM_FILE" "$UPSTREAM_BACKUP"; then
      log "could not back up $UPSTREAM_FILE; not touching it"
      return 1
    fi
    HAD_PREV_UPSTREAM=1
  fi
  local new; new="$(mktemp "$APP_DIR/.upstream.new.XXXXXX")"
  # A failed write leaves UPSTREAM_FILE exactly as it was (see
  # write_upstream_from), so there is nothing to put back.
  if ! render_upstream "$1" "$2" > "$new" || ! write_upstream_from "$new"; then
    rm -f -- "$new"
    log "could not write $UPSTREAM_FILE; it is unchanged"
    return 1
  fi
  rm -f -- "$new"
  # From here until the smoke test passes, on_exit puts the edge back.
  EDGE_DIRTY=1

  if ! edge_test 2>&1; then
    log "edge config test failed with the new upstream; putting the old one back"
    EDGE_DIRTY=0
    if ! restore_upstream; then
      log "         The edge was NOT reloaded, so it still serves $ACTIVE, but its config"
      log "         now fails its own test because of this deploy's line, until the"
      log "         file is put back."
      SWITCH_RESTORED=no
      return 1
    fi
    if edge_test >/dev/null 2>&1; then
      log "edge config is valid again"
    else
      log "WARNING: the edge config test still fails after the restore."
      log "         It was not this upstream; the edge was not reloaded."
    fi
    return 1
  fi
  return 0
}

# Polls SMOKE_URL until it reports EXPECTED_SHA, parsed exactly as the
# pre-switch health check parses it. A reload hands new requests to new
# workers within moments, not instantly, so one early answer from the old
# colour is not a failure, but SMOKE_TIMEOUT seconds of them is. Never
# through an HTTP proxy from the environment: the point is THIS box's edge.
smoke_test() {
  local deadline body got=""
  deadline=$(( $(date +%s) + SMOKE_TIMEOUT ))
  while :; do
    if body="$(curl -fsS --noproxy '*' --max-time 6 "$SMOKE_URL" 2>/dev/null)"; then
      got="$(health_commit "$body")"
      if [ "$got" = "$EXPECTED_SHA" ]; then
        log "smoke test passed through the edge (commit $got)"
        return 0
      fi
    fi
    [ "$(date +%s)" -lt "$deadline" ] || break
    sleep 1
  done
  log "smoke test through the edge failed: $SMOKE_URL reported commit '${got}', expected '$EXPECTED_SHA'"
  return 1
}

# After a failed reload or smoke test, or any unexpected exit once the
# upstream file was rewritten: the edge back to exactly what it was, and the
# new colour marked for teardown. image.env goes back too, but only if it was
# snapshotted: before that point it has not been touched.
roll_back_edge() {
  EDGE_DIRTY=0
  if ! restore_upstream; then
    # Nothing to reload: the file still points at $TARGET, and reloading
    # would only confirm that. image.env stays as it is too, for the same
    # reason, and $TARGET is left running (SWITCHED=1) for whatever the
    # edge sends it.
    SWITCHED=1
    resume_paused
    return 1
  fi
  if [ "$STATE_SAVED" = 1 ]; then
    if [ -f "$STATE_BACKUP" ]; then cp -p -- "$STATE_BACKUP" "$STATE_FILE"; else rm -f -- "$STATE_FILE"; fi
  fi
  resume_paused
  if edge_test 2>&1 && edge_reload; then
    SWITCHED=0
    if [ "$HAD_PREV_UPSTREAM" = 1 ]; then
      log "rolled the edge back to the previous upstream ($(upstream_colour "$UPSTREAM_FILE"))"
    else
      log "first deploy: removed the upstream file and reloaded; the edge is as it was"
    fi
    # If the edge had been reloaded onto $TARGET, it sent live traffic there:
    # let those requests finish, and the edge's workers pick up the reload,
    # before on_exit tears $TARGET down (as the success path drains $ACTIVE).
    if [ "${EDGE_RELOADED:-0}" = 1 ] && [ "$DRAIN_SECONDS" -gt 0 ]; then
      log "draining $TARGET for ${DRAIN_SECONDS}s before it is torn down"
      sleep "$DRAIN_SECONDS"
    fi
    return 0
  fi
  log "WARNING: the edge would not test/reload after the rollback. Check it by hand."
  # The edge may still be sending traffic to the new colour; leave it running.
  return 1
}

# The colour an upstream file points at, as far as its text says.
upstream_colour() { # <file>
  if grep -q ':3001\|solutionmines-blue' "$1" 2>/dev/null; then echo blue
  elif grep -q ':3002\|solutionmines-green' "$1" 2>/dev/null; then echo green
  else echo "unknown colour"; fi
}

# The old colour paused for the smoke test (see the header), if any.
pause_colour() { # <colour>
  docker compose -f "$COMPOSE_FILE" pause "$1" >/dev/null || return 1
  PAUSED="$1"
}
resume_paused() {
  [ -n "${PAUSED:-}" ] || return 0
  if docker compose -f "$COMPOSE_FILE" unpause "$PAUSED" >/dev/null; then
    log "resumed $PAUSED"
  else
    log "WARNING: could not unpause $PAUSED; run: docker compose -f $COMPOSE_FILE unpause $PAUSED"
  fi
  PAUSED=""
}

teardown() { # <colour>
  docker compose -f "$COMPOSE_FILE" stop "$1" >/dev/null 2>&1 || true
  docker compose -f "$COMPOSE_FILE" rm -f "$1" >/dev/null 2>&1 || true
}

# Set once the edge points at the new colour. Until then, ANY exit — a failed
# command under `set -e`, or an explicit `fail` — must take the new container
# back down. An ERR trap alone does not do this: `exit 1` inside a function is
# not a command failure, so the explicit failure paths would silently leave a
# second container running and eating memory.
#
# The same goes for the edge: from the moment the upstream file is rewritten
# until the smoke test passes, any exit that is not a success (set -e, a
# signal, CI cancelling the SSH session) puts the upstream back and reloads,
# so a failed deploy never leaves the edge pointing at a colour that is about
# to be torn down, ready for the next reload by anyone (a certbot renewal).
on_exit() {
  local code=$?
  set +e   # the cleanup must run to the end, whatever fails inside it
  resume_paused
  if [ "$code" -ne 0 ] && [ "${EDGE_DIRTY:-0}" = 1 ]; then
    log "unexpected failure after the upstream was rewritten; putting the edge back"
    roll_back_edge || log "WARNING: the edge could not be restored cleanly; check it by hand"
  fi
  if [ "$code" -ne 0 ] && [ "${SWITCHED:-0}" -eq 0 ] && [ "${UPSTREAM_STUCK:-0}" != 1 ] && [ -n "${TARGET:-}" ]; then
    log "tearing down $TARGET after a failed deploy"
    teardown "$TARGET"
  fi
  # The backup is the only copy of the previous upstream file: kept whenever
  # putting it back did not complete.
  if [ "${UPSTREAM_STUCK:-0}" = 1 ]; then
    [ -z "${UPSTREAM_BACKUP:-}" ] || [ ! -e "$UPSTREAM_BACKUP" ] || log "kept $UPSTREAM_BACKUP (the upstream file from before this deploy)"
  else
    [ -z "${UPSTREAM_BACKUP:-}" ] || rm -f -- "$UPSTREAM_BACKUP"
  fi
  [ -z "${STATE_BACKUP:-}" ] || rm -f -- "$STATE_BACKUP"
  exit "$code"
}

# A signal must reach on_exit as a failure. With only an EXIT trap, bash runs
# it with $? = 0 after a SIGTERM, and the cleanup above would think the deploy
# succeeded. SIGPIPE too: when CI's SSH session goes away, the next log line
# would kill the script mid-switch; ignoring it lets the cleanup finish.
on_signal() { # <exit code>
  trap '' PIPE
  exit "$1"
}

deploy_main() {
  IMAGE="${1:?usage: deploy.sh <image-ref> <expected-commit-sha>}"
  EXPECTED_SHA="${2:?usage: deploy.sh <image-ref> <expected-commit-sha>}"
  COMPOSE_FILE="$APP_DIR/docker-compose.yml"
  STATE_FILE="$APP_DIR/image.env"
  SWITCHED=0
  EDGE_DIRTY=0
  EDGE_RELOADED=0
  UPSTREAM_STUCK=0
  SWITCH_RESTORED=yes
  TARGET=""
  UPSTREAM_BACKUP=""
  STATE_BACKUP=""
  STATE_SAVED=0
  PAUSED=""

  # One deploy at a time. Two overlapping runs both read the same live
  # colour and target the same other one; the second recreates the first's
  # container and the first then tears down the second's live colour. CI's
  # concurrency group only serialises CI runs; a manual rollback and
  # bring-up call this script directly. Held until this process exits.
  command -v flock >/dev/null 2>&1 || fail "flock (util-linux) is missing; nothing was changed"
  exec 9>>"$APP_DIR/.deploy.lock" || fail "cannot open $APP_DIR/.deploy.lock; nothing was changed"
  flock -n 9 || fail "another deploy is running on this box (lock $APP_DIR/.deploy.lock); nothing was changed"

  [ -f "$SM_DEPLOY_DIR/guard.sh" ] \
    || fail "$SM_DEPLOY_DIR/guard.sh is missing; re-run bootstrap.sh or bring-up.sh to install it"
  # shellcheck source=deploy/guard.sh
  . "$SM_DEPLOY_DIR/guard.sh"

  load_edge_config

  # The edge must pass its own test BEFORE this deploy touches it. Otherwise
  # a failure later cannot be told apart from one this deploy caused, and
  # "restored, the edge is valid again" would be a claim nobody checked.
  local pre
  if ! pre="$(edge_test 2>&1)"; then
    printf '%s\n' "$pre" | tail -20
    fail "the edge config already fails its own test ($EDGE_TEST_CMD); fix that first. Nothing was changed"
  fi

  trap on_exit EXIT
  trap 'on_signal 129' HUP
  trap 'on_signal 130' INT
  trap 'on_signal 141' PIPE
  trap 'on_signal 143' TERM

  # --- which colour is live right now? -------------------------------------
  # First deploy has neither state file nor upstream file, so blue is the
  # target. image.env is the primary source: it says nothing about the
  # edge's config format, so it reads the same whether the upstream line is
  # an nginx `server` directive or a Caddy `reverse_proxy`. The upstream file
  # stays as a fallback for boxes deployed before image.env existed.
  ACTIVE=none
  if [ -f "$STATE_FILE" ]; then
    case "$(sed -n 's/^ACTIVE_COLOUR=//p' "$STATE_FILE")" in
      blue)  ACTIVE=blue ;;
      green) ACTIVE=green ;;
    esac
  fi
  if [ "$ACTIVE" = none ] && [ -f "$UPSTREAM_FILE" ]; then
    if grep -q ':3001\|solutionmines-blue' "$UPSTREAM_FILE"; then ACTIVE=blue
    elif grep -q ':3002\|solutionmines-green' "$UPSTREAM_FILE"; then ACTIVE=green
    fi
  fi
  TARGET=blue
  [ "$ACTIVE" = blue ] && TARGET=green
  TARGET_PORT="$(port_for "$TARGET")"

  log "active=$ACTIVE target=$TARGET image=$IMAGE edge=$([ "$EDGE_MODE" = yes ] && echo shared || echo nginx)"

  cd "$APP_DIR"
  export IMAGE

  # --- registry auth --------------------------------------------------------
  # A package pushed to GHCR by Actions is PRIVATE by default (organisation
  # packages included), so an anonymous pull 401s on the very first deploy,
  # which looks like a broken script rather than a permissions setting.
  #
  # Two ways out, and either is fine:
  #   - make ghcr.io/solution-mines/solutionmines public once, in the
  #     package's settings, or
  #   - drop a read:packages token in /opt/solutionmines/registry.env as
  #       GHCR_USER=<github-username with access to the package>
  #       GHCR_TOKEN=<classic PAT with read:packages>
  # The file is read here and never echoed.
  local registry_env="$APP_DIR/registry.env"
  if [ -f "$registry_env" ]; then
    # shellcheck source=/dev/null
    . "$registry_env"
    if [ -n "${GHCR_TOKEN:-}" ] && [ -n "${GHCR_USER:-}" ]; then
      log "authenticating to ghcr.io as $GHCR_USER"
      printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
    fi
  fi

  # --- start the new colour -------------------------------------------------
  # A locally built image (the bring-up path, before CI and GHCR are wired
  # up) has nothing to pull from, and `compose pull` on it is a hard error
  # rather than a no-op. Only pull what is actually remote.
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    log "image is already present locally — skipping pull"
  else
    log "pulling image"
    if ! docker compose -f "$COMPOSE_FILE" pull "$TARGET"; then
      log "pull failed. If this is a 401/denied, the GHCR package is still private:"
      log "  make it public in the package's settings, or create $registry_env"
      log "  with GHCR_USER and GHCR_TOKEN (read:packages)."
      fail "could not pull $IMAGE"
    fi
  fi

  log "starting $TARGET on 127.0.0.1:$TARGET_PORT"
  docker compose -f "$COMPOSE_FILE" up -d --force-recreate "$TARGET"

  # --- prove it is actually serving THIS build ------------------------------
  # Polling until 200 is not enough: a container that came up from the
  # PREVIOUS image also returns 200. Matching the commit is what catches a
  # registry that served a stale tag, or a pull that silently no-op'd.
  log "waiting for health on :$TARGET_PORT (timeout ${HEALTH_TIMEOUT}s)"
  local deadline healthy=0 body got_sha
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if body="$(curl -fsS --noproxy '*' --max-time 4 "http://127.0.0.1:$TARGET_PORT/api/health" 2>/dev/null)"; then
      got_sha="$(health_commit "$body")"
      if [ "$got_sha" = "$EXPECTED_SHA" ]; then
        healthy=1
        log "healthy, commit matches ($got_sha)"
        log "mail transport: $(printf '%s' "$body" | sed -n 's/.*"mail":"\([^"]*\)".*/\1/p')"
        break
      fi
      log "answering but commit is '$got_sha', expected '$EXPECTED_SHA' — still waiting"
    fi
    sleep "$POLL_SECONDS"
  done

  if [ "$healthy" -ne 1 ]; then
    log "--- last 60 log lines from $TARGET ---"
    docker compose -f "$COMPOSE_FILE" logs --tail=60 "$TARGET" || true
    fail "new container never became healthy; $ACTIVE is still serving"
  fi

  # Does the live colour already run this very commit (a redeploy, or a
  # bring-up re-run)? Then the smoke test below cannot tell the colours apart.
  local same_build=no active_body
  if [ "$ACTIVE" != none ] \
     && active_body="$(curl -fsS --noproxy '*' --max-time 4 "http://127.0.0.1:$(port_for "$ACTIVE")/api/health" 2>/dev/null)" \
     && [ "$(health_commit "$active_body")" = "$EXPECTED_SHA" ]; then
    same_build=yes
  fi

  # --- switch ---------------------------------------------------------------
  # image.env is snapshotted first: a rollback puts it back with the upstream.
  STATE_BACKUP="$(mktemp "$APP_DIR/.image.env.prev.XXXXXX")"
  if [ -f "$STATE_FILE" ]; then cp -p -- "$STATE_FILE" "$STATE_BACKUP"; else rm -f -- "$STATE_BACKUP"; fi
  STATE_SAVED=1

  if ! switch_edge "$TARGET" "$TARGET_PORT"; then
    if [ "$SWITCH_RESTORED" = yes ]; then
      fail "the new upstream was not applied; the upstream file is as it was, $ACTIVE still serving"
    fi
    fail "edge config test failed and the upstream file could not be put back (see above); the edge was not reloaded, $ACTIVE still serving"
  fi

  # Record the live state BEFORE retiring the old colour, so a reboot in the
  # middle of a deploy still comes back on the image that is actually serving.
  # Then a reload, not a restart: workers finish their in-flight requests and
  # new ones go to the new colour. This is what makes it zero-downtime.
  SWITCHED=1
  printf 'IMAGE=%s\nACTIVE_COLOUR=%s\n' "$IMAGE" "$TARGET" > "$STATE_FILE"
  if ! edge_reload; then
    log "edge reload failed; putting the previous upstream back"
    roll_back_edge || fail "edge reload failed and the rollback did not complete; $TARGET left running"
    fail "edge reload failed; rolled back"
  fi
  EDGE_RELOADED=1
  log "the edge now points at $TARGET"

  # --- smoke test through the edge -----------------------------------------
  # Same commit on both colours: pause the old one, so an answer through the
  # edge can only come from the new one. In-flight requests to the old colour
  # wait for the few seconds this takes; new ones already go to the new one.
  if [ "$same_build" = yes ]; then
    log "$ACTIVE already runs $EXPECTED_SHA; pausing it during the smoke test so only $TARGET can answer"
    if ! pause_colour "$ACTIVE"; then
      roll_back_edge || fail "could not pause $ACTIVE and the rollback did not complete; $TARGET left running"
      fail "could not pause $ACTIVE for the smoke test; rolled back, $TARGET torn down"
    fi
  fi
  if ! smoke_test; then
    roll_back_edge || fail "smoke test failed and the rollback did not complete; $TARGET left running"
    fail "smoke test failed; rolled back, $TARGET torn down"
  fi
  resume_paused
  # Committed: from here on the new upstream is the edge's real state.
  EDGE_DIRTY=0

  # --- retire the old colour ------------------------------------------------
  if [ "$ACTIVE" != none ]; then
    log "draining $ACTIVE for ${DRAIN_SECONDS}s"
    sleep "$DRAIN_SECONDS"
    docker compose -f "$COMPOSE_FILE" stop "$ACTIVE" || true
    docker compose -f "$COMPOSE_FILE" rm -f "$ACTIVE" || true
  fi

  # Keep the last few images so a manual rollback is a `deploy.sh <old-tag>`
  # away, but do not let the disk fill with every build ever shipped.
  #
  # Scoped to this project's images deliberately. `docker image prune -af`
  # would delete every OTHER service's older tags too, which on a box hosting
  # several sites quietly destroys their rollback targets. An image still in
  # use cannot be removed, so the running colour is never at risk.
  # shellcheck disable=SC2033  # xargs runs the real docker on purpose
  docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
    | awk '$1 ~ /solutionmines/ { print $2 }' \
    | tail -n +4 \
    | xargs -r docker rmi >/dev/null 2>&1 9>&- || true

  log "done — $TARGET serving $IMAGE"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  deploy_main "$@"
fi
