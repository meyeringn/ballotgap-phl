// Unit tests for js/core.js. Run: npm test  (Node 18+, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/core.js');

const row = (over = {}) => ({ placename: 'Test Rec', street_address: '100 Test St', zip_code: '19147', ward: 5, division: 1, accessibility_code: 'F', parking_code: 'H', lat: 39.95, lng: -75.16, ...over });
function cityRows(n = 1200) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(row({ ward: (i % 66) + 1, division: Math.floor(i / 66) + 1 }));
  return rows;
}

test('classify: FH needs both building F and parking H', () => {
  assert.equal(core.classify({ ac: 'F', pc: 'H' }), 'full');
  assert.equal(core.classify({ ac: 'F', pc: 'L' }), 'building');
  assert.equal(core.classify({ ac: 'F', pc: '' }), 'building');
  assert.equal(core.classify({ ac: 'A' }), 'alternate');
  assert.equal(core.classify({ ac: 'B' }), 'substantial');
  assert.equal(core.classify({ ac: 'R' }), 'modified');
  assert.equal(core.classify({ ac: 'M' }), 'modified');
  assert.equal(core.classify({ ac: 'N' }), 'barrier');
  assert.equal(core.classify({ ac: 'X' }), 'unknown');
  assert.equal(core.classify({ ac: '' }), 'unknown');
});

test('normalize: trims and uppercases codes, rejects bad rows', () => {
  const p = core.normalize(row({ accessibility_code: ' f ', parking_code: 'h' }));
  assert.equal(p.ac, 'F');
  assert.equal(p.pc, 'H');
  assert.equal(core.normalize(row({ lat: 41 })), null, 'outside Philadelphia');
  assert.equal(core.normalize(row({ ward: 67 })), null, 'ward out of range');
  assert.equal(core.normalize(row({ division: 0 })), null, 'division out of range');
  assert.equal(core.normalize(row({ lat: 'abc' })), null, 'non-numeric');
});

test('validateRows: accepts a full city, removes duplicate divisions', () => {
  const rows = cityRows();
  rows.push(row({ ward: 1, division: 1 }));
  const v = core.validateRows(rows);
  assert.equal(v.clean.length, 1200);
  assert.equal(v.dupes, 1);
});

test('validateRows: refuses partial or broken datasets', () => {
  assert.throws(() => core.validateRows(cityRows(50)), /size/);
  assert.throws(() => core.validateRows('nope'), /size/);
  const broken = cityRows().map((r, i) => (i < 100 ? { ...r, lat: null } : r));
  assert.throws(() => core.validateRows(broken), /invalid/);
  const fewWards = cityRows().map(r => ({ ...r, ward: (r.ward % 30) + 1 }));
  assert.throws(() => core.validateRows(fewWards));
});

test('pickGeocode: needs a house number and an exact Philadelphia match', () => {
  const hit = { lat: '39.9512', lon: '-75.158', address: { house_number: '1234', city: 'Philadelphia' } };
  assert.deepEqual(core.pickGeocode([hit], '1234 Market St'), { lat: 39.9512, lng: -75.158 });
  assert.throws(() => core.pickGeocode([hit], 'Market St'), /house number/);
  assert.throws(() => core.pickGeocode([hit], '99 Market St'), /house-number/);
  assert.throws(() => core.pickGeocode([{ ...hit, address: { ...hit.address, city: 'Camden' } }], '1234 Market St'), /missing/);
  assert.throws(() => core.pickGeocode([], '1234 Market St'), /missing/);
});

test('pickGeocode: two far-apart matches are ambiguous, never guessed', () => {
  const a = { lat: '39.9512', lon: '-75.158', address: { house_number: '1234', city: 'Philadelphia' } };
  const b = { lat: '40.05', lon: '-75.05', address: { house_number: '1234', city: 'Philadelphia' } };
  assert.throws(() => core.pickGeocode([a, b], '1234 Main St'), /ambiguous/);
});

test('parseDivision: reads ward and division, refuses ambiguity', () => {
  assert.deepEqual(core.parseDivision([{ attributes: { Division_Num: '0501', Short_Div_Num: '01' } }]), { ward: 5, division: 1 });
  assert.deepEqual(core.parseDivision([{ attributes: { Division_Num: '6620' } }]), { ward: 66, division: 20 });
  assert.throws(() => core.parseDivision([]), /ambiguous/);
  assert.throws(() => core.parseDivision([{}, {}]), /ambiguous/);
  assert.throws(() => core.parseDivision([{ attributes: { Division_Num: '5' } }]), /invalid/);
});

test('areaSummary: counts and sorts by FH share', () => {
  const places = [
    { ward: 1, ac: 'F', pc: 'H' }, { ward: 1, ac: 'N', pc: '' },
    { ward: 2, ac: 'N', pc: '' }, { ward: 2, ac: 'N', pc: '' }
  ];
  const low = core.areaSummary(places, 'ward', 'low');
  assert.equal(low[0].area, 2);
  assert.equal(low[0].rate, 0);
  assert.equal(low[1].rate, 50);
  assert.equal(core.areaSummary(places, 'ward', 'barrier')[0].barrier, 2);
  assert.equal(core.areaSummary(places.map(p => ({ ...p, council: null })), 'council').length, 0);
});

test('csvCell: neutralizes spreadsheet formulas and escapes quotes', () => {
  assert.equal(core.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(core.csvCell('-5'), '"\'-5"');
  assert.equal(core.csvCell(12), '"12"');
  assert.ok(core.toCSV([['a'], ['b']]).startsWith('﻿"a"\r\n'));
});

test('siteKey: groups address formatting variants', () => {
  assert.equal(core.siteKey({ address: '100 Test St.', zip: '19147' }), core.siteKey({ address: '100 TEST ST', zip: '19147' }));
  assert.equal(core.countSites([{ address: '1 A St', zip: '1' }, { address: '1 A ST', zip: '1' }, { address: '', zip: '1' }]), 1);
});

test('electionState: upcoming, today, then between elections', () => {
  const elections = [{ date: '2026-11-03', utcOffset: '-05:00', pollsOpen: '07:00' }];
  const s1 = core.electionState(elections, new Date('2026-10-31T12:00:00-04:00'));
  assert.equal(s1.mode, 'upcoming');
  assert.equal(s1.days, 3);
  assert.equal(core.electionState(elections, new Date('2026-11-03T21:00:00-05:00')).mode, 'today');
  assert.equal(core.electionState(elections, new Date('2026-11-04T00:00:01-05:00')).mode, 'none');
  assert.equal(core.electionState([], new Date()).mode, 'none');
});

test('electionState: picks the nearest future election even if listed out of order', () => {
  const elections = [{ date: '2027-11-02', utcOffset: '-05:00' }, { date: '2027-05-18', utcOffset: '-04:00' }, { date: '2026-11-03' }];
  assert.equal(core.electionState(elections, new Date('2026-12-01T12:00:00-05:00')).election.date, '2027-05-18');
});

test('parseHash: only place ids and language, nothing else', () => {
  assert.deepEqual(core.parseHash('#p=5-1&lang=es'), { place: '5-1', lang: 'es' });
  assert.deepEqual(core.parseHash('#p=1234+Market+St'), { place: null, lang: null });
  assert.deepEqual(core.parseHash('#lang=fr'), { place: null, lang: null });
});
