#!/usr/bin/env node
/* A11y Inspector CLI — run the audit engine headlessly via Node.
 *
 * Usage:
 *   node cli.mjs < file.html                 # pretty text report on stdout
 *   node cli.mjs --json < file.html          # machine-readable JSON
 *   node cli.mjs --fix < file.html           # apply safe fixes, print fixed HTML
 *   node cli.mjs page.html --json            # read from a file
 *   node cli.mjs --self                      # audit the bundled index.html
 *
 * CI gating:
 *   node cli.mjs page.html --fail-on error   # exit 1 when any error finding exists
 *   node cli.mjs page.html --min-score 90    # exit 1 when score < 90
 *   node cli.mjs page.html --fail-on warning # errors or warnings both fail
 *   node cli.mjs page.html --baseline .a11y-baseline.json      # fail only on regression vs baseline
 *   node cli.mjs page.html --baseline b.json --update-baseline # write baseline from current audit
 *
 * GitHub Actions annotations (::error/::warning/::notice on the PR diff):
 *   node cli.mjs page.html --github          # or set GITHUB_ACTIONS=true (auto in Actions)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const fixOut = args.includes('--fix');
const selfAudit = args.includes('--self');
const updateBaseline = args.includes('--update-baseline');
const githubAnnotations = args.includes('--github') || process.env.GITHUB_ACTIONS === 'true';
const VALUE_FLAGS = ['--fail-on', '--min-score', '--baseline'];

/** Value of a --flag value pair, or null. */
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const failOn = (flagValue('--fail-on') || '').toLowerCase();
const minScoreRaw = flagValue('--min-score');
const baselinePath = flagValue('--baseline');
if (failOn && !['error', 'warning', 'notice'].includes(failOn)) {
  console.error(`CLI error: --fail-on accepts error|warning|notice (got "${failOn}").`);
  process.exit(2);
}
let minScore = null;
if (minScoreRaw !== null) {
  minScore = Number(minScoreRaw);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
    console.error(`CLI error: --min-score accepts a number 0–100 (got "${minScoreRaw}").`);
    process.exit(2);
  }
}
if (updateBaseline && !baselinePath) {
  console.error('CLI error: --update-baseline requires --baseline <file>.');
  process.exit(2);
}

/** Collapse whitespace while keeping a map back to original offsets. */
function collapseSource(src) {
  let text = '';
  const map = [];
  let prevSpace = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      text += ' ';
      map.push(i);
      prevSpace = true;
    } else {
      text += ch;
      map.push(i);
      prevSpace = false;
    }
  }
  return { text, map };
}

/* Workflow-command escaping (GitHub Actions annotations). */
const wf = (s) => String(s ?? '').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const wfp = (s) => wf(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** Read and normalize a baseline file; exit 2 when malformed.
 * A missing file returns null so `--update-baseline` can create it. */
function loadBaseline(p) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(resolve(p), 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    console.error(`CLI error: could not read baseline "${p}": ${err.message}`);
    process.exit(2);
  }
  try {
    const score = Number(raw.score);
    const counts = raw.counts || {};
    if (!Number.isFinite(score) || typeof counts.errors !== 'number') throw new Error('missing "score" or "counts.errors"');
    return {
      score,
      counts: { errors: counts.errors, warnings: counts.warnings || 0, notices: counts.notices || 0 },
    };
  } catch (err) {
    console.error(`CLI error: malformed baseline "${p}": ${err.message}`);
    process.exit(2);
  }
}

function loadEngine(dom) {
  // The engine is the tail of app.js; run it inside a DOM so the browser
  // init path binds to the shell document, then grab the exported API.
  const window = dom.window;
  const { document } = window;
  const shell = readFileSync(join(here, 'index.html'), 'utf8')
    .replace('<link rel="stylesheet" href="styles.css">', '')
    .replace('<script src="app.js"></script>', '');
  document.open();
  document.write(shell);
  document.close();
  const appSource = readFileSync(join(here, 'app.js'), 'utf8');
  window.module = { exports: {} };
  const scriptEl = document.createElement('script');
  scriptEl.textContent = appSource;
  document.body.appendChild(scriptEl);
  return window.module?.exports || null;
}

