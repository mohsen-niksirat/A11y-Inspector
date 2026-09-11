#!/usr/bin/env node
/* A11y Inspector CLI — run the audit engine headlessly via Node.
 *
 * Usage:
 *   node cli.mjs < file.html                 # pretty text report on stdout
 *   node cli.mjs --json < file.html          # machine-readable JSON
 *   node cli.mjs --fix < file.html           # apply safe fixes, print fixed HTML
 *   node cli.mjs page.html --json            # read from a file
 *   node cli.mjs --self                      # audit the bundled index.html
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const fixOut = args.includes('--fix');
const selfAudit = args.includes('--self');

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
if (selfAudit) {
  inputHtml = inlineCssForContrast(readFileSync(join(here, 'index.html'), 'utf8'));
} else {
  const fileArg = args.find((a) => !a.startsWith('--'));
  inputHtml = fileArg ? readFileSync(resolve(fileArg), 'utf8') : await readStdin();
}

if (!inputHtml.trim()) {
  console.error('CLI error: no HTML provided (pipe a file, pass a path, or use --self).');
  process.exit(1);
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

if (jsonOut) {
  process.stdout.write(JSON.stringify({
    tool: 'a11y-inspector',
    version: JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version,
    durationMs: audit.duration,
    score,
    counts: { errors: counts.error, warnings: counts.warning, notices: counts.notice, passed: counts.pass },
    findings: audit.findings.filter((f) => f.severity !== 'pass').map(serializeFinding),
  }, null, 2));
  process.exit(0);
}

// Pretty text report
const line = '='.repeat(52);
process.stdout.write([
  line,
  `A11y Inspector — score ${score}/100`,
  `${counts.error} errors, ${counts.warning} warnings, ${counts.notices ?? counts.notice} notices, ${counts.pass} passed (${audit.duration} ms)`,
  line,
  ...audit.findings.filter((f) => f.severity !== 'pass').map((f) => `[${f.severity.toUpperCase()}] WCAG ${f.wcag} ${f.rule}\n  ${f.selector}\n  ${f.note || ''}\n  ${f.snippet.slice(0, 120)}`),
].join('\n') + '\n');
