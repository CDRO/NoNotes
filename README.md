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

### Drucken

**Drucken…** gibt es in der Mindmap-Leiste, im Editor, im Kontextmenü eines Knotens und
mit `Ctrl+P`. Der Dialog fragt den Umfang: nur diese Notiz, diese Notiz mit allen
Unternotizen, die ausgewählten Notizen (wahlweise mit Unternotizen) oder alle Notizen.
Dazu wählbar: Mindmap-Bild voranstellen (bei Teilmengen nur der gedruckte Ausschnitt),
Inhaltsverzeichnis, jede Notiz auf einer neuen Seite. Gedruckt wird die gerenderte Ansicht
mit Markdown, Bildern, Fragen und Antworten. Im Druckdialog des Browsers lässt sich
«Als PDF speichern» wählen.

In der Ansicht **Fragen** druckt **Drucken…** (oder `Ctrl+P`) ein Fragen-und-Antworten-Dokument:
wie angezeigt, nur offene, nur beantwortete oder alle Fragen, nach Notiz gruppiert, auf Wunsch
mit Linien für handschriftliche Antworten bei offenen Fragen.

### Export als Markdown

`Datenbank → Als Markdown exportieren…` bietet zwei Formen, jeweils mit dem Bild der
Mindmap (`mindmap.svg` und `mindmap.png`), das oben in der Übersicht eingebunden ist:

- **Eine Datei pro Notiz**: `index.md` mit Mindmap, Inhaltsverzeichnis in Baumreihenfolge
  und der Liste offener Fragen, dazu `notes/<titel>.md` pro Notiz mit Pfad, Datum, Tags,
  Inhalt und Links zu den Unternotizen.
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

### Hauptfarbe

Unter **Datenbank → Hauptfarbe** stehen acht Farben zur Wahl: Blau (Vorgabe), Türkis, Grün, Gelb, Orange,
Rot, Violett und Grau. Die Wahl wirkt sofort auf Knöpfe, Wurzelknoten, Abzeichen, Links und Auswahl, jeweils
mit einer passenden hellen und dunklen Fassung (je nach Einstellung des Systems) und einer Schriftfarbe, die auf
der Fläche gut lesbar bleibt. Die Farbe wird **in der Datenbankdatei** gespeichert (Tabelle `meta`, Schlüssel
`accent`), gehört also zur Datei und wandert mit ihr; ein Zwischenspeicher im Browser verhindert, dass beim Start
kurz Blau aufblitzt. Das Mindmap-Bild in Export und Druck übernimmt die Farbe.

### Verlauf pro Notiz

Der Knopf **Verlauf** im Editor zeigt frühere Fassungen der Notiz. Eine neue Fassung entsteht, wenn du nach einer
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
Welche geladen werden, steht in `plugins/plugins.js`; unter **Datenbank → Erweiterungen…** siehst du, was geladen
wurde und ob etwas schiefging. Eine Erweiterung kann Menüeinträge und Toolleistenknöpfe hinzufügen, auf Ereignisse
reagieren, Notizen über dieselbe Datenschnittstelle wie die App lesen und ändern und ein **Design** mitbringen
(Farben und Masse der Oberfläche; Auswahl im Menü, gespeichert in der Datenbankdatei).

**Achtung:** Eine Erweiterung läuft mit allen Rechten der Seite und kann alle Notizen lesen und ändern. Lade nur Dateien,
denen du vertraust. Erweiterungen kommen nie aus der Datenbankdatei, nur aus dem Ordner `plugins/`. Im Ordner
`plugins/beispiele/` liegen zwei Beispiele (Datum einfügen, Design «Sepia»). Die Schnittstelle ist asynchron und
bleibt innerhalb von 1.x stabil; Beschreibung für Autoren in [docs/PLUGINS.md](docs/PLUGINS.md).

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
- In der Mindmap zeigt eine Marke am Knoten die Anzahl offener Fragen; eingeklappte Äste
  zählen ihren ganzen Teilbaum. Der Reiter *Fragen* trägt die Gesamtzahl.

### Aufgaben

