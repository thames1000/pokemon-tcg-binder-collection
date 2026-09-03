import { Router } from 'express';
import { fetchFromApi, getApiCache, setApiCache, getCardById, searchCards, hasCompletedFullSync } from '../pokemonApi.js';
import db from '../db.js';

const router = Router();

// GET /api/cards/sets - list all sets (for filter dropdown). Sets barely ever change,
// so cache for a day and fall back to a stale cache (however old) if the API is down.
router.get('/sets', async (req, res) => {
  const cacheKey = 'sets';
  const cached = getApiCache(cacheKey, 24);
  if (cached && !cached.stale) return res.json(cached.data);

  try {
    const data = await fetchFromApi('/sets?orderBy=-releaseDate&pageSize=250');
    setApiCache(cacheKey, data.data);
    res.json(data.data);
  } catch (e) {
    if (cached) return res.json(cached.data); // serve stale rather than error
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/cards/search?q=&name=&set=&page=&pageSize=&sortBy=
// sortBy: 'name-asc' (default) | 'name-desc' | 'number' | 'price-desc' | 'price-asc'
// — served entirely from the local card_cache (sorted/paginated across the
// *whole* match set) once a full `npm run sync-cards` has completed; live
// (matching pokemontcg.io's own results) until then, so results are never
// silently truncated to whatever's been incidentally cached so far. See
// searchCards()/localSearchCards()/hasCompletedFullSync() in pokemonApi.js.
router.get('/search', async (req, res) => {
  const { name, set, sortBy, page = 1, pageSize = 32 } = req.query;
  try {
    const result = await searchCards({ name, set, sortBy, page, pageSize });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/cards/sync-status - how much of the card database is cached
// locally, and progress of the last backend/scripts/syncAllCards.js run (if
// any), so coverage can be checked without watching terminal logs.
router.get('/sync-status', (req, res) => {
  const cachedCount = db.prepare('SELECT COUNT(*) AS c FROM card_cache').get().c;
  const progressRow = db.prepare("SELECT data FROM api_cache WHERE cache_key = 'card-sync:progress'").get();
  res.json({
    cachedCount,
    lastSyncProgress: progressRow ? JSON.parse(progressRow.data) : null,
    // Whether search is currently served from the local cache (true) or live
    // pokemontcg.io (false) — see hasCompletedFullSync() in pokemonApi.js.
    fullSyncComplete: hasCompletedFullSync(),
  });
});

// GET /api/cards/:id?force=true - single card, cached with TTL, fresh price data.
// `force=true` (used by the "Refresh price" button) skips the TTL and always hits
// the live API, still falling back to whatever's cached if that live call fails.
router.get('/:id', async (req, res) => {
  try {
    const card = await getCardById(req.params.id, { force: req.query.force === 'true' });
    res.json(card);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
