#!/usr/bin/env bash
# ============================================================================
# Blue/green switch. Runs ON THE SERVER; CI invokes it over SSH.
#
#   deploy.sh <image-ref> <expected-commit-sha>
#
# The contract: this script either promotes the new image or leaves the
# currently-serving container untouched. There is no in-between state where
# the site is down because a deploy half-finished — every failure path below
# aborts before the nginx upstream is rewritten.
# ============================================================================
set -euo pipefail

IMAGE="${1:?usage: deploy.sh <image-ref> <expected-commit-sha>}"
EXPECTED_SHA="${2:?usage: deploy.sh <image-ref> <expected-commit-sha>}"

APP_DIR=/opt/solutionmines
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
UPSTREAM_FILE=/etc/nginx/conf.d/solutionmines-upstream.conf
HEALTH_TIMEOUT=90
DRAIN_SECONDS=15

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { log "FAILED: $*"; exit 1; }

# Set once the switch has happened. Until then, ANY exit — a failed command
# under `set -e`, or an explicit `fail` — must take the new container back
# down. An ERR trap alone does not do this: `exit 1` inside a function is not
# a command failure, so the explicit failure paths would silently leave a
# second container running and eating memory.
SWITCHED=0
TARGET=""
on_exit() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$SWITCHED" -eq 0 ] && [ -n "$TARGET" ]; then
    log "tearing down $TARGET after a failed deploy"
    docker compose -f "$COMPOSE_FILE" stop "$TARGET" >/dev/null 2>&1 || true
    docker compose -f "$COMPOSE_FILE" rm -f "$TARGET" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap on_exit EXIT

port_for() { [ "$1" = blue ] && echo 3001 || echo 3002; }

# --- which colour is live right now? ---------------------------------------
# First deploy has no upstream file, so blue is the default target.
ACTIVE=none
if [ -f "$UPSTREAM_FILE" ]; then
  if grep -q ':3001' "$UPSTREAM_FILE"; then ACTIVE=blue
  elif grep -q ':3002' "$UPSTREAM_FILE"; then ACTIVE=green
  fi
fi
TARGET=blue
[ "$ACTIVE" = blue ] && TARGET=green
TARGET_PORT="$(port_for "$TARGET")"

log "active=$ACTIVE target=$TARGET image=$IMAGE"

cd "$APP_DIR"
export IMAGE

# --- registry auth ----------------------------------------------------------
# A package pushed to GHCR by Actions is PRIVATE by default, even when the
# repository itself is public. So an anonymous pull 401s on the very first
# deploy, which looks like a broken script rather than a permissions setting.
#
# Two ways out, and either is fine:
#   - make the package public once, in the repo's Packages settings, or
#   - drop a read:packages token in /opt/solutionmines/registry.env as
#       GHCR_USER=<github-username>
#       GHCR_TOKEN=<classic PAT with read:packages>
# The file is read here and never echoed.
REGISTRY_ENV="$APP_DIR/registry.env"
if [ -f "$REGISTRY_ENV" ]; then
  # shellcheck source=/dev/null
  . "$REGISTRY_ENV"
  if [ -n "${GHCR_TOKEN:-}" ] && [ -n "${GHCR_USER:-}" ]; then
    log "authenticating to ghcr.io as $GHCR_USER"
    printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  fi
fi

# --- start the new colour ---------------------------------------------------
# A locally built image (the bring-up path, before CI and GHCR are wired up)
# has nothing to pull from, and `compose pull` on it is a hard error rather
# than a no-op. Only pull what is actually remote.
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  log "image is already present locally — skipping pull"
else
  log "pulling image"
  if ! docker compose -f "$COMPOSE_FILE" pull "$TARGET"; then
    log "pull failed. If this is a 401/denied, the GHCR package is still private:"
    log "  make it public in the repo's Packages settings, or create $REGISTRY_ENV"
    log "  with GHCR_USER and GHCR_TOKEN (read:packages)."
    fail "could not pull $IMAGE"
  fi
fi

log "starting $TARGET on 127.0.0.1:$TARGET_PORT"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate "$TARGET"

# --- prove it is actually serving THIS build --------------------------------
# Polling until 200 is not enough: a container that came up from the PREVIOUS
# image also returns 200. Matching the commit is what catches a registry that
# served a stale tag, or a pull that silently no-op'd.
log "waiting for health on :$TARGET_PORT (timeout ${HEALTH_TIMEOUT}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
healthy=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if body="$(curl -fsS --max-time 4 "http://127.0.0.1:$TARGET_PORT/api/health" 2>/dev/null)"; then
    got_sha="$(printf '%s' "$body" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')"
    if [ "$got_sha" = "$EXPECTED_SHA" ]; then
      healthy=1
      log "healthy, commit matches ($got_sha)"
      log "mail transport: $(printf '%s' "$body" | sed -n 's/.*"mail":"\([^"]*\)".*/\1/p')"
      break
    fi
    log "answering but commit is '$got_sha', expected '$EXPECTED_SHA' — still waiting"
  fi
  sleep 2
done

if [ "$healthy" -ne 1 ]; then
  log "--- last 60 log lines from $TARGET ---"
  docker compose -f "$COMPOSE_FILE" logs --tail=60 "$TARGET" || true
  fail "new container never became healthy; $ACTIVE is still serving"
fi

# --- switch -----------------------------------------------------------------
PREV_UPSTREAM=""
[ -f "$UPSTREAM_FILE" ] && PREV_UPSTREAM="$(cat "$UPSTREAM_FILE")"

printf 'server 127.0.0.1:%s;\n' "$TARGET_PORT" > "$UPSTREAM_FILE"

if ! nginx -t 2>&1; then
  [ -n "$PREV_UPSTREAM" ] && printf '%s\n' "$PREV_UPSTREAM" > "$UPSTREAM_FILE"
  fail "nginx config test failed; upstream reverted, $ACTIVE still serving"
fi

# A reload, not a restart: workers finish their in-flight requests and new
# ones go to the new colour. This is the part that makes it zero-downtime.
nginx -s reload
SWITCHED=1
log "nginx now points at $TARGET"

# Record the live state BEFORE retiring the old colour, so a reboot in the
# middle of a deploy still comes back on the image that is actually serving.
printf 'IMAGE=%s\nACTIVE_COLOUR=%s\n' "$IMAGE" "$TARGET" > "$APP_DIR/image.env"

# --- smoke test through nginx ----------------------------------------------
if ! curl -fsS --max-time 6 -o /dev/null http://127.0.0.1/api/health; then
  log "smoke test through nginx failed — rolling the upstream back"
  if [ -n "$PREV_UPSTREAM" ]; then
    printf '%s\n' "$PREV_UPSTREAM" > "$UPSTREAM_FILE"
    nginx -t && nginx -s reload
    # The old colour is serving again, so the new one IS the one to remove.
    SWITCHED=0
    fail "rolled back to $ACTIVE"
  fi
  fail "no previous upstream to roll back to"
fi
log "smoke test passed"

# --- retire the old colour --------------------------------------------------
if [ "$ACTIVE" != none ]; then
  log "draining $ACTIVE for ${DRAIN_SECONDS}s"
  sleep "$DRAIN_SECONDS"
  docker compose -f "$COMPOSE_FILE" stop "$ACTIVE" || true
  docker compose -f "$COMPOSE_FILE" rm -f "$ACTIVE" || true
fi

# Keep the last few images so a manual rollback is a `deploy.sh <old-tag>`
# away, but do not let the disk fill with every build ever shipped.
docker image prune -af --filter "until=168h" >/dev/null 2>&1 || true

log "done — $TARGET serving $IMAGE"
