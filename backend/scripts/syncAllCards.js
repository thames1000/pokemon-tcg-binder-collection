// One-time (or occasional, e.g. after a new set drops) full pull of every
// card in the pokemontcg.io database into card_cache, TCGdex fallback price
// applied where pokemontcg.io has none — see README's "Missing prices on
// very new cards" section. Run manually: `npm run sync-cards` (add
// `-- --restart` to ignore any saved progress and start over from set 1).
//
// Not run automatically on `npm start` — this is a deliberate, potentially
// long-running pull (~170+ requests, one or more per set, plus a TCGdex
// lookup for every card that gap affects) that the user kicks off on
// purpose. Resumable: progress is saved after every set, so an interrupted
// run (Ctrl+C, a crash, a persistent upstream failure) picks back up at the
// right set next time instead of starting over.
//
// Iterates set-by-set (via searchCards({ set: id, ... }) — same helper
// fetchAllCardsForSet in routes/binders.js uses for binder creation) rather
// than flat-paginating the whole /cards collection by page/offset. This
// isn't just a style choice: pokemontcg.io's deep-offset pagination has
// been unreliable during this project's Scrydex migration (confirmed
// live — shallow requests near offset 0 succeeded far more often than deep
// ones hundreds of pages in), and almost every set has under 250 cards, so
// querying set-by-set keeps every request's offset near 0.
import 'dotenv/config';
import { fetchFromApi, searchCards, getApiCache, setApiCache, markFullSyncComplete } from '../pokemonApi.js';

const PAGE_SIZE = 250;
const PROGRESS_KEY = 'card-sync:progress';
const SET_RETRY_LIMIT = 6;
const SET_RETRY_DELAY_MS = 3000;
const INTER_SET_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAllPagesForSet(setId) {
  let allCards = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await searchCards({ set: setId, page, pageSize: PAGE_SIZE });
    allCards = allCards.concat(result.cards);
    if (allCards.length >= result.totalCount || result.cards.length === 0 || page >= 10) break;
    page++;
  }
  return allCards;
}

async function fetchSetWithRetry(setId) {
  let lastErr;
  for (let attempt = 1; attempt <= SET_RETRY_LIMIT; attempt++) {
    try {
      return await fetchAllPagesForSet(setId);
    } catch (e) {
      lastErr = e;
      console.warn(`  set ${setId}: attempt ${attempt}/${SET_RETRY_LIMIT} failed (${e.message}) — retrying…`);
      if (attempt < SET_RETRY_LIMIT) await sleep(SET_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

async function main() {
  const restart = process.argv.includes('--restart');

  console.log('Fetching the set list…');
  const setsData = await fetchFromApi('/sets?orderBy=id&pageSize=250');
  const sets = setsData.data;
  console.log(`${sets.length} sets found.`);

  let startIndex = 0;
  if (!restart) {
    // No TTL cap — resumed regardless of age, only ever cleared by finishing
    // a run or passing --restart. A progress row from the old flat-pagination
    // version of this script (lastCompletedPage, no lastCompletedSetIndex)
    // doesn't map onto set indices, so it's treated as "start over" here —
    // nothing already cached is lost, this only affects where iteration
    // resumes from.
    const progress = getApiCache(PROGRESS_KEY, Infinity);
    if (progress?.data?.lastCompletedSetIndex != null && progress.data.totalSets === sets.length) {
      startIndex = progress.data.lastCompletedSetIndex + 1;
      console.log(`Resuming from set ${startIndex + 1}/${sets.length} (pass --restart to start over).`);
    } else if (progress?.data) {
      console.log('Saved progress is from an earlier version of this script — starting over from set 1 (nothing already cached is lost).');
    }
  } else {
    console.log('Starting a fresh sync from set 1 (--restart).');
  }

  let synced = 0;
  for (let i = startIndex; i < sets.length; i++) {
    const set = sets[i];
    const cards = await fetchSetWithRetry(set.id);
    synced += cards.length;

    setApiCache(PROGRESS_KEY, {
      lastCompletedSetIndex: i,
      totalSets: sets.length,
      totalCardsSynced: synced,
      updatedAt: new Date().toISOString(),
    });
    console.log(`Set ${i + 1}/${sets.length} (${set.name}) — ${cards.length} cards, ${synced} total synced so far`);

    if (i < sets.length - 1) await sleep(INTER_SET_DELAY_MS);
  }

  // Only now — having actually gone through every set — is it safe for
  // searchCards() to trust the local cache as complete for any query.
  markFullSyncComplete(synced);
  console.log(`Done: ${synced} cards cached across ${sets.length} sets. Search now serves entirely from the local cache.`);
}

main().catch((e) => {
  console.error('Sync stopped:', e.message);
  console.error('Progress was saved after every completed set — re-run to resume.');
  process.exit(1);
});
