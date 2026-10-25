#!/usr/bin/env bash
# ============================================================================
# PREFLIGHT — is this box safe for bootstrap.sh to take over?
#
#   sudo bash deploy/preflight.sh            human-readable report
#   sudo bash deploy/preflight.sh --emit     report on stderr, KEY=value on stdout
#
#   exit 0   dedicated: nothing else serves web traffic here
#   exit 3   SHARED: another site or proxy already serves web traffic here
#
# READ-ONLY. It changes nothing, so it is safe to run on a production box that
# hosts other people's sites.
#
# Why it exists: bootstrap.sh was written for a box dedicated to this site. On
# a box that already serves another site it would delete nginx's `default`
# site, claim `default_server` on :80 and :443, and switch on a firewall that
# allows only SSH and HTTP(S). Each of those takes the other site down. The
# default_server clash is the worst of them, because `nginx -t` fails only
# AFTER our files are in sites-enabled: nothing breaks until the next reload
# by anyone — someone else's deploy, a certbot renewal — days later.
#
# Run it as root. Without root, ss cannot name the process that owns a port,
# and every unidentifiable owner is treated as foreign. Fail safe, not open.
# ============================================================================
set -uo pipefail   # deliberately NOT -e: every check runs and reports

R="${SM_ROOT:-}"   # test hook: a fake filesystem root. Empty in real use.
EMIT=no
[ "${1:-}" = "--emit" ] && EMIT=yes

shared=()    # reasons this box is already serving someone else
exposed=()   # host ports a newly enabled firewall would cut off

# --- listening TCP sockets, normalised to "<host> <port> <process|?>" --------
listeners() {
  { ss -Hltnp 2>/dev/null || ss -ltnp 2>/dev/null | tail -n +2; } | awk '
    {
      addr = $4; proc = "?"
      # users:(("nginx",pid=1,fd=6),...) -> nginx
      if (match($0, /users:\(\("[^"]+"/)) proc = substr($0, RSTART + 9, RLENGTH - 10)
      n = split(addr, parts, ":"); port = parts[n]
      host = substr(addr, 1, length(addr) - length(port) - 1)
      if (port ~ /^[0-9]+$/) print host, port, proc
    }'
}

is_loopback() {
  case "$1" in
    127.*|'[::1]'|::1|'[::ffff:127.'*|*%lo) return 0 ;;
    *) return 1 ;;
  esac
}

# Without ss there is no way to see what is listening — and an empty list would
# read as "nothing on :80", i.e. dedicated. A safety check must fail closed.
HAVE_SS=yes
if ! command -v ss >/dev/null 2>&1; then
  HAVE_SS=no
  shared+=("cannot list listening sockets: 'ss' is not installed (package iproute2)")
fi

LISTENERS="$(listeners)"

# --- 1. who already holds :80 and :443? -------------------------------------
# Loopback holders count too: nginx's `listen 80` binds the wildcard address,
# and Linux refuses that while 127.0.0.1:80 is taken, so nginx would not start.
while read -r host port proc; do
  [ -n "${port:-}" ] || continue
  case "$port" in 80|443) ;; *) continue ;; esac
  case "$proc" in
    nginx) ;;   # judged by its configuration below, not by owning the port
    docker-proxy) shared+=(":$port is published by a container") ;;
    '?') shared+=(":$port is held by a process this check cannot identify (run it as root)") ;;
    *) shared+=(":$port is already held by '$proc'") ;;
  esac
done <<< "$LISTENERS"

# --- 2. containers publishing :80/:443 --------------------------------------
# With Docker's userland proxy disabled, a published port is pure NAT and has
# NO listening socket, so ss alone would miss it entirely.
if command -v docker >/dev/null 2>&1; then
  while IFS=$'\t' read -r name ports; do
    [ -n "${name:-}" ] || continue
    case "$name" in solutionmines-blue|solutionmines-green) continue ;; esac
    IFS=',' read -ra maps <<< "${ports:-}"
    for m in "${maps[@]}"; do
      m="${m// /}"
      case "$m" in *'->'*) ;; *) continue ;; esac
      hp="${m%%->*}"
      case "${hp##*:}" in 80|443) shared+=("container '$name' publishes :${hp##*:}") ;; esac
    done
  done < <(docker ps --format '{{.Names}}{{"\t"}}{{.Ports}}' 2>/dev/null)
fi

# --- 3. is nginx already serving another site? ------------------------------
NGX="$R/etc/nginx"

# The md5 dpkg recorded for the stock default site, or nothing if it cannot be
# established — in which case the file is treated as modified.
stock_default_md5() {
  local owner
  owner="$(dpkg -S /etc/nginx/sites-available/default 2>/dev/null \
    | grep -v '^diversion' | head -1 | cut -d: -f1 | cut -d, -f1 | tr -d ' ')"
  [ -n "$owner" ] || return 0
  dpkg-query -W -f='${Conffiles}\n' "$owner" 2>/dev/null \
    | awk '$1 == "/etc/nginx/sites-available/default" { print $2; exit }'
}

