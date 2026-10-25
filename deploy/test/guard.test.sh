#!/usr/bin/env bash
# ============================================================================
# Tests for deploy/guard.sh, and for deploy.sh's switch / rollback logic.
#
#   bash deploy/test/guard.test.sh
#
# Runs anywhere, as any user, and changes nothing outside a temp directory:
# preflight is replaced by stub scripts, and docker, curl and the edge's
# test/reload commands by stubs that log what they were asked to do.
# bootstrap.sh, bring-up.sh and enable-tls.sh are never executed; their
# wiring is checked statically at the end.
# ============================================================================
# Single quotes around code that eval / bash -c run later are deliberate, as
# is `[ ... ] && ok || bad` (ok cannot fail), and subshells that set
# variables on purpose so the parent never sees them.
# shellcheck disable=SC2016,SC2015,SC2030,SC2031,SC1091
set -uo pipefail
# Files and directories this suite creates must not be group-writable, or
# sm_check_edge_env rightly refuses them, whatever the runner's umask.
umask 022

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/guard-test.XXXXXX")"
[ -n "${KEEP:-}" ] && echo "keeping $T" || trap 'rm -rf "$T"' EXIT

pass=0; failed=0
ok()   { pass=$((pass + 1)); }
bad()  { failed=$((failed + 1)); printf 'FAIL: %s\n' "$*"; }
# check <description> <command...>: passes when the command succeeds
check() { local d="$1"; shift; if "$@"; then ok; else bad "$d"; fi; }
contains() { case "$1" in *"$2"*) return 0 ;; esac; return 1; }
# first_line <file> <ERE>: the number of the first matching line, or nothing
first_line() { grep -nE "$2" "$1" | head -1 | cut -d: -f1; }
# ordered <n>...: every line number is set, and each is smaller than the next
# (one command, so `check "..." ordered ...` checks all of it)
ordered() {
  local a b
  for a in "$@"; do [ -n "$a" ] || return 1; done
  a="$1"; shift
  for b in "$@"; do [ "$a" -lt "$b" ] || return 1; a="$b"; done
}

# shellcheck source=deploy/guard.sh
. "$DEPLOY/guard.sh"

# ----------------------------------------------------------------------------
# sm_run_preflight
# ----------------------------------------------------------------------------
PF="$T/pf"; mkdir -p "$PF"
# stub <name> <exit code> <stdout, printf-style>
stub() { printf '#!/bin/bash\nprintf "%s"\necho "report for %s" >&2\nexit %s\n' "$3" "$1" "$2" > "$PF/$1.sh"; }
stub ded       0 'SHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22\n'
stub shared    3 'SHARED=yes\nAPP_PORTS_FREE=yes\nSSH_PORTS=22 2222\n'
stub noports   0 'SHARED=no\nAPP_PORTS_FREE=no\nSSH_PORTS=22\n'
stub nossh     3 'SHARED=yes\nAPP_PORTS_FREE=yes\nSSH_PORTS=\n'
stub nonl      0 'SHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22'
stub rc3no     3 'SHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22\n'
stub rc0yes    0 'SHARED=yes\nAPP_PORTS_FREE=yes\nSSH_PORTS=22\n'
stub rc1       1 'SHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22\n'
stub rc2yes    2 'SHARED=yes\nAPP_PORTS_FREE=yes\nSSH_PORTS=22\n'
stub garbage   0 'hello\nworld\n'
stub empty     0 ''
stub empty3    3 ''
stub extra     0 'SHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22\nUFW_SAFE=yes\n'
stub blank     0 'SHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22\n\n'
stub lead      0 '\nSHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22\n'
stub order     0 'APP_PORTS_FREE=yes\nSHARED=no\nSSH_PORTS=22\n'
stub old       0 'SHARED=no\nUFW_SAFE=yes\nSSH_PORTS=22\n'
stub maybe     0 'SHARED=maybe\nAPP_PORTS_FREE=yes\nSSH_PORTS=22\n'
stub pmaybe    0 'SHARED=no\nAPP_PORTS_FREE=maybe\nSSH_PORTS=22\n'
stub comma     0 'SHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22,2222\n'
stub inject    0 'SHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22;touch /tmp/x\n'
stub dblspace  0 'SHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22  2222\n'
stub crlf      0 'SHARED=no\\r\nAPP_PORTS_FREE=yes\\r\nSSH_PORTS=22\\r\n'
stub space     0 'SHARED=no \nAPP_PORTS_FREE=yes\nSSH_PORTS=22\n'
stub dup       0 'SHARED=no\nSHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=22\n'
printf '#!/bin/bash\nno-such-command-anywhere\n' > "$PF/rc127.sh"
printf '#!/bin/bash\nkill -9 $$\n' > "$PF/killed.sh"
printf '#!/bin/bash\nsyntax error ( here\n' > "$PF/syntax.sh"

pf_ok() { # <stub> <shared> <ports free> <ssh>
  local err; err="$T/pf.err"
  if ! sm_run_preflight "$PF/$1.sh" 2>"$err"; then bad "preflight $1: refused, expected accepted ($(cat "$err"))"; return; fi
  [ "$SM_SHARED" = "$2" ] && [ "$SM_APP_PORTS_FREE" = "$3" ] && [ "$SM_SSH_PORTS" = "$4" ] \
    && ok || bad "preflight $1: got '$SM_SHARED' '$SM_APP_PORTS_FREE' '$SM_SSH_PORTS'"
  grep -q "report for $1" "$err" && ok || bad "preflight $1: the stderr report was not passed through"
}
pf_broke() { # <stub>
  SM_SHARED=stale SM_APP_PORTS_FREE=stale SM_SSH_PORTS=stale
  if sm_run_preflight "$PF/$1.sh" 2>/dev/null; then bad "preflight $1: accepted, expected 'broken'"; return; fi
  [ -z "$SM_SHARED$SM_APP_PORTS_FREE$SM_SSH_PORTS" ] && ok || bad "preflight $1: left values set after refusing"
}
pf_ok ded no yes 22
pf_ok shared yes yes "22 2222"
pf_ok noports no no 22
pf_ok nossh yes yes ""
pf_ok nonl no yes 22
for s in rc3no rc0yes rc1 rc2yes garbage empty empty3 extra blank lead order old maybe pmaybe \
         comma inject dblspace crlf space dup rc127 killed syntax; do
  pf_broke "$s"
done
pf_broke does-not-exist
check "preflight with no argument is refused" eval '! sm_run_preflight 2>/dev/null'

# Under the callers' own `set -euo pipefail`, rc 3 must not abort the caller.
out="$(bash -c 'set -euo pipefail; . "$1"; sm_run_preflight "$2" 2>/dev/null; echo "continued $SM_SHARED"' _ "$DEPLOY/guard.sh" "$PF/shared.sh")"
check "rc 3 under set -euo pipefail does not abort the caller" [ "$out" = "continued yes" ]

# The caller's environment must not reach preflight. Each stub below answers
# "dedicated" ONLY if something leaked through, and "shared" otherwise.
leak_stub() { # <name> <condition that means a leak>
  printf '#!/bin/bash\nif %s; then printf "SHARED=no\\nAPP_PORTS_FREE=yes\\nSSH_PORTS=22\\n"; exit 0; fi\nprintf "SHARED=yes\\nAPP_PORTS_FREE=yes\\nSSH_PORTS=22\\n"; exit 3\n' "$2" > "$PF/$1.sh"
}
leak_stub sm_root   '[ -n "${SM_ROOT:-}" ]'
leak_stub noglob    '[[ $- == *f* ]]'
leak_stub path      '[ "$PATH" != /usr/sbin:/usr/bin:/sbin:/bin ]'
leak_stub bash_env  '[ -n "${BASH_ENV:-}" ] || [ -n "${ENV:-}" ]'
leak_stub locale    '[ "${LC_ALL:-}" != C ]'
leak_stub anyenv    '[ -n "${SM_FORCE_DEDICATED:-}${UPSTREAM_FILE:-}${HOME:-}" ]'
printf 'echo SHARED=no; echo APP_PORTS_FREE=yes; echo SSH_PORTS=22; exit 0\n' > "$T/bash_env.sh"
mkdir -p "$T/evilbin"
for b in bash env sed; do
  printf '#!/bin/sh\nprintf "SHARED=no\\nAPP_PORTS_FREE=yes\\nSSH_PORTS=22\\n"; exit 0\n' > "$T/evilbin/$b"
  chmod +x "$T/evilbin/$b"
done
r="$(SM_ROOT=/nonexistent bash -c '. "$1"; sm_run_preflight "$2" 2>/dev/null; echo "$SM_SHARED"' _ "$DEPLOY/guard.sh" "$PF/sm_root.sh")"
check "stray SM_ROOT does not reach preflight" [ "$r" = yes ]
r="$(bash -c 'set -o noglob; export SHELLOPTS; . "$1"; sm_run_preflight "$2" 2>/dev/null; echo "$SM_SHARED"' _ "$DEPLOY/guard.sh" "$PF/noglob.sh")"
check "exported SHELLOPTS=noglob does not reach preflight" [ "$r" = yes ]
r="$(bash -c 'PATH="$3:$PATH"; . "$1"; sm_run_preflight "$2" 2>/dev/null; echo "$SM_SHARED"' _ "$DEPLOY/guard.sh" "$PF/path.sh" "$T/evilbin")"
check "a caller PATH with a fake bash/env first does not reach preflight" [ "$r" = yes ]
r="$(bash -c 'export BASH_ENV="$3" ENV="$3"; . "$1"; sm_run_preflight "$2" 2>/dev/null; echo "$SM_SHARED"' _ "$DEPLOY/guard.sh" "$PF/bash_env.sh" "$T/bash_env.sh")"
check "BASH_ENV in the caller does not reach preflight" [ "$r" = yes ]
r="$(LC_ALL=POSIX bash -c '. "$1"; sm_run_preflight "$2" 2>/dev/null; echo "$SM_SHARED"' _ "$DEPLOY/guard.sh" "$PF/locale.sh")"
check "preflight always runs with LC_ALL=C" [ "$r" = yes ]
r="$(SM_FORCE_DEDICATED=1 UPSTREAM_FILE=/x bash -c '. "$1"; sm_run_preflight "$2" 2>/dev/null; echo "$SM_SHARED"' _ "$DEPLOY/guard.sh" "$PF/anyenv.sh")"
check "no other caller variable reaches preflight" [ "$r" = yes ]

# ----------------------------------------------------------------------------
# sm_check_edge_env
# ----------------------------------------------------------------------------
E="$T/edge"; mkdir -p "$E/upstreams" "$E/sites" "$E/nginx/solutionmines" "$E/conf"
printf 'othersite.example {\n\trespond "palm"\n}\n' > "$E/sites/othersite.caddy"
n=0
# edge <expect: ok|fail> <description> <substring the output must contain, or ''> <file content>
edge() {
  n=$((n + 1)); local f="$E/conf/edge$n.env" out rc=0
  printf '%s\n' "$4" > "$f"; chmod 600 "$f"
  out="$(sm_check_edge_env "$f" 2>&1)" || rc=$?
  if [ "$1" = ok ] && [ "$rc" -ne 0 ]; then bad "edge.env ($2) refused: $out"; return; fi
  if [ "$1" = fail ] && [ "$rc" -eq 0 ]; then bad "edge.env ($2) accepted, expected refused"; return; fi
  if [ -n "$3" ] && ! contains "$out" "$3"; then bad "edge.env ($2): output lacks '$3': $out"; return; fi
  ok
}
CADDY="UPSTREAM_FILE=$E/upstreams/solutionmines.caddy
UPSTREAM_LINE='reverse_proxy solutionmines-__COLOUR__:3000'
EDGE_TEST_CMD='docker exec edge-caddy-1 caddy validate --config /etc/caddy/Caddyfile'
EDGE_RELOAD_CMD='docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile'
SMOKE_URL=http://sm.localhost/api/health"
NGINX="UPSTREAM_FILE=$E/nginx/solutionmines/upstream.conf
UPSTREAM_LINE='server 127.0.0.1:__PORT__;'
EDGE_TEST_CMD='nginx -t'
EDGE_RELOAD_CMD='nginx -s reload'
SMOKE_URL=https://www.example.com/api/health"
without() { printf '%s\n' "$1" | grep -v "^$2="; }
with() { printf '%s\n' "$1" | grep -v "^$2="; printf '%s=%s\n' "$2" "$3"; }

edge ok   "valid Caddy setup" "" "$CADDY"
edge ok   "valid nginx setup" "" "$NGINX"
edge ok   "valid, with comments and export" "" "# shared Caddy
export $(printf '%s\n' "$CADDY" | head -1)
$(printf '%s\n' "$CADDY" | tail -n +2)"
edge fail "empty file" "SMOKE_URL is not set" ""
out="$(cp "$DEPLOY/edge.env.example" "$E/conf/example.env"; chmod 600 "$E/conf/example.env"; sm_check_edge_env "$E/conf/example.env" 2>&1)"
check "unedited copy of edge.env.example is refused" eval '! sm_check_edge_env "$E/conf/example.env" 2>/dev/null'
for k in UPSTREAM_FILE UPSTREAM_LINE EDGE_TEST_CMD EDGE_RELOAD_CMD SMOKE_URL; do
  check "the unedited example reports $k" contains "$out" "$k is not set"
  edge fail "$k missing" "$k is not set" "$(without "$CADDY" "$k")"
  edge fail "$k empty" "$k is not set" "$(with "$CADDY" "$k" "''")"
  edge fail "$k commented out" "$k is not set" "$(printf '%s\n' "$CADDY" | sed "s/^$k=/# $k=/")"
