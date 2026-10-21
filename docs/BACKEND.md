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

`NoNotesBackend.METHODS` ist die verbindliche Liste. `test/app.cjs` prüft jedes Backend gegen den
Vertrag: Methoden vorhanden, Rückgaben JSON-sicher, Änderungen gemeldet, Fehlerkennungen.

## Methoden

Die Argumente entsprechen den Funktionen in `packages/data/db.js` ohne das erste Argument (die Datenbank).

| Bereich | Methoden |
| --- | --- |
| Einstellungen | `getMeta(key)`, `setMeta(key, value)`, `getMapTitle()`, `setMapTitle(title)` |
| Notizen lesen | `getTree({ archive })`, `getNote(id)`, `getPath(id)`, `listNotes(query, { tag, scope })`, `countNotes({ archived })`, `findNoteByTitle(title)`, `titleIndex()`, `getLinks()` (Querverweise `[[Titel*]]` als `{ from_id, to_id, title }`, seit v1.8.0, Schema 13) |
| Notizen ändern | `createNote(parentId)`, `updateNote(id, title, body, options)`, `renameNote(id, title, options)`, `setParent(id, parentId)`, `moveNote(id, anchorId, 'before' \| 'after')`, `moveAmongSiblings(id, direction)`, `setCollapsed(id, collapsed)`, `setAllCollapsed(collapsed)` |
| Papierkorb | `deleteNote(id)`, `restoreNote(id)`, `purgeNote(id)`, `emptyTrash()`, `countTrash()` |
| Archiv | `isArchived(id)`, `archiveCount(ids)`, `archiveNote(id)`, `unarchiveNote(id)`, `countArchived()` |
| Tags | `getTags(noteId)`, `setTags(noteId, names)`, `listAllTags()` |
| Fragen und Entscheide | `listQuestions({ kind, status, query, tag, person, sort, archived })` (`kind`: `'question'` (Standard), `'decision'` oder `'all'`; `person`: nur Einträge, die dieses Kürzel nennen; jede Zeile trägt `kind`, `decided` (Tag des Entscheids aus dem Text, `YYYY-MM-DD`) und `people` (`[{ handle, optional }]`); seit v2.4.0, Schema 15, dazu `details` (Beschreibung eines Blocks oder `null`), `parent_id`, `parent_text`, `parent_kind`, `parent_answered` (Unter-Eintrag: sein Block) und `sub` (`{ decisions, decisionsOpen, questions, questionsOpen }` oder `null`); die Suche umfasst die Beschreibung), `countQuestions(nowIso)` (`{ open, total, overdue, decisions: { open, total, overdue } }`), `getQuestion(id)`, `answerQuestion(id, text, options)` (bei einem Entscheid `!!`-Zeilen, die erste mit `options.decided`, zum Beispiel `'14.10.2026'`, sonst dem Datum aus dem Text, sonst heute; `options.author` wie bei `updateNote`), `listPeople()` (alle Kürzel lebender Notizen, seit v1.11.0, Schema 14) |
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

Optionale Eigenschaften der Hülle: `userName` (Anzeigename für Autor in Notiz und Verlauf), `role`, und seit v1.5.1 **`readOnly`**
(true = die Person darf nichts ändern). Dann blendet die Oberfläche alle Schreibwege aus (Attribut `data-write`, Einträge des
Kontextmenüs, Kästchen, Antwortfelder, Titel/Text/Tags gesperrt wie bei archivierten Notizen), jede Funktion, die schreiben
würde, bricht mit dem Hinweis «Nur lesen» ab, und das Backend, das die Oberfläche und die Erweiterungen sehen, lehnt alle
schreibenden Aufrufe mit der Kennung `READ_ONLY` ab. **Ausgenommen sind `setCollapsed` und `setAllCollapsed`**: Auf- und Zuklappen der Mindmap
ist Ansicht, nicht Inhalt; ob es für alle gilt oder pro Person gespeichert wird, entscheidet das Backend. Hauptfarbe und Design
lassen sich im Lesemodus nicht ändern (sie gelten für den ganzen Arbeitsbereich). Die lokale Hülle meldet nie `readOnly`. Im Lesemodus ist auch der Kalenderexport ausgeblendet, weil er Kennungen in der Datenbank ablegt.

