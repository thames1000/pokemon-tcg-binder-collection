# Pack opening simulator

Start the backend and frontend as usual, then choose **Pack Simulator** in the
navigation. Restart an already-running backend after installing this change.
Existing collection, wishlist, analytics and physical binders continue to represent
real cards only. The simulator shares the existing card catalog and SQLite file,
with separate `sim_*` tables for virtual holdings, binders, packs and money.

## Playing

- Begin with $25 in virtual USD credits. Claim $5 once per UTC calendar day.
- Every expansion in the shared set library appears in the pack shop, filterable
  by name and series. Prepare a set once. If a full card sync has completed,
  preparation uses the local catalog; otherwise it loads and validates the entire
  set from the card provider. Catalogs more than a few cards short of the set's
  declared count are rejected (small provider drift is tolerated; a set released
  after the last full sync is not silently prepared from a near-empty cache).
  Failed preparation spends nothing. Existing cached prices are retained.
- Purchase packs and open them from the shop. A pack's price is set when its set
  is prepared: 125% of the pack's expected resale value, rounded up to 25¢, with
  a $4 floor. Every ten openings grants a free pack of the set just opened.
  Rewards have no streak penalty.
- Use the pack trick before the first reveal, reveal cards individually, or reveal
  all. Pulls enter the virtual collection immediately on opening; reveal progress
  and ordering survive reloads. Finish the current opening before opening another.
- Buy and sell individual prints through Virtual Collection or Singles Market.
  Search uses all locally cached cards, including cards loaded by the existing
  Library, rather than an independent card database. Browse the Library or prepare
  more sets to expand the market.
- Virtual binders are plans, like the real Binders page: slots hold a (card,
  print) pair whether or not you own it, owned copies light up and missing ones
  stay dimmed, and each binder shows planned/owned counts plus an estimated
  cost to complete (buy prices of missing slots) and the sell value of what you
  hold. Create a prebuilt **master set** binder from any prepared set (one per
  set): every card in printed-number order. Common/Uncommon/Rare get an exact
  base + Reverse Holofoil pair (the base print is Holofoil in the Scarlet &
  Violet era), except WotC-era sets, which had no reverse foils. Every other
  slot — higher rarities, promos, energies, all WotC slots — accepts **any
  print of its card**, the same ownership rule the real binder page uses, so
  every pack pull lights up a slot no matter which foil it was dealt as (a
  tested invariant). Or create an empty binder (1–50 pages of front/back 3×3 grids)
  and place cards by hand: select a virtual card and click a slot, or Clear
  slot to remove one. The same card can occupy multiple slots. Selling your
  last copy dims every matching placement; buying that print again restores
  it — except non-listed prints of fallback-priced cards, which can only come
  back from pack pulls, so sell those placements knowingly. Completion
  estimates only count slots the singles market will actually sell; slots
  whose print can only come from packs are reported separately as not
  purchasable. Any-print slots are priced as the print the card most
  plausibly exists as.

## Economy choices

This version favors casual collecting: daily credits afford a floor-priced pack
even if all pulls are kept, opening milestones add a small bonus, and singles let
players chase a specific card. There is no real-money purchasing or cash value.

Pack prices are value-based rather than flat. When a set is prepared, the server
computes the exact expected resale value of one pack (each slot draws uniformly
from a known pool, so the expectation is a probability-weighted sum of pool
means — no sampling) and charges 125% of that (25¢ granularity, $4 minimum),
stored with the catalog and re-derived whenever the set is re-prepared.
Vintage and promo sets with valuable singles price accordingly — into the
hundreds of credits — so the shop offers an "Affordable now" filter and their
singles remain the practical way to chase them early on. Purchases submit the displayed price and are
rejected if it has changed, like single-card trades. A flat price was farmable:
at $4, one simulated Pokémon Rumble pack returned ~$1,177 in credits when sold
through, since a third of the catalog is promo or special products whose every
slot draws from high-value pools. Value pricing keeps every set's rip-and-sell
loop loss-making on average while leaving the chase (variance) intact. Products
without booster-style rarities are labeled "Special product" in the shop.

Single-card buys cost 110% of the cached market price (rounded up to cents);
sales return 90% (rounded down). The spread prevents an instant buy/sell loop
from earning credits. Quotes resolve exactly as the collection prices cards
(`cardMarketPrice`): print-specific TCGplayer first; when TCGplayer knows a card
but not a print, that print does not exist and is not traded; when TCGplayer has
no data for the card at all (common for very recent sets), the Cardmarket price
and then the TCGdex fallback are used, so new sets such as Mega Evolution are
tradable. Amounts count 1:1 as credits regardless of source currency, matching
how the collection totals mixed USD/EUR values (under 1% of cached cards
resolve to EUR, so the exposure is small). A TCGdex fallback price belongs to
one specific print — whichever bucket TCGdex exposes first, often the holofoil —
so the market lists such a card as that single print, and only that print can
be bought; Cardmarket trend prices are card-level and list as Normal. Pack
pulls can still enter the inventory under other foil variants: they always sell
at the same fallback quote (no arbitrage — the number is identical), but a
non-listed print cannot be re-bought once sold, and the UI disables its Buy
button and says so. If TCGplayer later gains data for such a card
without a bucket for a print you hold, that print stops quoting (TCGplayer is
authoritative that it was never made) and the copy moves from sale value into
the unpriced count. Cards with no price anywhere remain untradable. Sets
prepared fresh from the provider may lack fallback prices until refreshed
through sync or Price Lookup. Refresh prices there, then refresh the simulator
quotes; a prepared set's pack price is persisted at prepare time and re-derived
only by its shop "Refresh price" button (a local re-prepare when the set is
fully cached; it falls back to the provider otherwise), never silently by
restarts or card-price changes. The server checks that a submitted
quote still matches before executing a trade.

