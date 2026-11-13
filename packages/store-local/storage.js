/* NoNotes – Persistenz.
   Zwei Ebenen:
   1. Browser-Speicher (IndexedDB, ersatzweise localStorage): immer aktiv, Sicherheitsnetz.
   2. Datei auf der Platte über die File System Access API (Chromium-Browser wie Edge):
      nach einmaligem Auswählen schreibt die App direkt in die .sqlite-Datei.
   Dazu Download/Import als Weg für Browser ohne File System Access API.

   Bereiche (ab v2.3.0): mehrere Datenbanken nebeneinander, je mit eigener Browser-Kopie und eigener gemerkter Datei.
   Der erste Bereich «main» behält die bisherigen Schlüssel (db, fileHandle), weitere liegen unter area:<id>:db und
   area:<id>:handle. Das Verzeichnis der Bereiche steht unter «areas».

   Abgleich-Eintrag (seit 4.6.0): neben jeder Browser-Kopie unter sync:<bereich> { fileHash, mirrorHash, dirty, at }, in derselben
   Transaktion geschrieben wie die Kopie. dirty: die Kopie ist der Datei voraus (die Datei hat den Stand fileHash). Solange das so ist,
   liegt unter syncbase:<bereich> der Inhalt der Datei mit fileHash, die Grundlage zum Zusammenführen. */
