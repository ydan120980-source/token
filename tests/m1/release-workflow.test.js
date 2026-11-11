'use strict';
// The release workflow is the only thing that turns a tag into a published file, so its PowerShell is run here rather than
// trusted: each snippet is taken verbatim out of .github/workflows/release.yml and executed against fake files and a fake
// `gh`. Nothing here reaches GitHub, builds an installer or publishes anything.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');

const WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'release.yml');
const yaml = fs.readFileSync(WORKFLOW, 'utf8');

function powershell() {
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
  return probe.status === 0 ? 'pwsh' : null;
}

const shell = powershell();

// One `run: |` block, de-indented, exactly as the runner would hand it to the shell.
function step(name) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === '- name: ' + name);
  assert.notEqual(start, -1, 'the workflow still has a step named ' + name);
  let at = start + 1;
  while (at < lines.length && !/^\s+run:\s*\|/.test(lines[at])) at += 1;
  assert.ok(at < lines.length, name + ' still has a run block');
  const keyIndent = lines[at].search(/\S/);
  at += 1;
  const body = [];
  for (; at < lines.length; at += 1) {
    const line = lines[at];
    if (line.trim() === '') { body.push(''); continue; }
    const indent = line.search(/\S/);
    if (indent <= keyIndent) break;
    body.push(line.slice(Math.min(indent, keyIndent + 2)));
  }
  return body.join('\n');
}

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dist', 'win-unpacked', 'resources'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'agent-usage', version: '0.1.0' }), 'utf8');
  stub(dir);
  return dir;
}

// A fake `gh` that records every call, so a test can say which branch of the release decision ran. Labels rather than
// nested parentheses: `exit /b` inside a parenthesised block does not reliably set the exit code.
function stub(dir, { failEverything = false } = {}) {
  const lines = [
    '@echo off',
    'echo %*>>"%GH_STUB_LOG%"',
    'if /i "%1"=="release" if /i "%2"=="view" goto view',
  ];
  if (failEverything) lines.push('exit /b 1'); else lines.push('exit /b 0');
  lines.push(
    ':view',
    'if "%GH_STUB_DRAFT%"=="missing" exit /b 1',
    'echo %GH_STUB_DRAFT%',
    'exit /b 0',
    '',
  );
  fs.writeFileSync(path.join(dir, 'gh.cmd'), lines.join('\r\n'), 'utf8');
}

function run(dir, script, env = {}) {
  return spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, GH_STUB_LOG: path.join(dir, 'gh.log'), ...env },
  });
}

function calls(dir) {
  try { return fs.readFileSync(path.join(dir, 'gh.log'), 'utf8').split(/\r?\n/).filter(Boolean); } catch { return []; }
}

const TAG = step('Confirm the tag is the version in package.json');
const METADATA = step('Check the update metadata the client needs');
const DECISION = step('Create or update the draft release');

const files = [
  'dist/AgentUsage-0.1.0-preview-setup.exe',
  'dist/AgentUsage-0.1.0-preview-setup.exe.blockmap',
  'dist/latest.yml',
];

function present(dir) {
  for (const file of files) fs.writeFileSync(path.join(dir, file), 'x');
  fs.writeFileSync(path.join(dir, 'dist', 'win-unpacked', 'resources', 'app-update.yml'), 'provider: github\n');
  fs.writeFileSync(path.join(dir, 'dist', 'latest.yml'), 'version: 0.1.0\nfiles:\n  - url: AgentUsage-0.1.0-preview-setup.exe\nsha512: abc\n', 'utf8');
}

test('the workflow accepts only the tag matching the packaged version', { skip: !shell && 'no pwsh on this machine' }, t => {
  const dir = workspace(t);
  const matching = run(dir, TAG, { RELEASE_TAG: 'v0.1.0' });
  assert.equal(matching.status, 0, matching.stdout + matching.stderr);
  const different = run(dir, TAG, { RELEASE_TAG: 'v0.1.1' });
  assert.notEqual(different.status, 0);
  assert.match(different.stdout + different.stderr, /does not match package.json version/);
});

