/* NoNotes – Datenbankschicht (SQLite über sql.js).
   Alles, was SQL spricht, steht hier. Die Oberfläche kennt nur diese Funktionen. */
(function (global) {
  'use strict';

  const SCHEMA_VERSION = 3;
  const DEFAULT_MAP_TITLE = 'Meine Notizen';

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

  function scalar(db, sql, params) {
    const row = selectOne(db, sql, params);
    if (!row) return null;
    return row[Object.keys(row)[0]];
  }

  // Unicode-taugliches Kleinschreiben für die Suche (SQLite kennt von Haus aus nur ASCII).
  // Achtung: db.export() entfernt registrierte Funktionen wieder, deshalb nach jedem Export neu registrieren.
  function registerFunctions(db) {
    db.create_function('nn_lower', function (s) {
      return s == null ? null : String(s).toLowerCase();
    });
  }

  // ---------- Schema und Migrationen ----------

  function hasTable(db, name) {
    return !!selectOne(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);
  }

  function getMeta(db, key) {
    return scalar(db, 'SELECT value FROM meta WHERE key = ?', [key]);
  }

  function setMeta(db, key, value) {
    db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
  }

  /** Legt das aktuelle Schema in einer leeren Datenbank an. */
  function createSchema(db) {
    db.exec(`
      CREATE TABLE notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL DEFAULT '',
        body       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        parent_id  INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        collapsed  INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT
      );
      CREATE INDEX idx_notes_updated ON notes (updated_at DESC);
      CREATE INDEX idx_notes_parent ON notes (parent_id, sort_order);
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE questions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id     INTEGER NOT NULL,
        text        TEXT NOT NULL,
        norm        TEXT NOT NULL,
        answer      TEXT,
        line_no     INTEGER NOT NULL,
        created_at  TEXT NOT NULL,
        answered_at TEXT
      );
      CREATE INDEX idx_questions_note ON questions (note_id);
    `);
    setMeta(db, 'schema_version', SCHEMA_VERSION);
    setMeta(db, 'created_at', nowIso());
    setMeta(db, 'map_title', DEFAULT_MAP_TITLE);
  }

  /** Hebt eine bestehende Datenbank Schritt für Schritt auf das aktuelle Schema. */
  function migrate(db) {
    if (!hasTable(db, 'meta')) {
      db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      setMeta(db, 'schema_version', 1);
    }
    let version = Number(getMeta(db, 'schema_version') || 1);

    if (version < 2) {
      db.exec(`
        ALTER TABLE notes ADD COLUMN parent_id INTEGER;
        ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE notes ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE notes ADD COLUMN deleted_at TEXT;
        CREATE INDEX IF NOT EXISTS idx_notes_parent ON notes (parent_id, sort_order);
      `);
      // Bestehende Notizen hängen an der Wurzel, in der Reihenfolge ihres Entstehens.
      selectAll(db, 'SELECT id FROM notes ORDER BY created_at, id')
        .forEach((row, i) => db.run('UPDATE notes SET sort_order = ? WHERE id = ?', [i, row.id]));
      if (getMeta(db, 'map_title') == null) setMeta(db, 'map_title', DEFAULT_MAP_TITLE);
      version = 2;
    }

    if (version < 3) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS questions (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id     INTEGER NOT NULL,
          text        TEXT NOT NULL,
          norm        TEXT NOT NULL,
          answer      TEXT,
          line_no     INTEGER NOT NULL,
          created_at  TEXT NOT NULL,
          answered_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_questions_note ON questions (note_id);
      `);
      for (const row of selectAll(db, 'SELECT id, body FROM notes')) syncQuestions(db, row.id, row.body);
      version = 3;
    }

    setMeta(db, 'schema_version', SCHEMA_VERSION);
  }

  /** Öffnet eine Datenbank aus Bytes (oder legt eine neue an) und bringt sie auf das aktuelle Schema.
   *  Fremde SQLite-Dateien (Tabellen vorhanden, aber keine "notes") werden abgelehnt. */
  function open(SQL, bytes) {
    const db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
    try {
      const tables = selectAll(db,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
      if (!tables.length) {
        createSchema(db);
      } else if (!tables.some(t => t.name === 'notes')) {
        throw new Error('Diese SQLite-Datei stammt nicht von NoNotes (keine Tabelle "notes").');
      } else {
        const version = hasTable(db, 'meta') ? Number(getMeta(db, 'schema_version') || 1) : 1;
        if (version > SCHEMA_VERSION) {
          throw new Error(`Diese Datenbank hat Schema-Version ${version}, diese App versteht nur bis ${SCHEMA_VERSION}. Bitte App aktualisieren.`);
        }
        if (version < SCHEMA_VERSION) migrate(db);
      }
      registerFunctions(db);
      return db;
    } catch (e) {
      db.close();
      throw e;
    }
  }

  // ---------- Notizen ----------

  function escapeLike(s) {
    return s.replace(/[\\%_]/g, ch => '\\' + ch);
  }

  const LIST_COLUMNS = 'id, title, substr(body, 1, 200) AS snippet, created_at, updated_at, parent_id';

  /** Liste für die Seitenleiste, neueste zuerst. Optional gefiltert (Titel oder Inhalt). */
  function listNotes(db, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      return selectAll(db, `SELECT ${LIST_COLUMNS} FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC`);
    }
    const like = '%' + escapeLike(q) + '%';
    return selectAll(db,
      `SELECT ${LIST_COLUMNS} FROM notes
        WHERE deleted_at IS NULL
          AND (nn_lower(title) LIKE ? ESCAPE '\\' OR nn_lower(body) LIKE ? ESCAPE '\\')
        ORDER BY updated_at DESC, id DESC`,
      [like, like]);
  }

  /** Alle lebenden Notizen als flache Liste für den Baum. */
  function getTree(db) {
    return selectAll(db,
      `SELECT id, title, parent_id, sort_order, collapsed,
              (SELECT count(*) FROM questions q WHERE q.note_id = notes.id AND q.answer IS NULL) AS badge
         FROM notes
        WHERE deleted_at IS NULL ORDER BY parent_id, sort_order, id`);
  }

  function getNote(db, id) {
    return selectOne(db, 'SELECT * FROM notes WHERE id = ?', [id]);
  }

  /** Titelpfad von der Wurzel bis zur Notiz (ohne die Notiz selbst). */
  function getPath(db, id) {
    const path = [];
    let current = getNote(db, id);
    const seen = new Set();
    while (current && current.parent_id != null && !seen.has(current.parent_id)) {
      seen.add(current.parent_id);
      current = getNote(db, current.parent_id);
      if (current && current.deleted_at == null) path.unshift({ id: current.id, title: current.title });
    }
    return path;
  }

  function nextSortOrder(db, parentId) {
    const max = scalar(db,
      parentId == null
        ? 'SELECT max(sort_order) FROM notes WHERE parent_id IS NULL'
        : 'SELECT max(sort_order) FROM notes WHERE parent_id = ?',
      parentId == null ? undefined : [parentId]);
    return max == null ? 0 : max + 1;
  }

  function createNote(db, parentId) {
    const ts = nowIso();
    const pid = parentId == null ? null : parentId;
    db.run(
      "INSERT INTO notes (title, body, created_at, updated_at, parent_id, sort_order) VALUES ('', '', ?, ?, ?, ?)",
      [ts, ts, pid, nextSortOrder(db, pid)]);
    return scalar(db, 'SELECT last_insert_rowid()');
  }

  function updateNote(db, id, title, body) {
    const ts = nowIso();
    db.run('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?', [title, body, ts, id]);
    syncQuestions(db, id, body);
    return ts;
  }

  function renameNote(db, id, title) {
    const ts = nowIso();
    db.run('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?', [title, ts, id]);
    return ts;
  }

  /** Ist candidate ein Nachfahre von ancestorId (oder gleich)? */
  function isDescendantOf(db, candidateId, ancestorId) {
    let current = candidateId;
    const seen = new Set();
    while (current != null && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      current = scalar(db, 'SELECT parent_id FROM notes WHERE id = ?', [current]);
    }
    return false;
  }

  /** Hängt eine Notiz samt Unterbaum an einen anderen Knoten (null = Wurzel). */
  function setParent(db, id, parentId) {
    const pid = parentId == null ? null : parentId;
    if (pid != null && isDescendantOf(db, pid, id)) {
      throw new Error('Eine Notiz kann nicht unter sich selbst hängen.');
    }
    db.run('UPDATE notes SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
      [pid, nextSortOrder(db, pid), nowIso(), id]);
  }

  /** Verschiebt eine Notiz unter ihren Geschwistern nach oben (-1) oder unten (+1). */
  function moveAmongSiblings(db, id, direction) {
    const note = getNote(db, id);
    if (!note) return false;
    const siblings = selectAll(db,
      note.parent_id == null
        ? 'SELECT id FROM notes WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order, id'
        : 'SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
      note.parent_id == null ? undefined : [note.parent_id]);
    const idx = siblings.findIndex(s => s.id === id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return false;
    // Reihenfolge sauber neu durchnummerieren, damit Lücken und Dubletten verschwinden.
    const ids = siblings.map(s => s.id);
    [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
    ids.forEach((sid, i) => db.run('UPDATE notes SET sort_order = ? WHERE id = ?', [i, sid]));
    return true;
  }

  function setCollapsed(db, id, collapsed) {
    db.run('UPDATE notes SET collapsed = ? WHERE id = ?', [collapsed ? 1 : 0, id]);
  }

  function setAllCollapsed(db, collapsed) {
    db.run('UPDATE notes SET collapsed = ? WHERE deleted_at IS NULL', [collapsed ? 1 : 0]);
  }

  /** Verschiebt eine Notiz in den Papierkorb. Unternotizen rücken zum übergeordneten Knoten auf. */
  function deleteNote(db, id) {
    const note = getNote(db, id);
    if (!note) return;
    const ts = nowIso();
    const children = selectAll(db, 'SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_order, id', [id]);
    for (const child of children) {
      db.run('UPDATE notes SET parent_id = ?, sort_order = ? WHERE id = ?',
        [note.parent_id, nextSortOrder(db, note.parent_id), child.id]);
    }
    db.run('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?', [ts, ts, id]);
  }

  /** Entfernt eine Notiz endgültig (z. B. eine gerade erst angelegte, leere). */
  function purgeNote(db, id) {
    db.run('UPDATE notes SET parent_id = (SELECT parent_id FROM notes WHERE id = ?) WHERE parent_id = ?', [id, id]);
    db.run('DELETE FROM questions WHERE note_id = ?', [id]);
    db.run('DELETE FROM notes WHERE id = ?', [id]);
  }

  // ---------- Fragen ----------

  /** Gleicht den Fragen-Index einer Notiz mit ihrem Text ab. Bestehende Einträge werden über den
   *  normalisierten Text wiedererkannt, damit Anlagedatum und Nummer erhalten bleiben. */
  function syncQuestions(db, noteId, body) {
    const Q = global.NoNotesQuestions;
    if (!Q) return;
    const parsed = Q.parse(body);
    const existing = selectAll(db, 'SELECT * FROM questions WHERE note_id = ? ORDER BY line_no, id', [noteId]);
    const unused = existing.slice();
    const ts = nowIso();
    for (const q of parsed) {
      const idx = unused.findIndex(e => e.norm === q.norm);
      if (idx >= 0) {
        const e = unused.splice(idx, 1)[0];
        let answeredAt = e.answered_at;
        if (q.answer && !e.answer) answeredAt = ts;
        if (!q.answer) answeredAt = null;
        if (e.text !== q.text || e.answer !== q.answer || e.line_no !== q.lineIndex || e.answered_at !== answeredAt) {
          db.run('UPDATE questions SET text = ?, answer = ?, line_no = ?, answered_at = ? WHERE id = ?',
            [q.text, q.answer, q.lineIndex, answeredAt, e.id]);
        }
      } else {
        db.run('INSERT INTO questions (note_id, text, norm, answer, line_no, created_at, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [noteId, q.text, q.norm, q.answer, q.lineIndex, ts, q.answer ? ts : null]);
      }
    }
    for (const e of unused) db.run('DELETE FROM questions WHERE id = ?', [e.id]);
  }

  /** Fragen über alle lebenden Notizen. status: 'open' | 'answered' | 'all'. */
  function listQuestions(db, options) {
    const status = (options && options.status) || 'open';
    const q = ((options && options.query) || '').trim().toLowerCase();
    const where = ['n.deleted_at IS NULL'];
    const params = [];
    if (status === 'open') where.push('q.answer IS NULL');
    else if (status === 'answered') where.push('q.answer IS NOT NULL');
    if (q) {
      const like = '%' + escapeLike(q) + '%';
      where.push("(nn_lower(q.text) LIKE ? ESCAPE '\\' OR nn_lower(q.answer) LIKE ? ESCAPE '\\' OR nn_lower(n.title) LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }
    return selectAll(db,
      `SELECT q.id, q.note_id, q.text, q.norm, q.answer, q.line_no, q.created_at, q.answered_at,
              n.title AS note_title, n.updated_at AS note_updated_at
         FROM questions q JOIN notes n ON n.id = q.note_id
        WHERE ${where.join(' AND ')}
        ORDER BY (q.answer IS NOT NULL), n.updated_at DESC, n.id, q.line_no`, params);
  }

  function countQuestions(db) {
    const row = selectOne(db,
      `SELECT sum(q.answer IS NULL) AS open, count(*) AS total
         FROM questions q JOIN notes n ON n.id = q.note_id WHERE n.deleted_at IS NULL`);
    return { open: Number(row && row.open || 0), total: Number(row && row.total || 0) };
  }

  function getQuestion(db, id) {
    return selectOne(db, 'SELECT * FROM questions WHERE id = ?', [id]);
  }

  /** Schreibt die Antwort als "!"-Zeilen unter die Frage in der Notiz. Leerer Text entfernt die Antwort. */
  function answerQuestion(db, questionId, answerText) {
    const Q = global.NoNotesQuestions;
    const row = getQuestion(db, questionId);
    if (!row) throw new Error('Frage nicht gefunden.');
    const note = getNote(db, row.note_id);
    if (!note) throw new Error('Notiz nicht gefunden.');
    const q = Q.locate(note.body, row);
    if (!q) throw new Error('Die Frage steht nicht mehr so im Text.');
    const body = Q.writeAnswer(note.body, q, answerText);
    updateNote(db, note.id, note.title, body);
    return note.id;
  }

  function countNotes(db) {
    return scalar(db, 'SELECT count(*) FROM notes WHERE deleted_at IS NULL');
  }

  function getMapTitle(db) {
    return getMeta(db, 'map_title') || DEFAULT_MAP_TITLE;
  }

  function setMapTitle(db, title) {
    setMeta(db, 'map_title', (title || '').trim() || DEFAULT_MAP_TITLE);
  }

  /** Datenbank als Bytes (echte SQLite-Datei). */
  function exportBytes(db) {
    const bytes = db.export();
    registerFunctions(db); // export() hat sie entfernt
    return bytes;
  }

  global.NoNotesDB = {
    SCHEMA_VERSION,
    DEFAULT_MAP_TITLE,
    open,
    listNotes,
    getTree,
    getNote,
    getPath,
    createNote,
    updateNote,
    renameNote,
    setParent,
    moveAmongSiblings,
    setCollapsed,
    setAllCollapsed,
    deleteNote,
    purgeNote,
    countNotes,
    getMapTitle,
    setMapTitle,
    getMeta,
    setMeta,
    syncQuestions,
    listQuestions,
    countQuestions,
    getQuestion,
    answerQuestion,
    exportBytes,
  };
})(window);
