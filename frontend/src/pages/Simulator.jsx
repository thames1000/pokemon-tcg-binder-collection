import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import BinderSlot from '../components/BinderSlot.jsx';

const sim = api.simulator;
const money = cents => `$${(cents / 100).toFixed(2)}`;
const TABS = ['Pack shop', 'Opening table', 'Virtual collection', 'Singles market', 'Virtual binders', 'Bank activity'];

function CardFace({ card, variant }) {
  return <>
    {card.images?.small ? <img className="sim-card-image" src={card.images.small} alt={card.name} loading="lazy" /> : <div className="sim-energy">{card.supertype === 'Energy' ? '⚡' : '◇'}<span>{card.supertype === 'Energy' ? card.name : 'No card image'}</span></div>}
    <h3>{card.name}</h3>
    <p className="muted">{card.set?.name} {card.number ? `· #${card.number}` : ''}</p>
    {variant && <span className="sim-chip">{variant}</span>}
  </>;
}
function TradingCard({ card, variants, ownedByPrint, balance, busy, onTrade }) {
  const [choice, setChoice] = useState('');
  const selected = variants.find(v => v.variant === choice) || variants[0];
  const owned = ownedByPrint.get(`${card.id}:${selected?.variant}`) || 0;
  const price = selected?.quote;
  const buyable = selected?.buyable !== false; // market listings are always buyable; inventory rows say otherwise
  return <article className="sim-card">
    <CardFace card={card} />
    {variants.length > 1 ? <select aria-label={`Print of ${card.name}`} value={selected.variant} onChange={e => setChoice(e.target.value)}>{variants.map(v => <option key={v.variant}>{v.variant}</option>)}</select> : <p>{selected?.variant || 'No priced prints'}</p>}
    <p>Owned: <strong>{owned}</strong>{price && <> · Market {money(price.marketCents)}{price.source !== 'TCGplayer' && <small className="muted"> via {price.source}</small>}</>}</p>
    <div className="sim-actions">
      <button disabled={busy || !price || !buyable || balance < price.buyCents} onClick={() => onTrade(card.id, selected.variant, 'buy', price.buyCents)}>Buy {price ? money(price.buyCents) : '—'}</button>
      <button disabled={busy || !price || !owned} onClick={() => onTrade(card.id, selected.variant, 'sell', price.sellCents)}>Sell {price ? money(price.sellCents) : '—'}</button>
    </div>
    {!price && <small className="muted">No price found for this print. Trading unavailable.</small>}
    {price && !buyable && <small className="muted">Sellable at the card’s quote; the Singles market lists this card as a different print, so this exact print can’t be re-bought.</small>}
  </article>;
}

