export function formatChips(amount) {
  if (amount >= 1000) {
    const k = amount / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  return String(amount);
}
