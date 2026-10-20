# Erweiterungen

Erweiterungen (Plugins) ergänzen NoNotes um Knöpfe, Menüeinträge, Reaktionen auf Ereignisse und Designs.
Eine Erweiterung ist **eine Skriptdatei** im Ordner `plugins/` neben der App. Es braucht keinen Build.
Ein- und ausgeschaltet wird unter **Datenbank → Erweiterungen…**, zur Laufzeit und ohne eine Datei zu bearbeiten.

## Wichtig vorweg

- **Eine Erweiterung läuft mit allen Rechten der Seite.** Sie kann alle Notizen lesen, ändern und löschen und
  sich mit dem Netz verbinden. NoNotes schützt davor nicht. Lade nur Dateien, denen du vertraust.
- **Erweiterungen kommen nur aus dem Ordner `plugins/`**, nie aus der Datenbankdatei. Eine fremde `.sqlite`-Datei
  kann also keinen Programmcode einschleusen; Skripte im Notiztext werden nie ausgeführt.
- **Die Schnittstelle ist asynchron und in 1.x stabil.** Alles, was Daten berührt, liefert ein Promise. Innerhalb
  der Version 1.x kommt nur Neues dazu; nichts fällt weg und nichts ändert seine Bedeutung. Eine Erweiterung gibt
  mit `api: 1` an, für welche Version sie gebaut ist.

## Ein- und ausschalten

Der Dialog **Datenbank → Erweiterungen…** zeigt zwei Gruppen:

- **Eingeschaltet**: was gerade läuft, mit Zustand (`aktiv`, `Fehler`) und Fehlertext. Fest in `plugins/plugins.js`
  eingetragene Dateien stehen hier ohne Schalter.
