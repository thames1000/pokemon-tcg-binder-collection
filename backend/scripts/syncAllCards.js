// One-time (or occasional, e.g. after a new set drops) full pull of every
// card in the pokemontcg.io database into card_cache, TCGdex fallback price
// applied where pokemontcg.io has none — see README's "Missing prices on
// very new cards" section. Run manually: `npm run sync-cards` (add
// `-- --restart` to ignore any saved progress and start over from page 1).
//
// Not run automatically on `npm start` — this is a deliberate, potentially
// long-running pull (~80+ requests against the live API, plus a TCGdex
// lookup for every card that gap affects) that the user kicks off on
// purpose. Resumable: progress is saved after every page, so an interrupted
// run (Ctrl+C, a crash, a persistent upstream failure) picks back up at the
// right page next time instead of starting over.
import 'dotenv/config';
import { fetchFromApi, withFallbackPrice, cacheCard, getApiCache, setApiCache } from '../pokemonApi.js';

const PAGE_SIZE = 250;
const PROGRESS_KEY = 'card-sync:progress';

async function main() {
  const restart = process.argv.includes('--restart');

  let startPage = 1;
  if (!restart) {
    // No TTL cap — we want this regardless of age, only ever cleared by
    // finishing a run or passing --restart.
    const progress = getApiCache(PROGRESS_KEY, Infinity);
    if (progress?.data?.lastCompletedPage) {
      startPage = progress.data.lastCompletedPage + 1;
      console.log(`Resuming from page ${startPage} (pass --restart to start over).`);
    }
  } else {
    console.log('Starting a fresh sync from page 1 (--restart).');
  }

  let page = startPage;
  let synced = (startPage - 1) * PAGE_SIZE;
  let totalCount = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await fetchFromApi(`/cards?page=${page}&pageSize=${PAGE_SIZE}&orderBy=name`);
    totalCount = data.totalCount;
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    for (const card of data.data) {
      await withFallbackPrice(card);
      cacheCard(card);
    }
    synced += data.data.length;

    setApiCache(PROGRESS_KEY, { lastCompletedPage: page, totalCount, updatedAt: new Date().toISOString() });
    console.log(`Page ${page}/${totalPages} — ${synced}/${totalCount} cards synced`);

    if (data.data.length === 0 || page >= totalPages) break;
    page++;
  }

  console.log(`Done: ${synced}/${totalCount} cards cached.`);
}

main().catch((e) => {
  console.error('Sync stopped:', e.message);
  console.error('Progress was saved after every completed page — re-run to resume.');
  process.exit(1);
});
