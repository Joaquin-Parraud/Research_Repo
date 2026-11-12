# Research Repo

A self-hosted manager for research projects and their sources: each project holds a library of
PDFs with APA 7 citations, organised in a free-form folder tree, with a README front page, and
exposed to AI assistants through an MCP server. Think NotebookLM's per-project sources with
GitHub's repository structure.

The full design is in [DOCS/SDD.md](DOCS/SDD.md). This repository is at milestone **M2**
(backend): CSL-JSON metadata, DOI lookup through Crossref, APA 7 references and bibliography
export, on top of M1 (projects with a README, folder tree, PDF upload and serving, moves) and M0
(infrastructure, schema, owner login, i18n scaffolding). Text search (M3) and MCP (M4) come next.

## Layout

| Path | Contents |
|---|---|
| `backend/` | Python API (FastAPI, SQLAlchemy, Alembic). Package `research_repo` in `backend/src/` |
| `citeproc/` | Internal citation service (Node 22, citeproc-js) that renders APA 7 references |
| `frontend/` | React + TypeScript SPA (Vite), served by nginx in production |
| `docker-compose.yml` | `db` (PostgreSQL 16), `citeproc`, `backend`, `frontend` |
| `DOCS/` | Design documents |

## Quick start (Docker Compose)

```sh
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, OWNER_EMAIL and OWNER_PASSWORD
docker compose up -d --build
```

Open `http://<server>:8080` and sign in with the owner credentials. Only the frontend container
publishes a port; it serves the SPA and proxies `/api` to the backend. The `citeproc` container
is reachable only by the backend, on the compose network. The backend applies
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

Rendering citations needs the citation service (see below); set `CITEPROC_URL` (default
`http://citeproc:8080`, the compose address) to where it runs. Everything else works without it.

Tests run against a real PostgreSQL database, which they wipe, and the real citation service
(Node 22; run `npm ci` in `citeproc/` once):

```sh
export TEST_DATABASE_URL=postgresql+asyncpg://research_repo:change-me@localhost:5432/research_repo_test
pytest
ruff check . && ruff format --check .
```

New migrations: change the models in `src/research_repo/models/`, then
`alembic revision --autogenerate -m "describe change"` and review the generated file.
`tests/test_migrations.py` fails if models and migrations disagree.

### Citation service

APA 7 references are rendered by a small Node service in `citeproc/`: citeproc-js (the CSL
processor used by Zotero and Mendeley) with the official APA 7th edition style. It exists
because the Python processor (citeproc-py) got too many APA cases wrong (editor labels, title
in place of the author, date ranges, punctuation inside quotation marks); citeproc-js passes the
whole gold set in `backend/tests/data/apa_gold.json`. It has no database and no state that
outlives a request.

```sh
cd citeproc
npm ci
PORT=8081 node server.js        # then run the backend with CITEPROC_URL=http://localhost:8081
node --test                      # its own tests
```

`GET /health` answers `{"status": "ok"}`. `POST /render` takes `{locale: "en-US"|"es", items:
[CSL-JSON items with unique ids], bibliography?: {ids?}, citations?: [{id, mode:
"parenthetical"|"narrative"}]}` and returns `{bibliography: [{id, html, text}], citations: [{id,
mode, text}], excluded_ids}`. Every item sent takes part in disambiguation (year suffixes, added
initials), so the caller chooses the scope by what it sends. An item the processor cannot render
is left out and listed in `excluded_ids` when it was not asked for, and makes the request fail
with 422 `render_failed` (with its id) when it was. Requests over `MAX_BODY_MB` (default 32) get
413. Logs are one JSON object per line.

