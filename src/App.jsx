import React, { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import { api } from './api.js';
import { DocumentView } from './DocumentView.jsx';
import { StyleGuideEditor } from './settings/StyleGuideEditor.jsx';

function Login({ onLoggedIn }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      await api.login(pw);
      onLoggedIn();
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <div className="login-screen">
      <form onSubmit={submit}>
        <h2>Scribe</h2>
        <input type="password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
        {err && <div style={{ color: 'var(--danger)', marginBottom: 8, fontSize: 13 }}>{err}</div>}
        <button type="submit" className="primary">Sign in</button>
      </form>
    </div>
  );
}

function JoinModal({ token, onJoined }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      const r = await api.join(token, name);
      onJoined(r);
    } catch (e) { setErr(e.message); }
  }
  return (
    <div className="join-dialog">
      <form className="panel" onSubmit={submit}>
        <h3>You've been invited to a Scribe document</h3>
        <p>Enter the name others will see when you comment.</p>
        <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} autoFocus />
        {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
        <div style={{ marginTop: 10 }}>
          <button type="submit" className="primary">Join</button>
        </div>
      </form>
    </div>
  );
}

function DocList({ me }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showStyleGuide, setShowStyleGuide] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    api.listDocuments().then(r => { setDocs(r.documents); setLoading(false); });
  }, []);
  async function create() {
    const r = await api.createDocument({ title: 'Untitled' });
    nav(`/d/${r.document.id}`);
  }
  return (
    <div className="doclist">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <h1 style={{ flex: 1, margin: '0 0 0 0' }}>Scribe</h1>
        <span className="chip">{me.display_name}</span>
        {me.is_owner && <button onClick={() => setShowStyleGuide(true)}>Style guide</button>}
        {me.is_owner && <button onClick={create} className="primary">New document</button>}
      </div>
      <p style={{ color: 'var(--ink-muted)', marginBottom: 24 }}>Writing, drawn from your notebook.</p>
      {loading ? <div>Loading…</div> : docs.length === 0 ? (
        <div className="card">No documents yet. Start a new one.</div>
      ) : docs.map(d => (
        <Link to={`/d/${d.id}`} key={d.id} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card">
            <div style={{ fontWeight: 600 }}>{d.title || 'Untitled'}</div>
            {d.description && <div style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{d.description}</div>}
            <div className="meta">{new Date(d.updated_at).toLocaleString()} · {d.role}</div>
          </div>
        </Link>
      ))}
      {showStyleGuide && (
        <StyleGuideEditor onClose={() => setShowStyleGuide(false)} />
      )}
    </div>
  );
}

function DocRoute({ me }) {
  const { id } = useParams();
  const [search] = useSearchParams();
  const [state, setState] = useState({ status: 'loading' });
  const [joinNeeded, setJoinNeeded] = useState(null);

  useEffect(() => {
    api.getDocument(id)
      .then(r => setState({ status: 'ready', ...r }))
      .catch(err => {
        if (err.status === 401 || err.status === 403) {
          const t = search.get('t');
          if (t) setJoinNeeded(t);
          else setState({ status: 'forbidden' });
        } else {
          setState({ status: 'error', message: err.message });
        }
      });
  }, [id, search]);

  if (joinNeeded) {
    return <JoinModal token={joinNeeded} onJoined={() => { setJoinNeeded(null); window.location.reload(); }} />;
  }
  if (state.status === 'loading') return <div style={{ padding: 20 }}>Loading…</div>;
  if (state.status === 'forbidden') return <div style={{ padding: 20 }}>You don't have access to this document.</div>;
  if (state.status === 'error') return <div style={{ padding: 20 }}>Error: {state.message}</div>;

  return <DocumentView me={me} document={state.document} role={state.role} isOwner={state.is_owner} />;
}

export default function App() {
  const [me, setMe] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  function refresh() {
    api.me().then(setMe).catch(err => {
      if (err.status === 401) setNeedsLogin(true);
      else setMe(null);
    });
  }

  useEffect(refresh, []);

  if (needsLogin) return <Login onLoggedIn={() => { setNeedsLogin(false); refresh(); }} />;
  if (!me) return <div style={{ padding: 20 }}>Loading…</div>;

  return (
    <Routes>
      <Route path="/" element={<DocList me={me} onRefresh={refresh} />} />
      <Route path="/d/:id" element={<DocRoute me={me} />} />
    </Routes>
  );
}
