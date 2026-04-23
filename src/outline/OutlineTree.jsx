import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';

export function OutlineTree({ documentId, onMaterialize, onOutlineChange, editable, mode = 'build' }) {
  const [nodes, setNodes] = useState([]);
  const [cards, setCards] = useState([]);
  const [dragOverId, setDragOverId] = useState(null);

  async function load() {
    const r = await api.getOutline(documentId);
    setNodes(r.outline || []);
    setCards(r.cards || []);
    onOutlineChange?.(r.outline || [], r.cards || []);
  }

  useEffect(() => { load(); }, [documentId]);

  const cardMap = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  async function addNode(parentId, kind) {
    const siblings = nodes.filter(n => (n.parent_id || null) === (parentId || null));
    await api.addOutlineNode(documentId, {
      parent_id: parentId || null,
      position: siblings.length,
      kind,
      text: kind === 'heading' ? 'New section' : '',
    });
    await load();
  }

  async function updateText(id, text) {
    await api.updateOutlineNode(documentId, id, { text });
  }

  async function removeNode(id) {
    if (!confirm('Delete this outline item?')) return;
    await api.deleteOutlineNode(documentId, id);
    await load();
  }

  async function dropCard(parentId, payload, position) {
    const card = await api.createCard(documentId, {
      page_id: payload.page_id,
      snippet: payload.snippet,
      start_offset: 0,
      end_offset: payload.snippet.length,
      source_label: payload.source_label,
    });
    await api.addOutlineNode(documentId, {
      parent_id: parentId || null,
      position: position ?? nodes.length,
      kind: 'card_ref',
      card_id: card.card.id,
      text: '',
    });
    await load();
  }

  async function moveNode(draggedId, newParentId, newPosition) {
    await api.updateOutlineNode(documentId, draggedId, {
      parent_id: newParentId || null,
      position: newPosition,
    });
    await load();
  }

  function onDragOver(e, id) {
    if (!editable) return;
    const types = e.dataTransfer.types;
    if (types.includes('application/x-scribe-card') || types.includes('application/x-scribe-outline')) {
      e.preventDefault();
      setDragOverId(id || '__root__');
    }
  }

  function onDrop(e, parentId) {
    e.preventDefault();
    setDragOverId(null);
    const cardData = e.dataTransfer.getData('application/x-scribe-card');
    if (cardData) {
      const payload = JSON.parse(cardData);
      dropCard(parentId, payload);
      return;
    }
    const nodeData = e.dataTransfer.getData('application/x-scribe-outline');
    if (nodeData) {
      const { id } = JSON.parse(nodeData);
      moveNode(id, parentId, 999);
    }
  }

  async function materialize() {
    const r = await api.materialize(documentId);
    onMaterialize?.(r.fragment);
  }

  return (
    <div className={`outline mode-${mode}`}
         onDragOver={e => onDragOver(e, null)}
         onDrop={e => onDrop(e, null)}>
      <h3>Outline</h3>
      {tree.length === 0 && (
        <div className="outline-empty">
          {mode === 'build'
            ? 'Start with a heading or bullet. Drag notecards from the right to build structure.'
            : 'Outline is empty. Switch to Outline stage to build one.'}
        </div>
      )}
      <OutlineList
        list={tree}
        cardMap={cardMap}
        editable={editable}
        mode={mode}
        dragOverId={dragOverId}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onUpdate={updateText}
        onDelete={removeNode}
      />
      {editable && mode === 'build' && (
        <div className="actions">
          <button onClick={() => addNode(null, 'heading')}>+ Heading</button>
          <button onClick={() => addNode(null, 'bullet')}>+ Bullet</button>
          <button className="primary" onClick={materialize}
            disabled={nodes.length === 0}>Materialize into draft →</button>
        </div>
      )}
    </div>
  );
}

function OutlineList({ list, cardMap, editable, mode, dragOverId, onDragOver, onDrop, onUpdate, onDelete }) {
  return (
    <div>
      {list.map(n => (
        <OutlineItem
          key={n.id}
          node={n}
          cardMap={cardMap}
          editable={editable}
          mode={mode}
          dragOverId={dragOverId}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function outlineNodeToTiptap(node, card) {
  if (node.kind === 'heading') {
    return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: node.text || 'Section' }] };
  }
  if (node.kind === 'card_ref' && card) {
    return {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: card.snippet }] },
        { type: 'paragraph', content: [
          { type: 'text', text: '— ' },
          { type: 'text', text: card.source_label || `Gloss page ${card.page_id}` },
        ] },
      ],
    };
  }
  return { type: 'paragraph', content: node.text ? [{ type: 'text', text: node.text }] : [] };
}

function OutlineItem({ node, cardMap, editable, mode, dragOverId, onDragOver, onDrop, onUpdate, onDelete }) {
  const [text, setText] = useState(node.text || '');
  useEffect(() => setText(node.text || ''), [node.text]);
  const isDragOver = dragOverId === node.id;
  const card = node.card_id ? cardMap.get(node.card_id) : null;
  const isScaffold = mode === 'scaffold';

  // In scaffold mode (drafting), dragging an item inserts its materialized
  // content into the editor. In build mode, dragging reorders within the outline.
  function onDragStart(e) {
    if (isScaffold) {
      const content = [outlineNodeToTiptap(node, card)];
      e.dataTransfer.setData('application/x-scribe-outline-insert', JSON.stringify({ content }));
      e.dataTransfer.effectAllowed = 'copy';
    } else {
      e.dataTransfer.setData('application/x-scribe-outline', JSON.stringify({ id: node.id }));
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  return (
    <div style={{ marginLeft: node.parent_id ? 16 : 0 }}>
      <div
        className={`node ${node.kind === 'card_ref' ? 'card-ref' : ''} ${isDragOver ? 'drag-over' : ''} ${isScaffold ? 'scaffold' : ''}`}
        draggable={isScaffold || editable}
        onDragStart={onDragStart}
        onDragOver={e => onDragOver(e, node.id)}
        onDrop={e => onDrop(e, node.id)}
      >
        <span className="drag-handle">⋮⋮</span>
        {node.kind === 'card_ref' ? (
          <span className="snippet">{(card?.snippet || '').slice(0, 140)}{card && card.snippet.length > 140 ? '…' : ''}</span>
        ) : node.kind === 'heading' ? (
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={() => onUpdate(node.id, text)}
            style={{ fontWeight: 600 }}
            disabled={!editable || isScaffold}
          />
        ) : (
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={() => onUpdate(node.id, text)}
            placeholder="Bullet"
            disabled={!editable || isScaffold}
          />
        )}
        {editable && !isScaffold && <button onClick={() => onDelete(node.id)} className="x">×</button>}
      </div>
      {node.children?.length > 0 && (
        <OutlineList
          list={node.children}
          cardMap={cardMap}
          editable={editable}
          mode={mode}
          dragOverId={dragOverId}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function buildTree(nodes) {
  const byParent = new Map();
  for (const n of nodes) {
    const key = n.parent_id || '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);
  function walk(parent) {
    return (byParent.get(parent || '__root__') || []).map(n => ({ ...n, children: walk(n.id) }));
  }
  return walk(null);
}
