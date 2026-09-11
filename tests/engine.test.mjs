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

const DEPS = {
  contrastRatio: ['parseColor', 'channelLum', 'relativeLuminance'],
  relativeLuminance: ['channelLum'],
};

function load(...names) {
  const wanted = new Set();
  const add = (n) => {
    const bare = n.replace(/^fn:/, '');
    if (wanted.has(bare)) return;
    wanted.add(bare);
    (DEPS[bare] || []).forEach(add);
  };
  names.forEach(add);
  const kindOf = (n) => (names.includes(`fn:${n}`) ? 'function' : 'const');
  const code = `'use strict';\n${[...wanted].map((n) => extract(kindOf(n), n)).join('\n')}\nreturn {${[...wanted].join(',')}};`;
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

test('parseColor handles hex, rgb, rgba and rejects junk', () => {
  const { parseColor } = load('parseColor');
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.deepEqual(parseColor('#00ff88'), [0, 255, 136]);
  assert.deepEqual(parseColor('rgb(12, 34, 56)'), [12, 34, 56]);
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), [1, 2, 3]);
  assert.equal(parseColor('transparent'), null);
  assert.equal(parseColor(''), null);
  assert.equal(parseColor('not-a-color'), null);
  assert.equal(parseColor('url(bg.png)'), null);
});

test('contrastRatio implements the WCAG luminance formula', () => {
  const { contrastRatio } = load('contrastRatio', 'parseColor');
  assert.ok(Math.abs(contrastRatio([0, 0, 0], [255, 255, 255]) - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio([255, 255, 255], [255, 255, 255]) - 1) < 0.01);
  assert.ok(Math.abs(contrastRatio([255, 255, 255], [119, 229, 192]) - 1.53) < 0.05);
  assert.ok(Math.abs(contrastRatio([255, 255, 255], [7, 19, 31]) - 18.72) < 0.3);
  assert.equal(contrastRatio(null, [0, 0, 0]), null);
  assert.equal(contrastRatio([0, 0, 0], null), null);
  // Symmetry: swapping fg/bg must not change the ratio.
  const a = contrastRatio([255, 0, 0], [0, 0, 255]);
  const b = contrastRatio([0, 0, 255], [255, 0, 0]);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test('fontSizePx converts px, pt, em, rem and percent', () => {
  const { fontSizePx } = load('fontSizePx');
  assert.equal(fontSizePx('24px'), 24);
  assert.equal(fontSizePx('18.66px'), 18.66);
  assert.equal(fontSizePx('2em'), 32);
  assert.equal(fontSizePx('1.5rem'), 24);
  assert.equal(fontSizePx('150%'), 24);
  assert.equal(fontSizePx('18pt'), 24);
  assert.equal(fontSizePx('large'), null);
  assert.equal(fontSizePx(''), null);
});

test('isLargeText applies WCAG large-text thresholds', () => {
  const { isLargeText } = load('isLargeText');
  assert.ok(isLargeText(24, false));
  assert.ok(!isLargeText(23.9, false));
  assert.ok(isLargeText(18.66, true));
  assert.ok(isLargeText(19, true));
  assert.ok(!isLargeText(18.5, true));
  assert.ok(!isLargeText(18.66, false));
  assert.ok(!isLargeText(null, true));
});

test('parseCssRules extracts declarations and skips at-rules', () => {
  const { parseCssRules } = load('parseCssRules');
  const rules = parseCssRules('body { background-color: #07131f; } p { color: #999; font-size: 14px; } /* c */ @media (min-width: 600px) { div { color: red; } } .b::placeholder { color: #aaa; }');
  const body = rules.find(r => r.selector === 'body');
  const p = rules.find(r => r.selector === 'p');
  assert.equal(body.decls['background-color'], '#07131f');
  assert.equal(p.decls['color'], '#999');
  assert.ok(!rules.some(r => r.selector.startsWith('@')));
  assert.ok(!rules.some(r => r.selector.includes('::placeholder')));
});

test('inlineDecls parses style attributes tolerantly', () => {
  const { inlineDecls } = load('inlineDecls');
  const d = inlineDecls('color:#333;background: white ; font-size:12PX');
  assert.equal(d['color'], '#333');
  assert.equal(d['background'], 'white');
  assert.equal(d['font-size'], '12PX');
  assert.deepEqual(inlineDecls(null), {});
  assert.deepEqual(inlineDecls('nonsense'), {});
});

test('hasDirectText ignores element-only children', () => {
  const { hasDirectText } = load('hasDirectText');
  // Pure-text nodes via a tiny DOM shim.
  const text = (s) => ({ nodeType: 3, textContent: s });
  const el = (s) => ({ nodeType: 1 });
  assert.ok(hasDirectText({ childNodes: [text(' hi ')] }));
  assert.ok(!hasDirectText({ childNodes: [text('   ')] }));
  assert.ok(!hasDirectText({ childNodes: [el()] }));
  assert.ok(hasDirectText({ childNodes: [el(), text('x')] }));
});

test('app.js no longer uses legacy escape/unescape globals', () => {
  assert.ok(!/\b(unescape|escape)\s*\(/.test(src), 'escape/unescape should be replaced');
});
