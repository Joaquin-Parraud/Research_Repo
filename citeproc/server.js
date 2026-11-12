"use strict";
/**
 * Research Repo citation service: APA 7 with citeproc-js and the official CSL style.
 *
 * Environment: PORT (default 8080), HOST (default 0.0.0.0), MAX_BODY_MB (default 32).
 * Internal network only: there is no authentication.
 */

const { createApp, createLogger } = require("./lib/app");
const { Renderer } = require("./lib/render");

const SHUTDOWN_GRACE_MS = 10_000;

function positiveNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function main() {
  const logger = createLogger();
  const port = positiveNumber("PORT", 8080);
  const host = process.env.HOST || "0.0.0.0";
  const maxBodyBytes = Math.floor(positiveNumber("MAX_BODY_MB", 32) * 1024 * 1024);

  const started = Date.now();
  const renderer = new Renderer({ logger });
  renderer.warm();
  logger.info("engines_ready", { ms: Date.now() - started });

  const server = createApp({ renderer, logger, maxBodyBytes });
  server.listen(port, host, () => {
    const address = server.address();
    logger.info("listening", { host: address.address, port: address.port, max_body_bytes: maxBodyBytes });
  });

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info("shutdown", { signal });
    server.close(() => {
      logger.info("stopped");
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => {
      logger.warn("shutdown_forced", { after_ms: SHUTDOWN_GRACE_MS });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("uncaughtException", (error) => {
    logger.error("uncaught_exception", { error: String(error?.stack ?? error) });
    process.exit(1);
  });
}

main();
