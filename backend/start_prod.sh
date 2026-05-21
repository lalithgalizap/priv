#!/usr/bin/env bash
# Production launcher for the FastAPI backend.
#
# Tuned for ~500 concurrent users on a single t3.medium / m5.large class box:
# - Multiple uvicorn workers so we can use all CPU cores.
# - Each worker has its own threadpool that handles the synchronous boto3
#   calls for AWS Bedrock, so the async event loop never blocks.
# - DB pool of 40 conns per worker; 4 workers × 40 = 160 connections, well
#   under Supabase's default 60-per-pool but using the pgbouncer pool which
#   has 200+ inbound slots.
#
# Usage:
#   ENVIRONMENT=production ./start_prod.sh

set -euo pipefail

cd "$(dirname "$0")"

export ENVIRONMENT="${ENVIRONMENT:-production}"

# Reasonable defaults; override via env in your systemd unit / Docker.
WORKERS="${UVICORN_WORKERS:-4}"
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"

# uvicorn manages worker lifecycle; --reload is intentionally never used here.
exec venv/bin/uvicorn main:app \
    --host "$HOST" \
    --port "$PORT" \
    --workers "$WORKERS" \
    --proxy-headers \
    --forwarded-allow-ips='*' \
    --timeout-keep-alive 75 \
    --log-level info
