/* Zusammenarbeits-Test: Verlauf pro Notiz, gleichzeitiges Schreiben (Zusammenführen und Konfliktdialog), Änderungen von aussen
   (Datei und anderer Tab) und der Lesemodus. Ausführen: node test/collab.cjs (nach tools/build.cjs) */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { suite } = require('./lib.cjs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'NoNotes');
const APP_URL = 'file://' + path.join(DIST, 'index.html');
const initSqlJs = require(path.join(ROOT, 'vendor/sql.js/sql-asm.js'));
const READY = 'body[data-ready="true"]';
const SCHEMA_VERSION = '14'; // muss zu packages/data/db.js passen
const SAVED = () => document.querySelector('#status').dataset.state === 'saved';

// ============================================================
/* Test des Verlaufs pro Note (v1.3.0): Patches, Arbeitsphasen, Aufbewahrung, Wiederherstellen, Dialog, Migration.
   Die Uhr der Seite wird verschoben (window.__skew), damit Pausen und Zeiträume prüfbar sind. */
async function runHistory(browser, part, step) {
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
    part('Verlauf: Patches (Zufall, Emoji), Arbeitsphasen, Titel, Wiederherstellen, Archiv, Aufbewahrung, Platz');

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

    await page.click('#noteMenuBtn');
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
    await page.click('#noteMenuBtn');
    await page.click('#historyBtn');
    await page.waitForSelector('#historyDialog[open]');
    await page.waitForFunction(() => document.querySelectorAll('#historyList button').length === 3);
    await page.uncheck('#historyDiff');
    assert.equal(await page.locator('#historyText').innerText(), 'Zeile eins\nZeile zwei geändert\nZeile drei\nZeile vier', 'neueste Fassung = Stand vor dem Wiederherstellen');
    part('Dialog: Fassungen, Markierung der Unterschiede, Wiederherstellen, Stand davor bleibt');

    // Verlauf löschen
    await page.click('#historyClearBtn');
    await page.waitForFunction(() => document.querySelectorAll('#historyList button').length === 0);
    assert.match(await page.locator('#historyList').innerText(), /Noch keine früheren Fassungen/);
    assert.equal(await page.locator('#historyRestoreBtn').isDisabled(), true);
    assert.ok(dialogs.some(m => /Verlauf dieser Notiz löschen/.test(m)), 'Rückfrage vor dem Löschen');
    assert.equal(await page.inputValue('#body'), 'Zeile eins\nZeile zwei', 'der Text bleibt');
    await page.keyboard.press('Escape');
    part('Dialog: Verlauf löschen mit Rückfrage, Text bleibt');

    // Archiv: ansehen ja, wiederherstellen nein
    await jump(10 * MIN);
    await page.fill('#body', 'Zeile eins');
    await page.waitForFunction(SAVED);
    await jump(10 * MIN);
    await page.fill('#body', 'Zeile eins und mehr');
    await page.waitForFunction(SAVED);
    await page.click('#noteMenuBtn');
    await page.click('#archiveBtn');
    await page.waitForFunction(() => !document.querySelector('#archiveBar').hidden || document.querySelectorAll('#list li').length === 0);
    await page.selectOption('#listScope', 'archive');
    await page.locator('#list li').first().click();
    await page.waitForSelector('#archiveBar:not([hidden])');
    await page.click('#noteMenuBtn');
    await page.click('#historyBtn');
    await page.waitForSelector('#historyDialog[open]');
    await page.waitForFunction(() => document.querySelectorAll('#historyList button').length >= 1);
    assert.equal(await page.locator('#historyRestoreBtn').isDisabled(), true, 'archiviert: nur ansehen');
    await page.keyboard.press('Escape');
    // Papierkorb: kein Verlauf-Knopf
    await page.selectOption('#listScope', 'live');
    part('Dialog: archivierte Notiz nur ansehen');

    // Datei: Tabelle note_history, Schema 13; Migration einer Schema-10-Datei
    await page.waitForFunction(SAVED);
    await page.click('#menuBtn');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')]);
    const dlPath = path.join(tmp, 'verlauf.sqlite');
    await dl.saveAs(dlPath);
    const db = new SQL.Database(new Uint8Array(fs.readFileSync(dlPath)));
    assert.equal(db.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], '14');
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
    assert.equal(db2.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], '14');
    assert.equal(db2.exec("SELECT count(*) FROM sqlite_master WHERE name='note_history'")[0].values[0][0], 1);
    db2.close();
    assert.deepEqual(errors2, []);
    await ctx2.close();
    part('Datei: Schema 13 mit Tabelle note_history, Migration einer Schema-10-Datei');

    assert.deepEqual(errors, [], 'keine Fehler im Browser');
    await ctx.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ============================================================
