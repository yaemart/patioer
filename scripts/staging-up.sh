#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$ROOT_DIR/docker-compose.staging.yml"

# ──────────────────────────────────────────────────
# ElectroOS Staging Environment — One-click Setup
# ──────────────────────────────────────────────────
# Usage:
#   ./scripts/staging-up.sh          # Start all services
#   ./scripts/staging-up.sh down     # Tear down
#   ./scripts/staging-up.sh logs     # Tail API logs
#   ./scripts/staging-up.sh health   # Check API health
#   ./scripts/staging-up.sh psql     # Open psql to staging DB
#   ./scripts/staging-up.sh reset    # Destroy volumes and restart fresh
# ──────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[staging]${NC} $*"; }
warn() { echo -e "${YELLOW}[staging]${NC} $*"; }
err()  { echo -e "${RED}[staging]${NC} $*" >&2; }

check_prereqs() {
  for cmd in docker; do
    if ! command -v "$cmd" &>/dev/null; then
      err "$cmd is required but not installed."
      exit 1
    fi
  done
}

up() {
  check_prereqs

  if [ ! -f "$ROOT_DIR/.env.staging" ]; then
    err ".env.staging not found. Copy from template:"
    err "  cp .env.staging.example .env.staging"
    err "Then fill in real Shopify credentials."
    exit 1
  fi

  log "Starting staging environment..."
  docker compose -f "$COMPOSE_FILE" up -d --build --wait

  log "Waiting for API health check..."
  local retries=0
  local max_retries=30
  while [ $retries -lt $max_retries ]; do
    if curl -sf http://localhost:${API_PORT:-3100}/api/v1/health > /dev/null 2>&1; then
      log "API is healthy!"
      echo ""
      log "┌─────────────────────────────────────────┐"
      log "│  Staging Environment Ready               │"
      log "│                                          │"
      log "│  API:      http://localhost:${API_PORT:-3100}          │"
      log "│  Swagger:  http://localhost:${API_PORT:-3100}/api/v1/docs │"
      log "│  Postgres: localhost:${POSTGRES_PORT:-5433}              │"
      log "│  Paperclip: http://localhost:${PAPERCLIP_PORT:-3000}      │"
      log "└─────────────────────────────────────────┘"
      return 0
    fi
    retries=$((retries + 1))
    sleep 2
  done

  err "API failed to become healthy after ${max_retries} attempts."
  err "Check logs: ./scripts/staging-up.sh logs"
  exit 1
}

down() {
  log "Stopping staging environment..."
  docker compose -f "$COMPOSE_FILE" down
  log "Done."
}

reset_env() {
  log "Destroying staging volumes and restarting..."
  docker compose -f "$COMPOSE_FILE" down -v
  up
}

logs() {
  docker compose -f "$COMPOSE_FILE" logs -f api
}

health() {
  local url="http://localhost:${API_PORT:-3100}/api/v1/health"
  if curl -sf "$url" 2>/dev/null; then
    echo ""
    log "API is healthy."
  else
    err "API health check failed at $url"
    exit 1
  fi
}

open_psql() {
  docker compose -f "$COMPOSE_FILE" exec postgres \
    psql -U postgres -d patioer_staging
}

case "${1:-up}" in
  up)     up ;;
  down)   down ;;
  reset)  reset_env ;;
  logs)   logs ;;
  health) health ;;
  psql)   open_psql ;;
  *)
    err "Unknown command: $1"
    echo "Usage: $0 {up|down|reset|logs|health|psql}"
    exit 1
    ;;
esac
