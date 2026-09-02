import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import NewBinderModal from '../components/NewBinderModal.jsx';

export default function BinderList() {
  const [binders, setBinders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBinders(await api.getBinders());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id, name) {
    if (!confirm(`Delete "${name}"? This removes the binder plan (not your collection).`)) return;
    await api.deleteBinder(id);
    load();
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Binders</h1>
        <button type="button" className="btn-primary" onClick={() => setShowNew(true)}>
          + New Binder
        </button>
      </div>
      <p className="page-subtitle">
        Plan where cards go in a physical 9-pocket binder — auto-fill from a full set, or build one card at a time.
      </p>

      {error && <p className="error-text">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && binders.length === 0 && !error && (
        <p className="muted">No binders yet. Create one to start planning a layout.</p>
      )}

      <div className="binder-grid">
        {binders.map((b) => {
          const ownedPct = b.totalSlots > 0 ? Math.round((b.ownedSlots / b.totalSlots) * 100) : 0;
          return (
            <Link to={`/binders/${b.id}`} key={b.id} className="binder-card">
              <div className="binder-card-icon">📔</div>
              <div className="binder-card-body">
                <div className="binder-card-name">{b.name}</div>
                <div className="muted">
                  {b.sourceSetName ? `${b.sourceSetName} · ` : ''}
                  {b.sourcePokemonName ? `Every ${b.sourcePokemonName} card · ` : ''}
                  {b.pageCount} page{b.pageCount === 1 ? '' : 's'} · {b.filledSlots} planned
                </div>
                <div className="muted">
                  {b.ownedSlots} owned ({ownedPct}%)
                </div>
                <div className="binder-progress-track" title={`${b.ownedSlots} of ${b.totalSlots} slots owned`}>
                  <div className="binder-progress-fill" style={{ width: `${ownedPct}%` }} />
                </div>
              </div>
              <button
                type="button"
                className="btn-small btn-danger binder-card-remove"
                onClick={(e) => {
                  e.preventDefault();
                  remove(b.id, b.name);
                }}
              >
                Delete
              </button>
            </Link>
          );
        })}
      </div>

      {showNew && (
        <NewBinderModal onClose={() => setShowNew(false)} onCreated={load} />
      )}
    </div>
  );
}
