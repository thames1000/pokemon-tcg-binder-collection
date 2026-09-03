import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { bestGuessPrice } from './pricing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'collection.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS collection_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    condition TEXT NOT NULL DEFAULT 'Near Mint',
    variant TEXT NOT NULL DEFAULT 'Normal',
    acquired_price REAL,
    notes TEXT,
    card_snapshot TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_collection_card_id ON collection_items(card_id);

  CREATE TABLE IF NOT EXISTS card_cache (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Generic response cache for endpoints like /sets and /search that don't have a
  -- natural per-row cache. Lets us serve a slightly-stale (or even old) response
  -- instead of an error when the upstream pokemontcg.io API is unreachable/rate-limited.
  CREATE TABLE IF NOT EXISTS api_cache (
    cache_key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per calendar day, upserted whenever collection totals are computed
  -- (i.e. whenever the app is used) — this is how the value-over-time chart
  -- builds a history with no separate cron job.
  CREATE TABLE IF NOT EXISTS value_snapshots (
    date TEXT PRIMARY KEY,
    total_value REAL NOT NULL,
    total_cards INTEGER NOT NULL,
    unique_cards INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Cards you don't own yet but are tracking. target_price is optional — when set,
  -- the item is flagged in the UI once the current market price drops to or below it.
  CREATE TABLE IF NOT EXISTS wishlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    target_price REAL,
    notes TEXT,
    card_snapshot TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_wishlist_card_id ON wishlist_items(card_id);

  -- A planned physical binder: pageCount pages, each page = a front side + a back
  -- side of a 3x3 (9-pocket) sheet, so 18 slots per page. sourceSetId/sourceSetName
  -- are set when auto-filled from a full set; source_pokemon_name when auto-filled
  -- from every card of one Pokémon; is_national_dex when every slot is reserved for
  -- a National Dex number but not yet assigned an actual card (see nationalDex.js —
  -- the label for an empty slot is computed from its position, never stored); all
  -- of these are unset for a manual binder.
  CREATE TABLE IF NOT EXISTS binders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source_set_id TEXT,
    source_set_name TEXT,
    source_pokemon_name TEXT,
    is_national_dex INTEGER NOT NULL DEFAULT 0,
    page_count INTEGER NOT NULL DEFAULT 4,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per occupied slot. position is 0-indexed across the whole binder:
  -- page*18 + side*9 + (row*3+col), side 0=front/1=back. Empty slots simply have
  -- no row — never materialized, computed by the frontend from pageCount.
  CREATE TABLE IF NOT EXISTS binder_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    binder_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    card_id TEXT NOT NULL,
    card_snapshot TEXT,
    variant TEXT,
    notes TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(binder_id, position)
  );

  CREATE INDEX IF NOT EXISTS idx_binder_slots_binder ON binder_slots(binder_id);
`);

// Lightweight migrations for databases created before these columns existed
// (CREATE TABLE IF NOT EXISTS above only applies to brand-new tables).
for (const stmt of [
  'ALTER TABLE binder_slots ADD COLUMN variant TEXT',
  'ALTER TABLE binders ADD COLUMN source_pokemon_name TEXT',
  'ALTER TABLE binders ADD COLUMN is_national_dex INTEGER NOT NULL DEFAULT 0',
  // Indexed columns mirroring fields already inside card_cache.data's JSON —
  // lets search/sort run as a local SQL query instead of a live pokemontcg.io
  // call. Populated by pokemonApi.js's cacheCard() going forward; existing
  // rows are backfilled once below.
  'ALTER TABLE card_cache ADD COLUMN name TEXT',
  'ALTER TABLE card_cache ADD COLUMN set_id TEXT',
  'ALTER TABLE card_cache ADD COLUMN set_name TEXT',
  'ALTER TABLE card_cache ADD COLUMN number TEXT',
  'ALTER TABLE card_cache ADD COLUMN price_amount REAL',
  'ALTER TABLE card_cache ADD COLUMN price_currency TEXT',
]) {
  try {
    db.exec(stmt);
  } catch {
    // column already exists — fine
  }
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_card_cache_name ON card_cache(name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_card_cache_set ON card_cache(set_id);
  CREATE INDEX IF NOT EXISTS idx_card_cache_price ON card_cache(price_amount);
`);

// One-time backfill for card_cache rows written before the columns above
// existed — computed the same way cacheCard() computes them going forward,
// just done here in bulk so a search can serve everything already cached
// (e.g. a binder's set, from earlier browsing) without waiting on a fresh
// sync. Cheap: it's a local loop over whatever's already cached, not a
// network call, and only touches rows still missing `name`.
const staleRows = db.prepare('SELECT id, data FROM card_cache WHERE name IS NULL').all();
if (staleRows.length) {
  const backfillStmt = db.prepare(
    `UPDATE card_cache SET name = ?, set_id = ?, set_name = ?, number = ?, price_amount = ?, price_currency = ? WHERE id = ?`
  );
  const backfillAll = db.transaction((rows) => {
    for (const row of rows) {
      let card;
      try {
        card = JSON.parse(row.data);
      } catch {
        continue; // corrupt row — leave it, cacheCard() will overwrite on next fetch
      }
      const price = bestGuessPrice(card);
      backfillStmt.run(
        card.name ?? null,
        card.set?.id ?? null,
        card.set?.name ?? null,
        card.number ?? null,
        price?.amount ?? null,
        price?.currency ?? null,
        row.id
      );
    }
  });
  backfillAll(staleRows);
  console.log(`Backfilled search columns for ${staleRows.length} already-cached card(s)`);
}

export default db;
