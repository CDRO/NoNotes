/* Kern-Test ohne Browser: Zusammenführen, Datenbankschicht (Standardschema, Angleichen alter Dateien, Konflikte, Autor,
   Querverweise, Entscheide), mehrzeilige Entscheide und Fragen, Build fremder Ausprägungen, Videoadressen, Werkzeugkatalog für Agenten und MCP-Protokoll. Ausführen: node test/core.cjs */
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
const SCHEMA_VERSION = '18'; // muss zu packages/data/db.js passen
const SAVED = () => document.querySelector('#status').dataset.state === 'saved';

// ============================================================
/* Test des Zusammenführens (packages/core/merge.js) ohne Browser: Myers-Vergleich gegen eine einfache Berechnung der längsten
   gemeinsamen Teilfolge, Eigenschaften des Dreiwege-Vergleichs mit Zufallsdaten, Konflikte, Grössen. */
async function runMerge(browser, part, step) {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'packages', 'core', 'merge.js'), 'utf8'), ctx);
  const { merge3, resolve, matches, mapCaret } = ctx.NoNotesMerge;

  // deterministischer Zufall
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

  function lcsLength(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    return dp[a.length][b.length];
  }

  // 1. Myers findet eine längste gemeinsame Teilfolge, und die Zuordnung ist gültig (gleiche Zeilen, aufsteigend)
  for (let t = 0; t < 3000; t++) {
    const alphabet = 1 + rnd(5);
    const a = Array.from({ length: rnd(14) }, () => String(rnd(alphabet)));
    const b = Array.from({ length: rnd(14) }, () => String(rnd(alphabet)));
    const m = matches(a, b);
    let last = -1;
    let n = 0;
    m.forEach((j, i) => {
      if (j < 0) return;
      assert.equal(a[i], b[j], 'gleiche Zeilen');
      assert.ok(j > last, 'aufsteigend');
      last = j;
      n++;
    });
    assert.equal(n, lcsLength(a, b), `längste Teilfolge: ${JSON.stringify([a, b])}`);
  }
  part('Vergleich: 3000 Zufallspaare liefern eine längste gemeinsame Teilfolge, gültig und aufsteigend');

  // 2. Eigenschaften
  const doc = n => Array.from({ length: n }, (_, i) => `Zeile ${i}`);
  const text = lines => lines.join('\n');
  for (let t = 0; t < 2000; t++) {
    const base = doc(1 + rnd(12));
    const b = text(base);
    const edit = (lines) => {
      const out = lines.slice();
      const at = rnd(out.length + 1);
      const kind = rnd(3);
      if (kind === 0) out.splice(at, 0, `neu ${t}-${rnd(1000)}`);
      else if (kind === 1 && out.length) out.splice(Math.min(at, out.length - 1), 1);
      else if (out.length) out[Math.min(at, out.length - 1)] = `geändert ${t}-${rnd(1000)}`;
      return out;
    };
    const m = text(edit(base));
    const th = text(edit(base));
    assert.equal(merge3(b, m, b).text, m);
    assert.equal(merge3(b, b, th).text, th);
    assert.equal(merge3(b, m, m).text, m);
    assert.ok(merge3(b, m, th).clean === merge3(b, th, m).clean, 'Sauberkeit hängt nicht von der Reihenfolge ab');
    const r = merge3(b, m, th);
    if (r.clean) assert.equal(resolve(r.parts, 'theirs'), r.text);
  }
  part('Eigenschaften: unverändert übernimmt die andere Fassung, gleiche Änderungen sind kein Konflikt, Reihenfolge egal');

  // 3. Getrennte Stellen werden zusammengeführt (mit Zeile Abstand)
  for (let t = 0; t < 2000; t++) {
    const n = 6 + rnd(20);
    const base = doc(n);
    const a1 = rnd(n - 4);
    const a2 = a1 + 1 + rnd(2);                 // Bereich A: [a1, a2)
    const b1 = a2 + 1 + rnd(Math.max(1, n - a2 - 2)); // mindestens eine unveränderte Zeile dazwischen
    const b2 = Math.min(n, b1 + 1 + rnd(2));
    if (b1 >= n) continue;
    const X = Array.from({ length: rnd(3) }, (_, i) => `X${t}-${i}`);
    const Y = Array.from({ length: rnd(3) }, (_, i) => `Y${t}-${i}`);
    const mine = [...base.slice(0, a1), ...X, ...base.slice(a2)];
    const theirs = [...base.slice(0, b1), ...Y, ...base.slice(b2)];
    const expected = [...base.slice(0, a1), ...X, ...base.slice(a2, b1), ...Y, ...base.slice(b2)];
    const r = merge3(text(base), text(mine), text(theirs));
    assert.ok(r.clean, `getrennte Änderungen müssen sauber zusammengehen: A[${a1},${a2}) B[${b1},${b2}) n=${n}`);
    assert.equal(r.text, text(expected));
    const r2 = merge3(text(base), text(theirs), text(mine));
    assert.ok(r2.clean && r2.text === text(expected), 'auch mit vertauschten Rollen');
  }
  part('Getrennte Änderungen: 2000 Zufallsfälle ergeben genau den Text mit beiden Änderungen, in beiden Richtungen');

  // 4. Konflikte
  {
    const base = text(['a', 'b', 'c', 'd']);
    const mine = text(['a', 'B-mein', 'c', 'd']);
    const theirs = text(['a', 'B-dein', 'c', 'd']);
    const r = merge3(base, mine, theirs);
    assert.equal(r.clean, false);
    assert.equal(r.parts.filter(p => p.type === 'conflict').length, 1);
    const c = r.parts.find(p => p.type === 'conflict');
    assert.deepEqual(JSON.parse(JSON.stringify([c.base, c.mine, c.theirs])), [['b'], ['B-mein'], ['B-dein']]);
    assert.equal(r.text, mine);
    assert.equal(resolve(r.parts, 'theirs'), theirs);
    assert.equal(resolve(r.parts, 'mine'), mine);
    assert.equal(resolve(r.parts, 'markers', { mine: 'M', theirs: 'T' }), ['a', '<<<<<<< M', 'B-mein', '=======', 'B-dein', '>>>>>>> T', 'c', 'd'].join('\n'));
    // eine Seite löscht, die andere ändert dieselbe Zeile
    const r2 = merge3(base, text(['a', 'c', 'd']), theirs);
    assert.equal(r2.clean, false);
    // beide fügen an derselben Stelle verschiedenes ein
    const r3 = merge3(text(['a', 'c']), text(['a', 'm', 'c']), text(['a', 't', 'c']));
    assert.equal(r3.clean, false);
    // beide fügen dasselbe ein
    const r4 = merge3(text(['a', 'c']), text(['a', 'x', 'c']), text(['a', 'x', 'c']));
    assert.ok(r4.clean);
    // Änderungen in mehreren Bereichen, einer davon strittig
    const bigBase = doc(30);
    const bigMine = bigBase.slice(); bigMine[3] = 'mein 3'; bigMine[20] = 'mein 20';
    const bigTheirs = bigBase.slice(); bigTheirs[10] = 'dein 10'; bigTheirs[20] = 'dein 20';
    const r5 = merge3(text(bigBase), text(bigMine), text(bigTheirs));
    assert.equal(r5.parts.filter(p => p.type === 'conflict').length, 1);
    assert.match(resolve(r5.parts, 'theirs'), /mein 3/);
    assert.match(resolve(r5.parts, 'theirs'), /dein 10/);
    assert.match(resolve(r5.parts, 'theirs'), /dein 20/);
    assert.doesNotMatch(resolve(r5.parts, 'theirs'), /mein 20/);
  }
  part('Konflikte: strittige Stelle wird gemeldet, Auflösen nach mine/theirs/Markierungen, die übrigen Änderungen bleiben');

  // 5. Notiztypische Fälle: Aufgabenliste, Leerzeilen, Text ohne Umbruch, leerer Text
  {
    const base = '# Plan\n\n- [ ] eins\n- [ ] zwei\n\nSchluss\n';
    const mine = base.replace('- [ ] eins', '- [x] eins');
    const theirs = base.replace('Schluss', 'Schluss und mehr');
    const r = merge3(base, mine, theirs);
    assert.ok(r.clean);
    assert.equal(r.text, '# Plan\n\n- [x] eins\n- [ ] zwei\n\nSchluss und mehr\n');
    assert.equal(merge3('', 'a', '').text, 'a');
    assert.equal(merge3('', '', 'b').text, 'b');
    assert.equal(merge3('', 'a', 'b').clean, false);
    assert.equal(merge3('ein Satz', 'ein Satz hier', 'ein Satz').text, 'ein Satz hier');
    assert.equal(merge3('ein Satz', 'ein Satz hier', 'ein Satz da').clean, false, 'dieselbe Zeile verschieden geändert');
  }
  part('Notizen: Aufgaben abhaken und anderswo ergänzen geht zusammen, leere Texte, Text ohne Umbruch');

  // 6. Grösse und Zeit
  {
    const base = doc(8000);
    const mine = base.slice(); mine[100] = 'vorn'; mine.splice(7000, 0, 'eingefügt A');
    const theirs = base.slice(); theirs[4000] = 'mitte'; theirs.splice(7900, 1);
    const t0 = Date.now();
    const r = merge3(text(base), text(mine), text(theirs));
    const ms = Date.now() - t0;
    assert.ok(r.clean, 'grosse Notiz, weit auseinander liegende Änderungen');
    assert.ok(r.text.includes('vorn') && r.text.includes('mitte') && r.text.includes('eingefügt A') && !r.text.includes('Zeile 7900\n'));
    assert.ok(ms < 1500, `Zeit ${ms} ms`);
    // völlig verschiedene Texte brechen nicht ab, sondern melden einen Konflikt
    const noise = (seedText) => Array.from({ length: 6000 }, (_, i) => `${seedText}-${(i * 7919) % 6007}`);
    const t1 = Date.now();
    const r2 = merge3(text(doc(6000)), text(noise('p')), text(noise('q')));
    assert.equal(r2.clean, false);
    assert.ok(Date.now() - t1 < 8000, 'verschiedene Texte in vertretbarer Zeit');
    part(`Grösse: 8000 Zeilen in ${ms} ms, völlig verschiedene Texte brechen nicht ab`);
  }

  // 7. Cursor wandert mit
  {
    const old = 'eins\nzwei\ndrei';
    const withTop = 'neu oben\neins\nzwei\ndrei';
    assert.equal(mapCaret(old, withTop, 0), 9, 'am Anfang von «eins»');
    assert.equal(mapCaret(old, withTop, 7), 16, 'mitten in «zwei» (Spalte 2)');
    assert.equal(mapCaret(old, old, 5), 5);
    assert.equal(mapCaret('eins\nzwei', 'eins\nzwei\nunten', 6), 6, 'Änderung hinter dem Cursor verschiebt nichts');
    assert.equal(mapCaret('a\nb', 'a\nX', 3), 2, 'geänderte Zeile: hinter die letzte unveränderte davor');
    assert.equal(mapCaret('abc', 'abcd', 2), 2, 'einzeiliges Feld: Cursor bleibt, wo er war');
    assert.equal(mapCaret('abcdef', 'ab', 5), 2, 'nie hinter dem Ende');
    part('Cursor: wandert mit, wenn davor Zeilen dazukommen, und bleibt sonst stehen');
  }

}

// ============================================================
/* Test der Datenbankschicht ohne Browser: Schema 14 (Autor, Querverweise, Entscheide), Migration aus Schema 11, Konflikterkennung beim Speichern
   (NOTE_CONFLICT), Autor im Verlauf, Querverweise [[Titel*]]. Lädt dieselben Skripte wie die Seite in einen vm-Kontext, mit festgehaltener Uhr. */
