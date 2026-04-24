// SPEC 5 — Document exports (PDF + Markdown).
//
// The draft editor's authoritative state lives in documents.yjs_state as a
// Yjs binary update. We reconstitute a Y.Doc, extract the Prosemirror JSON
// via y-prosemirror's yDocToProsemirrorJSON, then serialize to either:
//
//   - Markdown (`blocksToMarkdown`): round-trips block types scribe cares
//     about — headings, paragraphs, lists, blockquotes, hard breaks, plus
//     the inline marks (bold/italic/code/link). Includes a YAML frontmatter
//     block with title/date/collection.
//
//   - PDF (`renderPdf`): pdfkit-based. Title/date/collection header, block
//     rendering as prose (no UI chrome — no toolbars, no sidebars, no
//     notecards). Notecard blocks render as inline quoted snippets.
//
// Exports are read-only and don't mutate the doc.

import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import PDFDocument from 'pdfkit';

// ── Y.Doc → Prosemirror JSON ─────────────────────────────────────────────────

export function yjsStateToProsemirrorJSON(buf, fieldName = 'default') {
  if (!buf || !buf.length) {
    return { type: 'doc', content: [] };
  }
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, buf);
  // Hocuspocus + Tiptap use field name 'default' unless configured otherwise.
  const json = yDocToProsemirrorJSON(ydoc, fieldName);
  return json || { type: 'doc', content: [] };
}

// ── Prosemirror JSON → Markdown ──────────────────────────────────────────────

function escapeMd(s) {
  // Escape the handful of chars that break the block types we actually emit.
  return String(s).replace(/\\/g, '\\\\').replace(/[*_`]/g, m => `\\${m}`);
}

function renderInlineNode(node) {
  if (!node) return '';
  if (node.type === 'text') {
    let t = escapeMd(node.text || '');
    const marks = node.marks || [];
    const hasBold   = marks.some(m => m.type === 'bold' || m.type === 'strong');
    const hasItalic = marks.some(m => m.type === 'italic' || m.type === 'em');
    const hasCode   = marks.some(m => m.type === 'code');
    const linkMark  = marks.find(m => m.type === 'link');
    if (hasCode)   t = `\`${node.text}\``; // literal for code — don't double-escape
    if (hasBold)   t = `**${t}**`;
    if (hasItalic) t = `*${t}*`;
    if (linkMark)  t = `[${t}](${linkMark.attrs?.href || ''})`;
    return t;
  }
  if (node.type === 'hardBreak' || node.type === 'hard_break') return '  \n';
  if (Array.isArray(node.content)) return node.content.map(renderInlineNode).join('');
  return '';
}

function renderBlockNode(node, depth = 0) {
  if (!node) return '';
  const type = node.type;
  const inline = Array.isArray(node.content) ? node.content.map(renderInlineNode).join('') : '';
  switch (type) {
    case 'paragraph':
      return inline + '\n\n';
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.attrs?.level || 1));
      return `${'#'.repeat(level)} ${inline}\n\n`;
    }
    case 'blockquote': {
      const inner = (node.content || []).map(n => renderBlockNode(n, depth)).join('').trimEnd();
      return inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
    }
    case 'bulletList':
    case 'bullet_list': {
      return (node.content || [])
        .map(item => '- ' + renderBlockNode(item, depth + 1).trimStart())
        .join('') + (depth === 0 ? '\n' : '');
    }
    case 'orderedList':
    case 'ordered_list': {
      return (node.content || [])
        .map((item, i) => `${i + 1}. ` + renderBlockNode(item, depth + 1).trimStart())
        .join('') + (depth === 0 ? '\n' : '');
    }
    case 'listItem':
    case 'list_item': {
      // Strip the trailing blank line inside list items so bullets don't
      // stretch a paragraph apart.
      return (node.content || []).map(n => renderBlockNode(n, depth)).join('').trimEnd() + '\n';
    }
    case 'codeBlock':
    case 'code_block': {
      const lang = node.attrs?.language || '';
      return '```' + lang + '\n' + (inline || '') + '\n```\n\n';
    }
    case 'notecard': {
      // Notecards carry a snippet in attrs; render as a blockquote with a
      // source line so the exported doc is still readable.
      const snippet = node.attrs?.snippet || node.attrs?.text || inline || '';
      const label   = node.attrs?.source_label || node.attrs?.title || '';
      const tail    = label ? `\n> — ${label}` : '';
      return `> ${snippet}${tail}\n\n`;
    }
    case 'hardBreak':
    case 'hard_break':
      return '  \n';
    case 'horizontalRule':
    case 'horizontal_rule':
      return '\n---\n\n';
    default:
      // Fallback: render children inline so we don't silently drop text.
      if (inline) return inline + '\n\n';
      return (node.content || []).map(n => renderBlockNode(n, depth)).join('');
  }
}

function yamlFrontmatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v == null || v === '') continue;
    const s = String(v).replace(/"/g, '\\"');
    lines.push(`${k}: "${s}"`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

export function docToMarkdown({ doc, prosemirrorJson }) {
  const header = yamlFrontmatter({
    title: doc?.title || 'Untitled',
    date: doc?.updated_at || doc?.created_at || new Date().toISOString(),
    collection: doc?.collection || null,
    id: doc?.id,
  });
  const body = (prosemirrorJson?.content || []).map(n => renderBlockNode(n, 0)).join('');
  return header + '\n' + body.trimEnd() + '\n';
}

// ── Prosemirror JSON → PDF (pdfkit) ──────────────────────────────────────────

function pdfInline(docKit, node, marks = []) {
  if (!node) return;
  if (node.type === 'text') {
    const allMarks = [...(node.marks || []), ...marks];
    const bold   = allMarks.some(m => m.type === 'bold' || m.type === 'strong');
    const italic = allMarks.some(m => m.type === 'italic' || m.type === 'em');
    const code   = allMarks.some(m => m.type === 'code');
    const linkMark = allMarks.find(m => m.type === 'link');
    const font =
      code ? 'Courier'
      : (bold && italic) ? 'Times-BoldItalic'
      : bold ? 'Times-Bold'
      : italic ? 'Times-Italic'
      : 'Times-Roman';
    docKit.font(font);
    const opts = { continued: true };
    if (linkMark?.attrs?.href) opts.link = linkMark.attrs.href;
    docKit.text(node.text || '', opts);
    return;
  }
  if (node.type === 'hardBreak' || node.type === 'hard_break') {
    docKit.text('\n', { continued: true });
    return;
  }
  for (const c of node.content || []) pdfInline(docKit, c, marks);
}

function pdfBlock(docKit, node) {
  if (!node) return;
  const flush = () => docKit.text('', { continued: false });
  const type = node.type;
  switch (type) {
    case 'paragraph':
      docKit.font('Times-Roman').fontSize(11);
      for (const c of node.content || []) pdfInline(docKit, c);
      flush();
      docKit.moveDown(0.4);
      return;
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.attrs?.level || 1));
      const size = level === 1 ? 18 : level === 2 ? 15 : 13;
      docKit.font('Times-Bold').fontSize(size);
      for (const c of node.content || []) pdfInline(docKit, c);
      flush();
      docKit.moveDown(0.5);
      return;
    }
    case 'blockquote':
      docKit.font('Times-Italic').fontSize(11).fillColor('#444');
      for (const c of node.content || []) {
        for (const cc of c.content || []) pdfInline(docKit, cc);
      }
      flush();
      docKit.fillColor('black').moveDown(0.4);
      return;
    case 'bulletList':
    case 'bullet_list':
      for (const item of node.content || []) {
        docKit.font('Times-Roman').fontSize(11);
        docKit.text('• ', { continued: true });
        for (const p of item.content || []) {
          if (p.type === 'paragraph') {
            for (const c of p.content || []) pdfInline(docKit, c);
          }
        }
        docKit.text('', { continued: false });
      }
      docKit.moveDown(0.4);
      return;
    case 'orderedList':
    case 'ordered_list':
      (node.content || []).forEach((item, i) => {
        docKit.font('Times-Roman').fontSize(11);
        docKit.text(`${i + 1}. `, { continued: true });
        for (const p of item.content || []) {
          if (p.type === 'paragraph') {
            for (const c of p.content || []) pdfInline(docKit, c);
          }
        }
        docKit.text('', { continued: false });
      });
      docKit.moveDown(0.4);
      return;
    case 'codeBlock':
    case 'code_block':
      docKit.font('Courier').fontSize(10);
      for (const c of node.content || []) pdfInline(docKit, c);
      flush();
      docKit.font('Times-Roman').fontSize(11).moveDown(0.4);
      return;
    case 'notecard': {
      const snippet = node.attrs?.snippet || node.attrs?.text || '';
      const label   = node.attrs?.source_label || node.attrs?.title || '';
      docKit.font('Times-Italic').fontSize(11).fillColor('#333');
      docKit.text(snippet);
      if (label) {
        docKit.font('Times-Italic').fontSize(10).fillColor('#777');
        docKit.text(`— ${label}`);
      }
      docKit.fillColor('black').moveDown(0.4);
      return;
    }
    case 'horizontalRule':
    case 'horizontal_rule':
      docKit.moveDown(0.3);
      docKit.moveTo(docKit.x, docKit.y).lineTo(docKit.page.width - docKit.page.margins.right, docKit.y).stroke();
      docKit.moveDown(0.6);
      return;
    default:
      // Fallback: render as paragraph so no text is silently dropped.
      if (Array.isArray(node.content)) {
        docKit.font('Times-Roman').fontSize(11);
        for (const c of node.content) pdfInline(docKit, c);
        flush();
        docKit.moveDown(0.3);
      }
  }
}

// Render to a Buffer. Streaming to res is possible but keeping this Buffer-
// based makes tests trivial ("check the first 4 bytes for %PDF").
export function renderPdfBuffer({ doc, prosemirrorJson }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdf = new PDFDocument({ size: 'LETTER', margin: 72 });
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end',  () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    // Header — title + date + collection.
    const title = doc?.title || 'Untitled';
    const date  = doc?.updated_at || doc?.created_at || new Date().toISOString();
    const coll  = doc?.collection || '';

    pdf.font('Times-Bold').fontSize(22).text(title);
    pdf.moveDown(0.2);
    pdf.font('Times-Italic').fontSize(10).fillColor('#555')
       .text([date, coll].filter(Boolean).join(' · '));
    pdf.fillColor('black').moveDown(1.0);

    const content = prosemirrorJson?.content || [];
    if (content.length === 0) {
      pdf.font('Times-Italic').fontSize(11).fillColor('#888')
         .text('(empty document)');
    } else {
      for (const node of content) pdfBlock(pdf, node);
    }

    pdf.end();
  });
}
