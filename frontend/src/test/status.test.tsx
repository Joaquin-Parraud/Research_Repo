import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryTree } from "../api/library";
import { baseRoutes, makeSource, makeSummary, sampleTree } from "./fixtures";
import { jsonResponse, mockApi, renderApp } from "./helpers";

vi.mock("../features/viewer/pdfjs", () => ({ loadPdfjs: vi.fn(() => new Promise(() => undefined)) }));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function statusTree(): LibraryTree {
  return {
    folders: sampleTree().folders,
    sources: [
      makeSummary("a", "Apple", null, { metadata_status: "pending" }),
      makeSummary("b", "Banana", null, { metadata_status: "suggested", authors_text: "Smith, A.", year: 2019 }),
      makeSummary("c", "Cherry", null, { metadata_status: "confirmed", authors_text: "Álvarez, M.", year: 2022 }),
      makeSummary("d", "Date", null, { metadata_status: "confirmed", authors_text: "Doe, J.", year: 2020 }),
    ],
  };
}

const rowOf = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) }).closest("li") as HTMLElement;
const order = () =>
  within(screen.getByRole("list", { name: "Sources in this folder" }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("button span")?.textContent);

async function renderList(tree = statusTree()) {
  mockApi({ ...baseRoutes({ tree }) });
  renderApp("/p/p1");
  await screen.findByRole("list", { name: "Sources in this folder" });
}

describe("metadata status in the list", () => {
  it("badges pending and suggested sources and nothing for confirmed ones", async () => {
    await renderList();
    expect(within(rowOf("Apple")).getByText("Needs metadata")).toBeInTheDocument();
    expect(within(rowOf("Banana")).getByText("Review suggestion")).toBeInTheDocument();
    expect(within(rowOf("Cherry")).queryByText(/Needs metadata|Review suggestion/)).not.toBeInTheDocument();
    expect(within(rowOf("Date")).queryByText(/Needs metadata|Review suggestion/)).not.toBeInTheDocument();
  });

  it("shows the server-derived authors and year", async () => {
    await renderList();
    expect(within(rowOf("Banana")).getByText("Smith, A.")).toBeInTheDocument();
    expect(within(rowOf("Banana")).getByText("2019")).toBeInTheDocument();
  });

  it("filters to sources that need review (pending + suggested) and back", async () => {
    await renderList();
    const filter = screen.getByRole("checkbox", { name: "Needs review (2)" });
    await userEvent.click(filter);
    expect(order()).toEqual(["Apple", "Banana"]);
    expect(screen.getByText("2 sources")).toBeInTheDocument();
    await userEvent.click(filter);
    expect(order()).toEqual(["Apple", "Banana", "Cherry", "Date"]);
  });

  it("says so when nothing needs review", async () => {
    const tree = statusTree();
    tree.sources = tree.sources.filter((s) => s.metadata_status === "confirmed");
    await renderList(tree);
    await userEvent.click(screen.getByRole("checkbox", { name: "Needs review (0)" }));
    expect(screen.getByText("Nothing to review")).toBeInTheDocument();
    // An empty folder keeps its own message.
    expect(screen.queryByText("No sources here")).not.toBeInTheDocument();
  });

  it("sorts by authors and by year, both directions, with unknown values last", async () => {
    await renderList();
    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "authors");
    expect(order()).toEqual(["Cherry", "Date", "Banana", "Apple"]);
    await userEvent.click(screen.getByRole("button", { name: /Ascending/ }));
    expect(order()).toEqual(["Banana", "Date", "Cherry", "Apple"]);

    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "year");
    expect(order()).toEqual(["Cherry", "Date", "Banana", "Apple"]);
    await userEvent.click(screen.getByRole("button", { name: /Descending/ }));
    expect(order()).toEqual(["Banana", "Date", "Cherry", "Apple"]);
  });

  it("filtering narrows what 'Select all' and the export selection cover", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("checkbox", { name: "Needs review (2)" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });
});

describe("metadata status in the details", () => {
  it.each([
    ["pending", "Needs metadata"],
    ["suggested", "Review suggestion"],
  ] as const)("shows %s", async (status, label) => {
    mockApi({
      ...baseRoutes(),
      "GET /api/sources/s3": () =>
        jsonResponse(200, makeSource({ id: "s3", title: "Gamma report", has_file: false, file: null, metadata_status: status })),
    });
    renderApp("/p/p1?source=s3");
    const heading = await screen.findByRole("heading", { name: "Gamma report" });
    const details = heading.closest("section") as HTMLElement;
    expect(within(details).getByText(label)).toBeInTheDocument();
  });

  it("shows no badge once confirmed", async () => {
    mockApi({
      ...baseRoutes(),
      "GET /api/sources/s3": () => jsonResponse(200, makeSource({ id: "s3", title: "Gamma report", has_file: false, file: null })),
    });
    renderApp("/p/p1?source=s3");
    await screen.findByRole("heading", { name: "Gamma report" });
    expect(screen.queryByText("Needs metadata")).not.toBeInTheDocument();
    expect(screen.queryByText("Review suggestion")).not.toBeInTheDocument();
  });
});
