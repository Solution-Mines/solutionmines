# shellcheck shell=bash
# ============================================================================
# GUARD — the checks every script runs before it changes this box.
#
#   . /opt/solutionmines/guard.sh        (or deploy/guard.sh in a checkout)
#
# A LIBRARY, not a script. Sourcing it defines functions and nothing else: no
# command runs, no variable is set, nothing on the box changes. That is what
# lets bootstrap.sh, bring-up.sh, enable-tls.sh and deploy.sh share one copy
# of each check, and lets deploy/test/guard.test.sh exercise every one of them
# against stubs without going near a real server.
#
# bootstrap.sh and bring-up.sh install it next to preflight.sh in
# /opt/solutionmines/.
# ============================================================================

# --- preflight --------------------------------------------------------------
# sm_run_preflight <path-to-preflight.sh>
#
# Runs preflight in a clean environment and accepts exactly the contract:
#   rc 0 with SHARED=no   -> dedicated
#   rc 3 with SHARED=yes  -> shared (or cannot verify)
# and stdout of exactly three lines, in order:
#   SHARED=yes|no
#   APP_PORTS_FREE=yes|no
#   SSH_PORTS=<digits separated by single spaces, possibly empty>
# Anything else means preflight itself broke, and the caller must refuse.
#
# `env -i` with a fixed PATH: nothing the caller exported (a test root, a
# SHELLOPTS=noglob, a PATH with a stray `ss` in it, BASH_ENV) can reach
# preflight and change its verdict. env itself is called by absolute path for
# the same reason.
#
# Sets SM_SHARED, SM_APP_PORTS_FREE and SM_SSH_PORTS. The human-readable report
# goes to stderr, straight through to the operator. Returns 1 if preflight broke.
sm_run_preflight() {
  local pf="${1:-}" out rc body
  SM_SHARED="" SM_APP_PORTS_FREE="" SM_SSH_PORTS=""
  if [ -z "$pf" ] || [ ! -f "$pf" ]; then
    echo "guard: preflight not found at '${pf}'" >&2
    return 1
  fi
  # The exit code rides along as a last line, so the output is captured
  # byte for byte (a bare $(...) would hide extra trailing blank lines) and
  # `set -e` in the caller cannot abort on rc 3.
  out="$(if /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C \
              bash "$pf" --emit </dev/null; then
           printf '\n0'
         else
           printf '\n%s' "$?"
         fi)"
  rc="${out##*$'\n'}"
  body="${out%$'\n'*}"
  body="${body%$'\n'}"   # the one newline that ends the third line

  local re='^SHARED=(yes|no)'$'\n''APP_PORTS_FREE=(yes|no)'$'\n''SSH_PORTS=([0-9]+( [0-9]+)*)?$'
  if ! [[ $body =~ $re ]]; then
    echo "guard: preflight (exit $rc) did not print the three expected lines; treating it as broken" >&2
    return 1
  fi
  local shared="${BASH_REMATCH[1]}" ports_free="${BASH_REMATCH[2]}" ssh="${BASH_REMATCH[3]}"
  if ! { [ "$rc" = 0 ] && [ "$shared" = no ]; } && ! { [ "$rc" = 3 ] && [ "$shared" = yes ]; }; then
    echo "guard: preflight exit code $rc contradicts SHARED=$shared; treating it as broken" >&2
    return 1
  fi
  SM_SHARED="$shared"
  SM_APP_PORTS_FREE="$ports_free"
  # shellcheck disable=SC2034  # read by the scripts that source this file
  SM_SSH_PORTS="$ssh"
  return 0
}