The backend's citation tests run against this real service: the test session starts
`node citeproc/server.js` itself (so run `npm ci` in `citeproc/` first), or uses
`CITEPROC_TEST_URL` if set. Without Node those tests fail rather than skip.

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
| `MAX_UPLOAD_MB` | `200` | Largest PDF accepted per upload. Drives both the backend and nginx's `client_max_body_size` (the frontend image renders `frontend/nginx.conf` as a template at start) |
| `METADATA_LOOKUP_ENABLED` | `true` | Crossref lookups by DOI on upload and `POST /api/metadata/lookup`; `false` makes no outbound requests |
| `METADATA_LOOKUP_TIMEOUT_SECONDS` | `6` | Total time budget of one metadata suggestion (PDF inspection + Crossref) |
| `CROSSREF_MAILTO` | empty | Contact e-mail put in the User-Agent sent to Crossref (their "polite" pool) |
| `OWNER_EMAIL` / `OWNER_PASSWORD` / `OWNER_DISPLAY_NAME` | empty | Owner created on first start when no user exists |
| `SESSION_TTL_DAYS` | `30` | Login session lifetime |
| `COOKIE_SECURE` | `false` | `Secure` flag on the session cookie; enable only behind HTTPS |
| `LOGIN_RATE_LIMIT_ATTEMPTS` / `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `5` / `300` | Failed logins allowed per email and per IP per window |
| `CITEPROC_URL` | `http://citeproc:8080` | Address of the citation service (set by compose) |
| `CITEPROC_TIMEOUT_SECONDS` | `30` | Longest wait for one rendering request (connecting has a fixed 2 s limit) |
| `CITEPROC_MAX_BODY_MB` | `32` | Largest request the citation service accepts (its `MAX_BODY_MB`) |
| `LOG_LEVEL` | `INFO` | Backend log level |
| `TEST_DATABASE_URL` | none | Database used (and wiped) by the test suite |
| `CITEPROC_TEST_URL` | none | A running citation service for the tests; unset, the tests start one |

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
| `POST` | `/api/projects/{id}/copy` | `{name}` → 201 project: a non-archived copy owned by the caller (see M2) | editor |
| `GET` / `PATCH` / `DELETE` | `/api/projects/{id}` | Read; `{name?, description?, citation_locale?, archived?}`; delete with its folders, sources and unshared files | viewer / owner / owner |
| `GET` / `PUT` | `/api/projects/{id}/readme` | `{readme_md, updated_at}`; README up to 200 kB | viewer / editor |
| `GET` | `/api/projects/{id}/tree` | `{folders, sources}` as flat lists | viewer |
| `POST` | `/api/projects/{id}/folders` | `{name, parent_id?}` → 201 folder, appended last | editor |
| `PATCH` / `DELETE` | `/api/folders/{id}` | `{name?, parent_id?, position?}` (rename, move, reorder); delete moves contents up | editor |
| `POST` | `/api/projects/{id}/sources` | Multipart: `file?` (PDF), `folder_id?`, `title?` (required without file), `allow_duplicate?` → 201 source | editor |
| `GET` / `PATCH` / `DELETE` | `/api/sources/{id}` | Read; `{title?, folder_id?, last_page_read?, tags?, csl?, metadata_status?, citation_key?}` (M2 fields below); delete | viewer / editor (viewers may set `last_page_read`) / editor |
| `POST` | `/api/sources/move` | `{source_ids, folder_id}` → `{moved}`, all or nothing | editor |
| `GET` | `/api/sources/{id}/file` | The PDF, with single-range requests (206/416), `ETag`, `If-None-Match`, `If-Range` | viewer |

Non-members get 404 for a project and everything in it; members below the needed role get 403.

How it behaves:

- **Slugs.** Project slugs come from the name (`my-thesis`, `my-thesis-2`, …) and do not
  change on rename. Citation keys are described under M2.
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
  with `tags` replaces the source's full set. Unused tags are deleted.

### Citations (M2)

| Method | Path | Result | Role |
|---|---|---|---|
| `GET` | `/api/sources/{id}/citation` | `{style: "apa", locale, reference_text, reference_html, in_text_parenthetical, in_text_narrative}` in the project's `citation_locale` | viewer |
| `POST` | `/api/projects/{id}/bibliography` | `{format: "text"\|"html"\|"bibtex"\|"csl", source_ids?, folder_id?, include_subfolders?=true}` → `{format, count, content}` | viewer |
| `PUT` | `/api/sources/{id}/file` | Multipart `file`, `allow_duplicate?` → source; only for a source without a file | editor |
| `POST` | `/api/sources/{id}/metadata/suggest` | `{csl, origin: "doi"\|"pdf"\|"none", doi}`; nothing is saved | editor |
| `POST` | `/api/metadata/lookup` | `{doi}` (bare, `doi:…` or `https://doi.org/…`) → `{csl}` | any user |
| `GET` | `/api/config` | `{max_upload_mb, metadata_lookup_enabled}` | any user |

- **Metadata.** `csl` (a CSL-JSON item) is the canonical metadata of a source. `PATCH` with
  `csl` replaces it; it must be an object with a CSL item `type` and a non-empty `title`; names
  are `{family, given?}` or `{literal}`; dates are `{"date-parts": [[y, m?, d?]]}` (or a range of
  two), `{raw}` or `{literal}`; unknown keys are kept; at most 64 kB. The client never sends
  `id`: the server sets it to the citation key when rendering. `title`, `authors_text`, `year`
  and `doi` are derived from `csl` on every change, and a `PATCH` with `title` alone updates
  `csl.title`. `authors_text` is a short display form from family names: `García`,
  `García & Smith`, `García et al.` (corporate names as written; editors when there is no
  author). `metadata_status: "confirmed"` is the only status a client can set.
