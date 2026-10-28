// Drehbuch der Screenshots für v3.2.0 (node tools/release-shots.cjs v3.2.0)

module.exports = {
  date: '2026-11-02T09:00:00+01:00',
  async run(s) {
    const { page, node } = s;
    const icon = title => node(title).locator('g.mm-linkicon');
    const menu = async (title, label) => {
      await node(title).click({ button: 'right' });
      await page.waitForSelector('#contextMenu:not([hidden])');
      await page.locator('#contextMenu button', { hasText: label }).click();
    };
    await page.evaluate(() => { window.open = () => null; });

    // ---------- Beispieldaten ----------
    await s.newNote('Umbau Haus');
    for (const t of ['Heizung', 'Fenster', 'Dach']) await s.newNote(t, 'Umbau Haus');
    await s.newNote('Offerte Heizung', 'Heizung');
    await s.newNote('Wartung', 'Heizung');
    await s.newNote('Budget');
    await s.newNote('Team');
    for (const t of ['Anna', 'Ben']) await s.newNote(t, 'Team');
    await s.edit('Heizung', { body: '- [ ] Offerte einholen @anna >13.11.2026\n? Reicht die Leistung für das Dach? @ben' });
    await s.back();
    await s.edit('Dach', { body: 'Kosten siehe [[Budget]].' });
    await s.back();
    await page.click('#mapFitBtn');
    await s.saved();

    // ---------- Link am Knoten ----------
    await menu('Budget', 'Link hinterlegen…');
    await page.waitForSelector('#nodeLinkDialog[open]');
    await page.fill('#nodeLinkInput', 'https://www.example.ch/budget-2027');
    await s.shot('link-dialog', { locator: '#nodeLinkDialog', pad: 24 });
    await page.click('#nodeLinkSaveBtn');
    await icon('Budget').waitFor();
    await node('Budget').hover();
    await icon('Budget').hover();
    await s.shot('link-am-knoten');

    // ---------- In neuen Bereich auslösen ----------
    await menu('Umbau Haus', 'In neuen Bereich auslösen…');
    await page.waitForSelector('#detachDialog[open]');
    await s.shot('ausloesen-dialog', { locator: '#detachDialog', pad: 24 });
    await page.click('#detachGoBtn');
    await page.waitForSelector('#banner:not([hidden])');
    await icon('Umbau Haus').waitFor();
    await page.click('#mapFitBtn');
    await s.shot('alter-bereich');

    await icon('Umbau Haus').click();
    await page.waitForFunction(() => /(^|&|#)w=umbau-haus(&|$)/.test(location.hash));
    await node('Heizung').waitFor();
    await page.click('#mapFitBtn');
    await s.shot('neuer-bereich');

    await s.edit('Dach', { mode: 'preview' });
    await s.shot('verweis-umgeschrieben', { locator: '#editor', pad: 0 });
    await s.back();
  },
};
