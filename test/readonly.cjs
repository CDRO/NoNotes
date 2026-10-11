/* Test des Lesemodus (v1.5.1): Meldet die Hülle `readOnly`, sind alle Schreibwege gesperrt, das Backend lehnt schreibende Aufrufe ab
   (auch für Erweiterungen), Auf-/Zuklappen bleibt erlaubt, und ohne die Meldung ändert sich nichts am bisherigen Verhalten.
   Die Hülle wird im Test mit einem Skript vor dem Start umhüllt (Merkzeichen in localStorage), die Daten legt vorher dieselbe Seite an.
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
  NoNotesPlugins.register({ id: 'zugriff', name: 'Zugriff', api: 1, activate(ctx) { window.__ctx = ctx; } });`;

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-readonly-'));
  const dir = path.join(tmp, 'NoNotes');
  fs.cpSync(DIST, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'zugriff.js'), PLUGIN);
  fs.writeFileSync(path.join(dir, 'plugins', 'plugins.js'), "NoNotesPlugins.list(['zugriff.js']);\n");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  // Mit dem Merkzeichen meldet die Hülle readOnly (wie die Hülle eines Dienstes für die Rolle «nur lesen»)
  await page.addInitScript(() => {
    let edition;
    Object.defineProperty(window, 'NoNotesEdition', {
      configurable: true,
      get: () => edition,
      set: v => {
        edition = v;
        const make = v.createShell;
        v.createShell = host => {
          const shell = make(host);
          if (localStorage.getItem('__readonly') === '1') Object.defineProperty(shell, 'readOnly', { get: () => true });
          return shell;
        };
      },
    });
  });
  const url = 'file://' + path.join(dir, 'index.html');
  await page.goto(url);
  await page.waitForSelector(READY, { timeout: 30000 });

  // ---------- Daten anlegen (normaler Modus) ----------
  const ids = await page.evaluate(async () => {
    const B = __ctx.backend;
    const a = await B.createNote(null);
    await B.updateNote(a, 'Plan', '- [ ] Aufgabe eins\n? Wer macht das?\n\nText', {});
    const b = await B.createNote(a);
    await B.updateNote(b, 'Unterpunkt', 'Inhalt', {});
    await B.setTags(a, ['wichtig']);
    await __ctx.refresh();
    return { a, b };
  });
  assert.equal(await page.locator('body.readonly-mode').count(), 0, 'normal: kein Lesemodus');
  assert.equal(await page.locator('#mapNewBtn').isVisible(), true);
  step('Normaler Modus: Schreibwege sind da, kein Lesemodus');

  // ---------- Lesemodus ----------
  await page.waitForFunction(SAVED, null, { timeout: 10000 });
  await page.evaluate(() => localStorage.setItem('__readonly', '1'));
  await page.reload();
  await page.waitForSelector(READY, { timeout: 30000 });
  assert.equal(await page.locator('body.readonly-mode').count(), 1);
  for (const sel of ['#mapNewBtn', '#newBtn', '#importBtn', '#calendarBtn', '.menu-accent']) {
    if (sel === '#importBtn') await page.click('#menuBtn'); // die beiden Menüeinträge werden bei geöffnetem Menü geprüft (der Kalenderexport schreibt Kennungen in die Datenbank)
    assert.equal(await page.locator(sel).first().isVisible(), false, sel + ' ist ausgeblendet');
    if (sel === '#calendarBtn') await page.keyboard.press('Escape');
  }
  await page.waitForFunction(title => [...document.querySelectorAll('.mm-node > text')].some(x => x.textContent === title), 'Plan');
  step('Lesemodus: Knöpfe zum Anlegen und Importieren und die Wahl der Hauptfarbe sind ausgeblendet');

  // Notiz öffnen: alles gesperrt, aber lesbar
  await page.dblclick('.mm-node:has(> text:text-is("Plan"))');
  await page.waitForSelector('#editorPane:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#title').value === 'Plan');
  assert.equal(await page.locator('#title').evaluate(e => e.readOnly), true);
  assert.equal(await page.locator('#body').evaluate(e => e.readOnly), true);
  assert.equal(await page.locator('#tagInput').isVisible(), false);
  for (const sel of ['#childBtn', '#archiveBtn', '#deleteBtn']) assert.equal(await page.locator(sel).isVisible(), false, sel + ' ist ausgeblendet');
  assert.equal(await page.locator('#historyBtn').isVisible(), true, 'den Verlauf darf man ansehen');
  assert.equal(await page.locator('#body').inputValue(), '- [ ] Aufgabe eins\n? Wer macht das?\n\nText');
  const before = await page.evaluate(id => __ctx.backend.getNote(id).then(n => n.updated_at), ids.a);
  await page.focus('#body');
  await page.keyboard.type('Tippen ändert nichts');
  assert.equal(await page.locator('#body').inputValue(), '- [ ] Aufgabe eins\n? Wer macht das?\n\nText');
  step('Notiz: Titel, Text und Tags gesperrt, Schaltflächen zum Ändern ausgeblendet, Verlauf bleibt sichtbar');

  // Das Backend lehnt Schreibendes ab – auch für Erweiterungen
  const results = await page.evaluate(async ids => {
    const B = __ctx.backend;
    const out = {};
    for (const [name, args] of Object.entries({
      createNote: [null], updateNote: [ids.a, 'X', 'Y', {}], renameNote: [ids.a, 'X'], deleteNote: [ids.b], archiveNote: [ids.b],
      setTags: [ids.a, ['x']], setMeta: ['accent', 'rot'], setMapTitle: ['X'], moveNote: [ids.b, ids.a, 'before'], setTaskDone: [1, true],
    })) {
      try { await B[name](...args); out[name] = 'ok'; } catch (e) { out[name] = e.code; }
    }
    return out;
  }, ids);
  for (const [name, r] of Object.entries(results)) assert.equal(r, 'READ_ONLY', name + ' wird abgelehnt');
  const after = await page.evaluate(id => __ctx.backend.getNote(id), ids.a);
  assert.equal(after.title, 'Plan');
  assert.equal(after.updated_at, before, 'nichts wurde verändert');
  step('Backend: alle schreibenden Aufrufe werden mit READ_ONLY abgelehnt, die Daten bleiben unverändert');

  // Auf- und Zuklappen ist Ansicht und bleibt erlaubt
  const collapsed = await page.evaluate(async id => {
    await __ctx.backend.setCollapsed(id, true);
    const info = await __ctx.backend.getNote(id);
    await __ctx.backend.setAllCollapsed(false);
    return info.collapsed;
  }, ids.a);
  assert.ok(collapsed === 1 || collapsed === true, 'setCollapsed geht durch');
  step('Auf-/Zuklappen bleibt erlaubt (persönliche Ansicht)');

  // Rückweg zur Mindmap; Tab, Entf und Kontextmenü
  await page.click('#backBtn');
  await page.waitForSelector('body:not(.editor-open)');
  await page.click('.mm-node:has(> text:text-is("Plan"))');
  const count = () => page.evaluate(() => __ctx.backend.countNotes());
  const notes = await count();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => /Nur lesen/.test(document.querySelector('#status').textContent), null, { timeout: 5000 });
  assert.equal(await count(), notes, 'weder angelegt noch gelöscht');
  await page.click('.mm-node:has(> text:text-is("Plan"))', { button: 'right' });
  await page.waitForSelector('#contextMenu:not([hidden])');
  const items = await page.locator('#contextMenu button span:first-child').allInnerTexts();
  assert.ok(items.includes('Öffnen') && items.some(t => t.startsWith('Drucken')), 'Lesen bleibt im Menü: ' + items);
  for (const forbidden of ['Umbenennen', 'Unternotiz anlegen', 'Löschen', 'Nach oben']) assert.ok(!items.includes(forbidden), forbidden + ' fehlt im Menü: ' + items);
  await page.keyboard.press('Escape');
  step('Mindmap: Tab und Entf tun nichts und nennen den Grund, das Kontextmenü enthält nur Lesendes');

  // Fragen und Aufgaben
  await page.click('#viewQuestionsBtn');
  await page.waitForSelector('#qList .q-item');
  assert.equal(await page.locator('#qList .q-actions button:text-is("Beantworten")').first().isVisible(), false, 'kein Antwortknopf');
  await page.click('#viewTasksBtn');
  await page.waitForSelector('#tList .t-item');
  assert.equal(await page.locator('#tList .t-check').first().isDisabled(), true, 'Kästchen gesperrt');
  step('Fragen und Aufgaben: kein Antwortknopf, Kästchen gesperrt');

  // ---------- Zurück in den normalen Modus ----------
  await page.evaluate(() => localStorage.removeItem('__readonly'));
  await page.waitForFunction(SAVED, null, { timeout: 10000 }).catch(() => {});
  await page.reload();
  await page.waitForSelector(READY, { timeout: 30000 });
  assert.equal(await page.locator('body.readonly-mode').count(), 0);
  await page.click('#viewMapBtn');
  assert.equal(await page.locator('#mapNewBtn').isVisible(), true);
  await page.click('#viewListBtn');
  await page.click('#list .note-item >> nth=0');
  await page.waitForSelector('#editorPane:not([hidden])');
  assert.equal(await page.locator('#body').evaluate(e => e.readOnly), false);
  step('Ohne die Meldung der Hülle ist alles wie bisher');

  assert.deepEqual(errors.filter(e => !/Nur lesen|READ_ONLY/.test(e)), [], 'Fehler im Browser:\n' + errors.join('\n'));
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nLesemodus-Test bestanden.');
}

main().catch(e => { console.error(e); process.exit(1); });
