# NoNotes

Eine kleine Notiz-App, die **ohne Server, ohne Installation und ohne Adminrechte** läuft.
Sie öffnet sich als Datei im Browser, ordnet die Notizen als **Mindmap** an, sammelt
**offene Fragen** und **Aufgaben** aus allen Notizen an einem Ort, versteht **Markdown**,
**Tags** und **Bilder**, **druckt** und **exportiert** alles samt Mindmap-Bild und speichert
in einer echten **SQLite-Datenbank**. Alles, was sie braucht, liegt im entpackten Ordner.

Gebaut für Rechner mit stark eingeschränkten Rechten: Es wird kein Dienst gestartet,
kein Port geöffnet, kein Programm installiert. PowerShell ist optional und auch im
Constrained Language Mode kein Hindernis, weil sie nur den Browser öffnet.

## Nutzung

NoNotes darf **kostenlos für den eigenen Gebrauch** genutzt werden. Alle Rechte bleiben vorbehalten: Eine Lizenz, die
darüber hinausgeht (Weitergabe, Veränderung und Weitergabe, Verkauf, Betrieb als Dienst für andere), gibt es noch nicht.
Der Quelltext ist einsehbar. Fehler und Wünsche gern als Issue; Pull Requests werden vorerst nicht angenommen.

## Voraussetzungen

- Windows 10/11 (oder ein anderes System) mit einem Chromium-Browser, z. B. **Microsoft Edge**.
  Firefox funktioniert ebenfalls, dort allerdings nur mit Kopie herunterladen / importieren
  statt direktem Schreiben in die Datei (siehe unten).
- Sonst nichts. Kein Internet, keine Adminrechte, kein .NET, kein Node.

## Start

