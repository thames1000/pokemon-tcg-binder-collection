import { useState } from 'react';
import { api } from '../api.js';
import CardTile from './CardTile.jsx';
import { useCardSearch } from '../hooks/useCardSearch.js';

export default function BinderSlotModal({ binderId, position, slot, onClose, onChanged }) {
  const [mode, setMode] = useState(slot ? 'view' : 'search'); // 'view' | 'search'
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const {
    name, setName, setId, setSetId, sets, cards, page, setPage,
    totalCount, totalPages, loading, error: searchError, handleSearchSubmit, retry,
  } = useCardSearch();

  async function place(card) {
    setSaving(true);
    setError(null);
    try {
      await api.setBinderSlot(binderId, position, { cardId: card.id, card });
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await api.clearBinderSlot(binderId, position);
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {mode === 'view' && slot?.card && (
          <div className="modal-body">
            <div className="modal-image">
              {slot.card.images?.large ? (
                <img src={slot.card.images.large} alt={slot.card.name} />
              ) : (
                <div className="card-tile-placeholder">No image</div>
              )}
            </div>
            <div className="modal-details">
              <h2>{slot.card.name}</h2>
              <p className="modal-subtitle">
                {slot.card.set?.name} · #{slot.card.number} · {slot.card.rarity || 'Unknown rarity'}
              </p>
              <p className={slot.owned ? 'success-text' : 'muted'}>
                {slot.owned ? '✓ In your collection' : 'Not in your collection yet'}
              </p>

              {error && <p className="error-text">{error}</p>}

              <div className="form-row" style={{ marginTop: '1rem' }}>
                <button type="button" className="btn-primary" onClick={() => setMode('search')} disabled={saving}>
                  Replace
                </button>
                <button type="button" className="btn-small btn-danger" onClick={remove} disabled={saving}>
                  {saving ? 'Removing…' : 'Remove from slot'}
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === 'search' && (
          <div>
            <h2>{slot?.card ? 'Replace card' : 'Add a card to this slot'}</h2>
            <form className="search-bar" onSubmit={handleSearchSubmit}>
              <input type="text" placeholder="Search card name…" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <select value={setId} onChange={(e) => setSetId(e.target.value)}>
                <option value="">All sets</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.series})
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary">
                Search
              </button>
            </form>

            {(error || searchError) && <p className="error-text">{error || searchError} {searchError && <button type="button" className="btn-small" onClick={retry}>Retry</button>}</p>}
            {loading && <p className="muted">Loading…</p>}
            {saving && <p className="muted">Placing…</p>}

            <div className="card-grid binder-search-grid">
              {cards.map((card) => (
                <CardTile key={card.id} card={card} onOpen={place} />
              ))}
            </div>

            {totalCount > 32 && (
              <div className="pagination">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Prev
                </button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
