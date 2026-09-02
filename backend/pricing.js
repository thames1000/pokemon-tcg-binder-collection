// Pulls a single "best guess" market price (USD) out of a pokemontcg.io card object,
// preferring the TCGplayer price bucket that matches the owned variant.

const VARIANT_TO_TCGPLAYER_KEY = {
  Normal: 'normal',
  Holofoil: 'holofoil',
  'Reverse Holofoil': 'reverseHolofoil',
  '1st Edition': '1stEdition',
  '1st Edition Holofoil': '1stEditionHolofoil',
  '1st Edition Normal': '1stEditionNormal',
  Unlimited: 'unlimited',
  'Unlimited Holofoil': 'unlimitedHolofoil',
};

export function cardMarketPrice(card, variant) {
  if (!card) return null;

  const tcg = card.tcgplayer?.prices;
  if (tcg) {
    const key = VARIANT_TO_TCGPLAYER_KEY[variant];
    if (key && tcg[key]?.market != null) {
      return { amount: tcg[key].market, currency: 'USD', source: 'TCGplayer', variant: key };
    }
    // fall back to whatever bucket exists
    const firstKey = Object.keys(tcg).find((k) => tcg[k]?.market != null);
    if (firstKey) {
      return { amount: tcg[firstKey].market, currency: 'USD', source: 'TCGplayer', variant: firstKey };
    }
  }

  const cm = card.cardmarket?.prices;
  if (cm?.trendPrice != null) {
    return { amount: cm.trendPrice, currency: 'EUR', source: 'Cardmarket', variant: 'trend' };
  }
  if (cm?.averageSellPrice != null) {
    return { amount: cm.averageSellPrice, currency: 'EUR', source: 'Cardmarket', variant: 'average' };
  }

  // pokemontcg.io has no price data of its own for this card (common for very
  // recently released sets) — fall back to whatever was found on TCGdex, if
  // anything, when the card was fetched. See pokemonApi.js / tcgdexApi.js.
  if (card.priceFallback) return card.priceFallback;

  return null;
}
