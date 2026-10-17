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
  agent/        Werkzeuge für KI-Agenten über das Backend (catalog.js), Anmeldung beim Agenten des Browsers (webmcp.js),
                MCP ohne Transport für Ausprägungen mit Server (protocol.js); siehe AGENTS.md
  store-local/  alles, was nur die lokale Ausprägung braucht: Backend über db.js, lokale Hülle
                (Speichern, Datei, Browser-Speicher, Bereiche), Persistenz (IndexedDB, File System Access)
  ui/           Oberfläche: app.js (Ablauf), Mindmap, Druck, Scroll-Sync, app.css
editions/
  local/        edition.json (Skripte, Hilfeabschnitt, Dateien), edition.js, Startskripte: setzt die lokale Version zusammen;
                agent/nonotes-mcp.cjs: MCP-Server für Agenten auf dem eigenen Rechner (Node), arbeitet auf derselben Datei wie die App
lang/           Sprachpakete (de.js ist die Quellsprache)
plugins/        Erweiterungen: feste Liste (plugins.js, der Build stellt das Verzeichnis des Ordners voran), Anleitung, Beispiele; ausgeliefert neben der App
tools/          build.cjs (Bau), i18n.cjs (Sprachwerkzeug)
test/           core.cjs (ohne Browser), app.cjs (Gesamtablauf, Vertrag), collab.cjs (Zusammenarbeit), extend.cjs (Erweiterungen, Sprachen), lib.cjs
docs/           diese Dokumente
vendor/         Fremdbestandteile (sql.js), siehe NOTICE
```

## Abhängigkeiten

- `core` kennt weder `data` noch `ui`. Es arbeitet mit dem Backend, das ihm übergeben wird.
- `ui` kennt nur das **Backend** (`NoNotesBackend`, siehe [BACKEND.md](BACKEND.md)) und die **Hülle** der
  Ausprägung. Es gibt keinen Zugriff auf SQL, IndexedDB oder Dateien aus der Oberfläche.
- `store-local` ist die einzige Stelle, die `data` und die Persistenz kennt.
- `agent` kennt wie `core` nur das Backend; `webmcp.js` dazu die Schnittstelle des Browsers (`document.modelContext`). Die
  Oberfläche baut den Katalog beim Start und meldet ihn an (`attachAgent` in `app.js`); im Lesemodus nur die lesenden Werkzeuge.
- Eine Ausprägung (`editions/<name>`) wählt aus, was sie lädt, und liefert `NoNotesEdition.createShell(host)`.

## Hülle und Backend

Das **Backend** beantwortet Datenfragen (asynchron, JSON-sicher). Die **Hülle** (`shell`) macht alles, was
zur Ausprägung gehört und nicht zur Oberfläche: das Backend beschaffen (`start()`), Änderungen sichern,
Verbindungen halten, Menüs der Ausprägung bedienen (bei der lokalen Version: Datei anlegen, öffnen,
trennen, Kopie, Import). Die Oberfläche gibt der Hülle über `host` nur Rückrufe (`setStatus`, `renderAll`,
`onDatabaseReplaced` …) und fragt sie nach ihrem Zustand (`storageLines`, `isDirty`).


## Bereiche der lokalen Ausprägung (v2.3.0)

Die lokale Hülle führt mehrere Datenbanken nebeneinander. `storage.js` legt je Bereich eine Browser-Kopie und ein gemerktes
Datei-Handle ab; der erste Bereich (`main`) behält die bisherigen Schlüssel `db` und `fileHandle`, weitere stehen unter
`area:<id>:db` und `area:<id>:handle`, das Verzeichnis unter `areas` (`{ list: [{ id, name, createdAt }], last }`). Solange es nur
den ersten gibt, wird kein Verzeichnis geschrieben, und alles verhält sich wie vor v2.3.0.

- **Aktiver Bereich je Tab:** aus der Adresse (`?w=<kennung>`, Name als Kennung oder Stelle 1 … 9), sonst aus dem Sitzungsspeicher
  des Tabs, sonst der zuletzt benutzte. Nach jedem Wechsel steht die Kennung in der Adresse (`history.replaceState`) und der Name im
  Titel des Tabs.
- **Wechsel:** die Oberfläche schreibt zuerst die offene Notiz (`host.ensureSaved`), die Hülle sichert ausstehende Änderungen, lädt
  den anderen Bereich (Datei, wenn freigegeben, sonst Browser-Kopie; die Freigabe fragt sie im selben Klick an) und tauscht die
  Datenbank aus (`onDatabaseReplaced`, danach `renderAll`). Das Backend bleibt dasselbe Objekt; es liest die Datenbank über `getDb()`.
  Plugins, Agenten-Werkzeuge (WebMCP) und Ansichten arbeiten damit immer auf dem aktiven Bereich.
- **Tabs:** Nachrichten auf dem Kanal `nonotes-mirror` tragen den Bereich (`{ tab, area }`); andere Bereiche ignorieren sie. Änderungen
  am Verzeichnis gehen als `{ type: 'areas' }` an alle Tabs. Wird der eigene Bereich anderswo entfernt, wechselt der Tab in den ersten.
- **Menü:** die Hülle baut es und zeigt es über `host.showMenu(items, x, y, { above: true })` (dasselbe Menü wie in der Mindmap).
- **Agenten:** `NoNotesAgent.multi()` in `packages/agent/catalog.js` macht aus mehreren Katalogen einen mit `list_workspaces` und dem
  Parameter `workspace`; das Programm `agent/nonotes-mcp.cjs` nutzt es für mehrere Dateien. Kennungen bildet `NoNotesAgent.slug()`
  gleich wie die App.
## Asynchron arbeiten

Weil jedes Backend im Netz liegen kann, ist jeder Datenzugriff asynchron. Für Code in der Oberfläche gelten
drei Regeln:

1. `preventDefault()` und `stopPropagation()` stehen **vor** dem ersten `await`.
2. Zeichenaufträge, die spät fertig werden, prüfen mit `fresh(key)`, ob sie noch gebraucht werden, bevor sie
   etwas ins Dokument schreiben (veraltete Antworten werden verworfen).
3. Was ein synchroner Renderer braucht (Bilder, Verweisverzeichnis), wird vorher geholt und dann übergeben.

## Erweiterungen

Eine Erweiterung ist eine Skriptdatei im Ordner `plugins/` neben der App, die sich mit `NoNotesPlugins.register()` meldet
(`packages/core/plugins.js`). Beim Start lädt die App die feste Liste aus `plugins/plugins.js` und danach die Dateien, die die
Person in diesem Browser eingeschaltet hat (`localStorage`), ruft nach dem ersten Zeichnen `activate(ctx)` auf und meldet
Ereignisse. Im Dialog «Erweiterungen» lassen sich Dateien zur Laufzeit ein- und ausschalten (seit v1.7.0): Vorgeschlagen wird,
was im Ordner liegt, nach dem Verzeichnis, das `tools/build.cjs` aus dem Zielordner `plugins/` erzeugt und vor die Liste stellt
(`NoNotesPlugins.catalog([...])`), weil eine Seite den Ordner weder per `file://` noch auf einem Server selbst lesen kann; eigene
Dateien gibt man per Name ein. Programmcode kommt nie aus der Datenbankdatei, und ein Dateiname bleibt immer innerhalb von
`plugins/`. Die Schnittstelle (`ctx`, Ereignisse, Theme-Variablen) ist für 1.x festgelegt, siehe [PLUGINS.md](PLUGINS.md).

