# BallotGap PHL 4.0

**Where do I vote? Can I access it? How do I get there?**

BallotGap PHL is an independent, nonpartisan, single-file civic technology application for Philadelphia voters and election administrators. It translates published polling-place accessibility classifications into plain language and helps identify areas for further investigation. It is not an official election service.

## Why it exists

Disabled voters should not need to interpret GIS tables to find basic accessibility information. Administrators and advocates also need transparent, comparable ward-level information. The app makes published information easier to explore while identifying its limitations.

## Who it serves

- **Voters:** review published building and parking classifications, seek a provisional ward/division match, check nearby transit map features, and create a voting plan.
- **Administrators and advocates:** compare division-record counts, identify areas with lower FH shares or more N codes, and export CSV data.

## Features

- Live browser request for Philadelphia's public polling-place dataset, map, and map-independent paginated list.
- Address geocoding and provisional GIS ward/division match, with strict no-match and ambiguous-match safeguards.
- Prominent links to the official Philadelphia Atlas voter lookup.
- Separate building and parking descriptions, including F, A, B, R, M, N and H, L, N, G codes.
- Ward filter, code filter, citywide counts, ward comparison, and downloadable ward CSV.
- Optional Council district comparison using official GIS intersections, only when the response passes minimum validation.
- Transparent Planning Priorities view, sorting by FH share, not a made-up composite risk score.
- On-demand nearby bus/trolley stop discovery from OpenStreetMap, with straight-line distances.
- Links to SEPTA's official trip planner, service alerts and accessibility information.
- English/Spanish interface, readable text voting-plan export, print view, and location-only deep links.
- No user account, analytics, tracking pixels, cookies or persistent address storage.

## Instructions for voters

