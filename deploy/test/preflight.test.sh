#!/usr/bin/env bash
# ============================================================================
# Tests for deploy/preflight.sh
#
#   bash deploy/test/preflight.test.sh
#
# Self-contained: no root, no network, nothing outside one mktemp directory,
# which is removed at exit. Every case runs preflight the way callers do,
# under `env -i`, with --emit and --test-root: commands (ss, docker, nginx,
# sshd, iptables-save, ip6tables-save, nft, dpkg) are stubs on PATH and the
# filesystem (/etc/nginx, /proc, /run, /var/lib/dpkg) is a fake tree.
#
# Every case asserts the exit code and all three emitted lines, and some also
# check the human report. Case names carry the scenario ids from the stress
# test reports: FP = foreign-proxies, NG = nginx-states, FW = firewall-ssh,
# IN = integration, BR = bash-robustness. The suite runs once per awk found
# (mawk, gawk, busybox awk); preflight must behave identically under each.
#
# Output: "ok N - name" / "not ok N - name"; exit status 1 on any failure.
# ============================================================================
# Stubs and checks are single-quoted on purpose, and the job functions are
# called indirectly through queue().
# shellcheck disable=SC2016,SC2317,SC2034
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PF="$HERE/../preflight.sh"
FX="$HERE/fixtures/preflight"
NGX_SRC="$HERE/../nginx"
ENV_BIN="$(command -v env)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/preflight-test.XXXXXX")" || exit 1
[ -n "${KEEP:-}" ] && echo "# keeping $TMP" || trap 'rm -rf "$TMP"' EXIT

N=0
CID=0
FAILED=0
VERBOSE="${VERBOSE:-}"

# --- tool directories ---------------------------------------------------------
# SYS holds only the coreutils preflight and the stubs need, so a command
# that exists on this machine (docker, dpkg, nginx) is present in a case only
# when the case puts it there.
mk_sys() {   # mk_sys DIR AWK-PATH [OMIT...]
  local d="$1" awk="$2" c
  shift 2
  rm -rf "$d"; mkdir -p "$d"
  for c in bash sh readlink tr sort md5sum timeout cat sleep; do
    case " $* " in *" $c "*) continue ;; esac
    ln -s "$(command -v "$c")" "$d/$c"
  done
  case "$awk" in
    *busybox*) printf '#!/bin/sh\nexec %s awk "$@"\n' "$awk" > "$d/awk"; chmod +x "$d/awk" ;;
    *) ln -s "$awk" "$d/awk" ;;
  esac
}

# dpkg and dpkg-query: the real ones when present (read-only, pointed at a
# fixture admin dir by preflight's --admindir under --test-root); otherwise
# small emulations reading the same fixture files.
DPKG="$TMP/dpkg"
mkdir -p "$DPKG"
if command -v dpkg >/dev/null 2>&1 && command -v dpkg-query >/dev/null 2>&1; then
  ln -s "$(command -v dpkg)" "$DPKG/dpkg"
  ln -s "$(command -v dpkg-query)" "$DPKG/dpkg-query"
else
  cat > "$DPKG/dpkg" <<'EOF'
#!/bin/sh
a=""; for x; do case "$x" in --admindir=*) a="${x#*=}";; esac; done
[ "$2" = -S ] || exit 2
for l in "$a"/info/*.list; do [ -f "$l" ] || continue
  grep -qx "$3" "$l" && { p="${l##*/}"; echo "${p%.list}: $3"; exit 0; }; done
exit 1
EOF
  cat > "$DPKG/dpkg-query" <<'EOF'
#!/bin/sh
a=""; for x; do case "$x" in --admindir=*) a="${x#*=}";; esac; done
[ -f "$a/status" ] || exit 2
awk -v p="$4" '/^Package: /{c=($2==p)} c&&/^Conffiles:/{f=1;next} c&&f&&/^ /{print;next} {f=0}' "$a/status"
EOF
  chmod +x "$DPKG/dpkg" "$DPKG/dpkg-query"
fi

# --- one case ---------------------------------------------------------------------
# begin NAME: a clean, dedicated Ubuntu 24.04 box. sshd on :22 (socket
# activated, so systemd co-holds it), systemd-resolved and chrony on
# loopback, the DHCP client on udp/68, empty NAT tables, no docker, no nginx.
BASE_TCP='LISTEN 0      4096   127.0.0.53%lo:53        0.0.0.0:*    users:(("systemd-resolve",pid=612,fd=15))
LISTEN 0      4096      127.0.0.54:53        0.0.0.0:*    users:(("systemd-resolve",pid=612,fd=17))
LISTEN 0      4096         0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=1005,fd=3),("systemd",pid=1,fd=128))
LISTEN 0      4096            [::]:22           [::]:*    users:(("sshd",pid=1005,fd=4),("systemd",pid=1,fd=129))'
BASE_UDP='UNCONN 0      0         127.0.0.54:53        0.0.0.0:*    users:(("systemd-resolve",pid=612,fd=16))
UNCONN 0      0      127.0.0.53%lo:53        0.0.0.0:*    users:(("systemd-resolve",pid=612,fd=14))
UNCONN 0      0       10.0.0.5%eth0:68       0.0.0.0:*    users:(("systemd-network",pid=590,fd=23))
UNCONN 0      0          127.0.0.1:323       0.0.0.0:*    users:(("chronyd",pid=700,fd=5))
UNCONN 0      0              [::1]:323          [::]:*    users:(("chronyd",pid=700,fd=6))'

begin() {
  NAME="$1"; CID=$((CID + 1))
  C="$TMP/c$CID"; R="$C/root"; B="$C/bin"
  mkdir -p "$B" "$R/proc/1/ns" "$R/run" "$R/etc"
  ln -s 'mnt:[4026531841]' "$R/proc/1/ns/mnt"
  printf '%s\n' "$BASE_TCP" > "$C/tcp"
  printf '%s\n' "$BASE_UDP" > "$C/udp"
  PATHV="$B:$SYS:$DPKG"
  EXTRA_ENV=()
  ss_mode H
  stub sshd 'case "$1" in -T) echo "port 22";; esac'
  nat_ipt "$FX/nat/empty-iptables-nft.txt"
  nat_ipt6 "$FX/nat/empty-iptables-nft.txt"
  nat_nft /dev/null
}

stub() {   # stub NAME BODY (made executable by run_pf)
  printf '#!/bin/sh\n%s\n' "$2" > "$B/$1"
}
tcp() { printf '%s\n' "$@" >> "$C/tcp"; }
udp() { printf '%s\n' "$@" >> "$C/udp"; }
tcp_only() { printf '%s\n' "$@" > "$C/tcp"; }
udp_none() { : > "$C/udp"; }

HDR='State  Recv-Q Send-Q Local Address:Port  Peer Address:PortProcess'
ss_mode() {   # H (supports -H) | noH (rejects -H) | fail | fail127 | missing
  case "$1" in
    H) stub ss "case \"\$1\" in
  -Hltnp) cat '$C/tcp' ;;
  -Hlunp) cat '$C/udp' ;;
  -ltnp) echo '$HDR'; cat '$C/tcp' ;;
  -lunp) echo '$HDR'; cat '$C/udp' ;;
  *) exit 64 ;;
esac" ;;
    noH) stub ss "case \"\$1\" in
  -H*) echo \"ss: invalid option -- 'H'\" >&2; exit 255 ;;
  -ltnp) echo '$HDR'; cat '$C/tcp' ;;
  -lunp) echo '$HDR'; cat '$C/udp' ;;
  *) exit 64 ;;
esac" ;;
    fail) stub ss 'echo "Cannot open netlink socket: Permission denied" >&2; exit 1' ;;
    fail127) stub ss 'echo "ss: error while loading shared libraries: libbpf.so.1" >&2; exit 127' ;;
    missing) rm -f "$B/ss" ;;
  esac
}

# ipt_stub TOOL VARIANT NAT-FILE [MANGLE-FILE]: an iptables-save as preflight
# calls it: --version, -t nat, -t mangle (empty unless given). Every call is
# logged to $C/ipt.log.
ipt_stub() {
  stub "$1" "echo \"$1 \$*\" >> '$C/ipt.log'
case \"\$*\" in
  --version) echo '$1 v1.8.10 ($2)' ;;
  '-t nat') cat '$3' ;;
  '-t mangle') if [ -n '${4:-}' ]; then cat '${4:-}'; else printf '*mangle\\n:PREROUTING ACCEPT [0:0]\\nCOMMIT\\n'; fi ;;
  *) exit 2 ;;
esac"
}
nat_ipt()  { ipt_stub iptables-save nf_tables "$1" "${2:-}"; }
nat_ipt6() { ipt_stub ip6tables-save nf_tables "$1" "${2:-}"; }
nat_nft()  { stub nft "[ \"\$*\" = 'list ruleset' ] || exit 2; cat '$1'"; }
nat_none() { rm -f "$B/iptables-save" "$B/ip6tables-save" "$B/nft"; }
legacy_tables() {   # legacy_tables 4|6 TABLE...: the kernel lists legacy x_tables
  mkdir -p "$R/proc/net"
  if [ "$1" = 4 ]; then printf '%s\n' "${@:2}" > "$R/proc/net/ip_tables_names"
  else printf '%s\n' "${@:2}" > "$R/proc/net/ip6_tables_names"; fi
}

# dockerd_up: a running dockerd, as preflight looks for it (/run/docker.pid
# naming a live process whose comm is dockerd).
dockerd_up() {
  mkdir -p "$R/proc/880"; echo dockerd > "$R/proc/880/comm"; echo 880 > "$R/run/docker.pid"
}
# json_str TEXT: TEXT as a JSON string, the way docker's {{json}} writes it.
json_str() {
  local n="$1"
  n="${n//\\/\\\\}"; n="${n//\"/\\\"}"; n="${n//$'\n'/\\n}"; n="${n//$'\t'/\\t}"
  printf '"%s"' "$n"
}
# docker_stub: docker as preflight asks it, from three files:
#   docker ps --format {{json .Names}}...  -> $C/docker.out (running containers)
#   docker ps -a -q --no-trunc            -> one id per line of $C/docker.insp
#   docker inspect --type container ...   -> $C/docker.insp (every container)
docker_stub() {
  dockerd_up
  touch "$C/docker.out" "$C/docker.insp"
  stub docker "case \"\$*\" in
  'ps --no-trunc --format {{json .Names}}{{\"\\t\"}}{{.Ports}}') cat '$C/docker.out' ;;
  'ps -a -q --no-trunc') i=0; while IFS= read -r l; do i=\$((i + 1)); printf '%064x\\n' \"\$i\"; done < '$C/docker.insp' ;;
  'inspect --type container --format '*) cat '$C/docker.insp' ;;
  *) exit 2 ;;
esac"
}
# insp_line NAME STATUS RESTART NETMODE BINDINGS NETWORKS: one container as
# preflight's docker inspect format prints it (NAME without the leading /).
insp_line() {
  printf '%s\t"%s"\t"%s"\t"%s"\t%s\t%s\n' "$(json_str "/$1")" "$2" "$3" "$4" "$5" "$6"
}
# docker_ps 'name<TAB>ports' ...: dockerd running, and docker ps as preflight
# asks for it (name JSON-encoded, a tab, the Ports column). Each container is
# also in docker ps -a and docker inspect: running, on the edge network
# (blue 172.18.0.2, green 172.18.0.3, others 172.18.0.9), with no port
# bindings of its own there (docker ps already shows what a running container
# publishes); docker_all adds or replaces inspect records.
docker_ps() {
  local l n p ip
  docker_stub
  : > "$C/docker.out"; : > "$C/docker.insp"
  for l in "$@"; do
    n="${l%%$'\t'*}"; p="${l#*$'\t'}"
    printf '%s\t%s\n' "$(json_str "$n")" "$p" >> "$C/docker.out"
    case "$n" in solutionmines-blue) ip=172.18.0.2 ;; solutionmines-green) ip=172.18.0.3 ;; *) ip=172.18.0.9 ;; esac
    insp_line "$n" running unless-stopped edge '{}' "{\"edge\":{\"IPAMConfig\":null,\"Gateway\":\"172.18.0.1\",\"IPAddress\":\"$ip\",\"IPPrefixLen\":16}}" >> "$C/docker.insp"
  done
}
# docker_all 'name<TAB>status<TAB>restart<TAB>netmode<TAB>bindings-json[<TAB>networks-json]' ...:
# containers in docker ps -a / docker inspect (replacing a record of the same
# name), not in the running list unless docker_ps put them there.
docker_all() {
  local l n st rp nm bd nw key x
  [ -f "$C/docker.insp" ] || docker_ps
  for l in "$@"; do
    IFS=$'\t' read -r n st rp nm bd nw <<< "$l"
    key="$(json_str "/$n")"; [ -n "$nw" ] || nw='{}'
    while IFS= read -r x; do [ "${x%%$'\t'*}" = "$key" ] || printf '%s\n' "$x"; done < "$C/docker.insp" > "$C/docker.insp.new"
    mv "$C/docker.insp.new" "$C/docker.insp"
    insp_line "$n" "$st" "$rp" "$nm" "$bd" "$nw" >> "$C/docker.insp"
  done
}
docker_fail() { dockerd_up; stub docker 'echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2; exit 1'; }
# docker_stopped: the CLI is installed, dockerd is not running, and any call
# would socket-activate it; the stub records every call in $C/activations.
docker_stopped() { stub docker "echo \"docker \$*\" >> '$C/activations'; exit 0"; }

# --- nginx: files, process, binary ------------------------------------------------
stock_tree() {   # stock_tree abs|rel|copy|none: Ubuntu's nginx-common as installed
  local E="$R/etc/nginx"
  mkdir -p "$E/sites-available" "$E/sites-enabled" "$E/conf.d" "$E/modules-enabled" "$E/snippets"
  cp "$FX/stock-nginx/nginx.conf" "$FX/stock-nginx/mime.types" "$E/"
  cp "$FX/stock-nginx/default" "$E/sites-available/default"
  case "${1:-abs}" in
    abs) ln -s /etc/nginx/sites-available/default "$E/sites-enabled/default" ;;
    rel) ln -s ../sites-available/default "$E/sites-enabled/default" ;;
    copy) cp "$E/sites-available/default" "$E/sites-enabled/default" ;;
  esac
  mkdir -p "$R/var/lib"
  ln -s "$FX/dpkg" "$R/var/lib/dpkg"   # read-only; copy it before changing it
}

# our_site http|tls [legacy]: what bootstrap.sh (and enable-tls.sh) install,
# taken from deploy/nginx so the test follows any change to those files.
# The stock default site is removed, as bootstrap does.
our_site() {
  local E="$R/etc/nginx" kind="$1" layout="${2:-new}" site
  [ -d "$E" ] || stock_tree abs
  mkdir -p "$E/snippets" "$E/solutionmines"
  rm -f "$E/sites-enabled/default"
  if [ "$kind" = tls ]; then
    site="$(sed 's/__DOMAIN__/example.com/g' "$NGX_SRC/solutionmines-tls.conf")"
    mkdir -p "$R/etc/letsencrypt"
    printf 'ssl_session_cache shared:le_nginx_SSL:10m;\nssl_session_timeout 1440m;\n' > "$R/etc/letsencrypt/options-ssl-nginx.conf"
  else
    site="$(cat "$NGX_SRC/solutionmines-http.conf")"
  fi
  if [ "$layout" = legacy ]; then
    site="${site//\/etc\/nginx\/snippets\/solutionmines-proxy.conf/\/etc\/nginx\/conf.d\/solutionmines-proxy.conf}"
    sed 's#/etc/nginx/solutionmines/upstream.conf#/etc/nginx/conf.d/solutionmines-upstream.conf#' \
      "$NGX_SRC/solutionmines-zones.conf" > "$E/conf.d/solutionmines-zones.conf"
    cp "$NGX_SRC/solutionmines-proxy.conf" "$E/conf.d/solutionmines-proxy.conf"
    echo 'server 127.0.0.1:3001;' > "$E/conf.d/solutionmines-upstream.conf"
  else
    cp "$NGX_SRC/solutionmines-zones.conf" "$E/conf.d/solutionmines-zones.conf"
    cp "$NGX_SRC/solutionmines-proxy.conf" "$E/snippets/solutionmines-proxy.conf"
    echo 'server 127.0.0.1:3001;' > "$E/solutionmines/upstream.conf"
  fi
  printf '%s\n' "$site" > "$E/sites-available/solutionmines"
  ln -s /etc/nginx/sites-available/solutionmines "$E/sites-enabled/solutionmines"
}

# proc PID PPID EXE NS CMDLINE: a fake /proc/PID
proc() {
  mkdir -p "$R/proc/$1/ns"
  printf 'Name:\tnginx\nState:\tS (sleeping)\nPid:\t%s\nPPid:\t%s\n' "$1" "$2" > "$R/proc/$1/status"
  ln -s "$3" "$R/proc/$1/exe"
  ln -s "$4" "$R/proc/$1/ns/mnt"
  printf '%s\0' "$5" > "$R/proc/$1/cmdline"
}
MASTER_CMD='nginx: master process /usr/sbin/nginx -g daemon on; master_process on;'

# nginx_bin: the nginx stub. `nginx -T` prints, in nginx's own format (header,
# file, newline: identical to a real 1.24 dump, see fixtures), the files
# nginx would load from the fake tree, unless ngx.mode says otherwise.
nginx_bin() {
  stub nginx "case \"\$1\" in
  -T)
    mode=\$(cat '$C/ngx.mode' 2>/dev/null)
    if [ -z \"\$mode\" ] && [ -e '$C/ngx.autofail' ]; then
      echo 'nginx: [emerg] \"proxy_pass\" directive is not allowed here in /etc/nginx/conf.d/solutionmines-proxy.conf:6' >&2
      echo 'nginx: configuration file /etc/nginx/nginx.conf test failed' >&2; exit 1
    fi
    case \"\$mode\" in
      fail) echo 'nginx: [emerg] cannot load certificate \"/etc/ssl/othersite.pem\"' >&2
            echo 'nginx: configuration file /etc/nginx/nginx.conf test failed' >&2; exit 1 ;;
      empty) exit 0 ;;
      raw) cat '$C/ngx.raw'; exit 0 ;;
    esac
    while IFS='	' read -r h s; do printf '# configuration file %s:\n' \"\$h\"; cat \"\$s\"; printf '\n'; done < '$C/ngx.list'
    echo 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok' >&2
    exit 0 ;;
  -v) echo 'nginx version: nginx/1.24.0 (Ubuntu)' >&2 ;;
esac"
  NGINX_STUB="$(readlink -f "$B/nginx")"
}

# host_nginx [PORT...]: the packaged nginx running from the stub binary:
# master 4100 (= /run/nginx.pid) and workers 4101, 4102 on the host's mount
# namespace, holding PORT (default 80) on 0.0.0.0 and [::].
host_nginx() {
  local p
  nginx_bin
  proc 4100 1 "$NGINX_STUB" 'mnt:[4026531841]' "$MASTER_CMD"
  proc 4101 4100 "$NGINX_STUB" 'mnt:[4026531841]' 'nginx: worker process'
  proc 4102 4100 "$NGINX_STUB" 'mnt:[4026531841]' 'nginx: worker process'
  echo 4100 > "$R/run/nginx.pid"
  for p in "${@:-80}"; do
    tcp "LISTEN 0      511          0.0.0.0:$p        0.0.0.0:*    users:((\"nginx\",pid=4102,fd=6),(\"nginx\",pid=4101,fd=6),(\"nginx\",pid=4100,fd=6))"
    tcp "LISTEN 0      511             [::]:$p           [::]:*    users:((\"nginx\",pid=4102,fd=7),(\"nginx\",pid=4101,fd=7),(\"nginx\",pid=4100,fd=7))"
  done
}

