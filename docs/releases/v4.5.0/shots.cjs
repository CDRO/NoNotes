// Drehbuch der Screenshots für v4.5.0 (node tools/release-shots.cjs v4.5.0)
// Die Aufgabenliste mit Unteraufgaben, die die Frist ihrer Hauptaufgabe erben (blass), neben solchen mit eigener Frist.

const BODY = [
  '- [ ] Umzug vorbereiten @anna >27.11.2026',
  '  - [ ] Offerten einholen',
  '  - [ ] Kisten bestellen >18.11.2026',
  '  - [ ] Möbelplan zeichnen @ben',
  '    - [ ] Masse aufnehmen',
  '- [ ] Netzwerk planen @cem >4.12.2026',
  '  - [ ] Anschlüsse zählen',
].join('\n');

module.exports = {
  date: '2026-11-12T09:00:00+01:00',
  async run(s) {
    const { page } = s;
    await s.newNote('Umzug Büro');
    await s.edit('Umzug Büro', { body: BODY });
    await s.back();
    await s.view('tasks');
    await page.waitForSelector('#tList .due.inherited');
    await s.shot('aufgaben', { locator: '#tList', pad: 8 });
  },
};
