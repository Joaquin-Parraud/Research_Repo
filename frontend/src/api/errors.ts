export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/** Error code used when the server could not be reached at all. */
export const NETWORK_ERROR_CODE = "network";
/** Error code used when the response was not in the documented error shape. */
export const UNKNOWN_ERROR_CODE = "unknown";