async function runDb(browser, part, step) {
  let now = Date.parse('2026-10-10T08:00:00Z');
  const tick = ms => { now += ms; };

  const sandbox = { console };
  sandbox.window = sandbox;
  const RealDate = Date;
  sandbox.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(now); else super(...a); }
    static now() { return now; }
  };
  const context = vm.createContext(sandbox);
  for (const f of ['packages/core/i18n.js', 'packages/core/history.js', 'packages/core/dates.js', 'packages/core/questions.js', 'packages/core/tasks.js', 'packages/core/links.js', 'packages/core/backend.js', 'packages/core/merge.js', 'packages/data/db.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  const SQL = await require(path.join(ROOT, 'vendor', 'sql.js', 'sql-asm.js'))();
  const DB = sandbox.NoNotesDB;
  const Backend = sandbox.NoNotesBackend;
  const json = v => JSON.parse(JSON.stringify(v));

  // ---------- Schema 13 ----------
  let db = DB.open(SQL, null);
  const cols = (d, t) => d.exec(`PRAGMA table_info(${t})`)[0].values.map(r => r[1]);
  assert.equal(DB.getMeta(db, 'schema_version'), SCHEMA_VERSION);
  assert.ok(cols(db, 'notes').includes('updated_by'));
  assert.ok(cols(db, 'note_history').includes('author'));
  assert.deepEqual(cols(db, 'note_links'), ['id', 'note_id', 'title', 'key', 'line_no']);
  part('Schema 13: Spalten updated_by (Notiz) und author (Verlauf), Tabelle note_links (Querverweise)');

  // ---------- Migration aus Schema 11 (Tabellen so, wie v1.3 und v1.4 sie anlegten) ----------
  {
    const old = new SQL.Database();
    old.exec(`
      CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, parent_id INTEGER, sort_order INTEGER NOT NULL DEFAULT 0,
        collapsed INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, archived_at TEXT);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE questions (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, text TEXT NOT NULL, norm TEXT NOT NULL,
        answer TEXT, line_no INTEGER NOT NULL, created_at TEXT NOT NULL, answered_at TEXT, due TEXT);
      CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
      CREATE TABLE note_tags (note_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (note_id, tag_id));
      CREATE TABLE attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
        size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, text TEXT NOT NULL, norm TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0, due TEXT, line_no INTEGER NOT NULL, created_at TEXT NOT NULL, done_at TEXT, parent_id INTEGER,
        depth INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE note_history (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, at TEXT NOT NULL, started_at TEXT NOT NULL,
        open INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL, p INTEGER NOT NULL, s INTEGER NOT NULL, r TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '11');
      INSERT INTO notes (title, body, created_at, updated_at) VALUES ('Alt', 'Text', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
      INSERT INTO note_history (note_id, at, started_at, open, title, p, s, r) VALUES (1, '2026-01-01T12:00:00.000Z', '2026-01-02T00:00:00.000Z', 0, 'Ganz alt', 0, 0, 'Vorher');
    `);
    const bytes = old.export();
    old.close();
    const migrated = DB.open(SQL, bytes);
    assert.equal(DB.getMeta(migrated, 'schema_version'), SCHEMA_VERSION);
    assert.ok(cols(migrated, 'notes').includes('updated_by') && cols(migrated, 'note_history').includes('author'));
    assert.equal(DB.getNote(migrated, 1).title, 'Alt');
    assert.equal(DB.getNote(migrated, 1).updated_by, null);
    assert.equal(json(DB.listHistory(migrated, 1))[0].author, null);
    DB.updateNote(migrated, 1, 'Neu', 'Text neu', { author: 'Anna' });
    assert.equal(DB.getNote(migrated, 1).updated_by, 'Anna');
    migrated.close();
  }
  part('Migration: eine Schema-11-Datei bekommt die Spalten, Notizen und Verlauf bleiben, danach lässt sich mit Autor speichern');

  // ---------- Konflikterkennung ----------
  const n = DB.createNote(db, null);
  const t1 = DB.updateNote(db, n, 'Titel', 'eins');
  tick(1000);
  const t2 = DB.updateNote(db, n, 'Titel', 'zwei', { baseUpdatedAt: t1 });
  assert.notEqual(t1, t2);
  tick(1000);
  assert.throws(() => DB.updateNote(db, n, 'Titel', 'drei', { baseUpdatedAt: t1 }),
    e => e.code === 'NOTE_CONFLICT' && e.params.updated_at === t2);
  assert.equal(DB.getNote(db, n).body, 'zwei', 'bei einem Konflikt wird nichts geschrieben');
  DB.updateNote(db, n, 'Titel', 'vier'); // ohne Basis: wie bisher, der letzte gewinnt
  assert.equal(DB.getNote(db, n).body, 'vier');
  assert.ok(Backend.ERRORS.NOTE_CONFLICT);
  assert.match(Backend.errorText({ code: 'NOTE_CONFLICT' }), /geändert/);
  part('Konflikt: Speichern auf veraltetem Stand wirft NOTE_CONFLICT mit dem aktuellen Zeitstempel, ohne Basis gilt wie bisher der letzte Stand');

  // ---------- Autor ----------
  db = DB.open(SQL, null);
  const a = DB.createNote(db, null);
  tick(60 * 1000);
  DB.updateNote(db, a, 'Plan', 'Anfang', { author: 'Anna' });
  assert.equal(DB.getNote(db, a).updated_by, 'Anna');
  tick(30 * 1000);
  DB.updateNote(db, a, 'Plan', 'Anfang Mitte', { author: 'Anna' });  // gleiche Person, kurz danach: dieselbe Arbeitsphase
  tick(30 * 1000);
  DB.updateNote(db, a, 'Plan', 'Anfang Mitte Ende', { author: 'Ben' }); // andere Person: neue Fassung, auch ohne Pause
  assert.equal(DB.getNote(db, a).updated_by, 'Ben');
  const hist = json(DB.listHistory(db, a));
  assert.ok(hist.length >= 1);
  assert.equal(hist[0].author, 'Anna', 'die Fassung davor stammt von Anna');
  const v = json(DB.getHistoryVersion(db, a, hist[0].id));
  assert.equal(v.author, 'Anna');
  assert.equal(v.body, 'Anfang Mitte');
  part('Autor: die Notiz merkt sich, wer zuletzt geschrieben hat; ein Wechsel der Person beginnt eine neue Fassung im Verlauf');

  tick(30 * 1000);
  DB.renameNote(db, a, 'Plan neu', { author: 'Cleo' });
  assert.equal(DB.getNote(db, a).updated_by, 'Cleo');
  tick(10 * 60 * 1000);
  const r = DB.restoreHistoryVersion(db, a, hist[0].id, { author: 'Dora' });
  assert.equal(DB.getNote(db, a).updated_by, 'Dora');
  assert.equal(DB.getNote(db, a).body, 'Anfang Mitte');
  assert.ok(r.ts);
  const hist2 = json(DB.listHistory(db, a));
  assert.ok(hist2.some(h => h.author === 'Cleo'), 'der Stand vor dem Wiederherstellen (von Cleo) bleibt als Fassung');
  part('Autor: Umbenennen und Wiederherstellen tragen den Namen, der Stand davor behält seinen Autor');

  // ohne Autor (lokal) ändert sich nichts am bisherigen Verhalten
  const lonely = DB.createNote(db, null);
  tick(1000);
  DB.updateNote(db, lonely, 'x', 'eins');
  tick(1000);
  DB.updateNote(db, lonely, 'x', 'eins zwei');
  assert.equal(DB.getNote(db, lonely).updated_by, null);
  assert.equal(json(DB.listHistory(db, lonely)).length, 0, 'ohne Autor und ohne Pause bleibt es bei einer Arbeitsphase');
  part('Ohne Autor: Verlauf und Speichern verhalten sich wie bisher');

  // Autor wird bereinigt
  tick(1000);
  DB.updateNote(db, lonely, 'x', 'drei', { author: '   ' });
  assert.equal(DB.getNote(db, lonely).updated_by, null);
  DB.updateNote(db, lonely, 'x', 'vier', { author: 'A'.repeat(200) });
  assert.equal(DB.getNote(db, lonely).updated_by.length, 80);
  part('Autor: leer wird zu keinem Autor, zu lange Namen werden gekürzt');

  // ---------- Querverweise [[Titel*]] (Schema 13) ----------
  {
    const d = DB.open(SQL, null);
    const alpha = DB.createNote(d, null);
    const beta = DB.createNote(d, null);
    const gamma = DB.createNote(d, alpha);
    DB.renameNote(d, beta, 'Beta');
    DB.renameNote(d, gamma, 'Gamma');
    DB.updateNote(d, alpha, 'Alpha', 'Siehe [[Beta*]] und [[Gamma]] und [[Alpha*]] und [[Nirgends*]] und [[beta *]]\n```\n[[Gamma*]]\n```\nEnde [[ *]]');
    DB.updateNote(d, gamma, 'Gamma', 'Zurück zu [[ALPHA*]] und nochmals [[Alpha*]]');
    const links = () => json(DB.getLinks(d));
    assert.deepEqual(links(), [{ from_id: alpha, to_id: beta, title: 'Beta' }, { from_id: gamma, to_id: alpha, title: 'ALPHA' }]);
    assert.equal(d.exec('SELECT count(*) FROM note_links')[0].values[0][0], 4, 'je Notiz und Ziel ein Eintrag (Alpha: beta, alpha, nirgends; Gamma: alpha); ohne Ziel wartet der Eintrag, auf sich selbst zählt er nicht');
    part('Querverweise: nur [[Titel*]] zählt, Gross-/Kleinschreibung egal, Code-Block und leerer Titel nicht, auf sich selbst keine Linie');

    DB.updateNote(d, alpha, 'Alpha', 'Siehe [[Beta]]');
    assert.deepEqual(links(), [{ from_id: gamma, to_id: alpha, title: 'ALPHA' }], 'ohne Stern verschwindet die Linie');
    DB.updateNote(d, alpha, 'Alpha', 'Siehe [[Beta*]]');
    DB.deleteNote(d, beta);
    assert.deepEqual(links(), [{ from_id: gamma, to_id: alpha, title: 'ALPHA' }], 'gelöschtes Ziel: keine Linie');
    DB.restoreNote(d, beta);
    assert.equal(links().length, 2, 'zurückgeholt: die Linie ist wieder da');
    DB.archiveNote(d, beta);
    assert.equal(links().length, 2, 'archiviertes Ziel bleibt Ziel (die Karte zeigt die Linie nur mit dem Archiv)');
    DB.unarchiveNote(d, beta);
    const beta2 = DB.createNote(d, null);
    tick(1000);
    DB.updateNote(d, beta2, 'beta', 'zweite Notiz mit demselben Titel');
    assert.equal(links().find(l => l.from_id === alpha).to_id, beta2, 'gleicher Titel: wie bei [[Titel]] gewinnt die aktive, zuletzt geänderte Notiz');
    DB.deleteNote(d, gamma);
    DB.emptyTrash(d);
    assert.equal(d.exec('SELECT count(*) FROM note_links WHERE note_id = ?', [gamma])[0].values[0][0], 0, 'endgültig gelöscht: Einträge weg');
    part('Querverweise folgen Text, Papierkorb, Archiv und Titelauflösung');

    // [[Titel#42]] (seit 2.9.0): genau diese Notiz, auch nach Umbenennen; gibt es sie nicht mehr, keine Linie (kein Ausweichen)
    const p1 = DB.createNote(d, null), p2 = DB.createNote(d, null);
    DB.updateNote(d, p1, 'Protokoll', 'eins');
    tick(1000);
    DB.updateNote(d, p2, 'Protokoll', 'zwei');
    const linker = DB.createNote(d, null);
    DB.updateNote(d, linker, 'Verweise', `[[Protokoll#${p1}*]] und [[Protokoll*]]`);
    const fromLinker = () => links().filter(l => l.from_id === linker);
    assert.deepEqual(fromLinker(), [{ from_id: linker, to_id: p1, title: 'Protokoll' }, { from_id: linker, to_id: p2, title: 'Protokoll' }], 'mit Nummer die gemeinte, ohne die zuletzt geänderte');
    DB.renameNote(d, p1, 'Protokoll alt');
    assert.equal(fromLinker()[0].to_id, p1, 'nach dem Umbenennen bleibt das Ziel');
    DB.deleteNote(d, p1);
    assert.deepEqual(fromLinker().map(l => l.to_id), [p2], 'Ziel im Papierkorb: keine Linie dorthin, auch nicht zu einer anderen «Protokoll»');
    const sprint = DB.createNote(d, null);
    DB.updateNote(d, sprint, `Sprint#${p2}`, '');
    DB.updateNote(d, linker, 'Verweise', `[[Sprint#${p2}*]]`);
    assert.deepEqual(fromLinker().map(l => l.to_id), [sprint], 'ein Titel, der selbst auf #Zahl endet, gewinnt vor der Nummer');
    const pairs = json(DB.titleIndex(d));
    assert.equal(new Map(pairs).get('protokoll'), p2, 'new Map(titleIndex) ergibt den Index wie bisher');
    assert.ok(pairs.some(([, id]) => id === beta2) && pairs.some(([, id]) => id === beta) && !pairs.some(([, id]) => id === p1), 'alle lebenden Notizen, auch gleichnamige; Papierkorb nicht');
    const L = sandbox.NoNotesLinks;
    const find = L.resolver(pairs);
    assert.deepEqual(json(find(`Protokoll#${p2}`)), { id: p2, label: 'Protokoll' });
    assert.deepEqual(json(find('Protokoll#99999')), { id: null, label: 'Protokoll' }, 'unbekannte Nummer: offen');
    assert.deepEqual(json(find('protokoll')), { id: p2, label: 'protokoll' });
    assert.deepEqual(json(find(' ')), { id: null, label: '' });
    part('[[Titel#42]]: genau diese Notiz, auch umbenannt; ohne sie keine Linie; ein Titel mit #Zahl gewinnt; titleIndex mit allen Notizen');

    // Migration aus Schema 12: bestehende Texte werden gelesen
    const old = new SQL.Database(DB.exportBytes(d));
    old.run('DROP TABLE note_links');
    old.run("UPDATE meta SET value = '12' WHERE key = 'schema_version'");
    const bytes = old.export();
    old.close();
    const mig = DB.open(SQL, bytes);
    assert.equal(DB.getMeta(mig, 'schema_version'), SCHEMA_VERSION);
    assert.deepEqual(json(DB.getLinks(mig)), links(), 'die Linien (Alpha → beta, Verweise → Sprint) kommen aus den bestehenden Texten');
    part('Migration aus Schema 12: Tabelle angelegt und aus den Texten gefüllt');
  }

  // ---------- Entscheide, Personen und Datum (Schema 14) ----------
  {
    const d = DB.open(SQL, null);
    assert.ok(['kind', 'decided', 'people'].every(c => cols(d, 'questions').includes(c)), 'Spalten kind, decided, people am Index');
    const n1 = DB.createNote(d, null);
    DB.updateNote(d, n1, 'Plan', [
      '? Wie hoch ist das Budget? @max1234',
      '! 20k',
      '?! Variante B oder C? @lea5678 (@tom9012) >01.11.2026',
      '!! 14.10.2026: Variante B',
      '!! weil billiger',
      '?! Lieferant wählen @max1234',
      '!! allein ohne Öffner davor zählt nicht',
    ].join('\n'));
    const rows = d.exec("SELECT kind, text, answer, decided, people FROM questions ORDER BY line_no")[0].values;
    assert.deepEqual(rows, [
      ['question', 'Wie hoch ist das Budget? @max1234', '20k', null, '[{"handle":"max1234","optional":false}]'],
      ['decision', 'Variante B oder C? @lea5678 (@tom9012)', 'Variante B\nweil billiger', '2026-10-14', '[{"handle":"lea5678","optional":false},{"handle":"tom9012","optional":true}]'],
      ['decision', 'Lieferant wählen @max1234', 'allein ohne Öffner davor zählt nicht', null, '[{"handle":"max1234","optional":false}]'],
    ]);
    assert.equal(json(DB.listQuestions(d, { status: 'all' })).length, 1, 'ohne kind: nur Fragen (wie bisher)');
    assert.equal(json(DB.listQuestions(d, { status: 'all', kind: 'decision' })).length, 2);
    assert.equal(json(DB.listQuestions(d, { status: 'all', kind: 'all' })).length, 3);
    assert.deepEqual(json(DB.listQuestions(d, { status: 'all', kind: 'all', person: '@MAX1234' })).map(r => r.text), ['Wie hoch ist das Budget? @max1234', 'Lieferant wählen @max1234'], 'Filter nach Person, Gross-/Kleinschreibung egal');
    assert.deepEqual(json(DB.listQuestions(d, { status: 'all', kind: 'decision' }))[0].people, [{ handle: 'lea5678', optional: false }, { handle: 'tom9012', optional: true }], 'people kommt als Liste');
    assert.deepEqual(json(DB.listPeople(d)), ['lea5678', 'max1234', 'tom9012']);
    const c = DB.countQuestions(d, '2026-10-14T10:00');
    assert.deepEqual(json({ open: c.open, total: c.total, decisions: c.decisions }), { open: 0, total: 1, decisions: { open: 0, total: 2, overdue: 0 } });
    assert.deepEqual(json(DB.getTree(d).map(r => [r.badge, r.dbadge])), [[0, 0]]);
    part('Schema 14: Art, Tag des Entscheids und Personen im Index; listQuestions filtert nach Art und Person; Zähler je Art');

    // Entscheiden schreibt "!!" mit Datum; ein bestehendes Datum bleibt; leer entfernt alles
    DB.updateNote(d, n1, 'Plan', '?! Lieferant wählen @max1234\nEnde');
    const open = json(DB.listQuestions(d, { kind: 'decision' }));
    assert.equal(open.length, 1);
    DB.answerQuestion(d, open[0].id, 'Firma Muster\nweil nah', { decided: '15.10.2026' });
    assert.equal(DB.getNote(d, n1).body, '?! Lieferant wählen @max1234\n!! 15.10.2026: Firma Muster\n!! weil nah\nEnde');
    assert.equal(DB.getQuestion(d, open[0].id).decided, '2026-10-15');
    DB.answerQuestion(d, open[0].id, 'Firma Beispiel', { decided: '16.10.2026' });
    assert.equal(DB.getNote(d, n1).body, '?! Lieferant wählen @max1234\n!! 16.10.2026: Firma Beispiel\nEnde', 'ein mitgegebenes Datum gilt');
    DB.answerQuestion(d, open[0].id, 'Firma Beispiel', {});
    assert.equal(DB.getNote(d, n1).body, '?! Lieferant wählen @max1234\n!! 16.10.2026: Firma Beispiel\nEnde', 'ohne Datum bleibt das Datum aus dem Text');
    DB.answerQuestion(d, open[0].id, '', {});
    assert.equal(DB.getNote(d, n1).body, '?! Lieferant wählen @max1234\nEnde');
    assert.equal(DB.getTree(d)[0].dbadge, 1, 'offener Entscheid zählt in der Marke');
    const q = DB.createNote(d, null);
    DB.updateNote(d, q, 'Frage', '? Offen?');
    DB.answerQuestion(d, json(DB.listQuestions(d, { kind: 'question' }))[0].id, 'Ja');
    assert.equal(DB.getNote(d, q).body, '? Offen?\n! Ja', 'Antworten auf Fragen bleiben "!"-Zeilen ohne Datum');
    part('Entscheiden schreibt "!! Datum: Text" in die Notiz, Fragen bleiben wie bisher');

    // Migration aus Schema 13: eine "?!"-Zeile war bisher eine Frage mit Text "! …" und wird zum Entscheid
    const old = new SQL.Database(DB.exportBytes(d));
    old.run("UPDATE meta SET value = '13' WHERE key = 'schema_version'");
    old.run("UPDATE questions SET kind = 'question', decided = NULL, people = NULL");
    const bytes = old.export();
    old.close();
    const mig = DB.open(SQL, bytes);
    assert.equal(DB.getMeta(mig, 'schema_version'), SCHEMA_VERSION);
    assert.deepEqual(mig.exec("SELECT kind, people FROM questions ORDER BY note_id, line_no")[0].values,
      [['decision', '[{"handle":"max1234","optional":false}]'], ['question', null]]);
    part('Migration aus Schema 13: der Index wird aus den Texten neu gefüllt');
  }
}

// ============================================================
/* Test des Builds mit einer Ausprägung ausserhalb des Projekts (--edition-dir), wie sie ein anderes Projekt mitbringt. */
async function runBuild(browser, part, step) {
  const BUILD = path.join(ROOT, 'tools', 'build.cjs');

  const run = args => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8' });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-build-'));
  try {
    const ed = path.join(tmp, 'meine-ausprägung');
    fs.mkdirSync(path.join(ed, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(ed, 'a.js'), 'window.__a = 1;');
    fs.writeFileSync(path.join(ed, 'sub', 'b.js'), 'window.__b = 2;');
    fs.writeFileSync(path.join(ed, 'hilfe.html'), '<h3>Wo liegen meine Notizen?</h3>\n<p>Auf dem Server.</p>\n');
    fs.writeFileSync(path.join(ed, 'extra.txt'), 'extra');
    fs.mkdirSync(path.join(ed, 'daten'));
    fs.writeFileSync(path.join(ed, 'daten', 'x.json'), '{}');
    fs.mkdirSync(path.join(ed, 'erw')); // Erweiterungen der Ausprägung, die nach plugins/fremd/ kommen
    fs.writeFileSync(path.join(ed, 'erw', 'x.js'), "NoNotesPlugins.register({ id: 'fremd-x', name: 'Fremd X', version: '0.1', api: 1, description: 'Aus der Ausprägung', theme: { light: { bg: '#fff' } } });");
    fs.writeFileSync(path.join(ed, 'erw', 'kaputt.js'), "document.body.appendChild(1); NoNotesPlugins.register({ id: 'kaputt', api: 1 });"); // läuft nur im Browser
    fs.writeFileSync(path.join(ed, 'edition.json'), JSON.stringify({
      id: 'fremd',
      scripts: ['a.js', '@core/packages/core/zip.js', 'sub/b.js'],
      helpStorage: 'hilfe.html',
      files: ['extra.txt'],
      include: ['NOTICE', 'plugins'],
      copy: { daten: 'daten', 'plugins/fremd': 'erw' },
    }));
    const out = path.join(tmp, 'out');

    let r = run(['--edition-dir', ed, '--out', out, '--version', 'v9.9.9']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Ausprägung fremd/);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const order = ['js/a.js', 'js/zip.js', 'js/b.js'].map(s => html.indexOf(`<script src="${s}"></script>`));
    assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], 'Skripte der Ausprägung stehen in dieser Reihenfolge: ' + order);
    assert.ok(html.indexOf('js/backend.js') < order[0] && order[2] < html.indexOf('js/mindmap.js'), 'zwischen Backend-Vertrag und Oberfläche');
    assert.ok(html.includes('<p>Auf dem Server.</p>') && !html.includes('Browser-Speicher (automatisch)'), 'Hilfeabschnitt der Ausprägung statt des lokalen');
    assert.ok(html.includes('Termine in den Kalender'), 'der übrige Teil der Hilfe bleibt');
    assert.ok(!html.includes('EDITION-'), 'keine offenen Platzhalter');
    assert.ok(fs.existsSync(path.join(out, 'js', 'a.js')) && fs.existsSync(path.join(out, 'js', 'b.js')));
    assert.ok(fs.existsSync(path.join(out, 'extra.txt')) && fs.existsSync(path.join(out, 'daten', 'x.json')));
    assert.ok(fs.existsSync(path.join(out, 'NOTICE')) && fs.existsSync(path.join(out, 'plugins', 'plugins.js')));
    assert.ok(!fs.existsSync(path.join(out, 'docs')) && !fs.existsSync(path.join(out, 'README.md')) && !fs.existsSync(path.join(out, 'vendor')), 'nur, was die Ausprägung einschliesst');
    assert.ok(!fs.existsSync(path.join(out, 'js', 'db.js')) && !fs.existsSync(path.join(out, 'js', 'local-shell.js')), 'nichts von der lokalen Ausprägung');
    assert.match(fs.readFileSync(path.join(out, 'js', 'version.js'), 'utf8'), /v9\.9\.9/);
    part('Fremde Ausprägung: Skripte in Reihenfolge, eigener Hilfeabschnitt, nur eingeschlossene Teile, Version gesetzt');

    // Verzeichnis der Erweiterungen: alle .js im Zielordner plugins/, auch die der Ausprägung, mit ihren Angaben; die Liste bleibt
    const listJs = fs.readFileSync(path.join(out, 'plugins', 'plugins.js'), 'utf8');
    const cat = JSON.parse(/NoNotesPlugins\.catalog\((\[[\s\S]*?\])\);/.exec(listJs)[1]);
    assert.deepEqual(cat.map(e => e.file), ['beispiele/datum-einfuegen.js', 'beispiele/sepia.js', 'fremd/kaputt.js', 'fremd/x.js']);
    assert.deepEqual(cat.find(e => e.file === 'fremd/x.js'), { file: 'fremd/x.js', id: 'fremd-x', name: 'Fremd X', version: '0.1', api: 1, description: 'Aus der Ausprägung', theme: true });
    assert.deepEqual(cat.find(e => e.file === 'fremd/kaputt.js'), { file: 'fremd/kaputt.js' }, 'eine Datei, die nur im Browser läuft, steht mit ihrem Namen drin');
    assert.equal(cat.find(e => e.file === 'beispiele/sepia.js').theme, true);
    assert.equal(cat.find(e => e.file === 'beispiele/datum-einfuegen.js').name, 'Datum einfügen');
    assert.ok(listJs.indexOf('NoNotesPlugins.catalog(') < listJs.indexOf('NoNotesPlugins.list('), 'das Verzeichnis steht vor der Liste des Projekts');
    assert.ok(fs.existsSync(path.join(out, 'plugins', 'fremd', 'x.js')));
    assert.match(r.stdout, /4 Erweiterungen im Verzeichnis/);
    part('Verzeichnis der Erweiterungen: aus dem Zielordner plugins/ erzeugt, mit Angaben aus register(), vor der Liste');

    // Fehler sind verständlich
    r = run(['--edition-dir', path.join(tmp, 'gibt-es-nicht'), '--out', out]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /edition\.json fehlt/);
    fs.writeFileSync(path.join(ed, 'edition.json'), JSON.stringify({ id: 'kaputt', scripts: ['fehlt.js'] }));
    r = run(['--edition-dir', ed, '--out', out]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Datei fehlt/);
    part('Fehlende Ausprägung und fehlende Datei brechen den Build mit einer klaren Meldung ab');

    // Die lokale Ausprägung ist unverändert vollständig
    r = run(['--edition', 'local', '--out', path.join(tmp, 'lokal'), '--version', 'v1.0.0']);
    assert.equal(r.status, 0, r.stderr);
    const lokal = path.join(tmp, 'lokal');
    for (const f of ['index.html', 'start.ps1', 'start.cmd', 'README.md', 'NOTICE', 'js/db.js', 'js/local-shell.js', 'js/edition.js', 'js/catalog.js', 'js/protocol.js', 'js/webmcp.js', 'agent/nonotes-mcp.cjs', 'vendor/sql.js/sql-asm.js', 'docs/BACKEND.md', 'docs/AGENTS.md', 'plugins/plugins.js', 'js/templates.js', 'js/templates-local.js', 'templates/Sitzungsprotokoll.md', 'templates/README.md']) {
      assert.ok(fs.existsSync(path.join(lokal, f)), `lokal: ${f}`);
    }
    const lokalCat = JSON.parse(/NoNotesPlugins\.catalog\((\[[\s\S]*?\])\);/.exec(fs.readFileSync(path.join(lokal, 'plugins', 'plugins.js'), 'utf8'))[1]);
    assert.deepEqual(lokalCat.map(e => e.id), ['datum-einfuegen', 'sepia'], 'die Beispiele stehen im Verzeichnis der lokalen Ausprägung');
    part('Lokale Ausprägung: alle Dateien wie bisher, Beispiele im Verzeichnis');

    // --plugins <Ordner>: Erweiterungen eines anderen Repositorys (Aufbau wie CDRO/NoNotes-plugins: ein Unterordner je Erweiterung)
    const erw = path.join(tmp, 'erweiterungen');
    fs.mkdirSync(path.join(erw, 'ordner'), { recursive: true });
    fs.mkdirSync(path.join(erw, '.git'));
    fs.mkdirSync(path.join(erw, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(erw, 'README.md'), '# Erweiterungen\n'); // direkt im Ordner: bleibt draussen (würde mit plugins/README.md kollidieren)
    fs.writeFileSync(path.join(erw, 'LICENSE'), 'MIT');
    fs.writeFileSync(path.join(erw, 'flach.js'), "NoNotesPlugins.register({ id: 'flach', name: 'Flach', api: 1 });");
    fs.writeFileSync(path.join(erw, '.git', 'HEAD'), 'ref: refs/heads/main');
    fs.writeFileSync(path.join(erw, 'node_modules', 'x', 'index.js'), 'module.exports = 1;');
    fs.writeFileSync(path.join(erw, 'ordner', 'plugin.js'), "const REGELN = [1];\nNoNotesPlugins.register({ id: 'im-ordner', name: 'Im Ordner', version: '2.0', api: 1, description: 'Aus einem Unterordner' });");
    fs.writeFileSync(path.join(erw, 'ordner', 'README.md'), '# Im Ordner\n');
    const mit = path.join(tmp, 'mit-erweiterungen');
    r = run(['--edition', 'local', '--out', mit, '--version', 'v1.0.0', '--plugins', erw]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of ['plugins/flach.js', 'plugins/ordner/plugin.js', 'plugins/ordner/README.md', 'plugins/beispiele/sepia.js', 'plugins/plugins.js']) assert.ok(fs.existsSync(path.join(mit, f)), `mit: ${f}`);
    for (const f of ['plugins/LICENSE', 'plugins/.git', 'plugins/node_modules']) assert.ok(!fs.existsSync(path.join(mit, f)), `nicht dabei: ${f}`);
    assert.equal(fs.readFileSync(path.join(mit, 'plugins', 'README.md'), 'utf8'), fs.readFileSync(path.join(ROOT, 'plugins', 'README.md'), 'utf8'), 'die README des Ordners plugins/ bleibt die der App');
    const mitCat = JSON.parse(/NoNotesPlugins\.catalog\((\[[\s\S]*?\])\);/.exec(fs.readFileSync(path.join(mit, 'plugins', 'plugins.js'), 'utf8'))[1]);
    assert.deepEqual(mitCat.map(e => e.file), ['beispiele/datum-einfuegen.js', 'beispiele/sepia.js', 'flach.js', 'ordner/plugin.js']);
    assert.deepEqual(mitCat.find(e => e.file === 'ordner/plugin.js'), { file: 'ordner/plugin.js', id: 'im-ordner', name: 'Im Ordner', version: '2.0', api: 1, description: 'Aus einem Unterordner', theme: false });
    assert.match(r.stdout, /4 Erweiterungen im Verzeichnis/);
    r = run(['--edition', 'local', '--out', mit, '--plugins', path.join(tmp, 'nirgends')]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Ordner mit Erweiterungen fehlt/);
    part('--plugins: Unterordner und .js-Dateien eines weiteren Ordners kommen nach plugins/ und ins Verzeichnis; README, LICENSE, .git und node_modules bleiben draussen');

  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ============================================================
/* Test der Videos (v1.6.0), Teil 1, ohne Browser: Erkennung der Adressen (auch Fälschungen), Adressen zum Einbetten, Karte im Markdown,
   Link statt Bild ohne Einbetten. */
async function runEmbeds(browser, part, step) {
  globalThis.window = globalThis;
  for (const f of ['i18n.js', 'embeds.js', 'markdown.js']) require(path.join(__dirname, '..', 'packages', 'core', f));
  const E = globalThis.NoNotesEmbeds;
  const M = globalThis.NoNotesMarkdown;

  const ID = 'dQw4w9WgXcQ';

  // ---------- Erkennung ----------
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&list=PL1`, `https://m.youtube.com/watch?v=${ID}`, `http://youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/live/${ID}`, `www.youtube.com/watch?v=${ID}`, `youtu.be/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ]) {
    const v = E.parse(url);
    assert.ok(v, url);
    assert.equal(v.provider, 'youtube');
    assert.equal(v.id, ID);
    assert.equal(v.embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
    assert.equal(v.watchUrl, `https://www.youtube.com/watch?v=${ID}`);
  }
  assert.equal(E.parse(`https://youtu.be/${ID}?t=90`).embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0&start=90`);
  assert.equal(E.parse(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`).embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0&start=3723`);
  assert.equal(E.parse(`https://youtu.be/${ID}?t=99999999`).embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0`, 'unsinnige Zeit wird ignoriert');
  assert.deepEqual(['0', 'abc', '-5', '1x', ''].map(E.seconds), [0, 0, 0, 0, 0]);
  assert.equal(E.seconds('1m30s'), 90);
  part('YouTube: alle üblichen Schreibweisen, Startzeit, Adresse ohne Cookies');

  const vim = E.parse('https://vimeo.com/76979871');
  assert.deepEqual([vim.provider, vim.id, vim.embedUrl], ['vimeo', '76979871', 'https://player.vimeo.com/video/76979871?dnt=1']);
  assert.equal(E.parse('https://vimeo.com/76979871/abcdef1234').embedUrl, 'https://player.vimeo.com/video/76979871?dnt=1&h=abcdef1234', 'Vimeo, nicht gelistet');
  assert.equal(E.parse('https://player.vimeo.com/video/76979871?h=abcdef1234').watchUrl, 'https://vimeo.com/76979871/abcdef1234');
  const dm = E.parse('https://www.dailymotion.com/video/x8abc12');
  assert.deepEqual([dm.provider, dm.id, dm.embedUrl], ['dailymotion', 'x8abc12', 'https://www.dailymotion.com/embed/video/x8abc12']);
  assert.equal(E.parse('https://www.dailymotion.com/video/x8abc12_titel-des-videos').id, 'x8abc12', 'ältere Adressen mit Titel');
  assert.equal(E.parse('https://dai.ly/x8abc12').provider, 'dailymotion');
  part('Vimeo (auch nicht gelistet) und Dailymotion (auch kurze und ältere Adressen)');

  // Fälschungen und Unsinn: nichts davon wird eingebettet
  for (const bad of [
    `https://youtube.com.boese.example/watch?v=${ID}`, `https://boese-youtube.com/watch?v=${ID}`, `https://youtube.com@boese.example/watch?v=${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`, `https://www.youtube.com:8443/watch?v=${ID}`, `javascript:alert(1)`, `data:text/html,<p>`, `ftp://youtu.be/${ID}`,
    'https://youtu.be/kurz', 'https://youtu.be/' + 'x'.repeat(40), `https://www.youtube.com/watch?v=${ID}"onload="x`, `https://www.youtube.com/watch?v=${ID} x`,
    'https://www.youtube.com/', 'https://www.youtube.com/watch', 'https://vimeo.com/abc', 'https://vimeo.com/12/', 'https://www.dailymotion.com/', 'https://example.com/video/x8abc12',
    '', null, undefined, 'x'.repeat(400),
  ]) assert.equal(E.parse(bad), null, String(bad).slice(0, 60));
  part('Fälschungen und Unsinn werden nicht eingebettet (ähnliche Hosts, Zugangsdaten, andere Schemata, falsche Kennung, Sonderzeichen)');

  assert.deepEqual(E.frameHosts(), ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.dailymotion.com', 'https://geo.dailymotion.com']);
  part('Hosts für den Schutzkopf');

  // ---------- Markdown ----------
  const src = `Vorher\nhttps://youtu.be/${ID}\n\n![Mein Clip](https://vimeo.com/76979871)\n![](https://www.dailymotion.com/video/x8abc12 "Titel")\nText mit ![x](https://youtu.be/${ID}) mittendrin\n[Link](https://youtu.be/${ID})`;
  const withCards = M.render(src, { embeds: true, lineMap: true });
  const cards = [...withCards.matchAll(/<div class="md-embed"[^>]*>/g)].map(m => m[0]);
  assert.equal(cards.length, 3, 'drei Karten: eine Adresse allein, zwei Bilder allein auf der Zeile');
  assert.match(cards[0], /data-provider="youtube"/);
  assert.match(cards[1], /data-provider="vimeo"/);
  assert.match(cards[1], /data-title="Mein Clip"/);
  assert.match(cards[2], /data-provider="dailymotion"/);
  assert.match(cards[0], /data-line="1"/, 'Zeilennummer für das gemeinsame Scrollen');
  assert.ok(!/<iframe/i.test(withCards), 'die Karte enthält keinen Rahmen');
  assert.ok(!/<img/i.test(withCards), 'kein Bild-Element, das die Seite des Anbieters abruft');
  assert.ok(!/src=/i.test(withCards), 'keine Quelle, die der Browser von selbst lädt');
  assert.match(withCards, /<button type="button" class="md-embed-load">Video laden<\/button>/);
  assert.match(withCards, /<a class="md-embed-open" href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  assert.match(withCards, /<p data-line="5">Text mit <a href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"[^>]*class="md-video-link">▶ x<\/a> mittendrin<br><a /, 'mitten im Satz: Link statt Karte; [Text](Adresse) bleibt ein Link');
  part('Markdown: Karte nur für eine Adresse oder ein Bild allein auf der Zeile; kein Rahmen, kein Bild, keine Quelle');

  const plain = M.render(src, {});
  assert.ok(!/md-embed/.test(plain), 'ohne die Option (Druck, Listen) keine Karte');
  assert.ok(!/<img/i.test(plain), 'auch kein Bild: eine Videoadresse ist kein Bild');
  assert.match(plain, /<a href="https:\/\/vimeo\.com\/76979871"[^>]*class="md-video-link">▶ Mein Clip<\/a>/);
  assert.match(plain, /<a href="https:\/\/youtu\.be\/dQw4w9WgXcQ"[^>]*>https:\/\/youtu\.be\/dQw4w9WgXcQ<\/a>/, 'eine nackte Adresse bleibt ein normaler Link');
  // echte Bilder bleiben Bilder
  assert.match(M.render('![x](https://beispiel.ch/bild.png)', { embeds: true }), /<img src="https:\/\/beispiel\.ch\/bild\.png"/);
  assert.ok(!/md-embed/.test(M.render('![x](https://beispiel.ch/bild.png)\nhttps://beispiel.ch/seite', { embeds: true })));
  part('Ohne Einbetten: Link statt Bild; gewöhnliche Bilder und Links bleiben unverändert');

  // YouTube kann nicht überall geladen werden: nur der Link
  const noLoad = M.render(`https://youtu.be/${ID}`, { embeds: true, embedLoad: p => p !== 'youtube' });
  assert.ok(!/md-embed-load/.test(noLoad));
  assert.match(noLoad, /lässt YouTube das Einbetten nicht zu|does not allow embedding/);
  assert.match(noLoad, /md-embed-open/);
  part('Ohne Ladeknopf (zum Beispiel YouTube in einer geöffneten Datei): nur der Link zum Anbieter, mit Erklärung');

  // Einschleusen über den Titel
  const evil = M.render('![<img src=x onerror=alert(1)>](https://vimeo.com/76979871)', { embeds: true });
  assert.ok(!/<img/i.test(evil) && !/onerror=alert/.test(evil.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')), 'der Titel wird maskiert');
  part('Titel mit HTML wird maskiert');

}

// ============================================================
/* Test des Werkzeugkatalogs für Agenten und des MCP-Protokolls (packages/agent/, v2.1.0) ohne Browser: jedes Werkzeug gegen eine
   Datenbank, Prüfung der Eingaben, Fehlerfälle, Lesemodus, Ressourcen; danach JSON-RPC-Nachrichten aller Protokollfassungen. */
async function runAgent(browser, part, step) {
  let now = Date.parse('2026-10-17T08:00:00Z');
  const RealDate = Date;
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } };
  const context = vm.createContext(sandbox);
  for (const f of ['packages/core/i18n.js', 'packages/core/history.js', 'packages/core/dates.js', 'packages/core/questions.js', 'packages/core/tasks.js', 'packages/core/links.js', 'packages/core/backend.js', 'packages/core/merge.js', 'packages/data/db.js', 'packages/store-local/backend-local.js', 'packages/agent/catalog.js', 'packages/agent/protocol.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  const SQL = await initSqlJs();
  const db = sandbox.NoNotesDB.open(SQL, null);
  const changes = [];
  const backend = sandbox.NoNotesBackendLocal.create({ getDb: () => db, onChange: name => changes.push(name) });
  const Agent = sandbox.NoNotesAgent;
  const cat = Agent.create(backend, { author: 'Agent-Test', now: () => new RealDate(now).toISOString() });
  const call = async (name, input) => { now += 1000; return cat.call(name, input); };
  const json = v => (v === undefined ? v : JSON.parse(JSON.stringify(v))); // Werte aus dem vm-Kontext haben fremde Prototypen
  const S = r => json(r.structuredContent);
  const T = r => r.content[0].text;
  const ok = (r, what) => { assert.ok(!r.isError, `${what || 'kein Fehler erwartet'}: ${r.content && r.content[0] && r.content[0].text}`); return r; };
  const bad = (r, code, what) => { assert.ok(r.isError, what || `Fehler ${code} erwartet`); assert.equal(S(r).error.code, code, T(r)); return r; };

  // ---------- Beschreibung und leere Datenbank ----------
  const tools = cat.list();
  assert.ok(tools.length >= 20, 'mindestens 20 Werkzeuge');
  for (const name of ['get_overview', 'list_notes', 'search_notes', 'get_note', 'create_note', 'update_note', 'append_to_note', 'list_questions', 'answer_question', 'list_decisions', 'record_decision', 'list_tasks', 'complete_task', 'reopen_task', 'list_people', 'get_history']) assert.ok(tools.some(t => t.name === name), name);
  for (const t of tools) {
    assert.match(t.name, /^[a-z][a-z_]+$/, t.name);
    assert.ok(t.description.length >= 40, `${t.name}: Beschreibung`);
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean', t.name);
    assert.ok(t.title, t.name);
  }
  assert.equal(new Set(tools.map(t => t.name)).size, tools.length, 'Namen eindeutig');
  assert.match(Agent.INSTRUCTIONS, /"\?!"/);
  let r = ok(await call('get_overview', {}));
  assert.equal(S(r).notes, 0);
  assert.match(T(r), /^Map: /);
  r = ok(await call('list_notes', {}));
  assert.equal(T(r), 'No notes.');
  r = bad(await call('create_note', {}), 'INVALID_INPUT');
  assert.match(T(r), /title: required/);
  bad(await call('get_note', { id: 'abc' }), 'INVALID_INPUT');
  bad(await call('get_note', { id: 7, extra: 1 }), 'INVALID_INPUT');
  bad(await call('get_note', { id: 999 }), 'NOTE_NOT_FOUND');
  bad(await call('nope', {}), 'UNKNOWN_TOOL');
  bad(await call('list_tasks', { status: 'maybe' }), 'INVALID_INPUT');
  bad(await call('record_decision', { id: 1, decision: 'x', decided: '17.10.2026' }), 'INVALID_INPUT');
  part('Katalog: Beschreibungen vollständig, Namen eindeutig, leere Datenbank, Eingaben werden geprüft');

  // ---------- Notizen: anlegen, lesen, Baum, Suche ----------
  r = ok(await call('create_note', { title: 'Projekt', body: '? Welche Bank?\n- [ ] Angebot einholen >2026-10-20\n  - [ ] Bank anrufen\n?! Variante A oder B? @anna (@ben)', tags: ['Arbeit', '#arbeit', 'Bank'] }));
  const pid = S(r).id;
  assert.ok(Number.isInteger(pid));
  assert.deepEqual(S(r).tags, ['Arbeit', 'Bank']);
  assert.match(T(r), /^Created note \[\d+\] "Projekt" at the root\.$/);
  r = ok(await call('create_note', { title: ' Kind ', body: 'Text', parent_id: String(pid) }), 'Kennung als Text');
  const cid = S(r).id;
  bad(await call('create_note', { title: 'x', parent_id: 999 }), 'TARGET_NOT_FOUND');
  r = ok(await call('get_note', { id: cid }));
  assert.equal(S(r).title, 'Kind');
  assert.deepEqual(S(r).path, [{ id: pid, title: 'Projekt' }]);
  assert.equal(S(r).parent_id, pid);
  r = ok(await call('get_note', { id: pid }));
  assert.deepEqual(S(r).tags, ['Arbeit', 'Bank']);
  assert.equal(S(r).questions.length, 2);
  assert.equal(S(r).tasks.length, 2);
  assert.match(T(r), /^# Projekt\n\(id \d+ · at the root · tags: Arbeit, Bank · updated 2026-10-17T/);
  assert.match(T(r), /\[q \d+\] \(note \d+ "Projekt"\) Welche Bank\? — open/);
  assert.match(T(r), /\[d \d+\] \(note \d+ "Projekt"\) Variante A oder B\? @anna \(@ben\) — open/);
  assert.match(T(r), /\[t \d+\] \(note \d+ "Projekt"\) Angebot einholen — due 2026-10-20 — 1 of 1 subtasks open — open/);
  assert.match(T(r), /\[t \d+\] \(note \d+ "Projekt"\)   Bank anrufen — open/);
  r = ok(await call('list_notes', {}));
  assert.equal(T(r), `- [${pid}] Projekt  (1 open question, 1 open decision, 2 open tasks)\n  - [${cid}] Kind`);
  assert.equal(S(r).notes[1].depth, 1);
  r = ok(await call('list_notes', { parent_id: pid }));
  assert.equal(T(r), `- [${cid}] Kind`);
  r = ok(await call('list_notes', { depth: 1 }));
  assert.ok(!T(r).includes('Kind'), 'Tiefe 1');
  bad(await call('list_notes', { parent_id: 999 }), 'NOTE_NOT_FOUND');
  r = ok(await call('search_notes', { query: 'bank' }));
  assert.equal(S(r).total, 1);
  assert.equal(S(r).items[0].id, pid);
  assert.match(S(r).items[0].snippet, /Welche Bank\?/);
  assert.match(T(r), /^1 note found\n\[\d+\] Projekt — /);
  r = ok(await call('search_notes', { tag: 'arbeit' }));
  assert.equal(S(r).total, 1);
  r = ok(await call('search_notes', {}));
  assert.equal(S(r).total, 2, 'ohne Suchbegriff: alle lebenden Notizen');
  assert.equal(S(r).items[0].id, cid, 'zuletzt geändert zuerst');
  assert.deepEqual(S(r).items[0].path, ['Projekt']);
  r = ok(await call('search_notes', { query: 'x', limit: 1, offset: 5 }));
  assert.equal(S(r).items.length, 0);
  part('Notizen: anlegen mit Tags und Eltern, lesen mit Pfad, Fragen und Aufgaben, Baum mit Marken, Teilbaum, Tiefe, Suche mit Ausschnitt, Tag, Seiten');

  // ---------- Fragen und Entscheide ----------
  r = ok(await call('list_questions', {}));
  assert.equal(S(r).total, 1);
  const qid = S(r).items[0].id;
  assert.equal(S(r).items[0].kind, 'question');
  assert.match(T(r), /^1 question\n\[q \d+\]/);
  r = ok(await call('list_decisions', {}));
  assert.equal(S(r).total, 1);
  const did = S(r).items[0].id;
  assert.deepEqual(S(r).items[0].people, [{ handle: 'anna', optional: false }, { handle: 'ben', optional: true }]);
  assert.equal(S(ok(await call('list_decisions', { person: '@ben' }))).total, 1);
  assert.equal(S(ok(await call('list_questions', { person: 'ben' }))).total, 0);
  assert.equal(S(ok(await call('list_questions', { note_id: cid }))).total, 0);
  bad(await call('answer_question', { id: did, answer: 'x' }), 'INVALID_INPUT');
  bad(await call('record_decision', { id: qid, decision: 'x' }), 'INVALID_INPUT');
  bad(await call('answer_question', { id: 999, answer: 'x' }), 'QUESTION_NOT_FOUND');
  r = ok(await call('answer_question', { id: qid, answer: 'Raiffeisen\nwegen der Nähe' }));
  assert.equal(S(r).note_id, pid);
  let body = S(ok(await call('get_note', { id: pid }))).body;
  assert.match(body, /^\? Welche Bank\?\n! Raiffeisen\n! wegen der Nähe\n- \[ \] Angebot/);
  assert.equal(S(ok(await call('list_questions', {}))).total, 0);
  r = ok(await call('list_questions', { status: 'answered' }));
  assert.equal(S(r).items[0].answer, 'Raiffeisen\nwegen der Nähe');
  assert.match(T(r), /answered: Raiffeisen \/ wegen der Nähe/);
  r = ok(await call('record_decision', { id: did, decision: 'Variante B', decided: '2026-10-17' }));
  body = S(ok(await call('get_note', { id: pid }))).body;
  assert.match(body, /\?! Variante A oder B\? @anna \(@ben\)\n!! 2026-10-17: Variante B$/);
  r = ok(await call('list_decisions', { status: 'decided' }));
  assert.equal(S(r).items[0].decided, '2026-10-17');
  assert.match(T(r), /decided 2026-10-17: Variante B/);
  assert.equal(S(ok(await call('list_decisions', {}))).total, 0);
  r = ok(await call('list_people', {}));
  assert.deepEqual(S(r).people, ['anna', 'ben']);
  assert.equal(T(r), '@anna, @ben');
  part('Fragen und Entscheide: auflisten mit Personen, Filter, beantworten als !-Zeilen, Entscheid mit Datum als !!-Zeile, Arten nicht verwechselbar');

  // ---------- Aufgaben ----------
  r = ok(await call('list_tasks', {}));
  assert.equal(S(r).total, 2);
  const [main, sub] = S(r).items;
  assert.equal(main.subtasks_open, 1);
  assert.equal(sub.depth, 1);
  assert.equal(sub.parent_text, 'Angebot einholen');
  r = bad(await call('complete_task', { id: main.id }), 'SUBTASKS_OPEN');
  assert.match(T(r), /1 subtask is still open/);
  assert.equal(S(r).error.open, 1);
  ok(await call('complete_task', { id: sub.id }));
  r = ok(await call('complete_task', { id: main.id }));
  assert.equal(S(r).done, true);
  assert.equal(S(ok(await call('list_tasks', {}))).total, 0);
  r = ok(await call('list_tasks', { status: 'done' }));
  assert.equal(S(r).total, 2);
  assert.match(T(r), /^2 tasks\n/);
  ok(await call('reopen_task', { id: sub.id }));
  assert.equal(S(ok(await call('list_tasks', { note_id: pid }))).total, 2, 'Unteraufgabe und Hauptaufgabe wieder offen');
  bad(await call('complete_task', { id: 999 }), 'TASK_NOT_FOUND');
  part('Aufgaben: auflisten mit Unteraufgaben, abschliessen erst nach den Unteraufgaben (verständlicher Fehler), erledigt, wieder öffnen');

  // ---------- Schreiben: anhängen, ersetzen, Konflikt, Tags, Verlauf, verschieben, Archiv, Papierkorb ----------
  ok(await call('append_to_note', { id: cid, text: 'Mehr' }));
  let n = S(ok(await call('get_note', { id: cid })));
  assert.equal(n.body, 'Text\nMehr');
  const base = n.updated_at;
  now += 6 * 60 * 1000; // neue Arbeitsphase im Verlauf
  r = ok(await call('update_note', { id: cid, body: 'Neu', base_updated_at: base }));
  assert.notEqual(S(r).updated_at, base);
  r = bad(await call('update_note', { id: cid, body: 'Alt', base_updated_at: base }), 'NOTE_CONFLICT');
  n = S(ok(await call('get_note', { id: cid })));
  assert.equal(S(r).error.updated_at, n.updated_at);
  assert.equal(n.body, 'Neu', 'bei Konflikt nichts geschrieben');
  bad(await call('update_note', { id: cid }), 'INVALID_INPUT');
  ok(await call('update_note', { id: cid, title: 'Kind 2' }));
  assert.equal(S(ok(await call('get_note', { id: cid }))).title, 'Kind 2');
  r = ok(await call('set_tags', { id: cid, tags: ['b', 'a', 'b'] }));
  assert.deepEqual(S(r).tags, ['b', 'a']);
  r = ok(await call('get_history', { id: cid }));
  assert.ok(S(r).versions.length >= 1);
  assert.equal(S(r).versions[0].author, 'Agent-Test');
  r = ok(await call('get_history', { id: cid, version_id: S(r).versions[0].version_id }));
  assert.equal(S(r).version.body, 'Text\nMehr');
  bad(await call('get_history', { id: cid, version_id: 999999 }), 'HISTORY_NOT_FOUND');
  ok(await call('move_note', { id: cid, parent_id: null }));
  assert.equal(S(ok(await call('get_note', { id: cid }))).parent_id, null);
  bad(await call('move_note', { id: pid, parent_id: pid }), 'MOVE_INTO_SELF');
  bad(await call('move_note', { id: pid, parent_id: 999 }), 'TARGET_NOT_FOUND');
  ok(await call('move_note', { id: cid, parent_id: pid }));
  r = ok(await call('archive_note', { id: pid }));
  assert.deepEqual([...S(r).ids].sort(), [pid, cid].sort());
  assert.equal(T(r), 'Archived 2 notes.');
  bad(await call('update_note', { id: cid, body: 'x' }), 'ARCHIVED_READONLY');
  bad(await call('append_to_note', { id: pid, text: 'x' }), 'ARCHIVED_READONLY');
  bad(await call('set_tags', { id: pid, tags: [] }), 'ARCHIVED_READONLY');
  bad(await call('create_note', { title: 'u', parent_id: pid }), 'ARCHIVED_NO_CHILD');
  assert.equal(T(ok(await call('list_notes', {}))), 'No notes.');
  assert.match(T(ok(await call('list_notes', { include_archived: true }))), /Projekt  \(archived\)\n  - \[\d+\] Kind 2  \(archived\)/);
  assert.equal(S(ok(await call('list_questions', { status: 'all' }))).total, 0, 'archiviert zählt nicht');
  assert.equal(S(ok(await call('list_questions', { status: 'all', include_archived: true }))).total, 1);
  r = ok(await call('unarchive_note', { id: cid }));
  assert.equal(S(r).ids.length, 2, 'Kind samt Eltern');
  r = ok(await call('delete_note', { id: cid }));
  assert.match(T(r), /to the trash/);
  assert.equal(S(ok(await call('get_note', { id: cid }))).in_trash, true);
  bad(await call('append_to_note', { id: cid, text: 'x' }), 'IN_TRASH');
  r = ok(await call('search_notes', { scope: 'trash' }));
  assert.equal(S(r).items[0].id, cid);
  assert.ok(S(r).items[0].in_trash);
  bad(await call('restore_note', { id: pid }), 'INVALID_INPUT');
  ok(await call('restore_note', { id: cid }));
  assert.equal(S(ok(await call('get_note', { id: cid }))).in_trash, false);
  part('Schreiben: anhängen, ersetzen mit Basisstand und Konflikt, Titel, Tags, Verlauf, verschieben, Archiv schreibgeschützt, Papierkorb und zurück');

  // ---------- Lesemodus, Ressourcen, Übersicht, Änderungsmeldung ----------
  const ro = Agent.create(backend, { readOnly: true });
  assert.ok(ro.list().length >= 8 && ro.list().every(t => t.annotations.readOnlyHint), 'nur lesende Werkzeuge');
  bad(await ro.call('create_note', { title: 'x' }), 'UNKNOWN_TOOL');
  ok(await ro.call('get_overview', {}));
  assert.deepEqual(json(cat.resources().map(x => x.uri)), ['nonotes://overview']);
  assert.equal(cat.resourceTemplates()[0].uriTemplate, 'nonotes://note/{id}');
  let res = await cat.readResource(`nonotes://note/${pid}`);
  assert.equal(res.mimeType, 'text/markdown');
  assert.match(res.text, /^# Projekt\n\n\? Welche Bank\?/);
  res = await cat.readResource('nonotes://overview');
  assert.match(res.text, /^Map: /);
  await assert.rejects(cat.readResource('nonotes://nope'), e => e.code === 'RESOURCE_NOT_FOUND');
  assert.ok(changes.includes('updateNote') && changes.includes('setTags') && changes.includes('answerQuestion') && changes.includes('setTaskDone'), 'Änderungen gemeldet (die Hülle speichert)');
  r = ok(await call('get_overview', {}));
  assert.equal(S(r).notes, 2);
  assert.equal(S(r).questions.total, 1);
  assert.equal(S(r).decisions.total, 1);
  assert.equal(S(r).tasks.open, 2);
  assert.deepEqual(S(r).tags.map(t => t.name), ['a', 'Arbeit', 'b', 'Bank']);
  assert.match(T(r), /Tasks: 2 open of 2/);
  part('Lesemodus kennt nur lesende Werkzeuge; Ressourcen; Übersicht; jede Änderung wird dem Backend gemeldet');

  // ---------- Protokoll ----------
  const Mcp = sandbox.NoNotesMcp;
  const srv = Mcp.createServer({ catalog: cat, name: 'nonotes', version: 'test', log: () => {} });
  const H = async (server, m) => json(await server.handle(m));
  const rpc = (id, method, params) => H(srv, { jsonrpc: '2.0', id, method, params });
  let resp = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(resp.jsonrpc, '2.0');
  assert.equal(resp.id, 1);
  assert.equal(resp.result.protocolVersion, '2025-06-18');
  assert.ok(resp.result.capabilities.tools && resp.result.capabilities.resources);
  assert.equal(resp.result.serverInfo.name, 'nonotes');
  assert.match(resp.result.instructions, /NoNotes/);
  for (const [want, got] of [['2025-11-25', '2025-11-25'], ['2026-07-28', '2026-07-28'], ['2024-11-05', '2024-11-05'], ['2099-01-01', '2025-06-18'], [undefined, '2025-06-18']]) {
    resp = await rpc(2, 'initialize', { protocolVersion: want });
    assert.equal(resp.result.protocolVersion, got, String(want));
  }
  assert.equal(await H(srv, { jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'Benachrichtigungen ohne Antwort');
  resp = await rpc(3, 'ping');
  assert.deepEqual(resp.result, {});
  resp = await rpc(4, 'tools/list');
  assert.equal(resp.result.tools.length, cat.list().length);
  assert.ok(resp.result.tools.every(t => t.name && t.inputSchema && t.description));
  resp = await rpc(5, 'tools/call', { name: 'create_note', arguments: { title: 'Per MCP' } });
  assert.ok(!resp.error && !resp.result.isError, JSON.stringify(resp));
  assert.equal(resp.result.content[0].type, 'text');
  const mid = resp.result.structuredContent.id;
  resp = await rpc(6, 'tools/call', { name: 'get_note', arguments: { id: 'x' } });
  assert.equal(resp.result.isError, true, 'Werkzeugfehler sind Ergebnisse, keine Protokollfehler');
  resp = await rpc(7, 'tools/call', { name: 'nope' });
  assert.equal(resp.error.code, -32602);
  resp = await rpc(8, 'tools/call', { name: 'get_overview', arguments: [1] });
  assert.equal(resp.error.code, -32602);
  resp = await rpc(9, 'resources/list');
  assert.equal(resp.result.resources[0].uri, 'nonotes://overview');
  resp = await rpc(10, 'resources/templates/list');
  assert.equal(resp.result.resourceTemplates[0].uriTemplate, 'nonotes://note/{id}');
  resp = await rpc(11, 'resources/read', { uri: `nonotes://note/${mid}` });
  assert.equal(resp.result.contents[0].mimeType, 'text/markdown');
  assert.match(resp.result.contents[0].text, /^# Per MCP/);
  resp = await rpc(12, 'resources/read', { uri: 'nonotes://note/999999' });
  assert.equal(resp.error.code, -32002);
  resp = await rpc(13, 'resources/read', { uri: 'x://y' });
  assert.equal(resp.error.code, -32002);
  assert.deepEqual(resp.error.data, { uri: 'x://y' });
  resp = await rpc(14, 'prompts/list');
  assert.deepEqual(resp.result.prompts, []);
  resp = await rpc(15, 'completion/complete', {});
  assert.equal(resp.error.code, -32601);
  resp = await H(srv, { id: 16, method: 'ping' });
  assert.equal(resp.error.code, -32600, 'ohne jsonrpc');
  resp = await H(srv, { jsonrpc: '2.0', id: 17 });
  assert.equal(resp.error.code, -32600, 'ohne Methode');
  resp = json(await srv.handleText('{nope'));
  assert.equal(resp.error.code, -32700);
  assert.equal(resp.id, null);
  resp = json(await srv.handleText(JSON.stringify([{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 'b', method: 'ping' }])));
  assert.deepEqual(resp.map(x => x.id), ['a', 'b'], 'Liste: nur Anfragen werden beantwortet');
  assert.equal(await H(srv, [{ jsonrpc: '2.0', method: 'notifications/cancelled' }]), null);
  resp = await H(srv, []);
  assert.equal(resp.error.code, -32600);
  // zustandslos: frischer Server ohne Begrüssung, Anfrage mit _meta wie im Entwurf 2026-07-28
  const fresh = Mcp.createServer({ catalog: cat });
  resp = await H(fresh, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_people', arguments: {}, _meta: { protocolVersion: '2026-07-28' } } });
  assert.deepEqual(resp.result.structuredContent.people, ['anna', 'ben']);
  const roSrv = Mcp.createServer({ catalog: ro });
  resp = await H(roSrv, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_note', arguments: { id: mid } } });
  assert.equal(resp.error.code, -32602, 'Lesemodus: schreibende Werkzeuge gibt es nicht');
  assert.equal((await H(roSrv, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.length, ro.list().length);
  part('Protokoll: Begrüssung je Fassung, Benachrichtigungen ohne Antwort, Ping, Werkzeuge, Ressourcen, Fehlercodes, kaputtes JSON, Listen, zustandslos');
}

// ============================================================
/* Test des Programms für den eigenen Rechner (editions/local/agent/nonotes-mcp.cjs, v2.2.0): Hilfe und Einträge für die Agenten,
   Datei anlegen, MCP über die Standardeingabe, atomar schreiben, Änderungen von aussen lesen, zwei Prozesse mit Sperre, Lesemodus,
   kaputtes JSON, sauberes Ende. Geprüft wird das gebaute Programm in dist/NoNotes/agent/. */
async function runAgentProgram(browser, part, step) {
  const { spawn } = require('node:child_process');
  const PROGRAM = path.join(DIST, 'agent', 'nonotes-mcp.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-mcp-'));
  const file = path.join(tmp, 'NoNotes.sqlite');
  const run = args => spawnSync(process.execPath, [PROGRAM, ...args], { encoding: 'utf8' });
  let r = run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--file/);
  r = run(['--config', file]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /claude mcp add --scope user nonotes -- node /);
  assert.ok(r.stdout.includes(file) && r.stdout.includes(PROGRAM), 'Pfade stehen in den Einträgen');
  assert.ok(r.stdout.includes('"mcpServers"') && r.stdout.includes('"servers"'), 'Claude Code, Claude Desktop, Copilot CLI und VS Code');
  r = run(['--version']);
  assert.equal(r.stdout.trim(), 'dev');
  r = run(['--file', file]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /nicht gefunden/);
  fs.writeFileSync(path.join(tmp, 'fremd.sqlite'), 'kein sqlite');
  r = run(['--file', path.join(tmp, 'fremd.sqlite')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /nicht von NoNotes|nicht öffnen/);
  r = run(['--file', file, '--unbekannt']);
  assert.equal(r.status, 2);
  r = run([]);
  assert.equal(r.status, 2);
  part('Programm: Hilfe, Einträge für die Agenten mit Pfaden, Version, klare Fehler bei fehlender oder fremder Datei');

  // Ein kleiner MCP-Client über die Standardeingabe
  function start(args) {
    const p = spawn(process.execPath, [PROGRAM, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map();
    const stderr = [];
    let buf = '';
    let seq = 0;
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        const w = pending.get(m.id);
        if (w) { pending.delete(m.id); w(m); }
      }
    });
    p.stderr.on('data', d => stderr.push(String(d)));
    return {
      p, stderr,
      request: (method, params) => new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, resolve);
        p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`keine Antwort auf ${method}: ${stderr.join('')}`)); } }, 20000);
      }),
      notify: (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'),
      raw: text => p.stdin.write(text),
      stop: () => new Promise(resolve => { p.on('exit', resolve); p.stdin.end(); }),
    };
  }
  const init = c => c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const SQL = await initSqlJs();
  const titles = () => { const d = new SQL.Database(fs.readFileSync(file)); const rows = d.exec("SELECT title FROM notes WHERE deleted_at IS NULL ORDER BY id"); d.close(); return rows.length ? rows[0].values.map(v => v[0]) : []; };

  const a = start(['--file', file, '--create', '--verbose']);
  let resp = await init(a);
  assert.equal(resp.result.serverInfo.name, 'nonotes');
  assert.match(resp.result.instructions, /works on the file/);
  a.notify('notifications/initialized');
  assert.ok(fs.existsSync(file), '--create legt die Datei an');
  resp = await a.request('tools/list');
  assert.ok(resp.result.tools.some(t => t.name === 'create_note'));
  resp = await a.request('tools/call', { name: 'create_note', arguments: { title: 'Aus Claude', body: '? Offen?' } });
  assert.ok(!resp.error && !resp.result.isError, JSON.stringify(resp));
  assert.deepEqual(titles(), ['Aus Claude'], 'die Datei auf der Platte hat die Notiz');
  assert.ok(!fs.readdirSync(tmp).some(f => f.endsWith('.tmp') || f.endsWith('.lock')), 'keine Reste neben der Datei');
  // Änderung von aussen (wie die App sie schreibt): beim nächsten Aufruf gelesen
  {
    const d = new SQL.Database(fs.readFileSync(file));
    d.run("INSERT INTO notes (title, body, created_at, updated_at, parent_id, sort_order) VALUES ('Von der App', '', '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z', NULL, 5)");
    const bytes = d.export();
    d.close();
    fs.writeFileSync(file + '.x', bytes);
    fs.renameSync(file + '.x', file);
  }
  resp = await a.request('tools/call', { name: 'search_notes', arguments: {} });
  assert.equal(resp.result.structuredContent.total, 2, 'Änderung von aussen gelesen');
  assert.ok(a.stderr.join('').includes('von aussen geändert'), 'mit --verbose gemeldet');
  resp = await a.request('resources/read', { uri: 'nonotes://overview' });
  assert.match(resp.result.contents[0].text, /Notes: 2/);
  part('Programm: Datei angelegt, Notiz über MCP geschrieben und auf der Platte, Änderung von aussen beim nächsten Aufruf gelesen');

  // Zwei Programme auf derselben Datei: abwechselnd und gleichzeitig, nichts geht verloren
  const b = start(['--file', file]);
  await init(b);
  for (let i = 0; i < 3; i++) {
    await a.request('tools/call', { name: 'create_note', arguments: { title: 'A' + i } });
    await b.request('tools/call', { name: 'create_note', arguments: { title: 'B' + i } });
  }
  assert.equal(titles().length, 8, 'abwechselnd');
  const burst = [];
  for (let i = 0; i < 5; i++) {
    burst.push(a.request('tools/call', { name: 'create_note', arguments: { title: 'PA' + i } }));
    burst.push(b.request('tools/call', { name: 'create_note', arguments: { title: 'PB' + i } }));
  }
  const results = await Promise.all(burst);
  assert.ok(results.every(x => !x.error && !x.result.isError), JSON.stringify(results.filter(x => x.error || x.result.isError)));
  assert.equal(titles().length, 18, 'gleichzeitig mit Sperre: nichts verloren');
  assert.ok(!fs.existsSync(file + '.lock'), 'Sperre wieder weg');
  assert.equal(await b.stop(), 0);
  // Lesemodus: nur lesende Werkzeuge, nichts wird geschrieben
  const before = fs.statSync(file).mtimeMs;
  const ro = start(['--file', file, '--read-only']);
  await init(ro);
  resp = await ro.request('tools/list');
  assert.ok(resp.result.tools.every(t => t.annotations.readOnlyHint));
  resp = await ro.request('tools/call', { name: 'delete_note', arguments: { id: 1 } });
  assert.equal(resp.error.code, -32602);
  resp = await ro.request('tools/call', { name: 'list_tasks', arguments: {} });
  assert.ok(!resp.error);
  assert.equal(fs.statSync(file).mtimeMs, before, 'nichts geschrieben');
  assert.equal(await ro.stop(), 0);
  // Kaputte Zeile: Fehlerantwort, der Server läuft weiter; Ende der Eingabe beendet den Prozess sauber
  a.raw('{kaputt\n');
  resp = await a.request('ping');
  assert.deepEqual(resp.result, {});
  assert.equal(await a.stop(), 0);
  assert.ok(!fs.existsSync(file + '.lock'));
  part('Programm: zwei Prozesse abwechselnd und gleichzeitig ohne Verlust, Lesemodus schreibt nie, kaputtes JSON schadet nicht, sauberes Ende');

  // ---------- Bereiche: mehrere Dateien (v2.3.0) ----------
  const areaDir = path.join(tmp, 'bereiche');
  fs.mkdirSync(areaDir);
  const arbeit = path.join(areaDir, 'Arbeit.sqlite');
  const privat = path.join(areaDir, 'Privat Ä.sqlite');
  const extra = path.join(tmp, 'Arbeit.sqlite'); // gleicher Name in einem anderen Ordner
  r = run(['--config', arbeit, privat]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`--file ${arbeit} --file "${privat}"`), 'beide Dateien im Eintrag für Claude Code: ' + r.stdout.split('\n')[3]);
  r = run(['--config', '--dir', areaDir]);
  assert.ok(r.stdout.includes(`--dir ${areaDir}`));
  // --dir liest nur vorhandene Dateien, --create legt fehlende --file an: zuerst die beiden im Ordner anlegen
  for (const f of [arbeit, privat]) { const c = start(['--file', f, '--create']); await init(c); await c.stop(); }
  const mm = start(['--dir', areaDir, '--file', extra, '--create', '--verbose']);
  resp = await init(mm);
  assert.match(resp.result.instructions, /call list_workspaces first/);
  assert.match(resp.result.instructions, /3 files/);
  resp = await mm.request('tools/list');
  const mtools = resp.result.tools;
  assert.equal(mtools[0].name, 'list_workspaces');
  assert.ok(mtools.slice(1).every(t => t.inputSchema.required[0] === 'workspace' && t.inputSchema.properties.workspace), 'jedes Werkzeug nimmt workspace');
  resp = await mm.request('tools/call', { name: 'list_workspaces', arguments: {} });
  assert.deepEqual(resp.result.structuredContent.workspaces.map(w => [w.id, w.name]), [['arbeit', 'Arbeit'], ['privat-ae', 'Privat Ä'], ['arbeit-2', 'Arbeit']], 'Kennungen wie in der App, doppelte mit -2');
  resp = await mm.request('tools/call', { name: 'create_note', arguments: { workspace: 'arbeit', title: 'Sitzung', body: '? Wann ist die nächste?' } });
  assert.ok(!resp.result.isError, JSON.stringify(resp.result));
  resp = await mm.request('tools/call', { name: 'create_note', arguments: { workspace: 'Privat Ä', title: 'Ferien' } });
  assert.ok(!resp.result.isError, 'der Name als Kennung geschrieben geht auch');
  const titlesOf = f => { const d = new SQL.Database(fs.readFileSync(f)); const rows = d.exec('SELECT title FROM notes WHERE deleted_at IS NULL ORDER BY id'); d.close(); return rows.length ? rows[0].values.map(v => v[0]) : []; };
  assert.deepEqual([titlesOf(arbeit), titlesOf(privat), titlesOf(extra)], [['Sitzung'], ['Ferien'], []], 'jede Notiz in ihrer Datei');
  resp = await mm.request('tools/call', { name: 'list_questions', arguments: { workspace: 'privat-ae' } });
  assert.equal(resp.result.structuredContent.total, 0, 'Fragen nur aus dem genannten Bereich');
  resp = await mm.request('tools/call', { name: 'list_questions', arguments: { workspace: 'arbeit' } });
  assert.equal(resp.result.structuredContent.total, 1);
  resp = await mm.request('tools/call', { name: 'get_overview', arguments: {} });
  assert.equal(resp.result.isError, true);
  assert.match(resp.result.content[0].text, /workspace: required/);
  resp = await mm.request('tools/call', { name: 'get_overview', arguments: { workspace: 'gibtsnicht' } });
  assert.equal(resp.result.structuredContent.error.code, 'WORKSPACE_NOT_FOUND');
  resp = await mm.request('resources/list');
  assert.deepEqual(resp.result.resources.map(x => x.uri), ['nonotes://arbeit/overview', 'nonotes://privat-ae/overview', 'nonotes://arbeit-2/overview']);
  resp = await mm.request('resources/read', { uri: 'nonotes://privat-ae/note/1' });
  assert.match(resp.result.contents[0].text, /Ferien/);
  // die App ändert eine der Dateien: der nächste Aufruf liest sie neu
  { const d = new SQL.Database(fs.readFileSync(privat)); d.run("UPDATE notes SET title = 'Ferien im Tessin' WHERE id = 1"); fs.writeFileSync(privat, Buffer.from(d.export())); d.close(); }
  resp = await mm.request('tools/call', { name: 'get_note', arguments: { workspace: 'privat-ae', id: 1 } });
  assert.equal(resp.result.structuredContent.title, 'Ferien im Tessin');
  await mm.stop();
  r = run(['--dir', path.join(tmp, 'leer-gibt-es-nicht')]);
  assert.equal(r.status, 2);
  fs.mkdirSync(path.join(tmp, 'leer'));
  r = run(['--dir', path.join(tmp, 'leer')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Keine \.sqlite-Datei/);

  // Vorlagen (v2.5.0): templates/ neben der App, eigener Ordner mit --templates, nichts ausserhalb des Ordners
  {
    const f = path.join(tmp, 'Vorlagen.sqlite');
    const c = start(['--file', f, '--create']);
    await init(c);
    let rv = await c.request('tools/call', { name: 'list_templates', arguments: {} });
    assert.ok(!rv.result.isError, JSON.stringify(rv));
    assert.match(rv.result.content[0].text, /^\[t Aufgabe\.md\] "Aufgabe" — .* — 1 note\n  fields: "Beschreibung": .*; "Wer": .*; "Bis wann" \(default "\{\{datum\+7\}\}"\): .*; "Ziel": .*\n\[t Entscheidungsvorlage\.md\] "Entscheidungsvorlage" — .*\n\[t Sitzungsprotokoll\.md\] "Sitzungsprotokoll" — .* — 3 notes$/);
    assert.deepEqual(rv.result.structuredContent.items.map(i => [i.id, !!i.fields]), [['Aufgabe.md', true], ['Entscheidungsvorlage.md', false], ['Sitzungsprotokoll.md', false]], 'fields nur mit ausfüllbaren Platzhaltern');
    rv = await c.request('tools/call', { name: 'create_note_from_template', arguments: { template_id: 'Sitzungsprotokoll.md' } });
    assert.match(rv.result.content[0].text, /^Created note \[1\] "Sitzung \d+\.\d+\.\d{4}" from template "Sitzungsprotokoll" with 2 sub-notes at the root\.$/);
    rv = await c.request('tools/call', { name: 'create_note_from_template', arguments: { template_id: 'Aufgabe.md', values: { Beschreibung: 'Offerte einholen', wer: 'anna' } } });
    assert.match(rv.result.content[0].text, /^Created note \[4\] "Offerte einholen" from template "Aufgabe" at the root\.$/, 'Werte für die ausfüllbaren Platzhalter (v2.12.0)');
    rv = await c.request('tools/call', { name: 'get_note', arguments: { id: 4 } });
    assert.match(JSON.stringify(rv.result.structuredContent), /- \[ \] Offerte einholen @anna >\{\{\?Bis wann: \d{1,2}\.\d{1,2}\.\d{4}\}\}/, 'nicht gegebene bleiben offen, mit Vorschlag');
    assert.equal(await c.stop(), 0);
    const own = path.join(tmp, 'eigene');
    fs.mkdirSync(own);
    fs.writeFileSync(path.join(own, 'Woche.md'), '# KW {{woche}}');
    fs.writeFileSync(path.join(own, 'README.md'), '# keine Vorlage');
    const c2 = start(['--file', f, '--templates', own]);
    await init(c2);
    rv = await c2.request('tools/call', { name: 'list_templates', arguments: {} });
    assert.deepEqual(rv.result.structuredContent.items.map(i => i.id), ['Woche.md'], 'README zählt nicht');
    rv = await c2.request('tools/call', { name: 'create_note_from_template', arguments: { template_id: '../Vorlagen.sqlite' } });
    assert.equal(rv.result.structuredContent.error.code, 'TEMPLATE_NOT_FOUND', 'nur Dateien im Ordner');
    rv = await c2.request('tools/call', { name: 'create_note_from_template', arguments: { template_id: 'Woche.md', title: 'Diese Woche' } });
    assert.ok(!rv.result.isError);
    assert.equal(await c2.stop(), 0);
    r = run(['--file', f, '--templates', path.join(tmp, 'fehlt')]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Ordner mit Vorlagen fehlt/);
    assert.match(run(['--help']).stdout, /--templates/);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  part('Programm mit mehreren Dateien (--file mehrmals, --dir): list_workspaces, Kennungen wie in der App, Parameter workspace, jede Änderung in ihrer Datei, Ressourcen je Bereich, Änderung von aussen; Vorlagen aus templates/ oder --templates');
}

// ============================================================
/* Mehrzeilige Entscheide und Fragen (v2.4.0) ohne Browser: Parser ("?!```" … "```", Einträge in Listen, Unter-Einträge, Code zählt
   nicht), Index mit Beschreibung und Block (Schema 15), Antworten schreiben, Angleichen aus Schema 14, Vorschau, Export, Editor,
   Querverweise im Block und Werkzeuge für Agenten. */
async function runEntries(browser, part, step) {
  let now = Date.parse('2026-10-20T08:00:00Z');
  const RealDate = Date;
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } };
  const context = vm.createContext(sandbox);
  for (const f of ['packages/core/i18n.js', 'packages/core/history.js', 'packages/core/dates.js', 'packages/core/questions.js', 'packages/core/tasks.js', 'packages/core/links.js',
    'packages/core/backend.js', 'packages/core/merge.js', 'packages/core/markdown.js', 'packages/core/editing.js', 'packages/core/export.js', 'packages/data/db.js',
    'packages/store-local/backend-local.js', 'packages/agent/catalog.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  const SQL = await initSqlJs();
  const { NoNotesDB: DB, NoNotesQuestions: Q, NoNotesMarkdown: M, NoNotesEditing: E, NoNotesExport: X } = sandbox;
  const json = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const cols = (d, t) => d.exec(`PRAGMA table_info(${t})`)[0].values.map(r => r[1]);

  const BODY = [
    'Intro',                                                         // 0
    '?!``` Ablage auf SharePoint umstellen @anna >15.11.2026',       // 1
    'Ab 1.11. liegen alle Projektordner auf SharePoint.',            // 2
    '- Altdaten bleiben bis Ende Jahr lesbar',                       // 3
    '?! Wer migriert die Altdaten? @ben',                            // 4
    '!! 21.10.2026: Externe Firma',                                  // 5
    '- ?! Brauchen wir Schulungen?',                                 // 6
    '? Wer schult? @cem',                                            // 7
    '~~~',                                                           // 8
    '?! im Code zählt nicht',                                        // 9
    '```',                                                           // 10 (im Code: schliesst den Block nicht)
    '~~~',                                                           // 11
    'Siehe [[Ziel*]]',                                               // 12
    '```',                                                           // 13
    '!! 22.10.2026: Ja, so umsetzen',                                // 14
    '',                                                              // 15
    '- Budget 2027',                                                 // 16
    '- ?! Neues Tool kaufen? @anna',                                 // 17
    '  !! 20.10.2026: Ja, Variante B',                               // 18
    '- [ ] Offerte einholen',                                        // 19
    'Danach [[Nach*]]',                                              // 20
    '```',                                                           // 21
    '? im Code zählt nicht',                                         // 22
    '```',                                                           // 23
    '?```',                                                          // 24
    '',                                                              // 25
    '# Wie gehen wir vor?',                                          // 26
    'Mit Details',                                                   // 27
    '```',                                                           // 28
  ].join('\n');

  // ---------- Parser ----------
  const parsed = json(Q.parse(BODY));
  assert.deepEqual(parsed.map(p => [p.kind, p.text, p.lineIndex, p.parent, p.answer, p.decided]), [
    ['decision', 'Ablage auf SharePoint umstellen @anna', 1, null, 'Ja, so umsetzen', '2026-10-22'],
    ['decision', 'Wer migriert die Altdaten? @ben', 4, 0, 'Externe Firma', '2026-10-21'],
    ['decision', 'Brauchen wir Schulungen?', 6, 0, null, null],
    ['question', 'Wer schult? @cem', 7, 0, null, null],
    ['decision', 'Neues Tool kaufen? @anna', 17, null, 'Ja, Variante B', '2026-10-20'],
    ['question', 'Wie gehen wir vor?', 24, null, null, null],
  ]);
  assert.equal(parsed[0].due, '2026-11-15', 'Termin in der Titelzeile');
  assert.deepEqual(parsed[0].people, [{ handle: 'anna', optional: false }], 'Personen nur aus dem Titel');
  assert.equal(parsed[0].details, 'Ab 1.11. liegen alle Projektordner auf SharePoint.\n- Altdaten bleiben bis Ende Jahr lesbar\n\n~~~\n?! im Code zählt nicht\n```\n~~~\nSiehe [[Ziel*]]',
    'Beschreibung ohne Unter-Einträge, Code im Block bleibt Text');
  assert.equal(parsed[0].block, true);
  assert.equal(parsed[2].list, true);
  assert.equal(parsed[4].indent, '  ', 'Antwort eines Listenpunkts eingerückt');
  assert.equal(parsed[5].details, 'Mit Details', 'ohne Titel gilt die erste Zeile (ohne «#»)');
  assert.equal(json(Q.parse('?!```\n```')).length, 0, 'leerer Block: kein Eintrag');
  assert.deepEqual(json(Q.parse('?!```\n```\n? Danach')).map(p => p.text), ['Danach'], 'und er verschluckt nichts');
  assert.deepEqual(json(Q.parse('?!``` Offen\n? Unter\n!! nicht die Antwort des Blocks')).map(p => [p.text, p.parent, p.answer]),
    [['Offen', null, null], ['Unter', 0, 'nicht die Antwort des Blocks']], 'ohne "```" reicht der Block bis zum Ende');
  assert.deepEqual(json(Q.parse('? Wie?\n! So\n?! Und? @x')).map(p => [p.kind, p.text, p.answer, p.block, p.list]),
    [['question', 'Wie?', 'So', false, false], ['decision', 'Und? @x', null, false, false]], 'einzeilig wie bisher');
  part('Parser: Block mit Titel, Termin und Personen, Beschreibung ohne Unter-Einträge, Einträge in Listen, ohne Titel die erste Zeile, Code zählt nicht');

  // ---------- Index (Schema 15) ----------
  const d = DB.open(SQL, null);
  assert.equal(DB.getMeta(d, 'schema_version'), SCHEMA_VERSION);
  assert.ok(['details', 'parent_id'].every(c => cols(d, 'questions').includes(c)), 'Spalten details und parent_id');
  const n = DB.createNote(d, null);
  DB.updateNote(d, n, 'Projekt', BODY);
  const all = json(DB.listQuestions(d, { kind: 'all', status: 'all' }));
  const byText = t => all.find(r => r.text.startsWith(t));
  const block = byText('Ablage');
  assert.equal(block.details, parsed[0].details);
  assert.equal(block.parent_id, null);
  assert.deepEqual(block.sub, { decisions: 2, decisionsOpen: 1, questions: 1, questionsOpen: 1 });
  for (const t of ['Wer migriert', 'Brauchen wir', 'Wer schult']) {
    assert.equal(byText(t).parent_id, block.id, t);
    assert.equal(byText(t).parent_text, 'Ablage auf SharePoint umstellen @anna', t);
    assert.equal(byText(t).parent_answered, true, t);
  }
  assert.equal(byText('Neues Tool').parent_id, null);
  assert.equal(byText('Neues Tool').sub, null);
  assert.deepEqual(json(DB.listQuestions(d, { kind: 'decision', status: 'all', query: 'projektordner' })).map(r => r.text), ['Ablage auf SharePoint umstellen @anna'], 'Suche auch in der Beschreibung');
  const c = json(DB.countQuestions(d, '2026-10-20T10:00'));
  assert.deepEqual({ q: [c.open, c.total], d: [c.decisions.open, c.decisions.total] }, { q: [2, 2], d: [1, 4] });
  assert.deepEqual(json(DB.listPeople(d)), ['anna', 'ben', 'cem']);
  assert.deepEqual(d.exec('SELECT title FROM note_links ORDER BY line_no')[0].values.map(v => v[0]), ['Ziel', 'Nach'], 'Querverweise im Block und nach ihm');
  assert.equal(d.exec("SELECT count(*) FROM tasks")[0].values[0][0], 1);
  assert.deepEqual(json(Q.nest(json(DB.listQuestions(d, { kind: 'decision', status: 'all' })))).map(e => [e.row.text.slice(0, 12), e.nested]),
    [['Ablage auf S', false], ['Wer migriert', true], ['Brauchen wir', true], ['Neues Tool k', false]], 'nest: Unterentscheide direkt unter dem Block');
  assert.deepEqual(json(Q.nest(json(DB.listQuestions(d, { kind: 'decision', status: 'open' })))).map(e => [e.row.text.slice(0, 12), e.nested]),
    [['Brauchen wir', false]], 'ohne den Block steht der Unterentscheid für sich');
  part('Index (Schema 15): Beschreibung, Block der Unter-Einträge, Zähler der Unter-Einträge, Suche in der Beschreibung, Querverweise im Block, nest()');

  // Die Beschreibung ändern: derselbe Eintrag (gleicher Titel), neue Beschreibung; Unter-Eintrag hinausschieben: kein Block mehr
  DB.updateNote(d, n, 'Projekt', BODY.replace('Ab 1.11. liegen', 'Ab 1.12. liegen'));
  assert.equal(DB.getQuestion(d, block.id).details.slice(0, 20), 'Ab 1.12. liegen alle', 'gleiche Nummer, neue Beschreibung');
  const moved = BODY.split('\n');
  moved.splice(7, 1);
  moved.push('? Wer schult? @cem');
  DB.updateNote(d, n, 'Projekt', moved.join('\n'));
  const cem = json(DB.listQuestions(d, { kind: 'question', status: 'all' })).find(r => r.text.startsWith('Wer schult'));
  assert.equal(cem.id, byText('Wer schult').id, 'gleiche Nummer');
  assert.equal(cem.parent_id, null, 'ausserhalb des Blocks gehört er nicht mehr dazu');
  DB.updateNote(d, n, 'Projekt', BODY);
  part('Änderungen: neue Beschreibung behält den Eintrag; ein Unter-Eintrag ausserhalb des Blocks gehört nicht mehr dazu');

  // ---------- Antworten schreiben ----------
  const lines = () => DB.getNote(d, n).body.split('\n');
  DB.answerQuestion(d, byText('Brauchen wir').id, 'Nein, nicht nötig', { decided: '20.10.2026' });
  assert.deepEqual(lines().slice(6, 9), ['- ?! Brauchen wir Schulungen?', '  !! 20.10.2026: Nein, nicht nötig', '? Wer schult? @cem'], 'im Block, unter dem Listenpunkt eingerückt');
  DB.answerQuestion(d, byText('Wer schult').id, 'Anna');
  assert.deepEqual(lines().slice(8, 10), ['? Wer schult? @cem', '! Anna']);
  assert.deepEqual(json(DB.listQuestions(d, { kind: 'decision', status: 'all' })).find(r => r.id === block.id).sub, { decisions: 2, decisionsOpen: 0, questions: 1, questionsOpen: 0 });
  DB.answerQuestion(d, block.id, 'Ja, ab Dezember', {});
  assert.deepEqual(lines().slice(15, 18), ['```', '!! 22.10.2026: Ja, ab Dezember', ''], 'nach dem "```", das Datum aus dem Text bleibt');
  DB.answerQuestion(d, byText('Neues Tool').id, 'Variante C\nweil günstiger', {});
  assert.deepEqual(lines().slice(19, 22), ['- ?! Neues Tool kaufen? @anna', '  !! 20.10.2026: Variante C', '  !! weil günstiger']);
  DB.answerQuestion(d, byText('Wie gehen').id, 'Schrittweise');
  assert.deepEqual(lines().slice(-3), ['Mit Details', '```', '! Schrittweise']);
  const o = DB.createNote(d, null);
  DB.updateNote(d, o, 'Offen', '?!``` Offen @anna\nText');
  DB.answerQuestion(d, json(DB.listQuestions(d, { kind: 'decision', status: 'open' })).find(r => r.text === 'Offen @anna').id, 'Erledigt', { decided: '20.10.2026' });
  assert.equal(DB.getNote(d, o).body, '?!``` Offen @anna\nText\n```\n!! 20.10.2026: Erledigt', 'ein Block ohne Ende bekommt sein "```" vor der Antwort');
  part('Antworten: Unterentscheid im Block (auch als Listenpunkt), Block nach "```", Listenpunkt eingerückt, Block ohne Ende wird geschlossen');

  // ---------- Angleichen aus Schema 14 ----------
  {
    const old = new SQL.Database(DB.exportBytes(d));
    old.run("DROP INDEX idx_questions_parent; ALTER TABLE questions DROP COLUMN details; ALTER TABLE questions DROP COLUMN parent_id; UPDATE meta SET value = '14' WHERE key = 'schema_version'");
    const mig = DB.open(SQL, old.export());
    old.close();
    assert.equal(DB.getMeta(mig, 'schema_version'), SCHEMA_VERSION);
    const rows = json(DB.listQuestions(mig, { kind: 'decision', status: 'all' }));
    assert.equal(rows.find(r => r.text.startsWith('Ablage')).details.slice(0, 8), 'Ab 1.11.');
    assert.equal(rows.find(r => r.text.startsWith('Wer migriert')).parent_text, 'Ablage auf SharePoint umstellen @anna');
    part('Angleichen aus Schema 14: Spalten dazu, Index aus den Texten neu gefüllt');
  }

  // ---------- Vorschau ----------
  const html = M.render(BODY, { lineMap: true, interactiveTasks: true });
  assert.equal((html.match(/class="md-q md-decision md-q-block answered" data-line="1"/g) || []).length, 1, 'Block als ein Kasten');
  assert.ok(html.includes('1 von 2 Unterentscheiden offen') && html.includes('1 von 1 Unterfrage offen'), 'Hinweis auf offene Unter-Einträge');
  assert.ok(/md-q-subs warn/.test(html), 'entschieden, aber Unter-Einträge offen: Warnung');
  assert.ok(html.includes('<div class="md-q-details"><p data-line="2">Ab 1.11.'), 'Beschreibung als Markdown, Zeilen stimmen');
  assert.ok(html.includes('<pre data-line="8"><code>?! im Code zählt nicht\n```</code></pre>'), 'Code im Block');
  assert.ok(/<li class="q-li" data-line="6"><div class="md-q md-decision open">/.test(html), 'Unterentscheid als Listenpunkt im Block');
  assert.ok(/<li class="q-li" data-line="17"><div class="md-q md-decision answered">/.test(html), 'Entscheid als Listenpunkt');
  assert.ok(html.includes('<li class="task" data-line="19">'), 'Aufgabe nach dem Block: richtige Zeile');
  assert.ok(html.includes('<pre data-line="21"><code>? im Code zählt nicht</code></pre>'));
  assert.ok(/<div class="md-q md-q-block open" data-line="24">.*<div class="md-q-text">Wie gehen wir vor\?<\/div><div class="md-q-details"><p data-line="27">Mit Details/.test(html), 'Titel aus der ersten Zeile, nicht doppelt');
  const inBlockTask = M.render('?!``` T\n- [ ] Im Block\n```', { interactiveTasks: true });
  assert.ok(inBlockTask.includes('<li class="task" data-line="1">'), 'Aufgabe im Block mit der Zeile im ganzen Text');
  assert.ok(M.render('- Punkt\n  ? Eingerückt?\n  ! Ja').includes('<li>Punkt<div class="md-q answered">'), 'Frage eingerückt unter einem Listenpunkt');
  part('Vorschau: ein Kasten je Block mit Beschreibung, Unter-Einträgen und Hinweis, Einträge als Listenpunkte, Code, Zeilen für Aufgaben und Scrollen');

  // ---------- Export ----------
  const md = X.bodyToMarkdown(BODY, null, null);
  for (const s of [
    '> **Entscheid (getroffen):** Ablage auf SharePoint umstellen @anna (bis 15.11.2026)\n>\n> Ab 1.11. liegen alle Projektordner auf SharePoint.\n> - Altdaten bleiben bis Ende Jahr lesbar\n>\n> > **Entscheid (getroffen):** Wer migriert die Altdaten? @ben\n> > **Entschieden 21.10.2026:** Externe Firma',
    '> - **Offener Entscheid:** Brauchen wir Schulungen?',
    '> **Entschieden 22.10.2026:** Ja, so umsetzen',
    '- **Entscheid (getroffen):** Neues Tool kaufen? @anna — **Entschieden 20.10.2026:** Ja, Variante B',
    '```\n? im Code zählt nicht\n```',
    '> **Offene Frage:** Wie gehen wir vor?\n>\n> Mit Details',
  ]) assert.ok(md.includes(s), `Export enthält ${JSON.stringify(s)}\n${md}`);
  part('Export: Block als Zitat mit Beschreibung, Unter-Einträge als Zitat im Zitat, Listenpunkte bleiben Listen, Code bleibt Code');

  // ---------- Editor ----------
  const tp = (text, s, e, kind) => json(E.togglePrefix(text, s, e, kind)).text;
  assert.equal(tp('- Neues Tool kaufen?', 3, 3, 'decision'), '- ?! Neues Tool kaufen?', 'in der Liste hinter dem Listenzeichen');
  assert.equal(tp('- ?! Neues Tool kaufen?', 3, 3, 'decision'), '- Neues Tool kaufen?');
  assert.equal(tp('- ?! Neues Tool kaufen?', 3, 3, 'question'), '- ? Neues Tool kaufen?');
  assert.equal(tp('Titel\nZeile 1\nZeile 2', 0, 21, 'decision'), '?!``` Titel\nZeile 1\nZeile 2\n```', 'mehrere Zeilen: Block');
  assert.equal(tp('?!``` Titel\nZeile 1\n```', 0, 23, 'question'), '?``` Titel\nZeile 1\n```', 'Art wechseln');
  assert.equal(tp('?!``` Titel\nZeile 1\n```', 0, 23, 'decision'), 'Titel\nZeile 1', 'Block wieder zu Text');
  assert.equal(tp('? a\n? b', 0, 7, 'question'), 'a\nb', 'schon markierte Zeilen: Zeile für Zeile entfernen');
  assert.deepEqual(json(E.continueLine('?!``` Titel', 11, 11)), { text: '?!``` Titel\n\n```', selStart: 12, selEnd: 12 }, 'Enter nach dem Öffner setzt das Ende');
  assert.equal(E.continueLine('?!``` Titel\nText\n```', 11, 11), null, 'schon geschlossen: normale neue Zeile');
  assert.deepEqual(json(E.continueLine('- ?! Tool?\n  !! Ja', 19, 19)).text, '- ?! Tool?\n  !! Ja\n  !! ', 'Antwortzeilen laufen eingerückt weiter');
  part('Editor: «?»/«?!» in Listen hinter dem Listenzeichen, mehrere Zeilen als Block (und zurück), Enter nach "?!```" setzt "```"');

  // ---------- Agenten ----------
  const backend = sandbox.NoNotesBackendLocal.create({ getDb: () => d, onChange: () => {} });
  const cat = sandbox.NoNotesAgent.create(backend, { author: 'Agent-Test', now: () => new RealDate(now).toISOString() });
  const r = await cat.call('list_decisions', { status: 'all', note_id: n });
  assert.ok(!r.isError, r.content[0].text);
  const items = json(r.structuredContent).items;
  const top = items.find(i => i.text.startsWith('Ablage'));
  assert.equal(top.details.slice(0, 8), 'Ab 1.11.');
  assert.deepEqual(top.sub_entries, { decisions: 2, open_decisions: 0, questions: 1, open_questions: 0 });
  assert.equal(items.find(i => i.text.startsWith('Wer migriert')).parent_id, top.id);
  assert.match(r.content[0].text, new RegExp(`inside \\[d ${top.id}\\] "Ablage auf SharePoint umstellen @anna"`));
  assert.match(r.content[0].text, /\n {4}Ab 1\.11\. liegen alle Projektordner auf SharePoint\./, 'Beschreibung eingerückt unter dem Eintrag');
  assert.match(sandbox.NoNotesAgent.INSTRUCTIONS, /"\?!``` Title"/);
  const rec = await cat.call('record_decision', { id: items.find(i => i.text.startsWith('Brauchen wir')).id, decision: 'Doch, eine halbe Stunde', decided: '2026-10-21' });
  assert.ok(!rec.isError, rec.content[0].text);
  assert.equal(DB.getNote(d, n).body.split('\n')[7], '  !! 2026-10-21: Doch, eine halbe Stunde', 'record_decision schreibt im Block');
  part('Agenten: Beschreibung, Block und Unter-Einträge in list_decisions, Anleitung nennt die Syntax, record_decision im Block');

  // ---------- Blöcke in Listen (v2.6.0) ----------
  const LIST = [
    '- Projekt A',                                                   // 0
    '  - ?!``` Welches Ticketsystem? @anna >15.11.2026',             // 1
    '    Wir brauchen bis Ende Jahr eines.',                         // 2
    '    - Variante A: günstig',                                     // 3
    '    ?! Budget freigeben? @ben',                                 // 4
    '    !! 21.10.2026: Ja',                                         // 5
    '    - ? Wer betreut es?',                                       // 6
    'ohne Einrückung, gehört dazu [[Ziel*]]',                        // 7
    '    ```',                                                       // 8
    '    !! 22.10.2026: Variante B',                                 // 9
    '- Projekt B [[Nach*]]',                                         // 10
    '  - [ ] Offerte einholen',                                      // 11
    '1. ?``` Wie gehen wir vor?',                                    // 12
    '   Schritt für Schritt',                                        // 13
    '   ```',                                                        // 14
    '2. Danach',                                                     // 15
  ].join('\n');
  const lp = json(Q.parse(LIST));
  assert.deepEqual(lp.map(p => [p.kind, p.text, p.lineIndex, p.parent, p.answer, p.block, p.list, p.indent.length]), [
    ['decision', 'Welches Ticketsystem? @anna', 1, null, 'Variante B', true, true, 4],
    ['decision', 'Budget freigeben? @ben', 4, 0, 'Ja', false, false, 4],
    ['question', 'Wer betreut es?', 6, 0, null, false, true, 6],
    ['question', 'Wie gehen wir vor?', 12, null, null, true, true, 3],
  ]);
  assert.equal(lp[0].due, '2026-11-15');
  assert.equal(lp[0].decided, '2026-10-22');
  assert.equal(lp[0].details, 'Wir brauchen bis Ende Jahr eines.\n- Variante A: günstig\n\nohne Einrückung, gehört dazu [[Ziel*]]', 'nachsichtig: auch eine Zeile ohne Einrückung gehört zum Block');
  assert.equal(lp[3].details, 'Schritt für Schritt');
  assert.deepEqual(json(Q.parse('- ?!``` Offen\n  Text\n- Nicht mehr in der Liste?')).map(p => [p.text, p.closed, p.details]), [['Offen', false, 'Text\n- Nicht mehr in der Liste?']], 'ohne "```" reicht er bis zum Ende');
  assert.deepEqual(json(Q.parse('?!``` Aussen\n- ?!``` Innen\n```\n!! A')).map(p => [p.text, p.block, p.parent, p.answer]), [['Aussen', true, null, 'A']], 'im Block kein Block, auch nicht als Listenpunkt');
  assert.deepEqual(json(Q.parse('- [ ] ?!``` Aufgabe\n  ```')).length, 0, 'eine Aufgabe ist kein Eintrag');
  part('Blöcke in Listen: Parser mit Titel, Personen, Termin, Beschreibung, Unter-Einträgen, Antwort; nummeriert und in Unterlisten; Einrückung nachsichtig; im Block keiner; Aufgaben nie');

  // Index, Aufgaben und Querverweise nach dem Block; Antworten schreiben
  const ln = DB.createNote(d, null);
  DB.updateNote(d, ln, 'Liste', LIST);
  const lrows = json(DB.listQuestions(d, { kind: 'all', status: 'all' })).filter(r => r.note_id === ln);
  const lblock = lrows.find(r => r.text.startsWith('Welches'));
  assert.equal(lblock.details.slice(0, 13), 'Wir brauchen ');
  assert.deepEqual(lrows.filter(r => r.parent_id === lblock.id).map(r => r.text).sort(), ['Budget freigeben? @ben', 'Wer betreut es?']);
  assert.deepEqual(d.exec(`SELECT title FROM note_links WHERE note_id = ${ln} ORDER BY line_no`)[0].values.map(v => v[0]), ['Ziel', 'Nach'], 'Querverweise im Block und nach dem "```"');
  assert.equal(d.exec(`SELECT count(*) FROM tasks WHERE note_id = ${ln}`)[0].values[0][0], 1, 'Aufgabe nach dem Block');
  const llines = () => DB.getNote(d, ln).body.split('\n');
  DB.answerQuestion(d, lblock.id, 'Variante C', {});
  assert.deepEqual(llines().slice(8, 11), ['    ```', '    !! 22.10.2026: Variante C', '- Projekt B [[Nach*]]'], 'Antwort nach dem "```", eingerückt wie der Text des Punkts');
  DB.answerQuestion(d, lrows.find(r => r.text === 'Wer betreut es?').id, 'Ben');
  assert.deepEqual(llines().slice(6, 8), ['    - ? Wer betreut es?', '      ! Ben']);
  DB.answerQuestion(d, lrows.find(r => r.text === 'Wie gehen wir vor?').id, 'Gemeinsam');
  assert.deepEqual(llines().slice(14, 18), ['   Schritt für Schritt', '   ```', '   ! Gemeinsam', '2. Danach']);
  const lo = DB.createNote(d, null);
  DB.updateNote(d, lo, 'Offen', '- ?!``` Offen\n  Text');
  DB.answerQuestion(d, json(DB.listQuestions(d, { kind: 'decision', status: 'open' })).find(r => r.text === 'Offen').id, 'Erledigt', { decided: '20.10.2026' });
  assert.equal(DB.getNote(d, lo).body, '- ?!``` Offen\n  Text\n  ```\n  !! 20.10.2026: Erledigt', 'ohne Ende: "```" eingerückt vor der Antwort');
  part('Blöcke in Listen: Index mit Beschreibung und Unter-Einträgen, Querverweise und Aufgaben danach, Antworten eingerückt nach "```", offener Block wird geschlossen');

  // Ältere Dateien: Merker index_rules füllt die Indexe einmal neu (ohne neues Schema)
  {
    assert.equal(DB.getMeta(d, 'index_rules'), '3', 'neue Datei: heutige Regeln');
    const old = new SQL.Database(DB.exportBytes(d));
    old.run(`DELETE FROM questions WHERE note_id = ${ln}; DELETE FROM meta WHERE key = 'index_rules'`);
    const re = DB.open(SQL, old.export());
    old.close();
    assert.equal(DB.getMeta(re, 'schema_version'), SCHEMA_VERSION, 'Schema bleibt');
    assert.equal(DB.getMeta(re, 'index_rules'), '3');
    assert.ok(json(DB.listQuestions(re, { kind: 'decision', status: 'all' })).some(r => r.text.startsWith('Welches')), 'Block in der Liste wieder im Index');
    const again = new SQL.Database(DB.exportBytes(re));
    again.run(`DELETE FROM questions WHERE note_id = ${ln}`);
    const kept = DB.open(SQL, again.export());
    again.close();
    assert.ok(!json(DB.listQuestions(kept, { kind: 'decision', status: 'all' })).some(r => r.text.startsWith('Welches')), 'mit heutigen Regeln wird nicht jedes Mal neu gefüllt');
    part('Ältere Dateien: Merker index_rules in meta füllt die Indexe einmal neu, ohne neues Schema');
  }

  // Vorschau und Export
  const lhtml = M.render(LIST, { lineMap: true });
  assert.ok(/<li class="q-li" data-line="1"><div class="md-q md-decision md-q-block answered">/.test(lhtml), 'Kasten im Listenpunkt der Unterliste: ' + lhtml);
  assert.ok(lhtml.includes('<div class="md-q-details"><p data-line="2">Wir brauchen bis Ende Jahr eines.</p>'), 'Beschreibung mit Zeilen');
  assert.ok(lhtml.includes('1 von 2 Unterfrage') || lhtml.includes('1 von 1 Unterfrage offen'), 'Hinweis auf offene Unter-Einträge');
  assert.ok(/<li data-line="10">Projekt B/.test(lhtml), 'die Liste geht danach weiter');
  assert.equal((lhtml.match(/<ol>/g) || []).length, 1, 'nummeriert: eine Liste über den Block hinweg');
  assert.ok(/<li class="q-li" data-line="12"><div class="md-q md-q-block open">.*<\/li><li data-line="15">Danach/.test(lhtml), 'zweiter Punkt nach dem Block');
  assert.ok(M.render('- Punkt\n  ?!``` Eingerückt\n  Text\n  ```').includes('<li>Punkt<div class="md-q md-decision md-q-block open">'), 'Block eingerückt unter einem Listenpunkt');
  const lmd = X.bodyToMarkdown(LIST, null, null);
  for (const s2 of [
    '  - **Entscheid (getroffen):** Welches Ticketsystem? @anna (bis 15.11.2026)\n\n    Wir brauchen bis Ende Jahr eines.\n    - Variante A: günstig',
    '    > **Entscheid (getroffen):** Budget freigeben? @ben',
    '    **Entschieden 22.10.2026:** Variante B',
    '1. **Offene Frage:** Wie gehen wir vor?\n\n   Schritt für Schritt',
  ]) assert.ok(lmd.includes(s2), `Export enthält ${JSON.stringify(s2)}\n${lmd}`);
  part('Blöcke in Listen: Vorschau als Kasten im Listenpunkt, Liste und Nummerierung gehen weiter; Export als Listenpunkt mit Beschreibung');

  // Editor
  assert.equal(tp('- Welches Tool?\n- Variante A\n- Variante B', 0, 41, 'decision'), '- ?!``` Welches Tool?\n  - Variante A\n  - Variante B\n  ```', 'markierte Listenpunkte: Block im ersten Punkt');
  assert.equal(tp('  1. Titel\n  2. Punkt', 0, 20, 'question'), '  1. ?``` Titel\n     2. Punkt\n     ```', 'nummeriert und eingerückt');
  assert.equal(tp('- ?!``` Welches Tool?\n  - Variante A\n  ```', 0, 42, 'question'), '- ?``` Welches Tool?\n  - Variante A\n  ```', 'Art wechseln');
  assert.equal(tp('- ?!``` Welches Tool?\n  - Variante A\n  ```', 0, 42, 'decision'), '- Welches Tool?\n- Variante A', 'und zurück');
  assert.deepEqual(json(E.continueLine('- ?!``` Titel', 13, 13)), { text: '- ?!``` Titel\n  \n  ```', selStart: 16, selEnd: 16 }, 'Enter: eingerückt, mit "```"');
  assert.deepEqual(json(E.continueLine('- ?!``` Titel\n  Text\n  ```', 13, 13)), { text: '- ?!``` Titel\n  \n  Text\n  ```', selStart: 16, selEnd: 16 }, 'schon geschlossen: nur eingerückt, kein neuer Punkt');
  part('Blöcke in Listen: Editor macht markierte Listenpunkte zum Block (und zurück, Art wechseln), Enter rückt ein und setzt "```"');

  // Verweise mit Nummer (seit 2.9.0): Vorschau und Export zeigen nur den Titel; der Knopf [[ ]] lässt den Cursor für die Vorschläge drin
  {
    const d = DB.open(SQL, null);
    const a = DB.createNote(d, null), b = DB.createNote(d, null);
    DB.updateNote(d, a, 'Protokoll', '');
    DB.updateNote(d, b, 'Protokoll', '');
    const find = sandbox.NoNotesLinks.resolver(DB.titleIndex(d));
    const html = M.render(`[[Protokoll#${a}]] [[Protokoll#999*]] [[Protokoll]]`, { resolveRef: find });
    assert.match(html, new RegExp(`class="md-wiki" data-title="Protokoll" data-note-id="${a}">Protokoll</a>`), 'mit Nummer: Notiz a, Text ohne Nummer');
    assert.match(html, /class="md-wiki md-wiki-cross missing" data-title="Protokoll">Protokoll<\/a>/, 'unbekannte Nummer: offen, ohne Nummer');
    assert.match(html, new RegExp(`data-note-id="${b}">Protokoll</a>`), 'ohne Nummer: die zuletzt geänderte');
    assert.match(M.render('[[Alt]]', { resolveTitle: () => 7 }), /data-note-id="7">Alt</, 'resolveTitle von früher geht weiter');
    assert.equal(X.bodyToMarkdown(`Siehe [[Protokoll#${a}*]].`, title => ({ href: 'p.md', label: find(title).label }), null), 'Siehe [Protokoll](p.md).');
    assert.deepEqual(json(E.wikiLink('Siehe ', 6, 6)), { text: 'Siehe [[]]', selStart: 8, selEnd: 8 }, 'ohne Markierung: Cursor zwischen den Klammern');
    assert.deepEqual(json(E.wikiLink('Siehe Protokoll', 6, 15)), { text: 'Siehe [[Protokoll]]', selStart: 17, selEnd: 17 }, 'Markierung wird der Suchtext');
    assert.equal(E.wikiLink('Siehe [[Protokoll]]', 6, 19).text, 'Siehe Protokoll', 'ein Verweis wird wieder Text');
    assert.equal(E.wikiLink('Siehe [[Protokoll]]', 8, 17).text, 'Siehe Protokoll');
    part('Verweise mit Nummer: Vorschau und Export zeigen den Titel, unbekannte Nummer offen; Knopf [[ ]] setzt den Cursor hinein');
  }
}

// ============================================================
/* Vorlagen (v2.5.0) ohne Browser: Platzhalter in mehreren Sprachen, Bereinigen einer Notiz, Dateiformat hin und zurück, Anlegen und
   Einfügen über das Backend (mit Unternotizen und Tags), Werkzeuge für Agenten mit und ohne Vorlagen. */
async function runTemplates(browser, part, step) {
  const sandbox = { console };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const f of ['packages/core/i18n.js', 'lang/en.js', 'packages/core/history.js', 'packages/core/dates.js', 'packages/core/questions.js', 'packages/core/tasks.js',
    'packages/core/links.js', 'packages/core/backend.js', 'packages/core/merge.js', 'packages/core/templates.js', 'packages/data/db.js',
    'packages/store-local/backend-local.js', 'packages/agent/catalog.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  const T = sandbox.NoNotesTemplates;
  const json = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const now = new Date(2026, 9, 20, 9, 5); // Dienstag, KW 43 (fill erkennt das Datum auch aus einem anderen Kontext)
  const fill = (s, extra) => T.fill(s, Object.assign({ now, template: 'Sitzung', area: 'Arbeit', me: '@anna1234' }, extra));

  // ---------- Platzhalter ----------
  assert.equal(fill('{{datum}} {{datum+7}} {{datum-1}} {{ zeit }} {{woche}} {{jahr}} {{vorlage}} {{bereich}} {{ich}}'), '20.10.2026 27.10.2026 19.10.2026 09:05 43 2026 Sitzung Arbeit @anna1234');
  assert.equal(fill('{{date+7}} {{time}} {{week}} {{template}} {{me}} {{DATUM}}'), '27.10.2026 09:05 43 Sitzung @anna1234 20.10.2026', 'englische Namen (aus dem Sprachpaket), Gross-/Kleinschreibung egal');
  assert.equal(fill('{{unbekannt}} {{zeit+1}} {{datum}}x'), '{{unbekannt}} {{zeit+1}} 20.10.2026x', 'Unbekanntes und Versatz ohne Datum bleiben stehen');
  assert.equal(fill('{{wochentag}}'), 'Dienstag');
  assert.equal(fill('{{ich}}', { me: '' }), '', 'ohne Person leer');
  assert.deepEqual(json(T.placeholders({ now })).map(p => p.name), ['datum', 'zeit', 'wochentag', 'woche', 'jahr', 'vorlage', 'bereich', 'ich']);
  sandbox.NoNotesI18n.setLanguage('en');
  assert.deepEqual(json(T.placeholders({ now })).map(p => p.name), ['date', 'time', 'weekday', 'week', 'year', 'template', 'area', 'me'], 'Namen in der Sprache der Oberfläche');
  assert.equal(fill('{{datum}}/{{date}}'), '20.10.2026/20.10.2026', 'deutsche Namen gelten auch bei englischer Oberfläche');
  assert.equal(fill('{{date+2:yyyy-mm-dd}} {{datum:long}}'), '2026-10-22 20 October 2026', 'Stil in der Sprache der Oberfläche');
  assert.deepEqual(json(T.dateFormats({ now })).map(f => [f.text, f.example]), [['{{date:dd.mm.yyyy}}', '20.10.2026'], ['{{date+7:yyyy-mm-dd}}', '2026-10-27'], ['{{date:long}}', '20 October 2026']]);
  sandbox.NoNotesI18n.setLanguage('de');
  part('Platzhalter: Datum mit Versatz, Zeit, Woche, Vorlage, Bereich, ich; Namen übersetzbar und in jeder Sprache erkannt');

  // ---------- Formate für das Datum (v2.5.1) ----------
  assert.equal(fill('{{datum+2:yyyy-mm-dd}} {{datum:dd.mm.yyyy}} {{datum:TT.MM.JJJJ}} {{ datum - 1 : JJJJ-MM-TT }}'), '2026-10-22 20.10.2026 20.10.2026 2026-10-19', 'Kürzel englisch und deutsch, Abstände egal');
  const march = new Date(2026, 2, 5);
  assert.equal(fill('{{datum:T.M.JJ}} {{datum:TT.MM.JJJJ}} {{datum:d/m/yyyy}} {{datum:YYYY-MM-DD}} {{datum}}', { now: march }), '5.3.26 05.03.2026 5/3/2026 2026-03-05 5.3.2026', 'mit und ohne führende Null, gross oder klein');
  assert.match(fill('{{datum:TTTT, T. MMMM JJJJ}} | {{datum:TTT T. MMM}}'), /^Dienstag, 20\. Oktober 2026 \| Di\.? 20\. Okt\.?$/, 'Wochentag und Monat ausgeschrieben und kurz (der Punkt je nach ICU)');
  assert.equal(fill("{{datum:JJJJ'W'MM}} {{datum:'Tag' T}} {{datum:TT''MM}}"), "2026W10 Tag 20 20'10", "Text in '…' bleibt, '' ist ein Hochkomma");
  assert.equal(fill('{{datum:kurz}} | {{datum:mittel}} | {{datum:lang}} | {{datum:voll}} | {{datum:iso}} | {{datum+7:ISO}}'), '20.10.26 | 20.10.2026 | 20. Oktober 2026 | Dienstag, 20. Oktober 2026 | 2026-10-20 | 2026-10-27', 'Stile über Intl.DateTimeFormat');
  assert.equal(fill('{{datum:lang}}', { locale: 'fr-CH' }), '20 octobre 2026', 'Sprache aus dem Kontext');
  assert.equal(fill('{{datum:}} {{zeit:hh.mm}} {{ich:x}} {{unbekannt:x}} {{datum:x}}'), '20.10.2026 {{zeit:hh.mm}} {{ich:x}} {{unbekannt:x}} x', 'leeres Format: übliche Schreibweise; Format an anderen Platzhaltern lässt sie stehen; ohne Kürzel bleibt der Text');
  assert.equal(fill('- [ ] Offerte >{{datum+7:JJJJ-MM-TT}}'), '- [ ] Offerte >2026-10-27', 'als Termin');
  assert.equal(T.formatDate(new Date(2026, 0, 2), 'TTT, TT.MM.', 'en-GB'), 'Fri, 02.01.', 'formatDate einzeln, Namen in der angegebenen Sprache');
  part('Datumsformate: Kürzel deutsch und englisch, führende Nullen, Wochentag und Monat, Text in Hochkommas, Stile, Sprache, Fehlfälle');

  // ---------- Aus Notizen ----------
  const nodes = [
    { depth: 2, title: 'Sitzung 20.10.2026', tags: ['sitzung'], body: '- [x] Protokoll genehmigt\n? Budget? >15.11.2026\n! 20k\n![Bild](att:3)\nText ![b](att:4) mehr\n```\n! bleibt im Code\n- [x] auch\n```' },
    { depth: 3, title: 'Beschlüsse', tags: [], body: '?! Variante? @anna\n!! 20.10.2026: B' },
    { depth: 4, title: 'Details', tags: ['x'], body: 'am 2026-10-20, nicht am 2026-10-21' },
    { depth: 3, title: 'Pendenzen', tags: [], body: '- [ ] {{ich}} bis {{datum+7}}' },
  ];
  let r = json(T.fromNotes(nodes, { description: 'Für Sitzungen', stripDates: true, todayToPlaceholder: true, today: now }));
  assert.equal(r.images, 2, 'Bilder aus der Datei gezählt und weggelassen');
  assert.deepEqual(r.template.notes.map(n => [n.depth, n.title]), [[0, 'Sitzung {{datum}}'], [1, 'Beschlüsse'], [2, 'Details'], [1, 'Pendenzen']]);
  assert.equal(r.template.notes[0].body, '- [ ] Protokoll genehmigt\n? Budget?\nText mehr\n```\n! bleibt im Code\n- [x] auch\n```', 'Antworten weg, Aufgaben offen, Termin weg, Code unverändert');
  assert.equal(r.template.notes[1].body, '?! Variante? @anna');
  assert.equal(r.template.notes[2].body, 'am {{datum:JJJJ-MM-TT}}, nicht am 2026-10-21', 'ISO bleibt ISO');
  const fromDay = (body, day) => json(T.fromNotes([{ depth: 0, title: 'X', tags: [], body }], { todayToPlaceholder: true, today: day })).template.notes[0].body;
  assert.equal(fromDay('5.3.2026 05.03.2026 05.3.2026 5.03.2026 2026-03-05 15.03.2026', march), "{{datum}} {{datum:TT.MM.JJJJ}} {{datum:TT.M.JJJJ}} {{datum:T.MM.JJJJ}} {{datum:JJJJ-MM-TT}} 15.03.2026", 'heutiges Datum in derselben Schreibweise');
  assert.equal(fill(fromDay('05.3.2026 2026-03-05', march), { now: march }), '05.3.2026 2026-03-05', 'und zurück');
  sandbox.NoNotesI18n.setLanguage('en');
  assert.equal(fromDay('05.03.2026, 2026-03-05', march), '{{date:dd.mm.yyyy}}, {{date:yyyy-mm-dd}}', 'Namen und Kürzel in der Sprache der Oberfläche');
  sandbox.NoNotesI18n.setLanguage('de');
  assert.equal(r.template.name, 'Sitzung {{datum}}');
  r = json(T.fromNotes(nodes, { name: 'Nur oben', children: false, stripAnswers: false, reopenTasks: false }));
  assert.equal(r.template.notes.length, 1);
  assert.match(r.template.notes[0].body, /^- \[x\] Protokoll genehmigt\n\? Budget\? >15\.11\.2026\n! 20k/, 'ohne Bereinigen bleibt alles');
  assert.throws(() => T.fromNotes([], {}), e => e.code === 'TEMPLATE_EMPTY');
  const one = body => json(T.fromNotes([{ depth: 0, title: 'X', tags: [], body }], {})).template.notes[0].body;
  assert.equal(one('?!``` Block\n- [x] Im Block\n?! Unter\n!! Ja\n```\n!! Antwort des Blocks\n- [x] Danach'), '?!``` Block\n- [ ] Im Block\n?! Unter\n```\n- [ ] Danach', 'das "```" eines Blocks öffnet keinen Code: seine Antwort fällt weg (v2.6.0)');
  assert.equal(one('- ?!``` In der Liste\n  Text\n  ```\n  !! Antwort\n- [x] Danach'), '- ?!``` In der Liste\n  Text\n  ```\n- [ ] Danach', 'auch als Listenpunkt');
  part('Aus Notizen: Unternotizen mit relativer Tiefe, Antworten weg, Aufgaben offen, Termine weg, heutiges Datum als Platzhalter, Bilder weg, Code bleibt');

  // ---------- Datei ----------
  const tpl = json(T.fromNotes(nodes, { name: 'Sitzung', description: 'Mit "Anführung" --> und <b>' })).template;
  tpl.notes[1].title = 'Titel mit --> drin';
  const md = T.toMarkdown(tpl);
  assert.match(md, /^---\nnonotes: 1\nname: "Sitzung"\ndescription: "Mit \\"Anführung\\" --\\u003e und \\u003cb\\u003e"\ntitle: "Sitzung 20.10.2026"\ntags: \["sitzung"\]\n---\n/);
  assert.ok(md.includes('<!-- nonotes:note {"depth":1,"title":"Titel mit --\\u003e drin","tags":[]} -->\n'), 'Kommentar kann nicht vorzeitig enden');
  assert.deepEqual(json(T.parse(md, 'x.md')), tpl, 'hin und zurück gleich');
  assert.deepEqual(json(T.parse('# Plan\nText', 'Mein Plan.md')), { name: 'Mein Plan', description: '', notes: [{ depth: 0, title: 'Mein Plan', tags: [], body: '# Plan\nText' }] }, 'ohne Kopf: aus dem Dateinamen');
  const jump = json(T.parse('---\ntitle: A\ntags: a, b\n---\nx\n<!-- nonotes:note {"depth":3,"title":"Zu tief"} -->\ny\n<!-- nonotes:note {kaputt} -->\nz', 'j.md'));
  assert.deepEqual(jump.notes.map(n => [n.depth, n.title, n.tags]), [[0, 'A', ['a', 'b']], [1, 'Zu tief', []]], 'Tiefe nie mehr als eine Stufe tiefer; kaputter Kommentar bleibt Text');
  assert.equal(jump.notes[1].body, 'y\n<!-- nonotes:note {kaputt} -->\nz');
  assert.equal(T.fileName('a/b:c*?"<>|  d'), 'a b c d.md');
  assert.equal(T.fileName('...'), 'Vorlage.md');
  part('Dateiformat: Kopf in JSON-Schreibweise, Unternotizen als Kommentar, hin und zurück gleich, Datei ohne Kopf, sichere Dateinamen');

  // ---------- Anlegen und Einfügen über das Backend ----------
  const SQL = await initSqlJs();
  const db = sandbox.NoNotesDB.open(SQL, null);
  const B = sandbox.NoNotesBackendLocal.create({ getDb: () => db, onChange: () => {} });
  const parent = await B.createNote(null);
  await B.updateNote(parent, 'Projekt', 'Hier: ', {});
  const sitz = T.parse(fs.readFileSync(path.join(ROOT, 'templates', 'Sitzungsprotokoll.md'), 'utf8'), 'Sitzungsprotokoll.md');
  const id = await T.apply(B, sitz, parent, { now, me: '@anna1234' }, { author: 'Test' });
  const tree = json(await B.getTree());
  const byId = new Map(tree.map(n => [n.id, n]));
  assert.equal(byId.get(id).parent_id, parent);
  assert.equal(byId.get(id).title, 'Sitzung 20.10.2026');
  assert.deepEqual(tree.filter(n => n.parent_id === id).map(n => n.title), ['Entscheide', 'Offene Fragen'], 'Unternotizen in ihrer Reihenfolge');
  assert.deepEqual(json(await B.getTags(id)), ['sitzung']);
  const created = json(await B.getNote(id));
  assert.ok(created.body.includes('**Protokoll:** @anna1234') && created.body.includes('- [ ] … >27.10.2026') && created.body.includes('**Datum:** Dienstag, 20. Oktober 2026, 09:05'), created.body);
  assert.equal(json(await B.listTasks({ status: 'open' })).find(tk => tk.note_id === id).due, '2026-10-27', 'Termin aus {{datum+7}} zählt');
  const deep = { name: 'Tief', notes: [{ depth: 0, title: 'A', tags: [], body: 'Oben' }, { depth: 1, title: 'B', tags: [], body: '' }, { depth: 2, title: 'C', tags: [], body: '' }, { depth: 1, title: 'D', tags: [], body: '' }] };
  const ins = await T.insert(B, deep, parent, 'Hier: X', 6, { now }, {});
  assert.equal(ins.body, 'Hier: \nOben\nX', 'Text an der Stelle, mit Zeilenumbrüchen davor und danach');
  assert.equal(ins.caret, 'Hier: \nOben'.length);
  const t2 = json(await B.getTree());
  assert.deepEqual(t2.filter(n => n.parent_id === parent).map(n => n.title), ['Sitzung 20.10.2026', 'B', 'D'], 'Unternotizen der Vorlage unter der Notiz');
  assert.equal(t2.find(n => n.title === 'C').parent_id, t2.find(n => n.title === 'B').id);
  await assert.rejects(T.apply(B, { name: 'Leer', notes: [] }, null, {}), e => e.code === 'TEMPLATE_EMPTY');
  part('Anlegen: oberste Notiz unter der gewählten, Unternotizen nach Tiefe, Tags, Platzhalter, Termin zählt; Einfügen an der Cursorstelle mit Unternotizen');

  // ---------- Agenten ----------
  const store = new Map([['sitz', sitz], ['tief', deep]]);
  const provider = {
    list: async () => [...store.entries()].map(([k, v]) => ({ id: k, name: v.name, description: v.description || '', notes: v.notes.length })),
    get: async k => { if (!store.has(k)) throw Object.assign(new Error('weg'), { code: 'TEMPLATE_NOT_FOUND' }); return store.get(k); },
    context: () => ({ area: 'Arbeit' }),
  };
  const cat = sandbox.NoNotesAgent.create(B, { author: 'Agent-Test', templates: provider, templateContext: () => ({ now, me: '@agent' }) });
  assert.ok(cat.list().some(x => x.name === 'list_templates') && cat.list().some(x => x.name === 'create_note_from_template'));
  let res = await cat.call('list_templates', {});
  assert.ok(!res.isError);
  assert.match(res.content[0].text, /^\[t sitz\] "Sitzungsprotokoll" — Sitzung mit Traktanden.* — 3 notes\n\[t tief\] "Tief" — 4 notes$/);
  res = await cat.call('create_note_from_template', { template_id: 'sitz', parent_id: parent, title: 'Sitzung Vorstand' });
  assert.ok(!res.isError, res.content[0].text);
  assert.match(res.content[0].text, /^Created note \[\d+\] "Sitzung Vorstand" from template "Sitzungsprotokoll" with 2 sub-notes under note \d+\.$/);
  assert.equal(json(res.structuredContent).ids.length, 3);
  assert.ok(json(await B.getNote(json(res.structuredContent).id)).body.includes('**Protokoll:** @agent'));
  res = await cat.call('create_note_from_template', { template_id: 'fehlt' });
  assert.equal(json(res.structuredContent).error.code, 'TEMPLATE_NOT_FOUND');
  res = await cat.call('create_note_from_template', { template_id: 'sitz', parent_id: 99999 });
  assert.equal(json(res.structuredContent).error.code, 'TARGET_NOT_FOUND');
  const ro = sandbox.NoNotesAgent.create(B, { readOnly: true, templates: provider });
  assert.ok(ro.list().some(x => x.name === 'list_templates') && !ro.list().some(x => x.name === 'create_note_from_template'), 'Lesemodus: nur auflisten');
  assert.ok(!sandbox.NoNotesAgent.create(B, {}).list().some(x => /template/.test(x.name)), 'ohne Vorlagen keine Werkzeuge dafür');
  part('Agenten: list_templates und create_note_from_template (Titel, Platzhalter, Unternotizen, Fehler), nur lesen im Lesemodus, ohne Vorlagen nichts');
}

async function runTables(browser, part, step) {
  globalThis.window = globalThis;
  for (const f of ['i18n.js', 'dates.js', 'questions.js', 'embeds.js', 'tables.js', 'markdown.js']) require(path.join(__dirname, '..', 'packages', 'core', f));
  const Tb = globalThis.NoNotesTables;
  const M = globalThis.NoNotesMarkdown;
  const sel = r => r.text.slice(r.selStart, r.selEnd);
  const caretLine = r => r.text.slice(0, r.selStart).split('\n').length - 1;
  const json = v => JSON.parse(JSON.stringify(v));

  // ---------- Lesen ----------
  assert.deepEqual(Tb.splitRow('| a | b \\| c |'), ['a', 'b \\| c'], '«\\|» trennt nicht');
  assert.deepEqual(Tb.splitRow('|a|b'), ['a', 'b'], 'ohne Strich am Ende');
  assert.deepEqual(Tb.splitRow('| a |  |'), ['a', ''], 'leeres letztes Feld');
  assert.ok(Tb.isDelimiter('|:---|---:| :-: |') && Tb.isDelimiter('|---|') && !Tb.isDelimiter('| a |') && !Tb.isDelimiter('---'));
  assert.deepEqual(Tb.readMeta('<!-- tabelle: {"kopfspalte":true} -->'), { kopfspalte: true });
  assert.deepEqual(Tb.readMeta('  <!-- Table: {"x":1} -->'), { x: 1 }, 'englisch und gross geschrieben');
  assert.equal(Tb.readMeta('<!-- tabelle: {kaputt} -->'), null);
  assert.equal(Tb.readMeta('<!-- tabelle: [1] -->'), null);
  let lines = ['Text', '<!-- tabelle: {"hervorheben":true} -->', '| A | B | C |', '|:--|:-:|--:|', '| 1 | 2 | 3 | 4 |', '| x |', 'danach'];
  let t = Tb.parseAt(lines, 2);
  assert.deepEqual({ start: t.start, head: t.head, end: t.end, metaLine: t.metaLine, meta: t.meta, align: t.align, rows: t.rows, cols: t.cols, header: t.header },
    { start: 1, head: 2, end: 6, metaLine: 1, meta: { hervorheben: true }, align: ['left', 'center', 'right'], rows: [['1', '2', '3'], ['x', '', '']], cols: 3, header: ['A', 'B', 'C'] },
    'Format darüber, Ausrichtung, Zeilen auf die Spaltenzahl gebracht, Ende vor der ersten Zeile ohne «|»');
  assert.equal(Tb.parseAt(['|   |   |', '|---|---|', '| 1 | 2 |'], 0).header, null, 'leere Kopfzeile: keine Titelzeile');
  assert.equal(Tb.parseAt(['| a | b |', '|---|'], 0), null, 'Trennzeile mit anderer Spaltenzahl');
  assert.equal(Tb.parseAt(['| a | b |', 'kein Strich'], 0), null);
  part('Lesen: Felder mit «\\|», Trennzeile mit Ausrichtung, Format-Zeile (deutsch und englisch), leere Kopfzeile, Zeilen auf die Spaltenzahl');

  // ---------- Einfügen und Tab/Enter ----------
  let r = Tb.insert('Text', 4, 4, 3, 3, { header: true });
  assert.equal(r.text, 'Text\n\n| Spalte 1 | Spalte 2 | Spalte 3 |\n| -------- | -------- | -------- |\n|          |          |          |\n|          |          |          |\n');
  assert.equal(sel(r), 'Spalte 1', 'erster Titel markiert');
  r = Tb.insert('vorher\n\nnachher', 7, 7, 2, 2, { header: false, headerColumn: true, label: n => 'Col ' + n });
  assert.equal(r.text, 'vorher\n\n<!-- tabelle: {"kopfspalte":true} -->\n|     |     |\n| --- | --- |\n|     |     |\n|     |     |\n\nnachher', 'ohne Titelzeile: leerer Kopf, Titelspalte im Format');
  assert.equal(r.selStart, r.selEnd);
  assert.equal(caretLine(r), 5, 'Cursor im ersten Feld');
  r = Tb.insert('', 0, 0, 1, 1, { header: true, label: n => 'Col ' + n });
  assert.equal(r.text, '| Col 1 |\n| ----- |\n', 'eine Zeile mit Titel: nur der Kopf');
  assert.equal(Tb.insert('', 0, 0, 99, 99, {}).text.split('\n')[0].split('|').length - 2, 20, 'höchstens 20 Spalten');

  let text = 'Liste:\n\n| Name | Wert |\n|---|---|\n| a | 1 |\n';
  let pos = text.indexOf('Name') + 2;
  r = Tb.move(text, pos, 1);
  assert.equal(r.text, 'Liste:\n\n| Name | Wert |\n| ---- | ---- |\n| a    | 1    |\n', 'Tab richtet die Striche aus');
  assert.equal(sel(r), 'Wert');
  r = Tb.move(r.text, r.selStart, 1);
  assert.equal(sel(r), 'a', 'über die Trennzeile in die erste Zeile');
  r = Tb.move(r.text, r.selStart, -1);
  assert.equal(sel(r), 'Wert', 'Umschalt+Tab zurück');
  r = Tb.move(r.text, r.text.indexOf('1    |'), 1);
  assert.equal(r.text, 'Liste:\n\n| Name | Wert |\n| ---- | ---- |\n| a    | 1    |\n|      |      |\n', 'hinter dem letzten Feld eine neue Zeile');
  assert.equal(caretLine(r), 5);
  r = Tb.move(r.text, r.text.indexOf('| Name') + 2, -1);
  assert.equal(sel(r), 'Name', 'vor dem ersten Feld bleibt der Cursor im ersten');
  // Breite nach dem Tippen: längerer Inhalt verbreitert die Spalte
  text = '| Name | Wert |\n| ---- | ---- |\n| Bodensee | 1 |';
  r = Tb.move(text, text.indexOf('Bodensee') + 8, 1);
  assert.equal(r.text, '| Name     | Wert |\n| -------- | ---- |\n| Bodensee | 1    |');
  assert.equal(sel(r), '1');
  // ohne Titelzeile wird der leere Kopf übersprungen
  text = '|     |     |\n| --- | --- |\n| a   | b   |';
  r = Tb.move(text, text.indexOf('b') + 1, -1);
  assert.equal(sel(r), 'a');
  r = Tb.move(r.text, r.selStart, -1);
  assert.equal(sel(r), 'a', 'nicht in den leeren Kopf');
  assert.equal(Tb.move('kein | Tisch', 3, 1), null, 'ausserhalb einer Tabelle nichts');

  text = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\nText';
  r = Tb.enter(text, text.indexOf('2'));
  assert.equal(r.text, '| A   | B   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n| 3   | 4   |\nText', 'Enter: neue Zeile darunter');
  assert.equal(caretLine(r), 3);
  r = Tb.enter(text, 2);
  assert.equal(r.text.split('\n')[2], '|     |     |', 'Enter im Kopf: neue erste Zeile');
  text = '| A | B |\n|---|---|\n| 1 | 2 |\n|   |   |\nText';
  r = Tb.enter(text, text.indexOf('|   |   |') + 2);
  assert.equal(r.text, '| A   | B   |\n| --- | --- |\n| 1   | 2   |\n\n\n\nText', 'Enter in der leeren letzten Zeile: Tabelle endet, Leerzeilen um die Zeile des Cursors');
  assert.equal(caretLine(r), 4);
  text = '| A | B |\n|---|---|\n| 1 | 2 |\n|   |   |\n\n\n\n\nText';
  r = Tb.enter(text, text.indexOf('|   |   |') + 2);
  assert.equal(r.text, '| A   | B   |\n| --- | --- |\n| 1   | 2   |\n\n\n\n\nText', 'vorhandene Leerzeilen genügen');
  assert.equal(caretLine(r), 4);
  for (const end of ['', '\n', '\n\n']) {
    text = '| A | B |\n|---|---|\n| 1 | 2 |\n|   |   |' + end;
    r = Tb.enter(text, text.indexOf('|   |   |') + 2);
    assert.equal(r.text, '| A   | B   |\n| --- | --- |\n| 1   | 2   |\n\n', `am Ende des Texts (${JSON.stringify(end)}): eine Leerzeile, dann der Cursor`);
    assert.equal(r.selStart, r.text.length);
  }
  part('Einfügen (mit und ohne Titelzeile, Titelspalte, Grenzen) und Editor: Tab und Umschalt+Tab mit Ausrichten, neue Zeile am Ende, Enter fügt an oder beendet');

  // ---------- Codeblöcke, Entscheidblöcke, mehrere Tabellen ----------
  text = '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```';
  assert.equal(Tb.at(text, text.indexOf('1')), null, 'im Codeblock nur Text');
  assert.equal(Tb.move(text, text.indexOf('1'), 1), null);
  text = '~~~~md\n```\n| a | b |\n~~~~\n| a | b |\n|---|---|\n| 1 | 2 |';
  assert.ok(Tb.at(text, text.lastIndexOf('1')), 'nach dem Codeblock wieder eine Tabelle (Zaun mit ~~~~, darin ```)');
  text = '?!``` Varianten\n| a | b |\n|---|---|\n| 1 | 2 |\n```';
  assert.equal(Tb.at(text, text.indexOf('1')).row, 0, 'im Entscheidblock gilt die Tabelle');
  text = '| a |\n|---|\n| 1 |\n| b |\n|---|\n| 2 |';
  const a2 = Tb.at(text, text.lastIndexOf('2'));
  assert.equal(a2, null, 'eine zweite Trennzeile beendet die erste Tabelle; ohne Kopf darüber keine zweite');
  text = '| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |';
  assert.equal(Tb.at(text, text.lastIndexOf('2')).t.head, 4, 'zwei Tabellen mit Leerzeile');
  part('Codeblöcke (``` und ~~~) sind keine Tabellen, Entscheidblöcke schon; mehrere Tabellen hintereinander');

  // ---------- Schritte am Kopf ----------
  text = 'Intro\n| A | B |\n|---|--:|\n| 1 | 2 |\nEnde';
  r = Tb.setMeta(text, 1, m => { m.kopfspalte = true; }, text.length);
  assert.equal(r.text, 'Intro\n<!-- tabelle: {"kopfspalte":true} -->\n| A   | B   |\n| --- | --: |\n| 1   | 2   |\nEnde', 'Format-Zeile entsteht, Ausrichtung bleibt');
  assert.equal(r.selStart, r.text.length, 'Cursor hinter der Tabelle wandert mit');
  r = Tb.setMeta(r.text, 2, m => { m.hervorheben = true; m.plugin = { breite: { 0: 'schmal' } }; });
  assert.deepEqual(Tb.readMeta(r.text.split('\n')[1]), { kopfspalte: true, hervorheben: true, plugin: { breite: { 0: 'schmal' } } });
  r = Tb.setMeta(r.text, 2, m => ({ kopfspalte: false, hervorheben: null }));
  assert.equal(r.text, 'Intro\n| A   | B   |\n| --- | --: |\n| 1   | 2   |\nEnde', 'leeres Format: die Zeile verschwindet');
  assert.equal(Tb.setMeta(r.text, 0, m => { m.x = 1; }), null, 'keine Tabelle in dieser Zeile');
  r = Tb.toggleHeader(r.text, 1, null);
  assert.equal(r.text, 'Intro\n|     |     |\n| --- | --: |\n| A   | B   |\n| 1   | 2   |\nEnde', 'Titelzeile aus: der Kopf wird zur ersten Zeile');
  r = Tb.toggleHeader(r.text, 1, null);
  assert.equal(r.text.split('\n')[1], '| A   | B   |', 'und wieder ein');
  r = Tb.toggleHeader('|   |   |\n|---|---|', 0, n => 'Col ' + n);
  assert.equal(r.text, '| Col 1 | Col 2 |\n| ----- | ----- |', 'ohne Zeilen: Spaltentitel');
  text = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
  r = Tb.insertRow(text, 0, 0, 'above');
  assert.deepEqual(r.text.split('\n').slice(2).map(l => Tb.splitRow(l)), [['', ''], ['1', '2'], ['3', '4']]);
  assert.equal(caretLine(r), 2);
  r = Tb.insertRow(text, 0, 1, 'below');
  assert.deepEqual(r.text.split('\n').slice(2).map(l => Tb.splitRow(l)), [['1', '2'], ['3', '4'], ['', '']]);
  r = Tb.insertRow(text, 0, -1, 'below');
  assert.deepEqual(Tb.splitRow(r.text.split('\n')[2]), ['', ''], 'unter dem Kopf: erste Zeile');
  r = Tb.deleteRow(text, 0, 0);
  assert.deepEqual(r.text.split('\n').slice(2).map(l => Tb.splitRow(l)), [['3', '4']]);
  r = Tb.insertColumn(text, 0, 0, 'right', n => 'Spalte ' + n);
  assert.deepEqual(Tb.splitRow(r.text.split('\n')[0]), ['A', 'Spalte 2', 'B']);
  assert.equal(sel(r), '', 'Cursor am Anfang des neuen Titels');
  assert.equal(r.text.slice(r.selStart, r.selStart + 8), 'Spalte 2');
  r = Tb.insertColumn('|   |   |\n|---|---|\n| 1 | 2 |', 0, 0, 'left', n => 'X');
  assert.deepEqual(Tb.splitRow(r.text.split('\n')[2]), ['', '1', '2'], 'ohne Titelzeile bleibt der Kopf leer');
  assert.equal(r.text.split('\n')[0].replace(/[|\s]/g, ''), '');
  r = Tb.deleteColumn(text, 0, 1);
  assert.equal(r.text, '| A   |\n| --- |\n| 1   |\n| 3   |');
  assert.equal(Tb.deleteColumn(r.text, 0, 0).text, r.text, 'die letzte Spalte bleibt');
  r = Tb.setMeta('x\n<!-- tabelle: {"a":1} -->\n| A |\n|---|', 1, m => { m.b = 2; });
  assert.equal(r.text, 'x\n<!-- tabelle: {"a":1,"b":2} -->\n| A   |\n| --- |', 'über die Format-Zeile angesprochen');
  assert.ok(Tb.tableAtLine(r.text, 1) && Tb.tableAtLine(r.text, 2), 'Format-Zeile oder Kopf');

  // Angaben der Erweiterungen je Zeile, Spalte und Feld wandern mit
  const fm = { kopfspalte: true, 'tab-x': { rows: { h: 'H', 0: 'A', 1: 'B', 2: 'C' }, cols: { 0: 'x', 1: 'y' }, cells: { 'h,1': 'hc', '0,0': 'a0', '1,1': 'b1', '2,0': 'c0', frei: 1 }, other: 5 }, 'tab-y': 'kein Objekt' };
  text = `<!-- tabelle: ${JSON.stringify(fm)} -->\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |`;
  const metaOf = res => Tb.readMeta(res.text.split('\n')[0]);
  const mine = res => { const m = metaOf(res); assert.equal(m.kopfspalte, true); assert.equal(m['tab-y'], 'kein Objekt'); assert.equal(m['tab-x'].other, 5); return m['tab-x']; };
  let x = mine(Tb.insertRow(text, 0, 0, 'below'));
  assert.deepEqual([x.rows, x.cells], [{ h: 'H', 0: 'A', 2: 'B', 3: 'C' }, { 'h,1': 'hc', '0,0': 'a0', '2,1': 'b1', '3,0': 'c0', frei: 1 }], 'Zeile eingefügt');
  x = mine(Tb.deleteRow(text, 0, 1));
  assert.deepEqual([x.rows, x.cells], [{ h: 'H', 0: 'A', 1: 'C' }, { 'h,1': 'hc', '0,0': 'a0', '1,0': 'c0', frei: 1 }], 'Zeile gelöscht: ihre Angaben fallen weg');
  x = mine(Tb.insertColumn(text, 0, 0, 'left', null));
  assert.deepEqual([x.cols, x.cells, x.rows.h], [{ 1: 'x', 2: 'y' }, { 'h,2': 'hc', '0,1': 'a0', '1,2': 'b1', '2,1': 'c0', frei: 1 }, 'H'], 'Spalte eingefügt');
  x = mine(Tb.deleteColumn(text, 0, 0));
  assert.deepEqual([x.cols, x.cells], [{ 0: 'y' }, { 'h,0': 'hc', '1,0': 'b1', frei: 1 }], 'Spalte gelöscht');
  r = Tb.toggleHeader(text, 0, null);
  x = mine(r);
  assert.deepEqual([x.rows, x.cells], [{ 0: 'H', 1: 'A', 2: 'B', 3: 'C' }, { '0,1': 'hc', '1,0': 'a0', '2,1': 'b1', '3,0': 'c0', frei: 1 }], 'Titelzeile aus: «h» wird Zeile 0');
  x = mine(Tb.toggleHeader(r.text, 0, null));
  assert.deepEqual([x.rows, x.cells], [fm['tab-x'].rows, fm['tab-x'].cells], 'und wieder an: wie vorher');
  x = mine(Tb.enter(text, text.indexOf('| 1 |') + 2));
  assert.deepEqual(x.rows, { h: 'H', 0: 'A', 2: 'B', 3: 'C' }, 'Enter fügt eine Zeile ein');
  r = Tb.enter(text + '\n|   |   |', text.length + 3);
  assert.deepEqual(mine(r).rows, fm['tab-x'].rows, 'Enter in der leeren letzten Zeile: die übrigen bleiben');
  part('Rechtsklick-Schritte: Format setzen und entfernen (Cursor wandert mit), Titelzeile aus und ein, Zeilen und Spalten einfügen und löschen; Angaben der Erweiterungen wandern mit');

  // ---------- Vorschau ----------
  text = 'Vorher\n\n<!-- tabelle: {"kopfspalte":true,"hervorheben":true} -->\n| Name | Wert \\| Einheit | Mitte |\n|---|--:|:-:|\n| **a** | 1 | x |\n| b | [[Ziel]] | y |\n\nNachher';
  let html = M.render(text, { lineMap: true });
  assert.ok(html.includes('<table class="md-table md-table-col md-table-mark" data-line="2" data-src="2">'), 'data-src: erste Zeile der Tabelle (die Format-Zeile)');
  assert.ok(html.includes('<thead><tr><th scope="col" data-col="0">Name</th><th scope="col" data-col="1" style="text-align: right">Wert | Einheit</th>'), 'Kopf mit Ausrichtung, «\\|» als Strich');
  assert.ok(html.includes('<tr data-row="0"><th scope="row" data-col="0"><strong>a</strong></th><td data-col="1" style="text-align: right">1</td><td data-col="2" style="text-align: center">x</td></tr>'), 'Titelspalte als th, Markdown in Feldern');
  assert.ok(!html.includes('tabelle:'), 'Format-Zeile unsichtbar');
  assert.match(html, /<p data-line="0">Vorher<\/p>\n<table/);
  assert.match(html, /<\/table>\n<p data-line="8">Nachher<\/p>/);
  html = M.render('|   |   |\n|---|---|\n| 1 | 2 |', {});
  assert.ok(html.includes('class="md-table md-table-nohead"') && !html.includes('<thead>'), 'ohne Titelzeile kein thead');
  assert.ok(html.includes('data-src="0"'));
  assert.ok(!M.render('```\n| a |\n|---|\n```', {}).includes('<table'), 'im Code keine Tabelle');
  assert.ok(!M.render('> | a |\n> |---|\n> | 1 |', {}).includes('data-src'), 'im Zitat ohne Quellzeile (kein Rechtsklick)');
  assert.ok(M.render('> | a |\n> |---|\n> | 1 |', {}).includes('<table class="md-table"'), 'aber als Tabelle');
  assert.ok(!M.render('?!``` T\n| a |\n|---|\n| 1 |\n```', {}).includes('data-src'), 'im Block ohne Quellzeile');
  assert.ok(!M.render('| a |\n|---|', { tableSrc: false }).includes('data-src'), 'tableSrc: false (Druck)');
  assert.ok(M.render('<!-- tabelle: {"x":1} -->\nkein Tisch', {}).includes('&lt;!-- tabelle'), 'Format-Zeile ohne Tabelle bleibt Text');
  assert.ok(M.render('Text\n| a |\n|---|\n| 1 |', {}).includes('<p>Text</p>\n<table'), 'Tabelle direkt nach einem Absatz');
  part('Vorschau: Titelzeile als thead, Titelspalte als th, Hervorheben, Ausrichtung, Markdown und «\\|» in Feldern, Quellzeile nur oben, Code, Zitat, Block');

  // ---------- Angaben von Erweiterungen ----------
  const seen = [];
  html = M.render('<!-- tabelle: {"tf":{"b":{"0":"20%"}}} -->\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', {
    tableFormat: info => {
      seen.push(info);
      return [
        { table: { class: 'tf-x', width: '100%' }, header: { class: 'tf-h', background: '#eef' }, columns: { 0: { width: info.meta.tf.b[0], class: 'tf-c0' } },
          rows: { 1: { height: '40px', class: 'tf-r1', background: '#ffe' } }, cells: { '1,1': { background: '#fdd', fontWeight: 'bold' }, 'h,1': { color: 'red' } } },
        { columns: { 1: { background: 'url(javascript:alert(1))', color: 'expression(alert(1))', onclick: 'x', 'text-align': 'center' } }, cells: { '0,0': { class: 'ok bad"class <x>' } } },
        null, 'Unsinn',
      ];
    },
  });
  assert.deepEqual(json(seen), [{ line: 0, meta: { tf: { b: { 0: '20%' } } }, header: true, headerColumn: false, cols: 2, rows: 2, cells: { header: ['A', 'B'], rows: [['1', '2'], ['3', '4']] } }]);
  assert.ok(html.includes('<table class="md-table tf-x" style="width: 100%" data-src="0">'), html);
  assert.ok(html.includes('<thead><tr class="tf-h"><th scope="col" data-col="0" class="tf-c0" style="width: 20%; background: #eef">A</th><th scope="col" data-col="1" style="text-align: center; background: #eef; color: red">B</th></tr></thead>'), 'Kopf: Klasse am tr, Werte an jedem Feld');
  assert.ok(html.includes('<tr data-row="1" class="tf-r1"><td data-col="0" class="tf-c0" style="width: 20%; height: 40px; background: #ffe">3</td><td data-col="1" style="text-align: center; height: 40px; background: #ffe; background: #fdd; font-weight: bold">4</td></tr>'), 'Spalte, Zeile, Feld in dieser Reihenfolge');
  assert.ok(html.includes('<td data-col="0" class="tf-c0 ok" style="width: 20%">1</td>'), 'nur gültige Klassennamen');
  assert.ok(!/javascript|expression|onclick|url\(/.test(html), 'gefährliche Werte und Eigenschaften fallen weg');
  html = M.render('| A |\n|---|\n| 1 |', { tableFormat: () => { throw new Error('kaputt'); } });
  assert.ok(html.includes('<table class="md-table" data-src="0">'), 'Fehler der Erweiterung: Tabelle ohne Angaben');
  part('Angaben von Erweiterungen: Tabelle, Kopf, Spalten, Zeilen, Felder (Reihenfolge), Format aus der Datei, Klassen und Werte geprüft, Fehler schaden nicht');
}

/* v2.11.0: Personen an Aufgaben (auch geerbt), Aufgaben, Fragen und Entscheide in Tabellenfeldern, Zeilenumbruch im Feld,
   Index (Schema 16, Regeln 3), Abhaken nach slot, Antwort ins Feld, Vorschau, Agenten, Abschnitte unter der Mindmap im Export. */
async function runCellsPeople(browser, part, step) {
  const sandbox = { console };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const f of ['packages/core/i18n.js', 'packages/core/history.js', 'packages/core/dates.js', 'packages/core/questions.js', 'packages/core/tables.js',
    'packages/core/tasks.js', 'packages/core/links.js', 'packages/core/backend.js', 'packages/core/merge.js', 'packages/core/embeds.js', 'packages/core/markdown.js',
    'packages/core/export.js', 'packages/data/db.js', 'packages/store-local/backend-local.js', 'packages/agent/catalog.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  const SQL = await initSqlJs();
  const { NoNotesDB: DB, NoNotesQuestions: Q, NoNotesTasks: T, NoNotesTables: Tb, NoNotesMarkdown: M, NoNotesExport: X } = sandbox;
  const json = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const cols = (d, t) => d.exec(`PRAGMA table_info(${t})`)[0].values.map(r => r[1]);

  // ---------- Personen an Aufgaben ----------
  const LIST = [
    '- [ ] Offerte einholen @anna (@ben) >15.11.2026', // 0
    '  - [ ] Preise vergleichen',                      // 1: erbt anna und ben
    '    - [ ] Tabelle machen',                        // 2: erbt (über 1) von 0
    '  - [x] Lieferant fragen @cem',                   // 3: eigene Person
    '- [ ] Ohne Person',                               // 4
    '- [ ] Mail an anna@example.ch schicken',          // 5: keine Mailadresse als Person
  ].join('\n');
  const tp = json(T.parse(LIST));
  assert.deepEqual(tp.map(x => [x.text, x.parent, x.people.map(p => (p.inherited ? '~' : '') + (p.optional ? '(' + p.handle + ')' : p.handle)).join(' ')]), [
    ['Offerte einholen @anna (@ben)', -1, 'anna (ben)'],
    ['Preise vergleichen', 0, '~anna ~(ben)'],
    ['Tabelle machen', 1, '~anna ~(ben)'],
    ['Lieferant fragen @cem', 0, 'cem'],
    ['Ohne Person', -1, ''],
    ['Mail an anna@example.ch schicken', -1, ''],
  ]);
  assert.equal(tp[0].due, '2026-11-15', 'Termin bleibt Termin, @anna ist eine Person');
  part('Personen an Aufgaben: @ verantwortlich, (@) beteiligt, Unteraufgaben erben (über mehrere Ebenen), eigene Person geht vor, keine Mailadressen');

  // ---------- Tabellenfelder ----------
  const TABLE = [
    'Plan',                                                                                  // 0
    '',                                                                                      // 1
    '| Thema | Aufgaben | Klärung |',                                                        // 2
    '|---|---|---|',                                                                         // 3
    '| Lieferant | [ ] Offerten @anna >20.11.2026<br>[x] Liste erstellt | ?! Wer liefert? @ben<br>!! 14.10.2026: Müller |', // 4
    '| Budget | [ ] Antrag schreiben (@cem) | ? Reicht 5000?<br>? Wer zahlt? |',            // 5
    '| Text | nur Text<br>zweite Zeile | |',                                                // 6
    '',                                                                                      // 7
    '```',                                                                                   // 8
    '| [ ] im Code | ? im Code |',                                                           // 9
    '|---|---|',                                                                             // 10
    '| [ ] auch nicht | x |',                                                                // 11
    '```',                                                                                   // 12
    '- [ ] Danach @dora',                                                                    // 13
  ].join('\n');
  const ct = json(T.parse(TABLE));
  assert.deepEqual(ct.map(x => [x.text, x.lineIndex, x.slot == null ? null : x.slot, x.done, x.due, x.people.map(p => p.handle).join(' ')]), [
    ['Offerten @anna', 4, 0, false, '2026-11-20', 'anna'],
    ['Liste erstellt', 4, 1, true, null, ''],
    ['Antrag schreiben (@cem)', 5, 0, false, null, 'cem'],
    ['Danach @dora', 13, null, false, null, 'dora'],
  ], 'Aufgaben in Feldern mit slot, nicht in Code, danach geht es weiter');
  const cq = json(Q.parse(TABLE));
  assert.deepEqual(cq.map(x => [x.kind, x.text, x.lineIndex, x.answer, x.decided, x.people.map(p => p.handle).join(' '), x.cell && x.cell.index]), [
    ['decision', 'Wer liefert? @ben', 4, 'Müller', '2026-10-14', 'ben', 2],
    ['question', 'Reicht 5000?', 5, null, null, '', 2],
    ['question', 'Wer zahlt?', 5, null, null, '', 2],
  ], 'Fragen und Entscheide in Feldern, Antwort im selben Feld');
  // abhaken nach slot, nur das richtige Kästchen
  let b = T.setDone(TABLE, 4, true, 0);
  assert.equal(b.split('\n')[4], '| Lieferant | [x] Offerten @anna >20.11.2026<br>[x] Liste erstellt | ?! Wer liefert? @ben<br>!! 14.10.2026: Müller |');
  b = T.reopen(b, 4, 1);
  assert.equal(b.split('\n')[4], '| Lieferant | [x] Offerten @anna >20.11.2026<br>[ ] Liste erstellt | ?! Wer liefert? @ben<br>!! 14.10.2026: Müller |');
  assert.equal(T.openSubtasks(TABLE, 4, 0), 0, 'keine Unteraufgaben in Feldern');
  assert.equal(T.doubleClick(TABLE, 5, 0).body.split('\n')[5], '| Budget | [x] Antrag schreiben (@cem) | ? Reicht 5000?<br>? Wer zahlt? |');
  // Antwort ins Feld, Tabelle neu ausgerichtet
  b = Q.writeAnswer(TABLE, cq[2], 'Die Firma | nicht wir');
  assert.ok(b.split('\n')[5].includes('? Reicht 5000?<br>? Wer zahlt?<br>! Die Firma \\| nicht wir'), b.split('\n')[5]);
  assert.equal(new Set(b.split('\n').slice(2, 7).map(l => l.length)).size, 1, 'alle Zeilen der Tabelle gleich lang (ausgerichtet)');
  assert.equal(json(Q.parse(b)).find(x => x.text === 'Wer zahlt?').answer, 'Die Firma | nicht wir', '«\\|» als «|» im Index');
  b = Q.writeAnswer(b, json(Q.parse(b)).find(x => x.text === 'Wer liefert? @ben'), 'Meier', { decided: '15.10.2026' });
  assert.ok(b.includes('?! Wer liefert? @ben<br>!! 15.10.2026: Meier'), 'Entscheid ersetzt, mit Datum');
  b = Q.writeAnswer(b, json(Q.parse(b)).find(x => x.text === 'Wer zahlt?'), '');
  assert.ok(b.includes('? Reicht 5000?<br>? Wer zahlt? '), 'leere Antwort entfernt die Antwort-Teile');
  part('Tabellenfelder: Aufgaben mit slot (nicht in Code), Fragen und Entscheide mit Antwort im Feld; abhaken trifft das richtige Kästchen; Antwort ins Feld mit «\\|», ausgerichtet');

  // ---------- Editor ----------
  let text = '| A | B |\n|---|---|\n| eins | zwei |';
  let r = Tb.lineBreak(text, text.indexOf('eins') + 2);
  assert.equal(r.text.split('\n')[2], '| ei<br>ns | zwei |', r.text);
  assert.equal(r.text.slice(r.selStart, r.selStart + 2), 'ns', 'Cursor hinter «<br>»');
  r = Tb.togglePrefix(text, text.indexOf('zwei') + 1, 'task');
  assert.ok(r.text.includes('| [ ] zwei |'));
  r = Tb.togglePrefix(r.text, r.selStart, 'question');
  assert.ok(r.text.includes('| ? zwei |'), 'ein anderes Zeichen wird ersetzt');
  r = Tb.togglePrefix(r.text, r.selStart, 'answer');
  assert.ok(r.text.includes('| ? zwei<br>!  |'), 'Antwort hängt einen Teil an (der Cursor steht nach «! »)');
  assert.equal(r.text.slice(r.selStart - 2, r.selStart), '! ');
  r = Tb.togglePrefix(r.text, r.text.indexOf('? zwei') + 3, 'question');
  assert.ok(/\| zwei<br>! +\|/.test(r.text), 'zweimal Frage: wieder Text');
  assert.equal(Tb.togglePrefix(text, 3, 'task'), null, 'in der Titelzeile nicht');
  assert.equal(Tb.togglePrefix('Text', 2, 'task'), null);
  part('Editor: Umschalt+Enter setzt «<br>», Aufgabe, Frage, Entscheid und Antwort wirken auf den Teil des Felds');

  // ---------- Vorschau ----------
  let html = M.render(TABLE, { interactiveTasks: true, lineMap: true });
  assert.ok(html.includes('<span class="md-cell-task task" data-line="4" data-slot="0"><input type="checkbox" aria-label="offen"><span class="task-text">Offerten <span class="md-person" data-handle="anna">@anna</span></span><span class="md-due due '), html);
  assert.ok(html.includes('<span class="md-cell-task task done" data-line="4" data-slot="1"><input type="checkbox" checked aria-label="erledigt">'));
  assert.ok(html.includes('<span class="md-cell-q md-decision answered"><span class="md-mark" aria-hidden="true">✓</span> Wer liefert? <span class="md-person" data-handle="ben">@ben</span></span><br><span class="md-cell-a">14.10.2026: Müller</span>'));
  assert.ok(html.includes('<td data-col="1">nur Text<br>zweite Zeile</td>'), '<br> als Zeilenumbruch');
  assert.ok(!html.includes('data-slot="0"><input type="checkbox" aria-label="offen"><span class="task-text">im Code'), 'Code bleibt Code');
  html = M.render(TABLE, { interactiveTasks: true, tableSrc: false });
  assert.ok(html.includes('<span class="md-cell-task task"><input type="checkbox" disabled aria-label="offen">'), 'ohne Quellzeile (Druck): Kästchen gesperrt, ohne data-line');
  html = M.render(LIST, { interactiveTasks: true });
  assert.ok(html.includes('Offerte einholen <span class="md-person" data-handle="anna">@anna</span> <span class="md-person optional" data-handle="ben" title="optional">@ben</span>'), 'Personen in Aufgaben als Marke');
  assert.ok(M.render('| <b>x</b> |\n|---|\n| <br/>a<BR>b |', {}).includes('<td data-col="0"><br>a<br>b</td>'), 'nur <br> wird zum Umbruch, anderes HTML bleibt Text');
  part('Vorschau: Kästchen mit Zeile und slot, Personen und Termine in Feldern, Entscheid mit Antwort, <br> als Umbruch, Druck ohne Quellzeile, Personen in Listen');

  // ---------- Index (Schema 16, Regeln 3) ----------
  const d = DB.open(SQL, null);
  assert.equal(DB.getMeta(d, 'schema_version'), SCHEMA_VERSION);
  assert.equal(DB.getMeta(d, 'index_rules'), '3');
  assert.ok(cols(d, 'tasks').includes('people'), 'Spalte people in tasks');
  const n1 = DB.createNote(d, null);
  DB.updateNote(d, n1, 'Liste', LIST);
  const n2 = DB.createNote(d, null);
  DB.updateNote(d, n2, 'Tabelle', TABLE);
  const anna = json(DB.listTasks(d, { status: 'all', person: '@Anna' }));
  assert.deepEqual(anna.map(x => x.text).sort(), ['Offerte einholen @anna (@ben)', 'Offerten @anna', 'Preise vergleichen', 'Tabelle machen'].sort(), 'Filter: auch geerbt, ohne @, ohne Gross/klein');
  assert.deepEqual(json(DB.listTasks(d, { status: 'all', person: 'ben' })).map(x => x.text).sort(), ['Offerte einholen @anna (@ben)', 'Preise vergleichen', 'Tabelle machen'].sort(), 'beteiligt zählt auch');
  assert.deepEqual(json(DB.listTasks(d, { status: 'all', person: 'an' })), [], 'nur ganze Kürzel');
  const one = anna.find(x => x.text === 'Preise vergleichen');
  assert.deepEqual(one.people, [{ handle: 'anna', optional: false, inherited: true }, { handle: 'ben', optional: true, inherited: true }]);
  const byPerson = json(DB.listTasks(d, { status: 'open', sort: 'person' })).map(x => x.text);
  assert.deepEqual(byPerson.slice(0, 4).sort(), ['Offerte einholen @anna (@ben)', 'Offerten @anna', 'Preise vergleichen', 'Tabelle machen'].sort(), 'nach Person: zuerst anna');
  assert.deepEqual(byPerson.slice(4, 6), ['Antrag schreiben (@cem)', 'Danach @dora'], 'dann cem und dora');
  assert.deepEqual(byPerson.slice(6).sort(), ['Mail an anna@example.ch schicken', 'Ohne Person'], 'ohne Person am Schluss');
  assert.deepEqual(json(DB.listPeople(d)), ['anna', 'ben', 'cem', 'dora']);
  assert.deepEqual(json(DB.listPeople(d, { of: 'questions' })), ['ben']);
  assert.deepEqual(json(DB.listPeople(d, { of: 'tasks' })), ['anna', 'ben', 'cem', 'dora']);
  assert.deepEqual(json(DB.getTask(d, anna[0].id)).people.length > 0, true, 'getTask liefert people als Liste');
  // abhaken über den Index: Aufgabe im Feld
  const cellTask = json(DB.listTasks(d, { status: 'all' })).find(x => x.text === 'Liste erstellt');
  DB.setTaskDone(d, cellTask.id, false);
  assert.ok(DB.getNote(d, n2).body.split('\n')[4].includes('[ ] Liste erstellt'), 'reopen im Feld');
  assert.ok(DB.getNote(d, n2).body.split('\n')[4].includes('[ ] Offerten'), 'das andere Kästchen bleibt');
  DB.setTaskDone(d, cellTask.id, true);
  assert.ok(DB.getNote(d, n2).body.split('\n')[4].includes('[x] Liste erstellt'));
  // Antwort aus der Liste ins Feld
  const q = json(DB.listQuestions(d, { status: 'open' })).find(x => x.text === 'Reicht 5000?');
  DB.answerQuestion(d, q.id, 'Ja');
  assert.ok(DB.getNote(d, n2).body.includes('? Reicht 5000?<br>! Ja<br>? Wer zahlt?'), DB.getNote(d, n2).body);
  assert.equal(json(DB.getQuestion(d, q.id)).answer, 'Ja');
  part('Index (Schema 16, Regeln 3): Personen an Aufgaben, Filter auch geerbt und ganze Kürzel, nach Person, Personen nach Art; Feld-Aufgabe abhaken, Antwort ins Feld');

  // ---------- Ältere Dateien: Schema 15 wird angeglichen und neu indexiert ----------
  const old = DB.open(SQL, null);
  const on = DB.createNote(old, null);
  DB.updateNote(old, on, 'Alt', LIST + '\n\n' + TABLE);
  old.run("ALTER TABLE tasks DROP COLUMN people; DELETE FROM tasks; UPDATE meta SET value = '15' WHERE key = 'schema_version'; UPDATE meta SET value = '2' WHERE key = 'index_rules'");
  const re = DB.open(SQL, old.export());
  assert.equal(DB.getMeta(re, 'schema_version'), SCHEMA_VERSION);
  assert.equal(DB.getMeta(re, 'index_rules'), '3');
  assert.equal(json(DB.listTasks(re, { status: 'all', person: 'anna' })).length, 4, 'Personen und Feld-Aufgaben nach dem Öffnen im Index');
  part('Ältere Dateien (Schema 15): Spalte people dazu, Indexe neu gefüllt');

  // ---------- Agenten ----------
  const backend = sandbox.NoNotesBackendLocal.create({ getDb: () => d, onChange: () => {} });
  const cat = sandbox.NoNotesAgent.create(backend, { author: 'Agent' });
  let res = await cat.call('list_tasks', { person: 'anna', status: 'all' });
  assert.ok(!res.isError, res.content[0].text);
  assert.match(res.content[0].text, /Preise vergleichen — assigned via parent task: @anna, @ben/);
  assert.deepEqual(json(res.structuredContent).items.find(x => x.text === 'Offerten @anna').people, [{ handle: 'anna', optional: false, inherited: false }]);
  res = await cat.call('list_people', {});
  assert.match(res.content[0].text, /@anna, @ben, @cem, @dora/);
  part('Agenten: list_tasks mit person und Personen (geerbt im Text), list_people mit Aufgaben');

  // ---------- Export: Abschnitte unter der Mindmap ----------
  const files = await X.buildFiles(backend, { mode: 'folder', version: 'test', sections: [{ title: 'Legende', markdown: '- Rot: dringend\n- Blau: wartet' }] });
  const index = files.find(f => f.path === 'index.md').data;
  assert.match(index, /!\[Mindmap\]\(mindmap\.svg\)\n\n## Legende\n\n- Rot: dringend\n- Blau: wartet\n\n## Inhalt/);
  const single = await X.buildFiles(backend, { mode: 'single', version: 'test', sections: [{ title: '', markdown: 'Nur Text' }] });
  assert.match(single.find(f => f.path.endsWith('.md')).data, /!\[Mindmap\]\(mindmap\.svg\)\n\nNur Text\n\n## Inhalt/);
  part('Export: Abschnitte der Erweiterungen direkt unter dem Mindmap-Bild (Ordner und eine Datei)');
}

// ============================================================
/* Release-Notizen (ab v2.12.0): Prüfung des Ordners docs/releases/<Version>/ (Titel, Kurzfassung, «Was ist neu» mit Beschreibung und
   Screenshot je Neuerung, Update-Pfad mit Sicherung, Bilder da und klein genug, keine Platzhalter), Beschreibung für GitHub (Adressen
   im Tag, Pakete, Vergleich mit dem vorigen Release), Screenshots aus einem Drehbuch, und alle Ordner, die es im Repository gibt. */
async function runReleaseNotes(browser, part, step) {
  const RN = require(path.join(ROOT, 'tools', 'release-notes.cjs'));
  const { shoot } = require(path.join(ROOT, 'tools', 'release-shots.cjs'));
  const TOOL = path.join(ROOT, 'tools', 'release-notes.cjs');
  const base = path.join(ROOT, 'dist', 'test-releases');
  const dir = path.join(base, 'v9.9.0');
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    // Ab welcher Version, voriges Release
    assert.deepEqual(['v2.11.0', 'v2.11.9', 'v2.12.0', 'v2.12.1', 'v3.0.0', 'v10.0.0'].map(RN.required), [false, false, true, true, true, true]);
    assert.equal(spawnSync(process.execPath, [TOOL, 'required', 'v2.11.0']).status, 1);
    assert.equal(spawnSync(process.execPath, [TOOL, 'required', 'v2.12.0']).status, 0);
    assert.equal(RN.previousOf('v2.12.0', ['v2.9.0', 'v2.11.0', 'v2.10.0', 'v2.12.0', 'v2.13.0', 'dev-123']), 'v2.11.0');
    assert.equal(RN.previousOf('v2.12.0', []), null);
    part('Pflicht ab v2.12.0, voriges Release aus den bekannten Tags');

    // Die Vorlage selbst besteht nicht
    fs.copyFileSync(path.join(ROOT, 'docs', 'releases', 'VORLAGE.md'), path.join(dir, 'RELEASE.md'));
    let r = RN.check('v9.9.0', dir);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /erste Zeile/.test(e)) && r.errors.some(e => /Platzhalter übrig: .*TODO/.test(e)), r.errors.join('\n'));

    // Eine vollständige Beschreibung
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(dir, 'legende.png'), PNG);
    fs.writeFileSync(path.join(dir, 'tabelle.png'), PNG);
    const good = [
      '# NoNotes v9.9.0 – Legende und Tabellen',
      '',
      '<!-- interner Hinweis, nicht im Release -->',
      'Farben bekommen eine Bedeutung, und Tabellenfelder nehmen Aufgaben auf.',
      '',
      '## Was ist neu',
      '',
      '### Legende über der Mindmap',
      '',
      'Die Erweiterung «Farben über Tags» zeigt oben rechts eine Legende. Ein Klick darauf öffnet den Text, Esc speichert. Siehe [Erweiterungen](../../../docs/PLUGINS.md#farben).',
      '',
      '![Legende oben rechts mit drei Farben](legende.png)',
      '',
      '### Aufgaben in Tabellenfeldern',
      '',
      'In einem Feld steht `[ ] Text @anna` als Aufgabe mit Kästchen; mehrere Teile trennt `<br>`. `![nicht ersetzen](im-code.png)` bleibt Code.',
      '',
      '![Tabelle mit Aufgaben und Personen](tabelle.png)',
      '',
      '### Schnittstelle für Erweiterungen',
      '',
      '<!-- ohne Bild: nur Programmierschnittstelle -->',
      'Neue Aufrufe ctx.ui.addMapButton und ctx.export.addMapSection für eigene Knöpfe und Abschnitte unter der Mindmap im Export.',
      '',
      '## Update von v9.8.0',
      '',
      '1. Sichern: Datenbank → Kopie herunterladen.',
      '2. Neue Version entpacken und öffnen.',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'RELEASE.md'), good);
    r = RN.check('v9.9.0', dir);
    assert.deepEqual(r.errors, []);
    assert.equal(r.title, 'NoNotes v9.9.0 – Legende und Tabellen');
    const cli = spawnSync(process.execPath, [TOOL, 'check', 'v9.9.0', '--dir', dir], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    part('Prüfung: die Vorlage fällt durch, eine vollständige Beschreibung besteht');

    // Was fehlt, wird genannt
    const bad = (edit, re, msg) => {
      fs.writeFileSync(path.join(dir, 'RELEASE.md'), edit(good));
      const res = RN.check('v9.9.0', dir);
      assert.ok(!res.ok && res.errors.some(e => re.test(e)), `${msg}: ${res.errors.join(' | ')}`);
    };
    bad(t => t.replace('v9.9.0 –', 'v9.8.0 –'), /nennt v9\.8\.0/, 'falsche Version im Titel');
    bad(t => t.replace('Farben bekommen eine Bedeutung, und Tabellenfelder nehmen Aufgaben auf.', ''), /Kurzfassung/, 'ohne Kurzfassung');
    bad(t => t.replace('## Was ist neu', '## Neu'), /Was ist neu/, 'ohne «Was ist neu»');
    bad(t => t.replace('![Tabelle mit Aufgaben und Personen](tabelle.png)', ''), /Aufgaben in Tabellenfeldern.*kein Screenshot/, 'Neuerung ohne Bild');
    bad(t => t.replace('<!-- ohne Bild: nur Programmierschnittstelle -->', ''), /Schnittstelle.*kein Screenshot/, 'ohne Begründung kein Verzicht aufs Bild');
    bad(t => t.replace(/Neue Aufrufe[^\n]*/, 'Neue Aufrufe.'), /zu knapp/, 'zu knappe Beschreibung');
    bad(t => t.replace('## Update von v9.8.0', '## Hinweise'), /Update/, 'ohne Update-Pfad');
    bad(t => t.replace('1. Sichern: Datenbank → Kopie herunterladen.', '1. Datenbank kopieren.'), /Sicherung/, 'Update ohne Sicherung');
    bad(t => t.replace('1. Sichern', '- Sichern').replace('2. Neue', '- Neue'), /nummerierte Liste/, 'Update ohne Schritte');
    bad(t => t.replace('(legende.png)', '(fehlt.png)'), /fehlt\.png fehlt/, 'fehlendes Bild');
    bad(t => t.replace('[Legende oben rechts mit drei Farben]', '[]'), /beschreibt, was zu sehen ist/, 'Bild ohne Text');
    bad(t => t + '\n\nTODO: noch schreiben', /Platzhalter übrig: «TODO»/, 'Platzhalter');
    fs.writeFileSync(path.join(dir, 'RELEASE.md'), good.replace('## Update von v9.8.0', '```markdown\n## Update im Beispiel\n1. sichern\n```\n\n## Update von v9.8.0'));
    assert.deepEqual(RN.check('v9.9.0', dir).errors, [], 'Überschriften in Codeblöcken zählen nicht als Abschnitt');
    fs.writeFileSync(path.join(dir, 'RELEASE.md'), good.replace('## Update von v9.8.0', 'Schreibweise `{{?Kunde}}` und `` `{{datum}}` ``:\n\n````markdown\n```template-description Kunde\nTODO {{?Kunde}}\n```\n## Kein Abschnitt\n````\n\n## Update von v9.8.0'));
    assert.deepEqual(RN.check('v9.9.0', dir).errors, [], 'Platzhalter und TODO in Code zählen nicht; ```` umschliesst ``` (v2.12.0)');
    bad(t => t + '\n\nOffen: {{?Kunde}}', /Platzhalter übrig: «\{\{\?Kunde\}\}»/, 'ausserhalb von Code schon');
    bad(t => t + '\n\nEine Aufgabe für @beat bis morgen.', /«@beat» ausserhalb von Code: GitHub erwähnt/, '@name erwähnt ein GitHub-Konto (v2.12.0)');
    fs.writeFileSync(path.join(dir, 'RELEASE.md'), good.replace('## Update von v9.8.0', 'Für `@beat`, `- [ ] Text @anna`, Mail an info@example.ch.\n\n## Update von v9.8.0'));
    assert.deepEqual(RN.check('v9.9.0', dir).errors, [], '@name in Code und Mailadressen sind keine Erwähnung');
    bad(t => t.replace('../../../docs/PLUGINS.md', '../../../docs/GIBTS-NICHT.md'), /zeigt ins Leere/, 'toter Verweis');
    fs.writeFileSync(path.join(dir, 'gross.png'), Buffer.alloc(1100 * 1024));
    bad(t => t + '\n\n![zu gross](gross.png)', /höchstens 1024 KB/, 'zu grosses Bild');
    fs.rmSync(path.join(dir, 'gross.png'));
    fs.writeFileSync(path.join(dir, 'uebrig.png'), PNG);
    fs.writeFileSync(path.join(dir, 'RELEASE.md'), good);
    assert.ok(RN.check('v9.9.0', dir).warnings.some(w => /uebrig\.png/.test(w)), 'nicht benutztes Bild: Hinweis');
    fs.rmSync(path.join(dir, 'uebrig.png'));
    const none = RN.check('v9.9.1', path.join(base, 'v9.9.1'));
    assert.ok(!none.ok && /RELEASE\.md fehlt/.test(none.errors[0]));
    part('Prüfung nennt: falsche Version, Kurzfassung, Abschnitte, Bild je Neuerung, Begründung, Update mit Sicherung und Schritten, Bilder, Platzhalter, Verweise, Grösse');

    // Beschreibung für GitHub
    const body = RN.render(good, { version: 'v9.9.0', dir, repo: 'CDRO/NoNotes', known: ['v9.7.0', 'v9.8.0', 'v9.9.0'] });
    assert.ok(!/^# NoNotes/m.test(body), 'ohne Titelzeile');
    assert.ok(!/interner Hinweis|ohne Bild/.test(body), 'ohne Kommentare');
    assert.ok(body.includes('![Legende oben rechts mit drei Farben](https://raw.githubusercontent.com/CDRO/NoNotes/v9.9.0/dist/test-releases/v9.9.0/legende.png)'), body);
    assert.ok(body.includes('[Erweiterungen](https://github.com/CDRO/NoNotes/blob/v9.9.0/docs/PLUGINS.md#farben)'), 'Verweis auf die Datei im Tag, mit Anker');
    assert.ok(body.includes('`![nicht ersetzen](im-code.png)`'), 'im Code bleibt alles, wie es ist');
    assert.match(body, /\*\*Pakete:\*\* `NoNotes-v9\.9\.0\.zip` .* `NoNotes-with-Plugins-v9\.9\.0\.zip`/);
    assert.ok(body.trimEnd().endsWith('**Alle Änderungen:** https://github.com/CDRO/NoNotes/compare/v9.8.0...v9.9.0'));
    const out = path.join(base, 'body.md'), titleOut = path.join(base, 'title.txt');
    const cr = spawnSync(process.execPath, [TOOL, 'render', 'v9.9.0', '--dir', dir, '--known', 'v9.8.0 v9.9.0', '--out', out, '--title-out', titleOut], { encoding: 'utf8' });
    assert.equal(cr.status, 0, cr.stderr);
    assert.equal(fs.readFileSync(titleOut, 'utf8'), 'NoNotes v9.9.0 – Legende und Tabellen\n');
    assert.ok(fs.readFileSync(out, 'utf8').includes('compare/v9.8.0...v9.9.0'));
    part('Beschreibung: ohne Titelzeile und Kommentare, Bilder und Verweise im Tag, Code unberührt, Pakete, Vergleich mit dem vorigen Release');

    // Screenshots aus einem Drehbuch (auf dem gebauten dist/NoNotes)
    const shots = path.join(base, 'v9.9.2');
    fs.mkdirSync(shots);
    fs.writeFileSync(path.join(shots, 'shots.cjs'), `module.exports = {
      date: '2026-11-02T09:00:00+01:00',
      async run(s) {
        await s.newNote('Projekt Süd');
        await s.edit('Projekt Süd', { body: '- [ ] Angebot einholen @anna >03.11.2026', mode: 'preview' });
        await s.shot('vorschau');
        await s.shot('aufgabe', { locator: '.preview li', pad: 4 });
        await s.back();
        await s.view('tasks');
        await s.shot('liste');
      },
    };`);
    const made = await shoot({ version: 'v9.9.2', dir: shots, app: DIST, plugins: [] });
    assert.deepEqual(made.map(f => path.basename(f)), ['vorschau.png', 'aufgabe.png', 'liste.png']);
    const dims = f => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    assert.deepEqual(dims(made[0]), [1280, 800], 'ganze Seite 1280 × 800');
    const [w, h] = dims(made[1]);
    assert.ok(w < 1280 && h < 200, `Ausschnitt um die Aufgabe (${w} × ${h})`);
    const only = await shoot({ version: 'v9.9.2', dir: shots, app: DIST, plugins: [], only: 'liste' });
    assert.deepEqual(only.map(f => path.basename(f)), ['liste.png'], '--only macht nur dieses Bild');
    await assert.rejects(shoot({ version: 'v9.9.3', dir: path.join(base, 'v9.9.3'), app: DIST, plugins: [] }), /shots\.cjs fehlt/);
    part('Screenshots: Drehbuch auf der gebauten App, ganze Seite und Ausschnitt, nur ein Bild, fehlendes Drehbuch');

    // Alle Ordner im Repository bestehen die Prüfung
    const releases = path.join(ROOT, 'docs', 'releases');
    const versions = fs.readdirSync(releases).filter(v => /^v\d+\.\d+\.\d+$/.test(v));
    for (const v of versions) {
      const res = RN.check(v, path.join(releases, v));
      assert.ok(res.ok, `docs/releases/${v}: ${res.errors.join(' | ')}`);
    }
    part(`Ordner im Repository: ${versions.length ? versions.join(', ') : 'noch keiner'} in Ordnung`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ============================================================
/* Pfade auf Dateien und Ordner (v2.12.0) als reine Funktionen: Erkennen, Adresse, Schreibweise zum Kopieren, Ordner, Einfügen, Grenzen. */
async function runPathsCore(browser, part, step) {
  globalThis.window = globalThis;
  for (const f of ['i18n.js', 'embeds.js', 'markdown.js']) require(path.join(__dirname, '..', 'packages', 'core', f));
  const M = window.NoNotesMarkdown;
  M.configure({ localFiles: true });
  const P = M.pathInfo;
  assert.deepEqual(P('\\\\srv01\\Projekte\\Angebot 2026.docx'), { href: 'file://srv01/Projekte/Angebot%202026.docx', path: '\\\\srv01\\Projekte\\Angebot 2026.docx', folder: false });
  assert.deepEqual(P('\\\\srv01\\Daten$\\Ablage\\'), { href: 'file://srv01/Daten$/Ablage/', path: '\\\\srv01\\Daten$\\Ablage\\', folder: true }, 'versteckte Freigabe mit $');
  assert.deepEqual(P('z:\\Team'), { href: 'file:///Z:/Team', path: 'z:\\Team', folder: true }, 'ohne Endung: Ordner');
  assert.equal(P('C:\\Ä#ö%.txt').href, 'file:///C:/%C3%84%23%C3%B6%25.txt', 'Umlaute, # und % kodiert');
  assert.deepEqual(P('file:///C:/Daten/Bericht%202026.pdf'), { href: 'file:///C:/Daten/Bericht%202026.pdf', path: 'C:\\Daten\\Bericht 2026.pdf', folder: false });
  assert.equal(P('file://srv01/Projekte/x.pdf').path, '\\\\srv01\\Projekte\\x.pdf');
  assert.equal(P('file://localhost/C:/x/y.txt').path, 'C:\\x\\y.txt');
  assert.equal(P('file:///home/anna/a b/').path, '/home/anna/a b/');
  for (const bad of ['\\\\srv01', '\\\\srv01\\', 'C:Daten', 'https://x.ch', 'C:\\a<b', '\\\\srv\\a"b', 'javascript:alert(1)']) assert.equal(P(bad), null, bad);
  part('Pfad → Adresse: Netz, Laufwerk, file://, Kodierung, Schreibweise zum Kopieren, Ordner, keine falschen Treffer');

  const html = M.inline('A \\\\srv\\x\\a.pdf, B (Z:\\T\\) C <\\\\srv\\a b\\c.docx> D [Text](<C:\\a b\\>) E `C:\\code` F a:b G x\\\\y H 12:30');
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(hrefs, ['file://srv/x/a.pdf', 'file:///Z:/T/', 'file://srv/a%20b/c.docx', 'file:///C:/a%20b/'], html);
  assert.ok(html.includes('<code>C:\\code</code>') && html.includes('x\\\\y') && html.includes('a:b'), 'Code und gewöhnlicher Text bleiben');
  assert.ok(html.includes('a.pdf</a>, B') && html.includes('T\\</a>) C'), 'Komma und Klammer nach dem Pfad bleiben Text');
  const safe = M.inline('<\\\\srv\\x" onclick="alert(1)> und \\\\srv\\y"onmouseover=1');
  assert.ok(!/<a [^>]*on\w+=/.test(safe), 'keine Attribute aus dem Pfad: ' + safe);
  M.configure({ localFiles: false });
  assert.match(M.inline('![Plan](<\\\\srv\\b\\Plan 1.png>)'), /^<a href="file:\/\/srv\/b\/Plan%201\.png" class="md-path md-path-file"[^>]*><span class="md-path-icon"[^>]*><\/span>Plan<\/a>$/, 'im Dienst: Bild als Link');
  M.configure({ localFiles: true });
  assert.match(M.inline('![Plan](<\\\\srv\\b\\Plan 1.png>)'), /^<img src="file:\/\/srv\/b\/Plan%201\.png" alt="Plan" class="md-path-img"/, 'lokal: das Bild');
  part('In der Zeile: Pfade mit und ohne Klammern, Link mit Text, Satzzeichen, Code, keine eingeschleusten Attribute, Bilder lokal und im Dienst');

  assert.equal(M.pastePaths('"C:\\Projekte\\Angebot 2026.docx"'), '<C:\\Projekte\\Angebot 2026.docx>');
  assert.equal(M.pastePaths('"\\\\srv\\a\\x.pdf"\r\n"\\\\srv\\a\\y z.pdf"'), '\\\\srv\\a\\x.pdf\n<\\\\srv\\a\\y z.pdf>', 'mehrere Dateien, je eine Zeile');
  assert.equal(M.pastePaths('C:\\a\\b.txt'), null, 'nichts zu ändern');
  assert.equal(M.pastePaths('Siehe C:\\a b'), null, 'kein reiner Pfad');
  part('Einfügen: «Als Pfad kopieren» aus dem Explorer, mehrere Dateien, sonst unverändert');
}

// ============================================================
/* Ausfüllbare Platzhalter (v2.12.0) als reine Funktionen und im Kern: Erkennen (nicht in Code), Werte für Aufgaben, Fragen, Personen und
   Termine, Vorschau, Druck und Export, Beschreibungen (sammeln, anhängen, wegräumen), Vorlagen anlegen und einfügen, Agenten. */
async function runPlaceholdersCore(browser, part, step) {
  const sandbox = { console };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const f of ['packages/core/i18n.js', 'packages/core/placeholders.js', 'packages/core/history.js', 'packages/core/dates.js', 'packages/core/questions.js',
    'packages/core/tables.js', 'packages/core/tasks.js', 'packages/core/links.js', 'packages/core/embeds.js', 'packages/core/markdown.js', 'packages/core/backend.js',
    'packages/core/merge.js', 'packages/core/templates.js', 'packages/core/zip.js', 'packages/core/export.js', 'packages/data/db.js',
    'packages/store-local/backend-local.js', 'packages/agent/catalog.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  const P = sandbox.NoNotesPlaceholders, M = sandbox.NoNotesMarkdown, T = sandbox.NoNotesTemplates;
  const json = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  // Erkennen und Werte
  const text = 'A {{?Kunde}} B {{?Kunde: Muster AG}} `{{?Code}}`\n```\n{{?Block}}\n```\n{{? }} {{?Leer: }}';
  assert.deepEqual(json(P.scan(text).map(p => [p.name, p.value])), [['Kunde', null], ['Kunde', 'Muster AG'], ['Leer', '']], 'nicht in Code, ohne Namen kein Platzhalter');
  assert.equal(P.flatten('x {{?A}} y {{?B: b}}'), 'x [A] y b');
  assert.equal(P.forPreview('@{{?Wer: anna}} {{?Ziel: frei}} [[{{?Notiz: Plan}}]] {{?Offen}}'), '@anna {{?Ziel: frei}} [[Plan]] {{?Offen}}', 'nur hängende Werte aufgelöst, offene bleiben');
  assert.equal(P.fill('{{?Kunde}} und {{?kunde: alt}} und {{?Ort}}', { KUNDE: 'Neu' }), 'Neu und Neu und {{?Ort}}', 'Gross-/Kleinschreibung egal');
  assert.equal(P.fill('{{?Kunde}}', { Kunde: 'Neu' }, { keep: true }), '{{?Kunde: Neu}}');
  assert.equal(P.resolve('{{?A: a}} {{?B}} {{?A}}', 'a'), 'a {{?B}} A');
  assert.equal(P.resolve('{{?A: a}} {{?B}}'), 'a B');
  assert.deepEqual(json(P.at('xx {{?A: aa}} yy', 6)), { name: 'A', value: 'aa', start: 3, end: 13, valueStart: 9, valueEnd: 11 });
  part('Erkennen: offen und ausgefüllt, nicht in Code; flatten, Vorschau (hängende Werte), fill, resolve, at');

  // Beschreibungen
  const withDesc = 'Text {{?A}} {{?B}}\n\n```template-description A\nfür **A**\n```\n```js\n```template-description X\n```\n```template-description B\nB eins\nB zwei\n```\n';
  const ds = P.descriptions(withDesc);
  assert.deepEqual([...ds.keys()], ['a', 'b'], 'Beschreibungen in einem anderen Codeblock zählen nicht');
  assert.equal(P.describe(ds, 'b'), 'B eins\nB zwei');
  assert.equal(P.stripDescriptions(withDesc), 'Text {{?A}} {{?B}}\n\n```js\n```template-description X\n```\n');
  const appended = P.appendDescriptions('Nur {{?B}}', ds);
  assert.equal(appended, 'Nur {{?B}}\n\n```template-description B\nB eins\nB zwei\n```\n', 'nur für vorkommende Namen');
  assert.equal(P.appendDescriptions(appended, ds), appended, 'nicht doppelt');
  assert.equal(P.pruneDescriptions(appended.replace('{{?B}}', 'fertig')), 'Nur fertig', 'ohne Platzhalter weg, samt Zeilenumbruch');
  assert.equal(P.pruneDescriptions(appended, '{{?B}}'), appended, 'der Titel zählt mit');
  assert.equal(P.plain('X {{?A: a}} {{?B}}\n\n```template-description A\nd\n```'), 'X a [B]');
  part('Beschreibungen: sammeln (nicht aus anderem Code), anhängen nur für vorkommende Namen, wegräumen ohne Platzhalter, Druck und Export');

  // Vorschau und Druck
  const html = M.render('- [ ] {{?Was: Offerte}} @{{?Wer: anna}} >{{?Bis: 31.10.2026}}\n\nZiel: {{?Ziel}}\n\n```template-description Ziel\ngeheim\n```');
  assert.ok(html.includes('<span class="md-ph" data-ph="Was"'), 'frei stehend: Platzhalter');
  assert.ok(html.includes('class="md-person" data-handle="anna"') && /md-due[^>]*>31\.10\.2026/.test(html), 'Person und Termin wirken');
  assert.ok(html.includes('<span class="md-ph open" data-ph="Ziel"') && !html.includes('geheim'), 'offen gelb, Beschreibung unsichtbar');
  const printed = M.render('Ziel: {{?Ziel}}, Wert {{?A: **fett**}}', { placeholders: 'plain' });
  assert.equal(printed, '<p>Ziel: [Ziel], Wert <strong>fett</strong></p>');
  part('Vorschau: frei stehend markiert, offen gelb, Personen und Termine wirken, Beschreibung unsichtbar; Druck nur Werte');

  // Index: Aufgaben, Fragen, Abhaken, Antworten
  const SQL = await initSqlJs();
  const db = sandbox.NoNotesDB.open(SQL, null);
  const B = sandbox.NoNotesBackendLocal.create({ getDb: () => db, onChange: () => {} });
  const id = await B.createNote(null);
  await B.updateNote(id, 'Aufgabe', '- [ ] {{?Was: Offerte}} @{{?Wer: anna}} >{{?Bis: 31.10.2026}}\n? {{?Frage: Budget?}} @{{?An: ben}}\n- [ ] {{?Offen}}', {});
  const tasks = json(await B.listTasks({ status: 'all' }));
  assert.deepEqual(tasks.map(t => [t.text, t.due, t.people.map(p => p.handle)]), [['Offerte @anna', '2026-10-31', ['anna']], ['[Offen]', null, []]]);
  const qs = json(await B.listQuestions({ status: 'all' }));
  assert.deepEqual(qs.map(q => [q.text, q.people.map(p => p.handle)]), [['Budget? @ben', ['ben']]]);
  await B.setTaskDone(tasks[0].id, true);
  assert.ok(json(await B.getNote(id)).body.startsWith('- [x] {{?Was: Offerte}} @{{?Wer: anna}}'), 'Abhaken lässt die Platzhalter stehen');
  await B.answerQuestion(qs[0].id, 'Ja', {});
  assert.ok(json(await B.getNote(id)).body.includes('? {{?Frage: Budget?}} @{{?An: ben}}\n! Ja'), 'Antwort darunter');
  part('Index: Aufgaben, Fragen, Personen und Termine aus den Werten; Abhaken und Antworten lassen die Platzhalter stehen');

  // Export
  const md = sandbox.NoNotesExport.bodyToMarkdown('X {{?A: a}} {{?B}}\n\n```template-description A\nd\n```', () => null, () => null);
  assert.equal(md.trim(), 'X a [B]');
  part('Export: Werte, offene als [Name], ohne Beschreibungen');

  // Vorlagen: Kopf, Beschreibungen an jede Notiz, die den Platzhalter hat; Einfügen hängt sie ans Ende
  const tpl = T.parse('---\nnonotes: 1\nname: "P"\ntitle: "Projekt {{?Kunde}}"\nplaceholders: "behalten"\n---\nKunde {{?Kunde}}, Termin >{{?Bis: {{datum+7}}}}\n```template-description Kunde\nFirma\n```\n```template-description Bis\nDatum\n```\n<!-- nonotes:note {"depth":1,"title":"Offerte","tags":[]} -->\nFür {{?Kunde}}\n<!-- nonotes:note {"depth":1,"title":"Leer","tags":[]} -->\nnichts', 'p.md');
  assert.equal(tpl.placeholders, 'keep', 'behalten/keep');
  assert.match(T.toMarkdown(tpl), /\nplaceholders: "keep"\n---\n/);
  const now = new Date(2026, 9, 20, 9, 5);
  const ids = await T.create(B, tpl, null, { now });
  const n0 = json(await B.getNote(ids[0])), n1 = json(await B.getNote(ids[1])), n2 = json(await B.getNote(ids[2]));
  assert.equal(n0.title, 'Projekt {{?Kunde}}');
  assert.equal(n0.body, 'Kunde {{?Kunde}}, Termin >{{?Bis: 27.10.2026}}\n\n```template-description Kunde\nFirma\n```\n```template-description Bis\nDatum\n```\n', 'automatischer Vorschlag, Beschreibungen am Ende');
  assert.equal(n1.body, 'Für {{?Kunde}}\n\n```template-description Kunde\nFirma\n```\n', 'die Unternotiz hat ihre Beschreibung');
  assert.equal(n2.body, 'nichts', 'ohne Platzhalter keine Beschreibung');
  const ins = await T.insert(B, tpl, id, 'Oben\nUnten', 5, { now });
  assert.equal(ins.body.slice(ins.start, ins.caret), 'Kunde {{?Kunde}}, Termin >{{?Bis: 27.10.2026}}', 'start und caret umfassen das Eingefügte');
  assert.ok(ins.body.endsWith('Unten\n\n```template-description Kunde\nFirma\n```\n```template-description Bis\nDatum\n```\n'), 'Beschreibungen am Ende der Notiz');
  const filled = await T.create(B, tpl, null, { now }, { values: { kunde: 'Muster AG' }, keep: true });
  assert.equal(json(await B.getNote(filled[0])).title, 'Projekt Muster AG');
  assert.ok(json(await B.getNote(filled[0])).body.startsWith('Kunde {{?Kunde: Muster AG}}, Termin'));
  part('Vorlagen: Kopf «placeholders», automatischer Vorschlag, Beschreibungen je Notiz, Einfügen mit Bereich und Beschreibungen am Ende, Werte beim Anlegen');

  // Agenten: Felder mit Beschreibung; Werte, je nach Einstellung behalten
  const store = new Map([['p', tpl], ['q', Object.assign({}, tpl, { placeholders: null })]]);
  const provider = { list: async () => [...store.entries()].map(([k, v]) => ({ id: k, name: v.name, notes: v.notes.length })), get: async k => store.get(k) };
  const cat = sandbox.NoNotesAgent.create(B, { author: 'Agent', templates: provider, templateContext: () => ({ now }) });
  let res = await cat.call('list_templates', {});
  assert.match(res.content[0].text, /fields: "Kunde": Firma; "Bis" \(default "\{\{datum\+7\}\}"\): Datum/);
  assert.deepEqual(json(res.structuredContent).items[0].fields.map(f => f.name), ['Kunde', 'Bis']);
  res = await cat.call('create_note_from_template', { template_id: 'q', values: { Kunde: 'Beta GmbH', Bis: '1.12.2026' } });
  assert.ok(!res.isError, res.content[0].text);
  let made = json(await B.getNote(json(res.structuredContent).id));
  assert.equal(made.title, 'Projekt Beta GmbH');
  assert.equal(made.body.split('\n')[0], 'Kunde Beta GmbH, Termin >1.12.2026', 'ohne Einstellung: nur die Werte');
  await B.setMeta('templates.keepPlaceholders', '1');
  res = await cat.call('create_note_from_template', { template_id: 'q', values: { Kunde: 'Gamma' } });
  made = json(await B.getNote(json(res.structuredContent).id));
  assert.equal(made.body.split('\n')[0], 'Kunde {{?Kunde: Gamma}}, Termin >{{?Bis: 27.10.2026}}', 'mit Einstellung: behalten; ohne Wert bleibt der Vorschlag');
  assert.match(sandbox.NoNotesAgent.INSTRUCTIONS, /"\{\{\?Name\}\}" is a fill-in placeholder/);
  part('Agenten: Felder mit Vorschlag und Beschreibung, Werte beim Anlegen, «behalten» aus der Einstellung, Hinweis in den Anweisungen');
}

// ============================================================
/* Termine mit «>» (v3.0.0): Schreibweise, Frist und Erinnerungen, Umstellung alter Texte (gleiche Länge, nicht in Code), Schema 17
   mit Sicherungsangaben, Umschreiben beim Speichern, Index, Kalender (VALARM), Agenten, Programm mit Sicherung, Seiten der Hauptäste. */
async function runDatesV3(browser, part, step) {
  const sandbox = { console, TextEncoder, crypto: globalThis.crypto };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const f of ['packages/core/i18n.js', 'packages/core/placeholders.js', 'packages/core/history.js', 'packages/core/dates.js', 'packages/core/questions.js',
    'packages/core/tables.js', 'packages/core/tasks.js', 'packages/core/links.js', 'packages/core/embeds.js', 'packages/core/markdown.js', 'packages/core/backend.js',
    'packages/core/merge.js', 'packages/core/templates.js', 'packages/core/ical.js', 'packages/data/db.js', 'packages/store-local/backend-local.js', 'packages/agent/catalog.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  const D = sandbox.NoNotesDates, DB = sandbox.NoNotesDB, M = sandbox.NoNotesMarkdown;
  const json = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const SQL = await initSqlJs();

  // ---------- Schreibweise ----------
  const sd = t => json(D.splitDue(t));
  assert.deepEqual(sd('Offerte einholen @anna >30.10.2026 >6.11.2026'), { text: 'Offerte einholen @anna', due: '2026-11-06', reminders: ['2026-10-30'], legacy: false });
  assert.deepEqual(sd('Offerte >6.11.2026 >30.10.2026 14:00'), { text: 'Offerte', due: '2026-11-06', reminders: ['2026-10-30T14:00'], legacy: false }, 'der späteste ist die Frist, gleich wo er steht');
  assert.deepEqual(sd('Termin >2026-11-06 14:30'), { text: 'Termin', due: '2026-11-06T14:30', reminders: [], legacy: false });
  assert.deepEqual(sd('Doppelt >6.11.2026 >06.11.2026'), { text: 'Doppelt', due: '2026-11-06', reminders: [], legacy: false }, 'gleiche Termine einmal');
  assert.deepEqual(sd('Alt @anna @6.11.2026'), { text: 'Alt @anna', due: '2026-11-06', reminders: [], legacy: true }, '@Datum gilt weiter');
  for (const t of ['a > b', 'Pfeil ->6.11.2026', 'Doppelpfeil =>6.11.2026', 'mitten >6.11.2026 im Satz', 'kein Datum >morgen']) {
    assert.equal(sd(t).due, null, `kein Termin: ${t}`);
  }
  assert.equal(D.toText('2026-11-06'), '06.11.2026');
  assert.equal(D.toText('2026-11-06T09:05'), '06.11.2026 09:05');
  assert.equal(D.nextReminder(['2026-10-20', '2026-10-30'], '2026-10-27T08:00'), '2026-10-30');
  assert.equal(D.nextReminder(['2026-10-20'], '2026-10-27T08:00'), null);
  part('Schreibweise: >Datum am Zeilenende, mehrere, der späteste ist die Frist, Uhrzeit, @Datum gilt weiter, kein Termin bei a > b, -> und mitten im Satz');

  // ---------- Umschreiben ----------
  const before = [
    '- [ ] Offerte @anna @30.10.2026 @6.11.2026 14:00',
    '? Budget? @2026-11-01',
    'Mail an anna@6.11.2026 bleibt',
    'Text @6.11.2026 mitten',
    '`- [ ] im Code @6.11.2026`',
    '```',
    '- [ ] im Block @6.11.2026',
    '```',
    '| Wer | Was |',
    '|---|---|',
    '| anna | [ ] Plan @6.11.2026<br>[ ] Liste @7.11.2026 |',
    '- [ ] Vorlage @{{datum+7}} und @{{?Bis wann: {{datum+7}}}}',
    '- [ ] Person bleibt @{{?Wer: anna}}',
    'Satz endet @6.11.2026',
  ].join('\n');
  const after = D.rewriteLegacy(before);
  assert.equal(after.length, before.length, 'gleiche Länge (die Fassungen im Verlauf passen weiter)');
  assert.deepEqual(after.split('\n'), [
    '- [ ] Offerte @anna >30.10.2026 >6.11.2026 14:00',
    '? Budget? >2026-11-01',
    'Mail an anna@6.11.2026 bleibt',
    'Text @6.11.2026 mitten',
    '`- [ ] im Code @6.11.2026`',
    '```',
    '- [ ] im Block @6.11.2026',
    '```',
    '| Wer | Was |',
    '|---|---|',
    '| anna | [ ] Plan >6.11.2026<br>[ ] Liste >7.11.2026 |',
    '- [ ] Vorlage @{{datum+7}} und >{{?Bis wann: {{datum+7}}}}',
    '- [ ] Person bleibt @{{?Wer: anna}}',
    'Satz endet >6.11.2026',
  ]);
  assert.equal(D.rewriteLegacy('- [ ] Vorlage @{{datum+7}}'), '- [ ] Vorlage >{{datum+7}}', 'automatischer Platzhalter am Ende');
  assert.equal(D.rewriteLegacy(after), after, 'ein zweites Mal ändert nichts');
  assert.ok(D.hasLegacy(before) && !D.hasLegacy(after));
  part('Umschreiben: @Datum am Zeilenende zu >Datum, auch mehrere, in Tabellenfeldern und Vorlagen; gleiche Länge; nicht in Code, nicht mitten im Text, nicht an Wörtern');

  // ---------- Umstellung einer Datei von v2.x (Schema 16) ----------
  {
    const d = DB.open(SQL, null);
    const id = DB.createNote(d, null);
    const body16 = '- [ ] Offerte @anna @30.10.2026 @6.11.2026\n? Budget? @1.11.2026 09:00\n```\n@6.11.2026\n```';
    const rewrite = D.rewriteLegacy;
    D.rewriteLegacy = x => x; // speichern wie v2.12, mit einer älteren Fassung im Verlauf
    DB.updateNote(d, id, 'Projekt', '- [ ] Erst @anna @1.11.2026');
    DB.updateNote(d, id, 'Projekt', body16, { newVersion: true });
    D.rewriteLegacy = rewrite;
    const plain = DB.createNote(d, null);
    d.run("UPDATE notes SET title = 'Ohne', body = 'nichts @ hier', updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", [plain]);
    d.exec("ALTER TABLE tasks DROP COLUMN reminders; ALTER TABLE questions DROP COLUMN reminders; ALTER TABLE notes DROP COLUMN side; UPDATE meta SET value = '16' WHERE key = 'schema_version'; DELETE FROM meta WHERE key = 'dates_migrated_at'");
    const bytes = d.export();
    const updatedBefore = d.exec('SELECT updated_at FROM notes WHERE id = ' + id)[0].values[0][0];
    d.close();
    assert.deepEqual(json(DB.inspect(SQL, bytes)), { version: 16, legacyNotes: 1 }, 'inspect zählt die Notizen mit @Datum, ohne zu ändern');
    const info = {};
    const m = DB.open(SQL, bytes, info);
    assert.deepEqual(json(info), { upgradedFrom: 16, rewritten: 1 });
    assert.equal(DB.getMeta(m, 'schema_version'), SCHEMA_VERSION);
    const note = DB.getNote(m, id);
    assert.equal(note.body, '- [ ] Offerte @anna >30.10.2026 >6.11.2026\n? Budget? >1.11.2026 09:00\n```\n@6.11.2026\n```');
    assert.equal(note.updated_at, updatedBefore, '«Geändert» bleibt');
    assert.ok(DB.getMeta(m, 'dates_migrated_at'), 'Zeitpunkt der Umstellung für den Verlauf');
    assert.equal(String(DB.getMeta(m, 'dates_migrated_notes')), '1');
    const task = json(DB.listTasks(m, { status: 'open' })).find(r => r.text.startsWith('Offerte'));
    assert.equal(task.due, '2026-11-06');
    assert.deepEqual(task.reminders, ['2026-10-30']);
    const q = json(DB.listQuestions(m, { status: 'open' }))[0];
    assert.equal(q.due, '2026-11-01T09:00');
    assert.deepEqual(q.reminders, []);
    const versions = json(DB.listHistory(m, id));
    assert.ok(versions.length >= 1, 'Verlauf bleibt');
    assert.ok(DB.getHistoryVersion(m, id, versions[0].id).body.includes('Erst @anna'), 'ältere Fassung lässt sich weiter herstellen');
    assert.equal(json(DB.inspect(SQL, DB.exportBytes(m))).version, Number(SCHEMA_VERSION));
    m.close();
  }
  part('Umstellung Schema 16 → 17 (heute 18): inspect vorher, alle @Datum zu >Datum, nicht in Code, «Geändert» und Verlauf bleiben, Zeitpunkt in meta, Index mit Frist und Erinnerungen');

  // ---------- Speichern, Index, Vorschau, Kalender ----------
  const d = DB.open(SQL, null);
  const B = sandbox.NoNotesBackendLocal.create({ getDb: () => d });
  const id = await B.createNote(null);
  await B.updateNote(id, 'Plan', '- [ ] Offerte @anna @6.11.2026 >30.10.2026\n? Lieferant? >3.11.2026 >10.11.2026 14:00', {});
  assert.equal(json(await B.getNote(id)).body, '- [ ] Offerte @anna >6.11.2026 >30.10.2026\n? Lieferant? >3.11.2026 >10.11.2026 14:00', 'Speichern schreibt @Datum still zu >Datum um');
  const tasks = json(await B.listTasks({ status: 'open' }));
  assert.deepEqual([tasks[0].due, tasks[0].reminders], ['2026-11-06', ['2026-10-30']]);
  const gt = json(await B.getTask(tasks[0].id));
  assert.deepEqual(gt.reminders, ['2026-10-30']);
  const qs = json(await B.listQuestions({ status: 'open' }));
  assert.deepEqual([qs[0].due, qs[0].reminders], ['2026-11-10T14:00', ['2026-11-03']]);
  const html = M.render(json(await B.getNote(id)).body);
  assert.equal((html.match(/md-reminder/g) || []).length, 2, 'je Erinnerung ein kleines Abzeichen');
  assert.ok(html.includes('data-date="2026-11-06"') && html.includes('data-date="2026-10-30"'), 'Abzeichen anklickbar (Datum dabei)');
  assert.ok(!html.includes('&gt;30.10.2026') && !html.includes('@6.11.2026'), 'die Termine stehen nicht als Text in der Vorschau');
  const { ics } = await sandbox.NoNotesCalendar.build(B, { dryRun: true, now: '2026-10-27T08:00:00Z' });
  const alarms = ics.split('\r\n').filter(l => l.startsWith('TRIGGER;VALUE=DATE-TIME:'));
  assert.equal(alarms.length, 2, 'je Erinnerung ein Alarm zum festen Zeitpunkt');
  assert.ok(alarms.some(l => /:20261030T\d{4}00Z$/.test(l)) && alarms.some(l => /:20261103T\d{4}00Z$/.test(l)), alarms.join(' | '));
  part('Speichern: @Datum wird >Datum; Index, Aufgabe und Frage mit Frist und Erinnerungen; Vorschau mit Abzeichen und Glocke; Kalender mit VALARM');

  // ---------- Agenten ----------
  const A = sandbox.NoNotesAgent;
  assert.match(A.INSTRUCTIONS, /after ">"/);
  assert.match(A.INSTRUCTIONS, /latest is the deadline/);
  const agent = A.create(B);
  let r = await agent.call('list_tasks', {});
  assert.deepEqual(json(r.structuredContent.items[0].reminders), ['2026-10-30']);
  assert.match(r.content[0].text, /due 2026-11-06 — reminders 2026-10-30/);
  r = await agent.call('list_questions', {});
  assert.deepEqual(json(r.structuredContent.items[0].reminders), ['2026-11-03']);
  r = await agent.call('append_to_note', { id, text: '- [ ] Von Claude @ben @1.12.2026' });
  assert.ok(!r.isError, JSON.stringify(r));
  assert.ok(json(await B.getNote(id)).body.endsWith('- [ ] Von Claude @ben >1.12.2026'), 'auch ein Agent mit alter Anleitung schreibt am Ende >Datum');
  part('Agenten: Anleitung erklärt >, Frist und Erinnerungen; list_tasks und list_questions liefern reminders; @Datum vom Agenten wird >Datum');

  // ---------- Seiten der Hauptäste in der Mindmap ----------
  const a1 = await B.createNote(null), a2 = await B.createNote(null), child = await B.createNote(a1);
  const side = async nid => json(await B.getTree({})).find(x => x.id === nid).side;
  assert.equal(await side(a1), null, 'neu ohne Seite: die Mindmap wählt sie');
  await B.setSides({ [a1]: 'left', [a2]: 'right', [id]: 'bogus' });
  assert.deepEqual([await side(a1), await side(a2), await side(id)], ['left', 'right', null]);
  await B.moveNote(child, a2, 'after');
  assert.equal(await side(child), 'right', 'neben einen Hauptast: auf seine Seite');
  await B.setParent(child, a1);
  assert.equal(await side(child), null, 'unter einer Notiz gilt keine Seite');
  await B.deleteNote(a1);
  assert.equal(await side(child), 'left', 'rückt an die Wurzel: auf die Seite des gelöschten Hauptasts');
  part('Seiten der Hauptäste: setSides, getTree, neben einen Hauptast, unter eine Notiz, nach dem Löschen des Elternknotens');

  // ---------- Programm: Sicherung vor dem ersten Schreiben einer Datei von v2.x ----------
  {
    const { spawn } = require('node:child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-v3-'));
    const file = path.join(tmp, 'Team.sqlite');
    const old = DB.open(SQL, null);
    const nid = DB.createNote(old, null);
    old.run("UPDATE notes SET title = 'Alt', body = '- [ ] Alt @1.12.2026' WHERE id = ?", [nid]);
    old.exec("ALTER TABLE notes DROP COLUMN side; UPDATE meta SET value = '16' WHERE key = 'schema_version'");
    const oldBytes = Buffer.from(old.export());
    old.close();
    fs.writeFileSync(file, oldBytes);
    const p = spawn(process.execPath, [path.join(DIST, 'agent', 'nonotes-mcp.cjs'), '--file', file], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', x => { out += x; });
    const answer = n => new Promise((resolve, reject) => {
      const t0 = Date.now();
      const look = () => {
        const line = out.split('\n').find(l => l.includes(`"id":${n}`));
        if (line) resolve(JSON.parse(line));
        else if (Date.now() - t0 > 20000) reject(new Error('keine Antwort: ' + out));
        else setTimeout(look, 30);
      };
      look();
    });
    const send = (n, method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    send(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    await answer(1);
    send(2, 'tools/call', { name: 'list_tasks', arguments: {} });
    const listed = await answer(2);
    assert.equal(listed.result.structuredContent.items[0].due, '2026-12-01', 'liest die alte Datei');
    assert.ok(!fs.existsSync(path.join(tmp, 'Team-vor-3.0.0.sqlite')), 'Lesen allein schreibt nichts');
    send(3, 'tools/call', { name: 'append_to_note', arguments: { id: nid, text: 'Neu' } });
    await answer(3);
    await new Promise(resolve => { p.on('exit', resolve); p.stdin.end(); });
    const backup = path.join(tmp, 'Team-vor-3.0.0.sqlite');
    assert.ok(fs.existsSync(backup), 'Sicherung neben der Datei');
    assert.deepEqual(fs.readFileSync(backup), oldBytes, 'die Sicherung ist der alte Stand');
    const now = new SQL.Database(fs.readFileSync(file));
    assert.equal(now.exec("SELECT value FROM meta WHERE key = 'schema_version'")[0].values[0][0], SCHEMA_VERSION);
    assert.equal(now.exec('SELECT body FROM notes WHERE id = ' + nid)[0].values[0][0], '- [ ] Alt >1.12.2026\nNeu');
    now.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  part('Programm: eine Datei von v2.x wird gelesen; vor dem ersten Schreiben liegt der alte Stand als …-vor-3.0.0.sqlite daneben');
}

async function runNodeLinks(browser, part, step) {
  const sandbox = { console };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const f of ['packages/core/i18n.js', 'packages/core/history.js', 'packages/core/dates.js', 'packages/core/questions.js', 'packages/core/tasks.js',
    'packages/core/links.js', 'packages/core/backend.js', 'packages/core/merge.js', 'packages/core/move.js', 'packages/data/db.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  const SQL = await require(path.join(ROOT, 'vendor', 'sql.js', 'sql-asm.js'))();
  const DB = sandbox.NoNotesDB;
  const Move = sandbox.NoNotesMove;
  const Links = sandbox.NoNotesLinks;
  const json = v => JSON.parse(JSON.stringify(v));

  // ---------- Link am Knoten (Schema 18) ----------
  {
    const old = new SQL.Database();
    old.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, parent_id INTEGER, sort_order INTEGER NOT NULL DEFAULT 0, collapsed INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, archived_at TEXT,
      updated_by TEXT, side TEXT); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '17'); INSERT INTO notes (title, created_at, updated_at) VALUES ('Alt', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');`);
    const info = {};
    const db = DB.open(SQL, old.export(), info);
    assert.equal(info.upgradedFrom, 17);
    assert.equal(DB.getMeta(db, 'schema_version'), SCHEMA_VERSION);
    assert.equal(DB.getTree(db)[0].link, null, 'Spalte link kommt dazu, leer');
    const ok = {
      'https://example.ch/a?b=1': 'https://example.ch/a?b=1', 'www.example.ch': 'https://www.example.ch', 'mailto:anna@example.ch': 'mailto:anna@example.ch',
      '\\\\server\\Projekte\\Angebot 2026.docx': '\\\\server\\Projekte\\Angebot 2026.docx', 'C:\\Daten\\Plan.xlsx': 'C:\\Daten\\Plan.xlsx',
      'file:///C:/Daten/': 'file:///C:/Daten/', '#w=projekt': '#w=projekt', '/w/abc123/42-plan': '/w/abc123/42-plan', '  https://x.ch  ': 'https://x.ch',
    };
    for (const [input, want] of Object.entries(ok)) assert.equal(DB.setNoteLink(db, 1, input), want, input);
    assert.equal(DB.getNote(db, 1).link, 'https://x.ch');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x', '//evil.example', 'nur text', 'https://a b', 'https://x\nhttps://y', 'x'.repeat(2001)]) {
      assert.throws(() => DB.setNoteLink(db, 1, bad), e => e.code === 'INVALID_LINK', bad);
    }
    assert.equal(DB.setNoteLink(db, 1, ''), null, 'leer entfernt den Link');
    assert.equal(DB.getNote(db, 1).link, null);
    DB.archiveNote(db, 1);
    assert.throws(() => DB.setNoteLink(db, 1, 'https://x.ch'), e => e.code === 'ARCHIVED_READONLY');
    assert.throws(() => DB.setNoteLink(db, 99, 'https://x.ch'), e => e.code === 'NOTE_NOT_FOUND');
    assert.ok(sandbox.NoNotesBackend.METHODS.includes('setNoteLink') && sandbox.NoNotesBackend.MUTATING.has('setNoteLink'));
    db.close();
  }
  part('Link am Knoten: Schema 17 → 18 (Spalte link), erlaubte Ziele (Web, www., mailto, Pfade, Bereich, Notiz), abgelehnte (javascript:, data:, //…, Leerzeichen, zu lang), leer entfernt, Archiv schreibgeschützt');

  // ---------- Texte umschreiben (NoNotesMove) ----------
  {
    const notes = new Map([[3, 1], [4, 2]]);
    const atts = new Map([[7, 1]]);
    const titles = Links.resolver([['budget', 10], ['heizung', 3], ['offerte', 4], ['projekt', 2]]);
    const parse = url => { const m = /^#(?:w=([^&]+)&)?n=(\d+)/.exec(url) || /^#w=([^&]+)$/.exec(url); if (!m) return null; return m[2] ? { note: Number(m[2]), area: m[1] && m[1] !== 'alt' ? m[1] : null } : { note: null, area: m[1] }; };
    const o = { notes, atts, resolve: titles, parse, source: (id, l) => `#w=alt&n=${id}`, target: (id, l) => `#w=neu&n=${id}` };
    const moved = 'Kosten [[Budget]], Teil [[Heizung]] und [[Offerte#4*]], offen [[Gibts nicht]].\n![Plan](att:7) ![Fremd](att:9)\n[Link](#n=10) und [hier](#w=alt&n=3) und [anderswo](#w=x&n=3)\n`[[Budget]]` im Code\n```\n[[Budget]]\n```';
    assert.equal(Move.rewriteMoved(moved, o),
      'Kosten [Budget](#w=alt&n=10), Teil [[Heizung]] und [[Offerte#2*]], offen [[Gibts nicht]].\n![Plan](att:1) ![Fremd](att:9)\n[Link](#w=alt&n=10) und [hier](#w=neu&n=1) und [anderswo](#w=x&n=3)\n`[[Budget]]` im Code\n```\n[[Budget]]\n```');
    assert.equal(Move.rewriteStaying('Siehe [[Heizung]], [[Budget]] und [Offerte](#n=4), Bereich #w=neu', o),
      'Siehe [Heizung](#w=neu&n=1), [[Budget]] und [Offerte](#w=neu&n=2), Bereich #w=neu');
    assert.equal(Move.rewriteMoved('[[Titel [x]]]', o), '[[Titel [x]]]', 'Klammern im Text stören nicht');
    assert.equal(Move.rewriteStaying('?!```\nEntscheid zu [[Heizung]]\n```', o), '?!```\nEntscheid zu [Heizung](#w=neu&n=1)\n```', 'ein Entscheid-Block ist kein Code');
    assert.equal(Move.rewriteLink('#n=4', o, false), '#w=neu&n=2', 'Link am Knoten auf eine mitgenommene Notiz');
    assert.equal(Move.rewriteLink('#n=10', o, true), '#w=alt&n=10', 'aus dem neuen Bereich zurück in den alten');
    assert.equal(Move.rewriteLink('https://example.ch', o, true), 'https://example.ch');
  }
  part('Umschreiben beim Auslösen: [[…]] bleibt, wenn das Ziel mitgeht (Nummer neu), sonst Link in den anderen Bereich; Bilder att:…, Links auf Notizen, Code bleibt');

  // ---------- Auslösen zwischen zwei Datenbanken ----------
  {
    const src = DB.open(SQL, null);
    const mk = (parent, title, body) => { const id = DB.createNote(src, parent); DB.updateNote(src, id, title, body || ''); return id; };
    const budget = mk(null, 'Budget', 'Siehe [[Heizung]].');
    const proj = mk(null, 'Projekt', 'Eigener Text bleibt\n- [ ] Aufgabe des Knotens');
    const heiz = mk(proj, 'Heizung', 'Kosten [[Budget]]\n- [ ] Offerte einholen @anna >30.10.2026\n? Reicht die Leistung?');
    const off = mk(heiz, 'Offerte', 'Erste Fassung');
    DB.updateNote(src, off, 'Offerte', 'Zweite Fassung mit [[Heizung]]', { newVersion: true });
    const att = DB.addAttachment(src, off, { name: 'plan.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    DB.updateNote(src, off, 'Offerte', `Zweite Fassung mit [[Heizung]] ![Plan](att:${att})`, { newVersion: true });
    DB.setTags(src, heiz, ['farbe:rot', 'wichtig']);
    const alt = mk(heiz, 'Alt', 'archiviert');
    DB.archiveNote(src, alt);
    const geloescht = mk(heiz, 'Weg', 'im Papierkorb');
    DB.deleteNote(src, geloescht);
    DB.setNoteLink(src, off, 'https://example.ch/offerte');

    const pkg = DB.exportSubtree(src, proj);
    assert.deepEqual(json(pkg.notes.map(n => [n.title, n.parent_id])), [['Heizung', null], ['Offerte', heiz], ['Alt', heiz]], 'Tiefensuche, ohne Papierkorb, mit Archiv; Kinder des Knotens werden Hauptäste');
    const resolve = Links.resolver(pkg.titles);
    const parse = url => { const m = /^#(?:w=([^&]+)&)?n=(\d+)/.exec(url); return m ? { note: Number(m[2]), area: m[1] && m[1] !== 'alt' ? m[1] : null } : null; };
    const opts = maps => ({ notes: maps.notes, atts: maps.atts, resolve, parse, source: id => `#w=alt&n=${id}`, target: id => `#w=neu&n=${id}` });
    const dst = DB.open(SQL, null);
    DB.setMapTitle(dst, 'Projekt');
    const res = DB.importSubtree(dst, pkg, (kind, v, maps) => (kind === 'body' ? Move.rewriteMoved(v, opts(maps)) : Move.rewriteLink(v, opts(maps), true)));
    const map = new Map(res.notes);
    const tree = json(DB.getTree(dst, { archive: true }));
    assert.deepEqual(tree.map(r => [r.title, r.parent_id == null ? null : tree.find(x => x.id === r.parent_id).title, !!r.archived_at]).sort(),
      [['Alt', 'Heizung', true], ['Heizung', null, false], ['Offerte', 'Heizung', false]], 'Hauptast Heizung, darunter Offerte und das archivierte Alt');
    const heizNeu = map.get(heiz), offNeu = map.get(off);
    assert.equal(DB.getNote(dst, heizNeu).body.split('\n')[0], 'Kosten [Budget](#w=alt&n=' + budget + ')', 'Verweis auf eine Notiz, die bleibt, wird zum Link');
    assert.equal(DB.getNote(dst, offNeu).body, `Zweite Fassung mit [[Heizung]] ![Plan](att:${new Map(res.atts).get(att)})`);
    assert.equal(DB.getNote(dst, offNeu).link, 'https://example.ch/offerte', 'der Link am Knoten zieht mit');
    assert.deepEqual(json(DB.getTags(dst, heizNeu)), ['farbe:rot', 'wichtig']);
    assert.deepEqual(json(DB.getAttachment(dst, new Map(res.atts).get(att)).data), json(new Uint8Array([1, 2, 3])));
    assert.deepEqual(json(DB.listTasks(dst, { status: 'all' })).map(t => t.text), ['Offerte einholen @anna']);
    assert.deepEqual(json(DB.listQuestions(dst, {})).map(q => q.text), ['Reicht die Leistung?']);
    const versions = json(DB.listHistory(dst, offNeu));
    assert.ok(versions.length >= 2, 'Verlauf zieht mit');
    assert.equal(DB.getHistoryVersion(dst, offNeu, versions[versions.length - 1].id).body, 'Erste Fassung', 'die älteste Fassung lässt sich weiter herstellen');
    assert.equal(DB.getNote(dst, offNeu).created_at, DB.getNote(src, off).created_at, '«Erstellt» bleibt');

    const moved = DB.finishDetach(src, proj, pkg, '#w=neu', (kind, v) => (kind === 'body' ? Move.rewriteStaying(v, opts({ notes: map, atts: new Map() })) : Move.rewriteLink(v, opts({ notes: map, atts: new Map() }), false)));
    assert.equal(moved, 3);
    assert.deepEqual(json(DB.getTree(src)).map(r => [r.title, r.link]), [['Budget', null], ['Projekt', '#w=neu']], 'hier bleibt der Knoten mit dem Link');
    assert.equal(DB.getNote(src, proj).body, 'Eigener Text bleibt\n- [ ] Aufgabe des Knotens', 'sein Text bleibt');
    assert.equal(DB.getNote(src, budget).body, `Siehe [Heizung](#w=neu&n=${heizNeu}).`, 'Verweis auf eine ausgelöste Notiz wird zum Link in den neuen Bereich');
    assert.equal(DB.countTrash(src), 4, 'die drei ausgelösten und die schon gelöschte im Papierkorb');
    assert.equal(DB.getNote(src, off).parent_id, heiz, 'im Papierkorb mit Platz im Baum');
    DB.restoreNote(src, heiz);
    assert.equal(DB.getNote(src, heiz).parent_id, proj, 'Zurückholen bringt die Notiz unter den Knoten');
    src.close();
    dst.close();
  }
  part('Auslösen: Unterbaum samt Tags, Bildern, Archiv, Fragen, Aufgaben, Verlauf und Link in eine andere Datenbank; hier Papierkorb mit Platz im Baum, Link am Knoten, Verweise umgeschrieben');
}

suite('Kern-Test', [
  { name: 'Zusammenführen: Myers-Vergleich, Dreiwege-Zusammenführung mit Zufallsdaten, Konflikte, Cursor', run: runMerge },
  { name: 'Datenbank: Standardschema, Angleichen alter Dateien (Schema 1, 11, 12, 13), Konflikterkennung, Autor im Verlauf, Querverweise, Entscheide und Personen', run: runDb },
  { name: 'Mehrzeilige Entscheide und Fragen: Parser, Index (Schema 15), Antworten, Angleichen, Vorschau, Export, Editor, Agenten, Blöcke in Listen', run: runEntries },
  { name: 'Vorlagen: Platzhalter in mehreren Sprachen, aus Notizen, Dateiformat, Anlegen und Einfügen, Agenten', run: runTemplates },
  { name: 'Build: fremde Ausprägung, Verzeichnis der Erweiterungen, --plugins, klare Fehler', run: runBuild },
  { name: 'Videoadressen: YouTube, Vimeo, Dailymotion, Fälschungen, Karte im Markdown, maskierte Titel', run: runEmbeds },
  { name: 'Tabellen: Lesen, Einfügen, Tab und Enter, Rechtsklick-Schritte, Vorschau, Angaben von Erweiterungen', run: runTables },
  { name: 'Pfade auf Dateien und Ordner: Netz, Laufwerk, file://, Kodierung, Kopieren, in der Zeile, Bilder, Einfügen aus dem Explorer', run: runPathsCore },
  { name: 'Ausfüllbare Platzhalter: Erkennen, Werte im Index, Vorschau, Druck, Export, Beschreibungen, Vorlagen anlegen und einfügen, Agenten', run: runPlaceholdersCore },
  { name: 'Personen an Aufgaben und Tabellenfelder: Parser, Editor, Vorschau, Index (Schema 16), Abhaken, Antwort ins Feld, Agenten, Export-Abschnitte', run: runCellsPeople },
  { name: 'Agenten: Werkzeugkatalog (Notizen, Fragen, Entscheide, Aufgaben, Verlauf, Archiv, Papierkorb, Lesemodus, Ressourcen) und MCP-Protokoll aller Fassungen', run: runAgent },
  { name: 'Programm für den eigenen Rechner: Einträge für Claude Code und andere, Datei, MCP über die Standardeingabe, Änderungen von aussen, zwei Prozesse mit Sperre, Lesemodus', run: runAgentProgram },
  { name: 'Termine mit «>» (v3.0.0): Schreibweise, Frist und Erinnerungen, Umstellung alter Dateien, Speichern, Index, Vorschau, Kalender, Agenten, Programm mit Sicherung, Seiten der Mindmap', run: runDatesV3 },
  { name: 'Link am Knoten und Auslösen in einen neuen Bereich (v3.2.0): Schema 18, Prüfung der Links, Umschreiben, Umzug zwischen zwei Datenbanken', run: runNodeLinks },
  { name: 'Release-Notizen: Pflicht ab v2.12.0, Prüfung, Beschreibung für GitHub, Screenshots aus einem Drehbuch, alle Ordner im Repository', run: runReleaseNotes },
]);
