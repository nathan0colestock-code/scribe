// Scribe — Express + Hocuspocus on one port.
// Dev: Vite on :5173 proxies /api + /ws here (:3748). Prod: serves dist/.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { parse as parseCookie } from 'cookie';
import { WebSocketServer } from 'ws';
import { createRequire } from 'node:module';

import * as db from './db.js';
import { createCollabServer } from './collab.js';
import { router as documentsRouter } from './routes/documents.js';
import { router as shareRouter } from './routes/share.js';
import { router as commentsRouter } from './routes/comments.js';
import { router as suggestionsRouter } from './routes/suggestions.js';
import { router as glossRouter } from './routes/gloss-links.js';
import { router as aiRouter } from './routes/ai.js';
import { router as styleRouter } from './routes/style.js';
import { router as outlineRouter } from './routes/outline.js';
import { router as commsRouter } from './routes/comms.js';

// ---- Env loader (simple KEY=VALUE .env, no dotenv dep) ----
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
} catch {}

const PORT = Number(process.env.PORT || 3748);
const IS_PROD = process.env.NODE_ENV === 'production';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PROD ? '' : 'dev-session-secret');
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const OWNER_EMAIL = process.env.SCRIBE_OWNER_EMAIL || 'nathan@local';

const AUTH_ENABLED = IS_PROD || !!AUTH_PASSWORD;

if (IS_PROD) {
  if (!AUTH_PASSWORD || !SESSION_SECRET) {
    console.error('[auth] AUTH_PASSWORD and SESSION_SECRET must be set in production.');
    process.exit(1);
  }
}

// ---- Signed session cookies ----
function signOwnerCookie() {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(ts).digest('hex');
  return `${ts}.${sig}`;
}
function verifyOwnerCookie(val) {
  if (!val) return null;
  const [ts, sig] = val.split('.');
  if (!ts || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(ts).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Date.now() - Number(ts) > COOKIE_MAX_AGE_MS) return null;
  return OWNER_EMAIL;
}
function signShareSession({ email, documentId, role, token }) {
  const payload = Buffer.from(JSON.stringify({ email, documentId, role, token, ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function verifyShareSession(val) {
  if (!val) return null;
  const [payload, sig] = val.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Date.now() - data.ts > COOKIE_MAX_AGE_MS) return null;
    return data;
  } catch { return null; }
}

// ---- Express setup ----
const app = express();
app.use(express.json({ limit: '4mb' }));

app.use((req, _res, next) => {
  const cookies = parseCookie(req.headers.cookie || '');
  req.ownerEmail = verifyOwnerCookie(cookies.scribe_auth);
  const share = verifyShareSession(cookies.scribe_share);
  req.shareSession = share;
  // Resolve a primary identity for the request.
  if (req.ownerEmail) {
    req.user = { email: req.ownerEmail, role: 'editor', is_owner: true };
  } else if (share) {
    req.user = { email: share.email, role: share.role, is_owner: false, token: share.token, documentId: share.documentId };
  } else if (!AUTH_ENABLED) {
    req.user = { email: OWNER_EMAIL, role: 'editor', is_owner: true };
  } else {
    req.user = null;
  }
  next();
});

// ---- Bearer auth (suite-wide) ----
// Accepts either the app's own API_KEY or the shared SUITE_API_KEY env var.
// Used for /api/status (and any future suite-level probes). Cookie session
// remains the primary path for interactive UI use.
function checkBearerAuth(req) {
  const header = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  const token = m ? m[1].trim() : (req.headers['x-api-key'] || '').trim();
  if (!token) return false;
  const candidates = [process.env.API_KEY, process.env.SUITE_API_KEY].filter(Boolean);
  if (candidates.length === 0) return false;
  const tBuf = Buffer.from(token);
  for (const c of candidates) {
    const cBuf = Buffer.from(c);
    if (tBuf.length === cBuf.length && crypto.timingSafeEqual(tBuf, cBuf)) return true;
  }
  return false;
}
function requireBearer(req, res, next) {
  if (checkBearerAuth(req)) return next();
  return res.status(401).json({ error: 'auth required' });
}

// Load package.json version for /api/status.
const APP_VERSION = (() => {
  try {
    const req = createRequire(import.meta.url);
    return req('./package.json').version || '0.0.0';
  } catch { return '0.0.0'; }
})();

// ---- Public routes ----
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- /api/status ----
// Suite-wide status endpoint. Returns app name, version, uptime, and a small
// set of metrics. Each metric is wrapped in try/catch so a bad query can't
// take the endpoint down — probes should never flap because of a migration.
app.get('/api/status', requireBearer, (_req, res) => {
  const runCount = (sql) => {
    try {
      const row = db.db.prepare(sql).get();
      if (!row) return 0;
      const v = Object.values(row)[0];
      return typeof v === 'number' ? v : Number(v) || 0;
    } catch { return 0; }
  };
  const runNullableCount = (sql) => {
    try {
      const row = db.db.prepare(sql).get();
      if (!row) return null;
      const v = Object.values(row)[0];
      return typeof v === 'number' ? v : Number(v) || 0;
    } catch { return null; }
  };

  const total_documents = runCount('SELECT COUNT(*) AS n FROM documents');
  // Active collaborators in the last 5 minutes (null if column/table absent).
  const active_collaborators = runNullableCount(
    `SELECT COUNT(DISTINCT user_email) AS n FROM document_collaborators
     WHERE last_seen_at IS NOT NULL
       AND last_seen_at >= datetime('now','-5 minutes')`
  );
  const gloss_linked_collections = runCount(
    "SELECT COUNT(*) AS n FROM gloss_links WHERE kind = 'collection'"
  );

  res.json({
    app: 'scribe',
    version: APP_VERSION,
    ok: true,
    uptime_seconds: Math.floor(process.uptime()),
    metrics: {
      total_documents,
      active_collaborators,
      gloss_linked_collections,
    },
  });
});

// ── Login rate limit ──────────────────────────────────────────────────────────
// In-memory sliding window; 5 attempts / 15 minutes per IP. No persistence —
// a machine restart wipes the counter, which is acceptable for a single-user
// app. Matches the pattern in comms/black/server.js.
const LOGIN_RATE = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
function loginRateLimit(req, res, next) {
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = LOGIN_RATE.get(key);
  if (rec && now - rec.firstAttemptAt > LOGIN_WINDOW_MS) LOGIN_RATE.delete(key);
  const cur = LOGIN_RATE.get(key);
  if (cur && cur.count >= LOGIN_MAX_ATTEMPTS) {
    const retry = Math.ceil((cur.firstAttemptAt + LOGIN_WINDOW_MS - now) / 1000);
    res.set('Retry-After', String(Math.max(retry, 1)));
    return res.status(429).json({ error: 'too many attempts' });
  }
  if (LOGIN_RATE.size > 1000) {
    for (const [k, v] of LOGIN_RATE) {
      if (now - v.firstAttemptAt > LOGIN_WINDOW_MS) LOGIN_RATE.delete(k);
    }
  }
  next();
}
function recordLoginAttempt(req) {
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const cur = LOGIN_RATE.get(key);
  if (cur) cur.count += 1;
  else LOGIN_RATE.set(key, { count: 1, firstAttemptAt: Date.now() });
}

app.post('/api/login', loginRateLimit, (req, res) => {
  const { password } = req.body || {};
  if (!AUTH_ENABLED) return res.json({ ok: true });
  if (!password || typeof password !== 'string') return res.status(400).json({ error: 'password required' });
  const a = Buffer.from(password);
  const b = Buffer.from(AUTH_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    recordLoginAttempt(req);
    return res.status(401).json({ error: 'bad password' });
  }
  const cookie = signOwnerCookie();
  const secure = IS_PROD ? '; Secure' : '';
  res.setHeader('Set-Cookie', `scribe_auth=${cookie}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${Math.floor(COOKIE_MAX_AGE_MS / 1000)}`);
  res.json({ ok: true, email: OWNER_EMAIL });
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'scribe_auth=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  const u = db.getUser(req.user.email || '');
  res.json({
    email: req.user.email,
    role: req.user.role,
    is_owner: !!req.user.is_owner,
    display_name: u?.display_name || req.user.email,
    color: u?.color || '#7c3aed',
  });
});

// Share-token join: public (you need the token).
app.post('/api/join', (req, res) => {
  const { token, displayName, color } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token required' });
  const share = db.getShareToken(token);
  if (!share || share.revoked_at) return res.status(404).json({ error: 'invalid token' });
  const name = (displayName || '').trim() || 'Guest';
  const email = `guest-${crypto.createHash('sha256').update(`${token}:${name}`).digest('hex').slice(0, 10)}@scribe.local`;
  const hue = Math.floor(Math.random() * 360);
  const pickedColor = color || `hsl(${hue} 65% 55%)`;
  db.upsertUser({ email, display_name: name, color: pickedColor });
  db.addCollaborator(share.document_id, email, share.role);
  const session = signShareSession({ email, documentId: share.document_id, role: share.role, token });
  const secure = IS_PROD ? '; Secure' : '';
  res.setHeader('Set-Cookie', `scribe_share=${session}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${Math.floor(COOKIE_MAX_AGE_MS / 1000)}`);
  res.json({ ok: true, documentId: share.document_id, role: share.role, email, displayName: name, color: pickedColor });
});

// ---- Auth gate for everything else ----
function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: 'unauthenticated' });
}
app.use('/api', requireAuth);