Admins have an "Adjust credits" tool in the Bank activity tab that adds or
removes any amount for testing (e.g. to try a vintage pack without grinding).
Every adjustment is a visible ledger entry, and the balance still cannot go
below zero — it is a testing convenience, not a hidden faucet, and it means
bank totals are only meaningful fair-play numbers if admins abstain.

The bank shows spendable balance, collection sale value, and their sum. Unknown
prices and unopened packs are excluded. Transactions use integer cents and commit
money, inventory and activity together. Request IDs protect purchase/trade/opening
retries, and reward eligibility is stored in SQLite. This is a local single-player
simulator, not a tamper-resistant competitive economy.

Potential later progression: set-completion badges and one-time collection goals.
These should reward discovered cards or durable achievements rather than current
ownership, so buying and selling the same card cannot repeatedly claim rewards.
They are suggestions, not implemented features.

## Pack model

Every English expansion in the cached pokemontcg.io sets list is openable (the
four original launch sets remain available if that cache has never loaded). Each
set maps by series to the closest of four era layouts; special products keep
their real card lists but use these approximate layouts rather than their actual
unusual collation rules.

| Era (series) | Face-up order before trick | Trick |
| --- | --- | --- |
| WotC (Base, Gym, Neo; not Legendary Collection) | 7 common, rare-or-higher, 3 uncommon — no reverse foil | Last 3 to front |
| Classic (Legendary Collection, E-Card, EX through XY, and unlisted series) | 5 common, reverse foil, rare-or-higher, 3 uncommon | Last 3 to front |
| Sun & Moon / Sword & Shield | 5 common, reverse foil, rare-or-higher, Basic Energy, 3 uncommon | Last 4 to front |
| Scarlet & Violet / Mega Evolution | 4 common, 3 uncommon, 2 foil slots, rare-or-higher, Basic Energy | Last 1 to front |

Code cards are omitted. Basic Energy slots pull a real Basic Energy print from
the opened set when it contains any (tradable like any other pull); otherwise
they use an explicitly labeled simulator placeholder with no sale quote. Only
the Sun & Moon and later era layouts have an energy slot, so Basic Energy prints
in older sets never appear in packs (real WotC Base Set packs did include them);
they remain purchasable as singles.

Rarity pools are Common, Uncommon, Rare, Rare Holo, and Illustration/Special
Illustration; every other or unknown rarity counts as a higher-rarity "hit."
Sets missing a conventional pool (promo-only or all-holo products) fill each
slot from the nearest non-empty pool instead of failing to open.

Odds are gameplay approximations, not official pull rates: 20% higher-rarity rare
slot; older eras otherwise have 25% holo / 55% regular rare. Scarlet & Violet
otherwise has a holo rare, plus a separate 10% illustration replacement in its
second foil slot. Cards within each eligible rarity pool are equally likely and
sampling permits duplicates. No rarity tier frequency or factory collation is
claimed to be exact. The trick only rotates saved results; it never rerolls them.

References for pack composition and common tricks:
- [Pokémon Support: booster contents](https://support.pokemon.com/hc/en-us/articles/360000981613-What-can-I-expect-in-a-Pok%C3%A9mon-Trading-Card-Game-booster-pack)
- [Pokémon: Scarlet & Violet foil changes](https://www.pokemon.com/uk/pokemon-news/pokemon-tcg-scarlet-violet-brings-changes-to-the-pokemon-trading-card-game)
- [PokéPatch: era-specific pack tricks](https://pokepatch.com/2022/07/26/how-to-open-pokemon-cards-card-trick-for-each-set/)

## Implementation and validation

`backend/simulator.js` holds rules and transactional operations; the new
`/api/simulator` router handles catalog preparation and endpoints. The frontend
`frontend/src/pages/Simulator.jsx` reuses the API wrapper and `BinderSlot` display component.
The existing collection endpoints are not repurposed for simulated holdings.

Run `npm run test:simulator` in `backend` for isolated in-memory SQLite regression
checks. They cover era pack order/tricks, set-print versus placeholder Basic Energy,
pool fallbacks for promo-only sets, dynamically added packs, value-based pack
pricing with price-change rejection and the $4 floor, a sampled-vs-analytic
mirror check that pins pack generation to the pricing formula, quoted cents and
unsupported currencies/prints, catalog completeness against declared set totals,
duplicate requests, persisted openings, insufficient balance, transaction rollback,
daily/milestone rewards, virtual binder sale/rebuy behavior, master-set binder
layout/estimates/idempotency, the legacy binder-slot migration, market pagination
and unchanged real-table fixtures. Run `npm run build` in
`frontend` for bundling validation.

Browser verification used a separate temporary database and mocked provider catalog:
prepare/buy/open, daily reward, pack trick, sequential reveal and reload, buy/sell,
single search, virtual binder placement, bank activity and responsive layout. Live
provider availability and real-world pack odds were not validated by those tests.
Additional fixture-backed checks exercised successful purchases followed by failed
state refreshes, subsequent fresh purchases, reveal-only updates, concurrent daily
claims, HTTP validation responses and preservation of existing cached fallback prices.
