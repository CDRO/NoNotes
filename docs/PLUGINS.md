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
| `ctx.language()` | Kennung der Sprache der Oberfläche, zum Beispiel `de` (Deutsch, Schweiz), `en`, seit 3.1.0 auch mit Region: `de-DE`, `fr-CH`, `it-CH`, `es-ES`, `es-MX`, `pt-PT`, `pt-BR`. Für die Sprache allein den Teil vor dem Bindestrich nehmen |
| `ctx.on(ereignis, rückruf)` | Auf ein Ereignis hören; liefert eine Funktion, die das Hören beendet |
| `ctx.openNote(id)` | Notiz im Editor öffnen (Promise) |
| `ctx.readOnly()` | Seit 2.11.0. `true` im Lesemodus (alles nur lesen, etwa als Leserin im Dienst); dann ändert `ctx.backend` nichts |
| `ctx.refresh()` | Nach Änderungen über `ctx.backend` die Oberfläche neu zeichnen (Promise) |
| `ctx.ui.setStatus(text, art)` | Text in der Statuszeile; `art` ist `'saved'`, `'dirty'`, `'saving'` oder `'error'` |
| `ctx.ui.addMenuItem({ label, title?, action })` | Eintrag im Menü **Datenbank** |
| `ctx.ui.addToolbarButton({ label, title?, action })` | Knopf in der Toolleiste des Editors; `action(editor)` bekommt die Editor-Schnittstelle |
| `ctx.ui.addMapButton({ label, title?, action })` | Seit 2.11.0. Knopf in der Leiste der Mindmap (vor dem Suchfeld); `action(button)`. Liefert den Knopf, etwa für `aria-pressed` |
| `ctx.ui.addMapOverlay(element)` | Seit 2.11.0. Ein eigenes Element über der Mindmap (etwa eine Legende); Lage und Aussehen setzt die Erweiterung (`position: absolute` im Bereich der Mindmap; die CSS-Variable `--map-bar-bottom` nennt die Unterkante der Leiste, also `top: calc(var(--map-bar-bottom) + 8px)`). Liefert eine Funktion zum Entfernen |
| `ctx.export.addMapStyle(fn)` | Seit 3.1.0. Farben im Mindmap-Bild für Markdown-Export, Druck und *Als Bild kopieren*: `fn({ target: 'export' \| 'print' \| 'copy', ids })` liefert (auch als Promise) `{ nodes: { [id]: { fill, stroke, text } }, defs }` oder nichts. `ids` sind die Notizen, die im Bild vorkommen können; `fill`, `stroke` (Rand) und `text` (Titel) sind Farben (`#rgb`, `rgb()`, `hsl()`, Namen) oder `url(#…)` auf ein Muster aus `defs` (SVG, etwa `<pattern>`, Kennungen mit eigenem Vorsatz). Was keine Farbe ist, und `defs`, die kein gültiges SVG sind, fallen weg; mehrere Erweiterungen: die spätere gewinnt je Knoten. Ein Fehler lässt nur diese Erweiterung weg. Liefert eine Funktion zum Abmelden |
| `ctx.export.addMapSection(fn)` | Seit 2.11.0. Abschnitt direkt unter dem Mindmap-Bild im Markdown-Export (`index.md` bzw. die eine Datei) und im Druck mit Mindmap-Bild: `fn({ target: 'export' \| 'print' })` liefert (auch als Promise) `{ title, markdown }` oder nichts. Ein Fehler lässt nur diesen Abschnitt weg. Liefert eine Funktion zum Abmelden |
| `ctx.ui.addContextMenuItem({ label, title?, write?, visible?, action? \| panel? })` | Seit 2.8.0. Eintrag im Kontextmenü eines Knotens der Mindmap (Rechtsklick), mit `action(target)` oder einem Untermenü `panel(target, { close })`; siehe unten |
| `ctx.ui.addTableMenuItem({ label, title?, write?, visible?, action? \| panel? })` | Seit 2.10.0. Eintrag im Menü, das ein Rechtsklick auf eine Tabelle in der Vorschau öffnet; Felder wie oben, `target` beschreibt die Tabelle; siehe [Tabellen](#tabellen-seit-2100) |
| `ctx.tables.format(fn)` | Seit 2.10.0. `fn(info)` liefert Klassen und Werte für Tabelle, Titelzeile, Spalten, Zeilen und Felder beim Zeichnen (Vorschau und Druck); liefert eine Funktion zum Abmelden |
| `ctx.tables.update(target, fn)` | Seit 2.10.0. Ändert das Format einer Tabelle in der offenen Notiz: `fn(meta)` ändert das Objekt; Promise mit `true`, wenn sich etwas geändert hat |
| `ctx.editor.noteId()` | Kennung der offenen Notiz oder `null` |
| `ctx.editor.isWritable()` | `true`, wenn eine Notiz offen und nicht schreibgeschützt ist |
| `ctx.editor.selection()` | `{ start, end, text }` der Markierung im Text |
| `ctx.editor.replaceSelection(text)` | Ersetzt die Markierung (oder fügt am Cursor ein); Promise mit `false`, wenn nichts zu bearbeiten ist |
| `ctx.people.provide(fn)` | Vorschläge für `@kürzel` beim Schreiben: `fn(prefix)` liefert (auch als Promise) `[{ handle, name }]` oder Kürzel als Text; die App führt alle Lieferanten zusammen, jedes Kürzel erscheint einmal. Liefert eine Funktion zum Abmelden; beim Ausschalten wird abgemeldet. Ohne Erweiterung gilt `NoNotesMentions.provide(fn)` für Ausprägungen (seit 1.11.0) |

`action`-Funktionen dürfen `async` sein. Wirft eine Aktion einen Fehler, erscheint er in der Statuszeile; die App
läuft weiter.

## Kontextmenü eines Knotens (seit 2.8.0)

`ctx.ui.addContextMenuItem(spec)` setzt einen Eintrag in das Menü, das ein Rechtsklick auf einen Knoten der Mindmap öffnet.
Die Einträge der Erweiterungen stehen gesammelt vor «Löschen». Die Wurzel, leere Fläche und archivierte Notizen bekommen
keine.

| Feld | Bedeutung |
| --- | --- |
| `label` | Text des Eintrags (Pflicht) |
| `title` | Tooltip |
| `write` | Vorgabe `true`: der Eintrag ändert Daten und fehlt im Lesemodus. `false` für Einträge, die nur lesen |
| `visible(target)` | Wahlweise: `false` blendet den Eintrag für dieses Ziel aus |
| `action(target)` | Ein Klick führt das aus (darf `async` sein); das Menü schliesst sich vorher |
| `panel(target, { close, applied })` | Statt `action`: Untermenü. Liefert ein Element, das die App neben dem Menü zeigt (Klick, Zeigen oder Pfeil rechts auf den Eintrag öffnet es, `Esc` oder Pfeil links schliesst es). `close()` heisst «erledigt» und schliesst Untermenü und Menü. `applied()` (seit 2.8.1) heisst «etwas getan, das Menü bleibt offen», etwa bei einem Häkchen |

`target` ist `{ id, ids }`: `id` ist der angeklickte Knoten. `ids` enthält **alle ausgewählten Notizen**, wenn der Knoten zur
Mehrfachauswahl (`Ctrl`+Klick) gehört, sonst nur `id`; archivierte fehlen. **Nach einer Aktion ist die Mehrfachauswahl
erledigt** (seit 2.8.1): Die App hebt sie auf, sobald ein Eintrag mit `action` gewählt wurde oder sich das Menü nach `close()`
bzw. `applied()` schliesst. Wer abbricht (`Esc`, Klick daneben), behält die Auswahl. Wer Daten ändert, nimmt `ctx.backend` und danach
`ctx.refresh()`. Fehler in `action` und `panel` erscheinen in der Statuszeile; wirft `visible`, fehlt der Eintrag. Das Menü
bleibt in beiden Fällen bedienbar.
Beim Ausschalten der Erweiterung verschwinden ihre Einträge.

```js
ctx.ui.addContextMenuItem({
  label: 'Markieren',
  panel(target, { close }) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${target.ids.length} Notiz(en) markieren`;
    b.addEventListener('click', async () => {
      for (const id of target.ids) await ctx.backend.setTags(id, [...await ctx.backend.getTags(id), 'markiert']);
      close();
      await ctx.refresh();
    });
    return b;
  },
});
```

Ältere Versionen haben die Funktion nicht: `if (ctx.ui.addContextMenuItem) …`.

## Tabellen (seit 2.10.0)

Tabellen sind Markdown-Tabellen wie bei GitHub. Eine Zeile direkt darüber trägt ihr Format als JSON:

```markdown
<!-- tabelle: {"kopfspalte":true,"hervorheben":true,"table-format":{"cols":{"0":{"breite":"schmal"}}}} -->
| Phase   | Start  | Ende   |
| ------- | ------ | ------ |
| Analyse | 01.11. | 15.11. |
```

Der Kern liest `kopfspalte` (erste Spalte als Titel) und `hervorheben` (Titel im Ton der Hauptfarbe). **Eine Erweiterung
legt ihre Angaben unter ihrer Kennung ab** (`meta[ctx.id]`) und lässt fremde Schlüssel stehen. So bleibt das Format beim
Ausschalten der Erweiterung im Text erhalten, und andere Markdown-Programme blenden die Zeile aus.

**Angaben je Zeile, Spalte und Feld** gehören in `meta[ctx.id].rows`, `.cols` und `.cells`, als Objekte mit den Schlüsseln
`"2"` (Zeile oder Spalte ab 0), `"h"` (Titelzeile) und `"2,1"` (Zeile, Spalte). Die App verschiebt diese Schlüssel, wenn
Zeilen oder Spalten eingefügt oder gelöscht werden (Rechtsklick, `Enter` im Text) und wenn die Titelzeile aus- oder
angeschaltet wird; gelöschte fallen weg. Was die Werte bedeuten, bestimmt die Erweiterung. Angaben an anderer Stelle bleiben
unverändert, auch wenn sich die Tabelle ändert.

**Zeichnen.** `ctx.tables.format(fn)` meldet eine Funktion an, die für jede Tabelle in Vorschau und Druck aufgerufen wird.
`fn(info)` bekommt:

| Feld | Bedeutung |
| --- | --- |
| `meta` | Das Format (Kopie), zum Beispiel `{ kopfspalte: true, 'table-format': { … } }` |
| `header`, `headerColumn` | Gibt es eine Titelzeile, ist die erste Spalte Titel? |
| `cols`, `rows` | Zahl der Spalten und der Zeilen (ohne Titelzeile) |
| `cells` | `{ header: […] \| null, rows: [[…], …] }`, der Text der Felder |
| `line` | Erste Zeile der Tabelle im Text der offenen Notiz (die Format-Zeile, ohne sie die Titelzeile); `null` in Zitaten, Blöcken und im Druck |
| `noteId` | Nur im Druck: die Notiz, zu der die Tabelle gehört (die Vorschau zeigt immer die offene) |

`fn` liefert `null`, ein Objekt oder eine Liste von Objekten der Form

```js
{
  table:   { class: 'tf-voll', width: '100%' },
  header:  { class: 'tf-kopf' },                       // die Titelzeile
  columns: { 0: { width: '30%' }, 2: { textAlign: 'right' } },
  rows:    { 0: { height: '3em' } },                   // Zeilen ab 0, ohne Titelzeile
  cells:   { '1,2': { class: 'tf-gelb', fontWeight: 'bold' }, 'h,1': { color: 'red' } },   // 'h,c' = Titelzeile
}
```

Jeder Eintrag ist `{ class?, <Eigenschaft>: Wert }`. Klassen müssen wie `tf-gelb` aussehen (Buchstabe, dann Buchstaben, Ziffern,
`-`, `_`). Erlaubt sind nur diese Eigenschaften (auch in der Schreibweise `fontWeight`): `width`, `min-width`, `max-width`,
`height`, `min-height`, `background`, `background-color`, `color`, `font-weight`, `font-style`, `text-decoration`,
`text-align`, `vertical-align`, `white-space`, `border-color`, `padding`. Werte bestehen aus Buchstaben, Ziffern, `#`, `.`, `,`,
`%`, `(`, `)`, `+`, `-` und Leerzeichen; `url(…)`, `expression` und `javascript` fallen weg, ebenso alles andere. Am Feld
gelten Spalte, dann Zeile, dann Feld (das Spätere gewinnt); die Klassen einer Zeile stehen am `<tr>`, ihre Werte an jedem Feld.
Wirft `fn`, zeichnet die App die Tabelle ohne die Angaben dieser Erweiterung.

