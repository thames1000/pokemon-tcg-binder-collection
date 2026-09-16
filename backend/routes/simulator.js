import { Router } from 'express';
import db from '../db.js';
import { requireAdmin } from './auth.js';
import { cacheCard, hasCompletedFullSync } from '../pokemonApi.js';
import { createSimulator, catalogShortfall, fail } from '../simulator.js';

const sim = createSimulator(db);
const router = Router();
const preparing = new Map();

// One bounded catalog load per set. Opening and trading never call upstream APIs.
async function prepareSet(setId) {
  if (typeof setId !== 'string' || !sim.packs().some(p => p.id === setId)) fail('Unsupported pack');
  if (preparing.has(setId)) return preparing.get(setId);
  const promise = (async () => {
    if (hasCompletedFullSync()) {
      const local = db.prepare('SELECT data FROM card_cache WHERE set_id=?').all(setId).map(r => JSON.parse(r.data));
      // The local catalog is an optimization, not an authority: a set released
      // after the last full sync is missing or short here, so fall through to
      // the provider instead of stranding it. catalogShortfall is the same
      // shared tolerance prepare() enforces, so the two can never disagree.
      const total = sim.packs().find(p => p.id === setId)?.total;
      if (local.length && !catalogShortfall(total, local.length)) return sim.prepare(setId, local, local.length);
    }
    const cards = [];
    let total;
    for (let page = 1; page <= 5; page++) {
      // orderBy keeps pagination deterministic; an unstable default order can
      // duplicate a card across a page boundary and fail the whole prepare.
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(`set.id:${setId}`)}&orderBy=number&pageSize=250&page=${page}`;
      const response = await fetch(url, {
        headers: process.env.POKEMONTCG_API_KEY ? { 'X-Api-Key': process.env.POKEMONTCG_API_KEY } : {},
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) fail('Card provider unavailable. Retry preparing this set later; your balance is unchanged.', 502);
      const data = await response.json();
      if (!Array.isArray(data.data) || !Number.isSafeInteger(data.totalCount) || (total != null && total !== data.totalCount)) fail('Invalid catalog response', 502);
      total = data.totalCount; cards.push(...data.data);
      if (cards.length >= total || data.data.length === 0) break;
    }
    // Cache and completeness marker commit together, or not at all.
    return db.transaction(() => {
      const result = sim.prepare(setId, cards, total);
      // Catalog setup must not erase existing fallback prices or renew their age.
      const existing = db.prepare('SELECT 1 FROM card_cache WHERE id=?');
      cards.forEach(card => { if (!existing.get(card.id)) cacheCard(card); });
      return result;
    })();
  })();
  preparing.set(setId, promise);
  try { return await promise; } finally { preparing.delete(setId); }
}
function route(fn) {
  return async (req, res) => {
    try { res.json(await fn(req)); }
    catch (error) {
      if (error.name === 'TimeoutError') return res.status(504).json({ error: 'Catalog request timed out. Retry later; no credits were spent.' });
      if (!error.status) console.error(error);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error' });
    }
  };
}
router.get('/', route(() => sim.state()));
router.post('/prepare', route(req => prepareSet(req.body.setId)));
router.post('/packs/buy', route(req => sim.purchase(req.body.setId, req.body.expectedCents, req.body.key)));
router.post('/packs/open', route(req => sim.open(req.body.setId, req.body.key)));
router.post('/packs/:id/reveal', route(req => sim.reveal(Number(req.params.id), req.body.count, req.body.trick === true)));
router.post('/daily', route(req => sim.daily(req.body.key)));
router.post('/credits', requireAdmin, route(req => sim.grant(req.body.cents, req.body.key, req.user.username)));
router.post('/trade', route(req => sim.trade(req.body)));
router.get('/market', route(req => sim.market({ name: req.query.name, set: req.query.set, page: Number(req.query.page || 1) })));
router.post('/binders', route(req => sim.createBinder(req.body)));
router.get('/binders/:id', route(req => sim.binder(Number(req.params.id))));
router.put('/binders/:id/slots/:position', route(req => sim.place(Number(req.params.id), Number(req.params.position),
  req.body.cardId ? { cardId: req.body.cardId, variant: req.body.variant } : null)));
router.delete('/binders/:id', route(req => sim.deleteBinder(Number(req.params.id))));
export default router;