# --- edge.env ---------------------------------------------------------------
# sm_check_edge_env <file>
#
# Validates a shared-edge config before anything acts on it. Prints every
# problem (not just the first) to stderr and returns 1 if there are any.
# It sources the file in a subshell, so nothing it sets leaks into the caller.
#
# Why each rule exists:
#  - all five keys explicit: a copy of the example with everything commented
#    out used to switch edge mode on and then fall back to THIS site's nginx
#    defaults, i.e. write into and reload the other site's proxy;
#  - UPSTREAM_FILE outside conf.d / sites-*: nginx loads those directories
#    whole, so a bare `server ...;` line there breaks the other site's config;
#    the same goes for a directory a Caddyfile imports by glob;
#  - UPSTREAM_FILE's directory, and every directory above it, owned by root
#    (or the checking user) and not writable by group or others (a sticky
#    /tmp-like parent is fine): deploy.sh writes there as root, and whoever
#    can create or swap names in that directory can redirect root's write
#    onto any file on the box;
#  - an existing UPSTREAM_FILE must hold exactly the line deploy.sh writes
#    (for blue or green), and its directory nothing else: anything else is
#    some other config of the proxy's (another site's upstream include, the
#    main Caddyfile, mime.types) that deploy.sh would overwrite;
#  - SMOKE_URL by hostname: a shared edge routes by Host, so 127.0.0.1 or
#    localhost reaches its catch-all, not this site, and proves nothing.
#    Nor on port 3001/3002: that is the container itself, not the proxy.
sm_check_edge_env() (
  set +e +u
  f="${1:-}"
  unset UPSTREAM_FILE UPSTREAM_LINE EDGE_TEST_CMD EDGE_RELOAD_CMD SMOKE_URL
  problems=()
  p() { problems+=("$*"); }

  if [ -z "$f" ]; then
    p "no edge.env path given"
  elif [ -L "$f" ] || [ ! -f "$f" ]; then
    p "$f must be a regular file (not a symlink, directory or missing)"
  elif [ ! -r "$f" ]; then
    p "$f is not readable"
  else
    # deploy.sh sources this file as root, so whoever can write it, or
    # replace it in its directory, runs commands as root. Owned by the user
    # checking it (root, in production), and so is its directory; neither
    # writable by group or others.
    me="$(id -u)"
    owner="$(stat -c %u -- "$f" 2>/dev/null)"
    if [ "$owner" != "$me" ] && [ "$owner" != 0 ]; then
      p "$f is owned by uid ${owner:-?}, not root; deploy.sh runs its commands as root (sudo chown root:root $f)"
    fi
    if [ -n "$(find "$f" -maxdepth 0 -perm /022 2>/dev/null)" ]; then
      p "$f is writable by group or others; deploy.sh runs its commands as root (chmod 600 or 644)"
    fi
    d="$(dirname -- "$f")"
    downer="$(stat -L -c %u -- "$d" 2>/dev/null)"
    if [ "$downer" != "$me" ] && [ "$downer" != 0 ]; then
      p "$d (the directory holding $f) is owned by uid ${downer:-?}, not root, so that user can replace the file"
    fi
    if [ -n "$(find -L "$d" -maxdepth 0 -perm /022 2>/dev/null)" ]; then
      p "$d (the directory holding $f) is writable by group or others, so they can replace the file"
    fi
    # Sourced in a nested subshell that reports the five values back, %q
    # quoted, then a sentinel. A file that calls `exit` loses the sentinel
    # and is refused instead of slipping through as "no problems".
    dump="$(
      unset UPSTREAM_FILE UPSTREAM_LINE EDGE_TEST_CMD EDGE_RELOAD_CMD SMOKE_URL
      # shellcheck source=/dev/null
      . "$f" >/dev/null 2>&1 </dev/null
      st=$?
      for k in UPSTREAM_FILE UPSTREAM_LINE EDGE_TEST_CMD EDGE_RELOAD_CMD SMOKE_URL; do
        printf '%s=%q\n' "$k" "${!k-}"
      done
      printf 'SM_END=%s\n' "$st"
    )"
    case "$dump" in
      *$'\n'SM_END=0) ;;
      *$'\n'SM_END=*) p "$f did not source cleanly (a command in it failed)" ;;
      *) p "$f exits or aborts when sourced" ;;
    esac
    while IFS= read -r line; do
      case "$line" in
        UPSTREAM_FILE=*|UPSTREAM_LINE=*|EDGE_TEST_CMD=*|EDGE_RELOAD_CMD=*|SMOKE_URL=*)
          eval "$line" ;;   # %q output: safe to read back
      esac
    done <<<"$dump"
  fi

  for k in UPSTREAM_FILE UPSTREAM_LINE EDGE_TEST_CMD EDGE_RELOAD_CMD SMOKE_URL; do
    [ -n "${!k}" ] || p "$k is not set (every one of the five keys must be set explicitly; there are no defaults in edge mode)"
  done

  # UPSTREAM_FILE
  # shellcheck disable=SC2153  # set by the eval above
  u="$UPSTREAM_FILE"
  if [ -n "$u" ]; then
    case "$u" in
      /*) ;;
      *) p "UPSTREAM_FILE must be an absolute path (got '$u')" ;;
    esac
    case "/$u/" in
      */../*|*/./*) p "UPSTREAM_FILE must not contain '.' or '..' components (got '$u')" ;;
    esac
    case "$u" in
      */) p "UPSTREAM_FILE must name a file, not a directory (got '$u')" ;;
    esac
    # Squeeze repeated slashes for the lexical check.
    norm="$(printf '%s' "$u" | tr -s '/')"
    dir="${norm%/*}"; [ -n "$dir" ] || dir=/
    base="${norm##*/}"
    resolved=""
    if [ -d "$dir" ]; then
      resolved="$(cd "$dir" 2>/dev/null && pwd -P)"
    else
      p "UPSTREAM_FILE's directory $dir does not exist (create it first; it must be a directory of its own)"
    fi
    for bad in /etc/nginx/conf.d /etc/nginx/sites-enabled /etc/nginx/sites-available; do
      badr="$bad"
      [ -d "$bad" ] && badr="$(cd "$bad" 2>/dev/null && pwd -P)"
      for d in "$dir" "$resolved"; do
        [ -n "$d" ] || continue
        case "$d/" in
          "$bad"/*|"$badr"/*)
            p "UPSTREAM_FILE must not be under $bad: nginx loads every file there, and a bare upstream line breaks the whole config"
            break 2 ;;
        esac
      done
    done
    if [ -L "$u" ] || { [ -e "$u" ] && [ ! -f "$u" ]; }; then
      p "UPSTREAM_FILE $u exists but is not a regular file"
    fi
    # Who can create, rename or replace names on the way to UPSTREAM_FILE:
    # every directory of the path as written (a symlinked component can be
    # swapped by whoever owns the directory holding it) and as resolved.
    me="$(id -u)"
    checked=" "
    for start in "$dir" "$resolved"; do
      case "$start" in /*) ;; *) continue ;; esac
      d="$start"; first=yes
      while [ -n "$d" ]; do
        case "$checked" in *" $first:$d "*) ;; *)
          checked="$checked$first:$d "
          downer="$(stat -L -c %u -- "$d" 2>/dev/null)"
          dmode="$(stat -L -c %a -- "$d" 2>/dev/null)"
          if [ -z "$downer" ] || [ -z "$dmode" ]; then
            [ -e "$d" ] && p "UPSTREAM_FILE: cannot read the owner and mode of $d"
          else
            dmode=$((8#$dmode))
            if [ "$downer" != 0 ] && [ "$downer" != "$me" ]; then
              p "UPSTREAM_FILE: $d is owned by uid $downer, not root; deploy.sh writes UPSTREAM_FILE as root, so that user could redirect the write onto any file (sudo chown root:root $d)"
            elif [ "$first" = yes ] && [ $((dmode & 8#022)) -ne 0 ]; then
              p "UPSTREAM_FILE's directory $d is writable by group or others; deploy.sh writes there as root (sudo chmod go-w $d)"
            elif [ $((dmode & 8#022)) -ne 0 ] && [ $((dmode & 8#1000)) -eq 0 ]; then
              p "UPSTREAM_FILE: $d is writable by group or others, so they can swap the directories below it (sudo chmod go-w $d)"
            fi
          fi ;;
        esac
        [ "$d" = / ] && break
        d="${d%/*}"; [ -n "$d" ] || d=/
        first=no
      done
    done
    # A directory of site files that the proxy imports by glob: the dir is
    # called sites*/conf.d, or other files with the same extension live in
    # it. The upstream file needs a directory of its own, imported by path
    # from inside this site's block.
    dname="${dir##*/}"
    case "$dname" in
      sites|sites-*|conf.d|*.d)
        p "UPSTREAM_FILE is in $dir, which looks like a directory the proxy loads whole; give it a directory of its own and import it from inside this site's block" ;;
      *)
        # A directory of its own: nothing in it but UPSTREAM_FILE and
        # deploy.sh's own temp files (.<name>.XXXXXX.sm-tmp, or <name>.sm-tmp
        # from older versions).
        if [ -n "$resolved" ]; then
          for other in "$resolved"/* "$resolved"/.[!.]* "$resolved"/..?*; do
            [ -e "$other" ] || [ -L "$other" ] || continue
            o="${other##*/}"
            case "$o" in
              "$base"|".$base".*.sm-tmp|"$base.sm-tmp") continue ;;
            esac
            if [ "${o##*.}" = "${base##*.}" ] && [ "$o" != "${o##*.}" ]; then
              p "UPSTREAM_FILE's directory $dir also holds $o: it looks like a directory the proxy imports by glob ('*.${base##*.}'); give the upstream file a directory of its own"
            else
              p "UPSTREAM_FILE's directory $dir also holds $o; give the upstream file a directory of its own, holding nothing else"
            fi
            break
          done
        fi ;;
    esac
  fi

  # UPSTREAM_LINE
  line_ok=no
  if [ -n "$UPSTREAM_LINE" ]; then
    case "$UPSTREAM_LINE" in
      *__PORT__*|*__COLOUR__*) line_ok=yes ;;
      *) p "UPSTREAM_LINE must contain __PORT__ or __COLOUR__, or the switch never changes anything (got '$UPSTREAM_LINE')" ;;
    esac
  fi

  # An existing UPSTREAM_FILE must be one deploy.sh wrote (or the operator
  # created as the docs say): exactly the line for blue or for green. One
  # slip in edge.env can name another site's upstream include or the proxy's
  # main config, which the validator would otherwise hand to deploy.sh to
  # overwrite and reload.
  if [ -n "$u" ] && [ -f "$u" ] && [ ! -L "$u" ] && [ "$line_ok" = yes ]; then
    mine=no
    for cp in blue:3001 green:3002; do
      l="${UPSTREAM_LINE//__COLOUR__/${cp%:*}}"; l="${l//__PORT__/${cp#*:}}"
      if cmp -s -- "$u" <(printf '%s\n' "$l") || cmp -s -- "$u" <(printf '%s' "$l"); then mine=yes; break; fi
    done
    if [ "$mine" != yes ]; then
      l="${UPSTREAM_LINE//__COLOUR__/blue}"; l="${l//__PORT__/3001}"
      p "UPSTREAM_FILE $u already exists and holds something deploy.sh did not write. It must hold exactly the one line UPSTREAM_LINE gives for blue ('$l') or for green. Is it another site's file, or the proxy's own config? If it really is this site's, write that one line into it"
    fi
  fi

  # SMOKE_URL
  s="$SMOKE_URL"
  if [ -n "$s" ]; then
    case "$s" in
      http://*|https://*)
        rest="${s#*://}"
        hostport="${rest%%[/?#]*}"
        hostport="${hostport##*@}"
        case "$hostport" in
          \[*) host="$hostport" ;;
          *) host="${hostport%%:*}" ;;
        esac
        host="${host,,}"; host="${host%.}"
        port=""
        case "$hostport" in
          \[*\]:*) port="${hostport##*]:}" ;;
          \[*) ;;
          *:*) port="${hostport#*:}" ;;
        esac
        case "$port" in ''|*[!0-9]*) ;; *) [ "${#port}" -le 6 ] && port=$((10#$port)) ;; esac
        case "$port" in 3001|3002)
          p "SMOKE_URL must not use port $port: that is this site's own container, not the proxy, so the smoke test would pass whatever the proxy does. Use the port the proxy listens on" ;;
        esac
        if [ -z "$host" ]; then
          p "SMOKE_URL has no host (got '$s')"
        elif [ "$host" = localhost ]; then
          p "SMOKE_URL must not use plain 'localhost': the shared edge routes by Host, so it lands on the catch-all. Use a name this site's block matches, e.g. an alias like sm.localhost"
        elif [[ $host == \[* ]] || [[ $host =~ ^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+))*$ ]]; then
          p "SMOKE_URL must not use an IP address ($host): the shared edge routes by Host, so it lands on the catch-all. Use a name this site's block matches"
        fi ;;
      *) p "SMOKE_URL must be an http:// or https:// URL (got '$s')" ;;
    esac
  fi

  if [ "${#problems[@]}" -gt 0 ]; then
    echo "edge.env: ${f:-?} is not usable:" >&2
    for m in "${problems[@]}"; do echo "  - $m" >&2; done
    return 1
  fi
  return 0
)

