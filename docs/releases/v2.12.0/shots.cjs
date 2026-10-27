// Drehbuch der Screenshots für v2.12.0 (node tools/release-shots.cjs v2.12.0 --plugins ../NoNotes-plugins)
const fs = require('fs');
const path = require('path');

const AUFGABE = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'templates', 'Aufgabe.md'));

const PFADE = [
  '## Ablage',
  '',
  '- Offerte: \\\\fileserver\\projekte\\Süd\\Offerte-2026.pdf',
  '- Pläne: <\\\\fileserver\\projekte\\Süd\\Pläne Stand Oktober\\>',
  '- Mit eigenem Text: [Projektordner](<\\\\fileserver\\projekte\\Süd\\>)',
  '- Auf dem Laufwerk: C:\\Users\\Public\\Documents\\Sitzung.docx',
  '- Als Adresse: file:///C:/Users/Public/Documents/',
].join('\n');

module.exports = {
  date: '2026-10-27T09:00:00+01:00',
  plugins: [],
  async run(s) {
    const { page } = s;
    const bodyFocused = () => page.waitForFunction(() => document.activeElement === document.querySelector('#body'));
    const fromTemplate = async (parent, name) => {
      await s.node(parent).click();
      await page.click('#mapTemplateBtn');
      await page.waitForSelector('#templatePickDialog[open]');
      await page.locator('.template-item', { hasText: name }).click();
      await page.click('#templatePickGoBtn');
      await page.waitForSelector('body.editor-open');
      await page.waitForFunction(() => document.activeElement === document.querySelector('#title'));
    };

    // Pfade: Quelltext und Vorschau nebeneinander, dann das Kontextmenü in der Vorschau
    await s.newNote('Projekt Süd');
    await s.edit('Projekt Süd', { body: PFADE, mode: 'split' });
    await s.shot('pfade');
    await s.mode('preview');
    await page.locator('#preview a.md-path').last().click({ button: 'right', position: { x: 120, y: 8 } }); // darunter ist Platz
    await page.waitForSelector('#contextMenu:not([hidden])');
    await s.shot('pfade-kontextmenue');
    await page.keyboard.press('Escape');
    await s.back();

    // Vorlage «Aufgabe» hinzufügen (wie *Datei hinzufügen…*)
    await page.click('#menuBtn');
    await page.click('#templatesBtn');
    await page.waitForSelector('#templatesDialog[open]');
    await page.setInputFiles('#templateInput', { name: 'Aufgabe.md', mimeType: 'text/markdown', buffer: AUFGABE });
    await page.locator('.template-row', { hasText: 'Aufgabe' }).waitFor();
    await page.locator('#templatesDialog button[value="close"]').click();

    // Neue Notiz aus «Aufgabe»: zuerst der Titel, dann Tab durch den Text, die Beschreibung im Kasten
    await fromTemplate('Projekt Süd', 'Aufgabe');
    await page.waitForSelector('#phHint:not([hidden])');
    await s.shot('platzhalter-titel');
    await page.keyboard.type('Offerte für die Heizung einholen');
    await page.keyboard.press('Tab');
    await bodyFocused();
    await page.waitForSelector('#phHint:not([hidden])');
    await s.shot('platzhalter-text');
    await page.keyboard.type('anna');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); // Vorschlag «in einer Woche» bleibt
    await page.keyboard.type('Drei vergleichbare Offerten liegen vor');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.querySelector('#phHint').hidden);
    await s.saved();
    await s.back();

    // Einstellung «Platzhalter behalten» mit der Hilfe im Dialog
    await page.click('#menuBtn');
    await page.click('#templatesBtn');
    await page.waitForSelector('#templatesDialog[open]');
    await page.check('#phKeep');
    await page.click('#phHelp summary');
    await s.shot('platzhalter-einstellung', { locator: '#templatesDialog', pad: 8 });
    await page.locator('#templatesDialog button[value="close"]').click();

    // Mit «behalten»: Werte bleiben Platzhalter, «Ziel» übersprungen
    await fromTemplate('Projekt Süd', 'Aufgabe');
    await page.keyboard.type('Bauplan mit dem Architekten besprechen');
    await page.keyboard.press('Tab');
    await bodyFocused();
    await page.keyboard.type('beat');
    await page.keyboard.press('Tab');
    await page.keyboard.type('6.11.2026');
    await page.keyboard.press('Escape');
    await s.saved();
    await s.mode('preview');
    await s.shot('platzhalter-vorschau');
    const kept = page.locator('#preview .md-ph:not(.open)').first();
    const keptBox = await kept.boundingBox();
    await kept.click({ button: 'right', position: { x: 40, y: keptBox.height - 1 } }); // das Menü unter der Zeile
    await page.waitForSelector('#contextMenu:not([hidden])');
    await s.shot('platzhalter-aufloesen');
    await page.keyboard.press('Escape');
    await page.locator('#preview .md-ph[data-ph="Beschreibung"]').first().click();
    await page.waitForSelector('#phHint:not([hidden])');
    await s.shot('platzhalter-anklicken');
  },
};
