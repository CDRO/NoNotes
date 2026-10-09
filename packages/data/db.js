/* NoNotes – Datenbankschicht (SQLite über sql.js).
   Alles, was SQL spricht, steht hier. Die Oberfläche kennt nur diese Funktionen. */
(function (global) {
  'use strict';

  const SCHEMA_VERSION = 10;
  let defaultMapTitle = 'Meine Notizen'; // i18n-ignore: Anfangswert; die Ausprägung setzt ihn über configure() in der Sprache der Oberfläche

  function nowIso() { return new Date().toISOString(); }

  /** Fehler mit Kennung. Die Oberfläche übersetzt über die Kennung (NoNotesBackend.errorText); die deutsche
   *  Meldung dient nur als Rückfall und für Protokolle. params sind JSON-sichere Werte für Platzhalter. */
  function fail(code, message, params) {
    const err = new Error(message);
    err.code = code;
    if (params) err.params = params;
    return err;
  }

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
        deleted_at TEXT,
        archived_at TEXT
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
        answered_at TEXT,
        due         TEXT
      );
      CREATE INDEX idx_questions_note ON questions (note_id);
      CREATE TABLE tags (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );
      CREATE TABLE note_tags (
        note_id INTEGER NOT NULL,
        tag_id  INTEGER NOT NULL,
        PRIMARY KEY (note_id, tag_id)
      );
      CREATE TABLE attachments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id    INTEGER NOT NULL,
        name       TEXT NOT NULL,
        mime       TEXT NOT NULL,
        size       INTEGER NOT NULL,
        data       BLOB NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_attachments_note ON attachments (note_id);
      CREATE TABLE tasks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id    INTEGER NOT NULL,
        text       TEXT NOT NULL,
        norm       TEXT NOT NULL,
        done       INTEGER NOT NULL DEFAULT 0,
        due        TEXT,
        line_no    INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        done_at    TEXT,
        parent_id  INTEGER,
        depth      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_tasks_note ON tasks (note_id);
    `);
    setMeta(db, 'schema_version', SCHEMA_VERSION);
    setMeta(db, 'created_at', nowIso());
    setMeta(db, 'map_title', defaultMapTitle);
  }

  /** Fügt der Aufgabentabelle die Spalten für Unteraufgaben hinzu, falls sie fehlen (ältere Datenbanken). */
  function ensureTaskTreeColumns(db) {
    if (!hasTable(db, 'tasks')) return;
    const cols = selectAll(db, 'PRAGMA table_info(tasks)').map(c => c.name);
    if (!cols.includes('parent_id')) db.exec('ALTER TABLE tasks ADD COLUMN parent_id INTEGER');
    if (!cols.includes('depth')) db.exec('ALTER TABLE tasks ADD COLUMN depth INTEGER NOT NULL DEFAULT 0');
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
      if (getMeta(db, 'map_title') == null) setMeta(db, 'map_title', defaultMapTitle);
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

    if (version < 4) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
          id   INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE
        );
        CREATE TABLE IF NOT EXISTS note_tags (
          note_id INTEGER NOT NULL,
          tag_id  INTEGER NOT NULL,
          PRIMARY KEY (note_id, tag_id)
        );
      `);
      version = 4;
    }

    if (version < 5) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS attachments (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id    INTEGER NOT NULL,
          name       TEXT NOT NULL,
          mime       TEXT NOT NULL,
          size       INTEGER NOT NULL,
          data       BLOB NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments (note_id);
      `);
      version = 5;
    }

    if (version < 6) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id    INTEGER NOT NULL,
          text       TEXT NOT NULL,
          norm       TEXT NOT NULL,
          done       INTEGER NOT NULL DEFAULT 0,
          due        TEXT,
          line_no    INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          done_at    TEXT,
          parent_id  INTEGER,
          depth      INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_note ON tasks (note_id);
      `);
      for (const row of selectAll(db, 'SELECT id, body FROM notes')) syncTasks(db, row.id, row.body);
      version = 6;
    }

    if (version < 7) {
      db.exec('ALTER TABLE questions ADD COLUMN due TEXT');
      for (const row of selectAll(db, 'SELECT id, body FROM notes')) syncQuestions(db, row.id, row.body);
      version = 7;
    }

    if (version < 8) {
      // Uhrzeiten in Terminen: alle Notizen neu indexieren, damit "@Datum Zeit" erkannt wird.
      ensureTaskTreeColumns(db);
      for (const row of selectAll(db, 'SELECT id, body FROM notes')) { syncQuestions(db, row.id, row.body); syncTasks(db, row.id, row.body); }
      version = 8;
    }

    if (version < 9) {
      // Unteraufgaben: Verweis auf die Hauptaufgabe und Tiefe, alle Notizen neu indexieren.
      ensureTaskTreeColumns(db);
      for (const row of selectAll(db, 'SELECT id, body FROM notes')) syncTasks(db, row.id, row.body);
      version = 9;
    }

    if (version < 10) {
      // Archiv: archivierte Notizen behalten ihren Platz im Baum und sind nur ausgeblendet.
      const cols = selectAll(db, 'PRAGMA table_info(notes)').map(c => c.name);
      if (!cols.includes('archived_at')) db.exec('ALTER TABLE notes ADD COLUMN archived_at TEXT');
      version = 10;
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
        throw fail('NOT_NONOTES_FILE', 'Diese SQLite-Datei stammt nicht von NoNotes (keine Tabelle "notes").');
      } else {
        const version = hasTable(db, 'meta') ? Number(getMeta(db, 'schema_version') || 1) : 1;
        if (version > SCHEMA_VERSION) {
          throw fail('SCHEMA_TOO_NEW', `Diese Datenbank hat Schema-Version ${version}, diese App versteht nur bis ${SCHEMA_VERSION}. Bitte App aktualisieren.`, { version, unterstuetzt: SCHEMA_VERSION });
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

  const LIST_COLUMNS = `n.id, n.title, n.body, n.created_at, n.updated_at, n.parent_id, n.deleted_at, n.archived_at,
    (SELECT group_concat(t.name, ',') FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) AS tags`;

  /** Liste für die Seitenleiste, neueste zuerst. Optional gefiltert nach Text (Titel oder Inhalt),
   *  Tag und Bereich ('live' = normale Notizen, 'archive' = Archiv, 'trash' = Papierkorb).
   *  Archivierte Notizen fehlen in 'live', ausser es wird nach Text gesucht: die Suche findet das Archiv immer. */
  function listNotes(db, query, options) {
    const q = (query || '').trim().toLowerCase();
    const tag = options && options.tag ? String(options.tag).trim() : '';
    const scope = options && options.scope === 'trash' ? 'trash' : options && options.scope === 'archive' ? 'archive' : 'live';
    const where = [scope === 'trash' ? 'n.deleted_at IS NOT NULL' : 'n.deleted_at IS NULL'];
    if (scope === 'archive') where.push('n.archived_at IS NOT NULL');
    else if (scope === 'live' && !q) where.push('n.archived_at IS NULL');
    const params = [];
    if (q) {
      const like = '%' + escapeLike(q) + '%';
      where.push("(nn_lower(n.title) LIKE ? ESCAPE '\\' OR nn_lower(n.body) LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
    if (tag) {
      where.push('EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id AND t.name = ? COLLATE NOCASE)');
      params.push(tag);
    }
    const order = scope === 'trash' ? 'n.deleted_at DESC, n.id DESC'
      : scope === 'archive' ? 'n.archived_at DESC, n.id DESC'
      : 'n.updated_at DESC, n.id DESC';
    return selectAll(db, `SELECT ${LIST_COLUMNS} FROM notes n WHERE ${where.join(' AND ')} ORDER BY ${order}`, params);
  }

  /** Lebende Notiz mit diesem Titel (für [[Titel]]-Verweise). */
  function findNoteByTitle(db, title) {
    const t = (title || '').trim();
    if (!t) return null;
    const row = selectOne(db,
      'SELECT id FROM notes WHERE deleted_at IS NULL AND title = ? COLLATE NOCASE ORDER BY (archived_at IS NOT NULL), updated_at DESC LIMIT 1', [t]);
    return row ? row.id : null;
  }

  /** Alle Ziele für [[Titel]]-Verweise: Titel → id (lebende Notizen, auch archivierte; bei gleichem Titel gewinnt die aktive). */
  function titleIndex(db) {
    const map = new Map();
    for (const r of selectAll(db, "SELECT id, title FROM notes WHERE deleted_at IS NULL AND title <> '' ORDER BY (archived_at IS NOT NULL) DESC, updated_at")) {
      map.set(r.title.trim().toLowerCase(), r.id);
    }
    return map;
  }

  /** Alle lebenden Notizen als flache Liste für den Baum. Archivierte fehlen, ausser options.archive ist
   *  true (alle) oder eine Liste von Notiz-IDs: dann erscheinen genau diese archivierten Notizen samt
   *  ihren archivierten Vorfahren (für Suchtreffer im Archiv). Fragen und Aufgaben archivierter Notizen
   *  zählen nicht in den Marken. */
  function getTree(db, options) {
    const archive = options && options.archive;
    const rows = selectAll(db,
      `SELECT id, title, parent_id, sort_order, collapsed, archived_at,
              CASE WHEN archived_at IS NULL THEN (SELECT count(*) FROM questions q WHERE q.note_id = notes.id AND q.answer IS NULL) ELSE 0 END AS badge,
              CASE WHEN archived_at IS NULL THEN (SELECT count(*) FROM tasks t WHERE t.note_id = notes.id AND t.done = 0) ELSE 0 END AS tbadge
         FROM notes
        WHERE deleted_at IS NULL ORDER BY parent_id, sort_order, id`);
    if (archive === true) return rows;
    if (!archive) return rows.filter(r => !r.archived_at);
    const byId = new Map(rows.map(r => [r.id, r]));
    const reveal = new Set();
    for (const id of archive) {
      let cur = byId.get(id);
      while (cur && cur.archived_at && !reveal.has(cur.id)) {
        reveal.add(cur.id);
        cur = cur.parent_id != null ? byId.get(cur.parent_id) : null;
      }
    }
    return rows.filter(r => !r.archived_at || reveal.has(r.id));
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
    if (pid != null && isArchived(db, pid)) throw fail('ARCHIVED_NO_CHILD', 'Unter einer archivierten Notiz lässt sich nichts anlegen.');
    db.run(
      "INSERT INTO notes (title, body, created_at, updated_at, parent_id, sort_order) VALUES ('', '', ?, ?, ?, ?)",
      [ts, ts, pid, nextSortOrder(db, pid)]);
    return scalar(db, 'SELECT last_insert_rowid()');
  }

  function updateNote(db, id, title, body) {
    const ts = nowIso();
    db.run('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?', [title, body, ts, id]);
    syncQuestions(db, id, body);
    syncTasks(db, id, body);
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
    if (isArchived(db, id) || (pid != null && isArchived(db, pid))) throw fail('ARCHIVED_NO_MOVE', 'Archivierte Notizen lassen sich nicht umhängen.');
    if (pid != null && isDescendantOf(db, pid, id)) {
      throw fail('MOVE_INTO_SELF', 'Eine Notiz kann nicht unter sich selbst hängen.');
    }
    db.run('UPDATE notes SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
      [pid, nextSortOrder(db, pid), nowIso(), id]);
  }

  /** Hängt eine Notiz direkt vor oder nach eine andere Notiz (gleicher Elternknoten wie der Anker).
   *  where: 'before' | 'after'. */
  function moveNote(db, id, anchorId, where) {
    if (id === anchorId) return;
    const anchor = getNote(db, anchorId);
    if (!anchor || anchor.deleted_at) throw fail('TARGET_NOT_FOUND', 'Zielnotiz nicht gefunden.');
    if (isArchived(db, id) || anchor.archived_at) throw fail('ARCHIVED_NO_MOVE', 'Archivierte Notizen lassen sich nicht umhängen.');
    const pid = anchor.parent_id == null ? null : anchor.parent_id;
    if (pid != null && isDescendantOf(db, pid, id)) {
      throw fail('MOVE_INTO_SELF', 'Eine Notiz kann nicht unter sich selbst hängen.');
    }
    const siblings = selectAll(db,
      pid == null
        ? 'SELECT id FROM notes WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order, id'
        : 'SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
      pid == null ? undefined : [pid]).map(r => r.id).filter(sid => sid !== id);
    const idx = siblings.indexOf(anchorId);
    if (idx < 0) throw fail('TARGET_NOT_FOUND', 'Zielnotiz nicht gefunden.');
    siblings.splice(where === 'after' ? idx + 1 : idx, 0, id);
    db.run('UPDATE notes SET parent_id = ?, updated_at = ? WHERE id = ?', [pid, nowIso(), id]);
    siblings.forEach((sid, i) => db.run('UPDATE notes SET sort_order = ? WHERE id = ?', [i, sid]));
  }

  /** Verschiebt eine Notiz unter ihren Geschwistern nach oben (-1) oder unten (+1). */
  function moveAmongSiblings(db, id, direction) {
    const note = getNote(db, id);
    if (!note || note.archived_at) return false;
    const siblings = selectAll(db,
      note.parent_id == null
        ? 'SELECT id, archived_at FROM notes WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order, id'
        : 'SELECT id, archived_at FROM notes WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
      note.parent_id == null ? undefined : [note.parent_id]);
    const idx = siblings.findIndex(s => s.id === id);
    // Archivierte Geschwister sind ausgeblendet: der Nachbar ist der nächste sichtbare.
    let swapIdx = idx + direction;
    while (swapIdx >= 0 && swapIdx < siblings.length && siblings[swapIdx].archived_at) swapIdx += direction;
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

  // ---------- Archiv ----------

  function isArchived(db, id) {
    const n = getNote(db, id);
    return !!(n && n.archived_at);
  }

  /** IDs der Notiz und aller ihrer Unternotizen (ohne gelöschte), Tiefensuche. */
  function subtreeNoteIds(db, id) {
    const out = [];
    const seen = new Set();
    const walk = nid => {
      if (seen.has(nid)) return;
      seen.add(nid);
      out.push(nid);
      for (const c of selectAll(db, 'SELECT id FROM notes WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_order, id', [nid])) walk(c.id);
    };
    walk(id);
    return out;
  }

  /** Wie viele noch nicht archivierte Notizen würde Archivieren dieser Notizen erfassen (Notiz samt Unternotizen)? */
  function archiveCount(db, ids) {
    const all = new Set();
    for (const id of [].concat(ids)) {
      const n = getNote(db, id);
      if (!n || n.deleted_at) continue;
      for (const sid of subtreeNoteIds(db, id)) all.add(sid);
    }
    let count = 0;
    for (const sid of all) if (!isArchived(db, sid)) count++;
    return count;
  }

  /** Archiviert die Notiz samt allen Unternotizen. Die Notiz behält ihren Platz im Baum; "Geändert" bleibt.
   *  Gibt die IDs der dabei neu archivierten Notizen zurück. */
  function archiveNote(db, id) {
    const note = getNote(db, id);
    if (!note || note.deleted_at) return [];
    const ts = nowIso();
    const done = [];
    for (const sid of subtreeNoteIds(db, id)) {
      if (isArchived(db, sid)) continue;
      db.run('UPDATE notes SET archived_at = ? WHERE id = ?', [ts, sid]);
      done.push(sid);
    }
    return done;
  }

  /** Holt genau diese Notiz aus dem Archiv, dazu alle archivierten Vorfahren (damit sie nicht in der Luft hängt).
   *  Archivierte Unternotizen bleiben im Archiv. Gibt die IDs der zurückgeholten Notizen zurück (zuerst die Notiz). */
  function unarchiveNote(db, id) {
    const done = [];
    const seen = new Set();
    let current = getNote(db, id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.archived_at) {
        db.run('UPDATE notes SET archived_at = NULL WHERE id = ?', [current.id]);
        done.push(current.id);
      }
      current = current.parent_id != null ? getNote(db, current.parent_id) : null;
    }
    return done;
  }

  function countArchived(db) {
    return scalar(db, 'SELECT count(*) FROM notes WHERE deleted_at IS NULL AND archived_at IS NOT NULL');
  }

  /** Entfernt eine Notiz endgültig (z. B. eine gerade erst angelegte, leere). */
  function purgeNote(db, id) {
    db.run('UPDATE notes SET parent_id = (SELECT parent_id FROM notes WHERE id = ?) WHERE parent_id = ?', [id, id]);
    db.run('DELETE FROM questions WHERE note_id = ?', [id]);
    db.run('DELETE FROM note_tags WHERE note_id = ?', [id]);
    db.run('DELETE FROM attachments WHERE note_id = ?', [id]);
    db.run('DELETE FROM tasks WHERE note_id = ?', [id]);
    db.run('DELETE FROM notes WHERE id = ?', [id]);
    pruneTags(db);
  }

  // ---------- Aufgaben ----------

  /** Gleicht den Aufgaben-Index einer Notiz mit ihrem Text ab (wie bei den Fragen). */
  function syncTasks(db, noteId, body) {
    const T = global.NoNotesTasks;
    if (!T) return;
    const parsed = T.parse(body);
    const existing = selectAll(db, 'SELECT * FROM tasks WHERE note_id = ? ORDER BY line_no, id', [noteId]);
    const unused = existing.slice();
    const ts = nowIso();
    const ids = []; // Zeilen-ID je Aufgabe; Hauptaufgaben stehen im Text vor ihren Unteraufgaben
    for (const t of parsed) {
      const idx = unused.findIndex(e => e.norm === t.norm);
      const done = t.done ? 1 : 0;
      const parentId = t.parent >= 0 ? ids[t.parent] : null;
      if (idx >= 0) {
        const e = unused.splice(idx, 1)[0];
        let doneAt = e.done_at;
        if (done && !e.done) doneAt = ts;
        if (!done) doneAt = null;
        if (e.text !== t.text || e.done !== done || e.due !== t.due || e.line_no !== t.lineIndex || e.done_at !== doneAt
            || (e.parent_id == null ? null : e.parent_id) !== parentId || (e.depth || 0) !== t.depth) {
          db.run('UPDATE tasks SET text = ?, done = ?, due = ?, line_no = ?, done_at = ?, parent_id = ?, depth = ? WHERE id = ?',
            [t.text, done, t.due, t.lineIndex, doneAt, parentId, t.depth, e.id]);
        }
        ids.push(e.id);
      } else {
        db.run('INSERT INTO tasks (note_id, text, norm, done, due, line_no, created_at, done_at, parent_id, depth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [noteId, t.text, t.norm, done, t.due, t.lineIndex, ts, done ? ts : null, parentId, t.depth]);
        ids.push(scalar(db, 'SELECT last_insert_rowid()'));
      }
    }
    for (const e of unused) db.run('DELETE FROM tasks WHERE id = ?', [e.id]);
  }

  /** Aufgaben über alle lebenden Notizen. status: 'open' | 'done' | 'all'; sort: 'due' | 'note'. */
  function listTasks(db, options) {
    const status = (options && options.status) || 'open';
    const q = ((options && options.query) || '').trim().toLowerCase();
    const tag = options && options.tag ? String(options.tag).trim() : '';
    const sort = options && options.sort === 'note' ? 'note' : 'due';
    const where = ['n.deleted_at IS NULL'];
    if (!(options && options.archived)) where.push('n.archived_at IS NULL'); // Archiv nur auf Wunsch (Export)
    const params = [];
    if (status === 'open') where.push('t.done = 0');
    else if (status === 'done') where.push('t.done = 1');
    if (tag) {
      where.push('EXISTS (SELECT 1 FROM note_tags nt JOIN tags tg ON tg.id = nt.tag_id WHERE nt.note_id = n.id AND tg.name = ? COLLATE NOCASE)');
      params.push(tag);
    }
    if (q) {
      const like = '%' + escapeLike(q) + '%';
      where.push("(nn_lower(t.text) LIKE ? ESCAPE '\\' OR nn_lower(n.title) LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
    const order = sort === 'note'
      ? 't.done, n.updated_at DESC, n.id, t.line_no'
      : 't.done, (t.due IS NULL), t.due, n.updated_at DESC, n.id, t.line_no';
    const rows = selectAll(db,
      `SELECT t.id, t.note_id, t.text, t.norm, t.done, t.due, t.line_no, t.created_at, t.done_at, t.parent_id, t.depth,
              n.title AS note_title, n.updated_at AS note_updated_at
         FROM tasks t JOIN notes n ON n.id = t.note_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}`, params);
    return withSubtaskInfo(db, rows);
  }

  /** Ergänzt jede Aufgabe um parent_text sowie sub_total / sub_done / sub_open (alle Unteraufgaben, jeder Tiefe),
   *  gezählt über alle lebenden Aufgaben, unabhängig von Filtern der Liste. */
  function withSubtaskInfo(db, rows) {
    if (!rows.length) return rows;
    const all = selectAll(db, 'SELECT t.id, t.parent_id, t.done, t.text FROM tasks t JOIN notes n ON n.id = t.note_id WHERE n.deleted_at IS NULL');
    const byId = new Map(all.map(t => [t.id, t]));
    const kids = new Map();
    for (const t of all) {
      if (t.parent_id != null && byId.has(t.parent_id)) {
        if (!kids.has(t.parent_id)) kids.set(t.parent_id, []);
        kids.get(t.parent_id).push(t);
      }
    }
    const memo = new Map();
    const count = id => {
      if (memo.has(id)) return memo.get(id);
      let total = 0, done = 0;
      for (const k of kids.get(id) || []) {
        const c = count(k.id);
        total += 1 + c.total;
        done += (k.done ? 1 : 0) + c.done;
      }
      const r = { total, done };
      memo.set(id, r);
      return r;
    };
    for (const r of rows) {
      const c = count(r.id);
      r.sub_total = c.total;
      r.sub_done = c.done;
      r.sub_open = c.total - c.done;
      const parent = r.parent_id != null ? byId.get(r.parent_id) : null;
      r.parent_text = parent ? parent.text : null;
    }
    return rows;
  }

  function countTasks(db, nowIso) {
    const now = nowIso || '0000-00-00';
    const today = now.slice(0, 10);
    const row = selectOne(db,
      `SELECT sum(t.done = 0) AS open, count(*) AS total,
              sum(t.done = 0 AND t.due IS NOT NULL AND ${overdueClause('t.due')}) AS overdue
         FROM tasks t JOIN notes n ON n.id = t.note_id WHERE n.deleted_at IS NULL AND n.archived_at IS NULL`, [today, now]);
    return { open: Number(row && row.open || 0), total: Number(row && row.total || 0), overdue: Number(row && row.overdue || 0) };
  }

  function getTask(db, id) {
    return selectOne(db, 'SELECT * FROM tasks WHERE id = ?', [id]);
  }

  function locateTask(db, taskId) {
    const T = global.NoNotesTasks;
    const row = getTask(db, taskId);
    if (!row) throw fail('TASK_NOT_FOUND', 'Aufgabe nicht gefunden.');
    const note = getNote(db, row.note_id);
    if (!note) throw fail('NOTE_NOT_FOUND', 'Notiz nicht gefunden.');
    const t = T.locate(note.body, row);
    if (!t) throw fail('TASK_STALE', 'Die Aufgabe steht nicht mehr so im Text.');
    return { note, line: t.lineIndex };
  }

  /** Meldung für eine Aufgabe, die wegen offener Unteraufgaben nicht abgeschlossen werden kann. */
  function subtasksOpenError(n) {
    const err = new Error(global.NoNotesTasks.openMessage(n));
    err.code = 'SUBTASKS_OPEN';
    err.open = n;
    return err;
  }

  /** Hakt eine Aufgabe im Notiztext ab bzw. öffnet sie wieder. Gibt die Notiz-ID zurück.
   *  Abhaken ist erst möglich, wenn alle Unteraufgaben erledigt sind (sonst Fehler mit code SUBTASKS_OPEN).
   *  Öffnen einer Unteraufgabe öffnet erledigte übergeordnete Aufgaben mit. */
  function setTaskDone(db, taskId, done) {
    const T = global.NoNotesTasks;
    const { note, line } = locateTask(db, taskId);
    let body;
    if (done) {
      const open = T.openSubtasks(note.body, line);
      if (open > 0) throw subtasksOpenError(open);
      body = T.setDone(note.body, line, true);
    } else {
      body = T.reopen(note.body, line);
    }
    updateNote(db, note.id, note.title, body);
    return note.id;
  }

  /** Doppelklick auf eine Aufgabe: schliesst sie samt Unteraufgaben ab, sonst öffnet sie wieder.
   *  Gibt { noteId, action: 'completed' | 'reopened' } zurück. */
  function toggleTaskTree(db, taskId) {
    const T = global.NoNotesTasks;
    const { note, line } = locateTask(db, taskId);
    const r = T.doubleClick(note.body, line);
    updateNote(db, note.id, note.title, r.body);
    return { noteId: note.id, action: r.action };
  }

  // ---------- Anhänge ----------

  function addAttachment(db, noteId, file) {
    db.run('INSERT INTO attachments (note_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [noteId, file.name || 'bild', file.mime || 'application/octet-stream', file.bytes.length, file.bytes, nowIso()]);
    return scalar(db, 'SELECT last_insert_rowid()');
  }

  function listAttachments(db, noteId) {
    return selectAll(db, 'SELECT id, note_id, name, mime, size, created_at FROM attachments WHERE note_id = ? ORDER BY id', [noteId]);
  }

  function getAttachment(db, id) {
    const row = selectOne(db, 'SELECT * FROM attachments WHERE id = ?', [id]);
    if (row && !(row.data instanceof Uint8Array)) row.data = new Uint8Array(row.data || []);
    return row;
  }

  function deleteAttachment(db, id) {
    db.run('DELETE FROM attachments WHERE id = ?', [id]);
  }

  /** Alle Anhänge lebender Notizen (mit Daten), für den Export. Archivierte nur mit options.archived. */
  function allAttachments(db, options) {
    const archived = !!(options && options.archived);
    return selectAll(db,
      `SELECT a.* FROM attachments a JOIN notes n ON n.id = a.note_id WHERE n.deleted_at IS NULL${archived ? '' : ' AND n.archived_at IS NULL'} ORDER BY a.id`)
      .map(r => { if (!(r.data instanceof Uint8Array)) r.data = new Uint8Array(r.data || []); return r; });
  }

  function attachmentsSize(db) {
    return scalar(db, 'SELECT coalesce(sum(size), 0) FROM attachments') || 0;
  }

  // ---------- Papierkorb ----------

  function countTrash(db) {
    return scalar(db, 'SELECT count(*) FROM notes WHERE deleted_at IS NOT NULL');
  }

  /** Holt eine Notiz aus dem Papierkorb zurück. Fehlt der alte Elternknoten, hängt sie an der Wurzel. */
  function restoreNote(db, id) {
    const note = getNote(db, id);
    if (!note || !note.deleted_at) return;
    let parentId = note.parent_id;
    if (parentId != null) {
      const parent = getNote(db, parentId);
      if (!parent || parent.deleted_at || parent.archived_at) parentId = null;
    }
    db.run('UPDATE notes SET deleted_at = NULL, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
      [parentId, nextSortOrder(db, parentId), nowIso(), id]);
  }

  function emptyTrash(db) {
    for (const row of selectAll(db, 'SELECT id FROM notes WHERE deleted_at IS NOT NULL')) purgeNote(db, row.id);
  }

  // ---------- Tags ----------

  function normalizeTag(name) {
    return String(name || '').replace(/\s+/g, ' ').replace(/^#/, '').trim();
  }

  function pruneTags(db) {
    db.run('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)');
  }

  function getTags(db, noteId) {
    return selectAll(db,
      'SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name COLLATE NOCASE', [noteId])
      .map(r => r.name);
  }

  /** Setzt die Tags einer Notiz (ersetzt die bisherigen). Doppelte und leere werden ignoriert. */
  function setTags(db, noteId, names) {
    const seen = new Set();
    const clean = [];
    for (const raw of names || []) {
      const name = normalizeTag(raw);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      clean.push(name);
    }
    db.run('DELETE FROM note_tags WHERE note_id = ?', [noteId]);
    for (const name of clean) {
      db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [name]);
      const tagId = scalar(db, 'SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [name]);
      db.run('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)', [noteId, tagId]);
    }
    pruneTags(db);
    db.run('UPDATE notes SET updated_at = ? WHERE id = ?', [nowIso(), noteId]);
    return clean;
  }

  /** Alle Tags mit Anzahl lebender Notizen. */
  function listAllTags(db) {
    return selectAll(db,
      `SELECT t.id, t.name, count(n.id) AS count
         FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id
         LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
        GROUP BY t.id ORDER BY t.name COLLATE NOCASE`);
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
        const due = q.due || null;
        if (e.text !== q.text || e.answer !== q.answer || e.line_no !== q.lineIndex || e.answered_at !== answeredAt || e.due !== due) {
          db.run('UPDATE questions SET text = ?, answer = ?, line_no = ?, answered_at = ?, due = ? WHERE id = ?',
            [q.text, q.answer, q.lineIndex, answeredAt, due, e.id]);
        }
      } else {
        db.run('INSERT INTO questions (note_id, text, norm, answer, line_no, created_at, answered_at, due) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [noteId, q.text, q.norm, q.answer, q.lineIndex, ts, q.answer ? ts : null, q.due || null]);
      }
    }
    for (const e of unused) db.run('DELETE FROM questions WHERE id = ?', [e.id]);
  }

  /** Fragen über alle lebenden Notizen. status: 'open' | 'answered' | 'all'; sort: 'note' | 'due'. */
  function listQuestions(db, options) {
    const status = (options && options.status) || 'open';
    const q = ((options && options.query) || '').trim().toLowerCase();
    const tag = options && options.tag ? String(options.tag).trim() : '';
    const sort = options && options.sort === 'due' ? 'due' : 'note';
    const where = ['n.deleted_at IS NULL'];
    if (!(options && options.archived)) where.push('n.archived_at IS NULL'); // Archiv nur auf Wunsch (Export)
    const params = [];
    if (tag) {
      where.push('EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id AND t.name = ? COLLATE NOCASE)');
      params.push(tag);
    }
    if (status === 'open') where.push('q.answer IS NULL');
    else if (status === 'answered') where.push('q.answer IS NOT NULL');
    if (q) {
      const like = '%' + escapeLike(q) + '%';
      where.push("(nn_lower(q.text) LIKE ? ESCAPE '\\' OR nn_lower(q.answer) LIKE ? ESCAPE '\\' OR nn_lower(n.title) LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }
    const order = sort === 'due'
      ? '(q.answer IS NOT NULL), (q.due IS NULL), q.due, n.updated_at DESC, n.id, q.line_no'
      : '(q.answer IS NOT NULL), n.updated_at DESC, n.id, q.line_no';
    return selectAll(db,
      `SELECT q.id, q.note_id, q.text, q.norm, q.answer, q.line_no, q.created_at, q.answered_at, q.due,
              n.title AS note_title, n.updated_at AS note_updated_at
         FROM questions q JOIN notes n ON n.id = q.note_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}`, params);
  }

  /** Überfällig: ohne Uhrzeit zählt der Tag, mit Uhrzeit der Zeitpunkt. */
  function overdueClause(col) {
    return `((length(${col}) = 10 AND ${col} < ?) OR (length(${col}) > 10 AND ${col} < ?))`;
  }

  function countQuestions(db, nowIso) {
    const now = nowIso || '0000-00-00';
    const today = now.slice(0, 10);
    const row = selectOne(db,
      `SELECT sum(q.answer IS NULL) AS open, count(*) AS total,
              sum(q.answer IS NULL AND q.due IS NOT NULL AND ${overdueClause('q.due')}) AS overdue
         FROM questions q JOIN notes n ON n.id = q.note_id WHERE n.deleted_at IS NULL AND n.archived_at IS NULL`, [today, now]);
    return { open: Number(row && row.open || 0), total: Number(row && row.total || 0), overdue: Number(row && row.overdue || 0) };
  }

  function getQuestion(db, id) {
    return selectOne(db, 'SELECT * FROM questions WHERE id = ?', [id]);
  }

  /** Schreibt die Antwort als "!"-Zeilen unter die Frage in der Notiz. Leerer Text entfernt die Antwort. */
  function answerQuestion(db, questionId, answerText) {
    const Q = global.NoNotesQuestions;
    const row = getQuestion(db, questionId);
    if (!row) throw fail('QUESTION_NOT_FOUND', 'Frage nicht gefunden.');
    const note = getNote(db, row.note_id);
    if (!note) throw fail('NOTE_NOT_FOUND', 'Notiz nicht gefunden.');
    const q = Q.locate(note.body, row);
    if (!q) throw fail('QUESTION_STALE', 'Die Frage steht nicht mehr so im Text.');
    const body = Q.writeAnswer(note.body, q, answerText);
    updateNote(db, note.id, note.title, body);
    return note.id;
  }

  /** Anzahl lebender Notizen; options.archived === false lässt archivierte weg. */
  function countNotes(db, options) {
    const live = options && options.archived === false ? ' AND archived_at IS NULL' : '';
    return scalar(db, `SELECT count(*) FROM notes WHERE deleted_at IS NULL${live}`);
  }

  /** Einstellungen der Ausprägung: defaultMapTitle (Titel einer neuen Mindmap, in der Sprache der Oberfläche). */
  function configure(options) {
    if (options && typeof options.defaultMapTitle === 'string' && options.defaultMapTitle.trim()) defaultMapTitle = options.defaultMapTitle.trim();
  }

  function getMapTitle(db) {
    return getMeta(db, 'map_title') || defaultMapTitle;
  }

  function setMapTitle(db, title) {
    setMeta(db, 'map_title', (title || '').trim() || defaultMapTitle);
  }

  /** Datenbank als Bytes (echte SQLite-Datei). */
  function exportBytes(db) {
    const bytes = db.export();
    registerFunctions(db); // export() hat sie entfernt
    return bytes;
  }

  global.NoNotesDB = {
    SCHEMA_VERSION,
    configure,
    open,
    listNotes,
    getTree,
    getNote,
    getPath,
    createNote,
    updateNote,
    renameNote,
    setParent,
    moveNote,
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
    findNoteByTitle,
    titleIndex,
    countTrash,
    restoreNote,
    emptyTrash,
    getTags,
    setTags,
    listAllTags,
    normalizeTag,
    syncTasks,
    listTasks,
    countTasks,
    getTask,
    setTaskDone,
    toggleTaskTree,
    isArchived,
    subtreeNoteIds,
    archiveCount,
    archiveNote,
    unarchiveNote,
    countArchived,
    addAttachment,
    listAttachments,
    getAttachment,
    deleteAttachment,
    allAttachments,
    attachmentsSize,
    exportBytes,
  };
})(window);
