import { config, rowSize } from '../config.js';

/** Footprint rows are integer keys so Map lookups never hit float drift. */
export const toRow = (price) => Math.round(price / rowSize());
export const rowToPrice = (row) => row * rowSize();
export const rowsBetween = (a, b) => Math.abs(toRow(a) - toRow(b));
export const roundTick = (price) =>
  Math.round(price / config.tickSize) * config.tickSize;

export const fmtPrice = (price) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(config.tickSize)));
  return price.toFixed(decimals);
};
