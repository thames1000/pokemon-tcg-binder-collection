import { Router } from 'express';
import db from '../db.js';
import { cardMarketPrice } from '../pricing.js';

const router = Router();

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

// GET /api/collection - list every owned card, with current market price + line value
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM collection_items ORDER BY added_at DESC').all();
  const items = rows.map((row) => {
    const item = rowToItem(row);
    const currentCard = latestCardData(row.card_id, item.card);
    const price = cardMarketPrice(currentCard, item.variant);
    item.card = currentCard;
    item.currentPrice = price;
    item.lineValue = price ? +(price.amount * item.quantity).toFixed(2) : null;
    return item;
  });
  res.json(items);
});

// GET /api/collection/value - collection totals
router.get('/value', (req, res) => {
  const rows = db.prepare('SELECT * FROM collection_items').all();
  let totalValue = 0;
  let totalCards = 0;
  let pricedCards = 0;
  let missingPrice = 0;
  for (const row of rows) {
    const item = rowToItem(row);
    const currentCard = latestCardData(row.card_id, item.card);
    const price = cardMarketPrice(currentCard, item.variant);
    totalCards += item.quantity;
    if (price) {
      totalValue += price.amount * item.quantity;
      pricedCards += item.quantity;
    } else {
      missingPrice += item.quantity;
    }
  }
  res.json({
    totalValue: +totalValue.toFixed(2),
    totalCards,
    uniqueCards: rows.length,
    pricedCards,
    missingPrice,
  });
});

// POST /api/collection - add a card to the collection
// body: { cardId, card, quantity, condition, variant, acquiredPrice, notes }
router.post('/', (req, res) => {
  const { cardId, card, quantity = 1, condition = 'Near Mint', variant = 'Normal', acquiredPrice, notes } = req.body;
  if (!cardId) return res.status(400).json({ error: 'cardId is required' });

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

  const row = db.prepare('SELECT * FROM collection_items WHERE id = ?').get(info.lastInsertRowid);
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

export default router;
