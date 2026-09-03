import db from './db.js';
import { fetchFallbackPrice } from './tcgdexApi.js';

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
export async function fetchFromApi(pathAndQuery, attempt = 1) {
  const res = await fetch(`${API_BASE}${pathAndQuery}`, { headers: apiHeaders() });
  if (!res.ok) {
    if ((res.status >= 500 || res.status === 429) && attempt < 4) {
      await sleep(attempt * 500 + Math.random() * 300);
      return fetchFromApi(pathAndQuery, attempt + 1);
    }
    // pokemontcg.io/Cloudflare error responses are full HTML pages — never forward
    // that raw markup to the client, just a short human-readable summary.
    const text = await res.text().catch(() => '');
    const snippet = /<title>(.*?)<\/title>/i.exec(text)?.[1] ?? `HTTP ${res.status}`;
    let message;
    if (res.status === 429) {
      message = 'Pokemon TCG API rate limit exceeded. Try again shortly, or add an API key for a higher limit.';
    } else if (res.status === 404) {
      message = "Card not found — check the ID or search terms.";
    } else {
      message = `Pokemon TCG API is currently unavailable (${snippet}). This is an upstream outage, not a problem with your setup — try again in a moment.`;
    }
    const err = new Error(message);
    err.status = res.status === 429 ? 429 : res.status === 404 ? 404 : 502;
    throw err;
  }
  return res.json();
}

// Generic cache helpers backing api_cache (used by endpoints without a natural
// per-row cache, e.g. /sets and /search) — lets us serve a stale-but-known-good
// response instead of an error when the upstream API is down.
export function getApiCache(key, ttlHours) {
  const row = db.prepare('SELECT data, fetched_at FROM api_cache WHERE cache_key = ?').get(key);
  if (!row) return null;
  const ageHours = (Date.now() - new Date(row.fetched_at + 'Z').getTime()) / 36e5;
  return { data: JSON.parse(row.data), stale: ageHours > ttlHours };
}

export function setApiCache(key, data) {
  db.prepare(
    `INSERT INTO api_cache (cache_key, data, fetched_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
  ).run(key, JSON.stringify(data));
}

export function cacheCard(card) {
  db.prepare(
    `INSERT INTO card_cache (id, data, fetched_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
  ).run(card.id, JSON.stringify(card));
}

export function getCachedCard(id) {
  const row = db.prepare('SELECT data, fetched_at FROM card_cache WHERE id = ?').get(id);
  if (!row) return null;
  const ageHours = (Date.now() - new Date(row.fetched_at + 'Z').getTime()) / 36e5;
  return { card: JSON.parse(row.data), stale: ageHours > CACHE_TTL_HOURS };
}

// pokemontcg.io has no price data of its own for some very recently released sets
// (their sync pipeline appears to have stopped covering new sets — see README).
// When a freshly-fetched card has neither TCGplayer nor Cardmarket prices, try
// TCGdex as a fallback and attach whatever it finds so it gets cached alongside
// the card — a no-op for the vast majority of cards that already have pricing.
export async function withFallbackPrice(card) {
  if (!card || card.tcgplayer?.prices || card.cardmarket?.prices) return card;
  const fallback = await fetchFallbackPrice({ name: card.name, setName: card.set?.name, number: card.number });
  if (fallback) card.priceFallback = fallback;
  return card;
}

// Resolve a single card by its pokemontcg.io id, cache-first with a live-fetch
// fallback (and a stale-cache fallback if that live fetch fails). Used by the
// card detail endpoint, the "refresh price" button, and CSV import (cardId column).
export async function getCardById(id, { force = false } = {}) {
  const cached = getCachedCard(id);
  if (cached && !cached.stale && !force) return cached.card;
  try {
    const data = await fetchFromApi(`/cards/${id}`);
    const card = await withFallbackPrice(data.data);
    cacheCard(card);
    return card;
  } catch (e) {
    if (cached) return cached.card;
    throw e;
  }
}

// Search cards by name/set, cache-first (short TTL) with a stale-cache fallback.
// Used by the search endpoint and by CSV import to resolve rows that only give a
// card name (+ optional set/number) instead of a cardId.
export async function searchCards({ name, set, page = 1, pageSize = 32 }) {
  const cacheKey = `search:${name || ''}:${set || ''}:${page}:${pageSize}`;
  const cached = getApiCache(cacheKey, 1);
  if (cached && !cached.stale) return cached.data;

  try {
    const clauses = [];
    if (name) clauses.push(`name:"${String(name).trim()}*"`);
    if (set) clauses.push(`set.id:${set}`);
    const q = clauses.length ? `&q=${encodeURIComponent(clauses.join(' '))}` : '';
    const data = await fetchFromApi(`/cards?page=${page}&pageSize=${pageSize}&orderBy=name${q}`);
    for (const card of data.data) {
      await withFallbackPrice(card);
      cacheCard(card);
    }
    const result = { cards: data.data, totalCount: data.totalCount, page: data.page, pageSize: data.pageSize };
    setApiCache(cacheKey, result);
    return result;
  } catch (e) {
    if (cached) return cached.data;
    throw e;
  }
}

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