if [ -d "$NGX" ]; then
  for f in "$NGX"/sites-enabled/*; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    name="${f##*/}"
    case "$name" in
      solutionmines) ;;
      default)
        # bootstrap deletes this one, so it must be provably the untouched stock
        # file. Anyone who put their site in `default` loses it otherwise.
        target="$f"
        if [ -L "$f" ]; then
          t="$(readlink "$f")"
          case "$t" in /*) target="$R$t" ;; *) target="$NGX/sites-enabled/$t" ;; esac
        fi
        want="$(stock_default_md5)"
        got="$( [ -f "$target" ] && md5sum "$target" | awk '{ print $1 }' )"
        if [ -z "$want" ] || [ "$want" != "$got" ]; then
          shared+=("nginx's 'default' site is not the stock file — it may be serving another site, and bootstrap would delete it")
        fi
        ;;
      *) shared+=("nginx already serves another site: sites-enabled/$name") ;;
    esac
  done

  for f in "$NGX"/conf.d/*.conf; do
    [ -e "$f" ] || continue
    case "${f##*/}" in solutionmines-*) continue ;; esac
    if grep -qE '^[[:space:]]*server[[:space:]]*\{' "$f"; then
      shared+=("nginx conf.d/${f##*/} defines a server block")
    fi
  done

  if [ -f "$NGX/nginx.conf" ] && grep -qE '^[[:space:]]*server[[:space:]]*\{' "$NGX/nginx.conf"; then
    shared+=("nginx.conf itself defines a server block")
  fi
fi

# The effective config catches server blocks pulled in from anywhere — custom
# include paths the file scan above does not know about.
if command -v nginx >/dev/null 2>&1; then
  while read -r cfg; do
    case "$cfg" in
      */solutionmines|*/solutionmines-*.conf|*/sites-enabled/default) ;;
      *) shared+=("nginx serves a site from $cfg") ;;
    esac
  done < <(nginx -T 2>/dev/null | awk '
    /^# configuration file / { file = $4; sub(/:$/, "", file); next }
    /^[[:space:]]*server[[:space:]]*\{/ { if (!(file in seen)) { seen[file] = 1; print file } }')
fi

# --- 4. firewall: would switching on ufw cut anything off? ------------------
# sshd -T reports the configured port even under Ubuntu's socket activation,
# where the listening socket belongs to systemd rather than to sshd.
SSH_PORTS="$( { sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }'
                printf '%s\n' "$LISTENERS" | awk '$3 == "sshd" { print $2 }'; } \
  | grep -E '^[0-9]+$' | sort -un | tr '\n' ' ' | sed 's/ $//')"

ufw_state=missing
if command -v ufw >/dev/null 2>&1; then
  if ufw status 2>/dev/null | grep -q '^Status: active'; then ufw_state=active; else ufw_state=inactive; fi
fi

while read -r host port proc; do
  [ -n "${port:-}" ] || continue
  is_loopback "$host" && continue
  case "$port" in 80|443) continue ;; esac
  case " $SSH_PORTS " in *" $port "*) continue ;; esac
  # Docker's NAT rules bypass ufw entirely, so a firewall would not cut these off.
  [ "$proc" = docker-proxy ] && continue
  exposed+=("$port ($proc)")
done <<< "$LISTENERS"

SHARED=no
[ "${#shared[@]}" -gt 0 ] && SHARED=yes

# An already-active firewall only ever gets rules ADDED by bootstrap, so it is
# safe. An inactive one is safe to switch on only if we know which port SSH is
# on — otherwise we would lock ourselves out — and nothing else is exposed.
UFW_SAFE=no
if [ "$ufw_state" = active ]; then
  UFW_SAFE=yes
elif [ "$HAVE_SS" = yes ] && [ -n "$SSH_PORTS" ] && [ "${#exposed[@]}" -eq 0 ]; then
  # Without ss, "nothing else exposed" would only mean "nothing seen".
  UFW_SAFE=yes
fi

# --- report -----------------------------------------------------------------
report() {
  echo "== preflight =="
  if [ "$SHARED" = yes ]; then
    echo "SHARED BOX — something else already serves web traffic here:"
    printf '%s\n' "${shared[@]}" | sort -u | sed 's/^/  - /'
    echo "bootstrap.sh will refuse to install nginx or change the firewall here."
    echo "To deploy behind the existing proxy, see deploy/edge.env.example."
  else
    echo "dedicated: nothing else serves :80 or :443 here"
  fi
  echo "ssh port(s): ${SSH_PORTS:-UNKNOWN}"
  echo "firewall (ufw): $ufw_state"
  if [ "${#exposed[@]}" -gt 0 ]; then
    echo "also reachable from outside:"
    printf '%s\n' "${exposed[@]}" | sort -u | sed 's/^/  - /'
  fi
  if [ "$UFW_SAFE" = yes ]; then
    echo "firewall: safe for bootstrap to enable"
  else
    echo "firewall: NOT safe to enable — bootstrap will leave it as it is"
  fi
}

if [ "$EMIT" = yes ]; then
  report >&2
  printf 'SHARED=%s\nUFW_SAFE=%s\nSSH_PORTS=%s\n' \
    "$SHARED" "$UFW_SAFE" "$(printf '%s' "$SSH_PORTS" | tr -cd '0-9 ')"
else
  report
fi

[ "$SHARED" = yes ] && exit 3
exit 0
