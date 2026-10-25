#!/usr/bin/env bash
# ============================================================================
# ONE-TIME server setup. Run as root on a fresh Debian/Ubuntu VPS:
#
#   git clone https://github.com/azariahjerish/solutionmines.git /tmp/sm
#   bash /tmp/sm/deploy/bootstrap.sh
#
# Idempotent: safe to re-run. It installs Docker, nginx and certbot, lays out
# /opt/solutionmines, creates a restricted `deploy` user for CI, and brings
# nginx up in HTTP-only mode so the first deploy can be verified on the bare
# IP BEFORE DNS is pointed at the box.
#
# It deliberately does NOT request a certificate. That needs DNS to resolve
# here first, so it is a separate step: deploy/enable-tls.sh
#
# SHARED BOXES. If deploy/preflight.sh finds another site already serving web
# traffic here, this script REFUSES to run, because installing nginx, taking
# default_server and switching on a firewall would take that site down. To
# deploy behind the box's existing proxy, create /opt/solutionmines/edge.env
# first (see deploy/edge.env.example): in that mode nginx, certificates and the
# firewall are left entirely to the existing setup. SM_FORCE_DEDICATED=1
# overrides the refusal for someone who knows the box is theirs alone.
# ============================================================================
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/solutionmines
DEPLOY_USER=deploy

log() { printf '\n== %s\n' "$*"; }

# --- preflight: before ANY change to the box -------------------------------
EDGE_MODE=no
[ -f "$APP_DIR/edge.env" ] && EDGE_MODE=yes

pf_rc=0
PF="$(bash "$REPO_DIR/deploy/preflight.sh" --emit)" || pf_rc=$?
# Parsed field by field, never eval'd: the values come from process and
# container names on the box, which are not ours to trust.
pf() { printf '%s\n' "$PF" | sed -n "s/^$1=//p" | head -1; }
SHARED="$(pf SHARED)"
UFW_SAFE="$(pf UFW_SAFE)"
SSH_PORTS="$(pf SSH_PORTS | tr -cd '0-9 ')"

if [ "$pf_rc" -ne 0 ] && [ "$pf_rc" -ne 3 ]; then
  echo "preflight failed to run (exit $pf_rc) — refusing to change anything"; exit 1
fi
if [ "$SHARED" != yes ] && [ "$SHARED" != no ]; then
  echo "preflight gave no verdict — refusing to change anything"; exit 1
fi

if [ "$SHARED" = yes ] && [ "$EDGE_MODE" = no ] && [ "${SM_FORCE_DEDICATED:-0}" != 1 ]; then
  cat <<REFUSE

== refusing: this box already serves another site ==

Installing nginx here, taking default_server on :80/:443 and switching on a
firewall would take that site down. Nothing has been changed.

To deploy behind the proxy that is already here:
  1. sudo install -d /opt/solutionmines
  2. sudo cp $REPO_DIR/deploy/edge.env.example /opt/solutionmines/edge.env
  3. edit it for this box's proxy, then re-run this script

If you are certain the box is dedicated to this site and preflight is wrong:
  sudo SM_FORCE_DEDICATED=1 bash $0
REFUSE
  exit 3
fi

if [ "$EDGE_MODE" = yes ]; then
  log "shared-edge mode: the existing proxy handles routing, TLS and the firewall"
fi

log "installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
if [ "$EDGE_MODE" = yes ]; then
  # No nginx and no certbot: the box's own proxy owns :80/:443 and TLS.
  apt-get install -y -qq ca-certificates curl gnupg
else
  apt-get install -y -qq ca-certificates curl gnupg nginx certbot python3-certbot-nginx ufw
fi

if ! command -v docker >/dev/null 2>&1; then
  log "installing docker engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  # Ubuntu and Debian have separate repositories; ID picks the right one.
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# The shared network the proxy and the app containers meet on. Idempotent, and
# harmless on a single-site box where nothing else is attached to it.
docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null