# --- the refusal ------------------------------------------------------------
# sm_print_refusal <absolute path of edge.env.example> <command to re-run, without sudo> [what changed so far]
# The one text bootstrap.sh and bring-up.sh print on a shared box, so the two
# can never drift apart again. The third argument replaces "Nothing has been
# changed." for a caller that has already written something (bring-up's clone).
sm_print_refusal() {
  local example="${1:-/opt/solutionmines-src/deploy/edge.env.example}" rerun="${2:-the same command}"
  local changed="${3:-Nothing has been changed.}"
  cat <<REFUSE

== refusing: this box already serves another site, or preflight could not rule that out ==

$changed Preflight's report above gives the reason.

If it says "cannot verify", preflight could not read something it needs (a
tool missing or failing, Docker stopped, nginx -t failing): fix that and
re-run. That is not a shared box, and forcing past it skips the check.

If it names another site: installing nginx here and taking default_server
on :80/:443 would take that site down. To deploy behind the proxy that is
already here:
  1. sudo install -d -m 0755 /opt/solutionmines
  2. sudo cp $example /opt/solutionmines/edge.env
  3. Edit /opt/solutionmines/edge.env and set all five keys for this box's
     proxy: UPSTREAM_FILE, UPSTREAM_LINE, EDGE_TEST_CMD, EDGE_RELOAD_CMD and
     SMOKE_URL. An unedited copy is refused.
  4. Create UPSTREAM_FILE first, in a root-owned directory of its own
     (sudo install -d -m 0755 <its directory>), holding the one line
     UPSTREAM_LINE gives for blue, e.g. 'reverse_proxy solutionmines-blue:3000'
     or 'server 127.0.0.1:3001;'. The proxy's test fails on an import of a
     file that does not exist.
  5. Then add this site's block to the existing proxy, importing UPSTREAM_FILE
     from inside it, and test the proxy's config. If the proxy runs in a
     container, put it on the shared network:
       sudo docker network inspect edge >/dev/null 2>&1 || sudo docker network create edge
       sudo docker network connect edge <proxy-container>
  6. Set SMOKE_URL to a hostname that block matches (a local alias such as
     sm.localhost, or the real domain once DNS points here). Not 127.0.0.1,
     and not port 3001/3002.
  7. Re-run:  sudo $rerun
     The re-run deploys straight away, so steps 4 to 6 must be done first.

See "Running behind a shared edge proxy" in docs/03-deployment.md.

If you are certain this box is dedicated to this site and preflight is wrong
(it named another site, it did not just fail to verify):
  sudo SM_FORCE_DEDICATED=1 $rerun
REFUSE
}

