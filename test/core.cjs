/* Kern-Test ohne Browser: Zusammenführen, Datenbankschicht (Standardschema, Angleichen alter Dateien, Konflikte, Autor,
   Querverweise, Entscheide), Build fremder Ausprägungen und Videoadressen. Ausführen: node test/core.cjs */
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
  assert.equal(DB.getMeta(db, 'schema_version'), '14');
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
    assert.equal(DB.getMeta(migrated, 'schema_version'), '14');
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

    // Migration aus Schema 12: bestehende Texte werden gelesen
    const old = new SQL.Database(DB.exportBytes(d));
    old.run('DROP TABLE note_links');
    old.run("UPDATE meta SET value = '12' WHERE key = 'schema_version'");
    const bytes = old.export();
    old.close();
    const mig = DB.open(SQL, bytes);
    assert.equal(DB.getMeta(mig, 'schema_version'), '14');
    assert.equal(json(DB.getLinks(mig)).length, 1, 'die Linie Alpha → beta kommt aus dem bestehenden Text');
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
      '?! Variante B oder C? @lea5678 (@tom9012) @01.11.2026',
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
    assert.equal(DB.getMeta(mig, 'schema_version'), '14');
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
    for (const f of ['index.html', 'start.ps1', 'start.cmd', 'README.md', 'NOTICE', 'js/db.js', 'js/local-shell.js', 'js/edition.js', 'vendor/sql.js/sql-asm.js', 'docs/BACKEND.md', 'plugins/plugins.js']) {
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

suite('Kern-Test', [
  { name: 'Zusammenführen: Myers-Vergleich, Dreiwege-Zusammenführung mit Zufallsdaten, Konflikte, Cursor', run: runMerge },
  { name: 'Datenbank: Standardschema, Angleichen alter Dateien (Schema 1, 11, 12, 13), Konflikterkennung, Autor im Verlauf, Querverweise, Entscheide und Personen', run: runDb },
  { name: 'Build: fremde Ausprägung, Verzeichnis der Erweiterungen, --plugins, klare Fehler', run: runBuild },
  { name: 'Videoadressen: YouTube, Vimeo, Dailymotion, Fälschungen, Karte im Markdown, maskierte Titel', run: runEmbeds },
]);
