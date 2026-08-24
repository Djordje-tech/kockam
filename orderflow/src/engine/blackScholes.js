// Minimal Black-Scholes surface: we only need gamma, and vanna/charm for the
// second-order flows that actually move futures into the close.

const SQRT_2PI = Math.sqrt(2 * Math.PI);

export const normPdf = (x) => Math.exp(-0.5 * x * x) / SQRT_2PI;

/** Abramowitz-Stegun 7.1.26 error function, plenty accurate for greeks. */
export function normCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

export function d1(S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  return (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

/** dDelta/dSpot — same for calls and puts. */
export function gamma(S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0 || S <= 0) return 0;
  return normPdf(d1(S, K, T, r, sigma)) / (S * sigma * Math.sqrt(T));
}

/** dDelta/dVol — drives the flow when IV moves, not spot. */
export function vanna(S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0 || S <= 0) return 0;
  const a = d1(S, K, T, r, sigma);
  const b = a - sigma * Math.sqrt(T);
  return -normPdf(a) * b / sigma;
}

/** dDelta/dTime — the decay-driven rehedge, biggest into expiry. */
export function charm(S, K, T, r, sigma, isCall = true) {
  if (T <= 0 || sigma <= 0 || S <= 0) return 0;
  const a = d1(S, K, T, r, sigma);
  const b = a - sigma * Math.sqrt(T);
  const common = -normPdf(a) * (2 * r * T - b * sigma * Math.sqrt(T)) / (2 * T * sigma * Math.sqrt(T));
  return isCall ? common : common;   // charm is sign-symmetric in this form
}
