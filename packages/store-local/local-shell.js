/* NoNotes – lokale Hülle: alles, was nur die lokale Ausprägung braucht.
   Datenbank im Browser (sql.js), Browser-Speicher (IndexedDB), Datei auf der Platte (File System Access API),
   Import und Kopie herunterladen, Speichern bei jeder Änderung. Die Oberfläche spricht nur mit dem Backend;
   diese Hülle liefert es und kümmert sich um das Sichern.

   Die Oberfläche übergibt beim Anlegen ein host-Objekt mit:
     el                      die benötigten Elemente (createFileBtn, openFileBtn, disconnectBtn, downloadBtn,
                             importBtn, importInput, storageInfo, menuHint)
     setStatus(text, state)  Statuszeile        showBanner(text, actions) / hideBanner()
     closeMenu()             renderAll()        onDatabaseReplaced()  (die Oberfläche setzt ihren Zustand zurück)
   Beschreibung der Ausprägungen: docs/ARCHITECTURE.md */
(function (global) {
  'use strict';

  const DB = global.NoNotesDB;
  const Store = global.NoNotesStorage;
  const I18n = global.NoNotesI18n;
  const t = I18n.t;
  const tn = I18n.tn;
  const errorText = e => global.NoNotesBackend.errorText(e);

  const DEFAULT_FILENAME = 'NoNotes.sqlite';
  const SAVE_DELAY_MS = 600;

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function isAbort(e) { return e && e.name === 'AbortError'; }

  /** Kurzer Prüfwert eines Inhalts (FNV-1a), nur um zu merken, ob sich eine Datei verändert hat. Kein Schutz gegen Absicht. */
  function hashBytes(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + ':' + bytes.length;
  }

  const FILE_CHECK_MS = 30000; // wie oft nachgesehen wird, ob die Datei von aussen geändert wurde

  function create(host) {
    const el = host.el;
    const s = {
      SQL: null,
      db: null,
      backend: null,
      editSeq: 0,             // jede Änderung erhöht editSeq; savedSeq ist der zuletzt vollständig gesicherte Stand
      savedSeq: 0,
      saving: false,
      saveTimer: null,
      fileHandle: null,
      filePermission: null,   // 'granted' | 'prompt' | 'denied' | null
      handleRemembered: false,
      mirrorAtStart: null,    // Browser-Kopie beim Start (für den Abgleich beim Verbinden)
      fileHash: null,         // Prüfwert der Datei, wie wir sie zuletzt gelesen oder geschrieben haben
      fileStamp: null,        // { size, modified } der Datei dabei: gleich geblieben = nichts zu prüfen
      tabId: Math.random().toString(36).slice(2),
      channel: null,          // Benachrichtigung zwischen Tabs desselben Browsers
      external: null,         // 'file' | 'mirror': von aussen geändert, die Person hat noch nicht entschieden (Speichern ruht)
      editedSinceStart: false, // Inhalt könnte von der gemerkten Datei abweichen
      openedFromFile: false,
      storageKind: null,
    };

    const setStatus = (text, state) => host.setStatus(text, state);
    const timeFormat = () => new Intl.DateTimeFormat(I18n.locale(), { timeStyle: 'short' });

    // ---------- Start ----------

    /** Lädt SQLite und die Datenbank (Datei, sonst Browser-Kopie, sonst leer) und gibt das Backend zurück. */
    async function start() {
      try {
        s.SQL = await global.initSqlJs();
      } catch (e) {
        throw new Error(t('SQLite konnte nicht geladen werden.') + '\n' + (e && e.message ? e.message : e));
      }

      DB.configure({ defaultMapTitle: t('Meine Notizen') });
      s.storageKind = await Store.browserStore.detect();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

      let mirror = null;
      try { mirror = await Store.browserStore.loadDb(); }
      catch (e) { console.warn('Browser-Speicher nicht lesbar', e); }
      s.mirrorAtStart = mirror;

      if (Store.fileAccess.supported) {
        const handle = await Store.browserStore.loadHandle();
        if (handle) {
          s.fileHandle = handle;
          s.handleRemembered = true;
          try { s.filePermission = await Store.fileAccess.permission(handle, false); }
          catch (e) { s.filePermission = 'prompt'; }
          if (s.filePermission === 'granted') {
            try {
              const bytes = await Store.fileAccess.read(handle);
              s.db = DB.open(s.SQL, bytes);
              s.openedFromFile = true;
              await rememberFile(bytes);
            } catch (e) {
              console.warn('Datei nicht lesbar, verwende Browser-Kopie', e);
              s.filePermission = 'prompt';
            }
          }
        }
      }

      if (!s.openedFromFile) {
        try {
          s.db = DB.open(s.SQL, mirror);
        } catch (e) {
          console.warn('Browser-Kopie unbrauchbar, starte mit leerer Datenbank', e);
          s.db = DB.open(s.SQL, null);
        }
      }

      s.backend = global.NoNotesBackendLocal.create({
        getDb: () => s.db,
        onChange: () => { s.editedSinceStart = true; scheduleSave(); },
      });
      return s.backend;
    }

    /** Nach dem ersten Zeichnen: Anzeige der Ablage, Hinweis zum Verbinden, Startmeldung. */
    function afterReady() {
      updateStorageInfo();
      if (s.fileHandle && s.filePermission !== 'granted') showConnectBanner();
      setStatus(s.openedFromFile ? t('Aus „{name}“ geladen', { name: s.fileHandle.name })
        : s.mirrorAtStart ? t('Aus Browser-Speicher geladen ({label})', { label: Store.browserStore.label() })
        : t('Neue Datenbank'), 'saved');
      if (s.storageKind === null) {
        setStatus(t('Achtung: kein Browser-Speicher verfügbar. Bitte eine Datenbankdatei anlegen oder regelmässig eine Kopie herunterladen.'), 'error');
      }
    }

    // ---------- Speichern ----------

    function scheduleSave() {
      s.editSeq++;
      setStatus(t('Ungespeicherte Änderungen'), 'dirty');
      clearTimeout(s.saveTimer);
      s.saveTimer = setTimeout(persistNow, SAVE_DELAY_MS);
    }

    function isDirty() { return s.editSeq !== s.savedSeq; }

    async function persistNow() {
      clearTimeout(s.saveTimer);
      if (s.saving) return; // läuft bereits; am Ende wird bei Bedarf nachgezogen
      if (s.editSeq === s.savedSeq) return;
      if (s.external) return; // die Datei oder der Browser-Speicher wurde von aussen geändert: erst entscheiden lassen

      s.saving = true;
      const seq = s.editSeq;
      setStatus(t('Speichern…'), 'saving');
      let ok = true;
      let foreign = null; // Inhalt der Datei, falls sie inzwischen von jemand anderem geändert wurde
      try {
        const bytes = DB.exportBytes(s.db);
        try {
          await Store.browserStore.saveDb(bytes);
          if (s.channel) { try { s.channel.postMessage({ tab: s.tabId }); } catch (e) { /* egal */ } }
        } catch (e) {
          ok = false;
          console.warn('Browser-Speicher', e);
          setStatus(t('Browser-Speicher nicht beschreibbar: {fehler}', { fehler: errorText(e) }), 'error');
        }
        if (s.fileHandle && s.filePermission === 'granted') {
          try {
            // Kurz vor dem Schreiben noch einmal nachsehen: Wurde die Datei inzwischen von aussen geändert, nicht blind überschreiben.
            foreign = s.overwrite ? null : await foreignFileBytes();
            if (foreign) {
              ok = false;
            } else {
              await Store.fileAccess.write(s.fileHandle, bytes);
              await rememberFile(bytes);
            }
          } catch (e) {
            ok = false;
            console.warn('Dateischreiben', e);
            setStatus(t('Datei konnte nicht geschrieben werden: {fehler}', { fehler: errorText(e) }), 'error');
          }
        }
        if (ok) {
          s.savedSeq = seq;
          setStatus(t('Gespeichert {zeit}', { zeit: timeFormat().format(new Date()) }), 'saved');
        }
      } catch (e) {
        ok = false;
        console.error(e);
        setStatus(t('Speichern fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
      } finally {
        s.saving = false;
        if (ok && s.editSeq !== seq) persistNow(); // zwischenzeitlich kam Neues
      }
      if (foreign) {
        s.pendingFileBytes = foreign;
        setStatus(t('Ungespeicherte Änderungen'), 'dirty');
        await onExternalChange('file');
      }
    }

    // ---------- Datenbank austauschen ----------

    function replaceDb(newDb) {
      host.onDatabaseReplaced(); // zuerst: die Oberfläche gibt ihre Bezüge auf die alte Datenbank frei
      if (s.db) { try { s.db.close(); } catch (e) { /* egal */ } }
      s.db = newDb;
    }

    // ---------- Änderungen von aussen erkennen (nur melden, die Person entscheidet) ----------

    /** Merkt sich den Stand der Datei, den wir gerade gelesen oder geschrieben haben. */
    async function rememberFile(bytes) {
      s.fileHash = hashBytes(bytes);
      s.fileStamp = null;
      try {
        const f = await s.fileHandle.getFile();
        s.fileStamp = { size: f.size, modified: f.lastModified };
      } catch (e) { /* ohne Zeitstempel prüfen wir jedes Mal den Inhalt */ }
    }

    /** Hat jemand anders die verbundene Datei verändert? Dann ihr Inhalt, sonst null. Billig, solange Grösse und Zeitstempel gleich bleiben. */
    async function foreignFileBytes() {
      if (!s.fileHandle || s.filePermission !== 'granted' || s.fileHash == null) return null;
      try {
        const f = await s.fileHandle.getFile();
        if (s.fileStamp && f.size === s.fileStamp.size && f.lastModified === s.fileStamp.modified) return null;
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (hashBytes(bytes) === s.fileHash) { s.fileStamp = { size: f.size, modified: f.lastModified }; return null; } // nur der Zeitstempel, nicht der Inhalt
        return bytes;
      } catch (e) {
        return null; // Datei gerade nicht lesbar: beim nächsten Mal wieder
      }
    }

    async function checkFile() {
      if (s.external || s.saving) return;
      const bytes = await foreignFileBytes();
      if (!bytes || s.saving || s.external) return;
      s.pendingFileBytes = bytes;
      await onExternalChange('file');
    }

    /** Der Browser-Speicher wurde von einem anderen Tab beschrieben. */
    async function onOtherTab() {
      if (s.external) return;
      if (s.fileHandle && s.filePermission === 'granted') { await checkFile(); return; } // beide schreiben dieselbe Datei: dort nachsehen
      await onExternalChange('mirror');
    }

    async function onExternalChange(kind) {
      if (s.external) return;
      if (!isDirty()) { await loadExternal(kind, true); return; } // nichts Ungesichertes zu verlieren: still übernehmen (die Statuszeile meldet es)
      s.external = kind;
      clearTimeout(s.saveTimer);
      const name = s.fileHandle ? s.fileHandle.name : '';
      host.showBanner(
        kind === 'file'
          ? t('Die Datei „{name}“ wurde ausserhalb dieser Sitzung geändert. Gespeichert wird erst nach deiner Entscheidung.', { name })
          : t('In einem anderen Tab dieses Browsers wurde inzwischen gespeichert. Gespeichert wird erst nach deiner Entscheidung.'),
        [
          { label: kind === 'file' ? t('Datei laden (meine Änderungen verwerfen)') : t('Stand dort laden (meine Änderungen verwerfen)'), onClick: () => loadExternal(kind, false) },
          { label: kind === 'file' ? t('Meine Fassung behalten (Datei überschreiben)') : t('Meine Fassung behalten (dort überschreiben)'), primary: true, onClick: keepMine },
        ]
      );
    }

    async function loadExternal(kind, silent) {
      try {
        let bytes;
        if (kind === 'file') bytes = s.pendingFileBytes || await Store.fileAccess.read(s.fileHandle);
        else bytes = await Store.browserStore.loadDb();
        s.pendingFileBytes = null;
        if (!bytes || !bytes.length) { s.external = null; host.hideBanner(); return; }
        replaceDb(DB.open(s.SQL, bytes));
        if (kind === 'file') await rememberFile(bytes);
        s.external = null;
        s.editedSinceStart = false;
        s.savedSeq = s.editSeq;
        host.hideBanner();
        await host.renderAll();
        setStatus(kind === 'file' ? t('Datei „{name}“ neu geladen', { name: s.fileHandle.name }) : t('Aus dem anderen Tab übernommen'), 'saved');
        if (!silent && kind === 'file') { s.editSeq++; await persistNow(); } // Browser-Kopie nachführen
      } catch (e) {
        s.external = null;
        console.error(e);
        setStatus(t('Laden fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
      }
    }

    async function keepMine() {
      s.external = null;
      s.pendingFileBytes = null;
      host.hideBanner();
      s.overwrite = true; // die Person hat entschieden: diesmal nicht noch einmal nachsehen
      s.editSeq++; // eigenen Stand schreiben, der Datei bzw. dem Browser-Speicher zum Trotz
      try { await persistNow(); } finally { s.overwrite = false; }
    }

    // ---------- Datei-Anbindung ----------

    function updateStorageInfo() {
      const info = el.storageInfo;
      const label = info.querySelector('.label');
      info.classList.remove('connected', 'pending');
      const supported = Store.fileAccess.supported;

      el.createFileBtn.hidden = !supported;
      el.openFileBtn.hidden = !supported;
      el.disconnectBtn.hidden = !s.fileHandle;

      if (s.fileHandle && s.filePermission === 'granted') {
        info.classList.add('connected');
        label.textContent = s.fileHandle.name + (s.handleRemembered ? '' : ' ' + t('(nur diese Sitzung)'));
        info.title = t('Änderungen werden in diese Datei und in den Browser-Speicher geschrieben.');
      } else if (s.fileHandle) {
        info.classList.add('pending');
        label.textContent = s.fileHandle.name + ' ' + t('(nicht verbunden)');
        info.title = t('Die Datei ist gemerkt, aber noch nicht freigegeben.');
      } else {
        label.textContent = t('Nur Browser-Speicher');
        info.title = t('Daten liegen im {label} dieses Browsers.', { label: Store.browserStore.label() });
      }

      el.menuHint.textContent = supported
        ? t('Empfohlen: eine Datenbankdatei anlegen. Dann liegt alles in einer echten .sqlite-Datei, die du sichern und mitnehmen kannst.')
        : t('Dieser Browser kann nicht direkt in Dateien schreiben. Sichere regelmässig eine Kopie und importiere sie bei Bedarf.');
    }

    function showConnectBanner() {
      const name = s.fileHandle.name || DEFAULT_FILENAME;
      const denied = s.filePermission === 'denied';
      host.showBanner(
        denied
          ? t('Der Zugriff auf „{name}“ wurde verweigert. Änderungen landen vorerst nur im Browser-Speicher.', { name })
          : t('Datenbankdatei „{name}“ gemerkt. Zum Weiterarbeiten in dieser Datei einmal verbinden.', { name }),
        [
          { label: t('Mit Datei verbinden'), primary: true, onClick: connectRememberedFile },
          { label: t('Verbindung trennen'), onClick: disconnectFile },
        ]
      );
    }

    async function connectRememberedFile() {
      const handle = s.fileHandle;
      try {
        s.filePermission = await Store.fileAccess.permission(handle, true);
        if (s.filePermission !== 'granted') { showConnectBanner(); updateStorageInfo(); return; }

        const fileBytes = await Store.fileAccess.read(handle);
        const fileUnchanged = s.mirrorAtStart && Store.bytesEqual(fileBytes, s.mirrorAtStart);
        await rememberFile(fileBytes);

        if (!fileBytes.length) {
          // Leere Datei: aktueller Stand wird hineingeschrieben.
          s.editSeq++;
        } else if (!s.editedSinceStart || fileUnchanged) {
          // Nichts Eigenes verloren: Datei ist massgebend bzw. identisch, aktueller Stand gewinnt bei Änderungen.
          if (!s.editedSinceStart) replaceDb(DB.open(s.SQL, fileBytes));
          s.editSeq++;
        } else {
          const loadFile = confirm(
            t('Die Datei „{name}“ wurde ausserhalb dieser Sitzung geändert.', { name: handle.name }) + '\n\n' +
            t('OK: Datei laden und die Änderungen dieser Sitzung verwerfen.') + '\n' +
            t('Abbrechen: Datei mit dem aktuellen Stand überschreiben.')
          );
          if (loadFile) replaceDb(DB.open(s.SQL, fileBytes));
          s.editSeq++;
        }
        s.editedSinceStart = false;
        host.hideBanner();
        updateStorageInfo();
        await host.renderAll();
        await persistNow();
        setStatus(t('Mit „{name}“ verbunden', { name: handle.name }), 'saved');
      } catch (e) {
        console.error(e);
        setStatus(t('Verbinden fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
      }
    }

    async function adoptHandle(handle) {
      s.fileHandle = handle;
      s.filePermission = 'granted';
      s.editedSinceStart = false;
      s.handleRemembered = false;
      // Erst die Oberfläche und das Schreiben, dann das Merken: der Benutzer sieht sofort, was gilt.
      host.hideBanner();
      updateStorageInfo();
      await host.renderAll();
      s.editSeq++;
      const written = persistNow();
      try {
        await Store.browserStore.saveHandle(handle);
        s.handleRemembered = true;
      } catch (e) {
        console.warn('Datei-Handle kann nicht gemerkt werden', e);
      }
      updateStorageInfo();
      await written;
    }

    async function createFile() {
      host.closeMenu();
      try {
        const handle = await Store.fileAccess.pickNew(DEFAULT_FILENAME);
        const perm = await Store.fileAccess.permission(handle, true);
        if (perm !== 'granted') { setStatus(t('Kein Schreibzugriff auf die Datei'), 'error'); return; }
        await adoptHandle(handle);
        if (!isDirty()) setStatus(t('Datenbankdatei „{name}“ angelegt', { name: handle.name }), 'saved');
      } catch (e) {
        if (isAbort(e)) return;
        console.error(e);
        setStatus(t('Datei anlegen fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
      }
    }

    async function openFile() {
      host.closeMenu();
      try {
        const handle = await Store.fileAccess.pickExisting();
        const perm = await Store.fileAccess.permission(handle, true);
        if (perm !== 'granted') { setStatus(t('Kein Schreibzugriff auf die Datei'), 'error'); return; }
        const bytes = await Store.fileAccess.read(handle);
        const newDb = DB.open(s.SQL, bytes); // prüft, ob es eine NoNotes-Datei ist
        const n = DB.countNotes(s.db);
        if (n > 0 && !confirm(
          t('„{name}“ öffnen?', { name: handle.name }) + '\n\n' +
          tn('Die aktuell angezeigte Notiz wird durch den Inhalt der Datei ersetzt.', 'Die aktuell angezeigten {n} Notizen werden durch den Inhalt der Datei ersetzt.', n) + ' ' +
          t('Bei Bedarf vorher „Kopie herunterladen“.')
        )) { newDb.close(); return; }
        replaceDb(newDb);
        await adoptHandle(handle);
        if (!isDirty()) setStatus(t('„{name}“ geöffnet', { name: handle.name }), 'saved');
      } catch (e) {
        if (isAbort(e)) return;
        console.error(e);
        setStatus(t('Datei öffnen fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
      }
    }

    async function disconnectFile() {
      host.closeMenu();
      await Store.browserStore.clearHandle();
      s.fileHandle = null;
      s.filePermission = null;
      s.handleRemembered = false;
      host.hideBanner();
      updateStorageInfo();
      setStatus(t('Dateiverbindung getrennt. Daten bleiben im Browser-Speicher.'), 'saved');
    }

    function downloadCopy() {
      host.closeMenu();
      const bytes = DB.exportBytes(s.db);
      Store.download(bytes, `NoNotes-${todayStamp()}.sqlite`);
      setStatus(t('Kopie heruntergeladen'), isDirty() ? 'dirty' : 'saved');
    }

    // ---------- Import ----------

    function startImport() {
      host.closeMenu();
      el.importInput.value = '';
      el.importInput.click();
    }

    async function importFromInput() {
      const file = el.importInput.files && el.importInput.files[0];
      if (!file) return;
      try {
        const bytes = await Store.readFileInput(file);
        const newDb = DB.open(s.SQL, bytes);
        const n = DB.countNotes(s.db);
        const linked = s.fileHandle && s.filePermission === 'granted';
        if (n > 0 && !confirm(
          t('„{name}“ importieren?', { name: file.name }) + '\n\n' +
          tn('Die aktuell angezeigte Notiz wird ersetzt', 'Die aktuell angezeigten {n} Notizen werden ersetzt', n) +
          (linked ? t(', auch in der verbundenen Datei „{name}“.', { name: s.fileHandle.name }) : '.')
        )) { newDb.close(); return; }
        replaceDb(newDb);
        await host.renderAll();
        s.editSeq++;
        await persistNow();
        if (!isDirty()) setStatus(t('„{name}“ importiert', { name: file.name }), 'saved');
      } catch (e) {
        console.error(e);
        setStatus(t('Import fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
      } finally {
        el.importInput.value = '';
      }
    }

    // ---------- Anzeige für die Hilfe ----------

    /** Zeilen für «Aktueller Stand» in der Hilfe (ohne den Inhalt, den kennt das Backend). */
    function storageLines() {
      const lines = [];
      lines.push(t('Browser-Speicher: {label}', { label: Store.browserStore.label() }) + (s.mirrorAtStart ? ' ' + t('(Kopie vorhanden)') : ''));
      if (s.fileHandle && s.filePermission === 'granted') {
        lines.push(t('Datenbankdatei: „{name}“, verbunden', { name: s.fileHandle.name }) + (s.handleRemembered ? t(', wird gemerkt') : ' ' + t('(nur diese Sitzung)')));
      } else if (s.fileHandle) {
        lines.push(t('Datenbankdatei: „{name}“ gemerkt, noch nicht verbunden', { name: s.fileHandle.name }));
      } else {
        lines.push(Store.fileAccess.supported
          ? t('Datenbankdatei: keine. Empfehlung: unter Datenbank → Datenbankdatei anlegen…')
          : t('Datenbankdatei: dieser Browser kann nicht direkt in Dateien schreiben; nutze Kopie herunterladen / importieren.'));
      }
      return lines;
    }

    function saveLine() {
      return isDirty() ? t('Es gibt ungespeicherte Änderungen (werden gleich geschrieben).') : t('Alle Änderungen sind gespeichert.');
    }

    // ---------- Anschluss an die Seite ----------

    function bind() {
      el.createFileBtn.addEventListener('click', createFile);
      el.openFileBtn.addEventListener('click', openFile);
      el.disconnectBtn.addEventListener('click', disconnectFile);
      el.downloadBtn.addEventListener('click', downloadCopy);
      el.importBtn.addEventListener('click', startImport);
      el.importInput.addEventListener('change', importFromInput);
      global.addEventListener('beforeunload', e => {
        if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
      });
      document.addEventListener('visibilitychange', () => { if (document.hidden) persistNow(); });
      global.addEventListener('pagehide', () => persistNow());
      // Änderungen von aussen: beim Zurückkehren in den Tab, beim Fokus und in Abständen nachsehen; andere Tabs melden sich selbst
      document.addEventListener('visibilitychange', () => { if (!document.hidden) checkFile(); });
      global.addEventListener('focus', () => checkFile());
      setInterval(() => checkFile(), FILE_CHECK_MS);
      if (typeof global.BroadcastChannel === 'function') {
        try {
          s.channel = new global.BroadcastChannel('nonotes-mirror');
          s.channel.onmessage = e => { if (e.data && e.data.tab !== s.tabId) onOtherTab(); };
        } catch (e) { s.channel = null; }
      }
    }

    return {
      id: 'local',
      start, afterReady, bind,
      flush: persistNow,
      isDirty,
      storageLines, saveLine,
      get bytes() { return DB.exportBytes(s.db); },
    };
  }

  global.NoNotesLocalShell = { create };
})(window);