- **Verfügbar im Ordner plugins/**: was im Ordner liegt, aber nicht läuft, mit Name, Version, Beschreibung und dem Hinweis,
  ob ein Design dabei ist. Diese Angaben stammen aus dem **Verzeichnis**, das der Build (`tools/build.cjs`) aus dem Ordner
  erzeugt und vor die Liste in `plugins/plugins.js` stellt (`NoNotesPlugins.catalog([...])`); dafür wird keine Datei
  geladen. Eine Seite kann den Ordner nicht selbst lesen (weder per `file://` noch auf einem Server), darum das Verzeichnis.

Der Schalter **Ein** lädt die Datei sofort und ruft `activate(ctx)`; Menüeinträge, Toolleistenknöpfe, Ereignisse und
Designs sind da, ohne die Seite neu zu laden. **Die Wahl merkt sich der Browser** (`localStorage`, Schlüssel
`nonotes.plugins`), nicht die Datenbankdatei: eine fremde `.sqlite`-Datei kann nichts einschalten. Gemerkt wird nur,
was sich gültig mit `register()` gemeldet hat.

Ausschalten nimmt der Erweiterung, was die App ihr gegeben hat: Menüeinträge, Toolleistenknöpfe, Ereignisrückrufe und
das Design (gilt es gerade, fällt die Ansicht auf Standard zurück; die Datei behält die Angabe, beim Wiedereinschalten
gilt das Design wieder). Ein Skript lässt sich nicht entladen. Hat die Erweiterung eine Funktion `deactivate()`, wird sie
gerufen und soll alles Übrige zurücknehmen (Zeitgeber, eigene Elemente). Ohne `deactivate` steht im Dialog, dass der Rest
erst beim nächsten Laden der Seite verschwindet. Wiedereinschalten in derselben Sitzung ruft `activate(ctx)` noch
einmal mit einer frischen Schnittstelle.

**Weitere Datei laden**: eine eigene Datei in `plugins/` ablegen und im Dialog ihren Namen eingeben (relativ zum Ordner,
zum Beispiel `meine-erweiterung.js` oder `eigene/werkzeug.js`). Erlaubt sind Buchstaben, Ziffern, Punkt, Unterstrich,
Bindestrich und Unterordner; kein Teil beginnt mit einem Punkt, die Endung ist `.js`. Damit bleibt jede Erweiterung im
Ordner `plugins/`; Adressen ausserhalb werden abgelehnt. Das gilt auch für Namen im gemerkten Zustand des Browsers.

Eine Erweiterung, die ohne Schalter **immer** laufen soll (zum Beispiel auf einem Server für alle), trägt man wie bisher
in `plugins/plugins.js` ein (`NoNotesPlugins.list([...])`); sie wird vor den gemerkten Dateien geladen.

## Eine Erweiterung anlegen

1. Datei im Ordner `plugins/` anlegen, zum Beispiel `plugins/hallo.js`:

   ```js
   NoNotesPlugins.register({
     id: 'hallo',                 // a-z, 0-9, Bindestrich; eindeutig
     name: 'Hallo',
     version: '1.0.0',
     api: 1,                      // Schnittstellenversion
     description: 'Zeigt einen Gruss.',

     activate(ctx) {
       ctx.ui.addMenuItem({
         label: 'Gruss',
         action: () => ctx.ui.setStatus('Hallo!', 'saved'),
       });
     },
   });
   ```

2. Unter **Datenbank → Erweiterungen…** bei «Weitere Datei laden» `hallo.js` eingeben. Die Datei läuft sofort; der
   Dialog zeigt, ob etwas schiefging. Beim nächsten Laden der Seite ist sie wieder da (die Wahl merkt sich der Browser).
   Wer sie fest einbauen will, trägt stattdessen `NoNotesPlugins.list(['hallo.js']);` in `plugins/plugins.js` ein.

Im Ordner `plugins/beispiele/` liegen zwei fertige Beispiele (Datum einfügen, Design «Sepia»); sie stehen im Dialog
unter «Verfügbar» und lassen sich dort einschalten.

Beim Start werden **zuerst die Liste aus `plugins/plugins.js`, dann die gemerkten Dateien** geladen, nacheinander in
dieser Reihenfolge und bevor die App zeichnet. Eine Datei, die fehlt, einen Syntaxfehler hat oder sich nicht mit
`register()` meldet, wird im Dialog als Fehler aufgeführt; die App und die übrigen Erweiterungen laufen weiter. Dasselbe
gilt für eine Erweiterung, deren `activate` oder deren Ereignisrückruf einen Fehler wirft.

## Beschreibung (`register`)

| Feld | Pflicht | Bedeutung |
| --- | --- | --- |
| `id` | ja | Kennung, `a-z`, `0-9` und `-`, 2 bis 41 Zeichen, eindeutig |
| `api` | ja | Schnittstellenversion, heute `1`. Eine höhere Zahl als die der App wird abgelehnt |
| `name` | nein | Anzeigename (sonst die `id`) |
| `version`, `description` | nein | Anzeige im Dialog |
| `activate(ctx)` | nein | Wird nach dem ersten Zeichnen aufgerufen (beim Einschalten zur Laufzeit sofort); darf `async` sein |
| `deactivate()` | nein | Seit 1.7.0. Wird beim Ausschalten gerufen; nimmt zurück, was `activate` ausserhalb von `ctx` eingerichtet hat (Zeitgeber, eigene Elemente). `ctx`-Beiträge räumt die App selbst |
| `help` | nein | Seit 1.9.0. Hilfetext für das Hilfefenster, siehe unten; er erscheint, solange die Erweiterung eingeschaltet ist |
| `theme` | nein | Ein Design, siehe unten |

## Die Schnittstelle `ctx`

`activate` bekommt ein eingefrorenes Objekt `ctx`:

| Name | Bedeutung |
| --- | --- |
| `ctx.id`, `ctx.api`, `ctx.appVersion` | Kennung der Erweiterung, Schnittstellenversion (`1`), Version der App |
| `ctx.backend` | Zugriff auf die Daten: dieselbe asynchrone [Backend-Schnittstelle](BACKEND.md) wie in der App (`await ctx.backend.getNote(id)` …). Änderungen werden wie jede andere gespeichert |
| `ctx.language()` | Kennung der Sprache der Oberfläche, zum Beispiel `de` |
| `ctx.on(ereignis, rückruf)` | Auf ein Ereignis hören; liefert eine Funktion, die das Hören beendet |
| `ctx.openNote(id)` | Notiz im Editor öffnen (Promise) |
| `ctx.refresh()` | Nach Änderungen über `ctx.backend` die Oberfläche neu zeichnen (Promise) |
| `ctx.ui.setStatus(text, art)` | Text in der Statuszeile; `art` ist `'saved'`, `'dirty'`, `'saving'` oder `'error'` |
| `ctx.ui.addMenuItem({ label, title?, action })` | Eintrag im Menü **Datenbank** |
| `ctx.ui.addToolbarButton({ label, title?, action })` | Knopf in der Toolleiste des Editors; `action(editor)` bekommt die Editor-Schnittstelle |
| `ctx.editor.noteId()` | Kennung der offenen Notiz oder `null` |
| `ctx.editor.isWritable()` | `true`, wenn eine Notiz offen und nicht schreibgeschützt ist |
| `ctx.editor.selection()` | `{ start, end, text }` der Markierung im Text |
| `ctx.editor.replaceSelection(text)` | Ersetzt die Markierung (oder fügt am Cursor ein); Promise mit `false`, wenn nichts zu bearbeiten ist |
| `ctx.people.provide(fn)` | Vorschläge für `@kürzel` beim Schreiben: `fn(prefix)` liefert (auch als Promise) `[{ handle, name }]` oder Kürzel als Text; die App führt alle Lieferanten zusammen, jedes Kürzel erscheint einmal. Liefert eine Funktion zum Abmelden; beim Ausschalten wird abgemeldet. Ohne Erweiterung gilt `NoNotesMentions.provide(fn)` für Ausprägungen (seit 1.11.0) |

`action`-Funktionen dürfen `async` sein. Wirft eine Aktion einen Fehler, erscheint er in der Statuszeile; die App
läuft weiter.

## Ereignisse

| Ereignis | Wann | Daten |
| --- | --- | --- |
| `ready` | Einmal nach dem Start, wenn alles gezeichnet ist | `{}` |
| `note:open` | Eine Notiz wurde im Editor geöffnet | `{ id }` |
| `note:close` | Der Editor wurde geschlossen | `{ id }` |
| `note:saved` | Nach einer Pause im Schreiben, nachdem die Änderung übernommen wurde | `{ id }` |
| `mindmap:rendered` | Die Mindmap wurde (neu) gezeichnet. Die Verbindungslinien sind `path.mm-edge` mit `data-from` (Kennung der Elternnotiz, bei der Wurzel `root`), `data-to` (Kennung der Unternotiz) und den Endpunkten `data-x1`, `data-y1`, `data-x2`, `data-y2` | `{}` |
| `mindmap:select` | Die Auswahl in der Mindmap hat sich geändert (Klick, Tastatur, Neuzeichnen mit anderer Auswahl) | `{ id }`: Notizkennung, `'root'` für die Wurzel oder `null` ohne Auswahl |
| `database:replaced` | Eine andere Datei wurde geöffnet oder importiert | `{}` |
| `questions:rendered` | Die Ansicht «Fragen» oder «Entscheide» wurde (neu) gezeichnet (seit 1.11.0) | `{ kind, items }`: `kind` ist `'question'` oder `'decision'`, `items` die gezeigten Einträge mit `id`, `noteId`, `kind`, `text`, `answer`, `decided`, `due`, `people` (`[{ handle, optional }]`), seit 2.4.0 `details` (Beschreibung eines Blocks oder `null`) und `parentId` (Block eines Unter-Eintrags oder `null`), und `element` (der Eintrag in der Liste, zum Beispiel um Knöpfe oder Marken anzuhängen) |

Rückrufe dürfen `async` sein. Die App wartet nicht auf sie. Jedes Ereignis geht zusätzlich als DOM-Ereignis `nonotes:<name>` am `document`
aus (`detail` trägt die Daten), damit auch Skripte ohne Erweiterungs-Schnittstelle zuhören können, etwa die Hülle einer Ausprägung.

## Designs

Eine Erweiterung kann ein **Design** mitbringen (`theme`). Sobald mindestens eins da ist, erscheint im Menü
**Datenbank** die Auswahl «Design». Die Wahl wird wie die Hauptfarbe **in der Datenbankdatei** gespeichert
(`meta.theme`) und im Browser zwischengespeichert. Fehlt die Erweiterung später, gilt wieder das Standarddesign;
die Datei behält die Angabe.

```js
NoNotesPlugins.register({
  id: 'sepia', name: 'Sepia', api: 1,
  theme: {
    name: 'Sepia',
    light: { bg: '#f3ead8', panel: '#fbf6ea', text: '#3b2f1e' },   // helle Systemeinstellung
    dark:  { bg: '#1c1710', panel: '#241e15', text: '#ece1c9' },   // dunkle Systemeinstellung
    css: '.logo { letter-spacing: 2px; }',                          // zusätzliches CSS (ohne <style>)
  },
});
```

Ein Design darf diese Variablen setzen: `bg`, `panel`, `text`, `muted`, `border`, `hover`, `danger`, `ok`, `warn`,
`radius`, `shadow`. Die **Hauptfarbe** (`accent` …) gehört dem Menü **Hauptfarbe** und lässt sich von einem Design
nicht überschreiben; sie gilt immer zusammen mit dem Design. Werte dürfen kein `;`, `{`, `}`, `<` oder `>` enthalten.

## Hilfetext

Eine Erweiterung kann das Hilfefenster ergänzen (`register({ help })`). Alle Hilfetexte stehen gemeinsam in einem
zusätzlichen Tab **Erweiterungen** (das Tab erscheint nur, wenn mindestens eine Erweiterung einen Hilfetext hat);
jede Erweiterung bekommt dort einen Abschnitt mit ihrem Namen als Überschrift.

```js
NoNotesPlugins.register({
  id: 'hallo', name: 'Hallo', api: 1,
  help: {
    de: 'Der Knopf **Gruss** im Menü zeigt einen Gruss.\n\n#### Tipp\nFunktioniert überall.',
    en: 'The **Greeting** menu item shows a greeting.\n\n#### Tip\nWorks everywhere.',
  },
});
```

- `help` ist ein Markdown-Text (derselbe Dialekt wie in den Notizen; HTML wird maskiert) oder ein Objekt mit einem Text
  je Sprache (`de`, `en`, …). Ein einzelner Text gilt für jede Sprache.
- Gewählt wird der Text der Sprache der Oberfläche, sonst ihrer Hauptsprache (`de-ch` → `de`), sonst `en`, sonst `de`,
  sonst der erste.
- Der Name der Erweiterung ist die Abschnittsüberschrift; Überschriften im Text rücken darunter ein (`#` wird zur
  Unterüberschrift), du schreibst sie also einfach als `#`, `##` …
- Der Text wird beim Start gelesen. Eine Erweiterung, die nicht geladen werden konnte, zeigt keinen Hilfetext.

## Texte der Erweiterung

Die Texte einer Erweiterung gehören ihr: Sie stehen nicht in den Sprachpaketen von NoNotes. Wer mehrere Sprachen
anbieten will, wählt anhand von `ctx.language()` selbst aus.

## Stabilität

- Die Namen in `ctx`, die Ereignisse und die Theme-Variablen sind für `api: 1` festgelegt. `test/extend.cjs` prüft das.
- Neue Fähigkeiten kommen als neue Namen dazu. Wer sie nutzen will, prüft ihr Vorhandensein
  (`if (ctx.ui.addSomething) …`).
- Ein Bruch käme frühestens mit `api: 2` in NoNotes 2.0; die App meldet dann eine ältere Erweiterung
  deutlich, statt sie still falsch zu behandeln.
- Seit 1.7.0 dazugekommen (ohne Änderung an `api`): `deactivate()` in `register`, das Verzeichnis
  `NoNotesPlugins.catalog([...])`/`available()` und das Laden und Schalten zur Laufzeit (`load`, `activate`, `disable`);
  nach 1.8.0 die Ereignisse `mindmap:rendered` und `mindmap:select` samt den `data-`Attributen an den Linien.
  `ctx` und Theme-Variablen sind unverändert.
