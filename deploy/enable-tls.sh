#!/usr/bin/env bash
# ============================================================================
# Promote the site from HTTP-only to TLS. Run AFTER DNS points at this box:
#
#   sudo /opt/solutionmines/enable-tls.sh solutionmines.com you@example.com
#
# Order matters. certbot's HTTP-01 challenge needs the domain to already
# resolve here, which is why this is separate from bootstrap.sh rather than
# the last step of it.
#
# Dedicated boxes only. It refuses on a box in shared-edge mode, and it runs
# preflight again first, because a box that was dedicated at bootstrap may
# have gained another site since. The new site config is checked with
# `nginx -t` before anything reloads, and put back if the check fails.
#
# Safe to re-run (a DNS or certbot hiccup, a renewed certificate): once the
# TLS site for this domain is installed it is kept as it is, with any hand
# edits (HSTS enabled, CSP enforced). Whenever it does replace a site file,
# the previous one is first copied to $APP_DIR/site-backup.<time>.<random>,
# which nothing deletes, whatever happens after.
# ============================================================================
set -euo pipefail

DOMAIN="${1:?usage: enable-tls.sh <domain> <email>}"
EMAIL="${2:?usage: enable-tls.sh <domain> <email>}"
APP_DIR=/opt/solutionmines
SITE=/etc/nginx/sites-available/solutionmines