/* Test der gleichzeitigen Änderung (v1.5.0): Speichern auf Basis des letzten Stands, automatisches Zusammenführen, Konfliktdialog
   (meine Fassung, neue Fassung, Markierungen, später entscheiden), Übernahme von Änderungen von aussen, Autor im Verlauf.
   Eine zweite Schreibende wird über die Erweiterungs-Schnittstelle nachgestellt: sie ändert die Notiz hinter dem Rücken des Editors. */
async function runConflict(browser, part, step) {
  const PLUGIN = `
    NoNotesPlugins.register({ id: 'andere', name: 'Zweite Schreibende', api: 1, activate(ctx) { window.__ctx = ctx; } });`;

  const LINES = Array.from({ length: 10 }, (_, i) => `Zeile ${i + 1}`);
  const text = lines => lines.join('\n');
  const withLine = (i, value) => LINES.map((l, k) => (k === i ? value : l));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-conflict-'));
  const dir = path.join(tmp, 'NoNotes');
  fs.cpSync(DIST, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'andere.js'), PLUGIN);
  fs.writeFileSync(path.join(dir, 'plugins', 'plugins.js'), "NoNotesPlugins.list(['andere.js']);\n");
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
  part('Verschiedene Stellen: automatisch zusammengeführt, im Editor und in der Datei');

  // ... und weiter schreiben funktioniert (der Stand ist nachgeführt, kein erneuter Konflikt)
  await page.fill('#body', merged + '\nZeile 11');
  await page.waitForFunction(SAVED);
  assert.equal((await dbNote(id)).body, merged + '\nZeile 11');
  part('Danach geht das Speichern normal weiter');

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
  part('Dieselbe Stelle: Dialog zeigt beide Fassungen und den Namen, nichts wird überschrieben');

  // Meine Fassung behalten
  await page.click('#conflictMineBtn');
  await page.waitForFunction(SAVED);
  await page.waitForFunction(() => !document.querySelector('#conflictDialog').open);
  assert.equal((await dbNote(id)).body, text(withLine(4, 'Zeile 5 MEINE')));
  part('Entscheidung «Meine Fassung behalten»');

  // Neue Fassung übernehmen
  await other(id, text(withLine(4, 'Zeile 5 NEU von anderer')), null);
  await page.fill('#body', text(withLine(4, 'Zeile 5 noch einmal MEINE')));
  await page.waitForSelector('#conflictDialog[open]');
  await page.click('#conflictTheirsBtn');
  await page.waitForFunction(() => !document.querySelector('#conflictDialog').open);
  await page.waitForFunction(SAVED);
  assert.equal(await page.inputValue('#body'), text(withLine(4, 'Zeile 5 NEU von anderer')));
  assert.equal((await dbNote(id)).body, text(withLine(4, 'Zeile 5 NEU von anderer')));
  part('Entscheidung «Neue Fassung übernehmen»: meine strittige Änderung fällt weg');

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
  part('Entscheidung «Beide mit Markierungen»: Markierungen an der strittigen Stelle, alles andere zusammengeführt');

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
  part('Später entscheiden: Hinweisleiste, Wechseln der Notiz führt zurück zur Entscheidung');
  await close();

  // ---------- 4. Änderung von aussen ohne eigene Eingabe ----------
  id = await newNote('Ruhig', 'Anfang');
  await page.click('#body'); // Fokus im Feld: früher wurde das nie überschrieben
  await other(id, 'Anfang\nvon der anderen', 'Ben');
  await page.evaluate(() => __ctx.refresh());
  await page.waitForFunction(() => document.querySelector('#body').value === 'Anfang\nvon der anderen');
  assert.match(await page.locator('#noteMeta').innerText(), /von Ben/);
  part('Ohne eigene Eingabe: die Änderung der anderen erscheint im Editor, auch mit Fokus; die Notiz nennt den Autor');

  // ---------- 5. Autor im Verlauf ----------
  await page.fill('#body', 'Anfang\nvon der anderen\nund von mir');
  await page.waitForFunction(SAVED);
  await page.click('#noteMenuBtn');
  await page.click('#historyBtn');
  await page.waitForSelector('#historyDialog[open]');
  await page.waitForFunction(() => document.querySelectorAll('#historyList button').length >= 1);
  assert.match(await page.locator('#historyList').innerText(), /von Ben/);
  await page.keyboard.press('Escape');
  part('Verlauf: die Fassung der anderen trägt ihren Namen');

  // ---------- 6. Tippen: viele Eingaben, ein Ergebnis ----------
  await close();
  id = await newNote('Tippen', '');
  await page.click('#body');
  await page.keyboard.type('Eine längere Zeile, die schnell getippt wird.', { delay: 0 });
  await page.waitForFunction(SAVED);
  await page.waitForFunction(async id => (await __ctx.backend.getNote(id)).body === 'Eine längere Zeile, die schnell getippt wird.', id);
  part('Schnelles Tippen: am Ende steht der ganze Text in der Datei');

  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  assert.deepEqual(dialogs, [], 'keine unerwarteten Rückfragen: ' + dialogs.join(' | '));
  part('Keine Browserfehler');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ============================================================
