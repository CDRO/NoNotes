/* Smoke-Test: öffnet die App wie der Benutzer per file:// in Chromium und prüft den Kernablauf.
   Ausführen: npm test (Playwright + Chromium müssen installiert sein). */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const APP_URL = 'file://' + path.join(ROOT, 'index.html');

function loadPlaywright() {
  try { return require('playwright'); }
  catch (e) {
    const alt = process.env.PLAYWRIGHT_MODULE;
    if (alt) return require(alt);
    throw e;
  }
}

const { chromium } = loadPlaywright();
const initSqlJs = require(path.join(ROOT, 'vendor/sql.js/sql-asm.js'));

const READY = 'body[data-ready="true"]';
const SCHEMA_VERSION = '7'; // muss zu js/db.js passen
const SAVED = () => document.querySelector('#status').dataset.state === 'saved';

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return errors;
}

async function openApp(ctx, view) {
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await page.waitForSelector(READY, { timeout: 30000 });
  if (view === 'list') {
    await page.click('#viewListBtn');
    await page.waitForSelector('body.view-list');
  }
  return { page, errors };
}

const idOfNode = (page, title) => page.evaluate(t => {
  const g = [...document.querySelectorAll('.mm-node')].find(n => n.querySelector('text').textContent === t);
  return g ? g.dataset.id : null;
}, title);

const nodeBox = async (page, id) => page.locator(`.mm-node[data-id="${id}"] rect`).boundingBox();

async function dragNode(page, fromId, toId, where) {
  const a = await nodeBox(page, fromId);
  const b = await nodeBox(page, toId);
  const rel = where === 'before' ? 0.1 : where === 'after' ? 0.9 : 0.5;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 20, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * rel, { steps: 12 });
  await page.mouse.up();
}

async function newRootNote(page, title) {
  await page.click('#mindmap', { position: { x: 30, y: 700 } });
  await page.keyboard.press('Tab');
  await page.waitForSelector('#renameInput:not([hidden])');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.waitForFunction(t => [...document.querySelectorAll('.mm-node text')].some(x => x.textContent === t), title);
  return idOfNode(page, title);
}


/** Liest ein ZIP (Methode Store) und liefert { pfad: Buffer }. */
function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054B50) eocd--;
  assert.ok(eocd >= 0, 'ZIP-Endsignatur gefunden');
  const count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(cd), 0x02014B50, 'Zentralverzeichnis');
    const nameLen = buf.readUInt16LE(cd + 28), extraLen = buf.readUInt16LE(cd + 30), commentLen = buf.readUInt16LE(cd + 32);
    const size = buf.readUInt32LE(cd + 24);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.subarray(cd + 46, cd + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOff + 26), lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    files[name] = buf.subarray(dataStart, dataStart + size);
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function waitSaved(page) {
  await page.waitForFunction(SAVED, null, { timeout: 10000 });
}

