'use strict';
/**
 * Money handling: all arithmetic is done in integer piasters (1 EGP = 100).
 * DB columns are DECIMAL(10,2) and are read as strings (never floats).
 * Rounding rule: round-half-up to the nearest piaster (applies to percent coupons only).
 */
const toCents = (decimalString) => {
  const s = String(decimalString);
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid money value: ${s}`);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const cents = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -cents : cents;
};
const fromCents = (cents) => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
// percent may have 2 decimals -> work in hundredths of a percent
const percentOf = (cents, percentDecimalString) => {
  const hundredths = toCents(percentDecimalString); // e.g. "12.50" -> 1250
  return Math.floor((cents * hundredths + 5000) / 10000);
};
const toNumber = (decimalString) => Number(decimalString);
module.exports = { toCents, fromCents, percentOf, toNumber };
