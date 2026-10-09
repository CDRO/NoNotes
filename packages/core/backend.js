/* NoNotes – Backend-Schnittstelle.
   Alles, was die Oberfläche, der Export, der Kalender und der Druck mit Daten tun, läuft über ein Backend.
   Ein Backend ist ein Objekt mit asynchronen Methoden (alle liefern ein Promise). Die lokale Ausprägung
   hat ein Backend über SQLite im Browser (packages/store-local/backend-local.js); ein Server-Backend
   kann dieselben Methoden über das Netz anbieten. Die Oberfläche kennt nur diese Schnittstelle.

   Regeln für jedes Backend:
   - Alle Methoden sind asynchron. Fehler kommen als abgelehntes Promise mit Error; ein Fehler kann ein
     Feld code tragen (zum Beispiel SUBTASKS_OPEN), das erhalten bleiben muss.
   - Rückgabewerte sind einfache Daten (Zahlen, Texte, Listen, Objekte, Uint8Array für Bilder), keine
     Funktionen und keine Map. titleIndex liefert Paare [Titel in Kleinschreibung, id].
   - Die Methoden entsprechen den Funktionen in packages/data/db.js ohne das erste Argument (die Datenbank).
     Beschreibung der einzelnen Methoden: docs/BACKEND.md. */
(function (global) {
  'use strict';

  const N_ = global.NoNotesI18n.N_;

  /** Alle Methoden, die ein Backend bieten muss. */
  const METHODS = [
    // Einstellungen
    'getMeta', 'setMeta', 'getMapTitle', 'setMapTitle',
    // Notizen und Baum
    'getTree', 'getNote', 'getPath', 'listNotes', 'countNotes', 'createNote', 'updateNote', 'renameNote',
    'setParent', 'moveNote', 'moveAmongSiblings', 'setCollapsed', 'setAllCollapsed',
    // Papierkorb
    'deleteNote', 'purgeNote', 'restoreNote', 'emptyTrash', 'countTrash',
    // Archiv
    'isArchived', 'archiveCount', 'archiveNote', 'unarchiveNote', 'countArchived',
    // Verweise zwischen Notizen
    'findNoteByTitle', 'titleIndex',
    // Tags
    'getTags', 'setTags', 'listAllTags',
    // Fragen
    'listQuestions', 'countQuestions', 'getQuestion', 'answerQuestion',
    // Aufgaben
    'listTasks', 'countTasks', 'getTask', 'setTaskDone', 'toggleTaskTree',
    // Verlauf
    'listHistory', 'getHistoryVersion', 'restoreHistoryVersion', 'clearHistory',
    // Anhänge
    'addAttachment', 'listAttachments', 'getAttachment', 'deleteAttachment', 'allAttachments', 'attachmentsSize',
  ];

  /** Methoden, die Daten ändern. Ein Backend meldet danach eine Änderung (onChange), damit die lokale
   *  Ausprägung speichern kann. */
  const MUTATING = new Set([
    'setMeta', 'setMapTitle', 'createNote', 'updateNote', 'renameNote', 'setParent', 'moveNote',
    'moveAmongSiblings', 'setCollapsed', 'setAllCollapsed', 'deleteNote', 'purgeNote', 'restoreNote',
    'emptyTrash', 'archiveNote', 'unarchiveNote', 'setTags', 'answerQuestion', 'setTaskDone',
    'toggleTaskTree', 'addAttachment', 'deleteAttachment', 'restoreHistoryVersion', 'clearHistory',
  ]);

  /** Prüft, ob ein Backend alle Methoden hat. Gibt die fehlenden zurück. */
  function missing(backend) {
    return METHODS.filter(name => typeof backend[name] !== 'function');
  }

  /** Verweisindex aus der Paarliste, als Map von Titel (klein) auf id. */
  function titleMap(pairs) {
    return new Map(pairs);
  }

  /** Meldungen zu Fehlerkennungen (err.code). Die deutschen Texte sind die Schlüssel für die Übersetzung;
   *  Platzhalter werden aus err.params gefüllt. N_ markiert den Text für die Extraktion. */
  const ERRORS = {
    NOT_NONOTES_FILE: N_('Diese SQLite-Datei stammt nicht von NoNotes (keine Tabelle "notes").'),
    SCHEMA_TOO_NEW: N_('Diese Datenbank hat Schema-Version {version}, diese App versteht nur bis {unterstuetzt}. Bitte App aktualisieren.'),
    ARCHIVED_NO_CHILD: N_('Unter einer archivierten Notiz lässt sich nichts anlegen.'),
    ARCHIVED_NO_MOVE: N_('Archivierte Notizen lassen sich nicht umhängen.'),
    MOVE_INTO_SELF: N_('Eine Notiz kann nicht unter sich selbst hängen.'),
    TARGET_NOT_FOUND: N_('Zielnotiz nicht gefunden.'),
    NOTE_NOT_FOUND: N_('Notiz nicht gefunden.'),
    TASK_NOT_FOUND: N_('Aufgabe nicht gefunden.'),
    TASK_STALE: N_('Die Aufgabe steht nicht mehr so im Text.'),
    QUESTION_NOT_FOUND: N_('Frage nicht gefunden.'),
    QUESTION_STALE: N_('Die Frage steht nicht mehr so im Text.'),
    HISTORY_NOT_FOUND: N_('Diese Fassung gibt es nicht mehr.'),
    ARCHIVED_READONLY: N_('Archivierte Notizen sind schreibgeschützt. Erst zurückholen.'),
  };

  /** Text eines Fehlers in der Sprache der Oberfläche. Kennt ein Backend die Kennung nicht, bleibt seine Meldung. */
  function errorText(e) {
    const I18n = global.NoNotesI18n;
    if (e && e.code === 'SUBTASKS_OPEN' && typeof e.open === 'number' && global.NoNotesTasks) return global.NoNotesTasks.openMessage(e.open);
    if (e && e.code && ERRORS[e.code]) return I18n.t(ERRORS[e.code], e.params); // i18n-dynamic
    if (e && e.message) return String(e.message);
    return I18n.t('Unbekannter Fehler');
  }

  /** Bereinigt einen Tag-Namen (reine Funktion, ohne Datenzugriff): Leerraum zusammenfassen, führendes # weg. */
  function normalizeTag(name) {
    return String(name || '').replace(/\s+/g, ' ').replace(/^#/, '').trim();
  }

  global.NoNotesBackend = { METHODS, MUTATING, ERRORS, missing, titleMap, normalizeTag, errorText };
})(window);
