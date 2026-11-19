// Drehbuch der Screenshots für v4.8.0 (node tools/release-shots.cjs v4.8.0)
// Das Rechtsklick-Menü nach Themen (Untermenü «Ansicht»), ein Ast mit teilweise ausgeblendeten Unternotizen («+N») und die Vorschau
// mit Hervorhebungen in mehreren Farben und einer nummerierten Liste, die bei 4 weitergeht, mit dem Farbfenster des Editors.

const BODY = [
  '## Stand Umbau',
  '',
  'Die ==Offerte== ist da, der ==Termin=={rot} steht noch aus. ==Budget=={limette} und ==Zeitplan=={himmelblau} sind besprochen, die',
  '==Bewilligung=={orange} fehlt, ==Lieferung=={violett} nach Ostern.',
  '',
  '## Nächste Schritte',
  '',
  '4. Termin mit der Bauleitung festlegen',
  '5. Offerte unterschreiben',
  '6. Lieferung bestätigen',
].join('\n');

module.exports = {
  date: '2026-11-13T10:00:00+01:00',
  async run(s) {
    const { page, node } = s;
    await s.newNote('Projekt Umbau');
    for (const t of ['Planung', 'Offerten', 'Bewilligung', 'Lieferanten', 'Termine']) await s.newNote(t, 'Projekt Umbau');
    await node('Projekt Umbau').waitFor();

    // 1. Das Menü nach Themen, «Ansicht» geöffnet
    await node('Offerten').click({ button: 'right' });
    await page.waitForSelector('#contextMenu:not([hidden])');
    await page.hover('#contextMenu > button:has(> span:first-child:text-is("Ansicht"))');
    await page.waitForSelector('.context-sub');
    await page.hover('.context-sub button:has(> span:first-child:text-is("Einklappen"))');
    await s.shot('menue', { locator: '#mindmap', pad: 0 });

    // 2. Teile eines Asts einklappen: Offerten, Lieferanten und Termine ausblenden → «+3»
    await page.click('.context-sub button:has(> span:first-child:text-is("Einklappen"))');
    for (const t of ['Lieferanten', 'Termine']) {
      await node(t).click({ button: 'right' });
      await page.waitForSelector('#contextMenu:not([hidden])');
      await page.hover('#contextMenu > button:has(> span:first-child:text-is("Ansicht"))');
      await page.waitForSelector('.context-sub');
      await page.click('.context-sub button:has(> span:first-child:text-is("Einklappen"))');
    }
    await page.waitForSelector('g.mm-node:has(> text:text-is("Projekt Umbau")) .mm-hiddenbadge');
    await page.mouse.move(5, 5);
    await s.shot('einklappen', { locator: '#mindmap', pad: 0 });
    await node('Projekt Umbau').locator('.mm-hiddenbadge').click();

    // 3. Hervorheben und nummerierte Liste
    await s.edit('Projekt Umbau', { body: BODY });
    await s.mode('preview');
    await s.shot('hervorheben-vorschau', { locator: '#preview', pad: 8 });
    await s.mode('edit');
    await page.evaluate(() => { const ta = document.querySelector('#body'); const i = ta.value.indexOf('Offerte'); ta.focus(); ta.setSelectionRange(i, i + 7); });
    await page.click('.toolbar button[data-cmd="highlight"]');
    await page.waitForSelector('.hl-picker:not([hidden])');
    await s.shot('hervorheben-farben', { locator: '#editorPane', pad: 8 });
  },
};
