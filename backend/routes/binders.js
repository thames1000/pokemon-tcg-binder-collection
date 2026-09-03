import { Router } from 'express';
import db from '../db.js';
import { searchCards, fetchFromApi, getApiCache, setApiCache, cacheCard, withFallbackPrice, compareCardNumbers } from '../pokemonApi.js';
import { cardMarketPrice } from '../pricing.js';
import { NATIONAL_DEX } from '../nationalDex.js';

const router = Router();

const SLOTS_PER_SIDE = 9; // 3x3
const SLOTS_PER_PAGE = SLOTS_PER_SIDE * 2; // front + back

// Rarities that default to "2 slots" (Normal + Reverse Holofoil) when a set is
// first previewed — conservative and only for exact, modern-naming rarities;
// everything else (including "Rare Holo", Promo, and every above-Rare tier,
// which are already single, holo-only prints) defaults to 1. Fully overridable
// per rarity in the New Binder modal before creating — this is just the seed.
const DEFAULT_TWO_SLOT_RARITIES = new Set(['Common', 'Uncommon', 'Rare']);

const isPromoRarity = (rarity) => /promo/i.test(rarity || '');

// Fetches every card in a set (pokemontcg.io caps pageSize at 250; a handful of
// sets exceed that, so paginate defensively, capped at 10 pages — no real set is
// 2500+ cards), sorted by printed number.
async function fetchAllCardsForSet(setId) {
  let allCards = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await searchCards({ set: setId, page, pageSize: 250 });
    allCards = allCards.concat(result.cards);
    if (allCards.length >= result.totalCount || result.cards.length === 0 || page >= 10) break;
    page++;
  }
  allCards.sort((a, b) => compareCardNumbers(a.number, b.number));
  return allCards;
}

// Fetches every Pokémon card whose name *contains* the given text, across every
// set ever printed — e.g. "Charizard" catches "Charizard", "Charizard VMAX",
// "Dark Charizard", "M Charizard-EX", "Reshiram & Charizard-GX", etc. Excludes
// non-Pokémon cards that just mention it (Trainer items like "Charizard Spirit
// Link"). Sorted chronologically by set release date, then by number within a
// set — a "collect them all" binder is naturally organized by when each was
// printed, not by a card number that resets every set.
async function fetchAllCardsForPokemon(pokemonName) {
  const cacheKey = `binder-pokemon:${pokemonName.toLowerCase()}`;
  const cached = getApiCache(cacheKey, 6);
  if (cached && !cached.stale) return cached.data;

  let allCards = [];
  let page = 1;
  const q = encodeURIComponent(`name:*${pokemonName.trim()}*`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await fetchFromApi(`/cards?q=${q}&page=${page}&pageSize=250`);
    allCards = allCards.concat(data.data);
    if (allCards.length >= data.totalCount || data.data.length === 0 || page >= 10) break;
    page++;
  }
  allCards = allCards.filter((c) => c.supertype === 'Pokémon');
  // Unlike fetchAllCardsForSet (which goes through searchCards, and so already
  // gets this), these cards come straight from fetchFromApi — enrich each with
  // the TCGdex fallback price and cache it, same as every other card-fetching
  // path, so a Pokémon-mode binder's estimate isn't missing prices simply
  // because this was the one path that skipped it.
  for (const card of allCards) {
    await withFallbackPrice(card);
    cacheCard(card);
  }
  allCards.sort((a, b) => {
    const dateA = a.set?.releaseDate || '';
    const dateB = b.set?.releaseDate || '';
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return compareCardNumbers(a.number, b.number);
  });
  setApiCache(cacheKey, allCards);
  return allCards;
}

