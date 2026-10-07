# NoNotes

Eine kleine Notiz-App, die **ohne Server, ohne Installation und ohne Adminrechte** läuft.
Sie öffnet sich als Datei im Browser, ordnet die Notizen als **Mindmap** an und speichert
alles in einer echten **SQLite-Datenbank**. Alles, was sie braucht, liegt im entpackten Ordner.

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

### Liste

Der Umschalter oben wechselt zur klassischen Liste mit Suche und Editor nebeneinander.
Die Suche filtert Titel und Inhalt, auch mit Umlauten und unabhängig von Gross-/Kleinschreibung.

### Editor

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
| Datenbank | [sql.js](https://github.com/sql-js/sql.js) (SQLite nach JavaScript kompiliert) in `vendor/sql.js/`; Schema und Abfragen in `js/db.js` |
| Persistenz | `js/storage.js`: IndexedDB (ersatzweise localStorage) plus File System Access API für die Datei |
| Start | `start.ps1` (nur Cmdlets, läuft im Constrained Language Mode), `start.cmd` |

Warum kein lokaler Webserver? Auf dem Zielrechner steht PowerShell nur im Constrained
Language Mode zur Verfügung. Dort sind weder `HttpListener` noch der Zugriff auf
`winsqlite3.dll` möglich. Die App braucht beides nicht: Der Browser bringt mit der
File System Access API alles mit, um direkt in die Datenbankdatei zu schreiben, und
sql.js liefert SQLite als reines JavaScript.

Schema (Version 2). Ältere Datenbanken werden beim Öffnen automatisch migriert.

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
```

## Entwicklung

Für die App selbst ist nichts zu bauen: Dateien ändern, `index.html` neu laden.

Der Smoke-Test öffnet die App wie ein Benutzer per `file://` in headless Chromium und
prüft Anlegen, Suchen, Speichern, Neuladen, Herunterladen, Importieren, Löschen, das
Schreiben in die Datenbankdatei, die Mindmap-Bedienung und die Migration alter Datenbanken:

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

## Release

Der Workflow `.github/workflows/package.yml` läuft bei jedem Push: Smoke-Test, dann ZIP
als Artefakt. Bei einem Tag `vX.Y.Z` wird zusätzlich ein GitHub-Release mit dem ZIP erstellt
und die Versionsnummer in die App geschrieben:

```bash
git tag v1.0.0
git push origin v1.0.0
```
