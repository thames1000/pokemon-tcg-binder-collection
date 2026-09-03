# Pokémon TCG Tracker

Track a Pokémon TCG collection: browse the full card library, mark what you own, look up
current market prices, and see where your collection's value is going — all backed by the
[pokemontcg.io](https://pokemontcg.io) API, and fully yours: a local SQLite file, no account,
no subscription.

## Features

- **Library** — search/browse every Pokémon TCG card ever printed, filter by set. Up to 250
  results per page (pokemontcg.io's own per-request cap) — most sets fit entirely on one page,
  so filtering by set means scrolling through the whole thing rather than clicking through
  several pages of 32.
- **My Collection** — add cards you own with quantity, condition, variant (normal/holofoil/
  reverse holo/1st edition/…), price paid, and notes. Edit or remove anytime.
- **Price Lookup** — a dedicated view to check a card's current price without the pressure of
  adding it to your collection; "Refresh price" forces a live re-check.
- **Analytics** — collection value over time, breakdowns by set and rarity, and top
  gainers/losers vs. what you paid.
- **Wishlist** — track cards you don't own yet with an optional target price; cards that drop
  to or below it are flagged when you check the page (not a push notification — see below).
- **CSV Import/Export** — back up or migrate your whole collection as a spreadsheet. Export
  includes a `cardId` column, so re-importing your own export is an exact, lossless round trip.
- **Binders** — plan where cards go in a physical 9-pocket binder: a 3×3 front + 3×3 back per
  page, either one page at a time or (a toggle, remembered per browser) scrolled continuously
  through the whole binder. Auto-fill an entire binder four ways: from a set (sorted
  by card number), from every card of one Pokémon across every set ever printed (e.g.
  "Charizard" — VMAX/ex/GX/Dark/Shining/tag-team variants and all, sorted oldest-first by
  release date), from the full National Dex (#1 Bulbasaur–#1025 Pecharunt, one slot per
  number — starts completely empty, each unfilled slot just labeled with its number and
  species so you know exactly where a card goes once you get one, whichever print it
  happens to be; clicking an empty labeled slot offers up anything you already own matching
  that name before you go searching), or build one manually, slot by slot. The set and
  Pokémon auto-fill modes share a per-rarity rules checklist — e.g. give Common/Uncommon/Rare
  2 slots each (Normal + Reverse Holofoil) while higher rarities get 1 (already a single
  foil-only print) — and a promo-rarity toggle (excluded by default for a set, included by
  default for a Pokémon, since promos are often exactly what a Pokémon-focused binder is
  chasing). Cards you already own show full color;
  cards you don't are darkened/desaturated at a glance (the same convention Holodex uses) —
  click any card to jump straight to "Add to Collection". Ownership matches on the slot's
  planned variant when it has one (e.g. owning the Normal print doesn't light up the
  Reverse Holofoil slot of the same card) — a slot with no variant set matches any copy you
  own. Every binder also shows an estimated cost to complete: current market price summed
  across every unowned, priced slot (from live-cached prices, not a stale snapshot from
  when the binder was built), alongside what you've already got and how many slots simply
  have no price data yet — never silently reported as $0.

## Stack

- **Backend**: Node + Express + SQLite (`better-sqlite3`). Proxies and caches the
  pokemontcg.io API, and stores your collection in `backend/data/collection.db`.
- **Frontend**: React + Vite.

## Setup

```bash
# Backend
cd backend
npm install
cp .env.example .env   # optional: add a free pokemontcg.io API key for higher rate limits
npm start               # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev              # http://localhost:5173
```

Open http://localhost:5173. The Vite dev server proxies `/api` calls to the backend.

### Getting an API key (recommended)

The app works with no key, but pokemontcg.io's unauthenticated tier has a low rate limit and
can return occasional 5xx errors under load. Get a free key at https://dev.pokemontcg.io/ and
put it in `backend/.env` as `POKEMONTCG_API_KEY` for a much smoother experience. The backend
also retries transient upstream errors automatically and falls back to its local cache when
the API is unreachable.

### Missing prices on very new cards

pokemontcg.io's own price sync appears to have stopped covering newly released sets (its
maintainers have shifted focus to a paid successor product) — cards from recent sets can come
back with no TCGplayer/Cardmarket data at all. When that happens, the backend tries
[TCGdex](https://tcgdex.dev) (free, no key) as a fallback, matching the card by name + set +
number since it's a separate database with its own IDs. If TCGdex is also unreachable or has no
match, the card just shows "No price data available" — never a fabricated price.

## Data model

- `card_cache` — a local cache of card data (including prices) pulled from the API, refreshed
  every 12 hours per card (or on demand via "Refresh price").
- `api_cache` — a generic cache for endpoints without a natural per-row cache (`/sets`,
  `/search`), so a transient upstream outage serves stale-but-known-good data instead of an error.
- `collection_items` — the cards you own: card id, quantity, condition, variant, price paid,
  notes, and a snapshot of the card at the time it was added.
- `wishlist_items` — cards you want, with an optional target price.
- `value_snapshots` — one row per calendar day, recorded automatically whenever the app
  computes your collection's totals. This is what powers the Analytics value-over-time chart —
  history builds up from normal use, no separate job required.
- `binders` / `binder_slots` — a binder is `pageCount` pages × 18 slots (3×3 front + 3×3 back).
  `binder_slots` has one row per *occupied* slot only — position `page*18 + side*9 + (row*3+col)`
  (side 0=front, 1=back); empty slots simply have no row. A National Dex binder
  (`is_national_dex`) is the extreme case of this: every slot starts unoccupied, and the
  label an empty slot shows is computed from its position against `nationalDex.js`, never
  stored — nothing is written to `binder_slots` until you actually place a card.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/cards/search?name=&set=&page=&pageSize=` | Search the card library |
| GET | `/api/cards/sets` | List all sets (for the filter dropdown) |
| GET | `/api/cards/:id?force=` | Get one card (cached; `force=true` bypasses the cache) |
| GET | `/api/collection` | List owned cards with current price/value |
| GET | `/api/collection/value` | Collection totals (also records today's value snapshot) |
| GET | `/api/collection/analytics` | Value history, by-set/by-rarity breakdowns, gainers/losers |
| GET | `/api/collection/export` | Download your collection as CSV |
| GET | `/api/collection/search?name=` | Owned items whose card name contains the text |
| POST | `/api/collection/import` | Bulk-add from CSV (body: `{ csv: "..." }`) |
| POST | `/api/collection` | Add a card to your collection |
| PATCH | `/api/collection/:id` | Update quantity/condition/variant/notes |
| DELETE | `/api/collection/:id` | Remove a card from your collection |
| GET | `/api/wishlist` | List wanted cards, flagged if at/below target price |
| POST | `/api/wishlist` | Add a card to your wishlist |
| PATCH | `/api/wishlist/:id` | Update target price/notes |
| DELETE | `/api/wishlist/:id` | Remove a card from your wishlist |
| GET | `/api/binders` | List binders with fill progress |
| GET | `/api/binders/set-preview?setId=` | Rarity breakdown for a set (builds the rules checklist) |
| GET | `/api/binders/pokemon-preview?name=` | Rarity breakdown for every card of one Pokémon |
| GET | `/api/binders/national-dex` | The full #1–1025 species list, in order |
| GET | `/api/binders/:id` | One binder with every filled slot, each priced, plus a completion cost estimate |
| POST | `/api/binders` | Create — `{ name, mode: 'manual', pageCount? }`, `{ name, mode: 'set', setId, excludePromos?, rarityRules? }`, `{ name, mode: 'pokemon', pokemonName, excludePromos?, rarityRules? }`, or `{ name, mode: 'dex' }` |
| PATCH | `/api/binders/:id` | Rename and/or resize (grow/shrink page count) |
| DELETE | `/api/binders/:id` | Delete a binder |
| PUT | `/api/binders/:id/slots/:position` | Place/replace a card in one slot |
| DELETE | `/api/binders/:id/slots/:position` | Clear a slot |

### CSV import format

Accepted columns (case-insensitive, aliases like `qty`/`price`/`set` also work): `cardId`,
`name`, `setId`, `setName`, `number`, `variant`, `condition`, `quantity`, `acquiredPrice`,
`notes`. Either `cardId` (exact match) or `name` (optionally narrowed by `setId`/`setName`/
`number`) is required per row. Rows that can't be confidently matched to exactly one card are
skipped and reported back — never guessed.
