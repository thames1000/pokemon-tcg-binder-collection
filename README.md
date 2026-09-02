# Pokémon TCG Tracker

Track a Pokémon TCG collection: browse the full card library, mark what you own, look up
current market prices, and see where your collection's value is going — all backed by the
[pokemontcg.io](https://pokemontcg.io) API, and fully yours: a local SQLite file, no account,
no subscription.

## Features

- **Library** — search/browse every Pokémon TCG card ever printed, filter by set.
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
| POST | `/api/collection/import` | Bulk-add from CSV (body: `{ csv: "..." }`) |
| POST | `/api/collection` | Add a card to your collection |
| PATCH | `/api/collection/:id` | Update quantity/condition/variant/notes |
| DELETE | `/api/collection/:id` | Remove a card from your collection |
| GET | `/api/wishlist` | List wanted cards, flagged if at/below target price |
| POST | `/api/wishlist` | Add a card to your wishlist |
| PATCH | `/api/wishlist/:id` | Update target price/notes |
| DELETE | `/api/wishlist/:id` | Remove a card from your wishlist |

### CSV import format

Accepted columns (case-insensitive, aliases like `qty`/`price`/`set` also work): `cardId`,
`name`, `setId`, `setName`, `number`, `variant`, `condition`, `quantity`, `acquiredPrice`,
`notes`. Either `cardId` (exact match) or `name` (optionally narrowed by `setId`/`setName`/
`number`) is required per row. Rows that can't be confidently matched to exactly one card are
skipped and reported back — never guessed.
