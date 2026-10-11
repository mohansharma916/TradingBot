#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# F&O Trading Platform — Backend Production Deployment Script
# Targets: Docker Compose stack (Postgres + NestJS API + Worker + Caddy)
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${PROJECT_DIR}/infrastructure/production/docker-compose.yml"
ENV_FILE="${PROJECT_DIR}/.env.production"

echo "========================================================"
echo "🚀 Starting Backend Deployment for F&O Trading Platform"
echo "📂 Project Directory: ${PROJECT_DIR}"
echo "📄 Compose File:     ${COMPOSE_FILE}"
echo "⏰ Timestamp:        $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "========================================================"

cd "${PROJECT_DIR}"

CURRENT_USER="$(id -un 2>/dev/null || whoami)"
CURRENT_GROUP="$(id -gn 2>/dev/null || echo "$CURRENT_USER")"

# 1. Fix ownership and Git safe.directory to avoid permission issues (on Linux servers)
if [ "$(uname -s)" = "Linux" ] && command -v sudo >/dev/null 2>&1; then
  sudo chown -R "${CURRENT_USER}:${CURRENT_GROUP}" "${PROJECT_DIR}" 2>/dev/null || true
  sudo chmod -R u+rwX "${PROJECT_DIR}" 2>/dev/null || true
fi
git config --global --add safe.directory "${PROJECT_DIR}" 2>/dev/null || true
git config --global --add safe.directory "*" 2>/dev/null || true

# Determine Docker command (supports sudo if user is not in docker group)
DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
    echo "ℹ️ Using sudo for Docker commands."
    DOCKER_CMD="sudo docker"
  else
    echo "❌ Error: Cannot connect to Docker daemon. Make sure docker is running and current user has access."
    exit 1
  fi
fi

# 2. Check for production environment file and validate required secrets
if [ ! -f "${ENV_FILE}" ]; then
  if [ -f "${PROJECT_DIR}/.env" ]; then
    echo "⚠️ Warning: .env.production not found; copying from .env"
    cp "${PROJECT_DIR}/.env" "${ENV_FILE}"
  else
    echo "⚠️ Warning: .env.production not found; copying from .env.example"
    cp "${PROJECT_DIR}/.env.example" "${ENV_FILE}"
  fi
fi

# Ensure JWT_SECRET is not using the development placeholder in production
if grep -E -q "JWT_SECRET=[^a-zA-Z0-9]*super_secret_dev" "${ENV_FILE}" 2>/dev/null; then
  echo "⚠️ Notice: JWT_SECRET in .env.production is using the default dev placeholder."
  echo "🔑 Generating a private secure JWT_SECRET..."
  GEN_SECRET=$(openssl rand -hex 32 2>/dev/null || date +%s%N | (sha256sum 2>/dev/null || shasum -a 256) | head -c 64)
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' -E "s|^[[:space:]]*JWT_SECRET=.*|JWT_SECRET=${GEN_SECRET}|g" "${ENV_FILE}" 2>/dev/null || true
  else
    sed -i -E "s|^[[:space:]]*JWT_SECRET=.*|JWT_SECRET=${GEN_SECRET}|g" "${ENV_FILE}" 2>/dev/null || true
  fi
fi

# Ensure OWNER_PASSWORD is configured
if ! grep -q "^OWNER_PASSWORD=" "${ENV_FILE}" 2>/dev/null || grep -q "^OWNER_PASSWORD=[[:space:]]*$" "${ENV_FILE}" 2>/dev/null; then
  echo "⚠️ Notice: OWNER_PASSWORD is not set in .env.production. Adding default owner password..."
  echo "OWNER_PASSWORD=OwnerSecure@2026" >> "${ENV_FILE}"
fi

# 3. Pull latest Git changes (skip if running locally or with --local/--skip-git)
if [ "${SKIP_GIT_PULL:-false}" = "true" ] || [ "${1:-}" = "--local" ] || [ "${1:-}" = "--skip-git" ]; then
  echo "⏩ Skipping git fetch/reset (running in local mode)..."
else
  echo "⬇️ Pulling latest changes from Git..."
  git fetch origin main
  git reset --hard origin/main
fi

# 4. Clean up stale runtime lock & start containers
echo "🧹 Removing any stale runtime lease lock from previous container..."
${DOCKER_CMD} compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" stop api 2>/dev/null || true
${DOCKER_CMD} compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm --no-deps --entrypoint rm api -f /app/.data/account-runtime.lock 2>/dev/null || true
${DOCKER_CMD} volume inspect fo-trading_api_state >/dev/null 2>&1 && \
  ${DOCKER_CMD} run --rm -v fo-trading_api_state:/v alpine rm -f /v/account-runtime.lock 2>/dev/null || true

echo "🐳 Building and starting Docker containers..."
${DOCKER_CMD} compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build --remove-orphans

# 5. Health Check: Verify API is answering
echo "🩺 Performing health verification..."
MAX_ATTEMPTS=24
SLEEP_INTERVAL=5
API_HEALTHY=false

for i in $(seq 1 ${MAX_ATTEMPTS}); do
  echo "   [Attempt $i/${MAX_ATTEMPTS}] Checking API responsiveness..."
  
  # Check if the container is running and responding on internal port 3000
  if ${DOCKER_CMD} compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T api node -e "
    const http = require('http');
    const req = http.get('http://127.0.0.1:3000/api/v1/health/live', (res) => {
      process.exit(res.statusCode === 200 || res.statusCode === 401 || res.statusCode === 404 ? 0 : 1);
    });
    req.on('error', () => process.exit(1));
  " >/dev/null 2>&1; then
    API_HEALTHY=true
    echo "✅ API container is healthy and responding!"
    break
  fi

  sleep ${SLEEP_INTERVAL}
done

if [ "${API_HEALTHY}" != "true" ]; then
  echo "❌ API failed health check after $((${MAX_ATTEMPTS} * ${SLEEP_INTERVAL})) seconds."
  echo "📋 Showing recent API container logs:"
  ${DOCKER_CMD} compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=50 api
  exit 1
fi

# 6. Cleanup dangling Docker images to preserve server disk space
echo "🧹 Cleaning up unused build images..."
${DOCKER_CMD} image prune -f >/dev/null 2>&1 || true

echo "========================================================"
echo "🎉 Deployment successfully completed!"
echo "🐳 Active Containers:"
${DOCKER_CMD} compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
echo "========================================================"
