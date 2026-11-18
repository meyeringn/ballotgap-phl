// Pure logic with no DOM or network access, so it can be unit-tested in Node
// (tests/core.test.js). Keep it that way: anything that touches `document`,
// `fetch`, or `localStorage` belongs in app.js.
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else (root.BallotGap = root.BallotGap || {}).core = core;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Rough box around Philadelphia. Data rows outside it are rejected.
  const DATA_BOUNDS = { lat: [39.7, 40.3], lng: [-75.5, -74.8] };
  // Tighter box for geocoder results and device location.
  const SEARCH_BOUNDS = { lat: [39.85, 40.15], lng: [-75.3, -74.95] };

  function safeCoord(value, min, max) {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }

  function inSearchArea(lat, lng) {
    return safeCoord(lat, ...SEARCH_BOUNDS.lat) !== null && safeCoord(lng, ...SEARCH_BOUNDS.lng) !== null;
  }

  /** Turn one CARTO row into a place, or null if it fails validation. */
  function normalize(row) {
    const lat = safeCoord(row.lat, ...DATA_BOUNDS.lat);
    const lng = safeCoord(row.lng, ...DATA_BOUNDS.lng);
    const ward = parseInt(row.ward, 10);
    const division = parseInt(row.division, 10);
    if (lat === null || lng === null || !Number.isInteger(ward) || !Number.isInteger(division) ||
        ward < 1 || ward > 66 || division < 1 || division > 99) return null;
    return {
      lat, lng, ward, division,
      name: String(row.placename || 'Polling place').slice(0, 180),
      address: String(row.street_address || '').slice(0, 180),
      zip: String(row.zip_code || '').slice(0, 10),
      ac: String(row.accessibility_code || '').trim().toUpperCase(),
      pc: String(row.parking_code || '').trim().toUpperCase(),
      council: null
    };
  }

  /** Ward-division key, e.g. "5-1". */
  function placeId(p) {
    return p.ward + '-' + p.division;
  }

  /**
   * Accessibility class used for filters, counts and map symbols.
   * "full" requires BOTH building F and parking H; F alone is "building".
   */
  function classify(p) {
    if (p.ac === 'F') return p.pc === 'H' ? 'full' : 'building';
    if (p.ac === 'A') return 'alternate';
    if (p.ac === 'B') return 'substantial';
    if (p.ac === 'R' || p.ac === 'M') return 'modified';
    if (p.ac === 'N') return 'barrier';
    return 'unknown';
  }

  /**
   * Validate a whole CARTO response. Throws if it looks incomplete or wrong,
   * so the app never shows a partial dataset as if it were the full city.
   */
  function validateRows(rows) {
    if (!Array.isArray(rows) || rows.length < 1000 || rows.length > 5000) throw Error('Implausible dataset size');
    let clean = rows.map(normalize).filter(Boolean);
    if (clean.length / rows.length < 0.98) throw Error('Too many invalid rows');
    const seen = new Set();
    let dupes = 0;
    clean = clean.filter(p => {
      const key = placeId(p);
      if (seen.has(key)) { dupes++; return false; }
      seen.add(key);
      return true;
    });
    if (clean.length < 1000 || new Set(clean.map(p => p.ward)).size < 60) throw Error('Incomplete ward coverage');
    return { clean, dupes, unknown: clean.filter(p => classify(p) === 'unknown').length };
  }

  /** Straight-line (haversine) distance in miles. */
  function distanceMiles(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const x = (lat2 - lat1) * rad;
    const y = (lng2 - lng1) * rad;
    const z = Math.sin(x / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(y / 2) ** 2;
    return 3958.76 * 2 * Math.atan2(Math.sqrt(z), Math.sqrt(1 - z));
  }

  /**
   * Pick one geocoder result for a typed address, or throw.
   * Requires a house number, a Philadelphia result with that exact house number,
   * and no competing candidate more than ~115 feet away.
   */
  function pickGeocode(results, query) {
    const valid = (Array.isArray(results) ? results : []).filter(x => x && x.address &&
      (x.address.city === 'Philadelphia' || x.address.county === 'Philadelphia County' || x.address.city_district === 'Philadelphia') &&
      inSearchArea(x.lat, x.lon));
    if (!valid.length) throw Error('missing geocode');
    const house = String(query).match(/^\s*(\d+[A-Za-z]?)\b/);
    if (!house) throw Error('house number required');
    const candidates = valid.filter(x => String(x.address.house_number || '').toLowerCase() === house[1].toLowerCase());
    if (!candidates.length) throw Error('no house-number match');
    const first = candidates[0];
    if (candidates.some(y => distanceMiles(+first.lat, +first.lon, +y.lat, +y.lon) > 0.022)) throw Error('ambiguous geocode');
    return { lat: Number(first.lat), lng: Number(first.lon) };
  }

  /** Read ward and division from a Political Divisions GIS feature list, or throw. */
  function parseDivision(features) {
    if (!Array.isArray(features) || features.length !== 1) throw Error('ambiguous division');
    const at = features[0].attributes || {};
    const raw = String(at.Division_Num ?? at.division_num ?? '').replace(/\D/g, '');
    const short = String(at.Short_Div_Num ?? at.short_div_num ?? '').replace(/\D/g, '');
    if (raw.length < 3) throw Error('invalid division code');
    return { ward: Number(raw.slice(0, -2)), division: Number(short || raw.slice(-2)) };
  }

  /** Count records per area. `key` is "ward" or "council". */
  function areaSummary(places, key, sort) {
    const groups = new Map();
    for (const p of places) {
      const n = key === 'ward' ? p.ward : p.council;
      if (n === null || n === undefined) continue;
      if (!groups.has(n)) groups.set(n, { area: n, total: 0, full: 0, building: 0, alternate: 0, substantial: 0, modified: 0, barrier: 0, unknown: 0 });
      const g = groups.get(n);
      g.total++;
      g[classify(p)]++;
    }
    const out = [...groups.values()];
    out.forEach(g => { g.rate = 100 * g.full / g.total; });
    const byArea = (a, b) => a.area - b.area;
    const sorters = {
      low: (a, b) => a.rate - b.rate || byArea(a, b),
      high: (a, b) => b.rate - a.rate || byArea(a, b),
      barrier: (a, b) => b.barrier - a.barrier || byArea(a, b)
    };
    return out.sort(sorters[sort] || byArea);
  }

  /** Lowest FH-share wards with at least `min` records. Rates are 0–100. */
  function lowestWards(places, count = 8, min = 5) {
    return areaSummary(places, 'ward', 'low').filter(g => g.total >= min).slice(0, count);
  }

  /** Normalized address + ZIP, used to estimate unique buildings. */
  function siteKey(p) {
    return (p.address || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(\d+)0+/, '$1') + '|' + (p.zip || '');
  }

  function countSites(places) {
    return new Set(places.filter(p => p.address).map(siteKey)).size;
  }

  /** One CSV cell: quoted, with spreadsheet formula injection neutralized. */
  function csvCell(value) {
    return '"' + String(value).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"';
  }

  function toCSV(rows) {
    return '﻿' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  /**
   * Which election to show, given the configured list and the current time.
   * Returns { mode: 'upcoming', election, days } | { mode: 'today', election } | { mode: 'none' }.
   * An election stays "today" until midnight Philadelphia time after Election Day.
   */
  function electionState(elections, now = new Date()) {
    const DAY = 86400000;
    const list = (elections || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    for (const election of list) {
      const offset = election.utcOffset || '-05:00';
      const dayStart = new Date(`${election.date}T00:00:00${offset}`);
      const pollsOpen = new Date(`${election.date}T${election.pollsOpen || '07:00'}:00${offset}`);
      const dayEnd = new Date(dayStart.getTime() + DAY);
      if (!Number.isFinite(dayStart.getTime()) || now >= dayEnd) continue;
      if (now >= dayStart) return { mode: 'today', election };
      return { mode: 'upcoming', election, days: Math.max(1, Math.ceil((pollsOpen - now) / DAY)) };
    }
    return { mode: 'none' };
  }

  /** Read "#p=5-1&lang=es" style hashes. Only place ids and language, never addresses. */
  function parseHash(hash) {
    const p = String(hash).match(/(?:^#|&)p=(\d{1,2}-\d{1,2})(?:&|$)/);
    const l = String(hash).match(/(?:^#|&)lang=(es|en)(?:&|$)/);
    return { place: p ? p[1] : null, lang: l ? l[1] : null };
  }

  return {
    safeCoord, inSearchArea, normalize, placeId, classify, validateRows, distanceMiles,
    pickGeocode, parseDivision, areaSummary, lowestWards, siteKey, countSites,
    csvCell, toCSV, electionState, parseHash
  };
});