done
edge fail "conf.d path" "/etc/nginx/conf.d" "$(with "$NGINX" UPSTREAM_FILE /etc/nginx/conf.d/solutionmines-upstream.conf)"
edge fail "conf.d path, doubled slash" "/etc/nginx/conf.d" "$(with "$NGINX" UPSTREAM_FILE //etc//nginx//conf.d//sm.conf)"
edge fail "conf.d path, dot component" "" "$(with "$NGINX" UPSTREAM_FILE /etc/nginx/./conf.d/sm.conf)"
edge fail "conf.d path, dotdot component" "" "$(with "$NGINX" UPSTREAM_FILE /etc/nginx/x/../conf.d/sm.conf)"
edge fail "sites-enabled path" "/etc/nginx/sites-enabled" "$(with "$NGINX" UPSTREAM_FILE /etc/nginx/sites-enabled/solutionmines-upstream)"
edge fail "sites-available path" "/etc/nginx/sites-available" "$(with "$NGINX" UPSTREAM_FILE /etc/nginx/sites-available/sm)"
edge fail "Caddy sites/*.caddy path (the old example)" "directory the proxy loads whole" "$(with "$CADDY" UPSTREAM_FILE "$E/sites/solutionmines-upstream.caddy")"
mkdir -p "$E/imports"; touch "$E/imports/othersite.caddy"
edge fail "a directory holding other *.caddy files" "othersite.caddy" "$(with "$CADDY" UPSTREAM_FILE "$E/imports/solutionmines.caddy")"
edge ok   "the upstream file itself already exists, holding the line for blue" "" "$(echo 'reverse_proxy solutionmines-blue:3000' > "$E/upstreams/solutionmines.caddy"; printf '%s\n' "$CADDY")"
edge fail "relative UPSTREAM_FILE" "absolute" "$(with "$CADDY" UPSTREAM_FILE upstreams/solutionmines.caddy)"
edge fail "UPSTREAM_FILE in a missing directory" "does not exist" "$(with "$CADDY" UPSTREAM_FILE "$E/nope/solutionmines.caddy")"
edge fail "UPSTREAM_FILE is a directory" "" "$(with "$CADDY" UPSTREAM_FILE "$E/upstreams/")"
mkdir -p "$E/odd/adir"
edge fail "UPSTREAM_FILE names an existing directory" "not a regular file" "$(with "$CADDY" UPSTREAM_FILE "$E/odd/adir")"
mkdir -p "$E/odd2"; ln -sfn /etc/hostname "$E/odd2/link.caddy"
edge fail "UPSTREAM_FILE is a symlink" "not a regular file" "$(with "$CADDY" UPSTREAM_FILE "$E/odd2/link.caddy")"
if [ -d /etc/nginx/conf.d ]; then
  ln -sfn /etc/nginx/conf.d "$E/confd-link"
  edge fail "directory symlinked into conf.d" "/etc/nginx/conf.d" "$(with "$NGINX" UPSTREAM_FILE "$E/confd-link/sm.conf")"
fi
edge fail "UPSTREAM_LINE without a placeholder" "__PORT__ or __COLOUR__" "$(with "$CADDY" UPSTREAM_LINE "'reverse_proxy solutionmines-blue:3000'")"
mkdir -p "$E/upstreams-port"
edge ok   "UPSTREAM_LINE with __PORT__ only" "" "$(with "$(with "$CADDY" UPSTREAM_LINE "'reverse_proxy 127.0.0.1:__PORT__'")" UPSTREAM_FILE "$E/upstreams-port/solutionmines.caddy")"
for u in http://127.0.0.1/api/health http://127.0.0.1:8080/api/health https://127.0.0.1/ \
         http://localhost/api/health http://LOCALHOST./api/health http://localhost:80/x \
         'http://[::1]/api/health' 'http://[::1]:80/' http://2130706433/ http://0x7f.1/ \
         http://user@127.0.0.1/ http://10.0.0.5/api/health; do
  edge fail "SMOKE_URL $u" "SMOKE_URL" "$(with "$CADDY" SMOKE_URL "$u")"
done
for u in ftp://sm.localhost/ sm.localhost/api/health /api/health 'http:///api/health'; do
  edge fail "SMOKE_URL $u" "SMOKE_URL" "$(with "$CADDY" SMOKE_URL "$u")"
done
for u in http://sm.localhost/api/health http://sm.localhost:8080/api/health \
         https://www.example.com/api/health http://example.com?x=127.0.0.1; do
  edge ok "SMOKE_URL $u" "" "$(with "$CADDY" SMOKE_URL "$u")"