tresolve() {   # tresolve ROOT-RELATIVE-PATH: like preflight's resolve()
  local p="$1" t n=0
  while [ -L "$R$p" ] && [ "$n" -lt 40 ]; do
    n=$((n + 1)); t="$(readlink "$R$p")"
    case "$t" in /*) p="$t" ;; *) p="${p%/*}/$t" ;; esac
  done
  printf '%s%s' "$R" "$p"
}
dump_extra() { printf '%s\t%s\n' "$1" "$2" >> "$C/ngx.extra"; }   # HEADER SOURCE
# auto_dump: what `nginx -T` prints for the fake tree, the way real nginx
# builds it: nginx.conf first, then every file an include pulls in, in the
# order nginx reads them (globs sorted, nested includes where they occur),
# each file once. A file that nothing includes is not in the dump, so a site
# left in sites-enabled under an nginx.conf that no longer includes it is not
# loaded, exactly as on a real box. The old conf.d layout (proxy_pass and a
# bare `server` line at http level) makes it fail, as real nginx 1.24 does.
declare -A AD_SEEN=()
ad_file() {   # ad_file HEADER-PATH
  local h="$1" src inc f
  [ -n "${AD_SEEN[$h]+y}" ] && return 0
  AD_SEEN[$h]=1
  src="$(tresolve "$h")"
  [ -f "$src" ] || return 0
  printf '%s\t%s\n' "$h" "$src" >> "$C/ngx.list"
  case "$h" in
    /etc/nginx/conf.d/solutionmines-proxy.conf|/etc/nginx/conf.d/solutionmines-upstream.conf) : > "$C/ngx.autofail" ;;
  esac
  while IFS= read -r inc; do
    [ -n "$inc" ] || continue
    case "$inc" in /*) ;; *) inc="/etc/nginx/$inc" ;; esac
    for f in "$R"$inc; do
      [ -e "$f" ] || [ -L "$f" ] || continue
      ad_file "${f#"$R"}"
    done
  done < <(sed 's/#.*//' "$src" | grep -oE '(^|[[:space:];{}])include[[:space:]]+[^;[:space:]]+[[:space:]]*;' \
             | sed -E 's/.*include[[:space:]]+([^;[:space:]]+).*/\1/')
}
auto_dump() {
  : > "$C/ngx.list"; rm -f "$C/ngx.autofail"
  AD_SEEN=()
  ad_file /etc/nginx/nginx.conf
  [ -f "$C/ngx.extra" ] && cat "$C/ngx.extra" >> "$C/ngx.list"
  return 0
}

# --- running and asserting -----------------------------------------------------------
# Cases are checked in parallel: setting a case up is sequential and cheap;
# queue() hands the run and its assertions to a background job, and the
# results are printed in order at the end.
P="$(nproc 2>/dev/null || echo 2)"
case "$P" in ''|*[!0-9]*) P=2 ;; esac
[ "$P" -gt 8 ] && P=8
[ "$P" -ge 1 ] || P=1
QUEUED=()
RUNNING=0
CHECK=""     # optional shell snippet run after the case; any output fails it

