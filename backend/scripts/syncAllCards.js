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
import { fetchFromApi, withFallbackPrice, cacheCard, getApiCache, setApiCache, markFullSyncComplete } from '../pokemonApi.js';

const PAGE_SIZE = 250;
const PROGRESS_KEY = 'card-sync:progress';
// pokemontcg.io's backend has been especially unstable during this project's
// Scrydex migration (see README) — a burst of 82 back-to-back page requests
// can hit a noticeably higher failure rate than normal single-request use.
// fetchFromApi already retries 4x per HTTP call; on top of that, each page
// here gets its own retry budget with longer backoff, plus a small pause
// between successful pages to ease pressure on a currently-flaky upstream.
const PAGE_RETRY_LIMIT = 6;
const PAGE_RETRY_DELAY_MS = 3000;
const INTER_PAGE_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPageWithRetry(page) {
  let lastErr;
  for (let attempt = 1; attempt <= PAGE_RETRY_LIMIT; attempt++) {
    try {
      return await fetchFromApi(`/cards?page=${page}&pageSize=${PAGE_SIZE}&orderBy=name`);
    } catch (e) {
      lastErr = e;
      console.warn(`  page ${page}: attempt ${attempt}/${PAGE_RETRY_LIMIT} failed (${e.message}) — retrying…`);
      if (attempt < PAGE_RETRY_LIMIT) await sleep(PAGE_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

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
    const data = await fetchPageWithRetry(page);
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
    await sleep(INTER_PAGE_DELAY_MS);
  }

  // Only now — having actually reached the last page — is it safe for
  // searchCards() to trust the local cache as complete for any query. Marked
  // here rather than after every page precisely so an interrupted run
  // doesn't flip this early.
  markFullSyncComplete(totalCount);
  console.log(`Done: ${synced}/${totalCount} cards cached. Search now serves entirely from the local cache.`);
}

main().catch((e) => {
  console.error('Sync stopped:', e.message);
  console.error('Progress was saved after every completed page — re-run to resume.');
  process.exit(1);
});
