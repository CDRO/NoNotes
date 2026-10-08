/* NoNotes – Oberfläche und Ablauf. */
(function () {
  'use strict';

  const DB = window.NoNotesDB;
  const Store = window.NoNotesStorage;
  const Mindmap = window.NoNotesMindmap;
  const Q = window.NoNotesQuestions;
  const M = window.NoNotesMarkdown;
  const Zip = window.NoNotesZip;
  const Exporter = window.NoNotesExport;
  const Printer = window.NoNotesPrint;
  const E = window.NoNotesEditing;
  const T = window.NoNotesTasks;
  const Dates = window.NoNotesDates;

  const DEFAULT_FILENAME = 'NoNotes.sqlite';
  const SAVE_DELAY_MS = 600;
  const SEARCH_DELAY_MS = 120;
  const VIEW_KEY = 'nonotes.view';
  const MODE_KEY = 'nonotes.editorMode';
  const PREVIEW_DELAY_MS = 150;

  const $ = sel => document.querySelector(sel);
  const el = {
    app: $('#app'), boot: $('#boot'), version: $('#version'), status: $('#status'),
    storageInfo: $('#storageInfo'), banner: $('#banner'),
    menuBtn: $('#menuBtn'), menu: $('#menu'), menuHint: $('#menuHint'),
    createFileBtn: $('#createFileBtn'), openFileBtn: $('#openFileBtn'), disconnectBtn: $('#disconnectBtn'),
    downloadBtn: $('#downloadBtn'), importBtn: $('#importBtn'), importInput: $('#importInput'),
    viewMapBtn: $('#viewMapBtn'), viewListBtn: $('#viewListBtn'), viewQuestionsBtn: $('#viewQuestionsBtn'),
    questionsView: $('#questionsView'), qFilter: $('#qFilter'), qSearch: $('#qSearch'),
    qList: $('#qList'), qEmpty: $('#qEmpty'), qCount: $('#qCount'),
    questionBtn: $('#questionBtn'), answerBtn: $('#answerBtn'), noteQuestions: $('#noteQuestions'),
    mapSearch: $('#mapSearch'), mapMatches: $('#mapMatches'), qTagFilter: $('#qTagFilter'),
    listScope: $('#listScope'), tagFilter: $('#tagFilter'), emptyTrashBtn: $('#emptyTrashBtn'),
    editor: $('#editor'), trashBar: $('#trashBar'), restoreBtn: $('#restoreBtn'), purgeBtn: $('#purgeBtn'),
    tagChips: $('#tagChips'), tagInput: $('#tagInput'), tagSuggestions: $('#tagSuggestions'),
    modeSwitch: $('#modeSwitch'), preview: $('#preview'),
    exportBtn: $('#exportBtn'), exportDialog: $('#exportDialog'), exportForm: $('#exportForm'),
    exportDirBtn: $('#exportDirBtn'), exportZipBtn: $('#exportZipBtn'), exportHint: $('#exportHint'),
    attachBtn: $('#attachBtn'), attachInput: $('#attachInput'), attachments: $('#attachments'),
    mapPrintBtn: $('#mapPrintBtn'), qPrintBtn: $('#qPrintBtn'), printBtn: $('#printBtn'),
    multiBar: $('#multiBar'), multiCount: $('#multiCount'), multiPrintBtn: $('#multiPrintBtn'), multiClearBtn: $('#multiClearBtn'),
    printDialog: $('#printDialog'), printForm: $('#printForm'), printGoBtn: $('#printGoBtn'),
    printScopeCurrent: $('#printScopeCurrent'), printScopeSubtree: $('#printScopeSubtree'),
    printScopeSelection: $('#printScopeSelection'), printScopeAll: $('#printScopeAll'),
    printSelectionChildren: $('#printSelectionChildren'), printIncludeMap: $('#printIncludeMap'),
    printIncludeToc: $('#printIncludeToc'), printPageBreaks: $('#printPageBreaks'),
    qaPrintDialog: $('#qaPrintDialog'), qaPrintForm: $('#qaPrintForm'), qaPrintGoBtn: $('#qaPrintGoBtn'),
    qaScopeFiltered: $('#qaScopeFiltered'), qaLines: $('#qaLines'), qSort: $('#qSort'),
    mdToolbar: $('#mdToolbar'), headingSelect: $('#headingSelect'), helpBtn: $('#helpBtn'),
    helpDialog: $('#helpDialog'), helpTabs: $('#helpTabs'), helpStorageStatus: $('#helpStorageStatus'),
    storageHelpBtn: $('#storageHelpBtn'), menuHelpBtn: $('#menuHelpBtn'),
    viewTasksBtn: $('#viewTasksBtn'), tasksView: $('#tasksView'), tFilter: $('#tFilter'), tSort: $('#tSort'),
    tSearch: $('#tSearch'), tTagFilter: $('#tTagFilter'), tPrintBtn: $('#tPrintBtn'), tCount: $('#tCount'),
    tList: $('#tList'), tEmpty: $('#tEmpty'),
    taskPrintDialog: $('#taskPrintDialog'), taskPrintForm: $('#taskPrintForm'), taskPrintGoBtn: $('#taskPrintGoBtn'),
    taskScopeFiltered: $('#taskScopeFiltered'),
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
    qStatus: 'open',
    qSort: 'due',
    qQuery: '',
    qSearchTimer: null,
    qAnswering: null,     // id der Frage, deren Antwortfeld offen ist
    qDraft: null,         // Entwurf im offenen Antwortfeld (überlebt ein Neuzeichnen)
    qTag: '',
    editorMode: 'edit',   // 'edit' | 'split' | 'preview'
    previewTimer: null,
    listScope: 'live',    // 'live' | 'trash'
    tagFilter: '',
    mapMatches: [],       // ids der Treffer in der Mindmap (Reihenfolge wie Liste)
    mapMatchIndex: -1,
    mapSearchTimer: null,
    attachmentUrls: new Map(), // id → Objekt-URL für die Anzeige
    multi: new Set(),          // Mehrfachauswahl (Mindmap und Liste)
    printNoteId: null,         // Notiz, auf die sich der Druckdialog bezieht
    tStatus: 'open',
    tSort: 'due',
    tQuery: '',
    tTag: '',
    tSearchTimer: null,
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
      onSelect: (id, opts) => {
        if (opts && opts.toggle && typeof id === 'number') { toggleMulti(id); return; }
        state.mapSelection = id;
      },
      onOpen: id => openNote(id),
      onOpenRoot: () => beginRename('root'),
      onReparent: (id, parentId, where) => moveNoteTo(id, parentId, where),
      onToggleCollapse: id => toggleCollapse(id),
      onContextMenu: (id, x, y) => showNodeMenu(id, x, y),
    });

    wireEvents();

    let view = 'map';
    let mode = 'edit';
    try {
      view = localStorage.getItem(VIEW_KEY) || 'map';
      mode = localStorage.getItem(MODE_KEY) || 'edit';
    } catch (e) { /* egal */ }
    setEditorMode(['edit', 'split', 'preview'].includes(mode) ? mode : 'edit');

    el.boot.hidden = true;
    el.app.hidden = false;
    setView(['list', 'questions', 'tasks'].includes(view) ? view : 'map');
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
    for (const id of [...state.attachmentUrls.keys()]) forgetAttachmentUrl(id);
    if (state.db) { try { state.db.close(); } catch (e) { /* egal */ } }
    state.db = newDb;
    state.currentId = null;
    state.query = '';
    state.mapSelection = null;
    state.mapDirty = true;
    state.tagFilter = '';
    state.qTag = '';
    state.listScope = 'live';
    el.listScope.value = 'live';
    el.search.value = '';
    el.mapSearch.value = '';
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

  // ---------- Export ----------

  function openExportDialog() {
    closeMenu();
    el.exportDirBtn.hidden = typeof window.showDirectoryPicker !== 'function';
    el.exportHint.textContent = el.exportDirBtn.hidden
      ? 'Dieser Browser kann nicht direkt in Ordner schreiben; das ZIP enthält dieselben Dateien.'
      : '';
    if (typeof el.exportDialog.showModal === 'function') el.exportDialog.showModal();
    else el.exportDialog.setAttribute('open', '');
  }

  function closeExportDialog() {
    if (el.exportDialog.open) el.exportDialog.close();
  }

  async function runExport(target) {
    const mode = (el.exportForm.querySelector('input[name="exportMode"]:checked') || {}).value || 'folder';
    el.exportHint.textContent = 'Export wird vorbereitet…';
    el.exportDirBtn.disabled = true;
    el.exportZipBtn.disabled = true;
    try {
      const svg = Exporter.renderSvg(state.db);
      let png = null;
      try { png = await Exporter.svgToPng(svg, 2); }
      catch (e) { console.warn('PNG', e); }
      const files = Exporter.buildFiles(state.db, { mode, svg, png, version: window.NONOTES_VERSION || 'dev' });
      const n = files.length;
      if (target === 'dir') {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        await Exporter.writeToDirectory(dir, files);
        closeExportDialog();
        setStatus(`Export gespeichert: ${n} Dateien in „${dir.name}“` + (png ? '' : ' (ohne PNG)'), state.editSeq === state.savedSeq ? 'saved' : 'dirty');
      } else {
        const bytes = Zip.create(files);
        Store.download(bytes, Exporter.suggestedZipName(state.db));
        closeExportDialog();
        setStatus(`Export als ZIP heruntergeladen (${n} Dateien)` + (png ? '' : ', ohne PNG'), state.editSeq === state.savedSeq ? 'saved' : 'dirty');
      }
    } catch (e) {
      if (isAbort(e)) { el.exportHint.textContent = ''; return; }
      console.error(e);
      el.exportHint.textContent = 'Export fehlgeschlagen: ' + e.message;
    } finally {
      el.exportDirBtn.disabled = false;
      el.exportZipBtn.disabled = false;
    }
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
    document.body.classList.toggle('view-questions', view === 'questions');
    document.body.classList.toggle('view-tasks', view === 'tasks');
    el.viewMapBtn.setAttribute('aria-selected', String(view === 'map'));
    el.viewListBtn.setAttribute('aria-selected', String(view === 'list'));
    el.viewQuestionsBtn.setAttribute('aria-selected', String(view === 'questions'));
    el.viewTasksBtn.setAttribute('aria-selected', String(view === 'tasks'));
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* egal */ }
    document.body.classList.remove('editor-open');
    hideContextMenu();
    cancelRename();
    if (view === 'map') {
      renderMap();
      el.mindmap.focus({ preventScroll: true });
    } else if (view === 'questions') {
      renderQuestions();
    } else if (view === 'tasks') {
      renderTasks();
    } else {
      renderList();
      renderEditor();
    }
    renderMulti();
  }

  /** Zeichnet die aktive Ansicht neu (nach Schliessen des Editors oder Änderungen). */
  function renderCurrentView() {
    if (state.view === 'map') renderMap();
    else if (state.view === 'questions') renderQuestions();
    else if (state.view === 'tasks') renderTasks();
    else { renderList(); renderEditor(); }
  }

  // ---------- Darstellung ----------

  function renderAll() {
    renderTagFilters();
    renderList();
    renderEditor();
    renderCount();
    renderMap();
    renderQuestionCounts();
    renderTaskCounts();
    if (state.view === 'questions') renderQuestions();
    if (state.view === 'tasks') renderTasks();
  }

  function renderTaskCounts() {
    const c = DB.countTasks(state.db, Dates.nowIso());
    el.viewTasksBtn.replaceChildren();
    el.viewTasksBtn.append('Aufgaben');
    if (c.open > 0) {
      const b = document.createElement('span');
      b.className = 'count tasks' + (c.overdue > 0 ? ' overdue' : '');
      b.textContent = String(c.open);
      b.title = (c.open === 1 ? '1 offene Aufgabe' : `${c.open} offene Aufgaben`) + (c.overdue ? `, ${c.overdue} überfällig` : '');
      el.viewTasksBtn.appendChild(b);
    }
  }

  function renderTagFilters() {
    const tags = DB.listAllTags(state.db);
    const fill = (select, current) => {
      const frag = document.createDocumentFragment();
      const all = document.createElement('option');
      all.value = '';
      all.textContent = 'Alle Tags';
      frag.appendChild(all);
      for (const t of tags) {
        const o = document.createElement('option');
        o.value = t.name;
        o.textContent = `${t.name} (${t.count})`;
        frag.appendChild(o);
      }
      select.replaceChildren(frag);
      select.value = tags.some(t => t.name === current) ? current : '';
      return select.value;
    };
    state.tagFilter = fill(el.tagFilter, state.tagFilter);
    state.qTag = fill(el.qTagFilter, state.qTag);
    state.tTag = fill(el.tTagFilter, state.tTag);
    const mine = new Set((state.currentId != null ? DB.getTags(state.db, state.currentId) : []).map(t => t.toLowerCase()));
    el.tagSuggestions.replaceChildren(...tags.filter(t => !mine.has(t.name.toLowerCase())).map(t => {
      const o = document.createElement('option');
      o.value = t.name;
      return o;
    }));
  }

  function renderQuestionCounts() {
    const c = DB.countQuestions(state.db, Dates.nowIso());
    el.viewQuestionsBtn.replaceChildren();
    el.viewQuestionsBtn.append('Fragen');
    if (c.open > 0) {
      const b = document.createElement('span');
      b.className = 'count' + (c.overdue > 0 ? ' q-overdue' : '');
      b.textContent = String(c.open);
      b.title = (c.open === 1 ? '1 offene Frage' : `${c.open} offene Fragen`) + (c.overdue ? `, ${c.overdue} überfällig` : '');
      el.viewQuestionsBtn.appendChild(b);
    }
  }

  function renderMap() {
    if (!state.map || state.view !== 'map' || isEditorOpen()) { state.mapDirty = true; return; }
    if (!el.mindmap.getBoundingClientRect().width) { state.mapDirty = true; return; }
    let matchIds = null;
    if (state.query.trim()) {
      state.mapMatches = DB.listNotes(state.db, state.query).map(r => r.id);
      matchIds = new Set(state.mapMatches);
      el.mapMatches.hidden = false;
      el.mapMatches.textContent = state.mapMatches.length === 1 ? '1 Treffer' : `${state.mapMatches.length} Treffer`;
    } else {
      state.mapMatches = [];
      state.mapMatchIndex = -1;
      el.mapMatches.hidden = true;
    }
    pruneMulti();
    state.map.render(DB.getTree(state.db), { mapTitle: DB.getMapTitle(state.db), matchIds });
    state.map.setSelected(state.mapSelection);
    state.map.setMulti(state.multi);
    state.mapDirty = false;
  }

  // ---------- Mehrfachauswahl ----------

  function pruneMulti() {
    for (const id of [...state.multi]) {
      const n = DB.getNote(state.db, id);
      if (!n || n.deleted_at) state.multi.delete(id);
    }
  }

  function toggleMulti(id) {
    if (state.multi.has(id)) state.multi.delete(id); else state.multi.add(id);
    renderMulti();
  }

  function clearMulti() {
    state.multi.clear();
    renderMulti();
  }

  function renderMulti() {
    const n = state.multi.size;
    el.multiBar.hidden = n === 0 || state.view === 'questions' || state.view === 'tasks';
    el.multiCount.textContent = n === 1 ? '1 Notiz ausgewählt' : `${n} Notizen ausgewählt`;
    if (state.map) state.map.setMulti(state.multi);
    for (const li of el.list.children) li.classList.toggle('multi', state.multi.has(Number(li.dataset.id)));
  }

  // ---------- Drucken ----------

  function subtreeCount(id) {
    const nodes = Exporter.treeOrder(state.db);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const count = n => 1 + n.children.reduce((s, c) => s + count(c), 0);
    const start = byId.get(id);
    return start ? count(start) : 0;
  }

  /** Öffnet den Druckdialog. opts: { noteId, scope } */
  function openPrintDialog(opts) {
    opts = opts || {};
    hideContextMenu();
    closeMenu();
    const noteId = opts.noteId != null ? opts.noteId : (state.currentId != null && !isHiddenNote(state.currentId) ? state.currentId : (typeof state.mapSelection === 'number' ? state.mapSelection : null));
    state.printNoteId = noteId;
    pruneMulti();
    const note = noteId != null ? DB.getNote(state.db, noteId) : null;
    const title = note ? (note.title.trim() || 'Ohne Titel') : null;
    const sub = noteId != null ? subtreeCount(noteId) : 0;
    const total = DB.countNotes(state.db);
    const radios = Object.fromEntries([...el.printForm.querySelectorAll('input[name="printScope"]')].map(r => [r.value, r]));

    radios.current.disabled = !note;
    radios.subtree.disabled = !note || sub <= 1;
    radios.selection.disabled = state.multi.size === 0;
    el.printScopeCurrent.textContent = note ? `Diese Notiz: „${title}“` : 'Diese Notiz';
    el.printScopeSubtree.textContent = note ? `„${title}“ mit Unternotizen (${sub})` : 'Diese Notiz mit Unternotizen';
    el.printScopeSelection.textContent = state.multi.size ? `Ausgewählte Notizen (${state.multi.size})` : 'Ausgewählte Notizen (keine Auswahl)';
    el.printScopeAll.textContent = `Alle Notizen (${total})`;

    let scope = opts.scope;
    if (!scope || radios[scope].disabled) {
      scope = state.multi.size ? 'selection' : note ? (sub > 1 ? 'subtree' : 'current') : 'all';
    }
    radios[scope].checked = true;
    if (typeof el.printDialog.showModal === 'function') el.printDialog.showModal();
    else el.printDialog.setAttribute('open', '');
  }

  function isHiddenNote(id) {
    const n = DB.getNote(state.db, id);
    return !n || !!n.deleted_at;
  }

  function runPrint() {
    const scope = (el.printForm.querySelector('input[name="printScope"]:checked') || {}).value || 'all';
    const html = Printer.buildNotesDocument(state.db, {
      scope: scope === 'current' || scope === 'subtree' ? scope : scope,
      noteId: state.printNoteId,
      ids: [...state.multi],
      withChildren: scope === 'subtree' || (scope === 'selection' && el.printSelectionChildren.checked),
      includeMap: el.printIncludeMap.checked,
      includeToc: el.printIncludeToc.checked,
      pageBreaks: el.printPageBreaks.checked,
      resolveAttachment: id => attachmentUrl(id),
    });
    if (el.printDialog.open) el.printDialog.close();
    Printer.print(html);
  }

  function openQaPrintDialog() {
    hideContextMenu();
    closeMenu();
    const shown = DB.listQuestions(state.db, { status: state.qStatus, query: state.qQuery, tag: state.qTag }).length;
    const label = state.qStatus === 'open' ? 'offene' : state.qStatus === 'answered' ? 'beantwortete' : 'alle';
    el.qaScopeFiltered.textContent = `Wie angezeigt: ${label} Fragen${state.qTag ? `, Tag „${state.qTag}“` : ''}${state.qQuery.trim() ? `, Suche „${state.qQuery.trim()}“` : ''} (${shown})`;
    if (typeof el.qaPrintDialog.showModal === 'function') el.qaPrintDialog.showModal();
    else el.qaPrintDialog.setAttribute('open', '');
  }

  function runQaPrint() {
    const scope = (el.qaPrintForm.querySelector('input[name="qaScope"]:checked') || {}).value || 'filtered';
    const groupBy = (el.qaPrintForm.querySelector('input[name="qaGroup"]:checked') || {}).value || 'note';
    const html = Printer.buildQuestionsDocument(state.db, {
      status: scope === 'filtered' ? state.qStatus : scope,
      tag: scope === 'filtered' ? state.qTag : '',
      query: scope === 'filtered' ? state.qQuery.trim() : '',
      groupBy,
      lines: el.qaLines.checked,
    });
    if (el.qaPrintDialog.open) el.qaPrintDialog.close();
    Printer.print(html);
  }

  /** Springt zum nächsten Treffer der Mindmap-Suche. */
  function nextMapMatch(step) {
    if (!state.mapMatches.length) return;
    state.mapMatchIndex = (state.mapMatchIndex + step + state.mapMatches.length) % state.mapMatches.length;
    const id = state.mapMatches[state.mapMatchIndex];
    // Eingeklappte Vorfahren aufklappen, damit der Treffer sichtbar wird.
    let p = DB.getNote(state.db, id);
    let changed = false;
    while (p && p.parent_id != null) {
      p = DB.getNote(state.db, p.parent_id);
      if (p && p.collapsed) { DB.setCollapsed(state.db, p.id, false); changed = true; }
    }
    if (changed) markEdited();
    state.mapSelection = id;
    renderMap();
    state.map.ensureVisible(id);
    el.mapMatches.textContent = `Treffer ${state.mapMatchIndex + 1} von ${state.mapMatches.length}`;
  }

  /** Textausschnitt um den ersten Treffer herum, sonst Anfang des Textes. */
  function snippetAround(body, query) {
    const flat = (body || '').replace(/\s+/g, ' ').trim();
    const q = (query || '').trim();
    if (!q) return flat.slice(0, 140);
    const idx = flat.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return flat.slice(0, 140);
    const start = Math.max(0, idx - 24);
    return (start > 0 ? '…' : '') + flat.slice(start, start + 140);
  }

  function renderList() {
    const trash = state.listScope === 'trash';
    const notes = DB.listNotes(state.db, state.query, { tag: state.tagFilter, scope: state.listScope });
    const q = state.query.trim();
    const frag = document.createDocumentFragment();
    for (const n of notes) {
      const li = document.createElement('li');
      li.className = 'note-item' + (n.id === state.currentId ? ' active' : '') + (trash ? ' trashed' : '') + (state.multi.has(n.id) ? ' multi' : '');
      li.dataset.id = String(n.id);
      li.tabIndex = 0;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(n.id === state.currentId));

      const t = document.createElement('div');
      t.className = 'note-title';
      t.innerHTML = M.highlightText(n.title.trim() || 'Ohne Titel', q);

      const s = document.createElement('div');
      s.className = 'note-snippet';
      s.innerHTML = M.highlightText(snippetAround(n.body, q) || '…', q);

      const d = document.createElement('div');
      d.className = 'note-date';
      d.textContent = trash && n.deleted_at ? `Gelöscht ${fmtDate(n.deleted_at)}` : fmtDate(n.updated_at);

      li.append(t, s, d);
      if (n.tags) {
        const tags = document.createElement('div');
        tags.className = 'note-tags';
        for (const name of n.tags.split(',')) {
          const chip = document.createElement('span');
          chip.className = 'tag';
          chip.textContent = name;
          tags.appendChild(chip);
        }
        li.appendChild(tags);
      }
      frag.appendChild(li);
    }
    el.list.replaceChildren(frag);

    const empty = notes.length === 0;
    el.listEmpty.hidden = !empty;
    el.listEmpty.textContent = q || state.tagFilter ? 'Keine Treffer.'
      : trash ? 'Der Papierkorb ist leer.'
      : 'Noch keine Notizen. Lege mit „Neue Notiz“ los.';
    el.emptyTrashBtn.hidden = !(trash && DB.countTrash(state.db) > 0);
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
    renderCrumbs(note);
    renderNoteQuestions(note.body);
    renderTags(DB.getTags(state.db, note.id));
    renderAttachments(note.id, !!note.deleted_at);
    const trashed = !!note.deleted_at;
    el.trashBar.hidden = !trashed;
    el.editor.classList.toggle('readonly', trashed);
    el.title.readOnly = trashed;
    el.body.readOnly = trashed;
    el.tagInput.disabled = trashed;
    el.deleteBtn.hidden = trashed;
    el.childBtn.hidden = trashed;
    for (const b of el.mdToolbar.querySelectorAll('button')) b.disabled = trashed;
    el.headingSelect.disabled = trashed;
    if (state.editorMode !== 'edit') renderPreview();
  }

  function renderTags(tags) {
    el.tagChips.replaceChildren(...tags.map(name => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.append(name);
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.title = `Tag „${name}“ entfernen`;
      x.setAttribute('aria-label', `Tag ${name} entfernen`);
      x.addEventListener('click', () => removeTag(name));
      chip.appendChild(x);
      return chip;
    }));
  }

  function currentTags() {
    return [...el.tagChips.querySelectorAll('.chip')].map(c => c.firstChild.textContent);
  }

  function saveTags(tags) {
    if (state.currentId == null) return;
    DB.setTags(state.db, state.currentId, tags);
    renderTags(DB.getTags(state.db, state.currentId));
    markEdited();
    renderTagFilters();
    renderList();
    if (state.view === 'questions') renderQuestions();
  }

  function addTagFromInput() {
    const raw = el.tagInput.value;
    el.tagInput.value = '';
    const parts = raw.split(',').map(DB.normalizeTag).filter(Boolean);
    if (!parts.length) return;
    saveTags(currentTags().concat(parts));
  }

  function removeTag(name) {
    saveTags(currentTags().filter(t => t.toLowerCase() !== name.toLowerCase()));
  }

  // ---------- Anhänge ----------

  const MAX_ATTACHMENT_BYTES = 400 * 1024;
  const MAX_ATTACHMENT_EDGE = 1600;

  function attachmentUrl(id) {
    if (state.attachmentUrls.has(id)) return state.attachmentUrls.get(id);
    const row = DB.getAttachment(state.db, id);
    if (!row) return null;
    const url = URL.createObjectURL(new Blob([row.data], { type: row.mime }));
    state.attachmentUrls.set(id, url);
    return url;
  }

  function forgetAttachmentUrl(id) {
    const url = state.attachmentUrls.get(id);
    if (url) { URL.revokeObjectURL(url); state.attachmentUrls.delete(id); }
  }

  function renderAttachments(noteId, readonly) {
    const rows = DB.listAttachments(state.db, noteId);
    el.attachments.hidden = rows.length === 0;
    el.attachments.replaceChildren(...rows.map(a => {
      const fig = document.createElement('figure');
      fig.className = 'attachment';
      fig.dataset.id = String(a.id);
      const img = document.createElement('img');
      img.src = attachmentUrl(a.id) || '';
      img.alt = a.name;
      img.title = 'In den Text einfügen';
      img.addEventListener('click', () => insertAttachmentRef(a));
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = a.name;
      name.title = `${a.name} · ${Math.round(a.size / 1024)} KB`;
      const row = document.createElement('div');
      row.className = 'row';
      const ins = document.createElement('button');
      ins.type = 'button';
      ins.textContent = 'Einfügen';
      ins.addEventListener('click', () => insertAttachmentRef(a));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger';
      del.textContent = 'Löschen';
      del.addEventListener('click', () => removeAttachment(a));
      if (readonly) { ins.disabled = true; del.disabled = true; }
      row.append(ins, del);
      fig.append(img, name, row);
      return fig;
    }));
  }

  function insertAtCursor(text) {
    const ta = el.body;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || start;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const needsNl = before.length && !before.endsWith('\n') ? '\n' : '';
    const insert = needsNl + text + (after.startsWith('\n') || !after.length ? '' : '\n');
    ta.value = before + insert + after;
    const pos = before.length + insert.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    onEdit();
  }

  function insertAttachmentRef(a) {
    const alt = a.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\[\]]/g, '');
    insertAtCursor(`![${alt}](att:${a.id})`);
  }

  function removeAttachment(a) {
    if (!confirm(`Bild „${a.name}“ aus dieser Notiz entfernen? Verweise im Text zeigen danach ins Leere.`)) return;
    DB.deleteAttachment(state.db, a.id);
    forgetAttachmentUrl(a.id);
    renderAttachments(state.currentId, false);
    markEdited();
    if (state.editorMode !== 'edit') renderPreview();
  }

  /** Verkleinert grosse Bilder, damit die Datenbank handlich bleibt. */
  async function prepareImage(file) {
    const mime = file.type || 'application/octet-stream';
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!mime.startsWith('image/') || mime === 'image/svg+xml' || mime === 'image/gif') return { name: file.name, mime, bytes };
    if (bytes.length <= MAX_ATTACHMENT_BYTES) {
      // Nur verkleinern, wenn das Bild auch sehr gross ist.
      const dims = await imageSize(file).catch(() => null);
      if (!dims || Math.max(dims.w, dims.h) <= MAX_ATTACHMENT_EDGE) return { name: file.name, mime, bytes };
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_ATTACHMENT_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close && bitmap.close();
      const keepPng = mime === 'image/png' && bytes.length <= 2 * MAX_ATTACHMENT_BYTES;
      const outMime = keepPng ? 'image/png' : 'image/jpeg';
      const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Bild konnte nicht verkleinert werden.')), outMime, 0.85));
      const out = new Uint8Array(await blob.arrayBuffer());
      if (out.length >= bytes.length) return { name: file.name, mime, bytes };
      const name = outMime === 'image/jpeg' ? file.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg' : file.name;
      return { name, mime: outMime, bytes: out };
    } catch (e) {
      console.warn('Bild verkleinern', e);
      return { name: file.name, mime, bytes };
    }
  }

  function imageSize(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('kein Bild')); };
      img.src = url;
    });
  }

  async function addAttachments(files) {
    if (state.currentId == null) return;
    const note = DB.getNote(state.db, state.currentId);
    if (!note || note.deleted_at) return;
    const images = [...files].filter(f => f && f.type && f.type.startsWith('image/'));
    if (!images.length) { setStatus('Nur Bilder können angehängt werden.', 'error'); return; }
    setStatus(images.length === 1 ? 'Bild wird eingefügt…' : `${images.length} Bilder werden eingefügt…`, 'saving');
    try {
      for (const file of images) {
        const prepared = await prepareImage(file);
        const id = DB.addAttachment(state.db, state.currentId, {
          name: prepared.name || `bild-${Date.now()}.png`, mime: prepared.mime, bytes: prepared.bytes,
        });
        insertAttachmentRef({ id, name: prepared.name || 'bild' });
      }
      renderAttachments(state.currentId, false);
      markEdited();
    } catch (e) {
      console.error(e);
      setStatus('Bild konnte nicht eingefügt werden: ' + e.message, 'error');
    }
  }

  // ---------- Vorschau ----------

  function setEditorMode(mode) {
    state.editorMode = mode;
    el.editorPane.classList.remove('mode-edit', 'mode-split', 'mode-preview');
    el.editorPane.classList.add('mode-' + mode);
    for (const b of el.modeSwitch.querySelectorAll('button[data-mode]')) {
      b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    }
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* egal */ }
    if (mode !== 'edit' && state.currentId != null) renderPreview();
  }

  function cycleEditorMode() {
    const order = ['edit', 'split', 'preview'];
    setEditorMode(order[(order.indexOf(state.editorMode) + 1) % order.length]);
  }

  function renderPreview() {
    if (state.currentId == null) return;
    const index = DB.titleIndex(state.db);
    el.preview.innerHTML = M.render(el.body.value, {
      highlight: state.query.trim() || null,
      resolveTitle: title => { const id = index.get(title.trim().toLowerCase()); return id == null ? null : id; },
      resolveAttachment: id => attachmentUrl(id),
      interactiveTasks: !el.body.readOnly,
    });
  }

  /** Kästchen in der Vorschau angeklickt: Zeile im Text umschalten. */
  function onPreviewChange(e) {
    const input = e.target.closest('li.task[data-line] input[type="checkbox"]');
    if (!input || state.currentId == null || el.body.readOnly) return;
    const line = Number(input.closest('li').dataset.line);
    el.body.value = T.setDone(el.body.value, line, input.checked);
    onEdit();
    renderPreview();
  }

  function schedulePreview() {
    if (state.editorMode === 'edit') return;
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(renderPreview, PREVIEW_DELAY_MS);
  }

  function onPreviewClick(e) {
    const a = e.target.closest('a');
    if (!a) return;
    if (a.classList.contains('md-wiki')) {
      e.preventDefault();
      if (a.dataset.noteId) { openNote(Number(a.dataset.noteId)); return; }
      const title = a.dataset.title;
      if (!confirm(`Es gibt keine Notiz „${title}“. Jetzt als Unternotiz anlegen?`)) return;
      const id = DB.createNote(state.db, state.currentId);
      DB.renameNote(state.db, id, title);
      markEdited();
      renderAll();
      openNote(id);
    } else if (a.getAttribute('href') === '#') {
      e.preventDefault();
    }
  }

  function renderNoteQuestions(body) {
    const parsed = Q.parse(body);
    const open = parsed.filter(q => !q.answer).length;
    el.noteQuestions.textContent = parsed.length === 0 ? ''
      : open === 0 ? `${parsed.length === 1 ? '1 Frage' : parsed.length + ' Fragen'}, alle beantwortet`
      : `${open === 1 ? '1 offene Frage' : open + ' offene Fragen'} von ${parsed.length}`;
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
    if (state.listScope === 'trash') {
      const t = DB.countTrash(state.db);
      el.count.textContent = t === 1 ? '1 Notiz im Papierkorb' : `${t} Notizen im Papierkorb`;
      return;
    }
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
  function openNote(id, opts) {
    hideContextMenu();
    state.currentId = id;
    if (state.view !== 'list') {
      if (state.view === 'map') state.mapSelection = id;
      document.body.classList.add('editor-open');
      renderEditor();
      (el.title.value ? el.body : el.title).focus();
    } else {
      selectNote(id, true);
    }
    if (opts && typeof opts.line === 'number') jumpToLine(opts.line);
  }

  function jumpToLine(lineIndex) {
    const body = el.body.value;
    const start = Q.offsetOfLine(body, lineIndex);
    let end = body.indexOf('\n', start);
    if (end < 0) end = body.length;
    el.body.focus();
    el.body.setSelectionRange(start, end);
    const lineHeight = parseFloat(getComputedStyle(el.body).lineHeight) || 24;
    el.body.scrollTop = Math.max(0, lineIndex * lineHeight - el.body.clientHeight / 3);
  }

  function closeEditor() {
    if (!isEditorOpen()) { showEditorView(false); return; }
    document.body.classList.remove('editor-open');
    if (state.view === 'map') {
      if (state.currentId != null) state.mapSelection = state.currentId;
      renderMap();
      el.mindmap.focus({ preventScroll: true });
    } else if (state.view === 'questions') {
      renderQuestions();
    } else if (state.view === 'tasks') {
      renderTasks();
    }
  }

  function newNote() {
    const parentId = state.view === 'map' ? selectionAsParent() : null;
    if (state.view === 'map') { newNoteInMap(parentId); return; }
    const id = DB.createNote(state.db, null);
    state.currentId = id;
    if (state.query) { state.query = ''; el.search.value = ''; el.mapSearch.value = ''; }
    if (state.listScope === 'trash') { state.listScope = 'live'; el.listScope.value = 'live'; }
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
    renderNoteQuestions(el.body.value);
    renderQuestionCounts();
    renderTaskCounts();
    schedulePreview();
    markEdited();
  }

  /** Markiert die Zeile(n) unter dem Cursor als Frage ("?") oder Antwort ("!") bzw. hebt es auf. */
  function toggleLine(prefix) {
    runCommand(prefix === '?' ? 'question' : 'answer');
  }

  // ---------- Toolleiste ----------

  function applyEdit(result) {
    el.body.value = result.text;
    el.body.focus();
    el.body.setSelectionRange(result.selStart, result.selEnd);
    onEdit();
  }

  function runCommand(cmd) {
    if (state.currentId == null || el.body.readOnly) return;
    const t = el.body.value;
    const s = el.body.selectionStart || 0;
    const e = el.body.selectionEnd || s;
    let r = null;
    switch (cmd) {
      case 'bold': r = E.wrap(t, s, e, '**', '**', 'fett'); break;
      case 'italic': r = E.wrap(t, s, e, '*', '*', 'kursiv'); break;
      case 'strike': r = E.wrap(t, s, e, '~~', '~~', 'durchgestrichen'); break;
      case 'code': r = E.wrap(t, s, e, '`', '`', 'code'); break;
      case 'bullet': r = E.toggleList(t, s, e, 'bullet'); break;
      case 'ordered': r = E.toggleList(t, s, e, 'ordered'); break;
      case 'task': r = E.toggleList(t, s, e, 'task'); break;
      case 'quote': r = E.togglePrefix(t, s, e, 'quote'); break;
      case 'question': r = E.togglePrefix(t, s, e, 'question'); break;
      case 'answer': r = E.togglePrefix(t, s, e, 'answer'); break;
      case 'codeblock': r = E.codeBlock(t, s, e); break;
      case 'hr': r = E.horizontalRule(t, s, e); break;
      case 'link': r = E.link(t, s, e); break;
      case 'wiki': r = E.wikiLink(t, s, e); break;
      default: return;
    }
    applyEdit(r);
  }

  function setHeadingFromSelect() {
    const v = el.headingSelect.value;
    el.headingSelect.value = '';
    if (v === '' || state.currentId == null || el.body.readOnly) return;
    applyEdit(E.setHeading(el.body.value, el.body.selectionStart || 0, el.body.selectionEnd || 0, Number(v)));
  }

  // ---------- Hilfe ----------

  function openHelp(tab) {
    closeMenu();
    hideContextMenu();
    showHelpTab(tab || 'editor');
    if (typeof el.helpDialog.showModal === 'function') { if (!el.helpDialog.open) el.helpDialog.showModal(); }
    else el.helpDialog.setAttribute('open', '');
  }

  function showHelpTab(tab) {
    for (const b of el.helpTabs.querySelectorAll('button[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const panel of el.helpDialog.querySelectorAll('.help-panel')) panel.hidden = panel.dataset.panel !== tab;
    if (tab === 'storage') renderStorageStatus();
  }

  function renderStorageStatus() {
    const lines = [];
    lines.push(`Browser-Speicher: ${Store.browserStore.label()}` + (state.mirrorAtStart ? ' (Kopie vorhanden)' : ''));
    if (state.fileHandle && state.filePermission === 'granted') lines.push(`Datenbankdatei: „${state.fileHandle.name}“, verbunden${state.handleRemembered ? ', wird gemerkt' : ' (nur diese Sitzung)'}`);
    else if (state.fileHandle) lines.push(`Datenbankdatei: „${state.fileHandle.name}“ gemerkt, noch nicht verbunden`);
    else lines.push(Store.fileAccess.supported ? 'Datenbankdatei: keine. Empfehlung: unter Datenbank → Datenbankdatei anlegen…' : 'Datenbankdatei: dieser Browser kann nicht direkt in Dateien schreiben; nutze Kopie herunterladen / importieren.');
    const n = DB.countNotes(state.db);
    const bytes = DB.attachmentsSize(state.db);
    lines.push(`Inhalt: ${n === 1 ? '1 Notiz' : n + ' Notizen'}, ${DB.countTrash(state.db)} im Papierkorb, Bilder ${Math.round(bytes / 1024)} KB`);
    lines.push(state.editSeq === state.savedSeq ? 'Alle Änderungen sind gespeichert.' : 'Es gibt ungespeicherte Änderungen (werden gleich geschrieben).');
    el.helpStorageStatus.textContent = lines.join('\n');
  }

  // ---------- Fragen-Ansicht ----------

  function setQuestionFilter(status) {
    clearTimeout(state.qSearchTimer);
    state.qQuery = el.qSearch.value;
    state.qStatus = status;
    for (const b of el.qFilter.querySelectorAll('button[data-status]')) {
      b.setAttribute('aria-selected', String(b.dataset.status === status));
    }
    renderQuestions();
  }

  function renderQuestions() {
    if (state.view !== 'questions') return;
    // Entwurf eines offenen Antwortfelds sichern, damit ein Neuzeichnen nichts verschluckt.
    const openTa = state.qAnswering != null ? el.qList.querySelector(`.q-item[data-id="${state.qAnswering}"] .q-form textarea`) : null;
    if (openTa) state.qDraft = openTa.value;
    const today = Dates.nowIso();
    const rows = DB.listQuestions(state.db, { status: state.qStatus, query: state.qQuery, tag: state.qTag, sort: state.qSort });
    const counts = DB.countQuestions(state.db, today);
    el.qCount.textContent = `${rows.length} von ${counts.total} · ${counts.open} offen` + (counts.overdue ? ` · ${counts.overdue} überfällig` : '');

    const groups = new Map();
    for (const r of rows) {
      const byDue = state.qSort === 'due';
      const key = byDue ? (r.answer ? 'answered' : Dates.urgency(r.due, today)) : `n${r.note_id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          title: byDue ? Dates.URGENCY_LABELS[key] : (r.note_title.trim() || 'Ohne Titel'),
          noteId: byDue ? null : r.note_id,
          cls: byDue ? `urgency-${key}` : '',
          items: [],
        });
      }
      groups.get(key).items.push(r);
    }

    const frag = document.createDocumentFragment();
    for (const g of orderedGroups(groups, state.qSort === 'due')) {
      const section = document.createElement('section');
      section.className = 'q-group ' + g.cls;
      const h = document.createElement('h3');
      h.className = 'q-note';
      if (g.noteId != null) {
        const nb = document.createElement('button');
        nb.type = 'button';
        nb.textContent = g.title;
        nb.title = 'Notiz öffnen';
        nb.addEventListener('click', () => openNote(g.noteId));
        h.appendChild(nb);
      } else {
        h.append(g.title);
      }
      const cnt = document.createElement('span');
      cnt.textContent = g.items.length === 1 ? '1 Frage' : `${g.items.length} Fragen`;
      h.appendChild(cnt);
      section.appendChild(h);
      for (const r of g.items) section.appendChild(renderQuestionItem(r, today));
      frag.appendChild(section);
    }
    el.qList.replaceChildren(frag);
    el.qEmpty.hidden = rows.length > 0;
    el.qEmpty.textContent = state.qQuery || state.qTag ? 'Keine Treffer.'
      : state.qStatus === 'open' ? 'Keine offenen Fragen. Eine Zeile, die mit „?“ beginnt, wird zur Frage, optional mit „@15.10.2026“ am Ende.'
      : state.qStatus === 'answered' ? 'Noch keine beantworteten Fragen.'
      : 'Noch keine Fragen. Eine Zeile, die mit „?“ beginnt, wird zur Frage.';
  }

  function renderQuestionItem(r, today) {
    const item = document.createElement('article');
    item.className = 'q-item ' + (r.answer ? 'answered' : 'open');
    item.dataset.id = String(r.id);

    const head = document.createElement('div');
    head.className = 'q-head';
    const mark = document.createElement('span');
    mark.className = 'q-mark';
    mark.textContent = r.answer ? '✓' : '?';
    const text = document.createElement('div');
    text.className = 'q-text';
    text.innerHTML = M.highlightText(r.text, state.qQuery.trim());
    head.append(mark, text);
    if (r.due) {
      const due = document.createElement('span');
      const u = r.answer ? 'none' : Dates.urgency(r.due, today || Dates.nowIso());
      due.className = 'due ' + u;
      due.textContent = r.answer ? Dates.formatDue(r.due) : Dates.dueLabel(r.due, today || Dates.nowIso());
      head.appendChild(due);
    }
    item.appendChild(head);

    if (r.answer) {
      const a = document.createElement('div');
      a.className = 'q-answer';
      a.innerHTML = M.highlightText(r.answer, state.qQuery.trim());
      item.appendChild(a);
    }

    const actions = document.createElement('div');
    actions.className = 'q-actions';
    const answerBtn = document.createElement('button');
    answerBtn.type = 'button';
    answerBtn.className = r.answer ? '' : 'primary';
    answerBtn.textContent = r.answer ? 'Antwort bearbeiten' : 'Beantworten';
    answerBtn.addEventListener('click', () => openAnswerForm(item, r));
    const gotoBtn = document.createElement('button');
    gotoBtn.type = 'button';
    gotoBtn.className = 'ghost';
    gotoBtn.textContent = 'Zur Notiz';
    gotoBtn.addEventListener('click', () => openNote(r.note_id, { line: r.line_no }));
    actions.append(answerBtn, gotoBtn);
    if (state.qSort === 'due') {
      const from = document.createElement('span');
      from.className = 't-note';
      from.append('aus ');
      const nb = document.createElement('button');
      nb.type = 'button';
      nb.textContent = r.note_title.trim() || 'Ohne Titel';
      nb.addEventListener('click', () => openNote(r.note_id));
      from.appendChild(nb);
      actions.appendChild(from);
    }
    const meta = document.createElement('span');
    meta.className = 'q-meta';
    meta.textContent = r.answer && r.answered_at ? `Beantwortet ${fmtDate(r.answered_at)}` : `Gestellt ${fmtDate(r.created_at)}`;
    actions.appendChild(meta);
    item.appendChild(actions);

    const form = document.createElement('form');
    form.className = 'q-form';
    form.hidden = true;
    const ta = document.createElement('textarea');
    ta.placeholder = 'Antwort…';
    ta.setAttribute('aria-label', 'Antwort');
    const row = document.createElement('div');
    row.className = 'row';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'primary';
    save.textContent = 'Speichern';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Abbrechen';
    cancel.addEventListener('click', () => { form.hidden = true; actions.hidden = false; state.qAnswering = null; state.qDraft = null; });
    row.append(save, cancel);
    form.append(ta, row);
    form.addEventListener('submit', e => {
      e.preventDefault();
      saveAnswer(r.id, ta.value);
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveAnswer(r.id, ta.value); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel.click(); }
    });
    item.appendChild(form);

    if (state.qAnswering === r.id) openAnswerForm(item, r);
    return item;
  }

  function openAnswerForm(item, r) {
    const form = item.querySelector('.q-form');
    const actions = item.querySelector('.q-actions');
    const ta = form.querySelector('textarea');
    const reopened = state.qAnswering === r.id && state.qDraft != null;
    state.qAnswering = r.id;
    ta.value = reopened ? state.qDraft : (r.answer || '');
    form.hidden = false;
    actions.hidden = true;
    if (!reopened || document.activeElement === document.body) ta.focus();
  }

  function saveAnswer(questionId, text) {
    try {
      const noteId = DB.answerQuestion(state.db, questionId, text);
      state.qAnswering = null;
      state.qDraft = null;
      markEdited();
      renderQuestionCounts();
      renderQuestions();
      if (state.currentId === noteId) renderEditor();
      setStatus(text.trim() ? 'Antwort gespeichert' : 'Antwort entfernt', 'dirty');
    } catch (e) {
      setStatus('Antwort konnte nicht gespeichert werden: ' + e.message, 'error');
    }
  }

  // ---------- Aufgaben-Ansicht ----------

  function setTaskFilter(status) {
    clearTimeout(state.tSearchTimer);
    state.tQuery = el.tSearch.value;
    state.tStatus = status;
    for (const b of el.tFilter.querySelectorAll('button[data-status]')) {
      b.setAttribute('aria-selected', String(b.dataset.status === status));
    }
    renderTasks();
  }

  const URGENCY_LABELS = { overdue: 'Überfällig', today: 'Heute', week: 'Diese Woche', later: 'Später', none: 'Ohne Termin', done: 'Erledigt' };
  const URGENCY_ORDER = ['overdue', 'today', 'week', 'later', 'none', 'done', 'answered'];

  /** Gruppen nach Dringlichkeit in fester Reihenfolge, sonst in Reihenfolge des Auftretens. */
  function orderedGroups(groups, byUrgency) {
    const entries = [...groups.entries()];
    if (byUrgency) entries.sort((a, b) => URGENCY_ORDER.indexOf(a[0]) - URGENCY_ORDER.indexOf(b[0]));
    return entries.map(e => e[1]);
  }

  function renderTasks() {
    if (state.view !== 'tasks') return;
    const today = Dates.nowIso();
    const rows = DB.listTasks(state.db, { status: state.tStatus, query: state.tQuery, tag: state.tTag, sort: state.tSort });
    const counts = DB.countTasks(state.db, today);
    el.tCount.textContent = `${rows.length} von ${counts.total} · ${counts.open} offen` + (counts.overdue ? ` · ${counts.overdue} überfällig` : '');

    const groups = new Map();
    for (const r of rows) {
      const key = state.tSort === 'note' ? `n${r.note_id}` : (r.done ? 'done' : T.urgency(r.due, today));
      if (!groups.has(key)) {
        groups.set(key, {
          title: state.tSort === 'note' ? (r.note_title.trim() || 'Ohne Titel') : URGENCY_LABELS[key],
          noteId: state.tSort === 'note' ? r.note_id : null,
          cls: state.tSort === 'note' ? '' : `urgency-${key}`,
          items: [],
        });
      }
      groups.get(key).items.push(r);
    }

    const frag = document.createDocumentFragment();
    for (const g of orderedGroups(groups, state.tSort !== 'note')) {
      const section = document.createElement('section');
      section.className = 'q-group ' + g.cls;
      const h = document.createElement('h3');
      h.className = 'q-note';
      if (g.noteId != null) {
        const nb = document.createElement('button');
        nb.type = 'button';
        nb.textContent = g.title;
        nb.title = 'Notiz öffnen';
        nb.addEventListener('click', () => openNote(g.noteId));
        h.appendChild(nb);
      } else {
        h.append(g.title);
      }
      const cnt = document.createElement('span');
      cnt.textContent = g.items.length === 1 ? '1 Aufgabe' : `${g.items.length} Aufgaben`;
      h.appendChild(cnt);
      section.appendChild(h);
      for (const r of g.items) section.appendChild(renderTaskItem(r, today));
      frag.appendChild(section);
    }
    el.tList.replaceChildren(frag);
    el.tEmpty.hidden = rows.length > 0;
    el.tEmpty.textContent = state.tQuery || state.tTag ? 'Keine Treffer.'
      : state.tStatus === 'open' ? 'Keine offenen Aufgaben. Eine Zeile „- [ ] Text“ wird zur Aufgabe, optional mit „@15.10.2026“ am Ende.'
      : state.tStatus === 'done' ? 'Noch keine erledigten Aufgaben.'
      : 'Noch keine Aufgaben. Eine Zeile „- [ ] Text“ wird zur Aufgabe.';
  }

  function renderTaskItem(r, today) {
    const item = document.createElement('article');
    item.className = 'q-item t-item ' + (r.done ? 'done' : 'open');
    item.dataset.id = String(r.id);

    const head = document.createElement('div');
    head.className = 'q-head';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 't-check';
    box.checked = !!r.done;
    box.setAttribute('aria-label', r.done ? 'Aufgabe wieder öffnen' : 'Aufgabe abhaken');
    box.addEventListener('change', () => toggleTaskDone(r.id, box.checked));
    const text = document.createElement('div');
    text.className = 'q-text';
    text.innerHTML = M.highlightText(r.text, state.tQuery.trim());
    head.append(box, text);
    if (r.due) {
      const due = document.createElement('span');
      const u = r.done ? 'none' : T.urgency(r.due, today);
      due.className = 'due ' + u;
      due.textContent = (u === 'overdue' ? 'überfällig · ' : u === 'today' ? 'heute · ' : '') + T.formatDue(r.due);
      head.appendChild(due);
    }
    item.appendChild(head);

    const actions = document.createElement('div');
    actions.className = 'q-actions';
    if (state.tSort !== 'note') {
      const from = document.createElement('span');
      from.className = 't-note';
      from.append('aus ');
      const nb = document.createElement('button');
      nb.type = 'button';
      nb.textContent = r.note_title.trim() || 'Ohne Titel';
      nb.addEventListener('click', () => openNote(r.note_id));
      from.appendChild(nb);
      actions.appendChild(from);
    }
    const gotoBtn = document.createElement('button');
    gotoBtn.type = 'button';
    gotoBtn.className = 'ghost';
    gotoBtn.textContent = 'Zur Notiz';
    gotoBtn.addEventListener('click', () => openNote(r.note_id, { line: r.line_no }));
    actions.appendChild(gotoBtn);
    const meta = document.createElement('span');
    meta.className = 'q-meta';
    meta.textContent = r.done && r.done_at ? `Erledigt ${fmtDate(r.done_at)}` : `Erfasst ${fmtDate(r.created_at)}`;
    actions.appendChild(meta);
    item.appendChild(actions);
    return item;
  }

  function toggleTaskDone(taskId, done) {
    try {
      const noteId = DB.setTaskDone(state.db, taskId, done);
      markEdited();
      renderTaskCounts();
      renderTasks();
      if (state.currentId === noteId) { renderEditor(); if (state.editorMode !== 'edit') renderPreview(); }
      setStatus(done ? 'Aufgabe erledigt' : 'Aufgabe wieder geöffnet', 'dirty');
    } catch (e) {
      setStatus('Aufgabe konnte nicht geändert werden: ' + e.message, 'error');
      renderTasks();
    }
  }

  function onTaskSearchInput() {
    clearTimeout(state.tSearchTimer);
    state.tSearchTimer = setTimeout(() => {
      if (el.tSearch.value === state.tQuery) return;
      state.tQuery = el.tSearch.value;
      renderTasks();
    }, SEARCH_DELAY_MS);
  }

  function openTaskPrintDialog() {
    hideContextMenu();
    closeMenu();
    const shown = DB.listTasks(state.db, { status: state.tStatus, query: state.tQuery, tag: state.tTag }).length;
    const label = state.tStatus === 'open' ? 'offene' : state.tStatus === 'done' ? 'erledigte' : 'alle';
    el.taskScopeFiltered.textContent = `Wie angezeigt: ${label} Aufgaben${state.tTag ? `, Tag „${state.tTag}“` : ''}${state.tQuery.trim() ? `, Suche „${state.tQuery.trim()}“` : ''} (${shown})`;
    if (typeof el.taskPrintDialog.showModal === 'function') el.taskPrintDialog.showModal();
    else el.taskPrintDialog.setAttribute('open', '');
  }

  function runTaskPrint() {
    const scope = (el.taskPrintForm.querySelector('input[name="taskScope"]:checked') || {}).value || 'filtered';
    const groupBy = (el.taskPrintForm.querySelector('input[name="taskGroup"]:checked') || {}).value || 'due';
    const html = Printer.buildTasksDocument(state.db, {
      status: scope === 'filtered' ? state.tStatus : scope,
      tag: scope === 'filtered' ? state.tTag : '',
      query: scope === 'filtered' ? state.tQuery.trim() : '',
      groupBy,
    });
    if (el.taskPrintDialog.open) el.taskPrintDialog.close();
    Printer.print(html);
  }

  /** "/" ausserhalb von Eingabefeldern: Suche der aktuellen Ansicht fokussieren. */
  function focusSearch() {
    const target = state.view === 'map' ? el.mapSearch : state.view === 'questions' ? el.qSearch : state.view === 'tasks' ? el.tSearch : el.search;
    target.focus();
    target.select();
  }

  function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function anyDialogOpen() {
    return [el.exportDialog, el.printDialog, el.qaPrintDialog, el.taskPrintDialog, el.helpDialog].some(d => d.open);
  }

  function onQuestionSearchInput() {
    clearTimeout(state.qSearchTimer);
    state.qSearchTimer = setTimeout(() => {
      if (el.qSearch.value === state.qQuery) return;
      state.qQuery = el.qSearch.value;
      renderQuestions();
    }, SEARCH_DELAY_MS);
  }

  function deleteNoteById(id) {
    hideContextMenu();
    const note = DB.getNote(state.db, id);
    if (!note) return;
    const name = note.title.trim() ? `„${note.title.trim()}“` : 'diese Notiz';
    const info = state.map ? state.map.nodeInfo(id) : null;
    const kids = info ? info.childCount : 0;
    const hint = kids ? `\n\n${kids === 1 ? 'Die Unternotiz rückt' : kids + ' Unternotizen rücken'} zum übergeordneten Knoten auf.` : '';
    if (!confirm(`Soll ${name} in den Papierkorb verschoben werden?${hint}`)) return;

    const parentId = note.parent_id;
    let nextInList = null;
    const li = el.list.querySelector(`li[data-id="${id}"]`);
    const neighbour = li && (li.nextElementSibling || li.previousElementSibling);
    if (neighbour) nextInList = Number(neighbour.dataset.id);

    DB.deleteNote(state.db, id);
    state.multi.delete(id);

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

  function restoreCurrent() {
    if (state.currentId == null) return;
    const id = state.currentId;
    DB.restoreNote(state.db, id);
    state.listScope = 'live';
    el.listScope.value = 'live';
    markEdited();
    renderAll();
    setStatus('Notiz wiederhergestellt', 'dirty');
  }

  function purgeCurrent() {
    if (state.currentId == null) return;
    const note = DB.getNote(state.db, state.currentId);
    const name = note && note.title.trim() ? `„${note.title.trim()}“` : 'diese Notiz';
    if (!confirm(`Soll ${name} endgültig gelöscht werden? Das lässt sich nicht rückgängig machen.`)) return;
    DB.purgeNote(state.db, state.currentId);
    state.currentId = null;
    markEdited();
    renderAll();
    showEditorView(false);
  }

  function emptyTrash() {
    const n = DB.countTrash(state.db);
    if (!n) return;
    if (!confirm(`${n === 1 ? 'Die Notiz' : 'Alle ' + n + ' Notizen'} im Papierkorb endgültig löschen?`)) return;
    DB.emptyTrash(state.db);
    if (state.currentId != null && !DB.getNote(state.db, state.currentId)) state.currentId = null;
    markEdited();
    renderAll();
  }

  /** Ablage aus der Mindmap: als Unternotiz des Ziels oder direkt vor/nach dem Ziel. */
  function moveNoteTo(id, targetId, where) {
    try {
      if (where === 'before' || where === 'after') {
        if (targetId == null) return;
        DB.moveNote(state.db, id, targetId, where);
        const target = DB.getNote(state.db, targetId);
        if (target && target.parent_id != null) {
          const info = state.map.nodeInfo(target.parent_id);
          if (info && info.collapsed) DB.setCollapsed(state.db, target.parent_id, false);
        }
      } else {
        DB.setParent(state.db, id, targetId);
        if (targetId != null) {
          const info = state.map.nodeInfo(targetId);
          if (info && info.collapsed) DB.setCollapsed(state.db, targetId, false);
        }
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
        'sep',
        { label: 'Alles drucken…', action: () => openPrintDialog({ scope: 'all' }) },
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
      { label: 'Drucken…', action: () => openPrintDialog({ noteId: id, scope: 'subtree' }) },
      { label: 'Nach oben', key: 'Alt+↑', action: () => { state.mapSelection = id; moveSelected(-1); } },
      { label: 'Nach unten', key: 'Alt+↓', action: () => { state.mapSelection = id; moveSelected(1); } },
      'sep',
      { label: 'Löschen', key: 'Entf', danger: true, action: () => deleteNoteById(id) },
    );
    showContextMenu(items, x, y);
  }

  // ---------- Suche, Menü ----------

  function onSearchInput(source) {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      const value = source === 'map' ? el.mapSearch.value : el.search.value;
      if (source === 'map') el.search.value = value; else el.mapSearch.value = value;
      if (value === state.query) return;
      state.query = value;
      state.mapMatchIndex = -1;
      renderList();
      if (state.view === 'map') renderMap(); else state.mapDirty = true;
      if (state.editorMode !== 'edit') renderPreview();
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
    el.viewQuestionsBtn.addEventListener('click', () => setView('questions'));
    el.viewTasksBtn.addEventListener('click', () => setView('tasks'));
    el.tFilter.addEventListener('click', e => {
      const b = e.target.closest('button[data-status]');
      if (b) setTaskFilter(b.dataset.status);
    });
    el.tSort.addEventListener('change', () => { state.tSort = el.tSort.value; renderTasks(); });
    el.tSearch.addEventListener('input', onTaskSearchInput);
    el.tTagFilter.addEventListener('change', () => { state.tTag = el.tTagFilter.value; renderTasks(); });
    el.tPrintBtn.addEventListener('click', openTaskPrintDialog);
    el.taskPrintGoBtn.addEventListener('click', runTaskPrint);
    el.preview.addEventListener('change', onPreviewChange);
    el.qFilter.addEventListener('click', e => {
      const b = e.target.closest('button[data-status]');
      if (b) setQuestionFilter(b.dataset.status);
    });
    el.qSearch.addEventListener('input', onQuestionSearchInput);
    el.qSort.addEventListener('change', () => { state.qSort = el.qSort.value; renderQuestions(); });
    el.mdToolbar.addEventListener('click', e => {
      const b = e.target.closest('button[data-cmd]');
      if (b) { e.preventDefault(); runCommand(b.dataset.cmd); }
    });
    el.mdToolbar.addEventListener('mousedown', e => {
      // Fokus und Markierung im Textfeld behalten
      if (e.target.closest('button')) e.preventDefault();
    });
    el.headingSelect.addEventListener('change', setHeadingFromSelect);
    el.helpBtn.addEventListener('click', () => openHelp('editor'));
    el.menuHelpBtn.addEventListener('click', () => openHelp('editor'));
    el.storageHelpBtn.addEventListener('click', () => openHelp('storage'));
    el.helpTabs.addEventListener('click', e => {
      const b = e.target.closest('button[data-tab]');
      if (b) showHelpTab(b.dataset.tab);
    });
    el.body.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.isComposing || el.body.readOnly) return;
      // Listen, Aufgaben, Zitate und Antworten weiterführen; Shift+Enter bleibt die normale neue Zeile.
      if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) {
        const r = E.continueLine(el.body.value, el.body.selectionStart || 0, el.body.selectionEnd || 0);
        if (r) { e.preventDefault(); applyEdit(r); }
        return;
      }
      if (e.key === 'Tab' && !mod && !e.altKey) {
        const r = E.indentLines(el.body.value, el.body.selectionStart || 0, el.body.selectionEnd || 0, e.shiftKey ? -1 : 1);
        if (r) { e.preventDefault(); applyEdit(r); }
        return;
      }
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey) {
        if (k === 'f') { e.preventDefault(); runCommand('question'); }
        else if (k === 'a') { e.preventDefault(); runCommand('answer'); }
        return;
      }
      if (k === 'b') { e.preventDefault(); runCommand('bold'); }
      else if (k === 'i') { e.preventDefault(); runCommand('italic'); }
      else if (k === 'k') { e.preventDefault(); runCommand('link'); }
    });

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
    el.search.addEventListener('input', () => onSearchInput('list'));
    el.search.addEventListener('keydown', e => {
      if (e.key === 'Escape' && el.search.value) { el.search.value = ''; onSearchInput('list'); }
    });
    el.mapSearch.addEventListener('input', () => onSearchInput('map'));
    el.mapSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); nextMapMatch(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') {
        e.stopPropagation();
        if (el.mapSearch.value) { el.mapSearch.value = ''; onSearchInput('map'); }
        else el.mindmap.focus({ preventScroll: true });
      }
    });
    el.listScope.addEventListener('change', () => { state.listScope = el.listScope.value; renderList(); renderCount(); });
    el.tagFilter.addEventListener('change', () => { state.tagFilter = el.tagFilter.value; renderList(); });
    el.qTagFilter.addEventListener('change', () => { state.qTag = el.qTagFilter.value; renderQuestions(); });
    el.emptyTrashBtn.addEventListener('click', emptyTrash);
    el.restoreBtn.addEventListener('click', restoreCurrent);
    el.purgeBtn.addEventListener('click', purgeCurrent);
    el.modeSwitch.addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (b) setEditorMode(b.dataset.mode);
    });
    el.preview.addEventListener('click', onPreviewClick);
    el.attachBtn.addEventListener('click', () => { el.attachInput.value = ''; el.attachInput.click(); });
    el.printBtn.addEventListener('click', () => openPrintDialog({ noteId: state.currentId }));
    el.mapPrintBtn.addEventListener('click', () => openPrintDialog({}));
    el.multiPrintBtn.addEventListener('click', () => openPrintDialog({ scope: 'selection' }));
    el.multiClearBtn.addEventListener('click', clearMulti);
    el.printGoBtn.addEventListener('click', runPrint);
    el.qPrintBtn.addEventListener('click', openQaPrintDialog);
    el.qaPrintGoBtn.addEventListener('click', runQaPrint);
    el.attachInput.addEventListener('change', () => { addAttachments(el.attachInput.files); el.attachInput.value = ''; });
    el.body.addEventListener('paste', e => {
      const items = e.clipboardData && e.clipboardData.items ? [...e.clipboardData.items] : [];
      const files = items.filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); addAttachments(files); }
    });
    el.body.addEventListener('dragover', e => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.body.classList.add('drop-target'); }
    });
    el.body.addEventListener('dragleave', () => el.body.classList.remove('drop-target'));
    el.body.addEventListener('drop', e => {
      el.body.classList.remove('drop-target');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addAttachments(e.dataTransfer.files); }
    });
    el.tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagFromInput(); }
      else if (e.key === 'Backspace' && !el.tagInput.value) {
        const tags = currentTags();
        if (tags.length) removeTag(tags[tags.length - 1]);
      }
    });
    el.tagInput.addEventListener('change', () => { if (el.tagInput.value.trim()) addTagFromInput(); });
    el.tagInput.addEventListener('blur', () => { if (el.tagInput.value.trim()) addTagFromInput(); });
    el.title.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.body.focus(); }
    });

    el.list.addEventListener('click', e => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      if (e.ctrlKey || e.metaKey) { toggleMulti(Number(li.dataset.id)); return; }
      selectNote(Number(li.dataset.id), false);
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
    el.exportBtn.addEventListener('click', openExportDialog);
    el.exportDirBtn.addEventListener('click', () => runExport('dir'));
    el.exportZipBtn.addEventListener('click', () => runExport('zip'));
    el.importInput.addEventListener('change', importFromInput);

    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); persistNow(); }
      else if (mod && !e.shiftKey && e.key.toLowerCase() === 'e' && state.currentId != null && !el.editorPane.hidden) { e.preventDefault(); cycleEditorMode(); }
      else if (e.key === 'F1') { e.preventDefault(); openHelp('editor'); }
      else if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (state.view === 'questions' && !isEditorOpen()) openQaPrintDialog();
        else if (state.view === 'tasks' && !isEditorOpen()) openTaskPrintDialog();
        else openPrintDialog({ noteId: isEditorOpen() || state.view === 'list' ? state.currentId : undefined });
      }
      else if (e.key === '/' && !mod && !e.altKey && !isTypingTarget(e.target) && !anyDialogOpen() && !isEditorOpen() && !state.rename) {
        e.preventDefault();
        focusSearch();
      }
      else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
      else if (e.key === 'Escape') {
        if (state.rename || anyDialogOpen()) return;
        if (state.multi.size && !isEditorOpen() && el.menu.hidden && el.contextMenu.hidden) { clearMulti(); return; }
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
