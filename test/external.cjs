/* Test der Änderungen von aussen in der lokalen Ausprägung (v1.5.0): Wird die verbundene Datei oder der Browser-Speicher von
   jemand anderem beschrieben (anderes Programm, anderer Tab), meldet die App es und die Person entscheidet: neu laden (eigene
   Änderungen verwerfen) oder die eigene Fassung behalten (überschreiben). Ohne ungesicherte eigene Änderungen wird still neu geladen.
   Ausführen: npm test (nach tools/build.cjs). */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const APP_URL = 'file://' + path.join(ROOT, 'dist', 'NoNotes', 'index.html');

function loadPlaywright() {
  try { return require('playwright'); }
  catch (e) {
    if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
    throw e;
  }
}
const { chromium } = loadPlaywright();
const initSqlJs = require(path.join(ROOT, 'vendor/sql.js/sql-asm.js'));

const READY = 'body[data-ready="true"]';
const SAVED = () => document.querySelector('#status').dataset.state === 'saved';
const step = name => console.log('  ✓ ' + name);

/** Datenbankschicht in Node (wie test/db.cjs): macht aus Datei-Bytes eine Datei mit einer Notiz mehr. */
async function loadDb() {
  const sandbox = { console };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const f of ['packages/core/i18n.js', 'packages/core/history.js', 'packages/core/dates.js', 'packages/core/questions.js', 'packages/core/tasks.js', 'packages/core/backend.js', 'packages/data/db.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  return { SQL: await initSqlJs(), DB: sandbox.NoNotesDB };
}

async function openPage(ctx, errors, view) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(v => { try { localStorage.setItem('nonotes.view', v); } catch (e) { /* egal */ } }, view || 'list');
  await page.goto(APP_URL);
  await page.waitForSelector(READY, { timeout: 30000 });
  return page;
}

const listTitles = page => page.evaluate(() => [...document.querySelectorAll('#list li .title, #list li .note-title')].map(x => x.textContent.trim()));

