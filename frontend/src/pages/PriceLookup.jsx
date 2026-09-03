import { useState } from 'react';
import CardTile from '../components/CardTile.jsx';
import PriceLookupModal from '../components/PriceLookupModal.jsx';
import { useCardSearch } from '../hooks/useCardSearch.js';

export default function PriceLookup({ onCollectionChanged }) {
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
    loading,
    error,
    handleSearchSubmit,
    retry,
    pageSize,
  } = useCardSearch();
  const [selectedCard, setSelectedCard] = useState(null);

  return (
    <div className="page">
      <h1>Price Lookup</h1>
      <p className="page-subtitle">
        Check current TCGplayer &amp; Cardmarket prices for any card — no need to add it to your collection.
      </p>

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
          Look Up Price
        </button>
      </form>

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
          <CardTile key={card.id} card={card} onOpen={setSelectedCard} />
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
        <PriceLookupModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onAdded={onCollectionChanged}
        />
      )}
    </div>
  );
}
