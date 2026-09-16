import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createSimulator, makePack, quote, packFromSet, expectedSellCents } from '../simulator.js';

// One fixture set per era layout. sv1 declares a total so short catalogs fail;
// sm1/sv1 include Basic Energy prints, swsh1 deliberately has none (placeholder path).
const SETS = [
  { id: 'base1', name: 'Base', series: 'Base' },
  { id: 'xy1', name: 'XY', series: 'XY' },
  { id: 'sm1', name: 'Sun & Moon', series: 'Sun & Moon' },
  { id: 'swsh1', name: 'Sword & Shield', series: 'Sword & Shield' },
  { id: 'sv1', name: 'Scarlet & Violet', series: 'Scarlet & Violet', total: 70 },
];
const SET_ENERGIES = { sm1: 6, sv1: 6 };

function cardsFor(setId, energies = 0) {
  const rarities = ['Common', 'Uncommon', 'Rare', 'Rare Holo', 'Rare Holo EX', 'Rare Holo GX', 'Rare Holo V', 'Rare Holo VMAX', 'Rare Ultra', 'Rare Secret', 'Rare Rainbow', 'Double Rare', 'Ultra Rare', 'Hyper Rare', 'Illustration Rare', 'Special Illustration Rare'];
  const cards = Array.from({ length: 64 }, (_, i) => ({ id: `${setId}-${i}`, name: `Card ${i}`, number: String(i), set: { id: setId, name: setId }, rarity: rarities[i % rarities.length], tcgplayer: { prices: { normal: { market: 1 }, holofoil: { market: 2 }, reverseHolofoil: { market: .5 } } } }));
  for (let i = 0; i < energies; i++) cards.push({ id: `${setId}-energy-${i}`, name: `Energy ${i}`, number: String(64 + i), supertype: 'Energy', subtypes: ['Basic'], set: { id: setId, name: setId }, tcgplayer: { prices: { normal: { market: .1 } } } });
  return cards;
}
function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE card_cache(id TEXT PRIMARY KEY,data TEXT,name TEXT,set_id TEXT);
    CREATE TABLE collection_items(id INTEGER PRIMARY KEY, quantity INTEGER); INSERT INTO collection_items VALUES(1,7);
    CREATE TABLE binders(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO binders VALUES(1,'Real binder');
    CREATE TABLE wishlist_items(id INTEGER PRIMARY KEY,card_id TEXT); INSERT INTO wishlist_items VALUES(1,'real-card');
    CREATE TABLE value_snapshots(date TEXT PRIMARY KEY,total_value REAL); INSERT INTO value_snapshots VALUES('2026-09-16',123.45);`);
  let date = new Date('2026-09-16T12:00:00Z');
  const options = { now: () => date, random: n => n - 1 };
  const sim = createSimulator(db, options);
  db.prepare("INSERT INTO api_cache(cache_key,data,fetched_at) VALUES('sets',?,'2026-09-16 00:00:00')").run(JSON.stringify(SETS));
  for (const s of SETS) {
    const cards = cardsFor(s.id, SET_ENERGIES[s.id] || 0);
    for (const c of cards) db.prepare('INSERT INTO card_cache VALUES(?,?,?,?)').run(c.id, JSON.stringify(c), c.name, s.id);
    sim.prepare(s.id, cards, cards.length);
  }
  let counter = 0;
  const priceOf = id => sim.state().packs.find(p => p.id === id).priceCents;
  return { db, sim, options, priceOf, key: () => `request-${++counter}`, nextDay: () => { date = new Date(+date + 86400000); } };
}

test('quotes resolve like the collection: TCGplayer, then Cardmarket, then TCGdex fallback', () => {
  assert.deepEqual(quote(cardsFor('xy1')[0], 'Normal'), { marketCents: 100, buyCents: 110, sellCents: 90, source: 'TCGplayer' });
  // No TCGplayer data at all: Cardmarket and the TCGdex fallback are accepted,
  // counting 1:1 as credits whatever the currency — same as collection totals.
  assert.equal(quote({ cardmarket: { prices: { trendPrice: 50 } } }, 'Normal').marketCents, 5000);
  assert.equal(quote({ priceFallback: { amount: 10, currency: 'USD' } }, 'Reverse Holofoil').marketCents, 1000);
  assert.equal(quote({ priceFallback: { amount: 10, currency: 'EUR' } }, 'Normal').sellCents, 900);
  assert.equal(quote({}, 'Normal'), null);
  assert.equal(quote(cardsFor('xy1')[0], undefined), null); // never pricing.js's "any bucket" browsing branch
  assert.equal(quote(cardsFor('xy1')[0], 'Holofoil').buyCents, 220);
  assert.equal(quote({ tcgplayer: { prices: { normal: { market: Infinity } } } }, 'Normal'), null);
  // TCGplayer knows the card but not this print: authoritative, never quoted.
  assert.equal(quote({ tcgplayer: { prices: { normal: { market: 1 } } }, priceFallback: { amount: 10, currency: 'USD' } }, 'Holofoil'), null);
});

test('era layouts keep pack order, the trick places rare last, and energy comes from the set', () => {
  for (const s of SETS) {
    const p = packFromSet(s);
    const entries = makePack(cardsFor(s.id, SET_ENERGIES[s.id] || 0), p, n => n - 1);
    assert.equal(entries.length, p.cardsPerPack);
    const moved = [...entries.slice(-p.trick), ...entries.slice(0, -p.trick)];
    assert.equal(moved.at(-1).slot, 'Rare or higher');
    assert.equal(entries.filter(e => e.slot === 'Common').length, p.era === 'wotc' ? 7 : p.era === 'sv' ? 4 : 5);
    assert.equal(entries.filter(e => e.slot === 'Uncommon').length, 3);
    assert.equal(entries.filter(e => e.variant === 'Reverse Holofoil').length, p.era === 'sv' ? 2 : p.era === 'wotc' ? 0 : 1);
    const energy = entries.filter(e => e.slot === 'Basic Energy');
    assert.equal(energy.length, ['sm', 'sv'].includes(p.era) ? 1 : 0);
    if (energy.length && SET_ENERGIES[s.id]) {
      assert.equal(energy[0].card.set.id, s.id);
      assert.ok(quote(energy[0].card, 'Normal')); // real set energies are tradable
    } else if (energy.length) {
      assert.ok(energy[0].cardId.startsWith('sim-energy-'));
      assert.equal(quote(energy[0].card, 'Normal'), null);
    }
    if (energy.length) assert.equal(moved[0].slot, 'Basic Energy');
    assert.ok(entries.every(e => e.card.set?.id === s.id || e.cardId.startsWith('sim-energy-')));
  }
});

test('pack layouts match their exact expected value in every era', () => {
  // Pins makePack and expectedSellCents together: if someone edits a slot
  // count or roll threshold in one, a fair sample of the other drifts and fails.
  for (const s of SETS) {
    const p = packFromSet(s);
    const cards = cardsFor(s.id, SET_ENERGIES[s.id] || 0);
    const analytic = expectedSellCents(cards, p);
    const random = n => Math.floor(Math.random() * n);
    const runs = 4000;
    let total = 0;
    for (let i = 0; i < runs; i++) for (const e of makePack(cards, p, random)) total += quote(e.card, e.variant)?.sellCents || 0;
    const sampled = total / runs;
    assert.ok(Math.abs(sampled - analytic) / analytic < 0.1, `${s.id}: sampled ${sampled} vs analytic ${analytic}`);
  }
});

test('deterministic hit and illustration branches remain in correct foil slots', () => {
  const p = packFromSet(SETS.find(s => s.id === 'sv1'));
  const entries = makePack(cardsFor('sv1', 6), p, () => 0);
  assert.equal(entries[8].slot, 'Illustration slot');
  assert.equal(entries[8].card.rarity, 'Illustration Rare');
  assert.equal(entries[8].variant, 'Holofoil');
  assert.ok(!['Common', 'Uncommon', 'Rare', 'Rare Holo'].includes(entries[9].card.rarity));
  assert.equal(entries[10].card.supertype, 'Energy');
  assert.equal(entries[10].card.set.id, 'sv1');
});

test('incomplete, duplicate, wrong set, unknown set, and short catalogs fail before purchase', () => {
  const { sim, db, key } = setup();
  const cards = cardsFor('xy1');
  assert.throws(() => sim.prepare('xy1', cards.slice(1), 64), /Incomplete/);
  assert.throws(() => sim.prepare('xy1', cards.map(() => cards[0]), 64), /Incomplete/);
  assert.throws(() => sim.prepare('sm1', cards, 64), /Incomplete/);
  assert.throws(() => sim.prepare('not-a-set', cards, 64), /Unsupported/);
  assert.throws(() => sim.prepare('sv1', cardsFor('sv1', 6).slice(0, 64), 64), /64 of 70/);
  sim.prepare('sv1', cardsFor('sv1', 6).slice(0, 68), 68); // small declared-total drift is tolerated
  db.prepare('DELETE FROM sim_catalog WHERE set_id=?').run('xy1');
  assert.throws(() => sim.purchase('xy1', 400, key()), /Prepare/);
  assert.equal(sim.state().balanceCents, 2500);
  db.close();
});

test('pack prices scale with expected resale value, floor at $4, and verify like quotes', () => {
  const { sim, db, key } = setup();
  const packState = id => sim.state().packs.find(p => p.id === id);
  const priced = packState('xy1');
  // Exact: 5 commons (90) + reverse (45) + rare mix (.2*180 + .25*180 + .55*90
  // = 130.5) + 3 uncommons (90) = 895.5 EV -> ceil(895.5 * 1.25 / 25) * 25.
  assert.equal(priced.priceCents, 1125);
  assert.equal(priced.special, false);
  assert.throws(() => sim.purchase('xy1', 400, key()), /price changed/);
  assert.throws(() => sim.purchase('xy1', 1.5, key()), /Invalid/);
  assert.equal(sim.state().balanceCents, 2500);
  db.prepare('DELETE FROM sim_catalog WHERE set_id=?').run('base1');
  const unprepared = packState('base1');
  assert.equal(unprepared.ready, false);
  assert.equal(unprepared.priceCents, null);
  db.close();
});

test('promo-only sets open through pool fallbacks and new cached sets become packs', () => {
  const { sim, db, key } = setup();
  db.prepare("UPDATE api_cache SET data=?, fetched_at='2026-09-17 00:00:00' WHERE cache_key='sets'")
    .run(JSON.stringify([...SETS, { id: 'promo1', name: 'Promos', series: 'Other' }]));
  const promos = Array.from({ length: 12 }, (_, i) => ({ id: `promo1-${i}`, name: `Promo ${i}`, rarity: 'Promo', set: { id: 'promo1', name: 'Promos' } }));
  for (const c of promos) db.prepare('INSERT INTO card_cache VALUES(?,?,?,?)').run(c.id, JSON.stringify(c), c.name, 'promo1');
  sim.prepare('promo1', promos, 12);
  const promoPack = sim.state().packs.find(p => p.id === 'promo1');
  assert.equal(promoPack.priceCents, 400); // no quotes at all: price floors at $4
  assert.equal(promoPack.special, true);
  sim.purchase('promo1', 400, key());
  const opened = sim.open('promo1', key());
  const view = sim.state().lastOpening;
  assert.equal(view.cards.length, 10); // unlisted series use the classic layout
  assert.ok(view.cards.every(e => e.card.rarity === 'Promo'));
  sim.reveal(opened.id, 10, false);
  db.close();
});

test('a tricked opening from a set later missing from the cache stays readable, untricked', () => {
  const { sim, db, key, priceOf } = setup();
  sim.purchase('sm1', priceOf('sm1'), key());
  const opened = sim.open('sm1', key());
  const tricked = sim.reveal(opened.id, undefined, true);
  assert.equal(tricked.cards[0].slot, 'Basic Energy');
  db.prepare("UPDATE api_cache SET data=?, fetched_at='2026-09-18 00:00:00' WHERE cache_key='sets'")
    .run(JSON.stringify(SETS.filter(s => s.id !== 'sm1')));
  const view = sim.state().lastOpening;
  assert.equal(view.cards.length, 11);
  assert.equal(view.cards[0].slot, 'Common'); // face-up order, no rotation applied
  db.close();
});

test('fallback-priced sets quote like the collection and trade as a single print', () => {
  const { sim, db, key } = setup();
  db.prepare("UPDATE api_cache SET data=?, fetched_at='2026-09-19 00:00:00' WHERE cache_key='sets'")
    .run(JSON.stringify([...SETS, { id: 'new1', name: 'Brand New', series: 'Mega Evolution' }]));
  const cards = Array.from({ length: 12 }, (_, i) => ({
    id: `new1-${i}`, name: `New ${i}`, rarity: ['Common', 'Uncommon', 'Rare'][i % 3],
    set: { id: 'new1', name: 'Brand New' },
  }));
  for (const c of cards) db.prepare('INSERT INTO card_cache VALUES(?,?,?,?)').run(c.id, JSON.stringify(c), c.name, 'new1');
  // Prepared before any prices exist: the pack sits at the floor.
  sim.prepare('new1', cards, 12);
  assert.equal(sim.state().packs.find(p => p.id === 'new1').priceCents, 400);
  // Prices arriving later (sync / Price Lookup) do NOT move the persisted pack
  // price on their own — re-preparing does. This is the "Refresh price" contract.
  const priced = cards.map((c, i) => ({ ...c, priceFallback: { amount: 2, currency: i % 2 ? 'EUR' : 'USD', source: 'TCGdex (TCGplayer)', variant: i === 1 ? 'holofoil' : 'normal' } }));
  const upd = db.prepare('UPDATE card_cache SET data=? WHERE id=?');
  for (const c of priced) upd.run(JSON.stringify(c), c.id);
  assert.equal(sim.state().packs.find(p => p.id === 'new1').priceCents, 400);
  sim.prepare('new1', priced, 12);
  assert.ok(sim.state().packs.find(p => p.id === 'new1').priceCents > 400); // fallback prices drive EV pricing too
  // Each card lists as the single print its fallback actually priced.
  const market = sim.market({ name: 'New', set: 'new1', page: 1 });
  const listed = id => market.cards.find(c => c.card.id === id).variants.map(v => v.variant);
  assert.deepEqual(listed('new1-0'), ['Normal']);
  assert.deepEqual(listed('new1-1'), ['Holofoil']);
  assert.equal(market.cards[0].variants[0].quote.marketCents, 200);
  // Buys are gated to the listed print; sells of any owned variant stay open.
  assert.throws(() => sim.trade({ cardId: 'new1-0', variant: 'Holofoil', side: 'buy', expectedCents: 220, key: key() }), /cannot be bought/);
  assert.throws(() => sim.trade({ cardId: 'new1-1', variant: 'Normal', side: 'buy', expectedCents: 220, key: key() }), /cannot be bought/);
  sim.trade({ cardId: 'new1-0', variant: 'Normal', side: 'buy', expectedCents: 220, key: key() });
  sim.trade({ cardId: 'new1-0', variant: 'Normal', side: 'sell', expectedCents: 180, key: key() });
  sim.trade({ cardId: 'new1-1', variant: 'Holofoil', side: 'buy', expectedCents: 220, key: key() });
  sim.trade({ cardId: 'new1-1', variant: 'Holofoil', side: 'sell', expectedCents: 180, key: key() });
  assert.equal(sim.state().balanceCents, 2500 - 220 + 180 - 220 + 180);
  // Foil pulls of fallback-priced cards sell fine but are flagged un-buyable,
  // so the UI never offers a buy the trade gate would refuse.
  sim.purchase('new1', sim.state().packs.find(p => p.id === 'new1').priceCents, key());
  const opened = sim.open('new1', key());
  sim.reveal(opened.id, 11, false);
  const pulls = sim.state().items.filter(i => i.card.set?.id === 'new1');
  const foil = pulls.find(i => i.variant === 'Reverse Holofoil' && i.quote);
  assert.equal(foil.buyable, false);
  assert.ok(pulls.some(i => i.buyable));
  sim.trade({ cardId: foil.cardId, variant: 'Reverse Holofoil', side: 'sell', expectedCents: foil.quote.sellCents, key: key() });
  db.close();
});

test('catalogs prepared before price persistence backfill their pack price once', () => {
  const { sim, db } = setup();
  db.prepare("UPDATE sim_catalog SET price_cents=NULL WHERE set_id='xy1'").run();
  assert.equal(sim.state().packs.find(p => p.id === 'xy1').priceCents, 1125);
  assert.equal(db.prepare("SELECT price_cents FROM sim_catalog WHERE set_id='xy1'").get().price_cents, 1125);
  db.close();
});

test('a missing sets cache falls back to the four launch sets', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE card_cache(id TEXT PRIMARY KEY,data TEXT,name TEXT,set_id TEXT)');
  const sim = createSimulator(db);
  assert.deepEqual(sim.packs().map(p => p.id), ['xy1', 'sm1', 'swsh1', 'sv1']);
  assert.deepEqual(sim.packs().map(p => p.trick), [3, 4, 4, 1]);
  db.close();
});

test('purchase and opening replay persist results, no double charges or rerolls', () => {
  const { sim, db, key, options, priceOf } = setup();
  const price = priceOf('swsh1');
  const buyKey = key(); const p = sim.purchase('swsh1', price, buyKey);
  assert.deepEqual(sim.purchase('swsh1', price, buyKey), p);
  assert.equal(sim.state().balanceCents, 2500 - price);
  const openKey = key(); const opened = sim.open('swsh1', openKey);
  const before = sim.state();
  assert.equal(before.items.reduce((sum, i) => sum + i.quantity, 0), 11);
  assert.deepEqual(sim.open('swsh1', openKey), opened);
  const restarted = createSimulator(db, options);
  assert.deepEqual(restarted.state(), before);
  assert.throws(() => sim.purchase('sm1', priceOf('sm1'), buyKey), /different action/);
  sim.purchase('swsh1', price, key());
  assert.throws(() => sim.open('swsh1', key()), /Finish revealing/);
  const tricked = sim.reveal(opened.id, undefined, true);
  assert.equal(tricked.cards[0].slot, 'Basic Energy');
  assert.ok(tricked.cards[0].cardId.startsWith('sim-energy-')); // swsh1 fixture has no set energies
  assert.deepEqual(sim.reveal(opened.id, undefined, true), tricked);
  sim.reveal(opened.id, 1, false);
  assert.throws(() => sim.reveal(opened.id, undefined, true), /before revealing/);
  assert.throws(() => sim.reveal(opened.id, 0, false), /Invalid/);
  assert.throws(() => sim.reveal(opened.id, 12, false), /Invalid/);
  assert.equal(sim.state().items.reduce((sum, i) => sum + i.quantity, 0), 11);
  db.close();
});

test('latest opening is by opening sequence rather than purchase ID', () => {
  const { sim, db, key, priceOf } = setup();
  const first = sim.purchase('xy1', priceOf('xy1'), key()); const second = sim.purchase('sv1', priceOf('sv1'), key());
  sim.open('sv1', key()); sim.reveal(second.id, 11, false);
  sim.open('xy1', key());
  assert.equal(sim.state().lastOpening.id, first.id);
  db.close();
});

test('trades are quoted server-side, reject overspending/overselling, and replay safely', () => {
  const { sim, db, key } = setup();
  const trade = { cardId: 'xy1-0', variant: 'Normal', side: 'buy', expectedCents: 110, key: key() };
  sim.trade(trade); sim.trade(trade);
  assert.equal(sim.state().balanceCents, 2390);
  assert.equal(sim.state().items[0].quantity, 1);
  assert.throws(() => sim.trade({ ...trade, key: key(), expectedCents: 1 }), /Price changed/);
  assert.throws(() => sim.trade({ ...trade, key: key(), expectedCents: 1.5 }), /Invalid/);
  assert.throws(() => sim.trade({ ...trade, key: key(), variant: 'fake' }), /Invalid/);
  const sale = { ...trade, side: 'sell', expectedCents: 90, key: key() };
  sim.trade(sale); sim.trade(sale);
  assert.equal(sim.state().balanceCents, 2480);
  assert.throws(() => sim.trade({ ...sale, key: key() }), /do not own/);
  db.prepare('UPDATE sim_wallet SET cents=50 WHERE id=1').run();
  const snapshot = sim.state();
  assert.throws(() => sim.trade({ ...trade, key: key() }), /Not enough/);
  assert.deepEqual(sim.state(), snapshot);
  db.close();
});

test('failed inventory write rolls back money and ledger', () => {
  const { sim, db, key } = setup();
  db.exec("CREATE TRIGGER reject_insert BEFORE INSERT ON sim_items BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  const before = sim.state();
  assert.throws(() => sim.trade({ cardId: 'xy1-0', variant: 'Normal', side: 'buy', expectedCents: 110, key: key() }), /test failure/);
  assert.deepEqual(sim.state(), before);
  db.close();
});

test('admin credit grants adjust the bank, replay safely, and appear in the ledger', () => {
  const { sim, db, key } = setup();
  const grantKey = key();
  assert.deepEqual(sim.grant(5000, grantKey, 'james'), { cents: 5000, balanceCents: 7500 });
  assert.deepEqual(sim.grant(5000, grantKey, 'james'), { cents: 5000, balanceCents: 7500 }); // idempotent replay
  assert.equal(sim.state().balanceCents, 7500);
  sim.grant(-2500, key(), 'james');
  assert.equal(sim.state().balanceCents, 5000);
  assert.throws(() => sim.grant(-99999, key(), 'james'), /Not enough/); // cannot take the bank below zero
  assert.throws(() => sim.grant(0, key(), 'james'), /cannot be zero/);
  assert.throws(() => sim.grant(1.5, key(), 'james'), /Invalid/);
  assert.throws(() => sim.grant(100000001, key(), 'james'), /Invalid/);
  assert.throws(() => sim.grant(100, key()), /Granting admin/);
  const grants = sim.state().ledger.filter(e => e.kind === 'admin');
  assert.equal(grants.length, 2);
  assert.ok(grants.every(e => e.detail.includes('james'))); // the audit trail names the admin
  db.close();
});

test('daily allowance is once per UTC day and milestone is awarded once per ten opens', () => {
  const { sim, db, key, nextDay, priceOf } = setup();
  const dailyKey = key(); sim.daily(dailyKey); sim.daily(dailyKey);
  assert.equal(sim.state().balanceCents, 3000);
  assert.throws(() => sim.daily(key()), /already claimed/);
  nextDay(); sim.daily(key()); nextDay(); sim.daily(key());
  assert.equal(sim.state().balanceCents, 4000);
  const price = priceOf('xy1');
  db.prepare('UPDATE sim_wallet SET cents=? WHERE id=1').run(price * 10);
  for (let i = 0; i < 10; i++) {
    sim.purchase('xy1', price, key());
    const openKey = key(); const result = sim.open('xy1', openKey);
    sim.open('xy1', openKey); sim.reveal(result.id, 10, false);
  }
  const state = sim.state();
  assert.equal(state.opened, 10);
  assert.equal(state.packs.find(p => p.id === 'xy1').count, 1);
  assert.equal(state.balanceCents, 0);
  assert.equal(state.ledger.filter(e => e.detail.includes('Ten-pack milestone')).length, 1);
  db.close();
});

test('virtual binders track variants and sales without modifying real tables', () => {
  const { sim, db, key } = setup();
  const tables = ['collection_items', 'binders', 'wishlist_items', 'value_snapshots'];
  const before = tables.map(t => db.prepare(`SELECT * FROM ${t}`).all());
  sim.trade({ cardId: 'xy1-0', variant: 'Normal', side: 'buy', expectedCents: 110, key: key() });
  const owned = { cardId: 'xy1-0', variant: 'Normal' };
  const b = sim.createBinder({ name: 'Virtual only', pages: 1, key: key() });
  sim.place(b.id, 0, owned); sim.place(b.id, 1, owned);
  assert.equal(sim.binder(b.id).slots[0].owned, true);
  // Slots are plans: an unowned (but locally known) card can be placed and stays dimmed.
  const planned = sim.place(b.id, 2, { cardId: 'xy1-5', variant: 'Holofoil' }).slots.find(s => s.position === 2);
  assert.equal(planned.owned, false);
  assert.equal(planned.quote.buyCents, 220);
  assert.throws(() => sim.place(b.id, 18, owned), /Invalid/);
  assert.throws(() => sim.place(b.id, -1, owned), /Invalid/);
  assert.throws(() => sim.place(b.id, 1, { cardId: 'ghost-card', variant: 'Normal' }), /not found/);
  assert.throws(() => sim.place(b.id, 1, { cardId: 'xy1-0', variant: 'Shiny' }), /Invalid placement/);
  assert.throws(() => sim.createBinder({ name: 'bad', pages: 1.5, key: key() }), /Invalid/);
  sim.trade({ cardId: 'xy1-0', variant: 'Normal', side: 'sell', expectedCents: 90, key: key() });
  assert.equal(sim.binder(b.id).slots[0].owned, false);
  sim.trade({ cardId: 'xy1-0', variant: 'Normal', side: 'buy', expectedCents: 110, key: key() });
  assert.equal(sim.binder(b.id).slots[0].owned, true);
  sim.place(b.id, 0, null); sim.deleteBinder(b.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sim_slots').get().n, 0);
  assert.deepEqual(tables.map(t => db.prepare(`SELECT * FROM ${t}`).all()), before);
  db.close();
});

test('prebuilt master set binders mirror the real binder page set auto-fill', () => {
  const { sim, db, key } = setup();
  const msKey = key();
  const created = sim.createBinder({ setId: 'sm1', key: msKey });
  assert.deepEqual(sim.createBinder({ setId: 'sm1', key: msKey }), created); // idempotent replay
  // sm1 fixture: 64 cards (16-rarity cycle) + 6 basic energies. C/U/R = 12
  // cards -> 24 paired slots; 52 higher rarities -> one Holofoil slot each;
  // 6 energies -> one Normal slot each.
  assert.equal(created.slots, 82);
  assert.equal(created.pages, Math.ceil(82 / 18));
  assert.throws(() => sim.createBinder({ setId: 'sm1', key: key() }), /already this set's master binder/);
  const b = sim.binder(created.id);
  assert.equal(b.name, 'Sun & Moon master set');
  assert.equal(b.setId, 'sm1');
  assert.deepEqual(b.slots.slice(0, 2).map(s => [s.cardId, s.variant]), [['sm1-0', 'Normal'], ['sm1-0', 'Reverse Holofoil']]);
  assert.equal(b.slots.find(s => s.cardId === 'sm1-3').variant, null); // Rare Holo: single any-print slot
  assert.ok(b.slots.filter(s => s.card.supertype === 'Energy').every(s => s.variant === null));
  assert.equal(b.ownedCount, 0);
  // All unowned: 12x110 Normal + 12x55 Reverse + 52x220 (null slots priced as
  // their preferred Holofoil print) + 6x11 energy (priced as Normal).
  assert.equal(b.estimate.remainingCents, 13486);
  assert.equal(b.estimate.unpricedRemaining, 0);
  // A null slot lights up from ANY print of its card.
  sim.trade({ cardId: 'sm1-3', variant: 'Normal', side: 'buy', expectedCents: 110, key: key() });
  assert.equal(sim.binder(created.id).slots.find(s => s.cardId === 'sm1-3').owned, true);
  // Pack pulls light the plan up with their exact prints.
  sim.grant(100000, key(), 'james');
  sim.purchase('sm1', sim.state().packs.find(p => p.id === 'sm1').priceCents, key());
  sim.reveal(sim.open('sm1', key()).id, 11, false);
  const after = sim.binder(created.id);
  assert.ok(after.ownedCount > 0);
  assert.ok(after.estimate.remainingCents < b.estimate.remainingCents);
  const listed = sim.state().binders.find(x => x.id === created.id);
  assert.equal(listed.planned, 82);
  assert.equal(listed.owned, after.ownedCount);
  // WotC-era sets had no reverse foils: no pair slots, every slot any-print.
  const wotc = sim.binder(sim.createBinder({ setId: 'base1', key: key() }).id);
  assert.equal(wotc.slots.length, 64);
  assert.ok(wotc.slots.every(s => s.variant === null));
  db.prepare('DELETE FROM sim_catalog WHERE set_id=?').run('sv1');
  assert.throws(() => sim.createBinder({ setId: 'sv1', key: key() }), /Prepare/);
  db.close();
});

test('every pack pull has a home in its master set plan', () => {
  const { sim, db, key } = setup();
  // POP-style product: only C/U/R rarities, so no foil pool exists and the
  // rare slot's fallback stamps Holofoil prints — the plan must go any-print.
  const popSet = { id: 'pop1', name: 'POP Series 1', series: 'POP' };
  const popCards = Array.from({ length: 17 }, (_, i) => ({ id: `pop1-${i}`, name: `Pop ${i}`, number: String(i), rarity: ['Common', 'Uncommon', 'Rare'][i % 3], set: { id: 'pop1', name: 'POP Series 1' }, tcgplayer: { prices: { normal: { market: 1 }, holofoil: { market: 2 }, reverseHolofoil: { market: .5 } } } }));
  db.prepare("UPDATE api_cache SET data=?, fetched_at='2026-09-20 00:00:00' WHERE cache_key='sets'").run(JSON.stringify([...SETS, popSet]));
  for (const c of popCards) db.prepare('INSERT INTO card_cache VALUES(?,?,?,?)').run(c.id, JSON.stringify(c), c.name, 'pop1');
  sim.prepare('pop1', popCards, 17);
  const catalogs = { base1: cardsFor('base1'), sm1: cardsFor('sm1', 6), sv1: cardsFor('sv1', 6), pop1: popCards };
  for (const setId of ['base1', 'sm1', 'sv1', 'pop1']) {
    const plan = sim.binder(sim.createBinder({ setId, key: key() }).id);
    if (setId === 'pop1') assert.ok(plan.slots.every(s => s.variant === null)); // no foil pool -> no exact pairs
    const cards = catalogs[setId];
    const pack = packFromSet([...SETS, popSet].find(s => s.id === setId));
    for (let run = 0; run < 60; run++) {
      for (const pull of makePack(cards, pack)) {
        if (pull.cardId.startsWith('sim-energy-')) continue; // labeled placeholder, not a set card
        assert.ok(
          plan.slots.some(s => s.cardId === pull.cardId && (s.variant === null || s.variant === pull.variant)),
          `${setId}: pulled ${pull.cardId} as ${pull.variant} but no slot accepts it`
        );
      }
    }
  }
  db.close();
});

test('legacy item-reference binder slots migrate to card/variant plans', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE card_cache(id TEXT PRIMARY KEY,data TEXT,name TEXT,set_id TEXT);
    CREATE TABLE sim_items (id INTEGER PRIMARY KEY, card_id TEXT NOT NULL, variant TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>=0), snapshot TEXT NOT NULL, UNIQUE(card_id,variant));
    CREATE TABLE sim_binders (id INTEGER PRIMARY KEY, name TEXT NOT NULL, pages INTEGER NOT NULL CHECK(pages BETWEEN 1 AND 50));
    CREATE TABLE sim_slots (binder_id INTEGER NOT NULL, position INTEGER NOT NULL, item_id INTEGER NOT NULL, PRIMARY KEY(binder_id,position));
    INSERT INTO sim_items VALUES (7, 'xy1-0', 'Normal', 1, '{"id":"xy1-0","name":"Card 0"}');
    INSERT INTO sim_binders(id,name,pages) VALUES (1, 'Legacy', 1);
    INSERT INTO sim_slots VALUES (1, 4, 7);`);
  const sim = createSimulator(db);
  assert.deepEqual(sim.binder(1).slots.map(s => [s.position, s.cardId, s.variant, s.owned]), [[4, 'xy1-0', 'Normal', true]]);
  db.close();
});

test('market pagination and bank totals include only supported quoted inventory', () => {
  const { sim, db, key } = setup();
  const result = sim.market({ name: 'Card', set: 'xy1', page: 1 });
  assert.equal(result.total, 64); assert.equal(result.cards.length, 24);
  assert.equal(sim.market({ name: 'nothing', page: 1 }).total, 0);
  assert.throws(() => sim.market({ page: 0 }), /Invalid/);
  assert.throws(() => sim.market({ name: [] }), /Invalid/);
  sim.trade({ cardId: 'xy1-0', variant: 'Normal', side: 'buy', expectedCents: 110, key: key() });
  const state = sim.state();
  assert.equal(state.sellValueCents, 90); assert.equal(state.bankValueCents, 2480);
  db.close();
});
