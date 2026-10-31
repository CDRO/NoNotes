// Drehbuch der Screenshots für v4.0.0 (node tools/release-shots.cjs v4.0.0 --plugins ../NoNotes-plugins)
// Der Editor kommt jetzt aus dem Paket NoNotes-editor: das Bild zeigt, dass er aussieht und arbeitet wie in v3.3.0, samt dem Knopf
// einer Erweiterung in der Toolleiste («Datum», aus den Beispielen) und dem Menü einer Tabelle mit dem Eintrag von «Tabellen formatieren».

const BODY = [
  '## Sitzung Projekt Süd',
  '',
  '- [ ] Offerte Gerüst einholen @anna >06.11.2026',
  '- [x] Termin mit der Bauherrschaft',
  '? Holz oder Kunststoff für die Fenster?',
  '! Holz-Metall, wie im Vorprojekt',
  '',
  '| Bereich | Stand | Nächster Schritt |',
  '| --- | --- | --- |',
  '| Heizung | offen | Förderung prüfen |',
  '| Fenster | entschieden | Bestellung |',
  '',
  'Siehe [[Vorprojekt]].',
].join('\n');

module.exports = {
  date: '2026-11-02T09:00:00+01:00',
  plugins: ['beispiele/datum-einfuegen.js', 'table-format/table-format.js'],
  async run(s) {
    const { page } = s;
    await s.newNote('Vorprojekt');
    await s.newNote('Sitzung Projekt Süd');
    await s.edit('Sitzung Projekt Süd', { body: BODY, mode: 'split' });
    await page.waitForSelector('#preview table.md-table');
    await page.waitForSelector('#mdToolbar button[data-plugin]');
    await s.shot('editor', { locator: '#editorPane', pad: 8 });

    await page.locator('#preview table.md-table tbody tr[data-row="0"] td[data-col="1"]').click({ button: 'right' });
    await page.waitForSelector('#contextMenu:not([hidden])');
    await page.locator('#contextMenu button', { hasText: 'Formatieren' }).hover();
    await s.shot('tabellenmenue');
    await page.keyboard.press('Escape');
  },
};
