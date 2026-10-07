# NoNotes

Eine kleine Notiz-App, die **ohne Server, ohne Installation und ohne Adminrechte** läuft.
Sie öffnet sich als Datei im Browser, ordnet die Notizen als **Mindmap** an, sammelt
**offene Fragen** aus allen Notizen an einem Ort, versteht **Markdown** und **Tags** und
speichert alles in einer echten **SQLite-Datenbank**. Alles, was sie braucht, liegt im
entpackten Ordner.

Gebaut für Rechner mit stark eingeschränkten Rechten: Es wird kein Dienst gestartet,
kein Port geöffnet, kein Programm installiert. PowerShell ist optional und auch im
Constrained Language Mode kein Hindernis, weil sie nur den Browser öffnet.

## Voraussetzungen

- Windows 10/11 (oder ein anderes System) mit einem Chromium-Browser, z. B. **Microsoft Edge**.
  Firefox funktioniert ebenfalls, dort allerdings nur mit Kopie herunterladen / importieren
  statt direktem Schreiben in die Datei (siehe unten).
- Sonst nichts. Kein Internet, keine Adminrechte, kein .NET, kein Node.

## Start

1. ZIP aus dem [Release](../../releases) oder aus dem Workflow-Artefakt herunterladen und entpacken.
2. Eine der drei Möglichkeiten:
   - **Doppelklick auf `index.html`** (öffnet im Standardbrowser), oder
   - Doppelklick auf `start.cmd`, oder
   - in PowerShell: `.\start.ps1` (mit `-Edge` wird Edge erzwungen).

Hinweis zu `start.ps1`: Heruntergeladene Dateien tragen die Internet-Markierung, und
eine Richtlinie wie `RemoteSigned` lehnt das Skript dann ab. Einmalig lösen mit
`Unblock-File -Path .\start.ps1` oder vor dem Entpacken in den Eigenschaften des ZIP
«Zulassen» anhaken. `index.html` und `start.cmd` sind davon nicht betroffen.

## Wo liegen die Daten?

NoNotes sichert zweistufig:

1. **Browser-Speicher (automatisch).** Jede Änderung wird nach kurzer Pause in den
   Browser-Speicher (IndexedDB) geschrieben. Du kannst sofort loslegen, auch ohne eine Datei anzulegen.
   Achtung: Dieser Speicher gehört zum Browserprofil. Wer «Browserdaten löschen» ausführt,
   löscht auch die Notizen. Deshalb Schritt 2.
2. **Datenbankdatei (empfohlen).** Über `Datenbank → Datenbankdatei anlegen…` legst du
   eine `NoNotes.sqlite` an einem Ort deiner Wahl an. Ab dann schreibt die App **jede Änderung
   direkt in diese Datei**. Das ist eine ganz normale SQLite-Datei, die du sichern, kopieren,
   mitnehmen oder mit jedem SQLite-Werkzeug öffnen kannst.

Beim nächsten Start merkt sich die App die Datei und bittet mit einem Klick auf
**Mit Datei verbinden** um die Freigabe. Das ist eine Sicherheitsabfrage des Browsers,
die sich bei lokal geöffneten Seiten nicht dauerhaft wegklicken lässt. Bis zur Freigabe
arbeitest du auf der Browser-Kopie; beim Verbinden gleicht die App beide Stände ab und
fragt nur nach, wenn die Datei zwischenzeitlich von aussen verändert wurde.

Weitere Funktionen im Menü **Datenbank**:

- **Datenbankdatei öffnen…**: eine bestehende `.sqlite` von NoNotes laden und ab dann darin arbeiten.
- **Kopie herunterladen**: Stand als `NoNotes-JJJJ-MM-TT.sqlite` in den Download-Ordner legen.
- **Aus Datei importieren…**: eine solche Kopie wieder einlesen (ersetzt den aktuellen Stand).
- **Dateiverbindung trennen**: nur noch im Browser-Speicher arbeiten.

Fremde SQLite-Dateien werden beim Öffnen und Importieren abgelehnt.

## Bedienung

### Mindmap (Startansicht)

