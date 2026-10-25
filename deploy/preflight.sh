#!/usr/bin/env bash
# ============================================================================
# PREFLIGHT: does this box already serve someone else's web traffic?
#
#   sudo bash deploy/preflight.sh                  human-readable report
#   sudo bash deploy/preflight.sh --emit           report on stderr, 3 lines on stdout
#   bash deploy/preflight.sh --test-root DIR ...   tests only, see below
#
#   exit 0   dedicated: nothing else serves :80 or :443 here
#   exit 3   SHARED, or it could not be verified (this check fails closed)
#   other    preflight itself broke; callers must refuse
#
# With --emit, stdout carries exactly these three lines and nothing else:
#   SHARED=yes|no
#   APP_PORTS_FREE=yes|no   TCP 3001 and 3002 are free, or held only by our own
#                           containers (solutionmines-blue on 3001,
#                           solutionmines-green on 3002)
#   SSH_PORTS=<ports>       digits separated by single spaces, maybe empty;
#                           information only
#
# READ-ONLY. It changes nothing, so it is safe to run on a production box that
# hosts other people's sites.
#
# Every probe either succeeds and is parsed completely, or it adds a
# "cannot verify" reason, and any reason makes the verdict SHARED. The probes:
#   - every TCP and UDP listener on :80 or :443, on any address, must belong to
#     the host's own packaged nginx: its master is /run/nginx.pid, runs the
#     nginx binary on PATH, lives in the host's mount namespace and has
#     exactly a command line the packaged nginx is started with;
#   - containers publishing :80/:443 (docker ps, port ranges included), and
#     every container, running or not, CONFIGURED to publish them or on the
#     host's network (docker ps -a, docker inspect), asked only when dockerd
#     is already running (docker ps would socket-activate a stopped one, and
#     every container with a restart policy with it);
#   - enabled web server units that are down right now, and container
#     orchestrators (Kubernetes, k3s, Cilium, Calico), whose eBPF dataplanes
#     publish ports with no socket and no NAT rule;
#   - NAT rules that redirect :80/:443 with no listening socket at all, read
#     in full for IPv4 AND IPv6 (iptables-save/ip6tables-save nat and mangle
#     tables, or nft), legacy x_tables included, native nftables tables (nft
#     only: it must work unless the kernel provably has no nf_tables), and
#     IPVS virtual services;
#   - nginx's configuration: the server blocks `nginx -T` prints must all be
#     in files it provably loads, byte for byte, that are ours or the
#     untouched stock default site, and that site must serve nothing but
#     nginx's welcome page from /var/www/html.
# APP_PORTS_FREE comes from the same listeners, containers and NAT rules;
# only the exact DNAT Docker writes for a running solutionmines-blue (3001)
# or solutionmines-green (3002) counts as theirs.
#
# Run it as root. Without root nothing above can be attributed, so it refuses.
#
# Contract details:
#   - No environment variable is a hook: none is read to decide anything. It
#     re-runs itself in an empty environment (dropping exported variables and
#     exported bash functions alike), and PATH is reset to
#     /usr/sbin:/usr/bin:/sbin:/bin.
#   - What it cannot do is defend itself against the shell it is started in:
#     an environment that redefines bash builtins (BASH_FUNC_exec%%,
#     BASH_ENV) takes effect before the first line of this file runs. The
#     clean start is therefore the CALLER's job, and both supported callers
#     do it: guard.sh's sm_run_preflight runs it under `env -i`, and sudo's
#     env_reset drops BASH_FUNC_* and BASH_ENV. Run it by hand as
#     `sudo bash preflight.sh`, or `sudo env -i bash -p preflight.sh`.
#   - --test-root DIR prefixes every filesystem path it reads (/etc, /proc,
#     /run, /sys, /var/lib/dpkg, ...) with DIR, skips the root check and
#     keeps the caller's PATH, so tests can stub ss, docker, nginx and the
#     rest.
# ============================================================================

# --- defensive start --------------------------------------------------------
# Start over in an empty environment. Exported variables are not the only
# thing a caller's environment carries: exported bash functions
# (BASH_FUNC_name%%) take precedence over every command on PATH, so a
# `timeout` or `ss` function would rewrite what a probe sees, and some
# variables (BASH_XTRACEFD) cannot even be unset safely. Only PATH is carried
# over (reset below unless --test-root). `bash -p` also ignores BASH_ENV,
# SHELLOPTS, BASHOPTS and imported functions, should any survive.
#
# The re-run is marked by an argument, --sm-reexec, as argv[1], never by an
# environment variable a caller could set. A marked run must find its
# environment empty (only what bash itself adds), or it refuses: a caller
# cannot use the marker to skip the clean start. Not possible when the script
# is fed on stdin; the scrub after this covers that case as well as it can.
if [[ ${1-} == --sm-reexec ]]; then
  shift
  for __v in $(compgen -e) $(compgen -A function); do
    case "$__v" in
      PATH|PWD|OLDPWD|SHLVL|_) ;;
      *) echo "preflight: --sm-reexec is internal; run preflight.sh without it" >&2; exit 2 ;;
    esac
  done
  unset __v
elif [[ -f ${BASH_SOURCE[0]-} && -x /usr/bin/env ]]; then
  exec /usr/bin/env -i "PATH=${PATH-}" "$BASH" -p -- "${BASH_SOURCE[0]}" --sm-reexec "$@"
fi

# Imported SHELLOPTS/BASHOPTS can switch globbing off or make it lie.
set +o noglob +o posix +o xtrace 2>/dev/null
shopt -u nullglob failglob dotglob nocaseglob nocasematch extglob globstar xpg_echo 2>/dev/null
unset GLOBIGNORE POSIXLY_CORRECT CDPATH 2>/dev/null
IFS=$' \t\n'
set -uo pipefail          # deliberately NOT -e: every check runs and reports
umask 077

KEEP_PATH="${PATH:-}"
# Drop every function and every exported variable: nothing from the caller
# may steer a probe. BASH_XTRACEFD is left alone: unsetting it closes the file
# descriptor it names, which may be stdout. With xtrace off it does nothing.
for __v in $(compgen -A function 2>/dev/null); do
  unset -f "$__v" 2>/dev/null
done
for __v in $(compgen -e 2>/dev/null); do
  [ "$__v" = BASH_XTRACEFD ] && continue
  unset "$__v" 2>/dev/null
done
unset __v

EMIT=no
TEST=no
R=""
usage() {
  echo "usage: preflight.sh [--emit] [--test-root DIR]" >&2
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --emit) EMIT=yes ;;
    --test-root)
      [ $# -ge 2 ] || usage
      TEST=yes; R="$2"; shift ;;
    --test-root=*) TEST=yes; R="${1#*=}" ;;
    *) usage ;;
  esac
  shift
done

if [ "$TEST" = yes ]; then
  if [ -z "$R" ] || ! [ -d "$R" ]; then echo "preflight: --test-root: not a directory" >&2; exit 2; fi
  R="$(cd "$R" && pwd -P)" || exit 2
  [ "$R" = / ] && R=""
  PATH="$KEEP_PATH"
else
  PATH=/usr/sbin:/usr/bin:/sbin:/bin
fi
export PATH LC_ALL=C DOCKER_CONTEXT=default

reasons=()     # why the box counts as shared (or cannot be verified)
app_busy=()    # why TCP 3001/3002 are not free
notes=()       # facts worth showing that change no verdict
ext=()         # listeners on non-loopback addresses (information only)
ssh_ports=()

# Executables only: `type -P` never returns a function, alias or builtin.
have() { type -P -- "$1" >/dev/null 2>&1; }
clean() { local s="${1//[^[:print:]]/?}"; printf '%s' "${s:0:300}"; }
shared() { reasons+=("$(clean "$*")"); }
cannot() { reasons+=("cannot verify: $(clean "$*")"); }

TIMEOUT="$(type -P timeout 2>/dev/null || true)"
# probe CMD ARGS...: run a read-only command; sets OUT (stdout) and RC.
probe() {
  if [ -n "$TIMEOUT" ]; then
    OUT="$("$TIMEOUT" -k 2 15 "$@" 2>/dev/null)"; RC=$?
  else
    OUT="$("$@" 2>/dev/null)"; RC=$?
  fi
}
# probe_raw CMD ARGS...: like probe, but OUT keeps every byte of stdout,
# trailing newlines included, and NUL bytes come back as \037 (a bash
# variable cannot hold NUL, and silently dropping it would join the bytes
# around it into text nginx never saw).
probe_raw() {
  if [ -n "$TIMEOUT" ]; then
    OUT="$("$TIMEOUT" -k 2 15 "$@" 2>/dev/null | tr '\000' '\037'; printf '\n%s' "${PIPESTATUS[0]}")"
  else
    OUT="$("$@" 2>/dev/null | tr '\000' '\037'; printf '\n%s' "${PIPESTATUS[0]}")"
  fi
  RC="${OUT##*$'\n'}"; OUT="${OUT%$'\n'*}"
}

# --- report and output ------------------------------------------------------
print_list() {   # print_list ARRAY-ELEMENTS... (deduplicated, order kept)
  local -A seen=()
  local x
  for x in "$@"; do
    [ -n "${seen[$x]+y}" ] && continue
    seen[$x]=1
    printf '  - %s\n' "$x"
  done
}

SSH_OUT=""
report() {
  echo "== preflight =="
  if [ "$SHARED" = yes ]; then
    echo "verdict: SHARED (exit 3). This box already serves other web traffic, or that could not be ruled out:"
    print_list "${reasons[@]}"
  else
    echo "verdict: dedicated (exit 0). Nothing else serves :80 or :443 here."
  fi
  if [ "$APP_FREE" = yes ]; then
    echo "app ports 3001/3002: free (or held only by solutionmines-blue/green)"
  else
    echo "app ports 3001/3002: NOT free:"
    print_list "${app_busy[@]}"
  fi
  echo "ssh port(s): ${SSH_OUT:-none found}"
  if [ "${#ext[@]}" -gt 0 ]; then
    echo "listening on non-loopback addresses (information only):"
    print_list "${ext[@]}"
  fi
  if [ "${#notes[@]}" -gt 0 ]; then
    echo "notes:"
    print_list "${notes[@]}"
  fi
}