async function main() {
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-smoke-'));
  const step = name => console.log('  ✓ ' + name);

  try {
    // ---------- 1. Anlegen, Suchen, Speichern, Neuladen, Herunterladen, Löschen ----------
    const ctx = await browser.newContext({ acceptDownloads: true, locale: 'de-CH' });
    const { page, errors } = await openApp(ctx, 'list');
    assert.equal(await page.locator('#list li').count(), 0, 'frischer Kontext ist leer');
    assert.match(await page.locator('#version').innerText(), /\S/, 'Version wird angezeigt');
    step('App startet per file:// und ist leer');

    await page.click('#newBtn');
    await page.fill('#title', 'Erste Notiz');
    await page.fill('#body', 'Hallo Welt. Grüezi mitenand.');
    await waitSaved(page);
    assert.equal(await page.locator('#list li').count(), 1);
    assert.match(await page.locator('#list li .note-title').first().innerText(), /Erste Notiz/);
    assert.match(await page.locator('#count').innerText(), /^1 Notiz$/);
    step('Notiz anlegen und bearbeiten');

    await page.click('#newBtn');
    await page.fill('#title', 'Zweite');
    await page.fill('#body', 'Übersicht der Dinge');
    await waitSaved(page);
    assert.equal(await page.locator('#list li').count(), 2);
    assert.match(await page.locator('#list li .note-title').first().innerText(), /Zweite/, 'zuletzt geändert steht oben');

    await page.fill('#search', 'übersicht');
    await page.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    await page.fill('#search', 'ÜBERSICHT');
    await page.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    await page.fill('#search', 'gibtsnicht');
    await page.waitForFunction(() => document.querySelectorAll('#list li').length === 0);
    assert.equal(await page.locator('#listEmpty').isVisible(), true);
    await page.fill('#search', '');
    await page.waitForFunction(() => document.querySelectorAll('#list li').length === 2);
    step('Suche (auch Umlaute, gross/klein)');

    await page.reload();
    await page.waitForSelector(READY);
    assert.equal(await page.locator('#list li').count(), 2, 'Notizen überleben das Neuladen');
    assert.match(await page.locator('#status').innerText(), /Browser-Speicher/);
    step('Persistenz im Browser-Speicher über Neuladen');

    await page.click('#menuBtn');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#downloadBtn'),
    ]);
    const dlPath = path.join(tmp, 'kopie.sqlite');
    await download.saveAs(dlPath);
    assert.match(download.suggestedFilename(), /^NoNotes-\d{4}-\d{2}-\d{2}\.sqlite$/);
    const bytes = fs.readFileSync(dlPath);
    assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3', 'Download ist eine echte SQLite-Datei');
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(bytes));
    assert.equal(db.exec('SELECT count(*) FROM notes')[0].values[0][0], 2);
    assert.deepEqual(db.exec('SELECT title FROM notes ORDER BY title')[0].values.map(r => r[0]), ['Erste Notiz', 'Zweite']);
    assert.equal(db.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    db.close();
    step('Kopie herunterladen ergibt gültige SQLite-Datei mit beiden Notizen');

    page.once('dialog', d => d.accept());
    await page.click('#list li:first-child');
    await page.click('#deleteBtn');
    await page.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    await waitSaved(page);
    assert.match(await page.locator('#list li .note-title').first().innerText(), /Erste Notiz/);
    step('Löschen mit Bestätigung');

    assert.deepEqual(errors, [], 'keine Konsolenfehler');
    await ctx.close();

    // ---------- 2. Import in einen frischen Kontext ----------
    const ctx2 = await browser.newContext({ locale: 'de-CH' });
    const { page: page2, errors: errors2 } = await openApp(ctx2, 'list');
    assert.equal(await page2.locator('#list li').count(), 0);
    await page2.setInputFiles('#importInput', dlPath);
    await page2.waitForFunction(() => document.querySelectorAll('#list li').length === 2);
    await waitSaved(page2);
    assert.match(await page2.locator('#status').innerText(), /importiert/);
    assert.deepEqual(errors2, []);
    await ctx2.close();
    step('Import einer .sqlite-Datei');

    // ---------- 3. Fremde SQLite-Datei wird abgelehnt ----------
    const foreign = new SQL.Database();
    foreign.run('CREATE TABLE kunden (id INTEGER)');
    const foreignPath = path.join(tmp, 'fremd.sqlite');
    fs.writeFileSync(foreignPath, Buffer.from(foreign.export()));
    foreign.close();
    const ctx3 = await browser.newContext({ locale: 'de-CH' });
    const { page: page3 } = await openApp(ctx3);
    await page3.setInputFiles('#importInput', foreignPath);
    await page3.waitForFunction(() => document.querySelector('#status').dataset.state === 'error');
    assert.match(await page3.locator('#status').innerText(), /nicht von NoNotes/);
    await ctx3.close();
    step('Fremde SQLite-Datei wird abgelehnt');

    // ---------- 4. Datei-Anbindung (File System Access API, hier nachgebildet) ----------
    const ctx4 = await browser.newContext({ locale: 'de-CH' });
    await ctx4.addInitScript(() => {
      window.__writes = [];
      const handle = {
        kind: 'file',
        name: 'Test.sqlite',
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        getFile: async () => new File([window.__writes.at(-1) || new Uint8Array()], 'Test.sqlite'),
        createWritable: async () => {
          const chunks = [];
          return {
            write: async d => { chunks.push(new Uint8Array(d)); },
            close: async () => {
              const total = chunks.reduce((n, c) => n + c.length, 0);
              const out = new Uint8Array(total);
              let o = 0;
              for (const c of chunks) { out.set(c, o); o += c.length; }
              window.__writes.push(out);
            },
            abort: async () => {},
          };
        },
      };
      window.showSaveFilePicker = async () => handle;
      window.showOpenFilePicker = async () => [handle];
    });
    const { page: page4, errors: errors4 } = await openApp(ctx4, 'list');
    assert.equal(await page4.locator('#createFileBtn').isHidden(), true, 'Menü ist zu');
    await page4.click('#menuBtn');
    await page4.click('#createFileBtn');
    // Nicht auf den Status warten (der stand seit dem Start auf "gespeichert"), sondern auf die Folgen.
    await page4.waitForFunction(() => /Test\.sqlite/.test(document.querySelector('#storageInfo .label').textContent));
    await page4.waitForFunction(() => window.__writes.length >= 1);
    await waitSaved(page4);
    const writes1 = await page4.evaluate(() => window.__writes.length);
    assert.ok(writes1 >= 1, 'Datei wurde beim Anlegen geschrieben');
    const magic = await page4.evaluate(() => String.fromCharCode(...window.__writes.at(-1).subarray(0, 15)));
    assert.equal(magic, 'SQLite format 3');

    await page4.click('#newBtn');
    await page4.fill('#title', 'In Datei');
    await page4.waitForFunction(n => window.__writes.length > n, writes1);
    await waitSaved(page4);
    const writes2 = await page4.evaluate(() => window.__writes.length);
    assert.ok(writes2 > writes1, 'jede Änderung landet in der Datei');
    const inFile = await page4.evaluate(() => Array.from(window.__writes.at(-1)));
    const db4 = new SQL.Database(new Uint8Array(inFile));
    assert.deepEqual(db4.exec('SELECT title FROM notes')[0].values.map(r => r[0]), ['In Datei']);
    db4.close();
    assert.deepEqual(errors4, []);
    await ctx4.close();
    step('Direktes Schreiben in die Datenbankdatei');

    // ---------- 5. Mindmap: Baum, Umbenennen, Vollbild-Editor, Ein-/Ausklappen, Umhängen, Löschen ----------
    const ctx5 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    const { page: page5, errors: errors5 } = await openApp(ctx5);
    assert.equal(await page5.locator('body.view-map').count(), 1, 'Mindmap ist die Startansicht');
    assert.equal(await page5.locator('.mm-node.mm-root text').textContent(), 'Meine Notizen');

    // Tab auf der fokussierten Map legt eine Notiz an und öffnet das Umbenennen
    await page5.click('#mindmap', { position: { x: 30, y: 700 } });
    await page5.keyboard.press('Tab');
    await page5.waitForSelector('#renameInput:not([hidden])');
    await page5.keyboard.type('Projekt');
    await page5.keyboard.press('Enter');
    await page5.waitForFunction(() => [...document.querySelectorAll('.mm-node:not(.mm-root) text')].some(t => t.textContent === 'Projekt'));
    const projektId = await idOfNode(page5, 'Projekt');

    // Zwei Unternotizen unter "Projekt"
    for (const title of ['Budget', 'Termine']) {
      await page5.click(`.mm-node[data-id="${projektId}"]`);
      await page5.keyboard.press('Tab');
      await page5.waitForSelector('#renameInput:not([hidden])');
      await page5.keyboard.type(title);
      await page5.keyboard.press('Enter');
      await page5.waitForFunction(t => [...document.querySelectorAll('.mm-node text')].some(x => x.textContent === t), title);
    }
    const budgetId = await idOfNode(page5, 'Budget');
    const termineId = await idOfNode(page5, 'Termine');
    const pBox = await nodeBox(page5, projektId);
    const bBox = await nodeBox(page5, budgetId);
    assert.ok(bBox.x > pBox.x + pBox.width, 'Unternotiz liegt rechts vom Elternknoten');
    assert.equal(await page5.locator('.mm-edge').count(), 3, 'drei Verbindungslinien');
    step('Mindmap: Notizen per Tastatur anlegen und benennen');

    // Doppelklick öffnet den Vollbild-Editor
    await page5.dblclick(`.mm-node[data-id="${budgetId}"]`);
    await page5.waitForSelector('body.editor-open');
    assert.equal(await page5.inputValue('#title'), 'Budget');
    assert.match(await page5.locator('#crumbs').innerText(), /Meine Notizen.*Projekt/s);
    await page5.fill('#body', 'Kosten rund 20k');
    await waitSaved(page5);
    await page5.keyboard.press('Escape');
    await page5.waitForSelector('body:not(.editor-open)');
    step('Mindmap: Doppelklick öffnet Vollbild-Editor, Esc schliesst');

    // Einklappen über das Kontextmenü, Ausklappen über den Knopf am Knoten
    await page5.click(`.mm-node[data-id="${projektId}"]`, { button: 'right' });
    await page5.waitForSelector('#contextMenu:not([hidden])');
    await page5.click('#contextMenu button:has-text("Einklappen")');
    await page5.waitForFunction(id => !document.querySelector(`.mm-node[data-id="${id}"]`), budgetId);
    assert.equal(await page5.locator(`.mm-node[data-id="${projektId}"] .mm-toggle text`).textContent(), '2');
    await page5.click(`.mm-node[data-id="${projektId}"] .mm-toggle`);
    await page5.waitForSelector(`.mm-node[data-id="${budgetId}"]`);
    step('Mindmap: Ein- und Ausklappen');

    // "Termine" auf die Wurzel ziehen
    await dragNode(page5, termineId, 'root');
    await page5.waitForFunction(() => document.querySelectorAll('.mm-edge').length === 3);
    const tBox = await nodeBox(page5, termineId);
    const rBox = await nodeBox(page5, 'root');
    assert.ok(tBox.x + tBox.width < rBox.x || tBox.x > rBox.x + rBox.width, 'Termine hängt jetzt direkt an der Wurzel');
    step('Mindmap: Umhängen per Drag & Drop');

    // Wurzel umbenennen
    await page5.dblclick('.mm-node.mm-root');
    await page5.waitForSelector('#renameInput:not([hidden])');
    await page5.fill('#renameInput', 'Mein Projekt');
    await page5.keyboard.press('Enter');
    await page5.waitForFunction(() => document.querySelector('.mm-node.mm-root text').textContent === 'Mein Projekt');
    step('Mindmap: Titel der Map ändern');

    // Datenbankkopie prüfen: Elternbeziehungen und Titel
    await page5.click('#menuBtn');
    const [dl5] = await Promise.all([page5.waitForEvent('download'), page5.click('#downloadBtn')]);
    const dl5Path = path.join(tmp, 'map.sqlite');
    await dl5.saveAs(dl5Path);
    const db5 = new SQL.Database(new Uint8Array(fs.readFileSync(dl5Path)));
    const rows5 = db5.exec('SELECT title, parent_id FROM notes ORDER BY title')[0].values;
    const parents = Object.fromEntries(rows5.map(r => [r[0], r[1]]));
    assert.equal(parents['Projekt'], null);
    assert.equal(parents['Budget'], Number(projektId));
    assert.equal(parents['Termine'], null);
    assert.equal(db5.exec("SELECT value FROM meta WHERE key='map_title'")[0].values[0][0], 'Mein Projekt');
    assert.equal(db5.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    db5.close();
    step('Mindmap: Baum und Titel landen in der SQLite-Datei');

    // Löschen: Unternotiz rückt auf
    page5.once('dialog', d => d.accept());
    await page5.click(`.mm-node[data-id="${projektId}"]`, { button: 'right' });
    await page5.click('#contextMenu button:has-text("Löschen")');
    await page5.waitForFunction(id => !document.querySelector(`.mm-node[data-id="${id}"]`), projektId);
    assert.ok(await page5.locator(`.mm-node[data-id="${budgetId}"]`).count() === 1, 'Budget bleibt erhalten');
    assert.equal(await page5.locator('.mm-node:not(.mm-root)').count(), 2);
    await page5.click('#viewListBtn');
    await page5.waitForFunction(() => document.querySelectorAll('#list li').length === 2);
    assert.deepEqual(errors5, [], 'keine Konsolenfehler in der Mindmap');
    await ctx5.close();
    step('Mindmap: Löschen lässt Unternotizen aufrücken');

    // ---------- 6. Migration einer Schema-v1-Datenbank ----------
    const old = new SQL.Database();
    old.run(`CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO meta VALUES ('schema_version','1');
             INSERT INTO notes (title, body, created_at, updated_at) VALUES ('Alt 1','a','2024-01-01T00:00:00Z','2024-01-01T00:00:00Z'), ('Alt 2','b','2024-01-02T00:00:00Z','2024-01-02T00:00:00Z');`);
    const oldPath = path.join(tmp, 'v1.sqlite');
    fs.writeFileSync(oldPath, Buffer.from(old.export()));
    old.close();
    const ctx6 = await browser.newContext({ locale: 'de-CH' });
    const { page: page6, errors: errors6 } = await openApp(ctx6);
    await page6.setInputFiles('#importInput', oldPath);
    await page6.waitForFunction(() => document.querySelectorAll('.mm-node:not(.mm-root)').length === 2);
    await waitSaved(page6);
    assert.deepEqual(errors6, []);
    await ctx6.close();
    step('Migration: Schema v1 wird geöffnet und als Baum gezeigt');

    // ---------- 7. Fragen: Syntax, zentrale Liste, Filter, Beantworten, Marke am Knoten ----------
    const ctx7 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    const { page: page7, errors: errors7 } = await openApp(ctx7, 'list');
    await page7.click('#newBtn');
    await page7.fill('#title', 'Planung');
    await page7.fill('#body', 'Intro\n? Wie hoch ist das Budget?\n? Wer liefert?\n! Firma Muster\nEnde');
    await waitSaved(page7);
    assert.match(await page7.locator('#noteQuestions').innerText(), /1 offene Frage von 2/);
    assert.match(await page7.locator('#viewQuestionsBtn').innerText(), /Fragen\s*1/);
    step('Fragen: Syntax wird erkannt und gezählt');

    // Marke am Knoten in der Mindmap
    await page7.click('#viewMapBtn');
    await page7.waitForSelector('body.view-map');
    const planungId = await idOfNode(page7, 'Planung');
    assert.equal(await page7.locator(`.mm-node[data-id="${planungId}"] .mm-badge text`).textContent(), '1');
    step('Fragen: Anzahl offener Fragen am Mindmap-Knoten');

    // Zentrale Liste
    await page7.click('#viewQuestionsBtn');
    await page7.waitForSelector('body.view-questions');
    assert.equal(await page7.locator('.q-item').count(), 1, 'Standardfilter zeigt nur offene Fragen');
    assert.match(await page7.locator('.q-item .q-text').innerText(), /Wie hoch ist das Budget\?/);
    await page7.click('#qFilter button[data-status="all"]');
    await page7.waitForFunction(() => document.querySelectorAll('.q-item').length === 2);
    await page7.click('#qFilter button[data-status="answered"]');
    await page7.waitForFunction(() => document.querySelectorAll('.q-item').length === 1);
    assert.match(await page7.locator('.q-item .q-answer').innerText(), /Firma Muster/);
    await page7.fill('#qSearch', 'budget');
    await page7.waitForFunction(() => document.querySelectorAll('.q-item').length === 0);
    await page7.fill('#qSearch', '');
    await page7.waitForFunction(() => document.querySelectorAll('.q-item').length === 1, null, {}); // Entprellung durch
    await page7.click('#qFilter button[data-status="open"]');
    await page7.waitForFunction(() => document.querySelectorAll('.q-item').length === 1 && /Budget/.test(document.querySelector('.q-item .q-text').textContent));
    step('Fragen: zentrale Liste mit Filter und Suche');

    // Zentral beantworten schreibt die Antwort in die Notiz
    await page7.click('.q-item button:has-text("Beantworten")');
    await page7.fill('.q-item .q-form textarea', '20k CHF');
    await page7.click('.q-item .q-form button[type="submit"]');
    await page7.waitForFunction(() => document.querySelectorAll('.q-item').length === 0);
    await waitSaved(page7);
    await page7.click('#qFilter button[data-status="answered"]');
    await page7.waitForFunction(() => document.querySelectorAll('.q-item').length === 2);
    assert.equal(await page7.locator('#viewQuestionsBtn .count').count(), 0, 'keine offene Frage mehr');
    // Zur Notiz springen: Vollbild-Editor aus der Fragenansicht
    await page7.locator('.q-item').first().locator('button:has-text("Zur Notiz")').click();
    await page7.waitForSelector('body.editor-open');
    assert.equal(await page7.inputValue('#body'), 'Intro\n? Wie hoch ist das Budget?\n! 20k CHF\n? Wer liefert?\n! Firma Muster\nEnde');
    step('Fragen: zentral beantworten landet als "!"-Zeile in der Notiz');

    // Editor-Knopf markiert die aktuelle Zeile als Frage und wieder zurück
    await page7.evaluate(() => { const b = document.querySelector('#body'); const pos = b.value.indexOf('Ende'); b.focus(); b.setSelectionRange(pos, pos); });
    await page7.click('#questionBtn');
    await page7.waitForFunction(() => document.querySelector('#body').value.endsWith('\n? Ende'));
    assert.match(await page7.locator('#noteQuestions').innerText(), /1 offene Frage von 3/);
    await page7.keyboard.press('Control+Shift+F');
    await page7.waitForFunction(() => document.querySelector('#body').value.endsWith('\nEnde'));
    await waitSaved(page7);
    await page7.keyboard.press('Escape');
    await page7.waitForSelector('body:not(.editor-open)');
    assert.equal(await page7.locator('body.view-questions').count(), 1, 'zurück in der Fragenansicht');
    step('Fragen: Zeile per Knopf und Tastenkürzel markieren');

    // Index liegt in der Datenbank
    await page7.click('#menuBtn');
    const [dl7] = await Promise.all([page7.waitForEvent('download'), page7.click('#downloadBtn')]);
    const dl7Path = path.join(tmp, 'fragen.sqlite');
    await dl7.saveAs(dl7Path);
    const db7 = new SQL.Database(new Uint8Array(fs.readFileSync(dl7Path)));
    assert.equal(db7.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    const qrows = db7.exec('SELECT text, answer FROM questions ORDER BY line_no')[0].values;
    assert.deepEqual(qrows, [['Wie hoch ist das Budget?', '20k CHF'], ['Wer liefert?', 'Firma Muster']]);
    db7.close();
    assert.deepEqual(errors7, [], 'keine Konsolenfehler in der Fragenansicht');
    await ctx7.close();
    step('Fragen: Index steht in der SQLite-Datei');

    // ---------- 8. Markdown-Vorschau, Tags, Papierkorb, Suche mit Hervorhebung ----------
    const ctx8 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    const { page: page8, errors: errors8 } = await openApp(ctx8, 'list');
    await page8.click('#newBtn');
    await page8.fill('#title', 'Planung');
    await page8.fill('#body', 'Grundlagen für das Budget.');
    await waitSaved(page8);
    await page8.click('#newBtn');
    await page8.fill('#title', 'Bericht');
    await page8.fill('#body', '# Überblick\n\nSiehe [[Planung]] und [[Gibt es nicht]].\n\n- **wichtig**\n- [x] erledigt\n\n? Offen?\n\n```\ncode <b>\n```');
    await waitSaved(page8);

    // Vorschau: Umschalter, Inhalte, Links
    await page8.click('#modeSwitch button[data-mode="preview"]');
    await page8.waitForSelector('#editorPane.mode-preview');
    assert.equal(await page8.locator('#body').isVisible(), false, 'Textfeld in der Vorschau ausgeblendet');
    assert.equal(await page8.locator('#preview h1').innerText(), 'Überblick');
    assert.equal(await page8.locator('#preview strong').innerText(), 'wichtig');
    assert.equal(await page8.locator('#preview li.task input:checked').count(), 1);
    assert.equal(await page8.locator('#preview .md-q.open').count(), 1);
    assert.equal(await page8.locator('#preview pre code').innerText(), 'code <b>');
    assert.equal(await page8.locator('#preview a.md-wiki:not(.missing)').innerText(), 'Planung');
    assert.equal(await page8.locator('#preview a.md-wiki.missing').innerText(), 'Gibt es nicht');
    await page8.click('#modeSwitch button[data-mode="split"]');
    await page8.waitForSelector('#editorPane.mode-split');
    assert.equal(await page8.locator('#body').isVisible(), true);
    assert.equal(await page8.locator('#preview').isVisible(), true);
    await page8.fill('#body', '# Neu\n\n? Offen?\n\nSiehe [[Planung]].');
    await page8.waitForFunction(() => document.querySelector('#preview h1') && document.querySelector('#preview h1').textContent === 'Neu');
    await waitSaved(page8);
    await page8.click('#preview a.md-wiki');
    await page8.waitForFunction(() => document.querySelector('#title').value === 'Planung');
    step('Markdown: Vorschau, geteilte Ansicht, [[Titel]]-Verweis');

    // Tags
    await page8.fill('#tagInput', 'projekt');
    await page8.keyboard.press('Enter');
    await page8.fill('#tagInput', 'Dringend, projekt');
    await page8.keyboard.press('Enter');
    await page8.waitForFunction(() => document.querySelectorAll('#tagChips .chip').length === 2);
    await waitSaved(page8);
    assert.deepEqual(await page8.locator('#tagChips .chip').allInnerTexts().then(a => a.map(t => t.replace('×', '').trim())), ['Dringend', 'projekt']);
    assert.equal(await page8.locator('#list li.active .note-tags .tag').count(), 2);
    await page8.selectOption('#tagFilter', 'projekt');
    await page8.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    await page8.selectOption('#tagFilter', '');
    await page8.waitForFunction(() => document.querySelectorAll('#list li').length === 2);
    await page8.click('#tagChips .chip:has-text("Dringend") button');
    await page8.waitForFunction(() => document.querySelectorAll('#tagChips .chip').length === 1);
    await waitSaved(page8);
    // Tag-Filter in der Fragenansicht
    await page8.click('#viewQuestionsBtn');
    await page8.waitForSelector('body.view-questions');
    await page8.waitForFunction(() => document.querySelectorAll('.q-item').length === 1);
    await page8.selectOption('#qTagFilter', 'projekt');
    await page8.waitForFunction(() => document.querySelectorAll('.q-item').length === 0, null, {});
    await page8.selectOption('#qTagFilter', '');
    await page8.waitForFunction(() => document.querySelectorAll('.q-item').length === 1);
    await page8.click('#viewListBtn');
    await page8.waitForSelector('body.view-list');
    step('Tags: Eingabe, Chips, Filter in Liste und Fragen');

    // Suche mit Hervorhebung in der Liste und in der Mindmap
    await page8.fill('#search', 'budget');
    await page8.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    assert.equal(await page8.locator('#list li mark').first().innerText(), 'Budget');
    await page8.click('#viewMapBtn');
    await page8.waitForSelector('body.view-map');
    assert.equal(await page8.inputValue('#mapSearch'), 'budget', 'Suche ist in beiden Ansichten dieselbe');
    await page8.waitForFunction(() => document.querySelectorAll('.mm-node.mm-match').length === 1);
    assert.equal(await page8.locator('.mm-node.mm-dim').count(), 1);
    assert.match(await page8.locator('#mapMatches').innerText(), /1 Treffer/);
    await page8.focus('#mapSearch');
    await page8.keyboard.press('Enter');
    await page8.waitForFunction(() => document.querySelector('.mm-node.mm-match.mm-selected'));
    await page8.fill('#mapSearch', '');
    await page8.waitForFunction(() => document.querySelectorAll('.mm-node.mm-match').length === 0);
    await page8.click('#viewListBtn');
    await page8.waitForFunction(() => document.querySelectorAll('#list li').length === 2);
    step('Suche: Hervorhebung in Liste und Mindmap, Sprung zum Treffer');

    // Papierkorb: löschen, wiederherstellen, endgültig löschen
    await page8.click('#list li:has-text("Bericht")');
    page8.once('dialog', d => d.accept());
    await page8.click('#deleteBtn');
    await page8.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    await waitSaved(page8);
    await page8.selectOption('#listScope', 'trash');
    await page8.waitForFunction(() => document.querySelectorAll('#list li.trashed').length === 1);
    assert.equal(await page8.locator('#emptyTrashBtn').isVisible(), true);
    await page8.click('#list li.trashed');
    await page8.waitForSelector('#trashBar:not([hidden])');
    assert.equal(await page8.locator('#title').evaluate(e => e.readOnly), true);
    await page8.click('#restoreBtn');
    await page8.waitForFunction(() => document.querySelector('#listScope').value === 'live' && document.querySelectorAll('#list li').length === 2);
    await waitSaved(page8);
    page8.once('dialog', d => d.accept());
    await page8.click('#deleteBtn');
    await page8.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    await page8.selectOption('#listScope', 'trash');
    await page8.waitForFunction(() => document.querySelectorAll('#list li.trashed').length === 1);
    page8.once('dialog', d => d.accept());
    await page8.click('#emptyTrashBtn');
    await page8.waitForFunction(() => document.querySelectorAll('#list li').length === 0);
    await waitSaved(page8);
    await page8.click('#menuBtn');
    const [dl8] = await Promise.all([page8.waitForEvent('download'), page8.click('#downloadBtn')]);
    const dl8Path = path.join(tmp, 'stufe3.sqlite');
    await dl8.saveAs(dl8Path);
    const db8 = new SQL.Database(new Uint8Array(fs.readFileSync(dl8Path)));
    assert.equal(db8.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    assert.equal(db8.exec('SELECT count(*) FROM notes')[0].values[0][0], 1, 'endgültig gelöscht');
    assert.deepEqual(db8.exec('SELECT name FROM tags')[0].values.map(r => r[0]), ['projekt']);
    db8.close();
    assert.deepEqual(errors8, [], 'keine Konsolenfehler in Stufe 3');
    await ctx8.close();
    step('Papierkorb: verschieben, wiederherstellen, endgültig löschen');

    // ---------- 9. Export als Markdown: Ordner (nachgebildet) und ZIP ----------
    const ctx9 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx9.addInitScript(() => {
      window.__exported = {};
      const concat = chunks => { const n = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };
      const makeDir = prefix => ({
        kind: 'directory', name: 'Export',
        getDirectoryHandle: async n => makeDir(prefix + n + '/'),
        getFileHandle: async n => ({
          kind: 'file', name: n,
          createWritable: async () => {
            const chunks = [];
            return {
              write: async d => { chunks.push(new Uint8Array(d)); },
              close: async () => { window.__exported[prefix + n] = Array.from(concat(chunks)); },
              abort: async () => {},
            };
          },
        }),
      });
      window.showDirectoryPicker = async () => makeDir('');
    });
    const { page: page9, errors: errors9 } = await openApp(ctx9, 'list');
    await page9.click('#newBtn');
    await page9.fill('#title', 'Planung');
    await page9.fill('#body', 'Siehe [[Budget]].\n? Offen?');
    await page9.fill('#tagInput', 'projekt');
    await page9.keyboard.press('Enter');
    await waitSaved(page9);
    await page9.click('#childBtn');
    await page9.fill('#title', 'Budget');
    await page9.fill('#body', '? Was kostet es?\n! 20k');
    await waitSaved(page9);

    await page9.click('#menuBtn');
    await page9.click('#exportBtn');
    await page9.waitForSelector('#exportDialog[open]');
    await page9.click('#exportDirBtn');
    await page9.waitForFunction(() => /Export gespeichert/.test(document.querySelector('#status').textContent));
    const exported = await page9.evaluate(() => window.__exported);
    const names = Object.keys(exported).sort();
    assert.deepEqual(names, ['index.md', 'mindmap.png', 'mindmap.svg', 'notes/budget.md', 'notes/planung.md']);
    const text = name => Buffer.from(exported[name]).toString('utf8');
    const index = text('index.md');
    assert.match(index, /^# Meine Notizen/);
    assert.ok(index.includes('![Mindmap](mindmap.svg)'), 'Bild oben in der Übersicht');
    assert.ok(index.includes('- [Planung](notes/planung.md)\n  - [Budget](notes/budget.md)'), 'Inhaltsverzeichnis in Baumreihenfolge');
    assert.ok(index.includes('## Offene Fragen') && index.includes('- Offen? — aus [Planung](notes/planung.md)'), 'offene Fragen gelistet');
    const planung = text('notes/planung.md');
    assert.ok(planung.includes('Siehe [Budget](budget.md).'), '[[Titel]] wird zum Link');
    assert.ok(planung.includes('> **Offene Frage:** Offen?'));
    assert.ok(planung.includes('*Tags: projekt*'));
    assert.ok(planung.includes('- [Budget](budget.md)'), 'Unternotizen verlinkt');
    const budget = text('notes/budget.md');
    assert.ok(budget.includes('*Pfad: Planung*'));
    assert.ok(budget.includes('> **Frage (beantwortet):** Was kostet es?\n> **Antwort:** 20k'));
    const svg = text('mindmap.svg');
    assert.ok(svg.startsWith('<svg') && svg.includes('Planung') && svg.includes('Budget'), 'SVG enthält die Knoten');
    assert.ok(Buffer.from(exported['mindmap.png']).subarray(0, 8).equals(PNG_MAGIC), 'PNG hat gültige Signatur');
    step('Export: Ordner mit index.md, Notizen, SVG und PNG');

    await page9.click('#menuBtn');
    await page9.click('#exportBtn');
    await page9.waitForSelector('#exportDialog[open]');
    await page9.check('#exportForm input[value="single"]');
    const [dl9] = await Promise.all([page9.waitForEvent('download'), page9.click('#exportZipBtn')]);
    assert.match(dl9.suggestedFilename(), /^NoNotes-meine-notizen-\d{4}-\d{2}-\d{2}\.zip$/);
    const zipPath = path.join(tmp, 'export.zip');
    await dl9.saveAs(zipPath);
    const zip = readZip(fs.readFileSync(zipPath));
    assert.deepEqual(Object.keys(zip).sort(), ['meine-notizen.md', 'mindmap.png', 'mindmap.svg']);
    const single = zip['meine-notizen.md'].toString('utf8');
    assert.ok(single.includes('![Mindmap](mindmap.svg)'));
    assert.ok(single.includes('- [Planung](#planung)\n  - [Budget](#budget)'));
    assert.ok(single.includes('<a id="planung"></a>\n\n## Planung') && single.includes('<a id="budget"></a>\n\n### Budget'), 'Abschnitte nach Tiefe');
    assert.ok(single.includes('Siehe [Budget](#budget).'));
    assert.ok(zip['mindmap.png'].subarray(0, 8).equals(PNG_MAGIC));
    assert.ok(zip['mindmap.svg'].toString('utf8').startsWith('<svg'));
    assert.deepEqual(errors9, [], 'keine Konsolenfehler beim Export');
    await ctx9.close();
    step('Export: eine Datei mit Anhängen als ZIP');

    // ---------- 10. Umsortieren per Drag & Drop (vor/nach Geschwistern) ----------
    const ctx10 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    const { page: page10, errors: errors10 } = await openApp(ctx10);
    const idA = await newRootNote(page10, 'Alpha');
    const idB = await newRootNote(page10, 'Beta');
    // Unternotize von Alpha
    await page10.click(`.mm-node[data-id="${idA}"]`);
    await page10.keyboard.press('Tab');
    await page10.waitForSelector('#renameInput:not([hidden])');
    await page10.keyboard.type('Gamma');
    await page10.keyboard.press('Enter');
    await page10.waitForFunction(() => [...document.querySelectorAll('.mm-node text')].some(x => x.textContent === 'Gamma'));
    const idC = await idOfNode(page10, 'Gamma');
    const orderOf = async () => {
      await page10.click('#menuBtn');
      const [dl] = await Promise.all([page10.waitForEvent('download'), page10.click('#downloadBtn')]);
      const pth = path.join(tmp, 'order.sqlite');
      await dl.saveAs(pth);
      const d = new SQL.Database(new Uint8Array(fs.readFileSync(pth)));
      const rows = d.exec('SELECT title, parent_id, sort_order FROM notes WHERE deleted_at IS NULL ORDER BY parent_id, sort_order')[0].values;
      d.close();
      return rows;
    };
    assert.deepEqual(await orderOf(), [['Alpha', null, 0], ['Beta', null, 1], ['Gamma', Number(idA), 0]]);
    await dragNode(page10, idB, idA, 'before');
    await page10.waitForFunction(() => document.querySelector('#status').dataset.state !== 'saving');
    await waitSaved(page10);
    assert.deepEqual(await orderOf(), [['Beta', null, 0], ['Alpha', null, 1], ['Gamma', Number(idA), 0]], 'Beta vor Alpha');
    await dragNode(page10, idC, idB, 'after');
    await waitSaved(page10);
    assert.deepEqual(await orderOf(), [['Beta', null, 0], ['Gamma', null, 1], ['Alpha', null, 2]], 'Gamma aus dem Ast heraus hinter Beta');
    await dragNode(page10, idA, idB, 'child');
    await waitSaved(page10);
    assert.deepEqual(await orderOf(), [['Beta', null, 0], ['Gamma', null, 1], ['Alpha', Number(idB), 0]], 'Mitte bleibt Unternotiz');
    assert.deepEqual(errors10, []);
    await ctx10.close();
    step('Mindmap: Umsortieren per Drag & Drop vor, nach und als Unternotiz');

    // ---------- 11. Bild-Anhänge ----------
    const ctx11 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx11.addInitScript(() => {
      window.__exported = {};
      const concat = chunks => { const n = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };
      const makeDir = prefix => ({ kind: 'directory', name: 'Export', getDirectoryHandle: async n => makeDir(prefix + n + '/'), getFileHandle: async n => ({ kind: 'file', name: n, createWritable: async () => { const chunks = []; return { write: async d => { chunks.push(new Uint8Array(d)); }, close: async () => { window.__exported[prefix + n] = Array.from(concat(chunks)); }, abort: async () => {} }; } }) });
      window.showDirectoryPicker = async () => makeDir('');
    });
    const { page: page11, errors: errors11 } = await openApp(ctx11, 'list');
    await page11.click('#newBtn');
    await page11.fill('#title', 'Skizzen');
    await page11.fill('#body', 'Vorher.');
    await waitSaved(page11);
    const smallPng = path.join(tmp, 'klein.png');
    fs.writeFileSync(smallPng, await page11.screenshot({ clip: { x: 0, y: 0, width: 40, height: 30 } }));
    await page11.setInputFiles('#attachInput', smallPng);
    await page11.waitForFunction(() => /!\[klein\]\(att:\d+\)/.test(document.querySelector('#body').value));
    await page11.waitForFunction(() => document.querySelectorAll('#attachments .attachment').length === 1);
    await waitSaved(page11);
    // Grosses Bild aus der Zwischenablage wird verkleinert
    await page11.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2000; canvas.height = 1200;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#4a90e2'; ctx.fillRect(0, 0, 2000, 1200);
      ctx.fillStyle = '#fff'; ctx.font = '120px sans-serif'; ctx.fillText('gross', 100, 600);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const file = new File([blob], 'gross.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('#body').dispatchEvent(ev);
    });
    await page11.waitForFunction(() => document.querySelectorAll('#attachments .attachment').length === 2);
    await waitSaved(page11);
    assert.match(await page11.inputValue('#body'), /!\[gross\]\(att:\d+\)/);
    // Vorschau zeigt die Bilder
    await page11.click('#modeSwitch button[data-mode="preview"]');
    await page11.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('#preview img.md-att')];
      return imgs.length === 2 && imgs.every(i => i.complete && i.naturalWidth > 0);
    });
    const widths = await page11.evaluate(() => [...document.querySelectorAll('#preview img.md-att')].map(i => i.naturalWidth));
    assert.deepEqual(widths, [40, 1600], 'kleines Bild bleibt, grosses wird auf 1600 Pixel verkleinert');
    await page11.click('#modeSwitch button[data-mode="edit"]');
    step('Anhänge: Datei, Zwischenablage, Verkleinern, Vorschau');

    // Export nimmt Anhänge mit
    await page11.click('#menuBtn');
    await page11.click('#exportBtn');
    await page11.waitForSelector('#exportDialog[open]');
    await page11.click('#exportDirBtn');
    await page11.waitForFunction(() => /Export gespeichert/.test(document.querySelector('#status').textContent));
    const exp11 = await page11.evaluate(() => Object.keys(window.__exported));
    const attFiles = exp11.filter(n => n.startsWith('attachments/'));
    assert.equal(attFiles.length, 2, 'beide Anhänge exportiert');
    const skizzen = await page11.evaluate(() => new TextDecoder().decode(new Uint8Array(window.__exported['notes/skizzen.md'])));
    assert.match(skizzen, /!\[klein\]\(\.\.\/attachments\/\d+-klein\.png\)/, 'Verweis zeigt auf den Anhangsordner');
    step('Anhänge: Export in den Ordner attachments/');

    // Anhang entfernen
    page11.once('dialog', d => d.accept());
    await page11.click('#attachments .attachment:first-child button.danger');
    await page11.waitForFunction(() => document.querySelectorAll('#attachments .attachment').length === 1);
    await waitSaved(page11);
    await page11.click('#modeSwitch button[data-mode="preview"]');
    await page11.waitForSelector('#preview .md-missing');
    await page11.click('#modeSwitch button[data-mode="edit"]');
    await page11.click('#menuBtn');
    const [dl11] = await Promise.all([page11.waitForEvent('download'), page11.click('#downloadBtn')]);
    const dl11Path = path.join(tmp, 'anhaenge.sqlite');
    await dl11.saveAs(dl11Path);
    const db11 = new SQL.Database(new Uint8Array(fs.readFileSync(dl11Path)));
    assert.equal(db11.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    assert.equal(db11.exec('SELECT count(*) FROM attachments')[0].values[0][0], 1);
    assert.equal(db11.exec('SELECT mime FROM attachments')[0].values[0][0], 'image/png');
    db11.close();
    assert.deepEqual(errors11, [], 'keine Konsolenfehler bei Anhängen');
    await ctx11.close();
    step('Anhänge: Löschen, fehlender Verweis, Ablage in SQLite');

    // ---------- 12. Drucken: Teilbaum, Auswahl, alles, Fragen und Antworten ----------
    const ctx12 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-CH' });
    await ctx12.addInitScript(() => {
      window.__printed = [];
      window.print = () => { window.__printed.push(document.getElementById('printArea').innerHTML); };
    });
    const { page: page12, errors: errors12 } = await openApp(ctx12);
    const idP = await newRootNote(page12, 'Projekt');
    await page12.click(`.mm-node[data-id="${idP}"]`);
    await page12.keyboard.press('Tab');
    await page12.waitForSelector('#renameInput:not([hidden])');
    await page12.keyboard.type('Budget');
    await page12.keyboard.press('Enter');
    await page12.waitForFunction(() => [...document.querySelectorAll('.mm-node text')].some(x => x.textContent === 'Budget'));
    const idBu = await idOfNode(page12, 'Budget');
    const idG = await newRootNote(page12, 'Garten');
    await page12.dblclick(`.mm-node[data-id="${idBu}"]`);
    await page12.waitForSelector('body.editor-open');
    await page12.fill('#body', 'Kosten.\n? Offerten da?\n? Versicherung?\n! Ja, 80 %');
    await waitSaved(page12);
    await page12.keyboard.press('Escape');
    await page12.waitForSelector('body:not(.editor-open)');
    const printedCount = () => page12.evaluate(() => window.__printed.length);
    const printed = i => page12.evaluate(i => window.__printed[i], i);

    // Teilbaum über das Kontextmenü
    await page12.click(`.mm-node[data-id="${idP}"]`, { button: 'right' });
    await page12.click('#contextMenu button:has-text("Drucken…")');
    await page12.waitForSelector('#printDialog[open]');
    assert.equal(await page12.locator('#printForm input[name="printScope"]:checked').inputValue(), 'subtree');
    assert.match(await page12.locator('#printScopeSubtree').innerText(), /„Projekt“ mit Unternotizen \(2\)/);
    await page12.click('#printGoBtn');
    await page12.waitForFunction(() => window.__printed.length === 1);
    const doc1 = await printed(0);
    assert.ok(doc1.includes('<h1>Projekt</h1>'), 'Titel des Teilbaums');
    assert.ok(doc1.includes(`id="print-note-${idBu}"`) && doc1.includes('Budget'), 'Unternotiz enthalten');
    assert.ok(doc1.includes('<svg') && doc1.includes('Projekt'), 'Mindmap-Bild enthalten');
    assert.ok(!doc1.includes('Garten'), 'fremder Ast nicht enthalten');
    assert.ok(doc1.includes('md-q open') && doc1.includes('md-q answered'), 'Fragen gerendert');
    await page12.waitForFunction(() => !document.body.classList.contains('printing'));
    step('Drucken: Notiz mit Unternotizen aus dem Kontextmenü');

    // Auswahl mit Ctrl+Klick
    await page12.click(`.mm-node[data-id="${idG}"]`, { modifiers: ['Control'] });
    await page12.click(`.mm-node[data-id="${idBu}"]`, { modifiers: ['Control'] });
    await page12.waitForSelector('#multiBar:not([hidden])');
    assert.equal(await page12.locator('#multiCount').innerText(), '2 Notizen ausgewählt');
    assert.equal(await page12.locator('.mm-node.mm-multi').count(), 2);
    await page12.click('#multiPrintBtn');
    await page12.waitForSelector('#printDialog[open]');
    assert.equal(await page12.locator('#printForm input[name="printScope"]:checked').inputValue(), 'selection');
    await page12.click('#printGoBtn');
    await page12.waitForFunction(() => window.__printed.length === 2);
    const doc2 = await printed(1);
    assert.ok(doc2.includes('<h2>Garten</h2>') && doc2.includes('<h2>Budget</h2>'), 'beide ausgewählten Notizen');
    assert.ok(!doc2.includes('<h2>Projekt</h2>'), 'nicht ausgewählte Notiz fehlt');
    await page12.click('#multiClearBtn');
    await page12.waitForFunction(() => document.getElementById('multiBar').hidden);
    assert.equal(await page12.locator('.mm-node.mm-multi').count(), 0);
    step('Drucken: ausgewählte Notizen');

    // Alles per Ctrl+P
    await page12.click('#mindmap', { position: { x: 30, y: 700 } });
    await page12.keyboard.press('Control+p');
    await page12.waitForSelector('#printDialog[open]');
    await page12.check('#printForm input[value="all"]');
    await page12.click('#printGoBtn');
    await page12.waitForFunction(() => window.__printed.length === 3);
    const doc3 = await printed(2);
    assert.ok(doc3.includes('print-toc') && doc3.includes('<h2>Projekt</h2>') && doc3.includes('<h3>Budget</h3>') && doc3.includes('<h2>Garten</h2>'), 'alle Notizen mit Inhaltsverzeichnis und Ebenen');
    step('Drucken: alle Notizen per Ctrl+P');

    // Fragen und Antworten
    await page12.click('#viewQuestionsBtn');
    await page12.waitForSelector('body.view-questions');
    await page12.click('#qPrintBtn');
    await page12.waitForSelector('#qaPrintDialog[open]');
    assert.match(await page12.locator('#qaScopeFiltered').innerText(), /offene Fragen \(1\)/);
    await page12.click('#qaPrintGoBtn');
    await page12.waitForFunction(() => window.__printed.length === 4);
    const doc4 = await printed(3);
    assert.ok(doc4.includes('Fragen und Antworten') && doc4.includes('Offerten da?') && doc4.includes('print-lines'), 'offene Frage mit Linien');
    assert.ok(!doc4.includes('Versicherung?'), 'beantwortete Frage nicht im Offen-Filter');
    await page12.keyboard.press('Control+p');
    await page12.waitForSelector('#qaPrintDialog[open]');
    await page12.check('#qaPrintForm input[value="all"]');
    await page12.click('#qaPrintGoBtn');
    await page12.waitForFunction(() => window.__printed.length === 5);
    const doc5 = await printed(4);
    assert.ok(doc5.includes('Versicherung?') && doc5.includes('print-a') && doc5.includes('Ja, 80 %'), 'Antwort gedruckt');
    assert.ok(doc5.includes('<h2>Budget</h2>'), 'nach Notiz gruppiert');
    assert.deepEqual(errors12, [], 'keine Konsolenfehler beim Drucken');
    await ctx12.close();
    step('Drucken: Fragen und Antworten mit Filter');

    // ---------- 13. Toolleiste, Tastenkürzel, Hilfe, Links ohne Schema ----------
    const ctx13 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-CH' });
    const { page: page13, errors: errors13 } = await openApp(ctx13, 'list');
    await page13.click('#newBtn');
    await page13.fill('#title', 'Format');
    await page13.fill('#body', 'hallo welt');
    const select = (a, b) => page13.evaluate(([a, b]) => { const t = document.querySelector('#body'); t.focus(); t.setSelectionRange(a, b); }, [a, b]);
    const sel = () => page13.evaluate(() => { const t = document.querySelector('#body'); return [t.selectionStart, t.selectionEnd]; });
    await select(0, 5);
    await page13.click('#mdToolbar button[data-cmd="bold"]');
    assert.equal(await page13.inputValue('#body'), '**hallo** welt');
    assert.deepEqual(await sel(), [2, 7], 'Markierung bleibt auf dem Wort');
    await page13.click('#mdToolbar button[data-cmd="bold"]');
    assert.equal(await page13.inputValue('#body'), 'hallo welt', 'nochmals klicken entfernt die Auszeichnung');
    await select(6, 10);
    await page13.keyboard.press('Control+i');
    assert.equal(await page13.inputValue('#body'), 'hallo *welt*');
    await select(0, 0);
    await page13.selectOption('#headingSelect', '2');
    assert.equal(await page13.inputValue('#body'), '## hallo *welt*');
    assert.equal(await page13.inputValue('#headingSelect'), '', 'Auswahl springt zurück');
    await page13.fill('#body', 'eins\nzwei');
    await select(0, 9);
    await page13.click('#mdToolbar button[data-cmd="bullet"]');
    assert.equal(await page13.inputValue('#body'), '- eins\n- zwei');
    await page13.click('#mdToolbar button[data-cmd="task"]');
    assert.equal(await page13.inputValue('#body'), '- [ ] eins\n- [ ] zwei');
    await page13.click('#mdToolbar button[data-cmd="quote"]');
    assert.equal(await page13.inputValue('#body'), '> - [ ] eins\n> - [ ] zwei');
    await page13.fill('#body', 'Siehe Google');
    await select(6, 12);
    await page13.keyboard.press('Control+k');
    assert.equal(await page13.inputValue('#body'), 'Siehe [Google](https://)');
    assert.deepEqual(await sel(), [15, 23], 'Adresse ist markiert');
    await page13.keyboard.type('www.google.com');
    await page13.waitForFunction(() => document.querySelector('#body').value === 'Siehe [Google](www.google.com)');
    await page13.click('#modeSwitch button[data-mode="preview"]');
    await page13.waitForFunction(() => document.querySelector('#preview a') && document.querySelector('#preview a').getAttribute('href') === 'https://www.google.com');
    assert.equal(await page13.locator('#preview a').innerText(), 'Google');
    await page13.click('#modeSwitch button[data-mode="edit"]');
    await waitSaved(page13);
    step('Toolleiste: Fett, Kursiv, Überschrift, Listen, Zitat, Link mit Schema-Ergänzung');

    await page13.click('#helpBtn');
    await page13.waitForSelector('#helpDialog[open]');
    assert.equal(await page13.locator('.help-panel[data-panel="editor"]').isVisible(), true);
    assert.match(await page13.locator('.help-panel[data-panel="editor"]').innerText(), /Markdown[\s\S]*Besonderheiten von NoNotes/);
    await page13.click('#helpTabs button[data-tab="storage"]');
    await page13.waitForSelector('.help-panel[data-panel="storage"]:not([hidden])');
    assert.match(await page13.locator('#helpStorageStatus').innerText(), /Browser-Speicher: IndexedDB[\s\S]*Notiz/);
    await page13.keyboard.press('Escape');
    await page13.waitForFunction(() => !document.getElementById('helpDialog').open);
    await page13.keyboard.press('F1');
    await page13.waitForSelector('#helpDialog[open]');
    assert.equal(await page13.locator('.help-panel[data-panel="editor"]').isVisible(), true, 'F1 öffnet den Editor-Reiter');
    await page13.keyboard.press('Escape');
    await page13.click('#menuBtn');
    await page13.click('#storageHelpBtn');
    await page13.waitForSelector('.help-panel[data-panel="storage"]:not([hidden])');
    assert.equal(await page13.locator('#helpTabs button[data-tab="storage"]').getAttribute('aria-selected'), 'true');
    await page13.keyboard.press('Escape');
    assert.deepEqual(errors13, [], 'keine Konsolenfehler in Toolleiste und Hilfe');
    await ctx13.close();
    step('Hilfe: Reiter Editor, Tastenkürzel, Datenablage; F1 und Menü');

    // ---------- 14. Aufgaben: Syntax, zentrale Liste, Abhaken, Marker, Druck, Export, Suche per / ----------
    const ctx14 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx14.addInitScript(() => {
      window.__printed = [];
      window.print = () => { window.__printed.push(document.getElementById('printArea').innerHTML); };
      window.__exported = {};
      const concat = chunks => { const n = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };
      const makeDir = prefix => ({ kind: 'directory', name: 'Export', getDirectoryHandle: async n => makeDir(prefix + n + '/'), getFileHandle: async n => ({ kind: 'file', name: n, createWritable: async () => { const chunks = []; return { write: async d => { chunks.push(new Uint8Array(d)); }, close: async () => { window.__exported[prefix + n] = Array.from(concat(chunks)); }, abort: async () => {} }; } }) });
      window.showDirectoryPicker = async () => makeDir('');
    });
    const { page: page14, errors: errors14 } = await openApp(ctx14, 'list');
    await page14.click('#newBtn');
    await page14.fill('#title', 'Umbau');
    await page14.fill('#body', 'Plan\n- [ ] Elektriker anrufen @01.01.2020\n- [ ] Offerten einholen\n- [x] Baubewilligung\n? Frage?');
    await page14.fill('#tagInput', 'projekt');
    await page14.keyboard.press('Enter');
    await waitSaved(page14);
    assert.match(await page14.locator('#viewTasksBtn').innerText(), /Aufgaben\s*2/);
    assert.equal(await page14.locator('#viewTasksBtn .count.overdue').count(), 1, 'überfällig hervorgehoben');
    await page14.click('#viewMapBtn');
    await page14.waitForSelector('body.view-map');
    const umbauId = await idOfNode(page14, 'Umbau');
    assert.equal(await page14.locator(`.mm-node[data-id="${umbauId}"] .mm-tbadge text`).textContent(), '2', 'Aufgaben-Marker am Knoten');
    assert.equal(await page14.locator(`.mm-node[data-id="${umbauId}"] .mm-badge text`).textContent(), '1', 'Fragen-Marker bleibt');
    step('Aufgaben: Syntax erkannt, Zähler und Marker');

    await page14.click('#viewTasksBtn');
    await page14.waitForSelector('body.view-tasks');
    await page14.waitForFunction(() => document.querySelectorAll('.t-item').length === 2);
    assert.deepEqual(await page14.locator('#tList .q-note').allInnerTexts().then(a => a.map(t => t.split('\n')[0].replace(/\s*\d+ Aufgaben?$/, '').trim())), ['Überfällig', 'Ohne Termin']);
    assert.equal(await page14.locator('.t-item .due.overdue').count(), 1);
    await page14.click('#tFilter button[data-status="all"]');
    await page14.waitForFunction(() => document.querySelectorAll('.t-item').length === 3);
    await page14.click('#tFilter button[data-status="done"]');
    await page14.waitForFunction(() => document.querySelectorAll('.t-item').length === 1);
    assert.match(await page14.locator('.t-item.done .q-text').innerText(), /Baubewilligung/);
    await page14.click('#tFilter button[data-status="open"]');
    await page14.waitForFunction(() => document.querySelectorAll('.t-item').length === 2);
    await page14.fill('#tSearch', 'elektr');
    await page14.waitForFunction(() => document.querySelectorAll('.t-item').length === 1);
    await page14.fill('#tSearch', '');
    await page14.waitForFunction(() => document.querySelectorAll('.t-item').length === 2);
    await page14.selectOption('#tSort', 'note');
    await page14.waitForFunction(() => document.querySelector('#tList .q-note button') && document.querySelector('#tList .q-note button').textContent === 'Umbau');
    await page14.selectOption('#tSort', 'due');
    step('Aufgaben: Liste mit Filter, Gruppen nach Fälligkeit, Suche, Sortierung');

    // Abhaken in der Liste schreibt in den Text
    await page14.locator('.t-item', { hasText: 'Offerten einholen' }).locator('.t-check').click();
    await page14.waitForFunction(() => document.querySelectorAll('.t-item').length === 1);
    await waitSaved(page14);
    assert.match(await page14.locator('#viewTasksBtn').innerText(), /Aufgaben\s*1/);
    await page14.locator('.t-item').first().locator('button:has-text("Zur Notiz")').click();
    await page14.waitForSelector('body.editor-open');
    assert.equal(await page14.inputValue('#body'), 'Plan\n- [ ] Elektriker anrufen @01.01.2020\n- [x] Offerten einholen\n- [x] Baubewilligung\n? Frage?');
    // Kästchen in der Vorschau
    await page14.click('#modeSwitch button[data-mode="preview"]');
    await page14.waitForSelector('#preview li.task[data-line="2"] input');
    await page14.click('#preview li.task[data-line="2"] input');
    await page14.waitForFunction(() => document.querySelector('#body').value.includes('- [ ] Offerten einholen'));
    await page14.click('#preview li.task[data-line="1"] input');
    await page14.waitForFunction(() => document.querySelector('#body').value.includes('- [x] Elektriker anrufen'));
    await waitSaved(page14);
    await page14.click('#modeSwitch button[data-mode="edit"]');
    await page14.keyboard.press('Escape');
    await page14.waitForSelector('body:not(.editor-open)');
    await page14.waitForFunction(() => document.querySelectorAll('.t-item').length === 1 && /Offerten/.test(document.querySelector('.t-item .q-text').textContent));
    step('Aufgaben: Abhaken in Liste und Vorschau landet im Text');

    // Suche per "/"
    await page14.keyboard.press('/');
    assert.equal(await page14.evaluate(() => document.activeElement && document.activeElement.id), 'tSearch');
    await page14.keyboard.press('Escape');
    await page14.click('#viewMapBtn');
    await page14.waitForSelector('body.view-map');
    await page14.click('#mindmap', { position: { x: 30, y: 700 } });
    await page14.keyboard.press('/');
    assert.equal(await page14.evaluate(() => document.activeElement && document.activeElement.id), 'mapSearch');
    await page14.keyboard.type('umb');
    await page14.waitForFunction(() => document.querySelectorAll('.mm-node.mm-match').length === 1, null, {});
    assert.equal(await page14.inputValue('#mapSearch'), 'umb', 'der Schrägstrich landet nicht im Suchfeld');
    await page14.fill('#mapSearch', '');
    await page14.click('#viewListBtn');
    await page14.waitForSelector('body.view-list');
    await page14.locator('body').click({ position: { x: 640, y: 780 } });
    await page14.keyboard.press('/');
    assert.equal(await page14.evaluate(() => document.activeElement && document.activeElement.id), 'search');
    step('Suche per "/" in Aufgaben, Mindmap und Liste');

    // Druck als Checkliste
    await page14.click('#viewTasksBtn');
    await page14.waitForSelector('body.view-tasks');
    await page14.click('#tPrintBtn');
    await page14.waitForSelector('#taskPrintDialog[open]');
    assert.match(await page14.locator('#taskScopeFiltered').innerText(), /offene Aufgaben \(1\)/);
    await page14.check('#taskPrintForm input[name="taskScope"][value="all"]');
    await page14.click('#taskPrintGoBtn');
    await page14.waitForFunction(() => window.__printed.length === 1);
    const tdoc = await page14.evaluate(() => window.__printed[0]);
    assert.ok(tdoc.includes('<h1>Aufgaben</h1>') && tdoc.includes('print-box') && tdoc.includes('Offerten einholen') && tdoc.includes('<h2>Erledigt</h2>'), 'Checkliste mit Gruppen');
    assert.ok(tdoc.includes('print-task done') && tdoc.includes('Baubewilligung'));
    await page14.keyboard.press('Control+p');
    await page14.waitForSelector('#taskPrintDialog[open]');
    await page14.keyboard.press('Escape');
    step('Aufgaben: Druck als Checkliste, Ctrl+P');

    // Export mit offenen Aufgaben
    await page14.click('#menuBtn');
    await page14.click('#exportBtn');
    await page14.waitForSelector('#exportDialog[open]');
    await page14.click('#exportDirBtn');
    await page14.waitForFunction(() => /Export gespeichert/.test(document.querySelector('#status').textContent));
    const idx14 = await page14.evaluate(() => new TextDecoder().decode(new Uint8Array(window.__exported['index.md'])));
    assert.ok(idx14.includes('## Offene Aufgaben') && idx14.includes('- [ ] Offerten einholen — aus [Umbau](notes/umbau.md)'), 'offene Aufgaben in der Übersicht');
    await page14.click('#menuBtn');
    const [dl14] = await Promise.all([page14.waitForEvent('download'), page14.click('#downloadBtn')]);
    const dl14Path = path.join(tmp, 'aufgaben.sqlite');
    await dl14.saveAs(dl14Path);
    const db14 = new SQL.Database(new Uint8Array(fs.readFileSync(dl14Path)));
    assert.equal(db14.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    assert.deepEqual(db14.exec('SELECT text, done, due FROM tasks ORDER BY line_no')[0].values, [['Elektriker anrufen', 1, '2020-01-01'], ['Offerten einholen', 0, null], ['Baubewilligung', 1, null]]);
    db14.close();
    assert.deepEqual(errors14, [], 'keine Konsolenfehler bei Aufgaben');
    await ctx14.close();
    step('Aufgaben: Export und Index in der SQLite-Datei');

    // ---------- 15. Fälligkeit bei Fragen ----------
    const ctx15 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx15.addInitScript(() => {
      window.__printed = [];
      window.print = () => { window.__printed.push(document.getElementById('printArea').innerHTML); };
      window.__exported = {};
      const concat = chunks => { const n = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };
      const makeDir = prefix => ({ kind: 'directory', name: 'Export', getDirectoryHandle: async n => makeDir(prefix + n + '/'), getFileHandle: async n => ({ kind: 'file', name: n, createWritable: async () => { const chunks = []; return { write: async d => { chunks.push(new Uint8Array(d)); }, close: async () => { window.__exported[prefix + n] = Array.from(concat(chunks)); }, abort: async () => {} }; } }) });
      window.showDirectoryPicker = async () => makeDir('');
    });
    const { page: page15, errors: errors15 } = await openApp(ctx15, 'list');
    await page15.click('#newBtn');
    await page15.fill('#title', 'Budget');
    await page15.fill('#body', '? Offerten da? @01.01.2020\n? Versicherung? @2030-01-01\n? Ohne Termin?\n? Fertig? @2030-02-02\n! ja');
    await waitSaved(page15);
    assert.match(await page15.locator('#viewQuestionsBtn').innerText(), /Fragen\s*3/);
    assert.equal(await page15.locator('#viewQuestionsBtn .count.q-overdue').count(), 1, 'überfällige Frage rot');
    await page15.click('#modeSwitch button[data-mode="preview"]');
    await page15.waitForSelector('#preview .md-q .md-due.overdue');
    assert.equal(await page15.locator('#preview .md-due').count(), 3);
    assert.match(await page15.locator('#preview .md-q.open .md-q-text').first().innerText(), /^Offerten da\?/, 'Termin nicht mehr im Fragetext');
    await page15.click('#modeSwitch button[data-mode="edit"]');
    step('Fragen: Termin erkannt, Zähler und Vorschau');

    await page15.click('#viewQuestionsBtn');
    await page15.waitForSelector('body.view-questions');
    await page15.waitForFunction(() => document.querySelectorAll('.q-item').length === 3);
    const groupTitles = async () => page15.locator('#qList .q-note').allInnerTexts().then(a => a.map(t => t.split('\n')[0].replace(/\s*\d+ Fragen?$/, '').trim()));
    assert.deepEqual(await groupTitles(), ['Überfällig', 'Später', 'Ohne Termin']);
    assert.equal(await page15.locator('.q-item .due.overdue').count(), 1);
    assert.match(await page15.locator('#qCount').innerText(), /1 überfällig/);
    await page15.click('#qFilter button[data-status="all"]');
    await page15.waitForFunction(() => document.querySelectorAll('.q-item').length === 4);
    assert.deepEqual(await groupTitles(), ['Überfällig', 'Später', 'Ohne Termin', 'Beantwortet']);
    await page15.selectOption('#qSort', 'note');
    await page15.waitForFunction(() => document.querySelector('#qList .q-note button') && document.querySelector('#qList .q-note button').textContent === 'Budget');
    await page15.selectOption('#qSort', 'due');
    await page15.click('#qFilter button[data-status="open"]');
    await page15.waitForFunction(() => document.querySelectorAll('.q-item').length === 3);
    // Zentral beantworten lässt den Termin in der Zeile stehen
    await page15.locator('.q-item', { hasText: 'Offerten da?' }).locator('button:has-text("Beantworten")').click();
    await page15.fill('.q-item .q-form textarea', 'Ja, heute gekommen');
    await page15.click('.q-item .q-form button[type="submit"]');
    await page15.waitForFunction(() => document.querySelectorAll('.q-item').length === 2);
    await waitSaved(page15);
    await page15.locator('.q-item').first().locator('button:has-text("Zur Notiz")').click();
    await page15.waitForSelector('body.editor-open');
    assert.ok((await page15.inputValue('#body')).startsWith('? Offerten da? @01.01.2020\n! Ja, heute gekommen\n'));
    await page15.keyboard.press('Escape');
    await page15.waitForSelector('body:not(.editor-open)');
    step('Fragen: Gruppen nach Fälligkeit, Sortierung, Beantworten behält den Termin');

    // Druck nach Fälligkeit gruppiert
    await page15.click('#qPrintBtn');
    await page15.waitForSelector('#qaPrintDialog[open]');
    await page15.check('#qaPrintForm input[name="qaScope"][value="all"]');
    await page15.check('#qaPrintForm input[name="qaGroup"][value="due"]');
    await page15.click('#qaPrintGoBtn');
    await page15.waitForFunction(() => window.__printed.length === 1);
    const qdoc = await page15.evaluate(() => window.__printed[0]);
    assert.ok(qdoc.includes('<h2>Später</h2>') && qdoc.includes('<h2>Ohne Termin</h2>') && qdoc.includes('<h2>Beantwortet</h2>'), 'Gruppen im Druck');
    assert.ok(qdoc.includes('class="due later"') && qdoc.includes('1.1.2030'), 'Termin im Druck');
    // Export nennt den Termin
    await page15.click('#menuBtn');
    await page15.click('#exportBtn');
    await page15.waitForSelector('#exportDialog[open]');
    await page15.click('#exportDirBtn');
    await page15.waitForFunction(() => /Export gespeichert/.test(document.querySelector('#status').textContent));
    const idx15 = await page15.evaluate(() => new TextDecoder().decode(new Uint8Array(window.__exported['index.md'])));
    assert.ok(idx15.includes('- Versicherung? (bis 1.1.2030) — aus [Budget](notes/budget.md)'), 'offene Frage mit Termin in der Übersicht');
    await page15.click('#menuBtn');
    const [dl15] = await Promise.all([page15.waitForEvent('download'), page15.click('#downloadBtn')]);
    const dl15Path = path.join(tmp, 'fragen-termine.sqlite');
    await dl15.saveAs(dl15Path);
    const db15 = new SQL.Database(new Uint8Array(fs.readFileSync(dl15Path)));
    assert.equal(db15.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    assert.deepEqual(db15.exec('SELECT text, due, answer IS NOT NULL FROM questions ORDER BY line_no')[0].values,
      [['Offerten da?', '2020-01-01', 1], ['Versicherung?', '2030-01-01', 0], ['Ohne Termin?', null, 0], ['Fertig?', '2030-02-02', 1]]);
    db15.close();
    assert.deepEqual(errors15, [], 'keine Konsolenfehler bei Fragen mit Termin');
    await ctx15.close();
    step('Fragen: Druck nach Fälligkeit, Export, Index in SQLite');

    // ---------- 16. Listenfortführung, Ein-/Ausrücken, Termin-Abzeichen bei Aufgaben ----------
    const ctx16 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-CH' });
    const { page: page16, errors: errors16 } = await openApp(ctx16, 'list');
    await page16.click('#newBtn');
    await page16.fill('#title', 'Listen');
    const setBody = async (text, pos) => page16.evaluate(([t, p]) => { const b = document.querySelector('#body'); b.value = t; b.dispatchEvent(new Event('input', { bubbles: true })); b.focus(); const at = p == null ? t.length : p; b.setSelectionRange(at, at); }, [text, pos == null ? null : pos]);
    const body = () => page16.inputValue('#body');

    await setBody('- eins');
    await page16.keyboard.press('Enter');
    await page16.keyboard.type('zwei');
    assert.equal(await body(), '- eins\n- zwei');
    await page16.keyboard.press('Tab');
    assert.equal(await body(), '- eins\n  - zwei', 'Tab rückt ein');
    await page16.keyboard.press('Enter');
    assert.equal(await body(), '- eins\n  - zwei\n  - ', 'Einrückung bleibt');
    await page16.keyboard.press('Enter');
    assert.equal(await body(), '- eins\n  - zwei\n- ', 'leeres Element rückt aus');
    await page16.keyboard.press('Enter');
    assert.equal(await body(), '- eins\n  - zwei\n', 'leeres Element beendet die Liste');
    await setBody('1. a\n2. b', 4);
    await page16.keyboard.press('Enter');
    await page16.keyboard.type('x');
    assert.equal(await body(), '1. a\n2. x\n3. b', 'Nummerierung läuft weiter und zählt nach');
    await setBody('- [x] a @01.01.2020');
    await page16.keyboard.press('Enter');
    assert.equal(await body(), '- [x] a @01.01.2020\n- [ ] ', 'Aufgabe: neues offenes Kästchen ohne Termin');
    await setBody('> z');
    await page16.keyboard.press('Enter');
    assert.equal(await body(), '> z\n> ');
    await setBody('! a');
    await page16.keyboard.press('Enter');
    assert.equal(await body(), '! a\n! ');
    await setBody('? f');
    await page16.keyboard.press('Enter');
    assert.equal(await body(), '? f\n', 'Fragen werden nicht weitergeführt');
    await setBody('- a');
    await page16.keyboard.press('Shift+Enter');
    assert.equal(await body(), '- a\n', 'Shift+Enter: normale Zeile');
    await setBody('- a\n  - b');
    await page16.keyboard.press('Shift+Tab');
    assert.equal(await body(), '- a\n- b', 'Shift+Tab rückt aus');
    await setBody('- ab cd', 4);
    await page16.keyboard.press('Enter');
    assert.equal(await body(), '- ab\n-  cd', 'Teilen mitten im Element');
    await setBody('abc');
    await page16.keyboard.press('Tab');
    assert.notEqual(await page16.evaluate(() => document.activeElement && document.activeElement.id), 'body', 'Tab ausserhalb von Listen verlässt das Feld');
    assert.equal(await body(), 'abc');
    await waitSaved(page16);
    step('Editor: Enter führt Listen weiter, Tab rückt ein und aus');

    await setBody('- [ ] Offerte @01.01.2020\n- [x] Fertig @2030-01-01\n? Frage @01.01.2020');
    await page16.click('#modeSwitch button[data-mode="preview"]');
    await page16.waitForSelector('#preview li.task .md-due.overdue');
    assert.equal(await page16.locator('#preview li.task .md-due.overdue').innerText(), 'überfällig · 1.1.2020');
    assert.equal(await page16.locator('#preview li.task.done .md-due').innerText(), '1.1.2030');
    assert.ok(!(await page16.locator('#preview').innerText()).includes('@'), 'Termin nicht mehr als Rohtext');
    assert.equal(await page16.locator('#preview .md-q .md-due.overdue').count(), 1);
    await page16.click('#modeSwitch button[data-mode="edit"]');
    await waitSaved(page16);
    assert.deepEqual(errors16, [], 'keine Konsolenfehler bei Listen');
    await ctx16.close();
    step('Vorschau: Termine von Aufgaben und Fragen als Abzeichen');

    console.log('\nSmoke-Test bestanden.');
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error('\nSmoke-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
