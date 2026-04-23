// ProseMirror plugin that renders proofread / style suggestions as decorations.
// Lives in a separate PluginKey so it never enters the Yjs collab stream.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const proofreadKey = new PluginKey('proofread');

// suggestions: [{ start, end, kind, before, after, reason, rule? }] — offsets are into plain-text
// We walk the doc to map plain-text offsets back to doc positions.

function mapToDocRange(doc, from, to) {
  let pos = 0;
  let docFrom = null, docTo = null;
  doc.descendants((node, docPos) => {
    if (docFrom !== null && docTo !== null) return false;
    if (node.isText) {
      const len = node.text.length;
      if (docFrom === null && from >= pos && from <= pos + len) docFrom = docPos + (from - pos);
      if (docTo === null && to >= pos && to <= pos + len) docTo = docPos + (to - pos);
      pos += len;
    } else if (node.isBlock && pos > 0) {
      // Block boundaries get a newline in our plain-text projection.
      pos += 1;
    }
    return true;
  });
  if (docFrom !== null && docTo === null) docTo = docFrom + (to - from);
  return (docFrom !== null && docTo !== null) ? { from: docFrom, to: docTo } : null;
}

export function ProofreadPlugin() {
  return new Plugin({
    key: proofreadKey,
    state: {
      init: () => ({ suggestions: [], decorations: DecorationSet.empty }),
      apply(tr, prev) {
        const meta = tr.getMeta(proofreadKey);
        if (meta) {
          const list = meta.suggestions || [];
          const decos = list.map((s, i) => {
            const range = mapToDocRange(tr.doc, s.start, s.end);
            if (!range) return null;
            const cls = s.kind === 'style' ? 'style-decoration' : 'proofread-decoration';
            return Decoration.inline(range.from, range.to, {
              class: cls,
              'data-suggestion-idx': String(i),
            });
          }).filter(Boolean);
          return { suggestions: list, decorations: DecorationSet.create(tr.doc, decos) };
        }
        // Re-map existing decorations on doc changes.
        return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) };
      },
    },
    props: {
      decorations(state) { return this.getState(state).decorations; },
    },
  });
}

export function setProofreadSuggestions(editor, suggestions) {
  editor.view.dispatch(editor.state.tr.setMeta(proofreadKey, { suggestions }));
}
export function getProofreadState(editor) {
  return proofreadKey.getState(editor.state);
}
export function clearProofread(editor) {
  setProofreadSuggestions(editor, []);
}

// Extract a plain-text projection (matching our offset math above).
export function docToPlainText(doc) {
  let out = '';
  doc.descendants((node) => {
    if (node.isText) {
      out += node.text;
    } else if (node.isBlock && out.length > 0) {
      out += '\n';
    }
    return true;
  });
  return out;
}