finish() {
  local p IFS=$' \t\n'
  SHARED=no; APP_FREE=yes; SSH_OUT=""
  [ "${#reasons[@]}" -gt 0 ] && SHARED=yes
  [ "${#app_busy[@]}" -gt 0 ] && APP_FREE=no
  # SSH_PORTS: valid port numbers only, sorted, unique, single spaces.
  local -a sorted=()
  local i j
  for p in "${ssh_ports[@]+"${ssh_ports[@]}"}"; do
    case "$p" in ''|*[!0-9]*) continue ;; esac
    [ "${#p}" -le 5 ] || continue
    p=$((10#$p))
    [ "$p" -ge 1 ] && [ "$p" -le 65535 ] || continue
    for ((i = 0; i < ${#sorted[@]}; i++)); do
      [ "${sorted[$i]}" -ge "$p" ] && break
    done
    [ "$i" -lt "${#sorted[@]}" ] && [ "${sorted[$i]}" -eq "$p" ] && continue
    for ((j = ${#sorted[@]}; j > i; j--)); do sorted[$j]="${sorted[$((j - 1))]}"; done
    sorted[$i]="$p"
  done
  SSH_OUT="${sorted[*]}"

  if [ "$EMIT" = yes ]; then
    report >&2
    printf 'SHARED=%s\nAPP_PORTS_FREE=%s\nSSH_PORTS=%s\n' "$SHARED" "$APP_FREE" "$SSH_OUT"
  else
    report
  fi
  if [ "$SHARED" = yes ]; then exit 3; fi
  exit 0
}

if [ "$TEST" = no ] && [ "${EUID:-1}" -ne 0 ]; then
  cannot "preflight must run as root: without root the owner of a listening socket, nginx's master process and the NAT rules cannot be identified"
  app_busy+=("not checked: preflight must run as root")
  finish
fi

# --- path helpers (everything read goes through the test root) ---------------
# resolve PATH: resolve an absolute path the way the kernel does, one
# component at a time, following a symlink wherever one appears (so ".."
# after a symlinked directory goes where the kernel goes, not where the text
# suggests), inside the test root. Sets RES to the root-relative result.
# Fails (RES empty) on loops, dangling links, and any path or link target
# holding a newline or other non-printable byte: such a name cannot be
# carried through text reliably, so it is never trusted.
resolve() {
  # Split on / by word splitting with globbing off (restored on return by
  # `local -`), not with `read <<<`: a here-string can need a temp file,
  # and when that cannot be written the read is skipped without a word.
  local -
  set -f
  local IFS=/ c t n=0 i=0 out=""
  local -a q=() tq=()
  RES=""
  case "$1" in /*) ;; *) return 1 ;; esac
  case "$1" in *[![:print:]]*) return 1 ;; esac
  # shellcheck disable=SC2206  # split on IFS=/ on purpose, globbing is off
  q=(${1#/})
  while [ "$i" -lt "${#q[@]}" ]; do
    c="${q[$i]}"; i=$((i + 1))
    case "$c" in
      ''|.) continue ;;
      ..) out="${out%/*}"; continue ;;
    esac
    if [ -L "$R$out/$c" ]; then
      n=$((n + 1)); [ "$n" -le 40 ] || return 1
      t="$(readlink -- "$R$out/$c"; printf x)"
      t="${t%x}"; t="${t%$'\n'}"
      case "$t" in ''|*[![:print:]]*) return 1 ;; esac
      # shellcheck disable=SC2206  # as above
      tq=(${t#/})
      case "$t" in /*) out="" ;; esac
      q=("${tq[@]+"${tq[@]}"}" "${q[@]:$i}"); i=0
    else
      out="$out/$c"
    fi
  done
  [ -n "$out" ] || out=/
  [ -e "$R$out" ] || return 1
  RES="$out"
}

# --- nginx server-block counter ----------------------------------------------
# One tokenizer for every nginx text, modelled on ngx_conf_read_token():
# comments start with '#' only where a token may start, quotes and backslash
# escapes are honoured, ';' '{' end a token, '}' closes a block only where a
# token may start, and "${" stays inside a token. A server block is a
# directive whose only word is `server`, followed by '{', across any
# whitespace, newlines or comments and in any context (http, stream, mail).
# "server 127.0.0.1:3001;" inside an upstream is not a block.
# Output: "TOTAL n", plus "INC <arg>" for each include directive and
# "BAD <file> <why>" for text that does not tokenize cleanly.
NGX_AWK='
function reset() {
  depth = 0; nargs = 0; first = ""; second = ""; tok = ""; intok = 0
  dq = 0; sq = 0; esc = 0; sharp = 0; varf = 0; needsp = 0; count = 0
  isbad = 0; why = ""
}
function bad(m) { if (!isbad) { isbad = 1; why = m } }
function push() {
  if (!intok) return
  nargs++
  if (nargs == 1) first = tok
  else if (nargs == 2) second = tok
  tok = ""; intok = 0
}
function endsemi(   a) {
  if (first == "include") {
    if (nargs == 2) { a = second; gsub(/[\t\n\r]/, "?", a); print "INC\t" a }
    else bad("include with " (nargs - 1) " arguments")
  }
  nargs = 0; first = ""; second = ""
}
function endbrace() {
  if (nargs == 1 && first == "server") count++
  # *_by_lua_block bodies are Lua, read by the Lua module with its own lexer: a
  # quote in a Lua comment would be taken for an nginx string here and could
  # swallow real configuration. Nothing of ours uses Lua, so refuse it.
  if (first ~ /lua_block$/) bad("a Lua block (" first ") cannot be checked as nginx configuration")
  depth++; nargs = 0; first = ""; second = ""
}
# In an `nginx -T` dump every file is complete on its own (nginx refuses a
# file that ends inside a block, a directive or a string), so at each file
# header the tokenizer must be back at top level. If it is not, a quote or
# brace it misread has run on into the next file, and the count is wrong.
function boundary() {
  if (dq || sq || esc || intok || nargs || depth || needsp)
    bad("a \"# configuration file\" line inside an unfinished directive, block or string")
}
function ws(c) { return c == " " || c == "\t" || c == "\r" || c == "\n" }
function feed(c) {
  if (isbad) return
  if (sharp) { if (c == "\n") sharp = 0; return }
  if (esc) { esc = 0; tok = tok c; intok = 1; return }
  if (needsp) {
    needsp = 0
    if (ws(c) || c == ")") return
    if (c == ";") { endsemi(); return }
    if (c == "{") { endbrace(); return }
    bad("unexpected character after a quoted string"); return
  }
  if (dq || sq) {
    if (c == "\\") { esc = 1; return }
    if ((dq && c == "\"") || (sq && c == "\047")) { dq = 0; sq = 0; push(); needsp = 1; return }
    tok = tok c; return
  }
  if (!intok) {
    if (ws(c)) return
    if (c == ";") { if (nargs == 0) bad("unexpected \";\""); else endsemi(); return }
    if (c == "{") { if (nargs == 0) bad("unexpected \"{\""); else endbrace(); return }
    if (c == "}") {
      if (nargs != 0) bad("unexpected \"}\"")
      depth--; if (depth < 0) bad("unexpected \"}\"")
      return
    }
    if (c == "#") { sharp = 1; return }
    intok = 1; tok = ""
    if (c == "\\") { esc = 1; return }
    if (c == "\"") { dq = 1; return }
    if (c == "\047") { sq = 1; return }
    varf = (c == "$"); tok = c; return
  }
  if (c == "{" && varf) { tok = tok c; return }
  varf = 0
  if (c == "\\") { esc = 1; return }
  if (c == "$") { varf = 1; tok = tok c; return }
  if (ws(c)) { push(); return }
  if (c == ";") { push(); endsemi(); return }
  if (c == "{") { push(); endbrace(); return }
  tok = tok c
}
function finish(name,   n) {
  if (dq || sq) bad("unterminated quoted string")
  if (esc) bad("dangling backslash")
  if (intok || nargs) bad("unterminated directive")
  if (depth != 0) bad("unbalanced braces")
  total += count
  if (isbad) { n = name; gsub(/[^ -~]/, "?", n); print "BAD\t" n "\t" why }
}
FNR == 1 { if (started) finish(cur); reset(); cur = FILENAME; started = 1 }
{
  line = $0; n = length(line)
  if (dump && substr(line, 1, 21) == "# configuration file ") boundary()
  for (i = 1; i <= n; i++) feed(substr(line, i, 1))
  feed("\n")
}
END { if (started) finish(cur); print "TOTAL\t" (total + 0) }
'

# Every loop that decides a verdict reads its records through feed(), never
# through a here-string: bash backs a here-string of 64 KiB or more (any size
# in bash 5.0) with a temp file, and when that file cannot be written (a full
# /tmp) the whole loop is skipped, silently, as if there were no records.
# feed() is a pipe at any size, and ends with a sentinel record the loop must
# reach: a loop that never sees it was not fed in full, and says so.
SENTINEL='@@SM-END@@'
feed() { printf '%s\n%s\n' "$1" "$SENTINEL"; }

# count_blocks FILE...: sets BLOCKS, INCS (newline list) and NGX_BAD (reasons)
# DUMP_MODE=1 (count_dump) adds the file-boundary check for an nginx -T dump.
DUMP_MODE=0
count_blocks() {
  local out rc line fed=no
  BLOCKS=0; INCS=""; NGX_BAD=""
  out="$(awk -v dump="$DUMP_MODE" "$NGX_AWK" "$@" 2>/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ]; then NGX_BAD="the configuration text could not be read"; return; fi
  while IFS= read -r line; do
    case "$line" in
      "$SENTINEL") fed=yes; break ;;
      TOTAL$'\t'*) BLOCKS="${line#TOTAL$'\t'}" ;;
      INC$'\t'*) INCS="$INCS${line#INC$'\t'}"$'\n' ;;
      BAD$'\t'*) NGX_BAD="${NGX_BAD:+$NGX_BAD; }${line#BAD$'\t'}" ;;
    esac
  done < <(feed "$out")
  [ "$fed" = yes ] || NGX_BAD="the configuration could not be read in full"
  case "$BLOCKS" in ''|*[!0-9]*) NGX_BAD="${NGX_BAD:-the configuration could not be tokenized}"; BLOCKS=0 ;; esac
}
count_dump() {   # count_dump TEXT: like count_blocks, for an nginx -T dump held in memory
  BLOCKS=0; INCS=""; NGX_BAD="the configuration could not be read"
  DUMP_MODE=1
  count_blocks /dev/stdin < <(printf '%s\n' "$1")
  DUMP_MODE=0
}

# --- 1. listening sockets (TCP and UDP) ---------------------------------------
# ss -Hltnp / -Hlunp. Each record must parse completely: state, queues, local
# address with a numeric port, peer, and an optional users:((...),(...)) list.
# A process name containing a newline continues on the next line; such a
# record is joined back. Every process in users:(...) is reported.
SS_AWK='
function bad(m) { print "BAD\t" m; }
function complete(s) { return index(s, "users:(") == 0 || s ~ /\)\)$/ }
function parse(s,   head, rest, f, local, port, host, inner, name, pid, m, cnt, o) {
  if (!match(s, /^[A-Z-]+[ \t]+[0-9]+[ \t]+[0-9]+[ \t]+[^ \t]+[ \t]+[^ \t]+/)) { bad("unparseable " proto " line"); return }
  head = substr(s, 1, RLENGTH); rest = substr(s, RLENGTH + 1)
  split(head, f, /[ \t]+/)
  if (f[1] != "LISTEN" && f[1] != "UNCONN") { bad("unexpected state \"" f[1] "\" in " proto " listing"); return }
  local = f[4]
  if (!match(local, /:[0-9]+$/)) { bad("unparseable local address in " proto " listing"); return }
  port = substr(local, RSTART + 1) + 0; host = substr(local, 1, RSTART - 1)
  if (port > 65535 || host == "") { bad("unparseable local address in " proto " listing"); return }
  if (f[5] !~ /:(\*|[0-9]+)$/) { bad("unparseable peer address in " proto " listing"); return }
  sub(/^[ \t]+/, "", rest)
  cnt = 0; o = ""
  if (rest != "") {
    if (rest !~ /^users:\(/ || rest !~ /\)$/) { bad("unparseable process field in " proto " listing"); return }
    inner = substr(rest, 8, length(rest) - 8)
    if (inner == "") { bad("empty process list in " proto " listing"); return }
    while (inner != "") {
      if (substr(inner, 1, 2) != "(\"") { bad("unparseable process list in " proto " listing"); return }
      inner = substr(inner, 3)
      if (!match(inner, /",pid=[0-9]+,fd=[0-9]+\)/)) { bad("unparseable process list in " proto " listing"); return }
      name = substr(inner, 1, RSTART - 1)
      m = substr(inner, RSTART, RLENGTH); pid = m
      sub(/^",pid=/, "", pid); sub(/,.*$/, "", pid)
      inner = substr(inner, RSTART + RLENGTH)
      if (substr(inner, 1, 1) == ",") { inner = substr(inner, 2); if (inner == "") { bad("unparseable process list in " proto " listing"); return } }
      else if (inner != "") { bad("unparseable process list in " proto " listing"); return }
      gsub(/[^A-Za-z0-9._@+:-]/, "_", name); if (name == "") name = "_"
      o = o "\t" name "\t" (pid + 0); cnt++
    }
  }
  gsub(/[^]A-Za-z0-9.:%*[_-]/, "_", host)
  printf "L\t%s\t%d\t%s\t%d%s\n", proto, port, host, cnt, o
}
BEGIN { proto = "tcp" }
{
  line = $0; sub(/[ \t\r]+$/, "", line)
  if (pend != "") {
    if (line == "@@SM-UDP@@") { bad("truncated " proto " record"); pend = "" }
    else {
      pend = pend "\\n" line; joins++
      if (complete(pend)) { parse(pend); pend = "" }
      else if (joins > 8) { bad("unterminated process list in " proto " listing"); pend = "" }
      next
    }
  }
  if (line == "@@SM-UDP@@") { proto = "udp"; next }
  if (line == "") next
  if (complete(line)) parse(line); else { pend = line; joins = 0 }
}
END { if (pend != "") bad("unterminated process list in " proto " listing") }
'

# ss_list t|u: sets RAW to the listing (no header) and returns 0, or returns 1.
# The no -H form is used only when -H is rejected (non-zero exit status).
ss_list() {
  probe ss "-Hl${1}np"
  if [ "$RC" -eq 0 ]; then RAW="$OUT"; return 0; fi
  probe ss "-l${1}np"
  [ "$RC" -eq 0 ] || return 1
  case "$OUT" in
    State*|Netid*) ;;
    *) return 1 ;;
  esac
  case "$OUT" in
    *$'\n'*) RAW="${OUT#*$'\n'}" ;;
    *) RAW="" ;;
  esac
  return 0
}

LISTENERS=""
SS_OK=no
if ! have ss; then
  cannot "'ss' is not installed (package iproute2), so listening sockets cannot be listed"
else
  TCP_RAW=""; UDP_RAW=""
  if ! ss_list t; then
    cannot "'ss' failed to list TCP listening sockets"
  else
    TCP_RAW="$RAW"
    if ! ss_list u; then
      cannot "'ss' failed to list UDP sockets"
    else
      UDP_RAW="$RAW"
      LISTENERS="$(printf '%s\n@@SM-UDP@@\n%s\n' "$TCP_RAW" "$UDP_RAW" | awk "$SS_AWK")"
      if [ $? -ne 0 ]; then
        cannot "the output of 'ss' could not be parsed"
        LISTENERS=""
      else
        SS_OK=yes
        case "$LISTENERS" in
          *L$'\t'tcp$'\t'*) ;;
          *) cannot "'ss' listed no TCP listening socket at all (an SSH server at least should be listening)"
             SS_OK=no ;;
        esac
      fi
    fi
  fi
fi

# --- 2. "the host's own nginx" -------------------------------------------------
NGINX_PATH="$(command -v nginx 2>/dev/null || true)"
NGINX_BIN=""
if [ -n "$NGINX_PATH" ]; then
  case "$NGINX_PATH" in
    /*) NGINX_BIN="$(readlink -f -- "$NGINX_PATH" 2>/dev/null || true)" ;;
  esac
fi
PIDFILE_PID=""
if [ -f "$R/run/nginx.pid" ] && [ -r "$R/run/nginx.pid" ]; then
  read -r PIDFILE_PID < "$R/run/nginx.pid" 2>/dev/null || true
  case "$PIDFILE_PID" in ''|*[!0-9]*) PIDFILE_PID="" ;; esac
fi
INIT_MNT="$(readlink -- "$R/proc/1/ns/mnt" 2>/dev/null || true)"
declare -A NGX_PROVEN=()

# nginx_cmdline_ok PID: is the master's command line exactly one the packaged
# nginx is started with? Nothing is parsed: nginx reads -g with its own
# tokenizer ("daemon on;include x;", a quoted "include", a newline: all load
# more configuration that the plain `nginx -T` below never shows), and a
# title truncated by setproctitle can hide a -c. So the cmdline must equal,
# byte for byte, either the title nginx gives its master or the argv it was
# started with, for one of these:
#   nginx                                    (any of these as /usr/sbin/nginx)
#   nginx -g 'daemon on; master_process on;'  (Ubuntu/Debian nginx.service)
#   ... -c /etc/nginx/nginx.conf before or after that -g
# Anything else, including a title shorter than a complete allowed form, is
# "not proven".
NGX_GLINE='daemon on; master_process on;'
nginx_cmdline_ok() {
  local f="$R/proc/$1/cmdline" raw bin o
  local -a forms=()
  raw="$(tr '\000\037' '\037\036' < "$f" 2>/dev/null; printf x)" || raw=x
  raw="${raw%x}"
  raw="${raw%"${raw##*[!$'\037']}"}"   # drop the trailing NULs (setproctitle pads with them)
  if [ -z "$raw" ]; then WHY="/proc/$1/cmdline is empty"; return 1; fi
  for bin in /usr/sbin/nginx nginx; do
    for o in "" "-g"$'\037'"$NGX_GLINE" "-c"$'\037'"/etc/nginx/nginx.conf" \
             "-c"$'\037'"/etc/nginx/nginx.conf"$'\037'"-g"$'\037'"$NGX_GLINE" \
             "-g"$'\037'"$NGX_GLINE"$'\037'"-c"$'\037'"/etc/nginx/nginx.conf"; do
      forms+=("$bin${o:+$'\037'$o}")
    done
  done
  for o in "${forms[@]}"; do
    [ "$raw" = "$o" ] && return 0                                       # argv
    [ "$raw" = "nginx: master process ${o//$'\037'/ }" ] && return 0   # title
  done
  WHY="its command line '$(clean "${raw//$'\037'/ }")' is not one the packaged nginx is started with (another -c, -p, -g or a truncated title)"
  return 1
}

# prove_nginx PID: is PID (master or worker) the host's packaged nginx?
# Sets WHY when it is not, or when that cannot be established.
prove_nginx() {
  local pid="$1" master="" ppid="" exe mnt k v
  WHY=""
  if [ -n "${NGX_PROVEN[$pid]+y}" ]; then
    WHY="${NGX_PROVEN[$pid]}"; [ -z "$WHY" ]; return
  fi
  if [ -z "$NGINX_BIN" ]; then
    WHY="no nginx binary on PATH to compare it with"
  elif [ -z "$PIDFILE_PID" ]; then
    WHY="/run/nginx.pid is missing or unreadable"
  else
    if [ "$pid" = "$PIDFILE_PID" ]; then
      master="$pid"
    elif [ -r "$R/proc/$pid/status" ]; then
      while read -r k v _; do
        [ "$k" = PPid: ] && { ppid="$v"; break; }
      done < "$R/proc/$pid/status" 2>/dev/null
      case "$ppid" in ''|*[!0-9]*) ppid="" ;; esac
      master="$ppid"
    fi
    if [ -z "$master" ]; then
      WHY="its parent process cannot be read from /proc/$pid/status"
    elif [ "$master" != "$PIDFILE_PID" ]; then
      WHY="its master (pid $master) is not the one in /run/nginx.pid ($PIDFILE_PID)"
    else
      exe="$(readlink -- "$R/proc/$master/exe" 2>/dev/null || true)"
      mnt="$(readlink -- "$R/proc/$master/ns/mnt" 2>/dev/null || true)"
      if [ -z "$exe" ]; then
        WHY="/proc/$master/exe cannot be read"
      elif [ "$exe" != "$NGINX_BIN" ] || ! [ "$R/proc/$master/exe" -ef "$NGINX_BIN" ]; then
        WHY="its master runs $exe, not $NGINX_BIN"
      elif [ -z "$mnt" ] || [ -z "$INIT_MNT" ]; then
        WHY="its mount namespace cannot be compared with the host's"
      elif [ "$mnt" != "$INIT_MNT" ]; then
        WHY="it runs in another mount namespace (a container)"
      elif ! [ -r "$R/proc/$master/cmdline" ]; then
        WHY="/proc/$master/cmdline cannot be read"
      else
        nginx_cmdline_ok "$master"
      fi
    fi
  fi
  NGX_PROVEN[$pid]="$WHY"
  [ -z "$WHY" ]
}

is_loopback() {
  case "$1" in
    127.*|'[::1]'|'[::1]%'*|::1|'[::ffff:127.'*|*%lo|*%lo]*) return 0 ;;
    *) return 1 ;;
  esac
}

# --- 3. containers ------------------------------------------------------------
# docker ps, one line per container: the name JSON-encoded (so no name can
# break a line), a tab, then the Ports column. Every mapping must parse;
# ranges (80-81->80-81/tcp), IPv6 ([::]:443, :::443) and udp included.
DOCKER_AWK='
function bad(m) { print "BAD\t" m }
{
  line = $0
  if (line == "") next
  if (!match(line, /^"([^"\\]|\\.)*"\t/)) { bad("a line of docker ps output does not parse"); next }
  jname = substr(line, 1, RLENGTH - 1); ports = substr(line, RLENGTH + 1)
  who = "other"
  if (jname == "\"solutionmines-blue\"") who = "blue"
  else if (jname == "\"solutionmines-green\"") who = "green"
  name = substr(jname, 2, length(jname) - 2); gsub(/[^A-Za-z0-9._-]/, "_", name)
  n = split(ports, it, ",")
  for (i = 1; i <= n; i++) {
    m = it[i]; sub(/^[ \t]+/, "", m); sub(/[ \t]+$/, "", m)
    if (m == "") continue
    if (m ~ /^[0-9]+(-[0-9]+)?\/(tcp|udp|sctp)$/) continue
    if (!match(m, /:[0-9]+(-[0-9]+)?->[0-9]+(-[0-9]+)?\/(tcp|udp|sctp)$/)) { bad("container " name ": port mapping \"" m "\" does not parse"); continue }
    spec = substr(m, RSTART + 1)
    hp = spec; sub(/->.*$/, "", hp)
    pr = spec; sub(/^.*\//, "", pr)
    lo = hp; hi = hp
    if (index(hp, "-")) { lo = substr(hp, 1, index(hp, "-") - 1); hi = substr(hp, index(hp, "-") + 1) }
    lo += 0; hi += 0
    if (lo > hi || hi > 65535) { bad("container " name ": port range \"" hp "\" is invalid"); continue }
    printf "P\t%s\t%s\t%s\t%d\t%d\n", who, name, pr, lo, hi
  }
}
'

# Every container, running or not (docker inspect, one line per container,
# each field JSON-encoded so no value can break a line or a field):
#   name, state, restart policy, network mode, the port bindings it is
#   CONFIGURED with (HostConfig.PortBindings), and its networks.
# `docker ps` shows ports only while a container runs: a crash-looping proxy
# ("Restarting") has an empty Ports column, and a stopped one with a restart
# policy is not listed at all, yet dockerd starts it again at its next start
# or the next boot, and it then takes :80/:443 back. So the configuration is
# what counts here, whatever the state.
# Output: C <who> <name> <state> <restart> <netmode>; B <who> <name> <state>
# <restart> <proto> <lo> <hi>; IP <who> <address>; BAD <why>.
INSPECT_FMT='{{json .Name}}{{"\t"}}{{json .State.Status}}{{"\t"}}{{json .HostConfig.RestartPolicy.Name}}{{"\t"}}{{json .HostConfig.NetworkMode}}{{"\t"}}{{json .HostConfig.PortBindings}}{{"\t"}}{{json .NetworkSettings.Networks}}'
INSPECT_AWK='
function bad(m) { print "BAD\t" m; isbad = 1 }
function jstr(s) { return s ~ /^"([^"\\]|\\.)*"$/ }
function unq(s) { s = substr(s, 2, length(s) - 2); gsub(/[^A-Za-z0-9._:\/-]/, "_", s); return s }
# bindings JSON: null, {} or {"80/tcp":[{"HostIp":"","HostPort":"80"}],"443/tcp":null,...}
function bindings(s,   rest, k, pr, v, item, hp, lo, hi) {
  if (s == "null" || s == "{}") return
  if (substr(s, 1, 1) != "{" || substr(s, length(s), 1) != "}") { bad("container " name ": its port bindings do not parse"); return }
  rest = substr(s, 2, length(s) - 2)
  while (rest != "") {
    if (!match(rest, /^"[0-9]+(-[0-9]+)?\/(tcp|udp|sctp)":/)) { bad("container " name ": its port bindings do not parse"); return }
    k = substr(rest, 2, RLENGTH - 3); rest = substr(rest, RLENGTH + 1)
    pr = k; sub(/^.*\//, "", pr)
    if (substr(rest, 1, 4) == "null") rest = substr(rest, 5)
    else {
      if (!match(rest, /^\[[^]]*\]/)) { bad("container " name ": its port bindings do not parse"); return }
      v = substr(rest, 2, RLENGTH - 2); rest = substr(rest, RLENGTH + 1)
      while (v != "") {
        if (!match(v, /^\{[^}]*\}/)) { bad("container " name ": its port bindings do not parse"); return }
        item = substr(v, 1, RLENGTH); v = substr(v, RLENGTH + 1)
        if (substr(v, 1, 1) == ",") { v = substr(v, 2); if (v == "") { bad("container " name ": its port bindings do not parse"); return } }
        else if (v != "") { bad("container " name ": its port bindings do not parse"); return }
        if (!match(item, /"HostPort":"[0-9]*(-[0-9]+)?"/)) { bad("container " name ": a port binding has no readable host port"); return }
        hp = substr(item, RSTART + 12, RLENGTH - 13)
        if (hp == "") continue   # an ephemeral port, from 32768 up
        lo = hp; hi = hp
        if (index(hp, "-")) { lo = substr(hp, 1, index(hp, "-") - 1); hi = substr(hp, index(hp, "-") + 1) }
        lo += 0; hi += 0
        if (lo > hi || hi > 65535) { bad("container " name ": port range \"" hp "\" is invalid"); return }
        printf "B\t%s\t%s\t%s\t%s\t%s\t%d\t%d\n", who, name, st, rp, pr, lo, hi
      }
    }
    if (substr(rest, 1, 1) == ",") { rest = substr(rest, 2); if (rest == "") { bad("container " name ": its port bindings do not parse"); return } }
    else if (rest != "") { bad("container " name ": its port bindings do not parse"); return }
  }
}
{
  if ($0 == "") next
  recs++
  n = split($0, f, "\t")
  if (n != 6 || !jstr(f[1]) || f[2] !~ /^"[a-z]+"$/ || f[3] !~ /^"[a-z-]*"$/ || !jstr(f[4])) { bad("a line of docker inspect output does not parse"); next }
  who = "other"
  if (f[1] == "\"/solutionmines-blue\"") who = "blue"
  else if (f[1] == "\"/solutionmines-green\"") who = "green"
  name = unq(f[1]); sub(/^\//, "", name)
  st = unq(f[2]); rp = unq(f[3]); if (rp == "") rp = "no"
  nm = unq(f[4])
  printf "C\t%s\t%s\t%s\t%s\t%s\n", who, name, st, rp, nm
  bindings(f[5])
  if (who != "other" && st == "running") {
    s = f[6]
    while (match(s, /"IPAddress":"[0-9.]+"/)) {
      print "IP\t" who "\t" substr(s, RSTART + 13, RLENGTH - 14)
      s = substr(s, RSTART + RLENGTH)
    }
  }
}
END { if (recs != want) bad("docker inspect described " (recs + 0) " container(s), but docker ps -a listed " want) }
'

# Is dockerd already running? `docker ps` must not be the thing that starts
# it: docker.socket stays listening after `systemctl stop docker`, so the
# first client call on the socket starts the daemon, and with it every
# container that has a restart policy. On a shared box that would bring
# another site's stopped stack back up from a read-only check.
dockerd_running() {
  local pf pid comm
  for pf in "$R/run/docker.pid" "$R/var/run/docker.pid"; do
    [ -f "$pf" ] && [ -r "$pf" ] || continue
    pid=""; read -r pid < "$pf" 2>/dev/null
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    comm=""; read -r comm < "$R/proc/$pid/comm" 2>/dev/null
    [ "$comm" = dockerd ] && return 0
  done
  return 1
}

DOCKER_OK=absent
PUBS=""
CONF=""
if have docker && ! dockerd_running; then
  DOCKER_OK=no
  cannot "the docker CLI is installed but dockerd is not running (no live dockerd in /run/docker.pid). Asking it for containers would start it through docker.socket, together with every container that has a restart policy, so this check does not. Start Docker yourself (sudo systemctl start docker) and re-run"
elif ! have docker && dockerd_running; then
  DOCKER_OK=no
  cannot "dockerd is running but there is no docker CLI to list its containers"
elif have docker; then
  DOCKER_OK=yes
  probe docker ps --no-trunc --format '{{json .Names}}{{"\t"}}{{.Ports}}'
  if [ "$RC" -ne 0 ]; then
    DOCKER_OK=no
    cannot "the docker CLI is installed but 'docker ps' failed (exit $RC), so published container ports cannot be listed"
  elif ! PUBS="$(printf '%s\n' "$OUT" | awk "$DOCKER_AWK")"; then
    DOCKER_OK=no
    cannot "the output of 'docker ps' could not be parsed"
  fi
  if [ "$DOCKER_OK" = yes ]; then
    probe docker ps -a -q --no-trunc
    if [ "$RC" -ne 0 ]; then
      DOCKER_OK=no
      cannot "'docker ps -a' failed (exit $RC), so containers that are not running cannot be checked"
    else
      ids=(); fed=no
      while IFS= read -r id; do
        case "$id" in
          "$SENTINEL") fed=yes; break ;;
          '') ;;
          *[!0-9a-f]*) DOCKER_OK=no; cannot "'docker ps -a -q' printed something that is not a container id" ;;
          *) ids+=("$id") ;;
        esac
      done < <(feed "$OUT")
      if [ "$fed" != yes ]; then
        DOCKER_OK=no; cannot "the output of 'docker ps -a -q' could not be read in full"
      elif [ "$DOCKER_OK" = yes ] && [ "${#ids[@]}" -gt 0 ]; then
        probe docker inspect --type container --format "$INSPECT_FMT" "${ids[@]}"
        if [ "$RC" -ne 0 ]; then
          DOCKER_OK=no
          cannot "'docker inspect' failed (exit $RC) for the containers 'docker ps -a' listed (one may have been removed meanwhile: re-run)"
        elif ! CONF="$(printf '%s\n' "$OUT" | awk -v want="${#ids[@]}" "$INSPECT_AWK")"; then
          DOCKER_OK=no
          cannot "the output of 'docker inspect' could not be parsed"
        fi
      fi
    fi
  fi
fi

BLUE_3001=no
GREEN_3002=no
fed=no
while IFS=$'\t' read -r kind who name pr lo hi; do
  case "$kind" in
    "$SENTINEL") fed=yes; break ;;
    BAD) DOCKER_OK=no; cannot "$who"; continue ;;
    P) ;;
    *) continue ;;
  esac
  if { [ "$lo" -le 80 ] && [ "$hi" -ge 80 ]; } || { [ "$lo" -le 443 ] && [ "$hi" -ge 443 ]; }; then
    if [ "$lo" = "$hi" ]; then
      shared "container '$name' publishes host port $lo/$pr"
    else
      shared "container '$name' publishes host ports $lo-$hi/$pr, which include 80 or 443"
    fi
  fi
  [ "$pr" = tcp ] || continue
  if [ "$lo" -le 3001 ] && [ "$hi" -ge 3001 ]; then
    if [ "$who" = blue ]; then BLUE_3001=yes; else app_busy+=("container '$name' publishes host port 3001"); fi
  fi
  if [ "$lo" -le 3002 ] && [ "$hi" -ge 3002 ]; then
    if [ "$who" = green ]; then GREEN_3002=yes; else app_busy+=("container '$name' publishes host port 3002"); fi
  fi
done < <(feed "$PUBS")
if [ "$fed" != yes ]; then DOCKER_OK=no; cannot "the list of published container ports could not be read in full"; fi

# The configuration of every container (see INSPECT_AWK). A container that
# is not running still counts when it is configured to publish :80/:443: it
# takes those ports whenever it runs (`sudo docker rm` it if it is not
# needed). One on the host's network publishes nothing and can still bind
# :80/:443 itself: it counts while it runs, or when a restart policy brings
# it back. For TCP 3001/3002, only a container that runs or comes back.
BLUE_IPS=" "
GREEN_IPS=" "
fed=no
while IFS=$'\t' read -r kind who name st rp a b c; do
  case "$kind" in
    "$SENTINEL") fed=yes; break ;;
    BAD) DOCKER_OK=no; cannot "$who"; continue ;;
    IP)
      case "$name" in *[!0-9.]*|'') continue ;; esac
      if [ "$who" = blue ]; then BLUE_IPS="$BLUE_IPS$name "; else GREEN_IPS="$GREEN_IPS$name "; fi
      continue ;;
    C)
      # C <who> <name> <state> <restart> <netmode>
      if [ "$a" = host ]; then
        case "$st" in
          running|restarting|paused) shared "container '$name' runs on the host's network (network_mode: host), so it can serve :80/:443 itself without publishing a port ($st)" ;;
          *) [ "$rp" = no ] || shared "container '$name' uses the host's network (network_mode: host) and restart policy '$rp' brings it back, so it can serve :80/:443 itself ($st now)" ;;
        esac
      fi
      continue ;;
    B) ;;
    *) continue ;;
  esac
  # B <who> <name> <state> <restart> <proto> <lo> <hi>
  pr="$a"; lo="$b"; hi="$c"
  if { [ "$lo" -le 80 ] && [ "$hi" -ge 80 ]; } || { [ "$lo" -le 443 ] && [ "$hi" -ge 443 ]; }; then
    if [ "$lo" = "$hi" ]; then
      shared "container '$name' ($st, restart policy '$rp') is configured to publish host port $lo/$pr and takes it whenever it runs"
    else
      shared "container '$name' ($st, restart policy '$rp') is configured to publish host ports $lo-$hi/$pr, which include 80 or 443"
    fi
  fi
  [ "$pr" = tcp ] || continue
  case "$st" in running|restarting|paused) ;; *) [ "$rp" != no ] || continue ;; esac
  if [ "$lo" -le 3001 ] && [ "$hi" -ge 3001 ] && [ "$who" != blue ]; then
    app_busy+=("container '$name' ($st, restart policy '$rp') is configured to publish host port 3001")
  fi
  if [ "$lo" -le 3002 ] && [ "$hi" -ge 3002 ] && [ "$who" != green ]; then
    app_busy+=("container '$name' ($st, restart policy '$rp') is configured to publish host port 3002")
  fi
done < <(feed "$CONF")
if [ "$fed" != yes ]; then DOCKER_OK=no; cannot "the configuration of the containers could not be read in full"; fi

# A web server unit that is enabled (systemd starts it at boot) but down
# right now, crashed or stopped by hand: nothing listens, and it takes
# :80/:443 back at the next boot. The host's packaged nginx is judged by its
# configuration in section 6 instead.
for p in "$R"/etc/systemd/system/*.wants/*; do
  [ -e "$p" ] || [ -L "$p" ] || continue
  u="${p##*/}"
  case "$u" in
    caddy*.service|apache2*.service|httpd*.service|haproxy*.service|traefik*.service|lighttpd*.service|openresty*.service|envoy*.service|angie*.service|h2o*.service)
      shared "the web server unit $(clean "$u") is enabled (${p#"$R"}), so systemd starts it at boot even if nothing listens on :80/:443 right now" ;;
  esac
done

# --- 4. walk the listeners ------------------------------------------------------
# Container orchestrators (see 4b) are recognised by name here as well.
ORCH_NAMES=' kubelet k3s k3s-server k3s-agent rke2 rke2-server rke2-agent kube-proxy kube-apiserver cilium-agent calico-node calico-felix '
orch=()
fed=no
while IFS=$'\t' read -r -a f; do
  [ "${#f[@]}" -gt 0 ] || continue
  case "${f[0]}" in
    "$SENTINEL") fed=yes; break ;;
    BAD) cannot "'ss' printed a line this check cannot parse (${f[1]:-?})"; SS_OK=no; continue ;;
    L) ;;
    *) continue ;;
  esac
  proto="${f[1]}"; port="${f[2]}"; host="${f[3]}"; n="${f[4]}"
  names=(); pids=()
  for ((i = 0; i < n; i++)); do
    names+=("${f[$((5 + 2 * i))]:-?}"); pids+=("${f[$((6 + 2 * i))]:-0}")
  done
  IFS=,; owners="${names[*]:-unidentified}"; IFS=$' \t\n'
  for ((i = 0; i < n; i++)); do
    case "$ORCH_NAMES" in *" ${names[$i]} "*) orch+=("'${names[$i]}' listens on $proto $host:$port") ;; esac
  done
  where="$proto $host:$port"

  if ! is_loopback "$host"; then ext+=("$where ($owners)"); fi

  # SSH ports reachable from outside (a loopback-only sshd needs no firewall
  # rule). A socket only systemd holds may be ssh.socket before its first
  # connection; say so, since sshd -T cannot see a ListenStream= drop-in.
  if [ "$proto" = tcp ] && ! is_loopback "$host"; then
    for ((i = 0; i < n; i++)); do
      [ "${names[$i]}" = sshd ] && ssh_ports+=("$port")
    done
    if [ "$n" -eq 1 ] && [ "${names[0]}" = systemd ]; then
      notes+=("$where is held by systemd alone (socket activation): if that is ssh.socket, SSH listens on $port")
    fi
  fi

  case "$port" in
    80|443)
      if [ "$n" -eq 0 ]; then
        shared "$where is held by a process this check cannot identify"
      fi
      for ((i = 0; i < n; i++)); do
        if [ "${names[$i]}" = nginx ]; then
          prove_nginx "${pids[$i]}" || shared "$where is held by an nginx (pid ${pids[$i]}) that is not proven to be the host's own: $WHY"
        else
          shared "$where is held by '${names[$i]}' (pid ${pids[$i]})"
        fi
      done
      ;;
  esac

  if [ "$proto" = tcp ]; then
    case "$port" in
      3001|3002)
        ours=yes
        [ "$n" -gt 0 ] || ours=no
        for ((i = 0; i < n; i++)); do
          case "${names[$i]}" in docker-proxy|dockerd) ;; *) ours=no ;; esac
        done
        if [ "$port" = 3001 ] && [ "$BLUE_3001" != yes ]; then ours=no; fi
        if [ "$port" = 3002 ] && [ "$GREEN_3002" != yes ]; then ours=no; fi
        [ "$ours" = yes ] || app_busy+=("$where is held by $owners, not by solutionmines-$([ "$port" = 3001 ] && echo blue || echo green)")
        ;;
    esac
  fi
