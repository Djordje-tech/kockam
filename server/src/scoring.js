const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// GeoGuessr-style exponential score, 0-5000.
export function scoreFromDistance(distanceKm) {
  const score = Math.round(5000 * Math.exp(-distanceKm / 2000));
  return Math.max(0, Math.min(5000, score));
}

// Gambling-style payout tiers based on real-world distance accuracy.
const TIERS = [
  { maxKm: 50, multiplier: 5, result: "JACKPOT" },
  { maxKm: 300, multiplier: 2.5, result: "WIN" },
  { maxKm: 1000, multiplier: 1.2, result: "WIN" },
  { maxKm: 3000, multiplier: 0.5, result: "PUSH" },
  { maxKm: Infinity, multiplier: 0, result: "BUST" },
];

export function resolveBet(distanceKm, betAmount) {
  const tier = TIERS.find((t) => distanceKm <= t.maxKm);
  const payout = Math.round(betAmount * tier.multiplier);
  return { multiplier: tier.multiplier, result: tier.result, payout };
}