Die Notizen bilden einen Baum um einen zentralen Knoten, dessen Titel du per Doppelklick
änderst. Jede Notiz zeigt nur ihren Titel.

| Aktion | So geht's |
| --- | --- |
| Notiz öffnen | Doppelklick auf den Knoten oder `Enter`. Der Editor öffnet sich im Vollbild, `Esc` oder «Zurück» schliesst ihn. |
| Neue Notiz | **Neue Notiz** oder `Tab`: hängt eine Unternotiz an den ausgewählten Knoten (ohne Auswahl an die Wurzel) und fragt gleich den Titel ab. |
| Umbenennen | `F2` oder Rechtsklick → Umbenennen. |
| Umhängen | Knoten mit der Maus auf einen anderen Knoten oder die Wurzel ziehen. |
| Reihenfolge | `Alt+↑` / `Alt+↓` oder Rechtsklick → Nach oben / Nach unten. |
| Ein-/Ausklappen | Kleiner Kreis am Knoten (zeigt eingeklappt die Anzahl der verborgenen Notizen) oder Rechtsklick. |
| Löschen | `Entf` oder Rechtsklick → Löschen. Unternotizen rücken zum übergeordneten Knoten auf. |
| Navigieren | Pfeiltasten wandern durch den Baum. Mausrad zoomt, Ziehen der Fläche verschiebt, `0` oder **Einpassen** zeigt alles. |

### Liste, Suche, Tags, Papierkorb

Der Umschalter oben wechselt zur klassischen Liste mit Suche und Editor nebeneinander.

- Die **Suche** filtert Titel und Inhalt, auch mit Umlauten und unabhängig von
  Gross-/Kleinschreibung, und hebt die Treffer in der Liste hervor. Dieselbe Suche gibt es
  oben in der Mindmap: Treffer leuchten, der Rest wird blass, `Enter` springt von Treffer zu
  Treffer (auch in eingeklappte Äste).
- **Tags** vergibst du im Editor unter dem Titel: tippen, `Enter` oder Komma. Die Auswahl
  «Alle Tags» in Liste und Fragen filtert danach.
- **Löschen** verschiebt in den **Papierkorb** (Auswahl «Papierkorb» in der Liste). Dort
  lässt sich eine Notiz wiederherstellen oder endgültig löschen; «Papierkorb leeren» räumt
  alles weg. Notizen im Papierkorb erscheinen weder in der Mindmap noch bei den Fragen.

### Fragen

Eine Zeile, die mit `?` beginnt, ist eine Frage. Direkt darunter stehende Zeilen, die mit `!`
beginnen, sind die Antwort. Der Notiztext bleibt die einzige Wahrheit, die App führt nur
einen Index darüber.

```
? Wie hoch ist das Budget?
! 20'000 CHF laut Mail von Anna
```

- Im Editor setzen **? Frage** und **! Antwort** (oder `Ctrl+Shift+F` / `Ctrl+Shift+A`) das
  Zeichen auf der aktuellen Zeile oder nehmen es wieder weg.
- Die Ansicht **Fragen** listet alle Fragen aller Notizen, nach Notiz gruppiert. Standardfilter
  ist *Offen*; *Alle* und *Beantwortet* holen den Rest zurück, die Suche filtert nach Text.
- **Beantworten** schreibt die Antwort als `!`-Zeile direkt unter die Frage in die Notiz.
  **Antwort bearbeiten** ändert sie, ein leerer Text macht die Frage wieder offen.
- **Zur Notiz** öffnet die Notiz im Vollbild und springt zur Zeile der Frage.
- In der Mindmap zeigt eine Marke am Knoten die Anzahl offener Fragen; eingeklappte Äste
  zählen ihren ganzen Teilbaum. Der Reiter *Fragen* trägt die Gesamtzahl.

### Editor und Markdown

- Der Text ist Markdown: Überschriften, Listen, Aufgabenlisten `- [ ]`, Zitate, Code,
  Links, Bilder, fett und kursiv. `[[Titel]]` verweist auf eine andere Notiz; ein Klick in
  der Vorschau öffnet sie, bei fehlendem Ziel wird sie auf Wunsch als Unternotiz angelegt.
