#!/usr/bin/env bash
# ============================================================================
# FIRST BRING-UP — from a bare server to a live site, in one command.
#
#   sudo bash deploy/bring-up.sh [branch]
#
# The branch defaults to the one the checkout this script lives in is on
# (main if it is not on a branch). Pass it explicitly anyway: it is the code
# that will be fetched into /opt/solutionmines-src and run.
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
#
# On a box that already serves another site it REFUSES before changing
# anything, unless /opt/solutionmines/edge.env sets up shared-edge mode (or
# SM_FORCE_DEDICATED=1 says the box is dedicated after all). It checks twice:
# once with this checkout, before it touches anything, and again with the
# code it fetched, before that code runs. See deploy/guard.sh and
# deploy/preflight.sh.
#
# In shared-edge mode it does not add swap unless SM_ALLOW_SWAP=1.
#
# Settings read from the environment (sudo VAR=value bash bring-up.sh ...):
#   SITE_URL   the canonical origin baked into the image (default: http://<server IP>)
#   SITE_ENV   production once the real domain is live (default: staging,
#              which serves robots.txt `Disallow: /`)
#   REPO_URL   the repository to fetch (default: the project's GitHub URL)
# ============================================================================
set -euo pipefail

# Read the caller's settings here, at top level: inside main() they are
# declared `local`, and a bare `local NAME` hides the exported value.
SM_SITE_URL_IN="${SITE_URL:-}"
SM_SITE_ENV_IN="${SITE_ENV:-}"
SM_REPO_URL_IN="${REPO_URL:-}"

