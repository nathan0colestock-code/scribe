// Shared access-control helper for per-document routes.
//
// Resolves the effective role of the requester for a given document id and
// writes 404/403 responses directly when the document is missing or the user
// has no role. Returns { doc, role, isOwner } on success, null on failure —
// so callers follow the pattern:
//
//   const a = ensureAccess(req, res, { docId }); if (!a) return;
//
// Options:
//   docId      explicit document id to look up. Defaults to req.params.id.
//   minRole    minimum role required. One of 'viewer' | 'suggester' | 'editor'.
//              Default 'viewer' admits any non-null role.
//   allowShareSession
//              when true (default), a share-session token with matching
//              documentId grants its embedded role. gloss-links routes pass
//              false — they're owner/collaborator only.
import * as db from '../db.js';

const ROLE_RANK = { viewer: 1, suggester: 2, editor: 3 };

export function ensureAccess(req, res, opts = {}) {
  const {
    docId = req.params?.id,
    minRole = 'viewer',
    allowShareSession = true,
  } = opts;
  const doc = db.getDocument(docId);
  if (!doc) { res.status(404).json({ error: 'not found' }); return null; }
  const isOwner = req.user?.is_owner && doc.owner_email === req.user.email;
  const collabRole = req.user?.email ? db.getCollaboratorRole(doc.id, req.user.email) : null;
  const shareRole = (allowShareSession && req.user?.documentId === doc.id) ? req.user.role : null;
  const role = isOwner ? 'editor' : (collabRole || shareRole);
  if (!role) { res.status(403).json({ error: 'forbidden' }); return null; }
  if ((ROLE_RANK[role] || 0) < (ROLE_RANK[minRole] || 0)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return { doc, role, isOwner };
}