async function main() {
  const { SQL, DB } = await loadDb();
  const browser = await chromium.launch();
  const errors = [];

  // ---------- Datei von aussen geändert ----------
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 }, locale: 'de-CH' });
  await ctx.addInitScript(() => {
    window.__file = { bytes: new Uint8Array(), mtime: 1000 };
    const handle = {
      kind: 'file', name: 'Test.sqlite',
      queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      getFile: async () => new File([window.__file.bytes], 'Test.sqlite', { lastModified: window.__file.mtime }),
      createWritable: async () => {
        const chunks = [];
        return {
          write: async d => { chunks.push(new Uint8Array(d)); },
          close: async () => {
            const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
            let o = 0;
            for (const c of chunks) { out.set(c, o); o += c.length; }
            window.__file = { bytes: out, mtime: window.__file.mtime + 1 };
          },
          abort: async () => {},
        };
      },
    };
    window.showSaveFilePicker = async () => handle;
    window.showOpenFilePicker = async () => [handle];
  });
  const page = await openPage(ctx, errors);
  await page.click('#menuBtn');
  await page.click('#createFileBtn');
  await page.waitForFunction(() => window.__file.bytes.length > 0);
  await page.click('#newBtn');
  await page.fill('#title', 'Eigene Notiz');
  await page.waitForFunction(SAVED);
  await page.waitForFunction(() => window.__file.bytes.length > 0);

  // Dateien gehen als Base64 hin und her: Zahlenlisten wären so langsam, dass die Wartezeit des Speicherns davor abläuft
  const fileBytes = () => page.evaluate(() => { let s = ''; const b = window.__file.bytes; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); })
    .then(b64 => new Uint8Array(Buffer.from(b64, 'base64')));
  const FROM_B64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  /** Legt Fremdes bereit, ohne es schon in die Datei zu stellen (das geschieht erst mit commitStaged). */
  const stage = (bytes, bump) => page.evaluate(({ b64, bump }) => { window.__staged = { bytes: Uint8Array.from(atob(b64), c => c.charCodeAt(0)), bump }; }, { b64: Buffer.from(bytes).toString('base64'), bump });
  const commitStaged = () => page.evaluate(() => { window.__file = { bytes: window.__staged.bytes, mtime: window.__file.mtime + window.__staged.bump }; window.dispatchEvent(new Event('focus')); });
  const setFile = async (bytes, bump) => { await stage(bytes, bump); await page.evaluate(() => { window.__file = { bytes: window.__staged.bytes, mtime: window.__file.mtime + window.__staged.bump }; }); };
  const withExtra = async (bytes, title) => {
    const db = DB.open(SQL, bytes);
    const id = DB.createNote(db, null);
    DB.updateNote(db, id, title, '');
    const out = db.export();
    db.close();
    return out;
  };
  const titlesIn = bytes => { const db = DB.open(SQL, bytes); const t = DB.listNotes(db, '').map(n => n.title); db.close(); return t; };

  // Ohne ungesicherte Änderungen: still neu laden
  const ext1 = await withExtra(await fileBytes(), 'Von aussen eins');
  await setFile(ext1, 5);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('#list').textContent.includes('Von aussen eins'));
  assert.match(await page.locator('#status').innerText(), /neu geladen/);
  assert.equal(await page.locator('#banner:not([hidden])').count(), 0, 'keine Rückfrage, wenn nichts Eigenes zu verlieren ist');
  step('Datei von aussen geändert, nichts Ungesichertes: wird still neu geladen und in der Statuszeile gemeldet');

  // Nur der Zeitstempel ändert sich: keine Meldung
  await setFile(await fileBytes(), 3);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#banner:not([hidden])').count(), 0);
  step('Nur der Zeitstempel der Datei ändert sich, der Inhalt nicht: keine Meldung');

  // Mit ungesicherten Änderungen: Rückfrage, Speichern ruht
  await page.click('#list li >> text=Eigene Notiz');
  const ext2 = await withExtra(await fileBytes(), 'Von aussen zwei'); // die Datei, wie sie gerade ist, plus Fremdes (ohne meine Änderung)
  await stage(ext2, 7);
  await page.fill('#title', 'Eigene Notiz geändert');
  await commitStaged(); // gleich nach der Eingabe, innerhalb der Wartezeit des Speicherns
  await page.waitForSelector('#banner:not([hidden])', { timeout: 5000 }).catch(async e => {
    throw new Error('keine Rückfrage: ' + JSON.stringify(await page.evaluate(() => ({ status: document.querySelector('#status').textContent, state: document.querySelector('#status').dataset.state, list: document.querySelector('#list').textContent, title: document.querySelector('#title').value }))));
  });
  assert.match(await page.locator('#banner').innerText(), /ausserhalb dieser Sitzung geändert/);
  await page.waitForTimeout(1200); // länger als die Wartezeit des Speicherns
  assert.deepEqual(titlesIn(await fileBytes()).sort(), titlesIn(ext2).sort(), 'die Datei wurde nicht überschrieben');
  step('Datei von aussen geändert, eigene Änderung ungesichert: Rückfrage, die Datei bleibt unberührt');

  // Datei laden: eigene Änderung verworfen
  await page.click('#banner button:has-text("Datei laden")');
  await page.waitForSelector('#banner', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#list').textContent.includes('Von aussen zwei'));
  assert.ok(!(await page.locator('#list').innerText()).includes('Eigene Notiz geändert'), 'die eigene Änderung ist verworfen');
  step('Entscheidung «Datei laden»: Stand der Datei, eigene Änderung verworfen');

  // Eigene Fassung behalten: die Datei wird überschrieben
  await page.click('#list li >> text=Eigene Notiz');
  const ext3 = await withExtra(await fileBytes(), 'Von aussen drei');
  await stage(ext3, 9);
  await page.fill('#title', 'Eigene Notiz wieder');
  await commitStaged();
  await page.waitForSelector('#banner:not([hidden])');
  await page.click('#banner button:has-text("Meine Fassung behalten")');
  await page.waitForSelector('#banner', { state: 'hidden' });
  await page.waitForFunction(SAVED);
  await page.waitForFunction(() => window.__file.bytes.length > 0);
  const kept = titlesIn(await fileBytes());
  assert.ok(kept.includes('Eigene Notiz wieder'), 'meine Fassung steht in der Datei');
  assert.ok(!kept.includes('Von aussen drei'), 'die fremde Änderung ist überschrieben');
  step('Entscheidung «Meine Fassung behalten»: Datei mit meinem Stand überschrieben');

  // Die Datei ändert sich, während gerade gespeichert wird: nicht blind überschreiben
  await page.click('#list li >> text=Eigene Notiz');
  await page.evaluate(() => {
    window.__hold = true;
    const store = NoNotesStorage.browserStore;
    const orig = store.saveDb.bind(store);
    store.saveDb = async bytes => { while (window.__hold) await new Promise(r => setTimeout(r, 30)); return orig(bytes); };
  });
  await page.fill('#title', 'Eigene Notiz mitten im Speichern');
  await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'saving'); // das Speichern läuft und hängt im Browser-Speicher
  await setFile(await withExtra(await fileBytes(), 'Von aussen vier'), 11);
  await page.evaluate(() => { window.__hold = false; });
  await page.waitForSelector('#banner:not([hidden])');
  const guarded = titlesIn(await fileBytes());
  assert.ok(guarded.includes('Von aussen vier') && !guarded.includes('Eigene Notiz mitten im Speichern'), 'die fremde Fassung wurde nicht blind überschrieben');
  await page.click('#banner button:has-text("Datei laden")');
  await page.waitForSelector('#banner', { state: 'hidden' });
  step('Datei ändert sich während des Speicherns: die App prüft kurz vor dem Schreiben und fragt, statt zu überschreiben');
  await ctx.close();

  // ---------- Anderer Tab hat den Browser-Speicher beschrieben ----------
  const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 850 }, locale: 'de-CH' });
  const p1 = await openPage(ctx2, errors);
  // Seite 2 bekommt einen gestellten Kanal, damit der Test die Nachricht des anderen Tabs auslösen kann, und lässt Speichern anhalten
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p2.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p2.addInitScript(() => {
    try { localStorage.setItem('nonotes.view', 'list'); } catch (e) { /* egal */ }
    window.BroadcastChannel = class { constructor() { window.__bc = this; } postMessage() {} close() {} };
  });
  await p2.goto(APP_URL);
  await p2.waitForSelector(READY, { timeout: 30000 });
  const tabMessage = page => page.evaluate(() => window.__bc.onmessage({ data: { tab: 'fremd' } }));

  await p1.click('#newBtn');
  await p1.fill('#title', 'Aus Tab eins');
  await p1.waitForFunction(SAVED);
  await tabMessage(p2);
  await p2.waitForFunction(() => document.querySelector('#list').textContent.includes('Aus Tab eins'));
  assert.equal(await p2.locator('#banner:not([hidden])').count(), 0);
  step('Anderer Tab hat gespeichert, hier nichts Ungesichertes: der Stand wird still übernommen');

  // hier ungesichert (Speichern hält an), dort wird gespeichert
  await p2.evaluate(() => {
    window.__hold = true;
    const store = NoNotesStorage.browserStore;
    const orig = store.saveDb.bind(store);
    store.saveDb = async bytes => { while (window.__hold) await new Promise(r => setTimeout(r, 50)); return orig(bytes); };
  });
  await p2.click('#list li >> text=Aus Tab eins');
  await p2.fill('#title', 'In Tab zwei geändert');
  await p1.click('#newBtn');
  await p1.fill('#title', 'Noch eine aus Tab eins');
  await p1.waitForFunction(SAVED);
  await tabMessage(p2);
  await p2.waitForSelector('#banner:not([hidden])');
  assert.match(await p2.locator('#banner').innerText(), /anderen Tab/);
  await p2.click('#banner button:has-text("Stand dort laden")');
  await p2.waitForSelector('#banner', { state: 'hidden' });
  await p2.waitForFunction(() => document.querySelector('#list').textContent.includes('Noch eine aus Tab eins'));
  assert.ok(!(await p2.locator('#list').innerText()).includes('In Tab zwei geändert'));
  step('Anderer Tab hat gespeichert, hier ungesichert: Rückfrage; «Stand dort laden» verwirft die eigene Änderung');

  // Eigene Fassung behalten
  await p2.click('#list li >> text=Aus Tab eins');
  await p2.fill('#title', 'In Tab zwei behalten');
  await p1.click('#newBtn');
  await p1.fill('#title', 'Dritte aus Tab eins');
  await p1.waitForFunction(SAVED);
  await tabMessage(p2);
  await p2.waitForSelector('#banner:not([hidden])');
  await p2.click('#banner button:has-text("Meine Fassung behalten")');
  await p2.evaluate(() => { window.__hold = false; });
  await p2.waitForFunction(SAVED);
  const p3 = await openPage(ctx2, errors);
  const text3 = await p3.locator('#list').innerText();
  assert.ok(text3.includes('In Tab zwei behalten'), 'mein Stand steht im Browser-Speicher');
  assert.ok(!text3.includes('Dritte aus Tab eins'), 'die Änderung des anderen Tabs ist überschrieben');
  step('«Meine Fassung behalten» schreibt den eigenen Stand in den Browser-Speicher');

  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  step('Keine Browserfehler');
  await browser.close();
  console.log('\nTest der Änderungen von aussen bestanden.');
}

main().catch(e => {
  console.error('\nTest der Änderungen von aussen FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
