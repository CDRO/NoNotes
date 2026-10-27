// Drehbuch der Screenshots für v3.1.0 (node tools/release-shots.cjs v3.1.0 --plugins ../nonotes-plugins)

module.exports = {
  date: '2026-10-28T09:00:00+01:00',
  plugins: ['tag-colors/tag-colors.js'],
  async run(s) {
    const { page } = s;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // ---------- Beispieldaten ----------
    await s.newNote('Projekt Süd');
    for (const t of ['Heizung', 'Fenster', 'Dach']) await s.newNote(t, 'Projekt Süd');
    await s.newNote('Offerte Heizung', 'Heizung');
    await s.newNote('Wartung', 'Heizung');
    await s.newNote('Budget');
    await s.newNote('Team');
    for (const t of ['Anna', 'Ben']) await s.newNote(t, 'Team');
    await s.newNote('Termine');
    await s.edit('Projekt Süd', { tags: ['farbe:blau'] });
    await s.back();
    await s.edit('Heizung', { tags: ['farbe:rot+schraffiert'], body: '- [ ] Offerte einholen @anna >30.10.2026\n? Reicht die Leistung für das Dach? @ben >04.11.2026' });
    await s.back();
    await s.edit('Budget', { tags: ['farbe:grün'] });
    await s.back();
    await page.click('#mapFitBtn');
    await s.saved();

    // ---------- Sprachwechsel mit Flagge ----------
    await page.click('#langBtn');
    await page.waitForSelector('#langList:not([hidden])');
    await s.shot('sprachwechsel', { locator: '#langList', pad: 56 });
    await page.keyboard.press('Escape');

    // ---------- Mindmap ab einem Knoten als Bild, mit den Farben der Erweiterung ----------
    await page.evaluate(() => { const o = NoNotesMindmap.toSvgString; NoNotesMindmap.toSvgString = (r, opt) => (window.__bild = o(r, opt)); });
    await s.node('Heizung').click({ button: 'right' });
    await page.waitForSelector('#contextMenu:not([hidden])');
    await page.locator('#contextMenu button', { hasText: 'Als Bild kopieren' }).hover();
    await s.shot('ab-knoten-kopieren');
    await page.locator('#contextMenu button', { hasText: 'Als Bild kopieren' }).click();
    await page.waitForFunction(() => window.__bild && /als Bild in die Zwischenablage kopiert/.test(document.querySelector('#status').textContent));
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'bildVorschau';
      box.style.cssText = 'position:fixed;left:40px;top:120px;z-index:999;padding:12px;background:#e9ecf1';
      box.innerHTML = window.__bild;
      document.body.appendChild(box);
    });
    await s.shot('ab-knoten-bild', { locator: '#bildVorschau', pad: 0 });
    await page.evaluate(() => document.getElementById('bildVorschau').remove());

    // Häkchen «Farben beim Kopieren als Bild» im Untermenü «Farbe ▸»
    await s.node('Heizung').click({ button: 'right' });
    await page.hover('#contextMenu button[data-plugin="tag-farben"]');
    await page.waitForSelector('.tf-panel[data-stand="geladen"]');
    await page.hover('.tf-panel .tf-bild');
    await s.shot('farben-im-bild', { locator: '.tf-panel', pad: 8 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // ---------- Neue Sprachen: dieselben Notizen auf Französisch und Portugiesisch (Brasilien) ----------
    const sprache = async code => {
      await page.click('#langBtn');
      await page.click(`#langList [data-lang="${code}"]`);
      await page.waitForFunction(c => document.documentElement.lang === c, code);
      await page.waitForSelector('body[data-ready="true"]');
      await page.click('#mapFitBtn');
    };
    await sprache('fr-CH');
    await s.shot('francais');
    await sprache('pt-BR');
    await s.view('tasks');
    await s.shot('portugues', { locator: '#tasksView', pad: 8 });
    await s.view('map');
    await sprache('de');
  },
};