done < <(feed "$LISTENERS")
if [ "$fed" != yes ]; then SS_OK=no; cannot "the list of listening sockets could not be read in full"; fi

[ "$SS_OK" = yes ] || app_busy+=("listening sockets could not be listed")
[ "$DOCKER_OK" = no ] && app_busy+=("containers could not be listed")

# --- 4b. what may take :80/:443 with no socket, rule or container now --------
# A container orchestrator. Kubernetes with an eBPF dataplane (Cilium's
# kube-proxy replacement, Calico eBPF) publishes hostPort, NodePort and
# LoadBalancer ports with tc/XDP/socket-lookup programs: no listening socket,
# no NAT rule, no IPVS entry, nothing in docker ps. Its presence is what
# shows. (Not containerd or its shims: Docker runs this site's own containers
# under them.)
for p in "$R"/proc/[0-9]*/comm; do
  [ -r "$p" ] || continue
  comm=""; read -r comm < "$p" 2>/dev/null
  pid="${p%/comm}"; pid="${pid##*/}"
  case "$ORCH_NAMES" in *" $comm "*) [ -n "$comm" ] && orch+=("process '$comm' runs (pid $pid)") ;; esac
done
for p in /etc/kubernetes /var/lib/kubelet /etc/rancher/k3s /var/lib/rancher/k3s /etc/rancher/rke2 /var/lib/rancher/rke2 /etc/cni/net.d/05-cilium.conflist /sys/fs/bpf/calico; do
  if [ -e "$R$p" ] || [ -L "$R$p" ]; then orch+=("$p exists"); fi