- Die Darstellung wechselt zwischen **Bearbeiten**, **Geteilt** (Text und Vorschau
  nebeneinander) und **Vorschau**, auch mit `Ctrl+E`. Die Einstellung wird gemerkt.
- Oberste Zeile ist der Titel, `Enter` springt in den Text.
- Der Pfad über dem Titel zeigt, wo die Notiz im Baum hängt; die Einträge sind anklickbar.
- **+ Unternotiz** legt direkt eine Unternotiz an.
- `Ctrl+S` speichert sofort (passiert sonst automatisch nach kurzer Pause).
- Auf schmalen Fenstern wird zwischen Liste und Editor umgeschaltet (`Esc` oder «Zurück»).

## Technik

| Teil | Umsetzung |
| --- | --- |
| Oberfläche | `index.html`, `css/app.css`, `js/app.js` – reines HTML/CSS/JS, keine Frameworks, kein Build |
| Mindmap | `js/mindmap.js`: eigenes Layout (links/rechts ausbalanciert), SVG, Zoom, Ziehen, Tastatur |
| Fragen | `js/questions.js`: Parser für `?`/`!`-Zeilen; Index in der Tabelle `questions`, bei jeder Änderung abgeglichen |
| Markdown | `js/markdown.js`: eigener Renderer, escaped allen Text, erlaubt nur sichere Link-Schemata |
| Datenbank | [sql.js](https://github.com/sql-js/sql.js) (SQLite nach JavaScript kompiliert) in `vendor/sql.js/`; Schema und Abfragen in `js/db.js` |
| Persistenz | `js/storage.js`: IndexedDB (ersatzweise localStorage) plus File System Access API für die Datei |
| Start | `start.ps1` (nur Cmdlets, läuft im Constrained Language Mode), `start.cmd` |

Warum kein lokaler Webserver? Auf dem Zielrechner steht PowerShell nur im Constrained
Language Mode zur Verfügung. Dort sind weder `HttpListener` noch der Zugriff auf
`winsqlite3.dll` möglich. Die App braucht beides nicht: Der Browser bringt mit der
File System Access API alles mit, um direkt in die Datenbankdatei zu schreiben, und
sql.js liefert SQLite als reines JavaScript.

Schema (Version 4). Ältere Datenbanken werden beim Öffnen automatisch migriert.

```sql
CREATE TABLE notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,   -- ISO 8601, UTC
  updated_at TEXT NOT NULL,
  parent_id  INTEGER,         -- NULL = hängt an der Wurzel
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed  INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT             -- gesetzt = im Papierkorb
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- schema_version, created_at, map_title
CREATE TABLE questions (          -- Index über die ?/!-Zeilen, wird aus dem Text abgeleitet
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  norm        TEXT NOT NULL,      -- normalisiert, zum Wiedererkennen nach Änderungen
  answer      TEXT,               -- NULL = offen
  line_no     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  answered_at TEXT
);
CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE note_tags (note_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (note_id, tag_id));
```

## Entwicklung

Für die App selbst ist nichts zu bauen: Dateien ändern, `index.html` neu laden.

Der Smoke-Test öffnet die App wie ein Benutzer per `file://` in headless Chromium und
prüft Anlegen, Suchen, Speichern, Neuladen, Herunterladen, Importieren, Löschen, das
Schreiben in die Datenbankdatei, die Mindmap-Bedienung, die Fragen, Markdown-Vorschau, Tags,
Papierkorb, Suche und die Migration alter Datenbanken:

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

## Release

Der Workflow `.github/workflows/package.yml` läuft bei jedem Push: Smoke-Test, dann ZIP
als Artefakt. Ein Release mit Tag entsteht auf zwei Wegen:

- **Manuell**: unter *Actions → Testen und paketieren → Run workflow* den gewünschten Stand
  wählen und die Version eingeben, z. B. `v0.1.0`. Der Workflow legt den Tag auf diesem
  Commit an, baut das ZIP und veröffentlicht das Release.
- **Per Tag**: `git tag v0.1.0 && git push origin v0.1.0` löst denselben Ablauf aus.

Die Versionsnummer wird dabei in die App geschrieben und erscheint oben neben dem Namen.