# --- the old conf.d layout ----------------------------------------------------
# sm_legacy_layout_present [nginx dir]
# True when nginx files from the old layout (before guard.sh) are still in
# conf.d. nginx loads every conf.d/*.conf at http level, where the proxy
# snippet (proxy_pass) and the bare upstream line are errors, so `nginx -t`
# fails on such a box and preflight cannot read the configuration.
sm_legacy_layout_present() {
  local d="${1:-/etc/nginx}"
  [ -e "$d/conf.d/solutionmines-proxy.conf" ] || [ -e "$d/conf.d/solutionmines-upstream.conf" ]
}

# sm_print_legacy_layout <re-run command, without sudo> [nginx dir]
# The migration by hand, for a box where only our own old files make
# `nginx -t` fail. It is what bootstrap.sh would do, but bootstrap cannot run
# before preflight has a verdict, and preflight cannot get one until nginx
# accepts its configuration again.
sm_print_legacy_layout() {
  local rerun="${1:-the same command}" d="${2:-/etc/nginx}"
  cat <<LEGACY

== this box has nginx files from an older version of this site ==

$d/conf.d/solutionmines-proxy.conf and/or solutionmines-upstream.conf
are still in conf.d, where nginx rejects them, so 'nginx -t' fails and
preflight cannot read what nginx serves. If the ONLY reason preflight gives
above is that 'nginx -T' failed, move them to where the current version keeps
them, then check nginx and re-run:

  sudo install -d -m 0755 $d/solutionmines $d/snippets
  sudo sh -c "grep -Eo 'server 127\.0\.0\.1:300[12];' $d/conf.d/solutionmines-upstream.conf | head -1 > $d/solutionmines/upstream.conf"
  sudo sh -c "[ -s $d/solutionmines/upstream.conf ] || echo 'server 127.0.0.1:3001;' > $d/solutionmines/upstream.conf"
  sudo mv $d/conf.d/solutionmines-proxy.conf $d/snippets/solutionmines-proxy.conf
  sudo rm -f $d/conf.d/solutionmines-upstream.conf
  sudo sed -i 's#$d/conf.d/solutionmines-upstream.conf#$d/solutionmines/upstream.conf#' $d/conf.d/solutionmines-zones.conf
  sudo sed -i 's#$d/conf.d/solutionmines-proxy.conf#$d/snippets/solutionmines-proxy.conf#g' $d/sites-available/solutionmines
  sudo nginx -t
  sudo $rerun

If preflight gives any other reason, the box is shared: see the refusal below.
LEGACY
}

