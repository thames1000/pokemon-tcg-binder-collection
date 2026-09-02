import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import db from '../db.js';
import { cardMarketPrice } from '../pricing.js';
import { getCardById, searchCards } from '../pokemonApi.js';

const router = Router();

const CONDITIONS = ['Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

function rowToItem(row) {
  return {
    id: row.id,
    cardId: row.card_id,
    quantity: row.quantity,
    condition: row.condition,
    variant: row.variant,
    acquiredPrice: row.acquired_price,
    notes: row.notes,
    card: row.card_snapshot ? JSON.parse(row.card_snapshot) : null,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  };
}

function latestCardData(cardId, fallbackSnapshot) {
  const cached = db.prepare('SELECT data FROM card_cache WHERE id = ?').get(cardId);
  if (cached) return JSON.parse(cached.data);
  return fallbackSnapshot;
}

// Every collection item, resolved with its current card data + market price. The
// single source every other endpoint in this file (list, totals, export, analytics)
// builds on, so "current price" means the same thing everywhere.
function getPricedItems() {
  const rows = db.prepare('SELECT * FROM collection_items ORDER BY added_at DESC').all();
  return rows.map((row) => {
    const item = rowToItem(row);
    item.card = latestCardData(row.card_id, item.card);
    item.currentPrice = cardMarketPrice(item.card, item.variant);
    item.lineValue = item.currentPrice ? +(item.currentPrice.amount * item.quantity).toFixed(2) : null;
    return item;
  });
}

function computeTotals(items) {
  let totalValue = 0;
  let totalCards = 0;
  let pricedCards = 0;
  let missingPrice = 0;
  for (const item of items) {
    totalCards += item.quantity;
    if (item.currentPrice) {
      totalValue += item.lineValue;
      pricedCards += item.quantity;
    } else {
      missingPrice += item.quantity;
    }
  }
  return {
    totalValue: +totalValue.toFixed(2),
    totalCards,
    uniqueCards: items.length,
    pricedCards,
    missingPrice,
  };
}

// Upsert today's snapshot so the value-over-time chart accumulates history just
// from normal app use — no cron needed. One row per calendar day (server-local).
function recordValueSnapshot(totals) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO value_snapshots (date, total_value, total_cards, unique_cards)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET total_value = excluded.total_value,
       total_cards = excluded.total_cards, unique_cards = excluded.unique_cards`
  ).run(today, totals.totalValue, totals.totalCards, totals.uniqueCards);
}

// GET /api/collection - list every owned card, with current market price + line value
router.get('/', (req, res) => {
  res.json(getPricedItems());
});

// GET /api/collection/value - collection totals (also records today's value snapshot)
router.get('/value', (req, res) => {
  const totals = computeTotals(getPricedItems());
  recordValueSnapshot(totals);
  res.json(totals);
});

const BREAKDOWN_CAP = 8; // top N slots get their own bar; the rest fold into "Other"

function topNWithOther(counts) {
  const sorted = [...counts.entries()].sort((a, b) => b[1].value - a[1].value);
  const top = sorted.slice(0, BREAKDOWN_CAP).map(([label, v]) => ({ label, value: +v.value.toFixed(2), count: v.count }));
  const rest = sorted.slice(BREAKDOWN_CAP);
  if (rest.length) {
    const other = rest.reduce((acc, [, v]) => ({ value: acc.value + v.value, count: acc.count + v.count }), { value: 0, count: 0 });
    top.push({ label: 'Other', value: +other.value.toFixed(2), count: other.count });
  }
  return top;
}

// GET /api/collection/analytics - value history, breakdowns by set/rarity, and
// unrealized profit/loss vs. what you paid (only for items with a price-paid value).
router.get('/analytics', (req, res) => {
  const items = getPricedItems();
  const totals = computeTotals(items);

  const bySetMap = new Map();
  const byRarityMap = new Map();
  const withDelta = [];
  let totalUnrealizedPL = 0;
  let costBasisTotal = 0;

  for (const item of items) {
    if (!item.currentPrice) continue;
    const setLabel = item.card?.set?.name || 'Unknown set';
    const rarityLabel = item.card?.rarity || 'Unknown rarity';
    for (const [map, label] of [[bySetMap, setLabel], [byRarityMap, rarityLabel]]) {
      const entry = map.get(label) || { value: 0, count: 0 };
      entry.value += item.lineValue;
      entry.count += item.quantity;
      map.set(label, entry);
    }

    if (item.acquiredPrice != null) {
      const costBasis = item.acquiredPrice * item.quantity;
      const delta = item.lineValue - costBasis;
      costBasisTotal += costBasis;
      totalUnrealizedPL += delta;
      withDelta.push({
        cardId: item.cardId,
        name: item.card?.name || item.cardId,
        image: item.card?.images?.small || null,
        quantity: item.quantity,
        costBasis: +costBasis.toFixed(2),
        currentValue: +item.lineValue.toFixed(2),
        delta: +delta.toFixed(2),
        deltaPct: costBasis > 0 ? +((delta / costBasis) * 100).toFixed(1) : null,
      });
    }
  }

  withDelta.sort((a, b) => b.delta - a.delta);
  const gainers = withDelta.filter((d) => d.delta > 0).slice(0, 5);
  const losers = withDelta.filter((d) => d.delta < 0).slice(-5).reverse();

  const history = db.prepare('SELECT date, total_value AS totalValue FROM value_snapshots ORDER BY date').all();

  res.json({
    ...totals,
    totalUnrealizedPL: +totalUnrealizedPL.toFixed(2),
    costBasisTotal: +costBasisTotal.toFixed(2),
    bySet: topNWithOther(bySetMap),
    byRarity: topNWithOther(byRarityMap),
    gainers,
    losers,
    valueHistory: history,
  });
});

// Shared by POST / (single add) and POST /import (bulk add).
function insertCollectionItem({ cardId, card, quantity = 1, condition = 'Near Mint', variant = 'Normal', acquiredPrice, notes }) {
  if (card) {
    db.prepare(
      `INSERT INTO card_cache (id, data, fetched_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
    ).run(cardId, JSON.stringify(card));
  }

  const info = db
    .prepare(
      `INSERT INTO collection_items (card_id, quantity, condition, variant, acquired_price, notes, card_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(cardId, quantity, condition, variant, acquiredPrice ?? null, notes ?? null, card ? JSON.stringify(card) : null);

  return db.prepare('SELECT * FROM collection_items WHERE id = ?').get(info.lastInsertRowid);
}

// POST /api/collection - add a card to the collection
// body: { cardId, card, quantity, condition, variant, acquiredPrice, notes }
router.post('/', (req, res) => {
  if (!req.body.cardId) return res.status(400).json({ error: 'cardId is required' });
  const row = insertCollectionItem(req.body);
  res.status(201).json(rowToItem(row));
});

// PATCH /api/collection/:id - update quantity/condition/variant/price/notes
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM collection_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const fields = ['quantity', 'condition', 'variant', 'notes'];
  const updates = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  if (req.body.acquiredPrice !== undefined) updates.acquired_price = req.body.acquiredPrice;

  if (Object.keys(updates).length === 0) {
    return res.json(rowToItem(existing));
  }

  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE collection_items SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({
    ...updates,
    id: req.params.id,
  });

  const row = db.prepare('SELECT * FROM collection_items WHERE id = ?').get(req.params.id);
  res.json(rowToItem(row));
});

// DELETE /api/collection/:id
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM collection_items WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

const EXPORT_COLUMNS = [
  'cardId', 'name', 'setId', 'setName', 'number', 'variant', 'condition',
  'quantity', 'acquiredPrice', 'notes', 'currentPrice', 'currentPriceCurrency', 'lineValue', 'addedAt',
];

// GET /api/collection/export - your whole collection as a CSV file (full-fidelity
// backup/spreadsheet export). Includes cardId so re-importing this exact file is
// a lossless, unambiguous round trip — see POST /import.
router.get('/export', (req, res) => {
  const records = getPricedItems().map((item) => ({
    cardId: item.cardId,
    name: item.card?.name || '',
    setId: item.card?.set?.id || '',
    setName: item.card?.set?.name || '',
    number: item.card?.number || '',
    variant: item.variant,
    condition: item.condition,
    quantity: item.quantity,
    acquiredPrice: item.acquiredPrice ?? '',
    notes: item.notes ?? '',
    currentPrice: item.currentPrice?.amount ?? '',
    currentPriceCurrency: item.currentPrice?.currency ?? '',
    lineValue: item.lineValue ?? '',
    addedAt: item.addedAt,
  }));
  const csv = stringify(records, { header: true, columns: EXPORT_COLUMNS });
  const filename = `pokemon-collection-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

const IMPORT_HEADER_ALIASES = {
  cardid: 'cardId',
  name: 'name',
  cardname: 'name',
  setid: 'setId',
  setname: 'setName',
  set: 'setName',
  number: 'number',
  cardnumber: 'number',
  variant: 'variant',
  condition: 'condition',
  quantity: 'quantity',
  qty: 'quantity',
  acquiredprice: 'acquiredPrice',
  pricepaid: 'acquiredPrice',
  price: 'acquiredPrice',
  notes: 'notes',
  note: 'notes',
};

function normalizeHeader(header) {
  const key = header.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return IMPORT_HEADER_ALIASES[key] || null; // unrecognized columns (e.g. currentPrice from our own export) are dropped
}

// Resolve one CSV row to a real card: cardId is authoritative (exact, no ambiguity —
// this is what makes exporting then re-importing your own collection reliable).
// Without a cardId, fall back to matching by name (+ optional set/number), but only
// auto-match when that narrows to exactly one card — anything else is reported back
// to the user rather than silently guessing wrong.
async function resolveImportRow(row) {
  const cardId = row.cardId?.trim();
  if (cardId) {
    try {
      return { card: await getCardById(cardId) };
    } catch (e) {
      return { error: `Card ID "${cardId}" could not be found: ${e.message}` };
    }
  }

  const name = row.name?.trim();
  if (!name) return { error: 'Row has neither a cardId nor a name — nothing to match against.' };

  const setName = row.setName?.trim();
  const setId = row.setId?.trim();
  const number = row.number?.trim();

  let candidates;
  try {
    const result = await searchCards({ name, set: setId || undefined, page: 1, pageSize: 50 });
    candidates = result.cards.filter((c) => c.name.toLowerCase() === name.toLowerCase());
  } catch (e) {
    return { error: `Search failed for "${name}": ${e.message}` };
  }
  if (setName) candidates = candidates.filter((c) => c.set?.name?.toLowerCase().includes(setName.toLowerCase()));
  if (number) candidates = candidates.filter((c) => c.number === number);

  if (candidates.length === 1) return { card: candidates[0] };
  if (candidates.length === 0) {
    return { error: `No card found matching "${name}"${setName ? ` in set "${setName}"` : ''}. Add a cardId column, or a set/number, to disambiguate.` };
  }
  return { error: `Ambiguous — ${candidates.length} cards named "${name}" match. Add a setId/setName or number column to disambiguate.` };
}

// POST /api/collection/import - body: { csv: "<raw CSV text>" }
// Bulk-adds cards from a CSV (your own exported file, or one you've put together —
// see the header aliases above for accepted column names). Processes rows one at a
// time (not in parallel) to stay gentle on the upstream API's rate limit. Rows that
// can't be confidently matched to a card are skipped and reported back, never guessed.
router.post('/import', async (req, res) => {
  const csvText = req.body?.csv;
  if (!csvText || !csvText.trim()) return res.status(400).json({ error: 'csv is required' });

  let rows;
  try {
    rows = parse(csvText, {
      columns: (headers) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (e) {
    return res.status(400).json({ error: `Could not parse CSV: ${e.message}` });
  }

  let imported = 0;
  const skipped = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 for 0-index, +1 for the header line
    const label = row.name || row.cardId || '(unknown)';
    try {
      const { card, error } = await resolveImportRow(row);
      if (error) {
        skipped.push({ row: rowNum, name: label, reason: error });
        continue;
      }
      const quantity = Number.parseInt(row.quantity, 10);
      const condition = CONDITIONS.includes(row.condition) ? row.condition : 'Near Mint';
      const acquiredPrice = row.acquiredPrice && row.acquiredPrice !== '' ? Number(row.acquiredPrice) : null;
      insertCollectionItem({
        cardId: card.id,
        card,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        condition,
        variant: row.variant?.trim() || 'Normal',
        acquiredPrice: Number.isFinite(acquiredPrice) ? acquiredPrice : null,
        notes: row.notes || null,
      });
      imported++;
    } catch (e) {
      skipped.push({ row: rowNum, name: label, reason: e.message });
    }
  }

  res.json({ total: rows.length, imported, skipped });
});

export default router;
