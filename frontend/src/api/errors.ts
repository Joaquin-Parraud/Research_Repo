export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Error code used when the server could not be reached at all. */
export const NETWORK_ERROR_CODE = "network";
/** Error code used when the response was not in the documented error shape. */
export const UNKNOWN_ERROR_CODE = "unknown";
