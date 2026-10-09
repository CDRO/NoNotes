# Erweiterungen

Erweiterungen sind Skriptdateien in diesem Ordner. Welche geladen werden, steht in `plugins.js`.

1. Datei hier ablegen (oder ein Beispiel aus `beispiele/` verwenden).
2. In `plugins.js` eintragen: `NoNotesPlugins.list(['meine-erweiterung.js']);`
3. Seite neu laden. Unter *Datenbank → Erweiterungen…* siehst du, was geladen wurde und ob es Fehler gab.

**Achtung:** Eine Erweiterung läuft mit allen Rechten der Seite. Sie kann alle Notizen lesen und ändern.
Lade nur Dateien, denen du vertraust. Die Datenbankdatei lädt nie Programmcode.

Die Schnittstelle (Version 1) ist in `../docs/PLUGINS.md` beschrieben und bleibt innerhalb von 1.x stabil.
