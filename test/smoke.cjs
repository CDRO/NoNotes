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
const SCHEMA_VERSION = '10'; // muss zu js/db.js passen
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

/** Zerlegt eine .ics: Kopfzeilen, Ereignisse mit Eigenschaften (Schlüssel inkl. Parametern) und Erinnerungen.
    Prüft dabei Zeilenenden, Faltung (höchstens 75 Oktette) und die Klammerung. */
function parseIcs(text) {
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'), 'beginnt mit VCALENDAR');
  assert.ok(text.endsWith('END:VCALENDAR\r\n'), 'endet mit VCALENDAR');
  for (const l of text.split('\r\n')) assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `Zeile länger als 75 Oktette: ${l}`);
  const lines = text.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
  const head = {};
  const events = [];
  let ev = null;
  let alarm = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { props: {}, alarms: [] }; continue; }
    if (line === 'END:VEVENT') { events.push(ev); ev = null; continue; }
    if (line === 'BEGIN:VALARM') { alarm = {}; continue; }
    if (line === 'END:VALARM') { ev.alarms.push(alarm); alarm = null; continue; }
    const i = line.indexOf(':');
    (alarm || (ev ? ev.props : head))[line.slice(0, i)] = line.slice(i + 1);
  }
  assert.equal(ev, null, 'VEVENT geschlossen');
  return { head, events };
}

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

    // ---------- 17. Uhrzeiten in Terminen ----------
    const ctx17 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx17.addInitScript(() => {
      window.__printed = [];
      window.print = () => { window.__printed.push(document.getElementById('printArea').innerHTML); };
      window.__exported = {};
      const concat = chunks => { const n = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };
      const makeDir = prefix => ({ kind: 'directory', name: 'Export', getDirectoryHandle: async n => makeDir(prefix + n + '/'), getFileHandle: async n => ({ kind: 'file', name: n, createWritable: async () => { const chunks = []; return { write: async d => { chunks.push(new Uint8Array(d)); }, close: async () => { window.__exported[prefix + n] = Array.from(concat(chunks)); }, abort: async () => {} }; } }) });
      window.showDirectoryPicker = async () => makeDir('');
    });
    const { page: page17, errors: errors17 } = await openApp(ctx17, 'list');
    const now = new Date();
    const pad2 = n => String(n).padStart(2, '0');
    const todayDe = `${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}.${now.getFullYear()}`;
    const todayShort = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
    const todayIso = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    await page17.click('#newBtn');
    await page17.fill('#title', 'Zeiten');
    await page17.fill('#body', `- [ ] Früh @${todayDe} 00:01\n- [ ] Spät @${todayDe} 23.59\n- [ ] Tag @${todayDe}\n? Frage @${todayDe} 23:58`);
    await waitSaved(page17);
    assert.equal(await page17.locator('#viewTasksBtn .count.overdue').count(), 1, 'Termin heute mit vergangener Zeit ist überfällig');
    await page17.click('#modeSwitch button[data-mode="preview"]');
    await page17.waitForSelector('#preview li.task .md-due');
    const badges = await page17.locator('#preview li.task .md-due').allInnerTexts();
    assert.deepEqual(badges, [`überfällig · ${todayShort}, 00:01`, 'heute · 23:59', `heute · ${todayShort}`]);
    assert.equal(await page17.locator('#preview .md-q .md-due').innerText(), 'heute · 23:58');
    await page17.click('#modeSwitch button[data-mode="edit"]');
    step('Zeiten: Erkennung, Überfällig nach Uhrzeit, Anzeige');

    await page17.click('#viewTasksBtn');
    await page17.waitForSelector('body.view-tasks');
    await page17.waitForFunction(() => document.querySelectorAll('.t-item').length === 3);
    const tgroups = await page17.locator('#tList .q-note').allInnerTexts().then(a => a.map(t => t.split('\n')[0].replace(/\s*\d+ Aufgaben?$/, '').trim()));
    assert.deepEqual(tgroups, ['Überfällig', 'Heute']);
    assert.deepEqual(await page17.locator('.t-item .q-text').allInnerTexts(), ['Früh', 'Tag', 'Spät'], 'ohne Zeit vor Zeiten am selben Tag');
    await page17.click('#tPrintBtn');
    await page17.waitForSelector('#taskPrintDialog[open]');
    await page17.click('#taskPrintGoBtn');
    await page17.waitForFunction(() => window.__printed.length === 1);
    const tdoc17 = await page17.evaluate(() => window.__printed[0]);
    assert.ok(tdoc17.includes(`bis ${todayShort}, 23:59`), 'Uhrzeit im Druck');
    await page17.click('#menuBtn');
    await page17.click('#exportBtn');
    await page17.waitForSelector('#exportDialog[open]');
    await page17.click('#exportDirBtn');
    await page17.waitForFunction(() => /Export gespeichert/.test(document.querySelector('#status').textContent));
    const idx17 = await page17.evaluate(() => new TextDecoder().decode(new Uint8Array(window.__exported['index.md'])));
    assert.ok(idx17.includes(`- [ ] Spät (bis ${todayShort}, 23:59)`), 'Uhrzeit im Export');
    await page17.click('#menuBtn');
    const [dl17] = await Promise.all([page17.waitForEvent('download'), page17.click('#downloadBtn')]);
    const dl17Path = path.join(tmp, 'zeiten.sqlite');
    await dl17.saveAs(dl17Path);
    const db17 = new SQL.Database(new Uint8Array(fs.readFileSync(dl17Path)));
    assert.equal(db17.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    assert.deepEqual(db17.exec('SELECT due FROM tasks ORDER BY line_no')[0].values.map(r => r[0]), [`${todayIso}T00:01`, `${todayIso}T23:59`, todayIso]);
    assert.equal(db17.exec('SELECT due FROM questions')[0].values[0][0], `${todayIso}T23:58`);
    db17.close();
    assert.deepEqual(errors17, [], 'keine Konsolenfehler bei Zeiten');
    await ctx17.close();
    step('Zeiten: Liste, Druck, Export, Ablage');

    // ---------- 18. Kalenderexport (.ics) ----------
    const ctx18 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx18.addInitScript(() => {
      window.__ics = [];
      window.__pickerCalls = [];
      // Methoden auf dem Prototyp: so lässt sich das Handle wie ein echtes per structured clone in IndexedDB merken.
      class MockHandle {
        constructor(name) { this.kind = 'file'; this.name = name; }
        async queryPermission() { return 'granted'; }
        async requestPermission() { return 'granted'; }
        async createWritable() {
          const chunks = [];
          return {
            write: async d => { chunks.push(typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d)); },
            close: async () => {
              const total = chunks.reduce((n, c) => n + c.length, 0);
              const out = new Uint8Array(total);
              let o = 0;
              for (const c of chunks) { out.set(c, o); o += c.length; }
              window.__ics.push(new TextDecoder().decode(out));
            },
            abort: async () => {},
          };
        }
      }
      window.showSaveFilePicker = async opts => { window.__pickerCalls.push(opts); return new MockHandle(opts.suggestedName); };
      window.showOpenFilePicker = async () => [];
    });
    const { page: page18, errors: errors18 } = await openApp(ctx18, 'list');
    const longText = 'Sehr lange Aufgabe mit Umlauten äöü, die sicher über die Grenze von fünfundsiebzig Oktetten hinausgeht; mit Komma, Strichpunkt';
    const escIcs = t => t.replace(/,/g, '\\,').replace(/;/g, '\\;');
    await page18.click('#newBtn');
    await page18.fill('#title', 'Termine');
    await page18.fill('#body', [
      '- [ ] Offerte einholen @15.10.2026 14:30',
      '- [x] Bericht abgeben @16.10.2026',
      '- [ ] Ganztag @17.10.2026',
      '- [ ] Ohne Termin',
      `- [ ] ${longText} @20.10.2026`,
      '',
      '? Offene Frage @18.10.2026 09:00',
      '',
      '? Beantwortete Frage @19.10.2026',
      '! Die Antwort',
    ].join('\n'));
    await waitSaved(page18);
    await page18.click('#menuBtn');
    await page18.click('#calendarBtn');
    await page18.waitForSelector('#calDialog[open]');
    assert.equal(await page18.locator('#calSummary').innerText(), '6 Termine: 4 offen, 2 erledigt/beantwortet (als abgesagt)');
    assert.equal(await page18.locator('#calWriteBtn').innerText(), 'Kalenderdatei anlegen…');
    assert.equal(await page18.locator('#calPickBtn').isHidden(), true, 'ohne gemerkte Datei kein «Andere Datei wählen»');
    await page18.click('#calWriteBtn');
    await page18.waitForFunction(() => window.__ics.length === 1);
    await page18.waitForFunction(() => !document.querySelector('#calDialog').open);
    assert.match(await page18.locator('#status').innerText(), /Kalenderdatei „NoNotes\.ics“ aktualisiert: 6 Termine \(Version 1\)/);
    const picker18 = await page18.evaluate(() => window.__pickerCalls);
    assert.equal(picker18.length, 1);
    assert.equal(picker18[0].suggestedName, 'NoNotes.ics');
    assert.deepEqual(picker18[0].types[0].accept, { 'text/calendar': ['.ics'] });
    const ics1 = parseIcs(await page18.evaluate(() => window.__ics[0]));
    assert.equal(ics1.head.VERSION, '2.0');
    assert.equal(ics1.head.METHOD, 'PUBLISH');
    assert.match(ics1.head['X-WR-CALNAME'], /^NoNotes · /);
    assert.deepEqual(ics1.events.map(e => e.props.SUMMARY), [
      'Aufgabe: Offerte einholen', 'Erledigt: Bericht abgeben', 'Aufgabe: Ganztag', 'Frage: Offene Frage',
      'Beantwortet: Beantwortete Frage', `Aufgabe: ${escIcs(longText)}`,
    ], 'nach Termin sortiert, Text escaped');
    const bySummary = evs => Object.fromEntries(evs.map(e => [e.props.SUMMARY, e]));
    const e1 = bySummary(ics1.events);
    const offerte = e1['Aufgabe: Offerte einholen'];
    assert.equal(offerte.props.DTSTART, '20261015T143000');
    assert.equal(offerte.props.DTEND, '20261015T150000', 'mit Uhrzeit 30 Minuten');
    assert.equal(offerte.props.STATUS, 'CONFIRMED');
    assert.deepEqual(offerte.alarms.map(a => a.TRIGGER), ['-PT30M']);
    assert.ok(offerte.props.DESCRIPTION.includes('Notiz: Termine'), 'Beschreibung nennt die Notiz');
    const ganztag = e1['Aufgabe: Ganztag'];
    assert.equal(ganztag.props['DTSTART;VALUE=DATE'], '20261017');
    assert.equal(ganztag.props['DTEND;VALUE=DATE'], '20261018', 'ohne Uhrzeit ganztägig');
    assert.deepEqual(ganztag.alarms.map(a => a.TRIGGER), ['-PT15H'], 'Vortag 9 Uhr');
    const bericht = e1['Erledigt: Bericht abgeben'];
    assert.equal(bericht.props.STATUS, 'CANCELLED');
    assert.equal(bericht.alarms.length, 0, 'abgesagte Termine ohne Erinnerung');
    const frage = e1['Frage: Offene Frage'];
    assert.equal(frage.props.DTSTART, '20261018T090000');
    assert.equal(frage.props.DTEND, '20261018T093000');
    const beantwortet = e1['Beantwortet: Beantwortete Frage'];
    assert.equal(beantwortet.props.STATUS, 'CANCELLED');
    assert.ok(beantwortet.props.DESCRIPTION.includes('\\nAntwort: Die Antwort'), 'Antwort in der Beschreibung');
    const uids1 = ics1.events.map(e => e.props.UID);
    assert.equal(new Set(uids1).size, 6, 'UIDs eindeutig');
    for (const u of uids1) assert.match(u, /^nonotes-[0-9a-f]{16}-(task|question)-\d+@nonotes\.local$/);
    assert.ok(ics1.events.every(e => e.props.SEQUENCE === '1' && /^\d{8}T\d{6}Z$/.test(e.props.DTSTAMP)));
    step('Kalender: .ics anlegen, Termine, Status, Erinnerungen, Faltung');

    // Termin verschieben, Aufgabe abhaken, Aufgabe umformulieren: gleiche UIDs, höhere SEQUENCE, Entferntes abgesagt.
    await page18.fill('#body', (await page18.inputValue('#body'))
      .replace('Offerte einholen @15.10.2026 14:30', 'Offerte einholen @22.10.2026 16:00')
      .replace('- [ ] Ganztag', '- [x] Ganztag')
      .replace(`${longText} @20.10.2026`, 'Kurz @20.10.2026'));
    await waitSaved(page18);
    await page18.click('#menuBtn');
    await page18.click('#calendarBtn');
    await page18.waitForSelector('#calDialog[open]');
    assert.equal(await page18.locator('#calSummary').innerText(), '7 Termine: 3 offen, 3 erledigt/beantwortet (als abgesagt), 1 entfernt (als abgesagt)');
    assert.equal(await page18.locator('#calWriteBtn').innerText(), 'Kalenderdatei aktualisieren');
    assert.equal(await page18.locator('#calPickBtn').isVisible(), true);
    assert.match(await page18.locator('#calFileInfo').innerText(), /Gemerkte Datei: „NoNotes\.ics“/);
    await page18.click('#calWriteBtn');
    await page18.waitForFunction(() => window.__ics.length === 2);
    assert.equal(await page18.evaluate(() => window.__pickerCalls.length), 1, 'gemerkte Datei, kein neuer Speicherdialog');
    const ics2 = parseIcs(await page18.evaluate(() => window.__ics[1]));
    assert.equal(ics2.events.length, 7);
    assert.ok(ics2.events.every(e => e.props.SEQUENCE === '2'), 'SEQUENCE erhöht');
    const e2 = bySummary(ics2.events);
    assert.equal(e2['Aufgabe: Offerte einholen'].props.UID, offerte.props.UID, 'verschobener Termin behält die UID');
    assert.equal(e2['Aufgabe: Offerte einholen'].props.DTSTART, '20261022T160000');
    assert.equal(e2['Erledigt: Ganztag'].props.UID, ganztag.props.UID, 'abgehakte Aufgabe behält die UID');
    assert.equal(e2['Erledigt: Ganztag'].props.STATUS, 'CANCELLED');
    const removed = e2[`Entfernt: ${escIcs(longText)}`];
    assert.ok(removed, 'umformulierte Aufgabe wird unter alter UID abgesagt');
    assert.equal(removed.props.UID, e1[`Aufgabe: ${escIcs(longText)}`].props.UID);
    assert.equal(removed.props.STATUS, 'CANCELLED');
    assert.equal(removed.props['DTSTART;VALUE=DATE'], '20261020');
    assert.equal(removed.alarms.length, 0);
    const uids2 = ics2.events.map(e => e.props.UID);
    assert.equal(new Set(uids2).size, 7);
    assert.ok(uids1.every(u => uids2.includes(u)), 'alle bisherigen UIDs sind weiterhin enthalten');
    assert.ok(uids2.includes(e2['Aufgabe: Kurz'].props.UID) && !uids1.includes(e2['Aufgabe: Kurz'].props.UID), 'neuer Text, neue UID');
    step('Kalender: erneuter Export aktualisiert statt zu duplizieren');

    // Herunterladen ohne Abgesagte und ohne Erinnerungen.
    await page18.click('#menuBtn');
    await page18.click('#calendarBtn');
    await page18.waitForSelector('#calDialog[open]');
    await page18.click('#calIncludeDone');
    await page18.waitForFunction(() => document.querySelector('#calSummary').textContent === '3 Termine: 3 offen');
    await page18.click('#calAlarms');
    const [dlIcs] = await Promise.all([page18.waitForEvent('download'), page18.click('#calDownloadBtn')]);
    assert.equal(dlIcs.suggestedFilename(), 'NoNotes.ics');
    const icsPath = path.join(tmp, 'NoNotes.ics');
    await dlIcs.saveAs(icsPath);
    const ics3 = parseIcs(fs.readFileSync(icsPath, 'utf8'));
    assert.deepEqual(ics3.events.map(e => e.props.SUMMARY), ['Frage: Offene Frage', 'Aufgabe: Kurz', 'Aufgabe: Offerte einholen']);
    assert.ok(ics3.events.every(e => e.props.STATUS === 'CONFIRMED' && e.props.SEQUENCE === '3' && e.alarms.length === 0));
    assert.match(await page18.locator('#status').innerText(), /Kalenderdatei heruntergeladen: 3 Termine \(Version 3\)/);
    await waitSaved(page18);

    // Gemerkte Datei und Kennung überleben das Neuladen; alles liegt in der Datenbank.
    await page18.reload();
    await page18.waitForSelector(READY);
    await page18.click('#menuBtn');
    await page18.click('#calendarBtn');
    await page18.waitForSelector('#calDialog[open]');
    assert.match(await page18.locator('#calFileInfo').innerText(), /Gemerkte Datei: „NoNotes\.ics“/, 'Kalenderdatei bleibt gemerkt');
    await page18.evaluate(() => document.querySelector('#calDialog').close());
    await page18.click('#menuBtn');
    const [dl18] = await Promise.all([page18.waitForEvent('download'), page18.click('#downloadBtn')]);
    const dl18Path = path.join(tmp, 'kalender.sqlite');
    await dl18.saveAs(dl18Path);
    const db18 = new SQL.Database(new Uint8Array(fs.readFileSync(dl18Path)));
    const meta18 = Object.fromEntries(db18.exec("SELECT key, value FROM meta WHERE key LIKE 'calendar_%'")[0].values);
    assert.match(meta18.calendar_uid, /^[0-9a-f]{16}$/);
    assert.equal(String(meta18.calendar_sequence), '3');
    assert.ok(uids1.every(u => u.includes(`-${meta18.calendar_uid}-`)), 'UIDs tragen die Kennung der Datenbank');
    assert.deepEqual(Object.keys(JSON.parse(meta18.calendar_known)).sort(), [...uids2].sort(), 'alle je exportierten Termine bleiben bekannt');
    db18.close();
    assert.deepEqual(errors18, [], 'keine Konsolenfehler beim Kalenderexport');
    await ctx18.close();
    step('Kalender: Herunterladen ohne Abgesagte, gemerkte Datei, Kennung in der Datenbank');

    // ---------- 19. Listenarten, Listen in Antworten, Links in den zentralen Listen und im Druck ----------
    const ctx19 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx19.addInitScript(() => {
      window.__printed = [];
      window.print = () => { window.__printed.push(document.getElementById('printArea').innerHTML); };
    });
    const { page: page19, errors: errors19 } = await openApp(ctx19, 'list');
    const md19 = (src) => page19.evaluate(s => window.NoNotesMarkdown.render(s), src);
    assert.equal(await md19('- a\n- b\n1. eins\n2. zwei'), '<ul><li>a</li><li>b</li></ul><ol><li>eins</li><li>zwei</li></ol>', 'Nummerierung direkt nach Bullets');
    assert.match(await md19('- [ ] Aufgabe\n1. eins'), /<\/ul><ol><li>eins<\/li><\/ol>$/, 'Nummerierung direkt nach Aufgabe');
    assert.equal(await md19('1. eins\n- a'), '<ol><li>eins</li></ol><ul><li>a</li></ul>');
    assert.equal(await md19('- a\n  - b\n  1. c\n- d'), '<ul><li>a<ul><li>b</li></ul><ol><li>c</li></ol></li><li>d</li></ul>', 'Wechsel in verschachtelter Liste');
    assert.equal(await md19('1. eins\n2. zwei'), '<ol><li>eins</li><li>zwei</li></ol>', 'gleiche Art bleibt eine Liste');
    assert.equal(await md19('> - a\n> 1. b'), '<blockquote><ul><li>a</li></ul><ol><li>b</li></ol></blockquote>', 'auch im Zitat');
    step('Markdown: Wechsel zwischen Bullet- und nummerierter Liste beginnt neue Liste');

    await page19.click('#newBtn');
    await page19.fill('#title', 'Ziel');
    await page19.fill('#body', 'Zielnotiz');
    await waitSaved(page19);
    await page19.click('#newBtn');
    await page19.fill('#title', 'Quelle');
    await page19.fill('#body', [
      '- [ ] Mail an [[Ziel]] mit **Anhang** und [Google](https://google.com)',
      '- [ ] Zweite Aufgabe [[Gibtsnicht]]',
      '',
      '? Was steht in [[Ziel]]?',
      '! 1. eins',
      '! 2. zwei',
      '',
      '? Kurz?',
      '! Ja',
    ].join('\n'));
    await waitSaved(page19);
    await page19.click('#modeSwitch button[data-mode="preview"]');
    await page19.waitForSelector('#preview .md-a ol');
    assert.equal(await page19.locator('#preview .md-a ol li').count(), 2, 'Liste in der Antwort der Vorschau');
    assert.equal(await page19.locator('#preview li.task a.md-wiki[data-note-id]').count(), 1);
    await page19.click('#modeSwitch button[data-mode="edit"]');
    step('Vorschau: Liste in der Antwort, Verweis in der Aufgabe');

    await page19.click('#viewTasksBtn');
    await page19.waitForSelector('body.view-tasks');
    await page19.waitForFunction(() => document.querySelectorAll('.t-item').length === 2);
    const t1 = page19.locator('.t-item').first();
    assert.equal(await t1.locator('.q-text').innerText(), 'Mail an Ziel mit Anhang und Google', 'Markdown in der Aufgabenliste gerendert');
    assert.equal(await t1.locator('.q-text strong').count(), 1);
    assert.equal(await t1.locator('.q-text a[href="https://google.com"][target="_blank"]').count(), 1, 'externer Link');
    assert.equal(await page19.locator('.t-item a.md-wiki.missing').count(), 1, 'fehlender Verweis gekennzeichnet');
    await page19.click('.t-item a.md-wiki.missing');
    await page19.waitForFunction(() => /keine Notiz „Gibtsnicht“/.test(document.querySelector('#status').textContent));
    assert.equal(await page19.locator('body.view-tasks').count(), 1, 'fehlender Verweis bleibt in der Liste');
    await t1.locator('.q-text a.md-wiki').click();
    await page19.waitForSelector('body.editor-open');
    await page19.waitForFunction(() => document.querySelector('#title').value === 'Ziel');
    await page19.keyboard.press('Escape');
    await page19.waitForSelector('body:not(.editor-open)');
    step('Aufgabenliste: Formatierung, Link, Verweis öffnet die Notiz');

    await page19.click('#viewQuestionsBtn');
    await page19.waitForSelector('body.view-questions');
    await page19.click('#qFilter button[data-status="all"]');
    await page19.waitForFunction(() => document.querySelectorAll('.q-item:not(.t-item)').length === 2);
    const q1 = page19.locator('.q-item:not(.t-item)').first();
    assert.equal(await q1.locator('.q-text a.md-wiki').innerText(), 'Ziel', 'Verweis im Fragetext');
    assert.equal(await q1.locator('.q-answer ol li').count(), 2, 'Liste in der Antwort der Fragenliste');
    await q1.locator('.q-text a.md-wiki').click();
    await page19.waitForSelector('body.editor-open');
    await page19.waitForFunction(() => document.querySelector('#title').value === 'Ziel');
    await page19.keyboard.press('Escape');
    await page19.waitForSelector('body:not(.editor-open)');
    step('Fragenliste: Verweis und Liste in der Antwort');

    await page19.click('#qPrintBtn');
    await page19.waitForSelector('#qaPrintDialog[open]');
    await page19.click('#qaPrintGoBtn');
    await page19.waitForFunction(() => window.__printed.length === 1);
    const qaDoc19 = await page19.evaluate(() => window.__printed[0]);
    assert.ok(/<div class="print-a md"><ol><li>eins<\/li><li>zwei<\/li><\/ol><\/div>/.test(qaDoc19), 'Liste in der gedruckten Antwort');
    assert.ok(/print-q-text">Was steht in <a href="#" class="md-wiki" data-title="Ziel" data-note-id="\d+">Ziel<\/a>\?/.test(qaDoc19), 'Verweis im gedruckten Fragetext');
    await page19.click('#viewTasksBtn');
    await page19.waitForSelector('body.view-tasks');
    await page19.click('#tPrintBtn');
    await page19.waitForSelector('#taskPrintDialog[open]');
    await page19.click('#taskPrintGoBtn');
    await page19.waitForFunction(() => window.__printed.length === 2);
    const tDoc19 = await page19.evaluate(() => window.__printed[1]);
    assert.ok(tDoc19.includes('<a href="https://google.com" target="_blank" rel="noopener noreferrer">Google</a>'), 'Link in der gedruckten Checkliste');
    assert.ok(tDoc19.includes('<strong>Anhang</strong>'));
    step('Druck: Markdown in Fragen und Antworten und in der Checkliste');

    await page19.click('#menuBtn');
    await page19.click('#exportBtn');
    await page19.waitForSelector('#exportDialog[open]');
    const [dl19] = await Promise.all([page19.waitForEvent('download'), page19.click('#exportZipBtn')]);
    const zip19Path = path.join(tmp, 'listen.zip');
    await dl19.saveAs(zip19Path);
    const files19 = readZip(fs.readFileSync(zip19Path));
    const quelle19 = new TextDecoder().decode(files19[Object.keys(files19).find(n => /notes\/.*quelle.*\.md$/i.test(n))]);
    assert.ok(quelle19.includes('> **Frage (beantwortet):** Was steht in [Ziel]('), 'Verweis im Export verlinkt');
    assert.ok(quelle19.includes('> **Antwort:**\n> 1. eins\n> 2. zwei'), 'mehrzeilige Antwort bleibt Liste');
    assert.ok(quelle19.includes('> **Antwort:** Ja'), 'einzeilige Antwort bleibt in der Zeile');
    assert.deepEqual(errors19, [], 'keine Konsolenfehler bei Listen und Links');
    await ctx19.close();
    step('Export: Listen in Antworten bleiben Listen');

    // ---------- 20. Geteilte Ansicht: synchrones Scrollen ----------
    const ctx20 = await browser.newContext({ viewport: { width: 1280, height: 700 }, locale: 'de-CH' });
    const { page: page20, errors: errors20 } = await openApp(ctx20, 'list');
    await page20.click('#newBtn');
    await page20.fill('#title', 'Lang');
    const lines20 = [];
    for (let k = 0; k < 120; k++) lines20.push(k % 10 === 0 ? `## Abschnitt ${k}` : (k % 10 === 5 ? `Zeile ${k} ` + 'sehr langer Text, der in der schmalen Spalte des Editors bestimmt mehrfach umbricht und so die Messung der Zeilenhöhe fordert. '.repeat(3) : `Zeile ${k}`));
    await page20.fill('#body', lines20.join('\n\n')); // Quellzeile 2k = Absatz k
    await waitSaved(page20);
    await page20.click('#modeSwitch button[data-mode="split"]');
    await page20.waitForSelector('#editorPane.mode-split');
    await page20.waitForSelector('#preview [data-line="238"]');
    assert.equal(await page20.locator('#preview h2[data-line="0"]').count(), 1, 'Blöcke tragen die Quellzeile');
    assert.equal(await page20.locator('#preview p[data-line="2"]').count(), 1);
    const mirrorTop = line => page20.evaluate(n => document.querySelector('#bodyMirror').children[n].offsetTop, line);
    const previewOffset = line => page20.evaluate(n => { const p = document.querySelector('#preview'); const e = p.querySelector(`[data-line="${n}"]`); return e.getBoundingClientRect().top - p.getBoundingClientRect().top; }, line);

    // Editor führt: Quellzeile 120 (Absatz 60) an die Oberkante → Vorschau zeigt denselben Block oben.
    await page20.hover('#body');
    await page20.evaluate(() => { document.querySelector('#body').dispatchEvent(new Event('scroll')); }); // Spiegel aufbauen
    const target20 = await mirrorTop(120);
    assert.ok(target20 > 1000, 'Spiegel misst Zeilenhöhen');
    await page20.evaluate(t => { document.querySelector('#body').scrollTop = t; }, target20);
    await page20.waitForFunction(() => { const p = document.querySelector('#preview'); const e = p.querySelector('[data-line="120"]'); return Math.abs(e.getBoundingClientRect().top - p.getBoundingClientRect().top) < 3; });
    const editorBefore = await page20.evaluate(() => document.querySelector('#body').scrollTop);
    await page20.waitForTimeout(300);
    assert.equal(await page20.evaluate(() => document.querySelector('#body').scrollTop), editorBefore, 'Vorschau stösst den Editor nicht zurück');
    step('Geteilt: Editor scrollt, Vorschau folgt zeilengenau');

    // Vorschau führt: Block von Quellzeile 40 an die Oberkante → Editor zeigt Zeile 40 oben.
    await page20.hover('#preview');
    await page20.evaluate(() => { const p = document.querySelector('#preview'); const e = p.querySelector('[data-line="40"]'); p.scrollTop += e.getBoundingClientRect().top - p.getBoundingClientRect().top; });
    const want20 = await mirrorTop(40);
    await page20.waitForFunction(w => Math.abs(document.querySelector('#body').scrollTop - w) < 3, want20);
    const previewBefore = await page20.evaluate(() => document.querySelector('#preview').scrollTop);
    await page20.waitForTimeout(300);
    assert.equal(await page20.evaluate(() => document.querySelector('#preview').scrollTop), previewBefore, 'Editor stösst die Vorschau nicht zurück');
    assert.ok(Math.abs(await previewOffset(40)) < 3, 'Vorschau bleibt, wo der Benutzer sie hingescrollt hat');

    // Ende an Ende: Editor ganz unten → Vorschau ganz unten. Umbrochene Zeilen stimmen ebenfalls.
    await page20.hover('#body');
    await page20.evaluate(() => { const b = document.querySelector('#body'); b.scrollTop = b.scrollHeight; });
    await page20.waitForFunction(() => { const p = document.querySelector('#preview'); return p.scrollTop >= p.scrollHeight - p.clientHeight - 1; });
    const wrapTop = await mirrorTop(210); // Quellzeile 210 = Absatz 105, der lange Absatz
    await page20.evaluate(t => { document.querySelector('#body').scrollTop = t; }, wrapTop);
    await page20.waitForFunction(() => { const p = document.querySelector('#preview'); const e = p.querySelector('[data-line="210"]'); return Math.abs(e.getBoundingClientRect().top - p.getBoundingClientRect().top) < 3; });
    // Nach einer Änderung bleibt die Vorschau am Editor ausgerichtet.
    await page20.focus('#body');
    await page20.evaluate(() => { const b = document.querySelector('#body'); b.setSelectionRange(0, 0); });
    await page20.keyboard.type('# Neu oben\n');
    await page20.waitForFunction(() => document.querySelector('#preview h1[data-line="0"]'));
    await page20.waitForFunction(() => { const b = document.querySelector('#body'); const p = document.querySelector('#preview'); if (b.scrollTop > 2) return false; return p.scrollTop < 2; }, null, { timeout: 5000 }).catch(() => {});
    const bodyTop = await page20.evaluate(() => document.querySelector('#body').scrollTop);
    const line20 = await page20.evaluate(() => { const m = document.querySelector('#bodyMirror'); const st = document.querySelector('#body').scrollTop; let i = 0; while (i + 1 < m.children.length && m.children[i + 1].offsetTop <= st) i++; return i; });
    const anchor20 = await page20.evaluate(l => { const p = document.querySelector('#preview'); let best = null; for (const e of p.querySelectorAll('[data-line]')) { const n = Number(e.dataset.line); if (n <= l && (!best || n > Number(best.dataset.line))) best = e; } return best ? Math.abs(best.getBoundingClientRect().top - p.getBoundingClientRect().top) : 9999; }, line20);
    assert.ok(anchor20 < 60, `Vorschau bleibt nach dem Tippen ausgerichtet (Abstand ${anchor20}px, Editor bei ${bodyTop}px, Zeile ${line20})`);
    assert.deepEqual(errors20, [], 'keine Konsolenfehler beim synchronen Scrollen');
    await ctx20.close();
    step('Geteilt: Vorschau scrollt, Editor folgt; Ende an Ende; umbrochene Zeilen; nach Änderung ausgerichtet');

    // ---------- 21. Unteraufgaben ----------
    const ctx21 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx21.addInitScript(() => {
      window.__printed = [];
      window.print = () => { window.__printed.push(document.getElementById('printArea').innerHTML); };
      window.__exported = {};
      const concat = chunks => { const n = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };
      const makeDir = prefix => ({ kind: 'directory', name: 'Export', getDirectoryHandle: async n => makeDir(prefix + n + '/'), getFileHandle: async n => ({ kind: 'file', name: n, createWritable: async () => { const chunks = []; return { write: async d => { chunks.push(new Uint8Array(d)); }, close: async () => { window.__exported[prefix + n] = Array.from(concat(chunks)); }, abort: async () => {} }; } }) });
      window.showDirectoryPicker = async () => makeDir('');
    });
    const { page: page21, errors: errors21 } = await openApp(ctx21, 'list');

    // Reine Textlogik
    const logic21 = await page21.evaluate(() => {
      const T = window.NoNotesTasks;
      const body = ['- [ ] Haupt', '  - [ ] A', '    - [x] Enkel', '  - [x] B', 'Zwischentext', '- [ ] Zweite', '\t- [ ] Tab-Unter', '', '- Bullet', '  - [ ] Kind eines Bullets'].join('\n');
      const p = T.parse(body);
      const all = T.completeTree(body, 0);
      return {
        tree: p.map(t => `${t.text}:${t.depth}:${t.parent}`),
        open: [T.openSubtasks(body, 0), T.openSubtasks(body, 1), T.openSubtasks(body, 2)],
        all: all.split('\n').slice(0, 4),
        reopened: T.reopen(all, 2).split('\n').slice(0, 4),
        dbl: [T.doubleClick(body, 0).action, T.doubleClick(all, 0).action, T.doubleClick(body, 7 - 1).action],
        text: T.openMessage(1) + ' / ' + T.openMessage(3),
      };
    });
    assert.deepEqual(logic21.tree, ['Haupt:0:-1', 'A:1:0', 'Enkel:2:1', 'B:1:0', 'Zweite:0:-1', 'Tab-Unter:1:4', 'Kind eines Bullets:0:-1'], 'Hierarchie über die Einrückung, Text ohne Kästchen beendet den Teilbaum');
    assert.deepEqual(logic21.open, [1, 0, 0]);
    assert.deepEqual(logic21.all, ['- [x] Haupt', '  - [x] A', '    - [x] Enkel', '  - [x] B']);
    assert.deepEqual(logic21.reopened, ['- [ ] Haupt', '  - [ ] A', '    - [ ] Enkel', '  - [x] B'], 'Öffnen einer Unteraufgabe öffnet die Hauptaufgaben darüber');
    assert.deepEqual(logic21.dbl, ['completed', 'reopened', 'completed']);
    assert.equal(logic21.text, '1 Unteraufgabe ist noch offen / 3 Unteraufgaben sind noch offen');
    step('Unteraufgaben: Hierarchie, Abschluss- und Öffnen-Regeln als Textfunktionen');

    await page21.click('#newBtn');
    await page21.fill('#title', 'Projekt');
    await page21.fill('#body', ['- [ ] Haupt @15.10.2026', '  - [ ] Unter A @12.10.2026', '    - [ ] Enkel', '  - [ ] Unter B', '- [ ] Einzel'].join('\n'));
    await waitSaved(page21);
    await page21.click('#viewTasksBtn');
    await page21.waitForSelector('body.view-tasks');
    await page21.waitForFunction(() => document.querySelectorAll('.t-item').length === 5);
    const row21 = text => page21.locator('.t-item').filter({ has: page21.locator('.q-text', { hasText: new RegExp('^' + text + '$') }) });
    const progress21 = async text => (await row21(text).locator('.t-progress').allInnerTexts())[0] || null;
    assert.equal(await progress21('Haupt'), '0/3', 'Fortschritt der Hauptaufgabe zählt alle Unteraufgaben');
    assert.equal(await progress21('Unter A'), '0/1');
    assert.equal(await progress21('Unter B'), null);
    assert.equal(await progress21('Einzel'), null);
    assert.equal(await row21('Unter A').locator('.t-part').innerText(), 'Teil von „Haupt“');
    assert.equal(await row21('Enkel').locator('.t-part').innerText(), 'Teil von „Unter A“');
    assert.equal(await row21('Haupt').locator('.t-part').count(), 0);
    step('Aufgabenliste: Fortschritt «0/3» und «Teil von …»');

    // Abhaken mit offenen Unteraufgaben wird verweigert
    await row21('Haupt').locator('.t-check').click();
    await page21.waitForFunction(() => /3 Unteraufgaben sind noch offen/.test(document.querySelector('#status').textContent));
    assert.equal(await page21.locator('.t-item.done').count(), 0, 'Kästchen bleibt offen');
    assert.equal(await row21('Haupt').locator('.t-check').isChecked(), false);
    await row21('Unter A').locator('.t-check').click();
    await page21.waitForFunction(() => /1 Unteraufgabe ist noch offen/.test(document.querySelector('#status').textContent));
    // Von unten nach oben abhaken
    await row21('Enkel').locator('.t-check').click();
    await page21.waitForFunction(() => document.querySelectorAll('.t-item').length === 4);
    assert.equal(await progress21('Haupt'), '1/3');
    await row21('Unter A').locator('.t-check').click();
    await page21.waitForFunction(() => document.querySelectorAll('.t-item').length === 3);
    assert.equal(await progress21('Haupt'), '2/3');
    await row21('Haupt').locator('.t-check').click();
    await page21.waitForFunction(() => /1 Unteraufgabe ist noch offen/.test(document.querySelector('#status').textContent));
    await row21('Unter B').locator('.t-check').click();
    await page21.waitForFunction(() => document.querySelectorAll('.t-item').length === 2);
    await row21('Haupt').locator('.t-check').click();
    await page21.waitForFunction(() => document.querySelectorAll('.t-item').length === 1);
    assert.equal(await row21('Einzel').count(), 1);
    step('Aufgabenliste: Abhaken erst nach den Unteraufgaben');

    // Doppelklick: alles erledigt → öffnet nur die Hauptaufgabe; ist etwas offen → schliesst die ganze Gruppe ab
    await page21.click('#tFilter button[data-status="all"]');
    await page21.waitForFunction(() => document.querySelectorAll('.t-item').length === 5);
    assert.equal(await page21.locator('.t-item.done').count(), 4, 'Haupt samt Unteraufgaben ist erledigt');
    await row21('Haupt').locator('.q-text').dblclick();
    await page21.waitForFunction(() => document.querySelectorAll('.t-item.done').length === 3 && document.querySelectorAll('.t-item.open').length === 2);
    assert.equal(await row21('Haupt').evaluate(e => e.classList.contains('open')), true, 'Doppelklick auf eine vollständig erledigte Aufgabe öffnet nur sie');
    assert.equal(await progress21('Haupt'), '3/3');
    assert.match(await page21.locator('#status').innerText(), /Aufgabe wieder geöffnet/);
    await row21('Haupt').locator('.q-text').dblclick();
    await page21.waitForFunction(() => document.querySelectorAll('.t-item.done').length === 4);
    assert.match(await page21.locator('#status').innerText(), /Aufgabe mit allen Unteraufgaben erledigt/);
    // Teilweise offen: Doppelklick auf eine Unteraufgabe schliesst deren Gruppe ab, die Hauptaufgabe bleibt
    await row21('Enkel').locator('.t-check').click();
    await page21.waitForFunction(() => document.querySelectorAll('.t-item.done').length === 1); // nur Unter B bleibt erledigt
    await row21('Unter A').locator('.q-text').dblclick();
    await page21.waitForFunction(() => document.querySelectorAll('.t-item.done').length === 3);
    assert.equal(await row21('Enkel').evaluate(e => e.classList.contains('done')), true);
    assert.equal(await row21('Haupt').evaluate(e => e.classList.contains('open')), true, 'Hauptaufgabe bleibt offen, bis sie selbst abgeschlossen wird');
    await row21('Haupt').locator('.q-text').dblclick();
    await page21.waitForFunction(() => document.querySelectorAll('.t-item.done').length === 4);
    // Unteraufgabe öffnen: erledigte Hauptaufgaben darüber werden mit geöffnet
    await row21('Enkel').locator('.t-check').click();
    await page21.waitForFunction(() => document.querySelectorAll('.t-item.done').length === 1);
    for (const t of ['Haupt', 'Unter A', 'Enkel']) assert.equal(await row21(t).evaluate(e => e.classList.contains('open')), true, `${t} ist offen`);
    assert.equal(await row21('Unter B').evaluate(e => e.classList.contains('done')), true, 'Geschwister bleibt erledigt');
    step('Aufgabenliste: Doppelklick schliesst alles ab bzw. öffnet nur die Aufgabe, Öffnen wirkt nach oben');

    // Sortierung nach Notiz: eingerückt; von Hand getipptes [x] zeigt den Hinweis
    await page21.selectOption('#tSort', 'note');
    await page21.waitForFunction(() => document.querySelectorAll('.t-item .t-part').length === 0);
    assert.deepEqual(await Promise.all(['Haupt', 'Unter A', 'Enkel'].map(t => row21(t).evaluate(e => e.style.marginLeft))), ['', '24px', '48px']);
    await page21.selectOption('#tSort', 'due');
    await row21('Haupt').locator('button:has-text("Zur Notiz")').click();
    await page21.waitForSelector('body.editor-open');
    await page21.fill('#body', ['- [x] Haupt @15.10.2026', '  - [ ] Unter A @12.10.2026', '    - [ ] Enkel', '  - [x] Unter B', '- [ ] Einzel'].join('\n'));
    await waitSaved(page21);
    await page21.keyboard.press('Escape');
    await page21.waitForSelector('body:not(.editor-open)');
    const hint21 = await row21('Haupt').locator('.t-progress.warn').innerText();
    assert.equal(hint21, '1/3 · Unteraufgaben offen', 'Haupt ist von Hand erledigt, Unteraufgaben sind offen');
    assert.equal(await row21('Haupt').evaluate(e => e.classList.contains('done')), true);
    step('Aufgabenliste: Einrückung nach Notiz, Hinweis bei von Hand erledigter Hauptaufgabe');

    // Vorschau: Kästchen verweigert, Fortschritt als Abzeichen, Doppelklick, Öffnen nach oben
    await page21.click('#viewListBtn');
    await page21.waitForSelector('body.view-list');
    await page21.locator('#list li').first().click();
    await page21.waitForFunction(() => document.querySelector('#title').value === 'Projekt');
    await page21.fill('#body', ['- [ ] Haupt @15.10.2026', '  - [ ] Unter A @12.10.2026', '    - [ ] Enkel', '  - [ ] Unter B', '- [ ] Einzel'].join('\n'));
    await waitSaved(page21);
    await page21.click('#modeSwitch button[data-mode="preview"]');
    await page21.waitForSelector('#preview li.task');
    assert.deepEqual(await page21.locator('#preview .md-progress').allInnerTexts(), ['0/3', '0/1']);
    await page21.locator('#preview li.task input').first().click();
    await page21.waitForFunction(() => /3 Unteraufgaben sind noch offen/.test(document.querySelector('#status').textContent));
    assert.equal(await page21.locator('#preview li.task input').first().isChecked(), false, 'Kästchen der Hauptaufgabe bleibt offen');
    assert.ok(!(await page21.inputValue('#body')).includes('[x]'), 'Text unverändert');
    await page21.locator('#preview li.task').first().dblclick({ position: { x: 70, y: 10 } });
    await page21.waitForFunction(() => document.querySelector('#body').value.split('\n').filter(l => l.includes('[x]')).length === 4);
    assert.equal(await page21.inputValue('#body'), ['- [x] Haupt @15.10.2026', '  - [x] Unter A @12.10.2026', '    - [x] Enkel', '  - [x] Unter B', '- [ ] Einzel'].join('\n'), 'Doppelklick schliesst die ganze Gruppe ab');
    assert.deepEqual(await page21.locator('#preview .md-progress').allInnerTexts(), ['3/3', '1/1']);
    assert.equal(await page21.locator('#preview .md-progress.complete').count(), 2);
    const deco21 = await page21.evaluate(() => { const li = document.querySelector('#preview li.task.done'); return [getComputedStyle(li).textDecorationLine, getComputedStyle(li.querySelector(':scope > .task-text')).textDecorationLine]; });
    assert.deepEqual(deco21, ['none', 'line-through'], 'Durchstreichen nur am Text der Aufgabe, nicht an ihren Unteraufgaben');
    await page21.locator('#preview li.task input').nth(2).click(); // Enkel wieder öffnen
    await page21.waitForFunction(() => document.querySelector('#body').value.split('\n').filter(l => l.includes('[ ]')).length === 4);
    assert.equal(await page21.inputValue('#body'), ['- [ ] Haupt @15.10.2026', '  - [ ] Unter A @12.10.2026', '    - [ ] Enkel', '  - [x] Unter B', '- [ ] Einzel'].join('\n'), 'Hauptaufgaben darüber geöffnet');
    await page21.locator('#preview li.task').nth(2).dblclick({ position: { x: 60, y: 8 } }); // Enkel ohne Unteraufgaben
    await page21.waitForFunction(() => document.querySelector('#body').value.includes('[x] Enkel'));
    await page21.click('#modeSwitch button[data-mode="edit"]');
    await waitSaved(page21);
    step('Vorschau: Abzeichen, Kästchen verweigert, Doppelklick, Öffnen nach oben');

    // Druck als Checkliste nach Notiz und Export
    await page21.fill('#body', ['- [ ] Haupt', '  - [x] Unter A', '- [ ] Einzel'].join('\n'));
    await waitSaved(page21);
    await page21.click('#viewTasksBtn');
    await page21.waitForSelector('body.view-tasks');
    await page21.click('#tPrintBtn');
    await page21.waitForSelector('#taskPrintDialog[open]');
    await page21.check('#taskPrintForm input[name="taskScope"][value="all"]');
    await page21.check('#taskPrintForm input[name="taskGroup"][value="note"]');
    await page21.click('#taskPrintGoBtn');
    await page21.waitForFunction(() => window.__printed.length === 1);
    const tdoc21 = await page21.evaluate(() => window.__printed[0]);
    assert.ok(/class="print-task done" style="margin-left:16pt"><span class="print-box"/.test(tdoc21), 'Unteraufgabe eingerückt im Druck');
    assert.ok(tdoc21.includes('1/1 Unteraufgaben'), 'Fortschritt im Druck');
    await page21.click('#menuBtn');
    await page21.click('#exportBtn');
    await page21.waitForSelector('#exportDialog[open]');
    await page21.click('#exportDirBtn');
    await page21.waitForFunction(() => /Export gespeichert/.test(document.querySelector('#status').textContent));
    const idx21 = await page21.evaluate(() => new TextDecoder().decode(new Uint8Array(window.__exported['index.md'])));
    assert.ok(idx21.includes('- [ ] Haupt — aus [Projekt]') && idx21.includes('- [ ] Einzel — aus [Projekt]'));
    step('Unteraufgaben: Druck eingerückt, Export');

    // Datenbank: Spalten, und eine Schema-8-Datei wird beim Öffnen migriert
    await page21.click('#viewListBtn');
    await page21.waitForSelector('body.view-list');
    await page21.locator('#list li').first().click();
    await page21.waitForFunction(() => document.querySelector('#title').value === 'Projekt');
    await page21.fill('#body', ['- [ ] Haupt', '  - [ ] Unter A', '    - [ ] Enkel', '- [ ] Einzel'].join('\n'));
    await waitSaved(page21);
    await page21.click('#menuBtn');
    const [dl21] = await Promise.all([page21.waitForEvent('download'), page21.click('#downloadBtn')]);
    const dl21Path = path.join(tmp, 'unter.sqlite');
    await dl21.saveAs(dl21Path);
    const db21 = new SQL.Database(new Uint8Array(fs.readFileSync(dl21Path)));
    assert.equal(db21.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    const rows21 = db21.exec('SELECT t.text, t.depth, p.text FROM tasks t LEFT JOIN tasks p ON p.id = t.parent_id ORDER BY t.line_no')[0].values;
    assert.deepEqual(rows21, [['Haupt', 0, null], ['Unter A', 1, 'Haupt'], ['Enkel', 2, 'Unter A'], ['Einzel', 0, null]]);
    db21.run("ALTER TABLE tasks DROP COLUMN parent_id; ALTER TABLE tasks DROP COLUMN depth; UPDATE meta SET value = '8' WHERE key = 'schema_version';");
    const v8Path = path.join(tmp, 'schema8.sqlite');
    fs.writeFileSync(v8Path, Buffer.from(db21.export()));
    db21.close();
    const ctx21b = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    const { page: page21b, errors: errors21b } = await openApp(ctx21b, 'list');
    await page21b.setInputFiles('#importInput', v8Path);
    await page21b.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    await page21b.click('#viewTasksBtn');
    await page21b.waitForSelector('body.view-tasks');
    await page21b.waitForFunction(() => document.querySelectorAll('.t-item').length === 4);
    assert.equal(await page21b.locator('.t-item .t-part').count(), 2, 'Unteraufgaben nach der Migration erkannt');
    await page21b.click('#menuBtn');
    const [dl21b] = await Promise.all([page21b.waitForEvent('download'), page21b.click('#downloadBtn')]);
    const dl21bPath = path.join(tmp, 'migriert.sqlite');
    await dl21b.saveAs(dl21bPath);
    const db21b = new SQL.Database(new Uint8Array(fs.readFileSync(dl21bPath)));
    assert.equal(db21b.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    assert.deepEqual(db21b.exec('SELECT depth FROM tasks ORDER BY line_no')[0].values.map(r => r[0]), [0, 1, 2, 0]);
    db21b.close();
    assert.deepEqual(errors21, [], 'keine Konsolenfehler bei Unteraufgaben');
    assert.deepEqual(errors21b, [], 'keine Konsolenfehler bei der Migration auf Schema 9');
    await ctx21.close();
    await ctx21b.close();
    step('Unteraufgaben: Schema 9 in der Datei, Migration einer Schema-8-Datei');

    // ---------- 22. Archiv ----------
    const ctx22 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx22.addInitScript(() => {
      window.__printed = [];
      window.print = () => { window.__printed.push(document.getElementById('printArea').innerHTML); };
      window.__exported = {};
      const concat = chunks => { const n = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };
      const makeDir = prefix => ({ kind: 'directory', name: 'Export', getDirectoryHandle: async n => makeDir(prefix + n + '/'), getFileHandle: async n => ({ kind: 'file', name: n, createWritable: async () => { const chunks = []; return { write: async d => { chunks.push(new Uint8Array(d)); }, close: async () => { window.__exported[prefix + n] = Array.from(concat(chunks)); }, abort: async () => {} }; } }) });
      window.showDirectoryPicker = async () => { window.__exported = {}; return makeDir(''); };
    });
    const { page: p22, errors: errors22 } = await openApp(ctx22);
    const dialogs22 = [];
    p22.on('dialog', d => { dialogs22.push(d.message()); d.accept(); });
    const addChild22 = async (parentId, title) => {
      await p22.click(`.mm-node[data-id="${parentId}"]`);
      await p22.keyboard.press('Tab');
      await p22.waitForSelector('#renameInput:not([hidden])');
      await p22.keyboard.type(title);
      await p22.keyboard.press('Enter');
      await p22.waitForFunction(t => [...document.querySelectorAll('.mm-node text')].some(x => x.textContent === t), title);
      return idOfNode(p22, title);
    };
    const setBody22 = async (id, body) => {
      await p22.dblclick(`.mm-node[data-id="${id}"]`);
      await p22.waitForSelector('body.editor-open');
      await p22.fill('#body', body);
      await waitSaved(p22);
      await p22.keyboard.press('Escape');
      await p22.waitForSelector('body:not(.editor-open)');
    };
    const ids22 = {};
    ids22.Alpha = await newRootNote(p22, 'Alpha');
    ids22.Beta = await addChild22(ids22.Alpha, 'Beta');
    ids22.Gamma = await addChild22(ids22.Beta, 'Gamma');
    ids22.Delta = await addChild22(ids22.Alpha, 'Delta');
    ids22.Epsilon = await newRootNote(p22, 'Epsilon');
    await setBody22(ids22.Gamma, 'Quokka Gamma\n- [ ] Gamma-Aufgabe @31.12.2026\n? Gamma-Frage @30.12.2026');
    await setBody22(ids22.Epsilon, 'Verweis auf [[Gamma]]');
    const node22 = name => p22.locator(`.mm-node[data-id="${ids22[name]}"]`);
    const visible22 = async () => (await p22.locator('.mm-node:not(.mm-root)').evaluateAll(ns => ns.map(n => n.querySelector('text').textContent))).sort();
    assert.deepEqual(await visible22(), ['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma']);
    assert.equal(await p22.locator('#viewTasksBtn .count').innerText(), '1');
    assert.equal(await p22.locator('#viewQuestionsBtn .count').innerText(), '1');
    assert.equal(await p22.locator('#mapArchiveBtn').innerText(), 'Archiv anzeigen');
    // Kalender vor dem Archivieren
    const icsDownload22 = async () => {
      await p22.click('#menuBtn');
      await p22.click('#calendarBtn');
      await p22.waitForSelector('#calDialog[open]');
      const [dl] = await Promise.all([p22.waitForEvent('download'), p22.click('#calDownloadBtn')]);
      const f = path.join(tmp, `archiv-${Date.now()}.ics`);
      await dl.saveAs(f);
      return parseIcs(fs.readFileSync(f, 'utf8'));
    };
    const cal1 = await icsDownload22();
    const gamma1 = cal1.events.find(e => e.props.SUMMARY === 'Aufgabe: Gamma-Aufgabe');
    assert.ok(gamma1 && gamma1.props.STATUS === 'CONFIRMED', 'Aufgabe von Gamma steht im Kalender');
    step('Archiv: Baum mit Aufgabe und Frage aufgebaut, Kalender vor dem Archivieren');

    // Beta archivieren: Rückfrage mit Anzahl, Unternotiz geht mit
    await node22('Beta').click({ button: 'right' });
    await p22.click('#contextMenu button:has-text("Archivieren…")');
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node').length === 4); // Wurzel, Alpha, Delta, Epsilon
    assert.ok(dialogs22[0].startsWith('„Beta“ und 1 Unternotiz archivieren?'), dialogs22[0]);
    assert.deepEqual(await visible22(), ['Alpha', 'Delta', 'Epsilon']);
    assert.match(await p22.locator('#status').innerText(), /2 Notizen archiviert/);
    await p22.waitForFunction(() => !document.querySelector('#viewTasksBtn .count') && !document.querySelector('#viewQuestionsBtn .count'));
    assert.equal(await p22.locator('#mapArchiveBtn').innerText(), 'Archiv anzeigen (2)');
    step('Archiv: Archivieren per Kontextmenü mit Rückfrage, Unternotiz geht mit, Zähler fallen weg');

    // Archiv anzeigen: blass und gestrichelt, Wahl bleibt nach dem Neuladen
    await p22.click('#mapArchiveBtn');
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node.mm-archived').length === 2);
    assert.equal(await p22.locator('#mapArchiveBtn').getAttribute('aria-pressed'), 'true');
    assert.equal(await p22.locator('#mapArchiveBtn').innerText(), 'Archiv ausblenden (2)');
    assert.deepEqual(await visible22(), ['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma']);
    assert.equal(await node22('Gamma').evaluate(n => n.classList.contains('mm-archived')), true);
    await waitSaved(p22);
    await p22.reload();
    await p22.waitForSelector(READY);
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node.mm-archived').length === 2);
    await p22.click('#mapArchiveBtn');
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node').length === 4);
    step('Archiv: Schalter «Archiv anzeigen», Wahl wird gemerkt');

    // Suche findet das Archiv immer: Treffer samt archivierten Vorfahren erscheinen
    await p22.fill('#mapSearch', 'Quokka');
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node.mm-archived').length === 2);
    assert.equal(await p22.locator('#mapMatches').innerText(), '1 Treffer');
    assert.equal(await p22.locator('.mm-node.mm-match').count(), 1);
    assert.equal(await node22('Gamma').evaluate(n => n.classList.contains('mm-match')), true);
    await p22.fill('#mapSearch', '');
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node').length === 4);
    step('Archiv: Suche findet Archivierte immer und blendet Treffer samt Vorfahren ein');

    // Alpha archivieren: nur noch noch nicht archivierte werden gezählt
    await node22('Alpha').click({ button: 'right' });
    await p22.click('#contextMenu button:has-text("Archivieren…")');
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node').length === 2); // Wurzel, Epsilon
    assert.ok(dialogs22[1].startsWith('„Alpha“ und 1 Unternotiz archivieren?'), dialogs22[1]);
    assert.deepEqual(await visible22(), ['Epsilon']);

    // Liste: Bereich «Archiv», Suche findet Archivierte, schreibgeschützt
    await p22.click('#viewListBtn');
    await p22.waitForSelector('body.view-list');
    await p22.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    assert.equal(await p22.locator('#count').innerText(), '1 Notiz · 4 im Archiv');
    await p22.fill('#search', 'Quokka');
    await p22.waitForFunction(() => document.querySelectorAll('#list li.archived').length === 1 && document.querySelectorAll('#list li').length === 1);
    assert.match(await p22.locator('#list li .note-date').first().innerText(), /^Archiviert /);
    await p22.fill('#search', '');
    await p22.waitForFunction(() => document.querySelectorAll('#list li.archived').length === 0 && document.querySelectorAll('#list li').length === 1);
    await p22.selectOption('#listScope', 'archive');
    await p22.waitForFunction(() => document.querySelectorAll('#list li').length === 4);
    assert.equal(await p22.locator('#count').innerText(), '4 Notizen im Archiv');
    await p22.locator('#list li', { hasText: 'Quokka' }).click();
    await p22.waitForFunction(() => document.querySelector('#title').value === 'Gamma');
    assert.equal(await p22.locator('#archiveBar').isVisible(), true);
    assert.equal(await p22.locator('#title').evaluate(e => e.readOnly), true);
    assert.equal(await p22.locator('#body').evaluate(e => e.readOnly), true);
    assert.equal(await p22.locator('#archiveBtn').isHidden(), true);
    assert.equal(await p22.locator('#childBtn').isHidden(), true);
    assert.equal(await p22.locator('#trashBar').isHidden(), true);
    step('Archiv: Liste mit Bereich und Suche, archivierte Notiz schreibgeschützt mit Zurückholen-Knopf');

    // Zurückholen: Gamma holt Beta und Alpha mit, Delta bleibt im Archiv
    await p22.click('#unarchiveBtn');
    await p22.waitForFunction(() => /dazu 2 übergeordnete Notizen/.test(document.querySelector('#status').textContent));
    assert.equal(await p22.locator('#listScope').inputValue(), 'live');
    await p22.waitForFunction(() => document.querySelectorAll('#list li').length === 4);
    assert.equal(await p22.locator('#body').evaluate(e => e.readOnly), false, 'zurückgeholte Notiz ist wieder bearbeitbar');
    assert.equal(await p22.locator('#count').innerText(), '4 Notizen · 1 im Archiv');
    await p22.click('#viewMapBtn');
    await p22.waitForSelector('body.view-map');
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node:not(.mm-root)').length === 4);
    assert.deepEqual(await visible22(), ['Alpha', 'Beta', 'Epsilon', 'Gamma']);
    assert.equal(await p22.locator('#viewTasksBtn .count').innerText(), '1');
    assert.equal(await p22.locator('#viewQuestionsBtn .count').innerText(), '1');
    step('Archiv: Zurückholen Blatt für Blatt, alle archivierten Eltern kommen mit, Unternotiz bleibt');

    // Schutz: archivierte Notizen lassen sich nicht ändern, Rechtsklick bietet nur Passendes
    await p22.click('#mapArchiveBtn');
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node.mm-archived').length === 1);
    await node22('Delta').click();
    await p22.keyboard.press('F2');
    await p22.waitForFunction(() => /schreibgeschützt/.test(document.querySelector('#status').textContent));
    assert.equal(await p22.locator('#renameInput').isHidden(), true);
    await p22.keyboard.press('Tab');
    await p22.waitForFunction(() => /nichts anlegen/.test(document.querySelector('#status').textContent));
    await node22('Delta').click({ button: 'right' });
    await p22.waitForSelector('#contextMenu:not([hidden])');
    const menu22 = await p22.locator('#contextMenu button').allInnerTexts().then(a => a.map(t => t.split('\n')[0].trim()));
    assert.ok(menu22.some(t => t.startsWith('Zurückholen')) && menu22.some(t => t.startsWith('Öffnen')));
    assert.ok(!menu22.some(t => /Unternotiz anlegen|Umbenennen|Archivieren|Nach oben/.test(t)), `Menü archivierter Notizen: ${menu22.join(', ')}`);
    await p22.keyboard.press('Escape');
    step('Archiv: archivierte Notizen sind geschützt, Kontextmenü passend');

    // Archiv und Papierkorb sind unabhängig
    await node22('Delta').click({ button: 'right' });
    await p22.click('#contextMenu button:has-text("Löschen")');
    await p22.waitForFunction(() => !document.querySelector('.mm-node.mm-archived'));
    await p22.click('#viewListBtn');
    await p22.waitForSelector('body.view-list');
    await p22.selectOption('#listScope', 'trash');
    await p22.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    await p22.locator('#list li').first().click();
    await p22.click('#restoreBtn');
    await p22.waitForFunction(() => /weiterhin im Archiv/.test(document.querySelector('#status').textContent));
    assert.equal(await p22.locator('#listScope').inputValue(), 'archive');
    await p22.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
    assert.equal(await p22.locator('#archiveBar').isVisible(), true, 'wiederhergestellte Notiz liegt weiterhin im Archiv');
    await p22.selectOption('#listScope', 'live');
    await p22.click('#viewMapBtn');
    await p22.waitForSelector('body.view-map');
    step('Archiv: Papierkorb-Wiederherstellung behält den Archivstatus');

    // Mehrere Notizen auf einmal (Archiv wieder ausblenden)
    if ((await p22.locator('#mapArchiveBtn').getAttribute('aria-pressed')) === 'true') await p22.click('#mapArchiveBtn');
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node.mm-archived').length === 0);
    await node22('Beta').click({ modifiers: ['Control'] });
    await node22('Epsilon').click({ modifiers: ['Control'] });
    await p22.waitForFunction(() => document.querySelector('#multiCount').textContent === '2 Notizen ausgewählt');
    await p22.click('#multiArchiveBtn');
    await p22.waitForFunction(() => document.querySelectorAll('.mm-node:not(.mm-root)').length === 1); // nur Alpha
    assert.ok(dialogs22.at(-1).startsWith('2 Notizen archivieren (mit Unternotizen insgesamt 3)?'), dialogs22.at(-1));
    assert.match(await p22.locator('#status').innerText(), /3 Notizen archiviert/);
    assert.deepEqual(await visible22(), ['Alpha']);
    step('Archiv: Mehrfachauswahl archivieren');

    // Kalender sagt archivierte Termine ab, ohne zu duplizieren
    const cal2 = await icsDownload22();
    const gamma2 = cal2.events.find(e => e.props.SUMMARY === 'Entfernt: Gamma-Aufgabe');
    assert.ok(gamma2, 'archivierter Termin wird als entfernt mitgeschrieben');
    assert.equal(gamma2.props.UID, gamma1.props.UID, 'gleiche Kennung, kein Duplikat');
    assert.equal(gamma2.props.STATUS, 'CANCELLED');
    assert.ok(!cal2.events.some(e => e.props.SUMMARY === 'Aufgabe: Gamma-Aufgabe'));
    await p22.keyboard.press('Escape');
    await p22.evaluate(() => { const d = document.querySelector('#calDialog'); if (d.open) d.close(); });

    // Druck und Export: Archivierte nur mit Kästchen
    await p22.click('#mapPrintBtn');
    await p22.waitForSelector('#printDialog[open]');
    await p22.check('#printForm input[value="all"]');
    assert.equal(await p22.locator('#printScopeAll').innerText(), 'Alle Notizen (1)');
    await p22.click('#printGoBtn');
    await p22.waitForFunction(() => window.__printed.length === 1);
    const pr1 = await p22.evaluate(() => window.__printed[0]);
    assert.ok(pr1.includes('Alpha') && !pr1.includes('Quokka') && !pr1.includes('Gamma'), 'ohne Kästchen kein Archiv im Druck');
    await p22.click('#mapPrintBtn');
    await p22.waitForSelector('#printDialog[open]');
    await p22.check('#printForm input[value="all"]');
    await p22.check('#printArchive');
    assert.equal(await p22.locator('#printScopeAll').innerText(), 'Alle Notizen (5)');
    await p22.click('#printGoBtn');
    await p22.waitForFunction(() => window.__printed.length === 2);
    const pr2 = await p22.evaluate(() => window.__printed[1]);
    assert.ok(pr2.includes('Quokka') && pr2.includes('Archiviert '), 'mit Kästchen steht das Archiv im Druck');
    const exportRun22 = async checked => {
      await p22.click('#menuBtn');
      await p22.click('#exportBtn');
      await p22.waitForSelector('#exportDialog[open]');
      if (checked) await p22.check('#exportArchive'); else await p22.uncheck('#exportArchive');
      await p22.click('#exportDirBtn');
      await p22.waitForFunction(() => /Export gespeichert/.test(document.querySelector('#status').textContent) && Object.keys(window.__exported).length > 0);
      return p22.evaluate(() => window.__exported);
    };
    const ex1 = await exportRun22(false);
    assert.deepEqual(Object.keys(ex1).sort(), ['index.md', 'mindmap.png', 'mindmap.svg', 'notes/alpha.md']);
    await p22.evaluate(() => { window.__exported = {}; document.querySelector('#status').textContent = ''; });
    const ex2 = await exportRun22(true);
    assert.ok(Object.keys(ex2).includes('notes/gamma.md') && Object.keys(ex2).includes('notes/beta.md'), 'mit Kästchen sind Archivierte im Export');
    const gammaMd = Buffer.from(ex2['notes/gamma.md']).toString('utf8');
    assert.ok(gammaMd.includes('Archiviert ') && gammaMd.includes('Quokka'));
    const idx2 = Buffer.from(ex2['index.md']).toString('utf8');
    assert.ok(idx2.includes('*(archiviert)*') && idx2.includes('Gamma-Aufgabe'), 'Inhaltsverzeichnis und Aufgabenliste');
    assert.ok(Buffer.from(ex2['mindmap.svg']).toString('utf8').includes('stroke-dasharray'), 'archivierte Knoten im Bild gestrichelt');
    assert.ok(!Buffer.from(ex1['index.md']).toString('utf8').includes('Gamma'), 'ohne Kästchen nicht im Index');
    step('Archiv: Kalender sagt ab, Druck und Export nur mit «Archivierte Notizen mit einbeziehen»');

    // Datei: Spalte archived_at, Migration einer Schema-9-Datei
    await p22.waitForTimeout(100);
    await waitSaved(p22);
    await p22.click('#menuBtn');
    const [dl22] = await Promise.all([p22.waitForEvent('download'), p22.click('#downloadBtn')]);
    const dl22Path = path.join(tmp, 'archiv.sqlite');
    await dl22.saveAs(dl22Path);
    const db22 = new SQL.Database(new Uint8Array(fs.readFileSync(dl22Path)));
    assert.equal(db22.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    assert.deepEqual(db22.exec('SELECT title, archived_at IS NOT NULL FROM notes ORDER BY id')[0].values,
      [['Alpha', 0], ['Beta', 1], ['Gamma', 1], ['Delta', 1], ['Epsilon', 1]]);
    db22.run("ALTER TABLE notes DROP COLUMN archived_at; UPDATE meta SET value = '9' WHERE key = 'schema_version';");
    const v9Path = path.join(tmp, 'schema9.sqlite');
    fs.writeFileSync(v9Path, Buffer.from(db22.export()));
    db22.close();
    const ctx22b = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    const { page: p22b, errors: errors22b } = await openApp(ctx22b, 'list');
    await p22b.setInputFiles('#importInput', v9Path);
    await p22b.waitForFunction(() => document.querySelectorAll('#list li').length === 5);
    assert.equal(await p22b.locator('#count').innerText(), '5 Notizen');
    await p22b.click('#menuBtn');
    const [dl22b] = await Promise.all([p22b.waitForEvent('download'), p22b.click('#downloadBtn')]);
    const dl22bPath = path.join(tmp, 'archiv-migriert.sqlite');
    await dl22b.saveAs(dl22bPath);
    const db22b = new SQL.Database(new Uint8Array(fs.readFileSync(dl22bPath)));
    assert.equal(db22b.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], SCHEMA_VERSION);
    assert.equal(db22b.exec('SELECT count(*) FROM notes WHERE archived_at IS NOT NULL')[0].values[0][0], 0);
    db22b.close();
    assert.deepEqual(errors22, [], 'keine Konsolenfehler beim Archiv');
    assert.deepEqual(errors22b, [], 'keine Konsolenfehler bei der Migration auf Schema 10');
    await ctx22.close();
    await ctx22b.close();
    step('Archiv: Spalte in der Datei, Migration einer Schema-9-Datei');

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