log "laying out $APP_DIR"
install -d -m 0755 "$APP_DIR"
install -d -m 0755 /var/www/certbot
install -m 0755 "$REPO_DIR/deploy/deploy.sh"      "$APP_DIR/deploy.sh"
install -m 0755 "$REPO_DIR/deploy/enable-tls.sh"  "$APP_DIR/enable-tls.sh"
install -m 0755 "$REPO_DIR/deploy/start.sh"       "$APP_DIR/start.sh"
install -m 0644 "$REPO_DIR/deploy/docker-compose.yml" "$APP_DIR/docker-compose.yml"
install -d -m 0755 "$APP_DIR/nginx"
install -m 0644 "$REPO_DIR"/deploy/nginx/*.conf "$APP_DIR/nginx/"

# The runtime secrets file. Created empty and 0600 — real values are pasted in
# by hand, never committed and never printed by any script here.
if [ ! -f "$APP_DIR/app.env" ]; then
  log "creating $APP_DIR/app.env (empty — fill it in before going live)"
  cat > "$APP_DIR/app.env" <<'ENVEOF'
# Runtime environment for the container. NOT build-time values: anything
# NEXT_PUBLIC_* or SITE_ENV is baked into the image by CI instead.
#
# Mail is validated at boot. Leave ALL of these blank and the app logs
# enquiries to stdout with a warning. Fill them in PARTIALLY and the container
# refuses to start, naming the missing key — which the deploy health check
# catches and rolls back, rather than losing a week of leads silently.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=
MAIL_FROM_NAME=SolutionMines
CONTACT_RECIPIENT_EMAIL=
ENVEOF
  chmod 600 "$APP_DIR/app.env"
fi

# Optional registry credentials. Only needed if the GHCR package is left
# private — see the note in deploy.sh. Created empty so the shape is obvious.
if [ ! -f "$APP_DIR/registry.env" ]; then
  cat > "$APP_DIR/registry.env" <<'REGEOF'
# Only needed if the GHCR package is PRIVATE (the default, even for a public
# repo). Either fill these in with a classic PAT scoped to read:packages, or
# leave them blank and make the package public instead.
GHCR_USER=
GHCR_TOKEN=
REGEOF
  chmod 600 "$APP_DIR/registry.env"
fi

if [ "$EDGE_MODE" = no ]; then
  log "configuring nginx (HTTP-only until a certificate exists)"
  install -m 0644 "$REPO_DIR/deploy/nginx/solutionmines-zones.conf" /etc/nginx/conf.d/solutionmines-zones.conf
  install -m 0644 "$REPO_DIR/deploy/nginx/solutionmines-proxy.conf" /etc/nginx/conf.d/solutionmines-proxy.conf
  # Point at blue by default; deploy.sh rewrites this on every switch.
  [ -f /etc/nginx/conf.d/solutionmines-upstream.conf ] || \
    echo "server 127.0.0.1:3001;" > /etc/nginx/conf.d/solutionmines-upstream.conf
  install -m 0644 "$REPO_DIR/deploy/nginx/solutionmines-http.conf" /etc/nginx/sites-available/solutionmines
  ln -sfn /etc/nginx/sites-available/solutionmines /etc/nginx/sites-enabled/solutionmines
  # Debian's default site also claims default_server on :80 and would collide.
  # Preflight has already proved it is the untouched stock file, so nobody's
  # site is in it.
  rm -f /etc/nginx/sites-enabled/default
fi

log "creating the $DEPLOY_USER user for CI"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

# CI needs root ONLY to rewrite the nginx upstream and reload. It gets exactly
# those two scripts and nothing else — not a general sudo grant, because a
# compromised CI token should not be a root shell on the box.
cat > /etc/sudoers.d/solutionmines <<SUDOEOF
$DEPLOY_USER ALL=(root) NOPASSWD: $APP_DIR/deploy.sh, $APP_DIR/enable-tls.sh
SUDOEOF
chmod 440 /etc/sudoers.d/solutionmines
visudo -cf /etc/sudoers.d/solutionmines

log "installing the systemd unit"
install -m 0644 "$REPO_DIR/deploy/solutionmines.service" /etc/systemd/system/solutionmines.service
systemctl daemon-reload
systemctl enable solutionmines.service

log "firewall"
if [ "$EDGE_MODE" = yes ]; then
  echo "   left untouched: a shared box's firewall belongs to whoever runs the box"
elif [ "$UFW_SAFE" != yes ]; then
  echo "   NOT enabled: preflight found other services reachable from outside, or"
  echo "   could not determine the SSH port. Switching a firewall on blind can cut"
  echo "   them off or lock you out. Review the preflight output and enable it by hand."
else
  # Open the port(s) sshd ACTUALLY listens on, not the 'OpenSSH' profile, which
  # means 22 only: on a box with SSH elsewhere that profile is a lockout.
  for p in $SSH_PORTS; do ufw allow "$p/tcp" >/dev/null; done
  ufw allow 'Nginx Full' >/dev/null
  ufw --force enable >/dev/null
  ufw status | sed 's/^/   /'
fi

if [ "$EDGE_MODE" = no ]; then
  nginx -t
  systemctl reload nginx || systemctl restart nginx
fi

if [ "$EDGE_MODE" = yes ]; then
  cat <<EDGEDONE

== bootstrap complete (shared-edge mode) ==

nginx, certificates and the firewall were not touched. Before deploying, add a
site block for this site to the box's existing proxy that forwards to the
container named in /opt/solutionmines/edge.env, and make sure SMOKE_URL there
uses a hostname that site block actually matches.

Then fill in $APP_DIR/app.env and deploy (CI, or deploy/bring-up.sh).
EDGEDONE
  exit 0
fi

cat <<DONE

== bootstrap complete ==

Next, in order:

  1. Add CI's public key to /home/$DEPLOY_USER/.ssh/authorized_keys
  2. Fill in $APP_DIR/app.env  (chmod 600, already created)
  2b. Make the GHCR package public, OR fill in $APP_DIR/registry.env —
      packages are private by default even for a public repo, and the
      first pull will 401 otherwise
  3. Push to main, or run the "Deploy" workflow — it builds and ships
  4. Verify on the bare IP:  curl -s http://<this-server-ip>/api/health
  5. Point DNS at this box (A @ -> ip, A www -> ip)
  6. Once DNS resolves here:  sudo $APP_DIR/enable-tls.sh <domain> <email>

Nothing is indexable until step 6 — the HTTP-only config sends
X-Robots-Tag: noindex on every response.
DONE
