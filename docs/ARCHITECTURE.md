# Architektur

NoNotes besteht aus Paketen mit klaren Abhängigkeiten und aus **Ausprägungen**, die daraus eine
auslieferbare Version zusammensetzen. Markdown-Engine und Editor liegen seit v4.0.0 im eigenen Paket
[NoNotes-editor](https://github.com/CDRO/NoNotes-editor) (MIT, siehe unten). Heute gibt es eine Ausprägung, die **lokale** (alles im Browser,
eine SQLite-Datei auf dem eigenen Gerät). Die Struktur ist so angelegt, dass weitere Ausprägungen
dieselbe Oberfläche und denselben Kern benutzen können.

```
packages/
  core/         reine Logik ohne Datenbank und ohne Oberfläche: Verweise (links.js), Vorlagen, Verlauf, Zusammenführen,
                Export, Kalender, ZIP, Sprachen (i18n), Erweiterungen, Backend-Schnittstelle
  data/         db.js: Schema und alle SQL-Abfragen (SQLite über sql.js); spricht nur SQL
  agent/        Werkzeuge für KI-Agenten über das Backend (catalog.js), Anmeldung beim Agenten des Browsers (webmcp.js),
                MCP ohne Transport für Ausprägungen mit Server (protocol.js); siehe AGENTS.md
  store-local/  alles, was nur die lokale Ausprägung braucht: Backend über db.js, lokale Hülle
                (Speichern, Datei, Browser-Speicher, Bereiche), Persistenz (IndexedDB, File System Access)
  ui/           Oberfläche: app.js (Ablauf, bindet den Editor ein), Mindmap, Druck, Flaggen, app.css
editions/
  local/        edition.json (Skripte, Hilfeabschnitt, Dateien), edition.js, Startskripte: setzt die lokale Version zusammen;
                agent/nonotes-mcp.cjs: MCP-Server für Agenten auf dem eigenen Rechner (Node), arbeitet auf derselben Datei wie die App
lang/           Sprachpakete (de.js ist die Quellsprache)
plugins/        Erweiterungen: feste Liste (plugins.js, der Build stellt das Verzeichnis des Ordners voran), Anleitung, Beispiele; ausgeliefert neben der App
tools/          build.cjs (Bau), i18n.cjs (Sprachwerkzeug), editor-package.cjs (wo das Paket nonotes-editor liegt), release-*.cjs
node_modules/nonotes-editor/   das Paket NoNotes-editor (devDependency, npm install): src/ (Engine und Editor), lang/, files.cjs
test/           core.cjs (ohne Browser), app.cjs (Gesamtablauf, Vertrag), collab.cjs (Zusammenarbeit), extend.cjs (Erweiterungen, Sprachen), lib.cjs
docs/           diese Dokumente
vendor/         Fremdbestandteile (sql.js), siehe NOTICE
```

## Das Paket NoNotes-editor (seit v4.0.0)