[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

# The domain goes into a sed expression and a file path. Hostname characters
# only, so neither can be bent into something else.
if ! [[ $DOMAIN =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
  echo "refusing: '$DOMAIN' does not look like a domain name"; exit 1
fi

# On a shared box TLS belongs to the existing proxy. This script would install
# an nginx site claiming default_server on :443, which is exactly the kind of
# takeover preflight exists to prevent.
if [ -e "$APP_DIR/edge.env" ] || [ -L "$APP_DIR/edge.env" ]; then
  echo "shared-edge mode (edge.env present): certificates are the box's existing"
  echo "proxy's job, not this script's. Nothing has been changed."
  exit 3
fi

if [ ! -f "$APP_DIR/guard.sh" ] || [ ! -f "$APP_DIR/preflight.sh" ]; then
  echo "refusing: $APP_DIR/guard.sh or $APP_DIR/preflight.sh is missing."
  echo "Re-run deploy/bootstrap.sh (or bring-up.sh) from a current checkout to install them."
  echo "Nothing has been changed."
  exit 1
fi
# shellcheck source=deploy/guard.sh
. "$APP_DIR/guard.sh"

# Is the box still ours alone? Before certbot, which writes /etc/letsencrypt.
if ! sm_run_preflight "$APP_DIR/preflight.sh"; then
  echo "refusing: preflight could not give a trustworthy verdict. Nothing has been changed."
  exit 1
fi
if [ "$SM_SHARED" = yes ]; then
  if [ "${SM_FORCE_DEDICATED:-}" = 1 ]; then
    echo "SM_FORCE_DEDICATED=1: continuing although preflight says this box is shared."
  else
    cat <<REFUSE

== refusing: this box now serves another site as well, or preflight could not rule that out ==

Nothing has been changed. Preflight's report above gives the reason.

If it says "cannot verify", preflight could not read something it needs (a
tool missing or failing, Docker stopped, nginx -t failing): fix that and
re-run this script. Do not force it.

If it names another site: installing the TLS site would claim
default_server on :443 and can take that site down at the next reload. Put
this site behind the existing proxy instead (docs/03-deployment.md, "Running
behind a shared edge proxy"), or, if you are certain the box is dedicated and
preflight is wrong:
  sudo SM_FORCE_DEDICATED=1 $APP_DIR/enable-tls.sh $DOMAIN $EMAIL
REFUSE
    exit 3
  fi
fi

log() { printf '\n== %s\n' "$*"; }

# Fail early with a clear reason rather than letting certbot hit a rate limit.
# Let's Encrypt allows 5 failed validations per account/hostname per hour, and
# burning those on a DNS propagation delay is an hour of waiting.
# Both names certbot asks for, and each address family on its own: `getent
# hosts` answers with the AAAA record first, and api.ipify.org only ever
# answers over IPv4, so comparing those two refused every domain with an
# AAAA record, even one that points here.
log "checking that $DOMAIN and www.$DOMAIN resolve to this machine"
server_ip="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
server_ip6="$( { ip -6 -o addr show scope global 2>/dev/null | awk '{ sub(/\/.*/, "", $4); print $4 }'
                 curl -6 -fsS --max-time 5 https://api6.ipify.org 2>/dev/null; echo; } \
               | awk 'NF' | sort -u | tr '\n' ' ')"
server_ip6="${server_ip6% }"
echo "   this server: IPv4 ${server_ip:-unknown}, IPv6 ${server_ip6:-none}"
dns_ok=yes
sm_dns_points_here "$DOMAIN" "$server_ip" "$server_ip6" || dns_ok=no
sm_dns_points_here "www.$DOMAIN" "$server_ip" "$server_ip6" || dns_ok=no
if [ "$dns_ok" != yes ]; then
  echo "   Fix the records above (or wait for propagation), then re-run. Nothing has been changed."
  exit 1
fi

log "requesting a certificate for $DOMAIN and www.$DOMAIN"
# --webroot, not --nginx: the nginx plugin rewrites the site config, and this
# config is version-controlled. The webroot path is already served by the
# HTTP-only site. The deploy hook is stored with the renewal config: without
# it a renewed certificate sits on disk while nginx keeps serving the old one
# until it expires.
certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" -d "www.$DOMAIN" \
  --email "$EMAIL" --agree-tos --no-eff-email --non-interactive \
  --deploy-hook "systemctl reload nginx"

# The TLS config includes two files that only certbot's nginx PLUGIN writes,
# and --webroot never runs it. Create them if they are missing; never
# overwrite ones certbot (or anyone) already put there.
OPTS=/etc/letsencrypt/options-ssl-nginx.conf
DHPARAMS=/etc/letsencrypt/ssl-dhparams.pem
if [ ! -f "$OPTS" ]; then
  log "writing $OPTS (certbot's recommended settings)"
  cat > "$OPTS" <<'OPTS'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;

ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;

ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
OPTS
  chmod 644 "$OPTS"
fi
if [ ! -f "$DHPARAMS" ]; then
  log "writing $DHPARAMS (RFC 7919 ffdhe2048)"
  openssl genpkey -genparam -algorithm DH -pkeyopt dh_param:ffdhe2048 -out "$DHPARAMS" 2>/dev/null \
    || openssl dhparam -out "$DHPARAMS" 2048
  chmod 644 "$DHPARAMS"
fi

BACKUP_KEPT=""
if sm_tls_site_installed "$SITE" "$DOMAIN"; then
  # A re-run: the certificate is (re)issued above, the site stays as it is.
  log "the TLS site for $DOMAIN is already installed; keeping it as it is"
  echo "   Hand edits in $SITE (an enabled Strict-Transport-Security line, an"
  echo "   enforced Content-Security-Policy) are kept. To re-render it from the"
  echo "   template, move it aside first and re-run."
  if ! nginx -t; then
    echo "   nginx -t fails with the current configuration; nginx was NOT reloaded."
    exit 1
  fi
  systemctl reload nginx
else
  log "installing the TLS site config"
  # Rendered to a temporary file first: a failed sed must never leave the live
  # site file empty or half-written.
  NEW="$(mktemp "$APP_DIR/.tls-site.XXXXXX")"
  # Only the rendered temp file is ever removed on exit. The copy of the
  # site file it replaces is made, under its final name, BEFORE anything is
  # replaced, and is never deleted: a failed reload, a failed restore or a
  # Ctrl-C at any point leaves it on disk.
  cleanup() { rm -f "$NEW"; }
  trap cleanup EXIT
  if ! sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/nginx/solutionmines-tls.conf" > "$NEW" \
     || [ ! -s "$NEW" ] || grep -q '__DOMAIN__' "$NEW"; then
    echo "   could not render $APP_DIR/nginx/solutionmines-tls.conf. The live site is unchanged."
    exit 1
  fi
  chmod 644 "$NEW"

  had_site=no
  if [ -f "$SITE" ]; then
    had_site=yes
    # Out of nginx's way, under the name it keeps; unique even for two runs
    # in the same second.
    BACKUP_KEPT="$(mktemp "$APP_DIR/site-backup.$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")"
    if ! cp -p "$SITE" "$BACKUP_KEPT"; then
      echo "   could not copy $SITE to $BACKUP_KEPT. The live site is unchanged."
      exit 1
    fi
    echo "   the current site config is kept as $BACKUP_KEPT"
  fi
  mv -f "$NEW" "$SITE"
  if ! nginx -t; then
    echo "   nginx -t failed with the TLS config. Putting the previous site config back."
    if [ "$had_site" = yes ]; then
      if ! cp -p "$BACKUP_KEPT" "$SITE"; then
        echo "   WARNING: could not put it back. nginx was NOT reloaded. Copy it back by hand"
        echo "   before anything reloads nginx: sudo cp -p $BACKUP_KEPT $SITE"
        exit 1
      fi
    else
      rm -f "$SITE"
    fi
    if nginx -t; then
      echo "   restored; nginx -t passes again. nginx was NOT reloaded."
    else
      echo "   WARNING: nginx -t still fails after the restore. nginx was NOT reloaded;"
      echo "   fix the config before anything reloads it."
    fi
    exit 1
  fi
  if ! systemctl reload nginx; then
    echo "   WARNING: the TLS site passes nginx -t, but 'systemctl reload nginx' failed"
    echo "   (is nginx running? sudo systemctl status nginx). The TLS site is installed."
    [ "$had_site" = no ] || echo "   The site config it replaced is kept as $BACKUP_KEPT."
    exit 1
  fi
fi

log "verifying renewal before anything depends on it"
# If this fails, the certificate silently expires in 90 days and the site goes
# dark. Checking now is the difference between a warning and an outage.
certbot renew --dry-run
systemctl list-timers certbot.timer --no-pager | sed 's/^/   /' || true

cat <<DONE

== TLS enabled for $DOMAIN ==

  curl -sI https://$DOMAIN | head -1
${BACKUP_KEPT:+
The site config this run replaced is kept as $BACKUP_KEPT.
}
Still to do, deliberately NOT automated:

  - HSTS is commented out in the TLS config. Enable it only now that
    \`certbot renew --dry-run\` has passed, by uncommenting the
    Strict-Transport-Security line and reloading nginx. For the max-age you
    publish it is effectively irreversible, and preload entirely so.

  - The app's canonical URLs, sitemap and JSON-LD are BAKED AT BUILD TIME from
    NEXT_PUBLIC_SITE_URL. Set that repository variable to https://$DOMAIN and
    re-run the deploy, or every canonical tag will point at the placeholder.

  - CSP is Report-Only. Review reports, then rename the header to
    Content-Security-Policy to enforce it.
DONE
