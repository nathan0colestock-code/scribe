// Comms HTTP client — companion to gloss.js, but talks to the comms app.
//
// Comms is the suite's communication hub (iMessage + email + calendar).
// Dev: http://localhost:3748. Prod: https://your-comms-app.fly.dev.
// Auth: Bearer `COMMS_API_KEY`. No cookie fallback — comms accepts the
// shared SUITE_API_KEY as well, so callers can use either.

const COMMS_URL = (process.env.COMMS_URL || 'http://localhost:3748').replace(/\/$/, '');
const COMMS_API_KEY = process.env.COMMS_API_KEY || process.env.SUITE_API_KEY || '';

async function request(path, { method = 'GET', body } = {}) {
  if (!COMMS_API_KEY) throw new Error('COMMS_API_KEY (or SUITE_API_KEY) not set — cannot call comms');
  const headers = { Accept: 'application/json', Authorization: `Bearer ${COMMS_API_KEY}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${COMMS_URL}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[comms] ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Save an outbound draft into Gmail Drafts (or return a body string for
// iMessage). Mirrors POST /api/contacts/:name/draft-message in comms.
//
// `contactName` is URL-encoded before insertion. `body` is reserved for a
// possible future server-side override where the client provides the exact
// text — today the route generates via Gemini, but we pass an `occasion`
// hint that can include the existing doc plaintext.
export async function draftMessage({ contactName, occasion, style = 'warm', medium = 'email' }) {
  if (!contactName) throw new Error('contactName required');
  const path = `/api/contacts/${encodeURIComponent(contactName)}/draft-message`;
  return request(path, { method: 'POST', body: { occasion, style, medium } });
}

export { COMMS_URL };
