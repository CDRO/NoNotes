/* NoNotes – Oberfläche und Ablauf. */
(function () {
  'use strict';

  const DB = window.NoNotesDB;
  const Store = window.NoNotesStorage;
  const Mindmap = window.NoNotesMindmap;

  const DEFAULT_FILENAME = 'NoNotes.sqlite';
  const SAVE_DELAY_MS = 600;
  const SEARCH_DELAY_MS = 120;
  const VIEW_KEY = 'nonotes.view';

  const $ = sel => document.querySelector(sel);
  const el = {
    app: $('#app'), boot: $('#boot'), version: $('#version'), status: $('#status'),
    storageInfo: $('#storageInfo'), banner: $('#banner'),
    menuBtn: $('#menuBtn'), menu: $('#menu'), menuHint: $('#menuHint'),
    createFileBtn: $('#createFileBtn'), openFileBtn: $('#openFileBtn'), disconnectBtn: $('#disconnectBtn'),
    downloadBtn: $('#downloadBtn'), importBtn: $('#importBtn'), importInput: $('#importInput'),
    viewMapBtn: $('#viewMapBtn'), viewListBtn: $('#viewListBtn'),
    mapView: $('#mapView'), mapNewBtn: $('#mapNewBtn'), mapFitBtn: $('#mapFitBtn'),
    mapZoomInBtn: $('#mapZoomInBtn'), mapZoomOutBtn: $('#mapZoomOutBtn'),
    mindmap: $('#mindmap'), renameInput: $('#renameInput'), contextMenu: $('#contextMenu'),
    search: $('#search'), newBtn: $('#newBtn'), list: $('#list'), listEmpty: $('#listEmpty'), count: $('#count'),
    editorEmpty: $('#editorEmpty'), editorPane: $('#editorPane'), backBtn: $('#backBtn'),
    crumbs: $('#crumbs'), noteMeta: $('#noteMeta'), childBtn: $('#childBtn'), deleteBtn: $('#deleteBtn'),
    title: $('#title'), body: $('#body'),
  };

  const state = {
    SQL: null,
    db: null,
    currentId: null,
    query: '',
    view: 'map',
    map: null,
    mapDirty: true,
    mapSelection: null,   // 'root' | Zahl | null
    rename: null,         // { id, isNew }
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

  function isEditorOpen() { return document.body.classList.contains('editor-open'); }

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

    state.map = Mindmap.create(el.mindmap, {
      onSelect: id => { state.mapSelection = id; },
      onOpen: id => openNote(id),
      onOpenRoot: () => beginRename('root'),
      onReparent: (id, parentId) => reparentNote(id, parentId),
      onToggleCollapse: id => toggleCollapse(id),
      onContextMenu: (id, x, y) => showNodeMenu(id, x, y),
    });

    wireEvents();

    let view = 'map';
    try { view = localStorage.getItem(VIEW_KEY) || 'map'; } catch (e) { /* egal */ }

    el.boot.hidden = true;
    el.app.hidden = false;
    setView(view === 'list' ? 'list' : 'map');
    renderAll();
    updateStorageInfo();
    if (state.fileHandle && state.filePermission !== 'granted') showConnectBanner();
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
    state.mapDirty = true;
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
    state.mapSelection = null;
    state.mapDirty = true;
    el.search.value = '';
    showEditorView(false);
    document.body.classList.remove('editor-open');
    if (state.map) state.map.requestFit();
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

  // ---------- Ansichten ----------

  function setView(view) {
    state.view = view;
    document.body.classList.toggle('view-map', view === 'map');
    document.body.classList.toggle('view-list', view === 'list');
    el.viewMapBtn.setAttribute('aria-selected', String(view === 'map'));
    el.viewListBtn.setAttribute('aria-selected', String(view === 'list'));
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* egal */ }
    document.body.classList.remove('editor-open');
    hideContextMenu();
    cancelRename();
    if (view === 'map') {
      renderMap();
      el.mindmap.focus({ preventScroll: true });
    } else {
      renderList();
      renderEditor();
    }
  }

  // ---------- Darstellung ----------

  function renderAll() {
    renderList();
    renderEditor();
    renderCount();
    renderMap();
  }

  function renderMap() {
    if (!state.map || state.view !== 'map' || isEditorOpen()) { state.mapDirty = true; return; }
    if (!el.mindmap.getBoundingClientRect().width) { state.mapDirty = true; return; }
    state.map.render(DB.getTree(state.db), { mapTitle: DB.getMapTitle(state.db) });
    state.map.setSelected(state.mapSelection);
    state.mapDirty = false;
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
    if (!note || note.deleted_at) {
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
    renderCrumbs(note);
  }

  function renderMeta(createdAt, updatedAt) {
    el.noteMeta.textContent = `Erstellt ${fmtDate(createdAt)} · Geändert ${fmtDate(updatedAt)}`;
  }

  function renderCrumbs(note) {
    const path = DB.getPath(state.db, note.id);
    const frag = document.createDocumentFragment();
    const add = (label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', onClick);
      frag.appendChild(b);
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      frag.appendChild(sep);
    };
    add(DB.getMapTitle(state.db), () => {
      if (state.view === 'map') { closeEditor(); state.mapSelection = 'root'; state.map.setSelected('root'); }
    });
    for (const p of path) add(p.title.trim() || 'Ohne Titel', () => openNote(p.id));
    el.crumbs.replaceChildren(frag);
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

  // ---------- Notiz-Aktionen ----------

  function selectNote(id, focusEditor) {
    state.currentId = id;
    setActiveItem(id);
    renderEditor();
    if (isNarrow()) showEditorView(true);
    if (focusEditor) (el.title.value ? el.body : el.title).focus();
  }

  /** Öffnet eine Notiz im Editor: in der Liste rechts, aus der Mindmap als Vollbild. */
  function openNote(id) {
    hideContextMenu();
    state.currentId = id;
    if (state.view === 'map') {
      state.mapSelection = id;
      document.body.classList.add('editor-open');
      renderEditor();
      (el.title.value ? el.body : el.title).focus();
    } else {
      selectNote(id, true);
    }
  }

  function closeEditor() {
    if (!isEditorOpen()) { showEditorView(false); return; }
    document.body.classList.remove('editor-open');
    if (state.view === 'map') {
      if (state.currentId != null) state.mapSelection = state.currentId;
      renderMap();
      el.mindmap.focus({ preventScroll: true });
    }
  }

  function newNote() {
    const parentId = state.view === 'map' ? selectionAsParent() : null;
    if (state.view === 'map') { newNoteInMap(parentId); return; }
    const id = DB.createNote(state.db, null);
    state.currentId = id;
    if (state.query) { state.query = ''; el.search.value = ''; }
    renderAll();
    markEdited();
    if (isNarrow()) showEditorView(true);
    el.title.focus();
  }

  function selectionAsParent() {
    return typeof state.mapSelection === 'number' ? state.mapSelection : null;
  }

  function newNoteInMap(parentId) {
    hideContextMenu();
    if (parentId != null) {
      const info = state.map.nodeInfo(parentId);
      if (info && info.collapsed) DB.setCollapsed(state.db, parentId, false);
    }
    const id = DB.createNote(state.db, parentId);
    state.mapSelection = id;
    markEdited();
    renderMap();
    renderCount();
    state.map.ensureVisible(id);
    beginRename(id, { isNew: true });
  }

  function newChildOfCurrent() {
    if (state.currentId == null) return;
    const parentId = state.currentId;
    const id = DB.createNote(state.db, parentId);
    const info = state.map.nodeInfo(parentId);
    if (info && info.collapsed) DB.setCollapsed(state.db, parentId, false);
    state.currentId = id;
    state.mapSelection = id;
    markEdited();
    renderList();
    renderCount();
    renderEditor();
    el.title.focus();
  }

  function onEdit() {
    if (state.currentId == null) return;
    const ts = DB.updateNote(state.db, state.currentId, el.title.value, el.body.value);
    renderMeta(DB.getNote(state.db, state.currentId).created_at, ts);
    updateListItem(state.currentId, el.title.value, el.body.value, ts);
    markEdited();
  }

  function deleteNoteById(id) {
    hideContextMenu();
    const note = DB.getNote(state.db, id);
    if (!note) return;
    const name = note.title.trim() ? `„${note.title.trim()}“` : 'diese Notiz';
    const info = state.map ? state.map.nodeInfo(id) : null;
    const kids = info ? info.childCount : 0;
    const hint = kids ? `\n\n${kids === 1 ? 'Die Unternotiz rückt' : kids + ' Unternotizen rücken'} zum übergeordneten Knoten auf.` : '';
    if (!confirm(`Soll ${name} gelöscht werden?${hint}`)) return;

    const parentId = note.parent_id;
    let nextInList = null;
    const li = el.list.querySelector(`li[data-id="${id}"]`);
    const neighbour = li && (li.nextElementSibling || li.previousElementSibling);
    if (neighbour) nextInList = Number(neighbour.dataset.id);

    DB.deleteNote(state.db, id);

    if (state.currentId === id) {
      state.currentId = state.view === 'list' ? nextInList : null;
      if (state.view === 'map') document.body.classList.remove('editor-open');
    }
    state.mapSelection = parentId == null ? 'root' : parentId;
    renderAll();
    markEdited();
    if (state.currentId == null) showEditorView(false);
    if (state.view === 'map') el.mindmap.focus({ preventScroll: true });
  }

  function reparentNote(id, parentId) {
    try {
      DB.setParent(state.db, id, parentId);
      if (parentId != null) {
        const info = state.map.nodeInfo(parentId);
        if (info && info.collapsed) DB.setCollapsed(state.db, parentId, false);
      }
      state.mapSelection = id;
      markEdited();
      renderMap();
      if (state.currentId === id) renderEditor();
    } catch (e) {
      setStatus(e.message, 'error');
      renderMap();
    }
  }

  function toggleCollapse(id) {
    const info = state.map.nodeInfo(id);
    if (!info || info.isRoot) return;
    DB.setCollapsed(state.db, id, !info.collapsed);
    if (info.collapsed === false && typeof state.mapSelection === 'number'
        && state.mapSelection !== id && isInSubtree(state.mapSelection, id)) {
      state.mapSelection = id;
    }
    markEdited();
    renderMap();
  }

  function isInSubtree(nodeId, ancestorId) {
    let n = state.map.nodeInfo(nodeId);
    const seen = new Set();
    while (n && !n.isRoot && !seen.has(n.id)) {
      if (n.id === ancestorId) return true;
      seen.add(n.id);
      n = n.parentId == null ? null : state.map.nodeInfo(n.parentId);
    }
    return false;
  }

  function moveSelected(direction) {
    if (typeof state.mapSelection !== 'number') return;
    if (DB.moveAmongSiblings(state.db, state.mapSelection, direction)) {
      markEdited();
      renderMap();
    }
  }

  function setAllCollapsed(collapsed) {
    hideContextMenu();
    DB.setAllCollapsed(state.db, collapsed);
    if (collapsed) state.mapSelection = typeof state.mapSelection === 'number' ? state.mapSelection : state.mapSelection;
    markEdited();
    renderMap();
    state.map.fit();
  }

  // ---------- Umbenennen direkt im Knoten ----------

  function beginRename(id, opts) {
    hideContextMenu();
    cancelRename();
    const rect = state.map.screenRectOf(id);
    if (!rect) return;
    state.rename = { id, isNew: !!(opts && opts.isNew) };
    const input = el.renameInput;
    const width = Math.max(rect.width, 180);
    input.style.left = `${rect.left + rect.width / 2 - width / 2}px`;
    input.style.top = `${rect.top}px`;
    input.style.width = `${width}px`;
    input.style.height = `${rect.height}px`;
    input.style.fontSize = `${Math.max(11, Math.round(rect.height * 0.41))}px`;
    input.value = id === 'root' ? DB.getMapTitle(state.db) : (DB.getNote(state.db, id) || {}).title || '';
    input.hidden = false;
    input.focus();
    input.select();
  }

  function commitRename() {
    const r = state.rename;
    if (!r) return;
    state.rename = null;
    const value = el.renameInput.value.trim();
    el.renameInput.hidden = true;
    if (r.id === 'root') {
      DB.setMapTitle(state.db, value);
    } else if (r.isNew && !value) {
      DB.purgeNote(state.db, r.id);
      state.mapSelection = null;
    } else {
      DB.renameNote(state.db, r.id, value);
      state.mapSelection = r.id;
    }
    markEdited();
    renderAll();
    if (state.currentId === r.id) renderEditor();
    el.mindmap.focus({ preventScroll: true });
  }

  function cancelRename() {
    const r = state.rename;
    if (!r) return;
    state.rename = null;
    el.renameInput.hidden = true;
    if (r.isNew && r.id !== 'root') {
      DB.purgeNote(state.db, r.id);
      state.mapSelection = null;
      markEdited();
      renderAll();
    }
    el.mindmap.focus({ preventScroll: true });
  }

  // ---------- Kontextmenü ----------

  function showContextMenu(items, x, y) {
    const menu = el.contextMenu;
    menu.replaceChildren();
    for (const item of items) {
      if (item === 'sep') {
        const s = document.createElement('div');
        s.className = 'sep';
        menu.appendChild(s);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      const label = document.createElement('span');
      label.textContent = item.label;
      b.appendChild(label);
      if (item.key) {
        const k = document.createElement('span');
        k.className = 'key';
        k.textContent = item.key;
        b.appendChild(k);
      }
      if (item.danger) b.classList.add('danger');
      b.addEventListener('click', () => { hideContextMenu(); item.action(); });
      menu.appendChild(b);
    }
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - h - 8)}px`;
  }

  function hideContextMenu() {
    el.contextMenu.hidden = true;
  }

  function showNodeMenu(id, x, y) {
    if (id == null) {
      showContextMenu([
        { label: 'Neue Notiz', key: 'Tab', action: () => newNoteInMap(null) },
        { label: 'Einpassen', key: '0', action: () => state.map.fit() },
        'sep',
        { label: 'Alles ausklappen', action: () => setAllCollapsed(false) },
        { label: 'Alles einklappen', action: () => setAllCollapsed(true) },
      ], x, y);
      return;
    }
    if (id === 'root') {
      showContextMenu([
        { label: 'Neue Notiz', key: 'Tab', action: () => newNoteInMap(null) },
        { label: 'Titel ändern', key: 'F2', action: () => beginRename('root') },
        'sep',
        { label: 'Alles ausklappen', action: () => setAllCollapsed(false) },
        { label: 'Alles einklappen', action: () => setAllCollapsed(true) },
        { label: 'Einpassen', key: '0', action: () => state.map.fit() },
      ], x, y);
      return;
    }
    const info = state.map.nodeInfo(id);
    const items = [
      { label: 'Öffnen', key: 'Enter', action: () => openNote(id) },
      { label: 'Unternotiz anlegen', key: 'Tab', action: () => newNoteInMap(id) },
      { label: 'Umbenennen', key: 'F2', action: () => beginRename(id) },
    ];
    if (info && info.childCount) {
      items.push({ label: info.collapsed ? 'Ausklappen' : 'Einklappen', action: () => toggleCollapse(id) });
    }
    items.push(
      { label: 'Nach oben', key: 'Alt+↑', action: () => { state.mapSelection = id; moveSelected(-1); } },
      { label: 'Nach unten', key: 'Alt+↓', action: () => { state.mapSelection = id; moveSelected(1); } },
      'sep',
      { label: 'Löschen', key: 'Entf', danger: true, action: () => deleteNoteById(id) },
    );
    showContextMenu(items, x, y);
  }

  // ---------- Suche, Menü ----------

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

  // ---------- Tastatur in der Mindmap ----------

  function onMapKeydown(e) {
    if (state.rename) return;
    const sel = state.mapSelection;
    const key = e.key;
    if (key === 'Tab') {
      e.preventDefault();
      newNoteInMap(selectionAsParent());
    } else if (key === 'Enter') {
      e.preventDefault();
      if (typeof sel === 'number') openNote(sel);
      else if (sel === 'root') beginRename('root');
    } else if (key === 'F2') {
      e.preventDefault();
      if (sel != null) beginRename(sel);
    } else if (key === 'Delete' || key === 'Backspace') {
      if (typeof sel === 'number') { e.preventDefault(); deleteNoteById(sel); }
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault();
      if (e.altKey) { moveSelected(key === 'ArrowUp' ? -1 : 1); return; }
      moveSelection(key === 'ArrowUp' ? 'up' : 'down');
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      moveSelection(key === 'ArrowLeft' ? 'left' : 'right');
    } else if (key === '+' || key === '=') {
      e.preventDefault(); state.map.zoomIn();
    } else if (key === '-') {
      e.preventDefault(); state.map.zoomOut();
    } else if (key === '0') {
      e.preventDefault(); state.map.fit();
    } else if (key === 'Escape') {
      if (!el.contextMenu.hidden) { hideContextMenu(); return; }
      state.mapSelection = null;
      state.map.setSelected(null);
    }
  }

  function moveSelection(direction) {
    const from = state.mapSelection == null ? 'root' : state.mapSelection;
    const next = state.mapSelection == null ? 'root' : state.map.neighbor(from, direction);
    if (next == null) return;
    state.mapSelection = next;
    state.map.setSelected(next);
    state.map.ensureVisible(next);
  }

  // ---------- Ereignisse ----------

  function wireEvents() {
    el.viewMapBtn.addEventListener('click', () => setView('map'));
    el.viewListBtn.addEventListener('click', () => setView('list'));

    el.newBtn.addEventListener('click', newNote);
    el.mapNewBtn.addEventListener('click', () => newNoteInMap(selectionAsParent()));
    el.mapFitBtn.addEventListener('click', () => state.map.fit());
    el.mapZoomInBtn.addEventListener('click', () => state.map.zoomIn());
    el.mapZoomOutBtn.addEventListener('click', () => state.map.zoomOut());
    el.mindmap.addEventListener('keydown', onMapKeydown);

    el.renameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
      e.stopPropagation();
    });
    el.renameInput.addEventListener('blur', () => { if (state.rename) commitRename(); });

    el.childBtn.addEventListener('click', newChildOfCurrent);
    el.deleteBtn.addEventListener('click', () => { if (state.currentId != null) deleteNoteById(state.currentId); });
    el.backBtn.addEventListener('click', closeEditor);
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
      if (!el.contextMenu.hidden && !e.target.closest('.context-menu')) hideContextMenu();
    });
    document.addEventListener('contextmenu', e => {
      if (!e.target.closest('#mindmap')) hideContextMenu();
    });
    window.addEventListener('resize', () => { hideContextMenu(); if (state.rename) cancelRename(); });
    window.addEventListener('blur', hideContextMenu);

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
        if (state.rename) return;
        if (!el.contextMenu.hidden) { hideContextMenu(); return; }
        if (!el.menu.hidden) { closeMenu(); return; }
        if (isEditorOpen()) { closeEditor(); return; }
        if (isNarrow() && document.body.classList.contains('view-editor')) showEditorView(false);
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
