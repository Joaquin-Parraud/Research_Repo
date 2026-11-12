# Research Repo

A self-hosted manager for research projects and their sources: each project holds a library of
PDFs with APA 7 citations, organised in a free-form folder tree, with a README front page, and
exposed to AI assistants through an MCP server. Think NotebookLM's per-project sources with
GitHub's repository structure.

The full design is in [DOCS/SDD.md](DOCS/SDD.md). This repository is at milestone **M0**:
infrastructure, database schema, owner login and the i18n scaffolding.

## Layout

| Path | Contents |
|---|---|
| `backend/` | Python API (FastAPI, SQLAlchemy, Alembic). Package `research_repo` in `backend/src/` |
| `frontend/` | React + TypeScript SPA (Vite), served by nginx in production |
| `docker-compose.yml` | `db` (PostgreSQL 16), `backend`, `frontend` |
| `DOCS/` | Design documents |

## Quick start (Docker Compose)

```sh
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, OWNER_EMAIL and OWNER_PASSWORD
docker compose up -d --build
```

Open `http://<server>:8080` and sign in with the owner credentials. Only the frontend container
publishes a port; it serves the SPA and proxies `/api` to the backend. The backend applies
database migrations on every start and creates the owner on first start if no user exists.

Instead of `OWNER_*` in `.env`, the owner can be created interactively:

```sh
docker compose exec backend python -m research_repo.cli create-owner --email you@example.org
```

Data lives in two named volumes: `db-data` (PostgreSQL) and `storage` (PDFs, mounted at
`/data/storage` in the backend).

## Local development

### Backend

Requires Python 3.12+ and a PostgreSQL 15+ server (the schema uses `UNIQUE NULLS NOT DISTINCT`).

```sh
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"

export DATABASE_URL=postgresql+asyncpg://research_repo:change-me@localhost:5432/research_repo
export STORAGE_DIR=./data/storage
alembic upgrade head
python -m research_repo.cli create-owner --email you@example.org
uvicorn --factory research_repo.main:create_app --reload --port 8000
```

API docs are at `http://localhost:8000/api/docs`.

Tests run against a real PostgreSQL database, which they wipe:

```sh
export TEST_DATABASE_URL=postgresql+asyncpg://research_repo:change-me@localhost:5432/research_repo_test
pytest
ruff check . && ruff format --check .
```

New migrations: change the models in `src/research_repo/models/`, then
`alembic revision --autogenerate -m "describe change"` and review the generated file.
`tests/test_migrations.py` fails if models and migrations disagree.

### Frontend

The frontend lives in `frontend/`. Run `npm install` and `npm run dev` there; the Vite dev server
proxies `/api` to the backend at `http://localhost:8000`.

## Configuration

All variables are documented in [.env.example](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `HTTP_PORT` | `8080` | Host port of the web app |
| `HTTP_BIND` | `0.0.0.0` | Host interface; set to the Tailscale IP to listen on the tailnet only |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `research_repo` / (required) / `research_repo` | Database credentials (compose) |
| `DATABASE_URL` | (set by compose) | Backend connection URL, `postgresql+asyncpg://...` |
| `STORAGE_DIR` | `/data/storage` | Where PDFs are stored |
| `OWNER_EMAIL` / `OWNER_PASSWORD` / `OWNER_DISPLAY_NAME` | empty | Owner created on first start when no user exists |
| `SESSION_TTL_DAYS` | `30` | Login session lifetime |
| `COOKIE_SECURE` | `false` | `Secure` flag on the session cookie; enable only behind HTTPS |
| `LOGIN_RATE_LIMIT_ATTEMPTS` / `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `5` / `300` | Failed logins allowed per email and per IP per window |
| `LOG_LEVEL` | `INFO` | Backend log level |
| `TEST_DATABASE_URL` | none | Database used (and wiped) by the test suite |

## API (M0)

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/health` | `{"status":"ok"}`; 503 if the database is unreachable |
| `POST` | `/api/auth/login` | Body `{"email","password"}` → user, sets the `rr_session` cookie |
| `POST` | `/api/auth/logout` | 204, ends the session and clears the cookie |
| `GET` | `/api/auth/me` | Current user `{"id","email","display_name","language"}` |
| `PATCH` | `/api/auth/me` | Body `{"language"?: "en"\|"es", "display_name"?}` → user |

Errors always have the shape `{"error": {"code": "auth.invalid_credentials", "message": "..."}}`.
`code` is a stable key the frontend translates; `message` is an English fallback.
