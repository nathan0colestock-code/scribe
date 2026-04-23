import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import React from 'react';

// Notecard node — a draggable callout block that holds verbatim Gloss text.
// The snippet is editable (content: 'paragraph+') so users can fix OCR errors.
// Metadata (source, volume, page, reference) is stored in attrs and rendered
// as a non-editable header row above the text.

export const Notecard = Node.create({
  name: 'notecard',
  group: 'block',
  content: 'paragraph+',
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      pageId:     { default: null },
      sourceLabel:{ default: '' },
      collection: { default: '' },
      volume:     { default: null },
      pageNumber: { default: null },
      reference:  { default: '' },
      deepLink:   { default: null },
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-notecard]',
      getAttrs: dom => ({
        pageId:      dom.getAttribute('data-page-id'),
        sourceLabel: dom.getAttribute('data-source') || '',
        collection:  dom.getAttribute('data-collection') || '',
        volume:      dom.getAttribute('data-volume') || null,
        pageNumber:  dom.getAttribute('data-page-num') || null,
        reference:   dom.getAttribute('data-reference') || '',
        deepLink:    dom.getAttribute('data-deep-link') || null,
      }),
    }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-notecard':   '',
        'data-page-id':    node.attrs.pageId,
        'data-source':     node.attrs.sourceLabel,
        'data-collection': node.attrs.collection,
        'data-volume':     node.attrs.volume,
        'data-page-num':   node.attrs.pageNumber,
        'data-reference':  node.attrs.reference,
        'data-deep-link':  node.attrs.deepLink,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NotecardView);
  },
});

function NotecardView({ node, selected }) {
  const a = node.attrs;
  const parts = [];
  if (a.collection) parts.push(a.collection);
  if (a.volume)     parts.push(`v.${a.volume}`);
  if (a.pageNumber) parts.push(`p.${a.pageNumber}`);
  if (a.reference)  parts.push(a.reference);
  const meta = parts.join(' · ') || a.sourceLabel || 'Gloss';

  return (
    <NodeViewWrapper>
      <div className={`notecard-block${selected ? ' selected' : ''}`}>
        <div className="notecard-meta" contentEditable={false} data-drag-handle="">
          {a.deepLink
            ? <a href={a.deepLink} target="_blank" rel="noreferrer" className="notecard-source">{meta}</a>
            : <span className="notecard-source">{meta}</span>
          }
        </div>
        <NodeViewContent className="notecard-text" />
      </div>
    </NodeViewWrapper>
  );
}
