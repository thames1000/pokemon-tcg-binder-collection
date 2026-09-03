import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// 250 is the pokemontcg.io API's own per-request maximum — most sets have
// well under 250 cards, so filtering by set fits the whole set on one "page"
// and can just be scrolled through instead of clicking through many pages.
const PAGE_SIZE = 250;

// Shared search/browse state + logic used by both the Library and Price Lookup
// pages. skipInitialSearch: for a consumer that's about to call searchFor()
// itself right after mount (e.g. a modal pre-filling a specific name) — without
// this, the hook's own unfiltered mount-time search and that explicit search
// race each other, and whichever network request resolves last wins, silently
// showing results that don't match what's in the search box.
export function useCardSearch({ skipInitialSearch = false } = {}) {
  const [name, setName] = useState('');
  const [setId, setSetId] = useState('');
  const [sortBy, setSortByState] = useState('name-asc');
  const [sets, setSets] = useState([]);
  const [cards, setCards] = useState([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getSets().then(setSets).catch(() => {});
  }, []);

  const runSearch = useCallback(async (searchName, searchSet, searchSortBy, searchPage) => {
    setLoading(true);
    setError(null);
    // Clear stale results immediately so a card from the previous search can't be
    // clicked (and its modal opened) while a new search is still in flight.
    setCards([]);
    try {
      const data = await api.searchCards({
        name: searchName,
        set: searchSet,
        sortBy: searchSortBy,
        page: searchPage,
        pageSize: PAGE_SIZE,
      });
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

  const skippedInitialSearch = useRef(false);
  useEffect(() => {
    if (skipInitialSearch && !skippedInitialSearch.current) {
      skippedInitialSearch.current = true;
      return;
    }
    runSearch(name, setId, sortBy, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    setPage(1);
    runSearch(name, setId, sortBy, 1);
  }

  function retry() {
    runSearch(name, setId, sortBy, page);
  }

  // Sorting changes the ordering of the *whole* matched set (server-side —
  // see backend/pokemonApi.js's localSearchCards), not just what's already
  // loaded, so it re-runs the search rather than re-sorting in place; treated
  // like a new query, so it resets to page 1.
  function setSortBy(newSortBy) {
    setSortByState(newSortBy);
    setPage(1);
    runSearch(name, setId, newSortBy, 1);
  }

  // For a consumer that needs to search for a specific name right away (e.g. a
  // National Dex slot pre-filling "Charizard") — setting `name` alone doesn't
  // trigger a search (only submitting the form or changing `page` does), and
  // calling it immediately after setName would still read the pre-update value
  // due to how state updates apply, so this takes the name directly instead.
  function searchFor(searchName, searchSet = '') {
    setName(searchName);
    setSetId(searchSet);
    setPage(1);
    runSearch(searchName, searchSet, sortBy, 1);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return {
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
    searchFor,
    pageSize: PAGE_SIZE,
  };
}