done
for p in "$R"/sys/fs/bpf/tc/globals/cilium_* "$R"/sys/fs/bpf/cilium; do
  if [ -e "$p" ] || [ -L "$p" ]; then orch+=("${p#"$R"} exists (Cilium's eBPF maps)"); break; fi
done
if [ "${#orch[@]}" -gt 0 ]; then
  x=""
  for p in "${orch[@]:0:4}"; do x="${x:+$x; }$p"; done
  shared "a container orchestrator (Kubernetes, k3s, Cilium or Calico) is on this box, and ports it publishes may show neither a socket nor a NAT rule ($x)"
fi


# --- 5. NAT: ports published with no listening socket ---------------------------
# A DNAT/REDIRECT/TPROXY/NETMAP rule is harmless only if one of its
# destination-port matches provably excludes both 80 and 443. A rule with no
# destination-port match at all is treated as covering them. A port match
# that cannot be evaluated (named sets, maps, compat expressions) cannot be
# verified. The same rules are checked against TCP 3001/3002 for
# APP_PORTS_FREE, where Docker's own DNAT for solutionmines-blue (3001) and
# solutionmines-green (3002) is allowed.
# Output lines: HIT|UNK <chain> <match>; APP|AUNK <chain> <match> <blue|green|->;
# LEGACY, INCOMPAT, BAD <why>.
NAT_COMMON='
function svc(v) {
  if (v ~ /^[0-9]+$/) return v + 0
  if (v == "http" || v == "www") return 80
  if (v == "https") return 443
  return -1
}
# portset LIST: sets P80/P443/P3001/P3002/PBAD for a list such as "80",
# "80:90", "1024:", "80,443", "80-90".
function portset(v,   n, a, i, it, lo, hi, k) {
  P80 = 0; P443 = 0; P3001 = 0; P3002 = 0; PBAD = 0
  n = split(v, a, ",")
  if (n == 0) { PBAD = 1; return }
  for (i = 1; i <= n; i++) {
    it = a[i]
    if (it == "") { PBAD = 1; continue }
    k = index(it, ":"); if (!k) k = index(it, "-")
    if (k) {
      lo = substr(it, 1, k - 1); hi = substr(it, k + 1)
      lo = (lo == "") ? 0 : svc(lo); hi = (hi == "") ? 65535 : svc(hi)
    } else { lo = svc(it); hi = lo }
    if (lo < 0 || hi < 0) { PBAD = 1; continue }
    if (lo <= 80 && hi >= 80) P80 = 1
    if (lo <= 443 && hi >= 443) P443 = 1
    if (lo <= 3001 && hi >= 3001) P3001 = 1
    if (lo <= 3002 && hi >= 3002) P3002 = 1
  }
}
# excludes(neg): after portset, does this match exclude both 80 and 443?
function excludes(neg) {
  if (PBAD) return 0
  if (neg) return P80 && P443
  return !P80 && !P443
}
# excludes_app(neg): ... both 3001 and 3002?
function excludes_app(neg) {
  if (PBAD) return 0
  if (neg) return P3001 && P3002
  return !P3001 && !P3002
}
# owner(chain, daddr, dports, ndp, dest): "blue" or "green" for a DNAT that
# has exactly the shape of the one Docker writes when it publishes
# 127.0.0.1:3001 (3002) for that running container: in the nat chain of
# Docker itself (DOCKER; nat-ports with its nftables backend), for
# destination 127.0.0.1 only, one port match, 3001 (3002), to the address of
# that very container (docker inspect, passed in as blue_ips/green_ips) and
# port 3000. Anything else that takes 3001/3002 is "-", i.e. not ours.
function owner(chain, daddr, dp, ndp, dest,   ip) {
  if (chain != "DOCKER" && chain != "nat-ports") return "-"
  if (daddr != "127.0.0.1" && daddr != "127.0.0.1/32") return "-"
  if (ndp != 1 || dest !~ /^[0-9.]+:3000$/) return "-"
  ip = " " substr(dest, 1, length(dest) - 5) " "
  if (dp == "3001" && index(blue_ips, ip)) return "blue"
  if (dp == "3002" && index(green_ips, ip)) return "green"
  return "-"
}
function clean(s) { gsub(/[^ A-Za-z0-9._:,!@+-]/, "_", s); sub(/ +$/, "", s); return s }
function report(ok, oka, unk, chain, what, own) {
  if (!ok) print (unk ? "UNK" : "HIT") "\t" clean(chain) "\t" clean(what)
  if (!oka) print (unk ? "AUNK" : "APP") "\t" clean(chain) "\t" clean(what) "\t" own
}
'
IPT_AWK="$NAT_COMMON"'
function tokenize(s,   i, c, n, t, inq, intok) {
  split("", T); split("", Q)
  n = 0; t = ""; inq = 0; intok = 0
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (inq) {
      if (c == "\\") { i++; t = t substr(s, i, 1); continue }
      if (c == "\"") { inq = 0; continue }
      t = t c; continue
    }
    if (c == "\"") { inq = 1; intok = 1; continue }
    if (c == " " || c == "\t") { if (intok) { T[++n] = t; t = ""; intok = 0 } ; continue }
    t = t c; intok = 1
  }
  if (intok) T[++n] = t
  if (inq) n = -1
  return n
}
function rule(   n, i, tg, ok, oka, unk, neg, v, desc, chain, ndp, dp, dest, pr, daddr) {
  n = tokenize($0)
  if (n < 0) { print "BAD\tunterminated quote in a rule"; return }
  chain = T[2]; tg = ""
  for (i = 3; i < n; i++) if (T[i] == "-j" || T[i] == "--jump") tg = T[i + 1]
  if (tg != "DNAT" && tg != "REDIRECT" && tg != "TPROXY" && tg != "NETMAP") return
  ok = 0; oka = 0; unk = 0; desc = ""; ndp = 0; dp = ""; dest = ""; daddr = ""
  for (i = 3; i <= n; i++) {
    if ((T[i] == "-d" || T[i] == "--destination") && T[i - 1] != "!") {
      daddr = T[i + 1]
    } else if (T[i] == "--dport" || T[i] == "--dports" || T[i] == "--destination-port" || T[i] == "--destination-ports") {
      neg = (T[i - 1] == "!"); v = T[i + 1]
      if (v == "!") { neg = 1; v = T[i + 2] }
      portset(v)
      if (PBAD) unk = 1
      if (excludes(neg)) ok = 1
      if (excludes_app(neg)) oka = 1
      ndp++; dp = (neg ? "!" : "") v
      desc = desc (neg ? "!" : "") v " "
    } else if (T[i] == "-m" && (T[i + 1] == "set" || T[i + 1] == "u32" || T[i + 1] == "bpf")) {
      unk = 1; desc = desc "-m " T[i + 1] " "
    } else if ((T[i] == "-p" || T[i] == "--protocol") && T[i - 1] != "!") {
      # TCP 3001/3002 only: a rule for another protocol cannot take them
      pr = T[i + 1]
      if (pr != "tcp" && pr != "6" && pr != "all" && pr != "0") oka = 1
    } else if (T[i] == "--to-destination") {
      dest = T[i + 1]
    }
  }
  if (desc == "") desc = "no destination-port match"
  report(ok, oka, unk, chain, tg " " desc, (unk || tg != "DNAT") ? "-" : owner(chain, daddr, dp, ndp, dest))
}
/^#/ {
  if ($0 ~ /ip6?tables-legacy tables present/) print "LEGACY"
  if ($0 ~ /incompatible/) print "INCOMPAT"
  next
}
/^\*/ { next }
/^:/ { next }
/^COMMIT[ \t]*$/ { next }
/^[ \t]*$/ { next }
/^-A / { rule(); next }
{ print "BAD\tunexpected line in iptables-save output" }
'
# nft list ruleset. "dnat", "redirect" and "tproxy" are also match VALUES
# (`ct status dnat`, which firewalld puts in every filter chain, and `icmp
# type redirect`), so a keyword counts only as a statement: never right after
# a match key or operator, never as a set element, never in a set or map
# declaration, and dnat/redirect never in a base chain of a type other than
# nat (nft refuses them there). tproxy is a filter-chain statement.
NFT_AWK="$NAT_COMMON"'
function tokenize(s,   i, c, n, t, inq, intok) {
  split("", T); split("", Q)
  n = 0; t = ""; inq = 0; intok = 0
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (inq) {
      if (c == "\\") { i++; t = t substr(s, i, 1); continue }
      if (c == "\"") { inq = 0; T[++n] = t; Q[n] = 1; t = ""; intok = 0; continue }
      t = t c; continue
    }
    if (c == "\"") { if (intok) { T[++n] = t; Q[n] = 0 } ; t = ""; inq = 1; intok = 0; continue }
    if (c == " " || c == "\t") { if (intok) { T[++n] = t; Q[n] = 0; t = ""; intok = 0 } ; continue }
    if (c == "{" || c == "}" || c == ",") {
      if (intok) { T[++n] = t; Q[n] = 0; t = ""; intok = 0 }
      T[++n] = c; Q[n] = 0; continue
    }
    t = t c; intok = 1
  }
  if (intok) { T[++n] = t; Q[n] = 0 }
  if (inq) n = -1
  return n
}
BEGIN {
  split("status type == != eq ne { , : . & | ^ map vmap jump goto", a, " ")
  for (k in a) VALUEPREV[a[k]] = 1
  split("set map flowtable ct counter quota limit secmark synproxy tunnel", a, " ")
  for (k in a) OBJ[a[k]] = 1
}
{
  n = tokenize($0)
  if (n < 0) { print "BAD\tunterminated quote in nft output"; next }
  if (n == 0) next
  # inside a set/map/object declaration (elements may continue over lines)
  if (inobj) { if (n == 1 && T[1] == "}") inobj = 0; next }
  if (T[1] == "table") { chain = ""; ctype = ""; next }
  if (T[1] == "chain" && n >= 2) { chain = T[2]; ctype = ""; next }
  if ((T[1] in OBJ) && n >= 3 && T[n] == "{") { inobj = 1; next }
  if (T[1] == "type" && n >= 4 && T[3] == "hook") { ctype = T[2]; next }
  # declarations, not rules
  if (T[1] == "set" || T[1] == "map" || T[1] == "flowtable" || T[1] == "type" || T[1] == "flags" || T[1] == "elements" || T[1] == "policy" || T[1] == "}" || T[1] == "devices" || T[1] == "hook" || T[1] == "size" || T[1] == "timeout" || T[1] == "gc-interval" || T[1] == "auto-merge") next
  natpos = 0; tg = ""; unk = 0
  for (i = 1; i <= n; i++) {
    if (Q[i]) continue
    w = T[i]
    if (w == "dnat" || w == "redirect" || w == "tproxy") {
      pv = (i > 1) ? T[i - 1] : ""; nx = (i < n) ? T[i + 1] : ""
      if (pv in VALUEPREV) continue
      if (nx == "," || nx == "}" || nx == ":" || nx == ".") continue
      if (w != "tproxy" && ctype != "" && ctype != "nat") continue
      # a statement keyword followed by something other than its syntax:
      # count it, but it cannot be read
      if (w == "dnat" && nx != "to" && nx != "ip" && nx != "ip6" && nx != "inet") unk = 1
      if (w == "tproxy" && nx != "to" && nx != "ip" && nx != "ip6") unk = 1
      natpos = i; tg = w; break
    }
    if (w == "xt" && i + 2 <= n && T[i + 1] == "target" && (T[i + 2] == "DNAT" || T[i + 2] == "REDIRECT" || T[i + 2] == "TPROXY" || T[i + 2] == "NETMAP")) {
      natpos = i; tg = "xt target " T[i + 2]; break
    }
  }
  if (!natpos) next
  ok = 0; oka = 0; desc = ""; ndp = 0; dp = ""; dest = ""; daddr = ""
  if (index(tg, "xt ") == 1) unk = 1
  for (i = 1; i < natpos; i++) {
    if (Q[i]) continue
    if (T[i] == "xt") { unk = 1; desc = desc "xt-compat "; continue }
    if (T[i] == "daddr" && i > 1 && T[i - 1] == "ip" && i < natpos - 1) {
      if (T[i + 1] == "==" || T[i + 1] == "eq") daddr = T[i + 2]
      else if (T[i + 1] != "!=" && T[i + 1] != "ne") daddr = T[i + 1]
      continue
    }
    if (T[i] != "dport" || i == 1) continue
    p = T[i - 1]
    if (p != "tcp" && p != "udp" && p != "th" && p != "sctp" && p != "dccp" && p != "udplite") continue
    j = i + 1; neg = 0
    if (T[j] == "!=" || T[j] == "ne") { neg = 1; j++ }
    else if (T[j] == "==" || T[j] == "eq") j++
    v = ""
    if (T[j] == "{") {
      for (j = j + 1; j <= n && T[j] != "}"; j++) {
        if (T[j] == ",") continue
        v = v (v == "" ? "" : ",") T[j]
      }
      if (j > n) v = "@unterminated"
    } else if (j <= n) v = T[j]
    if (v == "" || substr(v, 1, 1) == "@" || v == "map" || v == "vmap" || v == "." || v == "&" || v == "|" || T[i + 1] == ".") {
      unk = 1; desc = desc "dport " v " "; continue
    }
    portset(v)
    if (PBAD) unk = 1
    if (excludes(neg)) ok = 1
    # TCP 3001/3002 only: a udp/sctp/dccp port match cannot take them
    if (excludes_app(neg) || (p != "tcp" && p != "th")) oka = 1
    ndp++; dp = (neg ? "!=" : "") v
    desc = desc (neg ? "!=" : "") v " "
  }
  for (k = natpos + 1; k < n; k++) if (T[k] == "to") { dest = T[k + 1]; break }
  if (desc == "") desc = "no destination-port match"
  report(ok, oka, unk, chain, tg " " desc, (unk || tg != "dnat") ? "-" : owner(chain, daddr, dp, ndp, dest))
}
'

