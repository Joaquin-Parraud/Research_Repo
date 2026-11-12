# Research Repo — Software Design Document

| | |
|---|---|
| **Status** | Draft v0.5 — for discussion |
| **Author** | Joaquín Parraud |
| **Last updated** | 2026-11-12 |

> Items marked **[PROPOSED]** are defaults chosen to keep the draft concrete. They are not decided yet. Everything still undecided is collected in [§12 Open questions](#12-open-questions); decisions already taken are logged in [§12.1](#121-decisions).

---

## 1. Overview

Research Repo is a platform for organising research projects and their sources. It sits between two existing ideas:

- **NotebookLM**: a set of sources per project that an AI can read and answer from.
- **GitHub**: a repository per project, with a browsable tree, stable identifiers and a clear home for everything that belongs to the work.

Each research project holds a library of sources. Every source carries an APA 7 citation, can be opened and read in the browser (PDF), and lives in a user-defined folder tree that can be rearranged freely. An MCP server exposes the same library to AI assistants, so a project can be used as a grounded knowledge source.

## 2. Goals and non-goals

### 2.1 Goals (v1)

1. Manage several independent research projects.
2. Store sources per project, each with structured bibliographic metadata and a generated APA 7 reference.
3. Read a source's PDF inside the app by clicking it.
4. Organise sources in nested folders ("directories") grouped by theme, and move sources and folders around at will.
5. Expose projects, folders, citations and source text to AI clients through an MCP server.
6. Give each project a README front page, like a repository.

Planned after v1, in this order: sharing a project with collaborators, semantic search, per-project tasks (see [§4.8](#48-readme-tasks-and-sharing) and [§11](#11-roadmap)).

### 2.2 Non-goals (v1)

- Built-in chat or AI answers inside the app. The AI lives in the MCP client; Research Repo is the knowledge source.
- Manuscript writing and tracking, Notion and GitHub integrations. These are planned (see [§11](#11-roadmap)) and the design leaves room for them, but they are out of v1.
- Real-time collaborative editing.
- PDF annotation and highlighting.
- Source types other than PDF as readable files. A source may exist as a citation with no file attached.

## 3. Users and core use cases

Primary user: a researcher running several projects in parallel, who is the owner of the instance. Collaborators invited to individual projects come later; accounts and project membership exist in the data model from the first migration so that adding them does not require a rewrite.

| # | Use case | Notes |
|---|---|---|
| UC1 | Create a project | Name, description, optional research question |
| UC2 | Add a source | Upload a PDF; metadata is pre-filled from DOI or the PDF itself, then confirmed by the user |
| UC3 | Add a citation-only source | For books or reports with no PDF at hand |
| UC4 | Read a source | Click a source, the PDF opens next to its citation |
| UC5 | Organise | Create, rename, nest and delete folders; drag sources and folders between folders |
| UC6 | Cite | Copy the APA 7 reference or in-text citation; export a folder or project bibliography |
| UC7 | Search | By title, author, year, and inside the full text |
| UC8 | Ask an AI | An MCP client lists, searches and reads the project's sources and cites them with page numbers |

## 4. Functional requirements

### 4.1 Projects
- FR-P1: Create, rename, archive and delete projects.
- FR-P2: Each project has its own folder tree and source library. Nothing is shared between projects implicitly.

### 4.2 Folders
- FR-F1: Arbitrary nesting depth.
- FR-F2: Create, rename, move (re-parent) and delete folders. Deleting a non-empty folder requires confirmation and moves its sources to the parent **[PROPOSED]**.
- FR-F3: Manual ordering within a folder.
- FR-F4: A source lives in exactly one folder per project, like a file in a directory. Cross-cutting grouping is handled with tags (FR-S6).

### 4.3 Sources
- FR-S1: Upload one or many PDFs (drag and drop), into a chosen folder.
- FR-S2: On upload, attempt metadata extraction in this order: DOI found in the PDF → lookup in Crossref; PDF embedded metadata; manual entry.
- FR-S3: Metadata is always editable. Extraction is a suggestion; the user confirms it.
- FR-S4: Move one or many sources between folders. A move never touches the stored file.
- FR-S5: Duplicate detection by file hash and by DOI within a project.
- FR-S8: The same paper in two projects is two independent source records (own folder, tags, citation key and metadata edits) that point to one stored file. When a PDF already known to the instance is added to another project, the app offers to copy the existing metadata as a starting point.
- FR-S6: Free-form tags per source.
- FR-S7: Each source has a short, stable citation key (e.g. `garcia2021`) unique within its project.

### 4.4 Citations
- FR-C1: Bibliographic metadata is stored as **CSL-JSON**, the standard structured format used by citation processors.
- FR-C2: APA 7 output is produced by a CSL processor with the official APA 7th edition style, never by hand-built string templates. This covers the many APA edge cases (author counts, corporate authors, missing dates, source types).
- FR-C3: For each source: full reference, parenthetical in-text form, narrative in-text form.
- FR-C4: Export a bibliography for a selection, folder or project, sorted per APA rules, as formatted text, BibTeX and CSL-JSON.
- FR-C5: Because the canonical data is CSL-JSON, other styles can be added later with no schema change.

### 4.5 Reading
- FR-R1: In-browser PDF viewer with page navigation, zoom, text selection and in-document search.
- FR-R2: Remember the last page read per source.
- FR-R3: Citation panel next to the viewer with copy buttons.

### 4.6 Search
- FR-Q1: Metadata search (title, authors, year, tags) scoped to a project or folder.
- FR-Q2: Full-text search across extracted PDF text, returning matching passages with page numbers.
- FR-Q3: Semantic (embedding) search is a later version (M6). Keyword search is the v1 scope.
- FR-Q4: Scanned PDFs with no text layer are stored and readable, but not searchable. They are flagged as such in the UI. OCR is deferred.

### 4.7 MCP
See [§8](#8-mcp-server).

### 4.8 README, tasks and sharing
- FR-G1 (v1): Each project has a Markdown README shown as its front page: research question, scope, status, notes. Edited in the app.
- FR-G2 (later, after sharing and semantic search): Tasks per project, in the spirit of GitHub issues: title, Markdown body, open/closed state, labels, optional links to sources ("read and summarise `garcia2021`").
- FR-G3 (first milestone after v1): Share a project with collaborators by invitation, with roles: `owner`, `editor` (add, edit and move sources, manage tasks), `viewer` (read and cite only).
- FR-G4: Access to PDFs follows project membership. There are no public links to files.

### 4.9 Language
- FR-L1: The interface is available in English and Spanish from the first release. Each user chooses their language in settings; the first visit follows the browser language.
- FR-L2: No user-facing string is hard-coded. All UI text, validation messages and API error messages go through translation catalogues, so adding a third language is a translation task only.
- FR-L3: Interface language and citation language are separate. Each project has a citation locale (default English) that controls how references are rendered, since an APA reference list in Spanish differs from one in English ("y" for "&", translated terms such as "Recuperado de"). A user can work in a Spanish interface on a manuscript written in English.
- FR-L4: User content (titles, READMEs, tags) is never translated. Full-text search picks its language configuration per source, from the source's metadata language, so stemming works for both Spanish and English texts.
- FR-L5: MCP tool names and descriptions stay in English; the content they return is in whatever language the source is.

## 5. Non-functional requirements

- **Ownership of data**: PDFs and the database stay on infrastructure the user controls. Full export (files + metadata) must always be possible.
- **Copyright**: sources are often copyrighted papers. The instance is private; no public sharing of files in v1.
- **Performance**: opening a 50 MB PDF should start rendering in under 2 s on the local network. Full-text search under 500 ms for a library of about 5,000 sources.
- **Reliability**: uploads are atomic; a failed text extraction never loses the file or its metadata.
- **Portability**: the whole stack starts with one `docker compose up`.

## 6. Architecture

### 6.1 Components

```
┌──────────────┐        ┌──────────────────────────────────────┐
│  Web client  │ HTTPS  │              Backend                 │
│  (SPA)       ├───────►│  REST API  ·  services  ·  MCP server │
│  PDF viewer  │        └───────┬─────────────┬────────────────┘
└──────────────┘                │             │
                         ┌──────▼─────┐ ┌─────▼──────────┐
┌──────────────┐  MCP    │ PostgreSQL │ │  File storage  │
│  AI client   ├────────►│ metadata   │ │  PDFs (content │
│              │         │ full text  │ │  addressed)    │
└──────────────┘         └────────────┘ └────────────────┘
                                ▲
                         ┌──────┴─────┐
                         │   Worker   │  text extraction,
                         │            │  metadata lookup
                         └────────────┘
```

- **Web client**: single-page app. Project list, folder tree, source list, PDF viewer, citation panel.
- **Backend**: one service exposing a REST API to the web client and an MCP endpoint to AI clients. Both call the same service layer, so the MCP server never has logic the UI lacks.
- **Worker**: background jobs for PDF text extraction and metadata lookup, so uploads return immediately.
- **PostgreSQL**: metadata, folder tree, extracted text and full-text indexes.
- **File storage**: PDF binaries on disk behind a storage interface, so an S3-compatible backend can replace it later.

### 6.2 Technology stack

Python backend with a React frontend is decided. The individual libraries below are proposals.

| Layer | Choice | Reason |
|---|---|---|
| Backend | Python + FastAPI | Strong PDF, citation and ML ecosystem; official MCP Python SDK |
| Database | PostgreSQL | Built-in full-text search; `pgvector` extension available for phase 2 semantic search without adding a second database |
| Migrations / ORM | SQLAlchemy + Alembic | Standard for FastAPI |
| Background jobs | Simple DB-backed job queue | Avoids running Redis for a single-user system |
| PDF text extraction | PyMuPDF | Fast, page-level text. License (AGPL) is fine for private self-hosting; revisit if the project is ever distributed |
| Citation formatting | `citeproc-py` + official APA 7 CSL style | Implements FR-C2 |
| Metadata lookup | Crossref REST API (by DOI) | Free, returns data that maps directly to CSL-JSON |
| Frontend | React + TypeScript + Vite | Mature tree, drag-and-drop and PDF components |
| PDF rendering | PDF.js | Standard in-browser renderer |
| Internationalisation | `react-i18next` on the frontend; message keys returned by the API | English and Spanish catalogues from M0 |
| Packaging | Docker Compose | One-command deployment |

Alternative considered: a full TypeScript stack (Next.js + official MCP TypeScript SDK). One language end to end, but weaker PDF extraction and later ML tooling.

### 6.3 Deployment

Self-hosted with Docker Compose on a personal Ubuntu server, reachable only over a private Tailscale network. No public exposure, which keeps the copyrighted PDFs private. AI clients are self-run tools that sit on the same network; see [§8.4](#84-transport-and-connectivity).

Authentication is still required inside the private network: a login session for the web app and API tokens for MCP. This is what makes per-project sharing possible later.

Consequence for sharing: a collaborator must be able to reach the server. Options, to be chosen when sharing is built: invite them to the Tailscale network or share the single machine with them through Tailscale, or expose the app publicly behind HTTPS at that point.

## 7. Data model

```
Project 1───* Folder (self-referencing tree)
Project 1───* Source *───1 Folder
Source  *───0..1 File
Source  1───* SourcePage
Source  *───* Tag
User    *───* Project   (through Membership, with a role)
```

### 7.1 Entities

**project**
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| name, slug | text | slug unique |
| description | text | |
| readme_md | text | Markdown front page |
| citation_locale | text | `en-US` or `es`; default `en-US`; editable in project settings |
| archived_at | timestamp, nullable | |
| created_at, updated_at | timestamp | |

**folder**
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| project_id | FK | |
| parent_id | FK → folder, nullable | null = project root |
| name | text | unique among siblings |
| position | integer | manual ordering |

The tree uses a plain adjacency list (`parent_id`). Moving a folder is a single-row update. Subtree and path queries use recursive CTEs, which are fast at this scale. A move is rejected if the target is the folder itself or one of its descendants.

**source**
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| project_id | FK | |
| folder_id | FK, nullable | null = project root |
| citation_key | text | unique per project |
| csl | JSONB | canonical CSL-JSON metadata |
| title, year, authors_text | text / int | denormalised from `csl` for listing and search |
| doi | text, nullable | |
| file_id | FK, nullable | null = citation-only source |
| metadata_status | enum | `pending`, `suggested`, `confirmed` |
| text_status | enum | `none`, `queued`, `done`, `no_text_layer`, `failed` |
| last_page_read | integer | |
| created_at, updated_at | timestamp | |

**file**
| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| sha256 | text, unique | content address |
| size_bytes, page_count | integer | |
| original_filename | text | |

Files are stored on disk under their hash (`storage/ab/cd/<sha256>.pdf`). The folder tree exists only in the database, so reorganising never moves bytes and the same PDF added to two projects is stored once.

**source_page**
| Field | Type | Notes |
|---|---|---|
| source_id | FK | |
| page_number | integer | |
| text | text | extracted text of that page |
| tsv | tsvector | full-text index, built with the source's language configuration |

Page-level storage is deliberate: search results and MCP responses can always point to a page, which is what an APA in-text citation of a direct quote needs.

**tag**, **source_tag**: simple many-to-many.

**user**: id, email, display name, password hash, interface language. v1 has one row, the owner.

**membership**: user_id, project_id, role (`owner`, `editor`, `viewer`). Created from the first migration and checked by every service call, so v1 already runs through the same permission path that sharing will use.

**api_token**: hashed tokens for MCP and API access, belonging to a user, with a label, a mode (`read` or `read_write`), optional project scope and last-used timestamp. A token can never see more than its user can.

**activity_log**: timestamp, user, token (if the change came through MCP), project, action, target, before/after summary. Written for every change made through MCP; reused later to show collaborators' changes.

### 7.2 Reserved for later
`task`, `task_label`, `task_source` (tasks and their links to sources), `invitation`, `chunk` (text chunks + embeddings for semantic search), `manuscript`, `manuscript_citation` (which sources a manuscript cites), `annotation`.

## 8. MCP server

### 8.1 Purpose
Let an AI assistant treat a project as a citable knowledge base: discover what is in it, find the relevant passages, read them, and cite them correctly.

### 8.2 Read tools

The MCP server has two modes, chosen per API token when the token is created: **read** (default) exposes only the tools in this section; **read-write** adds the tools in §8.3. The user decides, per client, whether an assistant may change the library.

| Tool | Input | Returns |
|---|---|---|
| `list_projects` | — | Projects with id, name, description, source count |
| `get_project_readme` | project | The project README, so the assistant knows the research question and scope |
| `get_project_tree` | project | Folder tree with the sources in each folder (key, title, authors, year) |
| `search_sources` | project, query, optional folder / tag / year filters | Matching sources by metadata |
| `search_text` | project, query, optional folder, limit | Matching passages: source key, page number, snippet |
| `get_source` | source | Full metadata, APA 7 reference, in-text forms, page count, folder path |
| `read_source` | source, page range | Extracted text for those pages, labelled by page |
| `get_bibliography` | project or folder or list of sources | APA 7 reference list |

Design notes:
- Every passage returned carries its source key and page number, and `get_source` returns the ready-made APA strings, so the assistant never has to invent a citation.
- `read_source` is paginated to keep responses within context limits; long papers are read in page ranges.
- Folder scoping on the search tools lets the user say "only use the sources in *Methodology*".

### 8.3 Write tools (read-write tokens only)

| Tool | Input | Effect |
|---|---|---|
| `create_folder` | project, name, optional parent | New folder |
| `move_folder` | folder, new parent | Re-parent a folder |
| `move_sources` | sources, target folder | Move one or many sources |
| `tag_sources` | sources, tags to add / remove | Edit tags |
| `add_source_by_doi` | project, DOI, optional folder | Citation-only source from a metadata lookup, left in `suggested` status for the user to confirm |
| `upload_source` | project, optional folder, and one of: URL, local file path, base64 content | New source with a PDF; goes through the normal extraction pipeline and is left in `suggested` status |
| `attach_file` | source, same file inputs | Add a PDF to a citation-only source that has none |
| `update_source_metadata` | source, CSL-JSON fields | Correct a citation |
| `update_project_readme` | project, Markdown | Replace the README |

How an assistant hands over a PDF, since MCP tool calls carry JSON and not files:
- **URL**: the server downloads the file. Suited to open-access papers and preprints.
- **Local file path**: available on the stdio transport, where the launcher runs on the assistant's machine, reads the file and sends it to the backend. Suited to PDFs already downloaded.
- **Base64 content**: fallback for small files only, with a size cap, because the whole file passes through the model's context.

Limits that hold in both modes:
- No tool deletes anything. Deleting sources, folders and projects is done in the web app only.
- No tool replaces or removes an existing PDF. `attach_file` only works on a source with no file.
- Sources created by an assistant are marked as such and stay in `suggested` status until the user confirms their metadata.
- With a read token the write tools are not listed to the client at all, so the assistant does not see them.
- Every write made through MCP is recorded with the token that made it (see §8.5).

### 8.4 Transport and connectivity
The MCP server supports two transports from the same code:

- **stdio**: for desktop and CLI clients running on a machine that can reach the backend. Simplest; no public exposure.
- **Streamable HTTP**: served by the backend for remote clients, authenticated with an API token.

Target clients are self-run tools such as Cursor and OpenClaw. They run on machines inside the private network, so they can use either transport: stdio through a small launcher on the same machine, or Streamable HTTP pointed at the server's Tailscale address.

Cloud-hosted AI clients connect from the vendor's servers, so they can only reach an MCP endpoint that is on the public internet over HTTPS, usually with OAuth. They are out of scope. Supporting them later means exposing only the MCP endpoint publicly and adding OAuth; nothing else in the design changes.

### 8.5 Security
- Tokens are stored hashed, can be scoped to specific projects and revoked.
- Tokens are read-only unless created as read-write. A token's effective rights are the lesser of its mode and its user's role in the project.
- Writes through MCP go to an activity log (who, which token, what changed), visible in the app, so changes made by an assistant can be reviewed and undone by hand.
- Uploads by URL are fetched by the server, so the fetcher only follows `http(s)` URLs to public addresses (no private-network or loopback targets, redirects re-checked), enforces a size limit and rejects anything that is not a PDF.
- Text extracted from PDFs is untrusted content and is returned as data only. Tool descriptions state this, since a PDF could contain text written to manipulate an assistant.

## 9. REST API (sketch)

```
GET    /api/projects                      POST /api/projects
GET    /api/projects/{id}                 PATCH / DELETE
GET    /api/projects/{id}/tree            folder tree + source summaries
GET    /api/projects/{id}/readme          PUT to update

POST   /api/projects/{id}/folders
PATCH  /api/folders/{id}                  rename, re-parent, reorder
DELETE /api/folders/{id}

POST   /api/projects/{id}/sources         multipart upload or citation-only
GET    /api/sources/{id}
PATCH  /api/sources/{id}                  metadata, folder, tags
POST   /api/sources/move                  bulk move {source_ids, folder_id}
DELETE /api/sources/{id}
GET    /api/sources/{id}/file             PDF, supports HTTP range requests
GET    /api/sources/{id}/citation?style=apa

POST   /api/metadata/lookup               {doi} → suggested CSL-JSON
GET    /api/projects/{id}/search?q=&scope=metadata|text&folder=
GET    /api/projects/{id}/bibliography?folder=&format=text|bibtex|csl
```

Range request support on the file endpoint lets PDF.js show the first pages before the whole file has downloaded.

## 10. User interface

Three-pane layout:

```
┌────────────┬──────────────────────┬─────────────────────────────┐
│ Projects   │ Sources in folder    │ PDF viewer                  │
│ ▾ Thesis   │ ─────────────────    │                             │
│   ▾ Theory │ García (2021) …      │                             │
│     Method │ Smith & Lee (2019) … │                             │
│   ▸ Data   │ OECD (2023) …        ├─────────────────────────────┤
│ ▸ Paper B  │                      │ APA 7 reference   [copy]    │
│            │ [+ Add source]       │ (García, 2021)    [copy]    │
└────────────┴──────────────────────┴─────────────────────────────┘
```

- Left: project switcher and folder tree. Drag folders to re-parent them; drop sources onto folders to move them.
- Middle: sources in the selected folder, sortable by author, year, title or date added. Multi-select for bulk move, tag and bibliography export.
- Right: PDF viewer on top, citation panel below. Citation-only sources show the metadata form instead of a viewer.
- Selecting a project with no folder or source selected shows its README, as a repository's front page does.
- Upload flow: drop PDFs on a folder → each appears immediately as "pending" → suggested metadata appears → user confirms or edits.

## 11. Roadmap

| Milestone | Scope |
|---|---|
| **M0 — Skeleton** | Repo layout, Docker Compose, database migrations, CI, owner login, user and membership tables, i18n scaffolding with English and Spanish catalogues |
| **M1 — Library** | Projects with README, folder tree, PDF upload, drag-and-drop moves, PDF viewer |
| **M2 — Citations** | CSL-JSON metadata, DOI lookup, APA 7 output, bibliography export |
| **M3 — Text** | Page-level text extraction, metadata and full-text search |
| **M4 — MCP** | MCP server with read and read-write token modes, API tokens, activity log |
| **M5 — Sharing** | Invitations, roles, collaborator access path |
| **M6 — Semantic search** | Chunking, embeddings, hybrid search, exposed through MCP |
| **M7 — Tasks** | Per-project tasks with labels and links to sources; exposed through MCP |
| **Later** | OCR for scanned PDFs, manuscript tracking and source ↔ manuscript links, Notion and GitHub integrations, annotations |

M1 to M4 together are the v1 described in this document.

## 12. Open questions

| # | Question | Current assumption |
|---|---|---|
| Q8 | Source types beyond PDF in v1 (web pages, EPUB, videos)? | PDF and citation-only |
| Q14 | How will collaborators reach a server that is only on the private network: join or be shared into Tailscale, or expose the app publicly at that point? | Decide when sharing is built |
| Q15 | Can collaborators upload sources and edit metadata, or only read and cite? | Per-role: editors can, viewers cannot |
| Q17 | Embeddings for semantic search: computed locally on the server, or through an external API (which sends source text to a third party)? | Decide at M6 |

### 12.1 Decisions

| Date | Decision |
|---|---|
| 2026-11-12 | Hosting: self-hosted on own Ubuntu server, reachable over Tailscale only |
| 2026-11-12 | MCP clients: self-run tools (Cursor, OpenClaw and similar). Cloud-hosted clients out of scope |
| 2026-11-12 | Stack: Python backend, React frontend |
| 2026-11-12 | "GitHub" side: project README (v1), tasks and sharing with collaborators (post-v1). No version history |
| 2026-11-12 | User accounts and project membership are in the schema from the first migration, though v1 has a single owner |
| 2026-11-12 | A source lives in exactly one folder; tags handle cross-cutting grouping |
| 2026-11-12 | Search: keyword full-text in v1; semantic search in a later version |
| 2026-11-12 | Order after v1: sharing, then semantic search, then tasks |
| 2026-11-12 | MCP offers both a read-only and a read-write mode, selected per API token; default is read-only |
| 2026-11-12 | OCR for scanned PDFs deferred |
| 2026-11-12 | Read-write MCP tokens can upload PDFs. No MCP tool deletes or replaces anything |
| 2026-11-12 | Same paper in two projects: separate source records, one stored file |
| 2026-11-12 | Interface language is user-selectable (English and Spanish) from the first release |
| 2026-11-12 | One citation language per project, changeable at any time in project settings; changing it re-renders all references |
| 2026-11-12 | Spanish is neutral Spanish (`es`) for both interface and citations |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Automatic metadata extraction is unreliable for PDFs with no DOI | Extraction is a suggestion; user confirmation step; manual form always available |
| APA 7 edge cases formatted incorrectly | Use a CSL processor and the official style; keep a test set of tricky references |
| Private-network deployment blocks cloud AI clients and makes collaborator access harder | Accepted for AI clients; HTTP transport and token auth are designed in from the start. Collaborator access path is Q14 |
| An assistant with a read-write token reorganises, mislabels or clutters the library | Read-only by default; no delete or replace tools; assistant-added sources flagged and unconfirmed; activity log of every MCP write |
| Server-side download of PDFs by URL abused to reach internal services | Public `http(s)` targets only, size cap, PDF type check |
| Translations drift as features are added | CI check that both catalogues have the same keys |
| Sharing copyrighted PDFs with collaborators | Access tied to project membership, no public links, private instance |
| Text extraction quality on two-column or scanned papers | Page-level storage limits the damage; OCR as a later option |
| Scope creep from the "GitHub" and integration ideas | v1 fixed at M1–M4; later features only reserved in the data model |
