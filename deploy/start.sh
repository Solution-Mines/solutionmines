#!/usr/bin/env bash
# ============================================================================
# Boot-time restore, invoked by solutionmines.service.
#
# `docker compose up -d` with no argument would start BOTH colours, leaving
# two containers serving and nginx pointed at one of them — wasting memory and
# making "which build is live?" unanswerable. So this reads what the last
# successful deploy recorded and brings back exactly that.
# ============================================================================
set -euo pipefail

APP_DIR=/opt/solutionmines
STATE="$APP_DIR/image.env"

if [ ! -f "$STATE" ]; then
  echo "no $STATE yet — nothing has been deployed. Nothing to start."
  exit 0
fi

# shellcheck source=/dev/null
. "$STATE"

if [ -z "${IMAGE:-}" ] || [ -z "${ACTIVE_COLOUR:-}" ]; then
  echo "$STATE is incomplete (IMAGE='${IMAGE:-}' ACTIVE_COLOUR='${ACTIVE_COLOUR:-}')"
  exit 0
fi

export IMAGE
cd "$APP_DIR"
echo "restoring $ACTIVE_COLOUR on $IMAGE"
exec docker compose -f "$APP_DIR/docker-compose.yml" up -d "$ACTIVE_COLOUR"
