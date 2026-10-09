/* Vertragstest der Backend-Schnittstelle (NoNotesBackend) gegen das lokale Backend.
   Jedes weitere Backend (selbst gehostet, SaaS) muss denselben Vertrag erfüllen: Methodenliste, nur
   JSON-taugliche Rückgabewerte (ausser Bilddaten), Fehler mit Kennung, Meldung von Änderungen.
   Ausführen: npm test (nach tools/build.cjs). */
'use strict';

const path = require('node:path');
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
const step = name => console.log('  ✓ ' + name);

/** Läuft in der Seite. Gibt eine Liste von Befunden zurück (leer = in Ordnung). */
async function contract() {
  const findings = [];
  const fail = msg => findings.push(msg);
  const SQL = await window.initSqlJs();
  const DB = window.NoNotesDB;
  const C = window.NoNotesBackend;
  let db = DB.open(SQL, null);
  const changes = [];
  const B = window.NoNotesBackendLocal.create({ getDb: () => db, onChange: name => changes.push(name) });

  // 1. Methodenliste
  const miss = C.missing(B);
  if (miss.length) fail('Methoden fehlen: ' + miss.join(', '));
  // Jede Funktion in db.js, die mit db als erstem Argument arbeitet, ist Teil des Vertrags oder bewusst intern.
  const INTERNAL = new Set(['open', 'exportBytes', 'configure', 'normalizeTag', 'syncQuestions', 'syncTasks', 'subtreeNoteIds']);
  for (const [name, fn] of Object.entries(DB)) {
    if (typeof fn !== 'function' || INTERNAL.has(name)) continue;
    if (!C.METHODS.includes(name)) fail(`db.js-Funktion ${name} ist weder im Vertrag noch als intern vermerkt`);
  }
  for (const name of C.MUTATING) if (!C.METHODS.includes(name)) fail(`MUTATING enthält unbekannte Methode ${name}`);

  // 2. Ablauf mit allen Arten von Daten; jede Rückgabe muss JSON-tauglich sein
  const seen = [];
  const call = async (name, ...args) => {
    const before = changes.length;
    const r = await B[name](...args);
    const mutating = C.MUTATING.has(name);
    if (mutating && changes.length === before) fail(`${name} ändert Daten, meldet aber keine Änderung`);
    if (!mutating && changes.length !== before) fail(`${name} liest nur, meldet aber eine Änderung`);
    if (name !== 'getAttachment' && name !== 'allAttachments') {
      let round;
      try { round = JSON.parse(JSON.stringify(r === undefined ? null : r)); } catch (e) { fail(`${name}: nicht serialisierbar`); return r; }
      if (JSON.stringify(round) !== JSON.stringify(r === undefined ? null : r)) fail(`${name}: Rückgabe ist nicht JSON-sicher`);
    }
    seen.push(name);
    return r;
  };

  const a = await call('createNote', null);
  const b = await call('createNote', a);
  await call('updateNote', a, 'Alpha', 'Text\n- [ ] Aufgabe @15.10.2026\n  - [ ] Unterpunkt\n? Frage? @16.10.2026\n[[Beta]]');
  await call('renameNote', b, 'Beta');
  await call('setTags', a, ['x', 'y']);
  await call('setMeta', 'testkey', 'wert');
  await call('setMapTitle', 'Karte');
  await call('getMeta', 'testkey');
  await call('getMapTitle');
  await call('getTree', {});
  await call('getNote', a);
  await call('getPath', b);
  await call('listNotes', '', {});
  await call('countNotes', {});
  await call('findNoteByTitle', 'Beta');
  const index = await call('titleIndex');
  if (!Array.isArray(index) || !index.length || !Array.isArray(index[0]) || index[0].length !== 2) fail('titleIndex liefert keine Paare');
  await call('getTags', a);
  await call('listAllTags');
  await call('listTasks', { status: 'all', sort: 'due' });
  await call('countTasks', '2026-01-01');
  const tasks = await B.listTasks({ status: 'all', sort: 'due' });
  if (tasks.length) await call('getTask', tasks[0].id);
  await call('listQuestions', { status: 'all', sort: 'due' });
  await call('countQuestions', '2026-01-01');
  const qs = await B.listQuestions({ status: 'all' });
  if (qs.length) { await call('getQuestion', qs[0].id); await call('answerQuestion', qs[0].id, 'Antwort'); }
  await call('setCollapsed', a, true);
  await call('setAllCollapsed', false);
  await call('moveNote', b, a, 'after').catch(() => {});
  await call('moveAmongSiblings', b, -1).catch(() => {});
  await call('setParent', b, a).catch(() => {});
  const att = await call('addAttachment', a, { name: 'x.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
  await call('listAttachments', a);
  const got = await call('getAttachment', att);
  if (!(got && got.data && got.data.length === 3)) fail('getAttachment liefert die Bytes nicht');
  await call('allAttachments', {});
  await call('attachmentsSize');
  await call('deleteAttachment', att);
  await call('archiveCount', [b]);
  await call('archiveNote', b);
  await call('isArchived', b);
  await call('countArchived');
  await call('unarchiveNote', b);
  const c = await call('createNote', null);
  await call('deleteNote', c);
  await call('countTrash');
  await call('restoreNote', c);
  await call('deleteNote', c);
  await call('purgeNote', c);
  await call('emptyTrash');

  // 3. Fehler mit Kennung
  await call('archiveNote', a);
  const expect = async (code, fn) => {
    try { await fn(); fail(`kein Fehler für ${code}`); }
    catch (e) {
      if (e.code !== code) fail(`Fehlerkennung ${e.code} statt ${code}`);
      if (!window.NoNotesBackend.errorText(e)) fail(`kein Text zu ${code}`);
    }
  };
  await expect('ARCHIVED_NO_CHILD', () => B.createNote(a));
  await expect('ARCHIVED_NO_MOVE', () => B.setParent(b, null));
  await call('unarchiveNote', a);
  await expect('MOVE_INTO_SELF', () => B.setParent(a, a));
  const t2 = tasks.find(t => t.parent_id == null) || tasks[0];
  if (t2) {
    await B.setTaskDone(t2.id, true).then(() => fail('Hauptaufgabe mit offener Unteraufgabe abgehakt')).catch(e => { if (e.code !== 'SUBTASKS_OPEN') fail('SUBTASKS_OPEN erwartet, ' + e.code); else if (typeof e.open !== 'number') fail('SUBTASKS_OPEN ohne Anzahl open'); });
  }

  // 4. Abdeckung: der Ablauf hat jede Methode berührt
  const unused = C.METHODS.filter(m => !seen.includes(m) && m !== 'setTaskDone' && m !== 'toggleTaskTree');
  if (unused.length) fail('im Vertragstest nicht berührt: ' + unused.join(', '));

  // 5. normalizeTag stimmt mit db.js überein
  for (const s of ['  #Tag  ', 'a   b', '#', '', null, '##x', ' x ']) {
    if (C.normalizeTag(s) !== DB.normalizeTag(s)) fail(`normalizeTag weicht ab für ${JSON.stringify(s)}`);
  }
  return findings;
}

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(APP_URL);
    await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
    const findings = await page.evaluate(contract);
    assert.deepEqual(findings, [], 'Vertrag verletzt:\n' + findings.join('\n'));
    step('Backend-Vertrag: Methodenliste, JSON-sichere Rückgaben, Änderungsmeldung, Fehlerkennungen');
    assert.deepEqual(errors, []);
    console.log('\nBackend-Test bestanden.');
  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error('\nBackend-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
