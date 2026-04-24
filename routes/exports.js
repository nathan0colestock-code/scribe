// SPEC 5 — Export routes for scribe documents.
//
//   GET /api/documents/:id/export.pdf
//   GET /api/documents/:id/export.md
//
// Both read the draft's yjs_state, reconstitute Tiptap JSON, and serialize
// via exports.js. Auto-archive to Black happens after a successful response:
// failures are logged and swallowed so a Black outage can't block export.

import express from 'express';
import * as db from '../db.js';
import { ensureAccess as ensureAccessImpl } from './_access.js';
import { yjsStateToProsemirrorJSON, docToMarkdown, renderPdfBuffer } from '../exports.js';
import { archiveIngest } from '../black.js';
import { log } from '../log.js';

export const router = express.Router();

function docMeta(doc) {
  return {
    id: doc.id,
    title: doc.title || 'Untitled',
    description: doc.description,
    main_point: doc.main_point,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    collection: doc.collection || null,
  };
}

function safeFilename(title) {
  return String(title || 'document')
    .replace(/[^a-z0-9-_ ]+/gi, '')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'document';
}

// Extract plain text from Prosemirror JSON for archive body_text. Kept here
// (not in exports.js) so exports.js stays focused on file-format output.
function prosemirrorToPlain(json) {
  if (!json || !Array.isArray(json.content)) return '';
  const parts = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'text') { parts.push(n.text || ''); return; }
    if (n.type === 'hardBreak' || n.type === 'hard_break') { parts.push('\n'); return; }
    if (Array.isArray(n.content)) {
      for (const c of n.content) walk(c);
      // Add a paragraph break after block-level nodes.
      const blockTypes = new Set(['paragraph', 'heading', 'blockquote', 'listItem', 'list_item', 'codeBlock', 'code_block']);
      if (blockTypes.has(n.type)) parts.push('\n\n');
    }
  };
  walk(json);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

// POST-export auto-archive. Best-effort; logged failures are non-fatal.
async function autoArchive({ doc, bodyText, traceId }) {
  try {
    const r = await archiveIngest({
      doc_id: doc.id,
      title: doc.title,
      date: doc.updated_at || doc.created_at,
      collection: doc.collection || null,
      body_text: bodyText,
      url: process.env.SCRIBE_PUBLIC_URL
        ? `${process.env.SCRIBE_PUBLIC_URL.replace(/\/$/, '')}/d/${doc.id}`
        : null,
      traceId,
      log,
    });
    return r;
  } catch (err) {
    log('warn', 'archive_ingest_threw', { trace_id: traceId, doc_id: doc.id, error: err.message });
    return { ok: false, error: err.message };
  }
}

router.get('/:id/export.pdf', async (req, res) => {
  const access = ensureAccessImpl(req, res, { docId: req.params.id });
  if (!access) return;
  const { doc } = access;
  const buf = db.getYjsState(doc.id, 'draft');
  let pmJson;
  try {
    pmJson = yjsStateToProsemirrorJSON(buf, 'default');
  } catch (err) {
    log('error', 'export_decode_failed', { trace_id: req.trace_id, doc_id: doc.id, format: 'pdf', error: err.message });
    return res.status(500).json({ ok: false, error: 'failed to decode document', code: 'export_decode_failed' });
  }

  let pdf;
  try {
    pdf = await renderPdfBuffer({ doc: docMeta(doc), prosemirrorJson: pmJson });
  } catch (err) {
    log('error', 'export_render_failed', { trace_id: req.trace_id, doc_id: doc.id, format: 'pdf', error: err.message });
    return res.status(500).json({ ok: false, error: 'failed to render pdf', code: 'export_render_failed' });
  }

  const name = safeFilename(doc.title);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.end(pdf);

  // Fire-and-forget archive. Use the same plain text the PDF rendered from.
  const plain = prosemirrorToPlain(pmJson);
  autoArchive({ doc, bodyText: plain, traceId: req.trace_id }).catch(() => {});
});

router.get('/:id/export.md', async (req, res) => {
  const access = ensureAccessImpl(req, res, { docId: req.params.id });
  if (!access) return;
  const { doc } = access;
  const buf = db.getYjsState(doc.id, 'draft');
  let pmJson;
  try {
    pmJson = yjsStateToProsemirrorJSON(buf, 'default');
  } catch (err) {
    log('error', 'export_decode_failed', { trace_id: req.trace_id, doc_id: doc.id, format: 'md', error: err.message });
    return res.status(500).json({ ok: false, error: 'failed to decode document', code: 'export_decode_failed' });
  }

  const md = docToMarkdown({ doc: docMeta(doc), prosemirrorJson: pmJson });

  const name = safeFilename(doc.title);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.md"`);
  res.end(md);

  const plain = prosemirrorToPlain(pmJson);
  autoArchive({ doc, bodyText: plain, traceId: req.trace_id }).catch(() => {});
});

// Exposed for tests that need to drive auto-archive directly.
export { autoArchive, prosemirrorToPlain };