nat_results() {   # nat_results SOURCE TEXT-FROM-awk
  local src="$1" kind chain what own fed=no credited=" "
  while IFS=$'\t' read -r kind chain what own; do
    case "$kind" in
      "$SENTINEL") fed=yes; break ;;
      HIT) shared "a NAT rule ($src, chain $chain) redirects traffic for :80/:443 ($what)" ;;
      UNK) cannot "a NAT rule ($src, chain $chain) matches ports in a way this check cannot evaluate ($what)" ;;
      APP)
        # Docker writes one such rule per published port: a second one of
        # the same shape is not Docker's.
        if { [ "$own" = blue ] && [ "$BLUE_3001" = yes ]; } || { [ "$own" = green ] && [ "$GREEN_3002" = yes ]; }; then
          case "$credited" in
            *" $own "*) ;;
            *) credited="$credited$own "; continue ;;
          esac
        fi
        app_busy+=("$(clean "a NAT rule ($src, chain $chain) redirects TCP 3001/3002 ($what)")") ;;
      AUNK) app_busy+=("$(clean "a NAT rule ($src, chain $chain) may redirect TCP 3001/3002; its port match cannot be evaluated ($what)")") ;;
      BAD) cannot "$src printed output this check cannot parse ($chain)" ;;
    esac
  done < <(feed "$2")
  [ "$fed" = yes ] || cannot "what $src printed could not be read in full"
}

