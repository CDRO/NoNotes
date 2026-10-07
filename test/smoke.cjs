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
const SAVED = () => document.querySelector('#status').dataset.state === 'saved';

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return errors;
}

async function openApp(ctx) {
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(APP_URL);
  await page.waitForSelector(READY, { timeout: 30000 });
  return { page, errors };
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
    const { page, errors } = await openApp(ctx);
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
    assert.equal(db.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], '1');
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
    const { page: page2, errors: errors2 } = await openApp(ctx2);
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
    const { page: page4, errors: errors4 } = await openApp(ctx4);
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
