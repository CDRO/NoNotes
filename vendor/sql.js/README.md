# sql.js (vendored)

- Paket: `sql.js` 1.14.2 (SQLite 3.49.1), Datei `dist/sql-asm.js`
- Quelle: https://github.com/sql-js/sql.js · https://www.npmjs.com/package/sql.js
- Lizenz: MIT (siehe `LICENSE` in diesem Ordner)

Warum die asm.js-Variante und nicht die WebAssembly-Variante?

Die App wird direkt als Datei (`file://`) im Browser geöffnet, ohne Webserver.
In diesem Kontext darf die Seite keine Nachbardateien per `fetch` laden, womit
das Nachladen einer `.wasm`-Datei scheitern würde. `sql-asm.js` ist reines
JavaScript, wird per `<script>` eingebunden und braucht nichts weiter.

Aktualisieren: neue Version von npm holen, `dist/sql-asm.js` und `LICENSE`
hier ersetzen, Versionsnummer oben anpassen, Smoke-Test laufen lassen.