done
edge fail "file that calls exit" "exits or aborts" "$CADDY
exit 0"
edge fail "file with a syntax error" "" "$CADDY
if then fi ("
edge fail "file whose last command fails" "did not source cleanly" "$CADDY
false"
# every problem is reported, not just the first
out="$(printf 'UPSTREAM_FILE=/etc/nginx/conf.d/x.conf\nUPSTREAM_LINE=nothing\nSMOKE_URL=http://127.0.0.1/\n' > "$E/conf/multi.env"; chmod 600 "$E/conf/multi.env"; sm_check_edge_env "$E/conf/multi.env" 2>&1)"
for s in EDGE_TEST_CMD EDGE_RELOAD_CMD conf.d __PORT__ 'IP address'; do
  check "multiple problems: '$s' reported" contains "$out" "$s"
done
# file-level problems
check "a missing edge.env is refused" eval '! sm_check_edge_env "$E/conf/none.env" 2>/dev/null'
printf '%s\n' "$CADDY" > "$E/conf/ww.env"; chmod 666 "$E/conf/ww.env"
check "a world-writable edge.env is refused" eval '! sm_check_edge_env "$E/conf/ww.env" 2>/dev/null'
printf '%s\n' "$CADDY" > "$E/conf/real.env"; chmod 600 "$E/conf/real.env"; ln -sfn "$E/conf/real.env" "$E/conf/sym.env"
check "a symlinked edge.env is refused" eval '! sm_check_edge_env "$E/conf/sym.env" 2>/dev/null'
mkdir -p "$E/conf/dir.env"
check "an edge.env that is a directory is refused" eval '! sm_check_edge_env "$E/conf/dir.env" 2>/dev/null'
# integration NEW-7: deploy.sh sources edge.env as root, so its owner and its
# directory's owner can run commands as root; both must be root (or the user
# running the check, so this suite runs unprivileged), and the directory not
# group/other-writable.
mkdir -p "$E/gw"; chmod 775 "$E/gw"; printf '%s\n' "$CADDY" > "$E/gw/edge.env"; chmod 600 "$E/gw/edge.env"
out="$(sm_check_edge_env "$E/gw/edge.env" 2>&1)"
check "edge.env in a group-writable directory is refused (integration NEW-7)" contains "$out" "is writable by group or others, so they can replace the file"
chmod 755 "$E/gw"
check "same edge.env once its directory is 0755 is accepted (control)" sm_check_edge_env "$E/gw/edge.env"
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$E/own"; printf '%s\n' "$CADDY" > "$E/own/edge.env"; chmod 600 "$E/own/edge.env"; chown 1000:1000 "$E/own/edge.env"
  out="$(sm_check_edge_env "$E/own/edge.env" 2>&1)"
  check "edge.env owned by uid 1000, mode 0600, is refused (integration NEW-7)" contains "$out" "is owned by uid 1000, not root"
  mkdir -p "$E/own2"; chown 1000:1000 "$E/own2"; printf '%s\n' "$CADDY" > "$E/own2/edge.env"; chmod 600 "$E/own2/edge.env"
  out="$(sm_check_edge_env "$E/own2/edge.env" 2>&1)"
  check "edge.env in a directory owned by uid 1000 is refused (integration NEW-7)" contains "$out" "is owned by uid 1000, not root, so that user can replace the file"
fi
# values exported by the caller are not mistaken for the file's
printf '%s\n' "$(without "$CADDY" SMOKE_URL)" > "$E/conf/leak.env"; chmod 600 "$E/conf/leak.env"
check "a SMOKE_URL exported by the caller does not satisfy the check" \
  eval '! (export SMOKE_URL=http://sm.localhost/api/health; sm_check_edge_env "$E/conf/leak.env" 2>/dev/null)'
# no side effects on the caller
unset UPSTREAM_FILE SMOKE_URL
sm_check_edge_env "$E/conf/real.env" 2>/dev/null
check "sm_check_edge_env leaks no variables into the caller" [ -z "${UPSTREAM_FILE:-}${SMOKE_URL:-}" ]

# INT-3: the layout the docs and edge.env.example document must pass the
# check, with the upstream file outside the directory the Caddyfile imports
# by glob. Example A is read from the example itself, uncommented, with
# /opt/edge moved under the test directory.
XA="$T/exampleA"; mkdir -p "$XA/opt/edge/sites" "$XA/opt/edge/upstreams"
printf 'othersite.example {\n\trespond "palm"\n}\n' > "$XA/opt/edge/sites/othersite.caddy"
sed -n '/^# --- Example A/,/^# --- Example B/p' "$DEPLOY/edge.env.example" \
  | sed -n 's/^# \{0,1\}\(UPSTREAM_FILE\|UPSTREAM_LINE\|EDGE_TEST_CMD\|EDGE_RELOAD_CMD\|SMOKE_URL\)=/\1=/p' \
  | sed "s#/opt/edge/#$XA/opt/edge/#" > "$XA/edge.env"
chmod 600 "$XA/edge.env"
check "Example A has all five keys" [ "$(grep -c = "$XA/edge.env")" = 5 ]
check "Example A of edge.env.example passes sm_check_edge_env (INT-3)" sm_check_edge_env "$XA/edge.env"
# shellcheck disable=SC2034  # read inside the eval below
xa_up="$(sed -n 's/^UPSTREAM_FILE=//p' "$XA/edge.env")"
check "Example A's upstream file is outside the 'import sites/*.caddy' glob (INT-3)" \
  eval 'case "${xa_up#"$XA/opt/edge/"}" in sites/*) false ;; *) true ;; esac'
check "docs: the Caddyfile imports sites/*.caddy and the site block imports the upstream by path" \
  eval 'grep -q "import sites/\*\.caddy" "$DEPLOY/../docs/03-deployment.md" && grep -q "import /etc/caddy/upstreams/solutionmines.caddy" "$DEPLOY/../docs/03-deployment.md"'
check "docs and Example A name the same upstream file" grep -q 'UPSTREAM_FILE=/opt/edge/upstreams/solutionmines.caddy' "$DEPLOY/../docs/03-deployment.md"

# INT-10: the docs' fast path runs preflight before bring-up, and passes the
# branch it cloned to bring-up explicitly.
DOC="$DEPLOY/../docs/03-deployment.md"
dp="$(first_line "$DOC" '^sudo bash ~/solutionmines/deploy/preflight.sh')"; db="$(first_line "$DOC" 'deploy/bring-up.sh')"
check "docs: the fast path runs preflight before bring-up (INT-10) ($dp < $db)" ordered "$dp" "$db"
check "docs: the fast path clones \$BRANCH" grep -q 'git clone --depth 1 -b "\$BRANCH"' "$DOC"
check "docs: every bring-up command passes \$BRANCH (INT-10)" \
  eval '! grep -E "sudo bash [^ ]*bring-up\.sh" "$DOC" | grep -v "bring-up\.sh \"\\\$BRANCH\"" | grep -q .'

# ----------------------------------------------------------------------------
# sm_gate (what bootstrap.sh and bring-up.sh run before changing anything)
# ----------------------------------------------------------------------------
G="$T/gate"; mkdir -p "$G"
VALID="$E/conf/real.env"
printf '' > "$G/empty.env"; chmod 600 "$G/empty.env"
EX="$DEPLOY/edge.env.example"
gate() { # <expected rc> <description> <preflight stub> <edge.env path> [env assignments...]
  local want="$1" d="$2" pf="$3" ee="$4"; shift 4
  local rc=0
  env "$@" bash -c '. "$1"; sm_gate "$2" "$3" "$4" "bash /x/deploy/bootstrap.sh" >"$5.out" 2>&1; rc=$?; echo "$SM_EDGE_MODE" >"$5.mode"; exit $rc' \
    _ "$DEPLOY/guard.sh" "$PF/$pf.sh" "$ee" "$EX" "$G/last" || rc=$?
  [ "$rc" = "$want" ] && ok || bad "gate ($d): rc $rc, expected $want: $(cat "$G/last.out")"
}
gate 0 "dedicated, no edge.env" ded "$G/none.env"
check "dedicated gate reports edge mode no" [ "$(cat "$G/last.mode")" = no ]
gate 3 "shared, no edge.env" shared "$G/none.env"
refusal="$(cat "$G/last.out")"
for s in "install -d -m 0755 /opt/solutionmines" "sudo cp $EX /opt/solutionmines/edge.env" \
         "Edit /opt/solutionmines/edge.env" UPSTREAM_FILE SMOKE_URL "docker network connect edge" \
         "site's block" "SM_FORCE_DEDICATED=1" "Nothing has been changed" "sudo bash /x/deploy/bootstrap.sh"; do
  check "refusal text mentions '$s'" contains "$refusal" "$s"
done
check "refusal never names a relative example path" eval '! contains "$refusal" "cp deploy/edge.env.example"'
gate 0 "shared, SM_FORCE_DEDICATED=1" shared "$G/none.env" SM_FORCE_DEDICATED=1
gate 3 "shared, SM_FORCE_DEDICATED=true (only 1 counts)" shared "$G/none.env" SM_FORCE_DEDICATED=true
gate 3 "shared, SM_FORCE_DEDICATED=yes" shared "$G/none.env" SM_FORCE_DEDICATED=yes
gate 0 "shared, valid edge.env" shared "$VALID"
check "edge gate reports edge mode yes" [ "$(cat "$G/last.mode")" = yes ]
check "edge gate says nginx/firewall will not be touched" contains "$(cat "$G/last.out")" "will not be touched"
gate 0 "dedicated box, valid edge.env (edge mode anyway)" ded "$VALID"
gate 1 "shared, EMPTY edge.env" shared "$G/empty.env"
check "empty edge.env: refusal says nothing changed" contains "$(cat "$G/last.out")" "Nothing has been changed"
gate 1 "shared, empty edge.env, SM_FORCE_DEDICATED=1" shared "$G/empty.env" SM_FORCE_DEDICATED=1
gate 1 "shared, unedited example as edge.env" shared "$E/conf/example.env"
gate 1 "edge.env is a directory" shared "$E/conf/dir.env"
gate 1 "edge.env is a dangling symlink" shared "$(ln -sfn "$G/nowhere" "$G/dangling.env"; echo "$G/dangling.env")"
gate 1 "dedicated, app ports taken" noports "$G/none.env"
check "ports refusal names 3001/3002" contains "$(cat "$G/last.out")" "3001 or 3002"
gate 1 "edge mode, app ports taken" "noports" "$VALID"
for s in rc3no rc0yes garbage empty extra rc127 old; do
  gate 1 "preflight broken ($s)" "$s" "$G/none.env"
  gate 1 "preflight broken ($s), forced" "$s" "$G/none.env" SM_FORCE_DEDICATED=1
  gate 1 "preflight broken ($s), valid edge.env" "$s" "$VALID"
done
gate 3 "stray SM_ROOT cannot turn shared into dedicated" sm_root "$G/none.env" SM_ROOT=/nonexistent
r="$(SM_ROOT=/nonexistent bash -c '. "$1"; sm_gate "$2" "$3" "$4" x >/dev/null 2>&1; echo "$? $SM_SHARED"' _ "$DEPLOY/guard.sh" "$PF/sm_root.sh" "$G/none.env" "$EX")"
check "stray SM_ROOT: the gate still sees SHARED=yes and refuses with 3" [ "$r" = "3 yes" ]

# nginx-states NEW-2: our own old conf.d layout makes `nginx -t` (and so
# preflight) fail; the refusal then explains the manual migration instead of
# only pointing at shared-edge mode.
mkdir -p "$G/ngx/conf.d"; : > "$G/ngx/conf.d/solutionmines-proxy.conf"; : > "$G/ngx/conf.d/solutionmines-upstream.conf"
rc=0; bash -c '. "$1"; sm_gate "$2" "$3" "$4" "bash /x/deploy/bring-up.sh main" "" "$5"' _ "$DEPLOY/guard.sh" "$PF/shared.sh" "$G/none.env" "$EX" "$G/ngx" > "$G/legacy.out" 2>&1 || rc=$?
out="$(cat "$G/legacy.out")"
check "legacy layout: still refused with 3 (nginx-states NEW-2)" [ "$rc" = 3 ]
for s in "older version of this site" "sudo mv $G/ngx/conf.d/solutionmines-proxy.conf $G/ngx/snippets/solutionmines-proxy.conf" \
         "sudo rm -f $G/ngx/conf.d/solutionmines-upstream.conf" "sudo nginx -t" "sudo bash /x/deploy/bring-up.sh main"; do
  check "legacy layout message mentions '$s' (nginx-states NEW-2)" contains "$out" "$s"
done
bash -c '. "$1"; sm_gate "$2" "$3" "$4" x "" "$5"' _ "$DEPLOY/guard.sh" "$PF/shared.sh" "$G/none.env" "$EX" "$G/no-such-ngx" > "$G/nolegacy.out" 2>&1
check "no legacy files: no migration text (nginx-states NEW-2)" eval '! grep -q "older version of this site" "$G/nolegacy.out"'
# the migration commands, run for real against a copy of the old layout with
# the paths moved under the test directory, leave nothing in conf.d and point
# every include at the new places
ML="$T/migrate/etc/nginx"; mkdir -p "$ML/conf.d" "$ML/sites-available"
printf 'upstream solutionmines_app {\n    include %s/conf.d/solutionmines-upstream.conf;\n}\n' "$ML" > "$ML/conf.d/solutionmines-zones.conf"
printf 'proxy_pass http://solutionmines_app;\n' > "$ML/conf.d/solutionmines-proxy.conf"
echo 'server 127.0.0.1:3002;' > "$ML/conf.d/solutionmines-upstream.conf"
printf 'server {\n  location / { include %s/conf.d/solutionmines-proxy.conf; }\n}\n' "$ML" > "$ML/sites-available/solutionmines"
bash -c '. "$1"; sm_print_legacy_layout x "$2"' _ "$DEPLOY/guard.sh" "$ML" | sed -n 's/^  sudo //p' | grep -v '^nginx -t$\|^x$' > "$T/migrate/steps"
( cd "$T/migrate" && bash -e "$T/migrate/steps" ) && ok || bad "legacy migration commands failed to run"
check "migration: nothing of ours left in conf.d but the zones file" [ "$(ls "$ML/conf.d")" = solutionmines-zones.conf ]
check "migration: the upstream line was carried over" [ "$(cat "$ML/solutionmines/upstream.conf")" = "server 127.0.0.1:3002;" ]
check "migration: zones and site include the new paths only" eval '! grep -rq "conf.d/solutionmines-\(proxy\|upstream\)" "$ML" && grep -q "$ML/snippets/solutionmines-proxy.conf" "$ML/sites-available/solutionmines" && grep -q "$ML/solutionmines/upstream.conf" "$ML/conf.d/solutionmines-zones.conf"'

# integration NEW-6: a caller that has already written something says so in
# every refusal instead of "Nothing has been changed".
CH="Only the checkout in /opt/solutionmines-src was written; nothing else on the box changed."
for pfs in shared rc1 noports; do
  bash -c '. "$1"; sm_gate "$2" "$3" "$4" x "$5"' _ "$DEPLOY/guard.sh" "$PF/$pfs.sh" "$G/none.env" "$EX" "$CH" > "$G/ch.out" 2>&1
  check "gate refusal ($pfs) with a 'changed so far' sentence says it (integration NEW-6)" grep -qF "$CH" "$G/ch.out"
  check "gate refusal ($pfs) with a 'changed so far' sentence never claims nothing changed (integration NEW-6)" eval '! grep -q "Nothing has been changed" "$G/ch.out"'
done

# ----------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------
H="$T/helpers"; mkdir -p "$H"
check "no site file: install the HTTP site" sm_site_needs_http_config "$H/none"
check "the HTTP-only site may be reinstalled" sm_site_needs_http_config "$DEPLOY/nginx/solutionmines-http.conf"
sed 's/__DOMAIN__/example.test/g' "$DEPLOY/nginx/solutionmines-tls.conf" > "$H/tls"
check "a TLS site is never replaced by the HTTP one" eval '! sm_site_needs_http_config "$H/tls"'
printf 'server {\n  # ssl_certificate /x;\n}\n' > "$H/commented"
check "a commented-out ssl_certificate does not count" sm_site_needs_http_config "$H/commented"

echo "server 127.0.0.1:3002;" > "$H/legacy"
check "upstream carried over from the legacy conf.d file" [ "$(sm_initial_upstream "$H/legacy" "$H/none")" = "server 127.0.0.1:3002;" ]
printf 'IMAGE=x\nACTIVE_COLOUR=green\n' > "$H/image.env"
check "upstream follows image.env when there is no legacy file" [ "$(sm_initial_upstream "$H/none" "$H/image.env")" = "server 127.0.0.1:3002;" ]
check "upstream defaults to blue" [ "$(sm_initial_upstream "$H/none" "$H/none")" = "server 127.0.0.1:3001;" ]
echo "garbage" > "$H/legacy2"
check "a garbage legacy file is ignored" [ "$(sm_initial_upstream "$H/legacy2" "$H/image.env")" = "server 127.0.0.1:3002;" ]

mkdir -p "$H/repo/deploy" "$H/repo/.git" "$H/plain/deploy"
echo "ref: refs/heads/claude/some-branch" > "$H/repo/.git/HEAD"
check "default branch is the checkout's branch" [ "$(sm_default_branch "$H/repo/deploy")" = claude/some-branch ]
echo "0123456789abcdef0123456789abcdef01234567" > "$H/repo/.git/HEAD"
check "detached checkout: default branch main" [ "$(sm_default_branch "$H/repo/deploy")" = main ]
echo "ref: refs/heads/-oops" > "$H/repo/.git/HEAD"
check "a branch name starting with '-' is not used" [ "$(sm_default_branch "$H/repo/deploy")" = main ]
check "not a checkout: default branch main" [ "$(sm_default_branch "$H/plain/deploy")" = main ]

# sm_dedicated_firewall never enables anything
FW="$T/fw"; mkdir -p "$FW/active" "$FW/inactive" "$FW/nomgr"
for st in active inactive; do
  printf '#!/bin/sh\necho "ufw $*" >> "%s/calls"\n[ "$1" = status ] && echo "Status: %s"\nexit 0\n' "$FW" "$st" > "$FW/$st/ufw"
  chmod +x "$FW/$st/ufw"
done
# no other firewall manager on these boxes (see FWN-R2-2 below): stubs, so
# the real systemctl and dpkg-query of the machine running the tests are
# never asked
for d in inactive nomgr; do
  printf '#!/bin/sh\nexit 3\n' > "$FW/$d/systemctl"; printf '#!/bin/sh\nexit 1\n' > "$FW/$d/dpkg-query"
  chmod +x "$FW/$d/systemctl" "$FW/$d/dpkg-query"
done
: > "$FW/calls"
out="$(PATH="$FW/active:/usr/bin:/bin" sm_dedicated_firewall "22 2222")"
check "active ufw: 'Nginx Full' allowed" grep -qx "ufw allow Nginx Full" "$FW/calls"
check "active ufw: never enabled, no SSH rule touched" eval '! grep -q "enable\|allow 22" "$FW/calls"'
: > "$FW/calls"
out="$(PATH="$FW/inactive:/usr/bin:/bin" sm_dedicated_firewall "22 2222")"
check "inactive ufw: only 'status' was called" [ "$(cat "$FW/calls")" = "ufw status" ]
check "inactive ufw: manual commands allow each SSH port first" contains "$out" "sudo ufw allow 2222/tcp"
check "inactive ufw: manual commands end with enable" contains "$out" "sudo ufw enable"
out="$(PATH="$FW/nomgr:/bin:/usr/bin" bash -c '. "$1"; command -v ufw >/dev/null && exit 9; sm_dedicated_firewall ""' _ "$DEPLOY/guard.sh")"; r=$?
if [ "$r" -eq 9 ]; then ok; else
  check "no ufw: prints how to find the SSH port" contains "$out" "<ssh-port>"
fi

# an active ufw whose `allow` fails (no 'Nginx Full' profile): a warning, and
# bootstrap carries on to its nginx -t and reload instead of dying under set -e
mkdir -p "$FW/broken"
printf '#!/bin/sh\n[ "$1" = status ] && { echo "Status: active"; exit 0; }\necho "ERROR: Could not find a profile matching Nginx Full" >&2; exit 1\n' > "$FW/broken/ufw"
chmod +x "$FW/broken/ufw"
out="$(PATH="$FW/broken:/usr/bin:/bin" bash -c 'set -euo pipefail; . "$1"; sm_dedicated_firewall 22; echo carried-on' _ "$DEPLOY/guard.sh" 2>&1)"
check "active ufw, 'allow' fails: bootstrap is not aborted" contains "$out" "carried-on"
check "active ufw, 'allow' fails: a warning says so" contains "$out" "WARNING"

# firewall-ssh FWN-1: ufw's status line is translated (Ubuntu language packs);
# this stub answers in French unless LC_ALL=C and LANGUAGE is empty, as
# Python's gettext does (it reads LANGUAGE first).
mkdir -p "$FW/fr"
cat > "$FW/fr/ufw" <<SH
#!/bin/sh
echo "ufw \$*" >> "$FW/calls"
if [ "\$1" = status ]; then
  if [ "\${LC_ALL:-}" = C ] && [ -z "\${LANGUAGE:-}" ]; then echo "Status: active"; else echo "État : actif"; fi
  echo; echo "To                         Action      From"; echo "22/tcp                     ALLOW       Anywhere"
fi
exit 0
SH
chmod +x "$FW/fr/ufw"
for loc in "LANG=fr_FR.UTF-8" "LANGUAGE=fr:en LANG=en_GB.UTF-8" "LANGUAGE=fr LC_ALL=C" "LC_MESSAGES=fr_FR.UTF-8 LANGUAGE=fr"; do
  : > "$FW/calls"
  # shellcheck disable=SC2086  # $loc is a list of assignments, split on purpose
  out="$(env $loc PATH="$FW/fr:/usr/bin:/bin" bash -c 'set -euo pipefail; . "$1"; sm_dedicated_firewall 22' _ "$DEPLOY/guard.sh" 2>&1)"
  check "active ufw under $loc is recognised: 'Nginx Full' allowed (firewall-ssh FWN-1)" grep -qx "ufw allow Nginx Full" "$FW/calls"
  check "active ufw under $loc: no 'no active ufw' claim (firewall-ssh FWN-1)" eval '! contains "$out" "no active ufw"'
done
# firewall-ssh FWN-2: a long rule set; `ufw status | grep -q` under pipefail
# made ufw die of SIGPIPE once grep stopped reading, which read as inactive.
mkdir -p "$FW/long"
cat > "$FW/long/ufw" <<SH
#!/bin/bash
echo "ufw \$*" >> "$FW/calls"
if [ "\$1" = status ]; then
  echo "Status: active"; echo
  for i in \$(seq 1 20000); do echo "Anywhere                   REJECT      203.0.\$((i / 250 % 250)).\$((i % 250 + 1))"; done
fi
exit 0
SH
chmod +x "$FW/long/ufw"
: > "$FW/calls"
out="$(PATH="$FW/long:/usr/bin:/bin" bash -c 'set -euo pipefail; . "$1"; sm_dedicated_firewall 22' _ "$DEPLOY/guard.sh" 2>&1)"
check "active ufw with 20000 rules is recognised under pipefail (firewall-ssh FWN-2)" grep -qx "ufw allow Nginx Full" "$FW/calls"
# firewall-ssh FWN-3: the hint always shows how to confirm the SSH port
out="$(PATH="$FW/inactive:/usr/bin:/bin" sm_dedicated_firewall "22")"
check "manual firewall hint: always shows how to confirm the SSH port (firewall-ssh FWN-3)" contains "$out" "sudo ss -ltnp | grep -E 'sshd|systemd'"
check "manual firewall hint: no longer claims sshd listens there (firewall-ssh FWN-3)" eval '! contains "$out" "sshd listens here"'

# sm_tls_site_installed (nginx-states NEW-4)
check "TLS site for example.test is recognised (nginx-states NEW-4)" sm_tls_site_installed "$H/tls" example.test
check "TLS site for another domain is not (nginx-states NEW-4)" eval '! sm_tls_site_installed "$H/tls" other.test'
check "the dot in the domain is literal (nginx-states NEW-4)" eval '! sm_tls_site_installed "$H/tls" exampleXtest'
check "the HTTP-only site is not a TLS site (nginx-states NEW-4)" eval '! sm_tls_site_installed "$DEPLOY/nginx/solutionmines-http.conf" example.test'
check "no site file is not a TLS site (nginx-states NEW-4)" eval '! sm_tls_site_installed "$H/none" example.test'

# sm_dns_points_here (integration NEW-5): getent answers from per-name files,
# the way glibc does (ahostsv6 also returns IPv4-mapped addresses).
DN="$T/dns"; mkdir -p "$DN/bin" "$DN/db"
cat > "$DN/bin/getent" <<SH
#!/bin/bash
f="$DN/db/\$2"; [ -f "\$f" ] || exit 2
case "\$1" in
  ahostsv4) grep -v : "\$f" | while read -r a; do echo "\$a      STREAM \$2"; done ;;
  ahostsv6) grep : "\$f" | while read -r a; do echo "\$a      STREAM \$2"; done
            grep -v : "\$f" | while read -r a; do echo "::ffff:\$a STREAM \$2"; done ;;
  hosts) { grep : "\$f"; grep -v : "\$f"; } | head -1 | sed "s/\$/ \$2/" ;;
  *) exit 1 ;;
