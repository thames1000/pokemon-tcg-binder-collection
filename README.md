# Pokémon TCG Tracker

Track a Pokémon TCG collection: browse the full card library, mark what you own, and look up
current market prices — all backed by the [pokemontcg.io](https://pokemontcg.io) API.

## Features

- **Library** — search/browse every Pokémon TCG card ever printed, filter by set.
- **My Collection** — add cards you own with quantity, condition, variant (normal/holofoil/
  reverse holo/1st edition/…), price paid, and notes. Edit or remove anytime.
- **Price lookup** — each card shows live TCGplayer (low/market/high, per variant) and
  Cardmarket prices. Your collection's total estimated value updates automatically from
  current market prices × quantity owned.

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

## Data model

- `card_cache` — a local cache of card data (including prices) pulled from the API, refreshed
  every 12 hours per card.
- `collection_items` — the cards you own: card id, quantity, condition, variant, price paid,
  notes, and a snapshot of the card at the time it was added.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/cards/search?name=&set=&page=&pageSize=` | Search the card library |
| GET | `/api/cards/sets` | List all sets (for the filter dropdown) |
| GET | `/api/cards/:id` | Get one card (cached, with fresh prices) |
| GET | `/api/collection` | List owned cards with current price/value |
| GET | `/api/collection/value` | Collection totals |
| POST | `/api/collection` | Add a card to your collection |
| PATCH | `/api/collection/:id` | Update quantity/condition/variant/notes |
| DELETE | `/api/collection/:id` | Remove a card from your collection |
