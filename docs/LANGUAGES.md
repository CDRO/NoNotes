# Sprachen

NoNotes ist von Anfang an mehrsprachig gebaut. Die Quellsprache ist Deutsch (Schweiz); weitere Sprachen
sind Dateien im Ordner `lang/` und lassen sich mit jedem Release ergänzen. Ausgeliefert werden:

| Datei | Sprache | Flagge | Gebietsschema | Bekommt ausserdem (Browser) |
|---|---|---|---|---|
| `lang/de.js` | Deutsch (Schweiz), Quellsprache | CH | `de-CH` | `de`, `de-LI` |
| `lang/de-DE.js` | Deutsch (Deutschland), seit 3.1.0: ß, „ “, «Entscheidung» | DE | `de-DE` | `de-AT`, `de-LU`, `de-BE`, `de-IT` |
| `lang/en.js` | English, seit 1.4.0, britische Schreibweise | GB | `en-GB` | jedes `en-…` |
| `lang/fr-CH.js` | Français (Suisse), seit 3.1.0 | CH | `fr-CH` | jedes `fr-…` |
| `lang/it-CH.js` | Italiano (Svizzera), seit 3.1.0 | CH | `it-CH` | jedes `it-…` |
| `lang/es-ES.js` | Español (España), seit 3.1.0 | ES | `es-ES` | `es` |
| `lang/es-MX.js` | Español (México), seit 3.1.0 | MX | `es-MX` | Lateinamerika und `es-419`, `es-US` |
| `lang/pt-PT.js` | Português (Portugal), seit 3.1.0 | PT | `pt-PT` | `pt-AO`, `pt-MZ`, `pt-CV` … |
| `lang/pt-BR.js` | Português (Brasil), seit 3.1.0 | BR | `pt-BR` | `pt` |

## Wie es funktioniert

- **Der deutsche Text ist der Schlüssel** (wie bei gettext). Im Code steht `t('Neue Notiz')`; ohne
  Übersetzung erscheint der deutsche Text.
- Platzhalter in geschweiften Klammern: `t('Gespeichert {zeit}', { zeit })`.
- Einzahl und Mehrzahl: `tn('{n} Notiz', '{n} Notizen', n)`. Der Schlüssel ist die deutsche Einzahl,
  `{n}` ist immer gesetzt. Die Formen einer Sprache richten sich nach `Intl.PluralRules` (zum Beispiel
  `one`/`other` im Englischen, `one`/`few`/`many`/`other` im Polnischen).
- Festes Markup in der `index.html` wird beim Start über `translateDom()` ersetzt, ohne Auszeichnung im
  Markup. Elemente mit reinem Text oder Textauszeichnung (`<strong>`, `<em>`, `<code>` …) zählen als ein
  Text, sonst jeder Textknoten einzeln; dazu die Attribute `title`, `placeholder`, `aria-label`, `alt`.
  `data-i18n-skip` lässt ein Element aus, `data-i18n` erzwingt ein Element, dessen Text nur aus
  Tastenkürzeln besteht (zum Beispiel `<kbd data-i18n>Entf</kbd>`).
- Texte in Tabellen und Konstanten werden mit `N_('…')` markiert und später mit `t()` übersetzt.
- Eine Ausprägung oder Erweiterung ergänzt ein Sprachpaket mit `NoNotesI18n.extend('en', { 'Deutscher Text': 'English text' })`, auch wenn das
  Paket erst danach geladen wird. Texte, die das Paket schon hat, werden nicht ersetzt.
- Die Sprache wählt der Benutzer mit dem **Sprachwechsel** oben rechts (seit 3.1.0; nur sichtbar, wenn mehr als eine Sprache
  da ist): ein Knopf mit Flagge und Kürzel (`DE`, `FR` …), dahinter die Liste aller Sprachen mit Flagge und Namen, nach Namen
  sortiert, mit Maus oder Tastatur (Pfeile, `Pos1`/`Ende`, Anfangsbuchstabe, `Enter`, `Esc`). Gemerkt wird sie im Browser
  (`localStorage`, Schlüssel `nonotes.lang`). Ein Wechsel sichert die offene Notiz und lädt die Seite neu.
- Ohne gemerkte Wahl gilt die erste Browsersprache, für die es ein Paket gibt (`NoNotesI18n.match`): dieselbe Kennung oder
  dasselbe Gebietsschema (`de-CH` → `de`), sonst ein Paket derselben Sprache, das die Region in `regions` nennt
  (`es-AR` → `es-MX`), sonst das Paket, das nur die Sprache heisst (`de`, `en`), sonst das erste dieser Sprache in der
  Reihenfolge der Dateien (`pt` → `pt-BR`, `fr-FR` → `fr-CH`); ohne Treffer Deutsch.
- Die **Flagge** nennt das Paket mit `flag` (Land nach ISO 3166, zum Beispiel `CH`); gezeichnet wird sie von
  `packages/ui/flags.js` als kleines SVG (Emoji-Flaggen zeigt Windows nur als Buchstaben). Für ein Land ohne Zeichnung dort
  erscheint eine Weltkugel; eine neue Flagge ist ein Eintrag in `flags.js`.
- Zeitstempel (Erstellt, Geändert, Gedruckt, Gespeichert) folgen der Sprache (`Intl`). Fälligkeiten
  von Aufgaben und Fragen werden vorerst in jeder Sprache als `T.M.JJJJ` angezeigt; die Eingabe im Text
  (`>15.10.2026` oder `>2026-10-15`, optional mit Uhrzeit; bis v2.x `@Datum`) ist Syntax und bleibt überall gleich.
