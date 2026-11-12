# Research Repo

A self-hosted manager for research projects and their sources: each project holds a library of
PDFs with APA 7 citations, organised in a free-form folder tree, with a README front page, and
exposed to AI assistants through an MCP server. Think NotebookLM's per-project sources with
GitHub's repository structure.

The full design is in [DOCS/SDD.md](DOCS/SDD.md). This repository is at milestone **M1**
(backend): projects with a README, a nested folder tree, PDF upload and serving, and moving
sources and folders around. M0 provided the infrastructure, schema, owner login and i18n
scaffolding. Citation metadata (M2), text search (M3) and MCP (M4) come next.

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
| `MAX_UPLOAD_MB` | `200` | Largest PDF accepted per upload (keep nginx `client_max_body_size` in step) |
| `OWNER_EMAIL` / `OWNER_PASSWORD` / `OWNER_DISPLAY_NAME` | empty | Owner created on first start when no user exists |
| `SESSION_TTL_DAYS` | `30` | Login session lifetime |
| `COOKIE_SECURE` | `false` | `Secure` flag on the session cookie; enable only behind HTTPS |
| `LOGIN_RATE_LIMIT_ATTEMPTS` / `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `5` / `300` | Failed logins allowed per email and per IP per window |
| `LOG_LEVEL` | `INFO` | Backend log level |
| `TEST_DATABASE_URL` | none | Database used (and wiped) by the test suite |

## API

All endpoints are under `/api`. Everything except `/api/health` and `/api/auth/login` needs the
session cookie (401 `auth.not_authenticated` otherwise). Interactive docs: `/api/docs`.

### Auth and health (M0)

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/health` | `{"status":"ok"}`; 503 if the database is unreachable |
| `POST` | `/api/auth/login` | Body `{"email","password"}` → user, sets the `rr_session` cookie |
| `POST` | `/api/auth/logout` | 204, ends the session and clears the cookie |
| `GET` | `/api/auth/me` | Current user `{"id","email","display_name","language"}` |
| `PATCH` | `/api/auth/me` | Body `{"language"?: "en"\|"es", "display_name"?}` → user |

### Library (M1)

| Method | Path | Result | Role |
|---|---|---|---|
| `GET` | `/api/projects?include_archived=false` | Projects the caller belongs to, by name | member |
| `POST` | `/api/projects` | `{name, description?}` → 201 project; caller becomes owner | any user |
| `GET` / `PATCH` / `DELETE` | `/api/projects/{id}` | Read; `{name?, description?, citation_locale?, archived?}`; delete with its folders, sources and unshared files | viewer / owner / owner |
| `GET` / `PUT` | `/api/projects/{id}/readme` | `{readme_md, updated_at}`; README up to 200 kB | viewer / editor |
| `GET` | `/api/projects/{id}/tree` | `{folders, sources}` as flat lists | viewer |
| `POST` | `/api/projects/{id}/folders` | `{name, parent_id?}` → 201 folder, appended last | editor |
| `PATCH` / `DELETE` | `/api/folders/{id}` | `{name?, parent_id?, position?}` (rename, move, reorder); delete moves contents up | editor |
| `POST` | `/api/projects/{id}/sources` | Multipart: `file?` (PDF), `folder_id?`, `title?` (required without file), `allow_duplicate?` → 201 source | editor |
| `GET` / `PATCH` / `DELETE` | `/api/sources/{id}` | Read; `{title?, folder_id?, last_page_read?, tags?}`; delete | viewer / editor (viewers may set `last_page_read`) / editor |
| `POST` | `/api/sources/move` | `{source_ids, folder_id}` → `{moved}`, all or nothing | editor |
| `GET` | `/api/sources/{id}/file` | The PDF, with single-range requests (206/416), `ETag`, `If-None-Match`, `If-Range` | viewer |

Non-members get 404 for a project and everything in it; members below the needed role get 403.

How it behaves:

- **Slugs and keys.** Project slugs come from the name (`my-thesis`, `my-thesis-2`, …) and do not
  change on rename. Each source gets a provisional citation key from its title (ASCII, lowercase,
  at most 40 characters, unique per project); M2 replaces this with author-year keys.
- **Folders.** Names are unique among siblings, compared case-insensitively after trimming, and
  cannot contain `/`. `parent_id: null` in a PATCH moves to the root, while an absent
  `parent_id` leaves the parent unchanged. `position` is the 0-based index among the new siblings,
  and siblings are renumbered densely. Moving a folder into itself or a subfolder is a 409. When a
  folder is deleted, its sources and subfolders take its place in the parent; a subfolder whose name
  is already taken there is renamed `Name (2)`, `Name (3)`, ….
- **Uploads.** The body is streamed to a staging file under `STORAGE_DIR/.tmp` while being hashed
  and size-checked. It is never held in memory, and it is rejected with 413 as soon as it passes
  `MAX_UPLOAD_MB`. A file must start with `%PDF-`; its page count is read with pypdf, and an
  encrypted or damaged PDF is kept without a page count. Files are stored once by content at
  `STORAGE_DIR/ab/cd/<sha256>.pdf` and shared by every source that uses them, including across
  projects. Uploading a file that is already in the same project gives 409 `source.duplicate_file`
  with `details.existing_source_id`, unless `allow_duplicate=true`. A stored file is deleted
  together with the last source that references it. Staging files left behind by a crash are
  removed on startup.
- **Tags** are per project, trimmed and case-insensitive (the first spelling is kept). A PATCH
  with `tags` replaces the source's full set.

Errors always have the shape `{"error": {"code": "folder.cycle", "message": "..."}}`, plus an
optional `details` object for some codes. `code` is a stable key that the frontend translates;
`message` is an English fallback. Codes used by M1: `project.not_found`, `folder.not_found`,
`folder.name_conflict`, `folder.cycle`, `source.not_found`, `source.invalid_pdf`,
`source.file_too_large`, `source.duplicate_file`, `source.move_invalid`, `source.no_file`,
`source.range_not_satisfiable`, plus the general `validation.invalid`, `auth.forbidden` and
`auth.not_authenticated`.

The backend runs as a single process: the in-memory login limiter and the storage lock, which
serialises the creation and deletion of stored files, both assume one worker.
