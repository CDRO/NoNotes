// Drehbuch der Screenshots für v4.1.0 (node tools/release-shots.cjs v4.1.0)
// Der Dialog «Als PDF exportieren» als Screenshot; die Seiten der heruntergeladenen PDF-Datei als Bilder über pdftoppm (Poppler,
// nur auf dem Rechner, der die Release-Notizen macht: apt install poppler-utils, brew install poppler).

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const NOTES = [
  ['Heizung', [
    '+-------------+-------------------------------+--------+',
    '| Bereich     | Aufgaben                      | Stand  |',
    '+=============+===============================+========+',
    '| Wärmepumpe  | [ ] Offerte einholen @anna    | offen  |',
    '|             | [x] Termin mit Installateur   |        |',
    '+-------------+-------------------------------+--------+',
    '| Förderung   | [ ] Gesuch einreichen >20.11.2026 | offen |',
    '+-------------+-------------------------------+--------+',
    '',
    '? Wärmepumpe oder Pellets?',
    '! Wärmepumpe, Erdsonde mit 160 m',
    '',
    'Siehe auch [[Budget]].',
  ].join('\n')],
  ['Fenster', [
    '?! Holz oder Kunststoff? @ben >13.11.2026',
    '',
    '- dreifach verglast',
    '- Rollläden elektrisch',
    '',
    '> Offerte Schreinerei Huber: 18 400 CHF',
  ].join('\n')],
  ['Dach', [
    '- [ ] Gerüst ab KW 47 bestellen @cem >09.11.2026',
    '- [ ] Ziegel auswählen',
    '- [x] Statik prüfen lassen',
  ].join('\n')],
  ['Budget', [
    '| Posten | Betrag |',
    '| --- | ---: |',
    '| Heizung | 38 000 CHF |',
    '| Fenster | 18 400 CHF |',
    '| Dach | 26 500 CHF |',
    '| **Total** | **82 900 CHF** |',
  ].join('\n')],
];

module.exports = {
  date: '2026-11-05T09:00:00+01:00',
  async run(s) {
    const { page } = s;
    await s.newNote('Umbau Haus');
    await s.edit('Umbau Haus', { body: 'Planung für den Umbau 2027: [[Heizung]], [[Fenster]], [[Dach]] und das [[Budget]].' });
    await s.back();
    for (const [title, body] of NOTES) {
      await s.newNote(title, 'Umbau Haus');
      await s.edit(title, { body });
      await s.back();
    }

    // ---------- Dialog ----------
    await page.click('#menuBtn');
    await page.click('#pdfExportBtn');
    await page.waitForSelector('#pdfDialog[open]');
    await s.shot('dialog', { locator: '#pdfDialog', pad: 12 });

    // ---------- Seiten der PDF-Datei ----------
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#pdfDownloadBtn')]);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-shots-'));
    try {
      const file = path.join(tmp, 'export.pdf');
      await dl.saveAs(file);
      const pageImage = (n, name, dpi) => {
        try { execFileSync('pdftoppm', ['-png', '-r', String(dpi), '-f', String(n), '-l', String(n), '-singlefile', file, path.join(__dirname, name)]); }
        catch (e) { throw new Error('pdftoppm (Poppler) fehlt oder scheitert: ' + e.message); }
      };
      pageImage(1, 'pdf-mindmap', 60);
      pageImage(2, 'pdf-inhalt', 70);
      pageImage(3, 'pdf-notiz', 70);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
};
