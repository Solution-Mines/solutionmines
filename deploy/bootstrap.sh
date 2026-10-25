#!/usr/bin/env bash
# ============================================================================
# ONE-TIME server setup. Run as root on a fresh Debian/Ubuntu VPS:
#
#   git clone -b <branch> https://github.com/Solution-Mines/solutionmines.git ~/solutionmines
#   sudo bash ~/solutionmines/deploy/preflight.sh        # read-only: 0 = dedicated, 3 = shared
#   sudo bash ~/solutionmines/deploy/bootstrap.sh
#
# (deploy/bring-up.sh runs this for you; most people never call it directly.)
#
# Idempotent: safe to re-run. On a dedicated box it installs Docker, nginx and
# certbot, lays out /opt/solutionmines, creates a restricted `deploy` user for
# CI, and brings nginx up in HTTP-only mode so the first deploy can be
# verified on the bare IP BEFORE DNS is pointed at the box. A re-run never
# replaces a TLS site config that enable-tls.sh installed.
#
# It deliberately does NOT request a certificate. That needs DNS to resolve
# here first, so it is a separate step: deploy/enable-tls.sh
#
# It never switches a firewall on. If ufw is already active it adds the web
# ports; otherwise it prints the commands to run by hand.
#
# SHARED BOXES. If deploy/preflight.sh finds another site already serving web
# traffic here, this script REFUSES before changing anything, because
# installing nginx and taking default_server would take that site down. To
# deploy behind the box's existing proxy, create /opt/solutionmines/edge.env
# first (see deploy/edge.env.example): in that mode nginx, certificates and the
# firewall are left entirely to the existing setup, and Docker must already be
# installed. SM_FORCE_DEDICATED=1 overrides the refusal for someone who knows
# the box is theirs alone.
# ============================================================================
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/solutionmines
DEPLOY_USER=deploy
SITE=/etc/nginx/sites-available/solutionmines
UPSTREAM_DIR=/etc/nginx/solutionmines
UPSTREAM_FILE="$UPSTREAM_DIR/upstream.conf"
LEGACY_PROXY=/etc/nginx/conf.d/solutionmines-proxy.conf
LEGACY_UPSTREAM=/etc/nginx/conf.d/solutionmines-upstream.conf

log() { printf '\n== %s\n' "$*"; }

# --- the gate: before ANY change to the box --------------------------------
for f in guard.sh preflight.sh; do
  if [ ! -f "$REPO_DIR/deploy/$f" ]; then
    echo "refusing: $REPO_DIR/deploy/$f is missing; this checkout is too old to run safely."
    echo "Nothing has been changed."
    exit 1
  fi
done
# shellcheck source=deploy/guard.sh
. "$REPO_DIR/deploy/guard.sh"

gate_rc=0
sm_gate "$REPO_DIR/deploy/preflight.sh" "$APP_DIR/edge.env" \
  "$REPO_DIR/deploy/edge.env.example" "bash $REPO_DIR/deploy/bootstrap.sh" || gate_rc=$?
[ "$gate_rc" -eq 0 ] || exit "$gate_rc"
EDGE_MODE="$SM_EDGE_MODE"

if [ "$EDGE_MODE" = yes ]; then
  # Docker's installer rewrites the iptables FORWARD policy, which can cut off
  # the other site's containers or VMs. Not something to do to a shared box
  # as a side effect.
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    cat <<NODOCKER

== refusing: shared-edge mode, and Docker (with the compose plugin) is not installed ==

Installing Docker changes the box's iptables (it sets the FORWARD policy to
DROP), which can break the other site. Nothing has been changed. Install
Docker yourself, with whoever runs this box, then re-run:
  sudo bash $REPO_DIR/deploy/bootstrap.sh
NODOCKER
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "refusing: Docker is installed but its daemon is not answering ('docker info' failed)."
    echo "Nothing has been changed."
    exit 1
  fi
  log "shared-edge mode: the existing proxy handles routing, TLS and the firewall"
fi

# The CI user: created here, or one an earlier bootstrap of this site set up.
# Someone else's account of the same name is refused before anything changes.
DEPLOY_USER_STATE="$(sm_check_deploy_user "$DEPLOY_USER" "$APP_DIR")" || exit 1