queue() {   # queue JOB ARGS...
  if [ -n "${ONLY:-}" ]; then case "$NAME" in *$ONLY*) ;; *) CHECK=""; return 0 ;; esac; fi
  printf '%s\n' "$NAME" > "$C/name"
  QUEUED+=("$C")
  chmod +x "$B"/* 2>/dev/null
  [ -f "$B/nginx" ] && auto_dump
  if [ "$RUNNING" -ge "$P" ]; then wait -n; RUNNING=$((RUNNING - 1)); fi
  ( "$@" > "$C/result" 2>&1 ) &
  RUNNING=$((RUNNING + 1))
  CHECK=""
}

run_pf() {   # run_pf [ARGS...]: preflight under env -i; stdout/stderr to files
  ( cd "$C" && "$ENV_BIN" -i PATH="$PATHV" ${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"} \
      "$SYS/bash" "$PF" "$@" > "$C/out" 2> "$C/err" )
  RC=$?
}
result() {   # result WHY: "ok", or "not ok" and the details
  if [ -z "$1" ]; then
    echo ok
    [ -n "$VERBOSE" ] && sed 's/^/#   /' "$C/err"
  else
    echo "not ok"
    echo "#   $1"
    sed 's/^/#   | /' "$C/err" | head -40
  fi
}
check_hook() {   # appends the output of CHECK, if any, to WHY
  local x
  [ -n "$CHECK" ] || return 0
  x="$(eval "$CHECK" 2>&1)"
  [ -z "$x" ] || why="${why:+$why; }$x"
}

# job_emit RC SHARED APP_PORTS_FREE SSH_PORTS [REPORT-REGEX [!REPORT-REGEX]]
job_emit() {
  local why="" out="" err="" want T0=$SECONDS
  run_pf --emit --test-root "$R"
  want="SHARED=$2"$'\n'"APP_PORTS_FREE=$3"$'\n'"SSH_PORTS=$4"$'\n'
  IFS= read -r -d '' out < "$C/out"; IFS= read -r -d '' err < "$C/err"
  [ "$RC" = "$1" ] || why="exit $RC, want $1"
  [ "$out" = "$want" ] || why="${why:+$why; }stdout: ${out//$'\n'/|}"
  if [ -n "${5:-}" ] && ! [[ $err =~ $5 ]]; then why="${why:+$why; }report lacks /$5/"; fi
  if [ -n "${6:-}" ] && [[ $err =~ $6 ]]; then why="${why:+$why; }report has /$6/"; fi
  check_hook
  result "$why"
}
# job_plain RC ARGS...: run preflight with ARGS; pass if the exit code is RC
# and CHECK prints nothing.
job_plain() {
  local why="" want="$1"
  shift
  run_pf "$@"
  [ "$RC" = "$want" ] || why="exit $RC, want $want"
  check_hook
  result "$why"
}
# job_nofile RC SHARED APP_PORTS_FREE SSH_PORTS [REPORT-REGEX]: like
# job_emit, with RLIMIT_FSIZE 0 and SIGXFSZ ignored, so no file can be
# written (bash-robustness N1). stdout and stderr go through pipes.
job_nofile() {
  local why="" out="" err="" want rc
  { ( cd "$C" && "$SYS/bash" -c 'ulimit -f 0; trap "" XFSZ; "$@"; echo "@@RC=$?" >&2' _ \
        "$ENV_BIN" -i PATH="$PATHV" "$SYS/bash" "$PF" --emit --test-root "$R" ) 2>&1 1>&3 3>&- | cat > "$C/err"; } 3>&1 | cat > "$C/out"
  rc="$(sed -n 's/^@@RC=//p' "$C/err")"
  want="SHARED=$2"$'\n'"APP_PORTS_FREE=$3"$'\n'"SSH_PORTS=$4"$'\n'
  IFS= read -r -d '' out < "$C/out"; IFS= read -r -d '' err < "$C/err"
  [ "$rc" = "$1" ] || why="exit $rc, want $1"
  [ "$out" = "$want" ] || why="${why:+$why; }stdout: ${out//$'\n'/|}"
  if [ -n "${5:-}" ] && ! [[ $err =~ $5 ]]; then why="${why:+$why; }report lacks /$5/"; fi
  check_hook
  result "$why"
}
expect() { queue job_emit "$@"; }
ded()  { expect 0 no yes "${1-22}" "${2:-}" "${3:-}"; }        # dedicated, app ports free
shr()  { expect 3 yes yes "${2-22}" "$1" "${3:-}"; }            # shared, app ports free
shrx() { expect 3 yes no 22 "$1"; }                             # shared; app ports unverifiable
shra() { expect 3 yes no 22 "$1"; }                             # shared; a NAT rule also takes 3001/3002

# --- the cases --------------------------------------------------------------------------
cases() {

# === dedicated boxes: nothing may be wrongly refused ===================================
begin "clean Ubuntu 24.04 box (FP baseline-dedicated, FW S01b, IN S1, BR S01, FP-F3 S1)"
ded 22 'dedicated' 'will refuse|bootstrap'

begin "clean box, ss without -H support (FP baseline-dedicated-noH)"
ss_mode noH; ded

begin "stock nginx running, stock default enabled (abs symlink), dpkg md5 matches (NG 02, BR S02, FP-F1 host-nginx-stock-default-only, FP-F5 J0)"
stock_tree abs; host_nginx 80; ded

begin "stock default enabled by relative symlink (NG 03)"
stock_tree rel; host_nginx 80; ded

begin "stock default enabled as a regular-file copy (NG 04)"
stock_tree copy; host_nginx 80; ded

begin "real nginx 1.24 -T dump of the stock install, from fixtures (NG 02)"
stock_tree abs; host_nginx 80; echo raw > "$C/ngx.mode"; cp "$FX/stock-nginx-T.txt" "$C/ngx.raw"; ded

begin "nginx installed with an empty configuration (NG-2 D4)"
nginx_bin; mkdir -p "$R/etc/nginx"; printf 'events {}\nhttp {}\n' > "$R/etc/nginx/nginx.conf"; ded

begin "stock nginx installed but not running (NG 36 variant: binary on PATH)"
stock_tree abs; nginx_bin; ded

begin "our previous install, HTTP only, new layout (NG 09, IN S6)"
our_site http; host_nginx 80; ded

begin "our previous install, TLS, new layout (NG 09b)"
our_site tls; host_nginx 80 443; ded

# Real nginx rejects the old conf.d layout (proxy_pass and a bare `server` at
# http level), so `nginx -T` fails and preflight cannot verify the box; the
# guard explains the manual migration (guard.test.sh, nginx-states NEW-2).
begin "our previous install, HTTP only, legacy conf.d layout: nginx -T fails as on real nginx (NG 09, nginx-states NEW-2)"
our_site http legacy; host_nginx 80; shr "'nginx -T' failed \(exit 1\)"

begin "our previous install, TLS, legacy conf.d layout: nginx -T fails as on real nginx (NG 09b, nginx-states NEW-2)"
our_site tls legacy; host_nginx 80 443; shr "'nginx -T' failed \(exit 1\)"

begin "our install with the stock default still enabled (NG 09c)"
our_site http; ln -s /etc/nginx/sites-available/default "$R/etc/nginx/sites-enabled/default"; host_nginx 80; ded

begin "Docker running only our blue container on 127.0.0.1:3001 (FP our-own-blue-green-only, BR S35, FP-F7 G)"
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))'
docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp'
nat_ipt "$FX/nat/docker-ours-iptables.txt"; nat_ipt6 "$FX/nat/docker-ours-ip6tables.txt"; nat_nft "$FX/nat/docker-ours-nft.txt"
ded

begin "Docker with blue on 3001 and green on 3002 (FP-F2 own-blue-green-excluded)"
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))' \
    'LISTEN 0      4096       127.0.0.1:3002      0.0.0.0:*    users:(("docker-proxy",pid=2301,fd=7))'
docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp' $'solutionmines-green\t127.0.0.1:3002->3000/tcp'
nat_ipt "$FX/nat/docker-ours-iptables.txt"; nat_nft "$FX/nat/docker-ours-nft.txt"
ded

begin "full dedicated deploy: our TLS site, nginx, blue, Docker NAT (IN S6, FP-F4 S8)"
our_site tls; host_nginx 80 443
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))'
docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp'
nat_ipt "$FX/nat/docker-ours-iptables.txt"; nat_ipt6 "$FX/nat/docker-ours-ip6tables.txt"; nat_nft "$FX/nat/docker-ours-nft.txt"
ded

begin "Docker with iptables-legacy, only our container"
nat_ipt "$FX/nat/docker-ours-legacy.txt"; nat_nft /dev/null
docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp'
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))'
ded

begin "Docker's native nftables backend, only our container"
nat_nft "$FX/nat/docker-native-nft-ours.txt"
docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp'
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))'
ded

begin "our blue container with userland-proxy off: dockerd holds 3001 (FP-F2 dockerd listener)"
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("dockerd",pid=880,fd=41))'
docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp'
nat_ipt "$FX/nat/docker-ours-iptables.txt"
ded

begin "docker installed, no containers (FP-F7 F, FP-F2 docker-no-containers)"
docker_ps; ded

begin "docker not installed (FP-F7 E, FP-F2 clean-no-docker)"
ded

begin "conf.d/gzip.conf without a server block (NG 08)"
stock_tree abs; host_nginx 80; printf 'gzip_vary on;\ngzip_types text/css;\n' > "$R/etc/nginx/conf.d/gzip.conf"; ded

begin "sites-enabled exists but is empty, no nginx (BR S04)"
mkdir -p "$R/etc/nginx/sites-enabled"; ded

begin "stock nginx.conf: commented '#\\tserver {' lines are not blocks (BR control)"
stock_tree none; ded

begin "a diverted default site is not the packaged file, whoever owns it (NG 10c, BR S12, bash-robustness N2)"
stock_tree abs; host_nginx 80
stub dpkg "printf 'diversion by foo from: /etc/nginx/sites-available/default\ndiversion by foo to: /etc/nginx/sites-available/default.real\nnginx-common: /etc/nginx/sites-available/default\n'"
shr 'not the untouched stock file'

begin "dpkg -S 'nginx-common, nginx-core: path' (NG 10d, BR S13)"
stock_tree abs; host_nginx 80
stub dpkg "echo 'nginx-common, nginx-core: /etc/nginx/sites-available/default'"
ded

begin "dpkg -S arch-qualified owner 'nginx-common:amd64: path' (BR S16)"
stock_tree abs; host_nginx 80
stub dpkg "echo 'nginx-common:amd64: /etc/nginx/sites-available/default'"
ded

begin "Conffiles line with a trailing 'obsolete' flag (NG 33, BR S14)"
stock_tree abs; host_nginx 80
rm "$R/var/lib/dpkg"; cp -R "$FX/dpkg" "$R/var/lib/dpkg"
sed -i 's#^\( /etc/nginx/sites-available/default [0-9a-f]*\)$#\1 obsolete#' "$R/var/lib/dpkg/status"
ded

begin "nginx -T header with a doubled slash (NGX-4 D5)"
stock_tree abs; host_nginx 80
sed -i 's#include /etc/nginx/sites-enabled/\*;#include /etc/nginx//sites-enabled/*;#' "$R/etc/nginx/nginx.conf"
ded

begin "header-looking comments do not matter: dedicated box keeps its verdict (design 7, NG-5 X2)"
our_site http; host_nginx 80
printf '# configuration file /etc/nginx/vhosts/othersite.conf:\nserver_names_hash_bucket_size 64;\n' > "$R/etc/nginx/conf.d/hash.conf"
sed -i '1i # configuration file /etc/nginx/sites-enabled/othersite:' "$R/etc/nginx/sites-available/solutionmines"
ded

# === firewall-ssh family: no firewall verdict any more, SSH_PORTS informational ====
begin "nginx on 80/443 plus resolved; ufw is never consulted (FW S01, FW R1, R2)"
stock_tree abs; host_nginx 80 443
stub ufw "touch '$C/ufw-was-called'; echo 'Status: inactive'"
CHECK='[ ! -e "$C/ufw-was-called" ] || echo "preflight ran ufw"'
ded

begin "ssh socket activation on :22 owned by systemd only (FW S02, FP-F3 R1)"
tcp_only 'LISTEN 0      4096         0.0.0.0:22        0.0.0.0:*    users:(("systemd",pid=1,fd=128))'
ded 22

begin "socket activation on 2222, sshd -T says 2222 (FW S03)"
tcp_only 'LISTEN 0      4096         0.0.0.0:2222      0.0.0.0:*    users:(("systemd",pid=1,fd=128))'
stub sshd 'echo "port 2222"'; ded 2222

begin "sshd -T fails, only systemd on :22 (FW S04, BR S55)"
tcp_only 'LISTEN 0      4096         0.0.0.0:22        0.0.0.0:*    users:(("systemd",pid=1,fd=128))'
stub sshd 'echo "sshd: no hostkeys available -- exiting." >&2; exit 1'; ded ''

begin "sshd binary absent, only systemd on :22 (FW S04b)"
tcp_only 'LISTEN 0      4096         0.0.0.0:22        0.0.0.0:*    users:(("systemd",pid=1,fd=128))'
rm -f "$B/sshd"; ded ''

begin "sshd binary absent, ss shows sshd on :22 (BR S58)"
rm -f "$B/sshd"; ded 22

begin "two ports 22 and 2222, sshd -T and ss agree (FW S05)"
tcp 'LISTEN 0      128          0.0.0.0:2222      0.0.0.0:*    users:(("sshd",pid=1005,fd=5))'
stub sshd 'printf "port 22\nport 2222\n"'; ded '22 2222'

begin "two sshd ports from ss only, sshd -T fails (FW S05b)"
tcp 'LISTEN 0      128          0.0.0.0:2222      0.0.0.0:*    users:(("sshd",pid=1005,fd=5))'
stub sshd 'exit 1'; ded '22 2222'

begin "sshd -T stale (22) while sshd listens on 2222 (FW S05c)"
tcp_only 'LISTEN 0      128          0.0.0.0:2222      0.0.0.0:*    users:(("sshd",pid=1005,fd=5))'
ded '22 2222'

begin "ssh.socket override on 2222 owned by systemd, sshd -T 22 (FW S05d, BR S56, FP-F3 S7)"
tcp_only 'LISTEN 0      4096         0.0.0.0:2222      0.0.0.0:*    users:(("systemd",pid=1,fd=128))'
ded 22 'tcp 0.0.0.0:2222 \(systemd\)'

begin "sshd on [::]:22 only (FP-F3 R2)"
tcp_only 'LISTEN 0      128             [::]:22           [::]:*    users:(("sshd",pid=1005,fd=4))'
ded 22

begin "unknown owner on :22, not attributable (FP-F3 R3)"
tcp_only 'LISTEN 0      128          0.0.0.0:22        0.0.0.0:*'
ded 22

begin "sshd on 2222 agreeing with sshd -T (FP-F3 R4)"
tcp_only 'LISTEN 0      128          0.0.0.0:2222      0.0.0.0:*    users:(("sshd",pid=1005,fd=3))'
stub sshd 'echo "port 2222"'; ded 2222

begin "postgres on 0.0.0.0:5432 is listed, not judged (FW S06, FW-4 matrix)"
tcp 'LISTEN 0      244          0.0.0.0:5432      0.0.0.0:*    users:(("postgres",pid=800,fd=6))'
ded 22 'tcp 0.0.0.0:5432 \(postgres\)'

begin "postgres on loopback only (FW S07, FP-F3 R5)"
tcp 'LISTEN 0      244        127.0.0.1:5432      0.0.0.0:*    users:(("postgres",pid=800,fd=6))' \
    'LISTEN 0      244            [::1]:5432         [::]:*    users:(("postgres",pid=800,fd=7))'
ded 22 '' '5432'

begin "docker-proxy on 0.0.0.0:8080 and [::]:8080 (FW S08)"
tcp 'LISTEN 0      4096         0.0.0.0:8080      0.0.0.0:*    users:(("docker-proxy",pid=2001,fd=4))' \
    'LISTEN 0      4096            [::]:8080         [::]:*    users:(("docker-proxy",pid=2008,fd=4))'
docker_ps $'app\t0.0.0.0:8080->80/tcp, [::]:8080->80/tcp'; ded

begin "docker-proxy on :8080 with daemon.json iptables=false (FW R4, FW-6)"
mkdir -p "$R/etc/docker"; echo '{"iptables": false}' > "$R/etc/docker/daemon.json"
tcp 'LISTEN 0      4096         0.0.0.0:8080      0.0.0.0:*    users:(("docker-proxy",pid=2001,fd=4))'
docker_ps $'app\t0.0.0.0:8080->80/tcp'; ded

begin "node on [::]:3000 and *:3000 (FW S09, S09b)"
tcp 'LISTEN 0      511             [::]:3000         [::]:*    users:(("node",pid=901,fd=20))' \
    'LISTEN 0      511                *:3000            *:*    users:(("node",pid=902,fd=20))'
ded

begin "ufw active, exposed db, or SSH port unknown (FW S10, S10b, BR S57)"
stub ufw 'echo "Status: active"'
tcp_only 'LISTEN 0      4096         0.0.0.0:22        0.0.0.0:*    users:(("systemd",pid=1,fd=128))' \
         'LISTEN 0      244          0.0.0.0:5432      0.0.0.0:*    users:(("postgres",pid=800,fd=6))'
stub sshd 'exit 1'; ded ''

begin "ufw not installed, db exposed (FW S11, S11b)"
tcp 'LISTEN 0      244          0.0.0.0:5432      0.0.0.0:*    users:(("postgres",pid=800,fd=6))'; ded

begin "listener with no users field on :111 (FW S13)"
tcp 'LISTEN 0      4096         0.0.0.0:111       0.0.0.0:*'; ded 22 'tcp 0.0.0.0:111 \(unidentified\)'

begin "private IP 10.0.0.5:9100, v4-mapped loopback 6379, link-local 5000 (FW S14, S15, S16)"
tcp 'LISTEN 0      4096        10.0.0.5:9100      0.0.0.0:*    users:(("node_exporter",pid=950,fd=3))' \
    'LISTEN 0      511  [::ffff:127.0.0.1]:6379          *:*    users:(("redis-server",pid=951,fd=6))' \
    'LISTEN 0      4096    [fe80::1]%eth0:5000         [::]:*    users:(("registry",pid=952,fd=3))'
ded

begin "process named 'sshd x' on 6379 is not SSH (FW H2, FW-5)"
tcp 'LISTEN 0      511          0.0.0.0:6379      0.0.0.0:*    users:(("sshd x",pid=960,fd=6))'; ded 22

begin "process named 'sshd<TAB>x' and 'sshd\"x' on 6379/6380 are not SSH (FW-5 variants)"
tcp 'LISTEN 0      511          0.0.0.0:6379      0.0.0.0:*    users:(("sshd	x",pid=960,fd=6))' \
    'LISTEN 0      511          0.0.0.0:6380      0.0.0.0:*    users:(("sshd"x",pid=961,fd=6))'
ded 22

begin "process named exactly 'sshd' on 6379 counts as SSH (FW H3)"
tcp 'LISTEN 0      511          0.0.0.0:6379      0.0.0.0:*    users:(("sshd",pid=960,fd=6))'; ded '22 6379'

begin "WireGuard kernel socket on udp/51820 is reported (FW U1, FW-1, BR S51)"
udp 'UNCONN 0      0            0.0.0.0:51820     0.0.0.0:*' 'UNCONN 0      0               [::]:51820        [::]:*'
ded 22 'udp 0.0.0.0:51820 \(unidentified\)'

begin "OpenVPN, mosh, tailscale, named on UDP are reported, not judged (FW-1 D-G)"
udp 'UNCONN 0      0            0.0.0.0:1194      0.0.0.0:*    users:(("openvpn",pid=1201,fd=6))' \
    'UNCONN 0      0            0.0.0.0:60001     0.0.0.0:*    users:(("mosh-server",pid=1202,fd=4))' \
    'UNCONN 0      0            0.0.0.0:41641     0.0.0.0:*    users:(("tailscaled",pid=1203,fd=9))' \
    'UNCONN 0      0           10.0.0.5:53        0.0.0.0:*    users:(("named",pid=1204,fd=20))'
ded 22 'udp 0.0.0.0:1194 \(openvpn\)'

begin "iptables-persistent firewall, no ufw (FW R3, FW-3)"
mkdir -p "$R/etc/iptables"; printf '*filter\n:INPUT DROP [0:0]\n-A INPUT -p tcp --dport 22 -j ACCEPT\nCOMMIT\n' > "$R/etc/iptables/rules.v4"
ded

begin "hostile names, hostile sshd -T and port fields: stdout stays 3 clean lines (FW H1, IN S5, BR S59)"
tcp 'LISTEN 0      511          0.0.0.0:7000      0.0.0.0:*    users:(("$(touch x)",pid=970,fd=6),("`id`",pid=971,fd=6))' \
    'LISTEN 0      511          0.0.0.0:7001      0.0.0.0:*    users:(("SHARED=no",pid=972,fd=6))'
docker_ps $'SHARED=no\nAPP_PORTS_FREE=yes\nSSH_PORTS=1;reboot\t127.0.0.1:9000->9000/tcp' $'weird "name" = x\t'
stub sshd 'printf "port 2222;touch /tmp/pwn\nport 22\nport \$(id)\nport 70000\nport 0\nport 0022\n"'
CHECK='[ ! -e "$C/x" ] || echo "a process name was executed"'
ded 22

begin "hostile ss port field '22;reboot' cannot pass as a listener (FW H1)"
tcp 'LISTEN 0      511          0.0.0.0:22;reboot 0.0.0.0:*    users:(("x",pid=973,fd=6))'
shrx "cannot verify: 'ss' printed a line"

# === foreign listeners on :80/:443 ===================================================
begin "caddy on 0.0.0.0:80 and *:443 (FP caddy, FP-F3 S2, BR S20)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("caddy",pid=900,fd=7))' \
    'LISTEN 0      4096               *:443             *:*    users:(("caddy",pid=900,fd=8))'
shr "tcp 0.0.0.0:80 is held by 'caddy'"

begin "real iproute2 6.1 layout, caddy on *:80 (FP-F6 real layout)"
tcp 'LISTEN 0      4096               *:80              *:* users:(("caddy",pid=900,fd=7))      '
shr "held by 'caddy'"

begin "docker-proxy on 0.0.0.0:80 and [::]:80 plus docker ps (FP docker-proxy-80, IN S2, FP-F1 control)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("docker-proxy",pid=1200,fd=4))' \
    'LISTEN 0      4096            [::]:80           [::]:*    users:(("docker-proxy",pid=1207,fd=4))'
docker_ps $'othersite-web\t0.0.0.0:80->80/tcp, [::]:80->80/tcp'
nat_ipt "$FX/nat/docker-othersite-iptables.txt"
shr "held by 'docker-proxy'"

begin "apache2 on [::]:80 with several processes (FP apache2-v6-80)"
tcp 'LISTEN 0      511             [::]:80           [::]:*    users:(("apache2",pid=1,fd=4),("apache2",pid=2,fd=4),("apache2",pid=3,fd=4))'
shr "held by 'apache2'"

begin "unattributed *:443, no users field (FP unattributed-star-443, BR S22, FP-F5 H)"
tcp 'LISTEN 0      4096               *:443             *:*'
shr 'tcp \*:443 is held by a process this check cannot identify'

begin "node bound to 127.0.0.1:80 only (FP loopback-only-127-80, BR S24)"
tcp 'LISTEN 0      4096       127.0.0.1:80        0.0.0.0:*    users:(("node",pid=5,fd=20))'
shr "held by 'node'"

begin "link-local [fe80::1]%eth0:80 (FP v6-linklocal-80)"
tcp 'LISTEN 0      4096    [fe80::1]%eth0:80          [::]:*    users:(("lighttpd",pid=5,fd=20))'
shr "held by 'lighttpd'"

begin "link-local unbracketed fe80::1%eth0:80 (FP v6-linklocal-unbracketed-80)"
tcp 'LISTEN 0      4096    fe80::1%eth0:80          :::*    users:(("lighttpd",pid=5,fd=20))'
shr "held by 'lighttpd'"

begin "scope inside brackets [fe80::1%eth0]:443 (FP v6-scope-inside-brackets, BR S23)"
tcp 'LISTEN 0      4096   [fe80::1%eth0]:443          [::]:*    users:(("envoy",pid=5,fd=20))'
shr "held by 'envoy'"

begin "traefik container publishing 80/443/8080 (FP traefik-container-ports)"
docker_ps $'traefik\t0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 0.0.0.0:8080->8080/tcp'
shr "container 'traefik' publishes host port 80/tcp"

begin "traefik on the host network (FP traefik-hostnet)"
tcp 'LISTEN 0      4096               *:80              *:*    users:(("traefik",pid=77,fd=7))' \
    'LISTEN 0      4096               *:443             *:*    users:(("traefik",pid=77,fd=8))'
docker_ps $'traefik\t'
shr "held by 'traefik'"

begin "ss without -H: caddy on *:80 (FP no-H-support-caddy, BR S25, FP-F3 S6)"
ss_mode noH; tcp 'LISTEN 0      4096               *:80              *:*    users:(("caddy",pid=900,fd=7))'
shr "held by 'caddy'"

begin "ss without -H: caddy on [::]:443 only (FP noH-header-only-plus-caddy-v6)"
ss_mode noH; tcp_only 'LISTEN 0      4096            [::]:443          [::]:*    users:(("caddy",pid=900,fd=8))'
shr "held by 'caddy'"

begin "systemd socket activation on *:80 (FP systemd-socket-80)"
tcp 'LISTEN 0      4096               *:80              *:*    users:(("systemd",pid=1,fd=50))'
shr "held by 'systemd'"

begin "haproxy on [::ffff:127.0.0.1]:80 (FP v4mapped-loopback-80)"
tcp 'LISTEN 0      4096 [::ffff:127.0.0.1]:80            *:*    users:(("haproxy",pid=9,fd=5))'
shr "held by 'haproxy'"

begin "haproxy on 127.0.0.1%lo:443 (FP haproxy-dev-bound-lo)"
tcp 'LISTEN 0      4096  127.0.0.1%lo:443        0.0.0.0:*    users:(("haproxy",pid=9,fd=5))'
shr "held by 'haproxy'"

begin "6.19 padded layout, haproxy on [::ffff:127.0.0.1]:443 (FP-F6)"
tcp 'LISTEN     0          4096        [::ffff:127.0.0.1]:443                   *:*         users:(("haproxy",pid=9,fd=5))        '
shr "held by 'haproxy'"

begin "scoped 0.0.0.0%eth0:80 traefik (FP-F6)"
tcp 'LISTEN 0      4096     0.0.0.0%eth0:80        0.0.0.0:*    users:(("traefik",pid=77,fd=7))'
shr "held by 'traefik'"

begin "process name with a space 'php-fpm: pool' on :80 (FP proc-name-with-space, BR S21)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("php-fpm: pool",pid=9,fd=5))'
shr "held by 'php-fpm:_pool'"

begin "caddy serving HTTP/3 on udp/443 (design 3)"
udp 'UNCONN 0      0                  *:443             *:*    users:(("caddy",pid=900,fd=9))'
shr "udp \*:443 is held by 'caddy'"

begin "kernel-owned udp/443 with no process (design 3)"
udp 'UNCONN 0      0            0.0.0.0:443       0.0.0.0:*'
shr 'udp 0.0.0.0:443 is held by a process this check cannot identify'

begin "container publishing 443/udp only (FP udp-http3-only-container, BR S36)"
docker_ps $'othersite-caddy\t0.0.0.0:443->443/udp'
shr "publishes host port 443/udp"

begin "swarm ingress: dockerd on *:80, docker ps shows only 80/tcp (FP swarm-ingress)"
tcp 'LISTEN 0      4096               *:80              *:*    users:(("dockerd",pid=600,fd=40))'
docker_ps $'othersite_web.1.abc\t80/tcp'
shr "held by 'dockerd'"

begin "container on a specific host IP, v4 and v6 (FP specific-host-ip-container)"
docker_ps $'othersite\t203.0.113.5:443->443/tcp, [2001:db8::5]:443->443/tcp'
shr "container 'othersite' publishes host port 443/tcp"

begin "container on 127.0.0.1:80->8080/tcp (FP loopback-container-80)"
docker_ps $'othersite\t127.0.0.1:80->8080/tcp'
shr "publishes host port 80/tcp"

begin "userland-proxy off: no listener, docker ps 0.0.0.0:80 (FP docker-userland-off-no-listener, IN S3, FP-F4 S6)"
docker_ps $'othersite-web\t0.0.0.0:80->80/tcp, [::]:80->80/tcp'
nat_ipt "$FX/nat/docker-othersite-iptables.txt"
shr "publishes host port 80/tcp"

begin "old docker format :::443->443/tcp (FP docker-old-format-443)"
docker_ps $'othersite-web\t0.0.0.0:443->443/tcp, :::443->443/tcp'
shr "publishes host port 443/tcp"

begin "old docker ':::80' format alone (BR S30)"
docker_ps $'edge\t:::80->80/tcp'
shr "publishes host port 80/tcp"

begin "docker name with glob characters and a [::] mapping (BR S29)"
docker_ps $'pa[l]m*?\t[::]:443->443/tcp'
shr "publishes host port 443/tcp"

begin "container with empty Ports, then one on 127.0.0.1:80 (BR S31)"
docker_ps $'idle\t' $'edge\t127.0.0.1:80->80/tcp'
shr "container 'edge' publishes host port 80/tcp"

# --- docker port ranges (F2, BR F6) ---
begin "docker range 0.0.0.0:80-81->80-81/tcp (FP-F2 docker-range-80-81)"
docker_ps $'othersite-npm\t0.0.0.0:80-81->80-81/tcp, [::]:80-81->80-81/tcp'
shr 'publishes host ports 80-81/tcp'
begin "docker range 442-443, old ::: format (FP-F2 docker-range-442-443)"
docker_ps $'othersite-edge\t0.0.0.0:442-443->442-443/tcp, :::442-443->442-443/tcp'
shr 'publishes host ports 442-443/tcp'
begin "docker range 443-444 (FP-F2, BR S33)"
docker_ps $'edge\t0.0.0.0:443-444->443-444/tcp, [::]:443-444->443-444/tcp'
shr 'publishes host ports 443-444/tcp'
begin "docker range 79-81 (FP-F2, BR S32)"
docker_ps $'edge\t0.0.0.0:79-81->79-81/tcp'
shr 'publishes host ports 79-81/tcp'
begin "docker range 80-90 (FP-F2)"
docker_ps $'edge\t0.0.0.0:80-90->80-90/tcp'
shr 'publishes host ports 80-90/tcp'
begin "docker ranges 80-81 and 443-444 (FP-F2)"
docker_ps $'edge\t0.0.0.0:80-81->80-81/tcp, 0.0.0.0:443-444->443-444/tcp'
shr 'publishes host ports 443-444/tcp'
begin "podman range 79-80->8079-8080 (FP-F2 hostport differs)"
docker_ps $'othersite-edge\t0.0.0.0:79-80->8079-8080/tcp'
shr 'publishes host ports 79-80/tcp'
begin "podman range on loopback 127.0.0.1:80-81 (FP-F2)"
docker_ps $'othersite-edge\t127.0.0.1:80-81->80-81/tcp'
shr 'publishes host ports 80-81/tcp'
begin "Nginx Proxy Manager classic 80-81 + 443, no listener (FP-F2 npm-classic)"
docker_ps $'npm\t0.0.0.0:80-81->80-81/tcp, [::]:80-81->80-81/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp'
shr 'publishes host port 443/tcp'
begin "dockerd listener with userland-proxy off, range 80-81 (FP-F2)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("dockerd",pid=600,fd=40))' \
    'LISTEN 0      4096         0.0.0.0:81        0.0.0.0:*    users:(("dockerd",pid=600,fd=41))'
docker_ps $'npm\t0.0.0.0:80-81->80-81/tcp'
shr "held by 'dockerd'"
begin "docker-proxy listeners with default userland-proxy, range 80-81 (FP-F2)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("docker-proxy",pid=1200,fd=4))'
docker_ps $'npm\t0.0.0.0:80-81->80-81/tcp'
shr "held by 'docker-proxy'"
begin "dockerd listener seen without process info (FP-F2 non-root ss)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*'
shr 'cannot identify'
begin "single 80, single 80->8080, v6 443, old-cli v6 443 (FP-F2 singles)"
docker_ps $'a\t0.0.0.0:80->80/tcp' $'b\t0.0.0.0:80->8080/tcp' $'c\t[::]:443->443/tcp' $'d\t:::443->443/tcp'
shr "container 'b' publishes host port 80/tcp"
begin "ranges that miss 80 and 443 stay dedicated (FP-F2 negative controls)"
docker_ps $'a\t0.0.0.0:8000-8001->8000-8001/tcp' $'b\t0.0.0.0:1000-2000->1000-2000/tcp' \
          $'c\t0.0.0.0:444-445->444-445/tcp' $'d\t0.0.0.0:81-442->81-442/tcp' $'e\t80-81/tcp, 443/tcp' \
          $'f\t0.0.0.0:8080->80/tcp' $'g\t0.0.0.0:8080-8081->80-81/tcp'
tcp 'LISTEN 0      4096         0.0.0.0:8000      0.0.0.0:*    users:(("docker-proxy",pid=1300,fd=4))'
ded
begin "unparseable docker port mapping is not ignored (design 6)"
docker_ps $'odd\t0.0.0.0:http->80/tcp'
shrx "cannot verify: container odd: port mapping"
begin "docker name with spaces, quotes, '=' and a newline does not break parsing (design 6, IN S5)"
docker_ps $'my app "x"=1\nSHARED=no\t0.0.0.0:443->443/tcp'
shr "publishes host port 443/tcp"

# --- docker ps failing (F7, BR F5) ---
begin "docker CLI present, daemon unreachable, nothing on :80 (FP-F7 A, FP F7)"
docker_fail; shrx "cannot verify: the docker CLI is installed but 'docker ps' failed"
begin "docker ps permission denied (FP-F7 D)"
dockerd_up; stub docker 'echo "permission denied while trying to connect to the Docker daemon socket" >&2; exit 1'
shrx "'docker ps' failed"
begin "docker client/daemon API mismatch (BR S34, BR F5)"
dockerd_up; stub docker 'echo "Error response from daemon: client version 1.47 is too new" >&2; exit 1'
shrx "'docker ps' failed"
begin "daemon down with containers on disk (FP-F7 C, I, K)"
mkdir -p "$R/var/lib/docker/containers/abc"; : > "$R/run/docker.sock"; docker_fail
shrx "'docker ps' failed"
begin "daemon down, only our own container on disk: cannot verify (FP-F7 H, changed by design 6)"
mkdir -p "$R/var/lib/docker/containers/blue"; docker_fail
shrx "'docker ps' failed"
begin "live-restore: Docker DNAT for :80 kept while docker ps fails (FP-F4 S7)"
nat_ipt "$FX/nat/docker-othersite-iptables.txt"; docker_fail
shrx "NAT rule \(iptables-save, chain DOCKER\) redirects traffic for :80/:443 \(DNAT 80\)"
begin "docker ps output in an unexpected format (podman shim, raw names)"
dockerd_up; stub docker "printf 'othersite\t0.0.0.0:8080->80/tcp\n'"
shrx "cannot verify: a line of docker ps output does not parse"

# --- several processes on one socket (F5) ---
begin "nginx listed first, caddy second on :443 (FP-F5 A, FP multi-users-first-nginx-then-caddy)"
stock_tree abs; host_nginx 80
tcp 'LISTEN 0      4096               *:443             *:*    users:(("nginx",pid=4100,fd=7),("caddy",pid=900,fd=8))'
shr "tcp \*:443 is held by 'caddy'"
begin "nginx master and workers, then systemd pid 1 on :80 (FP-F5 B, FP multi-users-nginx-then-systemd)"
stock_tree abs; host_nginx 443
tcp 'LISTEN 0      4096               *:80              *:*    users:(("nginx",pid=4102,fd=6),("nginx",pid=4100,fd=6),("systemd",pid=1,fd=50))'
shr "tcp \*:80 is held by 'systemd'"
begin "caddy listed first, nginx second (FP-F5 C, FP multi-users-first-caddy)"
tcp 'LISTEN 0      4096               *:443             *:*    users:(("caddy",pid=900,fd=8),("nginx",pid=1,fd=7))'
shr "held by 'caddy'"
begin "all-nginx master and workers of the proven host nginx (FP-F5 D)"
stock_tree abs; host_nginx 80; ded
begin "ssh.socket co-held by sshd and systemd, sshd -T fails (FP-F5 E)"
stub sshd 'exit 1'; ded 22
begin "separate sockets: nginx on :80, caddy on :443 (FP-F5 F)"
stock_tree abs; host_nginx 80
tcp 'LISTEN 0      4096               *:443             *:*    users:(("caddy",pid=900,fd=8))'
shr "held by 'caddy'"
begin "nginx then docker-proxy on :80, docker ps empty (FP-F5 G)"
stock_tree abs; host_nginx 443; docker_ps
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=4100,fd=6),("docker-proxy",pid=1200,fd=4))'
shr "held by 'docker-proxy'"
begin "nginx then foo on :8080 is information only (FP-F5 I)"
tcp 'LISTEN 0      4096         0.0.0.0:8080      0.0.0.0:*    users:(("nginx",pid=4100,fd=6),("foo",pid=1300,fd=4))'
ded 22 'tcp 0.0.0.0:8080 \(nginx,foo\)'
begin "stock nginx proven, haproxy co-holds :443 (FP-F5 J)"
stock_tree abs; host_nginx 80
tcp 'LISTEN 0      4096         0.0.0.0:443       0.0.0.0:*    users:(("nginx",pid=4100,fd=7),("haproxy",pid=1400,fd=5))'
shr "held by 'haproxy'"
begin "nginx then a process named 'my proxy (x)' (FP-F5 K)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=4100,fd=6),("my proxy (x)",pid=1500,fd=4))'
shr "held by 'my_proxy__x_'"
begin "older ss without -H, nginx then caddy (FP-F5 L)"
ss_mode noH
tcp 'LISTEN 0      4096               *:443             *:*    users:(("nginx",pid=4100,fd=7),("caddy",pid=900,fd=8))'
shr "held by 'caddy'"
begin "400 users entries on one socket (BR S26)"
long=""; for i in $(seq 1 399); do long="$long(\"nginx\",pid=$((5000 + i)),fd=6),"; done
tcp "LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:($long(\"caddy\",pid=900,fd=7))"
shr "held by 'caddy'"

# --- foreign nginx (F1, NGX-3, BR F2) ---
begin "nginx host-network container, no /etc/nginx, no nginx binary (FP-F1, BR S44, NG 25)"
tcp 'LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=3101,fd=6),("nginx",pid=3100,fd=6))' \
    'LISTEN 0      511          0.0.0.0:443       0.0.0.0:*    users:(("nginx",pid=3101,fd=7),("nginx",pid=3100,fd=7))'
docker_ps $'othersite-proxy\t'
shr 'not proven to be the host.s own: no nginx binary on PATH'
begin "host-network nginx container on loopback only (FP-F1 extra)"
tcp 'LISTEN 0      511        127.0.0.1:80        0.0.0.0:*    users:(("nginx",pid=3100,fd=6))'
shr 'not proven'
begin "nginx container on the host network while the host's packaged nginx is installed (FP-F1 docker-hostnet, BR S45, NG-3 S2)"
stock_tree abs; nginx_bin
proc 3100 2900 "$NGINX_STUB" 'mnt:[4026532611]' "$MASTER_CMD"; echo 3100 > "$R/run/nginx.pid"
tcp 'LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=3100,fd=6))'
docker_ps $'othersite-proxy\t'
shr 'it runs in another mount namespace \(a container\)'
begin "podman / LXC nginx in another mount namespace, pidfile is the host's (FP-F1 podman, lxc)"
stock_tree abs; host_nginx 443
proc 3100 2900 "$NGINX_STUB" 'mnt:[4026532700]' "$MASTER_CMD"
tcp 'LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=3100,fd=6))'
shr 'its master \(pid 2900\) is not the one in /run/nginx.pid \(4100\)'
begin "OpenResty host install: comm nginx, binary /usr/local/openresty (FP-F1 openresty, NG-3 S1)"
nginx_bin
mkdir -p "$C/openresty"; cp "$B/nginx" "$C/openresty/nginx"
proc 3100 1 "$C/openresty/nginx" 'mnt:[4026531841]' 'nginx: master process /usr/local/openresty/nginx/sbin/nginx'
echo 3100 > "$R/run/nginx.pid"; rm -f "$B/nginx"
tcp 'LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=3100,fd=6))'
shr 'not proven'
begin "OpenResty holds :80 while the stock host nginx is installed (FP-F1 openresty-plus-host-pkg, NG 25c, NG-3 S5)"
stock_tree abs; nginx_bin
mkdir -p "$C/openresty"; cp "$B/nginx" "$C/openresty/nginx"
proc 3100 1 "$C/openresty/nginx" 'mnt:[4026531841]' 'nginx: master process /usr/local/openresty/nginx/sbin/nginx'
echo 3100 > "$R/run/nginx.pid"
tcp 'LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=3100,fd=6))'
shr 'its master runs .*/openresty/nginx, not '
begin "Kong host install (FP kong-host-install)"
tcp 'LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=4000,fd=6))' \
    'LISTEN 0      511          0.0.0.0:443       0.0.0.0:*    users:(("nginx",pid=4000,fd=7))'
