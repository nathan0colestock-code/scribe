import React, { useEffect, useState } from 'react';

export function ProofreadPopover({ editor, getSuggestions }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!editor) return;
    function onMouseOver(e) {
      const el = e.target.closest('.proofread-decoration, .style-decoration');
      if (!el) return;
      const idx = Number(el.dataset.suggestionIdx);
      const sugg = getSuggestions()[idx];
      if (!sugg) return;
      const rect = el.getBoundingClientRect();
      setState({ sugg, idx, rect });
    }
    function onMouseOut(e) {
      // Let the popover capture its own enter; defer closing.
      setTimeout(() => {
        if (!document.querySelector('.inline-popover:hover')) setState(null);
      }, 150);
    }
    const dom = editor.view.dom;
    dom.addEventListener('mouseover', onMouseOver);
    dom.addEventListener('mouseout', onMouseOut);
    return () => {
      dom.removeEventListener('mouseover', onMouseOver);
      dom.removeEventListener('mouseout', onMouseOut);
    };
  }, [editor, getSuggestions]);

  if (!state) return null;

  function accept() {
    const { sugg } = state;
    // Find the decoration position in the current doc. We re-walk plain text.
    const doc = editor.state.doc;
    let pos = 0;
    let foundFrom = null, foundTo = null;
    doc.descendants((node, docPos) => {
      if (foundFrom !== null && foundTo !== null) return false;
      if (node.isText) {
        const len = node.text.length;
        if (foundFrom === null && sugg.start >= pos && sugg.start <= pos + len) foundFrom = docPos + (sugg.start - pos);
        if (foundTo === null && sugg.end >= pos && sugg.end <= pos + len) foundTo = docPos + (sugg.end - pos);
        pos += len;
      } else if (node.isBlock && pos > 0) pos += 1;
      return true;
    });
    if (foundFrom == null || foundTo == null) { setState(null); return; }
    editor.chain().focus().insertContentAt({ from: foundFrom, to: foundTo }, sugg.after).run();
    setState(null);
  }

  function dismiss() { setState(null); }

  const { sugg, rect } = state;
  const style = {
    top: `${rect.bottom + 6}px`,
    left: `${Math.min(rect.left, window.innerWidth - 340)}px`,
  };
  return (
    <div className="inline-popover" style={style} onMouseLeave={dismiss}>
      <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--fg-muted)' }}>
        {sugg.kind}
      </div>
      <div className="diff">
        <del>{sugg.before}</del> → <ins>{sugg.after}</ins>
      </div>
      {sugg.reason && <div className="reason">{sugg.reason}</div>}
      {sugg.rule && <div className="rule">Rule: {sugg.rule}</div>}
      <div>
        <button className="primary" onClick={accept}>Accept</button>
        <button onClick={dismiss}>Dismiss</button>
      </div>
    </div>
  );
}
