import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

// 250 is the pokemontcg.io API's own per-request maximum — most sets have
// well under 250 cards, so filtering by set fits the whole set on one "page"
// and can just be scrolled through instead of clicking through many pages.
const PAGE_SIZE = 250;

// Shared search/browse state + logic used by both the Library and Price Lookup pages.
export function useCardSearch() {
  const [name, setName] = useState('');
  const [setId, setSetId] = useState('');
  const [sets, setSets] = useState([]);
  const [cards, setCards] = useState([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getSets().then(setSets).catch(() => {});
  }, []);

  const runSearch = useCallback(async (searchName, searchSet, searchPage) => {
    setLoading(true);
    setError(null);
    // Clear stale results immediately so a card from the previous search can't be
    // clicked (and its modal opened) while a new search is still in flight.
    setCards([]);
    try {
      const data = await api.searchCards({ name: searchName, set: searchSet, page: searchPage, pageSize: PAGE_SIZE });
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

  function retry() {
    runSearch(name, setId, page);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return {
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
    pageSize: PAGE_SIZE,
  };
}