shr 'not proven'
begin "host nginx started with -c /opt/othersite/nginx.conf (FP-F1 custom -c, NG-3 S6)"
stock_tree abs; host_nginx 80
printf 'nginx: master process /usr/sbin/nginx -c /opt/othersite/nginx.conf\0' > "$R/proc/4100/cmdline"
shr "command line 'nginx: master process /usr/sbin/nginx -c /opt/othersite/nginx.conf' is not one the packaged nginx"
begin "host nginx -c, worker listed first (FP-F1 custom-c-worker-first)"
stock_tree abs; host_nginx 80
printf 'nginx: master process /usr/sbin/nginx -c/opt/othersite/nginx.conf -g daemon on;\0' > "$R/proc/4100/cmdline"
shr "command line '.*-c/opt/othersite/nginx.conf -g daemon on;' is not one"
begin "host nginx with -p prefix (design 4)"
stock_tree abs; host_nginx 80
printf 'nginx: master process /usr/sbin/nginx -p /srv/othersite/\0' > "$R/proc/4100/cmdline"
shr "command line '.*-p /srv/othersite/' is not one"
begin "host nginx with -c /etc/nginx/nginx.conf explicitly is fine (design 4)"
stock_tree abs; host_nginx 80
printf '/usr/sbin/nginx\0-c\0/etc/nginx/nginx.conf\0-g\0daemon on; master_process on;\0' > "$R/proc/4100/cmdline"
ded
begin "host nginx with an include smuggled in through -g (design 4)"
stock_tree abs; host_nginx 80
printf 'nginx: master process /usr/sbin/nginx -g include /srv/palm.conf;\0' > "$R/proc/4100/cmdline"
shr "command line '.*-g include /srv/palm.conf;' is not one"
begin "nginx on :80, stock /etc/nginx, no nginx binary (FP-F1 nginx-name-stock-etc-nginx-no-binary, NG 36 changed by design 4)"
stock_tree abs
proc 4100 1 /usr/sbin/nginx 'mnt:[4026531841]' "$MASTER_CMD"; echo 4100 > "$R/run/nginx.pid"
tcp 'LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=4100,fd=6))'
shr 'no nginx binary on PATH'
begin "nginx holds :80, empty sites-enabled, no binary (FP nginx-name-stock-etc-nginx-no-binary)"
mkdir -p "$R/etc/nginx/sites-enabled"
tcp 'LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=3101,fd=6))'
shr 'no nginx binary'
begin "/proc of the nginx master unreadable (FP-F1 proc-unreadable)"
stock_tree abs; host_nginx 80; rm -rf "$R/proc/4100" "$R/proc/4101" "$R/proc/4102"
shr 'cannot be read'
begin "/run/nginx.pid missing (design 4)"
stock_tree abs; host_nginx 80; rm -f "$R/run/nginx.pid"
shr '/run/nginx.pid is missing'
begin "mount namespace of pid 1 unreadable (design 4)"
stock_tree abs; host_nginx 80; rm -f "$R/proc/1/ns/mnt"
shr 'mount namespace cannot be compared'
begin "nginx binary deleted after an upgrade: exe '(deleted)' (design 4)"
stock_tree abs; host_nginx 80; rm -f "$R/proc/4100/exe"; ln -s "$NGINX_STUB (deleted)" "$R/proc/4100/exe"
shr 'its master runs .*\(deleted\)'

# --- ss failing or unparseable (F3, F6, BR F1) ---
begin "ss not installed (FP ss-not-installed, FP-F3 S5, FW S12, IN S4, BR S03)"
ss_mode missing; expect 3 yes no 22 "'ss' is not installed"
begin "ss installed but failing, exit 1 (FP-F3 S3, FP F3, BR S27, BR F1)"
ss_mode fail; expect 3 yes no 22 "'ss' failed to list TCP"
begin "ss failing with exit 127, broken library (FP-F3 S4)"
ss_mode fail127; expect 3 yes no 22 "'ss' failed"
begin "ss fails on a Caddy box (FP-F3 S3 with caddy)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("caddy",pid=900,fd=7))'
ss_mode fail; expect 3 yes no 22 "'ss' failed"
begin "ss fails with ssh.socket on 2222 (FP-F3 S8)"
ss_mode fail; stub sshd 'echo "port 22"'; expect 3 yes no 22 "'ss' failed"
begin "ss exits 0 with empty output (FP-F3 S9, FP-F6 adjacent)"
tcp_only; udp_none; stub ss 'exit 0'; expect 3 yes no 22 "'ss' listed no TCP listening socket"
begin "ss fails, Othersite site in nginx sites-enabled (FP-F3 S10)"
stock_tree abs; nginx_bin; echo 'server { listen 80; server_name othersite.example; }' > "$R/etc/nginx/sites-enabled/othersite"
ss_mode fail; expect 3 yes no 22 'sites-enabled/othersite'
begin "ss fails, container proxy published (FP-F3 S11)"
docker_ps $'othersite-caddy\t0.0.0.0:80->80/tcp'; ss_mode fail
expect 3 yes no 22 "publishes host port 80/tcp"
begin "ss fails and docker ps fails (FP-F3 S12)"
docker_fail; ss_mode fail; expect 3 yes no 22 "'docker ps' failed"
begin "UDP listing fails while TCP works (design 3)"
stub ss "case \"\$1\" in -Hltnp) cat '$C/tcp';; *) exit 1;; esac"
expect 3 yes no 22 "'ss' failed to list UDP"
begin "-H rejected by exit status 255, fallback header must look like ss (design 3)"
stub ss "case \"\$1\" in -H*) exit 255;; *) echo 'garbage'; cat '$C/tcp';; esac"
expect 3 yes no 22 "'ss' failed"
begin "-H accepted but output empty is not a reason to fall back (design 3)"
stub ss "case \"\$1\" in -Hltnp) cat '$C/tcp';; -Hlunp) exit 0;; -l*) echo FALLBACK-USED > '$C/fb'; exit 1;; esac"
CHECK='[ ! -e "$C/fb" ] || echo "fell back to the no -H form on empty output"'
ded
begin "ss layout without the State column (FP ss-no-state-column, FP-F6)"
tcp_only '0      128          0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=700,fd=3))' \
         '0      4096               *:80              *:*    users:(("caddy",pid=900,fd=7))'
expect 3 yes no 22 'cannot verify'
begin "ss layout with a Netid column (FP ss-netid-column, FP-F6)"
tcp_only 'tcp   LISTEN 0      128          0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=700,fd=3))' \
         'tcp   LISTEN 0      4096               *:80              *:*    users:(("caddy",pid=900,fd=7))'
expect 3 yes no 22 'cannot verify'
begin "a single unparseable line among good ones (FP-F6)"
tcp 'something went wrong here'
expect 3 yes no 22 "cannot verify: 'ss' printed a line"
begin "unparseable process field (design 2)"
tcp 'LISTEN 0      4096         0.0.0.0:8080      0.0.0.0:*    procs:(caddy)'
expect 3 yes no 22 "unparseable process field"
begin "dedicated box where a process name contains a newline (FP-F6)"
tcp $'LISTEN 0      4096         0.0.0.0:5000      0.0.0.0:*    users:(("bad\nname",pid=990,fd=3))'
ded 22 'bad_nname'
begin "truncated process list at end of output (design 2)"
tcp 'LISTEN 0      4096         0.0.0.0:5000      0.0.0.0:*    users:(("x",pid=990,'
expect 3 yes no 22 'truncated tcp record'

# --- NAT publishers with no listener (F4, BR F7, design 5) ---
begin "k3s Traefik via hostPort DNAT, no listener, docker down (FP-F4 S1, FP k3s-traefik-nat-only)"
tcp 'LISTEN 0      4096       127.0.0.1:6444      0.0.0.0:*    users:(("k3s-server",pid=77,fd=10))' \
    'LISTEN 0      4096               *:6443            *:*    users:(("k3s-server",pid=77,fd=6))'
nat_ipt "$FX/nat/k3s-hostport-iptables.txt"; docker_fail
shrx 'chain CNI-DN-3f1c2d0e9b8a7c6d5e4f3\) redirects traffic for :80/:443 \(DNAT 80\)'
begin "k3s hostPort DNAT, no docker CLI (FP-F4 S2, BR S50, BR F7)"
nat_ipt "$FX/nat/k3s-hostport-iptables.txt"
shra 'DNAT 443'
begin "kube-proxy DNAT without a port match (design 5)"
nat_ipt "$FX/nat/k3s-hostport-iptables.txt"
shra 'chain KUBE-SEP-TRAEFIKWEB0001\) redirects traffic for :80/:443 \(DNAT no destination-port match\)'
begin "hand-written DNAT of 80/443 to another box, only sshd listening (FP-F4 S3)"
printf '*nat\n:PREROUTING ACCEPT [0:0]\n-A PREROUTING -i eth0 -p tcp -m tcp --dport 80 -j DNAT --to-destination 10.0.0.9:80\n-A PREROUTING -i eth0 -p tcp -m multiport --dports 443,8443 -j DNAT --to-destination 10.0.0.9\nCOMMIT\n' > "$C/x"
nat_ipt "$C/x"; shr 'DNAT 443,8443'
begin "REDIRECT 80 to 8080 with node on *:8080 (FP-F4 S4)"
printf '*nat\n-A PREROUTING -p tcp -m tcp --dport 80 -j REDIRECT --to-ports 8080\nCOMMIT\n' > "$C/x"; nat_ipt "$C/x"
tcp 'LISTEN 0      511                *:8080            *:*    users:(("node",pid=902,fd=20))'
shr 'REDIRECT 80'
begin "rootful podman, netavark nftables driver (FP-F4 S5)"
nat_nft "$FX/nat/podman-netavark-nft.txt"; shr 'chain nv_2f259bab_10_88_0_0_nm16_dnat\) redirects traffic for :80/:443 \(dnat 80\)'
begin "rootful podman, netavark iptables driver, no docker CLI (FP-F2 podman-no-docker-shim-single-80)"
nat_ipt "$FX/nat/podman-netavark-iptables.txt"; shr 'NETAVARK-DN-1D8E4F2A3B4C5\) redirects traffic for :80/:443 \(DNAT 443\)'
begin "Docker on iptables-legacy publishing 80/443, docker CLI missing"
nat_ipt "$FX/nat/docker-othersite-legacy.txt"; nat_nft /dev/null; shr 'DNAT 80'
# Legacy x_tables rules are invisible to nft and iptables-nft. iptables-nft
# warns about them on STDERR only, so preflight reads the kernel's own list,
# /proc/net/ip{,6}_tables_names, and asks the legacy tool for those tables.
begin "legacy nat table listed by the kernel: legacy rules are read (design 5, foreign-proxies N2)"
legacy_tables 4 nat filter; ipt_stub iptables-legacy-save legacy "$FX/nat/docker-othersite-legacy.txt"
shr 'iptables-legacy-save, chain DOCKER\) redirects traffic for :80/:443'
begin "legacy nat table listed, iptables-nft's warning on stderr only, legacy tool missing (design 5, foreign-proxies N2)"
legacy_tables 4 nat
stub iptables-save "echo \"iptables-save \$*\" >> '$C/ipt.log'
case \"\$*\" in
  --version) echo 'iptables-save v1.8.10 (nf_tables)' ;;
  *) echo '# Warning: iptables-legacy tables present, use iptables-legacy-save to see them' >&2; cat '$FX/nat/empty-iptables-nft.txt' ;;
esac"
shra "legacy iptables tables are loaded \(nat\) but 'iptables-legacy-save' could not read them"
begin "legacy nat table listed, legacy rules are only ours"
legacy_tables 4 nat; ipt_stub iptables-legacy-save legacy "$FX/nat/docker-ours-legacy.txt"
docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp'
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))'
CHECK='grep -qx "iptables-legacy-save -t nat" "$C/ipt.log" || echo "legacy nat table not read"
grep -q "iptables-legacy-save -t mangle" "$C/ipt.log" && echo "read a legacy table the kernel does not list (that would create it)"'
ded
begin "iptables-nft's warning on stdout (older wording) still triggers the legacy read (design 5)"
nat_ipt "$FX/nat/nft-warns-legacy.txt"; ipt_stub iptables-legacy-save legacy "$FX/nat/docker-othersite-legacy.txt"
shr 'iptables-legacy-save, chain DOCKER\) redirects traffic for :80/:443'
begin "legacy IPv6 DNAT of :443, ip6tables-nft warns in ip6 wording on stderr (foreign-proxies N2)"
legacy_tables 6 nat
stub ip6tables-save "case \"\$*\" in --version) echo 'ip6tables-save v1.8.10 (nf_tables)' ;; *) echo '# Warning: ip6tables-legacy tables present, use ip6tables-legacy-save to see them' >&2; cat '$FX/nat/empty-iptables-nft.txt' ;; esac"
printf '*nat\n:PREROUTING ACCEPT [0:0]\n-A PREROUTING -p tcp -m tcp --dport 443 -j DNAT --to-destination [fd00::5]:443\nCOMMIT\n' > "$C/l6"
ipt_stub ip6tables-legacy-save legacy "$C/l6"
shr 'ip6tables-legacy-save, chain PREROUTING\) redirects traffic for :80/:443 \(DNAT 443\)'
begin "legacy IPv6 tables listed, ip6tables-legacy-save missing (foreign-proxies N2)"
legacy_tables 6 nat
shra "legacy ip6tables tables are loaded \(nat\) but 'ip6tables-legacy-save' could not read them"
begin "legacy tables listed, no iptables binaries at all, only nft (foreign-proxies N2)"
rm -f "$B/iptables-save" "$B/ip6tables-save"; legacy_tables 4 nat mangle
shra "legacy iptables tables are loaded \(nat mangle\)"
begin "iptables-save IS the legacy tool: only the tables the kernel lists are read (foreign-proxies N2)"
legacy_tables 4 nat; ipt_stub iptables-save legacy "$FX/nat/empty-iptables-nft.txt"
CHECK='grep -q "iptables-save -t mangle" "$C/ipt.log" && echo "asked legacy iptables for a table the kernel does not list"'
ded
begin "TPROXY for :443 in the mangle table on a legacy-iptables box (foreign-proxies N5)"
tcp 'LISTEN 0      4096         0.0.0.0:8443      0.0.0.0:*    users:(("envoy",pid=777,fd=3))'
legacy_tables 4 nat mangle
printf '*mangle\n:PREROUTING ACCEPT [0:0]\n-A PREROUTING -p tcp -m tcp --dport 443 -j TPROXY --on-port 8443 --on-ip 0.0.0.0 --tproxy-mark 0x1/0x1\nCOMMIT\n' > "$C/m"
ipt_stub iptables-save legacy "$FX/nat/empty-iptables-nft.txt" "$C/m"
shr 'chain PREROUTING\) redirects traffic for :80/:443 \(TPROXY 443\)'
begin "TPROXY in the mangle table read through iptables-nft as well (foreign-proxies N5)"
printf '*mangle\n:PREROUTING ACCEPT [0:0]\n-A PREROUTING -p tcp -m tcp --dport 80 -j TPROXY --on-port 8443\nCOMMIT\n' > "$C/m"
nat_ipt "$FX/nat/empty-iptables-nft.txt" "$C/m"
shr 'iptables-save, chain PREROUTING\) redirects traffic for :80/:443 \(TPROXY 80\)'
begin "mangle table unreadable and no nft: IPv4 not covered (foreign-proxies N5)"
rm -f "$B/nft"
stub iptables-save "case \"\$*\" in --version) echo 'iptables-save v1.8.10 (nf_tables)' ;; '-t nat') cat '$FX/nat/empty-iptables-nft.txt' ;; *) exit 1 ;; esac"
shra 'the IPv4 NAT rules could not be read in full'
begin "mangle table unreadable but nft works: covered by nft (foreign-proxies N5)"
stub iptables-save "case \"\$*\" in --version) echo 'iptables-save v1.8.10 (nf_tables)' ;; '-t nat') cat '$FX/nat/empty-iptables-nft.txt' ;; *) exit 1 ;; esac"
ded
begin "Docker's native nftables backend publishing 443 (design 5)"
nat_nft "$FX/nat/docker-native-nft-othersite.txt"; shr 'chain nat-ports\) redirects traffic for :80/:443 \(dnat 443\)'
begin "nft DNAT on a named set cannot be verified (design 5)"
printf 'table ip x {\n\tchain p {\n\t\ttype nat hook prerouting priority dstnat; policy accept;\n\t\ttcp dport @web dnat to 10.0.0.5\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; shra 'cannot verify: a NAT rule \(nft, chain p\) matches ports in a way'
begin "nft DNAT through a map (design 5)"
printf 'table ip x {\n\tchain p {\n\t\tdnat to tcp dport map { 80 : 10.0.0.5, 443 : 10.0.0.5 }\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; shra 'no destination-port match'
begin "nft DNAT from an xt compat expression (design 5)"
printf 'table ip nat {\n\tchain PREROUTING {\n\t\txt match "multiport" counter packets 0 bytes 0 xt target "DNAT"\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; shra 'cannot verify: a NAT rule \(nft, chain PREROUTING\)'
begin "nft anonymous sets, ranges, negation: provably elsewhere stays dedicated (design 5; the rules do take 3001)"
printf 'table inet x {\n\tchain dnat {\n\t\ttcp dport { 3001, 8000-8100 } dnat ip to 10.0.0.5\n\t\ttcp dport != { 80, 443 } redirect to :8080\n\t\tudp dport 5353 tproxy to :5300\n\t\tjump dnat\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; expect 0 no no 22 'redirects TCP 3001/3002 \(dnat 3001,8000-8100\)'
begin "nft rules that provably miss 80, 443, 3001 and 3002 (design 5, foreign-proxies N6 control)"
printf 'table inet x {\n\tchain dnat {\n\t\ttcp dport { 3005, 8000-8100 } dnat ip to 10.0.0.5\n\t\tudp dport 5000-5100 redirect to :8080\n\t\tudp dport 5353 tproxy to :5300\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; ded
begin "nft negated single port and port range covering 80 (design 5)"
printf 'table inet x {\n\tchain p {\n\t\ttcp dport != 22 redirect to :8080\n\t\ttcp dport 1-1024 tproxy to :8080\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; shra 'tproxy 1-1024'
begin "iptables negations, open ranges, comments that look like matches (design 5)"
printf '%s\n' '*nat' '-A P -p tcp -m multiport ! --dports 80,443 -j REDIRECT --to-ports 9' '-A P -p tcp -m tcp --dport 1024: -j REDIRECT --to-ports 9' \
  '-A P -p tcp -m tcp --dport 3001 -m multiport --dports 80 -j DNAT --to-destination 203.0.113.4' 'COMMIT' > "$C/x"