1. ZIP aus dem [Release](../../releases) oder aus dem Workflow-Artefakt herunterladen und entpacken. Es gibt zwei:
   `NoNotes-<Version>.zip` (die App mit den zwei Beispiel-Erweiterungen) und `NoNotes-with-Plugins-<Version>.zip`
   (dieselbe App, zusätzlich alle Erweiterungen aus [CDRO/NoNotes-plugins](https://github.com/CDRO/NoNotes-plugins),
   jede mit ihrer Anleitung im Ordner `plugins/`; eingeschaltet wird unter **Datenbank → Erweiterungen…**).
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

**Änderungen von aussen.** Beschreibt ein anderes Programm (etwa ein KI-Agent, siehe unten) oder ein anderer Tab dieselbe Datei (oder den
Browser-Speicher), merkt die App das beim Zurückkehren in den Tab, alle 30 Sekunden und kurz vor dem Speichern. Ohne ungesicherte Änderungen
lädt sie den neuen Stand still. Mit ungesicherten Änderungen führt sie beides Notiz für Notiz zusammen (seit 2.2.0); nur wenn dieselbe Notiz an
derselben Stelle geändert wurde oder die eigene Änderung den Baum, Bilder, Papierkorb oder Archiv betrifft, fragt sie: **Datei laden** verwirft
die eigenen Änderungen, **Meine Fassung behalten** überschreibt die Datei. Bis zur Entscheidung wird nichts geschrieben.

**Mehrere Bereiche** (seit 2.3.0). Für getrennte Themen, etwa Arbeit und Privat, legst du Bereiche an: jeder ist eine eigene
Datenbank mit eigener Browser-Kopie, eigener Datei und eigener Hauptfarbe. Bearbeitet wird immer der aktive Bereich; Listen, Fragen,
Entscheide, Aufgaben und Suche zeigen nur ihn.

- **Wechseln:** Klick auf die Ablage unten links in der Statusleiste, `Datenbank → Bereiche…`, `Alt+1` … `Alt+9` nach der Stelle in
  der Liste, `Alt+0` für das Menü. Die offene Notiz wird vorher gespeichert; der Wechsel dauert Sekundenbruchteile.
- **Anlegen:** «Neuer Bereich…» beginnt leer (danach eine eigene Datenbankdatei anlegen); «Datei als Bereich öffnen…» nimmt eine
  vorhandene NoNotes-Datei als weiteren Bereich auf. Dieselbe Datei in zwei Bereichen gibt es nicht: die App wechselt dann dorthin.
- **Adresse:** `index.html#w=arbeit` öffnet den Bereich «Arbeit» direkt, als Lesezeichen oder Verknüpfung auf dem Desktop. Die
  Kennung entsteht aus dem Namen (klein, ohne Umlaute: «Projekt Ä» → `projekt-ae`) und bleibt beim Umbenennen gleich; der neue Name
  gilt in der Adresse ebenfalls. `#w=2` öffnet den zweiten Bereich der Liste. Gibt es den Bereich nicht, bietet die App an, ihn anzulegen.
  `?w=arbeit` geht ebenfalls, aber ein Webserver, der weiterleitet, wirft diesen Teil weg (etwa `npx serve`, das `index.html` auf `/`
  umleitet); der Teil nach `#` bleibt bei Weiterleitungen erhalten (seit 2.3.2). Eine Änderung von `#w=…` in der Adressleiste wechselt
  den Bereich ohne Neuladen.
- **Auf dem Desktop** (seit 2.3.3): im Menü der Bereiche «Startdatei für den Desktop…». Die App legt eine kleine Datei wie
  `NoNotes Arbeit.html` an, am liebsten gleich auf dem Desktop; ein Doppelklick öffnet im Browser genau diesen Bereich. Eine
  Windows-Verknüpfung auf eine `file:///…`-Adresse taugt dafür nicht: Windows macht daraus einen Dateipfad und wirft den Teil nach
  `?` und `#` weg, der Browser öffnet dann den zuletzt benutzten Bereich. Wird der Ordner der App verschoben, eine neue Startdatei anlegen.
- **Adresse kopieren** (seit 2.3.1) legt die Adresse des Bereichs in die Zwischenablage, für Lesezeichen im Browser. Verweigert der
  Browser die Zwischenablage, zeigt die App die Adresse zum Kopieren mit `Ctrl+C`.
- **Tabs:** Jeder Tab hat seinen eigenen aktiven Bereich; zwei Tabs mit verschiedenen Bereichen stören sich nicht. Der Titel des Tabs
  nennt den Bereich.
- **Freigaben:** Nach einem Neustart des Browsers fragt er für jede Datei einmal um Erlaubnis, beim ersten Wechsel in ihren Bereich.
- **Entfernen** nimmt den Bereich aus der Liste und löscht seine Browser-Kopie; die Datei auf der Platte bleibt.

Wer schon mit einer Datei arbeitet, merkt erst etwas, wenn ein zweiter Bereich dazukommt: der bisherige heisst dann wie seine Datei
(oder wie seine Mindmap) und bleibt der erste in der Liste.

Weitere Funktionen im Menü **Datenbank**:

- **Datenbankdatei öffnen…**: eine bestehende `.sqlite` von NoNotes in den aktiven Bereich laden und ab dann darin arbeiten.
- **Kopie herunterladen**: Stand als `NoNotes-JJJJ-MM-TT.sqlite` in den Download-Ordner legen.
- **Aus Datei importieren…**: eine solche Kopie wieder einlesen (ersetzt den aktuellen Stand).
- **Dateiverbindung trennen**: nur noch im Browser-Speicher arbeiten.

Fremde SQLite-Dateien werden beim Öffnen und Importieren abgelehnt.

### Drucken

**Drucken…** gibt es in der Mindmap-Leiste, im Editor, im Kontextmenü eines Knotens und
mit `Ctrl+P`. Der Dialog fragt den Umfang: nur diese Notiz, diese Notiz mit allen
Unternotizen, die ausgewählten Notizen (wahlweise mit Unternotizen) oder alle Notizen.
Dazu wählbar: Mindmap-Bild voranstellen (bei Teilmengen nur der gedruckte Ausschnitt),
Inhaltsverzeichnis, jede Notiz auf einer neuen Seite. Gedruckt wird die gerenderte Ansicht
mit Markdown, Bildern, Fragen und Antworten; geht eine Tabelle über mehrere Seiten, steht ihre
Titelzeile auf jeder. Im Druckdialog des Browsers lässt sich
«Als PDF speichern» wählen.

In der Ansicht **Fragen** druckt **Drucken…** (oder `Ctrl+P`) ein Fragen-und-Antworten-Dokument:
wie angezeigt, nur offene, nur beantwortete oder alle Fragen, nach Notiz gruppiert, auf Wunsch
mit Linien für handschriftliche Antworten bei offenen Fragen.

### Export als Markdown

`Datenbank → Als Markdown exportieren…` bietet zwei Formen, jeweils mit dem Bild der
Mindmap (`mindmap.svg` und `mindmap.png`), das oben in der Übersicht eingebunden ist:

- **Eine Datei pro Notiz**: `index.md` mit Mindmap, Inhaltsverzeichnis in Baumreihenfolge
  und der Liste offener Fragen, dazu eine Datei pro Notiz mit Pfad, Datum, Tags, Inhalt und
  Links zu den Unternotizen. Die Ordner bilden den Baum ab (seit 2.8.3): `notes/planung.md`,
  ihre Unternotizen in `notes/planung/`, deren Unternotizen in `notes/planung/budget/` usw.
  Gleichnamige Notizen an verschiedenen Orten (etwa jedes «Protokoll» unter seinem Projekt)
  bleiben so getrennt; gleichnamige Geschwister heissen `titel.md`, `titel-2.md` usw.
  Alle Links sind relativ und funktionieren auch im ZIP.
- **Alles in einer Datei**: eine Markdown-Datei mit dem Bild oben, Inhaltsverzeichnis und
  allen Notizen als Abschnitte (Tiefe = Überschriftenebene); die Bilder liegen als Anhänge daneben.

Fragen und Antworten werden zu Zitatblöcken (`> **Offene Frage:** …`, `> **Antwort:** …`),
`[[Titel]]` zu normalen Markdown-Links. Ziel ist wahlweise ein Ordner deiner Wahl (Edge und
andere Chromium-Browser) oder ein ZIP zum Herunterladen.

### Termine in den Kalender (.ics)

`Datenbank → Termine in Kalender exportieren (.ics)…` schreibt alle Aufgaben und Fragen mit
Termin als iCalendar-Datei, die sich in Outlook, Thunderbird, Google Kalender oder Apple
Kalender importieren oder abonnieren lässt.

- Mit Uhrzeit dauert ein Termin 30 Minuten, ohne Uhrzeit ist er ganztägig. Erinnerung
  30 Minuten vorher bzw. am Vortag um 9 Uhr (abschaltbar).
- Jeder Termin trägt eine feste Kennung (UID) aus einer Kennung der Datenbank und der Nummer
  des Eintrags. Sie bleibt erhalten, wenn Termin oder Status wechseln; die Versionsnummer
  (SEQUENCE) steigt mit jedem Export. Kalenderprogramme aktualisieren deshalb bestehende
  Termine, statt sie zu duplizieren.
- Erledigte Aufgaben und beantwortete Fragen werden als abgesagt (`STATUS:CANCELLED`)
  mitgeschrieben, damit sie im Kalender verschwinden. Dasselbe gilt für früher exportierte
  Einträge, die es nicht mehr gibt (umformuliert, gelöscht, Notiz im Papierkorb): Die App
  merkt sich alle je exportierten Kennungen und sagt sie noch ein Jahr über den Termin hinaus
  ab. Abschaltbar, dann enthält die Datei nur offene Termine.
- **Empfohlen: feste Datei.** «Kalenderdatei anlegen…» fragt einmal nach dem Speicherort
  (z. B. `NoNotes.ics`) und merkt ihn sich; jeder weitere Export überschreibt die Datei mit
  dem aktuellen Stand. Thunderbird bindet eine solche Datei direkt als Kalender ein (Neuer
  Kalender → Im Netzwerk → iCalendar, Adresse `file:///C:/…/NoNotes.ics`) und liest Änderungen
  automatisch. Alternativ **Herunterladen** und im Kalenderprogramm importieren; beim erneuten
  Import werden Termine mit bekannter Kennung ersetzt. Die Hilfe (`?` → Datenablage) beschreibt
  den Weg für Outlook, Google und Apple.

## Bedienung

Die **Statusleiste** am unteren Rand zeigt links, wo die Daten liegen und ob alles gespeichert ist, rechts bei
offener Notiz «Erstellt» und «Geändert» sowie die offenen Fragen und Aufgaben; bei einer Mehrfachauswahl in der
Mindmap stehen dort die Anzahl und die Knöpfe dazu. Fehler erscheinen zusätzlich für einige Sekunden als Banner
oben.


### Mindmap (Startansicht)

Die Notizen bilden einen Baum um einen zentralen Knoten, dessen Titel du per Doppelklick
änderst. Jede Notiz zeigt nur ihren Titel.

| Aktion | So geht's |
| --- | --- |
| Notiz öffnen | Doppelklick auf den Knoten oder `Enter`. Der Editor öffnet sich im Vollbild, `Esc` oder «Zurück» schliesst ihn. |
| Neue Notiz | **Neue Notiz** oder `Tab`: hängt eine Unternotiz an den ausgewählten Knoten (ohne Auswahl an die Wurzel) und fragt gleich den Titel ab. |
| Umbenennen | `F2` oder Rechtsklick → Umbenennen. |
| Umhängen | Knoten mit der Maus auf die Mitte eines anderen Knotens oder auf die Wurzel ziehen. |
| Reihenfolge | Knoten auf den oberen oder unteren Rand eines Geschwisterknotens ziehen (grüne Einfügemarke), oder `Alt+↑` / `Alt+↓`, oder Rechtsklick → Nach oben / Nach unten. |
| Ein-/Ausklappen | Kleiner Kreis am Knoten (zeigt eingeklappt die Anzahl der verborgenen Notizen) oder Rechtsklick. |
| Löschen | `Entf` oder Rechtsklick → Löschen. Unternotizen rücken zum übergeordneten Knoten auf. |
| Navigieren | Pfeiltasten wandern durch den Baum. Mausrad zoomt, Ziehen der Fläche verschiebt, `0` oder **Einpassen** zeigt alles. |
| Mehrere auswählen | `Ctrl`+Klick (oder `Shift`+Klick) sammelt Knoten; die Leiste unten zeigt die Anzahl, bietet **Drucken…** und **Auswahl aufheben** (`Esc`). In der Liste geht `Ctrl`+Klick ebenso. |
| Querverweise | Ein `[[Titel*]]` im Text (Stern am Ende) zieht eine **gestrichelte Linie** mit Pfeil zur Notiz mit diesem Titel, quer zur Hierarchie. Die Linie beginnt am äusseren Ende des Knotens (weg von der Wurzel) und endet von unten in der Mitte des Ziels oder, wenn das Ziel keine Unternotizen hat, aussen an dessen Ende; muss sie zurück Richtung Wurzel, macht sie zuerst eine Kehre über oder unter dem Knoten. Gewählt wird der Weg, der am wenigsten durch andere Knoten führt; die Linien liegen unter den Knoten. Der Schalter **Verweise** in der Leiste blendet alle Linien aus oder ein und erscheint nur, wenn es welche gibt; die Wahl merkt sich der Browser. Eingeklappte Ziele bekommen keine Linie. Export und Druck zeichnen die Linien im Mindmap-Bild. |

### Hauptfarbe

Unter **Datenbank → Hauptfarbe** stehen acht Farben zur Wahl: Blau (Vorgabe), Türkis, Grün, Gelb, Orange,
Rot, Violett und Grau. Die Wahl wirkt sofort auf Knöpfe, Wurzelknoten, Abzeichen, Links und Auswahl und (seit 2.7.1) auf das
Symbol im Tab des Browsers, so lassen sich mehrere offene Bereiche oder Arbeitsbereiche an der Farbe unterscheiden; jeweils
mit einer passenden hellen und dunklen Fassung (je nach Einstellung des Systems) und einer Schriftfarbe, die auf
der Fläche gut lesbar bleibt. Die Farbe wird **in der Datenbankdatei** gespeichert (Tabelle `meta`, Schlüssel
`accent`), gehört also zur Datei und wandert mit ihr; ein Zwischenspeicher im Browser verhindert, dass beim Start
kurz Blau aufblitzt. Das Mindmap-Bild in Export und Druck übernimmt die Farbe.

### Verlauf pro Notiz

**Notiz → Verlauf…** im Editor zeigt frühere Fassungen der Notiz. Eine neue Fassung entsteht, wenn du nach einer
Pause von mehr als fünf Minuten weiterarbeitest (oder nach 30 Minuten Dauerarbeit); während des Schreibens bleibt es
bei einer Fassung, damit der Verlauf nicht aus Hunderten Tastenanschlägen besteht. Gespeichert werden **nur die
Unterschiede**, nicht ganze Kopien: bei einer 100-KB-Notiz mit Änderungen an einer Stelle kostet jede Fassung nur die
geänderte Stelle.

- Im Dialog wählst du eine Fassung und siehst ihren Text. Mit **Unterschiede zur aktuellen Fassung markieren** (Vorgabe)
  sind die Zeilen grün, die beim Wiederherstellen dazukommen, und rot durchgestrichen die, die dabei verloren gehen.
- **Diese Fassung wiederherstellen** macht sie zum Text der Notiz (Titel eingeschlossen). Der Stand davor bleibt als
  Fassung erhalten, ein Wiederherstellen lässt sich also selbst wieder rückgängig machen.
- **Verlauf dieser Notiz löschen** leert den Verlauf, der aktuelle Text bleibt.
- Aufbewahrt werden höchstens **50 Fassungen** und **180 Tage** je Notiz; die ältesten gehen zuerst. Die Werte lassen sich
  in der Tabelle `meta` ändern: `history_max_versions`, `history_max_days`; `history_enabled` = `0` schaltet den
  Verlauf aus.
- Archivierte Notizen kann man im Verlauf ansehen, aber nicht wiederherstellen. Der Verlauf liegt in der Datenbankdatei
  (Tabelle `note_history`) und geht mit der Notiz in den Papierkorb; endgültiges Löschen entfernt ihn.

### Erweiterungen und Designs

NoNotes lässt sich mit **Erweiterungen** (Plugins) ergänzen: Skriptdateien im Ordner `plugins/` neben der App.
Unter **Datenbank → Erweiterungen…** siehst du, was im Ordner liegt, und schaltest es mit einem Schalter ein oder aus,
sofort und ohne die Seite neu zu laden; die Wahl merkt sich der Browser. Eine eigene Datei legst du in den Ordner und
gibst im Dialog ihren Namen ein. Eine Erweiterung kann Menüeinträge, Toolleistenknöpfe und (seit 2.8.0) Einträge mit
Untermenü im Kontextmenü eines Knotens der Mindmap hinzufügen, auf Ereignisse
reagieren, über dieselbe Schnittstelle wie die App auf die Daten zugreifen und ein **Design** mitbringen (Auswahl
«Design» im Menü, gespeichert in der Datei wie die Hauptfarbe).

**Achtung:** Eine Erweiterung läuft mit allen Rechten der Seite und kann alle Notizen lesen und ändern. Schalte nur
Dateien ein, denen du vertraust. Erweiterungen kommen nie aus der Datenbankdatei, nur aus dem Ordner `plugins/`. Im Ordner
`plugins/beispiele/` liegen zwei Beispiele (Datum einfügen, Design «Sepia»). Die Schnittstelle ist asynchron und
bleibt innerhalb von 1.x stabil; Beschreibung für Autoren in [docs/PLUGINS.md](docs/PLUGINS.md).

### KI-Agenten

Seit 2.1.0 beschreibt NoNotes seine Daten als **Werkzeuge für Agenten** (MCP): Übersicht, Notizen suchen und lesen, anlegen und
ergänzen, Fragen beantworten, Entscheide festhalten, Aufgaben abschliessen, Tags setzen, Verlauf lesen. Im Browser meldet die Seite
diese Werkzeuge beim **Agenten des Browsers** an (WebMCP, `document.modelContext`), etwa Copilot in Edge oder Gemini in Chrome: Er
kann dann auf Zuruf offene Fragen zusammenfassen oder eine Antwort unter die Frage schreiben; vor Änderungen fragt er nach, gespeichert
wird wie bei jeder Eingabe. Stand Oktober 2026 bauen die Browser WebMCP gerade ein; ein Agent, der die Werkzeuge einer Seite aufruft,
ist noch nicht ausgeliefert. NoNotes ist bereit, sobald er kommt, und tut bis dahin nichts. Im Lesemodus gibt es nur lesende Werkzeuge.
Für Agenten über das Netz liegt das Protokoll bei (für Ausprägungen mit Server).

**Agenten auf dem eigenen Rechner** (seit 2.2.0): Claude Code, VS Code mit GitHub Copilot, Claude Desktop und die Copilot CLI starten
das mitgelieferte Programm `agent/nonotes-mcp.cjs` (braucht Node 18 oder neuer) und arbeiten damit auf derselben `NoNotes.sqlite`
wie die App. `node agent/nonotes-mcp.cjs --config "<Pfad zur NoNotes.sqlite>"` zeigt die Einträge zum Kopieren. Die App merkt
Änderungen des Agenten und führt sie mit eigenen ungesicherten Änderungen Notiz für Notiz zusammen. Einzelheiten und Grenzen:
[docs/AGENTS.md](docs/AGENTS.md).

### Liste, Suche, Tags, Papierkorb, Archiv

Der Umschalter oben wechselt zur klassischen Liste mit Suche und Editor nebeneinander.

- Die **Suche** filtert Titel und Inhalt, auch mit Umlauten und unabhängig von
  Gross-/Kleinschreibung, und hebt die Treffer in der Liste hervor. Dieselbe Suche gibt es
  oben in der Mindmap: Treffer leuchten, der Rest wird blass, `Enter` springt von Treffer zu
  Treffer (auch in eingeklappte Äste).
- **Tags** vergibst du im Editor unter dem Titel: tippen, `Enter` oder Komma. Die Auswahl
  «Alle Tags» in Liste und Fragen filtert danach.
- **Archivieren** legt eine Notiz samt allen Unternotizen ins **Archiv**: per Rechtsklick auf den
  Knoten, mit dem Knopf im Editor oder in der Auswahlleiste (mehrere Notizen), jeweils nach
  Rückfrage mit der Anzahl. Archivierte Notizen behalten ihren Platz im Baum, sind aber ausgeblendet.
  - Der Schalter **Archiv anzeigen** in der Mindmap-Leiste blendet sie blass und gestrichelt ein
    (die Wahl wird gemerkt); die Liste hat den Bereich «Archiv».
  - **Die Suche findet das Archiv immer**, in Liste und Mindmap. Das unterscheidet es vom
    Papierkorb. Treffer im Archiv erscheinen in der Mindmap samt ihren archivierten Vorfahren, auch
    wenn das Archiv ausgeblendet ist.
  - Archivierte Notizen sind schreibgeschützt: kein Umbenennen, kein Umhängen, keine Unternotiz.
    Ihre Fragen und Aufgaben fehlen in den Listen, Zählern und Mindmap-Marken; im Kalenderexport
    werden ihre Termine beim nächsten Export als abgesagt mitgeschrieben. `[[Verweise]]` auf sie
    bleiben gültig.
  - **Zurückholen** geht Notiz für Notiz (Rechtsklick auf den archivierten Knoten oder Knopf im
    Editor). Es holt genau diese Notiz und alle archivierten Notizen darüber zurück, damit sie nicht
    in der Luft hängt. Ihre archivierten Unternotizen bleiben im Archiv.
  - Beim Drucken und Exportieren sind archivierte Notizen nur mit dem Kästchen «Archivierte Notizen
    mit einbeziehen» dabei.
  - Archiv und Papierkorb sind unabhängig: Eine archivierte Notiz lässt sich löschen, und beim
    Wiederherstellen aus dem Papierkorb liegt sie weiterhin im Archiv.
- **Löschen** verschiebt in den **Papierkorb** (Auswahl «Papierkorb» in der Liste). Dort
  lässt sich eine Notiz wiederherstellen oder endgültig löschen; «Papierkorb leeren» räumt
  alles weg. Notizen im Papierkorb erscheinen weder in der Mindmap noch bei den Fragen.

### Fragen

Eine Zeile, die mit `?` beginnt, ist eine Frage. Direkt darunter stehende Zeilen, die mit `!`
beginnen, sind die Antwort. Ein Termin darf wie bei Aufgaben am Zeilenende stehen. Der
Notiztext bleibt die einzige Wahrheit, die App führt nur einen Index darüber.

```
? Wie hoch ist das Budget? @15.10.2026
! 20'000 CHF laut Mail von Anna
```

- Im Editor setzen **? Frage** und **! Antwort** (oder `Ctrl+Shift+F` / `Ctrl+Shift+A`) das
  Zeichen auf der aktuellen Zeile oder nehmen es wieder weg.
- Die Ansicht **Fragen** listet alle Fragen aller Notizen. Standardfilter ist *Offen*; *Alle*
  und *Beantwortet* holen den Rest zurück, die Suche filtert nach Text. Sortierung nach
  Fälligkeit gruppiert in Überfällig, Heute, Diese Woche, Später und Ohne Termin, alternativ
  nach Notiz. Der Reiter zeigt die offenen Fragen, rot wenn eine überfällig ist.
- **Beantworten** schreibt die Antwort als `!`-Zeile direkt unter die Frage in die Notiz.
  **Antwort bearbeiten** ändert sie, ein leerer Text macht die Frage wieder offen.
- **Zur Notiz** öffnet die Notiz im Vollbild und springt zur Zeile der Frage.
- Frage und Antwort werden in der Liste, in der Vorschau und im Druck formatiert: fett, Code,
  Links und `[[Verweise]]` funktionieren, eine Antwort darf mehrere Zeilen und Listen enthalten
  (`! 1. erstens`, `! 2. zweitens`). Im Markdown-Export bleibt eine solche Antwort eine Liste.
- In der Mindmap zeigt eine Marke am Knoten die Anzahl offener Fragen und Entscheide; eingeklappte Äste
  zählen ihren ganzen Teilbaum. Der Reiter *Fragen* trägt die Gesamtzahl.

### Entscheide

Eine Zeile, die mit `?!` beginnt, ist ein **Entscheid**. Direkt darunter stehende Zeilen, die mit `!!`
beginnen, sind der getroffene Entscheid; die erste darf mit dem Datum beginnen. Termin am Zeilenende
wie bei Fragen. Die Zeile mit dem Öffner bestimmt die Art: unter `?!` zählt auch `!`, unter `?` auch `!!`.

```
?! Variante B oder C? @lea1234 (@tom5678) @31.10.2026
!! 14.10.2026: Variante B, weil sie ohne Serverkomponente auskommt
```

- **Personen:** `@kürzel` im Text einer Frage oder eines Entscheids nennt, wer antworten oder
  entscheiden soll; `(@kürzel)` ist jemand, der wahlweise dabei ist. Beim Tippen von `@` schlägt der
  Editor bekannte Kürzel vor (die in der Datei vorkommen; Erweiterungen und Ausprägungen können
  weitere liefern, siehe [docs/PLUGINS.md](docs/PLUGINS.md)). Das Kürzel, das gerade getippt wird,
  schlägt sich nicht selbst vor, auch wenn die Notiz zwischendurch gespeichert wurde (seit 2.0.1).
  `↑` `↓` wählen, `Enter` oder `Tab` übernimmt, `Esc` schliesst.
- Die Ansicht **Entscheide** erscheint als Reiter, sobald es Entscheide gibt. Sie funktioniert wie
  die Fragen-Ansicht (Filter *Offen*, *Alle*, *Entschieden*, Suche, Tags, Sortierung); beide Ansichten
  filtern zusätzlich nach Person. **Entscheiden** schreibt den Entscheid mit dem heutigen Datum als
  `!!`-Zeilen unter die Zeile; **Entscheid bearbeiten** ändert den Text, das Datum bleibt.
- Im Editor setzt **?! Entscheid** (oder `Ctrl+Shift+D`) das Zeichen auf der aktuellen Zeile oder
  nimmt es wieder weg. Vorschau, Liste und Druck zeigen Entscheide als Karte mit Datum und Personen.
- **Drucken…** in der Ansicht druckt die Entscheide; der Markdown-Export macht Zitatblöcke daraus
  (`> **Offener Entscheid:** …`, `> **Entschieden 14.10.2026:** …`) und listet offene Entscheide im
  Inhaltsverzeichnis, sobald es welche gibt.
- Die Statusleiste zählt bei offener Notiz Fragen und Entscheide getrennt.

### Mehrzeilige Entscheide, Einträge in Listen, Unterentscheide (seit 2.4.0)

````
?!``` Ablage auf SharePoint umstellen @anna @15.11.2026
Ab 1.11. liegen alle Projektordner auf SharePoint.
- Altdaten bleiben bis Ende Jahr lesbar
?! Wer migriert die Altdaten? @ben
!! 21.10.2026: Externe Firma
?! Brauchen wir Schulungen?
```
!! 22.10.2026: Ja, so umsetzen

- Budget 2027
- ?! Neues Tool kaufen? @anna
  !! 20.10.2026: Ja, Variante B
- ?!``` Welches Ticketsystem? @anna @15.11.2026
  Wir brauchen bis Ende Jahr eines.
  - Variante A: günstig
  - Variante B: mit Schnittstelle
  ?! Budget freigeben? @ben
  !! 21.10.2026: Ja
  ```
  !! 22.10.2026: Variante B
- Nächster Punkt
````

- **Block:** `?!```` öffnet einen mehrzeiligen Entscheid, eine Zeile ```` ``` ```` schliesst ihn. Der Rest der
  Öffnerzeile ist der Titel, mit Personen und Termin wie sonst; ohne Titel gilt die erste Zeile im Block (ein
  `#` davor fällt weg). Die übrigen Zeilen sind die **Beschreibung** (Markdown). Der Entscheid folgt mit `!!`
  direkt nach ```` ``` ````. `?```` macht dasselbe für eine Frage. Wer entscheiden soll, steht im Titel;
  `@kürzel` in der Beschreibung ist nur Text.
- **Unterentscheide:** Im Block stehen einzeilige `?!`- und `?`-Zeilen (auch als Listenpunkt) mit ihren eigenen
  `!!`/`!`-Antworten. Sie sind eigene Einträge mit eigenem Termin und eigenen Personen; Blöcke im Block gibt es
  nicht. Der Block darf entschieden werden, während Unterentscheide offen sind; er zeigt dann zum Beispiel
  «1 von 2 Unterentscheiden offen» als Warnung. Code im Block steht zwischen `~~~` oder beginnt mit
  ```` ```sprache ````, damit ein schlichtes ```` ``` ```` den Block schliessen kann.
- **In Listen:** `- ?! …` oder `1. ? …` ist ein Eintrag als Listenpunkt, die Antwort steht eingerückt darunter.
  Auch eine eingerückte `?`-Zeile unter einem Listenpunkt wird zum Kasten.
- **Blöcke in Listen (seit 2.6.0):** `- ?!``` Titel` (auch `1.`, `*`, `+` und in Unterlisten) macht den Block zum
  Listenpunkt. Beschreibung, Unter-Einträge und ```` ``` ```` stehen eingerückt unter dem Text des Punkts, der
  Entscheid gleich eingerückt danach; die Liste geht danach weiter. Die Einrückung ist nachsichtig: Zum Block gehört
  alles bis zum ```` ``` ````, auch eine Zeile ohne Einrückung. Eine Aufgabe (`- [ ] …`) ist nie zugleich ein
  Eintrag. Ältere Notizen mit `- ?!```` kommen beim ersten Öffnen mit 2.6.0 in die Übersicht (Merker `index_rules`
  in `meta`, ohne neues Schema).
- **Vorschau:** ein Kasten je Block mit Titel, Beschreibung, den Unter-Einträgen an ihrem Platz und dem
  Entscheid unten. Aufgaben im Block lassen sich abhaken.
- **Ansichten «Entscheide» und «Fragen»:** Unter dem Titel stehen die ersten Zeilen der Beschreibung als
  Zusammenhang, **Mehr anzeigen** klappt sie ganz auf. Nach Notiz sortiert stehen Unter-Einträge eingerückt unter
  ihrem Block; steht der Block nicht in der Liste (anderer Filter, andere Gruppe bei der Sortierung nach Termin,
  oder eine Unterfrage im Reiter «Fragen»), nennt «Teil von «Titel»» ihn. Die Suche findet auch Text in der
  Beschreibung. **Entscheiden** schreibt bei einem Block nach ```` ``` ````, bei einem Listenpunkt eingerückt,
  bei einem Unterentscheid im Block; einem Block ohne Ende setzt es das ```` ``` ```` davor.
- **Editor:** Mehrere Zeilen markieren und **?!** (oder `Ctrl+Shift+D`, für Fragen **?**) macht daraus einen
  Block, die erste Zeile wird der Titel; nochmals drücken macht ihn wieder zu Text, das andere Zeichen wechselt
  die Art. In einer Liste setzen **?** und **?!** das Zeichen hinter das Listenzeichen; sind mehrere Listenpunkte
  markiert, wird der Block der erste Punkt, die übrigen rücken als Beschreibung darunter (und zurück). `Enter` am
  Ende von `?!``` Titel` setzt das ```` ``` ```` darunter, wenn es noch fehlt; bei `- ?!``` Titel` eingerückt auf
  den Text des Punkts, und auch bei einem fertigen Block nur eingerückt statt mit einem neuen Listenpunkt.
- **Druck und Export:** Der Druck zeigt die ganze Beschreibung und rückt Unterentscheide ein. Der Markdown-Export
  macht aus einem Block ein Zitat mit Beschreibung, Unter-Einträge darin werden ein Zitat im Zitat; Einträge in
  Listen bleiben Listenpunkte, ein Block in einer Liste ein Listenpunkt mit der Beschreibung eingerückt darunter. Code (```` ``` ```` und `~~~`) zählt weder als Frage noch als Querverweis.

