/* Test des Verlaufs pro Note (v1.3.0): Patches, Arbeitsphasen, Aufbewahrung, Wiederherstellen, Dialog, Migration.
   Die Uhr der Seite wird verschoben (window.__skew), damit Pausen und Zeiträume prüfbar sind.
   Ausführen: npm test (nach tools/build.cjs). */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
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

// Uhr der Seite: window.__skew verschiebt new Date() und Date.now()
const clockScript = () => {
  const RealDate = Date;
  window.__skew = 0;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(RealDate.now() + window.__skew); else super(...a); }
    static now() { return RealDate.now() + window.__skew; }
  }
  window.Date = FakeDate;
};

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/** Läuft in der Seite: Backend gegen eine eigene Datenbank, mit verschiebbarer Uhr. */
async function backendScenario() {
  const findings = [];
  const fail = m => findings.push(m);
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const SQL = await window.initSqlJs();
  const H = window.NoNotesHistory;
  const make = () => {
    const db = window.NoNotesDB.open(SQL, null);
    const B = window.NoNotesBackendLocal.create({ getDb: () => db, onChange: () => {} });
    return { db, B };
  };
  const jump = ms => { window.__skew += ms; };
  const count = (db, id) => db.exec('SELECT count(*) FROM note_history' + (id != null ? ' WHERE note_id = ' + id : ''))[0].values[0][0];

  // ---- Patches: Hin- und Rückweg mit Zufall, Emoji, leeren Texten ----
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alphabet = ['a', 'b', 'c', ' ', '\n', 'ä', '😀', '𝒳', '-', '[x]'];
  const randText = () => Array.from({ length: rnd(40) }, () => alphabet[rnd(alphabet.length)]).join('');
  for (let i = 0; i < 2000; i++) {
    const a = randText();
    const b = rnd(3) === 0 ? randText() : a.slice(0, rnd(a.length + 1)) + randText().slice(0, rnd(6)) + a.slice(rnd(a.length + 1));
    const patch = H.diff(b, a);
    if (H.apply(b, patch) !== a) { fail(`Patch-Rückweg falsch: ${JSON.stringify([a, b])}`); break; }
    // keine halben Zeichen: der Teil, der in SQLite landet, muss gültiges Unicode sein
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(patch.r)) { fail(`Patch schneidet ein Zeichen durch: ${JSON.stringify([a, b])}`); break; }
    const ld = H.lineDiff(a, b);
    if (ld.filter(l => l.type !== 'add').map(l => l.text).join('\n') !== a) { fail('lineDiff: Ausgangstext nicht rekonstruierbar'); break; }
    if (ld.filter(l => l.type !== 'del').map(l => l.text).join('\n') !== b) { fail('lineDiff: Zieltext nicht rekonstruierbar'); break; }
  }

  // ---- Arbeitsphasen ----
  {
    const { db, B } = make();
    const id = await B.createNote(null);
    await B.updateNote(id, 'T', 'Eins');
    await B.updateNote(id, 'T', 'Eins zwei');
    if (count(db, id) !== 0) fail('Phase ab leerer Notiz soll keine Fassung anlegen');
    jump(10 * MIN);
    await B.updateNote(id, 'T', 'Eins zwei drei');
    let list = await B.listHistory(id);
    if (list.length !== 1) fail('nach der Pause genau eine Fassung, ist ' + list.length);
    if ((await B.getHistoryVersion(id, list[0].id)).body !== 'Eins zwei') fail('Fassung enthält den Stand vor der Phase');
    jump(1 * MIN);
    await B.updateNote(id, 'T', 'Eins zwei drei vier');
    jump(1 * MIN);
    await B.updateNote(id, 'T', 'Eins zwei drei vier fünf');
    list = await B.listHistory(id);
    if (list.length !== 1) fail('innerhalb der Phase bleibt es bei einer Fassung, ist ' + list.length);
    if ((await B.getHistoryVersion(id, list[0].id)).body !== 'Eins zwei') fail('Fassung bleibt unverändert während der Phase');
    jump(10 * MIN);
    await B.updateNote(id, 'T', 'Neu');
    list = await B.listHistory(id);
    if (list.length !== 2) fail('zweite Phase, zweite Fassung');
    const bodies = [];
    for (const it of list) bodies.push((await B.getHistoryVersion(id, it.id)).body);
    if (JSON.stringify(bodies) !== JSON.stringify(['Eins zwei drei vier fünf', 'Eins zwei'])) fail('Fassungen neueste zuerst: ' + JSON.stringify(bodies));
    if (list[0].added !== 3 || list[0].removed !== 24) fail('Umfang der Änderung danach: ' + JSON.stringify(list[0]));

    // nur der Titel
    jump(10 * MIN);
    await B.renameNote(id, 'Anderer Titel');
    list = await B.listHistory(id);
    if (list.length !== 3 || list[0].title !== 'T' || list[0].added !== 0 || list[0].removed !== 0) fail('Umbenennen legt eine Fassung mit altem Titel an: ' + JSON.stringify(list[0]));
    if ((await B.listHistory(id))[0].titleChanged !== true) fail('titleChanged wird gemeldet');

    // zurück zum Ausgangsstand in derselben Phase: keine unnötige Fassung
    jump(10 * MIN);
    await B.updateNote(id, 'Anderer Titel', 'a');
    jump(10 * MIN);
    await B.updateNote(id, 'Anderer Titel', 'a');
    await B.updateNote(id, 'Anderer Titel', 'ab');
    await B.updateNote(id, 'Anderer Titel', 'a');
    list = await B.listHistory(id);
    const before = list.length;
    jump(10 * MIN);
    await B.updateNote(id, 'Anderer Titel', 'a x');
    await B.updateNote(id, 'Anderer Titel', 'a');
    if ((await B.listHistory(id)).length !== before) fail('Rückkehr zum Stand vor der Phase hinterlässt keine Fassung');

    // lange Arbeit ohne Pause: nach 30 Minuten beginnt eine neue Fassung
    const n0 = (await B.listHistory(id)).length;
    for (let i = 0; i < 12; i++) { jump(4 * MIN); await B.updateNote(id, 'Anderer Titel', 'Lauf ' + i); }
    if ((await B.listHistory(id)).length < n0 + 2) fail('lange Phase wird zerteilt');

    // Wiederherstellen: der Stand davor bleibt erhalten, auch mitten in einer Phase
    const older = (await B.listHistory(id))[3];
    const target = await B.getHistoryVersion(id, older.id);
    const countBefore = count(db, id);
    await B.restoreHistoryVersion(id, older.id);
    const now = await B.getNote(id);
    if (now.body !== target.body || now.title !== target.title) fail('Wiederherstellen setzt Titel und Text');
    if (count(db, id) !== countBefore + 1) fail('Wiederherstellen sichert den Stand davor als neue Fassung');
    const top = (await B.listHistory(id))[0];
    const topVersion = await B.getHistoryVersion(id, top.id);
    if (topVersion.body !== 'Lauf 11') fail('die neueste Fassung ist der Stand vor dem Wiederherstellen: ' + topVersion.body);

    // Archiv: nicht wiederherstellen
    await B.archiveNote(id);
    try { await B.restoreHistoryVersion(id, top.id); fail('Wiederherstellen in archivierter Notiz'); }
    catch (e) { if (e.code !== 'ARCHIVED_READONLY') fail('Fehlerkennung ARCHIVED_READONLY erwartet, ' + e.code); }
    try { await B.getHistoryVersion(id, 999999); fail('unbekannte Fassung'); }
    catch (e) { if (e.code !== 'HISTORY_NOT_FOUND') fail('HISTORY_NOT_FOUND erwartet, ' + e.code); }
    await B.unarchiveNote(id);

    // Löschen: Papierkorb behält, endgültig löschen entfernt
    await B.deleteNote(id);
    if (count(db, id) === 0) fail('Papierkorb behält den Verlauf');
    await B.purgeNote(id);
    if (count(db, id) !== 0) fail('endgültiges Löschen entfernt den Verlauf');
  }

  // ---- Rückkehr zum Stand von vorher und danach weiterschreiben: die Fassung geht nicht verloren ----
  {
    const { B } = make();
    const id = await B.createNote(null);
    await B.updateNote(id, 'T', 'Basis');
    jump(10 * MIN);
    await B.updateNote(id, 'T', 'Basis X');
    await B.updateNote(id, 'T', 'Basis');
    await B.updateNote(id, 'T', 'Basis neu');
    const list = await B.listHistory(id);
    if (list.length !== 1 || (await B.getHistoryVersion(id, list[0].id)).body !== 'Basis') fail('Fassung vor der Phase geht nach Rückkehr und Weiterschreiben verloren');
  }

  // ---- Aufbewahrung ----
  {
    const { db, B } = make();
    const id = await B.createNote(null);
    await B.updateNote(id, 'T', 'start');
    const states = [];
    for (let i = 0; i < 60; i++) {
      jump(10 * MIN);
      const text = 'Fassung ' + i + (i % 7 === 0 ? ' 😀' : '') + '\nzweite Zeile ' + i;
      states.push(text);
      await B.updateNote(id, 'T', text);
    }
    const list = await B.listHistory(id);
    if (list.length !== 50) fail('höchstens 50 Fassungen, ist ' + list.length);
    // jede verbliebene Fassung stimmt: Stand vor Phase k ist der Text von Phase k-1
    for (let k = 0; k < list.length; k++) {
      const v = await B.getHistoryVersion(id, list[k].id);
      const expected = states[states.length - 2 - k];
      if (v.body !== expected) { fail(`Fassung ${k} falsch nach dem Kürzen: ${JSON.stringify(v.body)} statt ${JSON.stringify(expected)}`); break; }
    }
    // Zeitgrenze
    await B.setMeta('history_max_days', '2');
    jump(5 * DAY);
    await B.updateNote(id, 'T', 'sehr spät');
    const after = await B.listHistory(id);
    if (after.length !== 1) fail('nach 5 Tagen sind alle alten Fassungen weg, übrig: ' + after.length);
    if ((await B.getHistoryVersion(id, after[0].id)).body !== states[states.length - 1]) fail('die jüngste Fassung bleibt lesbar');
    // ausschalten
    await B.setMeta('history_enabled', '0');
    const c0 = count(db, id);
    jump(10 * MIN);
    await B.updateNote(id, 'T', 'ohne Verlauf');
    if (count(db, id) !== c0) fail('history_enabled=0 hält nichts fest');
    await B.clearHistory(id);
    if (count(db, id) !== 0) fail('clearHistory leert');
  }

  // ---- Platz: nur Unterschiede ----
  {
    const { db, B } = make();
    const id = await B.createNote(null);
    const para = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(1800); // rund 100 KB
    await B.updateNote(id, 'Gross', para);
    for (let i = 0; i < 20; i++) {
      jump(10 * MIN);
      await B.updateNote(id, 'Gross', para + ' Zusatz ' + i);
    }
    const bytes = db.exec('SELECT sum(length(r)) FROM note_history')[0].values[0][0];
    if (!(bytes < para.length / 4)) fail(`Verlauf zu gross: ${bytes} Zeichen für 20 Fassungen eines ${para.length}-Zeichen-Textes`);
    const v = await B.getHistoryVersion(id, (await B.listHistory(id))[0].id);
    if (v.body !== para + ' Zusatz 18') fail('grosse Fassung rekonstruierbar');
  }

  return findings;
}

