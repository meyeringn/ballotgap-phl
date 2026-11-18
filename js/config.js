// Settings that change between releases or elections. Edit this file, not app.js,
// for routine updates. Every date here must come from an official source
// (vote.phila.gov or pa.gov) — never from memory or a news article.
(function (root) {
  'use strict';
  const BallotGap = (root.BallotGap = root.BallotGap || {});

  BallotGap.config = {
    version: '5.3',

    // Shown in the footer. Update after re-checking the sources listed in README.md.
    dataVerified: ['Data last verified: November 2026', 'Datos verificados por última vez: noviembre de 2026'],

    // Official page listing Pennsylvania election dates.
    officialDatesUrl: 'https://www.pa.gov/agencies/vote/elections/upcoming-elections',

    // Elections, oldest first. The page shows the next one that has not ended.
    // When every election here has passed, it shows a neutral "between elections"
    // panel that points to official dates instead of stale ones.
    // To add the next election, copy the block below, change every value, and run `npm test`.
    elections: [
      {
        name: ['2026 General Election', 'Elección general de 2026'],
        date: '2026-11-03',      // Election Day, Philadelphia local date
        utcOffset: '-05:00',     // -05:00 in November, -04:00 in May (daylight time)
        pollsOpen: '07:00',
        pollsClose: '20:00',
        milestones: [
          { when: ['Oct 19', '19 de oct.'], label: ['Register or update registration', 'Inscribirse o actualizar la inscripción'] },
          { when: ['Oct 27, 5 PM', '27 de oct., 5 p. m.'], label: ['Mail-ballot application received', 'Fecha límite de recepción de solicitudes de voto por correo'] },
          { when: ['Nov 3, 7 AM–8 PM', '3 de nov., 7 a. m.–8 p. m.'], label: ['Polls open', 'Centros de votación abiertos'] },
          { when: ['Nov 3, 8 PM', '3 de nov., 8 p. m.'], label: ['Mail ballot received by election office', 'Boleta por correo recibida por la oficina electoral'] }
        ]
      }
    ]
  };

  // Anonymous visit counting (GoatCounter): page path only — never form input,
  // query strings, or the #p= place hash. Must load before gc.zgo.at/count.js.
  root.goatcounter = { path: function () { return root.location ? root.location.pathname : '/'; } };
})(typeof self !== 'undefined' ? self : globalThis);