Die Markdown-Engine und der Editor sind ein eigenes Paket, damit SteeringBoard, NoNotes-SaaS und NoNotes denselben Editor benutzen:
[CDRO/NoNotes-editor](https://github.com/CDRO/NoNotes-editor), MIT-Lizenz, in `package.json` eine **devDependency** auf einen Tag
(`github:CDRO/NoNotes-editor#v1.0.0`), keine Abhängigkeit zur Laufzeit. Es ist kein Bündler im Spiel: `tools/build.cjs` liest die
Dateiliste des Pakets (`files.cjs`) und kopiert dessen Skripte und Stylesheet wie die eigenen flach nach `js/` und `css/`, dazu die
Lizenz nach `js/nonotes-editor-LICENSE.txt` (siehe NOTICE).

| Datei im Paket | Global | bis v3.3.0 in NoNotes |
| --- | --- | --- |
| `src/labels.js`, `lang/editor.de.js`, `lang/editor.en.js` | `NoNotesEditorLabels` | neu: Texte des Pakets |
| `src/placeholders.js`, `dates.js`, `questions.js`, `mentions.js`, `tasks.js`, `embeds.js`, `tables.js`, `markdown.js`, `editing.js` | `NoNotesPlaceholders`, `NoNotesDates`, `NoNotesQuestions`, `NoNotesMentions`, `NoNotesTasks`, `NoNotesEmbeds`, `NoNotesTables`, `NoNotesMarkdown`, `NoNotesEditing` | `packages/core/` |
| `src/datepicker.js`, `src/scrollsync.js` | `NoNotesDatePicker`, `NoNotesScrollSync` | `packages/ui/` |
| `src/editor.js` | `NoNotesEditor` | der Editor in `packages/ui/app.js` |
| `src/editor.css` | – | die Regeln des Editors und der Markdown-Darstellung aus `app.css` |

Die globalen Namen und die Dateinamen in `js/` sind dieselben wie bis v3.3.0. Die Seitenvorlage hat dafür zwei Platzhalter
(`<!-- NONOTES-EDITOR-SCRIPTS -->` direkt nach `i18n.js`, `<!-- NONOTES-EDITOR-STYLES -->` vor `app.css`). `app.js` baut den Editor mit
`NoNotesEditor.create(#editorPane, { ids, onInput, attachments, refs, render, placeholders, … })` unter Titel und Tags (`createEditor`);
die festen Kennungen (`#body`, `#preview`, `#mdToolbar`, `#modeSwitch`, `#attachBtn` …) bleiben wie zuvor, die Klasse der Darstellung
(`mode-edit`, `mode-split`, `mode-preview`) steht wie bisher auch an `#editorPane`. Was der App gehört, bleibt in der App: Speichern mit
Zusammenführen und Konfliktdialog, Bilder in der Datenbank, Verweisziele (`links.js`), Kontextmenü, Statuszeile, Hilfe, Vorlagen, Verlauf.
Die Schnittstelle der Erweiterungen (`ctx.editor`, `ctx.ui.addToolbarButton`, `ctx.tables.*`, `ctx.ui.addTableMenuItem`) ist unverändert;
die App setzt sie über den Editor und `NoNotesEditor.extend` um. Texte: `labels.js` nimmt `NoNotesI18n` als Übersetzer, die neun
Sprachpakete in `lang/` übersetzen die Texte des Editors mit (`tools/i18n.cjs` liest dafür auch die Quelltexte des Pakets).

Node-Teile finden das Paket über `require.resolve('nonotes-editor/files.cjs')` (`tools/editor-package.cjs`): der Build, das
Sprachwerkzeug, die Tests und das MCP-Programm im Quelltext-Modus. Liegt NoNotes als Submodul in einem anderen Projekt, genügt
`nonotes-editor` in dessen `node_modules`. Entwurf, Rückrufe und Regeln für Texte: `docs/DESIGN.md` im Paket.

## Abhängigkeiten

- `core` kennt weder `data` noch `ui`. Es arbeitet mit dem Backend, das ihm übergeben wird. Es benutzt die Engine des Pakets
  NoNotes-editor (`NoNotesQuestions`, `NoNotesTasks` …); das Paket kennt NoNotes nicht (nur `NoNotesI18n`, wenn es da ist).
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

- **Aktiver Bereich je Tab:** aus der Adresse (`#w=<kennung>`, ersatzweise `?w=<kennung>`; Name als Kennung oder Stelle 1 … 9), sonst
  aus dem Sitzungsspeicher des Tabs, sonst der zuletzt benutzte. Nach jedem Wechsel steht die Kennung als `#w=…` in der Adresse
  (`history.replaceState`) und der Name im Titel des Tabs. Der Teil nach `#` gilt, weil er Weiterleitungen eines Webservers übersteht
  (`npx serve` leitet `index.html?w=…` auf `/` um und verliert den Parameter); `hashchange` wechselt ohne Neuladen.
- **Startdatei:** «Startdatei für den Desktop…» schreibt eine kleine HTML-Datei (Speicherdialog ab dem Desktop, sonst Download), die per
  `location.replace` und `meta refresh` auf `…/index.html#w=<kennung>` weiterleitet. Grund: Windows macht aus Verknüpfungen auf
  `file:///…`-Adressen einen Dateipfad und wirft `?…` und `#…` weg; ein Doppelklick auf die Startdatei öffnet sie im Browser, die
  Weiterleitung geschieht dort.
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

Es wird nichts übersetzt oder gebündelt. Der Build schreibt `js/version.js`, setzt die Dateien des Pakets NoNotes-editor ein
(Platzhalter `<!-- NONOTES-EDITOR-SCRIPTS -->` und `<!-- NONOTES-EDITOR-STYLES -->`, Reihenfolge aus dessen `files.cjs`), bindet alle Dateien aus `lang/` ein
und prüft, dass jeder Verweis auf eine Datei im Ergebnis trifft. Das ZIP enthält genau diesen Ordner.
Die Seite ist eine Vorlage (`packages/ui/index.html`) mit zwei Platzhaltern für den Editor (siehe oben) und zwei für die Ausprägung (`<!-- EDITION-SCRIPTS -->`, `<!-- EDITION-HELP-STORAGE -->`).
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
`NONOTES_CHROMIUM=/pfad/zu/chrome` nimmt ein vorhandenes Chromium (oder `chrome-headless-shell`) statt des Programms von Playwright
(für Tests, Sprachwerkzeug und Screenshots). Die Tests, die nur die Engine brauchen, laden deren Dateien aus dem Paket
(`editorFile()` aus `tools/editor-package.cjs`, `labels.js` vor der Engine); Editor und Engine selbst testet das Paket
(`npm test` dort), NoNotes prüft alles, was die App, die Datenbank, den Export und die Agenten betrifft, gegen das Paket.
