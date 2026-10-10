/* Test der Datenbankschicht ohne Browser: Schema 12 (Autor), Migration aus Schema 11, Konflikterkennung beim Speichern (NOTE_CONFLICT),
   Autor im Verlauf. Lädt dieselben Skripte wie die Seite in einen vm-Kontext, mit festgehaltener Uhr.
   Ausführen: node test/db.cjs */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const step = name => console.log('  ✓ ' + name);

let now = Date.parse('2026-10-10T08:00:00Z');
const tick = ms => { now += ms; };

async function main() {
  const sandbox = { console };
  sandbox.window = sandbox;
  const RealDate = Date;
  sandbox.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(now); else super(...a); }
    static now() { return now; }
  };
  const context = vm.createContext(sandbox);
  for (const f of ['packages/core/i18n.js', 'packages/core/history.js', 'packages/core/dates.js', 'packages/core/questions.js', 'packages/core/tasks.js', 'packages/core/backend.js', 'packages/core/merge.js', 'packages/data/db.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  const SQL = await require(path.join(ROOT, 'vendor', 'sql.js', 'sql-asm.js'))();
  const DB = sandbox.NoNotesDB;
  const Backend = sandbox.NoNotesBackend;
  const json = v => JSON.parse(JSON.stringify(v));

  // ---------- Schema 12 ----------
  let db = DB.open(SQL, null);
  const cols = (d, t) => d.exec(`PRAGMA table_info(${t})`)[0].values.map(r => r[1]);
  assert.equal(DB.getMeta(db, 'schema_version'), '12');
  assert.ok(cols(db, 'notes').includes('updated_by'));
  assert.ok(cols(db, 'note_history').includes('author'));
  step('Schema 12: Spalten updated_by (Notiz) und author (Verlauf)');

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
    assert.equal(DB.getMeta(migrated, 'schema_version'), '12');
    assert.ok(cols(migrated, 'notes').includes('updated_by') && cols(migrated, 'note_history').includes('author'));
    assert.equal(DB.getNote(migrated, 1).title, 'Alt');
    assert.equal(DB.getNote(migrated, 1).updated_by, null);
    assert.equal(json(DB.listHistory(migrated, 1))[0].author, null);
    DB.updateNote(migrated, 1, 'Neu', 'Text neu', { author: 'Anna' });
    assert.equal(DB.getNote(migrated, 1).updated_by, 'Anna');
    migrated.close();
  }
  step('Migration: eine Schema-11-Datei bekommt die Spalten, Notizen und Verlauf bleiben, danach lässt sich mit Autor speichern');

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
  step('Konflikt: Speichern auf veraltetem Stand wirft NOTE_CONFLICT mit dem aktuellen Zeitstempel, ohne Basis gilt wie bisher der letzte Stand');

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
  step('Autor: die Notiz merkt sich, wer zuletzt geschrieben hat; ein Wechsel der Person beginnt eine neue Fassung im Verlauf');

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
  step('Autor: Umbenennen und Wiederherstellen tragen den Namen, der Stand davor behält seinen Autor');

  // ohne Autor (lokal) ändert sich nichts am bisherigen Verhalten
  const lonely = DB.createNote(db, null);
  tick(1000);
  DB.updateNote(db, lonely, 'x', 'eins');
  tick(1000);
  DB.updateNote(db, lonely, 'x', 'eins zwei');
  assert.equal(DB.getNote(db, lonely).updated_by, null);
  assert.equal(json(DB.listHistory(db, lonely)).length, 0, 'ohne Autor und ohne Pause bleibt es bei einer Arbeitsphase');
  step('Ohne Autor: Verlauf und Speichern verhalten sich wie bisher');

  // Autor wird bereinigt
  tick(1000);
  DB.updateNote(db, lonely, 'x', 'drei', { author: '   ' });
  assert.equal(DB.getNote(db, lonely).updated_by, null);
  DB.updateNote(db, lonely, 'x', 'vier', { author: 'A'.repeat(200) });
  assert.equal(DB.getNote(db, lonely).updated_by.length, 80);
  step('Autor: leer wird zu keinem Autor, zu lange Namen werden gekürzt');

  console.log('\nDatenbank-Test bestanden.');
}

main().catch(e => {
  console.error('\nDatenbank-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
