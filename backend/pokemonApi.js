import db from './db.js';
import { fetchFallbackPrice } from './tcgdexApi.js';
import { bestGuessPrice } from './pricing.js';

const API_BASE = 'https://api.pokemontcg.io/v2';
const CACHE_TTL_HOURS = 12;

// Natural sort for printed card numbers ("1" < "2" < "10", "TG01" < "TG02",
// etc.) — a plain string/SQL sort would put "10" before "2", so this can't be
// expressed as a SQL ORDER BY; used to sort an already-fetched row set in JS.
export function compareCardNumbers(a, b) {
  const split = (s) => String(s ?? '').match(/(\d+|\D+)/g) || [];
  const aParts = split(a);
  const bParts = split(b);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ap = aParts[i] ?? '';
    const bp = bParts[i] ?? '';
    const aNum = /^\d+$/.test(ap);
    const bNum = /^\d+$/.test(bp);
    if (aNum && bNum) {
      const diff = Number(ap) - Number(bp);
      if (diff !== 0) return diff;
    } else {
      const cmp = ap.localeCompare(bp);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

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

// Also populates name/set/number/price columns alongside the JSON blob so a
// card can be found and sorted with a local SQL query (see localSearchCards)
// instead of a live pokemontcg.io call. price_amount uses bestGuessPrice
// (cheapest available variant), matching what CardTile actually displays —
// sorting by a *different* selection than what's shown would look "wrong"
// even though both are technically valid prices for the card.
export function cacheCard(card) {
  const price = bestGuessPrice(card);
  db.prepare(
    `INSERT INTO card_cache (id, data, fetched_at, name, set_id, set_name, number, price_amount, price_currency)
     VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data, fetched_at = excluded.fetched_at, name = excluded.name,
       set_id = excluded.set_id, set_name = excluded.set_name, number = excluded.number,
       price_amount = excluded.price_amount, price_currency = excluded.price_currency`
  ).run(
    card.id,
    JSON.stringify(card),
    card.name ?? null,
    card.set?.id ?? null,
    card.set?.name ?? null,
    card.number ?? null,
    price?.amount ?? null,
    price?.currency ?? null
  );
}

export function getCachedCard(id) {
  const row = db.prepare('SELECT data, fetched_at FROM card_cache WHERE id = ?').get(id);
  if (!row) return null;
  const ageHours = (Date.now() - new Date(row.fetched_at + 'Z').getTime()) / 36e5;
  return { card: { ...JSON.parse(row.data), pricesUpdatedAt: row.fetched_at }, stale: ageHours > CACHE_TTL_HOURS };
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
    card.pricesUpdatedAt = new Date().toISOString();
    return card;
  } catch (e) {
    if (cached) return cached.card;
    throw e;
  }
}

// Search purely against the local card_cache — no network call. Powers
// searchCards() below once a card's been cached at least once (by any path:
// a live search, a single-card lookup, or the sync-cards script), and is what
// makes "sort ALL matches, not just the current page" possible: name/price
// sort is a plain indexed SQL ORDER BY (cheap at any result-set size), and
// even "number" (natural sort, can't be expressed in SQL) sorts the full
// local match set in JS rather than one live 250-card page.
export function localSearchCards({ name, set, sortBy, page = 1, pageSize = 32 }) {
  const where = [];
  const params = [];
  if (name) {
    // Contains, not just prefix: pokemontcg.io's own live query (name:"X*")
    // tokenizes on whitespace and effectively matches any *word* in the name
    // starting with X (e.g. "charizard" matches "Mega Charizard"), which a
    // whole-string prefix match here wouldn't. Contains is a superset of
    // that and simpler to express in SQL — matches at least as much.
    where.push('LOWER(name) LIKE \'%\' || LOWER(?) || \'%\'');
    params.push(String(name).trim());
  }
  if (set) {
    where.push('set_id = ?');
    params.push(set);
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalCount = db.prepare(`SELECT COUNT(*) AS c FROM card_cache ${whereClause}`).get(...params).c;
  if (totalCount === 0) return { cards: [], totalCount: 0, page, pageSize };

  let rows;
  if (sortBy === 'number') {
    // Natural sort can't be a SQL ORDER BY — pull the full match set (still a
    // local indexed query even at ~20k rows) and sort/slice in JS.
    const all = db.prepare(`SELECT id, data, fetched_at, number FROM card_cache ${whereClause}`).all(...params);
    all.sort((a, b) => compareCardNumbers(a.number, b.number));
    rows = all.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  } else {
    const orderBy =
      {
        'name-desc': 'name COLLATE NOCASE DESC',
        'price-desc': 'price_amount IS NULL, price_amount DESC',
        'price-asc': 'price_amount IS NULL, price_amount ASC',
      }[sortBy] || 'name COLLATE NOCASE ASC'; // default + 'name-asc'
    rows = db
      .prepare(`SELECT id, data, fetched_at FROM card_cache ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);
  }

  const cards = rows.map((r) => ({ ...JSON.parse(r.data), pricesUpdatedAt: r.fetched_at }));
  return { cards, totalCount, page, pageSize };
}

const SYNC_COMPLETE_KEY = 'card-sync:completed';

// True once a full backend/scripts/syncAllCards.js run has finished at least
// once — only then is card_cache guaranteed to hold *every* card matching a
// given filter, not just whatever's been incidentally browsed so far.
// Trusting a partial local cache as complete (a query with *any* local match
// = "we have them all") silently truncates results — e.g. a set with 180
// cards where only 6 happen to have been looked up before would report 6.
// So searchCards() below stays fully live until this flips.
export function hasCompletedFullSync() {
  return !!getApiCache(SYNC_COMPLETE_KEY, Infinity);
}

export function markFullSyncComplete(totalCount) {
  setApiCache(SYNC_COMPLETE_KEY, { completedAt: new Date().toISOString(), totalCount });
}

// Search cards by name/set. Once a full sync has completed (see
// hasCompletedFullSync above), served entirely from the local card_cache —
// no network call, and sorting/pagination cover the whole matched set (see
// localSearchCards). Until then, always live (pokemontcg.io's own totalCount
// is the only thing that can be trusted as complete pre-sync), short-TTL
// cached with a stale-cache fallback on error — same as before this turn's
// change — while every result still gets cached opportunistically, so
// coverage keeps growing and the switch to cache-first is seamless once
// sync-cards finishes. Used by the search endpoint, by fetchAllCardsForSet
// (binder creation), and by CSV import to resolve name-only rows.
export async function searchCards({ name, set, sortBy, page = 1, pageSize = 32 }) {
  if (hasCompletedFullSync()) {
    return localSearchCards({ name, set, sortBy, page, pageSize });
  }

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
