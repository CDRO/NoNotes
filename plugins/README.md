# Erweiterungen

Erweiterungen sind Skriptdateien in diesem Ordner. Ein- und ausgeschaltet werden sie in der App unter
*Datenbank → Erweiterungen…*; die Wahl merkt sich der Browser. Es muss keine Datei bearbeitet werden.

1. Was schon hier liegt (zum Beispiel die Beispiele in `beispiele/`), steht im Dialog unter «Verfügbar»: Schalter **Ein**.
2. Eigene Datei hier ablegen und im Dialog bei «Weitere Datei laden» ihren Namen eingeben, etwa `meine-erweiterung.js`.
3. Der Dialog zeigt, was läuft und ob es Fehler gab. Ausschalten geht dort ebenso, ohne Neuladen.

`plugins.js` braucht es nur, wenn eine Erweiterung **immer** laufen soll, ohne Schalter (zum Beispiel auf einem Server
für alle): `NoNotesPlugins.list(['meine-erweiterung.js']);`. Das Verzeichnis am Anfang dieser Datei erzeugt der Build.

**Achtung:** Eine Erweiterung läuft mit allen Rechten der Seite. Sie kann alle Notizen lesen und ändern.
Schalte nur Dateien ein, denen du vertraust. Die Datenbankdatei lädt nie Programmcode.

Die Schnittstelle (Version 1) ist in `../docs/PLUGINS.md` beschrieben und bleibt innerhalb von 1.x stabil.
