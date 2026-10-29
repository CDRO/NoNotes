// Drehbuch der Screenshots für v3.3.0 (node tools/release-shots.cjs v3.3.0)

const TABLE = [
  'Wochenplan Umbau',
  '',
  '+-------------+------------------------------+------------+',
  '| Bereich     | Aufgaben                     | Stand      |',
  '+=============+==============================+============+',
  '| Heizung     | [ ] Offerte einholen @anna   | offen      |',
  '|             | [x] Termin mit Installateur  |            |',
  '|             | [ ] Förderung prüfen >13.11.2026 |        |',
  '+-------------+------------------------------+------------+',
  '| Fenster     | ? Holz oder Kunststoff?      | entschieden |',
  '|             | ! Holz-Metall                |            |',
  '+-------------+------------------------------+------------+',
  '| Dach: Gerüst ab KW 47, Abnahme mit Bauherrschaft         |',
  '+----------------------------------------------------------+',
].join('\n');

module.exports = {
  date: '2026-11-02T09:00:00+01:00',
  async run(s) {
    const { page } = s;
    await s.newNote('Umbau');
    await s.edit('Umbau', { body: TABLE });
    // einmal ausrichten lassen (Tab in die Tabelle und zurück)
    await page.evaluate(() => { const b = document.querySelector('#body'); const p = b.value.indexOf('Heizung'); b.focus(); b.setSelectionRange(p, p); });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await s.saved();

    // ---------- Vorschau ----------
    await s.mode('preview');
    await page.waitForSelector('#preview table.md-table td[colspan]');
    await s.shot('vorschau', { locator: '#preview table.md-table', pad: 16 });

    // ---------- Text mit Rahmen ----------
    await s.mode('edit');
    await page.evaluate(() => { const b = document.querySelector('#body'); const p = b.value.indexOf('Holz-Metall') + 'Holz-Metall'.length; b.focus(); b.setSelectionRange(p, p); });
    await s.shot('text', { locator: '#body', pad: 4 });

    // ---------- Rechtsklick: verbinden, teilen, umwandeln ----------
    await s.mode('preview');
    await page.locator('#preview tbody tr[data-row="0"] td[data-col="1"]').click({ button: 'right' });
    await page.waitForSelector('#contextMenu:not([hidden])');
    await page.locator('#contextMenu button', { hasText: 'Mit dem Feld rechts verbinden' }).hover();
    await s.shot('rechtsklick');
    await page.keyboard.press('Escape');

    // ---------- Einfügen ----------
    await s.mode('edit');
    await page.evaluate(() => { const b = document.querySelector('#body'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); });
    await page.click('#mdToolbar [data-cmd="table"]');
    await page.waitForSelector('#tablePicker:not([hidden])');
    await page.locator('#tablePicker .tp-cell[data-c="3"][data-r="3"]').hover();
    await s.shot('einfuegen', { locator: '#tablePicker', pad: 24 });
    await page.keyboard.press('Escape');
  },
};
