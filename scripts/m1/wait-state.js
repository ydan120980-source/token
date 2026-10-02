'use strict';
async function waitState(page, predicate, timeout = 60000) {
  const until = Date.now() + timeout;
  do {
    const state = await page.evaluate(() => window.agentUsage.get());
    if (state.error) throw new Error(state.error);
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < until);
  throw new Error('UI_STATE_TIMEOUT');
}
module.exports = { waitState };
