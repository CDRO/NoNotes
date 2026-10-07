/* NoNotes – Datenbankschicht (SQLite über sql.js).
   Alles, was SQL spricht, steht hier. Die Oberfläche kennt nur diese Funktionen. */
(function (global) {
  'use strict';

  const SCHEMA_VERSION = 1;

  function nowIso() { return new Date().toISOString(); }

  // Alle Zeilen einer Abfrage als Objekte. Statement wird immer freigegeben.
  function selectAll(db, sql, params) {
    const stmt = db.prepare(sql);
    try {
      if (params) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function selectOne(db, sql, params) {
    return selectAll(db, sql, params)[0] || null;
  }

  // Unicode-taugliches Kleinschreiben für die Suche (SQLite kennt von Haus aus nur ASCII).
  // Achtung: db.export() entfernt registrierte Funktionen wieder, deshalb nach jedem Export neu registrieren.
  function registerFunctions(db) {
    db.create_function('nn_lower', function (s) {
      return s == null ? null : String(s).toLowerCase();
    });
  }

  function ensureSchema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL DEFAULT '',
        body       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes (updated_at DESC);
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const row = selectOne(db, "SELECT value FROM meta WHERE key = 'schema_version'");
    if (!row) {
      db.run(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?), ('created_at', ?)",
        [String(SCHEMA_VERSION), nowIso()]
      );
    }
    // Spätere Migrationen: hier anhand von row.value schrittweise hochziehen.
  }

  /** Öffnet eine Datenbank aus Bytes (oder legt eine neue an) und stellt das Schema sicher.
   *  Fremde SQLite-Dateien (Tabellen vorhanden, aber keine "notes") werden abgelehnt. */
  function open(SQL, bytes) {
    const db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
    try {
      if (bytes && bytes.length) {
        const tables = selectAll(db,
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
        if (tables.length && !tables.some(t => t.name === 'notes')) {
          throw new Error('Diese SQLite-Datei stammt nicht von NoNotes (keine Tabelle "notes").');
        }
      }
      ensureSchema(db);
      registerFunctions(db);
      return db;
    } catch (e) {
      db.close();
      throw e;
    }
  }

  function escapeLike(s) {
    return s.replace(/[\\%_]/g, ch => '\\' + ch);
  }

  const LIST_COLUMNS = 'id, title, substr(body, 1, 200) AS snippet, created_at, updated_at';

  /** Liste für die Seitenleiste, neueste zuerst. Optional gefiltert (Titel oder Inhalt). */
  function listNotes(db, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      return selectAll(db, `SELECT ${LIST_COLUMNS} FROM notes ORDER BY updated_at DESC, id DESC`);
    }
    const like = '%' + escapeLike(q) + '%';
    return selectAll(db,
      `SELECT ${LIST_COLUMNS} FROM notes
        WHERE nn_lower(title) LIKE ? ESCAPE '\\' OR nn_lower(body) LIKE ? ESCAPE '\\'
        ORDER BY updated_at DESC, id DESC`,
      [like, like]);
  }

  function getNote(db, id) {
    return selectOne(db, 'SELECT * FROM notes WHERE id = ?', [id]);
  }

  function createNote(db) {
    const ts = nowIso();
    db.run("INSERT INTO notes (title, body, created_at, updated_at) VALUES ('', '', ?, ?)", [ts, ts]);
    return selectOne(db, 'SELECT last_insert_rowid() AS id').id;
  }

  function updateNote(db, id, title, body) {
    const ts = nowIso();
    db.run('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?', [title, body, ts, id]);
    return ts;
  }

  function deleteNote(db, id) {
    db.run('DELETE FROM notes WHERE id = ?', [id]);
  }

  function countNotes(db) {
    return selectOne(db, 'SELECT count(*) AS n FROM notes').n;
  }

  /** Datenbank als Bytes (echte SQLite-Datei). */
  function exportBytes(db) {
    const bytes = db.export();
    registerFunctions(db); // export() hat sie entfernt
    return bytes;
  }

  global.NoNotesDB = {
    SCHEMA_VERSION,
    open,
    listNotes,
    getNote,
    createNote,
    updateNote,
    deleteNote,
    countNotes,
    exportBytes,
  };
})(window);