export DEBIAN_FRONTEND=noninteractive
if [ "$EDGE_MODE" = yes ]; then
  # No nginx and no certbot: the box's own proxy owns :80/:443 and TLS. The
  # only thing deploy.sh needs from the box is curl, and on a shared box even
  # a package upgrade is not ours to make unless it is missing.
  if ! command -v curl >/dev/null 2>&1; then
    log "installing curl"
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl
  fi
else
  log "installing packages"
  apt-get update -qq
  # No ufw: this script never switches a firewall on (see the end), and
  # installing the package can remove netfilter-persistent from a box that
  # already has a firewall of its own.
  apt-get install -y -qq ca-certificates curl gnupg nginx certbot
fi

if [ "$EDGE_MODE" = no ]; then
  if ! command -v docker >/dev/null 2>&1; then
    log "installing docker engine"
    install -m 0755 -d /etc/apt/keyrings
    # shellcheck source=/dev/null
    . /etc/os-release
    # Ubuntu and Debian have separate repositories; ID picks the right one,
    # for the signing key as well as the packages.
    curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
      | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker
fi

# The shared network the proxy and the app containers meet on. Additive and
# idempotent, and harmless on a single-site box where nothing else joins it.
docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null

log "laying out $APP_DIR"
install -d -m 0755 "$APP_DIR"
[ "$EDGE_MODE" = yes ] || install -d -m 0755 /var/www/certbot
install -m 0755 "$REPO_DIR/deploy/deploy.sh"      "$APP_DIR/deploy.sh"
install -m 0755 "$REPO_DIR/deploy/enable-tls.sh"  "$APP_DIR/enable-tls.sh"
install -m 0755 "$REPO_DIR/deploy/start.sh"       "$APP_DIR/start.sh"
install -m 0755 "$REPO_DIR/deploy/preflight.sh"   "$APP_DIR/preflight.sh"
install -m 0644 "$REPO_DIR/deploy/guard.sh"       "$APP_DIR/guard.sh"
install -m 0644 "$REPO_DIR/deploy/edge.env.example" "$APP_DIR/edge.env.example"
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
# Only needed while the GHCR package ghcr.io/solution-mines/solutionmines is
# PRIVATE (the default for an organisation's packages). Either fill these in
# with a classic PAT scoped to read:packages, for an account that can read
# that package, or leave them blank and make the package public instead.
GHCR_USER=
GHCR_TOKEN=
REGEOF
  chmod 600 "$APP_DIR/registry.env"
fi

if [ "$EDGE_MODE" = no ]; then
  log "configuring nginx"
  # Only the zones file goes in conf.d: nginx loads every conf.d/*.conf at
  # http level, where the proxy snippet and the bare upstream line are
  # syntax errors that fail `nginx -t` for the whole box.
  install -m 0644 "$REPO_DIR/deploy/nginx/solutionmines-zones.conf" /etc/nginx/conf.d/solutionmines-zones.conf
  install -d -m 0755 /etc/nginx/snippets "$UPSTREAM_DIR"
  install -m 0644 "$REPO_DIR/deploy/nginx/solutionmines-proxy.conf" /etc/nginx/snippets/solutionmines-proxy.conf
  # deploy.sh rewrites this on every switch. Created once: carried over from
  # the old conf.d location, or pointed at the colour image.env says is live.
  if [ ! -f "$UPSTREAM_FILE" ]; then
    sm_initial_upstream "$LEGACY_UPSTREAM" "$APP_DIR/image.env" > "$UPSTREAM_FILE"
    chmod 644 "$UPSTREAM_FILE"
  fi
  rm -f "$LEGACY_PROXY" "$LEGACY_UPSTREAM"

  if sm_site_needs_http_config "$SITE"; then
    log "installing the HTTP-only site (until a certificate exists)"
    install -m 0644 "$REPO_DIR/deploy/nginx/solutionmines-http.conf" "$SITE"
  else
    log "keeping the existing TLS site config (enable-tls.sh installed it)"
    # A TLS site from before the layout change still includes the proxy
    # snippet from conf.d. Point it at the new path.
    if grep -q "$LEGACY_PROXY" "$SITE"; then
      tmp="$(mktemp "$APP_DIR/.site.XXXXXX")"
      sed "s#$LEGACY_PROXY#/etc/nginx/snippets/solutionmines-proxy.conf#g" "$SITE" > "$tmp"
      chmod 644 "$tmp"
      mv -f "$tmp" "$SITE"
    fi
  fi
  ln -sfn "$SITE" /etc/nginx/sites-enabled/solutionmines
  # Debian's default site also claims default_server on :80 and would collide.
  # Preflight has proved it is the untouched stock file, so nobody's site is in
  # it; unless SM_FORCE_DEDICATED=1 skipped that proof. So only the symlink is
  # ever deleted, and a real file is moved aside, never destroyed.
  if [ -L /etc/nginx/sites-enabled/default ]; then
    rm -f /etc/nginx/sites-enabled/default
  elif [ -e /etc/nginx/sites-enabled/default ]; then
    moved="$APP_DIR/sites-enabled-default.$(date -u +%Y%m%dT%H%M%SZ)"
    mv /etc/nginx/sites-enabled/default "$moved"
    echo "   moved /etc/nginx/sites-enabled/default (a file, not a link) to $moved"
  fi