# nft first: whether it worked decides how an iptables-save gap is judged.
# Only nft shows native nftables tables (firewalld's `table inet firewalld`,
# LXD, netavark, kube-proxy's nftables mode, Docker's nftables backend, a
# hand-written /etc/nftables.conf): iptables-save, even its nf_tables
# variant, asks for its own ip/ip6 nat and mangle tables and never sees
# them. So when nft is missing or fails, NAT is not known in full (see
# nf_tables_unused for the one exception), whatever iptables-save says.
NFT_OK=no
NFT_WHY=""
if ! have nft; then
  NFT_WHY="'nft' is not installed"
else
  probe nft list ruleset
  if [ "$RC" -ne 0 ]; then
    NFT_WHY="'nft list ruleset' failed (exit $RC)"
  else
    res="$(printf '%s\n' "$OUT" | awk -v blue_ips="$BLUE_IPS" -v green_ips="$GREEN_IPS" "$NFT_AWK")"
    if [ $? -ne 0 ]; then
      cannot "the output of 'nft list ruleset' could not be parsed"
    else
      nat_results nft "$res"
      NFT_OK=yes
    fi
  fi
fi

# tool_variant TOOL: sets VARIANT to nft, legacy or unknown.
tool_variant() {
  probe "$1" --version
  case "$OUT" in
    *nf_tables*) VARIANT=nft ;;
    *legacy*) VARIANT=legacy ;;
    *) VARIANT=unknown ;;
  esac
}