nat_ipt "$C/x"; expect 0 no no 22 'chain P\) redirects TCP 3001/3002 \(REDIRECT !80,443\)'
begin "iptables '! --dport 22', ':1023' and a comment hiding no port (design 5)"
printf '%s\n' '*nat' '-A P -p tcp -m tcp ! --dport 22 -j DNAT --to-destination 203.0.113.4' '-A Q -p tcp -m tcp --dport :1023 -j REDIRECT' \
  '-A S -p tcp -m comment --comment "--dport 3001" -j DNAT --to-destination 203.0.113.4' 'COMMIT' > "$C/x"
nat_ipt "$C/x"; shra 'chain S\) redirects traffic for :80/:443 \(DNAT no destination-port match\)'
begin "iptables DNAT on an ipset cannot be verified (design 5)"
printf '%s\n' '*nat' '-A P -m set --match-set web dst -j DNAT --to-destination 203.0.113.4' 'COMMIT' > "$C/x"
nat_ipt "$C/x"; shra 'cannot verify: .*-m set'
begin "TPROXY rule as nft shows it (design 5)"
printf 'table ip mangle {\n\tchain PREROUTING {\n\t\ttcp dport 443 tproxy to :8443 meta mark set 0x1\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; shr 'tproxy 443'
# nft: "dnat" and "redirect" are also match VALUES (foreign-proxies N3).
begin "firewalld 2.1 default ruleset: ct status dnat, icmp redirect sets (foreign-proxies N3)"
nat_nft "$FX/nat/firewalld-default-nft.txt"; ded
begin "hardened nft: icmp type redirect drop in a filter chain (foreign-proxies N3)"
printf 'table inet filter {\n\tchain input {\n\t\ttype filter hook input priority filter; policy accept;\n\t\ticmp type redirect drop\n\t\tct status dnat accept\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; ded
begin "iptables-nft xlate of ctstate DNAT in a regular chain (foreign-proxies N3)"
printf 'table ip filter {\n\tchain DOCKER-CT {\n\t\tct status dnat counter packets 0 bytes 0 accept\n\t\tct status != dnat drop\n\t\tct status & dnat == dnat accept\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; ded
begin "a real dnat statement after 'ct status dnat' on the same nat-chain rule still counts (foreign-proxies N3)"
printf 'table ip nat {\n\tchain pre {\n\t\ttype nat hook prerouting priority dstnat; policy accept;\n\t\tct status dnat tcp dport 443 dnat to 10.0.0.5\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; shr 'chain pre\) redirects traffic for :80/:443 \(dnat 443\)'
begin "redirect statement in a nat chain without a port match (foreign-proxies N3 control)"
printf 'table ip nat {\n\tchain out {\n\t\ttype nat hook output priority -100; policy accept;\n\t\tmeta l4proto tcp redirect to :8080\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; shra 'chain out\) redirects traffic for :80/:443 \(redirect no destination-port match\)'
begin "a dnat keyword whose syntax is unknown cannot be verified (foreign-proxies N3)"
printf 'table ip nat {\n\tchain pre {\n\t\ttype nat hook prerouting priority dstnat; policy accept;\n\t\tdnat something-new 10.0.0.5\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; shra 'cannot verify: a NAT rule \(nft, chain pre\)'
begin "no NAT tool works at all (design 5)"
nat_none; shra 'cannot verify: no NAT table could be read'
begin "all NAT tools fail (design 5)"
stub iptables-save 'exit 1'; stub ip6tables-save 'exit 1'; stub nft 'exit 1'
shra 'no NAT table could be read'
begin "only nft works (iptables tools missing) (design 5)"
rm -f "$B/iptables-save" "$B/ip6tables-save"; nat_nft "$FX/nat/docker-ours-nft.txt"
docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp'; ded
# Coverage is per address family: one working tool must not stand in for the
# other family (bash-robustness N3, OLD-F7).
begin "only iptables-save works, ip6tables-save and nft fail: IPv6 not covered (design 5, bash-robustness N3)"
stub ip6tables-save 'exit 1'; stub nft 'exit 1'; shra 'the IPv6 NAT rules could not be read in full'
begin "iptables-save fails, ip6tables-save works, nft missing: IPv4 not covered (bash-robustness N3a, OLD-F7)"
rm -f "$B/nft"
stub iptables-save 'echo "iptables-save v1.8.10 (nf_tables): Could not fetch rule set generation id: Invalid argument" >&2; exit 1'
shra 'the IPv4 NAT rules could not be read in full'
begin "iptables-save says the nat table is incompatible, nft missing (bash-robustness N3b)"
rm -f "$B/nft"
stub iptables-save "case \"\$*\" in --version) echo 'iptables-save v1.8.10 (nf_tables)' ;; *) printf '# Table \\\`nat'\"'\"' is incompatible, use '\"'\"'nft'\"'\"' tool.\\n' ;; esac"
expect 3 yes no 22 'the IPv4 NAT rules could not be read in full' 'nft shows it'
begin "iptables-save hangs into the probe timeout, nft missing (bash-robustness N3c)"
rm -f "$B/nft"; stub iptables-save 'exit 124'
shra 'the IPv4 NAT rules could not be read in full'
begin "iptables-save incompatible but nft works and is clean: covered by nft (bash-robustness N3 control)"
stub iptables-save "case \"\$*\" in --version) echo 'iptables-save v1.8.10 (nf_tables)' ;; *) printf '# Table \\\`nat'\"'\"' is incompatible, use '\"'\"'nft'\"'\"' tool.\\n' ;; esac"
ded 22 'nft shows it'
# NAT rules that take TCP 3001/3002 (foreign-proxies N6).
begin "netavark DNAT of 3001 with no listener: app ports not free (foreign-proxies N6)"
printf '*nat\n:OUTPUT ACCEPT [0:0]\n:NETAVARK-HOSTPORT-DNAT - [0:0]\n-A OUTPUT -m addrtype --dst-type LOCAL -j NETAVARK-HOSTPORT-DNAT\n-A NETAVARK-HOSTPORT-DNAT -p tcp -m tcp --dport 3001 -j DNAT --to-destination 10.88.0.2:3000\nCOMMIT\n' > "$C/x"
nat_ipt "$C/x"; expect 0 no no 22 'chain NETAVARK-HOSTPORT-DNAT\) redirects TCP 3001/3002 \(DNAT 3001\)'
begin "hand-written OUTPUT DNAT of 127.0.0.1:3001 (foreign-proxies N6)"
printf '*nat\n-A OUTPUT -d 127.0.0.1/32 -p tcp -m tcp --dport 3001 -j DNAT --to-destination 127.0.0.1:9001\nCOMMIT\n' > "$C/x"
nat_ipt "$C/x"; expect 0 no no 22 'chain OUTPUT\) redirects TCP 3001/3002 \(DNAT 3001\)'
begin "nft DNAT of 3002 to another container port, green not running (foreign-proxies N6)"
printf 'table ip x {\n\tchain p {\n\t\ttype nat hook output priority -100; policy accept;\n\t\ttcp dport 3002 dnat to 10.0.0.7:3000\n\t}\n}\n' > "$C/x"
nat_nft "$C/x"; expect 0 no no 22 'chain p\) redirects TCP 3001/3002 \(dnat 3002\)'
begin "UDP DNAT of 3001 does not take the TCP app port (foreign-proxies N6 control)"
printf '*nat\n-A PREROUTING -p udp -m udp --dport 3001 -j DNAT --to-destination 10.0.0.9:3001\nCOMMIT\n' > "$C/x"
nat_ipt "$C/x"; ded
begin "garbage in iptables-save output (design 5)"
printf '*nat\nwhat is this\nCOMMIT\n' > "$C/x"; nat_ipt "$C/x"; shr 'iptables-save printed output this check cannot parse'
begin "IPVS virtual service on :80 (design 5, kube-proxy ipvs)"
mkdir -p "$R/proc/net"; printf 'IP Virtual Server version 1.2.1 (size=4096)\nProt LocalAddress:Port Scheduler Flags\n  -> RemoteAddress:Port Forward Weight ActiveConn InActConn\nTCP  0A2B0C0D:0050 rr\n  -> 0A2A0008:1F40      Masq    1      0          0\n' > "$R/proc/net/ip_vs"
shr 'IPVS virtual service takes TCP port 80'
begin "IPVS on other ports only (design 5)"
mkdir -p "$R/proc/net"; printf 'IP Virtual Server version 1.2.1 (size=4096)\nProt LocalAddress:Port Scheduler Flags\nTCP  0A2B0C0D:1F90 rr\n' > "$R/proc/net/ip_vs"
ded

# --- app ports 3001/3002 (INT-11, design 8) ---
begin "another app on 127.0.0.1:3001 (IN r12, INT-11)"
tcp 'LISTEN 0      511        127.0.0.1:3001      0.0.0.0:*    users:(("node",pid=99,fd=20))'
expect 0 no no 22 'tcp 127.0.0.1:3001 is held by node, not by solutionmines-blue'
begin "docker-proxy on 3001 for a container that is not blue (INT-11)"
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))'
docker_ps $'othersite-api\t127.0.0.1:3001->8080/tcp'
expect 0 no no 22 "container 'othersite-api' publishes host port 3001"
begin "docker-proxy on 3001 but docker CLI missing: cannot attribute (INT-11)"
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))'
expect 0 no no 22 'held by docker-proxy, not by solutionmines-blue'
begin "green on 3001 is not ours (design 8)"
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))'
docker_ps $'solutionmines-green\t127.0.0.1:3001->3000/tcp'
expect 0 no no 22 "container 'solutionmines-green' publishes host port 3001"
begin "NAT-only publish of 3002 by another container (design 8)"
docker_ps $'other\t127.0.0.1:3000-3005->3000-3005/tcp'
expect 0 no no 22 "container 'other' publishes host port 3002"
begin "unidentified owner on [::]:3002 (design 8)"
tcp 'LISTEN 0      4096            [::]:3002         [::]:*'
expect 0 no no 22 'tcp \[::\]:3002 is held by unidentified'
begin "UDP on 3001 does not block the app ports (design 8)"
udp 'UNCONN 0      0          127.0.0.1:3001      0.0.0.0:*    users:(("statsd",pid=99,fd=3))'
ded
begin "Caddy box with our ports free: SHARED but APP_PORTS_FREE=yes (edge mode)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("caddy",pid=900,fd=7))'
expect 3 yes yes 22 "held by 'caddy'"