esac
SH
chmod +x "$DN/bin/getent"
dns() { # <expect 0|1> <description> <name> <ip4> <ip6s> [records...]
  local want="$1" d="$2" name="$3" ip4="$4" ip6="$5" rc=0; shift 5
  printf '%s\n' "$@" | grep . > "$DN/db/$name" || : > "$DN/db/$name"
  DNS_OUT="$(PATH="$DN/bin:$PATH" sm_dns_points_here "$name" "$ip4" "$ip6" 2>&1)" || rc=$?
  [ "$rc" = "$want" ] && ok || bad "dns ($d): rc $rc, expected $want: $DNS_OUT"
}
dns 0 "A and AAAA both point here (integration NEW-5)" dual.example 203.0.113.9 "2001:db8::9" 203.0.113.9 2001:db8::9
dns 0 "A only, pointing here" a.example 203.0.113.9 "2001:db8::9" 203.0.113.9
dns 0 "A only, box without IPv6" a2.example 203.0.113.9 "" 203.0.113.9
dns 1 "a parking AAAA elsewhere (integration NEW-5)" park.example 203.0.113.9 "2001:db8::9" 203.0.113.9 2001:db8:dead::1
check "a parking AAAA is named in the message" contains "$DNS_OUT" "AAAA record 2001:db8:dead::1"
dns 1 "an AAAA on a box without IPv6" v6.example 203.0.113.9 "" 203.0.113.9 2001:db8::9
check "no IPv6 here: the message says so" contains "$DNS_OUT" "this server has no global IPv6 address"
dns 1 "A record elsewhere" else.example 203.0.113.9 "" 198.51.100.7
dns 1 "two A records, one elsewhere" two.example 203.0.113.9 "" 203.0.113.9 198.51.100.7
dns 1 "nothing resolves" none.example 203.0.113.9 ""
check "nothing resolves: the message says so" contains "$DNS_OUT" "does not resolve yet"
dns 0 "this box's IPv4 unknown: A not compared" unk.example "" "" 198.51.100.7

# sm_check_deploy_user: someone else's `deploy` account is never modified
DU="$T/du"; mkdir -p "$DU/fresh" "$DU/ours"; touch "$DU/ours/deploy.sh"
check "deploy user absent: new" [ "$(sm_check_deploy_user sm-no-such-user-zz9 "$DU/fresh" 2>/dev/null)" = new ]
check "deploy user exists, box never bootstrapped: refused" eval '! sm_check_deploy_user root "$DU/fresh" 2>/dev/null >/dev/null'
out="$(sm_check_deploy_user root "$DU/fresh" 2>&1)"
check "deploy user refusal says nothing changed and names the override" eval 'contains "$out" "Nothing has been changed" && contains "$out" "SM_DEPLOY_USER_OK=1"'
check "deploy user exists, earlier bootstrap of ours: ours" [ "$(sm_check_deploy_user root "$DU/ours")" = ours ]
check "deploy user exists, SM_DEPLOY_USER_OK=1: adopted" [ "$(SM_DEPLOY_USER_OK=1 sm_check_deploy_user root "$DU/fresh")" = adopted ]
check "deploy user exists, SM_DEPLOY_USER_OK=yes does not count" eval '! SM_DEPLOY_USER_OK=yes sm_check_deploy_user root "$DU/fresh" 2>/dev/null >/dev/null'

# guard.sh itself: sourcing runs nothing and defines only functions
out="$(env -i PATH=/usr/bin:/bin bash -c 'before="$(compgen -v | sort)"; . "$1"; after="$(compgen -v | sort)"; comm -13 <(echo "$before") <(echo "$after") | grep -vE "^(before|PIPESTATUS|_|BASH_.*)$"' _ "$DEPLOY/guard.sh")"
check "sourcing guard.sh sets no variables (got: $out)" [ -z "$out" ]
out="$(cd "$T" && bash -c '. "$1" 2>&1' _ "$DEPLOY/guard.sh")"
check "sourcing guard.sh prints nothing" [ -z "$out" ]

# ----------------------------------------------------------------------------
# deploy.sh: switch, smoke test and rollback, against stubs
# ----------------------------------------------------------------------------
D="$T/deploy"; BIN="$D/bin"
mkdir -p "$BIN"
cat > "$BIN/docker" <<'SH'
#!/bin/bash
echo "docker $*" >> "$STUB_DIR/docker.log"
case "$*" in
  "image inspect"*) exit 0 ;;
  "image ls"*) exit 0 ;;
  *" pause "*) touch "$STUB_DIR/paused.${*: -1}" ;;
  *" unpause "*) rm -f "$STUB_DIR/paused.${*: -1}" ;;
esac
exit 0
SH
cat > "$BIN/curl" <<'SH'
#!/bin/bash
url="${*: -1}"
echo "curl $url" >> "$STUB_DIR/curl.log"
c=""
case "$url" in
  http://127.0.0.1:3001/api/health) c=blue ;;
  http://127.0.0.1:3002/api/health) c=green ;;
  *) # through the edge: answers for whichever colour the upstream points at,
     # unless a fixed answer is set
     if [ -f "$STUB_DIR/smoke.fixed" ]; then f="$STUB_DIR/smoke.fixed"
     elif [ -f "$STUB_DIR/live" ]; then c="$(cat "$STUB_DIR/live")"
     else exit 22; fi ;;
esac
if [ -n "$c" ]; then
  [ -e "$STUB_DIR/paused.$c" ] && exit 28   # a paused container: the request times out
  f="$STUB_DIR/health.$c"
fi
[ -f "$f" ] || exit 7
cat "$f"
SH
cat > "$BIN/edge-test" <<'SH'
#!/bin/bash
echo "test $(cat "$UPSTREAM_FILE_STUB" 2>/dev/null | head -1)" >> "$STUB_DIR/edge.log"
[ -f "$STUB_DIR/edge.broken" ] && exit 1
grep -q BAD "$UPSTREAM_FILE_STUB" 2>/dev/null && exit 1
[ -f "$STUB_DIR/edge.rejects" ] && grep -qf "$STUB_DIR/edge.rejects" "$UPSTREAM_FILE_STUB" 2>/dev/null && exit 1
exit 0
SH
cat > "$BIN/edge-reload" <<'SH'
#!/bin/bash
echo "reload" >> "$STUB_DIR/edge.log"
[ -f "$STUB_DIR/reload.fails" ] && exit 1
# what the edge serves after a reload: the colour named in the upstream file
if [ -f "$UPSTREAM_FILE_STUB" ]; then
  grep -o 'blue\|green' "$UPSTREAM_FILE_STUB" | head -1 > "$STUB_DIR/live"
else
  rm -f "$STUB_DIR/live"
fi
SH
chmod +x "$BIN"/*

# fresh <scenario>: a clean fake /opt/solutionmines with a valid shared-edge config
fresh() {
  S="$D/$1"; rm -rf "$S"; mkdir -p "$S/app" "$S/edge/upstreams"
  export STUB_DIR="$S" UPSTREAM_FILE_STUB="$S/edge/upstreams/solutionmines.caddy"
  : > "$S/docker.log"; : > "$S/edge.log"; : > "$S/curl.log"
  echo "services: {}" > "$S/app/docker-compose.yml"
  cat > "$S/app/edge.env" <<EOF
UPSTREAM_FILE=$S/edge/upstreams/solutionmines.caddy
UPSTREAM_LINE='reverse_proxy solutionmines-__COLOUR__:3000'
EDGE_TEST_CMD='$BIN/edge-test'
EDGE_RELOAD_CMD='$BIN/edge-reload'
SMOKE_URL=http://sm.localhost/api/health
EOF
  chmod 600 "$S/app/edge.env"
  echo '{"status":"ok","commit":"new111","mail":"log"}' > "$S/health.blue"
  echo '{"status":"ok","commit":"new111","mail":"log"}' > "$S/health.green"
}
# run_deploy <extra shell setup>: deploy.sh's main in a bash process of its
# own, as CI runs it. A new process, not a subshell: callers use run_deploy
# under `!` or `if`, which would silently switch `set -e` off in a subshell,
# and the failure paths under test depend on it.
run_deploy() {
  PATH="$BIN:$PATH" S="$S" DEPLOY="$DEPLOY" IMAGE_REF="$IMAGE_REF" HOOK="${1:-}" bash -c '
    # shellcheck source=deploy/deploy.sh
    . "$DEPLOY/deploy.sh"
    APP_DIR="$S/app" HEALTH_TIMEOUT=3 SMOKE_TIMEOUT=0 DRAIN_SECONDS=0 POLL_SECONDS=0
    eval "$HOOK"
    set -euo pipefail
    deploy_main "$IMAGE_REF" new111
  ' >"$S/out" 2>&1
}
IMAGE_REF=ghcr.io/solution-mines/solutionmines:new111

check "sourcing deploy.sh runs nothing" eval '[ -z "$(bash -c ". \"$DEPLOY/deploy.sh\"; echo -n" 2>&1)" ]'

# D1: first deploy through a shared edge, success
fresh d1
check "D1 first deploy succeeds" run_deploy
check "D1 upstream points at blue" [ "$(cat "$S/edge/upstreams/solutionmines.caddy")" = "reverse_proxy solutionmines-blue:3000" ]
check "D1 image.env records blue" grep -qx ACTIVE_COLOUR=blue "$S/app/image.env"
check "D1 blue started, nothing torn down" eval 'grep -q "up -d --force-recreate blue" "$S/docker.log" && ! grep -q "stop\|rm -f" "$S/docker.log"'
check "D1 the edge was tested before anything changed" [ "$(head -1 "$S/edge.log")" = "test " ]
check "D1 no backup files left behind" eval '[ -z "$(ls -A "$S/app" | grep "^\." | grep -vx "\.deploy\.lock")" ]'
check "D1 nothing written next to the upstream file" [ "$(ls "$S/edge/upstreams")" = solutionmines.caddy ]

# D2: first deploy, smoke test sees another commit -> edge left as found
fresh d2
echo '{"status":"ok","commit":"someone-else"}' > "$S/smoke.fixed"
check "D2 failed first deploy exits non-zero" eval '! run_deploy'
check "D2 upstream file removed (there was none before)" [ ! -e "$S/edge/upstreams/solutionmines.caddy" ]
check "D2 edge tested and reloaded after the removal" [ "$(tail -2 "$S/edge.log" | tr '\n' ' ')" = "test  reload " ]
check "D2 new colour torn down" grep -q "stop blue" "$S/docker.log"
check "D2 no image.env left claiming blue is live" [ ! -e "$S/app/image.env" ]
check "D2 smoke test fetched SMOKE_URL" grep -q "curl http://sm.localhost/api/health" "$S/curl.log"

# D3: second deploy, smoke fails -> previous upstream back byte for byte
fresh d3
printf 'reverse_proxy solutionmines-blue:3000' > "$S/edge/upstreams/solutionmines.caddy"   # no trailing newline
cp "$S/edge/upstreams/solutionmines.caddy" "$S/prev"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; cp "$S/app/image.env" "$S/prev.state"
echo blue > "$S/live"
# the edge keeps answering with the old build: the switch did not take
echo '{"status":"ok","commit":"old000"}' > "$S/smoke.fixed"
check "D3 failed smoke test exits non-zero" eval '! run_deploy'
check "D3 upstream restored byte for byte" cmp -s "$S/prev" "$S/edge/upstreams/solutionmines.caddy"
check "D3 image.env restored" cmp -s "$S/prev.state" "$S/app/image.env"
check "D3 green torn down, blue left alone" eval 'grep -q "stop green" "$S/docker.log" && ! grep -q "stop blue" "$S/docker.log"'
check "D3 edge reloaded back to blue" [ "$(cat "$S/live")" = blue ]
check "D3 edge reloaded twice (switch, rollback)" [ "$(grep -c reload "$S/edge.log")" = 2 ]

# D4: the edge's config test rejects the new upstream -> restored, re-tested, never reloaded
fresh d4
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"; cp "$S/edge/upstreams/solutionmines.caddy" "$S/prev"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"
echo green > "$S/edge.rejects"
check "D4 rejected upstream exits non-zero" eval '! run_deploy'
check "D4 upstream restored byte for byte" cmp -s "$S/prev" "$S/edge/upstreams/solutionmines.caddy"
check "D4 edge re-tested after the restore" [ "$(tail -1 "$S/edge.log")" = "test reverse_proxy solutionmines-blue:3000" ]
check "D4 edge never reloaded" eval '! grep -q reload "$S/edge.log"'
check "D4 says the edge is valid again" grep -q "edge config is valid again" "$S/out"
check "D4 green torn down" grep -q "stop green" "$S/docker.log"

# D5: same, first deploy -> file removed, never reloaded
fresh d5
sed -i "s/^UPSTREAM_LINE=.*/UPSTREAM_LINE='BAD __COLOUR__'/" "$S/app/edge.env"
check "D5 rejected first upstream exits non-zero" eval '! run_deploy'
check "D5 upstream file removed" [ ! -e "$S/edge/upstreams/solutionmines.caddy" ]
check "D5 edge never reloaded" eval '! grep -q reload "$S/edge.log"'

