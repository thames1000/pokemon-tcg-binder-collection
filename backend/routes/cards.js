import { Router } from 'express';
import { fetchFromApi, getApiCache, setApiCache, getCardById, searchCards } from '../pokemonApi.js';

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

// GET /api/cards/search?q=&name=&set=&page=&pageSize=
router.get('/search', async (req, res) => {
  const { name, set, page = 1, pageSize = 32 } = req.query;
  try {
    const result = await searchCards({ name, set, page, pageSize });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
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
