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
        applyUpdate(document, buf);
      }
      return document;
    },

    async onStoreDocument({ documentName, document }) {
      const { docId, kind } = parseDocName(documentName);
      const { encodeStateAsUpdate } = await import('yjs');
      const update = encodeStateAsUpdate(document);
      db.setYjsState(docId, Buffer.from(update), kind);
    },
  });
}
