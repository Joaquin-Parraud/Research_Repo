import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse, jsonResponse, mockApi, renderApp, testUser } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("language switcher", () => {
  it("switches the login page language without calling the API", async () => {
    const fetchMock = mockApi({
      "GET /api/auth/me": () => errorResponse(401, "auth.not_authenticated"),
    });
    renderApp("/login");

    await userEvent.selectOptions(await screen.findByLabelText("Language"), "es");

    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("switches language and persists it with PATCH when logged in", async () => {
    const fetchMock = mockApi({
      "GET /api/auth/me": () => jsonResponse(200, testUser),
      "PATCH /api/auth/me": () => jsonResponse(200, { ...testUser, language: "es" }),
    });
    renderApp("/");

    await userEvent.selectOptions(await screen.findByLabelText("Language"), "es");

    expect(await screen.findByRole("heading", { name: "Proyectos" })).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch?.[0]).toBe("/api/auth/me");
    expect(patch?.[1]?.body).toBe(JSON.stringify({ language: "es" }));
  });

  it("uses the saved language of the logged-in user", async () => {
    mockApi({ "GET /api/auth/me": () => jsonResponse(200, { ...testUser, language: "es" }) });
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Proyectos" })).toBeInTheDocument();
  });

  it("shows API errors in Spanish, never the English fallback message", async () => {
    mockApi({
      "GET /api/auth/me": () => errorResponse(401, "auth.not_authenticated"),
      "POST /api/auth/login": () => errorResponse(401, "auth.invalid_credentials"),
    });
    renderApp("/login");
    await userEvent.selectOptions(await screen.findByLabelText("Language"), "es");
    await userEvent.type(await screen.findByLabelText("Correo electrónico"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Contraseña"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Correo electrónico o contraseña incorrectos.",
    );
  });
});