# --- the gate ---------------------------------------------------------------
# sm_gate <preflight.sh> <edge.env> <edge.env.example> <re-run command> [what changed so far] [nginx dir]
#
# Everything bootstrap.sh and bring-up.sh must establish BEFORE they change
# anything. Sets SM_EDGE_MODE (yes|no) plus the SM_* values from preflight.
# Returns 0 to proceed, 1 to refuse (broken input), 3 to refuse (shared box).
# "What changed so far" replaces "Nothing has been changed." in every refusal,
# for a caller (bring-up's second gate) that has already written something.
sm_gate() {
  local pf="$1" edge_env="$2" example="$3" rerun="$4"
  local changed="${5:-Nothing has been changed.}" ngx="${6:-/etc/nginx}"
  SM_EDGE_MODE=no
  if [ -e "$edge_env" ] || [ -L "$edge_env" ]; then
    SM_EDGE_MODE=yes
    if ! sm_check_edge_env "$edge_env"; then
      echo "refusing: $edge_env exists, so this is shared-edge mode, but it is not usable (see above). $changed" >&2
      return 1
    fi
  fi
  if ! sm_run_preflight "$pf"; then
    echo "refusing: preflight could not give a trustworthy verdict. $changed" >&2
    return 1
  fi
  if [ "$SM_APP_PORTS_FREE" != yes ]; then
    cat >&2 <<PORTS
refusing: TCP 3001 or 3002 is in use (a listener, a container or a NAT rule)
by something other than this site's own containers (solutionmines-blue on
3001, solutionmines-green on 3002), or preflight could not check them. Its
report above says which. If it says "cannot verify" or "could not be
listed/read", fix that (start Docker, install the missing tool) and re-run.
Otherwise: both colours publish 127.0.0.1:3001 and :3002, so the first
deploy would fail. For listeners:
  sudo ss -ltnp '( sport = :3001 or sport = :3002 )'