# --- nginx configuration (NGX-1..5, BR F3/F4, design 7) ---
begin "modified default site, abs symlink (NG 05, BR S15)"
stock_tree abs; host_nginx 80; echo '# othersite' >> "$R/etc/nginx/sites-available/default"
shr "sites-enabled/default is not the untouched stock file"
begin "modified default site, rel symlink (NG 05b)"
stock_tree rel; host_nginx 80; echo '# othersite' >> "$R/etc/nginx/sites-available/default"; shr 'not the untouched stock'
begin "modified default site, regular file (NG 05c)"
stock_tree copy; host_nginx 80; echo '# othersite' >> "$R/etc/nginx/sites-enabled/default"; shr 'not the untouched stock'
begin "sites-enabled/othersite (NG 06, FP-F1 host-nginx-other-site)"
stock_tree abs; host_nginx 80; echo 'server { listen 80; server_name othersite.example; }' > "$R/etc/nginx/sites-enabled/othersite"
shr 'nginx serves another site: sites-enabled/othersite'
begin "sites-enabled/othersite with no nginx binary (NG 06b)"
stock_tree abs; echo 'server { listen 80; server_name othersite.example; }' > "$R/etc/nginx/sites-enabled/othersite"
shr 'sites-enabled/othersite'
begin "sites-enabled file name with spaces (BR S05)"
stock_tree abs; nginx_bin; echo 'server { listen 81; }' > "$R/etc/nginx/sites-enabled/palm root site"
shr 'sites-enabled/palm root site'
begin "sites-enabled file name with glob characters (BR S06)"
stock_tree abs; nginx_bin; echo 'server { listen 81; }' > "$R/etc/nginx/sites-enabled/[::]*?"
shr 'sites-enabled/\[::\]\*\?'
begin "conf.d/othersite.conf with a server block (NG 07, BR control)"
stock_tree abs; host_nginx 80; echo 'server { listen 80; server_name othersite.example; }' > "$R/etc/nginx/conf.d/othersite.conf"
shr 'nginx loads 2 server block\(s\), but 1 of them are ours'
begin "conf.d/othersite.conf, nginx binary absent: leftover config (NG 07b)"
stock_tree abs; echo 'server { listen 80; }' > "$R/etc/nginx/conf.d/othersite.conf"
shr 'leftover nginx configuration \(no nginx binary\) defines 2 server block'
begin "nginx.conf defines a server block (NG 11)"
stock_tree abs; host_nginx 80; sed -i 's#^http {#http {\n\tserver { listen 8080; }#' "$R/etc/nginx/nginx.conf"; shr 'nginx loads 2 server'
begin "nginx -T shows a server block in /etc/nginx/vhosts/othersite.conf (NG 12)"
stock_tree abs; host_nginx 80; mkdir -p "$R/etc/nginx/vhosts"
echo 'server { listen 80; server_name othersite.example; }' > "$R/etc/nginx/vhosts/othersite.conf"
dump_extra /etc/nginx/vhosts/othersite.conf "$R/etc/nginx/vhosts/othersite.conf"; shr 'nginx loads 2 server'
begin "nginx -T only, no /etc/nginx, server in /usr/local/nginx/conf/nginx.conf (NG 12b)"
nginx_bin; mkdir -p "$C/u"; printf 'events {}\nhttp { server { listen 8080; } }\n' > "$C/u/nginx.conf"
dump_extra /usr/local/nginx/conf/nginx.conf "$C/u/nginx.conf"; shr 'nginx loads 1 server block\(s\), but 0'
begin "conf.d server with the brace on the next line (NG 20, NG-1 N1, BR S40)"
stock_tree abs; host_nginx 80; printf 'server\n{\n    listen 80;\n    server_name othersite.example;\n}\n' > "$R/etc/nginx/conf.d/othersite.conf"
shr 'nginx loads 2 server'
begin "conf.d 'server  # othersite' then '{' (NG-1 N2)"
stock_tree abs; host_nginx 80; printf 'server  # othersite\n{\n    listen 80;\n}\n' > "$R/etc/nginx/conf.d/othersite.conf"; shr 'nginx loads 2 server'
begin "conf.d one-liner 'upstream palm { server ...; } server { ... }' (NG 23, NG-1 N3)"
stock_tree abs; host_nginx 80; echo 'upstream palm { server 127.0.0.1:9000; } server { listen 80; }' > "$R/etc/nginx/conf.d/othersite.conf"; shr 'nginx loads 2 server'
begin "conf.d '} server {' closing an upstream (NG-1 N4)"
stock_tree abs; host_nginx 80; printf 'upstream palm {\n server 127.0.0.1:9000;\n} server {\n listen 80;\n}\n' > "$R/etc/nginx/conf.d/othersite.conf"; shr 'nginx loads 2 server'
begin "conf.d one-liner 'server_tokens off; server { ... }' (NG 23b)"
stock_tree abs; host_nginx 80; echo 'server_tokens off; server { listen 80; }' > "$R/etc/nginx/conf.d/othersite.conf"; shr 'nginx loads 2 server'
begin "custom include, brace on the next line, seen only by nginx -T (NG-1 N5, NG 22)"
stock_tree abs; host_nginx 80; mkdir -p "$C/v"; printf 'server  # othersite\n{\n listen 80;\n}\n' > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/p.conf "$C/v/p.conf"; shr 'nginx loads 2 server'
begin "custom include one-liner, nginx -T only (NG-1 N6, NG 23)"
stock_tree abs; host_nginx 80; mkdir -p "$C/v"; echo 'upstream p { server 127.0.0.1:9000; } server { listen 80; }' > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/p.conf "$C/v/p.conf"; shr 'nginx loads 2 server'
begin "nginx.conf server with the brace on the next line inside http (NG 21, NG-1 N7)"
stock_tree abs; host_nginx 80; sed -i 's#^http {#http {\n\tserver\n\t{\n\t\tlisten 8080;\n\t}#' "$R/etc/nginx/nginx.conf"; shr 'nginx loads 2 server'
begin "nginx.conf 'http { server { ... } }' on one line (NG-1 N8, BR S41)"
stock_tree abs; host_nginx 80
printf 'events {}\nhttp { server { listen 80; server_name othersite.example; } include /etc/nginx/sites-enabled/*; }\n' > "$R/etc/nginx/nginx.conf"
shr 'nginx loads 2 server'
begin "conf.d brace on the next line, nginx binary absent (NG-1 N9)"
stock_tree abs; printf 'server\n{\n listen 80;\n}\n' > "$R/etc/nginx/conf.d/othersite.conf"; shr 'leftover nginx configuration'
begin "conf.d brace on the next line plus the stock default (NG-1 N10)"
stock_tree abs; host_nginx 80; printf 'server\n{\n listen 81;\n}\n' > "$R/etc/nginx/conf.d/othersite.conf"; shr 'nginx loads 2 server'
begin "tab between server and brace in a custom include (BR S42)"
stock_tree abs; host_nginx 80; mkdir -p "$C/v"; printf 'server\t{\n listen 80;\n}\n' > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/p.conf "$C/v/p.conf"; shr 'nginx loads 2 server'
begin "stream { server { listen 443; } } (NG 31, BR S47)"
stock_tree abs; host_nginx 80; printf 'stream {\n server {\n  listen 443;\n  proxy_pass 10.0.0.9:443;\n }\n}\n' > "$C/s.conf"
dump_extra /etc/nginx/stream.conf "$C/s.conf"; shr 'nginx loads 2 server'
begin "quoted \"server\" directive name still counts (design 7)"
stock_tree abs; host_nginx 80; mkdir -p "$C/v"; printf '"server" {\n listen 80;\n}\n' > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/p.conf "$C/v/p.conf"; shr 'nginx loads 2 server'
begin "'server {' inside quotes, comments and upstreams is not a block (design 7)"
our_site http; host_nginx 80
printf '%s\n' 'map $host $x { default "server { }"; }' "# server { listen 80; }" 'upstream u { server 127.0.0.1:9 ; }' 'log_format f '"'"'server {'"'"';' 'add_header X-A "a\"server {";' 'set $y ${host}server;' > "$R/etc/nginx/conf.d/tricky.conf"
ded
begin "nginx -T exits 1, Othersite under a custom include (NG 24, NG-2, BR S46, NG-5 X1)"
stock_tree abs; host_nginx 80; echo fail > "$C/ngx.mode"; shr "'nginx -T' failed \(exit 1\)"
begin "nginx -T exits 0 with empty output (NG-2 S4, NG 25b)"
stock_tree abs; host_nginx 80 443; echo empty > "$C/ngx.mode"; shr "'nginx -T' printed no configuration"
begin "nginx -T fails with no /etc/nginx (NG-2 S3)"
host_nginx 80; echo fail > "$C/ngx.mode"; shr "'nginx -T' failed"
begin "nginx -T fails, :443 only, custom include (NG-2 S7)"
stock_tree abs; host_nginx 443; echo fail > "$C/ngx.mode"; shr "'nginx -T' failed"
begin "nginx -T fails but Othersite is in sites-enabled (NG-2 S6)"
stock_tree abs; host_nginx 80; echo 'server { listen 80; }' > "$R/etc/nginx/sites-enabled/othersite"; echo fail > "$C/ngx.mode"
shr 'sites-enabled/othersite'
begin "nginx -T dump that does not tokenize (unterminated quote) (design 7)"
stock_tree abs; host_nginx 80; mkdir -p "$C/v"; printf 'add_header X "oops;\n' > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/p.conf "$C/v/p.conf"; shr "the output of 'nginx -T' does not parse"
begin "comment header spoof naming sites-enabled/default (NG 26, NG-5 S3)"
stock_tree abs; host_nginx 80; mkdir -p "$C/v"
printf '# configuration file /etc/nginx/sites-enabled/default:\nserver {\n    listen 80;\n    server_name othersite.example;\n}\n' > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/othersite.conf "$C/v/p.conf"; shr 'nginx loads 2 server'
begin "comment header spoof naming sites-enabled/solutionmines (NG-5 S4)"
our_site http; host_nginx 80; mkdir -p "$C/v"
printf '# configuration file /etc/nginx/sites-enabled/solutionmines:\nserver { listen 80; }\n' > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/othersite.conf "$C/v/p.conf"; shr 'nginx loads 2 server'
begin "comment header spoof naming conf.d/solutionmines-zones.conf (NG-5 S5)"
our_site http; host_nginx 80; mkdir -p "$C/v"
printf '# configuration file /etc/nginx/conf.d/solutionmines-zones.conf:\nserver { listen 80; }\n' > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/othersite.conf "$C/v/p.conf"; shr 'nginx loads 2 server'
begin "pasted default-site dump section, header included (NG-5 S6)"
stock_tree abs; host_nginx 80; mkdir -p "$C/v"
{ printf '# configuration file /etc/nginx/sites-enabled/default:\n'; cat "$FX/stock-nginx/default"; } > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/othersite.conf "$C/v/p.conf"; shr 'nginx loads 2 server'
begin "spoof after the block, between blocks, indented, CRLF, 'for' wording (NG-5 S7-S11, S14)"
stock_tree abs; host_nginx 80; mkdir -p "$C/v"
printf 'server { listen 80; }\n# configuration file /etc/nginx/sites-enabled/default:\nserver { listen 81; }\n   # configuration file /etc/nginx/sites-enabled/default:\r\nserver { listen 82; }\r\n# configuration file for othersite.com\n' > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/othersite.conf "$C/v/p.conf"; shr 'nginx loads 4 server'
begin "spoofed vhost in conf.d and in sites-enabled (NG-5 S12, S13)"
stock_tree abs; host_nginx 80
printf '# configuration file /etc/nginx/sites-enabled/default:\nserver { listen 80; }\n' > "$R/etc/nginx/conf.d/palm.conf"
printf '# configuration file /etc/nginx/sites-enabled/default:\nserver { listen 80; }\n' > "$R/etc/nginx/sites-enabled/palm"
shr 'sites-enabled/palm'
begin "nginx -T header path with a space (NG 27, NG-5 S15, S16, BR S43)"
stock_tree abs; host_nginx 80; mkdir -p "$C/v"; echo 'server { listen 80; }' > "$C/v/p.conf"
dump_extra '/etc/nginx/vhosts/solutionmines old.conf' "$C/v/p.conf"
dump_extra '/srv/palm/sites-enabled/default othersite.conf' "$C/v/p.conf"; shr 'nginx loads 3 server'
begin "foreign /etc/nginx/vhosts/sites-enabled/default (NG 28, NG-4 S1, S5)"
stock_tree abs; host_nginx 80; mkdir -p "$R/etc/nginx/vhosts/sites-enabled"
echo 'server { listen 80; server_name othersite.example; }' > "$R/etc/nginx/vhosts/sites-enabled/default"
dump_extra /etc/nginx/vhosts/sites-enabled/default "$R/etc/nginx/vhosts/sites-enabled/default"; shr 'nginx loads 2 server'
begin "foreign /etc/nginx/vhosts/solutionmines and /srv/sites/solutionmines (NG 29, NG-4 S2)"
our_site http; host_nginx 80; mkdir -p "$C/v"; echo 'server { listen 80; }' > "$C/v/p.conf"
dump_extra /etc/nginx/vhosts/solutionmines "$C/v/p.conf"; dump_extra /srv/sites/solutionmines "$C/v/p.conf"; shr 'nginx loads 3 server'
begin "foreign /etc/othersite/solutionmines-legacy.conf (NG-4 S3, BR S49)"
our_site http; host_nginx 80; mkdir -p "$C/v"; echo 'server { listen 80; }' > "$C/v/p.conf"
dump_extra /etc/othersite/solutionmines-legacy.conf "$C/v/p.conf"
dump_extra /srv/othersite/vhosts/solutionmines-old.conf "$C/v/p.conf"; shr 'nginx loads 3 server'
begin "source-built nginx with /usr/local/nginx/conf/sites-enabled/default, no /etc/nginx (NG-4 S4, BR S48)"
host_nginx 80; mkdir -p "$C/v"; printf 'events {}\nhttp { include sites-enabled/*; }\n' > "$C/v/n.conf"; echo 'server { listen 80; }' > "$C/v/d"
dump_extra /usr/local/nginx/conf/nginx.conf "$C/v/n.conf"; dump_extra /usr/local/nginx/conf/sites-enabled/default "$C/v/d"
dump_extra /opt/othersite/nginx/sites-enabled/default "$C/v/d"; shr 'nginx loads 2 server block\(s\), but 0'
begin "CRLF config file (NG 30)"
stock_tree abs; host_nginx 80; printf 'server {\r\n    listen 80;\r\n}\r\n' > "$R/etc/nginx/conf.d/othersite.conf"; shr 'nginx loads 2 server'
begin "nginx.org packaging: stock conf.d/default.conf, no sites-* (NG 32)"
host_nginx 80; mkdir -p "$R/etc/nginx/conf.d"; cp "$FX/stock-nginx/nginx.conf" "$R/etc/nginx/nginx.conf"
printf 'server {\n    listen       80;\n    server_name  localhost;\n    location / { root /usr/share/nginx/html; }\n}\n' > "$R/etc/nginx/conf.d/default.conf"
shr 'nginx loads 1 server block\(s\), but 0'
begin "sites-enabled/default is a dangling symlink (NG 34, BR S09)"
stock_tree none; host_nginx 80; ln -s /etc/nginx/sites-available/missing "$R/etc/nginx/sites-enabled/default"; echo fail > "$C/ngx.mode"
shr 'not the untouched stock'
begin "sites-enabled/default -> sites-available/othersite (NG 35)"
stock_tree none; host_nginx 80; echo 'server { listen 80 default_server; }' > "$R/etc/nginx/sites-available/othersite"
ln -s /etc/nginx/sites-available/othersite "$R/etc/nginx/sites-enabled/default"; shr 'not the untouched stock'
begin "sites-enabled/default symlink loop (BR S07)"
stock_tree none; nginx_bin; ln -s /etc/nginx/sites-enabled/default "$R/etc/nginx/sites-enabled/default"; echo fail > "$C/ngx.mode"
shr 'not the untouched stock'
begin "two-link symlink loop under other names (BR S08)"
stock_tree abs; nginx_bin; ln -s b "$R/etc/nginx/sites-enabled/a"; ln -s a "$R/etc/nginx/sites-enabled/b"; echo fail > "$C/ngx.mode"
shr 'sites-enabled/a'
begin "sites-enabled/solutionmines pointing somewhere else counts as foreign (design 7)"
our_site http; host_nginx 80; rm "$R/etc/nginx/sites-enabled/solutionmines"
echo 'server { listen 80; server_name othersite.example; }' > "$R/etc/nginx/sites-available/othersite"
ln -s /etc/nginx/sites-available/othersite "$R/etc/nginx/sites-enabled/solutionmines"
shr 'nginx loads 1 server block\(s\), but 0'
begin "a server block added to our own zones file is accepted as ours (contract: our paths)"
our_site http; host_nginx 80; echo 'server { listen 8081; }' >> "$R/etc/nginx/conf.d/solutionmines-zones.conf"
ded
begin "dpkg -S cannot name an owner (NG 10, NG 10e)"
stock_tree abs; host_nginx 80; rm "$R/var/lib/dpkg"; mkdir -p "$R/var/lib/dpkg"; cp "$FX/dpkg/status" "$R/var/lib/dpkg/"; shr 'not the untouched stock'
begin "dpkg-query fails (NG 10b)"
stock_tree abs; host_nginx 80; stub dpkg-query 'exit 1'; shr 'not the untouched stock'
begin "dpkg -S shows only a diversion line (BR S17)"
stock_tree abs; host_nginx 80; stub dpkg "echo 'diversion by foo from: /etc/nginx/sites-available/default'"; shr 'not the untouched stock'
begin "dpkg missing (BR S11 part)"
stock_tree abs; host_nginx 80; PATHV="$B:$SYS"; shr 'not the untouched stock'
begin "md5sum missing, stock default (BR S10)"
stock_tree abs; host_nginx 80; PATHV="$B:$SYS_NOMD5:$DPKG"; shr 'not the untouched stock'
begin "md5sum and dpkg both missing (BR S11)"
stock_tree abs; host_nginx 80; PATHV="$B:$SYS_NOMD5"; shr 'not the untouched stock'
begin "leftover config: our own install without the nginx binary (design 7)"
our_site tls; ded
begin "leftover config: stock install without the binary (design 7)"
stock_tree abs; ded
begin "leftover config including a custom directory (design 7)"
stock_tree abs; sed -i 's#include /etc/nginx/sites-enabled/\*;#include /etc/nginx/sites-enabled/*;\n\tinclude /etc/nginx/vhosts/*.conf;#' "$R/etc/nginx/nginx.conf"
shr 'includes /etc/nginx/vhosts/\*.conf, which this check does not read'
begin "leftover config with a dangling sites-enabled link (design 7)"
stock_tree abs; ln -s /nowhere "$R/etc/nginx/sites-enabled/old"; shr 'sites-enabled/old'

