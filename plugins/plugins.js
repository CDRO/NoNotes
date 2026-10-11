/* NoNotes – Erweiterungen, die immer geladen werden.
   Normalerweise braucht es diese Datei nicht: Die Erweiterungen im Ordner plugins/ stehen im Dialog
   Datenbank → Erweiterungen… und werden dort ein- und ausgeschaltet; die Wahl merkt sich der Browser. Eigene Dateien
   legst du in diesen Ordner und gibst im Dialog ihren Namen ein («Weitere Datei laden»).

   Wer eine Erweiterung fest einbauen will (immer geladen, ohne Schalter, zum Beispiel auf einem Server für alle),
   trägt sie hier ein, relativ zu diesem Ordner und in dieser Reihenfolge; Änderungen wirken nach dem Neuladen:

     NoNotesPlugins.list([
       'beispiele/datum-einfuegen.js',   // Knopf «Datum» in der Toolleiste und Eintrag im Menü
       'beispiele/sepia.js',             // ein Design (Auswahl im Menü Datenbank)
     ]);

   Der Build (tools/build.cjs) stellt dieser Datei das Verzeichnis des Ordners voran (NoNotesPlugins.catalog([...])).

   ACHTUNG: Eine Erweiterung läuft mit allen Rechten der Seite. Sie kann alle Notizen lesen und ändern.
   Trage nur Dateien ein, denen du vertraust. Beschreibung: docs/PLUGINS.md (im Ordner der App). */
NoNotesPlugins.list([
  // 'beispiele/datum-einfuegen.js',
  // 'beispiele/sepia.js',
]);
