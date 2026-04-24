// Structured logging for scribe.
//
// Contract (see plans/overnight/shared-rules.md):
//   - log(level, event, ctx) emits a JSON line to stderr.
//   - Keeps the last 1000 entries (24h) in a ring buffer so Maestro's
//     log-collector can pull them via GET /api/logs/recent.
//   - HTTP middleware logs every request as event:'http'.
//   - X-Trace-Id: echo if present, else crypto.randomUUID(). Exposed on
//     req.trace_id so outbound helpers can propagate.
//
// ESM — matches the rest of this app.

import crypto from 'node:crypto';

const APP = 'scribe';
export const MAX_ENTRIES = 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

const buffer = [];

function pushBuffer(entry) {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  pruneOld();
}

function pruneOld() {
  const cutoff = Date.now() - MAX_AGE_MS;
  while (buffer.length && Date.parse(buffer[0].ts) < cutoff) buffer.shift();
}

export function log(level, event, ctx = {}) {
  const lvl = LEVEL_RANK[level] ? level : 'info';
  const entry = {
    ts: new Date().toISOString(),
    app: APP,
    level: lvl,
    event: String(event || 'unknown'),
  };
  if (ctx && typeof ctx === 'object') {
    if (ctx.trace_id)    entry.trace_id    = ctx.trace_id;
    if (ctx.request_id)  entry.request_id  = ctx.request_id;
    if (ctx.duration_ms != null) entry.duration_ms = ctx.duration_ms;
    const { trace_id, request_id, duration_ms, ...rest } = ctx;
    if (Object.keys(rest).length) entry.ctx = rest;
  }
  pushBuffer(entry);
  try { process.stderr.write(JSON.stringify(entry) + '\n'); } catch {}
  return entry;
}

export function recent({ since, level, limit } = {}) {
  pruneOld();
  let out = buffer.slice();
  if (since) {
    const t = Date.parse(since);
    if (Number.isFinite(t)) out = out.filter(e => Date.parse(e.ts) >= t);
  }
  if (level && LEVEL_RANK[level]) {
    const min = LEVEL_RANK[level];
    out = out.filter(e => LEVEL_RANK[e.level] >= min);
  }
  const n = Math.max(1, Math.min(parseInt(limit, 10) || MAX_ENTRIES, MAX_ENTRIES));
  return out.slice(-n);
}

// Clear the ring buffer — tests only.
export function _reset() { buffer.length = 0; }

// S-I-03: trace-id middleware. Echoes inbound X-Trace-Id (if sane) or
// generates one. Sets req.trace_id so outbound helpers (gloss, black,
// readwise) can propagate it. Also logs every request at info/warn/error
// depending on status class.
export function httpMiddleware(req, res, next) {
  const traceHeader = req.headers['x-trace-id'];
  const traceId = (typeof traceHeader === 'string' && traceHeader.trim())
    ? traceHeader.trim().slice(0, 200)
    : crypto.randomUUID();
  req.trace_id = traceId;
  res.setHeader('X-Trace-Id', traceId);
  const start = Date.now();
  res.on('finish', () => {
    const duration_ms = Date.now() - start;
    const status = res.statusCode;
    const lvl = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    log(lvl, 'http', {
      trace_id: traceId,
      method: req.method,
      path: req.path,
      status,
      duration_ms,
    });
  });
  next();
}
