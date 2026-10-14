/* Test der Datenbankschicht ohne Browser: Schema 14 (Autor, Querverweise, Entscheide), Migration aus Schema 11, Konflikterkennung beim Speichern
   (NOTE_CONFLICT), Autor im Verlauf, Querverweise [[Titel*]]. Lädt dieselben Skripte wie die Seite in einen vm-Kontext, mit festgehaltener Uhr.
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
  step('Schema 13: Spalten updated_by (Notiz) und author (Verlauf), Tabelle note_links (Querverweise)');

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
    step('Querverweise: nur [[Titel*]] zählt, Gross-/Kleinschreibung egal, Code-Block und leerer Titel nicht, auf sich selbst keine Linie');

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
    step('Querverweise folgen Text, Papierkorb, Archiv und Titelauflösung');

    // Migration aus Schema 12: bestehende Texte werden gelesen
    const old = new SQL.Database(DB.exportBytes(d));
    old.run('DROP TABLE note_links');
    old.run("UPDATE meta SET value = '12' WHERE key = 'schema_version'");
    const bytes = old.export();
    old.close();
    const mig = DB.open(SQL, bytes);
    assert.equal(DB.getMeta(mig, 'schema_version'), '14');
    assert.equal(json(DB.getLinks(mig)).length, 1, 'die Linie Alpha → beta kommt aus dem bestehenden Text');
    step('Migration aus Schema 12: Tabelle angelegt und aus den Texten gefüllt');
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
    step('Schema 14: Art, Tag des Entscheids und Personen im Index; listQuestions filtert nach Art und Person; Zähler je Art');

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
    step('Entscheiden schreibt "!! Datum: Text" in die Notiz, Fragen bleiben wie bisher');

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
    step('Migration aus Schema 13: der Index wird aus den Texten neu gefüllt');
  }

  console.log('\nDatenbank-Test bestanden.');
}

main().catch(e => {
  console.error('\nDatenbank-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
