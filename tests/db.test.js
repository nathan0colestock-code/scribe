// Smoke tests for the SQLite + FTS5 layer. These tests use an isolated
// temp dir so they don't touch the real data/scribe.db.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-test-'));
process.env.SCRIBE_DATA_DIR = tmp;

const db = await import('../db.js');

test.after(() => {
  try { db.db.close(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('upsertTranscript is idempotent on unchanged content (etag_hash)', () => {
  const doc = db.createDocument({ owner_email: 'owner@scribe.local', title: 'T' });
  db.addGlossLink(doc.id, { kind: 'collection', gloss_id: 'col-1', label: 'Nehemiah' });

  const payload = {
    page_id: 'page-aaa',
    source_kind: 'scan',
    captured_at: '2026-01-01T00:00:00Z',
    is_voice: false,
    is_markdown: false,
    transcript: 'Sanballat mocked the wall builders but Nehemiah kept working.',
    summary: null,
  };

  const first = db.upsertTranscript(payload);
  assert.equal(first.changed, true, 'first insert is a change');

  const second = db.upsertTranscript(payload);
  assert.equal(second.changed, false, 'identical payload is a no-op');

  const third = db.upsertTranscript({ ...payload, transcript: payload.transcript + ' Edited.' });
  assert.equal(third.changed, true, 'changed content triggers update');
});

test('FTS returns VERBATIM raw-OCR snippets (the hard invariant)', () => {
  const doc = db.createDocument({ owner_email: 'owner@scribe.local', title: 'Invariant' });
  db.addGlossLink(doc.id, { kind: 'collection', gloss_id: 'col-nehemiah', label: 'Nehemiah' });

  const verbatim = 'Sanballat and Tobiah tried to intimidate the workers at the gate of Jerusalem.';
  db.upsertTranscript({
    page_id: 'page-verb-1',
    source_kind: 'scan',
    captured_at: '2026-01-01T00:00:00Z',
    is_voice: 0,
    is_markdown: 0,
    transcript: verbatim,
    summary: 'THIS SUMMARY MUST NEVER APPEAR IN THE SIDEBAR',
  });
  db.linkTranscriptSource('page-verb-1', 'collection', 'col-nehemiah');

  const hits = db.searchTranscriptsForDocument(doc.id, 'Sanballat intimidate workers', 10);
  assert.ok(hits.length >= 1, 'FTS finds the page');

  const hit = hits[0];
  // Invariant: the full transcript on the card is the raw OCR we stored,
  // NOT the pointer-summary.
  assert.equal(hit.transcript, verbatim, 'card body is raw OCR verbatim');
  assert.ok(!/SUMMARY/i.test(hit.transcript), 'summary text never bleeds into transcript field');
  // Snippet includes mark tags around matched terms and is a window of the source.
  assert.ok(/Sanballat/.test(hit.snippet), 'snippet contains matched term');
});

test('FTS is scoped to the calling document only', () => {
  const docA = db.createDocument({ owner_email: 'owner@scribe.local', title: 'A' });
  const docB = db.createDocument({ owner_email: 'owner@scribe.local', title: 'B' });
  db.addGlossLink(docA.id, { kind: 'collection', gloss_id: 'col-A', label: 'A' });
  db.addGlossLink(docB.id, { kind: 'collection', gloss_id: 'col-B', label: 'B' });

  db.upsertTranscript({
    page_id: 'page-scope-A', transcript: 'Alpha widgets march onward.', source_kind: 'scan',
    captured_at: null, is_voice: 0, is_markdown: 0, summary: null,
  });
  db.linkTranscriptSource('page-scope-A', 'collection', 'col-A');

  db.upsertTranscript({
    page_id: 'page-scope-B', transcript: 'Alpha widgets conquer elsewhere.', source_kind: 'scan',
    captured_at: null, is_voice: 0, is_markdown: 0, summary: null,
  });
  db.linkTranscriptSource('page-scope-B', 'collection', 'col-B');

  const hitsA = db.searchTranscriptsForDocument(docA.id, 'alpha widgets', 10);
  assert.equal(hitsA.length, 1);
  assert.equal(hitsA[0].page_id, 'page-scope-A');

  const hitsB = db.searchTranscriptsForDocument(docB.id, 'alpha widgets', 10);
  assert.equal(hitsB.length, 1);
  assert.equal(hitsB[0].page_id, 'page-scope-B');
});

test('outline + cards flip state on materialize path', () => {
  const doc = db.createDocument({ owner_email: 'owner@scribe.local', title: 'Outline doc' });
  const card = db.upsertCard({
    document_id: doc.id,
    page_id: 'page-xyz',
    snippet: 'A verbatim line from the notebook.',
    start_offset: 0,
    end_offset: 32,
    source_label: 'Nehemiah 6',
  });
  assert.equal(card.state, 'candidate');

  const node = db.createOutlineNode({
    document_id: doc.id,
    kind: 'card_ref',
    text: '',
    card_id: card.id,
    position: 0,
  });
  assert.ok(node.id);

  db.setCardState(card.id, 'in_outline');
  assert.equal(db.getCard(card.id).state, 'in_outline');

  db.setCardState(card.id, 'materialized');
  assert.equal(db.getCard(card.id).state, 'materialized');
});

test('share tokens mint, list, and revoke', () => {
  const doc = db.createDocument({ owner_email: 'owner@scribe.local', title: 'Share doc' });
  const t = db.createShareToken({ document_id: doc.id, role: 'commenter', created_by: 'owner@scribe.local' });
  assert.ok(t.token);
  assert.equal(t.role, 'commenter');

  const fetched = db.getShareToken(t.token);
  assert.equal(fetched.document_id, doc.id);

  const listed = db.listShareTokens(doc.id);
  assert.equal(listed.length, 1);

  db.revokeShareToken(t.token);
  const after = db.getShareToken(t.token);
  assert.ok(after.revoked_at, 'revoked_at is set');
});

test('collaborator roles are readable and gate-able', () => {
  const doc = db.createDocument({ owner_email: 'owner@scribe.local', title: 'Collab doc' });
  db.upsertUser({ email: 'reviewer@example.com', display_name: 'Rev', color: '#abc' });
  db.addCollaborator(doc.id, 'reviewer@example.com', 'suggester');
  assert.equal(db.getCollaboratorRole(doc.id, 'reviewer@example.com'), 'suggester');
  assert.ok(!db.getCollaboratorRole(doc.id, 'nobody@example.com'));
});
