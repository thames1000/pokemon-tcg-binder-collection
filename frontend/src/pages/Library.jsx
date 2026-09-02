import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import CardTile from '../components/CardTile.jsx';
import AddToCollectionModal from '../components/AddToCollectionModal.jsx';

export default function Library({ onCollectionChanged }) {
  const [name, setName] = useState('');
  const [setId, setSetId] = useState('');
  const [sets, setSets] = useState([]);
  const [cards, setCards] = useState([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);

  useEffect(() => {
    api.getSets().then(setSets).catch(() => {});
  }, []);

  const runSearch = useCallback(async (searchName, searchSet, searchPage) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.searchCards({ name: searchName, set: searchSet, page: searchPage, pageSize: 32 });
      setCards(data.cards);
      setTotalCount(data.totalCount);
    } catch (err) {
      setError(err.message);
      setCards([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runSearch(name, setId, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    setPage(1);
    runSearch(name, setId, 1);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / 32));

  return (
    <div className="page">
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

      {error && <p className="error-text">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && cards.length === 0 && !error && (
        <p className="muted">No cards found. Try a different search.</p>
      )}

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
        <AddToCollectionModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onAdded={onCollectionChanged}
        />
      )}
    </div>
  );
}