# D6: edge config already broken -> refuse before starting anything
fresh d6
touch "$S/edge.broken"
check "D6 broken edge refuses" eval '! run_deploy'
check "D6 no container started" eval '! grep -q "up -d" "$S/docker.log"'
check "D6 upstream untouched" [ ! -e "$S/edge/upstreams/solutionmines.caddy" ]
check "D6 says it already fails" grep -q "already fails its own test" "$S/out"

# D7: incomplete edge.env -> refuse, never fall back to nginx defaults
for k in UPSTREAM_FILE UPSTREAM_LINE EDGE_TEST_CMD EDGE_RELOAD_CMD SMOKE_URL; do
  fresh "d7-$k"
  sed -i "/^$k=/d" "$S/app/edge.env"
  check "D7 edge.env without $k refuses" eval '! run_deploy'
  check "D7 ($k) docker never called" [ ! -s "$S/docker.log" ]
  check "D7 ($k) edge never touched" [ ! -s "$S/edge.log" ]
  check "D7 ($k) names the missing key" grep -q "$k is not set" "$S/out"
done
fresh d7-empty; : > "$S/app/edge.env"
check "D7 empty edge.env refuses" eval '! run_deploy'
check "D7 empty edge.env: docker never called" [ ! -s "$S/docker.log" ]

# D8: new colour never healthy -> torn down, edge untouched
fresh d8
echo '{"status":"ok","commit":"stale"}' > "$S/health.blue"
check "D8 unhealthy deploy exits non-zero" eval '! run_deploy'
check "D8 edge only pre-tested" [ "$(cat "$S/edge.log")" = "test " ]
check "D8 blue torn down" grep -q "stop blue" "$S/docker.log"

# D9: reload fails -> previous upstream restored, new colour torn down
fresh d9
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"; cp "$S/edge/upstreams/solutionmines.caddy" "$S/prev"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"
touch "$S/reload.fails"
check "D9 failed reload exits non-zero" eval '! run_deploy'
check "D9 upstream restored" cmp -s "$S/prev" "$S/edge/upstreams/solutionmines.caddy"
check "D9 green left running (the rollback reload failed too)" eval '! grep -q "stop green" "$S/docker.log"'

# D10: second deploy, success -> old colour retired, state updated
fresh d10
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo blue > "$S/live"
check "D10 second deploy succeeds" run_deploy
check "D10 upstream points at green" [ "$(cat "$S/edge/upstreams/solutionmines.caddy")" = "reverse_proxy solutionmines-green:3000" ]
check "D10 blue retired" grep -q "stop blue" "$S/docker.log"
check "D10 image.env records green" grep -qx ACTIVE_COLOUR=green "$S/app/image.env"

# D11: smoke test retries while the reload settles
fresh d11
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"
echo '{"commit":"old000"}' > "$S/smoke.fixed"
( sleep 1; rm -f "$S/smoke.fixed" ) &
check "D11 smoke test waits for the new commit" run_deploy "SMOKE_TIMEOUT=5"
wait

# D13: an unexpected failure after the upstream was rewritten (here: image.env
# cannot be written) -> the edge is put back and reloaded, the new colour torn
# down. Before the fix the upstream file was left pointing at the torn-down
# colour, live at the next reload by anyone.
fresh d13
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"; cp "$S/edge/upstreams/solutionmines.caddy" "$S/prev"
echo blue > "$S/live"
mkdir "$S/app/image.env"
check "D13 failure after the switch exits non-zero" eval '! run_deploy'
check "D13 upstream restored byte for byte" cmp -s "$S/prev" "$S/edge/upstreams/solutionmines.caddy"
check "D13 edge reloaded back to blue" [ "$(cat "$S/live")" = blue ]
check "D13 green torn down" grep -q "stop green" "$S/docker.log"
check "D13 says the edge was put back" grep -q "putting the edge back" "$S/out"

# D14: the deploy is killed (SIGTERM, as when CI is cancelled) during the
# smoke test -> the edge is rolled back and the new colour torn down. With only
# an EXIT trap bash reports $? = 0 after a signal, and nothing was cleaned up.
fresh d14
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"; cp "$S/edge/upstreams/solutionmines.caddy" "$S/prev"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; cp "$S/app/image.env" "$S/prev.state"
echo blue > "$S/live"
echo '{"commit":"old000"}' > "$S/smoke.fixed"
run_deploy 'echo "$BASHPID" > "$S/pid"; SMOKE_TIMEOUT=30' &
bg=$!
for _ in $(seq 1 100); do grep -q reload "$S/edge.log" 2>/dev/null && break; sleep 0.1; done
sleep 0.3
kill -TERM "$(cat "$S/pid")" 2>/dev/null
rc=0; wait "$bg" || rc=$?
check "D14 killed deploy exits non-zero (rc $rc)" [ "$rc" -ne 0 ]
check "D14 upstream restored byte for byte" cmp -s "$S/prev" "$S/edge/upstreams/solutionmines.caddy"
check "D14 image.env restored" cmp -s "$S/prev.state" "$S/app/image.env"
check "D14 edge reloaded back to blue" [ "$(cat "$S/live")" = blue ]
check "D14 green torn down" grep -q "stop green" "$S/docker.log"

# D15 (integration NEW-2): one deploy at a time. While another deploy holds
# the lock, a second one refuses before touching docker or the edge.
fresh d15
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"; cp "$S/edge/upstreams/solutionmines.caddy" "$S/prev"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo blue > "$S/live"
exec 8>>"$S/app/.deploy.lock"; flock 8
check "D15 a deploy while another holds the lock fails (integration NEW-2)" eval '! run_deploy'
exec 8>&-
check "D15 it says another deploy is running" grep -q "another deploy is running" "$S/out"
check "D15 docker never called" [ ! -s "$S/docker.log" ]
check "D15 edge never touched" [ ! -s "$S/edge.log" ]
check "D15 upstream untouched" cmp -s "$S/prev" "$S/edge/upstreams/solutionmines.caddy"
check "D15 the next deploy, once the lock is free, succeeds" run_deploy

# D16 (integration NEW-2, the reported race): A is slow to reach its switch,
# B starts meanwhile. B must refuse; A completes; the edge ends on a colour
# that runs.
fresh d16
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo blue > "$S/live"
echo '{"status":"ok","commit":"old000"}' > "$S/health.blue"
run_deploy 'eval "orig_$(declare -f switch_edge)"; switch_edge() { sleep 2; orig_switch_edge "$@"; }' &
bga=$!
for _ in $(seq 1 50); do grep -q "up -d" "$S/docker.log" 2>/dev/null && break; sleep 0.1; done
cp "$S/out" "$S/outA.partial" 2>/dev/null
rcb=0; PATH="$BIN:$PATH" S="$S" DEPLOY="$DEPLOY" IMAGE_REF="$IMAGE_REF" bash -c '
  . "$DEPLOY/deploy.sh"; APP_DIR="$S/app" HEALTH_TIMEOUT=3 SMOKE_TIMEOUT=0 DRAIN_SECONDS=0 POLL_SECONDS=0
  set -euo pipefail; deploy_main "$IMAGE_REF" new222' > "$S/outB" 2>&1 || rcb=$?
rca=0; wait "$bga" || rca=$?
brefused=no; [ "$rcb" -ne 0 ] && grep -q "another deploy is running" "$S/outB" && brefused=yes
check "D16 the overlapping deploy B is refused (rc $rcb) (integration NEW-2)" [ "$brefused" = yes ]
check "D16 deploy A completes (rc $rca)" [ "$rca" = 0 ]
check "D16 the edge points at green, which A started" [ "$(cat "$S/edge/upstreams/solutionmines.caddy")" = "reverse_proxy solutionmines-green:3000" ]
check "D16 image.env agrees with the edge" grep -qx ACTIVE_COLOUR=green "$S/app/image.env"
check "D16 green was never torn down" eval '! grep -q "stop green\|rm -f green" "$S/docker.log"'

# D17 (integration NEW-3): a redeploy of the commit that is already live, and
# a reload that does not take effect. Both colours report the same commit, so
# the old colour is paused during the smoke test; the edge still sends
# traffic to it, the smoke test fails, and the deploy rolls back.
fresh d17
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"; cp "$S/edge/upstreams/solutionmines.caddy" "$S/prev"
printf 'IMAGE=img:new111\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo blue > "$S/live"
sed -i "s#^EDGE_RELOAD_CMD=.*#EDGE_RELOAD_CMD='true'#" "$S/app/edge.env"
check "D17 same-commit redeploy with a no-op reload fails (integration NEW-3)" eval '! run_deploy'
check "D17 blue was paused for the smoke test, then resumed" eval 'grep -q "pause blue" "$S/docker.log" && grep -q "unpause blue" "$S/docker.log" && [ ! -e "$S/paused.blue" ]'
check "D17 upstream restored to blue" cmp -s "$S/prev" "$S/edge/upstreams/solutionmines.caddy"
check "D17 green torn down, blue never stopped" eval 'grep -q "stop green" "$S/docker.log" && ! grep -q "stop blue" "$S/docker.log"'

# D18: the same redeploy with a reload that works succeeds, and blue is
# resumed before it is drained and retired.
fresh d18
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"
printf 'IMAGE=img:new111\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo blue > "$S/live"
check "D18 same-commit redeploy with a working reload succeeds (integration NEW-3)" run_deploy
check "D18 pause, unpause, then stop, in that order" eval '[ "$(grep -o "unpause blue\|pause blue\|stop blue" "$S/docker.log" | tr "\n" " ")" = "pause blue unpause blue stop blue " ]'
# D19: a different commit needs no pause
fresh d19
printf 'reverse_proxy solutionmines-blue:3000\n' > "$S/edge/upstreams/solutionmines.caddy"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo blue > "$S/live"
echo '{"status":"ok","commit":"old000"}' > "$S/health.blue"
check "D19 a new commit deploys without pausing anything" eval 'run_deploy && ! grep -q pause "$S/docker.log"'

# D20 (integration NEW-4): the upstream file keeps its owner and mode, on a
# successful deploy and on a rollback.
fresh d20
U20="$S/edge/upstreams/solutionmines.caddy"
printf 'reverse_proxy solutionmines-blue:3000\n' > "$U20"; chmod 640 "$U20"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo blue > "$S/live"
echo '{"status":"ok","commit":"old000"}' > "$S/health.blue"
if [ "$(id -u)" = 0 ]; then chown 1000:1000 "$U20"; fi
before="$(stat -c '%a %u:%g' "$U20")"
check "D20 deploy succeeds" run_deploy
check "D20 owner and mode kept after a switch ($before -> $(stat -c '%a %u:%g' "$U20")) (integration NEW-4)" [ "$(stat -c '%a %u:%g' "$U20")" = "$before" ]
fresh d20b
U20="$S/edge/upstreams/solutionmines.caddy"
printf 'reverse_proxy solutionmines-blue:3000\n' > "$U20"; chmod 640 "$U20"; cp "$U20" "$S/prev"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo blue > "$S/live"
echo '{"status":"ok","commit":"old000"}' > "$S/smoke.fixed"
if [ "$(id -u)" = 0 ]; then chown 1000:1000 "$U20"; fi
before="$(stat -c '%a %u:%g' "$U20")"
check "D20b smoke test fails" eval '! run_deploy'
check "D20b rollback restores bytes, owner and mode ($before -> $(stat -c '%a %u:%g' "$U20")) (integration NEW-4)" eval 'cmp -s "$S/prev" "$U20" && [ "$(stat -c "%a %u:%g" "$U20")" = "$before" ]'
check "D20b the rollback names the colour it restored" grep -q "rolled the edge back to the previous upstream (blue)" "$S/out"
fresh d20c
check "D20c a new upstream file is created 0644" eval 'run_deploy && [ "$(stat -c %a "$S/edge/upstreams/solutionmines.caddy")" = 644 ]'

