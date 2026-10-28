// Drehbuch der Screenshots für v3.1.1 (node tools/release-shots.cjs v3.1.1 --plugins ../nonotes-plugins)

module.exports = {
  date: '2026-10-28T15:00:00+01:00',
  plugins: ['tag-colors/tag-colors.js', 'table-format/table-format.js', 'subnote-jump/subnote-jump.js', 'tag-themes/tag-themes.js'],
  async run(s) {
    const { page } = s;

    // ---------- Beispieldaten ----------
    await s.newNote('Projet Sud');
    for (const t of ['Chauffage', 'Fenêtres', 'Toit']) await s.newNote(t, 'Projet Sud');
    await s.newNote('Budget');
    await s.edit('Chauffage', { tags: ['color:red'] });
    await s.back();
    await s.edit('Budget', { tags: ['color:green+hatched'] });
    await s.back();
    await page.click('#mapFitBtn');
    await s.saved();

    const sprache = async code => {
      await page.click('#langBtn');
      await page.click(`#langList [data-lang="${code}"]`);
      await page.waitForFunction(c => document.documentElement.lang === c, code);
      await page.waitForSelector('body[data-ready="true"]');
      await page.click('#mapFitBtn');
    };

    // ---------- Dialog «Erweiterungen…» auf Französisch ----------
    await sprache('fr-CH');
    await page.click('#menuBtn');
    await page.click('#pluginsBtn');
    await page.waitForSelector('#pluginsDialog[open]');
    await s.shot('erweiterungen-fr', { locator: '#pluginsDialog', pad: 12 });
    await page.keyboard.press('Escape');

    // ---------- Untermenü der Farben auf Portugiesisch (Brasilien), Tags englisch ----------
    await sprache('pt-BR');
    await s.node('Chauffage').click({ button: 'right' });
    await page.waitForSelector('#contextMenu:not([hidden])');
    await page.hover('#contextMenu button[data-plugin="tag-farben"]');
    await page.waitForSelector('.tf-panel[data-stand="geladen"]');
    await s.shot('farben-pt', { locator: '#contextMenu', pad: 260 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // ---------- Hilfe der Erweiterungen auf Italienisch ----------
    await sprache('it-CH');
    await page.click('#menuBtn');
    await page.click('#menuHelpBtn');
    await page.waitForSelector('#helpDialog[open]');
    await page.click('#helpTabs button[data-tab="plugins"]');
    await s.shot('hilfe-it', { locator: '#helpDialog', pad: 0 });
    await page.keyboard.press('Escape');
    await sprache('de');
  },
};