export default function Simulator({ user }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState(TABS[0]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const keys = useRef(new Map());
  const stateSeq = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inventorySearch, setInventorySearch] = useState('');
  const [packSearch, setPackSearch] = useState('');
  const [packSeries, setPackSeries] = useState('');
  const [packAffordable, setPackAffordable] = useState(false);
  const [marketName, setMarketName] = useState('');
  const [marketSet, setMarketSet] = useState('');
  const [marketQuery, setMarketQuery] = useState({ name: '', set: '', page: 1 });
  const [market, setMarket] = useState(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [marketRefresh, setMarketRefresh] = useState(0);
  const [creditAmount, setCreditAmount] = useState('');
  const [binderName, setBinderName] = useState('');
  const [binderPages, setBinderPages] = useState(4);
  const [masterSetId, setMasterSetId] = useState('');
  const [binderId, setBinderId] = useState('');
  const [binder, setBinder] = useState(null);
  const [binderPage, setBinderPage] = useState(0);
  const [binderError, setBinderError] = useState('');
  const [placement, setPlacement] = useState('');

  const load = useCallback(async () => {
    const seq = ++stateSeq.current;
    const next = await sim.state();
    if (seq === stateSeq.current) setData(next);
    return next;
  }, []);
  useEffect(() => { load().catch(e => setError(e.message)); return () => { stateSeq.current++; }; }, [load]);

  // apply: 'opening' and 'binder' apply the mutation's own response directly
  // instead of refetching the full simulator state — a slot placement already
  // returns the whole binder, so a refetch would just re-download it.
  async function act(signature, action, message, apply) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    const key = keys.current.get(signature) || crypto.randomUUID();
    keys.current.set(signature, key);
    try {
      const result = await action(key);
      // The server acknowledged the mutation. A subsequent refresh failure must
      // not cause the next deliberate purchase to replay this completed action.
      keys.current.delete(signature);
      if (apply === 'opening') setData(current => ({ ...current, lastOpening: result }));
      else if (apply === 'binder') setBinder(result);
      else await load();
      setNotice(result?.milestone ? 'Ten packs opened! A free pack has been added to your shop inventory.' : message || 'Saved.');
      return result;
    } catch (e) { setError(`${e.message} If the connection was interrupted, retry the same action or refresh your bank before continuing.`); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function trade(cardId, variant, side, expectedCents) {
    return act(`trade:${cardId}:${variant}:${side}:${expectedCents}`, key => sim.trade({ cardId, variant, side, expectedCents, key }), `${side === 'buy' ? 'Bought' : 'Sold'} one virtual card.`);
  }
  useEffect(() => {
    if (tab !== 'Singles market') return;
    let ignore = false; setMarketLoading(true); setMarketError(''); setMarket(null);
    sim.market(marketQuery).then(value => { if (!ignore) setMarket(value); }).catch(e => { if (!ignore) setMarketError(e.message); }).finally(() => { if (!ignore) setMarketLoading(false); });
    return () => { ignore = true; };
  }, [tab, marketQuery, marketRefresh]);
  useEffect(() => {
    setBinder(null); setBinderError('');
    if (!binderId || tab !== 'Virtual binders') return;
    let ignore = false;
    sim.binder(binderId).then(value => { if (!ignore) setBinder(value); }).catch(e => { if (!ignore) setBinderError(e.message); });
    return () => { ignore = true; };
  }, [binderId, data, tab]);

  const opening = data?.lastOpening;
  const ownedByPrint = useMemo(() => new Map(data?.items.map(i => [`${i.cardId}:${i.variant}`, i.quantity]) || []), [data]);
  const definition = data?.packs.find(p => p.id === opening?.setId) || (opening && { name: opening.setId, trick: 0 });
  const seriesList = useMemo(() => [...new Set(data?.packs.map(p => p.series) || [])], [data]);
  // tone comes from the position in the full list so tile colors stay put while filtering
  const packQuery = packSearch.trim().toLowerCase();
  const shownPacks = data?.packs.map((p, i) => ({ ...p, tone: i % 4 })).filter(p => (!packSeries || p.series === packSeries)
    && (!packAffordable || (p.ready ? p.priceCents <= data.balanceCents : data.balanceCents >= 400))
    && `${p.name} ${p.id} ${p.series}`.toLowerCase().includes(packQuery)) || [];
  const unfinished = opening && opening.revealed < opening.cards.length;
  const shown = opening?.cards.slice(0, opening.revealed) || [];
  const items = data?.items.filter(i => `${i.card.name} ${i.card.set?.name} ${i.variant}`.toLowerCase().includes(inventorySearch.toLowerCase())) || [];

  return <div className="page simulator">
    <div className="sim-heading"><div><span className="sim-eyebrow">A collection of possibilities</span><h1>Pack opening simulator</h1><p className="page-subtitle">Open a pack. Chase a favorite. Build a collection that’s entirely virtual.</p></div><span className="sim-chip">Virtual credits · No real money</span></div>
    {error && <div className="error-text" role="alert">{error} <button disabled={busy} onClick={() => act('refresh', () => Promise.resolve(), 'Bank refreshed.')}>Refresh bank</button></div>}
    {notice && <p className="sim-notice" role="status">{notice}</p>}
    {!data ? <p role="status">{error ? 'Simulator unavailable. Start the updated backend and retry.' : 'Loading your virtual collection…'}</p> : <>
      <div className="sim-stats">
        <div><span>Spendable balance</span><strong>{money(data.balanceCents)}</strong><small>Virtual credits</small></div>
        <div><span>Collection sale value</span><strong>{money(data.sellValueCents)}</strong><small>{data.unpricedCards} cards without a price excluded</small></div>
        <div><span>Simulated bank value</span><strong>{money(data.bankValueCents)}</strong><small>Balance + collection sale value</small></div>
        <div><span>Packs opened</span><strong>{data.opened}</strong><small>{10 - data.opened % 10} until a free pack</small></div>
      </div>
      <div className="sim-reward"><div><strong>A little boost for your next chase</strong><p>Claim $5 daily. Every ten openings earns a free pack of the set just opened.</p></div><button className="btn-primary" disabled={busy || !data.dailyAvailable} onClick={() => act('daily', sim.daily, '$5 daily allowance added.')}>{data.dailyAvailable ? 'Claim daily $5' : 'Claimed · resets 00:00 UTC'}</button></div>
      <nav className="sim-tabs" aria-label="Simulator sections">{TABS.map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{t}</button>)}</nav>

      {tab === 'Pack shop' && <>
        {unfinished && <p className="sim-notice">An opened pack is waiting. <button onClick={() => setTab('Opening table')}>Resume opening</button></p>}
        <p className="muted">Start with $25. Every expansion in the shared set library is openable: prepare a set once to load its complete card list and set its pack price. Packs cost at least $4; sets with valuable singles cost proportionally more, so ripping and reselling averages a loss. Vintage and promo products can run into the hundreds — chase their singles, or save up for the rip.</p>
        <form className="search-bar" onSubmit={e => e.preventDefault()}>
          <input aria-label="Search packs" value={packSearch} onChange={e => setPackSearch(e.target.value)} placeholder="Find a set…" maxLength={100} />
          <select aria-label="Filter packs by series" value={packSeries} onChange={e => setPackSeries(e.target.value)}><option value="">All series</option>{seriesList.map(s => <option key={s}>{s}</option>)}</select>
          <label><input type="checkbox" checked={packAffordable} onChange={e => setPackAffordable(e.target.checked)} /> Affordable now</label>
        </form>
        <p className="muted">{shownPacks.length === data.packs.length ? `${data.packs.length} packs, newest first` : `${shownPacks.length} of ${data.packs.length} packs match`}</p>
        {shownPacks.length === 0 && <p className="sim-empty">No packs match that search. Try part of a set name, a set code like “sv1”, or a series.</p>}
        <div className="sim-pack-grid">{shownPacks.map(p => <article className={`sim-pack sim-pack-${p.tone}`} key={p.id}>
          <span className="sim-chip">{p.special ? 'Special product · approximate pack' : `${p.cardsPerPack} cards${p.era === 'sm' || p.era === 'sv' ? ' incl. Basic Energy' : ''}`}</span><div className="sim-pack-art" aria-hidden="true">{p.logo ? <img src={p.logo} alt="" loading="lazy" /> : '✦'}</div><h2>{p.name}</h2><p className="muted">{p.series}{p.releaseDate ? ` · ${p.releaseDate.slice(0, 4)}` : ''}</p><p>{p.trick} to the front · {p.count} unopened</p><strong>{p.priceCents == null ? 'From $4.00' : money(p.priceCents)}</strong>{p.priceCents == null && <small className="muted">Final price set when prepared</small>}
          <div className="sim-actions">{!p.ready ? <button disabled={busy} onClick={() => act(`prepare:${p.id}`, () => sim.prepare(p.id), `${p.name} is ready to open.`)}>Prepare set</button> : <button disabled={busy || data.balanceCents < p.priceCents} onClick={() => act(`purchase:${p.id}:${p.priceCents}`, key => sim.buyPack(p.id, p.priceCents, key), 'Pack added to your unopened inventory.')}>Buy pack</button>}
            <button disabled={busy || !p.count || !!unfinished} onClick={async () => { const result = await act(`open:${p.id}`, key => sim.openPack(p.id, key), 'Pack opened. Your pulls are saved; reveal them at your own pace.'); if (result) setTab('Opening table'); }}>Open pack</button>
            {p.ready && <button disabled={busy} onClick={() => act(`prepare:${p.id}`, () => sim.prepare(p.id), `${p.name} pack price refreshed from current card prices.`)}>Refresh price</button>}</div>
        </article>)}</div>
        <details className="sim-rules"><summary>Pack layouts, simulated odds & economy rules</summary>
          <p>Every English expansion in the set library is openable, using the closest of four era layouts. Special products keep their real card lists but use these approximate layouts; unusual collation rules are not modeled. Code cards are omitted.</p>
          <p>Base through Neo: seven commons, rare slot, three uncommons, no reverse foil. Legendary Collection and e-Card onward through XY (and unlisted products): five commons, reverse foil, rare slot, three uncommons. Sun & Moon / Sword & Shield: the same, with a Basic Energy before the final three uncommons. Move the final three or four cards to the front before revealing.</p>
          <p>Scarlet & Violet and Mega Evolution: four commons, three uncommons, two foil slots, rare-or-higher slot, then Basic Energy. Move the final Energy to the front.</p>
          <p>Energy slots pull real Basic Energy cards printed in that set when it has any; otherwise you get a labeled simulator placeholder with no market quote. Sets missing a conventional rarity pool (promo and all-holo products) fill each slot from the nearest available pool instead.</p>
          <p>Game odds: the rare slot is 20% higher rarity; older packs otherwise have 25% holo and 55% regular rare. Scarlet & Violet otherwise guarantees a holo rare and has an independent 10% illustration replacement in its second foil slot. Eligible cards within each pool are equally likely; duplicates can occur. These are simplified simulated odds, not official pull rates.</p>
          <p>Pack prices are set when a set is prepared: 125% of the pack’s expected resale value (rounded up to 25¢), with a $4 floor — so opening packs purely to resell the pulls averages a loss for every set. Products without booster-style rarities are labeled “Special product.”</p>
          <p>Singles buy at 110% (rounded up) and sell at 90% (rounded down) of the cached market price, in cents. Prices resolve the same way your collection values cards: print-specific TCGplayer, then Cardmarket, then the TCGdex fallback — amounts count 1:1 as credits whatever the source currency, just like the collection total. Prints TCGplayer confirms don’t exist, and cards with no price anywhere, cannot be traded. Bank value excludes unpriced cards and unopened packs. Prices can be stale; refresh a card through Price Lookup when needed, then refresh quotes here. Rewards reset at midnight UTC with no streak penalty.</p>
        </details>
      </>}

      {tab === 'Opening table' && <section className="sim-opening">
        {!opening ? <div className="sim-empty"><h2>Your next favorite is waiting</h2><p>Buy a pack in the shop, then open it here.</p><button onClick={() => setTab('Pack shop')}>Visit pack shop</button></div> : <>
          <div className="sim-heading"><div><h2>{definition.name}</h2><p>{opening.revealed} / {opening.cards.length} revealed · Pulls are already saved to your virtual collection.</p></div><span className="sim-chip">{opening.source}</span></div>
          <div className="sim-actions">
            {definition.trick > 0 && <button disabled={busy || opening.revealed > 0 || opening.tricked} onClick={() => act(`trick:${opening.id}`, () => sim.reveal(opening.id, { trick: true }), `Moved the last ${definition.trick} cards to the front.`, true)}>{opening.tricked ? 'Pack trick applied' : `Pack trick · ${definition.trick} to the front`}</button>}
            <button className="btn-primary" disabled={busy || !unfinished} onClick={() => act(`reveal:${opening.id}:${opening.revealed + 1}`, () => sim.reveal(opening.id, { count: opening.revealed + 1 }), 'Card revealed.', 'opening')}>Reveal next card</button>
            <button disabled={busy || !unfinished} onClick={() => act(`all:${opening.id}`, () => sim.reveal(opening.id, { count: opening.cards.length }), 'All cards revealed.', 'opening')}>Reveal all</button>
            {!unfinished && <button onClick={() => setTab('Pack shop')}>Choose another pack</button>}
          </div>
          <div className="sim-reveal-stage" aria-live="polite">{shown.length ? <article className="sim-card sim-revealed" key={`${opening.id}:${shown.length}`}><span className="sim-chip">{shown.at(-1).slot}</span><CardFace card={shown.at(-1).card} variant={shown.at(-1).variant} /></article> : <div className="sim-card-back"><span>✦</span><strong>Ready when you are</strong><small>Try the pack trick before the first reveal</small></div>}</div>
          <div className="sim-pulls">{shown.map((entry, i) => <article className="sim-card" key={i}><small>#{i + 1} · {entry.slot}</small><CardFace card={entry.card} variant={entry.variant} /></article>)}</div>
        </>}
      </section>}

      {tab === 'Virtual collection' && <>
        <div className="sim-heading"><h2>Your virtual cards · {data.items.reduce((n, i) => n + i.quantity, 0)}</h2><Link to="/collection">View real collection →</Link></div>
        <label className="sim-search">Find a virtual card<input value={inventorySearch} onChange={e => setInventorySearch(e.target.value)} placeholder="Name, set, or print…" /></label>
        {!items.length && <p className="sim-empty">No matching virtual cards. Open a pack or buy a single to begin.</p>}
        <div className="sim-card-grid">{items.map(item => <TradingCard key={item.id} card={item.card} variants={[{ variant: item.variant, quote: item.quote, buyable: item.buyable }]} ownedByPrint={ownedByPrint} balance={data.balanceCents} busy={busy} onTrade={trade} />)}</div>
      </>}

      {tab === 'Singles market' && <>
        <h2>Chase the one you want</h2><p className="muted">Search the shared, locally cached card library. Prepare packs or browse the main Library to add more cards to this market. Prices resolve exactly like your collection: print-specific TCGplayer first, then Cardmarket or the TCGdex fallback for cards TCGplayer doesn’t cover.</p>
        <form className="search-bar" onSubmit={e => { e.preventDefault(); setMarketQuery({ name: marketName, set: marketSet, page: 1 }); }}>
          <input aria-label="Search singles" value={marketName} onChange={e => setMarketName(e.target.value)} placeholder="Find a Pokémon…" maxLength={100} />
          <select aria-label="Singles set" value={marketSet} onChange={e => setMarketSet(e.target.value)}><option value="">All cached sets</option>{data.packs.filter(p => p.ready).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button type="submit">Search</button><button type="button" onClick={() => setMarketRefresh(n => n + 1)}>Refresh quotes</button>
        </form>
        {marketLoading && <p role="status">Loading singles…</p>}{marketError && <p className="error-text" role="alert">{marketError}</p>}
        {market && <><p className="muted">{market.total} cached cards found</p><div className="sim-card-grid">{market.cards.map(({ card, variants }) => <TradingCard key={card.id} card={card} variants={variants} ownedByPrint={ownedByPrint} balance={data.balanceCents} busy={busy} onTrade={trade} />)}</div><div className="pagination"><button disabled={marketQuery.page <= 1 || marketLoading} onClick={() => setMarketQuery(q => ({ ...q, page: q.page - 1 }))}>← Previous</button><span>Page {marketQuery.page} of {Math.max(1, Math.ceil(market.total / 24))}</span><button disabled={marketQuery.page * 24 >= market.total || marketLoading} onClick={() => setMarketQuery(q => ({ ...q, page: q.page + 1 }))}>Next →</button></div></>}
      </>}

      {tab === 'Virtual binders' && <>
        <div className="sim-heading"><h2>A home for your virtual pulls</h2><Link to="/binders">View real binders →</Link></div>
        <p className="muted">Binder slots are plans, like the real Binders page: owned copies light up, missing ones stay dimmed until you pull or buy them. Create a prebuilt <strong>master set</strong> binder to chase a whole set — every card in number order, Common/Uncommon/Rare doubled as base + Reverse Holofoil, and every other slot filled by any print of its card. Complete it through pack openings or the Singles market. Manual placement uses cards from your virtual collection.</p>
        <form className="search-bar" onSubmit={async e => { e.preventDefault(); const result = await act(`msbinder:${masterSetId}`, key => sim.createBinder({ setId: masterSetId, key }), 'Master set binder created — every card and reverse in the set.'); if (result) { setBinderId(String(result.id)); setBinderPage(0); setMasterSetId(''); } }}>
          <label>Prebuilt master set<select aria-label="Master set" value={masterSetId} onChange={e => setMasterSetId(e.target.value)} required><option value="">Choose a prepared set…</option>{data.packs.filter(p => p.ready).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button disabled={busy || !masterSetId}>Create master set binder</button>
        </form>
        <form className="search-bar" onSubmit={async e => { e.preventDefault(); const result = await act(`binder:${binderName}:${binderPages}`, key => sim.createBinder({ name: binderName, pages: Number(binderPages), key }), 'Virtual binder created.'); if (result) { setBinderId(String(result.id)); setBinderPage(0); setBinderName(''); } }}>
          <input aria-label="New virtual binder name" value={binderName} onChange={e => setBinderName(e.target.value)} placeholder="Or name an empty binder" maxLength={80} required /><label>Pages<input aria-label="Binder pages" type="number" min="1" max="50" value={binderPages} onChange={e => setBinderPages(e.target.value)} required /></label><button disabled={busy}>Create empty binder</button>
        </form>
        {data.binders.length === 0 ? <p className="sim-empty">Create your first virtual binder above.</p> : <div className="sim-actions"><label>Binder <select value={binderId} onChange={e => { setBinderId(e.target.value); setBinderPage(0); }}><option value="">Choose a virtual binder</option>{data.binders.map(b => <option key={b.id} value={b.id}>{b.name}{b.planned ? ` · ${b.owned}/${b.planned} owned` : ''}</option>)}</select></label>{binderId && <button disabled={busy} onClick={async () => { if (!window.confirm('Delete this virtual binder? Your cards will stay in your virtual collection.')) return; const result = await act(`delete:${binderId}`, () => sim.deleteBinder(binderId), 'Virtual binder deleted.'); if (result) setBinderId(''); }}>Delete binder</button>}</div>}
        {binderError && <p className="error-text" role="alert">{binderError}</p>}
        {binder && <>
          <p className="muted">
            {binder.setName ? `${binder.setName} master set · ` : ''}
            {binder.plannedCount}/{binder.totalSlots} slots planned · {binder.ownedCount} owned
            {binder.plannedCount > 0 && ` (${Math.round((binder.ownedCount / binder.plannedCount) * 100)}%)`}
            {' · '}Est. {money(binder.estimate.remainingCents)} to complete
            {binder.estimate.unpricedRemaining > 0 && ` (+${binder.estimate.unpricedRemaining} not purchasable)`}
            {' · '}Owned sell value {money(binder.estimate.ownedValueCents)}
          </p>
          <label className="sim-search">Select a card, then click a slot<select value={placement} onChange={e => setPlacement(e.target.value)}><option value="">Clear slot</option>{data.items.map(i => <option key={i.id} value={i.id}>{i.card.name} · {i.card.set?.name} · {i.variant} (×{i.quantity})</option>)}</select></label>
          <div className="sim-binder-spread">{[0, 1].map(side => <section key={side}><h3>Page {binderPage + 1} · {side ? 'Back' : 'Front'}</h3><div className="binder-side-grid">{Array.from({ length: 9 }, (_, i) => { const pos = binderPage * 18 + side * 9 + i; return <div key={pos} className={busy ? 'sim-slot-busy' : ''}><BinderSlot slot={binder.slots.find(s => s.position === pos)} onClick={() => {
                if (busy) return;
                if (placement === '') { act(`place:${binderId}:${pos}:clear`, () => sim.place(binderId, pos, null), 'Slot cleared.', 'binder'); return; }
                const item = data.items.find(it => String(it.id) === placement);
                // Never let a stale selection degrade into clearing the slot.
                if (!item) { setError('That card is no longer in your virtual collection — pick another to place.'); return; }
                act(`place:${binderId}:${pos}:${placement}`, () => sim.place(binderId, pos, { cardId: item.cardId, variant: item.variant }), 'Virtual binder updated.', 'binder');
              }} /></div>; })}</div></section>)}</div>
          <div className="pagination"><button disabled={binderPage === 0} onClick={() => setBinderPage(p => p - 1)}>← Previous</button><span>Page {binderPage + 1} of {binder.pages}</span><button disabled={binderPage + 1 >= binder.pages} onClick={() => setBinderPage(p => p + 1)}>Next →</button></div>
        </>}
      </>}
      {tab === 'Bank activity' && <><h2>Recent virtual bank activity</h2><p className="muted">Your initial $25 starter balance plus these transactions funds your collection. Showing the latest 30 entries.</p>
        {user?.role === 'admin' && <form className="search-bar" onSubmit={e => {
          e.preventDefault();
          const cents = Math.round(Number(creditAmount) * 100);
          if (!Number.isSafeInteger(cents) || cents === 0) { setError('Enter a non-zero dollar amount, e.g. 100 or -25.'); return; }
          act(`credits:${cents}`, key => sim.grantCredits(cents, key), `${cents > 0 ? 'Added' : 'Removed'} ${money(Math.abs(cents))} of testing credits.`).then(result => { if (result) setCreditAmount(''); });
        }}>
          <label>Adjust credits (admin testing tool)<input aria-label="Credit adjustment in dollars" type="number" step="0.01" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} placeholder="Amount in dollars, negative subtracts" required /></label>
          <button disabled={busy}>Apply</button>
          <small className="muted">Recorded in the ledger below; the balance can’t go below $0.</small>
        </form>}<div className="sim-ledger">{data.ledger.length === 0 ? <p>No transactions yet.</p> : data.ledger.map(entry => <div key={entry.id}><span><strong>{entry.detail}</strong><small>{new Date(entry.created_at).toLocaleString()} · {entry.kind}</small></span><strong>{entry.cents > 0 ? '+' : entry.cents < 0 ? '−' : ''}{money(Math.abs(entry.cents))}</strong></div>)}</div></>}
    </>}
  </div>;
}
