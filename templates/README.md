# Vorlagen

Jede `.md`-Datei in diesem Ordner ist eine Vorlage für neue Notizen (diese README nicht). So kommt NoNotes an sie heran:
**Datenbank → Vorlagen… → Ordner verbinden…** und diesen Ordner wählen (einmal, gilt für alle Bereiche). Danach legt
«Neue Notiz aus Vorlage…» Notizen daraus an, und «Notiz → Als Vorlage speichern…» schreibt neue Vorlagen direkt hierher.

Eine Vorlage ist Markdown mit einem kurzen Kopf. Unternotizen beginnen mit einem Kommentar, der ausserhalb von NoNotes
unsichtbar ist:

```
---
nonotes: 1
name: "Sitzungsprotokoll"
description: "Traktanden, Entscheide und Pendenzen"
title: "Sitzung {{datum}}"
tags: ["sitzung"]
---
Text der Notiz …

<!-- nonotes:note {"depth":1,"title":"Entscheide","tags":[]} -->
Text der ersten Unternotiz …
```

Eine Markdown-Datei ohne Kopf geht auch: Name und Titel kommen dann aus dem Dateinamen.

**Platzhalter** werden beim Anlegen ersetzt: `{{datum}}` (heute), `{{datum+7}}` und `{{datum-1}}` (Tage dazu oder weg),
`{{zeit}}`, `{{wochentag}}`, `{{woche}}` (Kalenderwoche), `{{jahr}}`, `{{vorlage}}` (Name der Vorlage), `{{bereich}}` (Name des
Bereichs) und `{{ich}}` (im Dienst dein `@kürzel`). Die Namen gibt es auch in den anderen Sprachen der App (zum Beispiel
`{{date}}`); unbekannte Platzhalter bleiben stehen. Ein Termin in sieben Tagen: `- [ ] Offerte einholen @{{datum+7}}`.

Das **Datum mit Format** steht hinter einem Doppelpunkt: `{{datum+2:JJJJ-MM-TT}}` (2026-10-22), `{{datum:TT.MM.JJJJ}}` (05.03.2026),
`{{datum:TTTT, T. MMMM JJJJ}}` (Dienstag, 20. Oktober 2026), `{{datum:lang}}` (20. Oktober 2026). Kürzel gross oder klein, deutsch
oder englisch: `JJJJ` (`yyyy`), `JJ`; `MM`, `M`, `MMM` (Okt), `MMMM` (Oktober); `TT` (`dd`), `T`; `TTT` (Di), `TTTT` (Dienstag).
Text in Hochkommas bleibt stehen (`{{datum:'KW' JJJJ}}`). Stile: `kurz`, `mittel`, `lang`, `voll`, `iso`.

**Platzhalter zum Ausfüllen** (seit 2.12.0) schreibst du beim Einfügen selbst: `{{?Kunde}}`. Nach dem Einfügen ist der erste
ausgewählt (steht einer im Titel, beginnt es dort): Tippen ersetzt ihn, `Tab` springt zum nächsten, `Umschalt+Tab` zurück, `Esc`
beendet. Übersprungene bleiben stehen und sind in der Vorschau gelb. `{{?Kunde: Muster AG}}` bringt einen Vorschlag mit, auch einen
automatischen: `@{{?Bis wann: {{datum+7}}}}`. Gleiche Namen bekommen denselben Wert, auch im Titel und in den Unternotizen.

Eine **Beschreibung** erscheint beim Ausfüllen in einem Kasten unter der Zeile. Sie steht irgendwo in der Vorlage als Block mit dem
Namen des Platzhalters (Markdown):

````
```template-description Kunde
Firmenname wie im Handelsregister, **ohne** Rechtsform.
```
````

Die Blöcke stehen nach dem Einfügen am Ende der Notiz und sind in Vorschau, Druck und Export unsichtbar; sie verschwinden, sobald es
keinen Platzhalter ihres Namens mehr gibt. Ob ein ausgefüllter Platzhalter als `{{?Kunde: Muster AG}}` stehen bleibt (zum späteren
Anspringen) oder zu Text wird, sagt die Einstellung unter **Datenbank → Vorlagen…**; eine Vorlage kann es im Kopf selbst festlegen:
`placeholders: "keep"` oder `"remove"`. Beispiel: `Aufgabe.md`.
