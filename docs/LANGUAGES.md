# Sprachen

NoNotes ist von Anfang an mehrsprachig gebaut. Die Quellsprache ist Deutsch; weitere Sprachen
sind Dateien im Ordner `lang/` und lassen sich mit jedem Release ergänzen. Ausgeliefert wird
vorerst nur Deutsch.

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
- Die Sprache wählt der Benutzer im Menü **Datenbank** (nur sichtbar, wenn mehr als eine Sprache da ist).
  Gemerkt wird sie im Browser (`localStorage`, Schlüssel `nonotes.lang`); sonst gilt die Browsersprache,
  sonst Deutsch. Ein Wechsel lädt die Seite neu.
- Zeitstempel (Erstellt, Geändert, Gedruckt, Gespeichert) folgen der Sprache (`Intl`). Fälligkeiten
  von Aufgaben und Fragen werden vorerst in jeder Sprache als `T.M.JJJJ` angezeigt; die Eingabe im Text
  (`@15.10.2026` oder `@2026-10-15`, optional mit Uhrzeit) ist Syntax und bleibt überall gleich.
- Die Entwicklungssprache `qps` umschliesst jeden Text mit `⟦ ⟧`. Wer sie einstellt
  (`localStorage.setItem('nonotes.lang', 'qps')`), sieht sofort jede Stelle, die nicht übersetzbar ist.

## Eine Sprache hinzufügen

```bash
npm install
npm run i18n -- init en English en      # legt lang/en.js mit allen Texten an
# lang/en.js bearbeiten: Werte eintragen, leer lassen = bleibt deutsch
npm run i18n -- check                   # Platzhalter, Mehrzahlformen, veraltete Texte prüfen
npm test                                # ganzer Test, auch mit dem neuen Paket
```

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
- Die Schreibweise von Fragen (`?`), Antworten (`!`), Aufgaben (`- [ ]`) und Terminen (`@Datum`) ist keine
  Sprache, sondern Syntax des Notiztexts und bleibt in allen Sprachen gleich.

## Texte nachführen

Wenn sich der Quelltext ändert (neue Texte, geänderte Texte):

```bash
npm run i18n -- update en     # neue Texte leer anhängen, veraltete entfernen
npm run i18n -- check --strict  # schlägt fehl, solange etwas nicht übersetzt ist
npm run i18n -- list          # alle Texte mit Fundstelle
```

`npm run i18n -- lint` (Teil von `npm test`) sucht deutsche Texte im Quelltext, die nicht durch `t()`/`tn()`
laufen. Wer einen Text bewusst nicht übersetzt (Protokollmeldung, interner Fehler), hängt dem Ausdruck
`// i18n-ignore` an die Zeile.

## Mit einem Release veröffentlichen

Jedes Paket in `lang/` wird vom Build automatisch eingebunden (`tools/build.cjs` ersetzt den Platzhalter
`<!-- LANG-PACKS -->` durch alle `lang/xx.js`). Eine neue Sprache ist damit eine Datei und ein Release:
Datei hinzufügen, `npm test`, Version über den Workflow veröffentlichen.
