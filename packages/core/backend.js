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
    // Anhänge
    'addAttachment', 'listAttachments', 'getAttachment', 'deleteAttachment', 'allAttachments', 'attachmentsSize',
  ];

  /** Methoden, die Daten ändern. Ein Backend meldet danach eine Änderung (onChange), damit die lokale
   *  Ausprägung speichern kann. */
  const MUTATING = new Set([
    'setMeta', 'setMapTitle', 'createNote', 'updateNote', 'renameNote', 'setParent', 'moveNote',
    'moveAmongSiblings', 'setCollapsed', 'setAllCollapsed', 'deleteNote', 'purgeNote', 'restoreNote',
    'emptyTrash', 'archiveNote', 'unarchiveNote', 'setTags', 'answerQuestion', 'setTaskDone',
    'toggleTaskTree', 'addAttachment', 'deleteAttachment',
  ]);

  /** Prüft, ob ein Backend alle Methoden hat. Gibt die fehlenden zurück. */
  function missing(backend) {
    return METHODS.filter(name => typeof backend[name] !== 'function');
  }

  /** Verweisindex aus der Paarliste, als Map von Titel (klein) auf id. */
  function titleMap(pairs) {
    return new Map(pairs);
  }

  /** Bereinigt einen Tag-Namen (reine Funktion, ohne Datenzugriff): Leerraum zusammenfassen, führendes # weg. */
  function normalizeTag(name) {
    return String(name || '').replace(/\s+/g, ' ').replace(/^#/, '').trim();
  }

  global.NoNotesBackend = { METHODS, MUTATING, missing, titleMap, normalizeTag };
})(window);
