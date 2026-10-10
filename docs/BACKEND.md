# Backend-Schnittstelle

Alles, was Oberfläche, Export, Kalender und Druck mit Daten tun, läuft über ein **Backend**
(`NoNotesBackend`, `packages/core/backend.js`). Die Oberfläche kennt keine Datenbank. Heute
gibt es ein Backend: das lokale (`packages/store-local/backend-local.js`, SQLite im Browser über
`packages/data/db.js`). Ein Backend über das Netz kann dieselben Methoden anbieten; die Oberfläche merkt
den Unterschied nicht.

## Regeln

1. **Alle Methoden sind asynchron** und liefern ein Promise. Auch das lokale Backend, damit nichts
   in der Oberfläche vom Warten überrascht wird, sobald ein Netz dazwischenliegt.
2. **Rückgabewerte sind einfache Daten**: Zahlen, Texte, Listen, Objekte. Keine Funktionen, keine
   `Map`, keine `Set`. Ausnahme sind die Bytes der Bilder (`Uint8Array`) in `getAttachment` und
   `allAttachments`. Das Verweisverzeichnis `titleIndex` liefert Paare `[Titel in Kleinschreibung, id]`.
3. **Fehler** sind abgelehnte Promises mit einem `Error`. Ein Fehler kann ein Feld `code` tragen
   (Kennung, siehe unten) und `params` (JSON-sichere Werte für Platzhalter). Die Oberfläche übersetzt
   Fehler über die Kennung mit `NoNotesBackend.errorText(e)`; die deutsche `message` ist nur der Rückfall.
4. **Änderungen werden gemeldet.** Jede Methode in `NoNotesBackend.MUTATING` ändert Daten. Ein Backend
   ruft danach `onChange(name)` auf. Die lokale Hülle plant daraufhin das Speichern; ein Server-Backend
   kann daran seine Synchronisation hängen.
5. **Wer das Backend benutzt, wartet** (`await`). Wer Daten zum Zeichnen braucht, holt sie vorab und
   zeichnet danach synchron (Beispiele: `prefetchAttachments` und `wikiResolver()` in der Oberfläche,
   der Bildvorabruf in `print.js`).

`NoNotesBackend.METHODS` ist die verbindliche Liste. `test/backend.cjs` prüft jedes Backend gegen den
Vertrag: Methoden vorhanden, Rückgaben JSON-sicher, Änderungen gemeldet, Fehlerkennungen.

## Methoden

Die Argumente entsprechen den Funktionen in `packages/data/db.js` ohne das erste Argument (die Datenbank).

| Bereich | Methoden |
| --- | --- |
| Einstellungen | `getMeta(key)`, `setMeta(key, value)`, `getMapTitle()`, `setMapTitle(title)` |
| Notizen lesen | `getTree({ archive })`, `getNote(id)`, `getPath(id)`, `listNotes(query, { tag, scope })`, `countNotes({ archived })`, `findNoteByTitle(title)`, `titleIndex()` |
| Notizen ändern | `createNote(parentId)`, `updateNote(id, title, body, options)`, `renameNote(id, title, options)`, `setParent(id, parentId)`, `moveNote(id, anchorId, 'before' \| 'after')`, `moveAmongSiblings(id, direction)`, `setCollapsed(id, collapsed)`, `setAllCollapsed(collapsed)` |
| Papierkorb | `deleteNote(id)`, `restoreNote(id)`, `purgeNote(id)`, `emptyTrash()`, `countTrash()` |
| Archiv | `isArchived(id)`, `archiveCount(ids)`, `archiveNote(id)`, `unarchiveNote(id)`, `countArchived()` |
| Tags | `getTags(noteId)`, `setTags(noteId, names)`, `listAllTags()` |
| Fragen | `listQuestions(options)`, `countQuestions(nowIso)`, `getQuestion(id)`, `answerQuestion(id, text)` |
| Aufgaben | `listTasks(options)`, `countTasks(nowIso)`, `getTask(id)`, `setTaskDone(id, done)`, `toggleTaskTree(id)` |
| Verlauf | `listHistory(noteId)`, `getHistoryVersion(noteId, historyId)`, `restoreHistoryVersion(noteId, historyId, options)`, `clearHistory(noteId)` |
| Bilder | `addAttachment(noteId, { name, mime, bytes })`, `listAttachments(noteId)`, `getAttachment(id)`, `deleteAttachment(id)`, `allAttachments({ archived })`, `attachmentsSize()` |

