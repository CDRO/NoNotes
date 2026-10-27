// Drehbuch der Screenshots für v3.0.0 (node tools/release-shots.cjs v3.0.0 --plugins ../nonotes-plugins)

// Ein Bereich, wie ihn NoNotes 2.12 gespeichert hätte (Schema 16, Termine mit «@»): daran zeigt sich die Umstellung beim ersten Öffnen.
const ALT = {
  'Projekt Süd': [
    '## Offene Punkte',
    '',
    '- [ ] Offerte für die Heizung einholen @anna @30.10.2026 @6.11.2026',
    '- [ ] Baugesuch einreichen @ben @13.11.2026',
    '- [ ] Termin mit der Bauleitung @anna @28.10.2026 14:00',
    '? Reicht das Budget für die Fenster? @cem @3.11.2026 @10.11.2026',
  ].join('\n'),
  Budget: '- [ ] Budget 2027 freigeben @cem @20.11.2026',
  Lieferanten: '',
  Team: '',
  Termine: '',
  Ablage: '',
};
const KINDER = { 'Projekt Süd': ['Heizung', 'Fenster', 'Dach', 'Elektro', 'Garten'], Lieferanten: ['Heizung AG', 'Fenster GmbH'], Team: ['Anna', 'Ben', 'Cem'] };

module.exports = {
  date: '2026-10-27T09:00:00+01:00',
  plugins: ['tag-colors/tag-colors.js'],
  async run(s) {
    const { page } = s;

    // ---------- Umstellung beim ersten Öffnen ----------
    await page.evaluate(async ({ alt, kinder }) => {
      const SQL = await window.initSqlJs();
      const DB = window.NoNotesDB;
      const d = DB.open(SQL, null);
      for (const [title, body] of Object.entries(alt)) {
        const id = DB.createNote(d, null);
        d.run('UPDATE notes SET title = ?, body = ? WHERE id = ?', [title, body, id]);
        for (const k of kinder[title] || []) { const c = DB.createNote(d, id); d.run('UPDATE notes SET title = ? WHERE id = ?', [k, c]); }
      }
      d.exec("ALTER TABLE tasks DROP COLUMN reminders; ALTER TABLE questions DROP COLUMN reminders; ALTER TABLE notes DROP COLUMN side; UPDATE meta SET value = '16' WHERE key = 'schema_version'");
      await window.NoNotesStorage.browserStore.saveDb(d.export());
    }, { alt: ALT, kinder: KINDER });
    await page.reload();
    await page.waitForSelector('#migrateDialog[open]');
    await s.shot('umstellung', { locator: '#migrateDialog', pad: 8 });
    await page.locator('#migrateDialog button[value="skip"]').click();
    await page.waitForSelector('body[data-ready="true"]');
    await s.saved();

    // ---------- Datumsauswahl ----------
    await s.node('Projekt Süd').dblclick();
    await page.waitForSelector('body.editor-open');
    await page.click('[data-mode="edit"]');
    await page.evaluate(() => {
      const b = document.querySelector('#body');
      const at = b.value.indexOf('@ben >13.11.2026') + '@ben >13.11.2026'.length;
      b.focus();
      b.setSelectionRange(at, at);
    });
    await page.keyboard.type(' >');
    await page.waitForSelector('.dp:not([hidden])');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await s.shot('datumsauswahl');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await s.saved();

    // ---------- Frist und Erinnerungen ----------
    await s.mode('split');
    await s.shot('frist-erinnerungen');
    await s.back();
    await s.view('tasks');
    await s.shot('aufgabenliste', { locator: '#tasksView', pad: 8 });
    await s.view('map');

    // ---------- Mindmap: Seiten der Hauptäste, Kopieren als Bild ----------
    await page.click('#mapFitBtn');
    await s.node('Budget').click({ button: 'right' });
    await page.waitForSelector('#contextMenu:not([hidden])');
    await s.shot('mindmap-seiten');
    await page.keyboard.press('Escape');
    await page.locator('g.mm-node.mm-root').click({ button: 'right' });
    await page.waitForSelector('#contextMenu:not([hidden])');
    await s.shot('mindmap-kopieren');
    await page.keyboard.press('Escape');

    // ---------- Legende: fehlende Farben ergänzen ----------
    await s.edit('Projekt Süd', { tags: ['farbe:blau'] });
    await s.back();
    await s.edit('Budget', { tags: ['farbe:rot'] });
    await s.back();
    await page.click('.map-plugin-btn[data-plugin="tag-farben"]');
    await page.waitForSelector('.tf-legende .tf-lg-text:not([hidden])');
    await page.keyboard.press('Escape');
    await s.saved();
    await s.edit('Termine', { tags: ['farbe:grün'] });
    await s.back();
    await page.waitForSelector('.tf-legende .tf-lg-plus:not([hidden])');
    await s.shot('legende-ergaenzen', { locator: '.tf-legende', pad: 12 });
    await page.click('.tf-legende .tf-lg-plus');
    await page.waitForSelector('.tf-legende .tf-lg-text:not([hidden])');
    await page.keyboard.type('Termine fix');
    await s.shot('legende-ergaenzt', { locator: '.tf-legende', pad: 12 });
    await page.keyboard.press('Escape');
    await s.saved();
  },
};
