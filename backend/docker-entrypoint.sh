#!/bin/sh
# Apply database migrations, then serve the API.
set -eu

alembic upgrade head

# The backend is only reachable from the reverse proxy on the compose network, so the
# X-Forwarded-* headers it sets are trusted (used for per-IP login rate limiting).
exec uvicorn --factory research_repo.main:create_app \
    --host 0.0.0.0 --port 8000 \
    --proxy-headers --forwarded-allow-ips '*' \
    "$@"
