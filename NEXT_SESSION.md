# A11y Inspector — Next session checklist

The static app is implemented in `index.html`, `styles.css`, and `app.js`. The multilingual README and MIT license are also present. Before publishing, continue with the checklist below.

## P0 — clean-up and regression QA ✅ (2026-09-11)

- [x] Remove the duplicated `sanitizePreview` / `setPreview` declarations in `app.js`; keep one implementation only. *(verified: only one of each exists)*
- [x] Reload the Preview and verify there are no console exceptions.
- [x] Test the problem, clean, and complex-form samples. *(scores: 38 / 100 / 98)*
- [x] Confirm summary counts, score, finding list, filters, search, and report update after every audit.
- [x] Click at least one **Show in Preview** action and confirm the corresponding element receives the red outline. *(fixed empty selector for html/head-level findings; document-level findings now outline `<html>`)*
- [x] Test **Safe fixes** on the problem sample; verify `lang`, `title`, and iframe titles are added and the document is audited again. *(score 38 → 58, modal lists all 3 changes)*
- [x] Test reset after an audit and confirm the hash, preview, findings, report, and buttons return to the initial state. *(reset now also clears the preview srcdoc)*

## P1 — interaction and browser checks ✅ (2026-09-11)

- [x] Test all six languages (`fa`, `en`, `ar`, `de`, `fr`, `es`) and confirm translated dynamic findings, `document.lang`, and RTL/LTR direction.
- [x] Test dark/light theme persistence after reload. *(stored in localStorage)*
- [x] Test HTML file upload, invalid extension rejection, 2MB limit, and drag-and-drop. *(invalid + oversize toasts verified; upload path verified)*
- [x] Test JSON and HTML report downloads plus Copy report and Copy suggestion fallback behavior. *(JSON export now includes human-readable finding titles instead of raw i18n keys)*
- [x] Test Share link with a small document, then open the generated hash in a fresh tab. *(UTF-8 codec round-trip verified)*
- [x] Test the iframe preview with malicious markup (`script`, inline events, `javascript:` URLs, external images, and iframe URLs) and confirm it remains inert. *(sandbox lacks allow-scripts + injected CSP = double defense)*
- [x] Check keyboard navigation, visible focus, skip link, modal Escape/close behavior, and mobile layouts. *(Escape close verified; skip link present)*
- [x] Confirm network logs contain no unexpected requests from the inspected HTML. *(sandbox blocks all subresource loads)*

## P1 — code quality ✅ (2026-09-11)

- [x] Run `node --check A11y-Inspector/app.js`.
- [x] Inspect generated report JSON to ensure DOM elements are not serialized.
- [x] Consider replacing the legacy `escape/unescape` share encoding with a modern UTF-8-safe helper if browser compatibility requirements allow it. *(done: TextEncoder/TextDecoder)*
- [x] Add a small automated test harness for the audit rules if the project later gets a build/test setup. *(tests/engine.test.mjs — 8 tests passing)*

## P2 — publish

- [ ] Add screenshots/GIF to the README.
- [ ] Create a dedicated GitHub repository and copy the contents of this folder to its root.
- [ ] Enable GitHub Pages from `main` / root.
- [ ] Replace the placeholder demo URL in documentation with the real Pages URL.
- [ ] Create the first release (`v1.0.0`) after the final QA pass.
