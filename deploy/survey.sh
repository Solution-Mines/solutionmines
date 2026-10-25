#!/usr/bin/env bash
# ============================================================================
# SURVEY: what is already on this server?
#
#   sudo bash deploy/survey.sh
#
# READ-ONLY. It changes nothing, and it prints no secrets: no .env files, no
# full proxy configs, no keys. Only names, ports, versions and site
# addresses. NAT rules are shown as chain names and ports, never their
# destinations. It exists so a deploy can be planned around whatever already
# lives on the box, instead of discovering it by breaking it.
#
# Read the output before pasting it anywhere. It lists the domains of every
# site on this box, which is your information to share or not.
# ============================================================================
set -uo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
section() { printf '\n===== %s =====\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

section "system"
if [ -r /etc/os-release ]; then (. /etc/os-release; echo "${PRETTY_NAME:-unknown}"); fi
echo "kernel $(uname -r), $(nproc) cpu"
free -h | sed -n '1,3p'
df -h / | tail -1

section "preflight (is this box shared?)"
# Exactly how bootstrap runs it: a clean environment, nothing inherited.
env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin bash "$HERE/preflight.sh"
echo "(preflight exit code: $?; 0 dedicated, 3 shared or not verifiable, other: preflight broke)"

section "listening TCP sockets"
if have ss; then ss -ltnp 2>&1 | head -60; else echo "ss: not installed (package iproute2)"; fi

section "listening UDP sockets"
if have ss; then ss -lunp 2>&1 | head -60; else echo "ss: not installed (package iproute2)"; fi

section "NAT rules touching ports 80/443 (chain and ports only)"
# A port published by NAT alone has no listening socket. Only the chain, the
# target and the port match are printed; destinations are left out.
nat_ports() {   # reads iptables-save output on stdin
  awk '
    /^-A / {
      chain = $2; tg = ""; ports = ""
      for (i = 3; i <= NF; i++) {
        if ($i == "-j") tg = $(i + 1)
        if ($i == "--dport" || $i == "--dports" || $i == "--destination-port" || $i == "--destination-ports") {
          neg = ($(i - 1) == "!") ? "!" : ""
          ports = ports " " neg $(i + 1)
        }
      }
      if (tg != "DNAT" && tg != "REDIRECT" && tg != "TPROXY" && tg != "NETMAP") next
      if (ports == "" || ports ~ /(^|[ ,:!])(80|443)([ ,:]|$)/ || ports ~ /:/ || ports ~ /!/)
        printf "  chain %s: %s%s\n", chain, tg, (ports == "" ? " (no port match: all ports)" : " dport" ports)
    }'
}
found=no
for t in iptables-save ip6tables-save; do
  have "$t" || continue
  found=yes
  echo "--- $t -t nat:"
  "$t" -t nat 2>&1 | nat_ports | head -40
done
if have nft; then
  found=yes
  echo "--- nft list ruleset (nat statements):"
  nft list ruleset 2>/dev/null | awk '
    /^[ \t]*chain / { chain = $2; next }
    /(^|[ \t])(dnat|redirect|tproxy)([ \t]|$)/ {
      ports = ""
      for (i = 2; i <= NF; i++) if ($i == "dport") {
        j = i + 1; v = $j
        if (v == "!=") { j++; v = "!=" $j }
        if ($j == "{") { v = ""; for (k = j + 1; k <= NF && $k != "}"; k++) v = v $k; v = "{" v "}" }
        ports = ports " " v
      }
      if (ports == "" || ports ~ /(80|443)/ || ports ~ /[-!@]/)
        printf "  chain %s: %s\n", chain, (ports == "" ? "nat statement, no port match (all ports)" : "nat statement, dport" ports)
    }' | head -40
fi
[ "$found" = yes ] || echo "(no iptables-save, ip6tables-save or nft found)"
if [ -r /proc/net/ip_vs ]; then
  echo "--- IPVS virtual services (protocol, hex port):"
  awk '$1 == "TCP" || $1 == "UDP" || $1 == "SCTP" || $1 == "FWM" { n = split($2, a, ":"); print "  " $1 " port 0x" a[n] }' /proc/net/ip_vs | head -20
fi

section "containers"
# Only ask docker when dockerd is already running: after `systemctl stop
# docker`, docker.socket still listens, and the first client call would start
# the daemon and every container with a restart policy (preflight does the
# same; see deploy/preflight.sh).
dockerd_pid="$(cat /run/docker.pid 2>/dev/null)"
if ! have docker; then
  echo "docker: not installed"
elif [ -z "$dockerd_pid" ] || [ "$(cat "/proc/$dockerd_pid/comm" 2>/dev/null)" != dockerd ]; then
  echo "docker: installed, but dockerd is not running (not started by this survey)"
  if [ -d /var/lib/docker/containers ]; then
    echo "containers on disk (would start with the daemon if their restart policy says so): $(find /var/lib/docker/containers -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
  fi
else
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>&1 | head -40
  echo
  docker network ls --format 'network: {{.Name}} ({{.Driver}})' 2>&1 | head -20
fi

section "web servers installed"
for b in nginx openresty caddy traefik apache2 httpd haproxy envoy; do
  have "$b" && echo "$b: $("$b" -v 2>&1 | head -1)"
done
echo "(end)"

section "nginx sites"
ls -la /etc/nginx/sites-enabled /etc/nginx/conf.d 2>&1
echo "--- this site's own nginx files (present or not):"
for f in /etc/nginx/sites-available/solutionmines /etc/nginx/sites-enabled/solutionmines \
         /etc/nginx/conf.d/solutionmines-zones.conf /etc/nginx/snippets/solutionmines-proxy.conf \
         /etc/nginx/solutionmines/upstream.conf \
         /etc/nginx/conf.d/solutionmines-proxy.conf /etc/nginx/conf.d/solutionmines-upstream.conf; do
  if [ -L "$f" ]; then echo "  $f -> $(readlink "$f")"
  elif [ -e "$f" ]; then echo "  $f"
  else echo "  $f (absent)"; fi
done
if have nginx; then
  echo "--- addresses served (from the effective config):"
  nginx -T 2>/dev/null | grep -E '^# configuration file|^[[:space:]]*(server_name|listen)[[:space:]]' | head -80
fi

section "caddy sites"
found=no
for f in /etc/caddy/Caddyfile /opt/*/Caddyfile /opt/*/*/Caddyfile /srv/*/Caddyfile; do
  [ -f "$f" ] || continue
  found=yes
  echo "--- $f"
  # site addresses only: unindented lines that open a block
  grep -vE '^[[:space:]]*#' "$f" | grep -E '^[^[:space:]].*\{[[:space:]]*$' | head -40
done
[ "$found" = yes ] || echo "(no Caddyfile found in the usual places)"

section "firewall"
if have ufw; then ufw status verbose 2>&1 | head -30; else echo "ufw: not installed"; fi

section "ssh"
sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication) ' \
  || echo "(sshd -T unavailable; run as root)"

section "/opt"
ls -la /opt 2>&1

section "this site"
if [ -d /opt/solutionmines ]; then
  ls -la /opt/solutionmines
  echo "--- deployed image:"
  cat /opt/solutionmines/image.env 2>/dev/null || echo "(never deployed)"
  [ -f /opt/solutionmines/edge.env ] && echo "--- edge.env present (shared-edge mode)"
else
  echo "/opt/solutionmines does not exist: never bootstrapped"
fi

echo
echo "===== end of survey ====="
