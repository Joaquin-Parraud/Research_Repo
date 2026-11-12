import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import type { User } from "../api/auth";
import i18n from "../i18n";
import { AppRoutes } from "../routes";

export const testUser: User = {
  id: "u1",
  email: "ana@example.org",
  display_name: "Ana",
  language: "en",
};

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  });
}

export function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { error: { code, message: "English fallback" } });
}

type Handler = (init: RequestInit) => Response | Promise<Response>;

/** Replaces fetch with a router keyed by "METHOD /path". Unrouted calls fail the test. */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${String(input)}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function renderApp(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}
