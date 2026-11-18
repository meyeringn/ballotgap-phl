# BallotGap PHL

Nonpartisan static site (GitHub Pages) that shows the City Commissioners' published polling-place accessibility codes. Plain HTML/CSS/JS, no build step, no backend. The primary users are Disabled voters.

## Commands
- `npm test`: unit tests for `js/core.js` plus static checks (CSP, EN/ES parity, versions). Run after every change.
- `npm run test:e2e`: offline browser smoke test with faked APIs. Needs Playwright (`npm i && npx playwright install chromium`). Set `SCREENSHOTS=dir` to save 375px and 1280px screenshots.
- `npm run serve`, then open http://localhost:8000. Live APIs need network access.

## Where things live
- `js/config.js`: version, election dates, "data last verified". Routine updates go here.
- `js/i18n.js`: `data-i` strings (EN + ES) and code legends.
- `js/core.js`: pure logic, no DOM or network. Add tests in `tests/core.test.js` for anything new here.
- `js/app.js`: DOM, fetch, events. `css/styles.css`: design tokens at the top.

## Rules
- IMPORTANT: An address match is always "provisional". Never call it verified, confirmed, or "your polling place". Always link to Philadelphia Atlas.
- Never store, log, cache, or put a searched address in a URL or console message. Only the public ward-division id may go in `#p=`.
- Every user-facing string needs English and Spanish: `data-en` + `data-es`, a `data-i` key in both languages, or `say('…', '…')` in JS.
- Use identity-first language ("Disabled voters"), never "people with disabilities".
- Election dates come only from vote.phila.gov or pa.gov. If you can't confirm a date, leave the election out of the config; the page then shows "between elections."
- Adding an outside host means updating the CSP meta tag in `index.html` and the Privacy section of `README.md`. Scripts must not need `'unsafe-inline'`.
- No new frameworks, build tools, trackers, or CDNs without asking. Leaflet from unpkg (with SRI) is the only runtime dependency.
- Colors: use the tokens in `css/styles.css`. Body text needs ≥ 4.5:1 contrast and UI borders ≥ 3:1. `--gold` is never text on a light background.
- Meaning is never carried by color alone. Map symbols use shape + color, and badges include text.
- Any single-key keyboard shortcut must be optional (WCAG 2.1.4). Use a visible `role="status"` message, not `alert()` or `prompt()`.

## Workflow
- Make small, targeted edits. Don't regenerate whole files, because that silently undoes earlier fixes.
- Bump `version` in `js/config.js` and the `<title>` together (`npm run check` enforces this).
- Before finishing UI work, run the e2e test with screenshots and look at both widths.
- For accessibility-sensitive changes, ask the `a11y-reviewer` agent to review the diff.