# enable-tls.sh's site-install block (nginx-states NEW-4), run on its own
# against a fake site file, with nginx and systemctl stubbed. The whole
# script is never run.
TL="$T/tls"; mkdir -p "$TL/bin" "$TL/app/nginx"
cp "$DEPLOY/nginx/solutionmines-tls.conf" "$TL/app/nginx/"
printf '#!/bin/sh\necho "nginx $*" >> "%s/calls"\nexit 0\n' "$TL" > "$TL/bin/nginx"
printf '#!/bin/sh\necho "systemctl $*" >> "%s/calls"\nexit 0\n' "$TL" > "$TL/bin/systemctl"
chmod +x "$TL/bin/"*
tls_block="$(sed -n '/^BACKUP_KEPT=""$/,/^fi$/p' "$DEPLOY/enable-tls.sh")"
check "enable-tls: the site-install block can be found" [ -n "$tls_block" ]
run_tls() { # <site file>
  # shellcheck disable=SC2034  # APP_DIR, SITE and DOMAIN are read by the eval'd block
  ( set -euo pipefail; PATH="$TL/bin:$PATH"; APP_DIR="$TL/app"; SITE="$1"; DOMAIN=example.com
    log() { :; }; eval "$tls_block"; echo "kept=$BACKUP_KEPT" ) > "$TL/out" 2>&1
}
# a re-run after the operator enabled HSTS and enforced the CSP: kept as is
sed -e 's/__DOMAIN__/example.com/g' -e 's/# add_header Strict-Transport-Security/add_header Strict-Transport-Security/' \
    -e 's/Content-Security-Policy-Report-Only/Content-Security-Policy/' "$DEPLOY/nginx/solutionmines-tls.conf" > "$TL/site"
echo '# a hand edit' >> "$TL/site"; cp "$TL/site" "$TL/site.before"
check "enable-tls re-run: the block succeeds" run_tls "$TL/site"
check "enable-tls re-run: the live TLS site is unchanged, HSTS and CSP included (nginx-states NEW-4)" cmp -s "$TL/site.before" "$TL/site"
check "enable-tls re-run: nginx tested and reloaded" eval 'grep -q "nginx -t" "$TL/calls" && grep -q "systemctl reload nginx" "$TL/calls"'
# the first run, from the HTTP-only site: rendered, and the HTTP site kept as a backup
: > "$TL/calls"; cp "$DEPLOY/nginx/solutionmines-http.conf" "$TL/site2"
check "enable-tls first run: the block succeeds" run_tls "$TL/site2"
check "enable-tls first run: the TLS site is installed" sm_tls_site_installed "$TL/site2" example.com
kept="$(sed -n 's/^kept=//p' "$TL/out")"; kept_ok=no
[ -n "$kept" ] && cmp -s "$kept" "$DEPLOY/nginx/solutionmines-http.conf" && kept_ok=yes
check "enable-tls first run: the replaced HTTP site is kept as a backup ($kept) (nginx-states NEW-4)" [ "$kept_ok" = yes ]
check "enable-tls first run: no temp files left" eval '[ -z "$(ls -A "$TL/app" | grep "^\.")" ]'

# D12: dedicated defaults, and no environment hooks
(
  . "$DEPLOY/deploy.sh"
  # shellcheck disable=SC2034  # read by load_edge_config
  APP_DIR="$T/no-such-app"
  export UPSTREAM_FILE=/tmp/evil SMOKE_URL=http://evil EDGE_RELOAD_CMD=evil
  load_edge_config
  [ "$EDGE_MODE" = no ] && [ "$UPSTREAM_FILE" = /etc/nginx/solutionmines/upstream.conf ] \
    && [ "$SMOKE_URL" = http://127.0.0.1/api/health ] && [ "$EDGE_RELOAD_CMD" = "nginx -s reload" ]
) && ok || bad "D12 dedicated mode uses the new nginx paths and ignores the environment"
check "D12 deploy.sh reads no deploy settings from the environment" \
  eval '! grep -Eq "\\\$\{(UPSTREAM_FILE|UPSTREAM_LINE|EDGE_TEST_CMD|EDGE_RELOAD_CMD|SMOKE_URL|APP_DIR|HEALTH_TIMEOUT|SMOKE_TIMEOUT|DRAIN_SECONDS):-" "$DEPLOY/deploy.sh"'

# ----------------------------------------------------------------------------
# Static wiring of the scripts this suite must never execute
# ----------------------------------------------------------------------------
B="$DEPLOY/bootstrap.sh"; U="$DEPLOY/bring-up.sh"; L="$DEPLOY/enable-tls.sh"
mut='^[[:space:]]*(apt-get|install |rm |ln |useradd|usermod|gpasswd|systemctl|docker network create|ufw|cat > /etc|fallocate|mkswap|swapon|git (clone|-C)|certbot|mv )'
gb="$(first_line "$B" '^sm_gate ')"; mb="$(first_line "$B" "$mut")"
check "bootstrap: the gate runs before the first change ($gb < $mb)" ordered "$gb" "$mb"
gu="$(first_line "$U" '^  sm_gate ')"; mu="$(first_line "$U" "$mut")"
check "bring-up: the gate runs before the first change ($gu < $mu)" ordered "$gu" "$mu"
g2="$(grep -n 'sm_gate "\$SRC_DIR/deploy/preflight.sh"' "$U" | head -1 | cut -d: -f1)"; bs="$(first_line "$U" 'bash "\$SRC_DIR/deploy/bootstrap.sh"')"
check "bring-up: the fetched tree's gate runs before its bootstrap ($g2 < $bs)" ordered "$g2" "$bs"
check "bring-up: sources the fetched guard.sh" grep -q '\. "\$SRC_DIR/deploy/guard.sh"' "$U"
check "bring-up: the default branch is not hard-coded main" eval '! grep -q "BRANCH=\"\${1:-main}\"" "$U"'
pl="$(first_line "$L" 'sm_run_preflight')"; cb="$(first_line "$L" '^certbot ')"
check "enable-tls: preflight before certbot ($pl < $cb)" ordered "$pl" "$cb"
mvl="$(first_line "$L" '^[[:space:]]*mv -f "\$NEW" "\$SITE"')"
nt="$(awk -v m="$mvl" 'NR > m && /if ! nginx -t/ { print NR; exit }' "$L")"
rl="$(awk -v m="${nt:-0}" 'NR > m && /^[[:space:]]*(if ! )?systemctl reload nginx/ { print NR; exit }' "$L")"
check "enable-tls: backup, mv, nginx -t, then reload ($mvl < $nt < $rl)" ordered "$mvl" "$nt" "$rl"
check "enable-tls: a replaced site file is kept as a backup, not deleted (nginx-states NEW-4)" grep -q 'BACKUP_KEPT="\$(mktemp "\$APP_DIR/site-backup\.' "$L"
check "enable-tls: the EXIT trap removes only the rendered temp file (integration NEW-6)" grep -qx '  cleanup() { rm -f "\$NEW"; }' "$L"
check "enable-tls: DNS checked per family for both names (integration NEW-5)" \
  eval 'grep -q "sm_dns_points_here \"\$DOMAIN\"" "$L" && grep -q "sm_dns_points_here \"www.\$DOMAIN\"" "$L" && ! grep -q "getent hosts" "$L"'
dn="$(first_line "$L" 'sm_dns_points_here "www')"
check "enable-tls: DNS checked before certbot ($dn < $cb)" ordered "$dn" "$cb"
check "enable-tls: never redirects sed straight into the live site" eval '! grep -q "> /etc/nginx/sites-available" "$L"'
for f in "$B" "$U" "$L" "$DEPLOY/deploy.sh"; do
  check "$(basename "$f"): no UFW_SAFE" eval '! grep -q UFW_SAFE "$f"'
  check "$(basename "$f"): never enables a firewall" eval '! grep -Eq "^[^#]*ufw (--force )?enable" "$f"'
  check "$(basename "$f"): never touches iptables/nft" eval '! grep -Eq "^[[:space:]]*(sudo +)?(iptables|ip6tables|iptables-restore|nft)([[:space:]]|$)" "$f"'
  check "$(basename "$f"): uses the transferred repository URL" eval '! grep -q azariahjerish "$f"'
done
# enclosing <file> <fixed string>: the if/elif/else lines that enclose the
# first line containing the string, innermost first (a static view of which
# conditions that command runs under).
enclosing() {
  awk -v pat="$2" '
    { L[NR] = $0 }
    index($0, pat) && !t { t = NR }
    END {
      if (!t) exit 1
      d = 0
      for (i = t - 1; i >= 1; i--) {
        x = L[i]
        if (x ~ /^[[:space:]]*fi([[:space:];]|$)/) { d++; continue }
        if (x ~ /^[[:space:]]*if[[:space:]]/ && x !~ /;[[:space:]]*fi([[:space:];]|$)/) {
          if (d > 0) { d--; continue }
          print x; continue
        }
        if (d == 0 && x ~ /^[[:space:]]*(elif[[:space:]]|else([[:space:]]|$))/) print x
      }
    }' "$1"
}
# dedicated_only <file> <fixed string>: that command runs only when EDGE_MODE is no
dedicated_only() {
  local e; e="$(enclosing "$1" "$2")" || return 1
  printf '%s\n' "$e" | awk '
    /"\$EDGE_MODE" = no/ { ok = 1 }
    /^[[:space:]]*else/ { pending = 1; next }
    pending && /^[[:space:]]*if[[:space:]].*"\$EDGE_MODE" = yes/ { ok = 1 }
    { pending = 0 }
    END { exit !ok }'
}
for c in 'apt-get install -y -qq ca-certificates curl gnupg nginx certbot' \
         'docker-ce docker-ce-cli' 'systemctl enable --now docker' \
         'solutionmines-zones.conf" /etc/nginx/conf.d/' 'rm -f "$LEGACY_PROXY"' \
         'ln -sfn "$SITE" /etc/nginx/sites-enabled/solutionmines' \
         'rm -f /etc/nginx/sites-enabled/default' \
         'sm_dedicated_firewall "$SM_SSH_PORTS"' '  nginx -t' 'systemctl reload nginx'; do
  check "bootstrap: '$c' runs in dedicated mode only (INT-11, FW)" dedicated_only "$B" "$c"
done
check "enable-tls: the template is rendered only when the TLS site is not installed yet (nginx-states NEW-4)" \
  eval 'enclosing "$L" "mv -f \"\$NEW\" \"\$SITE\"" | grep -q "^if sm_tls_site_installed \"\$SITE\" \"\$DOMAIN\""'
check "survey: docker is only asked when dockerd is already running (foreign-proxies N4)" \
  eval 'enclosing "$DEPLOY/survey.sh" "docker ps --format" | grep -q "^elif \[ -z \"\$dockerd_pid\" \]"'
check "bootstrap: /var/www/certbot is skipped in edge mode (INT-11)" \
  grep -q '^\[ "\$EDGE_MODE" = yes \] || install -d -m 0755 /var/www/certbot' "$B"
check "bring-up: no swap in edge mode without SM_ALLOW_SWAP=1 (INT-11)" \
  eval 'enclosing "$U" "fallocate -l 2G" | grep -q "EDGE_MODE\" = yes \] && \[ \"\${SM_ALLOW_SWAP:-}\" != 1"'
sw="$(first_line "$U" 'fallocate -l 2G')"; dk="$(first_line "$U" 'shared-edge mode needs Docker')"
check "bring-up: edge mode checks for Docker before swap or clone (INT-11) ($dk < $sw)" ordered "$dk" "$sw"
check "bring-up: swap only after the fetched tree's gate (integration NEW-6) ($g2 < $sw)" ordered "$g2" "$sw"
check "bring-up: the second gate says the checkout was written (integration NEW-6)" grep -q 'Only the checkout in \$SRC_DIR was written; nothing else on the box changed.' "$U"
check "bring-up: no refusal text claims swap may have been added" eval '! grep -q "and swap, if it was added" "$U"'
# integration NEW-1: SITE_URL / REPO_URL / SITE_ENV from the environment reach
# main() (a bare `local NAME` inside main hides an exported value). The exact
# lines of bring-up.sh, run in a function the way main runs them.
top="$(grep -E '^SM_(SITE_URL|SITE_ENV|REPO_URL)_IN=' "$U")"
decl="$(grep -E '^  local [A-Z_ ]*SITE_URL' "$U")"; assign="$(grep -E '^  SITE_URL=' "$U")"; assign_env="$(grep -E '^  SITE_ENV_VALUE=' "$U")"
decl2="$(grep -E '^  local [A-Z_ ]*REPO_URL' "$U")"; assign2="$(grep -E '^  REPO_URL=' "$U")"
# shellcheck disable=SC2034  # PUBLIC_IP is read by the eval'd bring-up line
r="$(export SITE_URL=https://solutionmines.example SITE_ENV=production REPO_URL=https://example.invalid/fork.git
     eval "$top"; f() { eval "$decl"; PUBLIC_IP=203.0.113.9; eval "$assign"; eval "$assign_env"; echo "$SITE_URL $SITE_ENV_VALUE"; }
     g() { eval "$decl2"; eval "$assign2"; echo "$REPO_URL"; }; echo "$(f) $(g)")"
check "bring-up: exported SITE_URL, SITE_ENV and REPO_URL are used (integration NEW-1; got '$r')" \
  [ "$r" = "https://solutionmines.example production https://example.invalid/fork.git" ]
