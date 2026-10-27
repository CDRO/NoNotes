---
nonotes: 1
name: "Aufgabe"
description: "Eine Aufgabe mit Beschreibung, Ziel, verantwortlicher Person und Termin; Tab führt durch die Felder"
title: "{{?Beschreibung}}"
tags: ["aufgabe"]
---
- [ ] {{?Beschreibung}} @{{?Wer}} @{{?Bis wann: {{datum+7}}}}

**Ziel:** {{?Ziel}}

**Notizen:** 

```template-description Beschreibung
Was zu tun ist, kurz und als Tätigkeit, zum Beispiel *Offerte für die neue Heizung einholen*. Steht auch im Titel der Notiz.
```

```template-description Wer
Das **Kürzel** der Person, die dafür sorgt, ohne `@` (das steht schon da). Weitere Beteiligte danach als `(@kürzel)`.
```

```template-description Bis wann
Der Termin als Datum, etwa **31.10.2026**. Vorgeschlagen ist in einer Woche; ohne Termin den Platzhalter samt `@` löschen.
```

```template-description Ziel
Woran man merkt, dass die Aufgabe erledigt ist: ein Ergebnis, nicht der Weg dorthin.
```
