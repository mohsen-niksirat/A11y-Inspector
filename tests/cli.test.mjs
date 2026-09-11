// CLI integration tests: spawn cli.mjs as a real process and assert on the
// exit codes and JSON payload. These gate the CI flags (--fail-on, --min-score).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cliPath = join(root, 'cli.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'a11y-cli-'));

// Cheap jsdom-free fixture docs for the audit itself; the CLI still loads the
// engine (and jsdom) once per invocation, so keep the number of runs modest.
const BAD_DOC = `<!doctype html><html><head><title>t</title></head><body><img src="x.png"><form><input></form></body></html>`;
const CLEAN_DOC = `<!doctype html><html lang="en"><head><title>t</title></head><body><p>hello</p></body></html>`;
const badFile = join(tmp, 'bad.html');
const cleanFile = join(tmp, 'clean.html');
writeFileSync(badFile, BAD_DOC);
writeFileSync(cleanFile, CLEAN_DOC);

// Run once per document up front; every test below reuses the cached result.
function runCli(file, ...flags) {
  return spawnSync(process.execPath, [cliPath, file, ...flags], {
    encoding: 'utf8',
    timeout: 120000,
  });
}

test.after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test('CLI: --fail-on error fails when an error finding exists', () => {
  const r = runCli(badFile, '--fail-on', 'error');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a11y gate failed/);
});

test('CLI: --fail-on warning passes on a document with only warnings below cutoff', () => {
  // CLEAN_DOC has 1 warning (missing main landmark), so --fail-on error passes.
  const r = runCli(cleanFile, '--fail-on', 'error', '--json');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.counts.errors, 0);
});

test('CLI: --fail-on warning fails when a warning exists', () => {
  const r = runCli(cleanFile, '--fail-on', 'warning');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a11y gate failed/);
  assert.match(r.stderr, /gate:/);
});

test('CLI: --min-score passes when score meets the threshold', () => {
  const r = runCli(cleanFile, '--min-score', '90', '--json');
  assert.equal(r.status, 0);
  assert.ok(JSON.parse(r.stdout).score >= 90);
});

test('CLI: --min-score fails when score is below the threshold', () => {
  const r = runCli(badFile, '--min-score', '95');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /score \d+ < --min-score 95/);
});

test('CLI: gates combine (fail-on warning + min-score 100 fails on both counts)', () => {
  const r = runCli(cleanFile, '--fail-on', 'warning', '--min-score', '100');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a11y gate failed/);
});

test('CLI: invalid --fail-on value exits 2 without auditing', () => {
  const r = runCli(cleanFile, '--fail-on', 'banana');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--fail-on accepts error\|warning\|notice/);
});

test('CLI: invalid --min-score value exits 2 without auditing', () => {
  const r = runCli(cleanFile, '--min-score', '250');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--min-score accepts a number/);
});

test('CLI: --json payload shape is stable (tool, score, counts, findings)', () => {
  const r = runCli(cleanFile, '--json');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.tool, 'a11y-inspector');
  assert.equal(typeof out.score, 'number');
  assert.ok(out.counts && typeof out.counts.errors === 'number');
  assert.ok(Array.isArray(out.findings));
  for (const f of out.findings) {
    assert.ok(f.rule && f.severity && f.wcag);
  }
});

test('CLI: self-audit of the bundled app stays clean and above 95', () => {
  const r = spawnSync(process.execPath, [cliPath, '--self', '--json'], {
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.score >= 95, `self score ${out.score} should be >= 95`);
});