Eine Markdown-Checkbox ist eine Aufgabe: `- [ ] Offerte einholen` offen, `- [x] …` erledigt.
Ein Termin darf am Zeilenende stehen: `- [ ] Offerte einholen @15.10.2026`, mit Uhrzeit
`@15.10.2026 14:30` (auch `14.30` oder `@2026-10-15 14:30`). Mit Uhrzeit gilt der Zeitpunkt,
ohne Uhrzeit der ganze Tag; ein heutiger Termin mit vergangener Uhrzeit ist überfällig.
Dasselbe gilt für Fragen.

- Die Ansicht **Aufgaben** sammelt alle Aufgaben aller Notizen. Standardfilter ist *Offen*;
  *Alle* und *Erledigt* holen den Rest zurück. Sortierung nach Fälligkeit gruppiert in
  Überfällig, Heute, Diese Woche, Später und Ohne Termin; alternativ nach Notiz. Dazu Suche
  und Tag-Filter. Der Reiter zeigt die Zahl der offenen Aufgaben, rot wenn etwas überfällig ist.
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
  Adressen ohne `https://` wie `www.beispiel.ch` werden automatisch ergänzt.
- Die **Toolleiste** über dem Text setzt alles per Klick: Überschrift (Auswahlliste), fett,
  kursiv, durchgestrichen, Code, Listen, Aufgabe, Zitat, Codeblock, Trennlinie, Link,
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
  Der Streifen über dem Text zeigt alle Anhänge der Notiz mit Einfügen und Löschen.
  Beim Export landen sie im Ordner `attachments/`.
- Oberste Zeile ist der Titel, `Enter` springt in den Text.
- Der Pfad über dem Titel zeigt, wo die Notiz im Baum hängt; die Einträge sind anklickbar.
- **+ Unternotiz** legt direkt eine Unternotiz an.
- `Ctrl+S` speichert sofort (passiert sonst automatisch nach kurzer Pause).
- Auf schmalen Fenstern wird zwischen Liste und Editor umgeschaltet (`Esc` oder «Zurück»).

## Technik

Der Quelltext liegt in Paketen (`packages/`), eine Ausprägung (`editions/local/`) setzt daraus die
auslieferbare Version zusammen. Aufbau und Abhängigkeiten: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
Datenschnittstelle: [docs/BACKEND.md](docs/BACKEND.md), Sprachen: [docs/LANGUAGES.md](docs/LANGUAGES.md).
Im ausgelieferten Ordner liegen alle Skripte flach unter `js/`.

| Teil | Umsetzung |
| --- | --- |
| Oberfläche | `index.html`, `css/app.css`, `js/app.js` (`packages/ui/`) – reines HTML/CSS/JS, keine Frameworks; der Build kopiert nur |
| Mindmap | `packages/ui/mindmap.js`: eigenes Layout (links/rechts ausbalanciert), SVG, Zoom, Ziehen, Tastatur; archivierte Knoten blass und gestrichelt |
| Fragen | `packages/core/questions.js`: Parser für `?`/`!`-Zeilen; Index in der Tabelle `questions`, bei jeder Änderung abgeglichen |
| Aufgaben | `packages/core/tasks.js`: Parser für `- [ ]`-Zeilen mit `@Datum`, Unteraufgaben über die Einrückung, Abschluss-Regeln als reine Textfunktionen; Index in der Tabelle `tasks`, gleiches Prinzip |
| Termine | `packages/core/dates.js`: gemeinsame Logik für `@TT.MM.JJJJ` bzw. `@JJJJ-MM-TT`, Dringlichkeit, Anzeige |
| Markdown | `packages/core/markdown.js`: eigener Renderer, escaped allen Text, erlaubt nur sichere Link-Schemata |
| Toolleiste | `packages/core/editing.js`: reine Textfunktionen (umschliessen, Zeilenpräfixe, Überschriften, Links) |
| Export | `packages/core/export.js` baut die Dateien, `zip.js` ist ein kleiner ZIP-Writer; das Bild liefert `NoNotesMindmap.toSvgString`, PNG über ein Canvas |
| Druck | `packages/ui/print.js` baut das Druckdokument in `#printArea`; `@media print` blendet den Rest der App aus |
| Scroll-Sync | `packages/ui/scrollsync.js`: Spiegel des Textes misst Zeilenhöhen, Vorschau-Blöcke tragen `data-line`, lineare Interpolation dazwischen |
| Erweiterungen | `packages/core/plugins.js` (Verzeichnis, Lader, Ereignisse) und die Anbindung in `packages/ui/app.js`; Ordner `plugins/` mit Liste, Anleitung und Beispielen (siehe [docs/PLUGINS.md](docs/PLUGINS.md)) |
| Verlauf | `packages/core/history.js` (Patches und Zeilenvergleich als reine Textfunktionen); Fassungen und Aufbewahrung in `packages/data/db.js`, Dialog in `packages/ui/app.js` |
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