$changed
PORTS
    return 1
  fi
  if [ "$SM_EDGE_MODE" = yes ]; then
    echo "edge.env present: shared-edge mode. nginx, certificates and the firewall will not be touched." >&2
    return 0
  fi
  if [ "$SM_SHARED" = yes ]; then
    if [ "${SM_FORCE_DEDICATED:-}" = 1 ]; then
      echo "SM_FORCE_DEDICATED=1: treating this box as dedicated although preflight says it is shared." >&2
      return 0
    fi
    if sm_legacy_layout_present "$ngx"; then
      sm_print_legacy_layout "$rerun" "$ngx"
    fi
    sm_print_refusal "$example" "$rerun" "$changed"
    return 3
  fi
  return 0
}

# --- small helpers the scripts share (each one tested) ----------------------

# sm_site_needs_http_config <site file>
# True when bootstrap may (re)install the HTTP-only site: the file is absent,
# or it has no ssl_certificate directive. A re-run after enable-tls.sh must
# never swap the live TLS site back to HTTP-only.
sm_site_needs_http_config() {
  [ -f "$1" ] || return 0
  ! grep -Eq '^[[:space:]]*ssl_certificate[[:space:]]' "$1"
}

# sm_initial_upstream <legacy upstream file> <image.env>
# The upstream line bootstrap writes when /etc/nginx/solutionmines/upstream.conf
# does not exist yet: carry over the old conf.d file if there is one, else
# point at whichever colour image.env says is live, else blue.
sm_initial_upstream() {
  local legacy="$1" state="$2" line
  if [ -f "$legacy" ]; then
    line="$(grep -Eo 'server 127\.0\.0\.1:300[12];' "$legacy" | head -1)"
    [ -n "$line" ] && { printf '%s\n' "$line"; return 0; }
  fi
  if [ -f "$state" ] && grep -qx 'ACTIVE_COLOUR=green' "$state"; then
    echo "server 127.0.0.1:3002;"
  else
    echo "server 127.0.0.1:3001;"
  fi
}

# sm_default_branch <directory inside a git checkout>
# The branch that checkout is on, or main. Reads .git/HEAD directly first:
# running git as root on a checkout another user owns trips git's
# safe.directory check, which would silently fall back to main.
sm_default_branch() {
  local top
  top="$(cd "$1/.." 2>/dev/null && pwd)" || { echo main; return 0; }
  local b=""
  if [ -f "$top/.git/HEAD" ]; then
    b="$(sed -n 's#^ref: refs/heads/##p' "$top/.git/HEAD" | head -1)"
  elif command -v git >/dev/null 2>&1; then
    b="$(git -c safe.directory="$top" -C "$top" symbolic-ref --short -q HEAD 2>/dev/null || true)"
  fi
  if [ -n "$b" ] && [[ $b =~ ^[A-Za-z0-9._/-]+$ ]] && [[ $b != -* ]]; then
    printf '%s\n' "$b"
  else
    echo main
  fi
}