function buildRarityBreakdown(cards) {
  const counts = new Map();
  for (const card of cards) {
    const rarity = card.rarity || 'Unknown';
    counts.set(rarity, (counts.get(rarity) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([rarity, count]) => ({
      rarity,
      count,
      isPromo: isPromoRarity(rarity),
      defaultSlots: DEFAULT_TWO_SLOT_RARITIES.has(rarity) ? 2 : 1,
    }))
    .sort((a, b) => b.count - a.count);
}

// Expands each card into 1 or 2 consecutive slots (2 = Normal + Reverse
// Holofoil) per the rarity rules, after dropping promo-rarity cards if asked.
function buildPlacements(cards, { excludePromos, rarityRules }) {
  const filtered = excludePromos ? cards.filter((c) => !isPromoRarity(c.rarity)) : cards;
  const placements = [];
  for (const card of filtered) {
    if (rarityRules[card.rarity] === 2) {
      placements.push({ card, variant: 'Normal' });
      placements.push({ card, variant: 'Reverse Holofoil' });
    } else {
      placements.push({ card, variant: null });
    }
  }
  return placements;
}

function rowToBinder(row) {
  return {
    id: row.id,
    name: row.name,
    sourceSetId: row.source_set_id,
    sourceSetName: row.source_set_name,
    sourcePokemonName: row.source_pokemon_name,
    isNationalDex: !!row.is_national_dex,
    pageCount: row.page_count,
    totalSlots: row.page_count * SLOTS_PER_PAGE,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// A slot counts as owned if you have that card at all when the slot has no
// specific planned variant, or — when it does (e.g. a rarity-rules-expanded
// "Reverse Holofoil" slot) — only if you own *that* variant. Otherwise adding
// just the Normal print would incorrectly light up the Reverse Holofoil slot
// of the same card too.
const countOwnedSlots = db.prepare(
  `SELECT COUNT(*) AS c FROM binder_slots bs
   WHERE bs.binder_id = ? AND EXISTS (
     SELECT 1 FROM collection_items ci
     WHERE ci.card_id = bs.card_id AND (bs.variant IS NULL OR ci.variant = bs.variant)
   )`
);

const ownedStmt = db.prepare(
  `SELECT 1 FROM collection_items WHERE card_id = ? AND (? IS NULL OR variant = ?) LIMIT 1`
);
const isSlotOwned = (cardId, variant) => !!ownedStmt.get(cardId, variant ?? null, variant ?? null);

const cardCacheStmt = db.prepare('SELECT data, fetched_at FROM card_cache WHERE id = ?');
// Prefer freshly-cached card data (which gets refreshed periodically / on
// "Refresh price") over the snapshot frozen at the moment a slot was filled,
// same as the collection page does — a binder built weeks ago shouldn't quote
// a price from weeks ago when a live one is available.
function latestCardData(cardId, fallbackSnapshot) {
  const cached = cardCacheStmt.get(cardId);
  if (!cached) return fallbackSnapshot;
  return { ...JSON.parse(cached.data), pricesUpdatedAt: cached.fetched_at };
}

// Estimated cost to finish a binder: sum of current market price across every
// *unowned* slot that has price data, plus how many slots couldn't be priced
// (so the UI can be honest that the total is a floor, not the whole picture).
function computeEstimate(binderId) {
  const slotRows = db.prepare('SELECT card_id, card_snapshot, variant FROM binder_slots WHERE binder_id = ?').all(binderId);
  let remainingCost = 0;
  let pricedRemaining = 0;
  let unpricedRemaining = 0;
  let ownedValue = 0;
  for (const s of slotRows) {
    const snapshot = s.card_snapshot ? JSON.parse(s.card_snapshot) : null;
    const card = latestCardData(s.card_id, snapshot);
    const price = cardMarketPrice(card, s.variant);
    const owned = isSlotOwned(s.card_id, s.variant);
    if (owned) {
      if (price) ownedValue += price.amount;
    } else if (price) {
      remainingCost += price.amount;
      pricedRemaining++;
    } else {
      unpricedRemaining++;
    }
  }
  return {
    remainingCost: +remainingCost.toFixed(2),
    pricedRemaining,
    unpricedRemaining,
    ownedValue: +ownedValue.toFixed(2),
  };
}

// GET /api/binders - list all binders with progress. filledSlots = slots that
// have a card *planned* for them (this binder's layout is that complete);
// ownedSlots = of those, how many you actually have in your collection —
// these are very different numbers and the UI must never conflate them.
router.get('/', (req, res) => {
  const binders = db.prepare('SELECT * FROM binders ORDER BY updated_at DESC').all();
  const result = binders.map((b) => {
    const filledSlots = db.prepare('SELECT COUNT(*) AS c FROM binder_slots WHERE binder_id = ?').get(b.id).c;
    const ownedSlots = countOwnedSlots.get(b.id).c;
    return { ...rowToBinder(b), filledSlots, ownedSlots, estimate: computeEstimate(b.id) };
  });
  res.json(result);
});

// GET /api/binders/set-preview?setId=X - rarity breakdown for a set, used by the
// New Binder modal to build the per-rarity slot-count checklist before creating.
router.get('/set-preview', async (req, res) => {
  const { setId } = req.query;
  if (!setId) return res.status(400).json({ error: 'setId is required' });
  try {
    const cards = await fetchAllCardsForSet(setId);
    if (cards.length === 0) return res.status(404).json({ error: `No cards found for set "${setId}"` });
    res.json({
      setId,
      setName: cards[0]?.set?.name || setId,
      totalCards: cards.length,
      rarities: buildRarityBreakdown(cards),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/binders/pokemon-preview?name=X - same idea as set-preview, but for
// every card of one Pokémon across every set.
router.get('/pokemon-preview', async (req, res) => {
  const { name } = req.query;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const cards = await fetchAllCardsForPokemon(name.trim());
    if (cards.length === 0) return res.status(404).json({ error: `No Pokémon cards found matching "${name}"` });
    res.json({
      pokemonName: name.trim(),
      totalCards: cards.length,
      setCount: new Set(cards.map((c) => c.set?.id)).size,
      rarities: buildRarityBreakdown(cards),
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /api/binders/national-dex - the full #1-1025 species list, in order. Fetched
// once by the frontend and used to label a "dex" binder's empty slots by position.
router.get('/national-dex', (req, res) => {
  res.json(NATIONAL_DEX);
});

// GET /api/binders/:id - full binder with every filled slot (+ whether you own that card)
router.get('/:id', (req, res) => {
  const binder = db.prepare('SELECT * FROM binders WHERE id = ?').get(req.params.id);
  if (!binder) return res.status(404).json({ error: 'Not found' });

  const slotRows = db.prepare('SELECT * FROM binder_slots WHERE binder_id = ?').all(req.params.id);
  const slots = slotRows.map((s) => {
    const snapshot = s.card_snapshot ? JSON.parse(s.card_snapshot) : null;
    const card = latestCardData(s.card_id, snapshot);
    return {
      position: s.position,
      cardId: s.card_id,
      card,
      variant: s.variant,
      notes: s.notes,
      owned: isSlotOwned(s.card_id, s.variant),
      currentPrice: cardMarketPrice(card, s.variant),
    };
  });

  res.json({ ...rowToBinder(binder), slots, estimate: computeEstimate(req.params.id) });
});

function insertSourcedBinder({ name, sourceSetId, sourceSetName, sourcePokemonName, placements }) {
  const neededPages = Math.max(1, Math.ceil(placements.length / SLOTS_PER_PAGE));
  const info = db
    .prepare(
      'INSERT INTO binders (name, source_set_id, source_set_name, source_pokemon_name, page_count) VALUES (?, ?, ?, ?, ?)'
    )
    .run(name, sourceSetId ?? null, sourceSetName ?? null, sourcePokemonName ?? null, neededPages);
  const binderId = info.lastInsertRowid;

  const insertSlot = db.prepare(
    'INSERT INTO binder_slots (binder_id, position, card_id, card_snapshot, variant) VALUES (?, ?, ?, ?, ?)'
  );
  db.transaction((items) => {
    items.forEach((item, i) => insertSlot.run(binderId, i, item.card.id, JSON.stringify(item.card), item.variant));
  })(placements);

  return binderId;
}

// POST /api/binders - create a binder.
// Manual: { name, mode: 'manual', pageCount? } — starts empty.
// From a set: { name, mode: 'set', setId, excludePromos?, rarityRules? }
// From a Pokémon: { name, mode: 'pokemon', pokemonName, excludePromos?, rarityRules? }
//   rarityRules: { [rarity]: 1 | 2 } — cards of that rarity get that many
//   consecutive slots (2 = Normal + Reverse Holofoil). Rarities not listed
//   default to 1. See GET /set-preview or /pokemon-preview for the rarity list.
router.post('/', async (req, res) => {
  const { name, mode, setId, pokemonName, pageCount, rarityRules = {} } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  if (mode === 'set' || mode === 'pokemon') {
    // Promo cards aren't "in" a numbered set (default: excluded), but they're
    // often exactly what a Pokémon-focused binder is chasing (default: included).
    const excludePromos = req.body.excludePromos ?? mode === 'set';
    try {
      let cards;
      let sourceSetId = null;
      let sourceSetName = null;
      let sourcePokemonName = null;

      if (mode === 'set') {
        if (!setId) return res.status(400).json({ error: 'setId is required when mode is "set"' });
        cards = await fetchAllCardsForSet(setId);
        if (cards.length === 0) return res.status(404).json({ error: `No cards found for set "${setId}"` });
        sourceSetId = setId;
        sourceSetName = cards[0]?.set?.name || setId;
      } else {
        if (!pokemonName || !pokemonName.trim()) return res.status(400).json({ error: 'pokemonName is required when mode is "pokemon"' });
        cards = await fetchAllCardsForPokemon(pokemonName.trim());
        if (cards.length === 0) return res.status(404).json({ error: `No Pokémon cards found matching "${pokemonName}"` });
        sourcePokemonName = pokemonName.trim();
      }

      const placements = buildPlacements(cards, { excludePromos, rarityRules });
      if (placements.length === 0) return res.status(400).json({ error: 'No cards left after excluding promos' });

      const binderId = insertSourcedBinder({ name: name.trim(), sourceSetId, sourceSetName, sourcePokemonName, placements });
      const binder = db.prepare('SELECT * FROM binders WHERE id = ?').get(binderId);
      res.status(201).json({ ...rowToBinder(binder), filledSlots: placements.length });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  } else if (mode === 'dex') {
    // Every slot is reserved for a National Dex number, but starts completely
    // empty — no cards inserted. Which actual card eventually fills #6 is up to
    // whatever Charizard print you happen to get; the label is computed from
    // the slot's position (see GET /national-dex), never stored per-slot.
    const pages = Math.ceil(NATIONAL_DEX.length / SLOTS_PER_PAGE);
    const info = db
      .prepare('INSERT INTO binders (name, page_count, is_national_dex) VALUES (?, ?, 1)')
      .run(name.trim(), pages);
    const binder = db.prepare('SELECT * FROM binders WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ ...rowToBinder(binder), filledSlots: 0 });
  } else {
    const pages = Number.isFinite(Number(pageCount)) && Number(pageCount) > 0 ? Math.floor(Number(pageCount)) : 4;
    const info = db.prepare('INSERT INTO binders (name, page_count) VALUES (?, ?)').run(name.trim(), pages);
    const binder = db.prepare('SELECT * FROM binders WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ ...rowToBinder(binder), filledSlots: 0 });
  }
});

// PATCH /api/binders/:id - rename and/or resize (grow/shrink page count)
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM binders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const updates = {};
  if (req.body.name !== undefined) {
    if (!req.body.name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
    updates.name = req.body.name.trim();
  }
  if (req.body.pageCount !== undefined) {
    const pages = Math.floor(Number(req.body.pageCount));
    if (!Number.isFinite(pages) || pages < 1) return res.status(400).json({ error: 'pageCount must be at least 1' });
    const maxFilled = db.prepare('SELECT MAX(position) AS m FROM binder_slots WHERE binder_id = ?').get(req.params.id).m;
    const minPagesNeeded = maxFilled != null ? Math.ceil((maxFilled + 1) / SLOTS_PER_PAGE) : 1;
    if (pages < minPagesNeeded) {
      return res.status(400).json({ error: `Can't shrink below ${minPagesNeeded} pages — a later page still has cards in it` });
    }
    updates.page_count = pages;
  }
  if (Object.keys(updates).length === 0) return res.json(rowToBinder(existing));

  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE binders SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({
    ...updates,
    id: req.params.id,
  });
  res.json(rowToBinder(db.prepare('SELECT * FROM binders WHERE id = ?').get(req.params.id)));
});

// DELETE /api/binders/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM binder_slots WHERE binder_id = ?').run(req.params.id);
  const info = db.prepare('DELETE FROM binders WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

// PUT /api/binders/:id/slots/:position - place or replace the card in one slot.
// body: { cardId, card, variant, notes }
router.put('/:id/slots/:position', (req, res) => {
  const binder = db.prepare('SELECT * FROM binders WHERE id = ?').get(req.params.id);
  if (!binder) return res.status(404).json({ error: 'Not found' });

  const position = Number.parseInt(req.params.position, 10);
  const totalSlots = binder.page_count * SLOTS_PER_PAGE;
  if (!Number.isInteger(position) || position < 0 || position >= totalSlots) {
    return res.status(400).json({ error: 'Invalid slot position' });
  }

  const { cardId, card, variant, notes } = req.body;
  if (!cardId) return res.status(400).json({ error: 'cardId is required' });

  db.prepare(
    `INSERT INTO binder_slots (binder_id, position, card_id, card_snapshot, variant, notes) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(binder_id, position) DO UPDATE SET
       card_id = excluded.card_id, card_snapshot = excluded.card_snapshot,
       variant = excluded.variant, notes = excluded.notes, added_at = datetime('now')`
  ).run(req.params.id, position, cardId, card ? JSON.stringify(card) : null, variant ?? null, notes ?? null);
  db.prepare("UPDATE binders SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  res.json({ position, cardId, card, variant: variant ?? null, notes: notes ?? null, owned: isSlotOwned(cardId, variant) });
});

// DELETE /api/binders/:id/slots/:position - clear a slot
router.delete('/:id/slots/:position', (req, res) => {
  const info = db
    .prepare('DELETE FROM binder_slots WHERE binder_id = ? AND position = ?')
    .run(req.params.id, req.params.position);
  db.prepare("UPDATE binders SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Slot was already empty' });
  res.status(204).end();
});

export default router;