**`embeds`** (seit v1.6.0): `'off'` schaltet das Einbetten von Videos aus (die Vorschau zeigt dann nur Links). Sonst gilt `'ask'`: Videos von YouTube, Vimeo und Dailymotion erscheinen als Karte und laden erst nach einem Klick
(siehe [EMBEDS.md](EMBEDS.md)). Wer die Seite mit einem Schutzkopf (CSP) ausliefert, muss `frame-src` für die Hosts aus `NoNotesEmbeds.frameHosts()` öffnen, sonst blockiert der Browser den Rahmen.

**`templates`** (seit v2.5.0): die Ablage der Vorlagen; ohne sie gibt es keine Einträge für Vorlagen. Dateiformat, Platzhalter und das
Anlegen der Notizen stehen in `packages/core/templates.js` (`NoNotesTemplates`); die Hülle sagt nur, wo Vorlagen liegen:

| Methode | Zweck |
| --- | --- |
| `list()` | `[{ id, name, description, notes, source?, sourceLabel?, canRemove? }]` (`notes`: Zahl der Notizen) |
| `get(id)` | die Vorlage `{ name, description, notes: [{ depth, title, body, tags }] }` (Fehler `TEMPLATE_NOT_FOUND`) |
| `save(template, values)` | speichert; `values` sind die Werte der Felder aus `saveFields()`. Ergebnis `{ id, where: 'folder'\|'download'\|'server', folder? }` |
| `remove(id)`, `download(id)`, `importFile(file)` | wahlweise: entfernen, als `.md` herunterladen, eine `.md`-Datei aufnehmen |
| `canSave()` | darf die Person Vorlagen anlegen (sonst fehlt «Als Vorlage speichern…») |
| `saveFields()` | zusätzliche Auswahlfelder im Dialog `[{ id, label, options: [{ value, label }], value }]`, zum Beispiel «Sichtbar für» im Dienst |
| `context()` | Werte für Platzhalter: `{ area, me }` (`{{bereich}}`, `{{ich}}`) |
| `saveHint()`, `emptyHint()`, `manageLead()`, `manageUrl()` | wahlweise: Sätze für die Dialoge, Adresse der Verwaltung ausserhalb der App |

Die lokale Hülle nutzt `packages/store-local/templates-local.js` (Ordner `templates/`, sonst Browser); dieselbe Schnittstelle bekommt der
Werkzeugkatalog der Agenten als `options.templates` (`list_templates`, `create_note_from_template`).

**`routes`** (seit v2.7.0): wo die offene Notiz in der Adresse steht. Der Kern schreibt damit den Verlauf des Browsers (Zurück, Vor,
Neuladen), «Link kopieren» und erkennt eingefügte Links auf Notizen; das Format des Teils für die Notiz ist immer «Nummer-titel»
(`NoNotesRoutes.segment(id, titel)`, gelesen mit `NoNotesRoutes.noteOf`). Ohne `routes` gilt `NoNotesRoutes.hashRoutes()` (`#n=42-titel`).

| Methode | Zweck |
| --- | --- |
| `current()` | `{ note, area? }` aus der jetzigen Adresse (`note` null: keine Notiz) |
| `href({ note, title })` | volle Adresse für diese Notiz oder (`note` null) die Übersicht; andere Teile der Adresse bleiben |
| `parse(url)` | `{ note, area? }`, wenn `url` eine Notiz dieser App ist (lokal: dieselbe Seite; im Dienst: derselbe Arbeitsbereich), sonst null |
| `enter(target)` | wahlweise: `Promise<boolean>`, macht die Daten passend, bevor der Kern die Notiz öffnet (lokal: Wechsel in den Bereich `target.area`); false bricht ab |

Die lokale Hülle setzt die Notiz hinter das `#` (`#w=arbeit&n=42-…`, `pushState` geht auch unter `file://`, solange sich nur der Teil
nach `#` ändert). Der Dienst nutzt den Pfad (`/w/<id>/42-…`), damit auch ein Server oder `curl` die Notiz ansprechen kann; der Server
muss dafür die App unter diesen Pfaden ausliefern. Der Kern speichert vor jedem Schritt und legt `{ nn: { note, view, depth,
fromOverview } }` in `history.state` (andere Felder dort bleiben). `host.replaceNav()` schreibt die
Adresse neu (etwa nach einem Wechsel des Bereichs) und gibt false zurück, solange die Navigation noch nicht läuft.
