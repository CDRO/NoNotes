/* NoNotes – Ausprägung «lokal»: alles im Browser, Datei auf dem eigenen Gerät. */
(function (global) {
  'use strict';
  global.NoNotesEdition = {
    id: 'local',
    createShell: host => global.NoNotesLocalShell.create(host),
  };
})(window);
