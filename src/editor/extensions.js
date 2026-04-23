import { Mark, mergeAttributes } from '@tiptap/core';

// ---- comment mark: wraps text that has a thread attached ----
export const CommentMark = Mark.create({
  name: 'comment',
  addAttributes() {
    return {
      threadId: { default: null, parseHTML: el => el.getAttribute('data-thread-id'), renderHTML: a => a.threadId ? { 'data-thread-id': a.threadId } : {} },
      resolved: { default: false, parseHTML: el => el.getAttribute('data-resolved') === 'true', renderHTML: a => a.resolved ? { 'data-resolved': 'true' } : {} },
    };
  },
  parseHTML() { return [{ tag: 'span[data-thread-id]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: `comment-mark${HTMLAttributes['data-resolved'] === 'true' ? ' resolved' : ''}` }), 0];
  },
  inclusive: false,
});

// ---- suggestion-insert: content added by a suggester, pending owner accept ----
export const SuggestInsert = Mark.create({
  name: 'suggestInsert',
  addAttributes() {
    return {
      suggestionId: { default: null, parseHTML: el => el.getAttribute('data-suggestion-id'), renderHTML: a => a.suggestionId ? { 'data-suggestion-id': a.suggestionId } : {} },
      author: { default: null, parseHTML: el => el.getAttribute('data-author'), renderHTML: a => a.author ? { 'data-author': a.author } : {} },
    };
  },
  parseHTML() { return [{ tag: 'ins[data-suggestion-id]' }]; },
  renderHTML({ HTMLAttributes }) { return ['ins', mergeAttributes(HTMLAttributes, { class: 'suggest-insert' }), 0]; },
  inclusive: false,
});

// ---- suggestion-delete: content a suggester wants to remove (shown struck through) ----
export const SuggestDelete = Mark.create({
  name: 'suggestDelete',
  addAttributes() {
    return {
      suggestionId: { default: null, parseHTML: el => el.getAttribute('data-suggestion-id'), renderHTML: a => a.suggestionId ? { 'data-suggestion-id': a.suggestionId } : {} },
      author: { default: null, parseHTML: el => el.getAttribute('data-author'), renderHTML: a => a.author ? { 'data-author': a.author } : {} },
    };
  },
  parseHTML() { return [{ tag: 'del[data-suggestion-id]' }]; },
  renderHTML({ HTMLAttributes }) { return ['del', mergeAttributes(HTMLAttributes, { class: 'suggest-delete' }), 0]; },
  inclusive: false,
});

// ---- gloss-attribution: inline link back to a Gloss page ----
export const GlossAttribution = Mark.create({
  name: 'glossAttribution',
  addAttributes() {
    return {
      href: { default: null, parseHTML: el => el.getAttribute('href'), renderHTML: a => a.href ? { href: a.href } : {} },
      pageId: { default: null, parseHTML: el => el.getAttribute('data-page-id'), renderHTML: a => a.pageId ? { 'data-page-id': a.pageId } : {} },
    };
  },
  parseHTML() { return [{ tag: 'a[data-page-id]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { class: 'gloss-attribution', target: '_blank', rel: 'noreferrer' }), 0];
  },
  inclusive: false,
});