### Vorlagen (seit 2.5.0)

Eine **Vorlage** ist eine Notiz samt Unternotizen als Markdown-Datei, mit Platzhaltern, die beim Anlegen ersetzt werden.

- **Speichern:** *Notiz → Als Vorlage speichern…* (oder Rechtsklick auf einen Knoten der Mindmap). Im Dialog: Name, Beschreibung,
  *Unternotizen mitnehmen*, *Antworten und Entscheide entfernen*, *Erledigte Aufgaben wieder öffnen*, *Termine am Zeilenende entfernen*
  und *Heutiges Datum durch {{datum}} ersetzen* (in derselben Schreibweise). Bilder aus der Datei kommen nicht mit (die Meldung nennt, wie viele weggelassen wurden).
- **Anwenden:** *Aus Vorlage…* in der Mindmap-Leiste (unter der Auswahl), das Symbol neben *Neue Notiz* in der Liste, *Unternotiz aus
  Vorlage…* im Menü *Notiz* und im Kontextmenü der Mindmap. *Notiz → Vorlage einfügen…* setzt den Text der Vorlage an die Stelle des
  Cursors und legt ihre Unternotizen unter der offenen Notiz an. Die Auswahl zeigt eine Vorschau mit ersetzten Platzhaltern.
- **Platzhalter:** `{{datum}}` (heute), `{{datum+7}}` und `{{datum-1}}` (Tage dazu oder weg, zum Beispiel für Termine:
  `- [ ] Offerte @{{datum+7}}`), `{{zeit}}`, `{{wochentag}}`, `{{woche}}` (Kalenderwoche), `{{jahr}}`, `{{vorlage}}`, `{{bereich}}`,
  `{{ich}}` (im Dienst dein `@kürzel`). Die Namen sind übersetzbar (Sprachpaket, Schlüssel `platzhalter:…`) und werden in jeder Sprache
  erkannt (`{{date}}` geht auch); unbekannte bleiben stehen.
