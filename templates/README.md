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
