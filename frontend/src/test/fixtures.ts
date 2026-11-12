import type { Folder, LibraryTree, Source, SourceSummary } from "../api/library";
import type { Project, Role } from "../api/projects";
import { jsonResponse, testUser } from "./helpers";

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Thesis",
    slug: "thesis",
    description: "",
    citation_locale: "en-US",
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    role: "owner",
    source_count: 3,
    ...overrides,
  };
}

export function makeFolder(id: string, name: string, parent_id: string | null = null, position = 0): Folder {
  return { id, project_id: "p1", parent_id, name, position };
}

export function makeSummary(id: string, title: string, folder_id: string | null, overrides: Partial<SourceSummary> = {}): SourceSummary {
  return {
    id,
    folder_id,
    title,
    authors_text: null,
    year: null,
    citation_key: id,
    has_file: true,
    metadata_status: "pending",
    text_status: "queued",
    page_count: 10,
    created_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

export function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "s1",
    project_id: "p1",
    folder_id: null,
    title: "Alpha paper",
    authors_text: null,
    year: null,
    citation_key: "alpha",
    doi: null,
    metadata_status: "pending",
    text_status: "queued",
    last_page_read: 1,
    has_file: true,
    file: { size_bytes: 2_500_000, page_count: 10, original_filename: "alpha.pdf" },
    tags: [],
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

/** Folders: Theory(f1) > Method(f2); Data(f3). Sources: Alpha, Gamma at root; Beta in Theory; Delta in Method. */
export function sampleTree(): LibraryTree {
  return {
    folders: [
      makeFolder("f1", "Theory", null, 0),
      makeFolder("f2", "Method", "f1", 0),
      makeFolder("f3", "Data", null, 1),
    ],
    sources: [
      makeSummary("s1", "Alpha paper", null),
      makeSummary("s3", "Gamma report", null, { has_file: false, page_count: null, created_at: "2026-03-01T00:00:00Z" }),
      makeSummary("s2", "Beta study", "f1"),
      makeSummary("s4", "Delta notes", "f2"),
    ],
  };
}

type Handler = (init: RequestInit) => Response | Promise<Response>;

interface BaseOptions {
  role?: Role;
  tree?: LibraryTree;
  readme?: string;
  projects?: Project[];
}

/** The requests every project screen makes. Spread into `mockApi` and add test-specific routes. */
export function baseRoutes(options: BaseOptions = {}): Record<string, Handler> {
  const project = makeProject({ role: options.role ?? "owner" });
  return {
    "GET /api/auth/me": () => jsonResponse(200, testUser),
    "GET /api/projects?include_archived=false": () => jsonResponse(200, options.projects ?? [project]),
    "GET /api/projects/p1": () => jsonResponse(200, project),
    "GET /api/projects/p1/tree": () => jsonResponse(200, options.tree ?? sampleTree()),
    "GET /api/projects/p1/readme": () =>
      jsonResponse(200, { readme_md: options.readme ?? "", updated_at: "2026-01-01T00:00:00Z" }),
  };
}

export function bodyOf(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
}
