// Deterministic fake data for offline browser tests. Nothing here is real
// polling-place data; it only has the shape of the public APIs.
const CODES = ['F', 'F', 'F', 'B', 'A', 'R', 'M', 'N', ''];
const PARKING = ['H', 'H', 'L', 'N', 'G', ''];

export function cartoRows() {
  const rows = [];
  for (let ward = 1; ward <= 66; ward++) {
    for (let division = 1; division <= 20; division++) {
      const n = ward * 100 + division;
      rows.push({
        placename: `Test Recreation Center ${n}`,
        street_address: `${1000 + n} Test St`,
        zip_code: '19147',
        ward,
        division,
        accessibility_code: CODES[n % CODES.length],
        parking_code: PARKING[n % PARKING.length],
        lat: 39.90 + (ward % 11) * 0.01 + division * 0.0005,
        lng: -75.20 + Math.floor(ward / 11) * 0.015 + division * 0.0005,
      });
    }
  }
  return rows;
}

export const nominatim = [{
  lat: '39.9512', lon: '-75.1580',
  address: { house_number: '1234', road: 'Market Street', city: 'Philadelphia', county: 'Philadelphia County' },
}];

export const division = { features: [{ attributes: { Division_Num: '0501', Short_Div_Num: '01' } }] };

// Minimal stand-in for Leaflet so map code paths run without the network.
export const leafletStub = `(() => {
  window.__markers = 0;
  const chain = o => Object.assign(o, { addTo() { return o; }, on() { return o; } });
  window.L = {
    map: () => chain({ setView() {}, invalidateSize() {}, getZoom: () => 12 }),
    tileLayer: () => chain({}),
    layerGroup: () => chain({ clearLayers() { window.__markers = 0; } }),
    marker: () => chain({ addTo() { window.__markers++; return this; } }),
    divIcon: o => o,
  };
})();`;
