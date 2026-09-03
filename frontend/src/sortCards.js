import { bestPrice } from './pricing.js';

// Natural sort for printed card numbers ("1" < "2" < "10", "TG01" < "TG02", etc.)
// — mirrors backend/routes/binders.js's compareCardNumbers exactly, since the
// "number" field is a string and a plain string sort would put "10" before "2".
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

export const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'number', label: 'Card Number' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'price-asc', label: 'Price: Low to High' },
];

// Cards with no price data always sort to the bottom regardless of direction —
// an unpriced card isn't "worth $0", it's just missing data, and shouldn't
// clutter the top of a high-to-low sort or bury itself among cheap cards.
export function sortCards(cards, sortBy) {
  const arr = [...cards];
  switch (sortBy) {
    case 'name-asc':
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return arr.sort((a, b) => b.name.localeCompare(a.name));
    case 'number':
      return arr.sort((a, b) => compareCardNumbers(a.number, b.number));
    case 'price-desc':
      return arr.sort((a, b) => (bestPrice(b)?.amount ?? -Infinity) - (bestPrice(a)?.amount ?? -Infinity));
    case 'price-asc':
      return arr.sort((a, b) => (bestPrice(a)?.amount ?? Infinity) - (bestPrice(b)?.amount ?? Infinity));
    default:
      return arr;
  }
}
