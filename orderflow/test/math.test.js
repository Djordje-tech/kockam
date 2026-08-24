import test from 'node:test';
import assert from 'node:assert/strict';
import { gamma, normCdf, d1 } from '../src/engine/blackScholes.js';
import { computeGex } from '../src/engine/gamma.js';
import { Ring } from '../src/core/ring.js';
import { OrderBook } from '../src/core/orderBook.js';
import { VolumeProfile } from '../src/engine/volumeProfile.js';
import { FootprintBuilder } from '../src/engine/footprint.js';
import { parseDeribitExpiry } from '../src/feeds/deribitOptions.js';

test('normal cdf matches known values', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normCdf(-1.96) - 0.025) < 1e-3);
});

test('gamma peaks at the money and decays away from it', () => {
  const atm = gamma(100, 100, 0.25, 0.04, 0.5);
  assert.ok(atm > gamma(100, 130, 0.25, 0.04, 0.5));
  assert.ok(atm > gamma(100, 70, 0.25, 0.04, 0.5));
  assert.equal(gamma(100, 100, 0, 0.04, 0.5), 0, 'expired options carry no gamma');
});

test('gamma rises as expiry approaches for an at-the-money strike', () => {
  assert.ok(gamma(100, 100, 0.01, 0.04, 0.5) > gamma(100, 100, 0.5, 0.04, 0.5));
});

test('d1 is zero-ish for atm, zero-rate, tiny vol', () => {
  assert.ok(Math.abs(d1(100, 100, 1, 0, 0.0001)) < 0.01);
});

test('GEX puts the flip between the put wall and the call wall', () => {
  const now = Date.now();
  const expiry = now + 14 * 864e5;
  const chain = [];
  for (let k = 90; k <= 110; k += 1) {
    chain.push({ strike: k, expiryMs: expiry, type: 'call', iv: 0.5, oi: k > 100 ? 500 : 40 });
    chain.push({ strike: k, expiryMs: expiry, type: 'put', iv: 0.5, oi: k < 100 ? 500 : 40 });
  }
  const g = computeGex(chain, 100, { now });
  assert.ok(g.callWall.strike > 100, 'call wall sits above spot');
  assert.ok(g.putWall.strike < 100, 'put wall sits below spot');
  assert.ok(g.gammaFlip > g.putWall.strike && g.gammaFlip < g.callWall.strike);
});

test('GEX ignores expired and far-dated contracts', () => {
  const now = Date.now();
  const g = computeGex([
    { strike: 100, expiryMs: now - 1000, type: 'call', iv: 0.5, oi: 1e6 },
    { strike: 100, expiryMs: now + 400 * 864e5, type: 'call', iv: 0.5, oi: 1e6 },
    { strike: 100, expiryMs: now + 7 * 864e5, type: 'call', iv: 0.5, oi: 10 },
  ], 100, { now });
  assert.equal(g.strikes.length, 1);
  assert.equal(g.strikes[0].callOi, 10);
});

test('ring buffer keeps the newest N in order', () => {
  const r = new Ring(3);
  [1, 2, 3, 4, 5].forEach((n) => r.push(n));
  assert.deepEqual(r.toArray(), [3, 4, 5]);
  assert.equal(r.last(), 5);
  assert.equal(r.size, 3);
});

test('order book applies diffs, deletes zero levels and never crosses', () => {
  const b = new OrderBook();
  b.applySnapshot({ bids: [[99, 2], [98, 3]], asks: [[101, 1], [102, 4]] });
  assert.equal(b.bestBid(), 99);
  assert.equal(b.bestAsk(), 101);
  b.applyDiff({ bids: [[99, 0], [97, 5]] });
  assert.equal(b.bestBid(), 98);
  assert.ok(b.bestBid() < b.bestAsk());
});

test('order book counts a refill only on a real deplete-and-return round trip', () => {
  const b = new OrderBook();
  b.applySnapshot({ bids: [[99, 10]], asks: [[101, 5]] });
  b.applyDiff({ bids: [[99, 12]] });                // grew without being hit
  assert.equal(b.levels.get(99).refills, 0, 'quote flicker is not a refill');

  b.recordTrade(99, 9);
  b.applyDiff({ bids: [[99, 3]] });                 // eaten down
  b.applyDiff({ bids: [[99, 11]] });                // and back
  assert.equal(b.levels.get(99).refills, 1);

  b.applyDiff({ bids: [[99, 12]] });                // drifting up is not another one
  assert.equal(b.levels.get(99).refills, 1);

  b.recordTrade(99, 9);
  b.applyDiff({ bids: [[99, 2]] });
  b.applyDiff({ bids: [[99, 12]] });
  assert.equal(b.levels.get(99).refills, 2);
});

test('volume profile value area brackets the point of control', () => {
  const p = new VolumeProfile();
  const at = (price, qty) => p.onTrade({ ts: 1, price, qty, side: 'buy' });
  for (let i = 0; i < 20; i++) at(100, 5);
  for (let i = 0; i < 5; i++) { at(95, 1); at(105, 1); }
  const va = p.valueArea();
  assert.equal(va.poc, 100);
  assert.ok(va.val <= 100 && va.vah >= 100);
  assert.ok(va.coverage >= 0.7);
});

test('footprint flags a diagonal buy imbalance and stacks it', () => {
  const fb = new FootprintBuilder({ intervalMs: 10_000, imbalanceRatio: 3,
                                    minImbalanceVol: 0.4, stackedMin: 3 });
  let ts = 0;
  for (let row = 0; row < 4; row++) {
    fb.onTrade({ ts: ts += 10, price: 100 + row * 5, qty: 10, side: 'buy' });
    fb.onTrade({ ts: ts += 10, price: 100 + row * 5, qty: 0.5, side: 'sell' });
  }
  const closed = fb.onTrade({ ts: 20_000, price: 100, qty: 1, side: 'sell' }).closed;
  assert.ok(closed.imbalances.some((i) => i.side === 'buy'));
  assert.ok(closed.stacked.some((z) => z.side === 'buy' && z.count >= 3),
    'four consecutive buy-imbalanced rows form a stacked zone');
});

test('deribit expiry parsing lands on the 08:00 UTC settle', () => {
  assert.equal(parseDeribitExpiry('27JUN25'), Date.UTC(2025, 5, 27, 8));
  assert.equal(parseDeribitExpiry('3OCT26'), Date.UTC(2026, 9, 3, 8));
  assert.equal(parseDeribitExpiry('nonsense'), null);
});
