// BallotGap PHL: page behavior. Loads after leaflet, config.js, i18n.js and core.js.
// Rules that keep this tool trustworthy (see CLAUDE.md):
//   - An address match is always PROVISIONAL, never "verified" or "your polling place".
//   - Searched addresses are never stored, logged, cached, or put in URLs.
//   - Every new message needs English and Spanish text.
(() => {
  'use strict';
  const BG = window.BallotGap;
  const { core, config, words, buildingCodes, parkingCodes } = BG;
  const { classify, placeId } = core;

  const $ = id => document.getElementById(id);
  const OFFICIAL = 'https://atlas.phila.gov/voting';
  const CARTO = 'https://phl.carto.com/api/v2/sql';
  const DIVISION = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/ArcGIS/rest/services/Political_Divisions/FeatureServer/0/query';
  const COUNCIL = 'https://services2.arcgis.com/1OML3Q9DZatjcY7Q/ArcGIS/rest/services/Council_Lookup24/FeatureServer/1/query';
  const OVERPASS = 'https://overpass.kumi.systems/api/interpreter';
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  // Public dataset only. Bump the suffix if the cached row shape changes.
  const CACHE_KEY = 'ballotgap-public-places-v42';
  const CACHE_MAX_AGE = 48 * 3600 * 1000;
  const PAGE_SIZE = 35;

  const state = {
    lang: 'en',
    places: [],
    liveData: false,
    dataMode: 'unavailable', // 'live' | 'cache' | 'unavailable'
    retrieved: null,          // Date the shown data was fetched
    selected: null,
    assignment: null,
    lookupToken: 0,
    offset: 0,
    councilReady: false,
    councilLoading: false,
    areas: [],
    priorities: false,
    tourIndex: 0,
    stopCache: new Map()
  };
  let map = null;
  let layer = null;

  // ---------- Language ----------

  const say = (en, es) => (state.lang === 'es' ? es : en);
  const pick = pair => (Array.isArray(pair) ? pair[state.lang === 'es' ? 1 : 0] : pair);

  function codeLabel(p) {
    if (p.ac === 'F' && p.pc === 'H') return 'FH · ' + say('Fully accessible building + designated accessible parking', 'Edificio totalmente accesible y estacionamiento accesible designado');
    if (p.ac && buildingCodes[p.ac]) return p.ac + ' · ' + pick(buildingCodes[p.ac]);
    return say('Unknown building code', 'Código del edificio desconocido');
  }

  function parkLabel(p) {
    return parkingCodes[p.pc] ? p.pc + ' · ' + pick(parkingCodes[p.pc]) : say('Not reported / unknown', 'No informado / desconocido');
  }

  function translate() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-en][data-es]').forEach(el => { el.textContent = el.dataset[state.lang]; });
    document.querySelectorAll('[data-i]').forEach(el => { el.textContent = words[state.lang][el.dataset.i] || words.en[el.dataset.i]; });
    document.querySelectorAll('[data-placeholder-en]').forEach(el => { el.placeholder = state.lang === 'es' ? el.dataset.placeholderEs : el.dataset.placeholderEn; });
    $('langBtn').textContent = state.lang === 'en' ? 'Español' : 'English';
    $('langBtn').setAttribute('aria-label', state.lang === 'en' ? 'Español: switch to Spanish' : 'English: cambiar a inglés');
    $('langBtn').setAttribute('lang', state.lang === 'en' ? 'es' : 'en');
    $('filter').options[0].textContent = say('All classifications', 'Todas las clasificaciones');
    $('wardFilter').options[0].textContent = say('All wards', 'Todos los distritos');
    $('areaType').options[0].textContent = say('Ward', 'Distrito electoral');
    $('areaType').options[1].textContent = say('Council district (GIS)', 'Distrito del Concejo (GIS)');
    $('dataVerified').textContent = pick(config.dataVerified);
    document.querySelectorAll('[data-version]').forEach(el => { el.textContent = config.version; });
    renderElection();
    showTour();
    renderDataText();
    if (state.loadFailed) refreshShowcase();
    if (state.places.length) {
      [...$('wardFilter').options].slice(1).forEach(o => { o.textContent = say('Ward ', 'Distrito ') + o.value; });
      renderStats();
      renderList(true);
      renderAreas();
      refreshShowcase();
      if (state.selected) showPlace(state.selected, false);
      if (state.assignment) renderAssigned(state.assignment);
    }
  }

  // ---------- Small helpers ----------

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  function externalLink(href, text) {
    return el('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: text });
  }

  function lookupStatus(msg, err = false) {
    $('lookupStatus').className = 'notice' + (err ? ' error' : '');
    $('lookupStatus').textContent = msg;
  }

  function flash(id, msg) {
    $(id).textContent = msg;
  }

  async function getJSON(url, ms = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw Error(j.error.message || 'API error');
      return j;
    } finally {
      clearTimeout(timer);
    }
  }

  async function retryJSON(url, ms = 14000, attempts = 2) {
    let last;
    for (let n = 0; n < attempts; n++) {
      try { return await getJSON(url, ms); }
      catch (e) { last = e; if (n + 1 < attempts) await new Promise(r => setTimeout(r, 600 * (n + 1))); }
    }
    throw last;
  }

  function download(name, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  }

  // ---------- Election panel ----------

  function renderElection() {
    const s = core.electionState(config.elections);
    const title = $('electionTitle');
    const eyebrow = $('electionEyebrow');
    const metrics = $('electionMetrics');
    metrics.replaceChildren();
    if (s.mode === 'none') {
      eyebrow.textContent = say('Between elections', 'Entre elecciones');
      title.textContent = say('Next election: check official dates', 'Próximas elecciones: consulta las fechas oficiales');
      $('electionCountdown').textContent = say(
        'BallotGap shows deadlines only after they are confirmed by election officials. Until then, use the official Pennsylvania election calendar.',
        'BallotGap muestra plazos solo cuando las autoridades electorales los confirman. Mientras tanto, usa el calendario electoral oficial de Pensilvania.');
      return;
    }
    const e = s.election;
    eyebrow.textContent = pick(e.name);
    const day = new Date(`${e.date}T12:00:00${e.utcOffset || '-05:00'}`);
    const dateText = day.toLocaleDateString(state.lang === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
    title.textContent = say('Election Day: ', 'Día de las elecciones: ') + dateText;
    $('electionCountdown').textContent = s.mode === 'today'
      ? say('Election Day is here. Polls are open 7 AM to 8 PM local time. If you are in line by 8 PM, stay in line.', 'Hoy son las elecciones. Los centros abren de 7:00 a. m. a 8:00 p. m. Si estás en la fila a las 8 p. m., quédate en la fila.')
      : say(`${s.days} day${s.days === 1 ? '' : 's'} until Election Day. Confirm dates with Pennsylvania election officials.`, `Falta${s.days === 1 ? '' : 'n'} ${s.days} día${s.days === 1 ? '' : 's'} para las elecciones. Confirma las fechas con las autoridades electorales de Pensilvania.`);
    (e.milestones || []).forEach(m => metrics.append(el('div', { className: 'metric' }, el('strong', { textContent: pick(m.when) }), el('span', { textContent: pick(m.label) }))));
  }

  // ---------- Data loading ----------

  function cacheRows(rows) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ saved: Date.now(), rows })); }
    catch (e) { console.warn('Public-data cache unavailable:', e); }
  }

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!c || !Number.isFinite(c.saved) || Date.now() - c.saved > CACHE_MAX_AGE || c.saved > Date.now() + 60000) return null;
      return { ...core.validateRows(c.rows), saved: c.saved };
    } catch { return null; }
  }

  // Status text for the loaded dataset. Re-run on language change.
  function renderDataText() {
    const r = state.result;
    if (state.dataMode === 'unavailable') {
      if (!state.loadFailed) return;
      $('qualitySummary').textContent = say('No verified public data available. The dashboard is disabled; use official Atlas.', 'No hay datos públicos validados. El panel no está disponible; usa Atlas.');
      $('dataStatus').textContent = say('Live data unavailable and no recent validated cache exists. Use official Philadelphia Atlas.', 'No hay datos en directo ni una copia validada reciente. Usa Philadelphia Atlas.');
      return;
    }
    const isCached = state.dataMode === 'cache';
    const stamp = state.retrieved.toLocaleString();
    const n = state.places.length.toLocaleString();
    $('qualitySummary').textContent = say(
      `${n} unique ward/division records; ${r.dupes} duplicate keys excluded; ${r.unknown} unknown codes. ${isCached ? 'CACHED DATA, NOT LIVE.' : 'Live public dataset.'} Not an Election Day site inspection.`,
      `${n} registros únicos de distrito/división; ${r.dupes} duplicados excluidos; ${r.unknown} códigos desconocidos. ${isCached ? 'DATOS GUARDADOS, NO ACTUALES.' : 'Datos públicos consultados en directo.'} No es una inspección del día de las elecciones.`);
    $('dataStatus').textContent = isCached
      ? say(`WARNING: Live data unavailable. Showing previously downloaded public data from ${stamp}. Confirm all information with election officials.`, `ADVERTENCIA: datos en directo no disponibles. Se muestran datos públicos guardados del ${stamp}. Confirma todo con las autoridades electorales.`)
      : say(`Public polling data retrieved ${stamp}. Verify assignments in Atlas.`, `Datos públicos consultados el ${stamp}. Confirma tu asignación en Atlas.`);
  }

  function populatePlaces(result, isCached = false) {
    state.liveData = !isCached;
    state.dataMode = isCached ? 'cache' : 'live';
    state.retrieved = new Date(result.saved || Date.now());
    state.places = result.clean;
    state.result = result;
    renderDataText();
    $('wardFilter').replaceChildren(new Option(say('All wards', 'Todos los distritos'), ''));
    [...new Set(state.places.map(p => p.ward))].sort((a, b) => a - b)
      .forEach(w => $('wardFilter').add(new Option(say('Ward ', 'Distrito ') + w, String(w))));
    renderStats();
    renderMap();
    renderList(true);
    renderAreas();
    refreshShowcase();
    restoreHash();
  }

  async function load() {
    const q = 'SELECT placename,street_address,zip_code,ward,division,accessibility_code,parking_code,ST_Y(the_geom) AS lat,ST_X(the_geom) AS lng FROM polling_places';
    try {
      const j = await retryJSON(CARTO + '?q=' + encodeURIComponent(q) + '&format=json', 22000, 2);
      populatePlaces(core.validateRows(j.rows));
      cacheRows(j.rows);
    } catch (e) {
      console.warn('Live polling data failed validation or network:', e);
      const cached = readCache();
      if (cached) { populatePlaces(cached, true); return; }
      state.loadFailed = true;
      renderDataText();
      refreshShowcase();
    }
  }

  // ---------- Citywide numbers ----------

  function metric(value, label) {
    return el('div', { className: 'metric' }, el('strong', { textContent: value }), el('span', { textContent: label }));
  }

  function renderStats() {
    const c = {};
    state.places.forEach(p => { const k = classify(p); c[k] = (c[k] || 0) + 1; });
    $('metrics').replaceChildren(...[
      [say('Division records', 'Registros'), state.places.length],
      [say('FH: building + parking', 'FH: edificio y estacionamiento'), c.full || 0],
      [say('F without H', 'F sin H'), c.building || 0],
      [say('B: substantial', 'B: sustancial'), c.substantial || 0],
      [say('N: barriers', 'N: barreras'), c.barrier || 0],
      [say('Unknown', 'Desconocido'), c.unknown || 0]
    ].map(([label, val]) => metric(val.toLocaleString(), label)));
  }

  function barRow(label, value, max, kind = '', suffix = '') {
    const fill = el('div', { className: 'barfill ' + kind });
    fill.style.width = (max ? Math.max(0, Math.min(100, 100 * value / max)) : 0) + '%';
    return el('div', { className: 'barrow' },
      el('span', { className: 'barlabel', textContent: label }),
      el('div', { className: 'bartrack' }, fill),
      el('span', { className: 'barvalue', textContent: value.toLocaleString() + suffix }));
  }

  function lowestWardLines() {
    return core.lowestWards(state.places).map(g => say(`Ward ${g.area}: ${Math.round(g.rate)}% FH (${g.total} records)`, `Distrito ${g.area}: ${Math.round(g.rate)}% FH (${g.total} registros)`));
  }

  function refreshShowcase() {
    const metrics = $('showcaseMetrics');
    const bars = $('statusBars');
    const wardBars = $('wardBars');
    metrics.replaceChildren();
    bars.replaceChildren();
    wardBars.replaceChildren();
    const places = state.places;
    if (!places.length) {
      metrics.textContent = say('No verified records loaded.', 'No se cargaron registros validados.');
      $('dataHealth').textContent = say('Unavailable: consult Philadelphia Atlas.', 'No disponible: consulta Philadelphia Atlas.');
      $('dataHealth').className = 'notice quality-error';
      return;
    }
    const count = k => places.filter(p => k.includes(classify(p))).length;
    const total = places.length;
    const sites = core.countSites(places);
    const fh = count(['full']);
    const n = count(['barrier']);
    const share = (100 * fh / total).toFixed(1) + '%';
    metrics.append(
      metric(total.toLocaleString(), say('Division records', 'Registros de divisiones')),
      metric(sites.toLocaleString(), say('Estimated unique buildings', 'Edificios únicos estimados')),
      metric(share, say('FH classification share', 'Porcentaje FH')),
      metric(n.toLocaleString(), say('N-coded records', 'Registros con código N')));
    const group = [
      ['FH', fh, 'full'], ['F', count(['building']), ''], ['A / B', count(['alternate', 'substantial']), ''],
      ['R / M', count(['modified']), 'modified'], ['N', n, 'barrier'], [say('Unknown', 'Desconocido'), count(['unknown']), 'muted']
    ];
    group.forEach(([label, value, kind]) => bars.append(barRow(label, value, total, kind)));
    bars.setAttribute('aria-label', group.map(x => x[0] + ': ' + x[1]).join('; '));
    const stamp = state.retrieved ? state.retrieved.toLocaleString() : say('unknown', 'desconocido');
    $('dataHealth').className = 'notice ' + (state.dataMode === 'live' ? 'quality-live' : 'quality-cache');
    $('dataHealth').textContent = (state.dataMode === 'live'
      ? say('Live request succeeded', 'Consulta en directo completada')
      : say('Cached public data: address matching disabled', 'Datos públicos guardados: búsqueda de asignación desactivada')) +
      ' · ' + say('Retrieved', 'Recuperados') + ': ' + stamp + ' · ' +
      say('These are published administrative classifications, not current site inspections.', 'Son clasificaciones administrativas publicadas, no inspecciones actuales.');
    $('briefSummary').textContent = say(
      `Source: City Commissioners CARTO polling_places. ${total} division records, approximately ${sites} distinct address/ZIP combinations, ${fh} FH (${share}), ${n} N-coded records. Retrieved ${stamp} (${state.dataMode}). No physical accessibility verification or official voter assignment is implied.`,
      `Fuente: conjunto polling_places de CARTO. ${total} divisiones, aproximadamente ${sites} combinaciones de dirección y código postal, ${fh} FH (${share}), ${n} registros N. Recuperados ${stamp} (${state.dataMode === 'live' ? 'en directo' : 'guardados'}). No se verificó físicamente la accesibilidad ni la asignación oficial.`);
    wardBars.append(el('h4', { textContent: say('Eight wards with lowest FH share (minimum five records)', 'Ocho distritos con menor porcentaje FH (mínimo cinco registros)') }));
    core.lowestWards(places).forEach(g => wardBars.append(barRow(say('Ward ', 'Distrito ') + g.area, Math.round(g.rate), 100, 'share', '%')));
    wardBars.append(el('p', { className: 'help', textContent: say('Bar values are percentages, not counts. Review record-level details before drawing conclusions.', 'Las barras muestran porcentajes, no conteos. Revisa los registros antes de sacar conclusiones.') }));
  }

  // ---------- Map and list ----------

  function filtered() {
    const f = $('filter').value;
    const w = $('wardFilter').value;
    const q = $('placeQuery').value.trim().toLocaleLowerCase();
    return state.places.filter(p => (f === 'all' || classify(p) === f) && (!w || String(p.ward) === w) &&
      (!q || [p.name, p.address, p.zip, placeId(p)].some(v => String(v).toLocaleLowerCase().includes(q))));
  }

  function initMap() {
    if (!window.L) {
      $('map').textContent = say('Map library unavailable. Use the list.', 'No se pudo cargar el mapa. Usa la lista.');
      return;
    }
    map = L.map('map', { center: [39.9526, -75.1636], zoom: 12, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on('zoomend', renderMap);
  }

  // Shape AND color carry meaning, so the map works without color vision.
  const SHAPES = { full: '★', building: '●', alternate: '●', substantial: '●', modified: '◆', barrier: '■', unknown: '○' };

  function placeMarker(p) {
    const c = classify(p);
    const icon = L.divIcon({ className: '', html: `<span aria-hidden="true" class="mk mk-${c}">${SHAPES[c]}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] });
    const m = L.marker([p.lat, p.lng], { icon, title: p.name + ' ' + codeLabel(p) });
    m.on('click', () => showPlace(p));
    return m;
  }

  function renderMap() {
    if (!map || !layer) return;
    layer.clearLayers();
    const all = filtered();
    const z = map.getZoom();
    // Group markers into grid cells when zoomed out, so 1,700 markers stay fast.
    const cell = z < 13 ? 0.018 : z < 15 ? 0.007 : 0;
    if (!cell) { all.forEach(p => placeMarker(p).addTo(layer)); return; }
    const clusters = new Map();
    all.forEach(p => {
      const key = Math.floor(p.lat / cell) + ':' + Math.floor(p.lng / cell);
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(p);
    });
    clusters.forEach(group => {
      if (group.length === 1) { placeMarker(group[0]).addTo(layer); return; }
      const lat = group.reduce((s, p) => s + p.lat, 0) / group.length;
      const lng = group.reduce((s, p) => s + p.lng, 0) / group.length;
      const icon = L.divIcon({ className: '', html: `<span aria-hidden="true" class="mk-cluster">${group.length}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] });
      const m = L.marker([lat, lng], { icon, title: say(`${group.length} locations. Zoom in to explore.`, `${group.length} lugares. Acerca el mapa.`) });
      m.on('click', () => map.setView([lat, lng], Math.min(z + 2, 17)));
      m.addTo(layer);
    });
  }

  function renderList(reset = false) {
    if (reset) { state.offset = 0; $('placeList').replaceChildren(); }
    const all = filtered();
    const part = all.slice(state.offset, state.offset + PAGE_SIZE);
    $('filterCount').textContent = say('Showing ', 'Mostrando ') + all.length.toLocaleString() + ' / ' + state.places.length.toLocaleString() +
      say(' division records matching filters.', ' registros de divisiones que coinciden con los filtros.');
    $('emptyPlaces').classList.toggle('hidden', all.length !== 0);
    part.forEach(p => {
      const b = el('button', { type: 'button', textContent: p.name + ' · ' + p.address });
      b.addEventListener('click', () => showPlace(p));
      const mark = el('span', { className: 'result-mark mk-' + classify(p), textContent: SHAPES[classify(p)] });
      mark.setAttribute('aria-hidden', 'true');
      $('placeList').append(el('div', { className: 'result' }, mark,
        el('div', {}, b, el('div', { className: 'muted', textContent: say('Ward', 'Distrito') + ' ' + p.ward + ', ' + say('division', 'división') + ' ' + p.division + ' · ' + codeLabel(p) }))));
    });
    state.offset += part.length;
    $('moreBtn').classList.toggle('hidden', state.offset >= all.length);
    $('moreBtn').textContent = say('Show more', 'Ver más') + ` (${state.offset}/${all.length})`;
  }

  function setView(mode) {
    const isMap = mode === 'map';
    $('mapbox').classList.toggle('hidden', !isMap);
    $('mapBtn').setAttribute('aria-pressed', String(isMap));
    $('listBtn').setAttribute('aria-pressed', String(!isMap));
    if (isMap && map) setTimeout(() => map.invalidateSize(), 20);
  }

  // ---------- Place details ----------

  function badgeClass(c) {
    return c === 'full' ? 'full' : c === 'barrier' ? 'barrier' : c === 'modified' ? 'modified' : c === 'unknown' ? 'unknown' : 'substantial';
  }

  function isAssigned(p) {
    return !!state.assignment && placeId(state.assignment.place) === placeId(p);
  }

  function showPlace(p, scroll = true) {
    state.selected = p;
    $('details').classList.remove('hidden');
    $('detailTitle').textContent = p.name;
    $('detailMeta').textContent = p.address + ', Philadelphia ' + p.zip + ' · ' + say('Ward', 'Distrito') + ' ' + p.ward + ', ' + say('division', 'división') + ' ' + p.division;
    $('detailBadge').replaceChildren(el('span', { className: 'status ' + badgeClass(classify(p)), textContent: codeLabel(p) }));
    $('detailBuilding').textContent = codeLabel(p);
    $('detailParking').textContent = parkLabel(p);
    $('stopsOutput').replaceChildren();
    $('copyStatus').textContent = '';
    $('directions').href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(p.lat + ',' + p.lng);
    $('planWarning').textContent = isAssigned(p)
      ? say('PROVISIONAL MATCH ONLY. This ward/division was inferred from geographic data. Confirm the actual assigned place in Philadelphia Atlas before voting.', 'SOLO COINCIDENCIA PROVISIONAL. Se calculó la división mediante datos geográficos. Confirma tu lugar asignado en Philadelphia Atlas.')
      : say('INFORMATIONAL LOCATION ONLY. This is not a verified assignment. You cannot choose a different polling place based on accessibility.', 'SOLO LUGAR INFORMATIVO. No es una asignación verificada. No puedes elegir otro lugar por su accesibilidad.');
    $('reportPlace').textContent = say('Selected place: ', 'Lugar seleccionado: ') + p.name + ' (' + placeId(p) + ')';
    if (map) { map.setView([p.lat, p.lng], 15); setTimeout(() => map.invalidateSize(), 50); }
    if (scroll) { $('details').scrollIntoView({ block: 'start' }); $('details').focus({ preventScroll: true }); }
    updateHash();
  }

  function planText() {
    const p = state.selected;
    if (!p) return '';
    return [
      'BallotGap PHL ' + config.version,
      isAssigned(p) ? 'PROVISIONAL GIS MATCH - NOT OFFICIALLY VERIFIED' : 'INFORMATIONAL LOCATION - NOT AN ASSIGNED PLACE',
      p.name, p.address + ', Philadelphia PA ' + p.zip, 'Ward ' + p.ward + ' / Division ' + p.division,
      'Building: ' + codeLabel(p), 'Parking: ' + parkLabel(p), 'Official lookup: ' + OFFICIAL,
      'City Commissioners: 215-686-VOTE', 'SEPTA trip planner: https://plan.septa.org/', 'SEPTA alerts: https://www.septa.org/alerts/',
      'Transit and site accessibility not independently verified.'
    ].join('\n');
  }

  // Only the public ward-division id and language go in the URL. Never an address.
  function updateHash() {
    if (!state.selected) return;
    history.replaceState(null, '', location.pathname + location.search + '#p=' + encodeURIComponent(placeId(state.selected)) + '&lang=' + state.lang);
  }

  function restoreHash() {
    const h = core.parseHash(location.hash);
    if (h.lang && h.lang !== state.lang) { state.lang = h.lang; translate(); }
    if (h.place) {
      const p = state.places.find(x => placeId(x) === h.place);
      if (p) showPlace(p, false);
    }
  }

  // ---------- Address and location lookup ----------

  function renderAssigned(a) {
    const p = a.place;
    const review = el('button', { type: 'button', className: 'primary', textContent: say('Review access and transit', 'Ver accesibilidad y transporte') });
    review.addEventListener('click', () => showPlace(p));
    $('assigned').classList.remove('hidden');
    $('assigned').replaceChildren(
      el('h2', { textContent: say('Provisional ward/division match', 'Coincidencia provisional de distrito/división') }),
      el('p', { textContent: say(`GIS matched Ward ${p.ward}, Division ${p.division} to: ${p.name}, ${p.address}. This is NOT an official voter assignment confirmation.`, `GIS encontró el distrito ${p.ward}, división ${p.division}: ${p.name}, ${p.address}. NO es una confirmación oficial.`) }),
      el('div', { className: 'actions' }, review, externalLink(OFFICIAL, say('Confirm officially in Atlas', 'Confirmar en Atlas'))));
  }

  function showLookupOnMap(p) {
    setView('map');
    let summary = $('mapLookupSummary');
    if (!summary) {
      summary = el('div', { id: 'mapLookupSummary', className: 'notice', tabIndex: -1 });
      $('mapbox').before(summary);
    }
    summary.replaceChildren(
      el('strong', { textContent: say('Provisional match, not an official assignment: ', 'Coincidencia provisional, no una asignación oficial: ') }),
      document.createTextNode(p.name + ' · ' + p.address + ' · ' + say('Ward ', 'Distrito ') + p.ward + ', ' + say('division ', 'división ') + p.division + '. '),
      externalLink(OFFICIAL, say('Verify in Philadelphia Atlas', 'Verificar en Philadelphia Atlas')));
    $('explore').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    summary.focus({ preventScroll: true });
    if (map) setTimeout(() => map.invalidateSize(), 100);
  }

  function resetLookup() {
    const summary = $('mapLookupSummary');
    if (summary) summary.remove();
    state.assignment = null;
    $('assigned').classList.add('hidden');
    state.lookupToken++;
  }

  async function resolve(lat, lng, token) {
    try {
      const params = new URLSearchParams({ f: 'json', geometry: lng + ',' + lat, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'Division_Num,Short_Div_Num', returnGeometry: 'false' });
      const j = await getJSON(DIVISION + '?' + params);
      if (token !== state.lookupToken) return;
      const { ward, division } = core.parseDivision(j.features || []);
      const matches = state.places.filter(p => p.ward === ward && p.division === division);
      if (matches.length !== 1) throw Error('missing or duplicate polling-place match');
      state.assignment = { place: matches[0] };
      renderAssigned(state.assignment);
      showPlace(matches[0], false);
      showLookupOnMap(matches[0]);
      lookupStatus(say('Provisional geographic match found. Verify your official assignment in Philadelphia Atlas.', 'Se encontró una coincidencia geográfica provisional. Confirma tu asignación en Philadelphia Atlas.'));
    } catch (e) {
      if (token !== state.lookupToken) return;
      console.warn('Division lookup:', e.message);
      lookupStatus(say('We could not reliably match your address to exactly one polling division. No assignment is shown. Use Philadelphia Atlas to confirm where to vote.', 'No pudimos identificar una sola división electoral de manera confiable. No se muestra una asignación. Usa Philadelphia Atlas.'), true);
    }
  }

  async function lookup() {
    if (!state.liveData) {
      lookupStatus(say('Address matching is disabled while live polling data is unavailable. Use official Philadelphia Atlas.', 'La búsqueda de asignación está desactivada sin datos actuales. Usa Philadelphia Atlas.'), true);
      return;
    }
    const q = $('searchAddress').value.trim();
    if (q.length < 5) { lookupStatus(say('Enter a full street address.', 'Ingresa una dirección completa.'), true); return; }
    resetLookup();
    const token = state.lookupToken;
    lookupStatus(say('Looking up address…', 'Buscando dirección…'));
    $('searchBtn').disabled = true;
    try {
      const url = NOMINATIM + '?format=json&limit=3&countrycodes=us&addressdetails=1&q=' + encodeURIComponent(q + ', Philadelphia, Pennsylvania');
      const results = await getJSON(url);
      if (token !== state.lookupToken) return;
      const point = core.pickGeocode(results, q);
      await resolve(point.lat, point.lng, token);
    } catch (e) {
      if (token === state.lookupToken) {
        console.warn('Geocoding:', e.message); // the reason only, never the address
        lookupStatus(say('Address could not be matched unambiguously. Try a more specific Philadelphia street address or use the official Atlas lookup.', 'No se pudo identificar la dirección sin ambigüedad. Prueba una dirección más específica o usa Atlas.'), true);
      }
    } finally {
      $('searchBtn').disabled = false;
    }
  }

  function locate() {
    if (!state.liveData) { lookupStatus(say('Location matching requires live data. Use Philadelphia Atlas.', 'La búsqueda por ubicación requiere datos actuales. Usa Philadelphia Atlas.'), true); return; }
    if (!navigator.geolocation) { lookupStatus(say('Geolocation is unavailable. Enter an address.', 'La ubicación no está disponible. Ingresa una dirección.'), true); return; }
    resetLookup();
    const token = state.lookupToken;
    lookupStatus(say('Waiting for location permission…', 'Esperando permiso de ubicación…'));
    navigator.geolocation.getCurrentPosition(pos => {
      if (token !== state.lookupToken) return;
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      if (!core.inSearchArea(lat, lng) || accuracy > 150) {
        lookupStatus(say('Location is outside the search area or too imprecise. Enter your home address instead.', 'La ubicación está fuera del área o es demasiado imprecisa. Ingresa tu dirección residencial.'), true);
        return;
      }
      lookupStatus(say('Using current coordinates. This may not be your registered home address.', 'Se usan tus coordenadas actuales. Puede que no sea tu domicilio electoral.'));
      resolve(lat, lng, token);
    }, () => lookupStatus(say('Location permission denied or unavailable. Enter an address.', 'Permiso de ubicación denegado o no disponible. Ingresa una dirección.'), true),
    { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 });
  }

  // ---------- Nearby transit (OpenStreetMap, not an official SEPTA feed) ----------

  async function stops() {
    const p = state.selected;
    if (!p) return;
    const key = p.lat.toFixed(3) + ',' + p.lng.toFixed(3);
    const out = $('stopsOutput');
    $('stopsBtn').disabled = true;
    out.textContent = say('Searching OpenStreetMap stop locations…', 'Buscando paradas en OpenStreetMap…');
    try {
      let list = state.stopCache.get(key);
      if (!list) {
        const around = `(around:650,${p.lat},${p.lng})`;
        const query = `[out:json][timeout:12];(node[highway=bus_stop]${around};node[public_transport=platform][bus=yes]${around};node[railway=tram_stop]${around};);out body;`;
        const j = await getJSON(OVERPASS + '?data=' + encodeURIComponent(query), 18000);
        list = (j.elements || []).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon)).map(x => ({
          name: String(x.tags?.name || x.tags?.['name:en'] || x.tags?.ref || 'Unnamed stop'),
          routes: String(x.tags?.route_ref || x.tags?.routes || '').slice(0, 100),
          d: core.distanceMiles(p.lat, p.lng, x.lat, x.lon)
        })).sort((a, b) => a.d - b.d).slice(0, 6);
        state.stopCache.set(key, list);
      }
      if (state.selected !== p) return;
      out.replaceChildren();
      if (!list.length) { out.textContent = say('No mapped stops found within about 0.4 miles. Check SEPTA’s trip planner.', 'No se encontraron paradas cartografiadas a unas 0,4 millas. Consulta SEPTA.'); return; }
      out.append(
        el('p', { textContent: say('OpenStreetMap stop locations, not verified SEPTA service or accessibility:', 'Paradas de OpenStreetMap, sin verificar servicio ni accesibilidad de SEPTA:') }),
        el('ul', {}, ...list.map(s => el('li', { textContent: s.name + ' · ' + s.d.toFixed(2) + ' mi' + (s.routes ? ' · ' + say('Unverified route tags: ', 'Rutas no verificadas: ') + s.routes : '') }))),
        el('p', { className: 'help', textContent: say('Straight-line distance only. Routes and arrival times are not verified. Check SEPTA for schedules, elevator status, boarding accessibility, and alerts.', 'Solo distancia en línea recta. No se verificaron rutas ni horarios. Consulta SEPTA para horarios, ascensores, accesibilidad y alertas.') }));
    } catch (e) {
      console.warn('Stops:', e.message);
      if (state.selected === p) out.textContent = say('Stop data is unavailable. Use the SEPTA trip planner and alerts links.', 'Los datos de paradas no están disponibles. Usa el planificador y las alertas de SEPTA.');
    } finally {
      $('stopsBtn').disabled = false;
    }
  }

  // ---------- Ward and Council comparison ----------

  function renderAreas() {
    if (!state.places.length) return;
    state.areas = core.areaSummary(state.places, $('areaType').value, $('sortBy').value);
    $('areaRows').replaceChildren(...state.areas.map(g => {
      const row = el('tr');
      [g.area, g.total, g.full, g.building, g.alternate + g.substantial, g.modified, g.barrier, g.unknown, g.rate.toFixed(1) + '%']
        .forEach((v, i) => row.append(el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row', textContent: String(v) } : { textContent: String(v) })));
      return row;
    }));
    const coverage = state.places.filter(p => p.council !== null).length;
    $('areaStatus').textContent = $('areaType').value === 'council'
      ? say(`Council GIS coverage: ${coverage}/${state.places.length} division records. Unmatched records are excluded.`, `Cobertura GIS: ${coverage}/${state.places.length} registros. Se excluyen los no identificados.`)
      : say('Ward-level division records from the published polling-place dataset.', 'Registros de divisiones por distrito electoral del conjunto publicado.');
    if (state.priorities) {
      $('areaStatus').textContent += ' ' + say('Planning screen: examine areas with low FH share and high N counts first. No composite risk score is calculated.', 'Revisión: examina primero áreas con bajo porcentaje FH y muchos códigos N. No se calcula una puntuación de riesgo.');
    }
  }

  async function loadCouncil() {
    if (state.councilReady || state.councilLoading) return;
    state.councilLoading = true;
    $('areaStatus').textContent = say('Loading official Council GIS intersections…', 'Cargando intersecciones GIS oficiales…');
    try {
      const all = [];
      let start = 0;
      for (let page = 0; page < 20; page++) {
        const q = new URLSearchParams({ where: '1=1', outFields: 'OBJECTID,DISTRICT,Division_Num,Short_Div_Num', returnGeometry: 'false', f: 'json', resultRecordCount: '1000', resultOffset: String(start), orderByFields: 'OBJECTID' });
        const j = await getJSON(COUNCIL + '?' + q, 22000);
        if (!Array.isArray(j.features)) throw Error('Incomplete GIS response');
        all.push(...j.features);
        if (j.features.length < 1000 && !j.exceededTransferLimit) break;
        start += j.features.length;
        if (!j.features.length) throw Error('GIS pagination stalled');
        if (page === 19) throw Error('GIS pagination limit reached');
      }
      if (all.length < 100) throw Error('Incomplete GIS response');
      // A division that appears in two districts is marked ambiguous (null), not guessed.
      const mapping = new Map();
      all.forEach(f => {
        const a = f.attributes || {};
        const raw = String(a.Division_Num ?? a.DIVISION_NUM ?? '').replace(/\D/g, '');
        const d = Number(a.DISTRICT ?? a.district);
        if (raw.length >= 3 && d >= 1 && d <= 10) {
          const k = Number(raw.slice(0, -2)) + '-' + Number(raw.slice(-2));
          mapping.set(k, mapping.has(k) && mapping.get(k) !== d ? null : d);
        }
      });
      state.places.forEach(p => { p.council = mapping.get(placeId(p)) || null; });
      if (state.places.filter(p => p.council !== null).length < 100) throw Error('No usable Council matches');
      state.councilReady = true;
    } catch (e) {
      console.warn('Council GIS:', e.message);
      $('areaType').value = 'ward';
      $('areaStatus').textContent = say('Council comparisons unavailable: the GIS response could not be validated. Ward data remains available.', 'Comparaciones del Concejo no disponibles: no se pudo validar GIS. Los datos por distrito electoral siguen disponibles.');
    } finally {
      state.councilLoading = false;
      renderAreas();
    }
  }

  function areaCSV() {
    if (!state.areas.length) return;
    const rows = [['area', 'records', 'FH', 'F_without_H', 'A', 'B', 'R_or_M', 'N', 'unknown', 'FH_percent'],
      ...state.areas.map(g => [g.area, g.total, g.full, g.building, g.alternate, g.substantial, g.modified, g.barrier, g.unknown, g.rate.toFixed(2)])];
    download('ballotgap-' + $('areaType').value + '.csv', core.toCSV(rows), 'text/csv;charset=utf-8');
  }

  function researchSummary() {
    return ['BallotGap PHL ' + config.version + ' · ' + say('Research summary', 'Resumen de investigación'),
      $('briefSummary').textContent, '',
      say('Lowest FH-share wards (screening only)', 'Distritos con menor porcentaje FH (solo análisis preliminar)'),
      ...lowestWardLines(), '',
      'Official assignment: ' + OFFICIAL,
      say('Method: division-level published codes, not unique voter counts.', 'Método: códigos publicados por división, no conteos de votantes.')].join('\n');
  }

  // ---------- Guided tour ----------

  const TOUR = [
    ['#dashboard', 'Start with the citywide data and check whether it is live or cached.', 'Empieza con los datos de la ciudad y comprueba si son actuales o guardados.'],
    ['#explore', 'Explore the map or list. Grouped markers expand when you zoom.', 'Explora el mapa o la lista. Los marcadores agrupados se separan al acercar.'],
    ['#research', 'Compare wards and download a transparent research summary for advocacy.', 'Compara distritos y descarga un resumen de investigación para la defensa de derechos.'],
    ['#about', 'Always verify your official polling place in Philadelphia Atlas before voting.', 'Confirma siempre tu centro de votación oficial en Philadelphia Atlas antes de votar.']
  ];

  function showTour() {
    const step = TOUR[state.tourIndex];
    $('tourText').textContent = say(step[1], step[2]);
    $('tourProgress').textContent = (state.tourIndex + 1) + ' / ' + TOUR.length;
    $('tourBack').disabled = state.tourIndex === 0;
    $('tourNext').disabled = state.tourIndex === TOUR.length - 1;
  }

  function moveTour(delta) {
    state.tourIndex = Math.max(0, Math.min(TOUR.length - 1, state.tourIndex + delta));
    showTour();
    document.querySelector(TOUR[state.tourIndex][0]).scrollIntoView({ block: 'start' });
  }

  // ---------- Wire up controls ----------

  function bind() {
    const rerender = () => { renderMap(); renderList(true); };
    $('langBtn').addEventListener('click', () => { state.lang = state.lang === 'en' ? 'es' : 'en'; translate(); updateHash(); });
    $('searchForm').addEventListener('submit', e => { e.preventDefault(); lookup(); });
    $('locationBtn').addEventListener('click', locate);
    $('filter').addEventListener('change', rerender);
    $('wardFilter').addEventListener('change', rerender);
    $('placeQuery').addEventListener('input', rerender);
    $('resetFilters').addEventListener('click', () => {
      $('filter').value = 'all'; $('wardFilter').value = ''; $('placeQuery').value = '';
      rerender();
      $('placeQuery').focus();
    });
    $('moreBtn').addEventListener('click', () => renderList());
    $('mapBtn').addEventListener('click', () => setView('map'));
    $('listBtn').addEventListener('click', () => { setView('list'); $('placeList').scrollIntoView({ block: 'start' }); });
    $('stopsBtn').addEventListener('click', stops);
    $('copyBtn').addEventListener('click', async () => {
      if (!state.selected) return;
      updateHash();
      flash('copyStatus', await copyText(location.href)
        ? say('Place link copied. It contains the polling place, not your address.', 'Enlace copiado. Contiene el lugar de votación, no tu dirección.')
        : say('Copy this link from your address bar: ', 'Copia este enlace de la barra de direcciones: ') + location.href);
    });
    $('printBtn').addEventListener('click', () => window.print());
    $('textBtn').addEventListener('click', () => download('ballotgap-voting-plan.txt', planText(), 'text/plain;charset=utf-8'));
    $('areaType').addEventListener('change', () => ($('areaType').value === 'council' && !state.councilReady ? loadCouncil() : renderAreas()));
    $('sortBy').addEventListener('change', renderAreas);
    $('csvBtn').addEventListener('click', areaCSV);
    $('prioritiesBtn').addEventListener('click', () => {
      state.priorities = !state.priorities;
      $('sortBy').value = state.priorities ? 'low' : 'number';
      $('prioritiesBtn').setAttribute('aria-pressed', String(state.priorities));
      renderAreas();
    });
    $('briefPrint').addEventListener('click', () => window.print());
    $('briefText').addEventListener('click', () => { if (state.places.length) download('ballotgap-research-summary.txt', researchSummary(), 'text/plain;charset=utf-8'); });
    $('copyBrief').addEventListener('click', async () => {
      if (!state.places.length) { flash('copyBriefStatus', say('Data has not loaded.', 'Los datos no se han cargado.')); return; }
      flash('copyBriefStatus', await copyText(researchSummary())
        ? say('Research summary copied.', 'Resumen de investigación copiado.')
        : say('Clipboard unavailable. Use Download research summary.', 'Portapapeles no disponible. Usa Descargar resumen de investigación.'));
    });
    $('tourBack').addEventListener('click', () => moveTour(-1));
    $('tourNext').addEventListener('click', () => moveTour(1));
    $('reportBtn').addEventListener('click', () => {
      const note = $('barrierNotes').value.trim();
      if (!state.selected) { flash('reportStatus', say('First select a polling place from the list or map.', 'Primero selecciona un centro de votación de la lista o el mapa.')); return; }
      if (!note) { flash('reportStatus', say('Describe the observed barrier first.', 'Primero describe la barrera observada.')); $('barrierNotes').focus(); return; }
      const p = state.selected;
      download('ballotgap-unverified-barrier-' + placeId(p) + '.txt', [
        'UNVERIFIED ACCESSIBILITY OBSERVATION', 'Not submitted to any authority. Do not include voter personal information.',
        'Recorded: ' + new Date().toISOString(), 'Place: ' + p.name, 'Ward / division: ' + placeId(p),
        'Published building code: ' + p.ac, 'Category: ' + $('barrierType').value, 'Observation: ' + note,
        'Follow up with Philadelphia City Commissioners: 215-686-VOTE'].join('\n'), 'text/plain;charset=utf-8');
      flash('reportStatus', say('Note downloaded to your device. Nothing was sent.', 'Nota descargada en tu dispositivo. No se envió nada.'));
    });
    window.addEventListener('hashchange', () => { if (state.places.length) restoreHash(); });
  }

  bind();
  initMap();
  translate();
  load();
})();
