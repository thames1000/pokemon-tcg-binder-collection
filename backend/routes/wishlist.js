import { Router } from 'express';
import db from '../db.js';
import { cardMarketPrice } from '../pricing.js';

const router = Router();

function rowToItem(row) {
  return {
    id: row.id,
    cardId: row.card_id,
    targetPrice: row.target_price,
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

// GET /api/wishlist - every wanted card, with current price and whether it has
// dropped to (or below) your target price. Sorted so items at/below target — the
// ones worth acting on — surface first.
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM wishlist_items ORDER BY added_at DESC').all();
  const items = rows.map((row) => {
    const item = rowToItem(row);
    item.card = latestCardData(row.card_id, item.card);
    item.currentPrice = cardMarketPrice(item.card, undefined);
    item.belowTarget =
      item.targetPrice != null && item.currentPrice != null && item.currentPrice.amount <= item.targetPrice;
    return item;
  });
  items.sort((a, b) => {
    if (a.belowTarget !== b.belowTarget) return a.belowTarget ? -1 : 1;
    return new Date(b.addedAt) - new Date(a.addedAt);
  });
  res.json(items);
});

// POST /api/wishlist - body: { cardId, card, targetPrice, notes }. Idempotent
// by card: if this card is already on the wishlist (e.g. stale frontend state
// — a card tile's wishlist star not yet knowing about a wishlist add made
// elsewhere), the existing row is returned as-is rather than creating a
// second entry for the same card.
router.post('/', (req, res) => {
  const { cardId, card, targetPrice, notes } = req.body;
  if (!cardId) return res.status(400).json({ error: 'cardId is required' });

  const existing = db.prepare('SELECT * FROM wishlist_items WHERE card_id = ?').get(cardId);
  if (existing) return res.json(rowToItem(existing));

  if (card) {
    db.prepare(
      `INSERT INTO card_cache (id, data, fetched_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
    ).run(cardId, JSON.stringify(card));
  }

  const info = db
    .prepare(`INSERT INTO wishlist_items (card_id, target_price, notes, card_snapshot) VALUES (?, ?, ?, ?)`)
    .run(cardId, targetPrice ?? null, notes ?? null, card ? JSON.stringify(card) : null);

  const row = db.prepare('SELECT * FROM wishlist_items WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToItem(row));
});

// PATCH /api/wishlist/:id - update targetPrice/notes
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM wishlist_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const updates = {};
  if (req.body.targetPrice !== undefined) updates.target_price = req.body.targetPrice;
  if (req.body.notes !== undefined) updates.notes = req.body.notes;

  if (Object.keys(updates).length === 0) return res.json(rowToItem(existing));

  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE wishlist_items SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({
    ...updates,
    id: req.params.id,
  });

  const row = db.prepare('SELECT * FROM wishlist_items WHERE id = ?').get(req.params.id);
  res.json(rowToItem(row));
});

// DELETE /api/wishlist/:id
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