async function main() {
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-history-'));
  const SQL = await initSqlJs();
  try {
    // ---------- Backend: Patches, Arbeitsphasen, Aufbewahrung ----------
    const ctx0 = await browser.newContext({ locale: 'de-CH' });
    await ctx0.addInitScript(clockScript);
    const p0 = await ctx0.newPage();
    const errors0 = [];
    p0.on('pageerror', e => errors0.push(String(e)));
    await p0.goto(APP_URL);
    await p0.waitForSelector(READY, { timeout: 30000 });
    const findings = await p0.evaluate(backendScenario);
    assert.deepEqual(findings, [], 'Verlauf im Backend:\n' + findings.join('\n'));
    assert.deepEqual(errors0, []);
    await ctx0.close();
    step('Verlauf: Patches (Zufall, Emoji), Arbeitsphasen, Titel, Wiederherstellen, Archiv, Aufbewahrung, Platz');

    // ---------- Dialog ----------
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx.addInitScript(clockScript);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
    await page.goto(APP_URL);
    await page.waitForSelector(READY, { timeout: 30000 });
    await page.click('#viewListBtn');
    await page.waitForSelector('body.view-list');
    await page.click('#newBtn');
    await page.fill('#title', 'Protokoll');
    await page.fill('#body', 'Zeile eins\nZeile zwei');
    await page.waitForFunction(SAVED);
    const jump = ms => page.evaluate(m => { window.__skew += m; }, ms);
    await jump(10 * MIN);
    await page.fill('#body', 'Zeile eins\nZeile zwei\nZeile drei');
    await page.waitForFunction(SAVED);
    await jump(10 * MIN);
    await page.fill('#body', 'Zeile eins\nZeile zwei geändert\nZeile drei\nZeile vier');
    await page.waitForFunction(SAVED);

    await page.click('#historyBtn');
    await page.waitForSelector('#historyDialog[open]');
    await page.waitForFunction(() => document.querySelectorAll('#historyList button').length === 2);
    assert.match(await page.locator('#historyLead').innerText(), /Protokoll/);
    // die neueste Fassung ist gewählt: «Zeile eins / Zeile zwei / Zeile drei»
    assert.equal(await page.locator('#historyList button[aria-current="true"]').count(), 1);
    assert.match(await page.locator('#historyMeta').innerText(), /Fassung vom .*Protokoll/);
    let marks = await page.evaluate(() => [...document.querySelectorAll('#historyText .hl')].map(d => d.className.replace('hl ', '') + ':' + d.textContent));
    assert.deepEqual(marks, ['same:Zeile eins', 'del:Zeile zwei geändert', 'add:Zeile zwei', 'same:Zeile drei', 'del:Zeile vier']);
    assert.match(await page.locator('#historyList button').first().innerText(), /danach \+\d+ −\d+ Zeichen/);
    // ohne Markierung nur der Text
    await page.uncheck('#historyDiff');
    assert.equal(await page.locator('#historyText').innerText(), 'Zeile eins\nZeile zwei\nZeile drei');
    await page.check('#historyDiff');
    // die ältere Fassung wählen und wiederherstellen
    await page.locator('#historyList button').nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('#historyText .hl.add').length > 0);
    await page.uncheck('#historyDiff');
    assert.equal(await page.locator('#historyText').innerText(), 'Zeile eins\nZeile zwei');
    await page.click('#historyRestoreBtn');
    await page.waitForFunction(() => !document.querySelector('#historyDialog').open);
    await page.waitForFunction(() => document.querySelector('#body').value === 'Zeile eins\nZeile zwei');
    assert.match(await page.locator('#status').innerText(), /Fassung vom .* wiederhergestellt/);
    await page.waitForFunction(SAVED);
    // der Stand vor dem Wiederherstellen ist als Fassung da
    await page.click('#historyBtn');
    await page.waitForSelector('#historyDialog[open]');
    await page.waitForFunction(() => document.querySelectorAll('#historyList button').length === 3);
    await page.uncheck('#historyDiff');
    assert.equal(await page.locator('#historyText').innerText(), 'Zeile eins\nZeile zwei geändert\nZeile drei\nZeile vier', 'neueste Fassung = Stand vor dem Wiederherstellen');
    step('Dialog: Fassungen, Markierung der Unterschiede, Wiederherstellen, Stand davor bleibt');

    // Verlauf löschen
    await page.click('#historyClearBtn');
    await page.waitForFunction(() => document.querySelectorAll('#historyList button').length === 0);
    assert.match(await page.locator('#historyList').innerText(), /Noch keine früheren Fassungen/);
    assert.equal(await page.locator('#historyRestoreBtn').isDisabled(), true);
    assert.ok(dialogs.some(m => /Verlauf dieser Notiz löschen/.test(m)), 'Rückfrage vor dem Löschen');
    assert.equal(await page.inputValue('#body'), 'Zeile eins\nZeile zwei', 'der Text bleibt');
    await page.keyboard.press('Escape');
    step('Dialog: Verlauf löschen mit Rückfrage, Text bleibt');

    // Archiv: ansehen ja, wiederherstellen nein
    await jump(10 * MIN);
    await page.fill('#body', 'Zeile eins');
    await page.waitForFunction(SAVED);
    await jump(10 * MIN);
    await page.fill('#body', 'Zeile eins und mehr');
    await page.waitForFunction(SAVED);
    await page.click('#archiveBtn');
    await page.waitForFunction(() => !document.querySelector('#archiveBar').hidden || document.querySelectorAll('#list li').length === 0);
    await page.selectOption('#listScope', 'archive');
    await page.locator('#list li').first().click();
    await page.waitForSelector('#archiveBar:not([hidden])');
    await page.click('#historyBtn');
    await page.waitForSelector('#historyDialog[open]');
    await page.waitForFunction(() => document.querySelectorAll('#historyList button').length >= 1);
    assert.equal(await page.locator('#historyRestoreBtn').isDisabled(), true, 'archiviert: nur ansehen');
    await page.keyboard.press('Escape');
    // Papierkorb: kein Verlauf-Knopf
    await page.selectOption('#listScope', 'live');
    step('Dialog: archivierte Notiz nur ansehen');

    // Datei: Tabelle note_history, Schema 12; Migration einer Schema-10-Datei
    await page.waitForFunction(SAVED);
    await page.click('#menuBtn');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')]);
    const dlPath = path.join(tmp, 'verlauf.sqlite');
    await dl.saveAs(dlPath);
    const db = new SQL.Database(new Uint8Array(fs.readFileSync(dlPath)));
    assert.equal(db.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], '12');
    assert.ok(db.exec('SELECT count(*) FROM note_history')[0].values[0][0] >= 1);
    db.run('DROP TABLE note_history; UPDATE meta SET value = \'10\' WHERE key = \'schema_version\';');
    const v10 = path.join(tmp, 'schema10.sqlite');
    fs.writeFileSync(v10, Buffer.from(db.export()));
    db.close();
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: 'de-CH' });
    const page2 = await ctx2.newPage();
    const errors2 = [];
    page2.on('pageerror', e => errors2.push(String(e)));
    page2.on('console', m => { if (m.type() === 'error') errors2.push(m.text()); });
    await page2.goto(APP_URL);
    await page2.waitForSelector(READY, { timeout: 30000 });
    await page2.setInputFiles('#importInput', v10);
    await page2.waitForFunction(() => document.querySelector('#status').textContent.length > 0);
    await page2.click('#menuBtn');
    const [dl2] = await Promise.all([page2.waitForEvent('download'), page2.click('#downloadBtn')]);
    const migPath = path.join(tmp, 'migriert.sqlite');
    await dl2.saveAs(migPath);
    const db2 = new SQL.Database(new Uint8Array(fs.readFileSync(migPath)));
    assert.equal(db2.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], '12');
    assert.equal(db2.exec("SELECT count(*) FROM sqlite_master WHERE name='note_history'")[0].values[0][0], 1);
    db2.close();
    assert.deepEqual(errors2, []);
    await ctx2.close();
    step('Datei: Schema 12 mit Tabelle note_history, Migration einer Schema-10-Datei');

    assert.deepEqual(errors, [], 'keine Fehler im Browser');
    await ctx.close();
    console.log('\nVerlauf-Test bestanden.');
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error('\nVerlauf-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
