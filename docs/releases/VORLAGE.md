# NoNotes vX.Y.Z – <Titel>

<!-- Vorlage für docs/releases/<Version>/RELEASE.md. Regeln: docs/releases/README.md. Kommentare wie dieser erscheinen nicht im
     Release. Jedes «TODO» ersetzen; die Prüfung (node tools/release-notes.cjs check <Version>) lässt keines stehen. -->

TODO: Kurzfassung in ein, zwei Sätzen: was das Release bringt und für wen.

## Was ist neu

### TODO: Name der Neuerung

TODO: Was ist neu, wozu ist es gut, wie benutzt man es (Menü, Taste, Schreibweise im Text). Ein Beispiel im Text hilft:

```markdown
- [ ] Angebot einholen @anna @03.11.2026
```

![TODO: was auf dem Bild zu sehen ist](TODO-bildname.png)

### TODO: Name der nächsten Neuerung

TODO: Beschreibung.

<!-- ohne Bild: nur wenn ein Screenshot nichts zeigt (Schnittstelle, Fehler im Hintergrund); dann diese Zeile mit Grund stehen lassen
     und das Bild weglassen. -->

## Update von vA.B.C

<!-- Den Standardweg anpassen: Schema, Erweiterungen, eigene Dateien, Rückweg. Was nicht zutrifft, streichen. -->

Die Notizen bleiben erhalten. TODO: Was beim ersten Öffnen mit der Datenbank geschieht (z. B. «Die App gleicht die Datenbank beim
ersten Öffnen selbst an (Schema 16 → 17) und füllt die Indexe neu; das dauert bei grossen Datenbanken ein paar Sekunden.» oder
«Die Datenbank bleibt unverändert.»).

1. **Sichern:** *Datenbank → Kopie herunterladen (.sqlite)*. Wer mit einer Datenbankdatei arbeitet, kopiert zusätzlich diese Datei.
2. **Herunterladen:** unten `NoNotes-vX.Y.Z.zip` oder `NoNotes-with-Plugins-vX.Y.Z.zip` und in einen neuen Ordner entpacken.
3. **Eigene Dateien übernehmen:** aus dem alten Ordner `plugins/plugins.js` (nur wenn dort Erweiterungen fest eingetragen sind),
   eigene Erweiterungen in `plugins/` und eigene Vorlagen in `templates/` in den neuen Ordner kopieren.
4. **Öffnen:** `index.html` im neuen Ordner im selben Browser wie bisher. Oben neben dem Namen steht jetzt vX.Y.Z. Mit Datenbankdatei
   einmal *Mit Datei verbinden*.
5. **Prüfen:** Notizen, Erweiterungen (*Datenbank → Erweiterungen…*) und Hauptfarbe sind wie vorher. Fehlen die Notizen (anderer
   Browser oder anderes Profil): *Datenbank → Aus Datei importieren…* mit der Sicherung aus Schritt 1.
6. Den alten Ordner löschen, wenn alles da ist.

**Zurück zur vorigen Version:** TODO (z. B. «Die vorige Version öffnet die angeglichene Datenbank nicht mehr und meldet «App
aktualisieren». Zurück geht es nur mit der Sicherung aus Schritt 1; Änderungen seither gehen dabei verloren.»).

**Erweiterungen:** TODO (Mindestversionen, z. B. «Farben über Tags 2.2.0 braucht NoNotes 2.11.0 oder neuer.»; sonst «Keine
Änderung.»).

**Eigene Backends und Agenten:** TODO (neue oder geänderte Methoden mit Verweis auf [BACKEND.md](../../BACKEND.md), Werkzeuge der Agenten;
sonst «Keine Änderung.»).

## Behoben

<!-- wahlweise; sonst den Abschnitt streichen -->

- TODO

## Für Entwickler

<!-- wahlweise: neue Hooks, Schnittstellen, Build; sonst den Abschnitt streichen -->

- TODO
