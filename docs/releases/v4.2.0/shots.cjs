// Drehbuch der Screenshots für v4.2.0 (node tools/release-shots.cjs v4.2.0)
// Eine Sitzungsnotiz mit drei Traktanden: zwei davon werden mit der Schaltfläche am Ende der Auswahl in Unternotizen ausgelagert,
// dann ein Satz ohne Überschrift (Titel aus dem ersten Satz, beim ersten Öffnen markiert).

const BODY = [
  'Traktanden der Sitzung vom 5. November.',
  '',
  '## Budget 2027',
  'Der Entwurf liegt vor, die Zahlen der Abteilungen fehlen noch.',
  '- [ ] Zahlen einholen @anna >13.11.2026',
  '### Investitionen',
  'Neue Server und zwei Fahrzeuge.',
  '',
  '## Personal',
  '? Besetzen wir die zweite Stelle intern?',
  '- [ ] Ausschreibung vorbereiten @ben',
  '',
  '## Varia',
  'Die nächste Sitzung findet im Dezember statt. Ort folgt.',
].join('\n');

module.exports = {
  date: '2026-11-05T09:00:00+01:00',
  async run(s) {
    const { page } = s;
    const select = (from, to) => page.evaluate(([a, b]) => {
      const ta = document.querySelector('#body');
      const v = ta.value;
      ta.focus();
      ta.setSelectionRange(v.indexOf(a), b == null ? v.length : v.indexOf(b));
      ta.dispatchEvent(new Event('select'));
    }, [from, to]);
    await s.newNote('Sitzung Vorstand');
    await s.edit('Sitzung Vorstand', { body: BODY });

    // ---------- Schaltfläche am Ende der Auswahl ----------
    await select('## Budget 2027', '\n\n## Varia');
    await page.waitForSelector('#extractBtn:not([hidden])');
    await s.shot('auswahl', { locator: '#editorBody', pad: 8 });

    // ---------- Dialog ----------
    await page.click('#extractBtn');
    await page.waitForSelector('#extractDialog[open]');
    await s.shot('dialog', { locator: '#extractDialog', pad: 12 });
    await page.click('#extractOkBtn');
    await page.waitForFunction(() => /- \[\[Personal#\d+\]\]/.test(document.querySelector('#body').value));
    await s.saved();
    await s.mode('preview');
    await s.shot('ergebnis');

    // ---------- Ohne Überschrift: der erste Satz ----------
    await s.mode('edit');
    await page.click('#banner button:text("Schliessen")');
    await select('Die nächste Sitzung');
    await page.waitForSelector('#extractBtn:not([hidden])');
    await page.click('#extractBtn');
    await page.waitForFunction(() => /\[\[Die nächste Sitzung findet im Dezember statt#\d+\]\]/.test(document.querySelector('#body').value));
    await s.saved();
    await page.click('#banner button:text("Schliessen")');
    await s.mode('preview');
    await page.click('#preview a:text("Die nächste Sitzung findet im Dezember statt")');
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'title');
    await s.shot('titel', { locator: '#title', pad: 12 });
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('#title').value === 'Sitzung Vorstand');
    await s.back();
    await page.click('#mapFitBtn');
    await page.waitForTimeout(400);
    await s.shot('mindmap');
  },
};
