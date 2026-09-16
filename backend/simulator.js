import { randomInt } from 'node:crypto';
import { cardMarketPrice } from './pricing.js';
import { compareCardNumbers } from './cardNumbers.js';

// Era layouts are keyed by the set's pokemontcg.io series. Unlisted series
// (EX through XY, POP, promos, "Other" products) use the classic reverse-foil
// layout; these are gameplay approximations, not per-product collation claims.
const ERAS = {
  wotc: { trick: 3, cardsPerPack: 11 }, // 7 commons, rare, 3 uncommons — before reverse foils
  classic: { trick: 3, cardsPerPack: 10 }, // 5 commons, reverse foil, rare, 3 uncommons
  sm: { trick: 4, cardsPerPack: 11 }, // classic plus a Basic Energy before the uncommons
  sv: { trick: 1, cardsPerPack: 11 }, // 4 commons, 3 uncommons, two foil slots, rare, Basic Energy
};
// E-Card and Legendary Collection (base6) had reverse foils, so they take the
// classic layout. (base6's series is 'Other' in current provider data; the id
// special-case below is a safety net in case it is ever filed under Base.)
const SERIES_ERA = {
  Base: 'wotc', Gym: 'wotc', Neo: 'wotc',
  'Sun & Moon': 'sm', 'Sword & Shield': 'sm', 'Scarlet & Violet': 'sv', 'Mega Evolution': 'sv',
};
// Used only when the sets cache has never been populated (fresh install, offline).
export const FALLBACK_SETS = [
  { id: 'xy1', name: 'XY', series: 'XY' },
  { id: 'sm1', name: 'Sun & Moon', series: 'Sun & Moon' },
  { id: 'swsh1', name: 'Sword & Shield', series: 'Sword & Shield' },
  { id: 'sv1', name: 'Scarlet & Violet', series: 'Scarlet & Violet' },
];
export function packFromSet(set) {
  const era = set.id === 'base6' ? 'classic' : SERIES_ERA[set.series] || 'classic';
  return {
    id: set.id, name: set.name, series: set.series || 'Other', era, ...ERAS[era],
    releaseDate: set.releaseDate || null,
    total: Number.isSafeInteger(set.total) && set.total > 0 ? set.total : null,
    logo: set.images?.logo || null,
  };
}
export const MIN_PACK_PRICE_CENTS = 400;
// A pack costs 125% of its estimated resale value (rounded up to 25¢), floored
// at $4 — so ripping a pack and selling every pull averages a loss, whatever
// the set. A flat price made vintage and promo products print money: at $4,
// selling one simulated Pokémon Rumble pack returned ~$1,177 in credits.
export function packPriceCents(expectedSellCents) {
  return Math.max(MIN_PACK_PRICE_CENTS, Math.ceil((expectedSellCents * 1.25) / 25) * 25);
}
const ENERGY_TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
const VARIANTS = ['Normal', 'Holofoil', 'Reverse Holofoil'];
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function integer(n, min, max, label) {
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`Invalid ${label}`);
  return n;
}
export function poolsFor(cards) {
  const pools = { common: [], uncommon: [], rare: [], holo: [], illustration: [], hit: [], energy: [] };
  const bucket = { Common: 'common', Uncommon: 'uncommon', Rare: 'rare', 'Rare Holo': 'holo', 'Illustration Rare': 'illustration', 'Special Illustration Rare': 'illustration' };
  for (const c of cards) {
    if (c.supertype === 'Energy' && c.subtypes?.includes('Basic')) pools.energy.push(c);
    else pools[bucket[c.rarity] || 'hit'].push(c); // unknown and promo rarities count as hits
  }
  pools.reverse = [...pools.common, ...pools.uncommon, ...pools.rare, ...pools.holo];
  return pools;
}

// The effective pool behind each slot, after fallbacks. Products without a
// conventional pool (all-holo or promo-only sets) still open: each slot falls
// back to the nearest non-empty pool, never rejecting. This is the single
// source of truth for both drawing packs and pricing them.
function slotPools(cards) {
  const pools = poolsFor(cards);
  const nonEnergy = [...pools.reverse, ...pools.illustration, ...pools.hit];
  const backstop = nonEnergy.length ? nonEnergy : cards;
  const from = (...lists) => lists.find(list => list.length) || backstop;
  return {
    backstop,
    common: from(pools.common, pools.uncommon),
    uncommon: from(pools.uncommon, pools.common),
    reverse: from(pools.reverse),
    hit: from(pools.hit, pools.holo, pools.illustration, pools.rare),
    holo: from(pools.holo, pools.hit, pools.rare),
    rare: from(pools.rare, pools.holo, pools.hit),
    illustration: from(pools.illustration, pools.hit, pools.holo),
    energy: pools.energy,
    special: !cards.some(c => ['Common', 'Uncommon', 'Rare', 'Rare Holo'].includes(c.rarity)),
  };
}

