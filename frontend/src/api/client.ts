import { ApiError, NETWORK_ERROR_CODE, UNKNOWN_ERROR_CODE } from "./errors";

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Builds an ApiError from a parsed (or unparsable, `undefined`) error response body. */
export function errorFromBody(status: number, statusText: string, parsed: unknown): ApiError {
  const body: ErrorBody = isRecord(parsed) ? (parsed as ErrorBody) : {};
  const code = typeof body.error?.code === "string" ? body.error.code : UNKNOWN_ERROR_CODE;
  const message = typeof body.error?.message === "string" ? body.error.message : statusText;
  const details = isRecord(body.error?.details) ? body.error.details : undefined;
  return new ApiError(code, status, message, details);
}

async function toApiError(response: Response): Promise<ApiError> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // Non-JSON error body: fall through to the unknown code.
  }
  return errorFromBody(response.status, response.statusText, parsed);
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** JSON request. A `FormData` body is sent as-is (multipart) so the browser sets the boundary. */
export async function apiRequest<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(NETWORK_ERROR_CODE, 0, "Network error");
  }
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