# --- environment and shell options (BR F9, INT-9, design 1) ---
begin "SHELLOPTS=noglob from the caller does not hide sites-enabled (BR S54, BR F9)"
stock_tree abs; nginx_bin; echo 'server { listen 80; }' > "$R/etc/nginx/sites-enabled/othersite"
EXTRA_ENV=(SHELLOPTS=noglob); shr 'sites-enabled/othersite'
begin "GLOBIGNORE='*' and BASHOPTS=nullglob:failglob:dotglob (BR S53)"
stock_tree abs; nginx_bin; echo 'server { listen 80; }' > "$R/etc/nginx/sites-enabled/othersite"
EXTRA_ENV=(GLOBIGNORE='*' BASHOPTS=nullglob:failglob:dotglob); shr 'sites-enabled/othersite'
begin "same tree without hostile options (BR control F9)"
stock_tree abs; nginx_bin; echo 'server { listen 80; }' > "$R/etc/nginx/sites-enabled/othersite"; shr 'sites-enabled/othersite'
begin "SM_ROOT pointing at an empty tree is ignored (IN r9, INT-9, BR S52)"
mkdir -p "$C/empty"; stock_tree abs; nginx_bin; echo 'server { listen 80; }' > "$R/etc/nginx/sites-enabled/othersite"
EXTRA_ENV=(SM_ROOT="$C/empty"); shr 'sites-enabled/othersite'
# The three above also hold with no nginx binary, where only the glob over
# sites-enabled can see the foreign site (the HEAD preflight passed them only
# because its nginx -T scan caught the site anyway).
begin "SHELLOPTS=noglob, no nginx binary: leftover sites-enabled still seen (BR S54, BR F9)"
stock_tree abs; echo 'server { listen 80; }' > "$R/etc/nginx/sites-enabled/othersite"
EXTRA_ENV=(SHELLOPTS=noglob); shr 'sites-enabled/othersite'
begin "GLOBIGNORE='*', no nginx binary: leftover sites-enabled still seen (BR S53, BR F9)"
stock_tree abs; echo 'server { listen 80; }' > "$R/etc/nginx/sites-enabled/othersite"
EXTRA_ENV=(GLOBIGNORE='*' BASHOPTS=nullglob:failglob:dotglob); shr 'sites-enabled/othersite'
begin "SM_ROOT pointing at an empty tree, no nginx binary (IN r9, INT-9, BR S52, BR F9)"
mkdir -p "$C/empty"; stock_tree abs; echo 'server { listen 80; }' > "$R/etc/nginx/sites-enabled/othersite"
EXTRA_ENV=(SM_ROOT="$C/empty"); shr 'sites-enabled/othersite'
begin "SM_ROOT pointing at a shared tree does not make a clean box shared (INT-9)"
mkdir -p "$C/other/etc/nginx/sites-enabled"; echo 'server { listen 80; }' > "$C/other/etc/nginx/sites-enabled/othersite"
EXTRA_ENV=(SM_ROOT="$C/other" DOCKER_HOST=tcp://192.0.2.1:2375); ded
begin "the caller's environment never reaches a probe: docker sees no DOCKER_HOST (design 1)"
docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp'
printf '#!/bin/sh\n[ -z "${DOCKER_HOST:-}${SM_ROOT:-}${HOME:-}" ] && [ "${DOCKER_CONTEXT:-}" = default ] || { echo "inherited the caller environment" >&2; exit 1; }\n' > "$C/envcheck"
cat "$B/docker" | tail -n +2 >> "$C/envcheck"; mv "$C/envcheck" "$B/docker"
EXTRA_ENV=(DOCKER_HOST=tcp://192.0.2.1:2375 SM_ROOT=/ HOME=/root); ded
# === second adversarial round (r1) =====================================================
# --- the nginx master's command line is matched exactly (foreign-proxies N1, bash-robustness N4) ---
begin "nginx -g 'daemon on;include X;' (no space before include) is not the packaged nginx (foreign-proxies N1, bash-robustness N4a)"
stock_tree abs; host_nginx 80
printf 'nginx: master process /usr/sbin/nginx -g daemon on;include /opt/othersite/stream.conf;\0' > "$R/proc/4100/cmdline"
shr 'is not one the packaged nginx is started with'
begin "nginx -g with a quoted \"include\" (foreign-proxies N1)"
stock_tree abs; host_nginx 80
printf 'nginx: master process /usr/sbin/nginx -g daemon on; "include" /opt/othersite/stream.conf;\0' > "$R/proc/4100/cmdline"
shr 'is not one the packaged nginx is started with'
begin "nginx -g with a newline before include (foreign-proxies N1, bash-robustness N4b)"
stock_tree abs; host_nginx 80
printf 'nginx: master process /usr/sbin/nginx -g daemon on;\ninclude /etc/palm/stream.conf;\0' > "$R/proc/4100/cmdline"
shr 'is not one the packaged nginx is started with'
begin "a newline in -g hides a -c after it (foreign-proxies N1)"
stock_tree abs; host_nginx 80
printf 'nginx: master process /usr/sbin/nginx -g daemon on;\n -c /srv/p/n.conf\0' > "$R/proc/4100/cmdline"
shr 'is not one the packaged nginx is started with'
begin "title truncated by setproctitle (started under env -i) (foreign-proxies N1)"
stock_tree abs; host_nginx 80
printf 'nginx: master proce\0' > "$R/proc/4100/cmdline"
shr 'is not one the packaged nginx is started with'
begin "argv form with an include added to the stock -g (foreign-proxies N1)"
stock_tree abs; host_nginx 80
printf '/usr/sbin/nginx\0-g\0daemon on; master_process on; include /x;\0' > "$R/proc/4100/cmdline"
shr 'is not one the packaged nginx is started with'
begin "the stock title padded with NULs, as setproctitle leaves it (foreign-proxies N1 control)"
stock_tree abs; host_nginx 80
printf 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;\0\0\0\0\0\0\0\0\0\0' > "$R/proc/4100/cmdline"
ded
begin "nginx started by hand as plain 'nginx' (foreign-proxies N1 control)"
stock_tree abs; host_nginx 80; printf 'nginx: master process nginx\0' > "$R/proc/4100/cmdline"; ded

# --- docker is never asked when dockerd is not running (foreign-proxies N4) ---
begin "docker CLI installed, dockerd stopped: docker is never called (foreign-proxies N4)"
docker_stopped
CHECK='[ ! -e "$C/activations" ] || echo "docker was called (socket activation): $(tr "\n" ";" < "$C/activations")"'
shrx 'dockerd is not running'
begin "/run/docker.pid names a process that is not dockerd (foreign-proxies N4)"
docker_stopped; mkdir -p "$R/proc/880"; echo bash > "$R/proc/880/comm"; echo 880 > "$R/run/docker.pid"
CHECK='[ ! -e "$C/activations" ] || echo "docker was called"'
shrx 'dockerd is not running'
begin "stale /run/docker.pid, no such process (foreign-proxies N4)"
docker_stopped; echo 880 > "$R/run/docker.pid"
CHECK='[ ! -e "$C/activations" ] || echo "docker was called"'
shrx 'dockerd is not running'
begin "dockerd running but no docker CLI (foreign-proxies N4)"
dockerd_up; shrx 'dockerd is running but there is no docker CLI'

# --- the files that vouch for server blocks must be the ones nginx loads (nginx-states NEW-1, bash-robustness N1) ---
begin "S1: sites-enabled include commented out, stock default still linked, foreign site in conf.d (nginx-states NEW-1)"
stock_tree abs; host_nginx 80
sed -i 's|include /etc/nginx/sites-enabled/\*;|#include /etc/nginx/sites-enabled/*;|' "$R/etc/nginx/nginx.conf"
echo 'server { listen 80; server_name othersite.example; root /srv/othersite; }' > "$R/etc/nginx/conf.d/palm.conf"
shr 'nginx loads 1 server block\(s\), but 0 of them are ours'
begin "S2: Othersite's own nginx.conf with an inline server, stock default left linked (nginx-states NEW-1)"
stock_tree abs; host_nginx 80
printf 'events {}\nhttp {\n  include /etc/nginx/mime.types;\n  server {\n    listen 80;\n    server_name othersite.example;\n    root /srv/othersite;\n  }\n}\n' > "$R/etc/nginx/nginx.conf"
shr 'nginx loads 1 server block\(s\), but 0 of them are ours'
begin "X2: nginx.conf includes sites-enabled/*.conf only (nginx-states NEW-1)"
stock_tree abs; host_nginx 80
sed -i 's|include /etc/nginx/sites-enabled/\*;|include /etc/nginx/sites-enabled/*.conf;|' "$R/etc/nginx/nginx.conf"
echo 'server { listen 80; server_name othersite.example; }' > "$R/etc/nginx/conf.d/palm.conf"
shr 'nginx loads 1 server block\(s\), but 0 of them are ours'
begin "S3: our TLS site linked but not loaded, nginx.conf loads vhosts/*.conf with 3 foreign blocks (nginx-states NEW-1)"
our_site tls; host_nginx 80 443
sed -i 's|include /etc/nginx/sites-enabled/\*;|include /etc/nginx/vhosts/*.conf;|' "$R/etc/nginx/nginx.conf"
mkdir -p "$R/etc/nginx/vhosts"
printf 'server { listen 80; return 301 https://$host$request_uri; }\nserver { listen 443 ssl; server_name a.palm; }\nserver { listen 443 ssl default_server; return 444; }\n' > "$R/etc/nginx/vhosts/palm.conf"
shr 'nginx loads 3 server block\(s\), but 0 of them are ours'
begin "X3: our HTTP site linked but not loaded, foreign default_server in conf.d (nginx-states NEW-1)"
our_site http; host_nginx 80
sed -i 's|include /etc/nginx/sites-enabled/\*;|#include /etc/nginx/sites-enabled/*;|' "$R/etc/nginx/nginx.conf"
echo 'server { listen 80 default_server; server_name othersite.example; }' > "$R/etc/nginx/conf.d/palm.conf"
shr 'nginx loads 1 server block\(s\), but 0 of them are ours'
begin "N1a: nginx.conf loads only /etc/palm/*.conf, stock default linked but not loaded (bash-robustness N1a)"
stock_tree abs; host_nginx 80 443
printf 'events { worker_connections 768; }\nhttp {\n  include /etc/nginx/mime.types;\n  include /etc/palm/*.conf;\n}\n' > "$R/etc/nginx/nginx.conf"
mkdir -p "$R/etc/palm"
printf 'server {\n  listen 80;\n  listen 443 ssl;\n  server_name othersite.example;\n  location / { proxy_pass http://127.0.0.1:9000; }\n}\n' > "$R/etc/palm/site.conf"
shr 'nginx loads 1 server block\(s\), but 0 of them are ours'
begin "N1b: our 3-block site linked but not loaded, 3 foreign blocks in conf.d (bash-robustness N1b)"
our_site tls; host_nginx 80 443
printf 'events {}\nhttp { include /etc/nginx/conf.d/*.conf; }\n' > "$R/etc/nginx/nginx.conf"
printf 'server { listen 80 default_server; return 444; }\nserver { listen 443 ssl; server_name a.palm; }\nserver { listen 443 ssl; server_name b.palm; }\n' > "$R/etc/nginx/conf.d/palm.conf"
shr 'nginx loads 3 server block\(s\), but 0 of them are ours'
begin "N1c: symlinked sites-enabled directory, default -> ../sites-available/default lands in /srv/palm (bash-robustness N1c)"
stock_tree abs; host_nginx 80
rm "$R/etc/nginx/sites-enabled/default"; rmdir "$R/etc/nginx/sites-enabled"
mkdir -p "$R/srv/palm/sites-enabled" "$R/srv/palm/sites-available"
printf 'server { listen 80 default_server; server_name othersite.example; location / { proxy_pass http://127.0.0.1:9000; } }\n' > "$R/srv/palm/sites-available/default"
ln -s ../../srv/palm/sites-enabled "$R/etc/nginx/sites-enabled"
ln -s ../sites-available/default "$R/srv/palm/sites-enabled/default"
shr 'sites-enabled/default is not the untouched stock file'
begin "N6: a newline in the sites-enabled/default link target (bash-robustness N6)"
stock_tree abs; host_nginx 80
NLF="$R/etc/nginx/sites-available/default"$'\n'".palm"
printf 'server { listen 80 default_server; server_name othersite.example; }\n' > "$NLF"
rm "$R/etc/nginx/sites-enabled/default"; ln -s "../sites-available/default"$'\n'".palm" "$R/etc/nginx/sites-enabled/default"
echo raw > "$C/ngx.mode"; { printf '# configuration file /etc/nginx/sites-enabled/default:\n'; cat "$NLF"; printf '\n'; } > "$C/ngx.raw"
shr 'sites-enabled/default is not the untouched stock file'
begin "the stock default in sites-enabled AND loaded, our site on disk but not loaded (nginx-states NEW-1 control)"
our_site http; host_nginx 80; ln -s /etc/nginx/sites-available/default "$R/etc/nginx/sites-enabled/default"
sed -i 's|include /etc/nginx/sites-enabled/\*;|include /etc/nginx/sites-enabled/default;|' "$R/etc/nginx/nginx.conf"
ded 22 'sites-enabled/solutionmines is on disk, but nginx does not load it'

# --- real nginx -T dumps (fixtures made with Ubuntu's nginx 1.24, -T only) ---
# from_dump DUMP HEADER-PATH DEST: the file nginx dumped under HEADER-PATH
from_dump() {
  awk -v h="# configuration file $2:" '$0 == h { on = 1; next } on && /^# configuration file / { exit } on { print }' "$1" | head -c -1 > "$3"
}
real_ours() {   # real_ours FIXTURE: our HTTP site, on disk exactly as in the dump
  local E="$R/etc/nginx"
  our_site http; host_nginx 80; echo raw > "$C/ngx.mode"; cp "$1" "$C/ngx.raw"
  from_dump "$1" /etc/nginx/conf.d/solutionmines-zones.conf "$E/conf.d/solutionmines-zones.conf"
  from_dump "$1" /etc/nginx/snippets/solutionmines-proxy.conf "$E/snippets/solutionmines-proxy.conf"
  from_dump "$1" /etc/nginx/solutionmines/upstream.conf "$E/solutionmines/upstream.conf"
}
begin "real nginx 1.24 -T dump of our HTTP site (nginx-states NEW-1 control)"
real_ours "$FX/ours-http-nginx-T.txt"
from_dump "$FX/ours-http-nginx-T.txt" /etc/nginx/sites-enabled/solutionmines "$R/etc/nginx/sites-available/solutionmines"
ded
begin "real dump, include written as /etc/nginx//sites-enabled/* (NGX-4 D5 with nginx's own header)"
real_ours "$FX/ours-http-dslash-nginx-T.txt"
from_dump "$FX/ours-http-dslash-nginx-T.txt" /etc/nginx//sites-enabled/solutionmines "$R/etc/nginx/sites-available/solutionmines"
ded
begin "real dump, but our site on disk is not the text nginx loads (nginx-states NEW-1)"
real_ours "$FX/ours-http-nginx-T.txt"
from_dump "$FX/ours-http-nginx-T.txt" /etc/nginx/sites-enabled/solutionmines "$R/etc/nginx/sites-available/solutionmines"
echo '# edited after the last reload' >> "$R/etc/nginx/sites-available/solutionmines"
shr 'nginx loads 1 server block\(s\), but 0 of them are ours'

# --- Lua blocks and quotes that run across files (nginx-states NEW-3, bash-robustness N5) ---
begin "a quote opened in a Lua comment swallows a foreign server in the next file (nginx-states NEW-3)"
stock_tree abs; host_nginx 80
printf 'init_by_lua_block {\n    -- '"'"'shared dict warm-up\n    require "resty.core";\n}\n' > "$R/etc/nginx/conf.d/00-init.conf"
printf 'server {\n    listen 80;\n    server_name othersite.example;\n    root /srv/othersite;\n}\n' > "$R/etc/nginx/conf.d/palm.conf"
printf 'init_worker_by_lua_block {\n    -- start the workers'"'"' health timer\n    ngx.log(ngx.INFO, "worker up");\n}\n' > "$R/etc/nginx/conf.d/zz-worker.conf"
shr 'does not parse as nginx configuration \(.*a Lua block \(init_by_lua_block\)'
begin "a quote in a Lua comment hides a server block inside one file (bash-robustness N5)"
stock_tree abs; host_nginx 80
printf '%s\n' 'init_by_lua_block { -- "' '}' 'server { listen 443; server_name palm.example; return 204; }' '# " ; }' > "$R/etc/nginx/conf.d/palm-lua.conf"
shr 'Lua block \(init_by_lua_block\)'
begin "a quote still open at the next file header is refused (nginx-states NEW-3)"
stock_tree abs; host_nginx 80; mkdir -p "$C/v"
printf "add_header X 'a;\n" > "$C/v/a.conf"; printf "';\nserver { listen 80; }\n" > "$C/v/b.conf"
dump_extra /etc/nginx/vhosts/a.conf "$C/v/a.conf"; dump_extra /etc/nginx/vhosts/b.conf "$C/v/b.conf"
shr 'configuration file.* line inside an unfinished directive, block or string'

# --- only nginx-common's own record vouches for the stock default (bash-robustness N2) ---
dpkg_copy() { rm "$R/var/lib/dpkg"; cp -R "$FX/dpkg" "$R/var/lib/dpkg"; }
PALM_DEFAULT='server { listen 80 default_server; server_name othersite.example; location / { proxy_pass http://127.0.0.1:9000; } }'
begin "default site diverted by a package that ships Othersite's site (bash-robustness N2a)"
stock_tree abs; host_nginx 80; dpkg_copy; A="$R/var/lib/dpkg"
printf '%s\n' "$PALM_DEFAULT" > "$R/etc/nginx/sites-available/default"
M="$(md5sum < "$R/etc/nginx/sites-available/default" | cut -d' ' -f1)"
printf '/etc/nginx/sites-available/default\n/etc/nginx/sites-available/default.distrib\npalm-conf\n' > "$A/diversions"
printf '/.\n/etc\n/etc/nginx\n/etc/nginx/sites-available\n/etc/nginx/sites-available/default\n' > "$A/info/palm-conf.list"
printf '\nPackage: palm-conf\nStatus: install ok installed\nPriority: optional\nSection: httpd\nMaintainer: Palm <ops@palm.invalid>\nArchitecture: all\nVersion: 1.0\nConffiles:\n /etc/nginx/sites-available/default %s\nDescription: palm conf\n' "$M" >> "$A/status"
shr 'sites-enabled/default is not the untouched stock file'
begin "default site taken over (Replaces) by a package that ships Othersite's site (bash-robustness N2b)"
stock_tree abs; host_nginx 80; dpkg_copy; A="$R/var/lib/dpkg"
printf '%s\n' "$PALM_DEFAULT" > "$R/etc/nginx/sites-available/default"
M="$(md5sum < "$R/etc/nginx/sites-available/default" | cut -d' ' -f1)"
printf '/.\n/etc\n/etc/nginx\n/etc/nginx/sites-available\n' > "$A/info/nginx-common.list"
sed -i '/^Conffiles:/,/^Description/{/sites-available\/default/d}' "$A/status"
printf '/.\n/etc\n/etc/nginx\n/etc/nginx/sites-available\n/etc/nginx/sites-available/default\n' > "$A/info/palm-site.list"
printf '\nPackage: palm-site\nStatus: install ok installed\nPriority: optional\nSection: httpd\nMaintainer: Palm <ops@palm.invalid>\nArchitecture: all\nVersion: 1.0\nReplaces: nginx-common\nConffiles:\n /etc/nginx/sites-available/default %s\nDescription: palm site\n' "$M" >> "$A/status"
shr 'sites-enabled/default is not the untouched stock file'
begin "dpkg -S 'local diversion' lines: not the packaged file (bash-robustness N2)"
stock_tree abs; host_nginx 80
stub dpkg "printf 'local diversion from: /etc/nginx/sites-available/default\nlocal diversion to: /etc/nginx/sites-available/default.orig\nnginx-common: /etc/nginx/sites-available/default\n'"
shr 'sites-enabled/default is not the untouched stock file'

# --- the caller's environment (bash-robustness N7) ---
begin "an exported bash function named timeout cannot rewrite what a probe sees (bash-robustness N7a)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("caddy",pid=900,fd=7))'
EXTRA_ENV=("BASH_FUNC_timeout%%=() { shift 3; if [ \"\$1\" = ss ]; then echo 'LISTEN 0 1 0.0.0.0:22 0.0.0.0:* users:((\"sshd\",pid=1,fd=3))'; else command \"\$@\"; fi; }")
shr "tcp 0.0.0.0:80 is held by 'caddy'"
begin "exported functions named ss and awk are ignored too (bash-robustness N7a)"
tcp 'LISTEN 0      4096         0.0.0.0:443       0.0.0.0:*    users:(("caddy",pid=900,fd=8))'
EXTRA_ENV=("BASH_FUNC_ss%%=() { echo 'LISTEN 0 1 0.0.0.0:22 0.0.0.0:* users:((\"sshd\",pid=1,fd=3))'; }" "BASH_FUNC_have%%=() { return 1; }")
shr "tcp 0.0.0.0:443 is held by 'caddy'"
begin "BASH_XTRACEFD=1 in the environment does not close stdout (bash-robustness N7b)"
EXTRA_ENV=(BASH_XTRACEFD=1); ded

# --- SSH ports from sshd -T listenaddress (firewall-ssh FWN-3) ---
begin "ListenAddress 0.0.0.0:2222: sshd -T keeps 'port 22' but sshd listens on 2222 only (firewall-ssh FWN-3)"
tcp_only 'LISTEN 0      4096         0.0.0.0:2222      0.0.0.0:*    users:(("systemd",pid=1,fd=50))'
stub sshd 'printf "port 22\nlistenaddress 0.0.0.0:2222\n"'
ded 2222 'tcp 0.0.0.0:2222 is held by systemd alone \(socket activation\)'
begin "the default sshd -T listenaddress lines (firewall-ssh FWN-3 control)"
stub sshd 'printf "port 22\naddressfamily any\nlistenaddress [::]:22\nlistenaddress 0.0.0.0:22\n"'; ded 22
begin "loopback-only SSH ports are left out of SSH_PORTS (firewall-ssh FWN-3)"
tcp 'LISTEN 0      128        127.0.0.1:2201      0.0.0.0:*    users:(("sshd",pid=1006,fd=3))'
stub sshd 'printf "port 22\nport 2201\nlistenaddress 127.0.0.1:2201\nlistenaddress 0.0.0.0:22\n"'; ded 22

begin "unknown argument: preflight refuses with a usage error (contract)"
CHECK='[ ! -s "$C/out" ] || echo "stdout is not empty"'; queue job_plain 2 --bogus
begin "--test-root that is not a directory (contract)"
CHECK='[ ! -s "$C/out" ] || echo "stdout is not empty"'; queue job_plain 2 --emit --test-root "$C/nope"
begin "without --emit: the report goes to stdout, exit 0 (contract, INT-8 wording)"
our_site http; host_nginx 80
CHECK='grep -q "^verdict: dedicated" "$C/out" || echo "no dedicated verdict on stdout"
grep -q "^SHARED=" "$C/out" && echo "emit lines without --emit"
[ ! -s "$C/err" ] || echo "stderr is not empty"
grep -Eqi "will refuse|bootstrap|firewall|ufw" "$C/out" && echo "the report makes claims about bootstrap or the firewall"'
queue job_plain 0 --test-root "$R"
begin "without --emit on a shared box: exit 3, one line per reason, no claims about bootstrap (INT-8)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("caddy",pid=900,fd=7))' \
    'LISTEN 0      4096         0.0.0.0:443       0.0.0.0:*    users:(("caddy",pid=900,fd=8))'
mkdir -p "$R/opt/solutionmines"; : > "$R/opt/solutionmines/edge.env"
CHECK='[ "$(grep -c "^  - tcp 0.0.0.0:[0-9]* is held by .caddy." "$C/out")" = 2 ] || echo "want one line per reason"
grep -Eqi "will refuse|bootstrap|safe for|firewall" "$C/out" && echo "the report makes claims about bootstrap or the firewall"'
queue job_plain 3 --test-root "$R"

# === round 2 (r2) regressions ============================================================
# --- foreign-proxies N1: native nftables tables are visible only through nft ---
FW_NFT='table inet firewalld {
	chain nat_PREROUTING {
		type nat hook prerouting priority dstnat + 10; policy accept;
		jump nat_PRE_public
	}
	chain nat_PRE_public {
		jump nat_PRE_public_allow
	}
	chain nat_PRE_public_allow {
		meta nfproto ipv4 tcp dport 80 dnat ip to 10.0.0.5:8080
	}
}'
begin "firewalld forward-port of :80 in table inet firewalld, nft works (foreign-proxies N1 control)"
printf '%s\n' "$FW_NFT" > "$C/fw"; nat_nft "$C/fw"
shr 'chain nat_PRE_public_allow\) redirects traffic for :80/:443 \(dnat 80\)'
begin "the same box without the nft CLI: iptables-nft-save shows empty tables, cannot verify (foreign-proxies N1)"
rm -f "$B/nft"; shrx "cannot verify: 'nft' is not installed, so native nftables NAT rules .*apt-get install nftables"
begin "the same box with 'nft list ruleset' failing: cannot verify (foreign-proxies N1)"
stub nft 'echo "netlink: Error: cache initialization failed" >&2; exit 1'
shrx "cannot verify: 'nft list ruleset' failed \(exit 1\), so native nftables NAT rules"
begin "nft hangs into the probe timeout: cannot verify (foreign-proxies N1)"
stub nft 'exit 124'; shrx "'nft list ruleset' failed \(exit 124\)"
begin "iptables-save is the legacy tool, the kernel lists no legacy nat table, nft missing: cannot verify (foreign-proxies N1d)"
ipt_stub iptables-save legacy "$FX/nat/empty-iptables-nft.txt"; ipt_stub ip6tables-save legacy "$FX/nat/empty-iptables-nft.txt"
legacy_tables 4 filter; legacy_tables 6 filter; rm -f "$B/nft"
shrx "'nft' is not installed"
nf_tables_absent() {   # a kernel that provably has no nf_tables: sysfs without it, not built in
  mkdir -p "$R/sys/module/ip_tables" "$R/proc/sys/kernel" "$R/lib/modules/6.8.0-sm"
  echo 6.8.0-sm > "$R/proc/sys/kernel/osrelease"
  printf 'kernel/net/ipv4/netfilter/ip_tables.ko\nkernel/net/netfilter/x_tables.ko\n' > "$R/lib/modules/6.8.0-sm/modules.builtin"
}
begin "legacy iptables only, nft missing, and the kernel provably has no nf_tables: dedicated (foreign-proxies N1 exemption)"
ipt_stub iptables-save legacy "$FX/nat/empty-iptables-nft.txt"; ipt_stub ip6tables-save legacy "$FX/nat/empty-iptables-nft.txt"
legacy_tables 4 filter; legacy_tables 6 filter; rm -f "$B/nft"; nf_tables_absent
ded
begin "the same, but nf_tables is built into the kernel: cannot verify (foreign-proxies N1 exemption)"
ipt_stub iptables-save legacy "$FX/nat/empty-iptables-nft.txt"; ipt_stub ip6tables-save legacy "$FX/nat/empty-iptables-nft.txt"
legacy_tables 4 filter; legacy_tables 6 filter; rm -f "$B/nft"; nf_tables_absent
echo kernel/net/netfilter/nf_tables.ko >> "$R/lib/modules/6.8.0-sm/modules.builtin"
shrx "'nft' is not installed"
begin "the same, but the nf_tables module is loaded: cannot verify (foreign-proxies N1 exemption)"
ipt_stub iptables-save legacy "$FX/nat/empty-iptables-nft.txt"; ipt_stub ip6tables-save legacy "$FX/nat/empty-iptables-nft.txt"
legacy_tables 4 filter; legacy_tables 6 filter; rm -f "$B/nft"; nf_tables_absent; mkdir -p "$R/sys/module/nf_tables"
shrx "'nft' is not installed"

# --- foreign-proxies N2: containers that are configured, not running ---
begin "a foreign proxy crash-looping: docker ps shows no ports, its configuration publishes 80/443 (foreign-proxies N2)"
docker_ps $'othersite-caddy\t'
docker_all $'othersite-caddy\trestarting\talways\tbridge\t{"443/tcp":[{"HostIp":"","HostPort":"443"}],"80/tcp":[{"HostIp":"","HostPort":"80"}]}'
shr "container 'othersite-caddy' \(restarting, restart policy 'always'\) is configured to publish host port 80/tcp"
begin "a foreign proxy stopped, restart policy always: not in docker ps at all (foreign-proxies N2)"
docker_ps
docker_all $'othersite-caddy\texited\talways\tbridge\t{"443/tcp":[{"HostIp":"0.0.0.0","HostPort":"443"},{"HostIp":"::","HostPort":"443"}]}'
shr "container 'othersite-caddy' \(exited, restart policy 'always'\) is configured to publish host port 443/tcp"
begin "a leftover exited container configured for :80, restart policy no: refused, docker rm is the remedy (foreign-proxies N2)"
docker_ps; docker_all $'old-web\texited\tno\tbridge\t{"80/tcp":[{"HostIp":"","HostPort":"80"}]}'
shr "container 'old-web' \(exited, restart policy 'no'\) is configured to publish host port 80/tcp"
begin "a created container bound to the host range 1-1000 (foreign-proxies N2)"
docker_ps; docker_all $'edge\tcreated\tunless-stopped\tbridge\t{"8000/tcp":[{"HostIp":"","HostPort":"1-1000"}]}'
shr "host ports 1-1000/tcp, which include 80 or 443"
begin "a proxy on the host network, running (no ports in docker ps) (foreign-proxies N2)"
docker_ps $'othersite-proxy\t'; docker_all $'othersite-proxy\trunning\tunless-stopped\thost\t{}'
shr "container 'othersite-proxy' runs on the host's network"
begin "a proxy on the host network, stopped with a restart policy (foreign-proxies N2)"
docker_ps; docker_all $'othersite-proxy\texited\tunless-stopped\thost\t{}'
shr "restart policy 'unless-stopped' brings it back"
begin "exited containers with no :80/:443 binding, a host-network job with restart no (foreign-proxies N2 control)"
docker_ps
docker_all $'old-app\texited\tno\tbridge\t{"8080/tcp":[{"HostIp":"","HostPort":"8080"}]}' \
  $'db\texited\tunless-stopped\tbridge\t{"5432/tcp":[{"HostIp":"127.0.0.1","HostPort":"5432"}],"5433/tcp":null}' \
  $'job\texited\tno\thost\t{}' $'eph\texited\talways\tbridge\t{"80/tcp":[{"HostIp":"","HostPort":""}]}'
ded
begin "a stopped container with a restart policy configured for 127.0.0.1:3001 (foreign-proxies N2)"
docker_ps; docker_all $'other-app\texited\talways\tbridge\t{"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"3001"}]}'
expect 0 no no 22 "container 'other-app' \(exited, restart policy 'always'\) is configured to publish host port 3001"
begin "our own green, stopped, with its 3002 binding, next to a running blue (foreign-proxies N2 control)"
tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))'
docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp'
docker_all $'solutionmines-green\texited\tunless-stopped\tedge\t{"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"3002"}]}'
nat_ipt "$FX/nat/docker-ours-iptables.txt"; nat_ipt6 "$FX/nat/docker-ours-ip6tables.txt"; nat_nft "$FX/nat/docker-ours-nft.txt"
ded
begin "docker inspect fails: cannot verify (foreign-proxies N2)"
dockerd_up; stub docker "case \"\$*\" in ps\ --no-trunc*) ;; 'ps -a -q --no-trunc') printf '%064x\n' 7 ;; *) echo 'Error: No such container' >&2; exit 1 ;; esac"
shrx "cannot verify: 'docker inspect' failed \(exit 1\)"
begin "docker ps -a fails: cannot verify (foreign-proxies N2)"
dockerd_up; stub docker "case \"\$*\" in ps\ --no-trunc*) ;; *) exit 1 ;; esac"
shrx "cannot verify: 'docker ps -a' failed \(exit 1\)"
begin "docker inspect describes fewer containers than docker ps -a listed: cannot verify (foreign-proxies N2)"
dockerd_up; stub docker "case \"\$*\" in ps\ --no-trunc*) ;; 'ps -a -q --no-trunc') printf '%064x\n' 7 8 ;; inspect*) printf '\"/a\"\t\"exited\"\t\"no\"\t\"bridge\"\t{}\t{}\n' ;; *) exit 2 ;; esac"
shrx "docker inspect described 1 container\(s\), but docker ps -a listed 2"
begin "port bindings that do not parse: cannot verify (foreign-proxies N2)"
docker_ps; docker_all $'odd\texited\tno\tbridge\t{"80/tcp":[{"HostIp":"","HostPort":"80"}]'
shrx "container odd: its port bindings do not parse"
begin "a web server unit that is enabled but down: caddy.service (foreign-proxies N2)"
mkdir -p "$R/etc/systemd/system/multi-user.target.wants"
ln -s /lib/systemd/system/caddy.service "$R/etc/systemd/system/multi-user.target.wants/caddy.service"
shr "the web server unit caddy.service is enabled"
begin "enabled units that are not another web server: ssh, nginx, docker (foreign-proxies N2 control)"
mkdir -p "$R/etc/systemd/system/multi-user.target.wants" "$R/etc/systemd/system/sockets.target.wants"
for u in ssh.service nginx.service docker.service containerd.service; do ln -s "/lib/systemd/system/$u" "$R/etc/systemd/system/multi-user.target.wants/$u"; done
ln -s /lib/systemd/system/docker.socket "$R/etc/systemd/system/sockets.target.wants/docker.socket"
ded