function readStdin() {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolvePromise(data));
    process.stdin.on('error', rejectPromise);
  });
}

function inlineCssForContrast(html) {
  // Copy <link rel="stylesheet"> targets into <style> so cascade-aware
  // contrast rules see the project's own tokens when auditing app files.
  const linkRe = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>(?:<\/link>)?/i;
  const match = html.match(linkRe);
  if (!match) return html;
  try {
    const css = readFileSync(resolve(join(here, match[1])), 'utf8');
    return html.replace(linkRe, `<style>${css}</style>`);
  } catch {
    return html;
  }
}

function serializeFinding(f) {
  return {
    rule: f.rule,
    severity: f.severity,
    wcag: f.wcag,
    selector: f.selector,
    snippet: f.snippet,
    note: f.note,
  };
}

const domFor = (html) => new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/', runScripts: 'dangerously' });
const engine = loadEngine(domFor(''));
if (!engine) {
  console.error('CLI error: could not load the audit engine.');
  process.exit(1);
}

let inputHtml = '';
let inputFile = null;
let locateSource = '';
if (selfAudit) {
  locateSource = readFileSync(join(here, 'index.html'), 'utf8');
  inputHtml = inlineCssForContrast(locateSource);
  inputFile = 'index.html';
} else {
  // First bare argument that is not the value of a --flag.
  const fileArg = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]));
  if (fileArg) {
    inputHtml = readFileSync(resolve(fileArg), 'utf8');
    locateSource = inputHtml;
    inputFile = relative(process.cwd(), resolve(fileArg)) || fileArg;
  } else {
    inputHtml = await readStdin();
  }
}

if (!inputHtml.trim()) {
  console.error('CLI error: no HTML provided (pipe a file, pass a path, or use --self).');
  process.exit(1);
}

const baseline = baselinePath ? loadBaseline(baselinePath) : null;
if (baselinePath && !updateBaseline && !baseline) {
  console.error(`CLI error: baseline "${baselinePath}" does not exist yet — create it with --update-baseline.`);
  process.exit(2);
}

const audit = engine.audit(inputHtml);
const score = engine.scoreOf(audit.findings);
const counts = engine.counts(audit.findings);

if (fixOut) {
  const fixed = engine.safeFixes(inputHtml);
  const reAudit = engine.audit(fixed.html);
  process.stdout.write(JSON.stringify({
    applied: fixed.changes,
    scoreBefore: score,
    scoreAfter: engine.scoreOf(reAudit.findings),
    html: fixed.html,
  }, null, jsonOut ? 2 : 2));
  process.exit(0);
}

// Gate evaluation
const gateFailures = [];
const baselineRegressions = [];
if (failOn) {
  const severityRank = { notice: 0, warning: 1, error: 2 };
  const cutoff = severityRank[failOn];
  const offenders = audit.findings.filter((f) => severityRank[f.severity] >= cutoff);
  if (offenders.length) {
    gateFailures.push(`${offenders.length} finding(s) at or above "${failOn}"`);
    for (const f of offenders.slice(0, 20)) {
      process.stderr.write(`  gate: [${f.severity.toUpperCase()}] ${f.rule} — ${f.selector || '(document)'}\n`);
    }
    if (offenders.length > 20) process.stderr.write(`  gate: …and ${offenders.length - 20} more\n`);
  }
}
if (minScore !== null && score < minScore) {
  gateFailures.push(`score ${score} < --min-score ${minScore}`);
}
if (baseline) {
  if (score < baseline.score) baselineRegressions.push(`score ${score} < baseline ${baseline.score}`);
  if (counts.error > baseline.counts.errors) baselineRegressions.push(`errors ${counts.error} > baseline ${baseline.counts.errors}`);
  if (counts.warning > baseline.counts.warnings) baselineRegressions.push(`warnings ${counts.warning} > baseline ${baseline.counts.warnings}`);
  gateFailures.push(...baselineRegressions);
}

