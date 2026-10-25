#!/usr/bin/env bash
# ============================================================================
# SURVEY — what is already on this server?
#
#   sudo bash deploy/survey.sh
#
# READ-ONLY. It changes nothing, and it prints no secrets: no .env files, no
# full proxy configs, no keys — only names, ports, versions and site
# addresses. It exists so a deploy can be planned around whatever already
# lives on the box, instead of discovering it by breaking it.
#
# Read the output before pasting it anywhere. It lists the domains of every
# site on this box, which is your information to share or not.
# ============================================================================
set -uo pipefail

section() { printf '\n===== %s =====\n' "$*"; }

section "system"
if [ -r /etc/os-release ]; then . /etc/os-release; echo "${PRETTY_NAME:-unknown}"; fi
echo "kernel $(uname -r), $(nproc) cpu"
free -h | sed -n '1,3p'
df -h / | tail -1

section "preflight (is this box shared?)"
bash "$(dirname "${BASH_SOURCE[0]}")/preflight.sh"
echo "(preflight exit code: $?)"

section "listening TCP sockets"
ss -ltnp 2>&1 | head -60

section "containers"
if command -v docker >/dev/null 2>&1; then
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>&1 | head -40
  echo
  docker network ls --format 'network: {{.Name}} ({{.Driver}})' 2>&1 | head -20
else
  echo "docker: not installed"
fi

section "web servers installed"
for b in nginx caddy traefik apache2 httpd haproxy; do
  command -v "$b" >/dev/null 2>&1 && echo "$b: $("$b" -v 2>&1 | head -1)"
done
echo "(end)"

section "nginx sites"
ls -la /etc/nginx/sites-enabled /etc/nginx/conf.d 2>&1
if command -v nginx >/dev/null 2>&1; then
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
ufw status verbose 2>&1 | head -30

section "ssh"
sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication) ' \
  || echo "(sshd -T unavailable — run as root)"

section "/opt"
ls -la /opt 2>&1

section "this site"
if [ -d /opt/solutionmines ]; then
  ls -la /opt/solutionmines
  echo "--- deployed image:"
  cat /opt/solutionmines/image.env 2>/dev/null || echo "(never deployed)"
  [ -f /opt/solutionmines/edge.env ] && echo "--- edge.env present (shared-edge mode)"
else
  echo "/opt/solutionmines does not exist — never bootstrapped"
fi

echo
echo "===== end of survey ====="
