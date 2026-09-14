# BallotGap PHL

**Find your Philadelphia polling place. See if it's accessible. Know your rights.**

---

## Why This Exists

Only about one-third of Philadelphia's 1,703 polling places are designated "fully accessible" by the City Commissioners. That's not a secret — the data is public — but it's buried in a CARTO API that most voters will never find. If you're a Disabled voter in Philadelphia trying to figure out whether you can actually get into your polling place on Election Day, the city's answer is: call us.

BallotGap PHL puts that data on a map. Every polling place, color-coded by accessibility status, searchable by address. It's the tool that should already exist.

## How to Use It

1. **Open the tool** — no install, no account, no data collected
2. **Search your address** — the map zooms to your area and highlights the nearest polling places
3. **Click any marker** — see the accessibility status, parking info, and ward/division
4. **Read your rights** — scroll down for Alternative Ballot options if your location isn't fully accessible

For your official assigned polling place, visit [vote.phila.gov](https://vote.phila.gov).

Toggle to **Español** with the button in the header.

## Data Source & Methodology

All data comes from the **Philadelphia City Commissioners** via the [OpenDataPhilly CARTO API](https://opendataphilly.org/datasets/polling-places/), which is continuously updated. The dataset includes building accessibility codes and parking accessibility codes for every polling place in the city.

The tool queries the live API on each page load — no stale snapshots, no cached data. What you see is what the city has on file.

**Accessibility codes** are assigned by the City Commissioners in varying degrees. "F" indicates a building-accessible facility. "FH" (building + handicapped parking) is the full designation. The tool interprets these codes into plain-language categories so voters can understand what to expect before they arrive.

**Limitations:** This tool shows accessibility designations, not firsthand audits. A location coded "accessible" may still have barriers that aren't captured in the data. If you have concerns about a specific location, contact the City Commissioners at (215) 686-VOTE.

**Geocoding** uses OpenStreetMap's Nominatim service to convert addresses to coordinates. The tool finds your nearest polling places by distance — your actual assigned polling place is determined by your ward and division, which may differ.

## Tech Stack

Single `index.html` file. No build step. No framework. No backend.

- Vanilla HTML, CSS, JavaScript
- [Leaflet.js](https://leafletjs.com/) for interactive mapping (via CDN)
- [OpenStreetMap](https://www.openstreetmap.org/) tiles
- Philadelphia CARTO API (live, no key required)
- Nominatim geocoding (free, no key required)
- [Public Sans](https://public-sans.digital.gov/) typeface (U.S. government open-source font)

Runs entirely in the browser. No data is collected, stored, or transmitted to any server other than the public APIs listed above.

## Accessibility

This tool is built by a Disabled civic tech developer for Disabled voters. Accessibility isn't a feature — it's the point.

- Semantic HTML structure
- Keyboard navigable throughout
- Screen-reader-compatible labels and ARIA attributes
- Sufficient color contrast (WCAG AA)
- Mobile-first responsive layout
- Skip link for keyboard users
- Plain-language explanations alongside data codes
- Bilingual EN/ES interface
- No auto-playing media, no motion without user action
- Print-friendly detail view

## How to Contribute

Found a bug? See something that could be clearer? Open an issue or submit a PR.

If you work at the Philadelphia City Commissioners office and notice the accessibility code mapping is incomplete or inaccurate, I genuinely want to hear from you. This tool is only as good as its data interpretations.

If you're a civic tech developer in another city with similar open polling place data, this tool is designed to be adaptable. Swap the CARTO endpoint and code mappings and you're most of the way there.

## Context

BallotGap PHL was built for [Disability Voting Rights Week 2026](https://www.aapd.com/disability-voting-rights-week/) (September 14–18, 2026), a national nonpartisan movement hosted by the American Association of People with Disabilities and REV UP.

It sits within a portfolio of open-source civic tech tools focused on climate equity, transit accessibility, and civic access in Philadelphia. See more at [github.com/meyeringn](https://github.com/meyeringn).

## License

MIT