Reine Hilfsfunktionen ohne Datenzugriff liegen direkt auf `NoNotesBackend`: `normalizeTag(name)`,
`errorText(e)`, `missing(backend)`, `titleMap(pairs)`, `registerErrors({ KENNUNG: N_('Text') })` (eigene Fehlerkennungen anmelden).

## Gleichzeitiges Schreiben und Autor

`updateNote(id, title, body, options)` liefert den neuen Zeitstempel (`updated_at`) der Notiz. Mit `options.baseUpdatedAt` sagt der Aufrufer,
auf welchem Stand sein Text aufbaut. Hat die Notiz inzwischen einen anderen Zeitstempel, wirft die Methode `NOTE_CONFLICT` und schreibt nichts;
die Oberfläche liest dann die neuere Fassung (`getNote`), führt zeilenweise zusammen (`NoNotesMerge.merge3`) oder legt die strittigen Stellen
der Person vor. Ohne `baseUpdatedAt` gilt wie bisher der letzte Stand.

`options.author` (auch bei `renameNote` und `restoreHistoryVersion`) ist der Anzeigename des Schreibenden. Er landet in `notes.updated_by` und
in der Fassung im Verlauf (`listHistory` und `getHistoryVersion` liefern `author`). Wechselt der Autor, beginnt eine neue Fassung, auch ohne Pause.
Ein Backend, das Namen kennt, setzt `author` selbst und vertraut nicht auf den Aufrufer. Die lokale Ausprägung setzt keinen Autor.

## Fähigkeiten

Ein Backend darf ein Feld `capabilities` tragen. Heute ausgewertet: `files: false` blendet die Menüeinträge für Datenbankdateien aus
(Standard: `true`, wie das lokale Backend).

## Fehlerkennungen

| Kennung | Bedeutung |
| --- | --- |
| `NOT_NONOTES_FILE` | Die SQLite-Datei stammt nicht von NoNotes |
| `SCHEMA_TOO_NEW` | Datenbank mit neuerer Schema-Version (`params.version`, `params.unterstuetzt`) |
| `ARCHIVED_NO_CHILD` | Unter einer archivierten Notiz lässt sich nichts anlegen |
| `ARCHIVED_NO_MOVE` | Archivierte Notizen lassen sich nicht umhängen |
| `MOVE_INTO_SELF` | Eine Notiz kann nicht unter sich selbst hängen |
| `TARGET_NOT_FOUND`, `NOTE_NOT_FOUND`, `TASK_NOT_FOUND`, `QUESTION_NOT_FOUND` | Ziel oder Eintrag fehlt |
| `TASK_STALE`, `QUESTION_STALE` | Die Zeile steht nicht mehr so im Text |
| `HISTORY_NOT_FOUND` | Die Fassung gibt es nicht mehr (zum Beispiel gekürzt) |
| `ARCHIVED_READONLY` | Archivierte Notizen sind schreibgeschützt (Wiederherstellen einer Fassung) |
| `SUBTASKS_OPEN` | Eine Aufgabe lässt sich nicht abschliessen, solange Unteraufgaben offen sind (`open` = Anzahl) |
| `NOTE_CONFLICT` | Die Notiz wurde inzwischen von jemand anderem geändert (`params.updated_at` = aktueller Stand); nichts wurde geschrieben |

Neue Kennungen gehören mit ihrem deutschen Text in `NoNotesBackend.ERRORS` (mit `N_()` markiert),
damit sie übersetzt werden.

## Eine eigene Ausprägung anschliessen

Eine Ausprägung (`editions/<name>/`) liefert ein Objekt `window.NoNotesEdition = { id, createShell(host) }`.
Die **Hülle** (`shell`) kümmert sich um alles rund um die Daten, das nicht zur Oberfläche gehört: Start
(`shell.start()` gibt das Backend zurück), Speichern, Anmeldung, Verbindung. Die lokale Hülle ist
`packages/store-local/local-shell.js`; sie zeigt, welche Rückrufe die Oberfläche anbietet (`host`) und
welche Funktionen die Hülle bereitstellt (`start`, `afterReady`, `bind`, `flush`, `isDirty`,
`storageLines`, `saveLine`).