// These are deliberately gameplay odds, not measured factory pull rates.
export function makePack(cards, pack, random = n => randomInt(n)) {
  const slots = slotPools(cards);
  if (!slots.backstop.length) fail('Set has no cards to open; prepare it again', 409);
  const pick = pool => pool[random(pool.length)];
  const entry = (card, variant, slot) => ({ cardId: card.id, card, variant, slot });
  const draw = (pool, variant, slot) => entry(pick(pool), variant, slot);
  const commons = count => Array.from({ length: count }, () => draw(slots.common, 'Normal', 'Common'));
  const uncommons = () => Array.from({ length: 3 }, () => draw(slots.uncommon, 'Normal', 'Uncommon'));
  const reverse = () => draw(slots.reverse, 'Reverse Holofoil', 'Reverse foil');
  const roll = random(100);
  const rare = roll < 20 ? draw(slots.hit, 'Holofoil', 'Rare or higher')
    : pack.era === 'sv' ? draw(slots.rare, 'Holofoil', 'Rare or higher')
      : roll < 45 ? draw(slots.holo, 'Holofoil', 'Rare or higher') : draw(slots.rare, 'Normal', 'Rare or higher');
  // Real Basic Energy printed in this set when it has any; otherwise a clearly
  // labeled simulator placeholder that never claims a set print or a price.
  const energy = () => {
    if (slots.energy.length) return draw(slots.energy, 'Normal', 'Basic Energy');
    const energyType = ENERGY_TYPES[random(ENERGY_TYPES.length)];
    return entry({ id: `sim-energy-${energyType.toLowerCase()}`, name: `Basic ${energyType} Energy`, supertype: 'Energy', rarity: 'Basic Energy', set: { name: 'Simulator energy' } }, 'Normal', 'Basic Energy');
  };
  if (pack.era === 'sv') {
    const secondFoil = random(100) < 10 ? draw(slots.illustration, 'Holofoil', 'Illustration slot') : reverse();
    return [...commons(4), ...uncommons(), reverse(), secondFoil, rare, energy()];
  }
  if (pack.era === 'wotc') return [...commons(7), rare, ...uncommons()];
  // In face-up reveal order, the tail moves intact to the front for the trick.
  return [...commons(5), reverse(), rare, ...(pack.era === 'sm' ? [energy()] : []), ...uncommons()];
}

// Exact expected resale value of one pack: every slot draws uniformly from its
// slotPools entry, so the expectation is the probability-weighted sum of pool
// means — no sampling. Must mirror makePack's layouts and roll thresholds
// (the "pack layouts match their exact expected value" test pins the two together).
export function expectedSellCents(cards, pack) {
  return evFromSlots(slotPools(cards), pack);
}
function evFromSlots(slots, pack) {
  if (!slots.backstop.length) return 0;
  const mean = (pool, variant) => pool.length ? pool.reduce((sum, c) => sum + (quote(c, variant)?.sellCents || 0), 0) / pool.length : 0;
  const rare = 0.20 * mean(slots.hit, 'Holofoil') + (pack.era === 'sv'
    ? 0.80 * mean(slots.rare, 'Holofoil')
    : 0.25 * mean(slots.holo, 'Holofoil') + 0.55 * mean(slots.rare, 'Normal'));
  const energy = mean(slots.energy, 'Normal'); // 0 for the unquoted placeholder
  const common = mean(slots.common, 'Normal');
  const uncommon = mean(slots.uncommon, 'Normal');
  const reverse = mean(slots.reverse, 'Reverse Holofoil');
  if (pack.era === 'sv') {
    const secondFoil = 0.10 * mean(slots.illustration, 'Holofoil') + 0.90 * reverse;
    return 4 * common + 3 * uncommon + reverse + secondFoil + rare + energy;
  }
  if (pack.era === 'wotc') return 7 * common + rare + 3 * uncommon;
  return 5 * common + reverse + rare + (pack.era === 'sm' ? energy : 0) + 3 * uncommon;
}

// Whether a catalog is too far short of the set's declared card count (secret
// rares included). Shared by prepare() and the route's local-vs-provider choice
// so they can never disagree. Proportional: the provider's declared totals
// drift slightly from its own card data (e.g. sv1 declares 258, serves 257).
export function catalogShortfall(total, count) {
  return !!total && total - count > Math.max(2, Math.floor(total * 0.02));
}