- **Citation keys.** While `citation_key_auto` is true the key follows the metadata: first
  author's family name (ASCII, lowercase) + year, e.g. `garcia2021`; a corporate author gives
  its first significant word; no author gives the first significant title word; no year gives
  `nd`. Collisions get `a`, `b`, … (`garcia2021a`). Keys of other sources never change as a
  side effect. `PATCH {citation_key: "my-key"}` (lowercase letters, digits, `-`, `_`, ≤ 64,
  unique in the project) makes it manual; `{citation_key: null}` returns to automatic.
- **Suggestions on upload.** After a PDF is stored (upload or attach to a `pending` source), the
  backend looks for a DOI in the PDF's information dictionary, then its XMP packet, then the
  text of the first two pages, and asks Crossref for the record. Failing that, the PDF's own
  title, author and creation year are used if the title looks real (not `Microsoft Word - …`,
  `untitled`, a file name, a single word…). A result is stored with `metadata_status:
  "suggested"`. This runs within `METADATA_LOOKUP_TIMEOUT_SECONDS` and never makes the upload fail.
- **APA 7 output** comes from the citation service (citeproc-js) with the official APA 7th
  edition CSL style and the CSL locale files, vendored unmodified in `citeproc/data/` (CC BY-SA
  3.0; see the README there). `en-US` uses `locales-en-US.xml`, `es` uses `locales-es-ES.xml`;
  the official style's wording is used as is (Spanish keeps "&" in references and parenthetical
  citations, "y" in narrative ones, and dates such as "(2021, abril 15)"). Narrative citations use
  a variant of the same style derived in memory (only the in-text layout and the word for "and"
  differ; see `citeproc/lib/style.js`). Disambiguation (year suffixes such as `2020a`, added
  initials) is done by the processor over the whole project for a source's citation and over the
  exported sources for a bibliography. `reference_html` contains only `<i>`, `<b>`, `<sup>` and
  `<sub>`; user text in it is escaped.
- **Citation service down.** If the service cannot be reached or does not answer within
  `CITEPROC_TIMEOUT_SECONDS`, the citation endpoint and `text`/`html` bibliographies answer 503
  `citation.unavailable`; `bibtex` and `csl` exports still work (ordered by author, year and
  title instead of the processor's order). `/api/health` checks only the database, so the app
  stays up; the backend logs the failure.
- **Bibliography scope.** No `source_ids` and no `folder_id` key: the whole project.
  `folder_id: null`: the project root (with `include_subfolders: true`, everything).
  `source_ids` and `folder_id` cannot be combined. `content` is a string for `text` (one
  reference per line), `html` (one `<p>` per reference) and `bibtex`, and a JSON array of CSL
  items (with `id` = citation key) for `csl`; all in APA order (BibTeX and CSL-JSON use the
  processor's order when it is available).
- **Archived projects are read-only.** Every change inside an archived project (README, folders,
  sources, tags, uploads, attaching, moves, metadata) is a 409 `project.archived`. Reading,
  citing, exporting, metadata suggestions, the reading position (`last_page_read`), copying and
  deleting the project still work; the only project edit accepted is `PATCH {archived: false}`.
- **Copying a project** creates a non-archived project owned by the caller with the same
  description, README, citation locale, folders, tags and sources (metadata, statuses,
  citation keys, tags; `last_page_read` reset to 1). The copy shares the stored PDFs; deleting
  either project keeps the files the other still uses. Members are not copied.
- **Tags** that no source uses any more are deleted automatically.

New error codes in M2: `project.archived`, `source.already_has_file`,
`source.citation_key_conflict`, `metadata.invalid_csl` (with `details.reason`),
`metadata.invalid_doi`, `metadata.doi_not_found`, `metadata.lookup_failed`,
`metadata.lookup_disabled`, `citation.render_failed` (500, with `details.citation_keys`, the
sources the processor could not render, when known). Since the switch to the citation service:
`citation.unavailable` (503).

Errors always have the shape `{"error": {"code": "folder.cycle", "message": "..."}}`, plus an
optional `details` object for some codes. `code` is a stable key that the frontend translates;
`message` is an English fallback. Codes used by M1: `project.not_found`, `folder.not_found`,
`folder.name_conflict`, `folder.cycle`, `source.not_found`, `source.invalid_pdf`,
`source.file_too_large`, `source.duplicate_file`, `source.move_invalid`, `source.no_file`,
`source.range_not_satisfiable`, plus the general `validation.invalid`, `auth.forbidden` and
`auth.not_authenticated`.

The backend runs as a single process: the in-memory login limiter and the storage lock, which
serialises the creation and deletion of stored files, both assume one worker.