# --- foreign-proxies N3: an orchestrator whose dataplane shows no socket or NAT rule ---
begin "k3s with Cilium's eBPF dataplane: hostPort 443 with no socket and no NAT rule (foreign-proxies N3)"
tcp 'LISTEN 0      4096               *:6443             *:*    users:(("k3s-server",pid=1500,fd=12))' \
    'LISTEN 0      4096               *:10250            *:*    users:(("k3s-server",pid=1500,fd=180))' \
    'LISTEN 0      4096               *:4240             *:*    users:(("cilium-agent",pid=2500,fd=20))'
mkdir -p "$R/var/lib/kubelet" "$R/etc/rancher/k3s" "$R/sys/fs/bpf/tc/globals"; : > "$R/sys/fs/bpf/tc/globals/cilium_lb4_services_v2"
shr "a container orchestrator \(Kubernetes, k3s, Cilium or Calico\) is on this box.*'k3s-server' listens on tcp \*:6443"
begin "only /var/lib/kubelet is there: cannot be ruled out (foreign-proxies N3)"
mkdir -p "$R/var/lib/kubelet"; shr "a container orchestrator .*/var/lib/kubelet exists"
begin "a kubelet process with no listener seen: cannot be ruled out (foreign-proxies N3)"
mkdir -p "$R/proc/1700"; echo kubelet > "$R/proc/1700/comm"; shr "process 'kubelet' runs \(pid 1700\)"
begin "only Cilium's pinned eBPF maps (foreign-proxies N3)"
mkdir -p "$R/sys/fs/bpf/tc/globals"; : > "$R/sys/fs/bpf/tc/globals/cilium_calls_hostns_01234"; shr "Cilium's eBPF maps"
begin "containerd and its shims run our own containers: not an orchestrator (foreign-proxies N3 control)"
mkdir -p "$R/proc/700" "$R/proc/2100"; echo containerd > "$R/proc/700/comm"; echo containerd-shim > "$R/proc/2100/comm"
mkdir -p "$R/var/lib/containerd" "$R/sys/fs/bpf"
ded

# --- foreign-proxies N4: only Docker's own rule for blue/green counts as ours ---
DOCKER_BLUE_NAT="$(cat "$FX/nat/docker-ours-iptables.txt")"
blue_up() {
  tcp 'LISTEN 0      4096       127.0.0.1:3001      0.0.0.0:*    users:(("docker-proxy",pid=2201,fd=7))'
  docker_ps $'solutionmines-blue\t127.0.0.1:3001->3000/tcp'
  nat_ipt6 "$FX/nat/docker-ours-ip6tables.txt"; nat_nft /dev/null
}
begin "an OUTPUT DNAT of 127.0.0.1:3001 to another host's :3000, with blue running (foreign-proxies N4)"
blue_up
printf '%s\n' "${DOCKER_BLUE_NAT/COMMIT/-A OUTPUT -d 127.0.0.1/32 -p tcp -m tcp --dport 3001 -j DNAT --to-destination 192.0.2.9:3000
COMMIT}" > "$C/x"
nat_ipt "$C/x"; expect 0 no no 22 'chain OUTPUT\) redirects TCP 3001/3002 \(DNAT 3001\)'
begin "a DOCKER-chain DNAT of 3001 to an address that is not blue's (foreign-proxies N4)"
blue_up
printf '%s\n' "${DOCKER_BLUE_NAT//172.18.0.2:3000/172.18.0.77:3000}" > "$C/x"
nat_ipt "$C/x"; expect 0 no no 22 'chain DOCKER\) redirects TCP 3001/3002 \(DNAT 3001\)'
begin "Docker's rule for blue, twice (foreign-proxies N4)"
blue_up
printf '%s\n' "${DOCKER_BLUE_NAT/COMMIT/-A DOCKER -d 127.0.0.1/32 ! -i br-3f2a9c1d7e44 -p tcp -m tcp --dport 3001 -j DNAT --to-destination 172.18.0.2:3000
COMMIT}" > "$C/x"
nat_ipt "$C/x"; expect 0 no no 22 'chain DOCKER\) redirects TCP 3001/3002 \(DNAT 3001\)'
begin "nft: an extra rule shaped like Docker's in another chain (foreign-proxies N4)"
blue_up; nat_ipt "$FX/nat/docker-ours-iptables.txt"
sed 's/^	chain PREROUTING {/	chain sneaky {\n\t\tip daddr 127.0.0.1 tcp dport 3001 dnat to 10.9.9.9:3000\n\t}\n\n\tchain PREROUTING {/' "$FX/nat/docker-ours-nft.txt" > "$C/x"
nat_nft "$C/x"; expect 0 no no 22 'chain sneaky\) redirects TCP 3001/3002 \(dnat 3001\)'
begin "Docker's rule for blue while blue is not running (foreign-proxies N4 control)"
nat_ipt "$FX/nat/docker-ours-iptables.txt"; docker_ps
expect 0 no no 22 'chain DOCKER\) redirects TCP 3001/3002 \(DNAT 3001\)'

# --- nginx-states NGX-R2-1: what the untouched stock default site serves ---
WELCOME='<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
</head>
<body>
<h1>Welcome to nginx!</h1>
</body>
</html>'
welcome() {   # welcome [DOCROOT-COPY]: nginx-common's welcome page, and its copy in /var/www/html
  mkdir -p "$R/usr/share/nginx/html" "$R/var/www/html"
  printf '%s\n' "$WELCOME" > "$R/usr/share/nginx/html/index.html"
  [ "${1:-copy}" = copy ] && cp "$R/usr/share/nginx/html/index.html" "$R/var/www/html/index.nginx-debian.html"
  return 0
}
begin "untouched stock default site serving someone's static site from /var/www/html (nginx-states NGX-R2-1)"
stock_tree abs; host_nginx 80; welcome
echo '<h1>Othersite</h1>' > "$R/var/www/html/index.html"; echo 'body{}' > "$R/var/www/html/site.css"
shr "untouched default site serves /var/www/html, which holds content other than nginx's welcome page \(it holds (index.html|site.css)\)"
begin "untouched stock default, /var/www/html holds only nginx's welcome page (nginx-states NGX-R2-1 control)"
stock_tree abs; host_nginx 80; welcome; ded
begin "untouched stock default, /var/www/html exists but is empty (nginx-states NGX-R2-1 control)"
stock_tree abs; host_nginx 80; welcome none; ded
begin "the welcome page edited into a landing page (nginx-states NGX-R2-1)"
stock_tree abs; host_nginx 80; welcome; echo '<h1>Othersite, coming soon</h1>' > "$R/var/www/html/index.nginx-debian.html"
shr "is not nginx's welcome page"
begin "/var/www/html is a symlink to another project's build (nginx-states NGX-R2-1)"
stock_tree abs; host_nginx 80; welcome none; rmdir "$R/var/www/html"; mkdir -p "$R/srv/palm/build"
ln -s ../../srv/palm/build "$R/var/www/html"; shr "/var/www/html is a symlink"
begin "a dotfile next to the welcome page (nginx-states NGX-R2-1)"
stock_tree abs; host_nginx 80; welcome; : > "$R/var/www/html/.well-known-x"; shr 'it holds .well-known-x'
begin "a subdirectory next to the welcome page (nginx-states NGX-R2-1)"
stock_tree abs; host_nginx 80; welcome; mkdir -p "$R/var/www/html/blog"; shr 'it holds blog'
begin "the welcome page, but nginx's own copy is missing: cannot tell (nginx-states NGX-R2-1)"
stock_tree abs; host_nginx 80; welcome; rm -f "$R/usr/share/nginx/html/index.html"; shr "is not nginx's welcome page"
begin "leftover stock config (no nginx binary) whose /var/www/html holds a site (nginx-states NGX-R2-1)"
stock_tree abs; welcome; echo '<h1>Othersite</h1>' > "$R/var/www/html/index.html"; shr 'untouched default site serves /var/www/html'

# --- nginx-states NGX-R2-2: /etc/nginx behind a symlink ---
begin "/etc/nginx is a symlink to /srv/nginx: our own HTTP site is still ours (nginx-states NGX-R2-2)"
our_site http; mkdir -p "$R/srv"; mv "$R/etc/nginx" "$R/srv/nginx"; ln -s ../srv/nginx "$R/etc/nginx"; host_nginx 80
ded 22 '' 'does not point at'
begin "/etc/nginx/sites-available is a symlink: our own TLS site is still ours (nginx-states NGX-R2-2)"
our_site tls; mkdir -p "$R/srv"; mv "$R/etc/nginx/sites-available" "$R/srv/sites-available"
ln -s ../../srv/sites-available "$R/etc/nginx/sites-available"; host_nginx 80 443
ded 22 '' 'does not point at'
begin "sites-available/solutionmines itself a link to someone else's file still does not count (nginx-states NGX-R2-2 control)"
our_site http; mkdir -p "$R/srv"; mv "$R/etc/nginx/sites-available/solutionmines" "$R/srv/palm.conf"
ln -s /srv/palm.conf "$R/etc/nginx/sites-available/solutionmines"; host_nginx 80
shr 'sites-enabled/solutionmines does not point at sites-available/solutionmines|but 0 of them are ours'

# --- nginx-states NGX-R2-3: the leftover check reads what nginx.conf includes ---
begin "leftover config (no nginx binary): a stream server on :443 in modules-enabled (nginx-states NGX-R2-3)"
stock_tree abs
printf 'stream {\n  server {\n    listen 443;\n    proxy_pass 10.0.0.9:443;\n  }\n}\n' > "$R/etc/nginx/modules-enabled/60-palm-stream.conf"
shr 'leftover nginx configuration \(no nginx binary\) defines 2 server block'
begin "leftover config: a server block appended to mime.types (nginx-states NGX-R2-3)"
stock_tree abs; printf 'server {\n  listen 80;\n}\n' >> "$R/etc/nginx/mime.types"
shr 'leftover nginx configuration \(no nginx binary\) defines 2 server block'
begin "leftover config: a module link and a .conf.removed in modules-enabled (nginx-states NGX-R2-3 control)"
stock_tree abs; mkdir -p "$R/usr/share/nginx/modules-available"
echo 'load_module modules/ngx_stream_module.so;' > "$R/usr/share/nginx/modules-available/mod-stream.conf"
ln -s /usr/share/nginx/modules-available/mod-stream.conf "$R/etc/nginx/modules-enabled/50-mod-stream.conf"
ln -s /usr/share/nginx/modules-available/mod-http-geoip.conf "$R/etc/nginx/modules-enabled/50-mod-http-geoip.conf.removed"
ded

# --- bash-robustness N1: no verdict loop may depend on writing a temp file ---
# Each runs with RLIMIT_FSIZE 0 (and SIGXFSZ ignored), so bash cannot write
# the temp file behind a here-string of 64 KiB or more, the way a full /tmp
# fails it; preflight's output goes through pipes.
begin "3000 loopback listeners and caddy on :80, no file can be written (bash-robustness N1)"
for ((k = 20000; k < 23000; k++)); do printf 'LISTEN 0      4096       127.0.0.1:%s      0.0.0.0:*    users:(("app",pid=3000,fd=9))\n' "$k"; done >> "$C/tcp"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("caddy",pid=900,fd=7))'
queue job_nofile 3 yes yes 22 "tcp 0.0.0.0:80 is held by 'caddy'"
begin "900 kube-proxy-style DNAT rules with no port match, no file can be written (bash-robustness N1)"
{ printf '*nat\n:KUBE-SERVICES - [0:0]\n'; for ((k = 0; k < 900; k++)); do printf -- '-A KUBE-SEP-%05d -p tcp -m comment --comment "default/web" -m tcp -j DNAT --to-destination 10.42.0.%d:8080\n' "$k" "$((k % 250))"; done; printf 'COMMIT\n'; } > "$C/x"
nat_ipt "$C/x"
queue job_nofile 3 yes no 22 'chain KUBE-SEP-00000\) redirects traffic for :80/:443'
begin "an nginx -T dump over 64 KiB on a dedicated box, no file can be written (bash-robustness N1)"
our_site http; host_nginx 80
for ((k = 0; k < 1500; k++)); do printf '# padding line %05d ...................................................\n' "$k"; done >> "$R/etc/nginx/mime.types"
queue job_nofile 0 no yes 22 'dedicated'

# --- bash-robustness N2: no environment variable is a hook ---
begin "SM_PREFLIGHT_CLEAN=1 with exported unset and awk functions: still a clean re-run (bash-robustness N2)"
tcp 'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*    users:(("caddy",pid=2,fd=3))'
EXTRA_ENV=(SM_PREFLIGHT_CLEAN=1 "BASH_FUNC_unset%%=() { :; }"
  "BASH_FUNC_awk%%=() { command awk \"\$@\" | while IFS= read -r l; do case \"\$l\" in *caddy*) ;; *) printf '%s\\n' \"\$l\" ;; esac; done; return 0; }")
shr "tcp 0.0.0.0:80 is held by 'caddy'"
begin "--sm-reexec from a caller whose environment is not empty: refused (bash-robustness N2)"
EXTRA_ENV=(FOO=1); CHECK='[ ! -s "$C/out" ] || echo "stdout is not empty"'
queue job_plain 2 --sm-reexec --emit --test-root "$R"
begin "--sm-reexec with an empty environment behaves like the re-run itself (bash-robustness N2 control)"
queue job_plain 0 --sm-reexec --emit --test-root "$R"
}

# --- not root and no --test-root: refuse before probing anything (design 1) ---
# Safe to run for real: that path exits before any probe. As root, drop to
# nobody with setpriv and feed the script on stdin; as non-root, run it as is.
job_nonroot() {
  local why="" out="" err=""
  if [ "$(id -u)" -eq 0 ]; then
    ( cd "$C" && "$ENV_BIN" -i PATH=/usr/sbin:/usr/bin:/sbin:/bin SM_ROOT="$C" \
        setpriv --reuid=65534 --regid=65534 --clear-groups -- /bin/bash -s -- --emit \
        < "$PF" > "$C/out" 2> "$C/err" )
  else
    ( cd "$C" && "$ENV_BIN" -i PATH=/usr/sbin:/usr/bin:/sbin:/bin SM_ROOT="$C" \
        /bin/bash "$PF" --emit > "$C/out" 2> "$C/err" )
  fi
  RC=$?
  IFS= read -r -d '' out < "$C/out"; IFS= read -r -d '' err < "$C/err"
  [ "$RC" = 3 ] || why="exit $RC, want 3"
  [ "$out" = $'SHARED=yes\nAPP_PORTS_FREE=no\nSSH_PORTS=\n' ] || why="${why:+$why; }stdout: ${out//$'\n'/|}"
  [[ $err =~ "must run as root" ]] || why="${why:+$why; }report lacks 'must run as root'"
  result "$why"
}
nonroot_case() {
  begin "not root, no --test-root: 'must run as root', exit 3, nothing probed (design 1)"
  if [ "$(id -u)" -ne 0 ] || command -v setpriv >/dev/null 2>&1; then
    queue job_nonroot
  else
    echo "# skipped: running as root without setpriv"
  fi
}

# --- the slow case, run once: a hanging probe must time out, not hang preflight -----------
slow_cases() {
  begin "docker ps hangs: preflight times out the probe and fails closed (FP-F7 J)"
  dockerd_up; stub docker 'exec sleep 60'
  # The real timeout, cut from preflight's 15 seconds to 1 so the suite stays fast.
  stub timeout "shift 3; exec '$(command -v timeout)' -k 1 1 \"\$@\""
  CHECK='[ $((SECONDS - T0)) -le 10 ] || echo "took $((SECONDS - T0))s"'
  shrx "'docker ps' failed \(exit 124\)"
}

# --- main --------------------------------------------------------------------------------------
AWKS=()
for a in mawk gawk original-awk; do
  p="$(command -v "$a" 2>/dev/null)" && AWKS+=("$p")
done
if command -v busybox >/dev/null 2>&1 && busybox awk 'BEGIN{}' 2>/dev/null; then AWKS+=("$(command -v busybox)"); fi
# PREFLIGHT_TEST_AWKS="/path/to/awk ..." replaces the list (e.g. an unpacked gawk).
if [ -n "${PREFLIGHT_TEST_AWKS:-}" ]; then read -r -a AWKS <<< "$PREFLIGHT_TEST_AWKS"; fi
[ "${#AWKS[@]}" -gt 0 ] || AWKS=("$(command -v awk)")

# AWK_N, not i: the cases use i as a loop variable of their own, and a SYS
# directory that a later round recreated under a running job broke that job.
AWK_N=0
for awk in "${AWKS[@]}"; do
  AWK_N=$((AWK_N + 1))
  QUEUED+=("# awk: $awk")
  SYS="$TMP/sys$AWK_N"; SYS_NOMD5="$TMP/sys-nomd5-$AWK_N"
  mk_sys "$SYS" "$awk"
  mk_sys "$SYS_NOMD5" "$awk" md5sum
  cases
done
slow_cases
nonroot_case
wait

for c in "${QUEUED[@]}"; do
  case "$c" in "#"*) echo "$c"; continue ;; esac
  N=$((N + 1))
  name="$(cat "$c/name")"
  if [ "$(head -n 1 "$c/result" 2>/dev/null)" = ok ]; then
    echo "ok $N - $name"
    tail -n +2 "$c/result"
  else
    FAILED=$((FAILED + 1))
    echo "not ok $N - $name"
    tail -n +2 "$c/result" 2>/dev/null
  fi
done

echo "1..$N"
if [ "$FAILED" -gt 0 ]; then
  echo "# $FAILED of $N failed"
  exit 1
fi
echo "# all $N passed (awk: ${AWKS[*]}; $P parallel jobs)"
exit 0
