/* NoNotes – Persistenz.
   Zwei Ebenen:
   1. Browser-Speicher (IndexedDB, ersatzweise localStorage): immer aktiv, Sicherheitsnetz.
   2. Datei auf der Platte über die File System Access API (Chromium-Browser wie Edge):
      nach einmaligem Auswählen schreibt die App direkt in die .sqlite-Datei.
   Dazu Download/Import als Weg für Browser ohne File System Access API.

   Bereiche (ab v2.3.0): mehrere Datenbanken nebeneinander, je mit eigener Browser-Kopie und eigener gemerkter Datei.
   Der erste Bereich «main» behält die bisherigen Schlüssel (db, fileHandle), weitere liegen unter area:<id>:db und
   area:<id>:handle. Das Verzeichnis der Bereiche steht unter «areas». */
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

    async saveDb(bytes, area) {
      if (this.backend === 'indexeddb') { await idbSet(dbKey(area), bytes); return; }
      if (this.backend === 'localstorage') { localStorage.setItem(lsDbKey(area), bytesToB64(bytes)); return; }
      throw new Error(t('Kein Browser-Speicher verfügbar'));
    },

    /** Browser-Kopie und gemerkte Datei eines Bereichs löschen (die Datei auf der Platte bleibt). */
    async removeArea(area) {
      if (this.backend === 'indexeddb') {
        try { await idbDel(dbKey(area)); } catch (e) { /* nichts zu tun */ }
        try { await idbDel(handleKeyOf(area)); } catch (e) { /* nichts zu tun */ }
      } else if (this.backend === 'localstorage') {
        try { localStorage.removeItem(lsDbKey(area)); } catch (e) { /* nichts zu tun */ }
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

  const fileAccess = {
    supported: typeof global.showSaveFilePicker === 'function'
      && typeof global.showOpenFilePicker === 'function',
    ICS_TYPES,

    async pickNew(suggestedName, types) {
      return global.showSaveFilePicker({ suggestedName, types: types || FILE_TYPES });
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

    async read(handle) {
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    },

    /** Schreibt atomar: der Browser schreibt in eine Zwischendatei und tauscht bei close() aus. */
    async write(handle, bytes) {
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (e) {
        try { await writable.abort(); } catch (e2) { /* bereits geschlossen */ }
        throw e;
      }
    },
  };

  // ---------- Download / Import (funktioniert überall) ----------

  function download(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/vnd.sqlite3' });
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

  /** Bereich zu einem Wert aus der Adresse (?w=…): Kennung, Name als Kennung geschrieben, oder 1 … 9 für die Stelle in der Liste. */
  function findArea(list, value) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    if (!v) return null;
    return list.find(a => a.id === v) || list.find(a => areaSlug(a.name) === areaSlug(v))
      || (/^[1-9]$/.test(v) ? list[Number(v) - 1] || null : null);
  }

  global.NoNotesStorage = { browserStore, fileAccess, download, readFileInput, bytesEqual, MAIN_AREA: MAIN, areaSlug, newAreaId, findArea };
})(window);
