/* NoNotes – Oberfläche und Ablauf. */
(function () {
  'use strict';

  const DB = window.NoNotesDB;
  const Store = window.NoNotesStorage;

  const DEFAULT_FILENAME = 'NoNotes.sqlite';
  const SAVE_DELAY_MS = 600;
  const SEARCH_DELAY_MS = 120;

  const $ = sel => document.querySelector(sel);
  const el = {
    app: $('#app'), boot: $('#boot'), version: $('#version'), status: $('#status'),
    storageInfo: $('#storageInfo'), banner: $('#banner'),
    menuBtn: $('#menuBtn'), menu: $('#menu'), menuHint: $('#menuHint'),
    createFileBtn: $('#createFileBtn'), openFileBtn: $('#openFileBtn'), disconnectBtn: $('#disconnectBtn'),
    downloadBtn: $('#downloadBtn'), importBtn: $('#importBtn'), importInput: $('#importInput'),
    search: $('#search'), newBtn: $('#newBtn'), list: $('#list'), listEmpty: $('#listEmpty'), count: $('#count'),
    editorEmpty: $('#editorEmpty'), editorPane: $('#editorPane'), backBtn: $('#backBtn'),
    noteMeta: $('#noteMeta'), deleteBtn: $('#deleteBtn'), title: $('#title'), body: $('#body'),
  };

  const state = {
    SQL: null,
    db: null,
    currentId: null,
    query: '',
    // Speichern: jede Änderung erhöht editSeq; savedSeq ist der zuletzt vollständig gesicherte Stand.
    editSeq: 0,
    savedSeq: 0,
    saving: false,
    saveTimer: null,
    searchTimer: null,
    // Datei
    fileHandle: null,
    filePermission: null,   // 'granted' | 'prompt' | 'denied' | null
    handleRemembered: false,
    mirrorAtStart: null,    // Browser-Kopie beim Start (für den Abgleich beim Verbinden)
    editedSinceStart: false, // Inhalt könnte von der gemerkten Datei abweichen
  };

  // ---------- Hilfen ----------

  const fmtDateTime = new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtTime = new Intl.DateTimeFormat('de-CH', { timeStyle: 'short' });

  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : fmtDateTime.format(d);
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function snippetOf(text) {
    return (text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  }

  function setStatus(text, stateName) {
    el.status.textContent = text;
    el.status.dataset.state = stateName || '';
  }

  function isAbort(e) { return e && e.name === 'AbortError'; }

  function isNarrow() { return window.matchMedia('(max-width: 760px)').matches; }

  function showEditorView(on) { document.body.classList.toggle('view-editor', !!on); }

  function showBanner(text, actions) {
    el.banner.replaceChildren();
    const span = document.createElement('span');
    span.textContent = text;
    el.banner.appendChild(span);
    const box = document.createElement('div');
    box.className = 'actions';
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', a.onClick);
      box.appendChild(b);
    }
    el.banner.appendChild(box);
    el.banner.hidden = false;
  }

  function hideBanner() {
    el.banner.hidden = true;
    el.banner.replaceChildren();
  }

  // ---------- Start ----------

  async function boot() {
    el.version.textContent = window.NONOTES_VERSION || 'dev';

    try {
      state.SQL = await initSqlJs();
    } catch (e) {
      bootError('SQLite konnte nicht geladen werden.\n' + (e && e.message ? e.message : e));
      return;
    }

    const backend = await Store.browserStore.detect();
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    let mirror = null;
    try { mirror = await Store.browserStore.loadDb(); }
    catch (e) { console.warn('Browser-Speicher nicht lesbar', e); }
    state.mirrorAtStart = mirror;

    let openedFromFile = false;
    if (Store.fileAccess.supported) {
      const handle = await Store.browserStore.loadHandle();
      if (handle) {
        state.fileHandle = handle;
        state.handleRemembered = true;
        try { state.filePermission = await Store.fileAccess.permission(handle, false); }
        catch (e) { state.filePermission = 'prompt'; }
        if (state.filePermission === 'granted') {
          try {
            const bytes = await Store.fileAccess.read(handle);
            state.db = DB.open(state.SQL, bytes);
            openedFromFile = true;
          } catch (e) {
            console.warn('Datei nicht lesbar, verwende Browser-Kopie', e);
            state.filePermission = 'prompt';
          }
        }
      }
    }

    if (!openedFromFile) {
      try {
        state.db = DB.open(state.SQL, mirror);
      } catch (e) {
        console.warn('Browser-Kopie unbrauchbar, starte mit leerer Datenbank', e);
        state.db = DB.open(state.SQL, null);
      }
    }

    wireEvents();
    renderAll();
    updateStorageInfo();
    if (state.fileHandle && state.filePermission !== 'granted') showConnectBanner();

    el.boot.hidden = true;
    el.app.hidden = false;
    document.body.dataset.ready = 'true';

    setStatus(openedFromFile ? `Aus „${state.fileHandle.name}“ geladen`
      : mirror ? `Aus Browser-Speicher geladen (${Store.browserStore.label()})`
      : 'Neue Datenbank', 'saved');
    if (backend === null) {
      setStatus('Achtung: kein Browser-Speicher verfügbar. Bitte eine Datenbankdatei anlegen oder regelmässig eine Kopie herunterladen.', 'error');
    }
  }

  function bootError(message) {
    el.boot.textContent = message;
    el.boot.classList.add('error');
  }

  // ---------- Speichern ----------

  function markEdited() {
    state.editedSinceStart = true;
    scheduleSave();
  }

  function scheduleSave() {
    state.editSeq++;
    setStatus('Ungespeicherte Änderungen', 'dirty');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(persistNow, SAVE_DELAY_MS);
  }

  async function persistNow() {
    clearTimeout(state.saveTimer);
    if (state.saving) return; // läuft bereits; am Ende wird bei Bedarf nachgezogen
    if (state.editSeq === state.savedSeq) return;

    state.saving = true;
    const seq = state.editSeq;
    setStatus('Speichern…', 'saving');
    let ok = true;
    try {
      const bytes = DB.exportBytes(state.db);
      try {
        await Store.browserStore.saveDb(bytes);
      } catch (e) {
        ok = false;
        console.warn('Browser-Speicher', e);
        setStatus('Browser-Speicher nicht beschreibbar: ' + e.message, 'error');
      }
      if (state.fileHandle && state.filePermission === 'granted') {
        try {
          await Store.fileAccess.write(state.fileHandle, bytes);
        } catch (e) {
          ok = false;
          console.warn('Dateischreiben', e);
          setStatus('Datei konnte nicht geschrieben werden: ' + e.message, 'error');
        }
      }
      if (ok) {
        state.savedSeq = seq;
        setStatus('Gespeichert ' + fmtTime.format(new Date()), 'saved');
      }
    } catch (e) {
      ok = false;
      console.error(e);
      setStatus('Speichern fehlgeschlagen: ' + e.message, 'error');
    } finally {
      state.saving = false;
      if (ok && state.editSeq !== seq) persistNow(); // zwischenzeitlich kam Neues
    }
  }

  // ---------- Datenbank austauschen ----------

  function replaceDb(newDb) {
    if (state.db) { try { state.db.close(); } catch (e) { /* egal */ } }
    state.db = newDb;
    state.currentId = null;
    state.query = '';
    el.search.value = '';
    showEditorView(false);
  }

  // ---------- Datei-Anbindung ----------

  function updateStorageInfo() {
    const info = el.storageInfo;
    const label = info.querySelector('.label');
    info.classList.remove('connected', 'pending');
    const supported = Store.fileAccess.supported;

    el.createFileBtn.hidden = !supported;
    el.openFileBtn.hidden = !supported;
    el.disconnectBtn.hidden = !state.fileHandle;

    if (state.fileHandle && state.filePermission === 'granted') {
      info.classList.add('connected');
      label.textContent = state.fileHandle.name + (state.handleRemembered ? '' : ' (nur diese Sitzung)');
      info.title = 'Änderungen werden in diese Datei und in den Browser-Speicher geschrieben.';
    } else if (state.fileHandle) {
      info.classList.add('pending');
      label.textContent = state.fileHandle.name + ' (nicht verbunden)';
      info.title = 'Die Datei ist gemerkt, aber noch nicht freigegeben.';
    } else {
      label.textContent = 'Nur Browser-Speicher';
      info.title = 'Daten liegen im ' + Store.browserStore.label() + ' dieses Browsers.';
    }

    el.menuHint.textContent = supported
      ? 'Empfohlen: eine Datenbankdatei anlegen. Dann liegt alles in einer echten .sqlite-Datei, die du sichern und mitnehmen kannst.'
      : 'Dieser Browser kann nicht direkt in Dateien schreiben. Sichere regelmässig eine Kopie und importiere sie bei Bedarf.';
  }

  function showConnectBanner() {
    const name = state.fileHandle.name || DEFAULT_FILENAME;
    const denied = state.filePermission === 'denied';
    showBanner(
      denied
        ? `Der Zugriff auf „${name}“ wurde verweigert. Änderungen landen vorerst nur im Browser-Speicher.`
        : `Datenbankdatei „${name}“ gemerkt. Zum Weiterarbeiten in dieser Datei einmal verbinden.`,
      [
        { label: 'Mit Datei verbinden', primary: true, onClick: connectRememberedFile },
        { label: 'Verbindung trennen', onClick: disconnectFile },
      ]
    );
  }

  async function connectRememberedFile() {
    const handle = state.fileHandle;
    try {
      state.filePermission = await Store.fileAccess.permission(handle, true);
      if (state.filePermission !== 'granted') { showConnectBanner(); updateStorageInfo(); return; }

      const fileBytes = await Store.fileAccess.read(handle);
      const fileUnchanged = state.mirrorAtStart && Store.bytesEqual(fileBytes, state.mirrorAtStart);

      if (!fileBytes.length) {
        // Leere Datei: aktueller Stand wird hineingeschrieben.
        state.editSeq++;
      } else if (!state.editedSinceStart || fileUnchanged) {
        // Nichts Eigenes verloren: Datei ist massgebend bzw. identisch, aktueller Stand gewinnt bei Änderungen.
        if (!state.editedSinceStart) replaceDb(DB.open(state.SQL, fileBytes));
        state.editSeq++;
      } else {
        const loadFile = confirm(
          `Die Datei „${handle.name}“ wurde ausserhalb dieser Sitzung geändert.\n\n` +
          'OK: Datei laden und die Änderungen dieser Sitzung verwerfen.\n' +
          'Abbrechen: Datei mit dem aktuellen Stand überschreiben.'
        );
        if (loadFile) replaceDb(DB.open(state.SQL, fileBytes));
        state.editSeq++;
      }
      state.editedSinceStart = false;
      hideBanner();
      updateStorageInfo();
      renderAll();
      await persistNow();
      setStatus(`Mit „${handle.name}“ verbunden`, 'saved');
    } catch (e) {
      console.error(e);
      setStatus('Verbinden fehlgeschlagen: ' + e.message, 'error');
    }
  }

  async function adoptHandle(handle) {
    state.fileHandle = handle;
    state.filePermission = 'granted';
    state.editedSinceStart = false;
    state.handleRemembered = false;
    // Erst die Oberfläche und das Schreiben, dann das Merken: der Benutzer sieht sofort, was gilt.
    hideBanner();
    updateStorageInfo();
    renderAll();
    state.editSeq++;
    const written = persistNow();
    try {
      await Store.browserStore.saveHandle(handle);
      state.handleRemembered = true;
    } catch (e) {
      console.warn('Datei-Handle kann nicht gemerkt werden', e);
    }
    updateStorageInfo();
    await written;
  }

  async function createFile() {
    closeMenu();
    try {
      const handle = await Store.fileAccess.pickNew(DEFAULT_FILENAME);
      const perm = await Store.fileAccess.permission(handle, true);
      if (perm !== 'granted') { setStatus('Kein Schreibzugriff auf die Datei', 'error'); return; }
      await adoptHandle(handle);
      if (state.editSeq === state.savedSeq) setStatus(`Datenbankdatei „${handle.name}“ angelegt`, 'saved');
    } catch (e) {
      if (isAbort(e)) return;
      console.error(e);
      setStatus('Datei anlegen fehlgeschlagen: ' + e.message, 'error');
    }
  }

  async function openFile() {
    closeMenu();
    try {
      const handle = await Store.fileAccess.pickExisting();
      const perm = await Store.fileAccess.permission(handle, true);
      if (perm !== 'granted') { setStatus('Kein Schreibzugriff auf die Datei', 'error'); return; }
      const bytes = await Store.fileAccess.read(handle);
      const newDb = DB.open(state.SQL, bytes); // prüft, ob es eine NoNotes-Datei ist
      const n = DB.countNotes(state.db);
      if (n > 0 && !confirm(
        `„${handle.name}“ öffnen?\n\nDie ${n === 1 ? 'aktuell angezeigte Notiz wird' : 'aktuell angezeigten ' + n + ' Notizen werden'} ` +
        'durch den Inhalt der Datei ersetzt. Bei Bedarf vorher „Kopie herunterladen“.'
      )) { newDb.close(); return; }
      replaceDb(newDb);
      await adoptHandle(handle);
      if (state.editSeq === state.savedSeq) setStatus(`„${handle.name}“ geöffnet`, 'saved');
    } catch (e) {
      if (isAbort(e)) return;
      console.error(e);
      setStatus('Datei öffnen fehlgeschlagen: ' + e.message, 'error');
    }
  }

  async function disconnectFile() {
    closeMenu();
    await Store.browserStore.clearHandle();
    state.fileHandle = null;
    state.filePermission = null;
    state.handleRemembered = false;
    hideBanner();
    updateStorageInfo();
    setStatus('Dateiverbindung getrennt. Daten bleiben im Browser-Speicher.', 'saved');
  }

  function downloadCopy() {
    closeMenu();
    const bytes = DB.exportBytes(state.db);
    Store.download(bytes, `NoNotes-${todayStamp()}.sqlite`);
    const dirty = state.editSeq !== state.savedSeq;
    setStatus('Kopie heruntergeladen', dirty ? 'dirty' : 'saved');
  }

  function startImport() {
    closeMenu();
    el.importInput.value = '';
    el.importInput.click();
  }

  async function importFromInput() {
    const file = el.importInput.files && el.importInput.files[0];
    if (!file) return;
    try {
      const bytes = await Store.readFileInput(file);
      const newDb = DB.open(state.SQL, bytes);
      const n = DB.countNotes(state.db);
      if (n > 0 && !confirm(
        `„${file.name}“ importieren?\n\nDie ${n === 1 ? 'aktuell angezeigte Notiz wird' : 'aktuell angezeigten ' + n + ' Notizen werden'} ersetzt` +
        (state.fileHandle && state.filePermission === 'granted' ? `, auch in der verbundenen Datei „${state.fileHandle.name}“.` : '.')
      )) { newDb.close(); return; }
      replaceDb(newDb);
      renderAll();
      markEdited();
      await persistNow();
      if (state.editSeq === state.savedSeq) setStatus(`„${file.name}“ importiert`, 'saved');
    } catch (e) {
      console.error(e);
      setStatus('Import fehlgeschlagen: ' + e.message, 'error');
    } finally {
      el.importInput.value = '';
    }
  }

  // ---------- Darstellung ----------

  function renderAll() {
    renderList();
    renderEditor();
    renderCount();
  }

  function renderList() {
    const notes = DB.listNotes(state.db, state.query);
    const frag = document.createDocumentFragment();
    for (const n of notes) {
      const li = document.createElement('li');
      li.className = 'note-item' + (n.id === state.currentId ? ' active' : '');
      li.dataset.id = String(n.id);
      li.tabIndex = 0;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(n.id === state.currentId));

      const t = document.createElement('div');
      t.className = 'note-title';
      t.textContent = n.title.trim() || 'Ohne Titel';

      const s = document.createElement('div');
      s.className = 'note-snippet';
      s.textContent = snippetOf(n.snippet) || '…';

      const d = document.createElement('div');
      d.className = 'note-date';
      d.textContent = fmtDate(n.updated_at);

      li.append(t, s, d);
      frag.appendChild(li);
    }
    el.list.replaceChildren(frag);

    const empty = notes.length === 0;
    el.listEmpty.hidden = !empty;
    el.listEmpty.textContent = state.query
      ? 'Keine Treffer.'
      : 'Noch keine Notizen. Lege mit „Neue Notiz“ los.';
  }

  function renderEditor() {
    const note = state.currentId != null ? DB.getNote(state.db, state.currentId) : null;
    if (!note) {
      state.currentId = null;
      el.editorPane.hidden = true;
      el.editorEmpty.hidden = false;
      return;
    }
    el.editorEmpty.hidden = true;
    el.editorPane.hidden = false;
    // Während des Tippens nicht überschreiben, sonst springt der Cursor.
    if (document.activeElement !== el.title) el.title.value = note.title;
    if (document.activeElement !== el.body) el.body.value = note.body;
    renderMeta(note.created_at, note.updated_at);
  }

  function renderMeta(createdAt, updatedAt) {
    el.noteMeta.textContent = `Erstellt ${fmtDate(createdAt)} · Geändert ${fmtDate(updatedAt)}`;
  }

  function renderCount() {
    const n = DB.countNotes(state.db);
    el.count.textContent = n === 1 ? '1 Notiz' : `${n} Notizen`;
  }

  function updateListItem(id, title, body, ts) {
    const li = el.list.querySelector(`li[data-id="${id}"]`);
    if (!li) { renderList(); return; }
    li.querySelector('.note-title').textContent = title.trim() || 'Ohne Titel';
    li.querySelector('.note-snippet').textContent = snippetOf(body) || '…';
    li.querySelector('.note-date').textContent = fmtDate(ts);
    if (el.list.firstElementChild !== li) el.list.prepend(li);
  }

  function setActiveItem(id) {
    for (const li of el.list.children) {
      const active = li.dataset.id === String(id);
      li.classList.toggle('active', active);
      li.setAttribute('aria-selected', String(active));
    }
  }

  // ---------- Aktionen ----------

  function selectNote(id, focusEditor) {
    state.currentId = id;
    setActiveItem(id);
    renderEditor();
    if (isNarrow()) showEditorView(true);
    if (focusEditor) (el.title.value ? el.body : el.title).focus();
  }

  function newNote() {
    const id = DB.createNote(state.db);
    state.currentId = id;
    if (state.query) { state.query = ''; el.search.value = ''; }
    renderAll();
    markEdited();
    if (isNarrow()) showEditorView(true);
    el.title.focus();
  }

  function onEdit() {
    if (state.currentId == null) return;
    const ts = DB.updateNote(state.db, state.currentId, el.title.value, el.body.value);
    renderMeta(DB.getNote(state.db, state.currentId).created_at, ts);
    updateListItem(state.currentId, el.title.value, el.body.value, ts);
    markEdited();
  }

  function deleteCurrent() {
    if (state.currentId == null) return;
    const note = DB.getNote(state.db, state.currentId);
    const name = note && note.title.trim() ? `„${note.title.trim()}“` : 'diese Notiz';
    if (!confirm(`Soll ${name} endgültig gelöscht werden?`)) return;

    const li = el.list.querySelector(`li[data-id="${state.currentId}"]`);
    const neighbour = li && (li.nextElementSibling || li.previousElementSibling);
    DB.deleteNote(state.db, state.currentId);
    state.currentId = neighbour ? Number(neighbour.dataset.id) : null;
    renderAll();
    markEdited();
    if (state.currentId == null) showEditorView(false);
  }

  function onSearchInput() {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.query = el.search.value;
      renderList();
    }, SEARCH_DELAY_MS);
  }

  function toggleMenu(force) {
    const open = typeof force === 'boolean' ? force : el.menu.hidden;
    el.menu.hidden = !open;
    el.menuBtn.setAttribute('aria-expanded', String(open));
  }
  function closeMenu() { toggleMenu(false); }

  // ---------- Ereignisse ----------

  function wireEvents() {
    el.newBtn.addEventListener('click', newNote);
    el.deleteBtn.addEventListener('click', deleteCurrent);
    el.backBtn.addEventListener('click', () => showEditorView(false));
    el.title.addEventListener('input', onEdit);
    el.body.addEventListener('input', onEdit);
    el.search.addEventListener('input', onSearchInput);
    el.search.addEventListener('keydown', e => {
      if (e.key === 'Escape' && el.search.value) { el.search.value = ''; onSearchInput(); }
    });
    el.title.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.body.focus(); }
    });

    el.list.addEventListener('click', e => {
      const li = e.target.closest('li[data-id]');
      if (li) selectNote(Number(li.dataset.id), false);
    });
    el.list.addEventListener('keydown', e => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNote(Number(li.dataset.id), true); }
      else if (e.key === 'ArrowDown' && li.nextElementSibling) { e.preventDefault(); li.nextElementSibling.focus(); }
      else if (e.key === 'ArrowUp' && li.previousElementSibling) { e.preventDefault(); li.previousElementSibling.focus(); }
    });

    el.menuBtn.addEventListener('click', () => toggleMenu());
    document.addEventListener('click', e => {
      if (!el.menu.hidden && !e.target.closest('.menu')) closeMenu();
    });
    el.createFileBtn.addEventListener('click', createFile);
    el.openFileBtn.addEventListener('click', openFile);
    el.disconnectBtn.addEventListener('click', disconnectFile);
    el.downloadBtn.addEventListener('click', downloadCopy);
    el.importBtn.addEventListener('click', startImport);
    el.importInput.addEventListener('change', importFromInput);

    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); persistNow(); }
      else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
      else if (e.key === 'Escape') {
        if (!el.menu.hidden) closeMenu();
        else if (isNarrow() && document.body.classList.contains('view-editor')) showEditorView(false);
      }
    });

    window.addEventListener('beforeunload', e => {
      if (state.editSeq !== state.savedSeq) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) persistNow(); });
    window.addEventListener('pagehide', () => persistNow());
  }

  boot().catch(e => {
    console.error(e);
    bootError('NoNotes konnte nicht starten.\n' + (e && e.message ? e.message : e));
  });
})();