- **Datumsformat (seit 2.5.1):** hinter einem Doppelpunkt, zum Beispiel `{{datum+2:JJJJ-MM-TT}}` (2026-10-22), `{{datum:TT.MM.JJJJ}}`
  (05.03.2026), `{{datum:TTTT, T. MMMM JJJJ}}` (Dienstag, 20. Oktober 2026). Kürzel gross oder klein, deutsch oder englisch: `JJJJ`/`yyyy`
  und `JJ`/`yy` für das Jahr, `MM`/`mm` (zweistellig), `M` (ohne führende Null), `MMM` (Okt), `MMMM` (Oktober) für den Monat, `TT`/`dd`,
  `T`/`d` für den Tag, `TTT` (Di) und `TTTT` (Dienstag) für den Wochentag; Text in Hochkommas bleibt stehen (`'KW'`, `''` für ein
  Hochkomma). Statt Kürzeln ein Stil der Sprache der Oberfläche (`Intl.DateTimeFormat`): `kurz`, `mittel`, `lang`, `voll` (englisch
  `short`, `medium`, `long`, `full`) und `iso`. Ohne Format gilt `20.10.2026`. Als Termin taugen `T.M.JJJJ`, `TT.MM.JJJJ` und `JJJJ-MM-TT`
  (`@{{datum+7:JJJJ-MM-TT}}`). *Heutiges Datum ersetzen* behält beim Speichern die Schreibweise (`2026-10-20` wird `{{datum:JJJJ-MM-TT}}`).
- **Lokal:** Vorlagen liegen im Ordner `templates/` neben `index.html`, für alle Bereiche gleich. *Datenbank → Vorlagen…* verbindet den
  Ordner einmal (Edge, Chrome); danach liest NoNotes die `.md`-Dateien darin, und neue Vorlagen landen direkt dort (gleicher Name: `Name (2).md`).
  Ohne Ordner (oder in Firefox) wird die Vorlage heruntergeladen und in diesem Browser gemerkt. Im selben Dialog: Datei hinzufügen,
  herunterladen, entfernen. Das ZIP bringt zwei Beispiele mit (*Sitzungsprotokoll*, *Entscheidungsvorlage*) und `templates/README.md`
  mit dem Dateiformat.
