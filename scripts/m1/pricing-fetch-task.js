'use strict';

/**
 * Manual LLM Model Pricing Sync Script (maintainer-run, never scheduled)
 * 
 * Fetches the latest authoritative token prices for all mainstream LLM models
 * from the open-source industry standard registry:
 *   - Primary Authoritative Source: models.dev (https://models.dev/api.json)
 *     Tracks OpenAI, Anthropic, Google, DeepSeek, xAI, Qwen, GLM, etc.
 * 
 * Capabilities:
 *   - Fetches and parses live JSON payload with strict schema and SHA-256 validation.
 *   - Atomic write to `src/m1/models-dev-prices.json` on verification pass.
 *   - CLI Modes:
 *       --now             Execute a single live sync immediately (default)
 *       --check           Check whether live prices differ from local cache without writing
 * 
 * Guarantees:
 *   - Security: Zero user tokens, credentials, or local environment paths are sent.
 *   - Integrity: Any corrupt or incomplete payload (> 50% dropped) is rejected.
 *   - Non-destructive: Manual price overrides and custom mappings in preferences are never overwritten.
 */

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { parse, verify, URL } = require('../../src/m1/runtime-catalog');

const ROOT = path.resolve(__dirname, '../..');
const LOCAL_CATALOG_PATH = path.join(ROOT, 'src/m1/models-dev-prices.json');

const args = process.argv.slice(2);
const isCheckOnly = args.includes('--check');

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${ts}] [PriceSync] ${msg}`);
}

/**
 * Fetches live pricing JSON from the authoritative endpoint.
 */
function fetchRemoteCatalog() {
  return new Promise((resolve, reject) => {
    log(`Connecting to authoritative source: ${URL}...`);
    const req = https.get(URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AgentUsage-PriceSyncBot/1.0 (+https://github.com/anomalyco/models.dev)'
      },
      timeout: 25000
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}: Failed to download pricing database.`));
      }
      const chunks = [];
      let totalBytes = 0;
      res.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > 20 * 1024 * 1024) {
          req.destroy();
          return reject(new Error('Payload size exceeded 20MB limit.'));
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          const rawText = Buffer.concat(chunks).toString('utf8');
          log(`Downloaded ${(totalBytes / 1024).toFixed(1)} KB of raw pricing data.`);
          const parsed = parse(rawText);
          const verified = verify(parsed);
          resolve(verified);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Network timeout while reaching authoritative pricing source.'));
    });
    req.on('error', err => reject(err));
  });
}

/**
 * Performs comparison and write back to disk.
 */
async function syncOnce() {
  try {
    const liveCatalog = await fetchRemoteCatalog();
    const liveModelCount = Object.keys(liveCatalog.models).length;
    log(`Successfully parsed & verified ${liveModelCount} model prices (SHA-256: ${liveCatalog.sha256.slice(0, 12)}...).`);

    let localCatalog = null;
    if (fs.existsSync(LOCAL_CATALOG_PATH)) {
      try {
        localCatalog = JSON.parse(fs.readFileSync(LOCAL_CATALOG_PATH, 'utf8'));
      } catch {
        /* Local catalog might be uninitialized */
      }
    }

    const localModelCount = localCatalog ? Object.keys(localCatalog.models || {}).length : 0;
    const isIdentical = localCatalog && localCatalog.sha256 === liveCatalog.sha256;

    if (isCheckOnly) {
      if (isIdentical) {
        log(`Check result: Local catalog is UP-TO-DATE (${localModelCount} models). No drift.`);
      } else {
        log(`Check result: DRIFT DETECTED! Local: ${localModelCount} models, Remote: ${liveModelCount} models.`);
      }
      return { changed: !isIdentical, modelCount: liveModelCount };
    }

    if (isIdentical) {
      log(`Local catalog is already identical to remote authoritative version. No file write needed.`);
      return { changed: false, modelCount: liveModelCount };
    }

    // Atomic write
    const tempPath = LOCAL_CATALOG_PATH + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(liveCatalog, null, 2), 'utf8');
    fs.renameSync(tempPath, LOCAL_CATALOG_PATH);
    log(`Updated ${LOCAL_CATALOG_PATH} successfully! (${localModelCount} -> ${liveModelCount} models)`);

    return { changed: true, modelCount: liveModelCount };
  } catch (err) {
    console.error(`[PriceSync ERROR] ${err.message}`);
    throw err;
  }
}

async function main() {
  await syncOnce();
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { syncOnce, fetchRemoteCatalog };
