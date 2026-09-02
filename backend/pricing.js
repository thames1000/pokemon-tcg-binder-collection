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
    if (!variant) {
      // No specific variant requested (e.g. a plain browsing price badge) —
      // any available bucket is a fair "best guess" to show.
      const firstKey = Object.keys(tcg).find((k) => tcg[k]?.market != null);
      if (firstKey) {
        return { amount: tcg[firstKey].market, currency: 'USD', source: 'TCGplayer', variant: firstKey };
      }
      return null;
    }
    // A specific variant was requested, and TCGplayer has real data for this
    // card — just not that print. TCGplayer's bucket keys are exactly the print
    // treatments that were actually made (e.g. Base Set genuinely has no
    // "reverseHolofoil" bucket because reverse holos weren't introduced until
    // years later), so this is authoritative: that print doesn't exist. Don't
    // fall through to Cardmarket/TCGdex for a substitute — they wouldn't have a
    // genuine variant-specific price for a print that was never made either.
    return null;
  }

  // TCGplayer has *no* data at all for this card — a total data gap (common for
  // very recently released sets), not evidence this specific print doesn't
  // exist — so a general fallback price is still worth showing here, even for a
  // specific-variant request.
  const cm = card.cardmarket?.prices;
  if (cm?.trendPrice != null) {
    return { amount: cm.trendPrice, currency: 'EUR', source: 'Cardmarket', variant: 'trend' };
  }
  if (cm?.averageSellPrice != null) {
    return { amount: cm.averageSellPrice, currency: 'EUR', source: 'Cardmarket', variant: 'average' };
  }

  // See pokemonApi.js / tcgdexApi.js — the TCGdex fallback price, if any was found.
  if (card.priceFallback) return card.priceFallback;

  return null;
}