// A TCGdex fallback price belongs to one specific print — the first price
// bucket TCGdex exposes, recorded in priceFallback.variant — so the market
// lists and sells such a card as that print. Cardmarket trend (and anything
// unlabeled) is card-level and defaults to Normal.
export function fallbackPrintVariant(card) {
  return { holofoil: 'Holofoil', 'reverse-holofoil': 'Reverse Holofoil' }[card?.priceFallback?.variant] || 'Normal';
}
// Whether this exact print can be BOUGHT in the singles market: a non-null
// quote from TCGplayer is print-specific, while a fallback quote only sells as
// its listed print. The single source of truth for trade(), market(),
// inventory buy buttons, and binder completion estimates.
export function buyablePrint(card, variant, q = quote(card, variant)) {
  return !!q && (q.source === 'TCGplayer' || variant === fallbackPrintVariant(card));
}
// The print a card most plausibly exists as, used to price binder slots whose
// planned variant is null ("any print counts"). Prefers real TCGplayer
// buckets, then the fallback's own print.
export function preferredPrintVariant(card) {
  const buckets = card?.tcgplayer?.prices;
  if (buckets) return buckets.holofoil ? 'Holofoil' : buckets.normal ? 'Normal' : buckets.reverseHolofoil ? 'Reverse Holofoil' : fallbackPrintVariant(card);
  return fallbackPrintVariant(card);
}
// What binder slots and their snapshots actually need — shipping/storing the
// full card object (attacks, legalities, price blobs) made a 500-slot binder
// weigh ~1 MB per read.
export function slimCard(card) {
  return {
    id: card.id, name: card.name, number: card.number, supertype: card.supertype, rarity: card.rarity,
    ...(card.images?.small ? { images: { small: card.images.small } } : {}),
    ...(card.set ? { set: { id: card.set.id, name: card.set.name } } : {}),
  };
}
export function quote(card, variant) {
  if (!VARIANTS.includes(variant)) return null; // never let pricing.js's "any bucket" browsing branch price a trade
  // Same price resolution as the collection (cardMarketPrice): print-specific
  // TCGplayer first; when TCGplayer knows the card but not this print, the
  // print doesn't exist and nothing is quoted; when TCGplayer has no data at
  // all, Cardmarket and then the TCGdex fallback price step in. Credits are
  // currency-agnostic — EUR-sourced amounts count 1:1, exactly like the
  // collection's total value does.
  const price = cardMarketPrice(card, variant);
  if (!price || !Number.isFinite(price.amount) || price.amount <= 0) return null;
  const marketCents = Math.round(price.amount * 100);
  if (!Number.isSafeInteger(marketCents) || marketCents < 1 || marketCents > 100000000) return null;
  return { marketCents, buyCents: Math.ceil(marketCents * 110 / 100), sellCents: Math.floor(marketCents * 90 / 100), source: price.source };
}

