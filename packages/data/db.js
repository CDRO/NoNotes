/* NoNotes – Datenbankschicht (SQLite über sql.js).
   Alles, was SQL spricht, steht hier. Die Oberfläche kennt nur diese Funktionen. */
(function (global) {
  'use strict';

  const SCHEMA_VERSION = 18; // 16: Personen an Aufgaben (v2.11.0); 17: Termine mit ">", Erinnerungen (v3.0.0); 18: Link am Knoten (v3.2.0)
  // Regeln, nach denen die Indexe (Fragen, Aufgaben, Querverweise) aus den Texten entstehen. Steigt die Zahl ohne neues Schema
  // (2: Blöcke in Listen, v2.6.0; 3: Aufgaben, Fragen und Entscheide in Tabellenfeldern, v2.11.0), füllt das Öffnen die Indexe
  // neu; ältere Versionen öffnen die Datei weiter.
  const INDEX_RULES = 3;

  // Verlauf pro Notiz: eine «Arbeitsphase» endet nach so langer Pause oder so langer Dauer; danach beginnt eine neue Fassung.
  // Aufbewahrt werden höchstens so viele Fassungen und Tage; meta history_max_versions / history_max_days / history_enabled ('0') ändern das.
  const HISTORY_GAP_MS = 5 * 60 * 1000;
  const HISTORY_BURST_MS = 30 * 60 * 1000;
  const HISTORY_MAX_VERSIONS = 50;
  const HISTORY_MAX_DAYS = 180;
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

  /* Das Standardschema (Version 14). Eine neue Datei bekommt es ganz; eine bestehende Datei, gleich welchen Alters,
     wird beim Öffnen in einem Schritt daran angeglichen (upgrade): fehlende Tabellen und Spalten kommen dazu, danach
     werden die Indexe über die Texte (Fragen und Entscheide, Aufgaben, Querverweise) neu gefüllt. Es gibt keine
     Schritt-für-Schritt-Migrationen mehr; die Versionsnummer sagt nur, ob eine Datei schon auf diesem Stand ist
     oder von einer neueren App stammt. */
  const SCHEMA = [
    { name: 'notes', columns: [
      ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
      ['title', "TEXT NOT NULL DEFAULT ''"],
      ['body', "TEXT NOT NULL DEFAULT ''"],
      ['created_at', 'TEXT NOT NULL'],          // ISO 8601, UTC
      ['updated_at', 'TEXT NOT NULL'],
      ['parent_id', 'INTEGER'],                 // NULL = hängt an der Wurzel
      ['sort_order', 'INTEGER NOT NULL DEFAULT 0'],
      ['collapsed', 'INTEGER NOT NULL DEFAULT 0'],
      ['deleted_at', 'TEXT'],                   // gesetzt = im Papierkorb
      ['archived_at', 'TEXT'],                  // gesetzt = im Archiv (ausgeblendet, durchsuchbar, schreibgeschützt)
      ['updated_by', 'TEXT'],                   // wer den heutigen Stand geschrieben hat (Anzeigename, leer = unbekannt)
      ['side', 'TEXT'],                         // Hauptast der Mindmap: 'left' | 'right', NULL = die Mindmap wählt (Schema 17)
      ['link', 'TEXT'],                         // Link am Knoten: Webadresse, Mail, Pfad, Notiz oder Bereich dieser App (Schema 18)
    ], indexes: [
      'CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes (updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_notes_parent ON notes (parent_id, sort_order)',
    ] },
    // schema_version, index_rules, created_at, map_title, accent, theme, calendar_uid, calendar_sequence, calendar_known
    { name: 'meta', columns: [['key', 'TEXT PRIMARY KEY'], ['value', 'TEXT NOT NULL']] },
    // Index über die ?-, ?!-, !- und !!-Zeilen, aus dem Text abgeleitet (packages/core/questions.js)
    { name: 'questions', columns: [
      ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
      ['note_id', 'INTEGER NOT NULL'],
      ['text', 'TEXT NOT NULL'],
      ['norm', 'TEXT NOT NULL'],                // normalisiert, zum Wiedererkennen nach Änderungen
      ['answer', 'TEXT'],                       // NULL = offen
      ['line_no', 'INTEGER NOT NULL'],
      ['created_at', 'TEXT NOT NULL'],
      ['answered_at', 'TEXT'],
      ['due', 'TEXT'],                          // Frist aus ">Datum [Zeit]" (der späteste Termin): YYYY-MM-DD oder YYYY-MM-DDTHH:MM
      ['reminders', 'TEXT'],                    // JSON [ISO …]: die früheren Termine der Zeile, Erinnerungen (Schema 17)
      ['kind', "TEXT NOT NULL DEFAULT 'question'"], // 'question' oder 'decision'
      ['decided', 'TEXT'],                      // Tag des Entscheids aus dem Text, YYYY-MM-DD
      ['people', 'TEXT'],                       // JSON [{ handle, optional }] aus "@kürzel" und "(@kürzel)"
      ['details', 'TEXT'],                      // Beschreibung eines mehrzeiligen Eintrags ("?!``` … ```") ohne Unter-Einträge
      ['parent_id', 'INTEGER'],                 // Unter-Eintrag: der Block, in dem er steht
    ], indexes: ['CREATE INDEX IF NOT EXISTS idx_questions_note ON questions (note_id)', 'CREATE INDEX IF NOT EXISTS idx_questions_parent ON questions (parent_id)'] },
    { name: 'tags', columns: [['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'], ['name', 'TEXT NOT NULL UNIQUE COLLATE NOCASE']] },
    { name: 'note_tags', columns: [['note_id', 'INTEGER NOT NULL'], ['tag_id', 'INTEGER NOT NULL']], constraint: 'PRIMARY KEY (note_id, tag_id)' },
    { name: 'attachments', columns: [
      ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
      ['note_id', 'INTEGER NOT NULL'],
      ['name', 'TEXT NOT NULL'],
      ['mime', 'TEXT NOT NULL'],
      ['size', 'INTEGER NOT NULL'],
      ['data', 'BLOB NOT NULL'],
      ['created_at', 'TEXT NOT NULL'],
    ], indexes: ['CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments (note_id)'] },
    // Index über die Aufgabenzeilen "- [ ]", aus dem Text abgeleitet (packages/core/tasks.js)
    { name: 'tasks', columns: [
      ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
      ['note_id', 'INTEGER NOT NULL'],
      ['text', 'TEXT NOT NULL'],
      ['norm', 'TEXT NOT NULL'],
      ['done', 'INTEGER NOT NULL DEFAULT 0'],
      ['due', 'TEXT'],                          // Frist (der späteste Termin der Zeile)
      ['reminders', 'TEXT'],                    // JSON [ISO …]: die früheren Termine, Erinnerungen (Schema 17)
      ['line_no', 'INTEGER NOT NULL'],
      ['created_at', 'TEXT NOT NULL'],
      ['done_at', 'TEXT'],
      ['parent_id', 'INTEGER'],                 // Hauptaufgabe einer Unteraufgabe
      ['depth', 'INTEGER NOT NULL DEFAULT 0'],
      ['people', 'TEXT'],                       // JSON [{ handle, optional, inherited? }] aus "@kürzel" und "(@kürzel)", geerbt von der Hauptaufgabe (Schema 16)
    ], indexes: ['CREATE INDEX IF NOT EXISTS idx_tasks_note ON tasks (note_id)'] },
    // Verlauf: pro Fassung ein Rückwärts-Patch zur nächstneueren (packages/core/history.js)
    { name: 'note_history', columns: [
      ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
      ['note_id', 'INTEGER NOT NULL'],
      ['at', 'TEXT NOT NULL'],                  // Zeitpunkt der letzten Änderung dieser Fassung
      ['started_at', 'TEXT NOT NULL'],          // Beginn der Arbeitsphase, die auf diese Fassung folgte
      ['open', 'INTEGER NOT NULL DEFAULT 0'],   // 1 = die Arbeitsphase läuft noch, der Patch wird bei jeder Änderung nachgeführt
      ['title', 'TEXT NOT NULL'],               // Titel dieser Fassung
      ['p', 'INTEGER NOT NULL'],                // gemeinsamer Anfang mit der nächstneueren Fassung
      ['s', 'INTEGER NOT NULL'],                // gemeinsames Ende
      ['r', 'TEXT NOT NULL'],                   // der Teil dazwischen, wie er in dieser Fassung steht
      ['author', 'TEXT'],                       // wer diese Fassung geschrieben hat (Anzeigename, leer = unbekannt)
    ], indexes: ['CREATE INDEX IF NOT EXISTS idx_history_note ON note_history (note_id, id)'] },
    // Querverweise [[Titel*]] je Notiz (packages/core/links.js); Ziele werden beim Lesen über den Titel aufgelöst
    { name: 'note_links', columns: [
      ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
      ['note_id', 'INTEGER NOT NULL'],
      ['title', 'TEXT NOT NULL'],
      ['key', 'TEXT NOT NULL'],
      ['line_no', 'INTEGER NOT NULL'],
    ], indexes: ['CREATE INDEX IF NOT EXISTS idx_note_links_note ON note_links (note_id)'] },
  ];

  function createTableSql(t) {
    const cols = t.columns.map(([name, ddl]) => `${name} ${ddl}`);
    if (t.constraint) cols.push(t.constraint);
    return `CREATE TABLE IF NOT EXISTS ${t.name} (${cols.join(', ')})`;
  }

  function columnsOf(db, table) {
    return selectAll(db, `PRAGMA table_info(${table})`).map(c => c.name);
  }

  /** Spaltendefinition für ALTER TABLE ADD COLUMN: NOT NULL geht dort nur mit Vorgabewert. */
  function addableDdl(ddl) {
    return /\bDEFAULT\b/.test(ddl) ? ddl : ddl.replace(/\s*NOT NULL\b/, '');
  }

  /** Legt alle Tabellen und Indexe des Standardschemas an (neue Datei). */
  function createSchema(db) {
    for (const t of SCHEMA) db.exec(createTableSql(t));
    for (const t of SCHEMA) for (const sql of t.indexes || []) db.exec(sql);
    setMeta(db, 'schema_version', SCHEMA_VERSION);
    setMeta(db, 'index_rules', INDEX_RULES);
    setMeta(db, 'created_at', nowIso());
    setMeta(db, 'map_title', defaultMapTitle);
  }

  /** Gleicht eine bestehende Datei in einem Schritt an das Standardschema an. Dateien jeder bisherigen Version (1 bis 16)
   *  kommen so auf den heutigen Stand; was schon da ist, bleibt unberührt. Von vor Schema 17 (v3.0.0) werden die Termine
   *  "@Datum" am Zeilenende zu ">Datum" (rewriteDates). Gibt die Zahl der umgeschriebenen Notizen zurück. */
  function upgrade(db, from) {
    const hadTree = hasTable(db, 'notes') && columnsOf(db, 'notes').includes('sort_order');
    for (const t of SCHEMA) {
      if (!hasTable(db, t.name)) { db.exec(createTableSql(t)); continue; }
      const have = columnsOf(db, t.name);
      for (const [name, ddl] of t.columns) if (!have.includes(name)) db.exec(`ALTER TABLE ${t.name} ADD COLUMN ${name} ${addableDdl(ddl)}`);
    }
    for (const t of SCHEMA) for (const sql of t.indexes || []) db.exec(sql);
    if (!hadTree) {
      // Dateien von vor dem Baum (Schema 1): alle Notizen hängen an der Wurzel, in der Reihenfolge ihres Entstehens.
      selectAll(db, 'SELECT id FROM notes ORDER BY created_at, id').forEach((row, i) => db.run('UPDATE notes SET sort_order = ? WHERE id = ?', [i, row.id]));
    }
    if (getMeta(db, 'map_title') == null) setMeta(db, 'map_title', defaultMapTitle);
    const rewritten = from < 17 ? rewriteDates(db) : 0;
    reindex(db);
    setMeta(db, 'schema_version', SCHEMA_VERSION);
    return rewritten;
  }

  /** Umstellung auf v3.0.0: in allen Notizen (auch Archiv und Papierkorb) wird jedes "@Datum" am Zeilenende zu ">Datum"
   *  (NoNotesDates.rewriteLegacy). Zeitstempel und Verlauf bleiben; die Länge der Texte auch, darum passen die Fassungen im
   *  Verlauf weiter. Der Zeitpunkt steht in meta dates_migrated_at (der Verlauf zeigt ihn als Vermerk). */
  function rewriteDates(db) {
    const D = global.NoNotesDates;
    if (!D || !D.rewriteLegacy) return 0;
    let n = 0;
    for (const row of selectAll(db, "SELECT id, body FROM notes WHERE body LIKE '%@%'")) {
      const body = D.rewriteLegacy(row.body);
      if (body !== row.body) { db.run('UPDATE notes SET body = ? WHERE id = ?', [body, row.id]); n++; }
    }
    setMeta(db, 'dates_migrated_at', nowIso());
    setMeta(db, 'dates_migrated_notes', n);
    return n;
  }

  /** Die Indexe aus den Texten neu füllen: so gelten die heutigen Regeln (Termine mit Uhrzeit, Unteraufgaben, Entscheide,
   *  Personen, Querverweise, Blöcke in Listen) auch für Texte, die mit einer älteren Version geschrieben wurden. */
  function reindex(db) {
    for (const row of selectAll(db, 'SELECT id, body, deleted_at FROM notes')) {
      syncQuestions(db, row.id, row.body);
      syncTasks(db, row.id, row.body);
      if (!row.deleted_at) syncLinks(db, row.id, row.body);
    }
    setMeta(db, 'index_rules', INDEX_RULES);
  }

  /** Öffnet eine Datenbank aus Bytes (oder legt eine neue an) und bringt sie auf das aktuelle Schema.
   *  Fremde SQLite-Dateien (Tabellen vorhanden, aber keine "notes") werden abgelehnt.
   *  info (wahlweise, wird gefüllt): upgradedFrom (die Version davor, wenn angeglichen wurde), rewritten (Notizen, deren
   *  Termine von "@" auf ">" umgestellt wurden). */
  function open(SQL, bytes, info) {
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
        if (version < SCHEMA_VERSION) {
          const rewritten = upgrade(db, version);
          if (info) Object.assign(info, { upgradedFrom: version, rewritten });
        } else if (Number(getMeta(db, 'index_rules') || 1) < INDEX_RULES) reindex(db);
      }
      registerFunctions(db);
      return db;
    } catch (e) {
      db.close();
      throw e;
    }
  }

  /** Sieht in eine Datei, ohne sie zu ändern: { version, legacyNotes } – Schema-Version und wie viele Notizen beim Öffnen von "@" auf
   *  ">" umgestellt würden (nur bei einer Datei von vor Schema 17, sonst 0). Leer oder fremd: null. Für die Rückfrage vor der
   *  Umstellung (Sicherung herunterladen). */
  function inspect(SQL, bytes) {
    if (!bytes || !bytes.length) return null;
    let db;
    try { db = new SQL.Database(bytes); } catch (e) { return null; }
    try {
      if (!hasTable(db, 'notes')) return null;
      const version = hasTable(db, 'meta') ? Number(getMeta(db, 'schema_version') || 1) : 1;
      let legacyNotes = 0;
      const D = global.NoNotesDates;
      if (version < 17 && D && D.hasLegacy) {
        for (const row of selectAll(db, "SELECT body FROM notes WHERE body LIKE '%@%'")) if (D.hasLegacy(row.body)) legacyNotes++;
      }
      return { version, legacyNotes };
    } catch (e) {
      return null;
    } finally {
      db.close();
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

  /** Alle Ziele für [[Titel]]-Verweise: je lebende Notiz (auch archiviert) ein Paar [Titel in Kleinschreibung, id]. Bei gleichem Titel
   *  steht die gewinnende zuletzt (die aktive, dann die zuletzt geänderte), new Map(paare) ergibt also den Index Titel → id. Seit
   *  2.9.0 sind alle Notizen dabei (auch gleichnamige und solche ohne Titel), damit [[Titel#42]] prüfen kann, ob es 42 gibt. */
  function titleIndex(db) {
    return selectAll(db, 'SELECT id, title FROM notes WHERE deleted_at IS NULL ORDER BY (archived_at IS NOT NULL) DESC, updated_at, id')
      .map(r => [String(r.title || '').trim().toLowerCase(), r.id]);
  }

  /** Alle lebenden Notizen als flache Liste für den Baum. Archivierte fehlen, ausser options.archive ist
   *  true (alle) oder eine Liste von Notiz-IDs: dann erscheinen genau diese archivierten Notizen samt
   *  ihren archivierten Vorfahren (für Suchtreffer im Archiv). Fragen und Aufgaben archivierter Notizen
   *  zählen nicht in den Marken. */
  function getTree(db, options) {
    const archive = options && options.archive;
    const rows = selectAll(db,
      `SELECT id, title, parent_id, sort_order, collapsed, archived_at, updated_at, side, link,
              CASE WHEN archived_at IS NULL THEN (SELECT count(*) FROM questions q WHERE q.note_id = notes.id AND q.answer IS NULL) ELSE 0 END AS badge,
              CASE WHEN archived_at IS NULL THEN (SELECT count(*) FROM questions q WHERE q.note_id = notes.id AND q.answer IS NULL AND q.kind = 'decision') ELSE 0 END AS dbadge,
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

  /** Anzeigename des Schreibenden aus den Optionen (leer = unbekannt). */
  function authorOf(options) {
    const a = options && options.author;
    return a == null || String(a).trim() === '' ? null : String(a).trim().slice(0, 80);
  }

  /** Speichert Titel und Text einer Notiz und gibt den neuen Zeitstempel (updated_at) zurück.
   *  options.baseUpdatedAt: der Zeitstempel, auf dem der neue Text aufbaut. Hat die Notiz inzwischen einen anderen,
   *  hat jemand anders sie geändert: Fehler NOTE_CONFLICT (params.updated_at nennt den aktuellen Stand), nichts wird geschrieben.
   *  options.author: Anzeigename des Schreibenden; wechselt er, beginnt eine neue Fassung im Verlauf.
   *  options.newVersion: erzwingt eine neue Fassung im Verlauf. */
  function updateNote(db, id, title, body, options) {
    const ts = nowIso();
    const D = global.NoNotesDates;
    if (D && D.rewriteLegacy && body && body.includes('@')) body = D.rewriteLegacy(body); // alte Termine "@Datum" → ">Datum" (v3.0.0)
    const old = selectOne(db, 'SELECT title, body, updated_at, created_at, updated_by FROM notes WHERE id = ?', [id]);
    const base = options && options.baseUpdatedAt;
    if (old && base != null && old.updated_at !== base) {
      throw fail('NOTE_CONFLICT', 'Die Notiz wurde inzwischen von jemand anderem geändert.', { updated_at: old.updated_at });
    }
    const author = authorOf(options);
    if (old) recordHistory(db, id, old, title, body, ts, !!(options && options.newVersion) || (old.updated_by || null) !== author);
    db.run('UPDATE notes SET title = ?, body = ?, updated_at = ?, updated_by = ? WHERE id = ?', [title, body, ts, author, id]);
    syncQuestions(db, id, body);
    syncTasks(db, id, body);
    syncLinks(db, id, body);
    return ts;
  }

  function renameNote(db, id, title, options) {
    const ts = nowIso();
    const old = selectOne(db, 'SELECT title, body, updated_at, created_at, updated_by FROM notes WHERE id = ?', [id]);
    const author = authorOf(options);
    if (old) recordHistory(db, id, old, title, old.body, ts, (old.updated_by || null) !== author);
    db.run('UPDATE notes SET title = ?, updated_at = ?, updated_by = ? WHERE id = ?', [title, ts, author, id]);
    return ts;
  }

  // ---------- Link am Knoten (v3.2.0) ----------

  const LINK_MAX = 2000;

  /** Prüft einen Link für einen Knoten und gibt ihn bereinigt zurück (leer: null). Erlaubt sind Webadressen (http, https, auch
   *  «www.…»), mailto:, Pfade auf Dateien und Ordner (file://, \\server\freigabe, C:\…) und Adressen dieser App (#w=…, #n=…, /w/…).
   *  Andere Schemata (javascript:, data:) und Steuerzeichen werden abgelehnt (INVALID_LINK). */
  function normalizeLink(value) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return null;
    const ok = v.length <= LINK_MAX && !/[\u0000-\u001f\u007f]/.test(v) && (
      /^(https?:\/\/[^\s]+|mailto:[^\s]+|file:\/\/[^\n]+)$/i.test(v)
      || /^#[^\s]*$/.test(v) || /^\/(?![/\\])[^\s]*$/.test(v)
      || /^\\\\[^\\/\s]+\\/.test(v) || /^[a-z]:[\\/]/i.test(v) || /^www\.[^\s]+$/i.test(v));
    if (!ok) throw fail('INVALID_LINK', 'Dieser Link lässt sich nicht hinterlegen. Erlaubt sind Webadressen, Mailadressen, Pfade und Links auf Notizen oder Bereiche.');
    return /^www\./i.test(v) ? 'https://' + v : v;
  }

  /** Hinterlegt am Knoten einen Link (oder entfernt ihn mit leerem Wert). Gibt den gespeicherten Link zurück. «Geändert» bleibt. */
  function setNoteLink(db, id, link) {
    const note = getNote(db, id);
    if (!note || note.deleted_at) throw fail('NOTE_NOT_FOUND', 'Notiz nicht gefunden.');
    if (note.archived_at) throw fail('ARCHIVED_READONLY', 'Archivierte Notizen sind schreibgeschützt. Erst zurückholen.');
    const clean = normalizeLink(link);
    db.run('UPDATE notes SET link = ? WHERE id = ?', [clean, id]);
    return clean;
  }

  // ---------- Verlauf ----------

  function historySetting(db, key, fallback) {
    const v = Number(getMeta(db, key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  /** Hält die Fassungen einer Notiz fest, bevor sie überschrieben wird. old ist der Stand vor der Änderung.
   *  Während einer Arbeitsphase (Pausen unter 5 Minuten, höchstens 30 Minuten) bleibt es bei einer einzigen Fassung:
   *  dem Stand vor der Phase, dessen Patch bei jeder Änderung auf den neuen Text umgerechnet wird. */
  function recordHistory(db, id, old, newTitle, newBody, ts, force) {
    const H = global.NoNotesHistory;
    if (!H || getMeta(db, 'history_enabled') === '0') return;
    if (old.title === newTitle && old.body === newBody) return;
    const now = Date.parse(ts);
    const last = Date.parse(old.updated_at);
    const open = selectOne(db, 'SELECT * FROM note_history WHERE note_id = ? AND open = 1 ORDER BY id DESC LIMIT 1', [id]);
    let continuing = !force && Number.isFinite(now) && Number.isFinite(last) && (now - last) < HISTORY_GAP_MS;
    if (continuing) {
      // Beginn der Phase: bei offener Fassung deren Zeitpunkt, sonst (Phase ab leerer Notiz) die Erstellung der Notiz
      const started = Date.parse(open ? open.started_at : old.created_at);
      if (Number.isFinite(started) && now - started >= HISTORY_BURST_MS) continuing = false;
    }
    if (continuing) {
      if (!open) return; // die Phase begann bei einer leeren Notiz: es gibt nichts zu sichern
      const before = H.apply(old.body, open);
      const patch = H.diff(newBody, before);
      db.run('UPDATE note_history SET p = ?, s = ?, r = ? WHERE id = ?', [patch.p, patch.s, patch.r, open.id]);
      return;
    }
    if (open) {
      // Phase zu Ende. War am Ende alles wieder wie vorher, ist die Fassung überflüssig.
      if (H.apply(old.body, open) === old.body && open.title === old.title) db.run('DELETE FROM note_history WHERE id = ?', [open.id]);
      else db.run('UPDATE note_history SET open = 0 WHERE id = ?', [open.id]);
    }
    if (!old.title && !old.body) return; // nichts zu sichern
    const patch = H.diff(newBody, old.body);
    db.run('INSERT INTO note_history (note_id, at, started_at, open, title, p, s, r, author) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)',
      [id, old.updated_at, ts, old.title, patch.p, patch.s, patch.r, old.updated_by || null]);
    pruneHistory(db, id, ts);
  }

  /** Kürzt den Verlauf von hinten: zu alte und zu viele Fassungen gehen, die neueren bleiben lesbar. */
  function pruneHistory(db, id, ts) {
    const maxVersions = Math.floor(historySetting(db, 'history_max_versions', HISTORY_MAX_VERSIONS));
    const maxDays = historySetting(db, 'history_max_days', HISTORY_MAX_DAYS);
    const cutoff = new Date(Date.parse(ts) - maxDays * 86400000).toISOString();
    const expired = scalar(db, 'SELECT max(id) FROM note_history WHERE note_id = ? AND open = 0 AND at < ?', [id, cutoff]);
    if (expired != null) db.run('DELETE FROM note_history WHERE note_id = ? AND id <= ?', [id, expired]);
    db.run('DELETE FROM note_history WHERE note_id = ? AND id NOT IN (SELECT id FROM note_history WHERE note_id = ? ORDER BY id DESC LIMIT ?)', [id, id, maxVersions]);
  }

  /** Fassungen einer Notiz, neueste zuerst. Ohne den Text selbst: Zeitpunkt, Titel und Umfang der Änderung danach. */
  function listHistory(db, noteId) {
    const note = selectOne(db, 'SELECT title, body FROM notes WHERE id = ?', [noteId]);
    if (!note) return [];
    const out = [];
    let len = note.body.length;
    let newerTitle = note.title;
    for (const r of selectAll(db, 'SELECT * FROM note_history WHERE note_id = ? ORDER BY id DESC', [noteId])) {
      const added = Math.max(0, len - r.p - r.s);   // Zeichen, die seitdem dazukamen
      const titleChanged = r.title !== newerTitle;
      const newLen = len - added + r.r.length;
      // eine Fassung ohne Unterschied zur neueren (Rückkehr zum Stand von vorher) zeigt nur dasselbe noch einmal
      if (added || r.r.length || titleChanged) {
        out.push({ id: r.id, at: r.at, title: r.title, author: r.author || null, added, removed: r.r.length, titleChanged, length: newLen });
      }
      len = newLen;
      newerTitle = r.title;
    }
    return out;
  }

  /** Eine Fassung samt Text, aus dem aktuellen Stand durch die Patches zurückgerechnet. */
  function getHistoryVersion(db, noteId, historyId) {
    const H = global.NoNotesHistory;
    const note = selectOne(db, 'SELECT title, body FROM notes WHERE id = ?', [noteId]);
    if (!note) throw fail('NOTE_NOT_FOUND', 'Notiz nicht gefunden.');
    let text = note.body;
    for (const r of selectAll(db, 'SELECT * FROM note_history WHERE note_id = ? ORDER BY id DESC', [noteId])) {
      text = H.apply(text, r);
      if (r.id === historyId) return { id: r.id, at: r.at, title: r.title, author: r.author || null, body: text };
    }
    throw fail('HISTORY_NOT_FOUND', 'Diese Fassung gibt es nicht mehr.');
  }

  /** Macht eine frühere Fassung wieder zum Text der Notiz. Der Stand davor bleibt als Fassung erhalten. */
  function restoreHistoryVersion(db, noteId, historyId, options) {
    const note = selectOne(db, 'SELECT archived_at, deleted_at FROM notes WHERE id = ?', [noteId]);
    if (!note || note.deleted_at) throw fail('NOTE_NOT_FOUND', 'Notiz nicht gefunden.');
    if (note.archived_at) throw fail('ARCHIVED_READONLY', 'Archivierte Notizen sind schreibgeschützt. Erst zurückholen.');
    const v = getHistoryVersion(db, noteId, historyId);
    const ts = updateNote(db, noteId, v.title, v.body, { newVersion: true, author: options && options.author });
    return { ts, title: v.title, body: v.body };
  }

  function clearHistory(db, noteId) {
    db.run('DELETE FROM note_history WHERE note_id = ?', [noteId]);
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
    if (pid != null) db.run('UPDATE notes SET side = NULL WHERE id = ?', [id]); // die Seite gilt nur für Hauptäste
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
    // Mindmap (v3.0.0): ein Hauptast kommt auf die Seite seines Nachbarn; unter einer Notiz gilt keine Seite
    db.run('UPDATE notes SET side = ? WHERE id = ?', [pid == null ? scalar(db, 'SELECT side FROM notes WHERE id = ?', [anchorId]) : null, id]);
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

  /** Seiten der Hauptäste in der Mindmap (v3.0.0): sides { id: 'left' | 'right' | null }. Die Mindmap setzt sie, sobald ein Ast an der
   *  Wurzel auftaucht, und hält sie dann fest; verschieben per Ziehen oder Rechtsklick, «Neu verteilen» setzt alle. */
  function setSides(db, sides) {
    for (const [id, side] of Object.entries(sides || {})) {
      const v = side === 'left' || side === 'right' ? side : null;
      db.run('UPDATE notes SET side = ? WHERE id = ?', [v, Number(id)]);
    }
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
      // rücken die Kinder eines Hauptasts an die Wurzel, bleiben sie auf seiner Seite der Mindmap
      db.run('UPDATE notes SET parent_id = ?, sort_order = ?, side = ? WHERE id = ?',
        [note.parent_id, nextSortOrder(db, note.parent_id), note.parent_id == null ? (note.side || null) : null, child.id]);
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
    db.run('DELETE FROM note_links WHERE note_id = ?', [id]);
    db.run('DELETE FROM note_history WHERE note_id = ?', [id]);
    db.run('DELETE FROM notes WHERE id = ?', [id]);
    pruneTags(db);
  }

  // ---------- In einen anderen Bereich auslösen (v3.2.0) ----------
  // Ein Knoten wird zur Wurzel eines neuen Bereichs: seine Unternotizen (auch archivierte, nicht die im Papierkorb) ziehen samt Tags,
  // Bildern und Verlauf in eine andere Datenbank um und werden dort Hauptäste. Der Knoten selbst bleibt im alten Bereich, mit seinem
  // Text und einem Link auf den neuen; die Unternotizen kommen dort in den Papierkorb. Texte schreibt NoNotesMove um (rewrite).

  /** Paket für importSubtree: { root: { id, title }, notes (Tiefensuche, Eltern vor Kindern; parent_id null = Hauptast), attachments
   *  (mit Daten), history (älteste zuerst), titles (titleIndex dieses Bereichs, für die [[…]]-Verweise) }. */
  function exportSubtree(db, rootId) {
    const root = getNote(db, rootId);
    if (!root || root.deleted_at) throw fail('NOTE_NOT_FOUND', 'Notiz nicht gefunden.');
    const ids = subtreeNoteIds(db, rootId).filter(id => id !== rootId);
    const notes = ids.map(id => {
      const n = getNote(db, id);
      return {
        id: n.id, parent_id: n.parent_id === rootId ? null : n.parent_id, title: n.title, body: n.body, created_at: n.created_at,
        updated_at: n.updated_at, sort_order: n.sort_order, collapsed: n.collapsed, archived_at: n.archived_at || null,
        updated_by: n.updated_by || null, link: n.link || null, tags: getTags(db, id),
      };
    });
    const list = ids.length ? ids.join(',') : 'NULL';
    const attachments = selectAll(db, `SELECT * FROM attachments WHERE note_id IN (${list}) ORDER BY id`)
      .map(a => Object.assign(a, { data: a.data instanceof Uint8Array ? a.data : new Uint8Array(a.data || []) }));
    const history = selectAll(db, `SELECT note_id, at, started_at, open, title, p, s, r, author FROM note_history WHERE note_id IN (${list}) ORDER BY id`);
    return { root: { id: root.id, title: root.title }, notes, attachments, history, titles: titleIndex(db) };
  }

  /** Text oder Link einer Notiz neu setzen, ohne den Verlauf zu brechen: zuerst eine Fassung des alten Stands, dann der neue Text.
   *  touch: «Geändert» auf jetzt (für Notizen, die jemand offen haben kann). */
  function replaceBody(db, id, body, touch) {
    const old = selectOne(db, 'SELECT title, body, updated_at, created_at, updated_by FROM notes WHERE id = ?', [id]);
    if (!old || old.body === body) return;
    const ts = nowIso();
    recordHistory(db, id, old, old.title, body, ts, true);
    db.run(touch ? 'UPDATE notes SET body = ?, updated_at = ? WHERE id = ?' : 'UPDATE notes SET body = ? WHERE id = ?', touch ? [body, ts, id] : [body, id]);
    syncQuestions(db, id, body);
    syncTasks(db, id, body);
    syncLinks(db, id, body);
  }

  /** Legt ein Paket aus exportSubtree an der Wurzel dieser Datenbank an (gewöhnlich eine neue, leere). rewrite(kind, value, maps):
   *  kind 'body' oder 'link', maps { notes, atts } (Map alt → neu); gibt den neuen Wert zurück. Ergebnis: { notes, atts } als Paare
   *  [alt, neu]. «Erstellt» und «Geändert» bleiben, wie sie waren. */
  function importSubtree(db, pkg, rewrite) {
    const notes = new Map();
    const atts = new Map();
    for (const n of pkg.notes || []) {
      const parent = n.parent_id == null ? null : notes.get(n.parent_id);
      if (n.parent_id != null && parent == null) continue; // Eltern fehlen im Paket: nicht anlegen
      db.run(`INSERT INTO notes (title, body, created_at, updated_at, parent_id, sort_order, collapsed, archived_at, updated_by, link)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [n.title || '', n.body || '', n.created_at || nowIso(), n.updated_at || nowIso(), parent, parent == null ? nextSortOrder(db, null) : n.sort_order,
          n.collapsed ? 1 : 0, n.archived_at || null, n.updated_by || null, n.link || null]);
      const id = scalar(db, 'SELECT last_insert_rowid()');
      notes.set(n.id, id);
      for (const name of n.tags || []) {
        const clean = normalizeTag(name);
        if (!clean) continue;
        db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [clean]);
        db.run('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)', [id, scalar(db, 'SELECT id FROM tags WHERE name = ? COLLATE NOCASE', [clean])]);
      }
    }
    for (const a of pkg.attachments || []) {
      if (!notes.has(a.note_id)) continue;
      const bytes = a.data instanceof Uint8Array ? a.data : new Uint8Array(a.data || []);
      db.run('INSERT INTO attachments (note_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [notes.get(a.note_id), a.name || 'bild', a.mime || 'application/octet-stream', bytes.length, bytes, a.created_at || nowIso()]);
      atts.set(a.id, scalar(db, 'SELECT last_insert_rowid()'));
    }
    for (const h of pkg.history || []) {
      if (!notes.has(h.note_id)) continue;
      db.run('INSERT INTO note_history (note_id, at, started_at, open, title, p, s, r, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [notes.get(h.note_id), h.at, h.started_at, h.open ? 1 : 0, h.title, h.p, h.s, h.r, h.author || null]);
    }
    const maps = { notes, atts };
    for (const n of pkg.notes || []) {
      const id = notes.get(n.id);
      if (id == null) continue;
      syncQuestions(db, id, n.body || '');
      syncTasks(db, id, n.body || '');
      syncLinks(db, id, n.body || '');
      if (!rewrite) continue;
      replaceBody(db, id, rewrite('body', n.body || '', maps), false);
      const link = n.link ? rewrite('link', n.link, maps) : null;
      if (link !== (n.link || null)) db.run('UPDATE notes SET link = ? WHERE id = ?', [link || null, id]);
    }
    return { notes: [...notes], atts: [...atts] };
  }

  /** Der alte Bereich nach dem Umzug: die mitgenommenen Notizen kommen in den Papierkorb (sie behalten ihren Platz, damit «Zurückholen»
   *  sie unter ihre Eltern bringt), der Knoten bekommt den Link auf den neuen Bereich. rewrite(kind, value) schreibt Texte und Links
   *  der übrigen Notizen um, die auf mitgenommene zeigen. Gibt die Zahl der Notizen im Papierkorb zurück. */
  function finishDetach(db, rootId, pkg, link, rewrite) {
    const ts = nowIso();
    const moved = (pkg.notes || []).map(n => n.id);
    for (const id of moved) db.run('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [ts, ts, id]);
    db.run('UPDATE notes SET link = ?, collapsed = 0, updated_at = ? WHERE id = ?', [normalizeLink(link), ts, rootId]);
    if (rewrite) {
      for (const row of selectAll(db, 'SELECT id, body, link FROM notes WHERE deleted_at IS NULL')) {
        replaceBody(db, row.id, rewrite('body', row.body), true);
        if (row.id !== rootId && row.link) {
          const next = rewrite('link', row.link);
          if (next !== row.link) db.run('UPDATE notes SET link = ?, updated_at = ? WHERE id = ?', [next || null, ts, row.id]);
        }
      }
    }
    return moved.length;
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
      const people = t.people && t.people.length ? JSON.stringify(t.people) : null;
      const reminders = t.reminders && t.reminders.length ? JSON.stringify(t.reminders) : null;
      if (idx >= 0) {
        const e = unused.splice(idx, 1)[0];
        let doneAt = e.done_at;
        if (done && !e.done) doneAt = ts;
        if (!done) doneAt = null;
        if (e.text !== t.text || e.done !== done || e.due !== t.due || e.line_no !== t.lineIndex || e.done_at !== doneAt
            || (e.parent_id == null ? null : e.parent_id) !== parentId || (e.depth || 0) !== t.depth || (e.people || null) !== people
            || (e.reminders || null) !== reminders) {
          db.run('UPDATE tasks SET text = ?, done = ?, due = ?, reminders = ?, line_no = ?, done_at = ?, parent_id = ?, depth = ?, people = ? WHERE id = ?',
            [t.text, done, t.due, reminders, t.lineIndex, doneAt, parentId, t.depth, people, e.id]);
        }
        ids.push(e.id);
      } else {
        db.run('INSERT INTO tasks (note_id, text, norm, done, due, reminders, line_no, created_at, done_at, parent_id, depth, people) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [noteId, t.text, t.norm, done, t.due, reminders, t.lineIndex, ts, done ? ts : null, parentId, t.depth, people]);
        ids.push(scalar(db, 'SELECT last_insert_rowid()'));
      }
    }
    for (const e of unused) db.run('DELETE FROM tasks WHERE id = ?', [e.id]);
  }

  // ---------- Querverweise ----------

  /** Gleicht die Querverweise einer Notiz mit ihrem Text ab (packages/core/links.js liest sie). */
  function syncLinks(db, noteId, body) {
    const L = global.NoNotesLinks;
    if (!L) return;
    db.run('DELETE FROM note_links WHERE note_id = ?', [noteId]);
    for (const l of L.parse(body)) {
      db.run('INSERT INTO note_links (note_id, title, key, line_no) VALUES (?, ?, ?, ?)', [noteId, l.title, l.key, l.lineIndex]);
    }
  }

  /** Querverweise zwischen lebenden Notizen: [{ from_id, to_id, title }], in der Reihenfolge der Notizen und des Textes.
   *  Das Ziel ist die Notiz mit diesem Titel wie bei [[Titel]] (ohne Gross-/Kleinschreibung; bei mehreren die aktive, dann die
   *  zuletzt geänderte), bei [[Titel#42]] die Notiz 42 (NoNotesLinks.lookup); ohne Ziel oder auf sich selbst gibt es keinen
   *  Eintrag. Archivierte Notizen zählen an beiden Enden. */
  function getLinks(db) {
    const L = global.NoNotesLinks;
    if (!L) return [];
    const find = L.resolver(titleIndex(db));
    const out = [];
    for (const r of selectAll(db, 'SELECT l.note_id, l.title, l.key FROM note_links l JOIN notes n ON n.id = l.note_id WHERE n.deleted_at IS NULL ORDER BY l.note_id, l.id')) {
      const to = find(r.title);
      if (to.id == null || to.id === r.note_id) continue;
      out.push({ from_id: r.note_id, to_id: to.id, title: to.label });
    }
    return out;
  }

  /** Aufgaben über alle lebenden Notizen. status: 'open' | 'done' | 'all'; sort: 'due' | 'note' | 'person' (nach der ersten
   *  verantwortlichen Person, ohne Person am Schluss, darin nach Termin); person: nur Aufgaben, die diese Person nennen (auch
   *  geerbt von der Hauptaufgabe). people je Zeile als Liste [{ handle, optional, inherited? }]. */
  function listTasks(db, options) {
    const status = (options && options.status) || 'open';
    const q = ((options && options.query) || '').trim().toLowerCase();
    const tag = options && options.tag ? String(options.tag).trim() : '';
    const person = options && options.person ? String(options.person).trim().replace(/^@/, '').toLowerCase() : '';
    const sort = options && (options.sort === 'note' || options.sort === 'person') ? options.sort : 'due';
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
    if (person) {
      where.push("nn_lower(t.people) LIKE ? ESCAPE '\\'");
      params.push('%"handle":"' + escapeLike(person) + '"%');
    }
    const order = sort === 'note'
      ? 't.done, n.updated_at DESC, n.id, t.line_no, t.id'
      : 't.done, (t.due IS NULL), t.due, n.updated_at DESC, n.id, t.line_no, t.id';
    const rows = selectAll(db,
      `SELECT t.id, t.note_id, t.text, t.norm, t.done, t.due, t.reminders, t.line_no, t.created_at, t.done_at, t.parent_id, t.depth, t.people,
              n.title AS note_title, n.updated_at AS note_updated_at
         FROM tasks t JOIN notes n ON n.id = t.note_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}`, params);
    for (const r of rows) { r.people = peopleOf(r); r.reminders = remindersOf(r); }
    if (sort === 'person') {
      // nach der ersten verantwortlichen Person (sonst der ersten genannten); ohne Person am Schluss; sonst bleibt die Reihenfolge
      const key = r => { const p = r.people.find(x => !x.optional) || r.people[0]; return p ? p.handle.toLowerCase() : null; };
      const order = rows.map((r, i) => ({ r, i, k: key(r) }));
      order.sort((a, b) => (a.r.done - b.r.done) || ((a.k == null) - (b.k == null)) || (a.k && b.k ? a.k.localeCompare(b.k) : 0) || a.i - b.i);
      return withSubtaskInfo(db, order.map(x => x.r));
    }
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
    const row = selectOne(db, 'SELECT * FROM tasks WHERE id = ?', [id]);
    return row ? Object.assign(row, { people: peopleOf(row), reminders: remindersOf(row) }) : row;
  }

  function locateTask(db, taskId) {
    const T = global.NoNotesTasks;
    const row = getTask(db, taskId);
    if (!row) throw fail('TASK_NOT_FOUND', 'Aufgabe nicht gefunden.');
    const note = getNote(db, row.note_id);
    if (!note) throw fail('NOTE_NOT_FOUND', 'Notiz nicht gefunden.');
    const t = T.locate(note.body, row);
    if (!t) throw fail('TASK_STALE', 'Die Aufgabe steht nicht mehr so im Text.');
    return { note, line: t.lineIndex, slot: t.cell ? t.slot : null };
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
    const { note, line, slot } = locateTask(db, taskId);
    let body;
    if (done) {
      const open = T.openSubtasks(note.body, line, slot);
      if (open > 0) throw subtasksOpenError(open);
      body = T.setDone(note.body, line, true, slot);
    } else {
      body = T.reopen(note.body, line, slot);
    }
    updateNote(db, note.id, note.title, body);
    return note.id;
  }

  /** Doppelklick auf eine Aufgabe: schliesst sie samt Unteraufgaben ab, sonst öffnet sie wieder.
   *  Gibt { noteId, action: 'completed' | 'reopened' } zurück. */
  function toggleTaskTree(db, taskId) {
    const T = global.NoNotesTasks;
    const { note, line, slot } = locateTask(db, taskId);
    const r = T.doubleClick(note.body, line, slot);
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
   *  normalisierten Text wiedererkannt, damit Anlagedatum und Nummer erhalten bleiben. Unter-Einträge eines Blocks
   *  zeigen mit parent_id auf ihn (der Block steht im Text vor ihnen und hat seine Nummer darum schon). */
  function syncQuestions(db, noteId, body) {
    const Q = global.NoNotesQuestions;
    if (!Q) return;
    const parsed = Q.parse(body);
    const existing = selectAll(db, 'SELECT * FROM questions WHERE note_id = ? ORDER BY line_no, id', [noteId]);
    const unused = existing.slice();
    const ts = nowIso();
    const ids = [];
    for (const q of parsed) {
      const idx = unused.findIndex(e => e.norm === q.norm && (e.kind || 'question') === q.kind);
      const people = q.people.length ? JSON.stringify(q.people) : null;
      const reminders = q.reminders && q.reminders.length ? JSON.stringify(q.reminders) : null;
      const decided = q.decided || null;
      const details = q.details || null;
      const parentId = q.parent != null && ids[q.parent] != null ? ids[q.parent] : null;
      if (idx >= 0) {
        const e = unused.splice(idx, 1)[0];
        let answeredAt = e.answered_at;
        if (q.answer && !e.answer) answeredAt = ts;
        if (!q.answer) answeredAt = null;
        const due = q.due || null;
        if (e.text !== q.text || e.answer !== q.answer || e.line_no !== q.lineIndex || e.answered_at !== answeredAt || e.due !== due
          || (e.kind || 'question') !== q.kind || (e.decided || null) !== decided || (e.people || null) !== people
          || (e.details || null) !== details || (e.parent_id == null ? null : e.parent_id) !== parentId || (e.reminders || null) !== reminders) {
          db.run('UPDATE questions SET text = ?, answer = ?, line_no = ?, answered_at = ?, due = ?, reminders = ?, kind = ?, decided = ?, people = ?, details = ?, parent_id = ? WHERE id = ?',
            [q.text, q.answer, q.lineIndex, answeredAt, due, reminders, q.kind, decided, people, details, parentId, e.id]);
        }
        ids.push(e.id);
      } else {
        db.run('INSERT INTO questions (note_id, text, norm, answer, line_no, created_at, answered_at, due, reminders, kind, decided, people, details, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [noteId, q.text, q.norm, q.answer, q.lineIndex, ts, q.answer ? ts : null, q.due || null, reminders, q.kind, decided, people, details, parentId]);
        ids.push(scalar(db, 'SELECT last_insert_rowid()'));
      }
    }
    for (const e of unused) db.run('DELETE FROM questions WHERE id = ?', [e.id]);
  }

  /** Personen aus der Indexspalte: [{ handle, optional }]. */
  function peopleOf(row) {
    if (!row || !row.people) return [];
    try { const v = JSON.parse(row.people); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }

  /** Erinnerungen aus der Indexspalte: [ISO …] aufsteigend (Schema 17). */
  function remindersOf(row) {
    if (!row || !row.reminders) return [];
    if (Array.isArray(row.reminders)) return row.reminders;
    try { const v = JSON.parse(row.reminders); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch (e) { return []; }
  }

  /** Fragen oder Entscheide über alle lebenden Notizen. kind: 'question' (Standard) | 'decision' | 'all';
   *  status: 'open' | 'answered' | 'all'; sort: 'note' | 'due'; person: nur Einträge, die dieses Kürzel nennen. */
  function listQuestions(db, options) {
    const status = (options && options.status) || 'open';
    const kind = options && (options.kind === 'decision' || options.kind === 'all') ? options.kind : 'question';
    const q = ((options && options.query) || '').trim().toLowerCase();
    const tag = options && options.tag ? String(options.tag).trim() : '';
    const person = options && options.person ? String(options.person).trim().replace(/^@/, '').toLowerCase() : '';
    const sort = options && options.sort === 'due' ? 'due' : 'note';
    const where = ['n.deleted_at IS NULL'];
    const params = [];
    if (kind !== 'all') { where.push('q.kind = ?'); params.push(kind); }
    if (!(options && options.archived)) where.push('n.archived_at IS NULL'); // Archiv nur auf Wunsch (Export)
    if (tag) {
      where.push('EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id AND t.name = ? COLLATE NOCASE)');
      params.push(tag);
    }
    if (status === 'open') where.push('q.answer IS NULL');
    else if (status === 'answered') where.push('q.answer IS NOT NULL');
    if (person) {
      where.push("nn_lower(q.people) LIKE ? ESCAPE '\\'");
      params.push('%"handle":"' + escapeLike(person) + '"%');
    }
    if (q) {
      const like = '%' + escapeLike(q) + '%';
      where.push("(nn_lower(q.text) LIKE ? ESCAPE '\\' OR nn_lower(q.answer) LIKE ? ESCAPE '\\' OR nn_lower(q.details) LIKE ? ESCAPE '\\' OR nn_lower(n.title) LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like);
    }
    const order = sort === 'due'
      ? '(q.answer IS NOT NULL), (q.due IS NULL), q.due, n.updated_at DESC, n.id, q.line_no'
      : '(q.answer IS NOT NULL), n.updated_at DESC, n.id, q.line_no';
    return selectAll(db,
      `SELECT q.id, q.note_id, q.text, q.norm, q.answer, q.line_no, q.created_at, q.answered_at, q.due, q.reminders, q.kind, q.decided, q.people,
              q.details, q.parent_id, p.text AS parent_text, p.kind AS parent_kind, (p.answer IS NOT NULL) AS parent_answered,
              ${SUB_COUNTS},
              n.title AS note_title, n.updated_at AS note_updated_at
         FROM questions q JOIN notes n ON n.id = q.note_id LEFT JOIN questions p ON p.id = q.parent_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}`, params).map(withSubs);
  }

  // Unter-Einträge eines Blocks je Art: gesamt und offen
  const SUB_COUNTS = ['decision', 'question'].map(k => {
    const base = `FROM questions c WHERE c.parent_id = q.id AND c.kind = '${k}'`;
    return `(SELECT count(*) ${base}) AS sub_${k}s, (SELECT count(*) ${base} AND c.answer IS NULL) AS sub_${k}s_open`;
  }).join(', ');

  /** Indexzeile für Aufrufer: people als Liste, parent_answered als Wahrheitswert, Unter-Einträge als
   *  sub: { decisions, decisionsOpen, questions, questionsOpen } (oder null, wenn es keine gibt). */
  function withSubs(r) {
    const sub = { decisions: Number(r.sub_decisions || 0), decisionsOpen: Number(r.sub_decisions_open || 0), questions: Number(r.sub_questions || 0), questionsOpen: Number(r.sub_questions_open || 0) };
    delete r.sub_decisions; delete r.sub_decisions_open; delete r.sub_questions; delete r.sub_questions_open;
    if (r.parent_id == null) { r.parent_text = null; r.parent_kind = null; r.parent_answered = null; }
    else r.parent_answered = !!r.parent_answered;
    return Object.assign(r, { people: peopleOf(r), reminders: remindersOf(r), details: r.details || null, sub: sub.decisions + sub.questions ? sub : null });
  }

  /** Alle Kürzel, die Fragen, Entscheide und Aufgaben lebender Notizen nennen (ohne @, jede Schreibweise einmal), alphabetisch.
   *  options.of: 'questions' (Fragen und Entscheide) oder 'tasks' (Aufgaben, seit 2.11.0); ohne: alle. */
  function listPeople(db, options) {
    const of = options && options.of;
    const seen = new Map();
    const tables = of === 'questions' ? ['questions'] : of === 'tasks' ? ['tasks'] : ['questions', 'tasks'];
    for (const table of tables) {
      for (const r of selectAll(db, `SELECT x.people FROM ${table} x JOIN notes n ON n.id = x.note_id WHERE n.deleted_at IS NULL AND n.archived_at IS NULL AND x.people IS NOT NULL`)) {
        for (const p of peopleOf(r)) if (p.handle && !seen.has(p.handle.toLowerCase())) seen.set(p.handle.toLowerCase(), p.handle);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  /** Überfällig: ohne Uhrzeit zählt der Tag, mit Uhrzeit der Zeitpunkt. */
  function overdueClause(col) {
    return `((length(${col}) = 10 AND ${col} < ?) OR (length(${col}) > 10 AND ${col} < ?))`;
  }

  /** Zähler der Fragen (open, total, overdue) und darunter decisions: dieselben Zahlen für Entscheide. */
  function countQuestions(db, nowIso) {
    const now = nowIso || '0000-00-00';
    const today = now.slice(0, 10);
    const count = kind => {
      const row = selectOne(db,
        `SELECT sum(q.answer IS NULL) AS open, count(*) AS total,
                sum(q.answer IS NULL AND q.due IS NOT NULL AND ${overdueClause('q.due')}) AS overdue
           FROM questions q JOIN notes n ON n.id = q.note_id WHERE n.deleted_at IS NULL AND n.archived_at IS NULL AND q.kind = ?`, [today, now, kind]);
      return { open: Number(row && row.open || 0), total: Number(row && row.total || 0), overdue: Number(row && row.overdue || 0) };
    };
    return Object.assign(count('question'), { decisions: count('decision') });
  }

  function getQuestion(db, id) {
    const row = selectOne(db, 'SELECT * FROM questions WHERE id = ?', [id]);
    return row ? Object.assign(row, { people: peopleOf(row), reminders: remindersOf(row), details: row.details || null }) : row;
  }

  /** Schreibt die Antwort als "!"-Zeilen unter die Frage in der Notiz, bei einem Entscheid als "!!"-Zeilen, die erste mit
   *  dem Datum (options.decided, wie es im Text stehen soll; sonst das Datum aus dem Text, sonst heute). Leerer Text entfernt
   *  die Antwort. options.author wie bei updateNote. */
  function answerQuestion(db, questionId, answerText, options) {
    const Q = global.NoNotesQuestions;
    const row = getQuestion(db, questionId);
    if (!row) throw fail('QUESTION_NOT_FOUND', 'Frage nicht gefunden.');
    const note = getNote(db, row.note_id);
    if (!note) throw fail('NOTE_NOT_FOUND', 'Notiz nicht gefunden.');
    const q = Q.locate(note.body, row);
    if (!q) throw fail('QUESTION_STALE', 'Die Frage steht nicht mehr so im Text.');
    const body = Q.writeAnswer(note.body, q, answerText, options);
    updateNote(db, note.id, note.title, body, { author: authorOf(options) });
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
    normalizeLink,
    setNoteLink,
    exportSubtree,
    importSubtree,
    finishDetach,
    configure,
    open,
    inspect,
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
    setSides,
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
    listPeople,
    findNoteByTitle,
    titleIndex,
    countTrash,
    restoreNote,
    emptyTrash,
    listHistory,
    getHistoryVersion,
    restoreHistoryVersion,
    clearHistory,
    getTags,
    setTags,
    listAllTags,
    normalizeTag,
    syncTasks,
    syncLinks,
    getLinks,
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
