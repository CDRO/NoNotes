/* NoNotes – lokale Hülle: alles, was nur die lokale Ausprägung braucht.
   Datenbank im Browser (sql.js), Browser-Speicher (IndexedDB), Datei auf der Platte (File System Access API),
   Import und Kopie herunterladen, Speichern bei jeder Änderung. Die Oberfläche spricht nur mit dem Backend;
   diese Hülle liefert es und kümmert sich um das Sichern.

   Die Oberfläche übergibt beim Anlegen ein host-Objekt mit:
     el                      die benötigten Elemente (createFileBtn, openFileBtn, disconnectBtn, downloadBtn,
                             importBtn, importInput, storageInfo, menuHint, areasBtn)
     setStatus(text, state)  Statuszeile        showBanner(text, actions) / hideBanner()
     closeMenu()             renderAll()        onDatabaseReplaced()  (die Oberfläche setzt ihren Zustand zurück)
     showMenu(items, x, y, { above })          kleines Menü (Einträge wie im Kontextmenü der Mindmap)
     ensureSaved()           schreibt die offene Notiz; false, wenn die Person bei einem Konflikt erst entscheiden muss
     confirmMigration({ area, notes })  vor der Umstellung auf v3.0.0 (Termine «>» statt «@»): 'backup' (Sicherung herunterladen) oder
                             'skip'; ohne die Funktion wird die Sicherung heruntergeladen

   Bereiche (ab v2.3.0): mehrere Datenbanken, je mit eigener Browser-Kopie und eigener Datei. Bearbeitet wird immer nur der
   aktive Bereich; gewechselt wird über die Statusleiste, «Bereiche…» im Menü, Alt+1 … 9 oder die Adresse (index.html#w=<bereich>;
   ?w=<bereich> geht auch, überlebt aber keine Weiterleitung eines Webservers, der Teil nach # schon).
   Jeder Tab hat seinen eigenen aktiven Bereich; zwei Tabs mit verschiedenen Bereichen stören sich nicht.
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
  const AREA_PARAM = 'w';                     // index.html#w=<bereich> (oder ?w=<bereich>)
  const NOTE_PARAM = 'n';                     // index.html#w=<bereich>&n=42-titel: die offene Notiz (v2.7.0)
  const SESSION_AREA_KEY = 'nonotes.area';    // aktiver Bereich dieses Tabs (übersteht Neuladen)
  const MAIN = Store.MAIN_AREA;

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function isAbort(e) { return e && e.name === 'AbortError'; }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  /** Namen von Bereichen: ohne Steuerzeichen, höchstens 60 Zeichen. */
  const cleanName = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  /** Dateiname ohne Endung: «Arbeit.sqlite» → «Arbeit». */
  const baseName = name => cleanName(String(name || '').replace(/\.(sqlite3?|db)$/i, '')) || DEFAULT_FILENAME.replace(/\.sqlite$/, '');

  /** Kurzer Prüfwert eines Inhalts (FNV-1a), nur um zu merken, ob sich eine Datei verändert hat. Kein Schutz gegen Absicht. */
  function hashBytes(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + ':' + bytes.length;
  }

  const FILE_CHECK_MS = 30000; // wie oft nachgesehen wird, ob die Datei von aussen geändert wurde
  const BACKUP_EVERY_MS = 30 * 60 * 1000; // rollende Sicherung des gespeicherten Stands höchstens alle 30 Minuten (seit 4.4.0)

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
      baseSnap: null,         // Stand, den Datei bzw. Browser-Speicher zuletzt hatten (Grundlage für das Zusammenführen von aussen)
      openedFromFile: false,
      storageKind: null,
      area: null,             // { id, name } aktiver Bereich dieses Tabs
      areas: null,            // Verzeichnis { list: [{ id, name, createdAt }], last, implicit } (implicit: nur der erste, noch nicht gespeichert)
      sessionHandles: new Map(), // Bereich → Datei-Handle, das sich nicht merken liess (gilt nur in dieser Sitzung)
      missingArea: null,      // ?w=… ohne passenden Bereich: beim Start anbieten, ihn anzulegen
      baseTitle: null,        // Titel der Seite ohne Bereich
      // Seit 4.4.0 (Datenverlust verhindern)
      blocked: null,          // Stoppschirm offen: die Daten lassen sich nicht öffnen, es wird nichts gespeichert
      baseBytes: null,        // die Bytes, wie sie zuletzt gelesen oder gespeichert wurden (für Sicherungen und «Gespeicherten Stand laden»)
      backupAt: 0,            // Zeit der letzten rollenden Sicherung in diesem Bereich (0: seit dem Öffnen noch keine)
      held: false,            // Speichern angehalten: fast alle Notizen wären weg, die Person entscheidet
      allowShrink: false,     // die Person hat entschieden (oder Import, Wiederherstellen): bis zum nächsten gelungenen Speichern nicht anhalten
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

      // Bereich dieses Tabs: aus der Adresse (?w=…), sonst der zuletzt in diesem Tab gewählte, sonst der zuletzt benutzte
      s.areas = await loadAreas();
      const wanted = urlArea();
      let area = wanted != null && wanted !== '' ? Store.findArea(s.areas.list, wanted) : null;
      if (wanted && !area) s.missingArea = wanted;
      if (!area) {
        let mine = null;
        try { mine = sessionStorage.getItem(SESSION_AREA_KEY); } catch (e) { /* ohne Sitzungsspeicher: der zuletzt benutzte */ }
        area = s.areas.list.find(a => a.id === mine) || s.areas.list.find(a => a.id === s.areas.last) || s.areas.list[0];
      }
      await openArea(area, false);
      s.backend = global.NoNotesBackendLocal.create({
        getDb: () => s.db,
        onChange: () => { s.editedSinceStart = true; scheduleSave(); },
      });
      return s.backend;
    }

    /** Nach dem ersten Zeichnen: Anzeige der Ablage, Hinweis zum Verbinden, Startmeldung. */
    function afterReady() {
      s.baseTitle = document.title;
      rememberActive();
      updateStorageInfo();
      if (s.fileHandle && s.filePermission !== 'granted') showConnectBanner();
      else if (s.missingArea) showMissingAreaBanner(s.missingArea);
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
      if (s.held && s.allowShrink) { s.held = false; host.hideBanner(); } // inzwischen entschieden (Import, Wiederherstellen …)
      if (s.blocked || s.held) return; // Stoppschirm oder Halt bei Massenverlust: nichts schreiben, bis entschieden ist (seit 4.4.0)

      s.saving = true;
      const seq = s.editSeq;
      setStatus(t('Speichern…'), 'saving');
      let ok = true;
      let foreign = null; // Inhalt der Datei, falls sie inzwischen von jemand anderem geändert wurde
      let held = false;
      try {
        const snap = snapshot(s.db); // was gleich geschrieben wird; danach die Grundlage für das Zusammenführen
        // Halt bei Massenverlust (seit 4.4.0): fast alle gespeicherten Notizen wären weg
        if (!s.allowShrink && massLoss(snap)) { ok = false; held = true; }
        const bytes = ok ? DB.exportBytes(s.db) : null;
        const linked = !!(s.fileHandle && s.filePermission === 'granted');
        // Zuerst die Datei prüfen (seit 4.4.0): von aussen geändert → zusammenführen oder fragen; nicht lesbar → nichts schreiben
        if (ok && linked && !s.overwrite) {
          try {
            foreign = await foreignFileBytes(bytes);
            if (foreign) ok = false;
          } catch (e) {
            ok = false;
            console.warn('Datei vor dem Schreiben', e);
            setStatus(t('Die Datei „{name}“ ist gerade nicht lesbar; es wurde nichts gespeichert. Beim nächsten Speichern wird es wieder versucht. ({fehler})', { name: s.fileHandle.name, fehler: errorText(e) }), 'error');
          }
        }
        if (ok) {
          await rollingBackup(); // der gespeicherte Stand vor dem ersten Überschreiben nach dem Öffnen, danach alle 30 Minuten
          try {
            await Store.browserStore.saveDb(bytes, s.area.id);
            if (s.channel) { try { s.channel.postMessage({ tab: s.tabId, area: s.area.id }); } catch (e) { /* egal */ } }
          } catch (e) {
            ok = false;
            console.warn('Browser-Speicher', e);
            setStatus(t('Browser-Speicher nicht beschreibbar: {fehler}', { fehler: errorText(e) }), 'error');
          }
          if (linked) {
            try {
              // Kurz vor dem Schreiben noch einmal nachsehen: Wurde die Datei inzwischen von aussen geändert, nicht blind überschreiben.
              foreign = s.overwrite ? null : await foreignFileBytes(bytes);
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
        }
        if (ok) {
          s.savedSeq = seq;
          s.baseSnap = snap;
          s.baseBytes = bytes;
          s.allowShrink = false; // gilt nur bis zum ersten gelungenen Speichern danach
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
      if (held) { holdSave(); return; }
      if (foreign) {
        s.pendingFileBytes = foreign;
        setStatus(t('Ungespeicherte Änderungen'), 'dirty');
        await onExternalChange('file');
      }
    }

    // ---------- Halt bei Massenverlust, Sicherungen (seit 4.4.0) ----------

    /** Wären fast alle gespeicherten Notizen weg? Gespeichert sind mindestens 3, übrig blieben weniger als ein Viertel. Notizen im
     *  Papierkorb und im Archiv zählen mit; so lässt sich auch das Leeren des Papierkorbs bestätigen. */
    function massLoss(snap) {
      const stored = s.baseSnap ? s.baseSnap.notes.size : 0;
      return stored >= 3 && snap.notes.size < stored / 4;
    }

    function holdSave() {
      if (s.held) return;
      s.held = true;
      const stored = s.baseSnap ? s.baseSnap.notes.size : 0;
      const now = DB.countRecords(s.db);
      host.showBanner(
        t('Fast alle Notizen wären weg: gespeichert sind {alt}, jetzt wären es {neu}. Gespeichert wird erst nach deiner Entscheidung.', { alt: stored, neu: now }),
        [
          { label: t('Gespeicherten Stand laden'), primary: true, onClick: loadStored },
          { label: t('Trotzdem speichern'), onClick: saveAnyway },
        ],
        { danger: true });
      setStatus(t('Nicht gespeichert: bitte entscheiden (Leiste oben)'), 'dirty');
    }

    /** «Gespeicherten Stand laden»: zurück zu dem, was zuletzt gespeichert war; die Änderungen seither gehen in eine Sicherung. */
    async function loadStored() {
      await backup(DB.exportBytes(s.db), 'unsaved');
      s.held = false;
      host.hideBanner();
      replaceDb(DB.open(s.SQL, s.baseBytes && s.baseBytes.length ? s.baseBytes : null));
      s.baseSnap = snapshot(s.db);
      s.savedSeq = s.editSeq;
      await host.renderAll();
      setStatus(t('Gespeicherter Stand geladen'), 'saved');
    }

    async function saveAnyway() {
      s.held = false;
      host.hideBanner();
      s.allowShrink = true;
      s.editSeq++;
      await persistNow();
    }

    /** Ein Stand als Sicherung (rollend, je Bereich höchstens 5, ohne doppelte Inhalte). reason: opened, periodic, import, open,
     *  restore, merge, external, overwritten, unsaved, damaged. */
    async function backup(bytes, reason) {
      if (!bytes || !bytes.length || !Store.browserStore.backups || !s.area) return null;
      let notes = null;
      try {
        const d = new s.SQL.Database(bytes);
        try { notes = Number(d.exec('SELECT COUNT(*) FROM notes')[0].values[0][0]); } finally { d.close(); }
      } catch (e) { notes = null; }
      try { return await Store.browserStore.addBackup(s.area.id, bytes, { reason, notes, hash: hashBytes(bytes) }); }
      catch (e) { console.warn('Sicherung', e); return null; }
    }

    /** Vor dem Überschreiben: der gespeicherte Stand als Sicherung, beim ersten Mal nach dem Öffnen und danach alle 30 Minuten. */
    async function rollingBackup() {
      const now = Date.now();
      if (s.backupAt && now - s.backupAt < BACKUP_EVERY_MS) return;
      const first = !s.backupAt;
      s.backupAt = now;
      if (s.baseBytes && s.baseBytes.length) await backup(s.baseBytes, first ? 'opened' : 'periodic');
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

    /** Hat jemand anders die verbundene Datei verändert? Dann ihr Inhalt, sonst null. Billig, solange Grösse und Zeitstempel gleich
     *  bleiben. Seit 4.4.0: Lässt sie sich nicht lesen, wirft es (dann wird nichts geschrieben); eine Datei, die dieser Tab noch nie
     *  gelesen oder geschrieben hat, gilt als geändert, ausser sie ist leer oder gleich mit dem, was gleich geschrieben wird (mine). */
    async function foreignFileBytes(mine) {
      if (!s.fileHandle || s.filePermission !== 'granted') return null;
      const f = await s.fileHandle.getFile();
      if (s.fileHash != null && s.fileStamp && f.size === s.fileStamp.size && f.lastModified === s.fileStamp.modified) return null;
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (mine && Store.bytesEqual(bytes, mine)) return null; // steht schon so drin (etwa ein Schreiben, das trotz Fehler ankam)
      if (s.fileHash == null) return bytes.length ? bytes : null; // nie gesehen: gilt als geändert, ausser leer oder gleich
      if (hashBytes(bytes) === s.fileHash) { s.fileStamp = { size: f.size, modified: f.lastModified }; return null; } // nur der Zeitstempel, nicht der Inhalt
      return bytes;
    }

    /** Wie foreignFileBytes, aber ein Lesefehler ist kein Befund (beim nächsten Nachsehen wieder). */
    async function foreignQuiet() {
      try { return await foreignFileBytes(null); } catch (e) { return null; }
    }

    async function checkFile() {
      if (s.external || s.saving || s.blocked || s.held || s.fileHash == null) return;
      const bytes = await foreignQuiet();
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
      if (s.external || s.blocked) return;
      // Seit 4.4.0: Was von aussen kam, zuerst prüfen. Eine neuere, fremde oder beschädigte Fassung wird weder geladen noch überschrieben.
      let outside = null;
      try { outside = kind === 'file' ? (s.pendingFileBytes || await Store.fileAccess.read(s.fileHandle)) : await Store.browserStore.loadDb(s.area.id); }
      catch (e) { outside = null; }
      if (outside && outside.length) {
        const problem = DB.check(s.SQL, outside);
        if (problem) { s.pendingFileBytes = null; await stopNow(stopOf(problem, kind === 'file' ? 'file' : 'mirror', outside)); return; }
        if (kind === 'file') s.pendingFileBytes = outside;
      }
      if (!isDirty()) { await loadExternal(kind, true); return; } // nichts Ungesichertes zu verlieren: still übernehmen (die Statuszeile meldet es)
      if (await mergeExternal(kind)) return; // eigene Änderungen und fremde vertragen sich: vereint, ohne Rückfrage
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
        else bytes = await Store.browserStore.loadDb(s.area.id);
        s.pendingFileBytes = null;
        if (!bytes || !bytes.length) { s.external = null; host.hideBanner(); return; }
        await beforeMigration(bytes); // etwa von NoNotes 2.x geschrieben: vor der Umstellung fragen
        await backup(silent ? s.baseBytes : DB.exportBytes(s.db), silent ? 'external' : 'unsaved'); // der bisherige Stand (seit 4.4.0)
        replaceDb(DB.open(s.SQL, bytes));
        s.baseSnap = snapshot(s.db);
        s.baseBytes = bytes;
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
      // die fremde Fassung, die gleich überschrieben wird, zuerst als Sicherung (seit 4.4.0)
      let theirs = s.pendingFileBytes;
      if (!theirs) { try { theirs = s.external === 'file' ? await Store.fileAccess.read(s.fileHandle) : await Store.browserStore.loadDb(s.area.id); } catch (e) { theirs = null; } }
      await backup(theirs, 'overwritten');
      s.external = null;
      s.pendingFileBytes = null;
      host.hideBanner();
      s.overwrite = true; // die Person hat entschieden: diesmal nicht noch einmal nachsehen
      s.editSeq++; // eigenen Stand schreiben, der Datei bzw. dem Browser-Speicher zum Trotz
      try { await persistNow(); } finally { s.overwrite = false; }
    }

    // ---------- Änderungen von aussen zusammenführen (Notiz für Notiz) ----------

    /** Alles, was für das Zusammenführen zählt: Notizen (Titel, Text, Platz im Baum, Zustand, Tags), Bilder, Einstellungen. */
    function snapshot(db) {
      const rows = sql => {
        const r = db.exec(sql);
        if (!r.length) return [];
        const cols = r[0].columns;
        return r[0].values.map(v => { const o = {}; cols.forEach((c, i) => { o[c] = v[i]; }); return o; });
      };
      const notes = new Map();
      for (const n of rows('SELECT id, title, body, parent_id, sort_order, collapsed, deleted_at, archived_at FROM notes')) { n.tags = []; notes.set(n.id, n); }
      for (const x of rows('SELECT nt.note_id AS note_id, t.name AS name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id ORDER BY t.name COLLATE NOCASE')) { const n = notes.get(x.note_id); if (n) n.tags.push(x.name); }
      const attachments = rows('SELECT id, note_id FROM attachments').map(a => `${a.note_id}:${a.id}`).sort().join(',');
      const meta = new Map(rows('SELECT key, value FROM meta').map(m => [m.key, m.value]));
      return { notes, attachments, meta };
    }
    const samePlace = (a, b) => a.parent_id === b.parent_id && a.sort_order === b.sort_order && (a.deleted_at || null) === (b.deleted_at || null) && (a.archived_at || null) === (b.archived_at || null);
    const sameContent = (a, b) => a.title === b.title && a.body === b.body && a.tags.join('\n') === b.tags.join('\n');

    /** Vereint den fremden Stand (bytes) mit den eigenen ungesicherten Änderungen: eigene Änderungen an Titel, Text, Tags, Auf-/Zuklappen
     *  und Einstellungen werden auf den fremden Stand übertragen; hat die Gegenseite dieselbe Notiz geändert, wird zeilenweise
     *  zusammengeführt (NoNotesMerge). Gibt { db, base } zurück (die vereinte Datenbank und den fremden Stand als neue Grundlage) oder
     *  null, wenn die Person entscheiden muss: Konflikt in derselben Notiz, eigene Änderungen am Baum, an Bildern, Papierkorb oder Archiv. */
    function mergeWithExternal(bytes) {
      if (!s.baseSnap) return null;
      const base = s.baseSnap;
      const mine = snapshot(s.db);
      if (mine.attachments !== base.attachments || mine.notes.size !== base.notes.size) return null;
      const changed = [];
      for (const [id, m] of mine.notes) {
        const b = base.notes.get(id);
        if (!b || !samePlace(m, b)) return null;
        if (!sameContent(m, b) || m.collapsed !== b.collapsed) changed.push(id);
      }
      const metaChanged = [...mine.meta].filter(([k, v]) => base.meta.get(k) !== v).map(([k]) => k);
      let theirsDb;
      try { theirsDb = DB.open(s.SQL, bytes); } catch (e) { return null; }
      const theirs = snapshot(theirsDb);
      const Merge = global.NoNotesMerge;
      try {
        for (const id of changed) {
          const m = mine.notes.get(id);
          const b = base.notes.get(id);
          const th = theirs.notes.get(id);
          if (!th || th.deleted_at) throw new Error('Notiz drüben weg'); // i18n-ignore: nur intern
          if (!sameContent(m, b)) {
            let title = m.title;
            let body = m.body;
            let tags = m.tags;
            if (!sameContent(th, b)) { // beide haben dieselbe Notiz geändert
              const mt = Merge.merge3(b.title, m.title, th.title);
              const mb = Merge.merge3(b.body, m.body, th.body);
              if (!mt.clean || !mb.clean) throw new Error('Konflikt'); // i18n-ignore: nur intern
              title = mt.text;
              body = mb.text;
              const mineTags = m.tags.join('\n') !== b.tags.join('\n');
              const theirTags = th.tags.join('\n') !== b.tags.join('\n');
              if (mineTags && theirTags && m.tags.join('\n') !== th.tags.join('\n')) throw new Error('Konflikt'); // i18n-ignore: nur intern
              if (!mineTags) tags = th.tags;
            }
            if (title !== th.title || body !== th.body) DB.updateNote(theirsDb, id, title, body);
            if (tags.join('\n') !== th.tags.join('\n')) DB.setTags(theirsDb, id, tags);
          }
          if (m.collapsed !== b.collapsed) DB.setCollapsed(theirsDb, id, !!m.collapsed);
        }
        for (const k of metaChanged) {
          if (theirs.meta.get(k) !== base.meta.get(k) && theirs.meta.get(k) !== mine.meta.get(k)) throw new Error('Konflikt'); // i18n-ignore: nur intern
          DB.setMeta(theirsDb, k, mine.meta.get(k));
        }
      } catch (e) {
        try { theirsDb.close(); } catch (e2) { /* egal */ }
        return null;
      }
      return { db: theirsDb, base: theirs };
    }

    /** Versucht das Zusammenführen; true, wenn es gelungen ist (dann ist die vereinte Fassung geschrieben oder unterwegs). */
    async function mergeExternal(kind) {
      let bytes = null;
      try { bytes = kind === 'file' ? (s.pendingFileBytes || await Store.fileAccess.read(s.fileHandle)) : await Store.browserStore.loadDb(); }
      catch (e) { bytes = null; }
      if (!bytes || !bytes.length) return false;
      const merged = mergeWithExternal(bytes);
      if (!merged) { if (kind === 'file') s.pendingFileBytes = bytes; return false; }
      await backup(DB.exportBytes(s.db), 'merge'); // die eigene Fassung vor dem Zusammenführen (seit 4.4.0)
      s.pendingFileBytes = null;
      if (s.db) { try { s.db.close(); } catch (e) { /* egal */ } }
      s.db = merged.db; // ohne onDatabaseReplaced: die Oberfläche behält die offene Notiz, Bilder und Baum sind unverändert
      s.baseSnap = merged.base;
      s.baseBytes = bytes;
      if (kind === 'file') await rememberFile(bytes); // der fremde Stand ist jetzt die Grundlage; gleich kommt der vereinte darüber
      s.editSeq++;
      setStatus(kind === 'file' ? t('Änderungen aus „{name}“ mit deinen zusammengeführt', { name: s.fileHandle.name }) : t('Änderungen aus dem anderen Tab mit deinen zusammengeführt'), 'dirty');
      try { await host.renderAll(); } catch (e) { console.warn('Neu zeichnen nach dem Zusammenführen', e); }
      await persistNow();
      return true;
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

      // Mit mehreren Bereichen steht der Name des aktiven vorne
      const prefix = multiArea() ? s.area.name + ' · ' : '';
      if (s.fileHandle && s.filePermission === 'granted') {
        info.classList.add('connected');
        label.textContent = prefix + s.fileHandle.name + (s.handleRemembered ? '' : ' ' + t('(nur diese Sitzung)'));
        info.title = t('Änderungen werden in diese Datei und in den Browser-Speicher geschrieben.');
      } else if (s.fileHandle) {
        info.classList.add('pending');
        label.textContent = prefix + s.fileHandle.name + ' ' + t('(nicht verbunden)');
        info.title = t('Die Datei ist gemerkt, aber noch nicht freigegeben.');
      } else {
        label.textContent = prefix + t('Nur Browser-Speicher');
        info.title = t('Daten liegen im {label} dieses Browsers.', { label: Store.browserStore.label() });
      }
      if (areasPossible()) info.title += '\n' + t('Klicken: Bereich wechseln oder anlegen (Alt+1 … 9, Alt+0).');
      if (el.areasBtn) el.areasBtn.hidden = !areasPossible();

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
        const problem = DB.check(s.SQL, fileBytes); // seit 4.4.0: eine neuere, fremde oder beschädigte Datei weder laden noch überschreiben
        if (problem) { host.hideBanner(); await stopNow(stopOf(problem, 'file', fileBytes)); return; }
        const fileUnchanged = s.mirrorAtStart && Store.bytesEqual(fileBytes, s.mirrorAtStart);
        await rememberFile(fileBytes);

        if (!fileBytes.length) {
          // Leere Datei: aktueller Stand wird hineingeschrieben.
          s.editSeq++;
        } else if (!s.editedSinceStart || fileUnchanged) {
          // Nichts Eigenes verloren: Datei ist massgebend bzw. identisch, aktueller Stand gewinnt bei Änderungen.
          if (!s.editedSinceStart) { await beforeMigration(fileBytes); replaceDb(DB.open(s.SQL, fileBytes)); s.baseSnap = snapshot(s.db); s.baseBytes = fileBytes; }
          s.editSeq++;
        } else {
          const loadFile = confirm(
            t('Die Datei „{name}“ wurde ausserhalb dieser Sitzung geändert.', { name: handle.name }) + '\n\n' +
            t('OK: Datei laden und die Änderungen dieser Sitzung verwerfen.') + '\n' +
            t('Abbrechen: Datei mit dem aktuellen Stand überschreiben.')
          );
          await backup(loadFile ? DB.exportBytes(s.db) : fileBytes, loadFile ? 'unsaved' : 'overwritten');
          if (loadFile) { await beforeMigration(fileBytes); replaceDb(DB.open(s.SQL, fileBytes)); s.baseSnap = snapshot(s.db); s.baseBytes = fileBytes; }
          else s.allowShrink = true; // die Person hat entschieden, die Datei zu überschreiben
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

    /** bytes: der Inhalt der Datei, wie gerade gelesen (Datei öffnen); ohne: eine neue, leere Datei. */
    async function adoptHandle(handle, bytes) {
      s.fileHandle = handle;
      s.filePermission = 'granted';
      s.editedSinceStart = false;
      s.handleRemembered = false;
      if (bytes) await rememberFile(bytes); else { s.fileHash = null; s.fileStamp = null; }
      // Erst die Oberfläche und das Schreiben, dann das Merken: der Benutzer sieht sofort, was gilt.
      host.hideBanner();
      updateStorageInfo();
      await host.renderAll();
      s.editSeq++;
      const written = persistNow();
      try {
        await Store.browserStore.saveHandle(handle, s.area.id);
        s.handleRemembered = true;
        s.sessionHandles.delete(s.area.id);
      } catch (e) {
        console.warn('Datei-Handle kann nicht gemerkt werden', e);
        s.sessionHandles.set(s.area.id, handle); // wenigstens für diese Sitzung, auch nach einem Wechsel des Bereichs
      }
      updateStorageInfo();
      await written;
    }

    async function createFile() {
      host.closeMenu();
      if (s.held) { setStatus(t('Nicht gespeichert: bitte entscheiden (Leiste oben)'), 'error'); return; } // erst den Halt entscheiden
      try {
        const handle = await Store.fileAccess.pickNew(s.area.id === MAIN && !multiArea() ? DEFAULT_FILENAME : `${s.area.name}.sqlite`);
        const perm = await Store.fileAccess.permission(handle, true);
        if (perm !== 'granted') { setStatus(t('Kein Schreibzugriff auf die Datei'), 'error'); return; }
        // Eine bestehende Datei, deren Ersetzen die Person im Dialog bestätigt hat: ihr Inhalt zuerst als Sicherung (seit 4.4.0)
        let existing = null;
        try { existing = await Store.fileAccess.read(handle); } catch (e) { existing = null; }
        if (existing && existing.length) await backup(existing, 'overwritten');
        await adoptHandle(handle, existing || new Uint8Array(0));
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
        const other = await areaOfHandle(handle);
        if (other && other.id !== s.area.id) { // dieselbe Datei in zwei Bereichen schriebe doppelt: lieber dorthin wechseln
          if (confirm(t('„{datei}“ gehört zum Bereich „{name}“. Dorthin wechseln?', { datei: handle.name, name: other.name }))) await switchArea(other.id);
          return;
        }
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
        await beforeMigration(bytes); // Datei von NoNotes 2.x: vor dem Schreiben der umgestellten Fassung sichern
        await backup(DB.exportBytes(s.db), 'open'); // der bisherige Stand (seit 4.4.0)
        replaceDb(newDb);
        s.baseSnap = snapshot(s.db);
        s.baseBytes = bytes;
        s.held = false; // die geöffnete Datei ist der neue gespeicherte Stand
        await adoptHandle(handle, bytes);
        if (!isDirty()) setStatus(t('„{name}“ geöffnet', { name: handle.name }), 'saved');
      } catch (e) {
        if (isAbort(e)) return;
        console.error(e);
        setStatus(t('Datei öffnen fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
      }
    }

    async function disconnectFile() {
      host.closeMenu();
      await Store.browserStore.clearHandle(s.area.id);
      s.sessionHandles.delete(s.area.id);
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
        await backup(DB.exportBytes(s.db), 'import'); // der bisherige Stand (seit 4.4.0)
        replaceDb(newDb);
        await host.renderAll();
        s.editSeq++;
        s.allowShrink = true; // die Person hat den Import bestätigt
        await persistNow();
        if (!isDirty()) setStatus(t('„{name}“ importiert', { name: file.name }), 'saved');
      } catch (e) {
        console.error(e);
        setStatus(t('Import fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
      } finally {
        el.importInput.value = '';
      }
    }

    // ---------- Bereiche ----------

    const areasPossible = () => s.storageKind !== null; // ohne Browser-Speicher kein Verzeichnis
    const multiArea = () => !!(s.areas && s.areas.list.length > 1);

    /** Bereich aus der Adresse: zuerst #w=… (übersteht Weiterleitungen, etwa von «npx serve» auf /), sonst ?w=…. */
    function urlArea() {
      try {
        const fromHash = new URLSearchParams(String(global.location.hash || '').replace(/^#/, '')).get(AREA_PARAM);
        if (fromHash) return fromHash;
        return new URLSearchParams(global.location.search).get(AREA_PARAM);
      } catch (e) { return null; }
    }

    /** Verzeichnis aus dem Browser-Speicher; ohne Eintrag gibt es nur den ersten Bereich (wie vor v2.3.0). */
    async function loadAreas() {
      let reg = null;
      try { reg = await Store.browserStore.loadAreas(); } catch (e) { reg = null; }
      if (reg) return { list: reg.list.map(a => ({ id: a.id, name: cleanName(a.name) || a.id, createdAt: a.createdAt || null })), last: reg.last || null, implicit: false };
      return { list: [{ id: MAIN, name: t('Meine Notizen'), createdAt: null }], last: MAIN, implicit: true };
    }

    /** Name des ersten Bereichs, solange das Verzeichnis noch nicht gespeichert ist: Dateiname, sonst Titel der Mindmap. */
    function materialize(reg) {
      if (!reg.implicit) return reg;
      const first = reg.list[0];
      if (s.area && s.area.id === first.id) first.name = s.fileHandle ? baseName(s.fileHandle.name) : cleanName(DB.getMapTitle(s.db)) || first.name;
      reg.implicit = false;
      return reg;
    }

    /** Neu aus dem Speicher (ein anderer Tab hat vielleicht geändert), dann ändern und speichern. */
    async function changeAreas(fn) {
      const reg = materialize(await loadAreas());
      const out = await fn(reg);
      await Store.browserStore.saveAreas(reg);
      s.areas = reg;
      if (s.channel) { try { s.channel.postMessage({ tab: s.tabId, type: 'areas' }); } catch (e) { /* egal */ } }
      return out;
    }

    function uniqueName(name, list, exceptId) {
      const taken = new Set(list.filter(a => a.id !== exceptId).map(a => a.name.toLowerCase()));
      let n = name;
      for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${name} (${i})`;
      return n;
    }

    /** Vor der Umstellung auf v3.0.0 (Termine mit «>» statt «@»): nur wenn sie Notizen ändert, einmal fragen und auf Wunsch den alten
     *  Stand herunterladen (NoNotes-vor-3.0.0-<Bereich>.sqlite). Gibt true zurück, wenn umgestellt wird. */
    async function beforeMigration(bytes) {
      const info = bytes && DB.inspect ? DB.inspect(s.SQL, bytes) : null;
      if (!info || info.version >= DB.SCHEMA_VERSION || !info.legacyNotes) return false;
      const choice = host.confirmMigration ? await host.confirmMigration({ area: s.area.name, notes: info.legacyNotes }) : 'backup';
      if (choice !== 'skip') Store.download(bytes, `NoNotes-vor-3.0.0-${String(s.area.name || 'NoNotes').replace(/[\\/:*?"<>|]+/g, '-')}.sqlite`);
      return true;
    }

    /** Was mit Bytes, die es gibt, nicht stimmt: ein Halt für den Stoppschirm (seit 4.4.0). */
    function stopOf(problem, source, bytes) {
      const kind = problem.code === 'SCHEMA_TOO_NEW' ? 'tooNew' : problem.code === 'NOT_NONOTES_FILE' ? 'foreign' : 'damaged';
      return { kind, source, name: source === 'file' && s.fileHandle ? s.fileHandle.name : null, bytes,
        version: problem.params && problem.params.version, error: (problem.params && problem.params.message) || '' };
    }

    /** Liest einen Bereich, ohne etwas zu ändern: { db, bytes, source, migrated } oder { stop }. Seit 4.4.0 wird nie still leer
     *  gestartet, wenn es Daten gibt, die sich nicht öffnen lassen: Datei, wenn sie freigegeben ist (interactive: bei Bedarf
     *  nachfragen, braucht einen Klick), sonst die Browser-Kopie; leer nur, wenn es wirklich keine Daten gibt. */
    async function readArea(area, interactive) {
      Object.assign(s, { area: { id: area.id, name: area.name }, fileHandle: null, filePermission: null, handleRemembered: false,
        openedFromFile: false, fileHash: null, fileStamp: null, external: null, pendingFileBytes: null, editedSinceStart: false, held: false });
      let mirror = null;
      let mirrorFailed = null;
      try { mirror = await Store.browserStore.loadDb(area.id); }
      catch (e) { console.warn('Browser-Speicher nicht lesbar', e); mirrorFailed = { kind: 'read', source: 'mirror', error: errorText(e) }; }
      s.mirrorAtStart = mirror;
      let migrated = false; // auf ein neues Schema angeglichen: gleich wieder sichern, damit die Umstellung nur einmal läuft
      const opened = async (bytes, source) => {
        const problem = DB.check(s.SQL, bytes);
        if (problem) return { stop: stopOf(problem, source, bytes) };
        try {
          await beforeMigration(bytes);
          const info = {};
          const d = DB.open(s.SQL, bytes, info);
          if (info.upgradedFrom) migrated = true;
          return { db: d };
        } catch (e) {
          return { stop: stopOf(e && e.code ? e : { code: 'DAMAGED', params: { message: errorText(e) } }, source, bytes) };
        }
      };
      let db = null;
      let bytes = null;
      let source = null;
      if (Store.fileAccess.supported) {
        let handle = s.sessionHandles.get(area.id) || null;
        if (!handle) { handle = await Store.browserStore.loadHandle(area.id); s.handleRemembered = !!handle; }
        if (handle) {
          s.fileHandle = handle;
          try { s.filePermission = await Store.fileAccess.permission(handle, interactive); }
          catch (e) { s.filePermission = 'prompt'; }
          if (s.filePermission === 'granted') {
            let fileBytes;
            try { fileBytes = await Store.fileAccess.read(handle); }
            catch (e) {
              console.warn('Datei nicht lesbar', e);
              return { stop: { kind: 'read', source: 'file', name: handle.name, error: errorText(e) } };
            }
            if (fileBytes.length) {
              const r = await opened(fileBytes, 'file');
              if (r.stop) return r;
              db = r.db;
              bytes = fileBytes;
              source = 'file';
              s.openedFromFile = true;
            }
            await rememberFile(fileBytes); // eine leere Datei hat keine Daten: die Browser-Kopie gilt und kommt hinein
          }
        }
      }
      if (mirrorFailed) { if (db) db.close(); return { stop: mirrorFailed }; }
      if (mirror && mirror.length) {
        const problem = DB.check(s.SQL, mirror);
        if (db) {
          // die Datei gilt; eine Browser-Kopie, die eine neuere NoNotes-Version geschrieben hat, wird nicht überschrieben, eine
          // beschädigte zuerst gesichert
          if (problem && problem.code === 'SCHEMA_TOO_NEW') { db.close(); return { stop: stopOf(problem, 'mirror', mirror) }; }
          if (problem) await backup(mirror, 'damaged');
        } else {
          const r = await opened(mirror, 'mirror');
          if (r.stop) return r;
          db = r.db;
          bytes = mirror;
          source = 'mirror';
        }
      }
      if (!db) {
        // eine gemerkte Datei ohne Freigabe und keine Browser-Kopie: ihre Daten dürfen nicht durch eine leere Datenbank ersetzt werden
        if (s.fileHandle && s.filePermission !== 'granted') return { stop: { kind: 'permission', source: 'file', name: s.fileHandle.name, denied: s.filePermission === 'denied' } };
        db = DB.open(s.SQL, null);
      }
      return { db, bytes, source, migrated };
    }

    /** Lädt einen Bereich (interactive: Freigabe der Datei bei Bedarf erfragen). Lassen sich seine Daten nicht öffnen, steht der
     *  Stoppschirm, bis die Person «Erneut versuchen» oder einen anderen Bereich wählt; gespeichert wird so lange nichts. */
    async function openArea(area, interactive) {
      let target = area;
      let ask = interactive;
      for (;;) {
        const r = await readArea(target, ask);
        if (!r.stop) { await install(r); return; }
        const choice = await stopScreen(r.stop);
        ask = true; // «Erneut versuchen» und die Wahl eines Bereichs sind Klicks: die Freigabe darf gefragt werden
        if (choice.area) target = choice.area;
      }
    }

    async function install(r) {
      if (s.db) replaceDb(r.db); else s.db = r.db;
      if (s.blocked) { s.blocked = null; if (host.hideStop) host.hideStop(); }
      s.baseSnap = snapshot(s.db);
      s.baseBytes = r.bytes && r.bytes.length ? r.bytes : null;
      s.backupAt = 0;
      s.savedSeq = s.editSeq;
      if (r.migrated) { // die umgestellte Fassung gleich sichern, damit die Umstellung (und die Frage davor) nur einmal kommt
        s.editSeq++;
        try { await persistNow(); } catch (e) { console.warn('Speichern nach der Umstellung', e); scheduleSave(); }
      }
    }

    // ---------- Stoppschirm (seit 4.4.0) ----------

    function stopTexts(stop) {
      const version = global.NONOTES_VERSION || 'dev';
      const lines = [];
      if (stop.kind === 'tooNew') {
        lines.push(t('Diese Daten wurden mit einer neueren NoNotes-Version gespeichert (Schema {n}); diese App ist {version} (Schema {m}). Bitte die neuere Version verwenden. Es wurde nichts verändert.', { n: stop.version, version, m: DB.SCHEMA_VERSION }));
      } else if (stop.kind === 'foreign') {
        lines.push(t('Diese Daten sind keine NoNotes-Datenbank. Es wurde nichts verändert.'));
      } else if (stop.kind === 'damaged') {
        lines.push(t('Diese Daten lassen sich nicht öffnen: sie sind beschädigt oder unvollständig. Es wurde nichts verändert. Bitte erneut versuchen; hilft das nicht, eine Sicherung verwenden.'));
      } else if (stop.kind === 'read') {
        lines.push(t('Diese Daten konnten nicht gelesen werden, zum Beispiel weil das Netzlaufwerk gerade nicht erreichbar ist. Es wurde nichts verändert. Bitte erneut versuchen.'));
      } else if (stop.kind === 'permission') {
        lines.push(stop.denied ? t('Der Zugriff auf die Datei „{name}“ wurde verweigert. Ohne Zugriff wird nichts angezeigt und nichts gespeichert.', { name: stop.name })
          : t('Die Daten liegen in der Datei „{name}“. Zum Öffnen einmal mit der Datei verbinden; bis dahin wird nichts angezeigt und nichts gespeichert.', { name: stop.name }));
      }
      if (stop.kind !== 'permission') {
        lines.push(stop.source === 'file' ? t('Betroffen: die Datei „{name}“.', { name: stop.name || '' }) : t('Betroffen: die Kopie im Browser-Speicher.'));
      }
      if (multiArea()) lines.push(t('Bereich: „{name}“', { name: s.area.name }));
      if (stop.error && stop.kind !== 'tooNew') lines.push(t('Meldung: {fehler}', { fehler: stop.error }));
      const title = stop.kind === 'tooNew' ? t('Neuere Daten: bitte die neuere NoNotes-Version verwenden')
        : stop.kind === 'read' ? t('Daten konnten nicht gelesen werden')
          : stop.kind === 'permission' ? t('Mit der Datei verbinden')
            : t('Daten lassen sich nicht öffnen');
      return { title, lines };
    }

    /** Zeigt den Stoppschirm und löst auf mit der Wahl der Person: { retry } oder { area }. Solange er steht, wird nichts gespeichert
     *  (s.blocked) und die Seite dahinter ist gesperrt. */
    function stopScreen(stop) {
      s.blocked = stop;
      clearTimeout(s.saveTimer);
      const { title, lines } = stopTexts(stop);
      if (!host.showStop) return Promise.reject(new Error(title + '\n' + lines.join('\n')));
      return new Promise(resolve => {
        const actions = [];
        if (stop.kind === 'permission') {
          actions.push({ label: t('Mit Datei verbinden'), primary: true, action: () => resolve({ retry: true }) });
          actions.push({ label: t('Dateiverbindung trennen'), action: async () => {
            await Store.browserStore.clearHandle(s.area.id);
            s.sessionHandles.delete(s.area.id);
            resolve({ retry: true });
          } });
        } else {
          actions.push({ label: t('Erneut versuchen'), primary: stop.kind !== 'tooNew', action: () => resolve({ retry: true }) });
        }
        for (const a of (s.areas ? s.areas.list : []).filter(x => x.id !== s.area.id).slice(0, 9)) {
          actions.push({ label: t('Bereich „{name}“ öffnen', { name: a.name }), action: () => resolve({ area: a }) });
        }
        if (stop.bytes && stop.bytes.length) {
          actions.push({ label: t('Daten unverändert herunterladen'), action: () => Store.download(stop.bytes, `NoNotes-${s.area.id}-${todayStamp()}.sqlite`) });
        }
        if (Store.browserStore.backups && host.openBackups) actions.push({ label: t('Sicherungen…'), action: () => host.openBackups({ restore: false }) });
        host.showStop({ kind: stop.kind, title, lines, actions });
      });
    }

    /** Ein Halt mitten in der Sitzung (die Datei oder die Browser-Kopie wurde von aussen unbrauchbar): die ungespeicherten Änderungen
     *  dieser Sitzung zuerst sichern, dann den Stoppschirm; danach den gewählten Bereich neu lesen. */
    async function stopNow(stop) {
      if (s.blocked) return;
      clearTimeout(s.saveTimer);
      if (isDirty()) await backup(DB.exportBytes(s.db), 'unsaved');
      const choice = await stopScreen(stop);
      await enterArea(choice.area || s.area);
    }

    /** Vor dem Wechsel: alles Ungesicherte schreiben. false, wenn die Person lieber bleibt. */
    async function leaveCurrent() {
      if (s.blocked) return true; // Stoppschirm: es gibt nichts Gespeichertes zu verlieren
      if (host.ensureSaved && !(await host.ensureSaved())) return false; // zuerst die offene Notiz (Konflikt: die Person entscheidet)
      if (s.external) { setStatus(t('Bitte zuerst entscheiden, welche Fassung gilt (Leiste oben).'), 'error'); return false; }
      clearTimeout(s.saveTimer);
      for (let tries = 0, waited = 0; tries < 3 && waited < 400;) {
        if (s.saving) { waited++; await sleep(25); continue; }
        if (!isDirty() || s.external) break;
        tries++;
        await persistNow();
      }
      if (isDirty()) {
        if (!confirm(t('Die Änderungen in „{name}“ konnten nicht gespeichert werden. Trotzdem wechseln? Sie gehen dann verloren.', { name: s.area.name }))) return false;
        await backup(DB.exportBytes(s.db), 'unsaved'); // wenigstens als Sicherung (seit 4.4.0)
      }
      return true;
    }

    /** Merkt den aktiven Bereich (Tab, Verzeichnis, Adresse, Titel der Seite). */
    function rememberActive() {
      try { sessionStorage.setItem(SESSION_AREA_KEY, s.area.id); } catch (e) { /* egal */ }
      if (s.areas.last !== s.area.id) {
        s.areas.last = s.area.id;
        if (!s.areas.implicit) Store.browserStore.saveAreas(s.areas).catch(() => {});
      }
      // Mit laufender Navigation schreibt der Kern die Adresse (Bereich und offene Notiz, routes.href unten)
      if (host.replaceNav && host.replaceNav()) { if (s.baseTitle != null) document.title = multiArea() ? `${s.area.name} – ${s.baseTitle}` : s.baseTitle; return; }
      try {
        // In der Adresse steht der Bereich als #w=<kennung>; ein ?w=… von aussen wird dabei umgeschrieben
        const u = new URL(global.location.href);
        const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
        const inQuery = u.searchParams.has(AREA_PARAM);
        if (multiArea() || inQuery || hash.has(AREA_PARAM)) {
          if (inQuery || hash.get(AREA_PARAM) !== s.area.id) {
            u.searchParams.delete(AREA_PARAM);
            hash.set(AREA_PARAM, s.area.id);
            u.hash = hash.toString();
            global.history.replaceState(global.history.state, '', u.href);
          }
        }
      } catch (e) { /* Adresse lässt sich hier nicht ändern (manche Browser bei file://) */ }
      if (s.baseTitle != null) document.title = multiArea() ? `${s.area.name} – ${s.baseTitle}` : s.baseTitle;
    }

    /** Wechselt in einen Bereich, der schon im Verzeichnis steht. init(db) läuft vor dem Zeichnen (z. B. Titel der Mindmap). */
    async function enterArea(area, init) {
      host.hideBanner();
      await openArea(area, true);
      if (init) await init();
      rememberActive();
      updateStorageInfo();
      await host.renderAll();
      if (s.fileHandle && s.filePermission !== 'granted') showConnectBanner();
      setStatus(s.openedFromFile ? t('Bereich „{name}“: aus „{datei}“ geladen', { name: s.area.name, datei: s.fileHandle.name })
        : t('Bereich „{name}“', { name: s.area.name }), isDirty() ? 'dirty' : 'saved');
    }

    async function switchArea(id) {
      host.closeMenu();
      const area = s.areas.list.find(a => a.id === id);
      if (!area || area.id === s.area.id) return false;
      if (!(await leaveCurrent())) return false;
      await enterArea(area);
      return true;
    }

    /** Legt einen Bereich an und wechselt hinein; die Mindmap trägt seinen Namen. */
    async function createAreaNamed(rawName) {
      const name = cleanName(rawName);
      if (!name) return false;
      if (!(await leaveCurrent())) return false;
      const area = await changeAreas(reg => {
        const a = { id: Store.newAreaId(name, reg.list), name: uniqueName(name, reg.list), createdAt: new Date().toISOString() };
        reg.list.push(a);
        return a;
      });
      await enterArea(area, async () => { await s.backend.setMapTitle(area.name); });
      if (Store.fileAccess.supported) {
        host.showBanner(t('Neuer Bereich „{name}“. Empfohlen: eine eigene Datenbankdatei, damit die Notizen nicht nur im Browser liegen.', { name: area.name }), [
          { label: t('Datenbankdatei anlegen…'), primary: true, onClick: createFile },
          { label: t('Später'), onClick: () => host.hideBanner() },
        ]);
      }
      return true;
    }

    async function newArea() {
      host.closeMenu();
      const name = cleanName(global.prompt(t('Name des neuen Bereichs:'), ''));
      if (!name) return;
      try { await createAreaNamed(name); }
      catch (e) { console.error(e); setStatus(t('Bereich anlegen fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error'); }
    }

    /** Bereich, zu dem eine Datei schon gehört (gleiche Datei auf der Platte), oder null. */
    async function areaOfHandle(handle) {
      if (!handle || typeof handle.isSameEntry !== 'function') return null;
      for (const a of s.areas.list) {
        let h = a.id === s.area.id ? s.fileHandle : s.sessionHandles.get(a.id);
        if (!h) h = await Store.browserStore.loadHandle(a.id);
        try { if (h && await h.isSameEntry(handle)) return a; } catch (e) { /* nicht vergleichbar */ }
      }
      return null;
    }

    /** Eine vorhandene Datei als weiteren Bereich öffnen (oder in ihren Bereich wechseln, wenn sie schon einen hat). */
    async function openFileAsArea() {
      host.closeMenu();
      try {
        const handle = await Store.fileAccess.pickExisting();
        const existing = await areaOfHandle(handle);
        if (existing) {
          if (existing.id !== s.area.id) await switchArea(existing.id);
          else setStatus(t('„{datei}“ ist schon offen.', { datei: handle.name }), 'saved');
          return;
        }
        const perm = await Store.fileAccess.permission(handle, true);
        if (perm !== 'granted') { setStatus(t('Kein Schreibzugriff auf die Datei'), 'error'); return; }
        const bytes = await Store.fileAccess.read(handle);
        DB.open(s.SQL, bytes).close(); // prüft, ob es eine NoNotes-Datei ist
        if (!(await leaveCurrent())) return;
        const area = await changeAreas(reg => {
          const name = uniqueName(baseName(handle.name), reg.list);
          const a = { id: Store.newAreaId(name, reg.list), name, createdAt: new Date().toISOString() };
          reg.list.push(a);
          return a;
        });
        try { await Store.browserStore.saveDb(bytes, area.id); } catch (e) { /* die Datei gilt; die Browser-Kopie folgt beim Speichern */ }
        try { await Store.browserStore.saveHandle(handle, area.id); }
        catch (e) { s.sessionHandles.set(area.id, handle); }
        await enterArea(area);
      } catch (e) {
        if (isAbort(e)) return;
        console.error(e);
        setStatus(t('Datei öffnen fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
      }
    }

    async function renameArea() {
      host.closeMenu();
      const current = materialize(Object.assign({}, s.areas, { list: s.areas.list.map(a => Object.assign({}, a)) })).list.find(a => a.id === s.area.id);
      const name = cleanName(global.prompt(t('Neuer Name für den Bereich „{name}“:', { name: current.name }), current.name));
      if (!name) return;
      try {
        const final = await changeAreas(reg => {
          const a = reg.list.find(x => x.id === s.area.id);
          if (!a) return null;
          a.name = uniqueName(name, reg.list, a.id);
          return a.name;
        });
        if (!final) return;
        s.area.name = final;
        rememberActive();
        updateStorageInfo();
        setStatus(t('Der Bereich heisst jetzt „{name}“.', { name: final }), isDirty() ? 'dirty' : 'saved');
      } catch (e) { console.error(e); setStatus(t('Umbenennen fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error'); }
    }

    /** Entfernt den aktiven Bereich aus der Liste und löscht seine Browser-Kopie; die Datei auf der Platte bleibt. */
    async function removeArea() {
      host.closeMenu();
      if (!multiArea()) return;
      const file = s.fileHandle ? s.fileHandle.name : null;
      if (!confirm(t('Bereich „{name}“ aus der Liste entfernen?', { name: s.area.name }) + '\n\n' + (file
        ? t('Die Kopie im Browser wird gelöscht. Die Datei „{datei}“ bleibt auf der Platte und lässt sich später wieder als Bereich öffnen.', { datei: file })
        : t('Die Notizen dieses Bereichs liegen nur im Browser-Speicher und werden gelöscht. Vorher «Kopie herunterladen», wenn du sie behalten willst.')))) return;
      const gone = s.area.id;
      try {
        clearTimeout(s.saveTimer);
        s.savedSeq = s.editSeq; // nichts mehr schreiben: der Bereich verschwindet
        const next = await changeAreas(reg => {
          reg.list = reg.list.filter(a => a.id !== gone);
          reg.last = reg.list[0].id;
          return reg.list[0];
        });
        await Store.browserStore.removeArea(gone);
        s.sessionHandles.delete(gone);
        await enterArea(next);
      } catch (e) { console.error(e); setStatus(t('Entfernen fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error'); }
    }

    /** Ein anderer Tab hat Bereiche angelegt, umbenannt oder entfernt. */
    async function onAreasChanged() {
      const reg = await loadAreas();
      const mine = reg.list.find(a => a.id === s.area.id);
      s.areas = reg;
      if (mine) {
        s.area.name = mine.name;
        rememberActive();
        updateStorageInfo();
        return;
      }
      // der eigene Bereich ist weg: nichts mehr dorthin schreiben, in den ersten wechseln
      const name = s.area.name;
      clearTimeout(s.saveTimer);
      s.savedSeq = s.editSeq;
      await enterArea(reg.list[0]);
      setStatus(t('Der Bereich „{name}“ wurde in einem anderen Tab entfernt.', { name }), 'error');
    }

    function showMissingAreaBanner(value) {
      const name = cleanName(value);
      host.showBanner(t('Den Bereich „{name}“ gibt es in diesem Browser nicht. Geöffnet ist „{aktiv}“.', { name, aktiv: s.area.name }), [
        { label: t('Bereich „{name}“ anlegen', { name }), primary: true, onClick: () => { host.hideBanner(); createAreaNamed(name); } },
        { label: t('Schliessen'), onClick: () => host.hideBanner() },
      ]);
    }

    // ---------- Adressen von Notizen (v2.7.0): «index.html#w=arbeit&n=42-sitzungsprotokoll» ----------
    // Der Bereich steht in der Adresse, sobald es mehrere gibt (oder er schon drinsteht); die Notiz mit Nummer und lesbarem Titel.
    // Ein Link gilt nur in diesem Browser auf diesem Rechner: dort liegen die Daten.
    const R = global.NoNotesRoutes;
    const routes = {
      current() {
        const h = R.hashParams(new URL(global.location.href));
        return { area: urlArea(), note: R.noteOf(h.get(NOTE_PARAM)) };
      },
      href({ note, title }) {
        const u = new URL(global.location.href);
        const h = R.hashParams(u);
        const withArea = multiArea() || h.has(AREA_PARAM) || u.searchParams.has(AREA_PARAM);
        u.searchParams.delete(AREA_PARAM);
        const out = new URLSearchParams();
        if (withArea && s.area) out.set(AREA_PARAM, s.area.id);
        for (const [k, v] of h) if (k !== AREA_PARAM && k !== NOTE_PARAM) out.set(k, v); // andere Teile bleiben
        if (note != null) out.set(NOTE_PARAM, R.segment(note, title));
        u.hash = out.toString();
        return u.href;
      },
      parse(url) {
        let u;
        try { u = new URL(url, global.location.href); } catch (e) { return null; }
        if (!R.samePage(u, new URL(global.location.href))) return null;
        const h = R.hashParams(u);
        const note = R.noteOf(h.get(NOTE_PARAM));
        const area = h.get(AREA_PARAM) || u.searchParams.get(AREA_PARAM) || null;
        if (note == null) return area ? { note: null, area } : null; // nur der Bereich (Link am Knoten, v3.2.0)
        return { note, area };
      },
      /** Gehört das Ziel zum offenen Bereich? */
      isHere(target) {
        if (!target.area || !s.area) return true;
        const a = s.areas ? Store.findArea(s.areas.list, target.area) : null;
        return !!a && a.id === s.area.id;
      },
      /** In den Bereich des Ziels wechseln; fehlt er in diesem Browser, ein Hinweis und false. */
      async enter(target) {
        if (!target || !target.area || !s.areas || !s.area) return true;
        const a = Store.findArea(s.areas.list, target.area);
        if (!a) { showMissingAreaBanner(target.area); return false; }
        if (a.id === s.area.id) return true;
        return switchArea(a.id);
      },
    };

    /** Adresse einer Notiz (note null: nur der Bereich) in einem beliebigen Bereich dieses Browsers. */
    function areaHref(areaId, note, title) {
      const u = new URL(global.location.href);
      u.search = '';
      const h = new URLSearchParams();
      h.set(AREA_PARAM, areaId);
      if (note != null) h.set(NOTE_PARAM, R.segment(note, title));
      u.hash = h.toString();
      return u.href;
    }

    /** Knoten in einen neuen Bereich auslösen (v3.2.0): legt den Bereich an (Name und Wurzel wie angegeben), zieht die Unternotizen
     *  samt Tags, Bildern und Verlauf dorthin um (Hauptäste), legt sie hier in den Papierkorb und hinterlegt am Knoten den Link auf den
     *  neuen Bereich. Querverweise und Links auf Notizen werden in beiden Bereichen umgeschrieben (NoNotesMove). Bleibt im aktiven
     *  Bereich. Ergebnis: { area: { id, name, url }, moved } oder null (abgebrochen). */
    async function detachToArea({ noteId, name: rawName }) {
      const Move = global.NoNotesMove;
      const name = cleanName(rawName);
      if (!name || !Move) return null;
      if (host.ensureSaved && !(await host.ensureSaved())) return null;
      if (s.external) { setStatus(t('Bitte zuerst entscheiden, welche Fassung gilt (Leiste oben).'), 'error'); return null; }
      const pkg = DB.exportSubtree(s.db, noteId);
      const area = await changeAreas(reg => {
        const a = { id: Store.newAreaId(name, reg.list), name: uniqueName(name, reg.list), createdAt: new Date().toISOString() };
        reg.list.push(a);
        return a;
      });
      const sourceId = s.area.id;
      const resolve = global.NoNotesLinks.resolver(pkg.titles);
      const parse = url => {
        const target = routes.parse(url);
        if (!target) return null;
        return { note: target.note, area: target.area && !routes.isHere(target) ? target.area : null };
      };
      const opts = maps => ({
        notes: maps.notes, atts: maps.atts, resolve, parse,
        source: (id, label) => areaHref(sourceId, id, label), target: (id, label) => areaHref(area.id, id, label),
      });
      const target = DB.open(s.SQL, null);
      let bytes;
      let notes;
      try {
        DB.setMapTitle(target, area.name);
        const res = DB.importSubtree(target, pkg, (kind, v, maps) => (kind === 'body' ? Move.rewriteMoved(v, opts(maps)) : Move.rewriteLink(v, opts(maps), true)));
        notes = new Map(res.notes);
        bytes = DB.exportBytes(target);
      } finally { target.close(); }
      await Store.browserStore.saveDb(bytes, area.id);
      const o = opts({ notes, atts: new Map() });
      DB.finishDetach(s.db, noteId, pkg, areaHref(area.id, null),
        (kind, v) => (kind === 'body' ? Move.rewriteStaying(v, o) : Move.rewriteLink(v, o, false)));
      s.editedSinceStart = true;
      scheduleSave();
      await persistNow();
      updateStorageInfo();
      return { area: { id: area.id, name: area.name, url: areaHref(area.id, null) }, moved: pkg.notes.length };
    }

    /** Adresse, die genau diesen Bereich öffnet (für Lesezeichen und Verknüpfungen auf dem Desktop). */
    function areaUrl() {
      const u = new URL(global.location.href); // genau der Pfad, unter dem die App gerade läuft (index.html oder /)
      u.search = '';
      u.hash = `${AREA_PARAM}=${encodeURIComponent(s.area.id)}`;
      return u.href;
    }

    /** Kopiert die Adresse des aktiven Bereichs; verweigert der Browser die Zwischenablage, steht sie markiert in einem Fenster. */
    async function copyAreaUrl() {
      host.closeMenu();
      const url = areaUrl();
      try {
        await global.navigator.clipboard.writeText(url);
        setStatus(t('Adresse von „{name}“ kopiert', { name: s.area.name }), isDirty() ? 'dirty' : 'saved');
      } catch (e) {
        global.prompt(t('Adresse des Bereichs „{name}“ (mit Ctrl+C kopieren):', { name: s.area.name }), url);
      }
    }

    /** Kleine HTML-Datei, die im Browser genau diesen Bereich öffnet. Windows wirft bei Verknüpfungen auf file://-Adressen
     *  den Teil nach ? und # weg; eine eigene Datei braucht keinen solchen Teil, die Weiterleitung geschieht im Browser. */
    function startFileHtml(url, name) {
      const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const js = JSON.stringify(url).replace(/</g, '\\u003c');
      return `<!doctype html>
<html lang="${esc(I18n.language())}">
<head>
<meta charset="utf-8">
<title>${esc(name)} – NoNotes</title>
<meta http-equiv="refresh" content="0; url=${esc(url)}">
<script>location.replace(${js});</script>
</head>
<body>
<p>${esc(t('NoNotes öffnet den Bereich „{name}“.', { name }))} <a href="${esc(url)}">${esc(t('Falls nichts geschieht: hier klicken.'))}</a></p>
<p>${esc(t('Diese Datei wurde von NoNotes angelegt. Wird der Ordner der App verschoben, eine neue anlegen.'))}</p>
</body>
</html>
`;
    }

    /** Speichert die Startdatei des aktiven Bereichs, am liebsten direkt auf den Desktop; sonst als Download. */
    async function saveStartFile() {
      host.closeMenu();
      const name = s.area.name;
      const fileName = `NoNotes ${name}`.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) + '.html';
      const bytes = new TextEncoder().encode(startFileHtml(areaUrl(), name));
      const done = isDirty() ? 'dirty' : 'saved';
      if (Store.fileAccess.supported) {
        try {
          const handle = await Store.fileAccess.pickNew(fileName, [{ description: t('Startdatei (HTML)'), accept: { 'text/html': ['.html'] } }], 'desktop');
          await Store.fileAccess.write(handle, bytes);
          setStatus(t('Startdatei „{datei}“ gespeichert. Ein Doppelklick öffnet den Bereich „{name}“.', { datei: handle.name, name }), done);
          return;
        } catch (e) {
          if (isAbort(e)) return;
          console.warn('Startdatei: Speichern im Dialog ging nicht, lade herunter', e);
        }
      }
      Store.download(bytes, fileName, 'text/html');
      setStatus(t('Startdatei „{datei}“ heruntergeladen. Auf den Desktop verschieben; ein Doppelklick öffnet den Bereich „{name}“.', { datei: fileName, name }), done);
    }

    /** Menü der Bereiche, über der Statusleiste. */
    function showAreaMenu() {
      if (!areasPossible()) return;
      host.closeMenu();
      const items = s.areas.list.map((a, i) => ({ label: a.name, key: i < 9 ? `Alt+${i + 1}` : '', checked: a.id === s.area.id, action: () => switchArea(a.id) }));
      items.push('sep', { label: t('Neuer Bereich…'), key: 'Alt+0', action: newArea });
      if (Store.fileAccess.supported) items.push({ label: t('Datei als Bereich öffnen…'), action: openFileAsArea });
      items.push({ label: t('Bereich umbenennen…'), action: renameArea });
      items.push({ label: t('Adresse kopieren'), action: copyAreaUrl });
      items.push({ label: t('Startdatei für den Desktop…'), action: saveStartFile });
      if (multiArea()) items.push({ label: t('Bereich entfernen…'), danger: true, action: removeArea });
      const r = el.storageInfo.getBoundingClientRect();
      host.showMenu(items, Math.max(8, r.left), r.top, { above: true });
    }

    // ---------- Anzeige für die Hilfe ----------

    /** Zeilen für «Aktueller Stand» in der Hilfe (ohne den Inhalt, den kennt das Backend). */
    function storageLines() {
      const lines = [];
      if (multiArea()) lines.push(t('Bereich: „{name}“ (einer von {n}; Adresse: index.html#w={id})', { name: s.area.name, n: s.areas.list.length, id: s.area.id }));
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
      if (areasPossible()) {
        const info = el.storageInfo;
        info.classList.add('clickable');
        info.setAttribute('role', 'button');
        info.tabIndex = 0;
        info.addEventListener('click', e => { e.stopPropagation(); showAreaMenu(); }); // sonst schliesst der Klick das Menü gleich wieder
        info.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showAreaMenu(); } });
        if (el.areasBtn) el.areasBtn.addEventListener('click', e => { e.stopPropagation(); showAreaMenu(); });
        // Alt+1 … 9: Bereich nach seiner Stelle in der Liste; Alt+0: Menü der Bereiche (unabhängig vom Tastaturlayout über e.code)
        document.addEventListener('keydown', e => {
          if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
          if (!m) return;
          if (m[1] === '0') { e.preventDefault(); showAreaMenu(); return; }
          const target = s.areas.list[Number(m[1]) - 1];
          if (!target || !multiArea()) return;
          e.preventDefault();
          switchArea(target.id);
        });
      }
      // #w=… von Hand in der Adressleiste geändert: der Kern meldet es über routes.enter (Zurück, Vor, Adresse, Links; v2.7.0)
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
          s.channel.onmessage = e => {
            const d = e.data;
            if (!d || d.tab === s.tabId) return;
            if (d.type === 'areas') { onAreasChanged().catch(err => console.warn('Bereiche', err)); return; }
            if ((d.area || MAIN) === s.area.id) onOtherTab(); // andere Bereiche gehen diesen Tab nichts an
          };
        } catch (e) { s.channel = null; }
      }
    }

    // Vorlagen: ein Ordner (templates/) für alle Bereiche, siehe templates-local.js
    const templates = global.NoNotesTemplatesLocal ? global.NoNotesTemplatesLocal.create({ areaName: () => (s.area ? s.area.name : '') }) : null;

    // ---------- Sicherungen für die Oberfläche (seit 4.4.0) ----------

    const backupStamp = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; };
    const backups = {
      get supported() { return !!Store.browserStore.backups; },
      /** Die Sicherungen des aktiven Bereichs, die neueste zuerst: [{ id, at, reason, size, notes }]. */
      list: () => (s.area ? Store.browserStore.listBackups(s.area.id) : Promise.resolve([])),
      async download(id) {
        const list = await Store.browserStore.listBackups(s.area.id);
        const entry = list.find(b => b.id === id);
        const bytes = entry ? await Store.browserStore.loadBackup(s.area.id, id) : null;
        if (!bytes) throw new Error(t('Diese Sicherung gibt es nicht mehr.'));
        Store.download(bytes, `NoNotes-${s.area.id}-${backupStamp(entry.at)}.sqlite`);
      },
      /** Macht eine Sicherung zum aktuellen Stand (der bisherige wird vorher selbst gesichert) und speichert ihn. */
      async restore(id) {
        if (s.blocked) throw new Error(t('Erst den Bereich öffnen, dann wiederherstellen.'));
        const bytes = await Store.browserStore.loadBackup(s.area.id, id);
        if (!bytes) throw new Error(t('Diese Sicherung gibt es nicht mehr.'));
        const problem = DB.check(s.SQL, bytes);
        if (problem) throw Object.assign(new Error(t('Diese Sicherung lässt sich nicht öffnen.')), { code: problem.code });
        await backup(DB.exportBytes(s.db), 'restore');
        replaceDb(DB.open(s.SQL, bytes));
        await host.renderAll();
        s.editSeq++;
        s.allowShrink = true;
        await persistNow();
      },
    };

    return {
      id: 'local',
      start, afterReady, bind,
      backups,
      /** Steht der Stoppschirm? Seine Art ('tooNew', 'damaged', 'foreign', 'read', 'permission') oder null (für Tests). */
      stopKind: () => (s.blocked ? s.blocked.kind : null),
      /** Ist das Speichern angehalten (Massenverlust)? (für Tests) */
      isHeld: () => s.held,
      templates,
      routes,
      /** Aktiver Bereich und Verzeichnis (für Tests und Erweiterungen). */
      get area() { return s.area ? { id: s.area.id, name: s.area.name } : null; },
      get areas() { return s.areas ? s.areas.list.map(a => ({ id: a.id, name: a.name })) : []; },
      switchArea,
      detachToArea,
      areaHref,
      areaUrl: () => (s.area ? areaUrl() : null),
      flush: persistNow,
      isDirty,
      storageLines, saveLine,
      get bytes() { return DB.exportBytes(s.db); },
    };
  }

  global.NoNotesLocalShell = { create };
})(window);
