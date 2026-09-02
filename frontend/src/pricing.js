// Client-side mirror of backend/pricing.js — used for quick display before a
// card is added to the collection (where the server computes the authoritative price).

const VARIANT_LABELS = {
  normal: 'Normal',
  holofoil: 'Holofoil',
  reverseHolofoil: 'Reverse Holofoil',
  '1stEdition': '1st Edition',
  '1stEditionHolofoil': '1st Edition Holofoil',
  '1stEditionNormal': '1st Edition Normal',
  unlimited: 'Unlimited',
  unlimitedHolofoil: 'Unlimited Holofoil',
};

export const VARIANT_OPTIONS = Object.values(VARIANT_LABELS);

export function tcgplayerVariants(card) {
  const prices = card?.tcgplayer?.prices;
  if (!prices) return [];
  return Object.entries(prices).map(([key, v]) => ({
    key,
    label: VARIANT_LABELS[key] || key,
    ...v,
  }));
}

export function bestPrice(card) {
  const variants = tcgplayerVariants(card).filter((v) => v.market != null);
  if (variants.length) {
    const cheapest = variants.sort((a, b) => a.market - b.market)[0];
    return { amount: cheapest.market, currency: 'USD', source: 'TCGplayer', label: cheapest.label };
  }
  const cm = card?.cardmarket?.prices;
  if (cm?.trendPrice != null) {
    return { amount: cm.trendPrice, currency: 'EUR', source: 'Cardmarket', label: 'Trend' };
  }
  if (cm?.averageSellPrice != null) {
    return { amount: cm.averageSellPrice, currency: 'EUR', source: 'Cardmarket', label: 'Average' };
  }
  return null;
}