# ipt_table TOOL TABLE: read and judge one table. 0 = read in full.
ipt_table() {
  local res
  probe "$1" -t "$2"
  if [ "$RC" -ne 0 ]; then notes+=("'$1 -t $2' failed (exit $RC)"); return 1; fi
  res="$(printf '%s\n' "$OUT" | awk -v blue_ips="$BLUE_IPS" -v green_ips="$GREEN_IPS" "$IPT_AWK")" || { cannot "the output of '$1 -t $2' could not be parsed"; return 1; }
  nat_results "$1" "$res"
  case "$res" in *LEGACY*) LEGACY_WARNED=yes ;; esac
  case "$res" in
    *INCOMPAT*)
      if [ "$NFT_OK" = yes ]; then
        notes+=("'$1 -t $2' cannot show a table that was written with nft; nft shows it")
      else
        notes+=("'$1 -t $2' cannot show a table that was written with nft, and nft is missing or failed")
      fi
      return 1 ;;
  esac
  return 0
}

# ipt_tables TOOL TABLE...: 0 if every table was read in full.
ipt_tables() {
  local t ok=0
  for t in "${@:2}"; do ipt_table "$1" "$t" || ok=1; done
  return "$ok"
}

# nat_family 4|6: is that address family's NAT fully known? DNAT and REDIRECT
# live in the nat table, TPROXY in mangle. Rules in the kernel's legacy
# x_tables (iptables-legacy, or a tool that bundles it) are invisible to nft
# and to iptables-nft; the kernel lists those tables in
# /proc/net/ip{,6}_tables_names, and only they are read with the legacy tool,
# because asking legacy iptables for a table that does not exist creates it.
# When iptables-save IS the legacy tool and the kernel lists no legacy nat or
# mangle table, there is nothing to read on the legacy side; the nf_tables
# side is then known only through nft, which the check after this requires.
# Sets COVERED to yes or no.
nat_family() {
  local tool lt names t main=no legacy_ok=yes
  local -a ltables=()
  if [ "$1" = 4 ]; then
    tool=iptables-save; lt=iptables-legacy-save; names="$R/proc/net/ip_tables_names"
  else
    tool=ip6tables-save; lt=ip6tables-legacy-save; names="$R/proc/net/ip6_tables_names"
  fi
  if [ -e "$names" ]; then
    if [ -r "$names" ]; then
      while read -r t _; do
        case "$t" in nat|mangle) ltables+=("$t") ;; esac
      done < "$names"
    else
      cannot "$names exists but cannot be read, so legacy iptables rules cannot be ruled out"
    fi
  fi
  LEGACY_WARNED=no
  VARIANT=none
  if have "$tool"; then
    tool_variant "$tool"
    if [ "$VARIANT" = legacy ]; then
      # It IS the legacy tool: the only tables there are those the kernel lists.
      ipt_tables "$tool" "${ltables[@]+"${ltables[@]}"}" && main=yes
    else
      ipt_tables "$tool" nat mangle && main=yes
    fi
  fi
  if [ "$VARIANT" != legacy ] && { [ "${#ltables[@]}" -gt 0 ] || [ "$LEGACY_WARNED" = yes ]; }; then
    [ "${#ltables[@]}" -gt 0 ] || ltables=(nat mangle)
    legacy_ok=no
    if have "$lt"; then
      ipt_tables "$lt" "${ltables[@]}" && legacy_ok=yes
    fi
    [ "$legacy_ok" = yes ] || cannot "legacy ip$([ "$1" = 6 ] && echo 6)tables tables are loaded (${ltables[*]}) but '$lt' could not read them; nft and iptables-nft cannot see those rules"
  fi
  COVERED=no
  if { [ "$main" = yes ] || [ "$NFT_OK" = yes ]; } && [ "$legacy_ok" = yes ]; then COVERED=yes; fi
}
nat_family 4; COV4="$COVERED"
nat_family 6; COV6="$COVERED"

# nf_tables_unused: is it PROVEN that the kernel has no nf_tables at all, so
# no native nftables table can exist? Only when sysfs shows no nf_tables
# module and the running kernel's modules.builtin shows it is not built in.
# (On Ubuntu and Debian it is always loaded: iptables-nft, ufw and Docker all
# use it.)
nf_tables_unused() {
  local rel=""
  [ -d "$R/sys/module" ] || return 1
  [ -e "$R/sys/module/nf_tables" ] && return 1
  read -r rel < "$R/proc/sys/kernel/osrelease" 2>/dev/null
  case "$rel" in ''|*/*|*[![:print:]]*) return 1 ;; esac
  [ -f "$R/lib/modules/$rel/modules.builtin" ] || return 1
  awk '/(^|\/)nf_tables\.ko$/ { found = 1 } END { exit found }' "$R/lib/modules/$rel/modules.builtin" 2>/dev/null
}
if [ "$NFT_OK" != yes ] && [ -n "$NFT_WHY" ] && ! nf_tables_unused; then
  cannot "$NFT_WHY, so native nftables NAT rules (firewalld, LXD, netavark, Docker's nftables backend, a hand-written /etc/nftables.conf) cannot be read: iptables-save never shows them. Install nftables (sudo apt-get install nftables; preflight only reads the ruleset) and re-run"
  app_busy+=("native nftables NAT rules could not be read")
fi
if [ "$COV4" != yes ] && [ "$COV6" != yes ]; then
  cannot "no NAT table could be read in full (iptables-save, ip6tables-save and nft are all missing or failed), so ports published by NAT alone cannot be ruled out"
elif [ "$COV4" != yes ]; then
  cannot "the IPv4 NAT rules could not be read in full ('iptables-save -t nat/-t mangle' failed or cannot show them, and nft is missing or failed), so ports published by IPv4 NAT alone cannot be ruled out"
elif [ "$COV6" != yes ]; then
  cannot "the IPv6 NAT rules could not be read in full ('ip6tables-save -t nat/-t mangle' failed or cannot show them, and nft is missing or failed), so ports published by IPv6 NAT alone cannot be ruled out"
fi
if [ "$COV4" != yes ] || [ "$COV6" != yes ]; then
  app_busy+=("NAT rules could not be read in full")
fi

# IPVS virtual services (kube-proxy in ipvs mode, keepalived/LVS) take traffic
# for a port without any listening socket or NAT rule.
if [ -e "$R/proc/net/ip_vs" ]; then
  if ! [ -r "$R/proc/net/ip_vs" ]; then
    cannot "/proc/net/ip_vs exists but cannot be read"
  else
    while read -r proto addr _; do
      case "$proto" in
        TCP|UDP|SCTP)
          hp="${addr##*:}"
          case "$hp" in ''|*[!0-9A-Fa-f]*) cannot "an IPVS entry cannot be parsed"; continue ;; esac
          case "$((16#$hp))" in
            80|443) shared "an IPVS virtual service takes $proto port $((16#$hp))" ;;
            3001|3002) [ "$proto" = TCP ] && app_busy+=("an IPVS virtual service takes TCP port $((16#$hp))") ;;
          esac ;;
        FWM) cannot "an IPVS virtual service matches a firewall mark, so its ports cannot be checked" ;;
      esac
    done < "$R/proc/net/ip_vs"
  fi
fi

# --- 6. nginx configuration ------------------------------------------------------
NGX=/etc/nginx
OUR_SITE_LINK=$NGX/sites-enabled/solutionmines
OUR_FILES=(
  "$NGX/conf.d/solutionmines-zones.conf"
  "$NGX/snippets/solutionmines-proxy.conf"
  "$NGX/solutionmines/upstream.conf"
  "$NGX/conf.d/solutionmines-proxy.conf"      # legacy layout
  "$NGX/conf.d/solutionmines-upstream.conf"   # legacy layout
)

# The md5 dpkg recorded for the stock default site, or nothing if it cannot
# be established, in which case the file counts as modified. Only
# nginx-common's own record vouches for the file: a package that diverts it
# (dpkg-divert, config-package-dev) or takes it over (Replaces:) records the
# md5 of whatever IT ships, which proves nothing about the stock file, and a
# diverted path is not the packaged file by definition.
stock_default_md5() {
  local -
  set -f
  local admin=() line owners o found=no
  local -a own=()
  [ "$TEST" = yes ] && admin=("--admindir=$R/var/lib/dpkg")
  have dpkg && have dpkg-query || return 0
  probe dpkg "${admin[@]}" -S $NGX/sites-available/default
  [ "$RC" -eq 0 ] || return 0
  while IFS= read -r line; do
    case "$line" in
      '') continue ;;
      diversion\ by\ *|local\ diversion*) return 0 ;;
      *": $NGX/sites-available/default") ;;
      *) continue ;;
    esac
    owners="${line%": $NGX/sites-available/default"}"
    # shellcheck disable=SC2206  # split on commas on purpose, globbing is off
    IFS=, own=($owners)
    for o in "${own[@]}"; do
      o="${o// /}"
      case "$o" in nginx-common|nginx-common:*) found=yes ;; esac
    done
  done < <(printf '%s\n' "$OUT")
  [ "$found" = yes ] || return 0
  probe dpkg-query "${admin[@]}" -W -f='${Conffiles}\n' nginx-common
  [ "$RC" -eq 0 ] || return 0
  printf '%s\n' "$OUT" | awk -v p="$NGX/sites-available/default" '$1 == p && $2 ~ /^[0-9a-f]+$/ && length($2) == 32 { print $2; exit }'
}

# stock_docroot_ok: the untouched stock default site serves /var/www/html
# (root /var/www/html; index index.html ... index.nginx-debian.html). An
# untouched site FILE says nothing about what is in that directory: copying a
# static site there is the commonest way nginx serves one. So the stock site
# counts as nobody's only when /var/www/html is absent, or is a real
# directory (not a symlink) holding nothing but the welcome page
# nginx-common's postinst copies there: index.nginx-debian.html, a regular
# file with the same bytes as /usr/share/nginx/html/index.html. Sets
# DOCROOT_WHY when it is not.
stock_docroot_ok() {
  local d=/var/www/html e name w g
  DOCROOT_WHY=""
  if ! [ -e "$R$d" ] && ! [ -L "$R$d" ]; then return 0; fi
  if ! resolve "$d" || [ "$RES" != "$d" ]; then DOCROOT_WHY="$d is a symlink"; return 1; fi
  if ! [ -d "$R$d" ] || ! [ -r "$R$d" ] || ! [ -x "$R$d" ]; then DOCROOT_WHY="$d cannot be listed"; return 1; fi
  for e in "$R$d"/* "$R$d"/.[!.]* "$R$d"/..?*; do
    [ -e "$e" ] || [ -L "$e" ] || continue
    name="${e##*/}"
    if [ "$name" != index.nginx-debian.html ]; then DOCROOT_WHY="it holds $(clean "$name")"; return 1; fi
    if [ -L "$e" ] || ! [ -f "$e" ]; then DOCROOT_WHY="its index.nginx-debian.html is not a regular file"; return 1; fi
    w=""; g=""
    if [ -f "$R/usr/share/nginx/html/index.html" ]; then
      w="$(md5sum < "$R/usr/share/nginx/html/index.html" 2>/dev/null)"; w="${w%% *}"
    fi
    g="$(md5sum < "$e" 2>/dev/null)"; g="${g%% *}"
    if [ -z "$w" ] || [ "$w" != "$g" ]; then
      DOCROOT_WHY="its index.nginx-debian.html is not nginx's welcome page (/usr/share/nginx/html/index.html)"; return 1
    fi
  done
  return 0
}