(function (global) {
  'use strict';

  const { t } = global.NoNotesI18n;

  const IDB_NAME = 'nonotes';
  const IDB_STORE = 'kv';
  const KEY_DB = 'db';
  const KEY_HANDLE = 'fileHandle';
  const LS_KEY_DB = 'nonotes.db.b64';
  const KEY_AREAS = 'areas';
  const LS_KEY_AREAS = 'nonotes.areas';
  const MAIN = 'main';
  const dbKey = area => (!area || area === MAIN ? KEY_DB : `area:${area}:db`);
  const handleKeyOf = area => (!area || area === MAIN ? KEY_HANDLE : `area:${area}:handle`);
  const lsDbKey = area => (!area || area === MAIN ? LS_KEY_DB : `nonotes.area.${area}.db.b64`);
  const BACKUPS_MAX = 5; // rollende Sicherungen je Bereich (seit 4.4.0)
  const backupsKey = area => `backups:${area || MAIN}`;
  const backupKey = (area, id) => `backup:${area || MAIN}:${id}`;
  const syncKey = area => `sync:${area || MAIN}`;          // Abgleich-Eintrag (seit 4.6.0)
  const syncBaseKey = area => `syncbase:${area || MAIN}`;  // Grundlage, solange die Kopie voraus ist
  const LS_SYNC = area => `nonotes.sync.${area || MAIN}`;
  const READ_CHUNK = () => Number(global.NONOTES_READ_CHUNK) || 1024 * 1024; // Lesen in Stücken (seit 4.6.0); Tests setzen kleinere
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let backupChain = Promise.resolve(); // Sicherungen nacheinander anlegen

  // ---------- IndexedDB als einfacher Key-Value-Speicher ----------

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) { reject(new Error(t('IndexedDB nicht verfügbar'))); return; }
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error(t('IndexedDB konnte nicht geöffnet werden')));
      req.onblocked = () => reject(new Error(t('IndexedDB ist blockiert')));
    });
  }

  async function idbRun(mode, fn) {
    const db = await idbOpen();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, mode);
        const store = tx.objectStore(IDB_STORE);
        let result;
        const req = fn(store);
        if (req) req.onsuccess = () => { result = req.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error(t('IndexedDB-Transaktion fehlgeschlagen')));
        tx.onabort = () => reject(tx.error || new Error(t('IndexedDB-Transaktion abgebrochen')));
      });
    } finally {
      db.close();
    }
  }

  const idbGet = key => idbRun('readonly', store => store.get(key));
  const idbSet = (key, value) => idbRun('readwrite', store => store.put(value, key));
  const idbDel = key => idbRun('readwrite', store => store.delete(key));

  // ---------- Base64 für den localStorage-Ersatz ----------

  function bytesToB64(bytes) {
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function b64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------- Abgleich-Eintrag (seit 4.6.0) ----------

  const recordOf = sync => ({ fileHash: sync.fileHash == null ? null : sync.fileHash, mirrorHash: sync.mirrorHash || null, dirty: !!sync.dirty, at: sync.at || new Date().toISOString() });

  function putSync(store, area, sync) {
    store.put(recordOf(sync), syncKey(area));
    if (sync.base === null) store.delete(syncBaseKey(area));
    else if (sync.base) store.put(sync.base, syncBaseKey(area));
  }

  // ---------- Browser-Speicher mit Rückfallebene ----------

  const browserStore = {
    backend: null, // 'indexeddb' | 'localstorage' | null

    async detect() {
      try {
        await idbGet('__probe');
        this.backend = 'indexeddb';
      } catch (e) {
        try {
          localStorage.setItem('__probe', '1');
          localStorage.removeItem('__probe');
          this.backend = 'localstorage';
        } catch (e2) {
          this.backend = null;
        }
      }
      return this.backend;
    },

    label() {
      return this.backend === 'indexeddb' ? 'IndexedDB'
        : this.backend === 'localstorage' ? 'localStorage'
        : t('kein Browser-Speicher');
    },

    /** Browser-Kopie eines Bereichs (ohne Angabe: der erste Bereich). */
    async loadDb(area) {
      if (this.backend === 'indexeddb') {
        const v = await idbGet(dbKey(area));
        return v ? new Uint8Array(v) : null;
      }
      if (this.backend === 'localstorage') {
        const s = localStorage.getItem(lsDbKey(area));
        return s ? b64ToBytes(s) : null;
      }
      return null;
    },

    /** Schreibt die Browser-Kopie; sync (seit 4.6.0): der Abgleich-Eintrag { fileHash, mirrorHash, dirty, at, base? }, in derselben
     *  Transaktion. base: Bytes der Grundlage (speichern), null (löschen), fehlt (bleibt, wie sie ist). */
    async saveDb(bytes, area, sync) {
      if (this.backend === 'indexeddb') {
        await idbRun('readwrite', store => {
          store.put(bytes, dbKey(area));
          if (sync) putSync(store, area, sync);
        });
        return;
      }
      if (this.backend === 'localstorage') {
        localStorage.setItem(lsDbKey(area), bytesToB64(bytes));
        if (sync) localStorage.setItem(LS_SYNC(area), JSON.stringify(recordOf(sync))); // ohne Grundlage: dafür ist localStorage zu klein
        return;
      }
      throw new Error(t('Kein Browser-Speicher verfügbar'));
    },

    /** Nur den Abgleich-Eintrag schreiben (etwa nach dem Schreiben der Datei: nicht mehr voraus). */
    async saveSync(area, sync) {
      if (this.backend === 'indexeddb') { await idbRun('readwrite', store => { putSync(store, area, sync); }); return; }
      if (this.backend === 'localstorage') localStorage.setItem(LS_SYNC(area), JSON.stringify(recordOf(sync)));
    },

    /** Der Abgleich-Eintrag eines Bereichs oder null (Daten von vor 4.6.0, oder nie gespeichert). */
    async loadSync(area) {
      try {
        if (this.backend === 'indexeddb') { const v = await idbGet(syncKey(area)); return v && typeof v === 'object' ? v : null; }
        if (this.backend === 'localstorage') { const v = localStorage.getItem(LS_SYNC(area)); return v ? JSON.parse(v) : null; }
      } catch (e) { /* ohne Eintrag */ }
      return null;
    },

    async loadSyncBase(area) {
      if (this.backend !== 'indexeddb') return null;
      try { const v = await idbGet(syncBaseKey(area)); return v ? new Uint8Array(v) : null; } catch (e) { return null; }
    },

    /** Browser-Kopie und gemerkte Datei eines Bereichs löschen (die Datei auf der Platte bleibt). */
    async removeArea(area) {
      if (this.backend === 'indexeddb') {
        try { await idbDel(dbKey(area)); } catch (e) { /* nichts zu tun */ }
        try { await idbDel(handleKeyOf(area)); } catch (e) { /* nichts zu tun */ }
        try { await idbDel(syncKey(area)); await idbDel(syncBaseKey(area)); } catch (e) { /* nichts zu tun */ }
        try { for (const b of await this.listBackups(area)) await idbDel(backupKey(area, b.id)); await idbDel(backupsKey(area)); } catch (e) { /* nichts zu tun */ }
      } else if (this.backend === 'localstorage') {
        try { localStorage.removeItem(lsDbKey(area)); localStorage.removeItem(LS_SYNC(area)); } catch (e) { /* nichts zu tun */ }
      }
    },

    async loadHandle(area) {
      if (this.backend !== 'indexeddb') return null;
      try { return (await idbGet(handleKeyOf(area))) || null; }
      catch (e) { return null; }
    },

    async saveHandle(handle, area) {
      if (this.backend !== 'indexeddb') {
        throw new Error(t('Ohne IndexedDB kann sich die App die Datei nicht merken'));
      }
      await idbSet(handleKeyOf(area), handle);
    },

    async clearHandle(area) {
      if (this.backend === 'indexeddb') {
        try { await idbDel(handleKeyOf(area)); } catch (e) { /* nichts zu tun */ }
      }
    },

    /** Verzeichnis der Bereiche: { list: [{ id, name, createdAt }], last } oder null, solange es nur den ersten gibt. */
    async loadAreas() {
      try {
        let v = null;
        if (this.backend === 'indexeddb') v = await idbGet(KEY_AREAS);
        else if (this.backend === 'localstorage') { const s = localStorage.getItem(LS_KEY_AREAS); v = s ? JSON.parse(s) : null; }
        return v && Array.isArray(v.list) && v.list.length ? v : null;
      } catch (e) { return null; }
    },

    async saveAreas(reg) {
      const v = { list: reg.list.map(a => ({ id: a.id, name: a.name, createdAt: a.createdAt || null })), last: reg.last || null };
      if (this.backend === 'indexeddb') { await idbSet(KEY_AREAS, v); return; }
      if (this.backend === 'localstorage') { localStorage.setItem(LS_KEY_AREAS, JSON.stringify(v)); return; }
      throw new Error(t('Kein Browser-Speicher verfügbar'));
    },

    /** Kleine Werte für alle Bereiche (zum Beispiel Vorlagen ohne Ordner) unter eigenem Schlüssel; JSON-tauglich. */
    async loadValue(key) {
      try {
        if (this.backend === 'indexeddb') { const v = await idbGet('value:' + key); return v == null ? null : v; }
        if (this.backend === 'localstorage') { const s = localStorage.getItem('nonotes.value.' + key); return s ? JSON.parse(s) : null; }
      } catch (e) { /* nichts gemerkt */ }
      return null;
    },

    async saveValue(key, value) {
      if (this.backend === 'indexeddb') { await idbSet('value:' + key, value); return; }
      if (this.backend === 'localstorage') { localStorage.setItem('nonotes.value.' + key, JSON.stringify(value)); return; }
      throw new Error(t('Kein Browser-Speicher verfügbar'));
    },

    // ---------- Rollende Sicherungen (seit 4.4.0) ----------
    // Je Bereich höchstens BACKUPS_MAX Stände in IndexedDB, ohne doppelte Inhalte: ein Verzeichnis unter backups:<bereich> (Angaben),
    // die Bytes je unter backup:<bereich>:<kennung>. Ohne IndexedDB (localStorage ist zu klein) gibt es keine.

    /** Gibt es Sicherungen in diesem Browser? */
    get backups() { return this.backend === 'indexeddb'; },

    /** Sicherungen eines Bereichs, die neueste zuerst: [{ id, at, reason, size, notes, hash }]. */
    async listBackups(area) {
      if (this.backend !== 'indexeddb') return [];
      try { const v = await idbGet(backupsKey(area)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
    },

    /** Legt eine Sicherung an. meta: { reason, notes, hash }. Gleicher Inhalt wie eine vorhandene: nichts (gibt dann deren Angaben).
     *  Die älteste über BACKUPS_MAX fällt weg. */
    addBackup(area, bytes, meta) {
      // nacheinander: zwei gleichzeitige Sicherungen lesen sonst dieselbe Liste und eine ginge verloren
      const run = backupChain.then(() => this.addBackupNow(area, bytes, meta));
      backupChain = run.catch(() => null);
      return run;
    },

    async addBackupNow(area, bytes, meta) {
      if (this.backend !== 'indexeddb' || !bytes || !bytes.length) return null;
      const list = await this.listBackups(area);
      const same = list.find(b => b.hash === meta.hash && b.size === bytes.length);
      if (same) return same;
      const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), reason: meta.reason || '',
        size: bytes.length, notes: meta.notes == null ? null : meta.notes, hash: meta.hash };
      await idbSet(backupKey(area, entry.id), bytes);
      const next = [entry, ...list];
      const drop = next.splice(BACKUPS_MAX);
      await idbSet(backupsKey(area), next);
      for (const b of drop) { try { await idbDel(backupKey(area, b.id)); } catch (e) { /* bleibt liegen, stört nicht */ } }
      return entry;
    },

    async loadBackup(area, id) {
      if (this.backend !== 'indexeddb') return null;
      const v = await idbGet(backupKey(area, id));
      return v ? new Uint8Array(v) : null;
    },

    /** Weitere gemerkte Datei-Handles (z. B. die Kalenderdatei) unter eigenem Schlüssel. */
    async loadHandleKey(key) {
      if (this.backend !== 'indexeddb') return null;
      try { return (await idbGet('handle:' + key)) || null; }
      catch (e) { return null; }
    },

    async saveHandleKey(key, handle) {
      if (this.backend !== 'indexeddb') throw new Error(t('Ohne IndexedDB kann sich die App die Datei nicht merken'));
      await idbSet('handle:' + key, handle);
    },

    async clearHandleKey(key) {
      if (this.backend === 'indexeddb') {
        try { await idbDel('handle:' + key); } catch (e) { /* nichts zu tun */ }
      }
    },
  };

  // ---------- Datei auf der Platte (File System Access API) ----------

  const FILE_TYPES = [{
    description: 'SQLite-Datenbank',
    accept: { 'application/vnd.sqlite3': ['.sqlite', '.sqlite3', '.db'] },
  }];
  const ICS_TYPES = [{
    description: t('Kalenderdatei (iCalendar)'),
    accept: { 'text/calendar': ['.ics'] },
  }];

  const named = (name, message) => Object.assign(new Error(message), { name });

  /** Wartet auf promise, bricht aber sofort ab, wenn signal abbricht (ein hängendes Netzlaufwerk soll «Abbrechen» nicht aufhalten). */
  function abortable(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(named('AbortError', 'aborted')); return; }
      const onAbort = () => reject(named('AbortError', 'aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(v => { signal.removeEventListener('abort', onAbort); resolve(v); }, e => { signal.removeEventListener('abort', onAbort); reject(e); });
    });
  }

  async function readOnce(handle, o) {
    const file = await abortable(handle.getFile(), o.signal);
    const size = file.size;
    const out = new Uint8Array(size);
    const chunk = READ_CHUNK();
    let at = 0;
    while (at < size) {
      if (o.signal && o.signal.aborted) throw named('AbortError', 'aborted');
      const part = new Uint8Array(await abortable(file.slice(at, Math.min(size, at + chunk)).arrayBuffer(), o.signal));
      if (!part.length) throw named('FileChangedError', 'file shrank while reading');
      out.set(part, at);
      at += part.length;
      if (o.onProgress) o.onProgress(at, size);
    }
    const again = await abortable(handle.getFile(), o.signal); // hat sich die Datei inzwischen geändert? Dann ist das Gelesene nicht verlässlich
    if (again.size !== size || again.lastModified !== file.lastModified) throw named('FileChangedError', 'file changed while reading');
    return out;
  }

  const fileAccess = {
    supported: typeof global.showSaveFilePicker === 'function'
      && typeof global.showOpenFilePicker === 'function',
    ICS_TYPES,

    /** startIn: bekannter Ordner, in dem der Dialog beginnt (etwa 'desktop'). */
    async pickNew(suggestedName, types, startIn) {
      const opts = { suggestedName, types: types || FILE_TYPES };
      if (startIn) opts.startIn = startIn;
      return global.showSaveFilePicker(opts);
    },

    async pickExisting() {
      const handles = await global.showOpenFilePicker({ multiple: false, types: FILE_TYPES });
      return handles[0];
    },

    /** 'granted' | 'prompt' | 'denied'. Mit request=true wird der Benutzer gefragt (braucht Klick). */
    async permission(handle, request) {
      const opts = { mode: 'readwrite' };
      let p = await handle.queryPermission(opts);
      if (p !== 'granted' && request) p = await handle.requestPermission(opts);
      return p;
    },

    /** Liest die Datei in Stücken zu 1 MB (seit 4.6.0). opts: onProgress(gelesen, gesamt) nach jedem Stück, signal (AbortSignal:
     *  zwischen den Stücken abbrechen). Ändert sich die Datei während des Lesens (Grösse oder Zeitstempel) oder liefert der Browser
     *  NotReadableError, wird bis zu dreimal neu gelesen; danach kommt der Fehler. */
    async read(handle, opts) {
      for (let attempt = 1; ; attempt++) {
        try { return await readOnce(handle, opts || {}); }
        catch (e) {
          if (attempt >= 3 || !e || (e.name !== 'NotReadableError' && e.name !== 'FileChangedError')) throw e;
          await sleep(200 * attempt);
        }
      }
    },

    /** Schreibt atomar: der Browser schreibt in eine Zwischendatei und tauscht bei close() aus. opts.verify (seit 4.6.0): danach die
     *  Grösse prüfen; stimmt sie nicht, ist das Schreiben gescheitert (SizeMismatchError). */
    async write(handle, bytes, opts) {
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (e) {
        try { await writable.abort(); } catch (e2) { /* bereits geschlossen */ }
        throw e;
      }
      if (!(opts && opts.verify)) return;
      const after = await handle.getFile();
      if (after.size !== bytes.length) throw named('SizeMismatchError', `size ${after.size} instead of ${bytes.length}`);
    },
  };

  // ---------- Download / Import (funktioniert überall) ----------

  function download(bytes, filename, type) {
    const blob = new Blob([bytes], { type: type || 'application/vnd.sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function readFileInput(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  function bytesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ---------- Bereiche: Kennung, Suche über die Adresse ----------

  /** Kennung aus einem Namen: klein, ohne Umlaute und Sonderzeichen, höchstens 30 Zeichen («Projekt Ä» → «projekt-ae»). */
  function areaSlug(name) {
    const s = String(name || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
    return s || 'bereich';
  }

  /** Eine neue, freie Kennung zu einem Namen. «main» ist dem ersten Bereich vorbehalten. */
  function newAreaId(name, list) {
    const taken = new Set((list || []).map(a => a.id));
    const base = areaSlug(name);
    let id = base === MAIN ? 'main-2' : base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  /** Bereich zu einem Wert aus der Adresse (#w=… oder ?w=…): Kennung, Name als Kennung geschrieben, oder 1 … 9 für die Stelle in der Liste. */
  function findArea(list, value) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    if (!v) return null;
    return list.find(a => a.id === v) || list.find(a => areaSlug(a.name) === areaSlug(v))
      || (/^[1-9]$/.test(v) ? list[Number(v) - 1] || null : null);
  }

  global.NoNotesStorage = { browserStore, fileAccess, download, readFileInput, bytesEqual, MAIN_AREA: MAIN, areaSlug, newAreaId, findArea };
})(window);
