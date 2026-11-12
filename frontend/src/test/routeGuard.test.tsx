import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse, jsonResponse, mockApi, renderApp, testUser } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("route guard", () => {
  it("redirects unauthenticated users to the login page", async () => {
    mockApi({ "GET /api/auth/me": () => errorResponse(401, "auth.not_authenticated") });
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("redirects authenticated users away from the login page", async () => {
    mockApi({ "GET /api/auth/me": () => jsonResponse(200, testUser) });
    renderApp("/login");
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("logs out and returns to the login page", async () => {
    mockApi({
      "GET /api/auth/me": () => jsonResponse(200, testUser),
      "POST /api/auth/logout": () => jsonResponse(204),
    });
    renderApp("/");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
