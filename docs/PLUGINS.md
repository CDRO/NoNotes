# Erweiterungen

Erweiterungen (Plugins) ergänzen NoNotes um Knöpfe, Menüeinträge, Reaktionen auf Ereignisse und Designs.
Eine Erweiterung ist **eine Skriptdatei** im Ordner `plugins/` neben der App. Es braucht keinen Build.

## Wichtig vorweg

- **Eine Erweiterung läuft mit allen Rechten der Seite.** Sie kann alle Notizen lesen, ändern und löschen und
  sich mit dem Netz verbinden. NoNotes schützt davor nicht. Lade nur Dateien, denen du vertraust.
- **Erweiterungen kommen nur aus dem Ordner `plugins/`**, nie aus der Datenbankdatei. Eine fremde `.sqlite`-Datei
  kann also keinen Programmcode einschleusen; Skripte im Notiztext werden nie ausgeführt.
- **Die Schnittstelle ist asynchron und in 1.x stabil.** Alles, was Daten berührt, liefert ein Promise. Innerhalb
  der Version 1.x kommt nur Neues dazu; nichts fällt weg und nichts ändert seine Bedeutung. Eine Erweiterung gibt
  mit `api: 1` an, für welche Version sie gebaut ist.

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

2. In `plugins/plugins.js` eintragen: `NoNotesPlugins.list(['hallo.js']);`
3. Seite neu laden. Unter **Datenbank → Erweiterungen…** steht, was geladen wurde und ob etwas schiefging.

Im Ordner `plugins/beispiele/` liegen zwei fertige Beispiele (Datum einfügen, Design «Sepia»); sie sind in
`plugins.js` auskommentiert.

Die Skripte werden **nacheinander in der Reihenfolge der Liste** geladen, bevor die App startet. Eine Datei, die
fehlt, einen Syntaxfehler hat oder sich nicht mit `register()` meldet, wird im Dialog als Fehler aufgeführt; die
App und die übrigen Erweiterungen laufen weiter. Dasselbe gilt für eine Erweiterung, deren `activate` oder deren
Ereignisrückruf einen Fehler wirft.

## Beschreibung (`register`)

| Feld | Pflicht | Bedeutung |
| --- | --- | --- |
| `id` | ja | Kennung, `a-z`, `0-9` und `-`, 2 bis 41 Zeichen, eindeutig |
| `api` | ja | Schnittstellenversion, heute `1`. Eine höhere Zahl als die der App wird abgelehnt |
| `name` | nein | Anzeigename (sonst die `id`) |
| `version`, `description` | nein | Anzeige im Dialog |
| `activate(ctx)` | nein | Wird nach dem ersten Zeichnen aufgerufen; darf `async` sein |
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

`action`-Funktionen dürfen `async` sein. Wirft eine Aktion einen Fehler, erscheint er in der Statuszeile; die App
läuft weiter.

## Ereignisse

| Ereignis | Wann | Daten |
| --- | --- | --- |
| `ready` | Einmal nach dem Start, wenn alles gezeichnet ist | `{}` |
| `note:open` | Eine Notiz wurde im Editor geöffnet | `{ id }` |
| `note:close` | Der Editor wurde geschlossen | `{ id }` |
| `note:saved` | Nach einer Pause im Schreiben, nachdem die Änderung übernommen wurde | `{ id }` |
| `database:replaced` | Eine andere Datei wurde geöffnet oder importiert | `{}` |

Rückrufe dürfen `async` sein. Die App wartet nicht auf sie.

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

## Texte der Erweiterung

Die Texte einer Erweiterung gehören ihr: Sie stehen nicht in den Sprachpaketen von NoNotes. Wer mehrere Sprachen
anbieten will, wählt anhand von `ctx.language()` selbst aus.

## Stabilität

- Die Namen in `ctx`, die Ereignisse und die Theme-Variablen sind für `api: 1` festgelegt. `test/plugins.cjs` prüft das.
- Neue Fähigkeiten kommen als neue Namen dazu. Wer sie nutzen will, prüft ihr Vorhandensein
  (`if (ctx.ui.addSomething) …`).
- Ein Bruch käme frühestens mit `api: 2` in NoNotes 2.0; die App meldet dann eine ältere Erweiterung
  deutlich, statt sie still falsch zu behandeln.