# shellcheck disable=SC2034  # PUBLIC_IP is read by the eval'd bring-up line
r="$(unset SITE_URL SITE_ENV REPO_URL; eval "$top"; f() { eval "$decl"; PUBLIC_IP=203.0.113.9; eval "$assign"; eval "$assign_env"; echo "$SITE_URL $SITE_ENV_VALUE"; }; f)"
check "bring-up: defaults without them (got '$r')" [ "$r" = "http://203.0.113.9 staging" ]
tl="$(first_line "$U" '^SM_SITE_URL_IN=')"; ml="$(first_line "$U" '^main\(\) \{')"
check "bring-up: the settings are read before main() ($tl < $ml)" ordered "$tl" "$ml"
check "bring-up: step 3 re-runs with SITE_URL and SITE_ENV=production (integration NEW-1)" \
  grep -q 'sudo SITE_URL=https://<domain> SITE_ENV=production bash \$SRC_DIR/deploy/bring-up.sh \$BRANCH' "$U"
# firewall-ssh FWN-5: the closing text says what is true, not what bootstrap may have printed
check "bring-up: no unconditional 'firewall was not switched on' (firewall-ssh FWN-5)" eval '! grep -q "firewall was not switched" "$U"'
check "bring-up: the closing text reads ufw's state (firewall-ssh FWN-5)" grep -q 'if sm_ufw_active; then' "$U"
check "bring-up: a failing health check through nginx fails the run" grep -q '^  if ! curl -fsS --max-time 8 "http://127.0.0.1/api/health"; then' "$U"
check "bootstrap: never installs ufw" eval '! grep -Eq "apt-get install[^#]*\bufw\b" "$B"'
dc="$(first_line "$B" '^DEPLOY_USER_STATE="\$\(sm_check_deploy_user ')"; ap="$(first_line "$B" '^[[:space:]]*apt-get ')"
check "bootstrap: the deploy-user check runs before the first apt-get ($dc < $ap)" ordered "$dc" "$ap"
check "bootstrap: only an account of ours leaves the docker group" grep -q '^if \[ "\$DEPLOY_USER_STATE" = ours \] && id -nG' "$B"
du="$(first_line "$U" 'sm_check_deploy_user deploy')"
check "bring-up: the deploy-user check runs before the first change ($du < $mu)" ordered "$du" "$mu"
check "bootstrap: deploy user not added to the docker group" eval '! grep -q "usermod -aG docker" "$B"'
check "bootstrap: sudoers grants deploy.sh only" grep -qx '\$DEPLOY_USER ALL=(root) NOPASSWD: \$APP_DIR/deploy.sh' "$B"
check "bootstrap: installs preflight.sh and guard.sh" eval 'grep -q "deploy/preflight.sh\" *\"\$APP_DIR/preflight.sh\"" "$B" && grep -q "deploy/guard.sh\" *\"\$APP_DIR/guard.sh\"" "$B"'
# bootstrap and bring-up's refresh path install the same files to the same names
inst() { grep -oE 'install -m 07?[0-9]{3} +"\$(REPO_DIR|SRC_DIR)"?/deploy/[^ ]+ +"\$APP_DIR/[^"]*"' "$1" | sed -E 's#.*/deploy/([^ "]+)"? +"\$APP_DIR/([^"]*)"#\1 -> \2#' | sort; }
check "bootstrap and bring-up install the same files under the same names" [ "$(inst "$B")" = "$(inst "$U")" ]
check "the installed set includes preflight.sh, guard.sh and edge.env.example" \
  eval '[ "$(inst "$B" | grep -cE "^(preflight.sh -> preflight.sh|guard.sh -> guard.sh|edge.env.example -> edge.env.example)$")" = 3 ]'
check "bootstrap: TLS site kept on re-run" grep -q 'sm_site_needs_http_config "\$SITE"' "$B"
check "nginx: nothing of ours but the zones file is installed into conf.d" \
  eval '[ "$(grep -o "/etc/nginx/conf.d/solutionmines-[a-z]*.conf" "$B" | sort -u | tr "\n" " ")" = "/etc/nginx/conf.d/solutionmines-proxy.conf /etc/nginx/conf.d/solutionmines-upstream.conf /etc/nginx/conf.d/solutionmines-zones.conf " ] && grep -q "rm -f \"\$LEGACY_PROXY\" \"\$LEGACY_UPSTREAM\"" "$B"'
check "nginx: templates include the new snippet and upstream paths only" \
  eval '! grep -q "conf.d/solutionmines-proxy\|conf.d/solutionmines-upstream" "$DEPLOY"/nginx/*.conf'
check "nginx: the TLS template avoids 'http2 on' (nginx < 1.25.1)" eval '! grep -q "^[^#]*http2 on" "$DEPLOY/nginx/solutionmines-tls.conf"'
check "CI only ever runs sudo deploy.sh on the server" \
  eval '[ "$(grep -o "sudo /opt/solutionmines/[a-z-]*\.sh" "$DEPLOY/../.github/workflows/deploy.yml" | sort -u)" = "sudo /opt/solutionmines/deploy.sh" ]'

# ============================================================================
# round 2 (r2) regressions
# ============================================================================
R2="$T/r2"; mkdir -p "$R2"
# r2edge <expect ok|fail> <description> <substring or ''> <UPSTREAM_FILE> [UPSTREAM_LINE] [SMOKE_URL]
r2edge() {
  local f="$R2/edge.$RANDOM.env" out rc=0
  printf 'UPSTREAM_FILE=%s\nUPSTREAM_LINE=%q\nEDGE_TEST_CMD=true\nEDGE_RELOAD_CMD=true\nSMOKE_URL=%s\n' \
    "$4" "${5:-reverse_proxy solutionmines-__COLOUR__:3000}" "${6:-http://sm.localhost/api/health}" > "$f"
  chmod 600 "$f"
  out="$(sm_check_edge_env "$f" 2>&1)" || rc=$?
  if [ "$1" = ok ] && [ "$rc" -ne 0 ]; then bad "edge.env ($2) refused: $out"; return; fi
  if [ "$1" = fail ] && [ "$rc" -eq 0 ]; then bad "edge.env ($2) accepted, expected refused"; return; fi
  if [ -n "$3" ] && ! contains "$out" "$3"; then bad "edge.env ($2): output lacks '$3': $out"; return; fi
  ok
}

# integration NEW-2: an existing UPSTREAM_FILE must be one deploy.sh wrote
mkdir -p "$R2/etc/nginx/othersite" "$R2/opt/edge" "$R2/up-blue" "$R2/up-green" "$R2/up-nonl" "$R2/up-readme"
echo 'server 192.0.2.7:8080;   # othersite backend' > "$R2/etc/nginx/othersite/upstream.conf"
printf 'import sites/*.caddy\n:80 {\n\trespond 404\n}\n' > "$R2/opt/edge/Caddyfile"
r2edge fail "another site's upstream include, alone in its directory (integration NEW-2)" "holds something deploy.sh did not write" \
  "$R2/etc/nginx/othersite/upstream.conf" 'server 127.0.0.1:__PORT__;'
r2edge fail "the proxy's main Caddyfile, no extension (integration NEW-2)" "holds something deploy.sh did not write" "$R2/opt/edge/Caddyfile"
echo 'reverse_proxy solutionmines-blue:3000' > "$R2/up-blue/sm.caddy"
r2edge ok "an existing file holding the line for blue (integration NEW-2 control)" "" "$R2/up-blue/sm.caddy"
echo 'server 127.0.0.1:3002;' > "$R2/up-green/upstream.conf"
r2edge ok "an existing file holding the line for green (integration NEW-2 control)" "" "$R2/up-green/upstream.conf" 'server 127.0.0.1:__PORT__;'
printf 'reverse_proxy solutionmines-green:3000' > "$R2/up-nonl/sm.caddy"
r2edge ok "the line for green without a trailing newline (integration NEW-2 control)" "" "$R2/up-nonl/sm.caddy"
printf 'reverse_proxy solutionmines-blue:3000\nreverse_proxy solutionmines-blue:3000\n' > "$R2/up-blue/twice.caddy"
r2edge fail "the line twice (integration NEW-2)" "holds something deploy.sh did not write" "$R2/up-blue/twice.caddy"
echo 'reverse_proxy solutionmines-blue:3000' > "$R2/up-readme/sm.caddy"; echo notes > "$R2/up-readme/README"
r2edge fail "a directory that also holds another file (integration NEW-2)" "also holds README" "$R2/up-readme/sm.caddy"
mkdir -p "$R2/up-tmp"; echo 'reverse_proxy solutionmines-blue:3000' > "$R2/up-tmp/sm.caddy"; : > "$R2/up-tmp/.sm.caddy.Ab12Cd.sm-tmp"
r2edge ok "deploy.sh's own leftover temp file does not count (integration NEW-2 control)" "" "$R2/up-tmp/sm.caddy"

# integration NEW-1: UPSTREAM_FILE's directory and its parents
mkdir -p "$R2/gw/up" "$R2/pw/mid/up"; chmod 775 "$R2/gw/up"; chmod 777 "$R2/pw/mid"
r2edge fail "UPSTREAM_FILE's directory is group-writable (integration NEW-1)" "is writable by group or others; deploy.sh writes there as root" "$R2/gw/up/sm.caddy"
r2edge fail "a parent of UPSTREAM_FILE's directory is world-writable, not sticky (integration NEW-1)" "so they can swap the directories below it" "$R2/pw/mid/up/sm.caddy"
mkdir -p "$R2/st/mid/up"; chmod 1777 "$R2/st/mid"
r2edge ok "a sticky world-writable parent, like /tmp (integration NEW-1 control)" "" "$R2/st/mid/up/sm.caddy"
chmod 755 "$R2/gw/up" "$R2/pw/mid"
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$R2/own/up" "$R2/own2/mid/up"; chown 65534 "$R2/own/up" "$R2/own2/mid"
  r2edge fail "UPSTREAM_FILE's directory owned by another uid (integration NEW-1)" "is owned by uid 65534, not root" "$R2/own/up/sm.caddy"
  r2edge fail "a parent directory owned by another uid (integration NEW-1)" "$R2/own2/mid is owned by uid 65534" "$R2/own2/mid/up/sm.caddy"
  mkdir -p "$R2/lnk/real/up"; chown 65534 "$R2/lnk"; ln -s real "$R2/lnk/l"
  r2edge fail "a symlinked component in a directory another uid owns (integration NEW-1)" "$R2/lnk is owned by uid 65534" "$R2/lnk/l/up/sm.caddy"
fi

# integration NEW-5: SMOKE_URL on the container's own port
for u in http://sm.localhost:3001/api/health http://sm.localhost:3002/api/health https://www.example.com:3002/ http://sm.localhost:03001/x; do
  r2edge fail "SMOKE_URL $u (integration NEW-5)" "that is this site's own container" "$R2/up-green/upstream.conf" 'server 127.0.0.1:__PORT__;' "$u"
done
r2edge ok "SMOKE_URL on port 8443 (integration NEW-5 control)" "" "$R2/up-green/upstream.conf" 'server 127.0.0.1:__PORT__;' http://sm.localhost:8443/api/health

# integration NEW-1: deploy.sh never writes through a name planted next to UPSTREAM_FILE
fresh r2-plant
echo 'reverse_proxy solutionmines-blue:3000' > "$S/edge/upstreams/solutionmines.caddy"
echo 'root-only secret' > "$S/victim"; chmod 600 "$S/victim"
ln -s "$S/victim" "$S/edge/upstreams/solutionmines.caddy.sm-tmp"
check "NEW-1 deploy with a planted <name>.sm-tmp symlink succeeds" run_deploy
check "NEW-1 the symlink target is untouched (integration NEW-1)" eval '[ "$(cat "$S/victim")" = "root-only secret" ] && [ "$(stat -c %a "$S/victim")" = 600 ]'
check "NEW-1 the upstream file was written" [ "$(cat "$S/edge/upstreams/solutionmines.caddy")" = "reverse_proxy solutionmines-green:3000" ]
left=""; for f in "$S/edge/upstreams"/* "$S/edge/upstreams"/.[!.]*; do
  case "${f##*/}" in solutionmines.caddy|solutionmines.caddy.sm-tmp|'*'|'.[!.]*') ;; *) left="$left ${f##*/}" ;; esac
done
check "NEW-1 no temp file left next to it ($left)" [ -z "$left" ]

# integration NEW-3: a restore that fails is never reported as a rollback
mkdir -p "$R2/cpbin"
printf '#!/bin/sh\ncase "$1$2" in *.upstream.prev.*) echo "cp: error writing: No space left on device" >&2; exit 1 ;; esac\nexec %s "$@"\n' "$(command -v cp)" > "$R2/cpbin/cp"
chmod +x "$R2/cpbin/cp"
fresh r2-restore-smoke
echo 'reverse_proxy solutionmines-blue:3000' > "$S/edge/upstreams/solutionmines.caddy"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo blue > "$S/live"
echo '{"status":"ok","commit":"old000"}' > "$S/smoke.fixed"
check "NEW-3 smoke fails and the restore fails: exits non-zero" eval '! run_deploy "PATH=\"$R2/cpbin:\$PATH\""'
check "NEW-3 no claim that the edge was rolled back (integration NEW-3)" eval '! grep -q "rolled the edge back" "$S/out"'
check "NEW-3 says the file could not be put back, and how" eval 'grep -q "could not put .* back" "$S/out" && grep -q "cp -p .*upstream.prev" "$S/out"'
check "NEW-3 the colour the edge points at is not torn down (integration NEW-3)" eval '! grep -q "stop green" "$S/docker.log"'
check "NEW-3 the edge was not reloaded again (integration NEW-3)" [ "$(grep -c reload "$S/edge.log")" = 1 ]
check "NEW-3 the backup is kept (integration NEW-3)" eval 'b=$(ls "$S/app"/.upstream.prev.* 2>/dev/null | head -1); [ -n "$b" ] && [ "$(cat "$b")" = "reverse_proxy solutionmines-blue:3000" ]'
fresh r2-restore-test
echo 'reverse_proxy solutionmines-blue:3000' > "$S/edge/upstreams/solutionmines.caddy"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo green > "$S/edge.rejects"
check "NEW-3 edge test rejects, restore fails: exits non-zero" eval '! run_deploy "PATH=\"$R2/cpbin:\$PATH\""'
check "NEW-3 no claim that it was not this upstream (integration NEW-3)" eval '! grep -q "It was not this upstream\|upstream restored" "$S/out"'
check "NEW-3 says this deploy's line is still in the file (integration NEW-3)" grep -q "still holds this deploy's line" "$S/out"
check "NEW-3 never reloaded" eval '! grep -q reload "$S/edge.log"'
check "NEW-3 the backup is kept" eval '[ -n "$(ls "$S/app"/.upstream.prev.* 2>/dev/null)" ]'

# integration NEW-7: after the edge was switched, a rollback drains before teardown
fresh r2-drain
echo 'reverse_proxy solutionmines-blue:3000' > "$S/edge/upstreams/solutionmines.caddy"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo blue > "$S/live"
echo '{"status":"ok","commit":"old000"}' > "$S/smoke.fixed"
check "NEW-7 smoke test fails" eval '! run_deploy DRAIN_SECONDS=1'
dl="$(first_line "$S/out" 'draining green for 1s before it is torn down')"; tl="$(first_line "$S/out" 'tearing down green')"
check "NEW-7 the new colour is drained before it is torn down (integration NEW-7) ($dl < $tl)" ordered "$dl" "$tl"
fresh r2-nodrain; echo 'reverse_proxy solutionmines-blue:3000' > "$S/edge/upstreams/solutionmines.caddy"
printf 'IMAGE=old\nACTIVE_COLOUR=blue\n' > "$S/app/image.env"; echo green > "$S/edge.rejects"
check "NEW-7 a failure before the switch tears down at once" eval '! run_deploy DRAIN_SECONDS=1 && ! grep -q draining "$S/out" && grep -q "stop green" "$S/docker.log"'

# integration NEW-9: the deploy lock is not inherited by what the edge's commands leave behind
fresh r2-lock
sed -i "s#^EDGE_RELOAD_CMD=.*#EDGE_RELOAD_CMD='$BIN/edge-reload; (sleep 30 >/dev/null 2>\&1 \& echo \\\$! > $S/lingering)'#" "$S/app/edge.env"
check "NEW-9 first deploy succeeds" run_deploy
check "NEW-9 a child of the reload command is still running" eval 'kill -0 "$(cat "$S/lingering")" 2>/dev/null'
rm -f "$S/live"
check "NEW-9 the next deploy is not locked out by it (integration NEW-9)" run_deploy
kill "$(cat "$S/lingering" 2>/dev/null)" 2>/dev/null

# integration NEW-6: enable-tls keeps the replaced site file whatever fails after
printf '#!/bin/sh\necho "systemctl $*" >> "%s/calls"\necho "Job for nginx.service failed" >&2; exit 1\n' "$TL" > "$TL/bin2-systemctl"
mkdir -p "$TL/bin2"; mv "$TL/bin2-systemctl" "$TL/bin2/systemctl"; chmod +x "$TL/bin2/systemctl"; cp "$TL/bin/nginx" "$TL/bin2/nginx"
cp "$DEPLOY/nginx/solutionmines-http.conf" "$TL/site3"; echo '# operator hand edit' >> "$TL/site3"; cp "$TL/site3" "$TL/site3.orig"
rm -f "$TL/app"/site-backup.*
# shellcheck disable=SC2034  # APP_DIR, SITE and DOMAIN are read by the eval'd block
( set -euo pipefail; PATH="$TL/bin2:$PATH"; APP_DIR="$TL/app"; SITE="$TL/site3"; DOMAIN=example.com
  log() { :; }; eval "$tls_block" ) > "$TL/out3" 2>&1; rc=$?
kept=no; for f in "$TL/app"/site-backup.*; do [ -f "$f" ] && cmp -s "$f" "$TL/site3.orig" && kept=yes; done
check "NEW-6 enable-tls: a failed reload exits non-zero" [ "$rc" != 0 ]
check "NEW-6 enable-tls: a failed reload keeps the replaced site file (integration NEW-6)" [ "$kept" = yes ]
check "NEW-6 enable-tls: and says where" grep -q "kept as $TL/app/site-backup\." "$TL/out3"

# integration NEW-8: refusals do not claim what preflight did not establish
stub cannot 3 'SHARED=yes\nAPP_PORTS_FREE=no\nSSH_PORTS=22\n'
gate 1 "cannot verify: ports unknown" cannot "$G/none.env"
check "NEW-8 the ports refusal allows for 'could not check' (integration NEW-8)" contains "$(cat "$G/last.out")" "or preflight could not check them"
gate 3 "cannot verify: shared" shared "$G/none.env"
check "NEW-8 the shared refusal allows for 'could not rule out' (integration NEW-8)" contains "$(cat "$G/last.out")" "or preflight could not rule that out"
check "NEW-8 the shared refusal says to fix a 'cannot verify' instead of forcing" contains "$(cat "$G/last.out")" 'If it says "cannot verify"'
check "NEW-8 enable-tls's refusal allows for 'could not rule out'" grep -q 'or preflight could not rule that out' "$L"

# integration NEW-11: create UPSTREAM_FILE before adding the block that imports it
refusal_txt="$(sm_print_refusal /x/edge.env.example "bash x")"
# shellcheck disable=SC2034  # read through ${!t} below
edgedone_txt="$(sed -n '/<<EDGEDONE/,/^EDGEDONE/p' "$B")"
for t in refusal_txt edgedone_txt; do
  check "NEW-11 ($t) says to create UPSTREAM_FILE before adding the block (integration NEW-11)" \
    eval 'grep -qiE "create (the )?UPSTREAM_FILE.*first" <<<"${!t}"'
done
rl="$(printf '%s\n' "$refusal_txt" | grep -n 'Create UPSTREAM_FILE first' | cut -d: -f1)"; bl="$(printf '%s\n' "$refusal_txt" | grep -n "add this site's block" | cut -d: -f1)"
check "NEW-11 the refusal creates the file before the block ($rl < $bl)" ordered "$rl" "$bl"

# integration NEW-10: a box set up in edge mode that is now dedicated gets bootstrap
cond="$(sed -n '/^  if \[ ! -x "\$APP_DIR\/deploy.sh" \]/,/; then$/p' "$U")"
mkdir -p "$R2/app10"; touch "$R2/app10/guard.sh"; printf '#!/bin/sh\n' > "$R2/app10/deploy.sh"; chmod +x "$R2/app10/deploy.sh"
r="$(APP_DIR="$R2/app10" EDGE_MODE=no PATH=/nonexistent "$BASH" -c "$cond echo BOOTSTRAP; else echo REFRESH; fi" 2>/dev/null)"
check "NEW-10 dedicated, no nginx, scripts from an edge-mode bootstrap -> bootstrap (integration NEW-10; got $r)" [ "$r" = BOOTSTRAP ]
r="$(APP_DIR="$R2/app10" EDGE_MODE=yes PATH=/nonexistent "$BASH" -c "$cond echo BOOTSTRAP; else echo REFRESH; fi" 2>/dev/null)"
check "NEW-10 edge mode with the scripts installed -> refresh (control; got $r)" [ "$r" = REFRESH ]

# integration NEW-4: an unguarded branch is refused before it is checked out
GR="$R2/git"; mkdir -p "$GR"
if command -v git >/dev/null 2>&1; then
  (
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
    git init -q -b new "$GR/origin"; mkdir -p "$GR/origin/deploy"
    for f in guard.sh preflight.sh bring-up.sh; do echo "# guarded $f: sm_gate" > "$GR/origin/deploy/$f"; done
    git -C "$GR/origin" add -A; git -C "$GR/origin" commit -qm new
    git -C "$GR/origin" checkout -q -b new2; echo '# new2' >> "$GR/origin/deploy/guard.sh"; git -C "$GR/origin" commit -qam new2
    git -C "$GR/origin" checkout -q new
    git init -q -b old "$GR/oldsrc"; mkdir -p "$GR/oldsrc/deploy"; echo '# old bring-up: fallocate, no gate' > "$GR/oldsrc/deploy/bring-up.sh"
    git -C "$GR/oldsrc" add -A; git -C "$GR/oldsrc" commit -qm old
    git -C "$GR/origin" fetch -q "$GR/oldsrc" old:old
  ) >/dev/null 2>&1
  # bring-up's source block, from the fetch to the checkout, run the way main runs it
  # (its `rm -rf "$SRC_DIR"` is left out: every SRC_DIR here is new)
  src_blk="$(sed -n '/# --- source ----/,/^  local SHA$/p' "$U" | sed '$d' | sed 's/^    rm -rf "\$SRC_DIR"$/    : the removal is not needed here/')"
  run_src() { # <SRC_DIR> <HERE> <BRANCH>
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 SRC_DIR="$1" HERE="$2" BRANCH="$3" REPO_URL="file://$GR/origin" \
      bash -c "set -euo pipefail; log() { :; }; f() {
$src_blk
}; f" > "$GR/out" 2>&1
  }
  check "NEW-4 the source block can be found" [ -n "$src_blk" ]
  check "NEW-4 fresh clone of a guarded branch" eval 'run_src "$GR/src" /x new && [ -f "$GR/src/deploy/guard.sh" ] && [ -z "$(git -C "$GR/src" status --porcelain 2>/dev/null)" ]'
  cp "$GR/src/deploy/bring-up.sh" "$GR/bring-up.before"
  check "NEW-4 running from inside the checkout, an unguarded branch is refused" eval '! run_src "$GR/src" "$GR/src/deploy" old'
  check "NEW-4 ... before it is checked out: the running bring-up.sh is unchanged (integration NEW-4)" cmp -s "$GR/bring-up.before" "$GR/src/deploy/bring-up.sh"
  check "NEW-4 ... and the refusal says nothing was checked out" grep -q "NOT checked out" "$GR/out"
  check "NEW-4 another guarded branch is checked out (control)" eval 'run_src "$GR/src" "$GR/src/deploy" new2 && grep -q "# new2" "$GR/src/deploy/guard.sh"'
  check "NEW-4 a fresh clone of an unguarded branch is refused and left unchecked-out" eval '! run_src "$GR/src2" /x old && [ ! -e "$GR/src2/deploy/bring-up.sh" ]'
