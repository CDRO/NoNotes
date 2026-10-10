/* Test der gleichzeitigen Änderung (v1.5.0): Speichern auf Basis des letzten Stands, automatisches Zusammenführen, Konfliktdialog
   (meine Fassung, neue Fassung, Markierungen, später entscheiden), Übernahme von Änderungen von aussen, Autor im Verlauf.
   Eine zweite Schreibende wird über die Erweiterungs-Schnittstelle nachgestellt: sie ändert die Notiz hinter dem Rücken des Editors.
   Ausführen: npm test (nach tools/build.cjs). */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'NoNotes');

function loadPlaywright() {
  try { return require('playwright'); }
  catch (e) {
    if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
    throw e;
  }
}
const { chromium } = loadPlaywright();

const READY = 'body[data-ready="true"]';
const SAVED = () => document.querySelector('#status').dataset.state === 'saved';
const step = name => console.log('  ✓ ' + name);

const PLUGIN = `
  NoNotesPlugins.register({ id: 'andere', name: 'Zweite Schreibende', api: 1, activate(ctx) { window.__ctx = ctx; } });`;

const LINES = Array.from({ length: 10 }, (_, i) => `Zeile ${i + 1}`);
const text = lines => lines.join('\n');
const withLine = (i, value) => LINES.map((l, k) => (k === i ? value : l));

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-conflict-'));
  const dir = path.join(tmp, 'NoNotes');
  fs.cpSync(DIST, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'andere.js'), PLUGIN);
  fs.writeFileSync(path.join(dir, 'plugins', 'plugins.js'), "NoNotesPlugins.list(['andere.js']);\n");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto('file://' + path.join(dir, 'index.html'));
  await page.waitForSelector(READY, { timeout: 30000 });

  // Statusmeldungen mitschreiben: Hinweise wie «zusammengeführt» werden von «Gespeichert …» bald überschrieben
  await page.evaluate(() => {
    window.__status = [];
    new MutationObserver(() => window.__status.push(document.querySelector('#status').textContent))
      .observe(document.querySelector('#status'), { childList: true, characterData: true, subtree: true });
  });
  const saw = re => page.waitForFunction(src => window.__status.some(x => new RegExp(src).test(x)), re.source, { timeout: 10000 });

  // Die andere Schreibende: ändert hinter dem Rücken des Editors
  const other = (id, body, author, title) => page.evaluate(async ({ id, body, author, title }) => {
    const note = await __ctx.backend.getNote(id);
    return __ctx.backend.updateNote(id, title == null ? note.title : title, body, author ? { author } : {});
  }, { id, body, author, title });
  const dbNote = id => page.evaluate(id => __ctx.backend.getNote(id), id);
  const newNote = async (title, body) => {
    const id = await page.evaluate(async ({ title, body }) => {
      const id = await __ctx.backend.createNote(null);
      await __ctx.backend.updateNote(id, title, body, {});
      await __ctx.refresh();
      await __ctx.openNote(id);
      return id;
    }, { title, body });
    await page.waitForSelector('#editorPane:not([hidden])');
    await page.waitForFunction(b => document.querySelector('#body').value === b, body);
    return id;
  };
  const close = async () => { await page.click('#backBtn'); await page.waitForSelector('body:not(.editor-open)'); };

  // ---------- 1. verschiedene Stellen: wird automatisch zusammengeführt ----------
  let id = await newNote('Plan', text(LINES));
  await other(id, text(withLine(8, 'Zeile 9 von der anderen')), null);
  await page.fill('#body', text(withLine(1, 'Zeile 2 von mir')));
  await saw(/zusammengeführt/);
  await page.waitForFunction(SAVED);
  const merged = text(LINES.map((l, k) => (k === 1 ? 'Zeile 2 von mir' : k === 8 ? 'Zeile 9 von der anderen' : l)));
  assert.equal(await page.inputValue('#body'), merged, 'der Editor zeigt beide Änderungen');
  assert.equal((await dbNote(id)).body, merged, 'beide Änderungen sind gespeichert');
  assert.equal(await page.locator('#conflictDialog[open]').count(), 0, 'kein Dialog, wenn es sich zusammenführen lässt');
  step('Verschiedene Stellen: automatisch zusammengeführt, im Editor und in der Datei');

  // ... und weiter schreiben funktioniert (der Stand ist nachgeführt, kein erneuter Konflikt)
  await page.fill('#body', merged + '\nZeile 11');
  await page.waitForFunction(SAVED);
  assert.equal((await dbNote(id)).body, merged + '\nZeile 11');
  step('Danach geht das Speichern normal weiter');

  // ---------- 2. dieselbe Stelle: Dialog ----------
  await close();
  id = await newNote('Streit', text(LINES));
  await other(id, text(withLine(4, 'Zeile 5 DEINE')), 'Anna');
  await page.fill('#body', text(withLine(4, 'Zeile 5 MEINE')));
  await page.waitForSelector('#conflictDialog[open]');
  const shown = await page.locator('#conflictText').innerText();
  assert.match(shown, /Zeile 5 MEINE/);
  assert.match(shown, /Zeile 5 DEINE/);
  assert.match(await page.locator('#conflictLead').innerText(), /Anna/, 'nennt, von wem die Änderung kam');
  assert.equal((await dbNote(id)).body, text(withLine(4, 'Zeile 5 DEINE')), 'bis zur Entscheidung wird nichts überschrieben');
  assert.equal(await page.inputValue('#body'), text(withLine(4, 'Zeile 5 MEINE')), 'mein Text bleibt im Editor');
  step('Dieselbe Stelle: Dialog zeigt beide Fassungen und den Namen, nichts wird überschrieben');

  // Meine Fassung behalten
  await page.click('#conflictMineBtn');
  await page.waitForFunction(SAVED);
  await page.waitForFunction(() => !document.querySelector('#conflictDialog').open);
  assert.equal((await dbNote(id)).body, text(withLine(4, 'Zeile 5 MEINE')));
  step('Entscheidung «Meine Fassung behalten»');

  // Neue Fassung übernehmen
  await other(id, text(withLine(4, 'Zeile 5 NEU von anderer')), null);
  await page.fill('#body', text(withLine(4, 'Zeile 5 noch einmal MEINE')));
  await page.waitForSelector('#conflictDialog[open]');
  await page.click('#conflictTheirsBtn');
  await page.waitForFunction(() => !document.querySelector('#conflictDialog').open);
  await page.waitForFunction(SAVED);
  assert.equal(await page.inputValue('#body'), text(withLine(4, 'Zeile 5 NEU von anderer')));
  assert.equal((await dbNote(id)).body, text(withLine(4, 'Zeile 5 NEU von anderer')));
  step('Entscheidung «Neue Fassung übernehmen»: meine strittige Änderung fällt weg');

  // Beide mit Markierungen; nicht strittige Änderungen bleiben erhalten
  await other(id, text(LINES.map((l, k) => (k === 4 ? 'Zeile 5 ANDERE' : k === 8 ? 'Zeile 9 ANDERE' : l))), null);
  await page.fill('#body', text(LINES.map((l, k) => (k === 4 ? 'Zeile 5 MEINE' : k === 1 ? 'Zeile 2 MEINE' : l))));
  await page.waitForSelector('#conflictDialog[open]');
  await page.click('#conflictMarkersBtn');
  await page.waitForFunction(() => !document.querySelector('#conflictDialog').open);
  await page.waitForFunction(SAVED);
  const marked = (await dbNote(id)).body;
  assert.match(marked, /<<<<<<< Meine Fassung\nZeile 5 MEINE\n=======\nZeile 5 ANDERE\n>>>>>>> Neue Fassung/);
  assert.match(marked, /Zeile 2 MEINE/);
  assert.match(marked, /Zeile 9 ANDERE/);
  step('Entscheidung «Beide mit Markierungen»: Markierungen an der strittigen Stelle, alles andere zusammengeführt');

  // ---------- 3. später entscheiden ----------
  await other(id, text(withLine(0, 'Zeile 1 ANDERE')), null);
  await page.fill('#body', text(withLine(0, 'Zeile 1 MEINE')));
  await page.waitForSelector('#conflictDialog[open]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#conflictDialog').open);
  await page.waitForSelector('#banner:not([hidden])');
  assert.match(await page.locator('#banner').innerText(), /Gespeichert wird erst nach deiner Entscheidung/);
  await page.click('#backBtn');
  await page.waitForSelector('#conflictDialog[open]'); // Wechseln geht nicht, ohne zu entscheiden
  assert.equal(await page.locator('body.editor-open').count(), 1, 'der Editor bleibt offen');
  await page.click('#conflictTheirsBtn');
  await page.waitForFunction(() => !document.querySelector('#conflictDialog').open);
  await page.waitForFunction(SAVED);
  step('Später entscheiden: Hinweisleiste, Wechseln der Notiz führt zurück zur Entscheidung');
  await close();

  // ---------- 4. Änderung von aussen ohne eigene Eingabe ----------
  id = await newNote('Ruhig', 'Anfang');
  await page.click('#body'); // Fokus im Feld: früher wurde das nie überschrieben
  await other(id, 'Anfang\nvon der anderen', 'Ben');
  await page.evaluate(() => __ctx.refresh());
  await page.waitForFunction(() => document.querySelector('#body').value === 'Anfang\nvon der anderen');
  assert.match(await page.locator('#noteMeta').innerText(), /von Ben/);
  step('Ohne eigene Eingabe: die Änderung der anderen erscheint im Editor, auch mit Fokus; die Notiz nennt den Autor');

  // ---------- 5. Autor im Verlauf ----------
  await page.fill('#body', 'Anfang\nvon der anderen\nund von mir');
  await page.waitForFunction(SAVED);
  await page.click('#historyBtn');
  await page.waitForSelector('#historyDialog[open]');
  await page.waitForFunction(() => document.querySelectorAll('#historyList button').length >= 1);
  assert.match(await page.locator('#historyList').innerText(), /von Ben/);
  await page.keyboard.press('Escape');
  step('Verlauf: die Fassung der anderen trägt ihren Namen');

  // ---------- 6. Tippen: viele Eingaben, ein Ergebnis ----------
  await close();
  id = await newNote('Tippen', '');
  await page.click('#body');
  await page.keyboard.type('Eine längere Zeile, die schnell getippt wird.', { delay: 0 });
  await page.waitForFunction(SAVED);
  await page.waitForFunction(async id => (await __ctx.backend.getNote(id)).body === 'Eine längere Zeile, die schnell getippt wird.', id);
  step('Schnelles Tippen: am Ende steht der ganze Text in der Datei');

  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  assert.deepEqual(dialogs, [], 'keine unerwarteten Rückfragen: ' + dialogs.join(' | '));
  step('Keine Browserfehler');
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nKonflikt-Test bestanden.');
}

main().catch(e => {
  console.error('\nKonflikt-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
