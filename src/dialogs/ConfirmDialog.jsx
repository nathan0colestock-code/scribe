import React, { useEffect } from 'react';

export function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel = 'Confirm', confirmClassName = 'danger' }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  return (
    <div className="confirm-dialog" onClick={onCancel}>
      <div className="panel" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className={confirmClassName} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