// Issues a token the Hocuspocus WebSocket layer will accept. HTTP-authenticated
// via the middleware above; the browser fetches this after /api/me and hands it
// to the HocuspocusProvider. Owner → scribe_auth cookie value (opaque HMAC);
// share session → the raw share_tokens.token.
app.get('/api/documents/:id/collab-token', (req, res) => {
  const doc = db.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  if (!AUTH_ENABLED) return res.json({ token: 'dev' });
  if (req.ownerEmail && doc.owner_email === req.ownerEmail) {
    const cookies = parseCookie(req.headers.cookie || '');
    return res.json({ token: cookies.scribe_auth || '' });
  }
  if (req.shareSession && req.shareSession.documentId === doc.id) {
    return res.json({ token: req.shareSession.token });
  }
  return res.status(403).json({ error: 'no collab access' });
});

app.use('/api/documents', documentsRouter);
app.use('/api/documents', shareRouter);
app.use('/api/documents', commentsRouter);
app.use('/api/documents', suggestionsRouter);
app.use('/api/documents', glossRouter);
app.use('/api/documents', outlineRouter);
app.use('/api/documents', commsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/style-guides', styleRouter);

// ---- Static (prod) ----
if (IS_PROD) {
  const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
  app.use(express.static(distDir));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// ---- HTTP + WebSocket (Hocuspocus) ----
const server = http.createServer(app);
const collab = createCollabServer({
  resolveOwnerSession(token) { return verifyOwnerCookie(token); },
  authEnabled: AUTH_ENABLED,
  ownerEmail: OWNER_EMAIL,
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  if (!(request.url || '').startsWith('/ws')) return socket.destroy();
  wss.handleUpgrade(request, socket, head, (ws) => {
    collab.handleConnection(ws, request);
  });
});

server.listen(PORT, () => {
  console.log(`[scribe] http + ws on :${PORT} (env=${IS_PROD ? 'prod' : 'dev'}, auth=${AUTH_ENABLED ? 'on' : 'off'})`);
});