# sm_tls_site_installed <site file> <domain>
# True when the site file is already the TLS site for <domain> (it uses that
# domain's Let's Encrypt certificate). enable-tls.sh then keeps it as it is:
# re-rendering the template would silently undo what the operator was told
# to do by hand afterwards (enable HSTS, enforce the CSP).
sm_tls_site_installed() {
  local site="$1" domain="$2"
  [ -f "$site" ] || return 1
  [[ $domain =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || return 1
  grep -Eq "^[[:space:]]*ssl_certificate[[:space:]]+/etc/letsencrypt/live/${domain//./\\.}/fullchain\.pem;" "$site"
}

# sm_dns_points_here <name> <this box's public IPv4, or ''> <this box's global IPv6 addresses, space-separated>
# Does <name> resolve to this box in every address family it has records
# for? Let's Encrypt validates over IPv6 when there is an AAAA record, so an
# AAAA that points elsewhere (a registrar's parking record) fails validation
# exactly like a wrong A record. Prints what it found and why it refuses.
# An unknown IPv4 ('' : the lookup service was unreachable) is not compared.
sm_dns_points_here() {
  local name="$1" ip4="${2:-}" ip6s=" ${3:-} " a4 a6 x bad=0
  a4="$(getent ahostsv4 "$name" 2>/dev/null | awk '{ print $1 }' | sort -u | tr '\n' ' ')"
  # ahostsv6 also returns IPv4-mapped addresses (::ffff:a.b.c.d) for A records
  a6="$(getent ahostsv6 "$name" 2>/dev/null | awk '$1 ~ /:/ && tolower($1) !~ /^::ffff:/ { print $1 }' | sort -u | tr '\n' ' ')"
  echo "   $name -> A: ${a4:-none}  AAAA: ${a6:-none}"
  if [ -z "${a4// /}${a6// /}" ]; then
    echo "   $name does not resolve yet. Add its A record and wait, then re-run."
    return 1
  fi
  for x in $a4; do
    if [ -n "$ip4" ] && [ "$x" != "$ip4" ]; then
      echo "   $name has an A record $x, but this server's IPv4 address is $ip4."
      bad=1
    fi
  done
  for x in $a6; do
    case "$ip6s" in
      *" $x "*) ;;
      *) if [ -n "${ip6s// /}" ]; then
           echo "   $name has an AAAA record $x, which is not an address of this server (${3})."
         else
           echo "   $name has an AAAA record $x, but this server has no global IPv6 address."
         fi
         echo "   Let's Encrypt would validate over IPv6 and fail: remove that AAAA record, or point it here."
         bad=1 ;;
    esac
  done
  return "$bad"
}

# sm_check_deploy_user <user> <app dir>
# bootstrap.sh gives the CI user sudo on deploy.sh, an authorized_keys file
# and (taking back what older versions did) removes it from the docker group.
# All fine for a user this site created. On a box that already has an account
# of that name, set up by someone else (a `deploy` user is common), each of
# those changes someone else's account, and dropping it from the docker group
# can break their CI. So, before anything changes:
#   prints "new"     the user does not exist yet;
#   prints "ours"    it exists and an earlier bootstrap installed $app_dir/deploy.sh;
#   prints "adopted" it exists and SM_DEPLOY_USER_OK=1 says it is this site's;
#   otherwise prints the refusal to stderr and returns 1.
sm_check_deploy_user() {
  local user="$1" app="$2"
  if ! id "$user" >/dev/null 2>&1; then echo new; return 0; fi
  if [ -e "$app/deploy.sh" ]; then echo ours; return 0; fi
  if [ "${SM_DEPLOY_USER_OK:-}" = 1 ]; then echo adopted; return 0; fi
  cat >&2 <<USER
refusing: a user named '$user' already exists, and this site was never set up
on this box ($app/deploy.sh is missing), so that account is someone else's.
Bootstrap would give it sudo on $app/deploy.sh and an authorized_keys file.
Nothing has been changed. If the account really is meant for this site's CI,
re-run with SM_DEPLOY_USER_OK=1 (its group memberships are left alone).
USER
  return 1
}

# sm_ufw_active
# True when ufw is installed and active. Read in the C locale with LANGUAGE
# cleared: ufw's status line is translated (Ubuntu's language packs carry
# ufw.mo; "Status: active" reads "État : actif" under LANG=fr_FR.UTF-8, and
# Python's gettext reads LANGUAGE before LC_ALL). Captured whole, never piped
# into `grep -q`: under pipefail a long rule set makes ufw exit 120 on EPIPE
# once grep has stopped reading.
sm_ufw_active() {
  local st=""
  command -v ufw >/dev/null 2>&1 || return 1
  st="$(LC_ALL=C LANGUAGE='' ufw status 2>/dev/null)" || true
  case "$st" in
    'Status: active'*) return 0 ;;
    *) return 1 ;;
  esac
}