if (updateBaseline) {
  const payload = {
    tool: 'a11y-inspector',
    score,
    counts: { errors: counts.error, warnings: counts.warning, notices: counts.notice },
  };
  writeFileSync(resolve(baselinePath), `${JSON.stringify(payload, null, 2)}\n`);
  console.error(`Baseline written to ${baselinePath} (score ${score}, ${counts.error} errors, ${counts.warning} warnings, ${counts.notice} notices).`);
  process.exit(0);
}

// GitHub Actions annotations — written to stderr so stdout stays parseable.
// The runner processes workflow commands from stderr too.
if (githubAnnotations) {
  const findings = audit.findings.filter((f) => f.severity !== 'pass');
  let collapse = null;
  for (const f of findings.slice(0, 50)) {
    const level = f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'notice';
    const props = [`title=${wfp(`A11y ${f.rule} (${f.severity.toUpperCase()})`)}`];
    if (inputFile) {
      props.push(`file=${wfp(inputFile)}`);
      if (!collapse) collapse = collapseSource(locateSource);
      const needle = (f.snippet || '').slice(0, 40).replace(/\s+/g, ' ').trim();
      if (needle.length >= 8) {
        const idx = collapse.text.indexOf(needle);
        if (idx !== -1) props.push(`line=${locateSource.slice(0, collapse.map[idx]).split('\n').length}`);
      }
    }
    process.stderr.write(`::${level} ${props.join(',')}::${wf(`WCAG ${f.wcag} — ${f.note || f.selector}`)}\n`);
  }
  if (findings.length > 50) {
    process.stderr.write(`::notice title=${wfp('A11y annotations truncated')}::${wf(`${findings.length - 50} more findings were not annotated`)}\n`);
  }
  if (gateFailures.length) {
    process.stderr.write(`::error title=${wfp('A11y gate failed')}::${wf(gateFailures.join(' | '))}\n`);
  }
}

if (jsonOut) {
  process.stdout.write(JSON.stringify({
    tool: 'a11y-inspector',
    version: JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version,
    durationMs: audit.duration,
    score,
    counts: { errors: counts.error, warnings: counts.warning, notices: counts.notice, passed: counts.pass },
    findings: audit.findings.filter((f) => f.severity !== 'pass').map(serializeFinding),
    ...(baseline ? {
      baseline: {
        score: baseline.score,
        counts: baseline.counts,
        deltas: {
          score: score - baseline.score,
          errors: counts.error - baseline.counts.errors,
          warnings: counts.warning - baseline.counts.warnings,
          notices: counts.notice - baseline.counts.notices,
        },
        regression: baselineRegressions.length > 0,
      },
    } : {}),
    gate: { failed: gateFailures.length > 0, failures: gateFailures },
  }, null, 2));
  process.exit(gateFailures.length ? 1 : 0);
}

if (gateFailures.length) {
  for (const g of gateFailures) process.stderr.write(`a11y gate failed: ${g}\n`);
  process.exit(1);
}

// Pretty text report
const line = '='.repeat(52);
process.stdout.write([
  line,
  `A11y Inspector — score ${score}/100`,
  `${counts.error} errors, ${counts.warning} warnings, ${counts.notices ?? counts.notice} notices, ${counts.pass} passed (${audit.duration} ms)`,
  ...(baseline ? [`Baseline ${baseline.score}/100 — ${baselineRegressions.length ? 'REGRESSION' : 'no regression'}`] : []),
  line,
  ...audit.findings.filter((f) => f.severity !== 'pass').map((f) => `[${f.severity.toUpperCase()}] WCAG ${f.wcag} ${f.rule}\n  ${f.selector}\n  ${f.note || ''}\n  ${f.snippet.slice(0, 120)}`),
].join('\n') + '\n');
