import { Router } from 'express';
import db from '../db.js';
import { searchCards } from '../pokemonApi.js';

const router = Router();

const SLOTS_PER_SIDE = 9; // 3x3
const SLOTS_PER_PAGE = SLOTS_PER_SIDE * 2; // front + back

// Natural sort for printed card numbers ("1" < "2" < "10", "TG01" < "TG02", etc.)
// so a set fills into a binder in the same order the physical cards are numbered.
function compareCardNumbers(a, b) {
  const split = (s) => String(s ?? '').match(/(\d+|\D+)/g) || [];
  const aParts = split(a);
  const bParts = split(b);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ap = aParts[i] ?? '';
    const bp = bParts[i] ?? '';
    const aNum = /^\d+$/.test(ap);
    const bNum = /^\d+$/.test(bp);
    if (aNum && bNum) {
      const diff = Number(ap) - Number(bp);
      if (diff !== 0) return diff;
    } else {
      const cmp = ap.localeCompare(bp);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

function rowToBinder(row) {
  return {
    id: row.id,
    name: row.name,
    sourceSetId: row.source_set_id,
    sourceSetName: row.source_set_name,
    pageCount: row.page_count,
    totalSlots: row.page_count * SLOTS_PER_PAGE,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/binders - list all binders with fill progress
router.get('/', (req, res) => {
  const binders = db.prepare('SELECT * FROM binders ORDER BY updated_at DESC').all();
  const result = binders.map((b) => {
    const filledSlots = db.prepare('SELECT COUNT(*) AS c FROM binder_slots WHERE binder_id = ?').get(b.id).c;
    return { ...rowToBinder(b), filledSlots };
  });
  res.json(result);
});

// GET /api/binders/:id - full binder with every filled slot (+ whether you own that card)
router.get('/:id', (req, res) => {
  const binder = db.prepare('SELECT * FROM binders WHERE id = ?').get(req.params.id);
  if (!binder) return res.status(404).json({ error: 'Not found' });

  const slotRows = db.prepare('SELECT * FROM binder_slots WHERE binder_id = ?').all(req.params.id);
  const slots = slotRows.map((s) => ({
    position: s.position,
    cardId: s.card_id,
    card: s.card_snapshot ? JSON.parse(s.card_snapshot) : null,
    notes: s.notes,
    owned: !!db.prepare('SELECT 1 FROM collection_items WHERE card_id = ? LIMIT 1').get(s.card_id),
  }));

  res.json({ ...rowToBinder(binder), slots });
});

// POST /api/binders - create a binder.
// Manual: { name, mode: 'manual', pageCount? } — starts empty.
// From a set: { name, mode: 'set', setId } — fetches every card in the set, sorts
// by printed number, and fills slots 0..N in order, sizing pageCount to fit.
router.post('/', async (req, res) => {
  const { name, mode, setId, pageCount } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  if (mode === 'set') {
    if (!setId) return res.status(400).json({ error: 'setId is required when mode is "set"' });
    try {
      let allCards = [];
      let page = 1;
      // pokemontcg.io caps pageSize at 250; a handful of sets exceed that, so
      // paginate defensively (capped at 10 pages — no real set is 2500+ cards).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await searchCards({ set: setId, page, pageSize: 250 });
        allCards = allCards.concat(result.cards);
        if (allCards.length >= result.totalCount || result.cards.length === 0 || page >= 10) break;
        page++;
      }
      if (allCards.length === 0) return res.status(404).json({ error: `No cards found for set "${setId}"` });

      allCards.sort((a, b) => compareCardNumbers(a.number, b.number));
      const neededPages = Math.max(1, Math.ceil(allCards.length / SLOTS_PER_PAGE));
      const setName = allCards[0]?.set?.name || setId;

      const info = db
        .prepare('INSERT INTO binders (name, source_set_id, source_set_name, page_count) VALUES (?, ?, ?, ?)')
        .run(name.trim(), setId, setName, neededPages);
      const binderId = info.lastInsertRowid;

      const insertSlot = db.prepare(
        'INSERT INTO binder_slots (binder_id, position, card_id, card_snapshot) VALUES (?, ?, ?, ?)'
      );
      db.transaction((cards) => {
        cards.forEach((card, i) => insertSlot.run(binderId, i, card.id, JSON.stringify(card)));
      })(allCards);

      const binder = db.prepare('SELECT * FROM binders WHERE id = ?').get(binderId);
      res.status(201).json({ ...rowToBinder(binder), filledSlots: allCards.length });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  } else {
    const pages = Number.isFinite(Number(pageCount)) && Number(pageCount) > 0 ? Math.floor(Number(pageCount)) : 4;
    const info = db.prepare('INSERT INTO binders (name, page_count) VALUES (?, ?)').run(name.trim(), pages);
    const binder = db.prepare('SELECT * FROM binders WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ ...rowToBinder(binder), filledSlots: 0 });
  }
});

// PATCH /api/binders/:id - rename and/or resize (grow/shrink page count)
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM binders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const updates = {};
  if (req.body.name !== undefined) {
    if (!req.body.name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
    updates.name = req.body.name.trim();
  }
  if (req.body.pageCount !== undefined) {
    const pages = Math.floor(Number(req.body.pageCount));
    if (!Number.isFinite(pages) || pages < 1) return res.status(400).json({ error: 'pageCount must be at least 1' });
    const maxFilled = db.prepare('SELECT MAX(position) AS m FROM binder_slots WHERE binder_id = ?').get(req.params.id).m;
    const minPagesNeeded = maxFilled != null ? Math.ceil((maxFilled + 1) / SLOTS_PER_PAGE) : 1;
    if (pages < minPagesNeeded) {
      return res.status(400).json({ error: `Can't shrink below ${minPagesNeeded} pages — a later page still has cards in it` });
    }
    updates.page_count = pages;
  }
  if (Object.keys(updates).length === 0) return res.json(rowToBinder(existing));

  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE binders SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({
    ...updates,
    id: req.params.id,
  });
  res.json(rowToBinder(db.prepare('SELECT * FROM binders WHERE id = ?').get(req.params.id)));
});

// DELETE /api/binders/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM binder_slots WHERE binder_id = ?').run(req.params.id);
  const info = db.prepare('DELETE FROM binders WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

// PUT /api/binders/:id/slots/:position - place or replace the card in one slot.
// body: { cardId, card, notes }
router.put('/:id/slots/:position', (req, res) => {
  const binder = db.prepare('SELECT * FROM binders WHERE id = ?').get(req.params.id);
  if (!binder) return res.status(404).json({ error: 'Not found' });

  const position = Number.parseInt(req.params.position, 10);
  const totalSlots = binder.page_count * SLOTS_PER_PAGE;
  if (!Number.isInteger(position) || position < 0 || position >= totalSlots) {
    return res.status(400).json({ error: 'Invalid slot position' });
  }

  const { cardId, card, notes } = req.body;
  if (!cardId) return res.status(400).json({ error: 'cardId is required' });

  db.prepare(
    `INSERT INTO binder_slots (binder_id, position, card_id, card_snapshot, notes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(binder_id, position) DO UPDATE SET
       card_id = excluded.card_id, card_snapshot = excluded.card_snapshot,
       notes = excluded.notes, added_at = datetime('now')`
  ).run(req.params.id, position, cardId, card ? JSON.stringify(card) : null, notes ?? null);
  db.prepare("UPDATE binders SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);

  const owned = !!db.prepare('SELECT 1 FROM collection_items WHERE card_id = ? LIMIT 1').get(cardId);
  res.json({ position, cardId, card, notes: notes ?? null, owned });
});

// DELETE /api/binders/:id/slots/:position - clear a slot
router.delete('/:id/slots/:position', (req, res) => {
  const info = db
    .prepare('DELETE FROM binder_slots WHERE binder_id = ? AND position = ?')
    .run(req.params.id, req.params.position);
  db.prepare("UPDATE binders SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Slot was already empty' });
  res.status(204).end();
});

export default router;
