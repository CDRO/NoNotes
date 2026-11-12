// Drehbuch der Screenshots für v4.4.0 (node tools/release-shots.cjs v4.4.0)
// Die rote Leiste beim Halt (Papierkorb mit allen Notizen geleert), der Dialog «Sicherungen» und der Stoppschirm für Daten einer
// neueren NoNotes-Version (die Browser-Kopie bekommt dafür im Dateikopf Schema 25).

module.exports = {
  date: '2026-11-12T09:00:00+01:00',
  async run(s) {
    const { page, node } = s;
    page.on('dialog', d => d.accept()); // «In den Papierkorb?» und «Papierkorb leeren?»
    for (const t of ['Sitzung Vorstand', 'Budget 2027', 'Ferienplan', 'Offerten']) await s.newNote(t);
    await s.saved();
    // neu öffnen: die erste Sicherung danach hält diese vier Notizen fest
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]');
    await s.newNote('Personal', 'Sitzung Vorstand');
    await s.saved();

    // ---------- Halt bei Massenverlust ----------
    for (const t of ['Personal', 'Sitzung Vorstand', 'Budget 2027', 'Ferienplan', 'Offerten']) {
      await node(t).click();
      await page.keyboard.press('Delete');
      await node(t).waitFor({ state: 'detached' });
    }
    await s.saved();
    await s.view('list');
    await page.selectOption('#listScope', 'trash');
    await page.click('#emptyTrashBtn');
    await page.waitForSelector('#banner.banner-danger:not([hidden])');
    await s.shot('halt');
    await page.click('#banner button:text("Gespeicherten Stand laden")');
    await page.waitForSelector('#banner', { state: 'hidden' });
    await page.selectOption('#listScope', 'live');

    // ---------- Sicherungen ----------
    await page.click('#menuBtn');
    await page.click('#backupsBtn');
    await page.waitForSelector('#backupsDialog[open]');
    await s.shot('sicherungen', { locator: '#backupsDialog', pad: 8 });
    await page.keyboard.press('Escape');

    // ---------- Stoppschirm: Daten einer neueren Version ----------
    await page.evaluate(async () => {
      const SQL = await initSqlJs();
      const d = new SQL.Database(await NoNotesStorage.browserStore.loadDb());
      d.run('PRAGMA user_version = 25');
      await NoNotesStorage.browserStore.saveDb(d.export());
      d.close();
    });
    await page.reload();
    await page.waitForSelector('#stopScreen:not([hidden])');
    await s.shot('stopp');
  },
};
