"use strict";
/**
 * HTTP interface (internal network only, no authentication).
 *
 *   GET  /health  → 200 {"status": "ok"}
 *   POST /render  → 200 {"bibliography": [{id, html, text}], "citations": [{id, mode, text}],
 *                        "excluded_ids": [id]}
 *
 * Errors: {"error": {"code", "message", "ids"?}} with 400 invalid_request, 404 not_found,
 * 405 method_not_allowed, 413 body_too_large, 415 unsupported_media_type, 422 render_failed
 * (with the ids of the items the processor could not render) and 500 internal.
 * See validate.js for the request body and render.js for how rendering works.
 */

const http = require("node:http");
const { BadRequest, parseRenderRequest } = require("./validate");
const { RenderFailed } = require("./render");

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function send(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpError(413, "body_too_large", `the body is larger than ${maxBytes} bytes`));
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        reject(new HttpError(413, "body_too_large", `the body is larger than ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", (error) => {
      if (!done) {
        done = true;
        reject(error);
      }
    });
  });
}

function createApp({ renderer, logger, maxBodyBytes }) {
  async function handleRender(req) {
    const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      throw new HttpError(415, "unsupported_media_type", "send the body as application/json");
    }
    const raw = await readBody(req, maxBodyBytes);
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new HttpError(400, "invalid_request", "the body is not valid JSON");
    }
    let request;
    try {
      request = parseRenderRequest(body);
    } catch (error) {
      if (error instanceof BadRequest) throw new HttpError(400, "invalid_request", error.message);
      throw error;
    }
    try {
      const result = renderer.render(request);
      return { result, items: request.items.size };
    } catch (error) {
      if (error instanceof RenderFailed) {
        throw new HttpError(422, "render_failed", error.message, { ids: error.ids });
      }
      throw error;
    }
  }

  const server = http.createServer(async (req, res) => {
    const started = process.hrtime.bigint();
    const path = (req.url ?? "/").split("?")[0];
    const fields = { method: req.method, path };
    let status = 500;
    try {
      if (path === "/health") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          throw new HttpError(405, "method_not_allowed", "use GET", { allow: "GET, HEAD" });
        }
        status = 200;
        send(res, status, { status: "ok" });
      } else if (path === "/render") {
        if (req.method !== "POST") {
          throw new HttpError(405, "method_not_allowed", "use POST", { allow: "POST" });
        }
        const { result, items } = await handleRender(req);
        fields.items = items;
        if (result.excluded_ids.length) fields.excluded_ids = result.excluded_ids;
        status = 200;
        send(res, status, result);
      } else {
        throw new HttpError(404, "not_found", "no such endpoint");
      }
    } catch (error) {
      const known = error instanceof HttpError;
      status = known ? error.status : 500;
      const body = {
        error: {
          code: known ? error.code : "internal",
          message: known ? error.message : "unexpected error",
        },
      };
      const headers = {};
      if (known && error.extra.ids) body.error.ids = error.extra.ids;
      if (known && error.extra.allow) headers.allow = error.extra.allow;
      if (status === 413) headers.connection = "close";
      fields.error = known ? error.message : String(error?.stack ?? error);
      if (!res.headersSent) send(res, status, body, headers);
      else res.destroy();
    } finally {
      fields.status = status;
      fields.ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
      if (path !== "/health" || status !== 200) {
        logger.log(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "request", fields);
      }
    }
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  // Longer than the backend's keep-alive expiry, so the server never closes a pooled
  // connection the client is about to reuse.
  server.keepAliveTimeout = 65_000;
  return server;
}

/** One JSON object per line on stdout (stderr for errors). */
function createLogger({ stream = process.stdout, errorStream = process.stderr, silent = false } = {}) {
  const log = (level, event, fields = {}) => {
    if (silent) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
    (level === "error" ? errorStream : stream).write(`${line}\n`);
  };
  return {
    log,
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
  };
}

module.exports = { createApp, createLogger };
