import React, { useState, useRef, useEffect } from 'react';

export function PromptDialog({ message, placeholder = '', onConfirm, onCancel }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function submit(e) {
    e.preventDefault();
    if (value.trim()) onConfirm(value.trim());
  }

  return (
    <div className="confirm-dialog" onClick={onCancel}>
      <form className="panel" onSubmit={submit} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <p className="confirm-message">{message}</p>
        <input
          ref={inputRef}
          className="confirm-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={placeholder}
        />
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={!value.trim()}>OK</button>
        </div>
      </form>
    </div>
  );
}