- Der Test `test/extend.cjs` führt die Seite in `qps` und in `en` durch alle Ansichten, Dialoge und Rückfragen und
  schlägt fehl, sobald irgendwo deutscher Text stehen bleibt. Seit 3.1.0 öffnet er zudem jedes Paket (Hauptansicht, Menü,
  Hilfe) und meldet jeden Text, der deutsch geblieben ist, obwohl das Paket eine Übersetzung hat; dazu `html lang`, Kürzel
  und Flagge im Sprachwechsel und die Zuordnung der Browsersprache.
- Die Entwicklungssprache `qps` umschliesst jeden Text mit `⟦ ⟧`. Wer sie einstellt
  (`localStorage.setItem('nonotes.lang', 'qps')`), sieht sofort jede Stelle, die nicht übersetzbar ist.

## Eine Sprache hinzufügen

```bash
npm install
npm run i18n -- init nl-NL Nederlands nl-NL   # legt lang/nl-NL.js mit allen Texten an
# in der letzten Zeile flag (und wahlweise regions) ergänzen: { locale: 'nl-NL', flag: 'NL', regions: ['NL', 'BE'] }
# lang/nl-NL.js bearbeiten: Werte eintragen, leer lassen = bleibt deutsch
npm run i18n -- check --strict                # Platzhalter, Mehrzahlformen, Namen, veraltete Texte; alles übersetzt
npm test                                      # ganzer Test, auch mit dem neuen Paket
```

Eine Sprache für eine weitere Region (wie `es-MX` neben `es-ES`) ist ein eigenes, vollständiges Paket. `update` behält
`flag` und `regions`.

Die Datei sieht so aus (Schlüssel = deutscher Text):

```js
NoNotesI18n.register('en', 'English', {
  'Neue Notiz': 'New note',
  '{n} Notiz': { one: '{n} note', other: '{n} notes' },
  'Gespeichert {zeit}': 'Saved {zeit}',
}, { locale: 'en' });
```

Regeln für Übersetzungen:

- **Platzhalter bleiben unverändert** (`{zeit}`), dürfen aber umgestellt werden. `check` meldet fehlende
  oder erfundene Platzhalter. `{n}` darf in einer Mehrzahlform fehlen («Eine Notiz»).
- **Jede Mehrzahlkategorie der Sprache** ausfüllen (`init` legt sie passend an).
- **Markup in Hilfetexten bleibt erhalten** (`<strong>`, `<code>`, `<kbd>` …), damit das Layout stimmt.
  Text in `<code>` und `<kbd>` ist Syntax oder eine Taste und bleibt in der Regel stehen.
- Die Hilfe nennt Menüeinträge wie «Datenbank → Datenbankdatei anlegen…». Diese Namen so übersetzen, wie
  sie im Menü stehen.
- Die Schreibweise von Fragen (`?`), Antworten (`!`), Aufgaben (`- [ ]`) und Terminen (`>Datum`) ist keine
  Sprache, sondern Syntax des Notiztexts und bleibt in allen Sprachen gleich.
- **Namen in Vorlagen** (`platzhalter:datum` → `{{date}}`, `datumsstil:lang` → `{{date:long}}`): ein Wort aus Kleinbuchstaben,
  Ziffern oder `_` (Akzente erlaubt), und über alle Sprachen eindeutig: Vorlagen verstehen die Namen jeder Sprache, ein Name darf
  also nicht in zwei Sprachen Verschiedenes bedeuten. `datumsformat:TT.MM.JJJJ` und `datumsformat:JJJJ-MM-TT` brauchen dieselben
  Kürzel und Trennzeichen, deutsch oder englisch (`dd.mm.yyyy`). `check` prüft das.
- Anführungszeichen, Anrede und Fachbegriffe richten sich nach der Sprache: zum Beispiel „ “ in `de-DE`, « » mit schmalem
  Leerzeichen in `fr-CH`, “ ” in `es-MX` und `pt-BR`; `vous` in `fr-CH`, `você` in `pt-BR`. Die Taste `Entf` heisst wie auf
  der Tastatur der Sprache (`Del`, `Suppr`, `Canc`, `Supr`).

## Texte nachführen

Wenn sich der Quelltext ändert (neue Texte, geänderte Texte):

```bash
npm run i18n -- update en     # neue Texte leer anhängen, veraltete entfernen (je Paket: en, de-DE, fr-CH …)
npm run i18n -- check --strict  # schlägt fehl, solange etwas nicht übersetzt ist
npm run i18n -- list          # alle Texte mit Fundstelle
```

`npm run i18n -- lint` (Teil von `npm test`) sucht deutsche Texte im Quelltext, die nicht durch `t()`/`tn()`
laufen. Wer einen Text bewusst nicht übersetzt (Protokollmeldung, interner Fehler), hängt dem Ausdruck
`// i18n-ignore` an die Zeile. Eine ganze Datei, deren Texte für Agenten gedacht und darum englisch sind
(`packages/agent/`), trägt im Kopfkommentar `i18n-ignore-file`; sie wird vom Lint übersprungen.

## Mit einem Release veröffentlichen

Jedes Paket in `lang/` wird vom Build automatisch eingebunden (`tools/build.cjs` ersetzt den Platzhalter
`<!-- LANG-PACKS -->` durch alle `lang/xx.js`). Eine neue Sprache ist damit eine Datei und ein Release:
Datei hinzufügen, `npm test`, Version über den Workflow veröffentlichen.
