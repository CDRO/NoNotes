# Release-Notizen

Ab **v2.12.0** hat jedes Release auf GitHub eine ausführliche Beschreibung mit Screenshots der Neuerungen: was neu ist, wie man es
benutzt und wie man von der vorigen Version aktualisiert. Die Beschreibung entsteht hier im Repository, zusammen mit dem Code, und der
Workflow `.github/workflows/package.yml` setzt sie beim Release ein. Fehlt sie oder ist sie unvollständig, bricht das Release ab,
bevor die Tests laufen.

## Ordner je Release

```
docs/releases/v2.12.0/
  RELEASE.md      die Beschreibung (Vorlage: VORLAGE.md)
  shots.cjs       Drehbuch der Screenshots (tools/release-shots.cjs)
  *.png           die Screenshots, von RELEASE.md eingebunden
```

Der Ordner geht nicht ins ZIP (der Build nimmt aus `docs/` nur die Dateien direkt darin).

## Aufbau von RELEASE.md

1. **Titelzeile** `# NoNotes v2.12.0 – Kurztitel` (wird der Titel des Releases).
2. **Kurzfassung**: ein, zwei Sätze, was das Release bringt.
3. **`## Was ist neu`** mit einem Unterabschnitt `### …` je Neuerung. Jeder Unterabschnitt beschreibt, was neu ist und wie man es
   benutzt (Bedienung, Tasten, Menüs, Schreibweise), mindestens 15 Wörter, und zeigt mindestens einen Screenshot. Wo ein Bild nichts
   zeigt (eine Schnittstelle, ein Fehler im Hintergrund), steht stattdessen `<!-- ohne Bild: Grund -->`.
4. **`## Update von vA.B.C`**: der Update-Pfad als nummerierte Schritte, beginnend mit der Sicherung. Dazu, was mit den Daten
   geschieht (Schema, automatische Angleichung), ob der Weg zurück geht, was eigene Dateien (`plugins/plugins.js`, eigene
   Erweiterungen, `templates/`) brauchen, und was Erweiterungen, eigene Backends und Agenten wissen müssen.
5. Wahlweise `## Behoben`, `## Bekannte Einschränkungen`, `## Für Entwickler` (Schnittstellen, Hooks, `docs/BACKEND.md`).

Relative Bilder und Verweise (`![Legende](legende.png)`, `[Erweiterungen](../../PLUGINS.md)`) funktionieren im Repository und
werden beim Release zu Adressen auf dem Stand des Tags. Am Ende hängt das Werkzeug die Erklärung der zwei ZIPs und den Vergleich mit
dem vorigen Release an.

## Screenshots

- Gemacht mit `tools/release-shots.cjs` aus dem Drehbuch `shots.cjs`, damit sie sich jederzeit gleich wiederholen lassen:
  1280 × 800, Deutsch, Zeitzone Zürich, feste Uhrzeit, helles Design, nur Beispieldaten (keine echten Namen, Notizen oder Adressen).
- Ein Bild je Neuerung, das die Neuerung im Einsatz zeigt; lieber ein Ausschnitt (`locator`) als die ganze Seite, wenn es um ein
  Detail geht. Der Text in `[ ]` beschreibt, was zu sehen ist.
- PNG, höchstens 1 MB je Bild, Name aus Kleinbuchstaben, Ziffern und «-».

```sh
# mit allen Erweiterungen, wie im Paket «NoNotes-with-Plugins»
node tools/release-shots.cjs v2.12.0 --plugins ../NoNotes-plugins
# nur ein Bild neu
node tools/release-shots.cjs v2.12.0 --plugins ../NoNotes-plugins --only legende
```

Ein Drehbuch:

```js
module.exports = {
  date: '2026-11-02T09:00:00+01:00',          // Uhrzeit der App (Termine, «überfällig»)
  plugins: ['tag-colors/tag-colors.js'],      // fest eingeschaltete Erweiterungen
  async run(s) {
    await s.newNote('Projekt Süd');
    await s.edit('Projekt Süd', { body: '- [ ] Angebot einholen @anna @03.11.2026', mode: 'preview' });
    await s.shot('aufgaben-in-der-vorschau');
    await s.back();
    await s.view('tasks');
    await s.shot('aufgabenliste', { locator: '#tasksView', pad: 8 });
  },
};
```

## Ablauf beim Release

1. Ordner `docs/releases/<Version>/` aus `VORLAGE.md` anlegen, Neuerungen beschreiben, Drehbuch schreiben.
2. `node tools/release-shots.cjs <Version> --plugins ../NoNotes-plugins`, Bilder ansehen.
3. `node tools/release-notes.cjs check <Version>` (läuft auch in `npm test` für alle Ordner hier und im Workflow).
4. Mit dem Code committen, Release wie im README («Release») starten. Der Workflow prüft, baut, testet und legt das Release mit
   dieser Beschreibung an; existiert es schon, ersetzt er ZIPs und Beschreibung.

Vorschau der Beschreibung, wie sie auf GitHub steht: `node tools/release-notes.cjs render <Version>`.
