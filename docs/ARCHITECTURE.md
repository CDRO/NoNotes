# Architektur

NoNotes besteht aus Paketen mit klaren Abhängigkeiten und aus **Ausprägungen**, die daraus eine
auslieferbare Version zusammensetzen. Heute gibt es eine Ausprägung, die **lokale** (alles im Browser,
eine SQLite-Datei auf dem eigenen Gerät). Die Struktur ist so angelegt, dass weitere Ausprägungen
dieselbe Oberfläche und denselben Kern benutzen können.

```
packages/
  core/         reine Logik ohne Datenbank und ohne Oberfläche: Termine, Fragen, Aufgaben, Markdown,
                Editor-Funktionen, Export, Kalender, ZIP, Sprachen (i18n), Backend-Schnittstelle
  data/         db.js: Schema und alle SQL-Abfragen (SQLite über sql.js); spricht nur SQL
  store-local/  alles, was nur die lokale Ausprägung braucht: Backend über db.js, lokale Hülle
                (Speichern, Datei, Browser-Speicher), Persistenz (IndexedDB, File System Access)
  ui/           Oberfläche: app.js (Ablauf), Mindmap, Druck, Scroll-Sync, app.css
editions/
  local/        edition.json (Skripte, Hilfeabschnitt, Dateien), edition.js, Startskripte: setzt die lokale Version zusammen
lang/           Sprachpakete (de.js ist die Quellsprache)
plugins/        Liste der Erweiterungen (plugins.js), Anleitung und Beispiele; ausgeliefert neben der App
tools/          build.cjs (Bau), i18n.cjs (Sprachwerkzeug)
test/           smoke.cjs (Gesamtablauf), backend.cjs (Vertrag), i18n.cjs (Sprachen)
docs/           diese Dokumente
vendor/         Fremdbestandteile (sql.js), siehe NOTICE
```

## Abhängigkeiten

- `core` kennt weder `data` noch `ui`. Es arbeitet mit dem Backend, das ihm übergeben wird.
- `ui` kennt nur das **Backend** (`NoNotesBackend`, siehe [BACKEND.md](BACKEND.md)) und die **Hülle** der
  Ausprägung. Es gibt keinen Zugriff auf SQL, IndexedDB oder Dateien aus der Oberfläche.
- `store-local` ist die einzige Stelle, die `data` und die Persistenz kennt.
- Eine Ausprägung (`editions/<name>`) wählt aus, was sie lädt, und liefert `NoNotesEdition.createShell(host)`.

## Hülle und Backend

Das **Backend** beantwortet Datenfragen (asynchron, JSON-sicher). Die **Hülle** (`shell`) macht alles, was
zur Ausprägung gehört und nicht zur Oberfläche: das Backend beschaffen (`start()`), Änderungen sichern,
Verbindungen halten, Menüs der Ausprägung bedienen (bei der lokalen Version: Datei anlegen, öffnen,
trennen, Kopie, Import). Die Oberfläche gibt der Hülle über `host` nur Rückrufe (`setStatus`, `renderAll`,
`onDatabaseReplaced` …) und fragt sie nach ihrem Zustand (`storageLines`, `isDirty`).

## Asynchron arbeiten

Weil jedes Backend im Netz liegen kann, ist jeder Datenzugriff asynchron. Für Code in der Oberfläche gelten
drei Regeln:

1. `preventDefault()` und `stopPropagation()` stehen **vor** dem ersten `await`.
2. Zeichenaufträge, die spät fertig werden, prüfen mit `fresh(key)`, ob sie noch gebraucht werden, bevor sie
   etwas ins Dokument schreiben (veraltete Antworten werden verworfen).
3. Was ein synchroner Renderer braucht (Bilder, Verweisverzeichnis), wird vorher geholt und dann übergeben.

## Erweiterungen

Eine Erweiterung ist eine Skriptdatei im Ordner `plugins/` neben der App, die sich mit `NoNotesPlugins.register()` meldet
(`packages/core/plugins.js`). Die App lädt die Dateien aus `plugins/plugins.js` vor dem Start, ruft nach dem ersten Zeichnen
`activate(ctx)` auf und meldet Ereignisse. Programmcode kommt nie aus der Datenbankdatei. Die Schnittstelle (`ctx`, Ereignisse,
Theme-Variablen) ist für 1.x festgelegt, siehe [PLUGINS.md](PLUGINS.md).

## Sprachen

Alle Texte laufen über `t()`/`tn()` (Quelltext) und `translateDom()` (festes Markup). Siehe
[LANGUAGES.md](LANGUAGES.md). Der Test `test/i18n.cjs` stellt die Pseudo-Sprache ein und führt die Seite
durch alle Ansichten; `tools/i18n.cjs lint` findet deutschen Text, der am Sprachsystem vorbeiläuft.

## Bau und Auslieferung

`node tools/build.cjs --edition local --version v1.0.0` kopiert die Dateien der Ausprägung flach nach
`dist/NoNotes`:

```
index.html  css/  js/  lang/  vendor/  plugins/  docs/  start.ps1  start.cmd  README.md  NOTICE
```

Es wird nichts übersetzt oder gebündelt. Der Build schreibt `js/version.js`, bindet alle Dateien aus `lang/` ein
und prüft, dass jeder Verweis auf eine Datei im Ergebnis trifft. Das ZIP enthält genau diesen Ordner.
Die Seite ist eine Vorlage (`packages/ui/index.html`) mit zwei Platzhaltern für die Ausprägung (`<!-- EDITION-SCRIPTS -->`, `<!-- EDITION-HELP-STORAGE -->`).
Eine Ausprägung ist ein Ordner mit `edition.json`; er darf auch ausserhalb dieses Projekts liegen (`node tools/build.cjs --edition-dir <Ordner>`),
zum Beispiel in einem anderen Projekt, das NoNotes einbindet. Zum Entwickeln bauen und `dist/NoNotes/index.html` öffnen.

## Tests

`npm test` baut und führt der Reihe nach aus: `i18n lint`, `i18n check`, `test/backend.cjs`,
`test/smoke.cjs`, `test/palette.cjs`, `test/plugins.cjs`, `test/history.cjs`, `test/i18n.cjs`. Getestet wird immer das Gebaute (`dist/NoNotes`) per `file://` in
Chromium, also genau das, was der Benutzer bekommt.
