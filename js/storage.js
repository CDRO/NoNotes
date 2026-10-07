/* NoNotes – Persistenz.
   Zwei Ebenen:
   1. Browser-Speicher (IndexedDB, ersatzweise localStorage): immer aktiv, Sicherheitsnetz.
   2. Datei auf der Platte über die File System Access API (Chromium-Browser wie Edge):
      nach einmaligem Auswählen schreibt die App direkt in die .sqlite-Datei.
   Dazu Download/Import als Weg für Browser ohne File System Access API. */
(function (global) {
  'use strict';

  const IDB_NAME = 'nonotes';
  const IDB_STORE = 'kv';
  const KEY_DB = 'db';
  const KEY_HANDLE = 'fileHandle';
  const LS_KEY_DB = 'nonotes.db.b64';

  // ---------- IndexedDB als einfacher Key-Value-Speicher ----------

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) { reject(new Error('IndexedDB nicht verfügbar')); return; }
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB konnte nicht geöffnet werden'));
      req.onblocked = () => reject(new Error('IndexedDB ist blockiert'));
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
        tx.onerror = () => reject(tx.error || new Error('IndexedDB-Transaktion fehlgeschlagen'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB-Transaktion abgebrochen'));
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
        : 'kein Browser-Speicher';
    },

    async loadDb() {
      if (this.backend === 'indexeddb') {
        const v = await idbGet(KEY_DB);
        return v ? new Uint8Array(v) : null;
      }
      if (this.backend === 'localstorage') {
        const s = localStorage.getItem(LS_KEY_DB);
        return s ? b64ToBytes(s) : null;
      }
      return null;
    },

    async saveDb(bytes) {
      if (this.backend === 'indexeddb') { await idbSet(KEY_DB, bytes); return; }
      if (this.backend === 'localstorage') { localStorage.setItem(LS_KEY_DB, bytesToB64(bytes)); return; }
      throw new Error('Kein Browser-Speicher verfügbar');
    },

    async loadHandle() {
      if (this.backend !== 'indexeddb') return null;
      try { return (await idbGet(KEY_HANDLE)) || null; }
      catch (e) { return null; }
    },

    async saveHandle(handle) {
      if (this.backend !== 'indexeddb') {
        throw new Error('Ohne IndexedDB kann sich die App die Datei nicht merken');
      }
      await idbSet(KEY_HANDLE, handle);
    },

    async clearHandle() {
      if (this.backend === 'indexeddb') {
        try { await idbDel(KEY_HANDLE); } catch (e) { /* nichts zu tun */ }
      }
    },
  };

  // ---------- Datei auf der Platte (File System Access API) ----------

  const FILE_TYPES = [{
    description: 'SQLite-Datenbank',
    accept: { 'application/vnd.sqlite3': ['.sqlite', '.sqlite3', '.db'] },
  }];

  const fileAccess = {
    supported: typeof global.showSaveFilePicker === 'function'
      && typeof global.showOpenFilePicker === 'function',

    async pickNew(suggestedName) {
      return global.showSaveFilePicker({ suggestedName, types: FILE_TYPES });
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

  global.NoNotesStorage = { browserStore, fileAccess, download, readFileInput, bytesEqual };
})(window);