1. Enter a **complete Philadelphia street address**, or request location access. Current location may not be your registered voting address.
2. If the geocoder finds a single Philadelphia match and GIS finds exactly one division, BallotGap shows a **provisional** division-to-polling-place match. It is **not officially verified**.
3. **Always confirm your assigned polling place** at [Philadelphia Atlas](https://atlas.phila.gov/voting) or [vote.phila.gov](https://vote.phila.gov). Nearby locations are informational only. You cannot choose another polling place because it looks more accessible.
4. Open the location details to review published building and parking codes. Use the SEPTA planner and alerts before travel.
5. Save the text plan or print the details. Both clearly distinguish provisional matches from informational locations.

## Instructions for policymakers

Use the comparison table to view ward-level counts, including unknown data. Sort by lowest FH share or highest number of N-coded records. Download the displayed data as CSV. For Council districts, select the GIS option; if the external GIS service cannot be validated, the app falls back to ward analysis. The Planning Priorities control is an **investigation queue**, not an assessment of legal compliance or of affected voter counts.

## Polling-place data sources

- [Philadelphia City Commissioners via OpenDataPhilly](https://opendataphilly.org/datasets/polling-places/), `https://phl.carto.com/api/v2/sql`, queried on page load. No snapshot is bundled.
- [City Commissioners' published accessibility explanation](https://vote.phila.gov/voting/voting-at-the-polls/polling-place-accessibility/).
- [2026 polling-place list and code legend](https://vote.phila.gov/news/2026/04/29/2026-primary-election-polling-place-list/). The public page describes 1,703 division records at its publication date. **Do not assume this count is current.**
- [Philadelphia Political Divisions GIS](https://services.arcgis.com/fLeGjb7u4uXqeF9q/ArcGIS/rest/services/Political_Divisions/FeatureServer/0) for geographic division lookup.
- [Philadelphia Council Lookup 2024 GIS](https://services2.arcgis.com/1OML3Q9DZatjcY7Q/ArcGIS/rest/services/Council_Lookup24/FeatureServer/1) for optional district grouping. The integration requires browser/live service validation before public reliance.

**Source review:** October 7, 2026. Dataset retrieval happens at page load but freshness is controlled by source maintainers. The app displays its local retrieval time, not an authoritative source modification timestamp. A polling place may change before Election Day.

## Accessibility classification methodology

The City Commissioners describe `F` as a fully accessible building and `H` as designated accessible parking. `FH` is the combined designation. The tool distinguishes these two fields instead of treating `F` alone as `FH`.

| Building code | Published meaning |
| --- | --- |
| F | Building fully accessible |
| A | Alternate entrance |
| B | Building substantially accessible |
| R | Accessible with ramp |
| M | Building accessibility modified |
| N | Building not accessible |
| Other / missing | Unknown |

Parking codes: `H` accessible parking, `L` loading zone, `N` no parking, `G` general parking. Missing and unexpected values are shown as unknown. The classification describes **published administrative data**, not a firsthand inspection. A building with FH does not automatically guarantee an accessible sidewalk, transit trip, working entrance, or barrier-free experience.

Counts use **division records**, not necessarily unique buildings or individual voters. The denominator for FH share includes unknown records. No claim is made about turnout or the number of Disabled voters affected.

## SEPTA data sources and limitations

The app provides links to [SEPTA trip planning](https://plan.septa.org/), [alerts](https://www.septa.org/alerts/), and [accessibility](https://www.septa.org/accessibility/). The optional nearby stop list uses OpenStreetMap's public Overpass API, **not an official SEPTA stop feed**. It may contain missing, stale or mislabeled stops. Distances are straight-line estimates, **not walking distances or travel times**. Any route tags are explicitly unverified. The app does **not** display scheduled or real-time arrivals and does not certify stop, vehicle, station, elevator, or whole-trip accessibility.

For future authoritative stop/route work, SEPTA publishes [official GTFS files](https://www3.septa.org/developer/gtfs_public.zip) and [release notes](https://github.com/septadev/GTFS/releases). A robust GTFS integration would require feed parsing and a refresh strategy; that is deliberately not represented as already implemented in this one-file app.

## Assignment lookup methodology

1. A user-provided address is sent to OpenStreetMap Nominatim for geocoding.
2. Only a **single** result meeting Philadelphia location checks is accepted.
3. Coordinates are sent to Philadelphia's Political Divisions GIS point-in-polygon query.
4. A single ward/division polygon must be returned, and exactly one corresponding polling-place record must exist.
5. The resulting location is marked **provisional**, never officially verified. If any stage fails, no assignment is shown.

Geocoding may select the wrong building or address point, and GIS layers may differ from election-office records. For a definitive assignment use Philadelphia Atlas. A device's current location is not a substitute for its owner's registered address.

## Accessibility and universal design

The app includes semantic sections, labeled controls, live error announcements, keyboard-operable list and tables, a visible focus ring, a map-independent list, readable text exports, responsive layout, reduced-motion support, and English/Spanish labels. **No WCAG 2.2 AA conformance claim is made.** Full assistive technology, bilingual, color contrast and device testing remains necessary. Some external mapping controls and translated dynamic messages may have limitations.

## Privacy

BallotGap does not store address searches in cookies or local storage, does not transmit them to an application backend, and does not place them in shareable URLs. Address strings go to Nominatim; coordinates go to Philadelphia GIS. When requested, nearby stop coordinates go to Overpass. External map tiles and CDN libraries receive ordinary network request metadata, including IP addresses. Browser history can contain public polling-place identifiers, but not searched home addresses. Printed or downloaded plans may contain polling-place addresses, never searched home addresses.

## Architecture

One `index.html` file, plain HTML/CSS/JavaScript, Leaflet from a CDN, OpenStreetMap tiles, public APIs, no backend, no build process, no secrets. Runtime data is held in memory. External dependencies and cross-origin availability may change.

## GitHub Pages deployment

1. Put `index.html` and `README.md` at the root of the repository.
2. In repository **Settings → Pages**, select **Deploy from a branch**, then the branch and root folder.
3. Open the published HTTPS URL. HTTPS is needed for location permission and clipboard access.
4. Confirm the polling data, geocoding, GIS match, map/list, and optional stop lookup in a real browser before promoting the site.

## Testing and known limitations

The JavaScript syntax and structural checks were performed in the delivery environment. Full live browser/API, keyboard, screen-reader, 320/375/768px viewport and end-to-end assignment testing **must be completed before public launch**. No unexecuted test is reported as passing.

Known limitations: public API outages and CORS, geocoder ambiguity, GIS division data changes, no official confirmation of voter assignment, no authoritative SEPTA stop or arrival integration, incomplete transit-accessibility verification, potential Council GIS schema/coverage mismatch, no site audit, no source timestamp beyond local retrieval, and no independent WCAG audit. Spanish covers core controls and explanations but some code values and system-originated place names remain untranslated.

## Roadmap

1. Test and validate all external endpoints from GitHub Pages, especially the Political Divisions and Council GIS field names.
2. Integrate and periodically validate SEPTA GTFS stop and route data, with explicit feed effective dates and optional GTFS-RT when supportable.
3. Add official Council district geometry with audited joins and a coverage report.
4. Run manual keyboard, VoiceOver, NVDA, mobile and WCAG 2.2 AA testing with Disabled users.
5. Obtain official source update metadata and monitor changes before elections.
6. Explore authoritative pedestrian accessibility, entrance and curb-ramp data without inferring full-trip accessibility.

## Contributions

Issues and pull requests are welcome, especially accessibility testing, code legend corrections, data verification, bilingual review, and public-sector QA. Do not commit personal voter addresses or fabricated accessibility reports. See [the project owner's GitHub](https://github.com/meyeringn).

## License

MIT. See the repository's LICENSE file for the full legal text; this README is not a substitute for the license file.
