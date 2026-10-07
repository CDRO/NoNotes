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
const SCHEMA_VERSION = '4'; // muss zu js/db.js passen
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

async function dragNode(page, fromId, toId) {
  const a = await nodeBox(page, fromId);
  const b = await nodeBox(page, toId);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 20, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
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