/* Test der Änderungen von aussen in der lokalen Ausprägung (v1.5.0): Wird die verbundene Datei oder der Browser-Speicher von
   jemand anderem beschrieben (anderes Programm, anderer Tab), meldet die App es und die Person entscheidet: neu laden (eigene
   Änderungen verwerfen) oder die eigene Fassung behalten (überschreiben). Ohne ungesicherte eigene Änderungen wird still neu geladen. */
async function runExternal(browser, part, step) {
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

  const { SQL, DB } = await loadDb();
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
  part('Datei von aussen geändert, nichts Ungesichertes: wird still neu geladen und in der Statuszeile gemeldet');

  // Nur der Zeitstempel ändert sich: keine Meldung
  await setFile(await fileBytes(), 3);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#banner:not([hidden])').count(), 0);
  part('Nur der Zeitstempel der Datei ändert sich, der Inhalt nicht: keine Meldung');

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
  part('Datei von aussen geändert, eigene Änderung ungesichert: Rückfrage, die Datei bleibt unberührt');

  // Datei laden: eigene Änderung verworfen
  await page.click('#banner button:has-text("Datei laden")');
  await page.waitForSelector('#banner', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#list').textContent.includes('Von aussen zwei'));
  assert.ok(!(await page.locator('#list').innerText()).includes('Eigene Notiz geändert'), 'die eigene Änderung ist verworfen');
  part('Entscheidung «Datei laden»: Stand der Datei, eigene Änderung verworfen');

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
  part('Entscheidung «Meine Fassung behalten»: Datei mit meinem Stand überschrieben');

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
  part('Datei ändert sich während des Speicherns: die App prüft kurz vor dem Schreiben und fragt, statt zu überschreiben');
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
  part('Anderer Tab hat gespeichert, hier nichts Ungesichertes: der Stand wird still übernommen');

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
  part('Anderer Tab hat gespeichert, hier ungesichert: Rückfrage; «Stand dort laden» verwirft die eigene Änderung');

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
  part('«Meine Fassung behalten» schreibt den eigenen Stand in den Browser-Speicher');

  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  part('Keine Browserfehler');
}

// ============================================================
/* Test des Lesemodus (v1.5.1): Meldet die Hülle `readOnly`, sind alle Schreibwege gesperrt, das Backend lehnt schreibende Aufrufe ab
   (auch für Erweiterungen), Auf-/Zuklappen bleibt erlaubt, und ohne die Meldung ändert sich nichts am bisherigen Verhalten.
   Die Hülle wird im Test mit einem Skript vor dem Start umhüllt (Merkzeichen in localStorage), die Daten legt vorher dieselbe Seite an. */
async function runReadonly(browser, part, step) {
  const PLUGIN = `
    NoNotesPlugins.register({ id: 'zugriff', name: 'Zugriff', api: 1, activate(ctx) { window.__ctx = ctx; } });`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-readonly-'));
  const dir = path.join(tmp, 'NoNotes');
  fs.cpSync(DIST, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'zugriff.js'), PLUGIN);
  fs.writeFileSync(path.join(dir, 'plugins', 'plugins.js'), "NoNotesPlugins.list(['zugriff.js']);\n");
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
  part('Normaler Modus: Schreibwege sind da, kein Lesemodus');

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
  part('Lesemodus: Knöpfe zum Anlegen und Importieren und die Wahl der Hauptfarbe sind ausgeblendet');

  // Notiz öffnen: alles gesperrt, aber lesbar
  await page.dblclick('.mm-node:has(> text:text-is("Plan"))');
  await page.waitForSelector('#editorPane:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#title').value === 'Plan');
  assert.equal(await page.locator('#title').evaluate(e => e.readOnly), true);
  assert.equal(await page.locator('#body').evaluate(e => e.readOnly), true);
  assert.equal(await page.locator('#tagInput').isVisible(), false);
  await page.click('#noteMenuBtn'); // die Aktionen liegen im Menü «Notiz»
  for (const sel of ['#childBtn', '#archiveBtn', '#deleteBtn']) assert.equal(await page.locator(sel).isVisible(), false, sel + ' ist ausgeblendet');
  assert.equal(await page.locator('#historyBtn').isVisible(), true, 'den Verlauf darf man ansehen');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#body').inputValue(), '- [ ] Aufgabe eins\n? Wer macht das?\n\nText');
  const before = await page.evaluate(id => __ctx.backend.getNote(id).then(n => n.updated_at), ids.a);
  await page.focus('#body');
  await page.keyboard.type('Tippen ändert nichts');
  assert.equal(await page.locator('#body').inputValue(), '- [ ] Aufgabe eins\n? Wer macht das?\n\nText');
  part('Notiz: Titel, Text und Tags gesperrt, Schaltflächen zum Ändern ausgeblendet, Verlauf bleibt sichtbar');

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
  part('Backend: alle schreibenden Aufrufe werden mit READ_ONLY abgelehnt, die Daten bleiben unverändert');

  // Auf- und Zuklappen ist Ansicht und bleibt erlaubt
  const collapsed = await page.evaluate(async id => {
    await __ctx.backend.setCollapsed(id, true);
    const info = await __ctx.backend.getNote(id);
    await __ctx.backend.setAllCollapsed(false);
    return info.collapsed;
  }, ids.a);
  assert.ok(collapsed === 1 || collapsed === true, 'setCollapsed geht durch');
  part('Auf-/Zuklappen bleibt erlaubt (persönliche Ansicht)');

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
  part('Mindmap: Tab und Entf tun nichts und nennen den Grund, das Kontextmenü enthält nur Lesendes');

  // Fragen und Aufgaben
  await page.click('#viewQuestionsBtn');
  await page.waitForSelector('#qList .q-item');
  assert.equal(await page.locator('#qList .q-actions button:text-is("Beantworten")').first().isVisible(), false, 'kein Antwortknopf');
  await page.click('#viewTasksBtn');
  await page.waitForSelector('#tList .t-item');
  assert.equal(await page.locator('#tList .t-check').first().isDisabled(), true, 'Kästchen gesperrt');
  part('Fragen und Aufgaben: kein Antwortknopf, Kästchen gesperrt');

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
  part('Ohne die Meldung der Hülle ist alles wie bisher');

  assert.deepEqual(errors.filter(e => !/Nur lesen|READ_ONLY/.test(e)), [], 'Fehler im Browser:\n' + errors.join('\n'));
  fs.rmSync(tmp, { recursive: true, force: true });
}

suite('Zusammenarbeits-Test', [
  { name: 'Verlauf: Patches, Arbeitsphasen, Wiederherstellen, Aufbewahrung, Dialog mit Unterschieden, Verlauf löschen, archivierte Notiz; Datei mit Schema 10', run: runHistory },
  { name: 'Gleichzeitig schreiben: getrennte Stellen zusammengeführt, dieselbe Stelle als Dialog mit drei Entscheidungen, später entscheiden, Autor im Verlauf, schnelles Tippen', run: runConflict },
  { name: 'Von aussen geändert: Datei und anderer Tab, still übernehmen oder Rückfrage mit beiden Entscheidungen, Prüfung kurz vor dem Schreiben', run: runExternal },
  { name: 'Lesemodus: Schreibwege ausgeblendet oder gesperrt, Backend lehnt mit READ_ONLY ab, Auf-/Zuklappen erlaubt, Mindmap und Listen passend', run: runReadonly },
], { browser: true });
