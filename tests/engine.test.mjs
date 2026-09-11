// Minimal Node test harness for the pure logic of app.js (P1 checklist item).
// Browser-only parts (DOMParser audit, Preview iframe, rendering) need a DOM
// and are intentionally not covered here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'app.js'), 'utf8');

// app.js keeps its pure helpers on single lines, so we can lift them directly.
function extract(kind, name) {
  const pattern = kind === 'const'
    ? new RegExp(`^  const ${name} ?= ?.*$`, 'm')
    : new RegExp(`^  function ${name}\\b.*$`, 'm');
  const line = src.match(pattern)?.[0];
  if (!line) throw new Error(`Cannot extract ${kind} ${name} from app.js`);
  return line;
}

function load(...names) {
  const code = `'use strict';\n${names.map((n) => extract(n.startsWith('fn:') ? 'function' : 'const', n.replace(/^fn:/, ''))).join('\n')}\nreturn {${names.map((n) => n.replace(/^fn:/, '')).join(',')}};`;
  return new Function(code)();
}

test('esc escapes HTML-sensitive characters', () => {
  const { esc } = load('esc');
  assert.equal(esc(`<img src="x" onerror='a'>&`), '&lt;img src=&quot;x&quot; onerror=&#39;a&#39;&gt;&amp;');
  assert.equal(esc(undefined), '');
});

test('validLang accepts real language tags and rejects junk', () => {
  const { validLang } = load('validLang');
  assert.ok(validLang('en'));
  assert.ok(validLang('fa'));
  assert.ok(validLang('en-US'));
  assert.ok(!validLang(''));
  assert.ok(!validLang(null));
  assert.ok(!validLang('123'));
});

test('slug produces URL-safe report names', () => {
  const { slug } = load('slug');
  assert.equal(slug('My Report! 2026'), 'my-report-2026');
  assert.equal(slug('###'), 'report');
});

test('share codec round-trips UTF-8 text', () => {
  const { encodeShare, decodeShare } = load('encodeShare', 'decodeShare');
  const samples = ['سلام دنیا', 'A11y <Inspector> & co 🚀', 'line1\nline2\ttab'];
  for (const text of samples) {
    assert.equal(decodeShare(encodeShare(text)), text);
  }
  // Legacy behavior compatibility for plain ASCII (old links must keep working).
  assert.equal(decodeShare(btoa('hello world')), 'hello world');
});

test('scoreOf starts at 100 and applies severity penalties', () => {
  const { scoreOf } = load('fn:scoreOf');
  assert.equal(scoreOf([]), 100);
  assert.equal(scoreOf([{ severity: 'error' }]), 92);
  assert.equal(scoreOf([{ severity: 'error' }, { severity: 'warning' }, { severity: 'notice' }]), 87);
  const many = Array.from({ length: 20 }, () => ({ severity: 'error' }));
  assert.equal(scoreOf(many), 0);
});

test('counts tallies each severity', () => {
  const { counts } = load('fn:counts');
  const c = counts([
    { severity: 'error' },
    { severity: 'error' },
    { severity: 'warning' },
    { severity: 'notice' },
    { severity: 'pass' },
  ]);
  assert.deepEqual(c, { error: 2, warning: 1, notice: 1, pass: 1 });
});

test('canSafeFix only offers fixes for fixable failing rules', () => {
  const { canSafeFix } = load('canSafeFix');
  assert.ok(canSafeFix({ severity: 'error', rule: 'lang' }));
  assert.ok(canSafeFix({ severity: 'warning', rule: 'iframe' }));
  assert.ok(!canSafeFix({ severity: 'pass', rule: 'lang' }));
  assert.ok(!canSafeFix({ severity: 'error', rule: 'image' }));
});

test('app.js no longer uses legacy escape/unescape globals', () => {
  assert.ok(!/\b(unescape|escape)\s*\(/.test(src), 'escape/unescape should be replaced');
});
