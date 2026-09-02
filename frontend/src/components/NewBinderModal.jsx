import { useEffect, useState } from 'react';
import { api } from '../api.js';

const SLOTS_PER_PAGE = 18; // 3x3 front + 3x3 back

export default function NewBinderModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('manual');
  const [pageCount, setPageCount] = useState(4);
  const [sets, setSets] = useState([]);
  const [setId, setSetId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getSets().then(setSets).catch(() => {});
  }, []);

  const selectedSet = sets.find((s) => s.id === setId);
  const previewPages = selectedSet ? Math.ceil((selectedSet.total || 0) / SLOTS_PER_PAGE) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const payload =
        mode === 'set'
          ? { name: name.trim(), mode: 'set', setId }
          : { name: name.trim(), mode: 'manual', pageCount: Number(pageCount) };
      const binder = await api.createBinder(payload);
      onCreated?.(binder);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>New Binder</h2>

        <form className="add-form" onSubmit={handleSubmit}>
          <label>
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Base Set Binder" required />
          </label>

          <div className="binder-mode-toggle">
            <button type="button" className={mode === 'manual' ? 'btn-mode active' : 'btn-mode'} onClick={() => setMode('manual')}>
              Manual entry
            </button>
            <button type="button" className={mode === 'set' ? 'btn-mode active' : 'btn-mode'} onClick={() => setMode('set')}>
              From a master set
            </button>
          </div>

          {mode === 'manual' ? (
            <label>
              Starting page count
              <input type="number" min="1" value={pageCount} onChange={(e) => setPageCount(e.target.value)} />
              <span className="muted" style={{ fontWeight: 400 }}>
                {Number(pageCount) || 0} pages × 18 slots = {(Number(pageCount) || 0) * SLOTS_PER_PAGE} pockets. You can add more pages later.
              </span>
            </label>
          ) : (
            <label>
              Set
              <select value={setId} onChange={(e) => setSetId(e.target.value)} required>
                <option value="">Choose a set…</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.series}) — {s.total} cards
                  </option>
                ))}
              </select>
              {selectedSet && (
                <span className="muted" style={{ fontWeight: 400 }}>
                  {selectedSet.total} cards → {previewPages} page{previewPages === 1 ? '' : 's'} ({previewPages * SLOTS_PER_PAGE} pockets),
                  filled in card-number order.
                </span>
              )}
            </label>
          )}

          {error && <p className="error-text">{error}</p>}

          <button type="submit" className="btn-primary" disabled={creating || (mode === 'set' && !setId)}>
            {creating ? 'Creating…' : 'Create Binder'}
          </button>
        </form>
      </div>
    </div>
  );
}