Farben gehören am besten in Klassen mit einem eigenen Stylesheet, mit einer Variante für die dunkle Einstellung in
`@media screen and (prefers-color-scheme: dark) { … }` (mit `screen`, damit der Druck die hellen Farben behält). Die Vorschau zeichnet `table.md-table`, die Titelzeile in `thead`, Felder der
Titelspalte als `th scope="row"`; `.md-table-mark` heisst «hervorgehoben». Der Druck nutzt dieselben Klassen in `#printArea`.

**Rechtsklick.** `ctx.ui.addTableMenuItem(spec)` setzt einen Eintrag in das Menü einer Tabelle (Felder wie beim
[Kontextmenü eines Knotens](#kontextmenü-eines-knotens-seit-280); nach einem Strich unter den Einträgen der App). Das Menü
gibt es nur für Tabellen in der offenen, beschreibbaren Notiz, nicht in Zitaten und Blöcken. `target` ist eingefroren:

| Feld | Bedeutung |
| --- | --- |
| `noteId`, `line` | Notiz und erste Zeile der Tabelle im Text. Sie bleibt, wenn die Format-Zeile dazukommt oder wegfällt; dasselbe `target` taugt darum für mehrere `update` nacheinander (etwa in einem offenen Untermenü) |
| `row`, `col` | Angeklicktes Feld: Zeile ab 0 (`-1` = Titelzeile), Spalte ab 0 |
| `rows`, `cols` | Zahl der Zeilen (ohne Titelzeile) und Spalten |
| `header`, `headerColumn` | Titelzeile, Titelspalte |
| `meta` | Das Format (Kopie) |

**Format schreiben.** `ctx.tables.update(target, fn)` ruft `fn(meta)` mit einer Kopie des Formats auf; `fn` ändert sie (oder
liefert ein neues Objekt). Leere Angaben (`null`, `false`) fallen weg, ohne Angaben verschwindet die Zeile. Die App schreibt
die Zeile neu, richtet die Tabelle aus, speichert wie bei jeder Eingabe und zeichnet die Vorschau gleich neu. Das Promise
liefert `false`, wenn die Notiz nicht mehr offen oder schreibgeschützt ist oder in der Zeile keine Tabelle mehr steht.

```js
ctx.ui.addTableMenuItem({
  label: 'Spalte schmal',
  visible: t => t.cols > 1,
  action: t => ctx.tables.update(t, meta => {
    const mine = meta[ctx.id] || (meta[ctx.id] = {});
    mine.cols = Object.assign({}, mine.cols, { [t.col]: '6em' });
  }),
});
ctx.tables.format(info => {
  const mine = info.meta[ctx.id];
  if (!mine || !mine.cols) return null;
  const columns = {};
  for (const [c, w] of Object.entries(mine.cols)) columns[c] = { width: w };
  return { columns };
});
```

Ein Beispiel mit Breite, Höhe, Farben und Fett ist die Erweiterung *Tabellen formatieren* (`table-format`) im Zweig `plugins`.
Ältere Versionen haben die Namen nicht: `if (ctx.tables) …`.

## Über und unter der Mindmap (seit 2.11.0)

Eine Erweiterung kann der Mindmap etwas zur Seite stellen, etwa eine Legende:

```js
const box = document.createElement('aside');
box.className = 'meine-legende';           // Lage über eigenes CSS, zum Beispiel position: absolute; top: 56px; right: 12px
box.textContent = 'Rot: dringend';
const remove = ctx.ui.addMapOverlay(box);
const button = ctx.ui.addMapButton({ label: 'Legende', action: b => {
  box.hidden = !box.hidden;
  b.setAttribute('aria-pressed', String(!box.hidden));
} });
ctx.export.addMapSection(({ target }) => ({ title: 'Legende', markdown: '- **Rot:** dringend' }));
```

Farben im **Mindmap-Bild** (Export, Druck, *Als Bild kopieren*, seit 3.1.0), etwa damit ein Knoten mit Tag `dringend` auch im Bild rot
ist; die Erweiterung rechnet selbst aus, welche Knoten welche Farbe haben:

```js
ctx.export.addMapStyle(async ({ target, ids }) => {
  const nodes = {};
  for (const id of ids) if ((await ctx.backend.getTags(id)).includes('dringend')) nodes[id] = { fill: 'url(#meine-streifen)', stroke: '#9c1111', text: '#9c1111' };
  return { nodes, defs: '<pattern id="meine-streifen" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    + '<rect width="8" height="8" fill="#fad6d6"/><rect width="4" height="8" fill="#fdeaea"/></pattern>' };
});
```

Knopf, Element, Abschnitt und Farben entfernt die App beim Ausschalten selbst. Was dauerhaft zur Datenbank gehören soll (und im Dienst für
alle im Arbeitsbereich gilt), legt die Erweiterung mit `ctx.backend.setMeta('plugin:<kennung>:…', wert)` ab und liest es mit
`getMeta`; im Lesemodus (`ctx.readOnly()`) nur lesen. Nach einem Wechsel der Datei oder des Bereichs (Ereignis `database:replaced`)
neu lesen.

## Termine im Text (seit 3.0.0)

Termine stehen am Zeilenende hinter `>`, mit einem Leerzeichen davor: `- [ ] Offerte >30.10.2026 >6.11.2026` (der späteste ist die
Frist, die früheren sind Erinnerungen). `@` nennt nur noch Personen. Eine Erweiterung, die Termine schreibt, schreibt sie so, immer
mit dem ganzen Datum (`NoNotesDates.toText('2026-11-06')` ergibt `06.11.2026`); lesen geht mit `NoNotesDates.splitDue(text)` →
`{ text, due, reminders }`. Ein altes `@Datum` am Zeilenende liest NoNotes weiter als Termin und schreibt es beim Speichern zu `>Datum`
um. Die Mindmap merkt sich die Seite jedes Hauptasts (`side` in den Zeilen von `ctx.backend.getTree()`); eine Erweiterung, die Knoten
an der Wurzel anlegt, braucht nichts zu tun, die Mindmap wählt die Seite selbst.

## Ereignisse

| Ereignis | Wann | Daten |
| --- | --- | --- |
| `ready` | Einmal nach dem Start, wenn alles gezeichnet ist | `{}` |
| `note:open` | Eine Notiz wurde im Editor geöffnet | `{ id }` |
| `note:close` | Der Editor wurde geschlossen | `{ id }` |
| `note:saved` | Nach einer Pause im Schreiben, nachdem die Änderung übernommen wurde | `{ id }` |
| `mindmap:rendered` | Die Mindmap wurde (neu) gezeichnet. Die Verbindungslinien sind `path.mm-edge` mit `data-from` (Kennung der Elternnotiz, bei der Wurzel `root`), `data-to` (Kennung der Unternotiz) und den Endpunkten `data-x1`, `data-y1`, `data-x2`, `data-y2` | `{}` |
| `mindmap:select` | Die Auswahl in der Mindmap hat sich geändert (Klick, Tastatur, Neuzeichnen mit anderer Auswahl) | `{ id }`: Notizkennung, `'root'` für die Wurzel oder `null` ohne Auswahl |
| `database:replaced` | Eine andere Datei wurde geöffnet oder importiert, lokal auch beim Wechsel des Bereichs. Seit 2.8.1 **vor** dem Neuzeichnen: Zwischenstände zur alten Datei (gleiche Nummern, andere Notizen) hier verwerfen; `mindmap:rendered` folgt mit der neuen | `{}` |
| `template:saved` | Eine Vorlage wurde gespeichert (seit 2.5.0) | `{ name, where, id }`: `where` ist `'folder'`, `'download'` oder `'server'` |
| `template:applied` | Eine Vorlage wurde angewendet (seit 2.5.0) | `{ name, mode }`: `mode` ist `'new'` (neue Notiz) oder `'insert'` (in die offene Notiz) |
| `questions:rendered` | Die Ansicht «Fragen» oder «Entscheide» wurde (neu) gezeichnet (seit 1.11.0) | `{ kind, items }`: `kind` ist `'question'` oder `'decision'`, `items` die gezeigten Einträge mit `id`, `noteId`, `kind`, `text`, `answer`, `decided`, `due` (die Frist), seit 3.0.0 `reminders` (frühere Termine der Zeile), `people` (`[{ handle, optional }]`), seit 2.4.0 `details` (Beschreibung eines Blocks oder `null`) und `parentId` (Block eines Unter-Eintrags oder `null`), und `element` (der Eintrag in der Liste, zum Beispiel um Knöpfe oder Marken anzuhängen) |

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
anbieten will, wählt anhand von `ctx.language()` selbst aus, am besten nach der Sprache vor dem Bindestrich
(`ctx.language().split('-')[0]`: `de-DE` und `de` sind beide Deutsch) und mit Englisch als Rückfall.

## Stabilität

- Die Namen in `ctx`, die Ereignisse und die Theme-Variablen sind für `api: 1` festgelegt. `test/extend.cjs` prüft das.
- Neue Fähigkeiten kommen als neue Namen dazu. Wer sie nutzen will, prüft ihr Vorhandensein
  (`if (ctx.ui.addSomething) …`).
- Ein Bruch käme frühestens mit `api: 2` in NoNotes 2.0; die App meldet dann eine ältere Erweiterung
  deutlich, statt sie still falsch zu behandeln.
- Seit 3.1.0 (ohne Änderung an `api`): `ctx.export.addMapStyle` (Farben im Mindmap-Bild).
- Seit 3.0.0 (ohne Änderung an `api`): `reminders` in `questions:rendered`, `side` in `getTree()`, `setSides` im Backend; Termine im
  Text mit `>` (siehe oben).
- Seit 2.11.0 dazugekommen (ohne Änderung an `api`): `ctx.readOnly`, `ctx.ui.addMapButton`, `ctx.ui.addMapOverlay`, `ctx.export.addMapSection`.
- Seit 2.10.0 dazugekommen (ohne Änderung an `api`): `ctx.tables.format`, `ctx.tables.update` und `ctx.ui.addTableMenuItem`.
- Seit 2.8.0 dazugekommen (ohne Änderung an `api`): `ctx.ui.addContextMenuItem` (Kontextmenü eines Knotens, mit Untermenü).
  Seit 2.8.1: `applied()` im Untermenü, die Mehrfachauswahl wird nach einer Aktion aufgehoben, `database:replaced` kommt vor
  dem Neuzeichnen (vorher danach; wer auf die neue Mindmap angewiesen ist, hört auf `mindmap:rendered`).
- Seit 1.7.0 dazugekommen (ohne Änderung an `api`): `deactivate()` in `register`, das Verzeichnis
  `NoNotesPlugins.catalog([...])`/`available()` und das Laden und Schalten zur Laufzeit (`load`, `activate`, `disable`);
  nach 1.8.0 die Ereignisse `mindmap:rendered` und `mindmap:select` samt den `data-`Attributen an den Linien.
  `ctx` und Theme-Variablen sind unverändert.
