import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isIP } from "node:net";
import { createSiteRecords, parseBulkInput } from "./queue.js";
import { BraveSubmitter } from "./submitter.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "src", "public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3210);
const SUBMISSION_DELAY_MS = Number(process.env.SUBMISSION_DELAY_MS || 1500);
const VERIFICATION_TIMEOUT_MS = Number(process.env.VERIFICATION_TIMEOUT_MS || 30_000);

function normalizeHost(value) {
  return String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function isLoopbackHost(value) {
  const host = normalizeHost(value);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIP(host) === 4) return host.startsWith("127.");
  if (isIP(host) === 6) return host === "::1";
  return false;
}

if (!isLoopbackHost(HOST)) {
  throw new Error("HOST must be a loopback address or localhost. This server has no authentication and must not be exposed to the network.");
}

function requestHostIsAllowed(request) {
  const rawHost = request.headers.host || "";
  try {
    const hostname = new URL(`http://${rawHost}`).hostname;
    return isLoopbackHost(hostname);
  } catch {
    return false;
  }
}

function requestOriginIsAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return isLoopbackHost(hostname);
  } catch {
    return false;
  }
}

function requireJson(request, response) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    json(response, 415, { error: "Content-Type must be application/json." });
    return false;
  }
  return true;
}

const state = {
  sites: [],
  run: {
    status: "idle",
    total: 0,
    completed: 0,
    failed: 0,
    currentUrl: null,
    startedAt: null,
    finishedAt: null
  },
  events: [],
  stopRequested: false
};

let submitter = null;
let runPromise = null;
const clients = new Set();

function publicState() {
  return {
    sites: state.sites,
    run: state.run,
    events: state.events
  };
}

function logEvent(message, type = "info") {
  state.events.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    type,
    message
  });
  state.events = state.events.slice(0, 80);
  broadcast();
}

function broadcast() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const response of clients) response.write(payload);
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) reject(new Error("Request body is too large"));
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return json(response, 403, { error: "Forbidden" });

  fs.readFile(filePath, (error, data) => {
    if (error) return json(response, 404, { error: "Not found" });
    response.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
    response.end(data);
  });
}

async function runQueue(siteIds) {
  state.stopRequested = false;
  const selected = state.sites.filter((site) => siteIds.includes(site.id));
  state.run = {
    status: "running",
    total: selected.length,
    completed: 0,
    failed: 0,
    currentUrl: null,
    startedAt: new Date().toISOString(),
    finishedAt: null
  };
  logEvent(`Started run for ${selected.length} URL${selected.length === 1 ? "" : "s"}.`);

  submitter = new BraveSubmitter({
    verificationTimeoutMs: VERIFICATION_TIMEOUT_MS,
    executablePath: process.env.BRAVE_EXECUTABLE_PATH || "",
    onStage: (stage) => logEvent(`${state.run.currentUrl}: ${stage}.`, stage === "failed" ? "error" : "info")
  });

  try {
    for (const site of selected) {
      if (state.stopRequested) break;
      state.run.currentUrl = site.url;
      site.status = "submitting";
      site.attempts += 1;
      site.lastError = null;
      broadcast();

      const result = await submitter.submit(site.url);
      if (result.status === "success") {
        site.status = "success";
        site.submittedAt = new Date().toISOString();
        state.run.completed += 1;
        logEvent(`${site.url} was accepted by Brave Search.`, "success");
      } else {
        site.status = "failed";
        site.lastError = result.message;
        state.run.failed += 1;
        logEvent(`${site.url} failed: ${result.message}`, "error");
      }
      broadcast();
      if (!state.stopRequested) await delay(SUBMISSION_DELAY_MS);
    }

    state.run.status = state.stopRequested ? "stopped" : "complete";
    state.run.finishedAt = new Date().toISOString();
    state.run.currentUrl = null;
    logEvent(state.stopRequested ? "Run stopped after the current URL." : "Run complete.", state.stopRequested ? "warning" : "success");
  } catch (error) {
    state.run.status = "failed";
    state.run.finishedAt = new Date().toISOString();
    state.run.currentUrl = null;
    logEvent(`Run stopped unexpectedly: ${error.message}`, "error");
  } finally {
    await submitter.close().catch(() => {});
    submitter = null;
    runPromise = null;
    broadcast();
  }
}

const server = http.createServer(async (request, response) => {
  if (!requestHostIsAllowed(request)) {
    return json(response, 403, { error: "Invalid Host header." });
  }
  if (!requestOriginIsAllowed(request)) {
    return json(response, 403, { error: "Cross-origin requests are not allowed." });
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === "GET" && requestUrl.pathname === "/api/state") {
    return json(response, 200, publicState());
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    response.write(`data: ${JSON.stringify(publicState())}\n\n`);
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/sites") {
    if (!requireJson(request, response)) return;
    try {
      if (runPromise) return json(response, 409, { error: "Stop the current run before changing the queue." });
      const body = await parseBody(request);
      const parsed = parseBulkInput(body.input || "");
      if (!parsed.sites.length) return json(response, 400, { error: "Add at least one valid public URL.", errors: parsed.errors });
      state.sites = createSiteRecords(parsed.sites);
      state.events = [];
      logEvent(`Queue loaded with ${state.sites.length} URL${state.sites.length === 1 ? "" : "s"}.`);
      return json(response, 200, { ...publicState(), errors: parsed.errors });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/run") {
    if (!requireJson(request, response)) return;
    try {
      if (runPromise) return json(response, 409, { error: "A run is already in progress." });
      const body = await parseBody(request);
      const selectedIds = Array.isArray(body.siteIds) ? body.siteIds : state.sites.filter((site) => site.status !== "success").map((site) => site.id);
      const selected = state.sites.filter((site) => selectedIds.includes(site.id) && site.status !== "success");
      if (!selected.length) return json(response, 400, { error: "Select at least one ready or failed URL." });
      runPromise = runQueue(selected.map((site) => site.id));
      return json(response, 202, { ok: true, message: "Run started." });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/run/stop") {
    if (!requireJson(request, response)) return;
    state.stopRequested = true;
    logEvent("Stop requested. The current browser action will finish before the queue stops.", "warning");
    return json(response, 200, { ok: true });
  }

  if (request.method === "GET") return serveStatic(request, response, requestUrl.pathname);
  return json(response, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Brave Bulk Submitter running at http://${HOST}:${PORT}`);
});

async function shutdown() {
  state.stopRequested = true;
  await submitter?.close().catch(() => {});
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
