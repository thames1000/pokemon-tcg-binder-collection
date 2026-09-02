import db from './db.js';

// Fallback price source, used only when pokemontcg.io has no TCGplayer/Cardmarket
// data for a card (common for very recently released sets — see README). TCGdex is
// a free, keyless, independent database with its own card/set IDs, so cards are
// matched by name + set name + printed number rather than by ID.
const BASE = 'https://api.tcgdex.net/v2/en';
const FETCH_TIMEOUT_MS = 5000;

async function tcgdexFetch(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // network error, timeout, or bad JSON — fallback simply isn't available
  } finally {
    clearTimeout(timeout);
  }
}

function getCache(key, ttlHours) {
  const row = db.prepare('SELECT data, fetched_at FROM api_cache WHERE cache_key = ?').get(key);
  if (!row) return null;
  const ageHours = (Date.now() - new Date(row.fetched_at + 'Z').getTime()) / 36e5;
  if (ageHours > ttlHours) return null;
  return JSON.parse(row.data);
}

function setCache(key, data) {
  db.prepare(
    `INSERT INTO api_cache (cache_key, data, fetched_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
  ).run(key, JSON.stringify(data));
}

const normalizeName = (s) => (s || '').trim().toLowerCase();
// "001" -> "1" so it compares equal to pokemontcg.io's unpadded numbers; non-numeric
// local ids (promos, "TG01" etc.) compare as-is, case-insensitive.
const normalizeNumber = (s) => {
  const str = String(s ?? '').trim();
  return /^\d+$/.test(str) ? String(Number.parseInt(str, 10)) : str.toUpperCase();
};

async function getTcgdexSetId(setName) {
  const cacheKey = 'tcgdex:sets';
  let sets = getCache(cacheKey, 24);
  if (!sets) {
    const data = await tcgdexFetch('/sets');
    if (!data) return null;
    sets = data;
    setCache(cacheKey, sets);
  }
  const target = normalizeName(setName);
  const match = sets.find((s) => normalizeName(s.name) === target);
  return match?.id ?? null;
}

async function getTcgdexCardId(tcgdexSetId, number, name) {
  const cacheKey = `tcgdex:set:${tcgdexSetId}`;
  let set = getCache(cacheKey, 24);
  if (!set) {
    set = await tcgdexFetch(`/sets/${tcgdexSetId}`);
    if (!set) return null;
    setCache(cacheKey, set);
  }
  const cards = set.cards || [];
  const targetNumber = normalizeNumber(number);
  const byNumber = cards.find((c) => normalizeNumber(c.localId) === targetNumber);
  if (byNumber) return byNumber.id;
  // Number formats occasionally don't line up between the two databases — fall
  // back to an exact name match within the set rather than giving up entirely.
  const targetName = normalizeName(name);
  return cards.find((c) => normalizeName(c.name) === targetName)?.id ?? null;
}

// Pull whatever market price a TCGdex card has, tolerant of minor field-naming
// differences since this is matched against docs, not a pinned schema version.
function extractPrice(cardData) {
  const pricing = cardData?.pricing;
  if (!pricing) return null;

  const tp = pricing.tcgplayer;
  if (tp) {
    for (const [key, val] of Object.entries(tp)) {
      if (key === 'updated' || key === 'unit' || !val || typeof val !== 'object') continue;
      const amount = val.marketPrice ?? val.market ?? val.midPrice ?? val.mid;
      if (typeof amount === 'number') {
        return { amount, currency: tp.unit || 'USD', source: 'TCGdex (TCGplayer)', variant: key };
      }
    }
  }

  const cm = pricing.cardmarket;
  if (cm) {
    const amount = cm.trend ?? cm.trendPrice ?? cm.avg ?? cm.avg7 ?? cm.averageSellPrice;
    if (typeof amount === 'number') {
      return { amount, currency: cm.unit || 'EUR', source: 'TCGdex (Cardmarket)', variant: 'trend' };
    }
  }

  return null;
}

// Look up a fallback price for a card pokemontcg.io has no pricing for. Returns
// null (never throws) if TCGdex is unreachable or has no matching card either.
export async function fetchFallbackPrice({ name, setName, number }) {
  if (!setName || !number) return null;
  try {
    const tcgdexSetId = await getTcgdexSetId(setName);
    if (!tcgdexSetId) return null;
    const tcgdexCardId = await getTcgdexCardId(tcgdexSetId, number, name);
    if (!tcgdexCardId) return null;
    const cacheKey = `tcgdex:card:${tcgdexCardId}`;
    let cardData = getCache(cacheKey, 6);
    if (!cardData) {
      cardData = await tcgdexFetch(`/cards/${tcgdexCardId}`);
      if (!cardData) return null;
      setCache(cacheKey, cardData);
    }
    return extractPrice(cardData);
  } catch (e) {
    console.warn('TCGdex fallback lookup failed:', e.message);
    return null;
  }
}
