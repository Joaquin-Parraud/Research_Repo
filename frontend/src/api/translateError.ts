import type { i18n as I18n } from "i18next";
import { ApiError, NETWORK_ERROR_CODE, UNKNOWN_ERROR_CODE } from "./errors";

/**
 * Translates an error by its code. Unknown codes fall back to a generic
 * translated message; the server's English `message` is never displayed.
 */
export function translateError(i18n: I18n, error: unknown): string {
  const code = error instanceof ApiError ? error.code : UNKNOWN_ERROR_CODE;
  const key = `errors:${code}`;
  if (code !== UNKNOWN_ERROR_CODE && i18n.exists(key)) return i18n.t(key);
  return i18n.t(code === NETWORK_ERROR_CODE ? "errors:network" : "errors:unknown");
}
