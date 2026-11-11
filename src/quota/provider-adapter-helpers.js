'use strict';
const { amount } = require('./amount');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = () => { throw new Error('PROVIDER_RESPONSE_INVALID'); };
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
function cents(value) { const normalized = amount(value); if (normalized === null) return null; const [whole, fraction = ''] = normalized.split('.'), digits = whole.padStart(3, '0'); return amount(digits.slice(0, -2) + '.' + digits.slice(-2) + fraction); }
function microDollars(value) { const normalized = amount(value); if (normalized === null) return null; const [whole, fraction = ''] = normalized.split('.'), padded = whole.padStart(9, '0'); return amount(padded.slice(0, -8) + '.' + padded.slice(-8) + fraction); }
module.exports = { record, fail, percent, cents, microDollars, amount };