test('the metadata check keeps each path whole and passes when every file is there', { skip: !shell && 'no pwsh on this machine' }, t => {
  // A `+` inside @(...) binds looser than the comma, so the blockmap name used to
  // arrive as three separate items and the check failed even with real artifacts.
  assert.match(METADATA, /\$blockmap = "\$\{setup\}\.blockmap"/, 'the blockmap path is built before the array');
  const dir = workspace(t);
  present(dir);
  const result = run(dir, METADATA);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('the metadata check fails for a missing installer, blockmap, feed or mismatched version', { skip: !shell && 'no pwsh on this machine' }, async t => {
  const cases = [
    ['the blockmap', 'dist/AgentUsage-0.1.0-preview-setup.exe.blockmap'],
    ['the installer', 'dist/AgentUsage-0.1.0-preview-setup.exe'],
    ['latest.yml', 'dist/latest.yml'],
    ['app-update.yml', 'dist/win-unpacked/resources/app-update.yml'],
  ];
  for (const [label, removed] of cases) {
    await t.test(label, t => {
      const dir = workspace(t);
      present(dir);
      fs.rmSync(path.join(dir, removed));
      const result = run(dir, METADATA);
      assert.notEqual(result.status, 0, 'a missing ' + label + ' stops the release');
      assert.match(result.stdout + result.stderr, /missing/);
    });
  }
  await t.test('a stale latest.yml', t => {
    const dir = workspace(t);
    present(dir);
    fs.writeFileSync(path.join(dir, 'dist', 'latest.yml'), 'version: 0.0.9\nsha512: abc\n', 'utf8');
    const result = run(dir, METADATA);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /does not describe/);
  });
  await t.test('a feed without a hash', t => {
    const dir = workspace(t);
    present(dir);
    fs.writeFileSync(path.join(dir, 'dist', 'latest.yml'), 'version: 0.1.0\n', 'utf8');
    const result = run(dir, METADATA);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /no sha512/);
  });
});

test('a tag without a release creates a draft and publishes nothing', { skip: !shell && 'no pwsh on this machine' }, t => {
  const dir = workspace(t);
  present(dir);
  const result = run(dir, DECISION, { GH_STUB_DRAFT: 'missing' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const made = calls(dir);
  assert.equal(made.length, 2, made.join(' | '));
  assert.match(made[0], /^release view v0\.1\.0/);
  assert.match(made[1], /^release create v0\.1\.0 /);
  assert.match(made[1], /--draft/, 'a new release is always a draft');
  assert.match(made[1], /--prerelease/, 'the unsigned build is marked as a preview');
  assert.match(made[1], /--verify-tag/, 'creating a draft cannot create a new Git tag');
});

test('rewriting an existing draft replaces its assets', { skip: !shell && 'no pwsh on this machine' }, t => {
  const dir = workspace(t);
  present(dir);
  const result = run(dir, DECISION, { GH_STUB_DRAFT: 'true' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const made = calls(dir);
  assert.match(made.at(-1), /^release upload v0\.1\.0 /);
  assert.match(made.at(-1), /--clobber/, 'a rerun of the same draft may replace its own files');
});

test('an already published release is refused instead of overwritten', { skip: !shell && 'no pwsh on this machine' }, t => {
  // Clients read a published release. `gh release upload --clobber` deletes the
  // existing assets first, so rerunning a published tag must stop here.
  const dir = workspace(t);
  present(dir);
  const result = run(dir, DECISION, { GH_STUB_DRAFT: 'false' });
  assert.notEqual(result.status, 0, 'the job fails rather than touching a published release');
  assert.match(result.stdout + result.stderr, /already published/);
  const made = calls(dir);
  assert.equal(made.length, 1, 'only the probe ran: ' + made.join(' | '));
  assert.match(made[0], /^release view/);
});

test('a failed upload fails the job instead of reporting success', { skip: !shell && 'no pwsh on this machine' }, t => {
  const dir = workspace(t);
  present(dir);
  stub(dir, { failEverything: true });
  const result = run(dir, DECISION, { GH_STUB_DRAFT: 'true' });
  assert.notEqual(result.status, 0, 'an upload error is not swallowed');
  assert.match(result.stdout + result.stderr, /upload to draft/);
});
