import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import CardTile from '../components/CardTile.jsx';
import AddToCollectionModal from '../components/AddToCollectionModal.jsx';
import AddToWishlistModal from '../components/AddToWishlistModal.jsx';
import { useCardSearch } from '../hooks/useCardSearch.js';
import { SORT_OPTIONS } from '../sortCards.js';

export default function Library({ onCollectionChanged }) {
  const {
    name,
    setName,
    setId,
    setSetId,
    sortBy,
    setSortBy,
    sets,
    cards,
    page,
    setPage,
    totalCount,
    totalPages,
    loading,
    error,
    handleSearchSubmit,
    retry,
    pageSize,
  } = useCardSearch();
  const [selectedCard, setSelectedCard] = useState(null);
  const [wishlistCard, setWishlistCard] = useState(null);
  // cardId -> wishlist item id, so the star can show filled/empty per card
  // and a filled star knows which row to delete on click.
  const [wishlistedIds, setWishlistedIds] = useState(new Map());

  const loadWishlist = useCallback(async () => {
    try {
      const items = await api.getWishlist();
      setWishlistedIds(new Map(items.map((item) => [item.cardId, item.id])));
    } catch {
      // non-critical — the star just won't reflect wishlist state until a retry
    }
  }, []);

  useEffect(() => {
    loadWishlist();
  }, [loadWishlist]);

  async function handleUnwishlist(card) {
    const itemId = wishlistedIds.get(card.id);
    if (itemId == null) return;
    // Optimistic — the star flips back to empty immediately rather than
    // waiting on the round trip.
    setWishlistedIds((prev) => {
      const next = new Map(prev);
      next.delete(card.id);
      return next;
    });
    try {
      await api.removeFromWishlist(itemId);
    } catch {
      loadWishlist(); // request failed — resync with the server's actual state
    }
  }

  return (
    <div className="page">
      <h1>Library</h1>
      <p className="page-subtitle">Browse every Pokémon TCG card and add what you own to your collection.</p>

      <form className="search-bar" onSubmit={handleSearchSubmit}>
        <input
          type="text"
          placeholder="Search card name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
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

      {cards.length > 0 && (
        <div className="sort-bar">
          <label>
            Sort by
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && (
        <p className="error-text">
          {error}{' '}
          <button type="button" className="btn-small" onClick={retry}>
            Retry
          </button>
        </p>
      )}
      {loading && <p className="muted">Loading…</p>}

      {!loading && cards.length === 0 && !error && (
        <p className="muted">No cards found. Try a different search.</p>
      )}

      <div className="card-grid">
        {cards.map((card) => (
          <CardTile
            key={card.id}
            card={card}
            onOpen={setSelectedCard}
            onWishlist={setWishlistCard}
            onUnwishlist={handleUnwishlist}
            wishlisted={wishlistedIds.has(card.id)}
          />
        ))}
      </div>

      {totalCount > pageSize && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </button>
          <span>
            Page {page} of {totalPages} ({totalCount} cards)
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}

      {selectedCard && (
        <AddToCollectionModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onAdded={onCollectionChanged}
        />
      )}

      {wishlistCard && (
        <AddToWishlistModal card={wishlistCard} onClose={() => setWishlistCard(null)} onAdded={loadWishlist} />
      )}
    </div>
  );
}
