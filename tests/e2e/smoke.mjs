// Offline browser smoke test: serves the repo, fakes every external API,
// and checks the main voter and researcher flows in English and Spanish.
// Run: npm run test:e2e   (needs Playwright + a Chromium/Chrome install)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { cartoRows, nominatim, division, leafletStub } from './fixtures.mjs';

const require = (await import('node:module')).createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright')); }

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAGE = process.env.PAGE || 'index.html';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || PAGE;
  try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const failures = [];
async function check(name, fn) {
  try { await fn(); console.log('  ok  ', name); }
  catch (e) { failures.push(name); console.log('  FAIL', name, '\n       ', e.message.split('\n')[0]); }
}

async function openPage({ width = 1280, height = 900, rows = cartoRows(), ready = /retrieved|consultados/i } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|integrity/i.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(leafletStub);
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('phl.carto.com')) return route.fulfill({ json: { rows } });
    if (url.includes('nominatim.openstreetmap.org')) return route.fulfill({ json: nominatim });
    if (url.includes('Political_Divisions')) return route.fulfill({ json: division });
    return route.abort();
  });
  await page.goto(base + PAGE);
  await page.waitForFunction(re => new RegExp(re, 'i').test(document.getElementById('dataStatus').textContent), ready.source);
  return { page, errors };
}

console.log(`BallotGap smoke test (${PAGE})`);
const { page, errors } = await openPage();

await check('loads data and renders citywide metrics', async () => {
  assert.equal(await page.locator('#metrics .metric').count(), 6);
  assert.match(await page.locator('#metrics .metric').first().textContent(), /1,320/);
});
await check('lists places with pagination', async () => {
  assert.equal(await page.locator('#placeList .result').count(), 35);
  await page.click('#moreBtn');
  assert.equal(await page.locator('#placeList .result').count(), 70);
});
await check('ward filter has every ward', async () => {
  assert.equal(await page.locator('#wardFilter option').count(), 67);
});
await check('accessibility filter narrows the list', async () => {
  await page.selectOption('#filter', 'barrier');
  assert.match(await page.textContent('#filterCount'), /Showing 1[0-9]{2} \/ 1,320/);
  await page.selectOption('#filter', 'all');
});
await check('text search filters places', async () => {
  await page.fill('#placeQuery', 'Center 6620');
  assert.match(await page.textContent('#filterCount'), /Showing 1 \//);
  await page.click('#resetFilters');
  assert.match(await page.textContent('#filterCount'), /Showing 1,320/);
});
await check('address lookup gives a provisional match, never "verified"', async () => {
  await page.fill('#searchAddress', '1234 Market St');
  await page.click('#searchBtn');
  await page.waitForSelector('#assigned:not(.hidden)');
  const text = await page.textContent('#assigned');
  assert.match(text, /Ward 5, Division 1/);
  assert.match(text, /NOT an official/);
  assert.match(await page.textContent('#planWarning'), /PROVISIONAL/);
});
await check('address without house number is refused', async () => {
  await page.fill('#searchAddress', 'Market Street');
  await page.click('#searchBtn');
  await page.waitForFunction(() => document.getElementById('lookupStatus').classList.contains('error'));
});
await check('ward comparison table and CSV download', async () => {
  assert.equal(await page.locator('#areaRows tr').count(), 66);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csvBtn')]);
  assert.equal(dl.suggestedFilename(), 'ballotgap-ward.csv');
});
await check('Spanish toggle translates the page and sets lang', async () => {
  await page.click('#langBtn');
  assert.equal(await page.getAttribute('html', 'lang'), 'es');
  assert.match(await page.textContent('h1'), /¿Dónde voto\?/);
  assert.match(await page.textContent('#dataStatus'), /consultados/, 'loaded-data status stays after switching language');
  assert.match(await page.textContent('#qualitySummary'), /registros únicos/);
  await page.click('#langBtn');
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
});
await check('election panel never shows a past election as upcoming', async () => {
  const t = await page.textContent('#electionCountdown');
  assert.doesNotMatch(t, /days? until Election Day/);
});
await check('barrier note uses an on-page message, not a pop-up', async () => {
  let dialog = false;
  page.once('dialog', d => { dialog = true; d.dismiss(); });
  await page.fill('#barrierNotes', '');
  await page.click('#reportBtn');
  assert.equal(dialog, false);
  assert.match(await page.textContent('#reportStatus'), /Describe the observed barrier/);
});
await check('no "/" single-key shortcut steals focus', async () => {
  await page.click('h1');
  await page.keyboard.press('/');
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'placeQuery');
});
await check('no uncaught page errors', async () => { if (errors.length) throw Error(errors.join(' | ')); });

const bad = await openPage({ rows: cartoRows().slice(0, 50), ready: /unavailable/i });
await check('implausible data is rejected and address matching disabled', async () => {
  assert.match(await bad.page.textContent('#qualitySummary'), /No verified public data/);
  await bad.page.fill('#searchAddress', '1234 Market St');
  await bad.page.click('#searchBtn');
  assert.match(await bad.page.textContent('#lookupStatus'), /disabled/);
});
await bad.page.close();

if (process.env.SCREENSHOTS) {
  for (const [w, h] of [[375, 812], [1280, 900]]) {
    const p = (await openPage({ width: w, height: h })).page;
    await p.screenshot({ path: `${process.env.SCREENSHOTS}/ballotgap-${w}.png`, fullPage: true });
    await p.close();
  }
}

await browser.close(); server.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