- **Dateiformat:** ein Kopf mit `name`, `description`, `title`, `tags` (Werte in JSON-Schreibweise), danach der Text; jede Unternotiz
  beginnt mit `<!-- nonotes:note {"depth":1,"title":"…","tags":[]} -->`. Eine Markdown-Datei ohne Kopf ist auch eine Vorlage.
- **Agenten:** `list_templates` und `create_note_from_template` (WebMCP in der App, `agent/nonotes-mcp.cjs` mit `templates/` neben der
  App oder `--templates <Ordner>`).
- **Im Dienst** liegen Vorlagen auf dem Server: eine Organisation verwaltet sie zentral und weist sie Arbeitsbereichen zu (siehe dort).

### Navigation und Links (seit 2.7.0)

Zurück und Vor (Maustasten, `Alt+←`/`Alt+→`, Knöpfe des Browsers) gehen die Schritte nach, die du in der App machst: **Notiz öffnen**,
**zurück zur Übersicht**, **Ansicht wechseln** (Mindmap, Liste, Fragen, Aufgaben …) und **einem Link auf eine Notiz folgen**. Auswahl in der
Mindmap, Bearbeiten/Vorschau, Suche, Filter und Sortierung sind keine Schritte. Vor jedem Schritt wird gespeichert. Kehrst du zur Mindmap
zurück, ist die zuletzt offene Notiz ausgewählt.

- **Adresse:** Die offene Notiz steht in der Adresse, als Nummer mit dem Titel als lesbarem Zusatz: lokal `index.html#n=42-sitzungsprotokoll`
  (mit mehreren Bereichen `#w=arbeit&n=42-…`), im Dienst als Pfad `/w/<Arbeitsbereich>/42-sitzungsprotokoll`. Massgebend ist die Nummer; ein
  Link übersteht das Umbenennen, und beim Umbenennen entsteht kein neuer Schritt im Verlauf. Neuladen öffnet dieselbe Notiz wieder.
- **Link kopieren:** *Notiz → Link kopieren* oder Rechtsklick auf einen Knoten der Mindmap oder einen Eintrag der Liste.
- **Links im Text:** Eine eingefügte Adresse einer Notiz (auch als `[Text](Adresse)`) zeigt in der Vorschau, in Fragen und Aufgaben den
  **aktuellen Titel** (mit ↗) und öffnet die Notiz in der App statt in einem neuen Tab. Eine fehlende Notiz erscheint durchgestrichen.
- **Fehlt die Notiz** (gelöscht, im Papierkorb oder im Dienst ohne Zugriff), erscheint ein Hinweis und die Übersicht.
- **Der Pfeil «Zurück» im Editor** und `Esc` gehen wie Zurück im Browser, wenn du aus der Übersicht gekommen bist; nach einem direkten
  Einstieg über einen Link führen sie zur Übersicht.
- **Lokal** gelten Links nur im selben Browser (die Daten liegen dort). Ein Link auf eine Notiz in einem anderen Bereich wechselt in diesen
  Bereich; seinen Titel kennt die Vorschau erst dort. Im Dienst ist die Adresse eine echte Adresse auf dem Server: wer nicht angemeldet ist,
  landet nach der Anmeldung bei der Notiz.

### Pfade auf Dateien und Ordner (seit 2.12.0)

Netzwerkpfade, Laufwerkspfade und `file://`-Adressen im Text werden zu Links, mit einem Symbol für Datei oder Ordner:

```markdown
Offerte: \\srv01\Projekte\Offerte.pdf, Ablage: Z:\Team\Ablage\ oder file:///C:/Daten/Bericht.pdf
Mit Leerzeichen: <\\srv01\Projekte\Angebot 2026.docx> oder [Angebot](<\\srv01\Projekte\Angebot 2026.docx>)
![Grundriss](<Z:\Bau\Pläne\Grundriss EG.png>)
```

- Frei im Text endet ein Pfad beim ersten Leerzeichen; Satzzeichen am Ende (Punkt, Komma, Klammer) gehören nicht dazu. Pfade mit
  Leerzeichen stehen in spitzen Klammern. «Als Pfad kopieren» im Explorer (Umschalt+Rechtsklick) liefert den Pfad in Anführungszeichen;
  beim Einfügen macht NoNotes daraus von selbst `<…>`.
