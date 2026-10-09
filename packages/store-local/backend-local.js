/* NoNotes – lokales Backend: SQLite im Browser (sql.js) über packages/data/db.js.
   Die Datenbank wird über getDb() geholt, weil die lokale Hülle sie austauschen kann (Datei öffnen, Import). */
(function (global) {
  'use strict';

  function create(options) {
    const DB = global.NoNotesDB;
    const C = global.NoNotesBackend;
    const getDb = options.getDb;
    const onChange = options.onChange;
    const backend = { id: 'local' };
    for (const name of C.METHODS) {
      const fn = DB[name];
      if (typeof fn !== 'function') throw new Error(`Backend-Methode ohne Entsprechung in db.js: ${name}`); // i18n-ignore
      const mutating = C.MUTATING.has(name);
      backend[name] = async (...args) => {
        const result = fn(getDb(), ...args);
        if (mutating && onChange) onChange(name);
        return name === 'titleIndex' ? [...result] : result;
      };
    }
    return backend;
  }

  global.NoNotesBackendLocal = { create };
})(window);
