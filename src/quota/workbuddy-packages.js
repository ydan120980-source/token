'use strict';
const { createHash } = require('node:crypto');
const { readProvider } = require('./provider-http');
const { PAGE_SIZE, MAX_PAGES, MAX_PACKAGES, MAX_BYTES } = require('./workbuddy-package-contract');
const invalid = () => { throw Error('PROVIDER_RESPONSE_INVALID'); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const packageKey = value => createHash('sha256').update(JSON.stringify(canonical(Object.fromEntries(Object.entries(value).filter(([key]) => !/remain|used|frozen|balance/i.test(key)))))).digest('hex');
// Only the existing desktop billing endpoint has a verified PageNumber contract.
// A following empty page establishes termination. A short page alone does not.
async function readWorkBuddyPackages(token, { signal, project, read = readProvider, ...transport } = {}) {
  const accounts = [], seen = new Set(), at = Date.now(); let bytes = 0, first, total;
  const result = completePackages => ({ raw: { ...first, data: { ...first.data, Response: { ...first.data.Response, Data: { ...first.data.Response.Data, Accounts: accounts } } } }, completePackages });
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (signal?.aborted) throw Error('PROVIDER_CANCELED');
    const raw = await read('workbuddy-desktop', token, { ...transport, signal, project, pageNumber: page, workbuddyAt: at });
    if (signal?.aborted) throw Error('PROVIDER_CANCELED');
    if ([401, 403].includes(raw?.code)) throw Error(raw.code === 401 ? 'PROVIDER_AUTH_REQUIRED' : 'PROVIDER_ACCESS_DENIED');
    const response = raw?.data?.Response, data = response?.Data, items = data?.Accounts;
    if (raw?.code !== 0 || response?.Error || !Array.isArray(items) || items.length > PAGE_SIZE) invalid();
    bytes += Buffer.byteLength(JSON.stringify(raw)); if (bytes > MAX_BYTES) throw Error('PROVIDER_OUTPUT_LIMIT');
    first ||= raw;
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) invalid();
      // An ignored/overlapping page cannot establish complete coverage. Keep the
      // preceding validated pages, never append or total an ambiguous page.
      const hash = packageKey(item);
      if (page > 1 && seen.has(hash)) return result(false);
    }
    for (const item of items) seen.add(packageKey(item));
    accounts.push(...items);
    // Some versions include a total. Never call an empty page complete when it
    // contradicts that count; missing totals stay optional.
    if (data.TotalCount !== undefined) {
      if (!Number.isSafeInteger(data.TotalCount) || data.TotalCount < accounts.length || total !== undefined && total !== data.TotalCount) invalid();
      total = data.TotalCount;
    }
    if (total !== undefined && accounts.length > total || !items.length && total !== undefined && total !== accounts.length) invalid();
    if (!items.length || page === MAX_PAGES) return result(items.length === 0);
  }
}
module.exports = { readWorkBuddyPackages, PAGE_SIZE, MAX_PAGES, MAX_PACKAGES };
