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
const SCHEMA_VERSION = '15'; // muss zu packages/data/db.js passen
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

    // Migration aus Schema 12: bestehende Texte werden gelesen
    const old = new SQL.Database(DB.exportBytes(d));
    old.run('DROP TABLE note_links');
    old.run("UPDATE meta SET value = '12' WHERE key = 'schema_version'");
    const bytes = old.export();
    old.close();
    const mig = DB.open(SQL, bytes);
    assert.equal(DB.getMeta(mig, 'schema_version'), SCHEMA_VERSION);
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
  r = ok(await call('create_note', { title: 'Projekt', body: '? Welche Bank?\n- [ ] Angebot einholen @2026-10-20\n  - [ ] Bank anrufen\n?! Variante A oder B? @anna (@ben)', tags: ['Arbeit', '#arbeit', 'Bank'] }));
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
    assert.match(rv.result.content[0].text, /^\[t Entscheidungsvorlage\.md\] "Entscheidungsvorlage" — .*\n\[t Sitzungsprotokoll\.md\] "Sitzungsprotokoll" — .* — 3 notes$/);
    rv = await c.request('tools/call', { name: 'create_note_from_template', arguments: { template_id: 'Sitzungsprotokoll.md' } });
    assert.match(rv.result.content[0].text, /^Created note \[1\] "Sitzung \d+\.\d+\.\d{4}" from template "Sitzungsprotokoll" with 2 sub-notes at the root\.$/);
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
    '?!``` Ablage auf SharePoint umstellen @anna @15.11.2026',       // 1
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
  sandbox.NoNotesI18n.setLanguage('de');
  part('Platzhalter: Datum mit Versatz, Zeit, Woche, Vorlage, Bereich, ich; Namen übersetzbar und in jeder Sprache erkannt');

  // ---------- Aus Notizen ----------
  const nodes = [
    { depth: 2, title: 'Sitzung 20.10.2026', tags: ['sitzung'], body: '- [x] Protokoll genehmigt\n? Budget? @15.11.2026\n! 20k\n![Bild](att:3)\nText ![b](att:4) mehr\n```\n! bleibt im Code\n- [x] auch\n```' },
    { depth: 3, title: 'Beschlüsse', tags: [], body: '?! Variante? @anna\n!! 20.10.2026: B' },
    { depth: 4, title: 'Details', tags: ['x'], body: 'am 2026-10-20' },
    { depth: 3, title: 'Pendenzen', tags: [], body: '- [ ] {{ich}} bis {{datum+7}}' },
  ];
  let r = json(T.fromNotes(nodes, { description: 'Für Sitzungen', stripDates: true, todayToPlaceholder: true, today: now }));
  assert.equal(r.images, 2, 'Bilder aus der Datei gezählt und weggelassen');
  assert.deepEqual(r.template.notes.map(n => [n.depth, n.title]), [[0, 'Sitzung {{datum}}'], [1, 'Beschlüsse'], [2, 'Details'], [1, 'Pendenzen']]);
  assert.equal(r.template.notes[0].body, '- [ ] Protokoll genehmigt\n? Budget?\nText mehr\n```\n! bleibt im Code\n- [x] auch\n```', 'Antworten weg, Aufgaben offen, Termin weg, Code unverändert');
  assert.equal(r.template.notes[1].body, '?! Variante? @anna');
  assert.equal(r.template.notes[2].body, 'am {{datum}}');
  assert.equal(r.template.name, 'Sitzung {{datum}}');
  r = json(T.fromNotes(nodes, { name: 'Nur oben', children: false, stripAnswers: false, reopenTasks: false }));
  assert.equal(r.template.notes.length, 1);
  assert.match(r.template.notes[0].body, /^- \[x\] Protokoll genehmigt\n\? Budget\? @15\.11\.2026\n! 20k/, 'ohne Bereinigen bleibt alles');
  assert.throws(() => T.fromNotes([], {}), e => e.code === 'TEMPLATE_EMPTY');
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
  assert.ok(created.body.includes('**Protokoll:** @anna1234') && created.body.includes('- [ ] … @27.10.2026'), created.body);
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

suite('Kern-Test', [
  { name: 'Zusammenführen: Myers-Vergleich, Dreiwege-Zusammenführung mit Zufallsdaten, Konflikte, Cursor', run: runMerge },
  { name: 'Datenbank: Standardschema, Angleichen alter Dateien (Schema 1, 11, 12, 13), Konflikterkennung, Autor im Verlauf, Querverweise, Entscheide und Personen', run: runDb },
  { name: 'Mehrzeilige Entscheide und Fragen: Parser, Index (Schema 15), Antworten, Angleichen, Vorschau, Export, Editor, Agenten', run: runEntries },
  { name: 'Vorlagen: Platzhalter in mehreren Sprachen, aus Notizen, Dateiformat, Anlegen und Einfügen, Agenten', run: runTemplates },
  { name: 'Build: fremde Ausprägung, Verzeichnis der Erweiterungen, --plugins, klare Fehler', run: runBuild },
  { name: 'Videoadressen: YouTube, Vimeo, Dailymotion, Fälschungen, Karte im Markdown, maskierte Titel', run: runEmbeds },
  { name: 'Agenten: Werkzeugkatalog (Notizen, Fragen, Entscheide, Aufgaben, Verlauf, Archiv, Papierkorb, Lesemodus, Ressourcen) und MCP-Protokoll aller Fassungen', run: runAgent },
  { name: 'Programm für den eigenen Rechner: Einträge für Claude Code und andere, Datei, MCP über die Standardeingabe, Änderungen von aussen, zwei Prozesse mit Sperre, Lesemodus', run: runAgentProgram },
]);
