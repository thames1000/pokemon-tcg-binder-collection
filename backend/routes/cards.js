import { Router } from 'express';
import db from '../db.js';

const router = Router();

const API_BASE = 'https://api.pokemontcg.io/v2';
const CACHE_TTL_HOURS = 12;

function apiHeaders() {
  const headers = {};
  if (process.env.POKEMONTCG_API_KEY) {
    headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;
  }
  return headers;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The public pokemontcg.io API is prone to brief 5xx blips (and outright rejects some
// requests) under its unauthenticated rate limit, so retry with backoff+jitter before
// surfacing an error. Set POKEMONTCG_API_KEY in backend/.env for a much lower failure rate.
async function fetchFromApi(pathAndQuery, attempt = 1) {
  const res = await fetch(`${API_BASE}${pathAndQuery}`, { headers: apiHeaders() });
  if (!res.ok) {
    if ((res.status >= 500 || res.status === 429) && attempt < 4) {
      await sleep(attempt * 500 + Math.random() * 300);
      return fetchFromApi(pathAndQuery, attempt + 1);
    }
    const text = await res.text().catch(() => '');
    const err = new Error(`Pokemon TCG API error ${res.status}: ${text}`);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  return res.json();
}

// Generic cache helpers backing api_cache (used by endpoints without a natural
// per-row cache, e.g. /sets and /search) — lets us serve a stale-but-known-good
// response instead of an error when the upstream API is down.
function getApiCache(key, ttlHours) {
  const row = db.prepare('SELECT data, fetched_at FROM api_cache WHERE cache_key = ?').get(key);
  if (!row) return null;
  const ageHours = (Date.now() - new Date(row.fetched_at + 'Z').getTime()) / 36e5;
  return { data: JSON.parse(row.data), stale: ageHours > ttlHours };
}

function setApiCache(key, data) {
  db.prepare(
    `INSERT INTO api_cache (cache_key, data, fetched_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
  ).run(key, JSON.stringify(data));
}

function cacheCard(card) {
  db.prepare(
    `INSERT INTO card_cache (id, data, fetched_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
  ).run(card.id, JSON.stringify(card));
}

function getCachedCard(id) {
  const row = db.prepare('SELECT data, fetched_at FROM card_cache WHERE id = ?').get(id);
  if (!row) return null;
  const ageHours = (Date.now() - new Date(row.fetched_at + 'Z').getTime()) / 36e5;
  return { card: JSON.parse(row.data), stale: ageHours > CACHE_TTL_HOURS };
}

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
  const cacheKey = `search:${name || ''}:${set || ''}:${page}:${pageSize}`;
  const cached = getApiCache(cacheKey, 1);
  if (cached && !cached.stale) return res.json(cached.data);

  try {
    const clauses = [];
    if (name) clauses.push(`name:"${String(name).trim()}*"`);
    if (set) clauses.push(`set.id:${set}`);
    const q = clauses.length ? `&q=${encodeURIComponent(clauses.join(' '))}` : '';
    const data = await fetchFromApi(
      `/cards?page=${page}&pageSize=${pageSize}&orderBy=name${q}`
    );
    for (const card of data.data) cacheCard(card);
    const result = { cards: data.data, totalCount: data.totalCount, page: data.page, pageSize: data.pageSize };
    setApiCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    if (cached) return res.json(cached.data); // serve stale rather than error
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/cards/:id - single card, cached with TTL, fresh price data
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const cached = getCachedCard(id);
    if (cached && !cached.stale) {
      return res.json(cached.card);
    }
    const data = await fetchFromApi(`/cards/${id}`);
    cacheCard(data.data);
    res.json(data.data);
  } catch (e) {
    // Fall back to stale cache if the API is unreachable/rate-limited
    const cached = getCachedCard(id);
    if (cached) return res.json(cached.card);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Called once at server startup so the (slow, occasionally very flaky) first /sets
// fetch happens in the background instead of blocking a user's first page load.
export async function warmSetsCache() {
  const cacheKey = 'sets';
  const cached = getApiCache(cacheKey, 24);
  if (cached && !cached.stale) return;
  try {
    const data = await fetchFromApi('/sets?orderBy=-releaseDate&pageSize=250');
    setApiCache(cacheKey, data.data);
    console.log('Pre-warmed sets cache');
  } catch (e) {
    console.warn('Could not pre-warm sets cache:', e.message);
  }
}

export default router;
