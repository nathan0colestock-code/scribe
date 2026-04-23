// Hocuspocus setup — realtime collab backed by Yjs, persisted to documents.yjs_state
// or documents.outline_yjs_state depending on the document name suffix.
//
// documentName can be either:
//   "<docId>"          — draft (maps to yjs_state)
//   "<docId>:outline"  — outline doc (maps to outline_yjs_state)
//   "<docId>:draft"    — draft alias (maps to yjs_state)

import { Server } from '@hocuspocus/server';
import * as db from './db.js';

function parseDocName(documentName) {
  const [docId, kind = 'draft'] = documentName.split(':');
  return { docId, kind };
}

// Per-doc store counters + last-snapshot timestamps for the opportunistic
// auto-snapshot policy in onStoreDocument. Keyed by `${docId}:${kind}` so
// draft vs. outline snapshots are tracked independently. Module-scoped
// (single process per host) — intentionally not persisted.
const _storeCounters = new Map();      // key → integer
const _lastAutoSnapshotAt = new Map(); // key → ms timestamp
const AUTO_SNAPSHOT_EVERY_N_STORES = 20;
const AUTO_SNAPSHOT_MIN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_SNAPSHOTS_PER_DOC = 20;

export function createCollabServer({ resolveOwnerSession, authEnabled = true, ownerEmail } = {}) {
  return Server.configure({
    async onAuthenticate({ token, documentName }) {
      const { docId } = parseDocName(documentName);
      const doc = db.getDocument(docId);
      if (!doc) throw new Error('Unknown document');

      if (!authEnabled) {
        return { user: { email: ownerEmail, role: 'editor', is_owner: true } };
      }

      if (token && resolveOwnerSession) {
        const email = resolveOwnerSession(token);
        if (email && email === doc.owner_email) {
          return { user: { email, role: 'editor', is_owner: true } };
        }
      }

      if (token) {
        const share = db.getShareToken(token);
        if (share && share.document_id === docId && !share.revoked_at) {
          return { user: { email: null, role: share.role, is_owner: false, token } };
        }
      }

      throw new Error('Unauthorized');
    },

    async onLoadDocument({ documentName, document }) {
      const { docId, kind } = parseDocName(documentName);
      const buf = db.getYjsState(docId, kind);
      if (buf && buf.length) {
        const { applyUpdate } = await import('yjs');
        // Yjs applyUpdate throws on truncated / pathological buffers.
        // Historically this rejected onLoadDocument, which closed the WS
        // and made the doc unopenable — one bad update would brick a doc
        // permanently. Instead: log, preserve the corrupt bytes as a
        // snapshot for offline forensics, and fall back to an empty doc
        // so the user can still open and edit.
        try {
          applyUpdate(document, buf);
        } catch (err) {
          const hex = Buffer.from(buf).toString('hex').slice(0, 200);
          console.warn(
            `[collab] applyUpdate failed for ${documentName} (${buf.length} bytes): ${err.message}. First 100 bytes: ${hex}. Falling back to empty doc.`
          );
          try {
            db.createSnapshot(docId, Buffer.from(buf), `corruption_fallback:${kind}`);
          } catch (e) {
            console.warn(`[collab] failed to persist corruption_fallback snapshot: ${e.message}`);
          }
        }
      }
      return document;
    },

    async onStoreDocument({ documentName, document }) {
      const { docId, kind } = parseDocName(documentName);
      const { encodeStateAsUpdate } = await import('yjs');
      const update = encodeStateAsUpdate(document);
      const buf = Buffer.from(update);
      db.setYjsState(docId, buf, kind);

      // Opportunistic auto-snapshot: write to document_snapshots every N
      // stores, gated by a minimum per-doc time interval. Keeps the last
      // MAX_SNAPSHOTS_PER_DOC auto entries per doc to bound storage.
      const key = `${docId}:${kind}`;
      const nextCount = (_storeCounters.get(key) || 0) + 1;
      _storeCounters.set(key, nextCount);
      const now = Date.now();
      const sinceLast = now - (_lastAutoSnapshotAt.get(key) || 0);
      if (nextCount % AUTO_SNAPSHOT_EVERY_N_STORES === 0 &&
          sinceLast >= AUTO_SNAPSHOT_MIN_INTERVAL_MS) {
        try {
          db.createSnapshot(docId, buf, `auto:${kind}`);
          _lastAutoSnapshotAt.set(key, now);
          pruneAutoSnapshots(docId, kind);
        } catch (err) {
          console.warn(`[collab] auto-snapshot failed for ${documentName}: ${err.message}`);
        }
      }
    },
  });
}

// Exposed for direct use (e.g. from routes/documents.js on stage transitions)
// and tested in isolation below.
export function snapshotForStageTransition(docId, fromStage, toStage, kind = 'draft') {
  const buf = db.getYjsState(docId, kind);
  if (!buf || !buf.length) return null;
  return db.createSnapshot(docId, Buffer.from(buf), `stage:${fromStage}→${toStage}`);
}

// Keep only the last MAX_SNAPSHOTS_PER_DOC auto snapshots per doc (by kind).
// Manual `stage:` / `corruption_fallback` snapshots are preserved.
function pruneAutoSnapshots(docId, kind) {
  try {
    const label = `auto:${kind}`;
    const rows = db.listSnapshots(docId).filter(r => r.label === label);
    if (rows.length <= MAX_SNAPSHOTS_PER_DOC) return;
    const surplus = rows.slice(MAX_SNAPSHOTS_PER_DOC); // listSnapshots is DESC
    for (const r of surplus) {
      db.deleteSnapshot(r.id);
    }
  } catch (err) {
    console.warn(`[collab] pruneAutoSnapshots failed: ${err.message}`);
  }
}

// Exposed counters for tests — no external callers otherwise.
export const __test = {
  _storeCounters,
  _lastAutoSnapshotAt,
  AUTO_SNAPSHOT_EVERY_N_STORES,
  AUTO_SNAPSHOT_MIN_INTERVAL_MS,
};
