// Natural sort for printed card numbers ("1" < "2" < "10", "TG01" < "TG02",
// etc.) — a plain string/SQL sort would put "10" before "2", so this can't be
// expressed as a SQL ORDER BY; used to sort an already-fetched row set in JS.
// Lives in its own dependency-free module so simulator.js (whose tests run
// against in-memory databases) can use it without importing db-opening code.
export function compareCardNumbers(a, b) {
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
