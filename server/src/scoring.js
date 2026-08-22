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

// A run of wins is worth more than the same wins spread out — the streak
// bonus is what makes a hot run feel like something you'd hate to lose.
const STREAK_BONUS = [
  { minStreak: 6, multiplier: 3 },
  { minStreak: 5, multiplier: 2.5 },
  { minStreak: 4, multiplier: 2 },
  { minStreak: 3, multiplier: 1.5 },
  { minStreak: 2, multiplier: 1.2 },
  { minStreak: 0, multiplier: 1 },
];

export function streakMultiplier(streak) {
  return STREAK_BONUS.find((s) => streak >= s.minStreak).multiplier;
}

// How the streak reacts to a result: a win extends it, a bust wipes it, and
// a push holds the line without advancing it.
export function nextStreak(currentStreak, result) {
  if (result === "JACKPOT" || result === "WIN") return currentStreak + 1;
  if (result === "PUSH") return currentStreak;
  return 0;
}

// "You were 3 km from a JACKPOT" — the gap to the next tier up, but only
// when it was genuinely close enough to sting. Being 2,000 km short of a
// tier isn't a near miss, so it's capped both relative to the tier and in
// absolute terms. Returns null when it wasn't close.
const NEAR_MISS_MAX_GAP_KM = 400;

export function nearMiss(distanceKm) {
  const currentIndex = TIERS.findIndex((t) => distanceKm <= t.maxKm);
  if (currentIndex <= 0) return null; // already the top tier
  const better = TIERS[currentIndex - 1];
  const gapKm = distanceKm - better.maxKm;
  if (gapKm <= 0 || gapKm > NEAR_MISS_MAX_GAP_KM || distanceKm > better.maxKm * 2) return null;
  return {
    tier: better.result,
    tierMultiplier: better.multiplier,
    gapKm: Math.round(gapKm * 10) / 10,
  };
}

export function resolveBet(distanceKm, betAmount, streak = 0) {
  const tier = TIERS.find((t) => distanceKm <= t.maxKm);
  const bonus = tier.multiplier > 0 ? streakMultiplier(streak) : 1;
  const payout = Math.round(betAmount * tier.multiplier * bonus);
  return {
    multiplier: tier.multiplier,
    streakBonus: bonus,
    result: tier.result,
    payout,
  };
}
