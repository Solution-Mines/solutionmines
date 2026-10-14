#!/usr/bin/env bash
# ============================================================================
# Promote the site from HTTP-only to TLS. Run AFTER DNS points at this box:
#
#   sudo /opt/solutionmines/enable-tls.sh solutionmines.com you@example.com
#
# Order matters. certbot's HTTP-01 challenge needs the domain to already
# resolve here, which is why this is separate from bootstrap.sh rather than
# the last step of it.
# ============================================================================
set -euo pipefail

DOMAIN="${1:?usage: enable-tls.sh <domain> <email>}"
EMAIL="${2:?usage: enable-tls.sh <domain> <email>}"
APP_DIR=/opt/solutionmines

[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

log() { printf '\n== %s\n' "$*"; }

# Fail early with a clear reason rather than letting certbot hit a rate limit.
# Let's Encrypt allows 5 failed validations per account/hostname per hour, and
# burning those on a DNS propagation delay is an hour of waiting.
log "checking that $DOMAIN resolves to this machine"
server_ip="$(curl -fsS --max-time 5 https://api.ipify.org || true)"
resolved="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
echo "   this server: ${server_ip:-unknown}"
echo "   $DOMAIN -> ${resolved:-nothing}"
if [ -z "$resolved" ]; then
  echo "   $DOMAIN does not resolve yet. Add the A records and wait, then re-run."
  exit 1
fi
if [ -n "$server_ip" ] && [ "$resolved" != "$server_ip" ]; then
  echo "   WARNING: $DOMAIN resolves elsewhere. Continuing would likely fail validation."
  echo "   Re-run once propagation has finished."
  exit 1
fi

log "requesting a certificate for $DOMAIN and www.$DOMAIN"
# --webroot, not --nginx: the nginx plugin rewrites the site config, and this
# config is version-controlled. The webroot path is already served by the
# HTTP-only site.
certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" -d "www.$DOMAIN" \
  --email "$EMAIL" --agree-tos --no-eff-email --non-interactive

log "installing the TLS site config"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/nginx/solutionmines-tls.conf" \
  > /etc/nginx/sites-available/solutionmines
nginx -t
systemctl reload nginx

log "verifying renewal before anything depends on it"
# If this fails, the certificate silently expires in 90 days and the site goes
# dark. Checking now is the difference between a warning and an outage.
certbot renew --dry-run
systemctl list-timers certbot.timer --no-pager | sed 's/^/   /' || true

cat <<DONE

== TLS enabled for $DOMAIN ==

  curl -sI https://$DOMAIN | head -1

Still to do, deliberately NOT automated:

  - HSTS is commented out in the TLS config. Enable it only now that
    `certbot renew --dry-run` has passed, by uncommenting the
    Strict-Transport-Security line and reloading nginx. For the max-age you
    publish it is effectively irreversible, and preload entirely so.

  - The app's canonical URLs, sitemap and JSON-LD are BAKED AT BUILD TIME from
    NEXT_PUBLIC_SITE_URL. Set that repository variable to https://$DOMAIN and
    re-run the deploy, or every canonical tag will point at the placeholder.

  - CSP is Report-Only. Review reports, then rename the header to
    Content-Security-Policy to enforce it.
DONE
