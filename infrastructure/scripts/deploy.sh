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

# 1. Fix ownership and Git safe.directory to avoid permission issues
if command -v sudo >/dev/null 2>&1; then
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

# 2. Check for production environment file
if [ ! -f "${ENV_FILE}" ]; then
  if [ -f "${PROJECT_DIR}/.env" ]; then
    echo "⚠️ Warning: .env.production not found; copying from .env"
    cp "${PROJECT_DIR}/.env" "${ENV_FILE}"
  else
    echo "⚠️ Warning: .env.production not found; copying from .env.example"
    cp "${PROJECT_DIR}/.env.example" "${ENV_FILE}"
  fi
fi

# 3. Pull latest Git changes
echo "⬇️ Pulling latest changes from Git..."
git fetch origin main
git reset --hard origin/main

# 4. Build and start containers
echo "🐳 Building and starting Docker containers..."
${DOCKER_CMD} compose -f "${COMPOSE_FILE}" up -d --build --remove-orphans

# 5. Health Check: Verify API is answering
echo "🩺 Performing health verification..."
MAX_ATTEMPTS=24
SLEEP_INTERVAL=5
API_HEALTHY=false

for i in $(seq 1 ${MAX_ATTEMPTS}); do
  echo "   [Attempt $i/${MAX_ATTEMPTS}] Checking API responsiveness..."
  
  # Check if the container is running and responding on internal port 3000
  if ${DOCKER_CMD} compose -f "${COMPOSE_FILE}" exec -T api node -e "
    const http = require('http');
    const req = http.get('http://127.0.0.1:3000/api/v1/strategies', (res) => {
      process.exit(res.statusCode === 200 || res.statusCode === 404 ? 0 : 1);
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
  ${DOCKER_CMD} compose -f "${COMPOSE_FILE}" logs --tail=50 api
  exit 1
fi

# 6. Cleanup dangling Docker images to preserve server disk space
echo "🧹 Cleaning up unused build images..."
${DOCKER_CMD} image prune -f >/dev/null 2>&1 || true

echo "========================================================"
echo "🎉 Deployment successfully completed!"
echo "🐳 Active Containers:"
${DOCKER_CMD} compose -f "${COMPOSE_FILE}" ps
echo "========================================================"