fi

log "creating the $DEPLOY_USER user for CI"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
# NOT in the docker group: membership is root on the box in all but name
# (`docker run -v /:/host`). CI only ever runs `sudo deploy.sh`, which is
# root anyway. Taken back out if an older version of this script put it in;
# an adopted account's groups are its owner's business.
if [ "$DEPLOY_USER_STATE" = ours ] && id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then
  gpasswd -d "$DEPLOY_USER" docker >/dev/null
  echo "   removed $DEPLOY_USER from the docker group"
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

# CI needs root ONLY to run the blue/green switch. It gets exactly that one
# script and nothing else — not a general sudo grant, and not enable-tls.sh,
# which CI never calls. A compromised CI token should not be a root shell on
# the box.
cat > /etc/sudoers.d/solutionmines <<SUDOEOF
$DEPLOY_USER ALL=(root) NOPASSWD: $APP_DIR/deploy.sh
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
else
  sm_dedicated_firewall "$SM_SSH_PORTS"
fi

if [ "$EDGE_MODE" = no ]; then
  nginx -t
  systemctl reload nginx || systemctl restart nginx
fi

if [ "$EDGE_MODE" = yes ]; then
  cat <<EDGEDONE

== bootstrap complete (shared-edge mode) ==

nginx, certificates and the firewall were not touched; Docker was already here.
The docker network \`edge\` exists. Before deploying:

  1. The proxy must join the \`edge\` network if it runs in a container, or it
     cannot reach solutionmines-blue / solutionmines-green by name:
       sudo docker network connect edge <proxy-container>
  2. Create the UPSTREAM_FILE named in /opt/solutionmines/edge.env first, in
     a root-owned directory of its own, holding the one line UPSTREAM_LINE
     gives for blue (e.g. 'reverse_proxy solutionmines-blue:3000' or
     'server 127.0.0.1:3001;'): the proxy's test fails on an import of a
     file that does not exist.
  3. Then add this site's block to the proxy, importing that file, test the
     proxy's config, and make sure SMOKE_URL uses a hostname that block
     matches.
  4. Fill in $APP_DIR/app.env.

Then deploy (CI, or deploy/bring-up.sh).
EDGEDONE
  exit 0
fi

cat <<DONE

== bootstrap complete ==

Next, in order:

  1. Add CI's public key to /home/$DEPLOY_USER/.ssh/authorized_keys
  2. Fill in $APP_DIR/app.env  (chmod 600, already created)
  2b. Make the GHCR package ghcr.io/solution-mines/solutionmines public, OR
      fill in $APP_DIR/registry.env — organisation packages are private by
      default, and the first pull will 401 otherwise
  3. Push to main, or run the "Deploy" workflow — it builds and ships
  4. Verify on the bare IP:  curl -s http://<this-server-ip>/api/health
  5. Point DNS at this box (A @ -> ip, A www -> ip)
  6. Once DNS resolves here:  sudo $APP_DIR/enable-tls.sh <domain> <email>

Nothing is indexable until step 6 — the HTTP-only config sends
X-Robots-Tag: noindex on every response.
DONE
