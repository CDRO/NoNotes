// Drehbuch der Screenshots für v4.7.0 (node tools/release-shots.cjs v4.7.0)
// Eine Rettungskopie aus einem geschlossenen Tab, deren Zeile inzwischen anders geändert wurde: die ruhige Leiste beim nächsten
// Öffnen und das Fenster «Text anzeigen…».

const LINES = [
  'Traktanden der Sitzung vom 12. November.',
  '',
  '## Budget 2027',
  'Der Entwurf liegt vor.',
  '- [ ] Zahlen einholen @anna >20.11.2026',
];
const BODY = LINES.join('\n');
const BASE = BODY;
const NOW = LINES.map((l, i) => (i === 3 ? 'Der Entwurf liegt vor, die Zahlen der Abteilungen fehlen noch.' : l)).join('\n');
const MINE = LINES.map((l, i) => (i === 3 ? 'Der Entwurf liegt vor und geht am Freitag an den Vorstand.' : l)).join('\n');

module.exports = {
  date: '2026-11-13T10:00:00+01:00',
  async run(s) {
    const { page } = s;
    await s.newNote('Sitzung Vorstand');
    await s.edit('Sitzung Vorstand', { body: NOW });
    await s.back();
    // was ein anderer, inzwischen geschlossener Tab nicht mehr speichern konnte
    await page.evaluate(([base, mine]) => localStorage.setItem('nonotes.rescue.vorher', JSON.stringify({
      area: 'main', at: new Date().toISOString(),
      entries: [{ note: 1, field: 'body', base, value: mine, label: 'Sitzung Vorstand' }],
    })), [BASE, MINE]);
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]');
    await page.waitForFunction(() => /wurde nicht übernommen/.test(document.querySelector('#banner').textContent));
    await s.shot('leiste');
    await page.click('#banner button:has-text("Text anzeigen")');
    await page.waitForSelector('#textDialog[open]');
    await s.shot('text', { locator: '#textDialog', pad: 8 });
  },
};