export function createSimulator(db, { now = () => new Date(), random = n => randomInt(n) } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sim_wallet (id INTEGER PRIMARY KEY CHECK(id=1), cents INTEGER NOT NULL CHECK(cents>=0), opened INTEGER NOT NULL DEFAULT 0, daily TEXT);
    INSERT OR IGNORE INTO sim_wallet(id,cents) VALUES(1,2500);
    CREATE TABLE IF NOT EXISTS sim_items (id INTEGER PRIMARY KEY, card_id TEXT NOT NULL, variant TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>=0), snapshot TEXT NOT NULL, UNIQUE(card_id,variant));
    CREATE TABLE IF NOT EXISTS sim_packs (id INTEGER PRIMARY KEY, set_id TEXT NOT NULL, source TEXT NOT NULL, opening TEXT, revealed INTEGER NOT NULL DEFAULT 0, tricked INTEGER NOT NULL DEFAULT 0, opened_number INTEGER);
    CREATE TABLE IF NOT EXISTS sim_catalog (set_id TEXT PRIMARY KEY, ids TEXT NOT NULL, prepared_at TEXT NOT NULL, price_cents INTEGER, special INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sim_requests (key TEXT PRIMARY KEY, operation TEXT NOT NULL, result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sim_ledger (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, cents INTEGER NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sim_binders (id INTEGER PRIMARY KEY, name TEXT NOT NULL, pages INTEGER NOT NULL CHECK(pages BETWEEN 1 AND 50), set_id TEXT, set_name TEXT);
    CREATE TABLE IF NOT EXISTS sim_slots (binder_id INTEGER NOT NULL, position INTEGER NOT NULL, card_id TEXT NOT NULL, variant TEXT, snapshot TEXT NOT NULL, PRIMARY KEY(binder_id,position));
    CREATE TABLE IF NOT EXISTS api_cache (cache_key TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  // sim_catalog gained persisted pack economics and sim_binders gained master-
  // set labels after the first release; add the columns in place on existing
  // databases (a no-op once present).
  for (const ddl of ['ALTER TABLE sim_catalog ADD COLUMN price_cents INTEGER', 'ALTER TABLE sim_catalog ADD COLUMN special INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE sim_binders ADD COLUMN set_id TEXT', 'ALTER TABLE sim_binders ADD COLUMN set_name TEXT']) {
    try { db.exec(ddl); } catch { /* already migrated */ }
  }
  // Binder slots used to reference owned sim_items rows; they are now plans
  // holding (card, variant) directly, owned or not. Rebuild a legacy table in
  // place, resolving each item reference to the card it pointed at.
  if (db.prepare("SELECT 1 FROM pragma_table_info('sim_slots') WHERE name='item_id'").get()) {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS sim_slots_migrated;
        CREATE TABLE sim_slots_migrated (binder_id INTEGER NOT NULL, position INTEGER NOT NULL, card_id TEXT NOT NULL, variant TEXT, snapshot TEXT NOT NULL, PRIMARY KEY(binder_id,position));
        INSERT INTO sim_slots_migrated SELECT s.binder_id, s.position, i.card_id, i.variant, i.snapshot FROM sim_slots s JOIN sim_items i ON i.id = s.item_id;
      `);
      // Sells only ever decrement quantity, so every slot's item row should
      // exist; if one ever doesn't, that slot is an unrepresentable plan —
      // dropping it is deliberate, but never silent.
      const before = db.prepare('SELECT COUNT(*) n FROM sim_slots').get().n;
      const after = db.prepare('SELECT COUNT(*) n FROM sim_slots_migrated').get().n;
      if (after !== before) console.warn(`sim_slots migration dropped ${before - after} slot(s) whose inventory row was missing`);
      db.exec('DROP TABLE sim_slots; ALTER TABLE sim_slots_migrated RENAME TO sim_slots;');
    })();
  }
  // Every set from the shared sets cache is an openable pack. Reparse only when
  // the cache row changes; state() runs after every mutation.
  let packsMemo = {};
  function packs() {
    // Timestamp-only probe on the hot path; the blob is read and parsed only
    // when another process (sets route, sync script) has rewritten the row.
    const stamp = db.prepare("SELECT fetched_at FROM api_cache WHERE cache_key='sets'").get()?.fetched_at ?? 'fallback';
    if (packsMemo.stamp !== stamp) {
      let sets = null;
      try { sets = JSON.parse(db.prepare("SELECT data FROM api_cache WHERE cache_key='sets'").get()?.data ?? 'null'); } catch { /* degrade to fallback */ }
      // A malformed row degrades to the fallback sets instead of 500ing every
      // endpoint; entries missing an id or name are dropped, not crashed on.
      const valid = Array.isArray(sets) ? sets.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string') : [];
      packsMemo = { stamp, list: (valid.length ? valid : FALLBACK_SETS).map(packFromSet) };
    }
    return packsMemo.list;
  }
  function packDefinition(id) { return packs().find(p => p.id === id) || fail('Unsupported pack'); }
  // Pack economics (exact expected resale value -> price, and the special-
  // product flag) are computed at prepare time and PERSISTED on sim_catalog,
  // so state() never re-parses catalogs and a restart cannot move a price —
  // only re-preparing (the shop's "Refresh price") re-derives it. Rows written
  // before persistence existed (price_cents NULL) backfill once on first read.
  const NOT_READY = { ready: false, priceCents: null, special: false };
  function economics(pack) {
    const row = db.prepare('SELECT price_cents, special FROM sim_catalog WHERE set_id=?').get(pack.id);
    if (!row) return NOT_READY;
    if (row.price_cents == null) return backfillEconomics(pack);
    return { ready: true, priceCents: row.price_cents, special: !!row.special };
  }
  function backfillEconomics(pack) {
    try {
      const slots = slotPools(catalog(pack.id));
      const priceCents = packPriceCents(evFromSlots(slots, pack));
      db.prepare('UPDATE sim_catalog SET price_cents=?, special=? WHERE set_id=?').run(priceCents, slots.special ? 1 : 0, pack.id);
      return { ready: true, priceCents, special: slots.special };
    } catch {
      return NOT_READY; // broken catalog: require re-prepare
    }
  }
  const ledger = (kind, cents, detail) => db.prepare('INSERT INTO sim_ledger(kind,cents,detail,created_at) VALUES(?,?,?,?)').run(kind, cents, detail, now().toISOString());
  const wallet = () => db.prepare('SELECT * FROM sim_wallet WHERE id=1').get();
  function adjust(cents) {
    const balance = wallet().cents + cents;
    if (!Number.isSafeInteger(balance) || balance < 0) fail('Not enough virtual funds', 409);
    db.prepare('UPDATE sim_wallet SET cents=? WHERE id=1').run(balance);
  }
  function atomic(key, operation, action) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(key)) fail('A valid request ID is required');
    return db.transaction(() => {
      const saved = db.prepare('SELECT * FROM sim_requests WHERE key=?').get(key);
      if (saved) {
        if (saved.operation !== operation) fail('Request ID already used for a different action', 409);
        return JSON.parse(saved.result);
      }
      const result = action();
      db.prepare('INSERT INTO sim_requests VALUES(?,?,?)').run(key, operation, JSON.stringify(result));
      return result;
    })();
  }
  function cardFor(row) {
    const cached = db.prepare('SELECT data FROM card_cache WHERE id=?').get(row.card_id);
    return cached ? JSON.parse(cached.data) : JSON.parse(row.snapshot);
  }
  function addItem(entry) {
    db.prepare(`INSERT INTO sim_items(card_id,variant,quantity,snapshot) VALUES(?,?,1,?)
      ON CONFLICT(card_id,variant) DO UPDATE SET quantity=quantity+1, snapshot=excluded.snapshot`).run(entry.cardId, entry.variant, JSON.stringify(entry.card));
  }
  function catalog(setId) {
    packDefinition(setId);
    const saved = db.prepare('SELECT ids FROM sim_catalog WHERE set_id=?').get(setId);
    if (!saved) fail('Prepare this set before buying packs', 409);
    const ids = JSON.parse(saved.ids);
    const get = db.prepare('SELECT data FROM card_cache WHERE id=?');
    return ids.map(id => { const row = get.get(id); if (!row) fail('Catalog is incomplete; prepare the set again', 409); return JSON.parse(row.data); });
  }
  function prepare(setId, cards, totalCount) {
    const pack = packDefinition(setId);
    if (!Number.isSafeInteger(totalCount) || totalCount < 1 || cards.length !== totalCount || new Set(cards.map(c => c.id)).size !== totalCount || cards.some(c => c.set?.id !== setId)) fail('Incomplete set catalog; no packs were purchased', 409);
    // A catalog much shorter than the set's declared card count means a
    // truncated fetch or a set released after the last full local sync.
    if (catalogShortfall(pack.total, totalCount)) {
      fail(`Incomplete set catalog (${totalCount} of ${pack.total} cards); no packs were purchased`, 409);
    }
    const slots = slotPools(cards);
    db.prepare('INSERT OR REPLACE INTO sim_catalog(set_id,ids,prepared_at,price_cents,special) VALUES(?,?,?,?,?)')
      .run(setId, JSON.stringify(cards.map(c => c.id)), now().toISOString(), packPriceCents(evFromSlots(slots, pack)), slots.special ? 1 : 0);
    return { setId, count: totalCount };
  }
  function packView(row) {
    const result = { id: row.id, setId: row.set_id, source: row.source, revealed: row.revealed, tricked: !!row.tricked, opened: !!row.opening };
    if (row.opening) {
      let entries = JSON.parse(row.opening);
      // Tolerate a set missing from a refreshed sets cache: show untricked order
      // for that opening rather than making every state() read fail.
      const n = row.tricked ? packs().find(p => p.id === row.set_id)?.trick ?? 0 : 0;
      if (n) entries = [...entries.slice(-n), ...entries.slice(0, -n)];
      result.cards = entries;
    }
    return result;
  }
  function state() {
    const w = wallet();
    const items = db.prepare('SELECT * FROM sim_items WHERE quantity>0 ORDER BY id DESC').all().map(row => {
      const card = cardFor(row);
      const q = quote(card, row.variant);
      // Foil pulls of fallback-priced cards sell at the card's quote but can
      // only be re-BOUGHT as the market's listed print — tell the UI so it
      // doesn't offer a buy the trade gate would always refuse.
      return { id: row.id, cardId: row.card_id, variant: row.variant, quantity: row.quantity, card, quote: q, buyable: buyablePrint(card, row.variant, q) };
    });
    const sellValueCents = items.reduce((sum, i) => sum + (i.quote?.sellCents || 0) * i.quantity, 0);
    const packCounts = db.prepare('SELECT set_id, COUNT(*) AS count FROM sim_packs WHERE opening IS NULL GROUP BY set_id').all();
    const catalogRows = new Map(db.prepare('SELECT set_id, price_cents, special FROM sim_catalog').all().map(r => [r.set_id, r]));
    const last = db.prepare('SELECT * FROM sim_packs WHERE opening IS NOT NULL ORDER BY opened_number DESC LIMIT 1').get();
    return {
      balanceCents: w.cents, opened: w.opened, dailyAvailable: w.daily !== now().toISOString().slice(0, 10),
      sellValueCents, bankValueCents: w.cents + sellValueCents,
      unpricedCards: items.reduce((n, i) => n + (i.quote ? 0 : i.quantity), 0), items,
      packs: packs().map(p => {
        const row = catalogRows.get(p.id);
        const eco = !row ? NOT_READY
          : row.price_cents == null ? economics(p) // pre-persistence row: backfills once
            : { ready: true, priceCents: row.price_cents, special: !!row.special };
        return { ...p, ...eco, count: packCounts.find(r => r.set_id === p.id)?.count || 0 };
      }),
      lastOpening: last ? packView(last) : null,
      binders: db.prepare(`
        SELECT b.id, b.name, b.pages, b.set_name AS setName,
          (SELECT COUNT(*) FROM sim_slots s WHERE s.binder_id=b.id) AS planned,
          (SELECT COUNT(*) FROM sim_slots s WHERE s.binder_id=b.id
             AND EXISTS(SELECT 1 FROM sim_items i WHERE i.card_id=s.card_id AND (s.variant IS NULL OR i.variant=s.variant) AND i.quantity>0)) AS owned
        FROM sim_binders b ORDER BY b.id DESC`).all(),
      ledger: db.prepare('SELECT * FROM sim_ledger ORDER BY id DESC LIMIT 30').all(),
    };
  }
  function purchase(setId, expectedCents, key) {
    integer(expectedCents, 0, 110000000, 'pack price');
    return atomic(key, `pack:${setId}:${expectedCents}`, () => {
      const pack = packDefinition(setId);
      const eco = economics(pack);
      if (!eco.ready) fail('Prepare this set before buying packs', 409);
      // Like trades, the client buys at a quoted price; a re-prepared catalog
      // can change it, so verify instead of silently charging something else.
      if (expectedCents !== eco.priceCents) fail('Pack price changed; refresh the shop before buying', 409);
      adjust(-eco.priceCents);
      const result = db.prepare("INSERT INTO sim_packs(set_id,source) VALUES(?,'Purchased')").run(setId);
      ledger('pack', -eco.priceCents, pack.name);
      return { id: Number(result.lastInsertRowid) };
    });
  }
  // Admin-only testing tool (enforced at the route): adjust the shared bank by
  // any amount, recorded in the ledger so granted credits are never invisible.
  function grant(cents, key, grantedBy) {
    integer(cents, -100000000, 100000000, 'credit amount');
    if (cents === 0) fail('Credit amount cannot be zero');
    if (typeof grantedBy !== 'string' || !grantedBy) fail('Granting admin is required');
    return atomic(key, `credits:${cents}`, () => {
      adjust(cents); // still refuses to take the balance below zero
      // The ledger is the bank's only audit trail — name the admin.
      ledger('admin', cents, `Testing credits adjusted by ${grantedBy}`);
      return { cents, balanceCents: wallet().cents };
    });
  }
  function daily(key) {
    return atomic(key, 'daily', () => {
      const date = now().toISOString().slice(0, 10);
      if (wallet().daily === date) fail('Daily allowance already claimed; resets at midnight UTC', 409);
      adjust(500); db.prepare('UPDATE sim_wallet SET daily=? WHERE id=1').run(date);
      ledger('reward', 500, 'Daily allowance'); return { awardedCents: 500 };
    });
  }
  function open(setId, key) {
    return atomic(key, `open:${setId}`, () => {
      const unfinished = db.prepare('SELECT * FROM sim_packs WHERE opening IS NOT NULL AND revealed < json_array_length(opening) LIMIT 1').get();
      if (unfinished) fail('Finish revealing your current pack first', 409);
      const row = db.prepare('SELECT * FROM sim_packs WHERE set_id=? AND opening IS NULL ORDER BY id LIMIT 1').get(setId);
      if (!row) fail('Buy a pack first', 409);
      const pack = packDefinition(setId);
      const entries = makePack(catalog(setId), pack, random);
      entries.forEach(addItem);
      db.prepare('UPDATE sim_packs SET opening=?, opened_number=? WHERE id=?').run(JSON.stringify(entries), wallet().opened + 1, row.id);
      db.prepare('UPDATE sim_wallet SET opened=opened+1 WHERE id=1').run();
      const milestone = wallet().opened % 10 === 0;
      if (milestone) { db.prepare("INSERT INTO sim_packs(set_id,source) VALUES(?,'Milestone reward')").run(setId); ledger('reward', 0, `Ten-pack milestone: free ${pack.name} pack`); }
      ledger('open', 0, pack.name);
      return { id: row.id, milestone };
    });
  }
  function reveal(id, count, trick) {
    integer(id, 1, Number.MAX_SAFE_INTEGER, 'pack ID');
    return db.transaction(() => {
      const row = db.prepare('SELECT * FROM sim_packs WHERE id=?').get(id);
      if (!row?.opening) fail('Opened pack not found', 404);
      const length = JSON.parse(row.opening).length;
      if (trick) {
        if (row.revealed) fail('Use the pack trick before revealing cards', 409);
        db.prepare('UPDATE sim_packs SET tricked=1 WHERE id=?').run(id);
      } else {
        integer(count, row.revealed, length, 'reveal count');
        db.prepare('UPDATE sim_packs SET revealed=? WHERE id=?').run(count, id);
      }
      return packView(db.prepare('SELECT * FROM sim_packs WHERE id=?').get(id));
    })();
  }
  function trade({ cardId, variant, side, expectedCents, key }) {
    if (typeof cardId !== 'string' || !VARIANTS.includes(variant) || !['buy', 'sell'].includes(side)) fail('Invalid trade');
    integer(expectedCents, 0, 110000000, 'quote');
    return atomic(key, `${side}:${cardId}:${variant}:${expectedCents}`, () => {
      const row = db.prepare('SELECT * FROM sim_items WHERE card_id=? AND variant=?').get(cardId, variant);
      const cached = db.prepare('SELECT data FROM card_cache WHERE id=?').get(cardId);
      const card = cached ? JSON.parse(cached.data) : row ? JSON.parse(row.snapshot) : null;
      const price = quote(card, variant);
      if (!price) fail('No price found for this print; trading is unavailable', 409);
      // Buys are limited to the print the market lists (see market() above);
      // sells stay unrestricted so foil pulls from fallback-priced packs can
      // always be sold at the same card-level quote that priced the pack.
      if (side === 'buy' && !buyablePrint(card, variant, price)) {
        fail(`This print cannot be bought; the Singles market lists this card as ${fallbackPrintVariant(card)}`, 409);
      }
      const cents = side === 'buy' ? price.buyCents : price.sellCents;
      if (cents !== expectedCents) fail('Price changed; refresh the quote before trading', 409);
      if (side === 'sell' && (!row || row.quantity < 1)) fail('You do not own this virtual card', 409);
      adjust(side === 'buy' ? -cents : cents);
      if (side === 'buy') addItem({ cardId, card, variant });
      else db.prepare('UPDATE sim_items SET quantity=quantity-1 WHERE id=?').run(row.id);
      ledger(side, side === 'buy' ? -cents : cents, `${card.name} · ${variant}`);
      return { cents, side };
    });
  }
  function market({ name = '', set = '', page = 1 } = {}) {
    if (typeof name !== 'string' || name.length > 100 || typeof set !== 'string') fail('Invalid search');
    integer(page, 1, 10000, 'page');
    const where = "WHERE (?='' OR instr(lower(name),lower(?))>0) AND (?='' OR set_id=?)";
    const params = [name.trim(), name.trim(), set, set];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM card_cache ${where}`).get(...params).n;
    const rows = db.prepare(`SELECT data FROM card_cache ${where} ORDER BY name,id LIMIT 24 OFFSET ?`).all(...params, (page - 1) * 24);
    return {
      total, page,
      cards: rows.map(r => {
        const card = JSON.parse(r.data);
        // A non-TCGplayer quote is the same number for every variant — list
        // such a card once, as the print its fallback actually priced (i.e.
        // exactly the prints the trade gate will accept a buy for).
        const variants = VARIANTS.map(variant => ({ variant, quote: quote(card, variant) }))
          .filter(v => buyablePrint(card, v.variant, v.quote));
        return { card, variants };
      }),
    };
  }
  function createBinder({ name, pages, setId, key }) {
    if (setId !== undefined) return createMasterSetBinder({ name, setId, key });
    if (typeof name !== 'string' || !name.trim() || name.length > 80) fail('Name must be 1–80 characters');
    integer(pages, 1, 50, 'page count');
    return atomic(key, `binder:${name.trim()}:${pages}`, () => ({ id: Number(db.prepare('INSERT INTO sim_binders(name,pages) VALUES(?,?)').run(name.trim(), pages).lastInsertRowid) }));
  }
  // Prebuilt "master set" plan, mirroring the real binder page's set auto-fill
  // AND its ownership rule: every card of a prepared set in printed-number
  // order. Common/Uncommon/Rare expand to an exact base + Reverse Holofoil
  // pair (the base print is Holofoil in the Scarlet & Violet era, Normal
  // before it) — except in the WotC era, which had no reverse foils, where
  // they get a single slot. Every single slot stores variant NULL, meaning
  // ANY print of that card fills it — the same rule routes/binders.js uses —
  // so pack pulls light the plan up regardless of which foil the slot machine
  // dealt.
  function createMasterSetBinder({ name, setId, key }) {
    const pack = packDefinition(setId);
    const binderName = typeof name === 'string' && name.trim() ? name.trim() : `${pack.name} master set`;
    if (binderName.length > 80) fail('Name must be 1–80 characters');
    return atomic(key, `binder:${binderName}:${setId}`, () => {
      const existing = db.prepare('SELECT id, name FROM sim_binders WHERE set_id=?').get(setId);
      if (existing) fail(`"${existing.name}" is already this set's master binder; delete it first to rebuild`, 409);
      const cards = [...catalog(setId)].sort((a, b) => compareCardNumbers(a.number, b.number));
      // Sets with no foil pool at all (POP-style C/U/R-only products) get no
      // exact pairs either: their rare slot falls back to the rare pool but
      // still deals ~45% of packs a Holofoil print, which an exact pair could
      // never accept — any-print slots absorb whatever the pack machine stamps.
      const pools = poolsFor(cards);
      const hasFoilPool = pools.hit.length + pools.holo.length + pools.illustration.length > 0;
      const pairBase = rarity => (pack.era === 'sv' && rarity === 'Rare' ? 'Holofoil' : 'Normal');
      const placements = [];
      for (const card of cards) {
        const isEnergy = card.supertype === 'Energy' && card.subtypes?.includes('Basic');
        if (!isEnergy && pack.era !== 'wotc' && hasFoilPool && ['Common', 'Uncommon', 'Rare'].includes(card.rarity)) {
          placements.push({ card, variant: pairBase(card.rarity) }, { card, variant: 'Reverse Holofoil' });
        } else {
          placements.push({ card, variant: null }); // any print of this card counts
        }
      }
      const pages = Math.ceil(placements.length / 18);
      if (pages > 50) fail('This master set needs more than 50 pages');
      const id = Number(db.prepare('INSERT INTO sim_binders(name,pages,set_id,set_name) VALUES(?,?,?,?)').run(binderName, pages, setId, pack.name).lastInsertRowid);
      const insert = db.prepare('INSERT INTO sim_slots(binder_id,position,card_id,variant,snapshot) VALUES(?,?,?,?,?)');
      placements.forEach((p, i) => insert.run(id, i, p.card.id, p.variant, JSON.stringify(slimCard(p.card))));
      return { id, slots: placements.length, pages };
    });
  }
  function binder(id) {
    integer(id, 1, Number.MAX_SAFE_INTEGER, 'binder ID');
    const b = db.prepare('SELECT * FROM sim_binders WHERE id=?').get(id);
    if (!b) fail('Virtual binder not found', 404);
    // variant NULL = "any print of this card fills the slot", exactly like
    // the real binder page's isSlotOwned; pairs demand the exact print.
    const ownedStmt = db.prepare('SELECT 1 FROM sim_items WHERE card_id=? AND (? IS NULL OR variant=?) AND quantity>0');
    const cached = db.prepare('SELECT data FROM card_cache WHERE id=?');
    const slots = db.prepare('SELECT * FROM sim_slots WHERE binder_id=? ORDER BY position').all(id).map(row => {
      const full = JSON.parse(cached.get(row.card_id)?.data ?? row.snapshot);
      const priceVariant = row.variant ?? preferredPrintVariant(full);
      const q = quote(full, priceVariant);
      return {
        position: row.position, cardId: row.card_id, variant: row.variant, card: slimCard(full),
        owned: !!ownedStmt.get(row.card_id, row.variant, row.variant),
        quote: q, buyable: buyablePrint(full, priceVariant, q),
      };
    });
    // Same shape as the real binder page's estimate, in credits: what the
    // unowned slots would cost to buy now (only prints the market will
    // actually sell), and what the owned ones sell for.
    let remainingCents = 0, pricedRemaining = 0, unpricedRemaining = 0, ownedValueCents = 0, ownedCount = 0;
    for (const s of slots) {
      if (s.owned) { ownedCount++; ownedValueCents += s.quote?.sellCents || 0; }
      else if (s.buyable) { remainingCents += s.quote.buyCents; pricedRemaining++; }
      else unpricedRemaining++;
    }
    return {
      id: b.id, name: b.name, pages: b.pages, setId: b.set_id, setName: b.set_name,
      totalSlots: b.pages * 18, slots, plannedCount: slots.length, ownedCount,
      estimate: { remainingCents, pricedRemaining, unpricedRemaining, ownedValueCents },
    };
  }
  function place(id, position, placement) {
    integer(id, 1, Number.MAX_SAFE_INTEGER, 'binder ID');
    return db.transaction(() => {
      const b = db.prepare('SELECT pages FROM sim_binders WHERE id=?').get(id);
      if (!b) fail('Virtual binder not found', 404);
      integer(position, 0, b.pages * 18 - 1, 'slot');
      if (!placement) db.prepare('DELETE FROM sim_slots WHERE binder_id=? AND position=?').run(id, position);
      else {
        const { cardId, variant = null } = placement;
        if (typeof cardId !== 'string' || !cardId || (variant !== null && !VARIANTS.includes(variant))) fail('Invalid placement');
        // Slots are plans: any locally known card can be placed, owned or not.
        const source = db.prepare('SELECT data FROM card_cache WHERE id=?').get(cardId)?.data
          ?? db.prepare('SELECT snapshot FROM sim_items WHERE card_id=? AND (? IS NULL OR variant=?)').get(cardId, variant, variant)?.snapshot;
        if (!source) fail('Card not found in the local card library', 404);
        db.prepare('INSERT OR REPLACE INTO sim_slots VALUES(?,?,?,?,?)').run(id, position, cardId, variant, JSON.stringify(slimCard(JSON.parse(source))));
      }
      return binder(id);
    })();
  }
  function deleteBinder(id) {
    return db.transaction(() => { binder(id); db.prepare('DELETE FROM sim_slots WHERE binder_id=?').run(id); db.prepare('DELETE FROM sim_binders WHERE id=?').run(id); return { deleted: id }; })();
  }
  return { packs, state, prepare, purchase, daily, grant, open, reveal, trade, market, createBinder, binder, place, deleteBinder };
}
