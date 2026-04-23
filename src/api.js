async function request(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

export const api = {
  me: () => request('/api/me'),
  login: (password) => request('/api/login', { method: 'POST', body: { password } }),
  logout: () => request('/api/logout', { method: 'POST' }),
  join: (token, displayName, color) => request('/api/join', { method: 'POST', body: { token, displayName, color } }),

  listDocuments: () => request('/api/documents'),
  createDocument: (body) => request('/api/documents', { method: 'POST', body }),
  getDocument: (id) => request(`/api/documents/${id}`),
  // Read-once: drains any server-queued seed text for this doc (e.g. black
  // "Open in Scribe" hand-off). Returns { seed_body: string | null }.
  pendingSeed: (id) => request(`/api/documents/${id}/pending-seed`),
  collabToken: (id) => request(`/api/documents/${id}/collab-token`),
  updateDocument: (id, body) => request(`/api/documents/${id}`, { method: 'PATCH', body }),
  deleteDocument: (id) => request(`/api/documents/${id}`, { method: 'DELETE' }),

  getOutline: (id) => request(`/api/documents/${id}/outline`),
  addOutlineNode: (id, body) => request(`/api/documents/${id}/outline`, { method: 'POST', body }),
  updateOutlineNode: (id, nodeId, body) => request(`/api/documents/${id}/outline/${nodeId}`, { method: 'PATCH', body }),
  deleteOutlineNode: (id, nodeId) => request(`/api/documents/${id}/outline/${nodeId}`, { method: 'DELETE' }),
  createCard: (id, body) => request(`/api/documents/${id}/cards`, { method: 'POST', body }),
  materialize: (id) => request(`/api/documents/${id}/materialize`, { method: 'POST' }),

  glossLinks: (id) => request(`/api/documents/${id}/gloss/links`),
  addGlossLink: (id, body) => request(`/api/documents/${id}/gloss/links`, { method: 'POST', body }),
  removeGlossLink: (id, linkId) => request(`/api/documents/${id}/gloss/links/${linkId}`, { method: 'DELETE' }),
  refreshGloss: (id) => request(`/api/documents/${id}/gloss/refresh`, { method: 'POST' }),
  glossPicker: (id) => request(`/api/documents/${id}/gloss/picker`),
  glossSearch: (id, q) => request(`/api/documents/${id}/gloss/search?q=${encodeURIComponent(q)}`),

  // Black-hole archive suggestions (server-side proxy to black's semantic
  // search). Returns { results: [{ file_id, name, drive_path, web_view_link,
  // content, distance, ... }], query }. `k` caps how many hits to fetch;
  // `fresh: true` busts the 5-minute per-doc cache.
  blackSuggestions: (id, { k = 20, fresh = false } = {}) => {
    const params = new URLSearchParams();
    params.set('k', String(k));
    if (fresh) params.set('fresh', '1');
    return request(`/api/documents/${id}/black-suggestions?${params.toString()}`);
  },

  listComments: (id) => request(`/api/documents/${id}/comments`),
  addComment: (id, body) => request(`/api/documents/${id}/comments`, { method: 'POST', body }),
  resolveThread: (id, threadId) => request(`/api/documents/${id}/comments/${threadId}/resolve`, { method: 'POST' }),

  listSuggestions: (id) => request(`/api/documents/${id}/suggestions`),
  addSuggestion: (id, body) => request(`/api/documents/${id}/suggestions`, { method: 'POST', body }),
  resolveSuggestion: (id, sid, state) => request(`/api/documents/${id}/suggestions/${sid}/resolve`, { method: 'POST', body: { state } }),

  createShareToken: (id, role) => request(`/api/documents/${id}/share`, { method: 'POST', body: { role } }),
  listShares: (id) => request(`/api/documents/${id}/shares`),
  revokeShare: (id, token) => request(`/api/documents/${id}/shares/${token}`, { method: 'DELETE' }),

  listStyleGuides: () => request('/api/style-guides'),
  saveStyleGuide: (body) => request('/api/style-guides', { method: 'POST', body }),
  deleteStyleGuide: (id) => request(`/api/style-guides/${id}`, { method: 'DELETE' }),

  proofread: (document_id, text) => request('/api/ai/proofread', { method: 'POST', body: { document_id, text } }),
  styleCheck: (document_id, text) => request('/api/ai/style-check', { method: 'POST', body: { document_id, text } }),

  // Outline → Draft: materialize outline + cards into Tiptap JSON, caller
  // merges into the draft editor.
  materializeOutline: (id) => request(`/api/documents/${id}/materialize`, { method: 'POST' }),
  // Review → Comms: save the doc body as an outbound Gmail draft via comms.
  sendToComms: (id, body) => request(`/api/documents/${id}/send-to-comms`, { method: 'POST', body }),
};