else
  ok
fi

# firewall-ssh FWN-R2-2: another firewall manager is never told to add ufw
mkdir -p "$FW/fwd" "$FW/nfp" "$FW/none2"
for d in fwd nfp none2; do
  printf '#!/bin/sh\necho "systemctl $*" >> "%s/probes"\n[ "%s" = fwd ] && [ "$*" = "is-active --quiet firewalld" ] && exit 0\nexit 3\n' "$FW" "$d" > "$FW/$d/systemctl"
  printf '#!/bin/sh\necho "dpkg-query $*" >> "%s/probes"\n[ "%s" = nfp ] && { printf "install ok installed"; exit 0; }\nexit 1\n' "$FW" "$d" > "$FW/$d/dpkg-query"
  chmod +x "$FW/$d/systemctl" "$FW/$d/dpkg-query"
done
: > "$FW/probes"
out="$(PATH="$FW/fwd:/usr/bin:/bin" bash -c '. "$1"; command -v ufw >/dev/null && exit 9; sm_dedicated_firewall 22' _ "$DEPLOY/guard.sh")"; r=$?
if [ "$r" -ne 9 ]; then
  check "FWN-R2-2 firewalld: open 80/443 in firewalld (firewall-ssh FWN-R2-2)" contains "$out" "firewall-cmd --permanent --add-service=http --add-service=https"
  check "FWN-R2-2 firewalld: never suggests ufw" eval '! contains "$out" "ufw allow" && ! contains "$out" "ufw enable"'
  out="$(PATH="$FW/nfp:/usr/bin:/bin" bash -c '. "$1"; sm_dedicated_firewall 22' _ "$DEPLOY/guard.sh")"
  check "FWN-R2-2 netfilter-persistent: iptables rules and netfilter-persistent save" eval 'contains "$out" "--dports 80,443 -j ACCEPT" && contains "$out" "netfilter-persistent save" && ! contains "$out" "ufw enable"'
  check "FWN-R2-2 only read-only probes were made" eval '! grep -vE "^(systemctl is-active --quiet (firewalld|nftables)|dpkg-query -W -f=\\\$\{Status\} netfilter-persistent)$" "$FW/probes" | grep -q .'
  out="$(PATH="$FW/none2:/usr/bin:/bin" bash -c '. "$1"; sm_dedicated_firewall 22' _ "$DEPLOY/guard.sh")"
  check "FWN-R2-2 no manager at all: the ufw steps as before (control)" contains "$out" "sudo ufw enable"
  check "FWN-R2-2 the hint mentions a provider firewall" contains "$out" "security group"
else
  ok
fi
check "FWN-R2-2 bring-up's closing text knows about other firewall managers" grep -q 'elif other="\$(sm_other_firewall)"; then' "$U"
check "FWN-R2-2 bring-up says it verified only through 127.0.0.1" grep -q 'checked the site through http://127.0.0.1 only' "$U"
check "FWN-R2-2 docs: the firewall paragraph covers other managers" grep -q 'firewalld, nftables.service or netfilter-persistent' "$DEPLOY/../docs/03-deployment.md"

echo "guard.test.sh: $pass passed, $failed failed"
[ "$failed" -eq 0 ]
