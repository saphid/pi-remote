#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
if (!version || typeof version !== 'string') die('package.json must contain a string version');

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function tryRun(cmd, args) {
  try { return run(cmd, args); } catch { return ''; }
}
function die(message) {
  console.error(`pi-remote version check failed: ${message}`);
  process.exit(1);
}
function packageVersionAt(ref) {
  const text = tryRun('git', ['show', `${ref}:package.json`]);
  if (!text) return '';
  try { return JSON.parse(text).version || ''; } catch { return ''; }
}
function changedFilesSince(ref) {
  return tryRun('git', ['diff', '--name-only', ref]).split(/\r?\n/).filter(Boolean);
}
function meaningfulChanges(files) {
  return files.filter((file) => ![
    'package.json',
    'package-lock.json',
    'dist/pi-remote.js',
  ].includes(file));
}
function assertVersionBumpedFrom(ref, label) {
  const previous = packageVersionAt(ref);
  if (!previous || previous !== version) return;
  const changed = meaningfulChanges(changedFilesSince(ref));
  if (!changed.length) return;
  die(`code changed since ${label}, but package.json version is still ${version}. Bump the version before building/releasing.\nChanged files:\n${changed.join('\n')}`);
}

const src = fs.readFileSync(path.join(root, 'src/pi-remote.ts'), 'utf8');
if (/const\s+VERSION\s*=\s*['"]/.test(src)) die('src/pi-remote.ts must not hardcode VERSION; use packageVersion()');

// Local developer guard: if code differs from HEAD, package.json must differ from HEAD too.
assertVersionBumpedFrom('HEAD', 'HEAD');

// CI/release guard: once committed, compare this commit to its parent as well.
if (tryRun('git', ['rev-parse', '--verify', 'HEAD~1'])) assertVersionBumpedFrom('HEAD~1', 'HEAD~1');

const head = run('git', ['rev-parse', 'HEAD']);
const exactTag = tryRun('git', ['describe', '--tags', '--exact-match', 'HEAD']);
const expectedTags = [`v${version}`, version];

if (exactTag && !expectedTags.includes(exactTag)) {
  die(`HEAD is tagged ${exactTag}, but package.json version is ${version}`);
}

const versionTag = expectedTags.find((tag) => tryRun('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]));
if (!versionTag) {
  console.log(`version ${version} has no git tag yet; OK because version bump checks passed`);
  process.exit(0);
}

const tagCommit = run('git', ['rev-list', '-n', '1', versionTag]);
if (tagCommit !== head) {
  const changed = tryRun('git', ['diff', '--name-only', `${versionTag}..HEAD`]);
  die(`package.json version ${version} points at tag ${versionTag} (${tagCommit.slice(0, 12)}), but HEAD is ${head.slice(0, 12)}. Bump package.json version before building/releasing.\nChanged since ${versionTag}:\n${changed || '(no file list)'}`);
}

console.log(`version ${version} matches ${versionTag} at HEAD`);
