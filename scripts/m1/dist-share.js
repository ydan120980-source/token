'use strict';

/**
 * Collapse duplicated build payloads across `dist/` generations with NTFS hardlinks.
 *
 * Every electron-builder generation under `dist/<generation>/win-unpacked/` ships
 * the same ~156 MB Electron runtime. Only `Agent Usage Quota.exe` and
 * `resources/app.asar` actually differ between generations, so identical files at
 * the same relative path can share one physical copy instead of one copy per
 * generation. This keeps one copy per generation while removing the duplicate bytes.
 *
 * Guarantees:
 *   - only files inside `<dist>/<generation>/win-unpacked/` are ever replaced
 *   - a file is replaced only when another generation has the same relative path
 *     and byte-identical SHA-256 content
 *   - `*.zip` is never touched; a zip cannot be hardlinked and is not a candidate
 *   - replacement is atomic: link to a temporary name, then rename over the target
 *   - with the default `--quiet-seconds` the command refuses to run while the tree
 *     is being written to, so it cannot race an in-flight build
 *
 * Usage:
 *   node scripts/m1/dist-share.js [--dry-run | --verify] [--dist <dir>] [--quiet-seconds <n>] [--anchor-generation <name>]
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const WINDOWS_DIR = 'win-unpacked';
const DEFAULT_QUIET_SECONDS = 90;

/** Every file below `dir`, as paths relative to `dir`, sorted for stable output. */
function relativeFiles(dir) {
  const files = [];
  const pending = [''];
  while (pending.length > 0) {
    const relative = pending.pop();
    for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  return files.sort();
}

/** Generation directories that contain a `win-unpacked/` build payload. */
function generationNames(distRoot) {
  return fs.readdirSync(distRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(distRoot, name, WINDOWS_DIR)))
    .sort();
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Physical file identity. `bigint` avoids precision loss on large NTFS inodes. */
function identity(file) {
  const stat = fs.statSync(file, { bigint: true });
  return stat.dev.toString() + ':' + stat.ino.toString();
}

/**
 * Group files by relative path inside each `win-unpacked/`, then by content.
 *
 * `groups`   - relative paths whose content is byte-identical in two or more
 *              generations; `winner` is the copy that stays.
 * `differing`- relative paths that legitimately differ between generations.
 */
function plan(distRoot) {
  const generations = generationNames(distRoot);
  const byRelative = new Map();
  for (const generation of generations) {
    const base = path.join(distRoot, generation, WINDOWS_DIR);
    for (const relative of relativeFiles(base)) {
      const file = path.join(base, relative);
      if (!byRelative.has(relative)) byRelative.set(relative, []);
      byRelative.get(relative).push({ generation, relative, file, size: fs.statSync(file).size });
    }
  }

  const groups = [];
  const differing = [];
  for (const relative of [...byRelative.keys()].sort()) {
    const items = byRelative.get(relative);
    if (items.length < 2) continue;

    const byHash = new Map();
    for (const item of items) {
      const hash = digest(item.file);
      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(item);
    }
    if (byHash.size > 1) differing.push({ relative, generations: items.map(item => item.generation) });
    for (const [hash, members] of byHash) {
      if (members.length > 1) groups.push({ relative, hash, winner: members[0], members });
    }
  }
  return { generations, groups, differing };
}

/**
 * Replace duplicate copies with hardlinks to one winner.
 * Never touches files whose content differs, and never touches zips.
 */
function share(distRoot, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const { generations, groups } = plan(distRoot);
  if (options.anchorGeneration && !generations.includes(options.anchorGeneration)) throw new Error('ANCHOR_GENERATION_NOT_FOUND');
  const linked = [];
  const alreadyShared = [];
  const failures = [];
  let freedBytes = 0;

  for (const group of groups) {
    // Keep a frozen/running generation as the source; never replace its files
    // just because a new generation sorts before it alphabetically.
    if (options.anchorGeneration) group.winner = group.members.find(member => member.generation === options.anchorGeneration) || group.winner;
    const winnerIdentity = identity(group.winner.file);
    for (const member of group.members) {
      if (member.file === group.winner.file) continue;
      const record = { relative: member.relative, generation: member.generation, bytes: member.size };
      if (identity(member.file) === winnerIdentity) { alreadyShared.push(record); continue; }
      if (dryRun) { linked.push(record); freedBytes += member.size; continue; }
      try {
        const temporary = member.file + '.share-' + process.pid + '-' + Date.now().toString(36);
        fs.linkSync(group.winner.file, temporary);
        try {
          fs.renameSync(temporary, member.file);
        } catch (error) {
          fs.rmSync(temporary, { force: true });
          throw error;
        }
        linked.push(record);
        freedBytes += member.size;
      } catch (error) {
        failures.push({ ...record, message: error.message });
      }
    }
  }
  return { dryRun, linked, alreadyShared, failures, freedBytes };
}

/** Every content-identical group must resolve to exactly one physical file. */
function verify(distRoot) {
  const { generations, groups } = plan(distRoot);
  const failures = [];
  for (const group of groups) {
    const identities = new Set(group.members.map(member => identity(member.file)));
    if (identities.size !== 1) {
      failures.push({
        relative: group.relative,
        physicalCopies: identities.size,
        generations: group.members.map(member => member.generation),
      });
    }
  }
  return { generations, groups: groups.length, failures };
}

/** Logical size versus physical size once hardlinked files are counted once. */
function footprint(distRoot) {
  const files = relativeFiles(distRoot).map(relative => path.join(distRoot, relative));
  const seen = new Set();
  let logicalBytes = 0, physicalBytes = 0;
  for (const file of files) {
    const size = fs.statSync(file).size;
    logicalBytes += size;
    const key = identity(file);
    if (seen.has(key)) continue;
    seen.add(key);
    physicalBytes += size;
  }
  return {
    files: files.length,
    physicalFiles: seen.size,
    logicalBytes,
    physicalBytes,
    collapsedBytes: logicalBytes - physicalBytes,
  };
}

/** Files written within the last `quietSeconds`, used as a race guard. */
function recentWrites(distRoot, quietSeconds) {
  const cutoff = Date.now() - quietSeconds * 1000;
  return relativeFiles(distRoot)
    .filter(relative => fs.statSync(path.join(distRoot, relative)).mtimeMs > cutoff);
}

function run(argv) {
  const value = (name, fallback) => {
    const index = argv.indexOf(name);
    return index === -1 ? fallback : argv[index + 1];
  };
  const distRoot = path.resolve(value('--dist', path.join(__dirname, '..', '..', 'dist')));
  const quietSeconds = Number(value('--quiet-seconds', DEFAULT_QUIET_SECONDS));
  const anchorGeneration = value('--anchor-generation', null);
  const mode = argv.includes('--verify') ? 'verify' : argv.includes('--dry-run') ? 'dry-run' : 'share';
  if (!fs.existsSync(distRoot)) throw new Error('DIST_NOT_FOUND ' + distRoot);

  if (mode === 'share' && quietSeconds > 0) {
    const active = recentWrites(distRoot, quietSeconds);
    if (active.length > 0) {
      console.log(JSON.stringify({ status: 'BUSY', mode, quietSeconds, active: active.slice(0, 10) }, null, 2));
      process.exitCode = 1;
      return;
    }
  }

  const result = mode === 'verify' ? verify(distRoot) : share(distRoot, { dryRun: mode === 'dry-run', anchorGeneration });
  const report = {
    status: result.failures.length > 0 ? 'INCOMPLETE' : 'OK',
    mode,
    anchorGeneration,
    distRoot: path.relative(process.cwd(), distRoot),
    ...result,
    footprint: footprint(distRoot),
  };
  console.log(JSON.stringify(report, null, 2));
  if (result.failures.length > 0) process.exitCode = 1;
}

module.exports = { relativeFiles, generationNames, plan, share, verify, footprint, recentWrites };

if (require.main === module) run(process.argv.slice(2));
