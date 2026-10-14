#!/usr/bin/env bash
# ============================================================================
# FIRST BRING-UP — from a bare server to a live site, in one command.
#
#   sudo bash deploy/bring-up.sh [branch]
#
# This is the path that needs NOTHING from GitHub: no Actions secrets, no
# GHCR, no merge to main. It clones the branch, builds the image on the box,
# and runs the same blue/green deploy CI would have run.
#
# Building on the server is explicitly NOT how this should work long term —
# see docs/03-deployment.md. It is slow, and on a small box it can OOM while
# the live site shares the machine. It is here because "live today on the IP"
# beats "live next week through a perfect pipeline", and because every later
# deploy goes through CI properly once the secrets are set.
# ============================================================================
set -euo pipefail

BRANCH="${1:-claude/blissful-babbage-4uy884}"
REPO_URL="${REPO_URL:-https://github.com/azariahjerish/solutionmines.git}"
SRC_DIR=/opt/solutionmines-src
APP_DIR=/opt/solutionmines

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }

log() { printf '\n== %s\n' "$*"; }

# --- memory guard -----------------------------------------------------------
# `next build` wants roughly 2 GB. Finding that out by having the OOM killer
# take the build — or worse, the running site — is a bad way to learn it.
total_mb="$(free -m | awk 'NR==2{print $2}')"
swap_mb="$(free -m | awk 'NR==3{print $2}')"
log "memory: ${total_mb} MB RAM, ${swap_mb} MB swap"
if [ "$total_mb" -lt 1800 ] && [ "$((total_mb + swap_mb))" -lt 2600 ]; then
  log "adding 2 GB of swap for the build (small box, and the build needs ~2 GB)"
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log "swap enabled"
  fi
fi

# --- source -----------------------------------------------------------------
log "fetching $BRANCH"
if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" remote set-url origin "$REPO_URL"
  git -C "$SRC_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$SRC_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  rm -rf "$SRC_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
fi
SHA="$(git -C "$SRC_DIR" rev-parse HEAD)"
log "at $SHA"

# --- server setup (idempotent) ---------------------------------------------
if [ ! -x "$APP_DIR/deploy.sh" ]; then
  log "running bootstrap (first time only)"
  bash "$SRC_DIR/deploy/bootstrap.sh"
else
  log "refreshing deploy scripts and nginx config"
  install -m 0755 "$SRC_DIR/deploy/deploy.sh"     "$APP_DIR/deploy.sh"
  install -m 0755 "$SRC_DIR/deploy/enable-tls.sh" "$APP_DIR/enable-tls.sh"
  install -m 0755 "$SRC_DIR/deploy/start.sh"      "$APP_DIR/start.sh"
  install -m 0644 "$SRC_DIR/deploy/docker-compose.yml" "$APP_DIR/docker-compose.yml"
  install -m 0644 "$SRC_DIR"/deploy/nginx/*.conf "$APP_DIR/nginx/"
fi

# --- the canonical origin ---------------------------------------------------
# Baked into the image, because the routes using it are statically generated.
# Until DNS exists, the server's own IP is the honest value — it is what the
# links in the page will point at, and it is what you are about to browse.
PUBLIC_IP="$(curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
SITE_URL="${SITE_URL:-http://$PUBLIC_IP}"
# SITE_ENV stays non-production until a real domain is live, so robots.txt
# serves `Disallow: /` and this never gets indexed on a bare IP.
SITE_ENV_VALUE="${SITE_ENV:-staging}"
log "building with NEXT_PUBLIC_SITE_URL=$SITE_URL SITE_ENV=$SITE_ENV_VALUE"

IMAGE="solutionmines:$SHA"
log "building $IMAGE (first build takes a few minutes)"
docker build \
  --build-arg "GIT_COMMIT_SHA=$SHA" \
  --build-arg "SITE_ENV=$SITE_ENV_VALUE" \
  --build-arg "NEXT_PUBLIC_SITE_URL=$SITE_URL" \
  -t "$IMAGE" \
  "$SRC_DIR"

# --- deploy -----------------------------------------------------------------
log "deploying"
"$APP_DIR/deploy.sh" "$IMAGE" "$SHA"

log "verifying from outside nginx"
sleep 2
curl -fsS --max-time 8 "http://127.0.0.1/api/health" && echo

cat <<DONE

== live ==

  http://$PUBLIC_IP          <- open this in a browser
  http://$PUBLIC_IP/api/health

Port 80 only. There is deliberately nothing on 3001/3002 from outside: the app
binds to 127.0.0.1 and only nginx can reach it.

Not indexable yet — robots.txt serves Disallow: / and nginx sends
X-Robots-Tag: noindex until a real domain and TLS are in place.

Next:
  1. Point DNS at this box
  2. sudo $APP_DIR/enable-tls.sh <domain> <email>
  3. Set SITE_URL to https://<domain> and re-run this script once, so the
     canonical URLs, sitemap and JSON-LD stop pointing at the IP
  4. Add the Actions secrets so later deploys go through CI instead of here
DONE