# Everything runs from main(), so bash has read the whole file before the
# fetch below can rewrite it (when this checkout IS /opt/solutionmines-src).
main() {
  local HERE REPO_URL SRC_DIR APP_DIR BRANCH gate_rc
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_URL="${SM_REPO_URL_IN:-https://github.com/Solution-Mines/solutionmines.git}"
  SRC_DIR=/opt/solutionmines-src
  APP_DIR=/opt/solutionmines

  [ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }

  log() { printf '\n== %s\n' "$*"; }

  for f in guard.sh preflight.sh edge.env.example; do
    if [ ! -f "$HERE/$f" ]; then
      echo "refusing: $HERE/$f is missing; this checkout is too old to run safely."
      echo "Nothing has been changed."
      exit 1
    fi
  done
  # shellcheck source=deploy/guard.sh
  . "$HERE/guard.sh"

  BRANCH="${1:-$(sm_default_branch "$HERE")}"
  if ! [[ $BRANCH =~ ^[A-Za-z0-9._/-]+$ ]] || [[ $BRANCH == -* ]]; then
    echo "refusing: '$BRANCH' is not a branch name. Nothing has been changed."; exit 1
  fi
  log "branch: $BRANCH"

  # --- gate 1, this checkout: before ANY change to the box ------------------
  # This script clones the repo (and may add swap) before bootstrap.sh ever
  # runs, so it cannot rely on bootstrap's own check: by then it would
  # already have changed a box that might be someone else's.
  gate_rc=0
  sm_gate "$HERE/preflight.sh" "$APP_DIR/edge.env" "$HERE/edge.env.example" \
    "bash $HERE/bring-up.sh $BRANCH" || gate_rc=$?
  [ "$gate_rc" -eq 0 ] || exit "$gate_rc"
  local EDGE_MODE="$SM_EDGE_MODE"

  # Bootstrap would refuse someone else's `deploy` account; find out now,
  # before swap or the clone.
  sm_check_deploy_user deploy "$APP_DIR" >/dev/null || exit 1

  if ! command -v git >/dev/null 2>&1; then
    echo "refusing: git is not installed (sudo apt-get install -y git). Nothing has been changed."
    exit 1
  fi

  if [ "$EDGE_MODE" = yes ]; then
    if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
      echo "refusing: shared-edge mode needs Docker with the compose plugin already installed;"
      echo "bootstrap will not install it on a shared box (it rewrites iptables)."
      echo "Nothing has been changed."
      exit 1
    fi
    log "shared-edge mode: building on a box that serves other sites"
    echo "   The build takes a few minutes of CPU and ~2 GB of RAM, alongside"
    echo "   whatever else runs here. Prefer the CI deploy for every later release."
  fi

  # --- source -----------------------------------------------------------------
  # The fetched branch must have the shared-box checks BEFORE its files are
  # checked out: when this script runs from inside $SRC_DIR (the docs'
  # rebuild step does), checking out a branch that predates them would
  # replace this very script with one that has no gate, and the refusal
  # would then point the operator at it.
  log "fetching $BRANCH from $REPO_URL"
  local fetched
  if [ -d "$SRC_DIR/.git" ]; then
    git -C "$SRC_DIR" remote set-url origin "$REPO_URL"
    # An explicit refspec: a --depth 1 --branch clone only tracks the branch it
    # was cloned with, so a bare `fetch origin other` never updates
    # origin/other and the checkout below would fail.
    git -C "$SRC_DIR" fetch --depth 1 origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
    fetched="origin/$BRANCH"
  else
    case "$HERE/" in
      "$SRC_DIR"/*)
        echo "refusing: this script runs from $HERE, inside $SRC_DIR, which is not a git"
        echo "checkout; replacing $SRC_DIR would delete it. Clone a current branch into"
        echo "a directory of your own and run bring-up from there. Nothing has been changed."
        exit 1 ;;
    esac
    rm -rf "$SRC_DIR"
    git clone --no-checkout --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
    fetched=HEAD
  fi
  for f in preflight.sh guard.sh; do
    if ! git -C "$SRC_DIR" cat-file -e "$fetched:deploy/$f" 2>/dev/null; then
      cat <<OLD

== refusing: $BRANCH has no deploy/$f ==

That branch predates the shared-box checks, and its bootstrap.sh would install
nginx and change the firewall without asking. It was fetched into $SRC_DIR
but NOT checked out, so no script there changed, and nothing else on the box
has been changed. Deploy a branch that has them:
  sudo bash $HERE/bring-up.sh <branch>
OLD
      exit 1
    fi
  done
  if [ "$fetched" = HEAD ]; then
    git -C "$SRC_DIR" checkout -q -f "$BRANCH"
  else
    git -C "$SRC_DIR" checkout -B "$BRANCH" "$fetched"
  fi
  local SHA
  SHA="$(git -C "$SRC_DIR" rev-parse HEAD)"
  log "at $SHA"

  # --- gate 2, the fetched tree: the code that acts is the code that checked --
  for f in preflight.sh guard.sh; do
    if [ ! -f "$SRC_DIR/deploy/$f" ]; then
      echo "refusing: the checkout in $SRC_DIR has no deploy/$f. Nothing else on the box has been changed."
      exit 1
    fi
  done
  # From here on every check is the fetched tree's own.
  # shellcheck source=deploy/guard.sh
  . "$SRC_DIR/deploy/guard.sh"
  # By now the checkout in $SRC_DIR exists, so a refusal must not claim that
  # nothing changed.
  gate_rc=0
  sm_gate "$SRC_DIR/deploy/preflight.sh" "$APP_DIR/edge.env" "$SRC_DIR/deploy/edge.env.example" \
    "bash $HERE/bring-up.sh $BRANCH" \
    "Only the checkout in $SRC_DIR was written; nothing else on the box changed." || gate_rc=$?
  [ "$gate_rc" -eq 0 ] || exit "$gate_rc"
  EDGE_MODE="$SM_EDGE_MODE"

  # --- memory guard -----------------------------------------------------------
  # Only now, after both gates: swap is for the build below, and a box the
  # fetched preflight refuses must not have gained a swap file or an fstab line.
  # `next build` wants roughly 2 GB. Finding that out by having the OOM killer
  # take the build — or worse, the running site — is a bad way to learn it.
  local total_mb swap_mb
  total_mb="$(free -m | awk 'NR==2{print $2}')"
  swap_mb="$(free -m | awk 'NR==3{print $2}')"
  log "memory: ${total_mb} MB RAM, ${swap_mb} MB swap"
  if [ "$total_mb" -lt 1800 ] && [ "$((total_mb + swap_mb))" -lt 2600 ]; then
    if [ "$EDGE_MODE" = yes ] && [ "${SM_ALLOW_SWAP:-}" != 1 ]; then
      echo "   Low on memory for the build, but this box is shared, so no swap is added"
      echo "   without permission (it writes /swapfile and /etc/fstab). Re-run with"
      echo "   SM_ALLOW_SWAP=1 to add 2 GB of swap, or build in CI instead."
    elif [ ! -f /swapfile ]; then
      log "adding 2 GB of swap for the build (small box, and the build needs ~2 GB)"
      fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
      swapon /swapfile
      grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
      log "swap enabled"
    fi
  fi


  # --- server setup (idempotent) ---------------------------------------------
  # bootstrap runs on a first install, and again on a box set up by an older
  # version (no guard.sh yet, or nginx files still in the old conf.d layout),
  # so the layout is migrated by the same code that installs it.
  # A box set up in shared-edge mode has the scripts but no nginx, no site and
  # no upstream file: if it is dedicated now (edge.env removed), bootstrap
  # must install them, or every deploy would refuse at `nginx -t`.
  if [ ! -x "$APP_DIR/deploy.sh" ] || [ ! -f "$APP_DIR/guard.sh" ] \
     || { [ "$EDGE_MODE" = no ] && { [ -e /etc/nginx/conf.d/solutionmines-proxy.conf ] \
                                     || [ -e /etc/nginx/conf.d/solutionmines-upstream.conf ] \
                                     || ! command -v nginx >/dev/null 2>&1 \
                                     || [ ! -e /etc/nginx/sites-enabled/solutionmines ] \
                                     || [ ! -f /etc/nginx/solutionmines/upstream.conf ]; }; }; then
    log "running bootstrap from the fetched tree"
    bash "$SRC_DIR/deploy/bootstrap.sh"
  else
    log "refreshing deploy scripts and nginx templates"
    install -m 0755 "$SRC_DIR/deploy/deploy.sh"     "$APP_DIR/deploy.sh"
    install -m 0755 "$SRC_DIR/deploy/enable-tls.sh" "$APP_DIR/enable-tls.sh"
    install -m 0755 "$SRC_DIR/deploy/start.sh"      "$APP_DIR/start.sh"
    install -m 0755 "$SRC_DIR/deploy/preflight.sh"  "$APP_DIR/preflight.sh"
    install -m 0644 "$SRC_DIR/deploy/guard.sh"      "$APP_DIR/guard.sh"
    install -m 0644 "$SRC_DIR/deploy/edge.env.example" "$APP_DIR/edge.env.example"
    install -m 0644 "$SRC_DIR/deploy/docker-compose.yml" "$APP_DIR/docker-compose.yml"
    install -d -m 0755 "$APP_DIR/nginx"
    install -m 0644 "$SRC_DIR"/deploy/nginx/*.conf "$APP_DIR/nginx/"
  fi

  # --- the canonical origin ---------------------------------------------------
  # Baked into the image, because the routes using it are statically generated.
  # Until DNS exists, the server's own IP is the honest value — it is what the
  # links in the page will point at, and it is what you are about to browse.
  local PUBLIC_IP SITE_URL SITE_ENV_VALUE IMAGE
  PUBLIC_IP="$(curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  SITE_URL="${SM_SITE_URL_IN:-http://$PUBLIC_IP}"
  # SITE_ENV stays non-production until a real domain is live, so robots.txt
  # serves `Disallow: /` and this never gets indexed on a bare IP.
  SITE_ENV_VALUE="${SM_SITE_ENV_IN:-staging}"
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

  if [ "$EDGE_MODE" = yes ]; then
    # deploy.sh has already smoke-tested through the shared edge: SMOKE_URL in
    # edge.env had to report this exact commit. Probing 127.0.0.1 here would
    # land on the edge's catch-all rather than this site.
    cat <<EDGEDONE

== live behind the shared edge ==

deploy.sh's smoke test reached commit $SHA through the proxy.

The proxy has to stay on the \`edge\` docker network to reach the containers
by name; if it runs in a container and was not connected yet:
  sudo docker network connect edge <proxy-container>

Reach the site at the hostname this site's block in the proxy matches.
SITE_URL was "$SITE_URL" — if that is not the real public origin, re-run with
  sudo SITE_URL=https://<domain> SITE_ENV=production bash $SRC_DIR/deploy/bring-up.sh $BRANCH
so canonical URLs, the sitemap and JSON-LD point at it and robots.txt allows
indexing.
Certificates and the firewall are the proxy's job, not this site's.
EDGEDONE
    exit 0
  fi

  log "verifying through nginx"
  sleep 2
  if ! curl -fsS --max-time 8 "http://127.0.0.1/api/health"; then
    echo
    echo "FAILED: deploy.sh switched, but http://127.0.0.1/api/health does not answer"
    echo "through nginx. Check: sudo nginx -t; sudo systemctl status nginx"
    exit 1
  fi
  echo

  # What is true now, read without changing anything: whether the TLS site
  # is installed, and whether ufw is active (bootstrap allows 'Nginx Full' in
  # an active ufw; it never switches a firewall on).
  local served firewall other
  if sm_site_needs_http_config /etc/nginx/sites-available/solutionmines; then
    served="nginx serves HTTP on port 80 (TLS comes with enable-tls.sh, below)."
  else
    served="nginx serves the TLS site (port 80 redirects to 443)."
  fi
  if sm_ufw_active; then
    firewall="ufw is active; 80 and 443 must be allowed in it (bootstrap adds 'Nginx Full')."
  elif other="$(sm_other_firewall)"; then
    firewall="This box's firewall is $other, not ufw: 80/tcp and 443/tcp must be open in
it (bootstrap printed how). Do not add ufw on top of it."
  else
    firewall="No active ufw, and this script never switches a firewall on. To add one, see
\"The firewall is yours\" in docs/03-deployment.md: allow the SSH port first."
  fi

  cat <<DONE

== live ==

  http://$PUBLIC_IP          <- open this in a browser
  http://$PUBLIC_IP/api/health

$served There is deliberately nothing on 3001/3002 from outside: the app
binds to 127.0.0.1 and only nginx can reach it.
This script checked the site through http://127.0.0.1 only. Open the address
above from another machine: if it does not load, a firewall is in the way,
on the box or in front of it (a provider security group).
$firewall

Built with NEXT_PUBLIC_SITE_URL=$SITE_URL and SITE_ENV=$SITE_ENV_VALUE. Until
SITE_ENV is production, robots.txt serves Disallow: /, and the HTTP-only site
sends X-Robots-Tag: noindex until TLS is in place.

Next:
  1. Point DNS at this box (A @ and A www; an AAAA record only if it points here too)
  2. sudo $APP_DIR/enable-tls.sh <domain> <email>
  3. Rebuild once for the real origin, so canonical URLs, sitemap and JSON-LD
     stop pointing at the IP and the site becomes indexable:
       sudo SITE_URL=https://<domain> SITE_ENV=production bash $SRC_DIR/deploy/bring-up.sh $BRANCH
  4. Add the Actions secrets so later deploys go through CI instead of here
DONE
}

main "$@"
exit
