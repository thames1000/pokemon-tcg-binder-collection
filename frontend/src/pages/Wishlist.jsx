import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import CardTile from '../components/CardTile.jsx';
import AddToWishlistModal from '../components/AddToWishlistModal.jsx';
import { useCardSearch } from '../hooks/useCardSearch.js';

function WishlistRow({ item, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [targetPrice, setTargetPrice] = useState(item.targetPrice ?? '');
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateWishlistItem(item.id, {
        targetPrice: targetPrice === '' ? null : Number(targetPrice),
        notes,
      });
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${item.card?.name} from your wishlist?`)) return;
    await api.removeFromWishlist(item.id);
    onChanged();
  }

  async function refreshPrice() {
    setRefreshing(true);
    try {
      await api.refreshCardPrice(item.cardId);
      onChanged();
    } finally {
      setRefreshing(false);
    }
  }

  const card = item.card;

  return (
    <div className={`wishlist-row ${item.belowTarget ? 'wishlist-row-hit' : ''}`}>
      {card?.images?.small && <img src={card.images.small} alt={card.name} className="wishlist-row-image" />}
      <div className="wishlist-row-body">
        <div className="row-name">
          {card?.name || item.cardId}
          {item.belowTarget && <span className="target-hit-badge">🎯 At target</span>}
        </div>
        <div className="row-meta">
          {card?.set?.name} · #{card?.number}
        </div>
        {editing ? (
          <input
            type="text"
            className="notes-input"
            placeholder="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        ) : (
          item.notes && <div className="muted">{item.notes}</div>
        )}
      </div>

      <div className="wishlist-row-prices">
        <div>
          <div className="muted" style={{ fontSize: '0.7rem' }}>
            Current
          </div>
          <div className="price-cell">
            <span>{item.currentPrice ? `$${item.currentPrice.amount.toFixed(2)}` : '—'}</span>
            <button type="button" className="btn-icon" title="Refresh price" onClick={refreshPrice} disabled={refreshing}>
              {refreshing ? '…' : '↻'}
            </button>
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: '0.7rem' }}>
            Target
          </div>
          {editing ? (
            <input
              type="number"
              min="0"
              step="0.01"
              className="qty-input"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
            />
          ) : (
            <div>{item.targetPrice != null ? `$${item.targetPrice.toFixed(2)}` : '—'}</div>
          )}
        </div>
      </div>

      <div className="col-actions">
        {editing ? (
          <>
            <button className="btn-small" onClick={save} disabled={saving}>
              Save
            </button>
            <button className="btn-small btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn-small btn-ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="btn-small btn-danger" onClick={remove}>
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Wishlist() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.getWishlist());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const {
    name,
    setName,
    setId,
    setSetId,
    sets,
    cards,
    page,
    setPage,
    totalCount,
    totalPages,
    loading: searching,
    error: searchError,
    handleSearchSubmit,
    retry,
  } = useCardSearch();

  const hitCount = items.filter((i) => i.belowTarget).length;

  return (
    <div className="page">
      <h1>Wishlist</h1>
      <p className="page-subtitle">
        Cards you want but don't own yet. Set a target price and cards that drop to or below it are flagged here —
        check back when you're deal-hunting.
      </p>

      {error && <p className="error-text">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && items.length === 0 && !error && (
        <p className="muted">Your wishlist is empty. Search below to add cards you're hunting for.</p>
      )}

      {items.length > 0 && (
        <>
          {hitCount > 0 && (
            <p className="target-hit-summary">
              🎯 {hitCount} card{hitCount > 1 ? 's' : ''} at or below your target price.
            </p>
          )}
          <div className="wishlist-list">
            {items.map((item) => (
              <WishlistRow key={item.id} item={item} onChanged={load} />
            ))}
          </div>
        </>
      )}

      <h2 className="wishlist-search-heading">Add to wishlist</h2>
      <form className="search-bar" onSubmit={handleSearchSubmit}>
        <input type="text" placeholder="Search card name…" value={name} onChange={(e) => setName(e.target.value)} />
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

      {searchError && (
        <p className="error-text">
          {searchError}{' '}
          <button type="button" className="btn-small" onClick={retry}>
            Retry
          </button>
        </p>
      )}
      {searching && <p className="muted">Loading…</p>}

      <div className="card-grid">
        {cards.map((card) => (
          <CardTile key={card.id} card={card} onOpen={setSelectedCard} />
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

      {selectedCard && (
        <AddToWishlistModal card={selectedCard} onClose={() => setSelectedCard(null)} onAdded={load} />
      )}
    </div>
  );
}
