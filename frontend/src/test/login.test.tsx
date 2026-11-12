import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse, jsonResponse, mockApi, renderApp, testUser } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "ana@example.org");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("login", () => {
  it("signs in and shows the app shell", async () => {
    const fetchMock = mockApi({
      "GET /api/auth/me": () => errorResponse(401, "auth.not_authenticated"),
      "POST /api/auth/login": () => jsonResponse(200, testUser),
    });
    renderApp("/login");

    await fillAndSubmit();

    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([url]) => url === "/api/auth/login");
    expect(loginCall?.[1]?.body).toBe(JSON.stringify({ email: "ana@example.org", password: "secret" }));
    expect(loginCall?.[1]?.credentials).toBe("include");
  });

  it("shows a translated error on bad credentials", async () => {
    mockApi({
      "GET /api/auth/me": () => errorResponse(401, "auth.not_authenticated"),
      "POST /api/auth/login": () => errorResponse(401, "auth.invalid_credentials"),
    });
    renderApp("/login");

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(screen.queryByText("English fallback")).not.toBeInTheDocument();
  });

  it("falls back to a generic translated message for unknown codes and network failures", async () => {
    const fetchMock = mockApi({
      "GET /api/auth/me": () => errorResponse(401, "auth.not_authenticated"),
      "POST /api/auth/login": () => errorResponse(500, "something.new"),
    });
    renderApp("/login");
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again.",
    );

    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
  });
});