# sm_other_firewall
# Prints the firewall manager other than ufw that is in charge of this box
# (firewalld, nftables for nftables.service, netfilter-persistent for
# iptables-persistent), and returns 0; returns 1 if there is none. Read-only:
# it only asks systemctl and dpkg-query. On such a box ufw must not be
# suggested: two managers fight over the same tables, and installing ufw
# removes netfilter-persistent (ufw Breaks: it).
sm_other_firewall() {
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet firewalld 2>/dev/null; then echo firewalld; return 0; fi
    if systemctl is-active --quiet nftables 2>/dev/null; then echo nftables; return 0; fi
  fi
  if command -v dpkg-query >/dev/null 2>&1; then
    case "$(dpkg-query -W -f='${Status}' netfilter-persistent 2>/dev/null)" in
      *' installed') echo netfilter-persistent; return 0 ;;
    esac
  fi
  return 1
}

# sm_print_firewall_steps <manager>: how to open 80/443 in that manager.
sm_print_firewall_steps() {
  case "$1" in
    firewalld)
      echo "     sudo firewall-cmd --permanent --add-service=http --add-service=https"
      echo "     sudo firewall-cmd --reload" ;;
    nftables)
      echo "     # add 'tcp dport { 80, 443 } accept' to the input chain in /etc/nftables.conf, then:"
      echo "     sudo nft -c -f /etc/nftables.conf && sudo systemctl reload nftables" ;;
    netfilter-persistent)
      echo "     sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT"
      echo "     sudo ip6tables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT"
      echo "     sudo netfilter-persistent save" ;;
  esac
}

# sm_dedicated_firewall <ssh ports>
# Dedicated mode only. Never installs ufw, never enables a firewall that is
# off, never touches iptables or nftables. If ufw is ALREADY active, adds the
# web ports to it. If another manager runs the firewall (sm_other_firewall),
# prints how to open 80/443 in THAT one, and never suggests ufw. Otherwise
# prints what to run by hand, SSH first.
sm_dedicated_firewall() {
  local ssh_ports="${1:-}" p other
  if sm_ufw_active; then
    # Not fatal: by now nginx is configured, and a missing app profile must
    # not abort bootstrap before its `nginx -t` and reload.
    if ufw allow 'Nginx Full' >/dev/null; then
      echo "   ufw is active: allowed 'Nginx Full' (80 and 443/tcp). Nothing else changed."
    else
      echo "   WARNING: ufw is active, but 'ufw allow \"Nginx Full\"' failed. Allow 80/tcp and"
      echo "   443/tcp yourself, or the site will not be reachable."
    fi
    return 0
  fi
  if other="$(sm_other_firewall)"; then
    echo "   NOT changed: this box's firewall is $other, not ufw, and this script"
    echo "   never touches a firewall. Do NOT add ufw on top of it: two managers"
    echo "   fight over the same tables, and installing ufw removes"
    echo "   netfilter-persistent. If $other drops incoming traffic by default, the"
    echo "   site is unreachable from outside until 80/tcp and 443/tcp are open in it:"
    sm_print_firewall_steps "$other"
    echo "   A provider firewall or security group in front of the box needs them too."
    return 0
  fi
  echo "   NOT changed: no active ufw here, and this script never switches a"
  echo "   firewall on. Enabling one blind can cut off SSH, a VPN, or anything"
  echo "   else that is reachable today. To do it by hand, allow SSH FIRST."
  echo "   Check which ports SSH really listens on (a socket-activated ssh.socket"
  echo "   shows up as systemd):"
  echo "     sudo ss -ltnp | grep -E 'sshd|systemd'"
  if [ -n "$ssh_ports" ]; then
    for p in $ssh_ports; do echo "     sudo ufw allow $p/tcp      # from preflight; confirm with the ss line above"; done
  else
    echo "     sudo ufw allow <ssh-port>/tcp   # preflight could not tell the SSH port"
  fi
  echo "     sudo ufw allow 'Nginx Full'"
  echo "     # ...and every other service this box must keep (VPN, mail, ...)"
  echo "     sudo ufw enable"
  echo "   A provider firewall or security group in front of the box must allow"
  echo "   80/tcp and 443/tcp too."
  return 0
}
