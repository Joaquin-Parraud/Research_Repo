import { ApiError, NETWORK_ERROR_CODE, UNKNOWN_ERROR_CODE } from "./errors";

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // Non-JSON error body: fall through to the unknown code.
  }
  const code = typeof body.error?.code === "string" ? body.error.code : UNKNOWN_ERROR_CODE;
  const message = typeof body.error?.message === "string" ? body.error.message : response.statusText;
  return new ApiError(code, response.status, message);
}

export async function apiRequest<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(NETWORK_ERROR_CODE, 0, "Network error");
  }
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