# Candidates: files whose server blocks are ours or the stock default's, as
# the nginx path they are loaded by and the file on disk (test root included).
CAND_P=()
CAND_F=()
candidate() {
  if ! [ -r "$2" ]; then cannot "$1 cannot be read"; return; fi
  CAND_P+=("$1"); CAND_F+=("$2")
}

# credit LOADPATH FILE: does the dump contain FILE's text, byte for byte, as
# one whole file under the header nginx writes for LOADPATH? nginx -T prints
# "# configuration file PATH:", the file, then one newline, for every file it
# loads, and each file is complete on its own. So the text must sit between
# that header and either the next header or the end. A header-looking comment
# inside another file cannot borrow a credit: the text after it would have to
# be FILE's exact text, which is then counted in the total anyway. Each region
# of the dump is credited at most once.
CREDIT_S=()
CREDIT_E=()
credit() {
  local d needle hay pre s e k
  d="$(tr '\000' '\037' < "$2" 2>/dev/null; printf x)"; d="${d%x}"
  needle=$'\n# configuration file '"$1"$':\n'"$d"$'\n'
  hay=$'\n'"$NDUMP"
  if [[ $hay == *"$needle# configuration file "* ]]; then
    pre="${hay%%"$needle# configuration file "*}"
  elif [[ $hay == *"$needle" ]]; then
    pre="${hay%"$needle"}"
  else
    return 1
  fi
  s=$((${#pre} + 1)); e=$((${#pre} + ${#needle}))
  for k in "${!CREDIT_S[@]}"; do
    if [ "$s" -lt "${CREDIT_E[$k]}" ] && [ "${CREDIT_S[$k]}" -lt "$e" ]; then return 1; fi
  done
  CREDIT_S+=("$s"); CREDIT_E+=("$e")
  return 0
}

if [ -d "$R$NGX" ] || [ -n "$NGINX_PATH" ]; then
  # sites-enabled: only our site and the untouched stock default may be there.
  if [ -d "$R$NGX/sites-enabled" ]; then
    for f in "$R$NGX/sites-enabled"/*; do
      [ -e "$f" ] || [ -L "$f" ] || continue
      name="${f##*/}"
      case "$name" in
        solutionmines)
          # The link must end at the file sites-available/solutionmines
          # names, compared resolved with resolved: /etc/nginx (or
          # sites-available) may itself be a symlink, to /srv/nginx kept
          # under configuration management for instance. Only the directory
          # is resolved first, so a sites-available/solutionmines that is
          # itself a link elsewhere still does not count.
          want=""
          resolve "$NGX/sites-available" && want="$RES/solutionmines"
          if [ -n "$want" ] && resolve "$OUR_SITE_LINK" && [ "$RES" = "$want" ] && [ -f "$R$RES" ]; then
            candidate "$OUR_SITE_LINK" "$R$RES"
          else
            notes+=("sites-enabled/solutionmines does not point at sites-available/solutionmines, so its server blocks count as foreign")
          fi
          ;;
        default)
          want="$(stock_default_md5)"
          got=""; p=""
          resolve "$NGX/sites-enabled/default" && p="$RES"
          if [ -n "$p" ] && [ -f "$R$p" ] && [ -r "$R$p" ]; then
            got="$(md5sum < "$R$p" 2>/dev/null)"; got="${got%% *}"
          fi
          if [ -n "$want" ] && [ "$want" = "$got" ]; then
            candidate "$NGX/sites-enabled/default" "$R$p"
            stock_docroot_ok || shared "nginx's untouched default site serves /var/www/html, which holds content other than nginx's welcome page ($DOCROOT_WHY). The stock site file is unchanged, but the site in it is someone's. If that is only an old copy of the welcome page, remove it and re-run"
          else
            shared "nginx's sites-enabled/default is not the untouched stock file (or that cannot be established), so it may be serving another site"
          fi
          ;;
        *) shared "nginx serves another site: sites-enabled/$name" ;;
      esac
    done
  fi
  for f in "${OUR_FILES[@]}"; do
    if resolve "$f" && [ -f "$R$RES" ]; then candidate "$f" "$R$RES"; fi
  done

  if [ -n "$NGINX_PATH" ]; then
    # What nginx actually loads. The verdict compares the server blocks in
    # the whole dump with those in candidate files PROVEN to be in it (see
    # credit): a stock default or our site that sits in sites-enabled but is
    # not loaded vouches for nothing.
    probe_raw nginx -T
    if [ "$RC" -ne 0 ]; then
      cannot "'nginx -T' failed (exit $RC), so the configuration nginx loads cannot be read; fix 'nginx -t' first"
    elif ! case $'\n'"$OUT" in *$'\n# configuration file '*) true ;; *) false ;; esac; then
      cannot "'nginx -T' printed no configuration"
    else
      count_dump "$OUT"
      if [ -n "$NGX_BAD" ]; then
        cannot "the output of 'nginx -T' does not parse as nginx configuration ($NGX_BAD)"
      else
        TOTAL="$BLOCKS"
        # Header paths as nginx writes them keep a doubled slash from an
        # include such as /etc/nginx//sites-enabled/*; squeeze those.
        NDUMP="$(printf '%s' "$OUT" | awk 'substr($0, 1, 21) == "# configuration file " { gsub(/\/\/+/, "/") } { print }'; printf x)"
        NDUMP="${NDUMP%x}"
        EXPECTED=0
        for i in "${!CAND_P[@]}"; do
          if credit "${CAND_P[$i]}" "${CAND_F[$i]}"; then
            count_blocks "${CAND_F[$i]}"
            if [ -n "$NGX_BAD" ]; then
              cannot "${CAND_P[$i]} does not parse as nginx configuration ($NGX_BAD)"
            fi
            EXPECTED=$((EXPECTED + BLOCKS))
          else
            notes+=("${CAND_P[$i]} is on disk, but nginx does not load it as it is on disk, so its server blocks are not counted as ours")
          fi
        done
        if [ "$TOTAL" -ne "$EXPECTED" ]; then
          shared "nginx loads $TOTAL server block(s), but $EXPECTED of them are ours or the stock default site"
        fi
      fi
    fi
  else
    # No nginx binary, but a configuration that installing nginx would switch
    # on. Count what the stock nginx.conf would load.
    EXPECTED=0
    if [ "${#CAND_F[@]}" -gt 0 ]; then
      count_blocks "${CAND_F[@]}"
      if [ -n "$NGX_BAD" ]; then
        cannot "our own or the stock nginx files do not parse as nginx configuration ($NGX_BAD)"
      fi
      EXPECTED="$BLOCKS"
    fi
    files=()
    # Everything the stock nginx.conf loads, and so everything the include
    # allow-list below accepts unread: modules-enabled/*.conf and mime.types
    # are read too (a stream{} server in modules-enabled is valid nginx).
    for f in "$R$NGX/nginx.conf" "$R$NGX/modules-enabled"/*.conf "$R$NGX/mime.types" \
             "$R$NGX/conf.d"/*.conf "$R$NGX/sites-enabled"/*; do
      [ -e "$f" ] || [ -L "$f" ] || continue
      resolve "${f#"$R"}" || { cannot "${f#"$R"} is a dangling or looping symlink, or its name cannot be read"; continue; }
      p="$RES"
      if [ -f "$R$p" ] && [ -r "$R$p" ]; then files+=("$R$p"); else cannot "${f#"$R"} cannot be read"; fi
    done
    if [ "${#files[@]}" -gt 0 ]; then
      count_blocks "${files[@]}"
      if [ -n "$NGX_BAD" ]; then
        cannot "leftover nginx configuration does not parse ($NGX_BAD)"
      else
        if [ "$BLOCKS" -ne "$EXPECTED" ]; then
          shared "leftover nginx configuration (no nginx binary) defines $BLOCKS server block(s), but $EXPECTED of them are ours or the stock default site"
        fi
        fed=no
        while IFS= read -r inc; do
          [ -n "$inc" ] || continue
          case "$inc" in
            "$SENTINEL") fed=yes; break ;;
            /etc/nginx/modules-enabled/\*.conf|modules-enabled/\*.conf|/etc/nginx/mime.types|mime.types) ;;
            /etc/nginx/conf.d/\*.conf|conf.d/\*.conf|/etc/nginx/sites-enabled/\*|sites-enabled/\*) ;;
            /etc/nginx/snippets/solutionmines-proxy.conf|/etc/nginx/solutionmines/upstream.conf) ;;
            /etc/nginx/conf.d/solutionmines-proxy.conf|/etc/nginx/conf.d/solutionmines-upstream.conf) ;;
            /etc/letsencrypt/options-ssl-nginx.conf) ;;
            *) cannot "leftover nginx configuration includes $inc, which this check does not read" ;;
          esac
        done < <(feed "$INCS")
        [ "$fed" = yes ] || cannot "the includes of the leftover nginx configuration could not be read in full"
      fi
    fi
  fi
fi

# --- 7. SSH ports (information only) ---------------------------------------------
# sshd -T prints the effective address:port pairs as `listenaddress` lines
# (`ListenAddress 0.0.0.0:2222` keeps `port 22` but listens on 2222 only), so
# those win over `port` when present. Loopback addresses need no firewall rule.
if have sshd; then
  probe sshd -T
  if [ "$RC" -eq 0 ]; then
    la=(); pt=(); had_la=no
    while read -r k v _; do
      case "$k" in
        port) pt+=("$v") ;;
        listenaddress)
          had_la=yes
          case "$v" in *:*) ;; *) continue ;; esac
          is_loopback "${v%:*}" || la+=("${v##*:}") ;;
      esac
    done < <(printf '%s\n' "$OUT")
    if [ "$had_la" = yes ]; then
      ssh_ports+=("${la[@]+"${la[@]}"}")
    else
      ssh_ports+=("${pt[@]+"${pt[@]}"}")
    fi
  fi
fi

finish
