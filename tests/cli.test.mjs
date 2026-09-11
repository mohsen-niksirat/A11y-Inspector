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

function runCliEnv(file, env, ...flags) {
  return spawnSync(process.execPath, [cliPath, file, ...flags], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, ...env },
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

// --- --baseline mode ---

const baselineFile = join(tmp, 'baseline.json');

test('CLI: --update-baseline creates a baseline file with score and counts', () => {
  const r = runCli(cleanFile, '--baseline', baselineFile, '--update-baseline', '--json');
  assert.equal(r.status, 0);
  const raw = JSON.parse(readFileSync(baselineFile, 'utf8'));
  assert.equal(raw.tool, 'a11y-inspector');
  assert.equal(typeof raw.score, 'number');
  assert.equal(typeof raw.counts.errors, 'number');
});

test('CLI: --update-baseline without --baseline exits 2', () => {
  const r = runCli(cleanFile, '--update-baseline');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--update-baseline requires/);
});

test('CLI: comparing without a baseline file exits 2 with a hint', () => {
  const missing = join(tmp, 'nope.json');
  const r = runCli(cleanFile, '--baseline', missing);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--update-baseline/);
});

test('CLI: --baseline passes when the document matches the baseline', () => {
  const r = runCli(cleanFile, '--baseline', baselineFile, '--json');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.baseline.regression, false);
  assert.equal(out.baseline.deltas.score, 0);
  assert.equal(out.gate.failed, false);
});

test('CLI: --baseline fails on score and error-count regressions', () => {
  const r = runCli(badFile, '--baseline', baselineFile, '--json');
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.baseline.regression, true);
  assert.ok(out.baseline.deltas.score < 0);
  assert.ok(out.baseline.deltas.errors > 0);
  assert.ok(out.gate.failures.some((g) => /score \d+ < baseline/.test(g)));
  assert.ok(out.gate.failures.some((g) => /errors \d+ > baseline/.test(g)));
});

test('CLI: --baseline passes when the document improves over the baseline', () => {
  // Baseline the bad doc, then audit the clean one: score up, errors down.
  runCli(badFile, '--baseline', baselineFile, '--update-baseline');
  const r = runCli(cleanFile, '--baseline', baselineFile, '--json');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.baseline.regression, false);
  assert.ok(out.baseline.deltas.score > 0);
});

test('CLI: malformed baseline file exits 2', () => {
  const junk = join(tmp, 'junk.json');
  writeFileSync(junk, '{not json');
  const r = runCli(cleanFile, '--baseline', junk);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /could not read baseline/);
});

// --- GitHub Actions annotations ---

test('CLI: --github emits ::error/::warning/::notice annotations with file and line', () => {
  const r = runCli(badFile, '--github');
  assert.equal(r.status, 0);
  const annotations = r.stderr.split('\n').filter((l) => l.startsWith('::'));
  assert.ok(annotations.length >= 3, `expected annotations, got: ${annotations.join(' | ')}`);
  assert.ok(annotations.some((l) => l.startsWith('::error ')));
  assert.ok(annotations.every((l) => l.includes('file=')));
  // line= is best-effort: skipped when the snippet is too short to match safely.
  const withLine = annotations.filter((l) => /line=\d+/.test(l));
  assert.ok(withLine.length >= Math.floor(annotations.length / 2));
  // stdout must stay annotation-free so it remains parseable.
  assert.ok(!r.stdout.includes('::'));
});

test('CLI: GITHUB_ACTIONS=true auto-enables annotations without the flag', () => {
  const r = runCliEnv(badFile, { GITHUB_ACTIONS: 'true' });
  const annotations = r.stderr.split('\n').filter((l) => l.startsWith('::'));
  assert.ok(annotations.length >= 3);
});

test('CLI: annotations are absent when not running in Actions and --github is unset', () => {
  const r = runCliEnv(badFile, { GITHUB_ACTIONS: '' });
  assert.ok(!r.stderr.split('\n').some((l) => l.startsWith('::')));
});

test('CLI: gate failure emits a single ::error summary annotation', () => {
  const r = runCli(badFile, '--github', '--min-score', '95', '--json');
  assert.equal(r.status, 1);
  assert.ok(r.stderr.split('\n').some((l) => l.startsWith('::error title=A11y gate failed')));
  // JSON on stdout still carries the structured gate result.
  assert.equal(JSON.parse(r.stdout).gate.failed, true);
});