## Sprachen

Alle Texte laufen über `t()`/`tn()` (Quelltext) und `translateDom()` (festes Markup). Siehe
[LANGUAGES.md](LANGUAGES.md). Der Test `test/extend.cjs` stellt die Pseudo-Sprache ein und führt die Seite
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

`--plugins <Ordner>` (mehrfach möglich) nimmt die Erweiterungen eines weiteren Ordners oder Repositorys mit: seine Unterordner
kommen ganz nach `plugins/` (eine Erweiterung je Unterordner, mit README), `.js`-Dateien direkt im Ordner ebenfalls; andere Dateien
direkt im Ordner, Verstecktes und `node_modules` bleiben draussen. Der Workflow baut damit das zweite Artefakt
`NoNotes-with-Plugins-<Version>.zip` aus `CDRO/NoNotes-plugins`. Das Verzeichnis für den Dialog «Erweiterungen» entsteht danach aus
allem, was in `plugins/` liegt.

## Tests

`npm test` baut und führt der Reihe nach aus: `i18n lint`, `i18n check`, dann vier Läufe: `test/core.cjs` (ohne Browser:
Zusammenführen, Datenbank, Build, Videoadressen), `test/app.cjs` (Gesamtablauf und Backend-Vertrag), `test/collab.cjs`
(Verlauf, gleichzeitiges Schreiben, Änderungen von aussen, Lesemodus) und `test/extend.cjs` (Erweiterungen, Hauptfarbe,
Videos, Querverweise, Entscheide, Sprachen). Jeder Lauf teilt sich ein Chromium und druckt je Abschnitt eine Zeile; die
Teilschritte bleiben still (`NONOTES_TEST_VERBOSE=1` zeigt sie) und der letzte wird beim Fehlschlag genannt (`test/lib.cjs`).
Getestet wird immer das Gebaute (`dist/NoNotes`) per `file://` in Chromium, also genau das, was der Benutzer bekommt.