Schema (Version 11). Ältere Datenbanken werden beim Öffnen automatisch migriert.

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
  deleted_at TEXT,            -- gesetzt = im Papierkorb
  archived_at TEXT            -- gesetzt = im Archiv (ausgeblendet, durchsuchbar, schreibgeschützt)
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- schema_version, created_at, map_title, accent, theme,
                                                                -- calendar_uid, calendar_sequence, calendar_known
CREATE TABLE questions (          -- Index über die ?/!-Zeilen, wird aus dem Text abgeleitet
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  norm        TEXT NOT NULL,      -- normalisiert, zum Wiedererkennen nach Änderungen
  answer      TEXT,               -- NULL = offen
  line_no     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  answered_at TEXT,
  due         TEXT                -- Fälligkeit aus "@Datum [Zeit]": YYYY-MM-DD oder YYYY-MM-DDTHH:MM
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
  r TEXT NOT NULL                   -- der Teil dazwischen, wie er in dieser Fassung steht
);
CREATE TABLE attachments (          -- Bilder, im Text als ![Name](att:ID) referenziert
  id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, name TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL
);
```

## Entwicklung

Für die Entwicklung genügt es, `editions/local/index.html` im Browser zu öffnen und nach einer
Änderung neu zu laden (dann nur Deutsch, ohne Versionsnummer). Die auslieferbare Form entsteht mit

```bash
npm run build        # schreibt dist/NoNotes
```

Der Test baut zuerst, öffnet dann das Gebaute wie ein Benutzer per `file://` in headless Chromium
und prüft Anlegen, Suchen, Speichern, Neuladen, Herunterladen, Importieren, Löschen, das Schreiben
in die Datenbankdatei, die Mindmap-Bedienung, Fragen, Markdown-Vorschau, Tags, Papierkorb, Suche,
Umsortieren per Drag & Drop, Bild-Anhänge, den Export (Ordner und ZIP), das Drucken (mit gestubbtem
`window.print`), Toolleiste und Hilfe, Aufgaben, Termine mit Uhrzeit, den Kalenderexport, das synchrone
Scrollen der geteilten Ansicht, Unteraufgaben, das Archiv und die Migration alter Datenbanken. Dazu
kommen der Vertrag der Backend-Schnittstelle (`test/backend.cjs`), die Hauptfarbe (`test/palette.cjs`), die Erweiterungs-Schnittstelle (`test/plugins.cjs`), den Verlauf (`test/history.cjs`) und die
Sprachprüfungen (`test/i18n.cjs`, `tools/i18n.cjs lint` und `check`):

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

## Sprachen

Ausgeliefert wird Deutsch. Weitere Sprachen sind Dateien in `lang/` und kommen mit einem Release dazu:
`npm run i18n -- init en English en` legt ein Paket mit allen Texten an, `check` prüft es. Ist mehr als eine
Sprache vorhanden, erscheint die Auswahl im Menü **Datenbank**. Einzelheiten in
[docs/LANGUAGES.md](docs/LANGUAGES.md).

## Release

Der Workflow `.github/workflows/package.yml` läuft bei jedem Push: Smoke-Test, dann ZIP
als Artefakt. Ein Release mit Tag entsteht auf zwei Wegen:

- **Manuell**: unter *Actions → Testen und paketieren → Run workflow* den gewünschten Stand
  wählen und die Version eingeben, z. B. `v0.1.0`. Der Workflow legt den Tag auf diesem
  Commit an, baut das ZIP und veröffentlicht das Release.
- **Per Tag**: `git tag v0.1.0 && git push origin v0.1.0` löst denselben Ablauf aus.

Die Versionsnummer wird dabei in die App geschrieben und erscheint oben neben dem Namen.
