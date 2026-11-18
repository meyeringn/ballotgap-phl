// Static checks that catch the mistakes AI-assisted edits make most often.
// Run: npm run check   (no dependencies)
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const problems = [];
const fail = msg => problems.push(msg);

// 1. No inline scripts, so the CSP can forbid them.
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!/\bsrc=/.test(m[1])) fail('Inline <script> found. Put code in js/ so CSP can block injected scripts.');
}
if (/\son[a-z]+\s*=\s*["']/i.test(html)) fail('Inline event handler (onclick= etc.) found. Use addEventListener in js/app.js.');

// 2. Every outside host the page loads from is allowed by the CSP.
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
if (!csp) fail('Content-Security-Policy meta tag is missing.');
if (/script-src[^;]*'unsafe-inline'/.test(csp)) fail("CSP script-src must not allow 'unsafe-inline'.");
const directive = name => (csp.match(new RegExp(`${name} ([^;]+)`)) || [])[1] || '';
const allowed = (dir, url) => directive(dir).split(/\s+/).some(src => {
  if (!src.startsWith('https://')) return false;
  const host = new URL(url).host;
  const allow = src.replace('https://', '').replace(/\/.*$/, '');
  return allow.startsWith('*.') ? host.endsWith(allow.slice(1)) : host === allow;
});
for (const m of html.matchAll(/<script[^>]+src="(https:[^"]+)"/g)) if (!allowed('script-src', m[1])) fail(`Script ${m[1]} is not allowed by CSP script-src.`);
for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(https:[^"]+)"/g)) if (!allowed('style-src', m[1])) fail(`Stylesheet ${m[1]} is not allowed by CSP style-src.`);
const js = ['app.js', 'core.js', 'config.js'].map(f => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8')).join('\n');
for (const m of js.matchAll(/'(https:\/\/[^'/]+)\/[^']*'/g)) {
  const url = m[1];
  if (/atlas\.phila\.gov|vote\.phila\.gov|septa\.org|google\.com|pa\.gov/.test(url)) continue; // links, not fetches
  if (!allowed('connect-src', url + '/') && !allowed('img-src', url + '/')) fail(`${url} is used in JS but not allowed by CSP connect-src or img-src.`);
}
const goat = (html.match(/data-goatcounter="([^"]+)"/) || [])[1];
if (goat && !allowed('connect-src', goat)) fail('GoatCounter endpoint is not in CSP connect-src, so visits are not counted.');

// 3. Local files referenced by the page exist.
for (const m of html.matchAll(/(?:src|href)="((?:js|css|fonts)\/[^"]+)"/g)) {
  if (!existsSync(new URL(`../${m[1]}`, import.meta.url))) fail(`Missing file: ${m[1]}`);
}

// 4. English and Spanish stay in step.
globalThis.self = globalThis;
require('../js/config.js');
require('../js/i18n.js');
const { words, config } = globalThis.BallotGap;
const en = Object.keys(words.en), es = Object.keys(words.es);
en.filter(k => !es.includes(k)).forEach(k => fail(`Spanish is missing words.${k}`));
es.filter(k => !en.includes(k)).forEach(k => fail(`English is missing words.${k}`));
for (const m of html.matchAll(/data-i="([^"]+)"/g)) if (!en.includes(m[1])) fail(`data-i="${m[1]}" has no entry in js/i18n.js`);
for (const m of html.matchAll(/<[^>]*\bdata-en="[^"]*"[^>]*>/g)) if (!/\bdata-es="/.test(m[0])) fail(`data-en without data-es: ${m[0].slice(0, 80)}`);
for (const m of html.matchAll(/<[^>]*\bdata-es="[^"]*"[^>]*>/g)) if (!/\bdata-en="/.test(m[0])) fail(`data-es without data-en: ${m[0].slice(0, 80)}`);

// 5. Version labels agree.
const title = (html.match(/<title>BallotGap PHL ([\d.]+)/) || [])[1];
if (title !== config.version) fail(`<title> says ${title} but js/config.js says ${config.version}.`);
for (const m of html.matchAll(/data-version>([^<]*)</g)) if (m[1] !== config.version) fail(`data-version placeholder says ${m[1]}, config says ${config.version}.`);

// 6. Election config is well formed.
for (const e of config.elections) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) fail(`Election date "${e.date}" must be YYYY-MM-DD.`);
  if (!/^[+-]\d{2}:\d{2}$/.test(e.utcOffset || '')) fail(`Election ${e.date} needs utcOffset like -05:00.`);
  if (!Array.isArray(e.name) || e.name.length !== 2) fail(`Election ${e.date} needs name: [English, Spanish].`);
  (e.milestones || []).forEach(m => { if (m.when?.length !== 2 || m.label?.length !== 2) fail(`Election ${e.date} milestone needs when/label in both languages.`); });
}

// 7. Language the project has committed to.
const text = html + js;
if (/person(s)? with (a )?disabilit/i.test(text)) fail('Use identity-first language ("Disabled voters"), not "person with a disability".');

if (problems.length) {
  console.error(`check: ${problems.length} problem(s)\n - ` + problems.join('\n - '));
  process.exit(1);
}
console.log('check: all static checks passed');