- Als Ordner gilt ein Pfad, der mit `\` oder `/` endet oder dessen letzter Teil keine Endung hat.
- **Lokal** öffnet ein Klick die Datei in einem neuen Tab: PDF, Bilder und Text zeigt der Browser, Word und Excel lädt er herunter, ein
  Ordner zeigt seinen Inhalt. Den Explorer oder Word starten kann ein Browser nicht; dafür Rechtsklick → **Pfad kopieren** (in der
  Schreibweise von Windows) und im Explorer einfügen. Bilder mit einem Pfad erscheinen in der Vorschau.
- **Im Dienst** sperren Browser Links auf lokale Dateien. Der Pfad sieht gleich aus, ein Klick kopiert ihn; ein Bild erscheint als Link.
- Der Text bleibt, wie er geschrieben ist (Export, Agenten). Andere Markdown-Programme zeigen einen Netzwerkpfad mit nur einem `\` am Anfang,
  weil sie `\\` als maskierten Backslash lesen.

### Aufgaben

Eine Markdown-Checkbox ist eine Aufgabe: `- [ ] Offerte einholen` offen, `- [x] …` erledigt.
Ein Termin darf am Zeilenende stehen: `- [ ] Offerte einholen @15.10.2026`, mit Uhrzeit
`@15.10.2026 14:30` (auch `14.30` oder `@2026-10-15 14:30`). Mit Uhrzeit gilt der Zeitpunkt,
ohne Uhrzeit der ganze Tag; ein heutiger Termin mit vergangener Uhrzeit ist überfällig.
Dasselbe gilt für Fragen.

- **Personen** (seit 2.11.0): `- [ ] Offerte einholen @anna (@ben) @15.10.2026` – `@anna` ist
  verantwortlich, `(@ben)` beteiligt, wie bei Fragen und Entscheiden; mehrere sind gleichwertig.
  Eine Unteraufgabe ohne eigene Person gehört den Personen ihrer Hauptaufgabe (in der Liste blass,
  «Über die Hauptaufgabe»). Abhaken darf weiterhin jede Person, die schreiben darf. Im Dienst
  bekommt eine neu genannte Person eine Mail, und jeden Morgen um 7 Uhr eine Übersicht ihrer
  offenen Aufgaben (überfällig, heute, die nächsten 7 Tage) mit Links; abschaltbar im Konto.
- Die Ansicht **Aufgaben** sammelt alle Aufgaben aller Notizen. Standardfilter ist *Offen*;
  *Alle* und *Erledigt* holen den Rest zurück. Sortierung nach Fälligkeit gruppiert in
  Überfällig, Heute, Diese Woche, Später und Ohne Termin; alternativ nach Notiz oder nach Person
  (eine Gruppe je Person, eine Aufgabe für zwei steht bei beiden, ohne Person am Schluss). Dazu
  Suche, Tag-Filter und Filter nach Person (verantwortlich, beteiligt oder geerbt). Der Reiter
  zeigt die Zahl der offenen Aufgaben, rot wenn etwas überfällig ist.
- Aufgaben stehen auch in **Tabellenfeldern**: `| [ ] Offerte @anna |` (siehe Tabellen).
- **Abhaken** geht an drei Orten: Kästchen in der Aufgabenliste, Kästchen in der Vorschau
  des Editors, oder direkt im Text. Alles schreibt in dieselbe Zeile der Notiz.
- **Unteraufgaben:** Eine Aufgabe, die tiefer eingerückt direkt unter einer anderen steht,
  gehört zu ihr (beliebig tief; `Tab` rückt ein). Eine Zeile ohne Kästchen auf gleicher oder
  geringerer Einrückung beendet die Gruppe, Leerzeilen nicht.
  - Eine Aufgabe lässt sich erst abhaken, wenn alle Unteraufgaben erledigt sind. Bis dahin
    bleibt das Kästchen offen und die Statuszeile nennt die Zahl der offenen Unteraufgaben
    (Aufgabenliste und Vorschau). Von Hand `[x]` im Text zu tippen lässt sich nicht verhindern;
    die Liste zeigt die Aufgabe dann trotzdem als erledigt, mit dem Hinweis «Unteraufgaben offen».
  - **Doppelklick auf den Aufgabentext** (Vorschau und Aufgabenliste) schliesst die Aufgabe und
    alle Unteraufgaben ab. Ist schon alles erledigt, öffnet er die Aufgabe wieder.
  - Eine Hauptaufgabe wieder zu öffnen lässt die Unteraufgaben erledigt. Eine Unteraufgabe
    wieder zu öffnen öffnet erledigte Hauptaufgaben darüber mit.
  - In der Aufgabenliste bleibt jede Unteraufgabe ein eigener Eintrag mit eigenem Termin. Die
    Hauptaufgabe zeigt den Fortschritt (`2/3`), die Unteraufgabe «Teil von …». Bei Sortierung
    nach Notiz stehen Unteraufgaben eingerückt unter der Hauptaufgabe. Die Vorschau zeigt den
    Fortschritt als Abzeichen. Zähler, Mindmap-Marker und Kalenderexport behandeln jede Aufgabe
    einzeln; die gedruckte Checkliste rückt Unteraufgaben ein.
- Der Aufgabentext wird in der Liste und im Druck wie in der Vorschau formatiert: fett, Code,
  Links und `[[Verweise]]` funktionieren. Ein Klick auf einen Verweis öffnet die Notiz, ein Klick
  auf einen Link öffnet ihn im neuen Tab.
- In der Mindmap zeigt ein blauer Marker unten am Knoten die offenen Aufgaben, der orange
  Marker oben die offenen Fragen. Eingeklappte Äste zählen ihren Teilbaum.
- **Drucken…** in der Aufgabenansicht (oder `Ctrl+P`) druckt eine Checkliste mit Kästchen,
  gruppiert nach Fälligkeit oder Notiz. Der Export schreibt eine Liste «Offene Aufgaben» in
  die Übersicht.
- `/` startet in jeder Ansicht die Suche.
- `Datenbank → Termine in Kalender exportieren (.ics)…` schreibt alle Aufgaben und Fragen
  mit Termin in eine Kalenderdatei (siehe oben).

### Editor und Markdown

- Der Text ist Markdown: Überschriften, Listen, Aufgabenlisten `- [ ]`, Zitate, Code,
  Links, Bilder, fett und kursiv. `[[Titel]]` verweist auf eine andere Notiz; ein Klick in
  der Vorschau öffnet sie, bei fehlendem Ziel wird sie auf Wunsch als Unternotiz angelegt.
  `[[Titel*]]` ist ein **Querverweis**: derselbe Link, dazu eine gestrichelte Linie in der Mindmap.
- **Vorschläge für Verweise** (seit 2.9.0): Sobald `[[` getippt ist (oder nach dem Knopf `[[ ]]`),
  zeigt der Editor eine Liste der Notizen im offenen Bereich, oben ihre Anzahl. Tippen schränkt
  sie ein: Treffer irgendwo im Titel, ohne Gross-/Kleinschreibung, «ue» findet auch «ü». Zuerst
  stehen Titel, die so beginnen, dann Treffer an einem Wortanfang, dann der Rest, darin die zuletzt
  geänderten zuerst; archivierte kommen blass am Schluss.
  - Bedienung: Zehn Einträge sind sichtbar, `↑`/`↓` (und Bild auf/ab) wählen auch darüber hinaus,
    einer ist immer hervorgehoben. `Enter` oder `Tab` übernehmen, `Umschalt+Enter` als Querverweis
    `[[Titel*]]`, `Esc` schliesst.
  - Gleichnamige Notizen zeigen ihren Eltern-Node, mit gedrückter `Strg`-Taste zeigen alle ihren
    Pfad.
  - Gibt es den Titel mehrfach, schreibt die Liste die Nummer dazu: `[[Protokoll#42]]` meint genau
    diese Notiz, auch nach Umbenennen oder Verschieben. Vorschau, Druck und Export zeigen nur
    «Protokoll». Liegt die Notiz im Papierkorb, ist der Verweis offen; er springt nicht auf ein
    anderes «Protokoll».
  - Ein Titel, der selbst auf `#Zahl` endet, geht vor.
  - Gezählt werden die Notizen, die du im Bereich sehen kannst (im Dienst: die des Arbeitsbereichs).
  Adressen ohne `https://` wie `www.beispiel.ch` werden automatisch ergänzt.
- **Tabellen** (seit 2.10.0) sind Markdown-Tabellen wie bei GitHub: `| Name | Wert |`, darunter
  `|---|---|`, dann je Zeile `| … | … |`. `:---:` zentriert eine Spalte, `---:` richtet sie rechts aus.
  - Einfügen: Der Knopf **Tabelle einfügen** in der Toolleiste öffnet ein Raster mit 8 × 10 Feldern. Die Grösse zeigst du mit der Maus, ziehst sie auf oder
    wählst sie mit den Pfeiltasten; Klick, Loslassen oder `Enter` fügt ein. Darunter wählst du
    **Titelzeile** (vorgegeben) und **Titelspalte**.
  - Schreiben: In einer Tabelle springen `Tab` und `Umschalt+Tab` von Feld zu Feld und markieren
    den Inhalt; hinter dem letzten Feld kommt eine neue Zeile dazu. `Enter` fügt eine Zeile unter
    der aktuellen an; in einer leeren letzten Zeile endet die Tabelle mit einer Leerzeile. Die
    senkrechten Striche werden dabei ausgerichtet (gleich viele Zeichen je Spalte; im Editor mit
    seiner Proportionalschrift stehen sie nur ungefähr untereinander, in Programmen mit fester
    Zeichenbreite genau).
  - Titel: Die Titelzeile steht in der Vorschau beim Scrollen oben und im Druck auf jeder Seite.
    Ist die erste Zeile leer, gibt es keine Titelzeile. Die Titelspalte ist die erste Spalte, fett
    wie die Titelzeile. **Titel hervorheben** färbt beide im Ton der Hauptfarbe.
  - Rechtsklick auf eine Tabelle in der Vorschau: Titelzeile, Titelspalte und Hervorheben ein- und
    ausschalten, Zeilen darüber oder darunter, Spalten links oder rechts einfügen, Zeile oder Spalte
    löschen; dazu Einträge von Erweiterungen (zum Beispiel *Tabellen formatieren* für Breite, Höhe,
    Farbe und Fett).
  - Das Format steht in einer Zeile `<!-- tabelle: {"kopfspalte":true,"hervorheben":true} -->`
    direkt über der Tabelle. Andere Markdown-Programme blenden sie aus, der Export behält sie.
  - Ein Feld enthält Text mit Markdown (fett, kursiv, Links, `[[Verweise]]`, Code); ein `|` im
    Feld schreibt sich `\|`.
  - **Mehrere Zeilen im Feld** (seit 2.11.0): `<br>` trennt sie; `Umschalt+Enter` im Feld setzt es.
  - **Aufgaben, Fragen und Entscheide in Feldern** (seit 2.11.0): Ein Teil, der mit `[ ]` beginnt,
    ist eine Aufgabe (mit Termin und Personen), mit `?` eine Frage, mit `?!` ein Entscheid. Die
    Antwort folgt im selben Feld: `| ? Budget?<br>! 5000 |`, ein Entscheid `<br>!! 14.10.2026: Müller`.
    Sie erscheinen in den Ansichten, im Index und bei den Agenten wie alle anderen; das Kästchen in
    der Vorschau hakt genau diese Aufgabe ab, eine Antwort aus der Liste wird ins Feld geschrieben
    und die Tabelle neu ausgerichtet. In einem Feld wirken die Knöpfe für Aufgabe, Frage, Entscheid
    und Antwort auf den Teil, in dem der Cursor steht. Unteraufgaben gibt es in Feldern nicht.
- Die **Toolleiste** über dem Text setzt alles per Klick: Überschrift (Auswahlliste), fett,
  kursiv, durchgestrichen, Code, Listen, Aufgabe, Zitat, Codeblock, Trennlinie, Tabelle, Link,
  Notiz-Verweis, Bild, Frage und Antwort. Die Knöpfe wirken auf den markierten Text oder die
  aktuellen Zeilen und lassen sich mit einem zweiten Klick wieder aufheben.
  Tastenkürzel: `Ctrl+B`, `Ctrl+I`, `Ctrl+K` für Link.
- Beim Schreiben führt `Enter` Listen, Aufgaben, Zitate und Antwortzeilen weiter, mit
  gleichem Zeichen und gleicher Einrückung; nummerierte Listen zählen weiter und werden neu
  durchnummeriert. Ein leeres Element rückt zuerst aus und beendet dann die Liste.
  `Tab` und `Shift+Tab` rücken Listenelemente ein und aus, auch über mehrere markierte
  Zeilen. `Shift+Enter` fügt eine normale neue Zeile ein.
- Termine von Aufgaben und Fragen erscheinen in der Vorschau und im Druck als Abzeichen,
  rot bei überfällig, orange bei heute. Im Text bleibt `@15.10.2026` unverändert.
- Der **?**-Knopf rechts (oder `F1`) öffnet die Hilfe mit allen Schreibweisen, allen
  Tastenkürzeln und einer eigenen Seite zur Datenablage, die auch unter
  *Datenbank → Datenablage erklärt…* zu finden ist.
- Die Darstellung wechselt zwischen **Bearbeiten**, **Geteilt** (Text und Vorschau
  nebeneinander) und **Vorschau**, auch mit `Ctrl+E`. Die Einstellung wird gemerkt.
- In der geteilten Ansicht scrollen Text und Vorschau synchron. Die App misst dafür die
  Pixelhöhe jeder Textzeile in einem unsichtbaren Spiegel des Editors (so stimmt es auch bei
  umbrochenen Zeilen) und kennt die Quellzeile jedes Blocks der Vorschau. Es führt die Seite,
  auf der die Maus liegt oder die den Fokus hat, die andere folgt.
- **Bilder** hängst du mit **🖼 Bild**, per Einfügen aus der Zwischenablage (`Ctrl+V`) oder
  durch Ablegen auf dem Text an. Sie liegen in der Datenbank, im Text steht `![Name](att:ID)`,
  die Vorschau zeigt sie. Grosse Bilder werden auf 1600 Pixel Kantenlänge verkleinert.
- **Videos** von YouTube, Vimeo und Dailymotion: die Adresse allein auf einer Zeile (oder `![Titel](Adresse)`). Die Vorschau zeigt eine Karte «Video laden»; erst der Klick lädt das Video, vorher geht
  keine Anfrage an den Anbieter. Gedruckt erscheint ein Link. Einzelheiten und Einschränkungen: [docs/EMBEDS.md](docs/EMBEDS.md).
  Der Streifen über dem Text zeigt alle Anhänge der Notiz mit Einfügen und Löschen.
  Beim Export landen sie im Ordner `attachments/`.
- Oberste Zeile ist der Titel, `Enter` springt in den Text.
- Der Pfad über dem Titel zeigt, wo die Notiz im Baum hängt; die Einträge sind anklickbar.
- Das Menü **Notiz ▾** rechts über dem Titel bündelt die Aktionen zur offenen Notiz: Unternotiz anlegen, Vorlage einfügen, Verlauf, Drucken, Archivieren, Löschen. Links davon steht der Pfad der Notiz; wird er zu lang, fallen mittlere Glieder zu «…» zusammen.
- `Ctrl+S` speichert sofort (passiert sonst automatisch nach kurzer Pause).
- Auf schmalen Fenstern wird zwischen Liste und Editor umgeschaltet (`Esc` oder «Zurück»).

## Technik

Der Quelltext liegt in Paketen (`packages/`), eine Ausprägung (`editions/local/`) setzt daraus die
auslieferbare Version zusammen. Aufbau und Abhängigkeiten: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
Datenschnittstelle: [docs/BACKEND.md](docs/BACKEND.md), Sprachen: [docs/LANGUAGES.md](docs/LANGUAGES.md), KI-Agenten: [docs/AGENTS.md](docs/AGENTS.md).
Im ausgelieferten Ordner liegen alle Skripte flach unter `js/`.

| Teil | Umsetzung |
| --- | --- |
| Oberfläche | `index.html`, `css/app.css`, `js/app.js` (`packages/ui/`) – reines HTML/CSS/JS, keine Frameworks; der Build kopiert nur |
| Mindmap | `packages/ui/mindmap.js`: eigenes Layout (links/rechts ausbalanciert), SVG, Zoom, Ziehen, Tastatur; archivierte Knoten blass und gestrichelt |
| Vorlagen | `packages/core/templates.js` (Dateiformat, Platzhalter, aus Notizen, Anlegen und Einfügen), Ablage über `shell.templates` (lokal `packages/store-local/templates-local.js`: Ordner `templates/` mit der File System Access API, sonst Browser), Beispiele in `templates/`; Tests `test/core.cjs` und `test/extend.cjs` |
| Fragen und Entscheide | `packages/core/questions.js`: ein Parser für `?`-, `?!`-, `!`- und `!!`-Zeilen samt Datum und `@kürzel`, Einträge in Listen und Blöcke `?!```` … ```` ``` ```` mit Unter-Einträgen (`parseBlock` nutzen auch Vorschau und Export, `nest` die Ansichten und der Druck); Index in der Tabelle `questions` mit `kind`, `decided`, `people`, `details`, `parent_id` (Schema 15), bei jeder Änderung abgeglichen; Vorschläge für Kürzel über `packages/core/mentions.js`; Tests `test/core.cjs` (mehrzeilige Entscheide) und `test/extend.cjs` |
| Aufgaben | `packages/core/tasks.js`: Parser für `- [ ]`-Zeilen mit `@Datum`, Unteraufgaben über die Einrückung, Abschluss-Regeln als reine Textfunktionen; Index in der Tabelle `tasks`, gleiches Prinzip |
| Termine | `packages/core/dates.js`: gemeinsame Logik für `@TT.MM.JJJJ` bzw. `@JJJJ-MM-TT`, Dringlichkeit, Anzeige |
| Markdown | `packages/core/markdown.js`: eigener Renderer, escaped allen Text, erlaubt nur sichere Link-Schemata |
| Toolleiste | `packages/core/editing.js`: reine Textfunktionen (umschliessen, Zeilenpräfixe, Überschriften, Links) |
| Tabellen | `packages/core/tables.js`: Markdown-Tabellen lesen (seit 2.11.0 auch Teile eines Felds, `cellParts`, `lineBreak`, `togglePrefix`; Aufgaben, Fragen und Entscheide in Feldern liest `tasks.js` bzw. `questions.js`) (`parseAt`, Format-Zeile `<!-- tabelle: … -->`) und schreiben (`format` richtet aus), Schritte des Editors (`move`, `enter`, `insert`) und des Rechtsklicks (`setMeta`, `toggleHeader`, Zeilen und Spalten) als reine Textfunktionen; `markdown.js` zeichnet sie (`thead` bleibt oben, `th scope="row"` für die Titelspalte, Angaben von Erweiterungen über `tableFormat`); Raster, Tasten und Rechtsklick in `packages/ui/app.js`; Schnittstelle `ctx.tables` und `ctx.ui.addTableMenuItem` ([docs/PLUGINS.md](docs/PLUGINS.md)) |
| Export | `packages/core/export.js` baut die Dateien, `zip.js` ist ein kleiner ZIP-Writer; das Bild liefert `NoNotesMindmap.toSvgString`, PNG über ein Canvas |
| Druck | `packages/ui/print.js` baut das Druckdokument in `#printArea`; `@media print` blendet den Rest der App aus |
| Scroll-Sync | `packages/ui/scrollsync.js`: Spiegel des Textes misst Zeilenhöhen, Vorschau-Blöcke tragen `data-line`, lineare Interpolation dazwischen |
| Erweiterungen | `packages/core/plugins.js` (Verzeichnis, Lader, Schalter, Ereignisse) und die Anbindung in `packages/ui/app.js`; Ordner `plugins/` mit Liste, Anleitung und Beispielen; das Verzeichnis des Ordners erzeugt `tools/build.cjs` (siehe [docs/PLUGINS.md](docs/PLUGINS.md)) |
| KI-Agenten | `packages/agent/`: `catalog.js` beschreibt die Werkzeuge (englische Namen, Eingabeschemata) und führt sie über das Backend aus, `webmcp.js` meldet sie beim Agenten des Browsers an (`document.modelContext`, sobald ein Browser sie anbietet), `protocol.js` spricht MCP ohne Transport; `editions/local/agent/nonotes-mcp.cjs` ist das Programm für Agenten auf dem eigenen Rechner (MCP über die Standardeingabe, dieselbe Datei wie die App, atomar schreiben unter einer Sperre); `local-shell.js` führt Änderungen von aussen Notiz für Notiz zusammen; Tests `test/core.cjs` (Katalog, Protokoll, Programm), `test/collab.cjs` (Zusammenführen), `test/extend.cjs` (WebMCP gegen einen Nachbau); siehe [docs/AGENTS.md](docs/AGENTS.md) |
| Verlauf | `packages/core/history.js` (Patches und Zeilenvergleich als reine Textfunktionen); Fassungen und Aufbewahrung in `packages/data/db.js`, Dialog in `packages/ui/app.js`; wer eine Fassung geschrieben hat, steht in `author` (nur wenn ein Backend einen Namen liefert) |
| Videos | `packages/core/embeds.js` erkennt Adressen von YouTube, Vimeo und Dailymotion (nur genau passende Hosts und Kennungen); `markdown.js` macht aus einer Adresse allein auf einer Zeile eine Karte, die Vorschau baut den Rahmen erst nach dem Klick (siehe [docs/EMBEDS.md](docs/EMBEDS.md)); Tests `test/core.cjs` und `test/extend.cjs` |
| Querverweise | `[[Titel*]]` im Text: `packages/core/links.js` liest sie und löst sie auf (`lookup`, `resolver`: Titel, seit 2.9.0 auch `[[Titel#42]]` für genau eine Notiz), `db.js` führt den Index `note_links` beim Speichern nach (`getLinks`); Vorschläge beim Tippen von `[[` in `packages/ui/app.js` (`updateWikiPopup`); die Mindmap zeichnet gestrichelte Linien mit Pfeil zwischen sichtbaren Knoten (`linkPath`: vom äusseren Ende in die untere Mitte oder ans äussere Ende, bewertet nach Länge und Weg durch andere Knoten), auch im SVG für Export und Druck; Schalter «Verweise» in der Leiste (je Browser gemerkt); Test `test/extend.cjs` |
| Lesemodus | Meldet die Hülle `readOnly` (siehe [docs/BACKEND.md](docs/BACKEND.md)), sperrt `packages/ui/app.js` alle Schreibwege (`data-write`, `denyWrite()`) und `readOnlyBackend` lehnt schreibende Aufrufe mit `READ_ONLY` ab; Test `test/collab.cjs` |
| Bereiche | `packages/store-local/storage.js` (Browser-Kopie und Datei-Handle je Bereich, Verzeichnis `areas`, Kennungen), `local-shell.js` (laden, wechseln, anlegen, öffnen, umbenennen, entfernen, `?w=` in der Adresse, `Alt+1 … 9`, Kanal zwischen Tabs mit Bereich), Menü über `host.showMenu`; `NoNotesAgent.multi()` für das Programm mit mehreren Dateien; Tests `test/app.cjs` (Abschnitt «Bereiche») und `test/core.cjs` (Programm); siehe [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Zusammenführen | `packages/core/merge.js`: zeilenweiser Dreiwege-Vergleich (Myers) für gleichzeitige Änderungen derselben Notiz; Speichern mit `baseUpdatedAt`, Konfliktdialog in `packages/ui/app.js` |
| Hauptfarbe | `packages/core/palette.js`: acht Farben mit heller und dunkler Fassung (Fläche, Schrift auf der Fläche, Farbe als Schrift, Tönung); die Seite setzt sie über CSS-Variablen, Export und Druck über `toSvgString` |
| Kalender | `packages/core/ical.js`: iCalendar nach RFC 5545 mit festen UIDs, SEQUENCE, VALARM, Zeilenfaltung; gemerkte Kennungen in `meta` |
| Backend | `packages/core/backend.js`: asynchrone Schnittstelle für alle Datenzugriffe; `packages/store-local/backend-local.js` setzt sie über SQLite um |
| Datenbank | [sql.js](https://github.com/sql-js/sql.js) (SQLite nach JavaScript kompiliert) in `vendor/sql.js/`; Schema und Abfragen in `packages/data/db.js` |
| Persistenz | `packages/store-local/storage.js`: IndexedDB (ersatzweise localStorage) plus File System Access API; `local-shell.js` steuert Speichern, Datei und Browser-Kopie |
| Sprachen | `packages/core/i18n.js` und `lang/`: der deutsche Text ist der Schlüssel, weitere Sprachen sind Dateien (siehe [docs/LANGUAGES.md](docs/LANGUAGES.md)) |
| Start | `start.ps1` (nur Cmdlets, läuft im Constrained Language Mode), `start.cmd` |

Warum kein lokaler Webserver? Auf dem Zielrechner steht PowerShell nur im Constrained
Language Mode zur Verfügung. Dort sind weder `HttpListener` noch der Zugriff auf
`winsqlite3.dll` möglich. Die App braucht beides nicht: Der Browser bringt mit der
File System Access API alles mit, um direkt in die Datenbankdatei zu schreiben, und
sql.js liefert SQLite als reines JavaScript.

Das **Standardschema** (Version 14) steht als Liste in `packages/data/db.js`: eine neue Datei bekommt es ganz,
eine bestehende Datei wird beim Öffnen **in einem Schritt** daran angeglichen, gleich aus welcher Version sie stammt:
fehlende Tabellen und Spalten kommen dazu, danach werden die Indexe (Fragen und Entscheide, Aufgaben, Querverweise)
aus den Texten neu gefüllt. Schritt-für-Schritt-Migrationen gibt es seit v2.0.0 nicht mehr; die Versionsnummer sagt
nur, ob eine Datei schon auf diesem Stand ist oder von einer neueren App stammt (dann «App aktualisieren»).

```sql
CREATE TABLE notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,   -- ISO 8601, UTC
  updated_at  TEXT NOT NULL,
  parent_id   INTEGER,         -- NULL = hängt an der Wurzel
  sort_order  INTEGER NOT NULL DEFAULT 0,
  collapsed   INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,            -- gesetzt = im Papierkorb
  archived_at TEXT,            -- gesetzt = im Archiv (ausgeblendet, durchsuchbar, schreibgeschützt)
  updated_by  TEXT             -- wer den heutigen Stand geschrieben hat (nur mit einem Backend, das Namen liefert)
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- schema_version, created_at, map_title, accent, theme,
                                                                -- calendar_uid, calendar_sequence, calendar_known
CREATE TABLE questions (          -- Index über die ?-, ?!-, !- und !!-Zeilen, wird aus dem Text abgeleitet
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  norm        TEXT NOT NULL,      -- normalisiert, zum Wiedererkennen nach Änderungen
  answer      TEXT,               -- NULL = offen
  line_no     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  answered_at TEXT,
  due         TEXT,               -- Fälligkeit aus "@Datum [Zeit]": YYYY-MM-DD oder YYYY-MM-DDTHH:MM
  kind        TEXT NOT NULL DEFAULT 'question',  -- 'question' oder 'decision'
  decided     TEXT,               -- Tag des Entscheids aus dem Text, YYYY-MM-DD
  people      TEXT,               -- JSON [{ handle, optional }] aus "@kürzel" und "(@kürzel)"
  details     TEXT,               -- Beschreibung eines Blocks ("?!``` … ```") ohne Unter-Einträge
  parent_id   INTEGER             -- Unter-Eintrag: der Block, in dem er steht
);
CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE note_tags (note_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (note_id, tag_id));
CREATE TABLE tasks (                -- Index über die "- [ ]"-Zeilen, aus dem Text abgeleitet
  id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, text TEXT NOT NULL, norm TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, due TEXT, line_no INTEGER NOT NULL, created_at TEXT NOT NULL, done_at TEXT,
  parent_id INTEGER,                -- Hauptaufgabe (tasks.id) bei Unteraufgaben, sonst NULL
  depth INTEGER NOT NULL DEFAULT 0  -- Anzahl übergeordneter Aufgaben
);
CREATE TABLE note_history (          -- Verlauf: pro Fassung ein Rückwärts-Patch zur nächstneueren
  id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL,
  at TEXT NOT NULL,                 -- Zeitpunkt der letzten Änderung dieser Fassung
  started_at TEXT NOT NULL,         -- Beginn der Arbeitsphase danach
  open INTEGER NOT NULL DEFAULT 0,  -- 1 = Arbeitsphase läuft noch (Patch wird nachgeführt)
  title TEXT NOT NULL,              -- Titel dieser Fassung
  p INTEGER NOT NULL, s INTEGER NOT NULL,   -- gemeinsamer Anfang und Ende mit der neueren Fassung (Zeichen)
  r TEXT NOT NULL,                  -- der Teil dazwischen, wie er in dieser Fassung steht
  author TEXT                       -- wer diese Fassung geschrieben hat
);
CREATE TABLE note_links (            -- Querverweise [[Titel*]] je Notiz; Ziele werden beim Lesen über den Titel aufgelöst
  id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, title TEXT NOT NULL, key TEXT NOT NULL, line_no INTEGER NOT NULL
);
CREATE TABLE attachments (          -- Bilder, im Text als ![Name](att:ID) referenziert
  id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, name TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL
);
```

## Entwicklung

Die Seite ist eine Vorlage (`packages/ui/index.html`); die Ausprägung (`editions/local/`) liefert ihre Skripte und einen Hilfeabschnitt
über `edition.json`. Zum Entwickeln bauen und `dist/NoNotes/index.html` im Browser öffnen, nach einer Änderung neu bauen und neu laden. Die
auslieferbare Form entsteht mit

```bash
npm run build        # schreibt dist/NoNotes
```

`npm test` baut zuerst und führt dann vier Läufe aus, jeder druckt wenige Schritte, die je mehrere Dinge prüfen
(die Teilschritte darin bleiben still; `NONOTES_TEST_VERBOSE=1` zeigt sie, beim Fehlschlag wird der letzte genannt):

| Lauf | Prüft |
| --- | --- |
| `test/core.cjs` (ohne Browser) | Zusammenführen, Datenbankschicht (Standardschema, Angleichen alter Dateien, Konflikte, Autor, Querverweise, Entscheide), Build fremder Ausprägungen, Videoadressen, Tabellen |
| `test/app.cjs` | das Gebaute wie ein Benutzer per `file://` in headless Chromium: Datei und Speicher, Mindmap, Fragen, Markdown, Tags, Suche, Papierkorb, Export, Drag & Drop, Anhänge, Drucken, Toolleiste, Hilfe, Aufgaben, Termine, Kalender, Listen, geteilte Ansicht, Unteraufgaben, Archiv, alte Dateien; der Vertrag der Backend-Schnittstelle |
| `test/collab.cjs` | Verlauf pro Notiz, gleichzeitiges Schreiben, Änderungen von aussen (Datei, anderer Tab), Lesemodus |
| `test/extend.cjs` | Erweiterungen und Designs, Hauptfarbe, Videos in der Vorschau, Querverweise, Entscheide und Personen, Vorlagen, Tabellen, Sprachen (Pseudo-Sprache, Englisch, Testpaket) |

Dazu kommen `tools/i18n.cjs lint` und `check` (Texte und Sprachpakete):

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

## Sprachen

Ausgeliefert werden **Deutsch** und **English** (ab v1.4.0). Beim ersten Start gilt die Sprache des Browsers,
sonst Deutsch; umgestellt wird im Menü **Datenbank → Sprache** (die Auswahl wird im Browser gemerkt, die Seite
lädt neu, die Daten bleiben). Weitere Sprachen sind Dateien in `lang/` und kommen mit einem Release dazu:
`npm run i18n -- init fr French fr-CH` legt ein Paket mit allen Texten an, `check` prüft es. Einzelheiten in
[docs/LANGUAGES.md](docs/LANGUAGES.md).

## Release

Der Workflow `.github/workflows/package.yml` läuft bei jedem Push: Smoke-Test, dann zwei ZIPs
als Artefakte: `NoNotes-<Version>.zip` und `NoNotes-with-Plugins-<Version>.zip`. Für das zweite holt der
Workflow das Repository `CDRO/NoNotes-plugins` und baut mit `node tools/build.cjs --plugins <Ordner>`; die
Unterordner dieses Repositorys landen in `plugins/` und stehen im Verzeichnis des Dialogs «Erweiterungen».
Ist das Repository privat, braucht der Workflow ein Secret `PLUGINS_TOKEN` (Fine-grained Token mit Leserecht
auf dessen Inhalt); ohne Zugriff gibt es eine Warnung und nur das erste ZIP. Ein Release mit Tag entsteht auf zwei Wegen:

- **Manuell**: unter *Actions → Testen und paketieren → Run workflow* den gewünschten Stand
  wählen und die Version eingeben, z. B. `v0.1.0`. Der Workflow legt den Tag auf diesem
  Commit an, baut die ZIPs und veröffentlicht das Release (existiert es schon, werden die ZIPs ersetzt).
- **Per Tag**: `git tag v0.1.0 && git push origin v0.1.0` löst denselben Ablauf aus.

**Release-Notizen (ab v2.12.0).** Jedes Release bekommt auf GitHub eine ausführliche Beschreibung mit Screenshots: was neu ist, wie
man es benutzt, und den Update-Pfad von der vorigen Version. Sie liegt im Repository unter `docs/releases/<Version>/RELEASE.md`
(Vorlage `docs/releases/VORLAGE.md`), die Screenshots daneben, gemacht mit `node tools/release-shots.cjs <Version>` aus einem
Drehbuch `shots.cjs`. Der Workflow prüft den Ordner gleich nach dem Start (`node tools/release-notes.cjs check <Version>`) und bricht
ab, wenn etwas fehlt; beim Release wird daraus Titel und Beschreibung. Regeln und Ablauf: [docs/releases/README.md](docs/releases/README.md).

Die Versionsnummer wird dabei in die App geschrieben und erscheint oben neben dem Namen.
