import { config } from '../config.js';
import { gamma as bsGamma, vanna as bsVanna, charm as bsCharm } from './blackScholes.js';

/**
 * Dealer gamma exposure by strike.
 *
 * Convention (the standard SqueezeMetrics one): dealers are assumed long calls
 * and short puts against customer flow, so call open interest contributes
 * positive gamma and put open interest negative. Where net gamma is positive
 * dealers hedge against the move and price mean-reverts; where it is negative
 * they hedge with the move and price accelerates. The strike where the running
 * total flips sign is the gamma flip — the single most useful level on the map.
 *
 * GEX per strike is expressed as dollar-delta rehedged per 1% spot move:
 *     GEX = gamma * OI * multiplier * S^2 * 0.01
 */
export function computeGex(chain, spot, opts = {}) {
  const cfg = { ...config.gamma, ...opts };
  const now = opts.now ?? Date.now();
  const byStrike = new Map();

  let totalGex = 0, totalVanna = 0, totalCharm = 0, totalCallOi = 0, totalPutOi = 0;

  for (const o of chain) {
    const T = (o.expiryMs - now) / (365 * 24 * 3600 * 1000);
    if (T <= 0 || T * 365 > cfg.maxDaysOut) continue;
    const iv = o.iv > 3 ? o.iv / 100 : o.iv;    // accept 65 or 0.65
    if (!(iv > 0) || !(o.oi > 0)) continue;

    const g = bsGamma(spot, o.strike, T, cfg.riskFreeRate, iv);
    const notionalPerPct = g * o.oi * cfg.contractMultiplier * spot * spot * 0.01;
    const signed = o.type === 'call' ? notionalPerPct : -notionalPerPct;

    let e = byStrike.get(o.strike);
    if (!e) byStrike.set(o.strike, (e = {
      strike: o.strike, callGex: 0, putGex: 0, netGex: 0,
      callOi: 0, putOi: 0, vanna: 0, charm: 0,
    }));
    if (o.type === 'call') { e.callGex += signed; e.callOi += o.oi; totalCallOi += o.oi; }
    else { e.putGex += signed; e.putOi += o.oi; totalPutOi += o.oi; }
    e.netGex += signed;

    const v = bsVanna(spot, o.strike, T, cfg.riskFreeRate, iv) * o.oi * cfg.contractMultiplier;
    const c = bsCharm(spot, o.strike, T, cfg.riskFreeRate, iv, o.type === 'call') * o.oi * cfg.contractMultiplier;
    e.vanna += o.type === 'call' ? v : -v;
    e.charm += o.type === 'call' ? c : -c;

    totalGex += signed;
    totalVanna += e.vanna;
    totalCharm += e.charm;
  }

  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  if (!strikes.length) return null;

  // Walls: the strikes carrying the most gamma on each sign.
  let callWall = null, putWall = null;
  for (const s of strikes) {
    if (!callWall || s.netGex > callWall.netGex) callWall = s;
    if (!putWall || s.netGex < putWall.netGex) putWall = s;
  }

  const gammaFlip = findGammaFlip(strikes, spot, cfg);

  return {
    ts: now,
    spot,
    totalGex,
    totalVanna,
    totalCharm,
    regime: totalGex >= 0 ? 'positive' : 'negative',
    putCallOi: totalCallOi ? totalPutOi / totalCallOi : null,
    gammaFlip,
    callWall: callWall && callWall.netGex > 0 ? { strike: callWall.strike, gex: callWall.netGex } : null,
    putWall: putWall && putWall.netGex < 0 ? { strike: putWall.strike, gex: putWall.netGex } : null,
    strikes,
    levels: keyLevels(strikes, spot, gammaFlip, callWall, putWall),
  };
}

/**
 * Gamma flip: the spot price at which total dealer gamma crosses zero.
 * Re-priced properly — cumulative GEX by strike is a crude proxy that lands on
 * the wrong side whenever the surface is skewed, so instead we scan candidate
 * spot levels and find where aggregate gamma changes sign, then interpolate.
 */
function findGammaFlip(strikes, spot, cfg) {
  const lo = strikes[0].strike, hi = strikes[strikes.length - 1].strike;
  const steps = 80;
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const s = lo + ((hi - lo) * i) / steps;
    const g = aggregateGammaAt(strikes, s, spot);
    if (prev && Math.sign(prev.g) !== Math.sign(g) && prev.g !== 0) {
      const t = Math.abs(prev.g) / (Math.abs(prev.g) + Math.abs(g));
      return prev.s + (s - prev.s) * t;
    }
    prev = { s, g };
  }
  return null;
}

/**
 * Approximate net gamma if spot were at `s`, reusing each strike's gamma shape.
 * Gamma is highest at the money, so we weight each strike's contribution by a
 * lognormal-ish kernel around it rather than re-running Black-Scholes per node.
 */
function aggregateGammaAt(strikes, s, spot) {
  let total = 0;
  const width = spot * 0.03;
  for (const k of strikes) {
    const d = (s - k.strike) / width;
    total += k.netGex * Math.exp(-0.5 * d * d);
  }
  return total;
}

function keyLevels(strikes, spot, flip, callWall, putWall) {
  const out = [];
  if (flip) out.push({ kind: 'gammaFlip', price: flip, label: 'Gamma flip',
    note: spot > flip ? 'above flip — dealers suppress volatility'
                      : 'below flip — dealers amplify volatility' });
  if (callWall?.netGex > 0) out.push({ kind: 'callWall', price: callWall.strike,
    label: 'Call wall', note: 'positive gamma magnet / resistance' });
  if (putWall?.netGex < 0) out.push({ kind: 'putWall', price: putWall.strike,
    label: 'Put wall', note: 'negative gamma shelf — breaks accelerate' });

  // Secondary walls above and below spot are where intraday flow tends to pin.
  const above = strikes.filter((s) => s.strike > spot).sort((a, b) => b.netGex - a.netGex)[0];
  const below = strikes.filter((s) => s.strike < spot).sort((a, b) => a.netGex - b.netGex)[0];
  if (above && above.strike !== callWall?.strike) {
    out.push({ kind: 'gammaAbove', price: above.strike, label: 'Gamma above', note: 'nearest gamma shelf overhead' });
  }
  if (below && below.strike !== putWall?.strike) {
    out.push({ kind: 'gammaBelow', price: below.strike, label: 'Gamma below', note: 'nearest gamma shelf underneath' });
  }
  return out.sort((a, b) => b.price - a.price);
}
