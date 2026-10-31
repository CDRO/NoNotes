/* NoNotes – Oberfläche und Ablauf. */
(function () {
  'use strict';

  const I18n = window.NoNotesI18n;
  const t = I18n.t;
  const tn = I18n.tn;
  const Backend = window.NoNotesBackend;
  const Palette = window.NoNotesPalette;
  const Plugins = window.NoNotesPlugins;
  const Store = window.NoNotesStorage;
  const Mindmap = window.NoNotesMindmap;
  const Q = window.NoNotesQuestions;
  const Mentions = window.NoNotesMentions;
  const M = window.NoNotesMarkdown;
  const Zip = window.NoNotesZip;
  const Exporter = window.NoNotesExport;
  const Printer = window.NoNotesPrint;
  const T = window.NoNotesTasks;
  const Dates = window.NoNotesDates;
  const Cal = window.NoNotesCalendar;
  const Merge = window.NoNotesMerge;
  const Routes = window.NoNotesRoutes;
  const Tables = window.NoNotesTables;
  const joinParts = (...parts) => parts.filter(Boolean).join(', ');
  const errorText = e => Backend.errorText(e);
  const THEME_KEY = 'nonotes.theme';   // Zwischenspeicher des Designs; massgebend ist meta 'theme' der Datenbank
  const ACCENT_KEY = 'nonotes.accent'; // Zwischenspeicher der Hauptfarbe; massgebend ist meta 'accent' der Datenbank
  const CAL_HANDLE_KEY = 'ics';
  const CAL_FILENAME = 'NoNotes.ics';

  const SEARCH_DELAY_MS = 120;
  const VIEW_KEY = 'nonotes.view';
  const MODE_KEY = 'nonotes.editorMode';
  const ARCHIVE_KEY = 'nonotes.showArchive';
  const LINKS_KEY = 'nonotes.showLinks';     // Querverweise ([[Titel*]]) in der Mindmap zeigen, je Browser
  const PLUGINS_KEY = 'nonotes.plugins';   // eingeschaltete Erweiterungen (Dateien in plugins/), je Browser

  I18n.init();
  I18n.translateDom(document.body);

  /** Setzt die Farbvariablen der Seite für eine Hauptfarbe (Vorgabe Blau: das Stylesheet gilt), dazu das Symbol im Tab. */
  function paintAccent(id) {
    paintFavicon(id);
    const css = Palette.css(id);
    let style = document.getElementById('accentStyle');
    if (!css) { if (style) style.remove(); return; }
    if (!style) {
      style = document.createElement('style');
      style.id = 'accentStyle';
      document.head.appendChild(style);
    }
    style.textContent = css;
  }

  /** Das Symbol im Tab in der Hauptfarbe des Bereichs: mehrere offene Bereiche oder Arbeitsbereiche lassen sich an der Farbe unterscheiden. */
  function paintFavicon(id) {
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    const href = Palette.favicon(id);
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }

  // Sofort aus dem Zwischenspeicher, damit beim Start nichts umspringt; die Datenbank gleicht danach ab.
  try { paintAccent(Palette.normalize(localStorage.getItem(ACCENT_KEY))); } catch (e) { /* ohne Zwischenspeicher: Vorgabe */ }

  const $ = sel => document.querySelector(sel);
  const el = {
    app: $('#app'), boot: $('#boot'), version: $('#version'), status: $('#status'),
    storageInfo: $('#storageInfo'), banner: $('#banner'),
    menuBtn: $('#menuBtn'), menu: $('#menu'), menuHint: $('#menuHint'), noteMenuBtn: $('#noteMenuBtn'), noteMenu: $('#noteMenu'),
    statusbar: $('#statusbar'), toast: $('#toast'), toastText: $('#toastText'), toastCloseBtn: $('#toastCloseBtn'),
    createFileBtn: $('#createFileBtn'), openFileBtn: $('#openFileBtn'), disconnectBtn: $('#disconnectBtn'), areasBtn: $('#areasBtn'),
    downloadBtn: $('#downloadBtn'), importBtn: $('#importBtn'), importInput: $('#importInput'),
    viewMapBtn: $('#viewMapBtn'), viewListBtn: $('#viewListBtn'), viewQuestionsBtn: $('#viewQuestionsBtn'),
    questionsView: $('#questionsView'), qFilter: $('#qFilter'), qSearch: $('#qSearch'),
    qList: $('#qList'), qEmpty: $('#qEmpty'), qCount: $('#qCount'),
    questionBtn: $('#questionBtn'), answerBtn: $('#answerBtn'), noteQuestions: $('#noteQuestions'),
    mapSearch: $('#mapSearch'), mapMatches: $('#mapMatches'), qTagFilter: $('#qTagFilter'),
    listScope: $('#listScope'), tagFilter: $('#tagFilter'), emptyTrashBtn: $('#emptyTrashBtn'),
    editor: $('#editor'), trashBar: $('#trashBar'), restoreBtn: $('#restoreBtn'), purgeBtn: $('#purgeBtn'),
    archiveBar: $('#archiveBar'), archiveBarText: $('#archiveBarText'), unarchiveBtn: $('#unarchiveBtn'), archiveBtn: $('#archiveBtn'),
    mapArchiveBtn: $('#mapArchiveBtn'), mapLinksBtn: $('#mapLinksBtn'), multiArchiveBtn: $('#multiArchiveBtn'), printArchive: $('#printArchive'), exportArchive: $('#exportArchive'),
    tagChips: $('#tagChips'), tagInput: $('#tagInput'), tagSuggestions: $('#tagSuggestions'),
    exportBtn: $('#exportBtn'), exportDialog: $('#exportDialog'), exportForm: $('#exportForm'),
    exportDirBtn: $('#exportDirBtn'), exportZipBtn: $('#exportZipBtn'), exportHint: $('#exportHint'),
    mapPrintBtn: $('#mapPrintBtn'), mapCopyBtn: $('#mapCopyBtn'), qPrintBtn: $('#qPrintBtn'), printBtn: $('#printBtn'), copyLinkBtn: $('#copyLinkBtn'),
    multiBar: $('#multiBar'), multiCount: $('#multiCount'), multiPrintBtn: $('#multiPrintBtn'), multiClearBtn: $('#multiClearBtn'),
    printDialog: $('#printDialog'), printForm: $('#printForm'), printGoBtn: $('#printGoBtn'),
    printScopeCurrent: $('#printScopeCurrent'), printScopeSubtree: $('#printScopeSubtree'),
    printScopeSelection: $('#printScopeSelection'), printScopeAll: $('#printScopeAll'),
    printSelectionChildren: $('#printSelectionChildren'), printIncludeMap: $('#printIncludeMap'),
    printIncludeToc: $('#printIncludeToc'), printPageBreaks: $('#printPageBreaks'),
    qaPrintDialog: $('#qaPrintDialog'), qaPrintForm: $('#qaPrintForm'), qaPrintGoBtn: $('#qaPrintGoBtn'),
    qaScopeFiltered: $('#qaScopeFiltered'), qaLines: $('#qaLines'), qSort: $('#qSort'),
    helpDialog: $('#helpDialog'), helpTabs: $('#helpTabs'), helpStorageStatus: $('#helpStorageStatus'),
    storageHelpBtn: $('#storageHelpBtn'), menuHelpBtn: $('#menuHelpBtn'), langMenu: $('#langMenu'), langBtn: $('#langBtn'), langList: $('#langList'), accentSwatches: $('#accentSwatches'),
    themeRow: $('#themeRow'), themeSelect: $('#themeSelect'), pluginMenu: $('#pluginMenu'), pluginsBtn: $('#pluginsBtn'),
    pluginsDialog: $('#pluginsDialog'), pluginList: $('#pluginList'), pluginFile: $('#pluginFile'), pluginLoadBtn: $('#pluginLoadBtn'),
    historyBtn: $('#historyBtn'), historyDialog: $('#historyDialog'), historyLead: $('#historyLead'), historyList: $('#historyList'),
    historyMeta: $('#historyMeta'), historyText: $('#historyText'), historyDiff: $('#historyDiff'), historyLegend: $('#historyLegend'),
    historyRestoreBtn: $('#historyRestoreBtn'), historyClearBtn: $('#historyClearBtn'),
    conflictDialog: $('#conflictDialog'), conflictLead: $('#conflictLead'), conflictText: $('#conflictText'), conflictLegend: $('#conflictLegend'),
    conflictMineBtn: $('#conflictMineBtn'), conflictTheirsBtn: $('#conflictTheirsBtn'), conflictMarkersBtn: $('#conflictMarkersBtn'),
    viewTasksBtn: $('#viewTasksBtn'), tasksView: $('#tasksView'), tFilter: $('#tFilter'), tSort: $('#tSort'),
    tSearch: $('#tSearch'), tTagFilter: $('#tTagFilter'), tPersonFilter: $('#tPersonFilter'), tPrintBtn: $('#tPrintBtn'), tCount: $('#tCount'),
    tList: $('#tList'), tEmpty: $('#tEmpty'),
    taskPrintDialog: $('#taskPrintDialog'), taskPrintForm: $('#taskPrintForm'), taskPrintGoBtn: $('#taskPrintGoBtn'),
    taskScopeFiltered: $('#taskScopeFiltered'),
    calendarBtn: $('#calendarBtn'), calDialog: $('#calDialog'), calSummary: $('#calSummary'),
    calIncludeDone: $('#calIncludeDone'), calAlarms: $('#calAlarms'), calFileSet: $('#calFileSet'), calFileInfo: $('#calFileInfo'),
    calWriteBtn: $('#calWriteBtn'), calPickBtn: $('#calPickBtn'), calDownloadBtn: $('#calDownloadBtn'),
    mapView: $('#mapView'), mapNewBtn: $('#mapNewBtn'), mapFitBtn: $('#mapFitBtn'),
    mapZoomInBtn: $('#mapZoomInBtn'), mapZoomOutBtn: $('#mapZoomOutBtn'),
    mindmap: $('#mindmap'), renameInput: $('#renameInput'), contextMenu: $('#contextMenu'),
    search: $('#search'), newBtn: $('#newBtn'), list: $('#list'), listEmpty: $('#listEmpty'), count: $('#count'),
    editorEmpty: $('#editorEmpty'), editorPane: $('#editorPane'), backBtn: $('#backBtn'),
    crumbs: $('#crumbs'), noteMeta: $('#noteMeta'), childBtn: $('#childBtn'), deleteBtn: $('#deleteBtn'),
    title: $('#title'),
    viewDecisionsBtn: $('#viewDecisionsBtn'), qPersonFilter: $('#qPersonFilter'), qAnsweredBtn: $('#qAnsweredBtn'),
    phKeep: $('#phKeep'), qaPrintTitle: $('#qaPrintTitle'), qaScopeOpen: $('#qaScopeOpen'), qaScopeAnswered: $('#qaScopeAnswered'),
    qaScopeAll: $('#qaScopeAll'), qaLinesLabel: $('#qaLinesLabel'),
    mapTemplateBtn: $('#mapTemplateBtn'), newTemplateBtn: $('#newTemplateBtn'), templatesBtn: $('#templatesBtn'),
    childTemplateBtn: $('#childTemplateBtn'), insertTemplateBtn: $('#insertTemplateBtn'), saveTemplateBtn: $('#saveTemplateBtn'),
    nodeLinkDialog: $('#nodeLinkDialog'), nodeLinkLead: $('#nodeLinkLead'), nodeLinkInput: $('#nodeLinkInput'), nodeLinkAreaRow: $('#nodeLinkAreaRow'),
    nodeLinkArea: $('#nodeLinkArea'), nodeLinkError: $('#nodeLinkError'), nodeLinkSaveBtn: $('#nodeLinkSaveBtn'), nodeLinkRemoveBtn: $('#nodeLinkRemoveBtn'),
    nodeLinkBtn: $('#nodeLinkBtn'), nodeLinkBar: $('#nodeLinkBar'), nodeLinkOpen: $('#nodeLinkOpen'), nodeLinkEditBtn: $('#nodeLinkEditBtn'),
    detachDialog: $('#detachDialog'), detachName: $('#detachName'), detachLead: $('#detachLead'), detachError: $('#detachError'),
    detachGoBtn: $('#detachGoBtn'), detachBtn: $('#detachBtn'),
    templateSaveDialog: $('#templateSaveDialog'), templateName: $('#templateName'), templateDescription: $('#templateDescription'),
    templateChildren: $('#templateChildren'), templateChildrenLabel: $('#templateChildrenLabel'), templateStripAnswers: $('#templateStripAnswers'),
    templateReopenTasks: $('#templateReopenTasks'), templateStripDates: $('#templateStripDates'), templateToday: $('#templateToday'), templateTodayLabel: $('#templateTodayLabel'), templateSaveFields: $('#templateSaveFields'),
    templateSaveWhere: $('#templateSaveWhere'), templateSaveHint: $('#templateSaveHint'), templateSaveGoBtn: $('#templateSaveGoBtn'),
    templatePickDialog: $('#templatePickDialog'), templatePickTitle: $('#templatePickTitle'), templatePickLead: $('#templatePickLead'),
    templatePickList: $('#templatePickList'), templatePickPreview: $('#templatePickPreview'), templatePickEmpty: $('#templatePickEmpty'),
    templatePickGoBtn: $('#templatePickGoBtn'), templatePickManageBtn: $('#templatePickManageBtn'),
    templatesDialog: $('#templatesDialog'), templatesLead: $('#templatesLead'), templatesFolder: $('#templatesFolder'), templatesList: $('#templatesList'),
    templatesEmpty: $('#templatesEmpty'), templatesImportBtn: $('#templatesImportBtn'), templatesManageBtn: $('#templatesManageBtn'),
    templatesPlaceholders: $('#templatesPlaceholders'), templateInput: $('#templateInput'),
  };

  const state = {
    closeLangList: null,         // schliesst die Liste des Sprachwechsels (setupLanguage)
    navReady: false,             // Navigation mit dem Verlauf läuft (nach dem Start)
    navApplying: false,          // ein Eintrag des Verlaufs wird gerade angewendet: keine neuen Schritte
    navChain: Promise.resolve(), // Schritte nacheinander
    navSeq: 0,                   // zählt Zurück/Vor/Adresse: ein überholter Schritt schreibt nichts mehr
    navPending: 0,               // Zurück/Vor/Adresse, die noch nicht angewendet sind: so lange schreibt niemand sonst in die Adresse
    leaving: false,              // die Seite wird verlassen (Neuladen, andere Adresse): abgebrochene Anfragen sind kein Fehler
    navTitleTimer: null,
    currentId: null,
    query: '',
    view: 'map',
    map: null,
    mapDirty: true,
    accent: Palette.DEFAULT,
    theme: '',            // Kennung der Erweiterung, deren Design gilt; leer = Standard
    pluginFiles: [],      // in diesem Browser eingeschaltete Erweiterungen (Dateien in plugins/)
    accentStale: false,   // nach Datei öffnen oder Import: Hauptfarbe neu aus der Datenbank lesen
    mapSelection: null,   // 'root' | Zahl | null
    rename: null,         // { id, isNew }
    qStatus: 'open',
    qSort: 'due',
    qQuery: '',
    qSearchTimer: null,
    qAnswering: null,     // id der Frage, deren Antwortfeld offen ist
    qDraft: null,         // Entwurf im offenen Antwortfeld (überlebt ein Neuzeichnen)
    qTag: '',
    qPerson: '',          // Filter «an @kürzel» in Fragen und Entscheiden
    pluginProviders: new Map(), // Lieferanten für @kürzel je Erweiterung (zum Abmelden beim Ausschalten)
    pluginContextItems: [],     // Einträge der Erweiterungen im Kontextmenü eines Knotens (seit 2.8.0): { plugin, spec }
    pluginTableItems: [],       // Einträge der Erweiterungen im Kontextmenü einer Tabelle (seit 2.10.0): { entry, spec }
    toolbarButtons: [],         // Knöpfe der Erweiterungen in der Toolleiste des Editors (ctx.ui.addToolbarButton): { entry, item }
    editPromise: null,          // Sichern nach der letzten Änderung im Editor (onEdit), für applyEdit
    tableFormatters: [],        // Format der Tabellen aus Erweiterungen (ctx.tables.format, seit 2.10.0): { entry, fn }
    mapSections: [],            // Abschnitte unter der Mindmap in Export und Druck (ctx.export.addMapSection, seit 2.11.0): { entry, fn }
    mapStyles: [],              // Farben im Mindmap-Bild für Export, Druck und Kopie (ctx.export.addMapStyle, seit 3.1.0): { entry, fn }
    contextSub: null,           // offenes Untermenü des Kontextmenüs: { anchor, el }
    contextUse: null,           // Kontextmenü eines Knotens mit Einträgen der Erweiterungen: { multi, applied }
    editorMode: 'edit',   // 'edit' | 'split' | 'preview'
    listScope: 'live',    // 'live' | 'trash'
    tagFilter: '',
    mapMatches: [],       // ids der Treffer in der Mindmap (Reihenfolge wie Liste)
    mapMatchIndex: -1,
    mapSearchTimer: null,
    attachmentUrls: new Map(), // id → Objekt-URL für den Druck (der Editor hat seine eigenen)
    multi: new Set(),          // Mehrfachauswahl (Mindmap und Liste)
    printNoteId: null,         // Notiz, auf die sich der Druckdialog bezieht
    tStatus: 'open',
    tSort: 'due',
    tQuery: '',
    tTag: '',
    tPerson: '',          // Filter «an @kürzel» in den Aufgaben (seit 2.11.0)
    tSearchTimer: null,
    calHandle: null,          // gemerkte Kalenderdatei (.ics)
    showArchive: false,       // archivierte Notizen in der Mindmap zeigen
    showLinks: true,          // Querverweise als gestrichelte Linien in der Mindmap zeigen
    renderTokens: {},         // je Ansicht der neueste Zeichenauftrag; ältere, spät fertige werden verworfen
    sync: null,               // Stand der offenen Notiz (siehe newSync): worauf der Editor aufbaut, Speichervorgang, Konflikt
    searchTimer: null,
  };

  // ---------- Hilfen ----------

  /** Die Ansichten «Fragen» und «Entscheide» teilen sich Leiste und Liste. */
  const inQuestions = () => state.view === 'questions' || state.view === 'decisions';

  /** Neuester Zeichenauftrag je Bereich: nach einem await prüft isLatest(), ob inzwischen ein neuerer begonnen hat. */
  function fresh(key) {
    const n = (state.renderTokens[key] || 0) + 1;
    state.renderTokens[key] = n;
    return () => state.renderTokens[key] === n;
  }

  const fmtDateTime = new Intl.DateTimeFormat(I18n.locale(), { dateStyle: 'medium', timeStyle: 'short' });
  const fmtTime = new Intl.DateTimeFormat(I18n.locale(), { timeStyle: 'short' });

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

  /** Statusleiste unten; ein Fehler erscheint zusätzlich kurz als Banner oben. */
  function setStatus(text, stateName) {
    el.status.textContent = text;
    el.status.dataset.state = stateName || '';
    if (stateName === 'error') showToast(text);
  }

  const TOAST_MS = 7000;
  let toastTimer = null;
  function showToast(text) {
    el.toastText.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, TOAST_MS);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    el.toast.hidden = true;
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

  let B = null;       // Backend (asynchron), kommt aus der Ausprägung
  let shell = null;   // Hülle der Ausprägung (lokal: Speichern, Datei, Import)

  // Lesemodus: Meldet die Hülle `readOnly`, darf die Person nichts ändern (zum Beispiel Rolle «nur lesen»). Die Oberfläche blendet die
  // Schreibwege aus (Attribut data-write), jede Funktion, die schreiben würde, bricht mit einem Hinweis ab, und das Backend lehnt
  // schreibende Aufrufe selbst ab (readOnlyBackend) – auch für Erweiterungen. Ausgenommen ist die persönliche Ansicht (Auf-/Zuklappen).
  const readOnly = () => !!(shell && shell.readOnly);
  const VIEW_STATE_CALLS = new Set(['setCollapsed', 'setAllCollapsed']);
  function denyWrite() {
    if (!readOnly()) return false;
    hint(t('Nur lesen: In diesem Arbeitsbereich sind Änderungen nicht erlaubt.'));
    return true;
  }
  function readOnlyBackend(backend) {
    const blocked = new Set([...Backend.MUTATING].filter(m => !VIEW_STATE_CALLS.has(m)));
    return new Proxy(backend, {
      get(target, prop) {
        if (blocked.has(prop)) return async () => { throw Object.assign(new Error('Nur lesen'), { code: 'READ_ONLY' }); }; // i18n-ignore: die Oberfläche übersetzt über die Kennung
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  }

  /** Wird von der Hülle aufgerufen, wenn sie die Datenbank austauscht (Datei öffnen, Import). */
  function onDatabaseReplaced() {
    for (const id of [...state.attachmentUrls.keys()]) forgetAttachmentUrl(id);
    if (editor) editor.forgetAttachment(); // die Nummern der Bilder gehören zur alten Datenbank
    state.currentId = null;
    state.sync = newSync(null);
    hideBanner();
    state.query = '';
    state.mapSelection = null;
    state.multi.clear(); // die Nummern gehören zur alten Datenbank (anderer Bereich, andere Datei)
    renderMulti();
    state.mapDirty = true;
    state.accentStale = true;
    state.tagFilter = '';
    state.qTag = '';
    state.listScope = 'live';
    el.listScope.value = 'live';
    el.search.value = '';
    el.mapSearch.value = '';
    showEditorView(false);
    document.body.classList.remove('editor-open');
    if (state.map) state.map.requestFit();
    replaceNav(); // keine Notiz mehr offen
  }

  /** Vor der Umstellung auf v3.0.0 (Termine mit «>» statt «@», lokale Hülle): einmal fragen, ob vorher eine Sicherung des alten
   *  Stands heruntergeladen werden soll. 'backup' (auch bei Esc) oder 'skip'. */
  function confirmMigration(info) {
    const d = $('#migrateDialog');
    $('#migrateText').textContent = tn('Im Bereich «{bereich}» stellt NoNotes jetzt {n} Notiz um.', 'Im Bereich «{bereich}» stellt NoNotes jetzt {n} Notizen um.', info.notes, { bereich: info.area });
    return new Promise(resolve => {
      d.returnValue = '';
      d.addEventListener('close', () => resolve(d.returnValue === 'skip' ? 'skip' : 'backup'), { once: true });
      d.showModal();
    });
  }

  function shellHost() {
    return {
      el: {
        createFileBtn: el.createFileBtn, openFileBtn: el.openFileBtn, disconnectBtn: el.disconnectBtn,
        downloadBtn: el.downloadBtn, importBtn: el.importBtn, importInput: el.importInput,
        storageInfo: el.storageInfo, menuHint: el.menuHint, areasBtn: el.areasBtn,
      },
      setStatus, showBanner, hideBanner, closeMenu,
      showMenu: (items, x, y, opts) => showContextMenu(items, x, y, opts),
      ensureSaved: () => ensureSaved(),
      renderAll: () => renderAll(),
      onDatabaseReplaced,
      confirmMigration,
      // Adresse nachführen (v2.7.0); false, solange die Navigation noch nicht läuft (dann setzt die Hülle die Adresse selbst)
      replaceNav: () => { if (!state.navReady) return false; replaceNav(); return true; },
    };
  }

  async function boot() {
    el.version.textContent = window.NONOTES_VERSION || 'dev';

    const edition = window.NoNotesEdition;
    if (!edition) throw new Error(t('Es ist keine Ausprägung geladen.'));
    shell = edition.createShell(shellHost());
    createEditor(); // NoNotesEditor (Paket nonotes-editor); stellt auch NoNotesMarkdown auf lokale Pfade ein
    state.pluginFiles = loadPluginChoice();
    await Plugins.loadAll(state.pluginFiles); // feste Liste und die hier eingeschalteten Dateien aus plugins/, bevor etwas gezeichnet wird (Designs)
    try { applyTheme(localStorage.getItem(THEME_KEY) || ''); } catch (e) { /* ohne Zwischenspeicher: Standard */ }
    B = await shell.start();
    if (readOnly()) { B = readOnlyBackend(B); document.body.classList.add('readonly-mode'); }
    if (B.capabilities && B.capabilities.files === false) { // Backend ohne Dateien auf dem Gerät: kein Datei-Menü
      for (const b of [el.createFileBtn, el.openFileBtn, el.disconnectBtn]) { b.hidden = true; b.disabled = true; }
    }
    await loadAccent();
    await loadTheme();
    if (Store.fileAccess.supported) state.calHandle = await Store.browserStore.loadHandleKey(CAL_HANDLE_KEY);

    state.map = Mindmap.create(el.mindmap, {
      onSelect: (id, opts) => {
        if (opts && opts.toggle && typeof id === 'number') { toggleMulti(id); return; }
        state.mapSelection = id;
      },
      onSelectionChange: id => emitPlugins('mindmap:select', { id }),
      onOpen: id => openNote(id),
      onOpenRoot: () => beginRename('root'),
      onReparent: (id, parentId, where, side) => moveNoteTo(id, parentId, where, side),
      onSides: sides => keepSides(sides),
      onToggleCollapse: id => toggleCollapse(id),
      onContextMenu: (id, x, y) => showNodeMenu(id, x, y),
      onOpenLink: id => openNodeLink(id),
      linkTitle: url => nodeLinkTitle(url),
    });

    wireEvents();
    shell.bind();

    let view = 'map';
    try {
      view = localStorage.getItem(VIEW_KEY) || 'map';
      state.showArchive = localStorage.getItem(ARCHIVE_KEY) === '1';
      state.showLinks = localStorage.getItem(LINKS_KEY) !== '0';
    } catch (e) { /* egal */ }

    el.boot.hidden = true;
    el.app.hidden = false;
    await setView(['list', 'questions', 'decisions', 'tasks'].includes(view) ? view : 'map');
    await renderAll();
    shell.afterReady();
    await startNav();
    setupTemplates();
    Mentions.provide(localPeople); // Kürzel, die in der Datei schon vorkommen
    await Plugins.activateAll(pluginContext);
    renderPlugins();
    await attachAgent();
    document.body.dataset.ready = 'true';
    emitPlugins('ready', {});
  }

  /** Werkzeuge für den Agenten des Browsers (WebMCP, packages/agent/): derselbe Katalog wie im Dienst, im Lesemodus nur lesende.
   *  Nach einer Änderung durch den Agenten zeichnet die Oberfläche neu; gespeichert wird über das Backend wie bei jeder Eingabe. */
  async function attachAgent() {
    if (!window.NoNotesAgent || !window.NoNotesWebMcp) return;
    try {
      state.agent = window.NoNotesAgent.create(B, { readOnly: readOnly(), author: shell.userName || null, log: console.warn, templates: templateStore(), templateContext });
      state.webmcp = await window.NoNotesWebMcp.attach({ catalog: state.agent, onChange: async () => { markEdited(); await renderAll(); }, log: console.warn });
    } catch (e) { console.warn('WebMCP', e); }
  }

  /** Sprachwechsel in der Kopfleiste (seit 3.1.0): Knopf mit Flagge und Kürzel, Liste mit Flagge und Namen jeder Sprache (nach Namen
   *  sortiert). Nur sichtbar, wenn mehr als eine Sprache vorhanden ist. Der Wechsel sichert die offene Notiz und lädt die Seite neu. */
  function setupLanguage() {
    const Flags = window.NoNotesFlags;
    const flag = country => (Flags ? Flags.element(country) : document.createTextNode(''));
    const collator = new Intl.Collator(I18n.locale());
    const langs = I18n.available().slice().sort((a, b) => collator.compare(a.name, b.name));
    el.langMenu.hidden = langs.length < 2;
    if (langs.length < 2) return;
    const current = I18n.language();
    const mine = langs.find(l => l.code === current) || { code: current, name: current, flag: '' };
    const code = document.createElement('span');
    code.className = 'lang-code';
    code.textContent = mine.code.split('-')[0].toUpperCase();
    el.langBtn.replaceChildren(flag(mine.flag), code);
    el.langBtn.title = t('Sprache: {sprache}', { sprache: mine.name });
    el.langBtn.setAttribute('aria-label', el.langBtn.title);
    el.langList.setAttribute('aria-label', t('Sprache'));
    el.langList.replaceChildren(...langs.map(l => {
      const o = document.createElement('div');
      o.className = 'lang-option';
      o.setAttribute('role', 'option');
      o.tabIndex = -1;
      o.dataset.lang = l.code;
      o.lang = l.code; // der Name steht in seiner eigenen Sprache
      o.setAttribute('aria-selected', String(l.code === current));
      const name = document.createElement('span');
      name.textContent = l.name;
      const check = document.createElement('span');
      check.className = 'lang-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      o.append(flag(l.flag), name, check);
      return o;
    }));
    const options = () => [...el.langList.querySelectorAll('.lang-option')];
    const open = focusSelected => {
      closeMenu();
      el.langList.hidden = false;
      el.langBtn.setAttribute('aria-expanded', 'true');
      if (focusSelected) (el.langList.querySelector('[aria-selected="true"]') || options()[0]).focus();
    };
    const close = focusButton => {
      if (el.langList.hidden) return;
      el.langList.hidden = true;
      el.langBtn.setAttribute('aria-expanded', 'false');
      if (focusButton) el.langBtn.focus();
    };
    state.closeLangList = () => close(false);
    const choose = async target => {
      close(true);
      if (!target || target === I18n.language()) return;
      I18n.setLanguage(target, true);
      // Erst die offene Notiz sichern: sonst fragt beforeunload nach «ungespeicherten Änderungen» oder das Neuladen bleibt hängen.
      // Bei einem Konflikt entscheidet die Person zuerst; die Sprache gilt dann beim nächsten Laden.
      try { if (!(await ensureSaved())) return; } catch (e) { /* neu laden trotzdem */ }
      try { await shell.flush(); } catch (e) { /* neu laden trotzdem */ }
      location.reload();
    };
    el.langBtn.addEventListener('click', () => (el.langList.hidden ? open(true) : close(false)));
    el.langBtn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(true); }
    });
    el.langList.addEventListener('click', e => {
      const o = e.target.closest('.lang-option');
      if (o) choose(o.dataset.lang);
    });
    el.langList.addEventListener('keydown', e => {
      const list = options();
      const i = list.indexOf(document.activeElement);
      const go = n => { e.preventDefault(); list[(n + list.length) % list.length].focus(); };
      if (e.key === 'ArrowDown') go(i + 1);
      else if (e.key === 'ArrowUp') go(i < 0 ? list.length - 1 : i - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(list.length - 1);
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) choose(list[i].dataset.lang); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close(false);
      else if (e.key.length === 1 && /\S/.test(e.key)) { // Anfangsbuchstabe: zur nächsten Sprache, deren Name so beginnt
        const k = e.key.toLowerCase();
        const next = list.slice(i + 1).concat(list.slice(0, i + 1)).find(o => o.textContent.trim().toLowerCase().startsWith(k));
        if (next) { e.preventDefault(); next.focus(); }
      }
    });
    document.addEventListener('click', e => { if (!e.target.closest('#langMenu')) close(false); });
  }

  function bootError(message) {
    el.boot.textContent = message;
    el.boot.classList.add('error');
  }

  /** Die Oberfläche markiert nur, dass sich Daten geändert haben; das Sichern ist Sache der Hülle. */
  function markEdited() {
    state.mapDirty = true;
  }

  /** Zustand für die Statuszeile: noch nicht gesichert oder gesichert. */
  function saveState() {
    return shell && shell.isDirty() ? 'dirty' : 'saved';
  }

  // ---------- Kalenderexport ----------

  async function updateCalDialog() {
    const c = await Cal.count(B, el.calIncludeDone.checked);
    el.calSummary.textContent = c.total === 0
      ? t('Es gibt noch keine Aufgaben oder Fragen mit Termin.')
      : joinParts(
        tn('{n} Termin: {offen} offen', '{n} Termine: {offen} offen', c.total, { offen: c.open }),
        c.cancelled ? t('{n} erledigt/beantwortet (als abgesagt)', { n: c.cancelled }) : '',
        c.removed ? t('{n} entfernt (als abgesagt)', { n: c.removed }) : '');
    const fsa = Store.fileAccess.supported;
    el.calFileSet.hidden = !fsa;
    el.calWriteBtn.hidden = !fsa;
    el.calPickBtn.hidden = !fsa || !state.calHandle;
    if (fsa) {
      el.calFileInfo.textContent = state.calHandle
        ? t('Gemerkte Datei: „{name}“. «Kalenderdatei aktualisieren» überschreibt sie mit dem aktuellen Stand.', { name: state.calHandle.name })
        : t('Noch keine Kalenderdatei gemerkt. «Kalenderdatei anlegen…» fragt einmal nach dem Speicherort und merkt ihn sich.');
      el.calWriteBtn.textContent = state.calHandle ? t('Kalenderdatei aktualisieren') : t('Kalenderdatei anlegen…');
    }
    const disabled = c.total === 0;
    el.calWriteBtn.disabled = disabled;
    el.calDownloadBtn.disabled = disabled;
  }

  async function openCalDialog() {
    closeMenu();
    await updateCalDialog();
    if (typeof el.calDialog.showModal === 'function') el.calDialog.showModal();
    else el.calDialog.setAttribute('open', '');
  }

  function closeCalDialog() {
    if (el.calDialog.open) el.calDialog.close();
  }

  async function buildCalendar() {
    const result = await Cal.build(B, { includeDone: el.calIncludeDone.checked, alarms: el.calAlarms.checked });
    markEdited(); // Kennung und Versionsnummer liegen in der Datenbank
    return result;
  }

  async function runCalendarExport(target) {
    try {
      if (target === 'download') {
        const r = await buildCalendar();
        Store.download(new TextEncoder().encode(r.ics), CAL_FILENAME);
        closeCalDialog();
        setStatus(t('Kalenderdatei heruntergeladen: {gesamt} Termine (Version {version})', { gesamt: r.total, version: r.sequence }), 'dirty');
        return;
      }
      let handle = state.calHandle;
      if (target === 'pick' || !handle) {
        handle = await Store.fileAccess.pickNew(CAL_FILENAME, Store.fileAccess.ICS_TYPES);
      }
      const perm = await Store.fileAccess.permission(handle, true);
      if (perm !== 'granted') { setStatus(t('Kein Schreibzugriff auf die Kalenderdatei'), 'error'); return; }
      const r = await buildCalendar();
      await Store.fileAccess.write(handle, new TextEncoder().encode(r.ics));
      if (handle !== state.calHandle) {
        state.calHandle = handle;
        try { await Store.browserStore.saveHandleKey(CAL_HANDLE_KEY, handle); }
        catch (e) { console.warn('Kalenderdatei kann nicht gemerkt werden', e); }
      }
      closeCalDialog();
      setStatus(t('Kalenderdatei „{name}“ aktualisiert: {gesamt} Termine (Version {version})', { name: handle.name, gesamt: r.total, version: r.sequence }), 'dirty');
    } catch (e) {
      if (isAbort(e)) return;
      console.error(e);
      setStatus(t('Kalenderexport fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
    }
  }

  // ---------- Export ----------

  function openExportDialog() {
    closeMenu();
    el.exportDirBtn.hidden = typeof window.showDirectoryPicker !== 'function';
    el.exportHint.textContent = el.exportDirBtn.hidden
      ? t('Dieser Browser kann nicht direkt in Ordner schreiben; das ZIP enthält dieselben Dateien.')
      : '';
    if (typeof el.exportDialog.showModal === 'function') el.exportDialog.showModal();
    else el.exportDialog.setAttribute('open', '');
  }

  function closeExportDialog() {
    if (el.exportDialog.open) el.exportDialog.close();
  }

  async function runExport(target) {
    const mode = (el.exportForm.querySelector('input[name="exportMode"]:checked') || {}).value || 'folder';
    el.exportHint.textContent = t('Export wird vorbereitet…');
    el.exportDirBtn.disabled = true;
    el.exportZipBtn.disabled = true;
    try {
      const archived = el.exportArchive.checked;
      const style = await mapStyleFor('export', (await B.getTree({ archive: archived })).map(r => r.id));
      const svg = await Exporter.renderSvg(B, { archived, sides: state.map.sides(), style });
      let png = null;
      try { png = await Exporter.svgToPng(svg, 2); }
      catch (e) { console.warn('PNG', e); }
      const files = await Exporter.buildFiles(B, { mode, svg, png, version: window.NONOTES_VERSION || 'dev', archived, sections: await mapSectionsFor('export') });
      const n = files.length;
      if (target === 'dir') {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        await Exporter.writeToDirectory(dir, files);
        closeExportDialog();
        setStatus(t('Export gespeichert: {n} Dateien in „{name}“', { n, name: dir.name }) + (png ? '' : ' (ohne PNG)'), saveState());
      } else {
        const bytes = Zip.create(files);
        Store.download(bytes, await Exporter.suggestedZipName(B));
        closeExportDialog();
        setStatus(t('Export als ZIP heruntergeladen ({n} Dateien)', { n }) + (png ? '' : ', ohne PNG'), saveState());
      }
    } catch (e) {
      if (isAbort(e)) { el.exportHint.textContent = ''; return; }
      console.error(e);
      el.exportHint.textContent = t('Export fehlgeschlagen: {fehler}', { fehler: errorText(e) });
    } finally {
      el.exportDirBtn.disabled = false;
      el.exportZipBtn.disabled = false;
    }
  }

  // ---------- Ansichten ----------

  async function setView(view) {
    state.view = view;
    document.body.classList.toggle('view-map', view === 'map');
    document.body.classList.toggle('view-list', view === 'list');
    document.body.classList.toggle('view-questions', view === 'questions');
    document.body.classList.toggle('view-decisions', view === 'decisions');
    document.body.classList.toggle('view-tasks', view === 'tasks');
    el.viewMapBtn.setAttribute('aria-selected', String(view === 'map'));
    el.viewListBtn.setAttribute('aria-selected', String(view === 'list'));
    el.viewQuestionsBtn.setAttribute('aria-selected', String(view === 'questions'));
    el.viewDecisionsBtn.setAttribute('aria-selected', String(view === 'decisions'));
    if (view !== 'decisions' && el.viewDecisionsBtn.dataset.empty === '1') el.viewDecisionsBtn.hidden = true; // Reiter nur, wenn es Entscheide gibt
    el.viewTasksBtn.setAttribute('aria-selected', String(view === 'tasks'));
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* egal */ }
    document.body.classList.remove('editor-open');
    hideContextMenu();
    await cancelRename();
    if (view === 'map') {
      await renderMap();
      el.mindmap.focus({ preventScroll: true });
    } else if (view === 'questions' || view === 'decisions') {
      renderQuestionChrome();
      await renderQuestions();
    } else if (view === 'tasks') {
      await renderTasks();
    } else {
      await renderList();
      await renderEditor();
    }
    renderMulti();
    pushNav();
  }

  /** Zeichnet die aktive Ansicht neu (nach Schliessen des Editors oder Änderungen). */
  async function renderCurrentView() {
    if (state.view === 'map') await renderMap();
    else if (inQuestions()) await renderQuestions();
    else if (state.view === 'tasks') await renderTasks();
    else { await renderList(); await renderEditor(); }
  }

  // ---------- Darstellung ----------

  async function renderAll() {
    const replaced = state.accentStale;
    if (state.accentStale) { await loadAccent(); await loadTheme(); }
    // Erweiterungen erfahren vom Wechsel der Datenbank vor dem Zeichnen (seit 2.8.1): Zwischenstände zur alten Datei
    // (gleiche Nummern, andere Notizen) dürfen nicht in die neue Mindmap geraten.
    if (replaced) emitPlugins('database:replaced', {});
    // Unabhängige Abfragen gleichzeitig stellen: bei einem Backend über das Netz zählt jede Laufzeit nur einmal.
    await Promise.all([renderTagFilters(), renderList(), renderEditor(), renderCount(), renderMap(), renderQuestionCounts(), renderTaskCounts()]);
    if (inQuestions()) await renderQuestions();
    if (state.view === 'tasks') await renderTasks();
  }

  // ---------- Hauptfarbe ----------

  /** Wendet eine Hauptfarbe an: Seite, Zwischenspeicher, Auswahl im Menü. */
  function applyAccent(id) {
    id = Palette.normalize(id);
    state.accent = id;
    paintAccent(id);
    try { localStorage.setItem(ACCENT_KEY, id); } catch (e) { /* egal */ }
    for (const b of el.accentSwatches.children) b.setAttribute('aria-pressed', String(b.dataset.accent === id));
  }

  /** Liest die Hauptfarbe der Datenbank (fehlt sie, gilt die Vorgabe Blau). */
  async function loadAccent() {
    state.accentStale = false;
    applyAccent(await B.getMeta('accent'));
  }

  async function chooseAccent(id) {
    if (denyWrite()) return;
    applyAccent(id);
    await B.setMeta('accent', state.accent);
    setStatus(t('Hauptfarbe: {farbe}', { farbe: Palette.name(state.accent) }), saveState());
  }

  function setupAccent() {
    el.accentSwatches.replaceChildren(...Palette.COLORS.map(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.accent = c.id;
      b.style.setProperty('--sw-l', c.light.accent);
      b.style.setProperty('--sw-d', c.dark.accent);
      b.title = Palette.name(c.id);
      b.setAttribute('aria-label', Palette.name(c.id));
      b.setAttribute('aria-pressed', String(c.id === state.accent));
      b.addEventListener('click', () => chooseAccent(c.id));
      return b;
    }));
  }

  // ---------- Design (aus einer Erweiterung) ----------

  function paintTheme(theme) {
    let style = document.getElementById('themeStyle');
    const css = Plugins.themeCss(theme);
    if (!css) { if (style) style.remove(); return; }
    if (!style) {
      style = document.createElement('style');
      style.id = 'themeStyle';
      document.head.appendChild(style);
    }
    style.textContent = css;
    const accent = document.getElementById('accentStyle');
    if (accent) document.head.appendChild(accent); // die Hauptfarbe steht zuletzt und gewinnt
  }

  /** Wendet das Design einer Erweiterung an (leer oder unbekannt: Standard). */
  function applyTheme(id) {
    const theme = id ? Plugins.theme(id) : null;
    state.theme = theme ? theme.id : '';
    paintTheme(theme);
    try {
      if (state.theme) localStorage.setItem(THEME_KEY, state.theme); else localStorage.removeItem(THEME_KEY);
    } catch (e) { /* egal */ }
    el.themeSelect.value = state.theme;
  }

  async function loadTheme() {
    applyTheme(await B.getMeta('theme'));
  }

  async function chooseTheme(id) {
    if (denyWrite()) return;
    applyTheme(id);
    await B.setMeta('theme', state.theme);
    const theme = state.theme ? Plugins.theme(state.theme) : null;
    setStatus(t('Design: {name}', { name: theme ? theme.name : t('Standard') }), saveState());
  }

  /** Auswahl im Menü, nur sichtbar, wenn eingeschaltete Erweiterungen Designs mitbringen. */
  function renderThemeOptions() {
    const themes = Plugins.themes();
    el.themeRow.hidden = themes.length === 0;
    const standard = document.createElement('option');
    standard.value = '';
    standard.textContent = t('Standard');
    el.themeSelect.replaceChildren(standard, ...themes.map(th => {
      const o = document.createElement('option');
      o.value = th.id;
      o.textContent = th.name;
      return o;
    }));
    el.themeSelect.value = state.theme;
  }

  function setupTheme() {
    renderThemeOptions();
    el.themeSelect.addEventListener('change', () => chooseTheme(el.themeSelect.value));
  }

  // ---------- Verlauf ----------

  /** Dialog mit den früheren Fassungen der offenen Notiz. */
  async function openHistoryDialog() {
    if (state.currentId == null) return;
    state.history = { noteId: state.currentId, items: [], selected: null, token: 0 };
    await renderHistoryList();
    if (typeof el.historyDialog.showModal === 'function') el.historyDialog.showModal();
    else el.historyDialog.setAttribute('open', '');
  }

  function closeHistoryDialog() {
    if (el.historyDialog.open) el.historyDialog.close();
  }

  async function renderHistoryList(selectId) {
    const h = state.history;
    const note = await B.getNote(h.noteId);
    if (!note) { closeHistoryDialog(); return; }
    h.items = await B.listHistory(h.noteId);
    h.locked = !!note.archived_at;
    el.historyLead.textContent = t('Frühere Fassungen von «{titel}»', { titel: note.title.trim() || t('Ohne Titel') });
    el.historyList.replaceChildren();
    el.historyRestoreBtn.disabled = true;
    el.historyClearBtn.disabled = h.items.length === 0;
    if (!h.items.length) {
      const li = document.createElement('li');
      li.className = 'history-empty';
      li.textContent = t('Noch keine früheren Fassungen. Eine Fassung entsteht, sobald du nach einer Pause weiterarbeitest.');
      el.historyList.appendChild(li);
      h.selected = null;
      el.historyMeta.textContent = '';
      el.historyText.replaceChildren();
      el.historyLegend.textContent = '';
      return;
    }
    // Vermerk: an dieser Stelle hat die Umstellung auf v3.0.0 die Termine von «@» auf «>» umgeschrieben (meta dates_migrated_at)
    let migratedAt = null;
    try { migratedAt = await B.getMeta('dates_migrated_at'); } catch (e) { /* ohne Vermerk */ }
    for (const item of h.items) {
      if (migratedAt && item.at < migratedAt) {
        const mark = document.createElement('li');
        mark.className = 'history-mark';
        mark.textContent = t('{datum}: Umstellung auf v3.0.0, Termine mit «>» statt «@». Ältere Fassungen zeigen sie teils noch mit «@».', { datum: fmtDate(migratedAt) });
        el.historyList.appendChild(mark);
        migratedAt = null;
      }
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = String(item.id);
      const time = document.createElement('span');
      time.className = 'h-time';
      time.textContent = fmtDate(item.at);
      const info = document.createElement('span');
      info.className = 'h-info';
      const parts = [item.title.trim() || t('Ohne Titel')];
      if (item.author) parts.push(t('von {name}', { name: item.author }));
      if (item.titleChanged) parts.push(t('Titel danach geändert'));
      if (item.added || item.removed) parts.push(t('danach +{plus} −{minus} Zeichen', { plus: item.added, minus: item.removed }));
      info.textContent = parts.join(' · ');
      b.append(time, info);
      b.addEventListener('click', () => selectHistory(item.id));
      li.appendChild(b);
      el.historyList.appendChild(li);
    }
    const keep = selectId != null && h.items.some(i => i.id === selectId) ? selectId : h.items[0].id;
    await selectHistory(keep);
  }

  async function selectHistory(id) {
    const h = state.history;
    const token = ++h.token;
    const version = await B.getHistoryVersion(h.noteId, id);
    if (token !== h.token) return; // zwischenzeitlich eine andere Fassung gewählt
    const note = await B.getNote(h.noteId);
    h.selected = id;
    h.version = version;
    h.currentBody = note ? note.body : '';
    for (const b of el.historyList.querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.id === String(id)));
    el.historyMeta.textContent = version.author
      ? t('Fassung vom {datum} von {name}: «{titel}»', { datum: fmtDate(version.at), name: version.author, titel: version.title.trim() || t('Ohne Titel') })
      : t('Fassung vom {datum}: «{titel}»', { datum: fmtDate(version.at), titel: version.title.trim() || t('Ohne Titel') });
    el.historyRestoreBtn.disabled = !!h.locked;
    el.historyRestoreBtn.title = h.locked ? t('Archivierte Notizen sind schreibgeschützt. Erst zurückholen.') : '';
    renderHistoryText();
  }

  /** Text der gewählten Fassung; auf Wunsch mit den Zeilen, die beim Wiederherstellen dazukommen oder verloren gehen. */
  function renderHistoryText() {
    const h = state.history;
    if (!h || !h.version) return;
    const box = el.historyText;
    box.replaceChildren();
    const mark = el.historyDiff.checked;
    el.historyLegend.textContent = mark ? t('Grün: kommt beim Wiederherstellen dazu. Rot, durchgestrichen: geht dabei verloren.') : '';
    if (!mark) { box.textContent = h.version.body; return; }
    const frag = document.createDocumentFragment();
    for (const line of NoNotesHistory.lineDiff(h.currentBody, h.version.body)) {
      const div = document.createElement('div');
      div.className = 'hl ' + (line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : 'same');
      div.textContent = line.text === '' ? ' ' : line.text; // eine leere Zeile behält ihre Höhe
      frag.appendChild(div);
    }
    box.appendChild(frag);
  }

  async function restoreHistoryVersion() {
    if (denyWrite()) return;
    const h = state.history;
    if (!h || h.selected == null) return;
    const at = h.version ? fmtDate(h.version.at) : '';
    try {
      await B.restoreHistoryVersion(h.noteId, h.selected);
    } catch (e) {
      setStatus(errorText(e), 'error');
      return;
    }
    closeHistoryDialog();
    markEdited();
    await renderAll();
    setStatus(t('Fassung vom {datum} wiederhergestellt', { datum: at }), saveState());
  }

  async function clearHistory() {
    if (denyWrite()) return;
    const h = state.history;
    if (!h || !h.items.length) return;
    if (!confirm(t('Den Verlauf dieser Notiz löschen? Der aktuelle Text bleibt erhalten.'))) return;
    await B.clearHistory(h.noteId);
    markEdited();
    await renderHistoryList();
  }

  // ---------- Erweiterungen ----------

  /** Meldet ein Ereignis den Erweiterungen und als DOM-Ereignis «nonotes:<name>» am Dokument (für Ausprägungen und fremde Skripte). */
  const emitPlugins = (event, data) => {
    try { document.dispatchEvent(new CustomEvent('nonotes:' + event, { detail: data })); } catch (e) { /* egal */ }
    Plugins.emit(event, data);
  };

  /** «Gespeichert»-Ereignis nach einer Pause im Tippen, nicht bei jedem Zeichen. */
  function scheduleSavedEvent(id) {
    clearTimeout(state.pluginSavedTimer);
    state.pluginSavedTimer = setTimeout(() => emitPlugins('note:saved', { id }), 700);
  }

  /** Führt Code einer Erweiterung aus; ein Fehler trifft nur die Erweiterung und erscheint in der Statuszeile. */
  async function runPlugin(entry, fn) {
    try {
      await fn();
    } catch (e) {
      entry.error = (e && e.message) || String(e);
      console.warn(`Erweiterung ${entry.id}`, e); // i18n-ignore: Protokoll
      setStatus(t('Erweiterung «{name}»: {fehler}', { name: entry.name, fehler: entry.error }), 'error');
    }
  }

  function pluginEditorApi() {
    const writable = () => state.currentId != null && !el.body.readOnly && isEditorOpen();
    return Object.freeze({
      noteId: () => (isEditorOpen() ? state.currentId : null),
      isWritable: writable,
      selection: () => ({ start: el.body.selectionStart || 0, end: el.body.selectionEnd || 0, text: el.body.value.slice(el.body.selectionStart || 0, el.body.selectionEnd || 0) }),
      /** Ersetzt die Markierung (oder fügt am Cursor ein). Liefert false, wenn gerade nichts zu bearbeiten ist. */
      replaceSelection: async text => {
        if (!writable()) return false;
        const value = el.body.value;
        const s = el.body.selectionStart || 0;
        const e = el.body.selectionEnd || s;
        const insert = String(text);
        await applyEdit({ text: value.slice(0, s) + insert + value.slice(e), selStart: s + insert.length, selEnd: s + insert.length });
        return true;
      },
    });
  }

  /** Die Schnittstelle, die activate(ctx) einer Erweiterung bekommt. Stabil innerhalb der Version 1.x. */
  function pluginContext(entry) {
    const id = entry.id;
    return Object.freeze({
      id,
      api: Plugins.API,
      appVersion: window.NONOTES_VERSION || 'dev',
      backend: B,
      language: () => I18n.language(),
      on: (event, fn) => Plugins.on(id, event, fn),
      openNote: noteId => openNote(noteId),
      refresh: async () => { state.mapDirty = true; await renderAll(); },
      readOnly: () => readOnly(),
      ui: Object.freeze({
        setStatus: (text, kind) => setStatus(String(text), ['saved', 'dirty', 'saving', 'error'].includes(kind) ? kind : ''),
        addMenuItem: item => addPluginMenuItem(entry, item),
        addToolbarButton: item => addPluginToolbarButton(entry, item),
        addContextMenuItem: item => addPluginContextItem(entry, item),
        addTableMenuItem: item => addPluginContextItem(entry, item, state.pluginTableItems, 'addTableMenuItem'),
        addMapButton: item => addPluginMapButton(entry, item),
        addMapOverlay: element => addPluginMapOverlay(entry, element),
      }),
      export: Object.freeze({ addMapSection: fn => addMapSection(entry, fn), addMapStyle: fn => addMapStyle(entry, fn) }),
      editor: pluginEditorApi(),
      tables: Object.freeze({
        format: fn => addTableFormatter(entry, fn),
        update: (target, fn) => updateTableMeta(entry, target, fn),
      }),
      people: Object.freeze({ provide: fn => providePeople(id, fn) }),
    });
  }

  /** Vorschläge für @kürzel aus einer Erweiterung; beim Ausschalten wieder abgemeldet. */
  function providePeople(id, fn) {
    const off = Mentions.provide(fn);
    if (!state.pluginProviders.has(id)) state.pluginProviders.set(id, []);
    state.pluginProviders.get(id).push(off);
    return off;
  }

  function checkItem(item, what) {
    if (!item || typeof item.label !== 'string' || !item.label.trim() || typeof item.action !== 'function') {
      throw new Error(t('{was} braucht label (Text) und action (Funktion)', { was: what }));
    }
  }

  function addPluginMenuItem(entry, item) {
    checkItem(item, 'addMenuItem');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.dataset.plugin = entry.id;
    const icon = document.createElement('span');
    icon.className = 'mi'; // leerer Platz, damit der Text mit den Einträgen der App bündig steht
    b.append(icon, item.label);
    if (item.title) b.title = String(item.title);
    b.addEventListener('click', () => { closeMenu(); runPlugin(entry, () => item.action()); });
    el.pluginMenu.appendChild(b);
    el.pluginMenu.hidden = false;
  }

  /** Knopf in der Leiste der Mindmap (seit 2.11.0), vor dem Suchfeld; action(button). Liefert den Knopf (etwa für aria-pressed). */
  function addPluginMapButton(entry, item) {
    checkItem(item, 'addMapButton');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-plugin-btn';
    b.dataset.plugin = entry.id;
    b.textContent = item.label;
    b.title = String(item.title || item.label);
    b.addEventListener('click', () => runPlugin(entry, () => item.action(b)));
    el.mapSearch.before(b);
    return b;
  }

  /** Element über der Mindmap (seit 2.11.0), etwa eine Legende; die Erweiterung setzt Lage und Aussehen. Liefert eine Funktion,
   *  die es wieder entfernt; beim Ausschalten entfernt es die App. */
  function addPluginMapOverlay(entry, element) {
    if (!(element instanceof HTMLElement)) throw new Error(t('{was} braucht ein Element', { was: 'addMapOverlay' }));
    element.dataset.plugin = entry.id;
    element.classList.add('map-overlay');
    el.mapView.appendChild(element);
    return () => element.remove();
  }

  /** Abschnitt unter dem Mindmap-Bild im Markdown-Export und im Druck (seit 2.11.0): fn({ target: 'export' | 'print' }) liefert
   *  (auch als Promise) { title, markdown } oder nichts. Liefert eine Funktion zum Abmelden. */
  function addMapSection(entry, fn) {
    if (typeof fn !== 'function') throw new Error(t('{was} braucht eine Funktion', { was: 'export.addMapSection' }));
    const item = { entry, fn };
    state.mapSections.push(item);
    return () => { state.mapSections = state.mapSections.filter(x => x !== item); };
  }

  /** Farben im Mindmap-Bild (seit 3.1.0): fn({ target: 'export' | 'print' | 'copy', ids }) liefert (auch als Promise)
   *  { nodes: { [id]: { fill, stroke, text } }, defs } oder nichts. ids: die Notizen, die im Bild vorkommen können. Farben sind
   *  #rgb, rgb(), hsl(), Namen oder url(#…) auf ein Muster aus defs (SVG, etwa <pattern>). Liefert eine Funktion zum Abmelden. */
  function addMapStyle(entry, fn) {
    if (typeof fn !== 'function') throw new Error(t('{was} braucht eine Funktion', { was: 'export.addMapStyle' }));
    const item = { entry, fn };
    state.mapStyles.push(item);
    return () => { state.mapStyles = state.mapStyles.filter(x => x !== item); };
  }

  /** Die Farben aller eingeschalteten Erweiterungen für ein Mindmap-Bild: { nodes, defs } (spätere überschreiben frühere je Knoten).
   *  defs, die kein gültiges SVG sind, fallen weg, damit das Bild nicht kaputtgeht; Fehler einer Erweiterung lassen nur ihren Teil weg. */
  async function mapStyleFor(target, ids) {
    const nodes = {};
    const defs = [];
    for (const { entry, fn } of state.mapStyles) {
      if (entry.status !== 'active') continue;
      try {
        const r = await fn(Object.freeze({ target, ids: Object.freeze([...ids]) }));
        if (!r) continue;
        for (const [id, st] of Object.entries(r.nodes || {})) {
          if (st && typeof st === 'object') nodes[id] = Object.assign({}, nodes[id], { fill: st.fill, stroke: st.stroke, text: st.text });
        }
        if (typeof r.defs === 'string' && r.defs.trim()) {
          const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg"><defs>${r.defs}</defs></svg>`, 'image/svg+xml');
          if (doc.getElementsByTagName('parsererror').length) console.warn(`Erweiterung ${entry.id}: defs sind kein gültiges SVG`); // i18n-ignore: Protokoll
          else defs.push(r.defs);
        }
      } catch (e) { console.warn(`Erweiterung ${entry.id}`, e); } // i18n-ignore: Protokoll
    }
    return { nodes, defs: defs.join('') };
  }

  /** Die Abschnitte der eingeschalteten Erweiterungen für Export oder Druck: [{ title, markdown }]. Fehler einer Erweiterung
   *  lassen nur ihren Abschnitt weg. */
  async function mapSectionsFor(target) {
    const out = [];
    for (const { entry, fn } of state.mapSections) {
      if (entry.status !== 'active') continue;
      try {
        const r = await fn(Object.freeze({ target }));
        if (r && typeof r.markdown === 'string' && r.markdown.trim()) out.push({ title: String(r.title || '').trim(), markdown: r.markdown });
      } catch (e) { console.warn(`Erweiterung ${entry.id}`, e); } // i18n-ignore: Protokoll
    }
    return out;
  }

  /** Knopf in der Toolleiste des Editors: der Editor zeichnet ihn (NoNotesEditor.extend, toolbar in createEditor). */
  function addPluginToolbarButton(entry, item) {
    checkItem(item, 'addToolbarButton');
    state.toolbarButtons.push({ entry, item });
    editor.refreshExtensions();
  }

  /** Eintrag im Kontextmenü eines Knotens der Mindmap (seit 2.8.0). spec: { label, title?, write?, visible?(target),
   *  action?(target) oder panel?(target, { close }) }; genau eines von action und panel. target: { id, ids } (ids: die
   *  ausgewählten Notizen, wenn der Knoten zur Mehrfachauswahl gehört, sonst nur er; ohne archivierte). panel liefert den
   *  Inhalt eines Untermenüs (ein Element), das die App neben dem Menü zeigt. write (Vorgabe true): fehlt im Lesemodus. */
  function addPluginContextItem(entry, spec, list, what) {
    const ok = spec && typeof spec.label === 'string' && spec.label.trim()
      && (typeof spec.action === 'function') !== (typeof spec.panel === 'function')
      && (spec.visible == null || typeof spec.visible === 'function');
    if (!ok) throw new Error(t('{was} braucht label (Text) und entweder action oder panel (Funktion)', { was: what || 'addContextMenuItem' }));
    (list || state.pluginContextItems).push({ entry, spec });
  }

  /** Format für Tabellen (seit 2.10.0): fn(table) liefert { table, header, columns, rows, cells } mit Klassen und erlaubten
   *  CSS-Angaben (markdown.js im Paket nonotes-editor). Liefert eine Funktion zum Abmelden; beim Ausschalten wird abgemeldet. */
  function addTableFormatter(entry, fn) {
    if (typeof fn !== 'function') throw new Error(t('tables.format braucht eine Funktion'));
    const item = { entry, fn };
    state.tableFormatters.push(item);
    schedulePreview(); // eine offene Vorschau zeigt die Tabellen gleich mit (und nach dem Abmelden ohne) die Angaben
    return () => { state.tableFormatters = state.tableFormatters.filter(x => x !== item); schedulePreview(); };
  }

  /** Für M.render: ruft alle eingeschalteten Formatierer mit { noteId, line, meta, header, headerColumn, cols, rows, cells } auf. */
  function tableFormatFor(noteId) {
    const list = state.tableFormatters.filter(f => f.entry.status === 'active');
    if (!list.length) return undefined;
    return info => {
      const arg = Object.freeze(Object.assign({ noteId }, info));
      const out = [];
      for (const f of list) {
        try { const r = f.fn(arg); if (r && typeof r === 'object') out.push(r); } catch (e) { console.warn(`Erweiterung ${f.entry.id}`, e); } // i18n-ignore: Protokoll
      }
      return out;
    };
  }

  /** Format einer Tabelle der offenen Notiz ändern (ctx.tables.update): fn(meta) ändert das Objekt oder liefert ein neues.
   *  target: { noteId, line } wie im Kontextmenü. Liefert true, wenn sich der Text geändert hat. */
  async function updateTableMeta(entry, target, fn) {
    if (!target || typeof fn !== 'function' || target.noteId !== state.currentId || el.body.readOnly) return false;
    let r = null;
    try { r = Tables.setMeta(el.body.value, Number(target.line), fn, el.body.selectionStart || 0); } catch (e) { runPlugin(entry, () => { throw e; }); return false; }
    if (!r || r.text === el.body.value) return false;
    await applyTableEdit(r);
    return true;
  }

  /** Die Einträge der Erweiterungen für einen Knoten, für showContextMenu. use: { multi, applied } dieses Menüs; wurde mit
   *  einem Eintrag etwas getan (action, close() oder applied() im Untermenü), wird die Mehrfachauswahl danach aufgehoben. */
  function pluginContextEntries(target, use, list) {
    const out = [];
    for (const { entry, spec } of list || state.pluginContextItems) {
      if (entry.status !== 'active') continue;
      if (spec.visible) {
        let show = false;
        try { show = !!spec.visible(target); } catch (e) { console.warn(`Erweiterung ${entry.id}`, e); } // i18n-ignore: Protokoll
        if (!show) continue;
      }
      const item = { label: spec.label.trim(), title: spec.title ? String(spec.title) : '', write: spec.write !== false, plugin: entry.id };
      if (spec.panel) {
        const api = Object.freeze({
          close: () => { use.applied = true; hideContextMenu(); },
          applied: () => { use.applied = true; },
        });
        item.panel = () => {
          try { return spec.panel(target, api); } catch (e) { runPlugin(entry, () => { throw e; }); return null; }
        };
      } else {
        item.action = () => { if (use.multi) clearMulti(); return runPlugin(entry, () => spec.action(target)); };
      }
      out.push(item);
    }
    return out;
  }

  /** Die in diesem Browser eingeschalteten Dateien (relativ zu plugins/). Die Datenbankdatei bestimmt nie, was geladen wird. */
  function loadPluginChoice() {
    try {
      const v = JSON.parse(localStorage.getItem(PLUGINS_KEY) || '[]');
      return Array.isArray(v) ? v.map(f => Plugins.cleanFile(f)).filter(Boolean) : [];
    } catch (e) { return []; }
  }

  function savePluginChoice() {
    try {
      if (state.pluginFiles.length) localStorage.setItem(PLUGINS_KEY, JSON.stringify(state.pluginFiles));
      else localStorage.removeItem(PLUGINS_KEY);
    } catch (e) { /* egal */ }
  }

  /** Nimmt einer Erweiterung Menüeinträge und Toolleistenknöpfe (Kennungen sind a-z, 0-9 und -, darum ohne Maskierung). */
  function removePluginUi(id) {
    if (!id) return;
    for (const b of el.pluginMenu.querySelectorAll(`[data-plugin="${id}"]`)) b.remove();
    el.pluginMenu.hidden = !el.pluginMenu.querySelector('button');
    const buttons = state.toolbarButtons.length;
    state.toolbarButtons = state.toolbarButtons.filter(x => x.entry.id !== id);
    if (state.toolbarButtons.length !== buttons) editor.refreshExtensions();
    for (const x of el.mapView.querySelectorAll(`.map-plugin-btn[data-plugin="${id}"], .map-overlay[data-plugin="${id}"]`)) x.remove();
    state.mapSections = state.mapSections.filter(x => x.entry.id !== id);
    state.mapStyles = state.mapStyles.filter(x => x.entry.id !== id);
    for (const off of state.pluginProviders.get(id) || []) off();
    state.pluginProviders.delete(id);
    state.pluginContextItems = state.pluginContextItems.filter(x => x.entry.id !== id);
    state.pluginTableItems = state.pluginTableItems.filter(x => x.entry.id !== id);
    const formatters = state.tableFormatters.length;
    state.tableFormatters = state.tableFormatters.filter(x => x.entry.id !== id);
    if (state.tableFormatters.length !== formatters) schedulePreview();
  }

  /** Schaltet eine Datei aus plugins/ ein (lädt sie bei Bedarf) oder aus. Gemerkt wird nur, was sich gültig gemeldet hat. */
  async function setPluginEnabled(file, on) {
    let entry = Plugins.all().find(p => p.file === file);
    if (entry && entry.fixed) return;
    if (on) {
      if (entry && entry.status === 'off') await Plugins.activate(entry, pluginContext);
      else if (!entry) { entry = await Plugins.load(file); await Plugins.activateAll(pluginContext); }
      if (entry.valid && !state.pluginFiles.includes(entry.file)) { state.pluginFiles.push(entry.file); savePluginChoice(); }
      await loadTheme();
      renderThemeOptions();
      if (entry.status === 'error') setStatus(t('Erweiterung «{name}»: {fehler}', { name: entry.name, fehler: entry.error }), 'error');
      else setStatus(t('Erweiterung «{name}» eingeschaltet', { name: entry.name }), saveState());
    } else {
      state.pluginFiles = state.pluginFiles.filter(f => f !== file);
      savePluginChoice();
      const name = entry ? entry.name : file;
      if (entry) {
        const id = entry.valid ? entry.id : '';
        Plugins.disable(entry);
        removePluginUi(id);
      }
      applyTheme(state.theme); // gehörte das Design dazu, gilt Standard; die Datei behält die Angabe
      renderThemeOptions();
      setStatus(t('Erweiterung «{name}» ausgeschaltet', { name }), saveState());
    }
    renderPlugins();
    setupPluginHelp(); // das Hilfe-Tab «Erweiterungen» zeigt nur eingeschaltete Erweiterungen
  }

  async function loadPluginFromInput() {
    const file = el.pluginFile.value.trim().replace(/^(?:\.\/)+/, '').replace(/^plugins\//, '');
    if (!file) return;
    el.pluginFile.value = '';
    await setPluginEnabled(file, true);
  }

  /** Ein Eintrag im Dialog. Name, Version, Datei und Beschreibung gehören der Erweiterung (nicht übersetzt, data-i18n-skip). */
  function pluginItem(it) {
    const box = document.createElement('div');
    box.className = 'plugin-item' + (it.on ? '' : ' off');
    const head = document.createElement('div');
    head.className = 'plugin-head';
    const h = document.createElement('h3');
    h.setAttribute('data-i18n-skip', '');
    h.append(it.name);
    if (it.version) {
      const v = document.createElement('span');
      v.className = 'plugin-version';
      v.textContent = it.version;
      h.append(v);
    }
    const f = document.createElement('span');
    f.className = 'plugin-file';
    f.textContent = it.file;
    h.append(f);
    head.appendChild(h);
    const st = document.createElement('div');
    st.className = 'plugin-state' + (it.status === 'error' ? ' error' : '');
    st.textContent = { active: t('aktiv'), error: t('Fehler'), loaded: t('geladen'), off: t('ausgeschaltet'), available: t('verfügbar') }[it.status] || it.status;
    head.appendChild(st);
    const tooNew = it.api != null && it.api > Plugins.API;
    if (!it.fixed) {
      const sw = document.createElement('label');
      sw.className = 'plugin-switch';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = it.on;
      cb.disabled = tooNew;
      cb.dataset.file = it.file;
      cb.addEventListener('change', () => setPluginEnabled(it.file, cb.checked));
      const txt = document.createElement('span');
      txt.textContent = t('Ein');
      sw.append(cb, txt);
      head.appendChild(sw);
    }
    box.appendChild(head);
    const note = (text, cls, own) => {
      const d = document.createElement('p');
      if (cls) d.className = cls;
      if (own) d.setAttribute('data-i18n-skip', '');
      d.textContent = text;
      box.appendChild(d);
    };
    if (it.description) note(it.description, '', true);
    if (it.theme) note(t('Bringt ein Design mit; Auswahl im Menü Datenbank.'), 'plugin-note');
    if (it.fixed) note(t('Fest eingetragen in plugins/plugins.js; lässt sich hier nicht ausschalten.'), 'plugin-note');
    if (tooNew) note(t('braucht die Schnittstelle {api}, diese App bietet {angebot}', { api: it.api, angebot: Plugins.API }), 'plugin-error');
    if (it.needsReload) note(t('Ausgeschaltet. Was die Erweiterung selbst eingerichtet hat, verschwindet beim nächsten Laden der Seite.'), 'plugin-note');
    if (it.error) note(it.error, 'plugin-error');
    return box;
  }

  /** Dialog: eingeschaltete Erweiterungen (fest oder gewählt) und die verfügbaren aus dem Verzeichnis des Ordners plugins/. */
  function renderPlugins() {
    const loaded = Plugins.all();
    const available = Plugins.available();
    const known = new Set(loaded.map(p => p.file));
    const info = file => available.find(a => a.file === file) || {};
    el.pluginList.replaceChildren();
    if (!loaded.length && !available.length) {
      const p = document.createElement('p');
      p.className = 'plugin-empty';
      p.textContent = t('Im Ordner plugins/ wurde keine Erweiterung gefunden. Eine Datei dort ablegen und unten ihren Namen eingeben; Anleitung und Beispiele liegen im Ordner plugins/.');
      el.pluginList.appendChild(p);
      return;
    }
    const items = loaded.map(p => {
      const c = info(p.file);
      return {
        file: p.file, name: p.name || c.name || p.file, version: p.version || c.version || '', description: p.description || c.description || '',
        theme: !!(p.theme || (p.status !== 'error' && c.theme)), status: p.status, error: p.error, fixed: p.fixed, needsReload: p.needsReload,
        api: null, on: p.fixed || p.status !== 'off',
      };
    });
    for (const c of available) {
      if (known.has(c.file)) continue;
      items.push({ file: c.file, name: c.name, version: c.version, description: c.description, theme: c.theme, status: 'available', error: '', fixed: false, needsReload: false, api: c.api, on: false });
    }
    const group = (label, list) => {
      if (!list.length) return;
      const h = document.createElement('p');
      h.className = 'plugin-group';
      h.textContent = label;
      el.pluginList.appendChild(h);
      for (const it of list) el.pluginList.appendChild(pluginItem(it));
    };
    group(t('Eingeschaltet'), items.filter(i => i.on));
    group(t('Verfügbar im Ordner plugins/'), items.filter(i => !i.on));
  }

  function openPluginsDialog() {
    closeMenu();
    renderPlugins();
    if (typeof el.pluginsDialog.showModal === 'function') el.pluginsDialog.showModal();
    else el.pluginsDialog.setAttribute('open', '');
  }

  async function renderTaskCounts() {
    const c = await B.countTasks(Dates.nowIso());
    el.viewTasksBtn.replaceChildren();
    el.viewTasksBtn.append(t('Aufgaben'));
    if (c.open > 0) {
      const b = document.createElement('span');
      b.className = 'count tasks' + (c.overdue > 0 ? ' overdue' : '');
      b.textContent = String(c.open);
      b.title = joinParts(tn('{n} offene Aufgabe', '{n} offene Aufgaben', c.open), c.overdue ? t('{n} überfällig', { n: c.overdue }) : '');
      el.viewTasksBtn.appendChild(b);
    }
  }

  async function renderTagFilters() {
    const tags = await B.listAllTags();
    const fill = (select, current) => {
      const frag = document.createDocumentFragment();
      const all = document.createElement('option');
      all.value = '';
      all.textContent = t('Alle Tags');
      frag.appendChild(all);
      for (const tag of tags) {
        const o = document.createElement('option');
        o.value = tag.name;
        o.textContent = `${tag.name} (${tag.count})`;
        frag.appendChild(o);
      }
      select.replaceChildren(frag);
      select.value = tags.some(tag => tag.name === current) ? current : '';
      return select.value;
    };
    state.tagFilter = fill(el.tagFilter, state.tagFilter);
    state.qTag = fill(el.qTagFilter, state.qTag);
    state.tTag = fill(el.tTagFilter, state.tTag);
    const mine = new Set((state.currentId != null ? await B.getTags(state.currentId) : []).map(t => t.toLowerCase()));
    el.tagSuggestions.replaceChildren(...tags.filter(t => !mine.has(t.name.toLowerCase())).map(t => {
      const o = document.createElement('option');
      o.value = t.name;
      return o;
    }));
  }

  async function renderQuestionCounts() {
    const c = await B.countQuestions(Dates.nowIso());
    el.viewQuestionsBtn.replaceChildren();
    el.viewQuestionsBtn.append(t('Fragen'));
    if (c.open > 0) {
      const b = document.createElement('span');
      b.className = 'count' + (c.overdue > 0 ? ' q-overdue' : '');
      b.textContent = String(c.open);
      b.title = joinParts(tn('{n} offene Frage', '{n} offene Fragen', c.open), c.overdue ? t('{n} überfällig', { n: c.overdue }) : '');
      el.viewQuestionsBtn.appendChild(b);
    }
    const d = c.decisions || { open: 0, total: 0, overdue: 0 };
    el.viewDecisionsBtn.replaceChildren();
    el.viewDecisionsBtn.append(t('Entscheide'));
    if (d.open > 0) {
      const b = document.createElement('span');
      b.className = 'count decisions' + (d.overdue > 0 ? ' overdue' : '');
      b.textContent = String(d.open);
      b.title = joinParts(tn('{n} offener Entscheid', '{n} offene Entscheide', d.open), d.overdue ? t('{n} überfällig', { n: d.overdue }) : '');
      el.viewDecisionsBtn.appendChild(b);
    }
    // Der Reiter erscheint nur, wenn es Entscheide gibt (offen oder getroffen); die gerade aktive Ansicht bleibt sichtbar.
    el.viewDecisionsBtn.dataset.empty = d.total === 0 ? '1' : '';
    el.viewDecisionsBtn.hidden = d.total === 0 && state.view !== 'decisions';
  }

  async function renderMap() {
    if (!state.map || state.view !== 'map' || isEditorOpen()) { state.mapDirty = true; return; }
    if (!el.mindmap.getBoundingClientRect().width) { state.mapDirty = true; return; }
    const isLatest = fresh('map');
    let matchIds = null;
    let reveal = state.showArchive;
    if (state.query.trim()) {
      const hits = await B.listNotes(state.query); // die Suche findet auch das Archiv
      state.mapMatches = hits.map(r => r.id);
      matchIds = new Set(state.mapMatches);
      // Treffer im Archiv werden samt ihren archivierten Vorfahren eingeblendet, auch bei ausgeblendetem Archiv.
      if (!reveal) { const archivedHits = hits.filter(r => r.archived_at).map(r => r.id); if (archivedHits.length) reveal = archivedHits; }
      el.mapMatches.hidden = false;
      el.mapMatches.textContent = tn('{n} Treffer', '{n} Treffer', state.mapMatches.length);
    } else {
      state.mapMatches = [];
      state.mapMatchIndex = -1;
      el.mapMatches.hidden = true;
    }
    await pruneMulti();
    const rows = await B.getTree({ archive: reveal });
    const links = await B.getLinks();
    const mapTitle = await B.getMapTitle();
    if (!isLatest()) return;
    const ids = new Set(rows.map(r => r.id));
    const shown = links.filter(l => ids.has(l.from_id) && ids.has(l.to_id)); // Querverweise, deren beide Enden in dieser Karte sind
    state.map.render(rows, { mapTitle, matchIds, links: state.showLinks ? shown : [] });
    state.mapShown = { rows, mapTitle, links: state.showLinks ? shown : [] }; // für «Als Bild kopieren»
    await renderArchiveButton();
    renderLinksButton(shown.length);
    state.map.setSelected(state.mapSelection);
    state.map.setMulti(state.multi);
    state.mapDirty = false;
    emitPlugins('mindmap:rendered', {});
  }

  // ---------- Mehrfachauswahl ----------

  async function pruneMulti() {
    for (const id of [...state.multi]) {
      const n = await B.getNote(id);
      if (!n || n.deleted_at) state.multi.delete(id);
    }
  }

  async function renderArchiveButton() {
    const n = await B.countArchived();
    el.mapArchiveBtn.setAttribute('aria-pressed', String(state.showArchive));
    el.mapArchiveBtn.textContent = (state.showArchive ? t('Archiv ausblenden') : t('Archiv anzeigen')) + (n ? ` (${n})` : '');
  }

  /** Schalter für die Querverweise, nur sichtbar, wenn es in dieser Karte welche gibt. */
  function renderLinksButton(n) {
    el.mapLinksBtn.hidden = !n;
    el.mapLinksBtn.setAttribute('aria-pressed', String(state.showLinks));
    el.mapLinksBtn.textContent = (state.showLinks ? t('Verweise ausblenden') : t('Verweise anzeigen')) + ` (${n})`;
  }

  async function toggleLinksView() {
    state.showLinks = !state.showLinks;
    try { localStorage.setItem(LINKS_KEY, state.showLinks ? '1' : '0'); } catch (e) { /* egal */ }
    await renderMap();
  }

  async function toggleArchiveView() {
    state.showArchive = !state.showArchive;
    try { localStorage.setItem(ARCHIVE_KEY, state.showArchive ? '1' : '0'); } catch (e) { /* egal */ }
    if (typeof state.mapSelection === 'number' && !state.showArchive && await B.isArchived(state.mapSelection)) state.mapSelection = 'root';
    await renderMap();
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
    el.multiBar.hidden = n === 0 || inQuestions() || state.view === 'tasks';
    el.multiCount.textContent = tn('{n} Notiz ausgewählt', '{n} Notizen ausgewählt', n);
    if (state.map) state.map.setMulti(state.multi);
    for (const li of el.list.children) li.classList.toggle('multi', state.multi.has(Number(li.dataset.id)));
  }

  // ---------- Drucken ----------

  /** Anzahl der Notiz samt Unternotizen; archivierte nur, wenn sie einbezogen werden. */
  async function subtreeCount(id, archived) {
    const nodes = await Exporter.treeOrder(B, { archived: true });
    const byId = new Map(nodes.map(n => [n.id, n]));
    const count = n => 1 + n.children.filter(c => archived || !c.archived_at).reduce((s, c) => s + count(c), 0);
    const start = byId.get(id);
    return start ? count(start) : 0;
  }

  /** Öffnet den Druckdialog. opts: { noteId, scope } */
  async function openPrintDialog(opts) {
    opts = opts || {};
    hideContextMenu();
    closeMenu();
    const noteId = opts.noteId != null ? opts.noteId : (state.currentId != null && !(await isHiddenNote(state.currentId)) ? state.currentId : (typeof state.mapSelection === 'number' ? state.mapSelection : null));
    state.printNoteId = noteId;
    await pruneMulti();
    const note = noteId != null ? await B.getNote(noteId) : null;
    const radios = Object.fromEntries([...el.printForm.querySelectorAll('input[name="printScope"]')].map(r => [r.value, r]));
    el.printArchive.checked = false; // Archivierte Notizen sind nur auf Wunsch dabei
    const sub = await updatePrintLabels();

    let scope = opts.scope;
    if (!scope || radios[scope].disabled) {
      scope = state.multi.size ? 'selection' : note ? (sub > 1 ? 'subtree' : 'current') : 'all';
    }
    radios[scope].checked = true;
    if (typeof el.printDialog.showModal === 'function') el.printDialog.showModal();
    else el.printDialog.setAttribute('open', '');
  }

  /** Beschriftung und Verfügbarkeit der Umfänge; hängt vom Kästchen «Archivierte einbeziehen» ab. Gibt die Grösse des Teilbaums zurück. */
  async function updatePrintLabels() {
    const archived = el.printArchive.checked;
    const noteId = state.printNoteId;
    const note = noteId != null ? await B.getNote(noteId) : null;
    const title = note ? (note.title.trim() || t('Ohne Titel')) : null;
    const sub = noteId != null ? await subtreeCount(noteId, archived) : 0;
    const total = archived ? await B.countNotes() : await B.countNotes({ archived: false });
    const radios = Object.fromEntries([...el.printForm.querySelectorAll('input[name="printScope"]')].map(r => [r.value, r]));
    radios.current.disabled = !note;
    radios.subtree.disabled = !note || sub <= 1;
    radios.selection.disabled = state.multi.size === 0;
    el.printScopeCurrent.textContent = note ? t('Diese Notiz: „{titel}“', { titel: title }) : t('Diese Notiz');
    el.printScopeSubtree.textContent = note ? t('„{titel}“ mit Unternotizen ({anzahl})', { titel: title, anzahl: sub }) : t('Diese Notiz mit Unternotizen');
    el.printScopeSelection.textContent = state.multi.size ? t('Ausgewählte Notizen ({anzahl})', { anzahl: state.multi.size }) : t('Ausgewählte Notizen (keine Auswahl)');
    el.printScopeAll.textContent = t('Alle Notizen ({gesamt})', { gesamt: total });
    return sub;
  }

  async function isHiddenNote(id) {
    const n = await B.getNote(id);
    return !n || !!n.deleted_at;
  }

  async function runPrint() {
    const scope = (el.printForm.querySelector('input[name="printScope"]:checked') || {}).value || 'all';
    const html = await Printer.buildNotesDocument(B, {
      scope: scope === 'current' || scope === 'subtree' ? scope : scope,
      noteId: state.printNoteId,
      ids: [...state.multi],
      withChildren: scope === 'subtree' || (scope === 'selection' && el.printSelectionChildren.checked),
      archived: el.printArchive.checked,
      includeMap: el.printIncludeMap.checked,
      includeToc: el.printIncludeToc.checked,
      pageBreaks: el.printPageBreaks.checked,
      attachmentUrl: id => attachmentUrl(id),
      tableFormat: tableFormatFor(null),
      mapSections: el.printIncludeMap.checked ? await mapSectionsFor('print') : [],
      mapStyle: el.printIncludeMap.checked ? await mapStyleFor('print', (await B.getTree({ archive: true })).map(r => r.id)) : null,
    });
    if (el.printDialog.open) el.printDialog.close();
    Printer.print(html);
  }

  async function openQaPrintDialog() {
    hideContextMenu();
    closeMenu();
    const kind = questionKind();
    const decision = kind === 'decision';
    const shown = (await B.listQuestions({ kind, status: state.qStatus, query: state.qQuery, tag: state.qTag, person: state.qPerson })).length;
    const label = decision
      ? (state.qStatus === 'open' ? t('offene Entscheide') : state.qStatus === 'answered' ? t('getroffene Entscheide') : t('alle Entscheide'))
      : (state.qStatus === 'open' ? t('offene Fragen') : state.qStatus === 'answered' ? t('beantwortete Fragen') : t('alle Fragen'));
    el.qaPrintTitle.textContent = decision ? t('Entscheide drucken') : t('Fragen und Antworten drucken');
    el.qaScopeOpen.textContent = decision ? t('Nur offene Entscheide') : t('Nur offene Fragen');
    el.qaScopeAnswered.textContent = decision ? t('Nur getroffene Entscheide') : t('Nur beantwortete Fragen');
    el.qaScopeAll.textContent = decision ? t('Alle Entscheide') : t('Alle Fragen');
    el.qaLinesLabel.textContent = decision ? t('Linien für handschriftliche Entscheide bei offenen Entscheiden') : t('Linien für handschriftliche Antworten bei offenen Fragen');
    el.qaScopeFiltered.textContent = t('Wie angezeigt: {filter} ({anzahl})', {
      filter: joinParts(label, state.qTag ? t('Tag „{tag}“', { tag: state.qTag }) : '', state.qPerson ? t('an @{person}', { person: state.qPerson }) : '', state.qQuery.trim() ? t('Suche „{suche}“', { suche: state.qQuery.trim() }) : ''),
      anzahl: shown,
    });
    if (typeof el.qaPrintDialog.showModal === 'function') el.qaPrintDialog.showModal();
    else el.qaPrintDialog.setAttribute('open', '');
  }

  async function runQaPrint() {
    const scope = (el.qaPrintForm.querySelector('input[name="qaScope"]:checked') || {}).value || 'filtered';
    const groupBy = (el.qaPrintForm.querySelector('input[name="qaGroup"]:checked') || {}).value || 'note';
    const html = await Printer.buildQuestionsDocument(B, {
      kind: questionKind(),
      status: scope === 'filtered' ? state.qStatus : scope,
      tag: scope === 'filtered' ? state.qTag : '',
      person: scope === 'filtered' ? state.qPerson : '',
      query: scope === 'filtered' ? state.qQuery.trim() : '',
      groupBy,
      lines: el.qaLines.checked,
    });
    if (el.qaPrintDialog.open) el.qaPrintDialog.close();
    Printer.print(html);
  }

  /** Springt zum nächsten Treffer der Mindmap-Suche. */
  async function nextMapMatch(step) {
    if (!state.mapMatches.length) return;
    state.mapMatchIndex = (state.mapMatchIndex + step + state.mapMatches.length) % state.mapMatches.length;
    const id = state.mapMatches[state.mapMatchIndex];
    // Eingeklappte Vorfahren aufklappen, damit der Treffer sichtbar wird.
    let p = await B.getNote(id);
    let changed = false;
    while (p && p.parent_id != null) {
      p = await B.getNote(p.parent_id);
      if (p && p.collapsed) { await B.setCollapsed(p.id, false); changed = true; }
    }
    if (changed) markEdited();
    state.mapSelection = id;
    await renderMap();
    state.map.ensureVisible(id);
    el.mapMatches.textContent = t('Treffer {n} von {anzahl}', { n: state.mapMatchIndex + 1, anzahl: state.mapMatches.length });
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

  async function renderList() {
    const isLatest = fresh('list');
    const trash = state.listScope === 'trash';
    const notes = await B.listNotes(state.query, { tag: state.tagFilter, scope: state.listScope });
    const trashCount = trash ? await B.countTrash() : 0;
    if (!isLatest()) return;
    const q = state.query.trim();
    const frag = document.createDocumentFragment();
    for (const n of notes) {
      const li = document.createElement('li');
      li.className = 'note-item' + (n.id === state.currentId ? ' active' : '') + (trash ? ' trashed' : '') + (n.archived_at && !trash ? ' archived' : '') + (state.multi.has(n.id) ? ' multi' : '');
      li.dataset.id = String(n.id);
      li.tabIndex = 0;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(n.id === state.currentId));

      const titleEl = document.createElement('div');
      titleEl.className = 'note-title';
      titleEl.innerHTML = M.highlightText(n.title.trim() || t('Ohne Titel'), q);

      const s = document.createElement('div');
      s.className = 'note-snippet';
      s.innerHTML = M.highlightText(snippetAround(n.body, q) || '…', q);

      const d = document.createElement('div');
      d.className = 'note-date';
      d.textContent = trash && n.deleted_at ? t('Gelöscht {datum}', { datum: fmtDate(n.deleted_at) })
        : n.archived_at ? t('Archiviert {datum}', { datum: fmtDate(n.archived_at) }) : fmtDate(n.updated_at);

      li.append(titleEl, s, d);
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
    el.listEmpty.textContent = q || state.tagFilter ? t('Keine Treffer.')
      : trash ? t('Der Papierkorb ist leer.')
      : state.listScope === 'archive' ? t('Das Archiv ist leer. Archivierte Notizen sind ausgeblendet, bleiben aber durchsuchbar.')
      : t('Noch keine Notizen. Lege mit „Neue Notiz“ los.');
    el.emptyTrashBtn.hidden = !(trash && trashCount > 0);
  }

  async function renderEditor() {
    const isLatest = fresh('editor');
    const note = state.currentId != null ? await B.getNote(state.currentId) : null;
    if (!isLatest()) return;
    if (!note) {
      state.currentId = null;
      state.sync = newSync(null);
      el.editorPane.hidden = true;
      el.editorEmpty.hidden = false;
      el.statusbar.classList.remove('has-note');
      replaceNav();
      return;
    }
    el.editorEmpty.hidden = true;
    el.editorPane.hidden = false;
    el.statusbar.classList.add('has-note');
    syncEditorWith(note);
    renderMeta(note.created_at, note.updated_at, note.updated_by);
    await renderCrumbs(note);
    if (!isLatest()) return;
    renderNoteQuestions(el.body.value);
    const tags = await B.getTags(note.id);
    if (!isLatest()) return;
    renderTags(tags);
    const trashed = !!note.deleted_at;
    const archived = !trashed && !!note.archived_at;
    const locked = trashed || archived || readOnly(); // Papierkorb und Archiv sind schreibgeschützt, ebenso alles im Lesemodus
    if (editor.isReadOnly() !== locked) editor.setReadOnly(locked); // Toolleiste, Bilder, Kästchen in der Vorschau
    await editor.renderAttachments();
    if (!isLatest()) return;
    el.trashBar.hidden = !trashed;
    el.archiveBar.hidden = !archived;
    if (archived) el.archiveBarText.textContent = t('Diese Notiz ist archiviert (seit {datum}) und schreibgeschützt.', { datum: fmtDate(note.archived_at) });
    el.editor.classList.toggle('readonly', locked);
    el.title.readOnly = locked;
    el.tagInput.disabled = locked;
    el.deleteBtn.hidden = trashed || readOnly();
    el.historyBtn.hidden = trashed;
    el.childBtn.hidden = locked;
    syncTemplateMenu(locked, trashed);
    el.archiveBtn.hidden = locked;
    el.nodeLinkBtn.hidden = locked;
    el.detachBtn.hidden = locked || !canDetach();
    renderNodeLink(note, locked);
    if (state.editorMode !== 'edit') await renderPreview();
  }

  function renderTags(tags) {
    el.tagChips.replaceChildren(...tags.map(name => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.append(name);
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.title = t('Tag „{name}“ entfernen', { name });
      x.setAttribute('aria-label', t('Tag {name} entfernen', { name }));
      x.addEventListener('click', () => removeTag(name));
      chip.appendChild(x);
      return chip;
    }));
  }

  function currentTags() {
    return [...el.tagChips.querySelectorAll('.chip')].map(c => c.firstChild.textContent);
  }

  async function saveTags(tags) {
    if (denyWrite()) return;
    if (state.currentId == null) return;
    await B.setTags(state.currentId, tags);
    renderTags(await B.getTags(state.currentId));
    markEdited();
    await renderTagFilters();
    await renderList();
    if (inQuestions()) await renderQuestions();
  }

  async function addTagFromInput() {
    const raw = el.tagInput.value;
    el.tagInput.value = '';
    const parts = raw.split(',').map(Backend.normalizeTag).filter(Boolean);
    if (!parts.length) return;
    await saveTags(currentTags().concat(parts));
  }

  async function removeTag(name) {
    await saveTags(currentTags().filter(t => t.toLowerCase() !== name.toLowerCase()));
  }

  // ---------- Bilder für den Druck ----------
  // Im Editor zeigt der Baustein die Bilder selbst (attachments in createEditor); der Druck holt sie hier.

  /** Objekt-URL für ein Bild aus der Datenbank, gemerkt, damit sie nicht mehrfach angelegt wird. */
  async function attachmentUrl(id) {
    if (state.attachmentUrls.has(id)) return state.attachmentUrls.get(id);
    const row = await B.getAttachment(id);
    if (!row) return null;
    const url = URL.createObjectURL(new Blob([row.data], { type: row.mime }));
    state.attachmentUrls.set(id, url);
    return url;
  }

  function forgetAttachmentUrl(id) {
    const url = state.attachmentUrls.get(id);
    if (url) { URL.revokeObjectURL(url); state.attachmentUrls.delete(id); }
  }

  // ---------- Editor (NoNotesEditor aus dem Paket nonotes-editor, seit v4.0.0) ----------
  // Toolleiste, Darstellungen, Tasten, Datumsauswahl, Vorschläge für @kürzel und [[Verweise]], Tabellen, Bilder, Platzhalter und die
  // Vorschau macht der Baustein; die App gibt ihm über Rückrufe, was ihr gehört (Notiz, Speichern mit Zusammenführen, Bilder in der
  // Datenbank, Verweisziele, Menüs, Statuszeile, Hilfe) und bedient die Schnittstelle der Erweiterungen über NoNotesEditor.extend. Die
  // Kennungen bleiben wie vor v4.0.0 (#body, #preview, #mdToolbar …), damit CSS, Tests und Erweiterungen dieselben Elemente finden.

  const EditorKit = window.NoNotesEditor;
  let editor = null;
  const MODES = ['edit', 'split', 'preview'];
  const OLD_GRID_KEY = 'nonotes.tableGrid'; // bis v3.3.0: «Mit Rahmen» im Raster; jetzt merkt sich das der Baustein

  /** Baut den Editor in #editorPane (unter Titel und Tags) und hängt seine Elemente in el ein. */
  function createEditor() {
    let mode = 'edit';
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (MODES.includes(m)) mode = m;
      const grid = localStorage.getItem(OLD_GRID_KEY);
      const gridKey = 'nonotes-editor.tableGrid';
      if (grid != null && localStorage.getItem(gridKey) == null) localStorage.setItem(gridKey, grid);
    } catch (e) { /* ohne Speicher: Vorgaben */ }
    EditorKit.configure({ localFiles: localFiles(), embeds: embedsOn() ? 'ask' : 'off' });
    editor = EditorKit.create(el.editorPane, {
      kind: 'note',
      mode,
      remember: false, // die App merkt sich die Darstellung selbst (nonotes.editorMode, wie bisher)
      ids: {
        root: 'noteEditor', body: 'body', preview: 'preview', toolbar: 'mdToolbar', heading: 'headingSelect', modeSwitch: 'modeSwitch',
        help: 'helpBtn', attach: 'attachBtn', attachInput: 'attachInput', attachments: 'attachments', mentionPopup: 'mentionPopup',
        wikiPopup: 'wikiPopup', wikiCount: 'wikiCount', wikiList: 'wikiList', phHint: 'phHint', editorBody: 'editorBody', mirror: 'bodyMirror',
        tablePicker: 'tablePicker', questionBtn: 'questionBtn', answerBtn: 'answerBtn', decisionBtn: 'decisionBtn',
      },
      onMode: m => {
        state.editorMode = m;
        // die Klasse auch an #editorPane (CSS der App und von Erweiterungen, etwa «Sprung zu Unternotizen», fragen dort nach)
        el.editorPane.classList.remove('mode-edit', 'mode-split', 'mode-preview');
        el.editorPane.classList.add('mode-' + m);
        try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* egal */ }
      },
      onInput: () => { state.editPromise = onEdit(); },
      attachments: {
        list: () => (state.currentId != null ? B.listAttachments(state.currentId) : []),
        get: id => B.getAttachment(id),
        add: async a => {
          const id = await B.addAttachment(state.currentId, a);
          markEdited();
          return { id, name: a.name };
        },
        remove: async id => {
          await B.deleteAttachment(id);
          forgetAttachmentUrl(id);
          markEdited();
        },
      },
      refs: { list: wikiNotes, resolver: () => wikiResolver(), open: openWikiLink, cross: true },
      render: async text => ({ highlight: state.query.trim() || null, noteLink: await noteLinkResolver([text]) }),
      onLinkClick: (a, e) => {
        if (!a.classList.contains('md-note')) return false;
        e.preventDefault();
        followNoteLink(a.getAttribute('href'));
        return true;
      },
      people: { keepTyped: true }, // localPeople lässt das Wort am Cursor schon weg
      placeholders: { field: el.title, keep: () => keepPlaceholders(null), onFill: fillOtherNotes },
      modernizeDates: true,
      help: () => openHelp('editor'),
      showMenu: (items, x, y) => showContextMenu(items, x, y),
      confirm: text => Promise.resolve(confirm(text)),
      hint: (text, kind) => { if (!text) return; if (kind) setStatus(text, kind); else hint(text); },
      onError: e => setStatus(errorText(e), 'error'),
    });
    el.body = editor.textarea;
    el.preview = editor.preview;
    el.mdToolbar = editor.toolbar;
    EditorKit.extend({
      toolbar: () => state.toolbarButtons.map(({ entry, item }) => ({
        plugin: entry.id, label: item.label, title: String(item.title || item.label),
        run: () => runPlugin(entry, () => item.action(pluginEditorApi())),
      })),
      tableFormat: () => tableFormatFor(state.currentId),
      tableMenu: tg => pluginContextEntries(Object.freeze({
        noteId: state.currentId, line: tg.line, row: tg.row, col: tg.col, cols: tg.cols, rows: tg.rows, header: tg.header,
        headerColumn: tg.headerColumn, meta: Object.freeze(JSON.parse(JSON.stringify(tg.meta))), grid: tg.grid, span: tg.span,
      }), { multi: false, applied: false }, state.pluginTableItems),
    });
  }

  async function setEditorMode(mode) {
    editor.mode(mode);
    if (mode !== 'edit' && state.currentId != null) await renderPreview();
  }

  async function cycleEditorMode() {
    await setEditorMode(MODES[(MODES.indexOf(state.editorMode) + 1) % MODES.length]);
  }

  /** Löst [[Titel]] und [[Titel#42]] auf: Inhalt → { id, label } (NoNotesLinks.lookup); einmal pro Darstellung bauen. */
  async function wikiResolver() {
    return window.NoNotesLinks.resolver(await B.titleIndex());
  }

  async function renderPreview() {
    if (state.currentId == null) return;
    await editor.renderPreview();
  }

  /** Zähler, Schrift und Vorschau nach einer Änderung, die nicht über das Tippen kam (Zusammenführen, Vorlage, Erweiterung). */
  function schedulePreview() {
    if (editor) editor.refresh();
  }

  /** Änderung am Text über den Editor (Rückgängig bleibt nicht, wie bisher); wartet, bis gesichert ist. */
  async function applyEdit(result) {
    state.editPromise = null;
    editor.applyEdit(result);
    await state.editPromise;
  }

  /** Änderung an einer Tabelle (Erweiterung): gleich neu zeichnen, sonst träfe ein rascher zweiter Rechtsklick die alten Zeilen. */
  async function applyTableEdit(result) {
    const saved = applyEdit(result);
    if (state.editorMode !== 'edit') await renderPreview();
    await saved;
  }

  /** Klick auf [[Verweis]] in der Vorschau: die Notiz öffnen; fehlt sie, als Unternotiz anlegen (nach Rückfrage). */
  async function openWikiLink(ref) {
    if (ref.id != null) { await openNote(Number(ref.id)); return; }
    const title = ref.title;
    if (denyWrite()) return;
    if (!confirm(t('Es gibt keine Notiz „{titel}“. Jetzt als Unternotiz anlegen?', { titel: title }))) return;
    const id = await B.createNote(state.currentId);
    await B.renameNote(id, title);
    markEdited();
    await renderAll();
    await openNote(id);
  }

  /** Ziele für die Vorschläge bei «[[»: alle Notizen des Bereichs (auch archivierte) ausser der offenen, mit Pfad und ob der Titel
   *  mehrfach vorkommt (wie bei der Auflösung: ohne Gross-/Kleinschreibung, über alle Notizen); dann mit Nummer ([[Protokoll#42]]). */
  async function wikiNotes() {
    if (!window.NoNotesLinks || state.currentId == null) return [];
    const rows = (await B.getTree({ archive: true })).slice().sort((a, b) => a.id - b.id);
    const mapTitle = (await B.getMapTitle()) || '';
    const byId = new Map(rows.map(r => [r.id, r]));
    const count = new Map();
    const key = r => window.NoNotesLinks.normalize(r.title);
    for (const r of rows) if (key(r)) count.set(key(r), (count.get(key(r)) || 0) + 1);
    const pathOf = r => {
      const out = [];
      const seen = new Set();
      for (let p = byId.get(r.parent_id); p && !seen.has(p.id); p = byId.get(p.parent_id)) { seen.add(p.id); out.unshift(p.title.trim() || t('Ohne Titel')); }
      return out;
    };
    return rows.filter(r => r.id !== state.currentId && r.title.trim() && !/[[\]]/.test(r.title)).map(r => {
      const path = pathOf(r);
      const dup = count.get(key(r)) > 1;
      return { id: r.id, title: r.title.trim(), insert: dup ? `${r.title.trim()}#${r.id}` : r.title.trim(), archived: !!r.archived_at,
        updated: r.updated_at || '', path, parent: path.length ? path[path.length - 1] : mapTitle, dup };
    });
  }

  // ---------- Videos (YouTube, Vimeo, Dailymotion) ----------

  /** Die Hülle kann das Einbetten ausschalten (shell.embeds === 'off'), zum Beispiel ein Dienst, dessen Schutzkopf keine Rahmen erlaubt. */
  const embedsOn = () => !(shell && shell.embeds === 'off');

  /** Hinweis in der Statuszeile, ohne den Speicherstand falsch darzustellen. */
  function hint(text) {
    setStatus(text, saveState());
  }

  /** Link in der Fragen- oder Aufgabenliste: Verweis öffnet die Notiz, externe Links öffnen sich im neuen Tab. */
  async function onListLinkClick(e) {
    const a = e.target.closest('a');
    if (!a) return;
    e.stopPropagation();
    if (a.classList.contains('md-note')) { e.preventDefault(); await followNoteLink(a.getAttribute('href')); return; }
    if (a.classList.contains('md-wiki')) {
      e.preventDefault();
      if (a.dataset.noteId) await openNote(Number(a.dataset.noteId));
      else setStatus(t('Es gibt keine Notiz „{titel}“', { titel: a.dataset.title }), 'error');
    } else if (a.getAttribute('href') === '#') {
      e.preventDefault();
    }
  }

  function renderNoteQuestions(body) {
    const parsed = Q.parse(body);
    const qs = parsed.filter(q => q.kind !== 'decision');
    const ds = parsed.filter(q => q.kind === 'decision');
    const qOpen = qs.filter(q => !q.answer).length;
    const dOpen = ds.filter(q => !q.answer).length;
    const parts = [
      qs.length === 0 ? '' : qOpen === 0 ? tn('{n} Frage, alle beantwortet', '{n} Fragen, alle beantwortet', qs.length)
        : tn('{n} offene Frage von {gesamt}', '{n} offene Fragen von {gesamt}', qOpen, { gesamt: qs.length }),
      ds.length === 0 ? '' : dOpen === 0 ? tn('{n} Entscheid, alle getroffen', '{n} Entscheide, alle getroffen', ds.length)
        : tn('{n} offener Entscheid von {gesamt}', '{n} offene Entscheide von {gesamt}', dOpen, { gesamt: ds.length }),
    ];
    el.noteQuestions.textContent = parts.filter(Boolean).join(' · ');
  }

  function renderMeta(createdAt, updatedAt, by) {
    el.noteMeta.textContent = by
      ? t('Erstellt {erstellt} · Geändert {geaendert} von {name}', { erstellt: fmtDate(createdAt), geaendert: fmtDate(updatedAt), name: by })
      : t('Erstellt {erstellt} · Geändert {geaendert}', { erstellt: fmtDate(createdAt), geaendert: fmtDate(updatedAt) });
  }

  /** Pfad über der Notiz: Wurzel und Vorfahren, klickbar; die offene Notiz selbst steht als Titel darunter. */
  async function renderCrumbs(note) {
    const path = await B.getPath(note.id);
    const items = [{ label: await B.getMapTitle(), onClick: async () => {
      if (state.view === 'map') { await closeEditor(); state.mapSelection = 'root'; state.map.setSelected('root'); }
    } }];
    for (const p of path) items.push({ label: p.title.trim() || t('Ohne Titel'), onClick: () => openNote(p.id) });
    state.crumbItems = items;
    fitCrumbs();
  }

  /** Zeichnet den Pfad; passt er nicht in die Zeile, fallen mittlere Glieder zu «…» zusammen (erstes und letztes bleiben). */
  function fitCrumbs() {
    const items = state.crumbItems || [];
    const draw = hidden => {
      const frag = document.createDocumentFragment();
      const sep = () => { const x = document.createElement('span'); x.className = 'sep'; x.textContent = '›'; return x; };
      items.forEach((it, i) => {
        if (hidden && i >= 1 && i <= hidden) {
          if (i === 1) {
            const more = document.createElement('span');
            more.className = 'more';
            more.textContent = '…';
            more.title = items.slice(1, hidden + 1).map(x => x.label).join(' › ');
            frag.append(more, sep());
          }
          return;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = it.label;
        if (i === items.length - 1) b.className = 'last';
        b.addEventListener('click', it.onClick);
        frag.appendChild(b);
        if (i < items.length - 1) frag.appendChild(sep());
      });
      el.crumbs.replaceChildren(frag);
    };
    draw(0);
    const fits = () => el.crumbs.scrollWidth <= el.crumbs.clientWidth + 1;
    for (let hidden = 1; !fits() && items.length - hidden > 2; hidden++) draw(hidden);
  }

  async function renderCount() {
    if (state.listScope === 'trash') {
      const trash = await B.countTrash();
      el.count.textContent = tn('{n} Notiz im Papierkorb', '{n} Notizen im Papierkorb', trash);
      return;
    }
    if (state.listScope === 'archive') {
      const a = await B.countArchived();
      el.count.textContent = tn('{n} Notiz im Archiv', '{n} Notizen im Archiv', a);
      return;
    }
    const n = await B.countNotes({ archived: false });
    const a = await B.countArchived();
    el.count.textContent = tn('{n} Notiz', '{n} Notizen', n) + (a ? ' · ' + t('{n} im Archiv', { n: a }) : '');
  }

  async function updateListItem(id, title, body, ts) {
    const li = el.list.querySelector(`li[data-id="${id}"]`);
    if (!li) { await renderList(); return; }
    li.querySelector('.note-title').textContent = title.trim() || t('Ohne Titel');
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

  async function selectNote(id, focusEditor) {
    if (state.currentId !== id && !(await ensureSaved())) return;
    state.currentId = id;
    setActiveItem(id);
    await renderEditor();
    if (isNarrow()) showEditorView(true);
    if (focusEditor) (el.title.value ? el.body : el.title).focus();
    pushNav();
  }

  /** Öffnet eine Notiz im Editor: in der Liste rechts, aus der Mindmap als Vollbild. */
  async function openNote(id, opts) {
    hideContextMenu();
    if (state.currentId !== id && !(await ensureSaved())) return;
    state.currentId = id;
    if (state.view !== 'list') {
      if (state.view === 'map') state.mapSelection = id;
      document.body.classList.add('editor-open');
      await renderEditor();
      (el.title.value ? el.body : el.title).focus();
    } else {
      await selectNote(id, true);
    }
    if (opts && typeof opts.line === 'number') jumpToLine(opts.line);
    pushNav();
    emitPlugins('note:open', { id });
  }

  function jumpToLine(lineIndex) {
    editor.selectLine(lineIndex);
  }

  async function closeEditor() {
    closeNoteMenu();
    if (!isEditorOpen()) { showEditorView(false); return; }
    if (!(await ensureSaved())) return;
    state.sync = newSync(null);
    document.body.classList.remove('editor-open');
    if (state.currentId != null) emitPlugins('note:close', { id: state.currentId });
    if (state.view === 'map') {
      if (state.currentId != null) state.mapSelection = state.currentId;
      await renderMap();
      el.mindmap.focus({ preventScroll: true });
    } else if (inQuestions()) {
      await renderQuestions();
    } else if (state.view === 'tasks') {
      await renderTasks();
    }
    pushNav();
  }

  // ---------- Navigation mit dem Verlauf des Browsers (v2.7.0) ----------
  // Ein Schritt ist: eine Notiz öffnen (in der Liste: wählen), zur Übersicht zurück, die Ansicht wechseln, einem Verweis folgen. Jeder
  // Schritt ist ein Eintrag im Verlauf (history.pushState); Zurück und Vor, auch mit den Maustasten, bewegen sich darin. Die Adresse nennt
  // die offene Notiz mit Nummer und lesbarem Titel; ihre Form bestimmt die Hülle (shell.routes, packages/core/routes.js), sonst «#n=…».
  // Keine Schritte: Auswahl in der Mindmap, Bearbeiten/Vorschau, Suche, Filter, Sortierung.

  const VIEWS = ['map', 'list', 'questions', 'decisions', 'tasks'];
  let defaultRoutes = null;
  const routes = () => (shell && shell.routes) || defaultRoutes || (defaultRoutes = Routes.hashRoutes());
  const navEntry = () => (history.state && history.state.nn) || null;

  /** Was gerade offen ist: die Notiz im Editor (in der Liste die gewählte) und die Ansicht. */
  function navNow() {
    const open = isEditorOpen() || state.view === 'list';
    return { note: open && state.currentId != null ? state.currentId : null, view: state.view };
  }

  function writeNav(push) {
    const cur = navEntry();
    const now = navNow();
    const entry = push
      ? { note: now.note, view: now.view, depth: (cur ? cur.depth : 0) + 1, fromOverview: !!cur && cur.note == null }
      : Object.assign({ depth: 0, fromOverview: false }, cur || {}, now);
    const url = routes().href({ note: now.note, title: now.note != null && now.note === state.currentId ? el.title.value : '' });
    try { history[push ? 'pushState' : 'replaceState'](Object.assign({}, history.state, { nn: entry }), '', url); } catch (e) { /* manche Browser bei file:// */ }
  }

  /** Ein Schritt, wenn sich gegenüber dem jetzigen Eintrag die Notiz oder die Ansicht geändert hat; sonst nur nachführen. */
  function pushNav() {
    if (!state.navReady || state.navApplying || state.navPending) return;
    const cur = navEntry();
    const now = navNow();
    writeNav(!!cur && (cur.note !== now.note || cur.view !== now.view));
  }

  /** Den jetzigen Eintrag nachführen (Titel in der Adresse, gelöschte Notiz, anderer Bereich), ohne neuen Schritt. */
  function replaceNav() {
    if (!state.navReady || state.navApplying || state.navPending) return;
    writeNav(false);
  }

  function scheduleNavTitle() {
    clearTimeout(state.navTitleTimer);
    state.navTitleTimer = setTimeout(replaceNav, 600); // Browser bremsen viele Änderungen der Adresse
  }

  /** Schritte nacheinander anwenden (schnelles Zurück, Zurück während ein Bereich lädt). */
  function queueNav(fn) {
    state.navChain = state.navChain.then(fn).catch(e => {
      if (state.leaving) return;
      console.error(e);
      setStatus(errorText(e), 'error');
    });
    return state.navChain;
  }

  /** Eine Notiz für einen Schritt: null, wenn es sie nicht (mehr) gibt (mit Hinweis). */
  async function noteForNav(id) {
    const note = await B.getNote(id).catch(() => null);
    if (note && !note.deleted_at) return note;
    hint(note ? t('Diese Notiz liegt im Papierkorb.') : t('Diese Notiz gibt es nicht (mehr).'));
    return null;
  }

  /** Einen Eintrag des Verlaufs anwenden (Zurück, Vor, Adresse von Hand geändert): target { note, view, area }.
   *  seq: Nummer des Ereignisses; kam inzwischen ein neueres (schnell Zurück und gleich Vor, während noch gespeichert wird), steht der
   *  Browser schon auf einem anderen Eintrag: dann nichts mehr in die Adresse schreiben, das neuere Ereignis wendet seinen Eintrag an. */
  async function applyNav(target, seq) {
    let failed = false;
    state.navApplying = true;
    try {
      const r = routes();
      if (r.enter && (await r.enter(target)) === false) return; // lokal: in den Bereich der Adresse wechseln
      const view = VIEWS.includes(target.view) ? target.view : state.view;
      const now = navNow();
      if (now.note === target.note && now.view === view) return;
      if (now.note != null && now.note !== target.note && !(await ensureSaved())) { failed = true; return; }
      const note = target.note != null ? await noteForNav(target.note) : null;
      if (view !== state.view) await setView(view);
      if (note) await openNote(note.id);
      else if (isEditorOpen()) await closeEditor();
      else if (state.view === 'list' && state.currentId != null) {
        state.currentId = null;
        setActiveItem(null);
        await renderEditor();
        showEditorView(false);
      }
    } finally {
      state.navApplying = false;
    }
    // Was jetzt offen ist, steht in der Adresse; ging der Schritt nicht (Speichern abgebrochen), gilt der Stand der Oberfläche
    if (seq == null || seq === state.navSeq) writeNav(failed);
  }

  async function onNavEvent(seq) {
    if (seq != null && seq !== state.navSeq) return; // überholt: das neuere Ereignis liest die Adresse selbst
    const at = routes().current();
    const entry = navEntry();
    await applyNav(Object.assign({ view: state.view }, entry || {}, { note: at.note, area: at.area }), seq);
  }

  /** Zurück, Vor oder eine Adresse von Hand: der Browser steht schon auf dem neuen Eintrag, die Oberfläche folgt (nacheinander). Bis dahin
   *  passen Oberfläche und Eintrag nicht zusammen; Nachführen (Titel, Speichern, Bereich) würde den Eintrag überschreiben. */
  function onHistoryEvent() {
    const seq = ++state.navSeq;
    state.navPending++;
    queueNav(() => onNavEvent(seq)).finally(() => { state.navPending--; });
  }

  /** Beim Start: Notiz aus der Adresse öffnen (Link, Lesezeichen, Neuladen, Vor nach dem Verlassen der App). */
  async function startNav() {
    state.navReady = true;
    window.addEventListener('pagehide', () => { state.leaving = true; });
    window.addEventListener('pageshow', () => { state.leaving = false; }); // zurück aus dem Zwischenspeicher des Browsers
    window.addEventListener('popstate', onHistoryEvent);
    window.addEventListener('hashchange', onHistoryEvent); // falls ein Browser bei «#…» kein popstate meldet (sonst überholt)
    const at = routes().current();
    const entry = navEntry();
    if (at.note != null || (entry && entry.view && entry.view !== state.view)) await queueNav(() => onNavEvent());
    else replaceNav();
  }

  /** Pfeil «Zurück» im Editor und Esc: war der Schritt davor die Übersicht, wie Zurück im Browser; sonst die Übersicht als Schritt. */
  async function closeEditorStep() {
    const cur = navEntry();
    if (state.navReady && cur && cur.note != null && cur.note === state.currentId && cur.fromOverview && cur.depth > 0) {
      if (!(await ensureSaved())) return;
      history.back();
      return;
    }
    await closeEditor();
  }

  /** Einem Link auf eine Notiz dieser App folgen (aus der Vorschau oder einer Liste): ein Schritt, lokal auch in einen anderen Bereich. */
  function followNoteLink(href) {
    const target = routes().parse(href);
    if (!target) { window.open(href, '_blank', 'noopener'); return Promise.resolve(); }
    return queueNav(async () => {
      const r = routes();
      if (r.enter) {
        state.navApplying = true; // der Bereichswechsel schreibt die Adresse nicht um: der Eintrag davor bleibt, wie er war
        let ok;
        try { ok = await r.enter(target); } finally { state.navApplying = false; }
        if (ok === false) return;
      }
      if (target.note == null) { // nur der Bereich (Link am Knoten, v3.2.0): die Hülle hat ihn geöffnet; ein Schritt im Verlauf
        if (state.navReady) writeNav(true);
        return;
      }
      const note = await noteForNav(target.note);
      if (note) await openNote(note.id);
    });
  }

  // ---------- Link am Knoten (v3.2.0) ----------
  // Jeder Knoten kann einen Link tragen: eine Webadresse, eine Mailadresse, einen Pfad auf eine Datei oder einen Ordner, eine Notiz oder
  // einen Bereich dieser App. Die Mindmap zeigt ↗ im Knoten, ein Klick darauf öffnet das Ziel; der Editor zeigt ihn unter dem Titel.

  /** Art eines Links: 'area' (Bereich dieser App), 'note' (Notiz dieser App), 'path', 'mail' oder 'web'. */
  function nodeLinkKind(url) {
    const target = routes().parse(url);
    if (target) return target.note == null ? 'area' : 'note';
    if (M.pathInfo(url)) return 'path';
    if (/^mailto:/i.test(url)) return 'mail';
    return 'web';
  }

  /** Name eines Bereichs dieser App aus seiner Kennung (lokal), sonst die Kennung. */
  function areaName(id) {
    const list = shell && Array.isArray(shell.areas) ? shell.areas : [];
    const a = list.find(x => x.id === id || x.name === id);
    return a ? a.name : id;
  }

  /** Kurzer Text zum Link (Tooltip in der Mindmap, Anzeige im Editor). */
  function nodeLinkTitle(url) {
    const target = routes().parse(url);
    if (target && target.note == null) return t('Bereich „{name}“ öffnen', { name: areaName(target.area) });
    if (target) return target.area ? t('Notiz in „{name}“ öffnen', { name: areaName(target.area) }) : t('Notiz öffnen: {link}', { link: url });
    const info = M.pathInfo(url);
    if (info) return (localFiles() ? t('Öffnen: {pfad}', { pfad: info.path }) : t('Pfad kopieren: {pfad}', { pfad: info.path }));
    return t('Link öffnen: {link}', { link: url });
  }

  /** Öffnet den Link eines Knotens: Bereich oder Notiz in der App, Pfad (lokal öffnen, im Dienst kopieren), sonst im neuen Tab. */
  async function openNodeLink(id) {
    const note = await B.getNote(id).catch(() => null);
    const url = note && note.link;
    if (!url) return;
    const target = routes().parse(url);
    if (target) {
      if (target.note == null && isEditorOpen()) await closeEditor(); // in einen anderen Bereich: die offene Notiz zuerst schliessen
      await followNoteLink(url);
      return;
    }
    const info = M.pathInfo(url);
    if (info) {
      if (localFiles()) window.open(info.href, '_blank', 'noopener');
      else await copyPath(info.path);
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  /** Dialog «Link am Knoten». */
  async function openNodeLinkDialog(id) {
    hideContextMenu();
    closeNoteMenu();
    if (denyWrite()) return;
    const note = await B.getNote(id).catch(() => null);
    if (!note || note.deleted_at) return;
    state.nodeLinkFor = id;
    el.nodeLinkLead.textContent = t('Knoten „{titel}“', { titel: note.title.trim() || t('Ohne Titel') });
    el.nodeLinkInput.value = note.link || '';
    el.nodeLinkRemoveBtn.hidden = !note.link;
    el.nodeLinkError.hidden = true;
    const others = (shell && Array.isArray(shell.areas) ? shell.areas : []).filter(a => !shell.area || a.id !== shell.area.id);
    el.nodeLinkAreaRow.hidden = !(others.length && typeof shell.areaHref === 'function');
    el.nodeLinkArea.replaceChildren(new Option('–', ''), ...others.map(a => new Option(a.name, a.id)));
    showDialog(el.nodeLinkDialog);
    el.nodeLinkInput.focus();
    el.nodeLinkInput.select();
  }

  async function saveNodeLink(value) {
    const id = state.nodeLinkFor;
    if (id == null) return;
    el.nodeLinkSaveBtn.disabled = true;
    try {
      await B.setNoteLink(id, value);
      el.nodeLinkDialog.close();
      markEdited();
      state.mapDirty = true;
      await renderAll();
      setStatus(value && value.trim() ? t('Link hinterlegt') : t('Link entfernt'), 'saved');
    } catch (e) {
      el.nodeLinkError.textContent = errorText(e);
      el.nodeLinkError.hidden = false;
    } finally {
      el.nodeLinkSaveBtn.disabled = false;
    }
  }

  async function removeNodeLink(id) {
    hideContextMenu();
    if (denyWrite()) return;
    await B.setNoteLink(id, '');
    markEdited();
    state.mapDirty = true;
    await renderAll();
    setStatus(t('Link entfernt'), 'saved');
  }

  /** Streifen unter dem Titel im Editor: das Ziel des Links und «Ändern…». */
  function renderNodeLink(note, locked) {
    const url = note && note.link;
    el.nodeLinkBar.hidden = !url;
    if (!url) return;
    el.nodeLinkOpen.textContent = nodeLinkKind(url) === 'area' ? nodeLinkTitle(url) : url;
    el.nodeLinkOpen.title = nodeLinkTitle(url);
    el.nodeLinkOpen.setAttribute('href', url);
    el.nodeLinkEditBtn.hidden = locked;
  }

  // ---------- In einen neuen Bereich auslösen (v3.2.0) ----------
  // Nur, wo die Hülle es kann (shell.detachToArea: lokal ein neuer Bereich, im Dienst ein neuer Arbeitsbereich).

  const canDetach = () => !!(shell && typeof shell.detachToArea === 'function') && !readOnly();

  async function openDetachDialog(id) {
    hideContextMenu();
    closeNoteMenu();
    if (denyWrite() || !canDetach()) return;
    const note = await B.getNote(id).catch(() => null);
    if (!note || note.deleted_at || note.archived_at) return;
    const count = countBelow(await B.getTree({ archive: true }), id);
    state.detachFor = id;
    el.detachName.value = note.title.trim();
    el.detachLead.textContent = count
      ? tn('„{titel}“ mit {n} Unternotiz', '„{titel}“ mit {n} Unternotizen', count, { titel: note.title.trim() || t('Ohne Titel') })
      : t('„{titel}“ hat keine Unternotizen: der neue Bereich beginnt leer.', { titel: note.title.trim() || t('Ohne Titel') });
    el.detachError.hidden = true;
    el.detachGoBtn.disabled = false;
    showDialog(el.detachDialog);
    el.detachName.focus();
    el.detachName.select();
  }

  /** Zahl der Unternotizen (alle Ebenen, auch archivierte) aus den Zeilen von getTree. */
  function countBelow(rows, id) {
    const kids = new Map();
    for (const r of rows) {
      if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
      kids.get(r.parent_id).push(r.id);
    }
    let n = 0;
    const stack = [...(kids.get(id) || [])];
    while (stack.length) { const x = stack.pop(); n++; stack.push(...(kids.get(x) || [])); }
    return n;
  }

  async function detachNode() {
    const id = state.detachFor;
    const name = el.detachName.value.trim();
    if (id == null) return;
    if (!name) { el.detachError.textContent = t('Bitte einen Namen angeben.'); el.detachError.hidden = false; return; }
    el.detachGoBtn.disabled = true;
    setStatus(t('Wird ausgelöst…'), 'dirty');
    try {
      const r = await shell.detachToArea({ noteId: id, name });
      if (!r) { el.detachGoBtn.disabled = false; setStatus(t('Nicht ausgelöst'), 'saved'); return; }
      el.detachDialog.close();
      state.mapDirty = true;
      state.multi.delete(id);
      await renderAll();
      if (state.currentId != null) await renderEditor();
      setStatus(tn('{n} Notiz in den neuen Bereich „{name}“ ausgelöst', '{n} Notizen in den neuen Bereich „{name}“ ausgelöst', r.moved, { name: r.area.name }), 'saved');
      showBanner(t('Neuer Bereich „{name}“. Hier bleibt der Knoten mit einem Link dorthin; die ausgelösten Notizen liegen im Papierkorb.', { name: r.area.name }), [
        { label: t('Bereich öffnen'), primary: true, onClick: () => { hideBanner(); followNoteLink(r.area.url); } },
        { label: t('Schliessen'), onClick: () => hideBanner() },
      ]);
    } catch (e) {
      console.error(e);
      el.detachError.textContent = errorText(e);
      el.detachError.hidden = false;
      el.detachGoBtn.disabled = false;
      setStatus(t('Auslösen fehlgeschlagen: {fehler}', { fehler: errorText(e) }), 'error');
    }
  }

  // ---------- Ausfüllbare Platzhalter in Vorlagen (v2.12.0) ----------
  // {{?Name}} wählt die App nach dem Einfügen einer Vorlage aus; Tippen ersetzt ihn, Tab springt zum nächsten, Umschalt+Tab zurück, Esc
  // beendet. Mit «Platzhalter behalten» (Einstellung im Dialog «Vorlagen», je Vorlage im Kopf «placeholders») wird daraus
  // {{?Name: Wert}}; ein Klick hinein wählt den Wert und zeigt die Beschreibung. Gleiche Namen bekommen denselben Wert (Text, Titel und
  // die Unternotizen der Vorlage). Übersprungene bleiben offen. Das Ausfüllen in Titel und Text macht der Editor (Paket nonotes-editor,
  // placeholders.field = #title), die Textarbeit placeholders.js im Paket; hier bleiben die Einstellung, der Start und die Unternotizen.

  const PH = window.NoNotesPlaceholders;
  const KEEP_PLACEHOLDERS = 'templates.keepPlaceholders';

  async function keepPlaceholders(tpl) {
    if (tpl && (tpl.placeholders === 'keep' || tpl.placeholders === 'remove')) return tpl.placeholders === 'keep';
    try { return (await B.getMeta(KEEP_PLACEHOLDERS)) === '1'; } catch (e) { return false; }
  }

  /** Setzt einen Wert für alle Platzhalter eines Namens: keep → {{?Name: Wert}}, sonst der Wert. Gibt { text, edits } zurück. */
  function fillName(text, name, value, keep) {
    const edits = [];
    let out = text;
    for (const p of PH.scan(text).filter(x => PH.same(x.name, name)).reverse()) {
      const r = keep ? PH.token(p.name, value) : value;
      out = out.slice(0, p.start) + r + out.slice(p.end);
      edits.push({ start: p.start, end: p.end, len: r.length });
    }
    return { text: out, edits };
  }

  /** Startet das Ausfüllen im Editor (Titel zuerst, dann der Text): in einer neuen oder gerade eingefügten Vorlage.
   *  opts: { keep, others (die Unternotizen der Vorlage), start, end }. */
  async function startPlaceholders(opts) {
    if (!PH || readOnly()) return false;
    return editor.startPlaceholders({ keep: !!opts.keep, start: opts.start, end: opts.end, data: { others: opts.others || [] } });
  }

  /** Ein Platzhalter im Titel oder Text ist ausgefüllt: dieselben Namen in den Unternotizen der Vorlage nachziehen (field: der Wert kam
   *  aus dem Titel). Titel und Text der offenen Notiz füllt der Editor selbst. */
  async function fillOtherNotes(name, typed, keep, info) {
    const others = (info && info.data && info.data.others) || [];
    for (const id of others) {
      try {
        const n = await B.getNote(id);
        if (!n) continue;
        const nt = PH.flatten(fillName(n.title, name, typed, false).text, { open: x => `{{?${x}}}` });
        const nb = PH.pruneDescriptions(fillName(n.body, name, typed, keep).text, info.field ? n.title : nt);
        if (nt !== n.title || nb !== n.body) await B.updateNote(n.id, nt, nb, { author: meName() });
      } catch (e) { /* eine fehlende Unternotiz hält das Ausfüllen nicht auf */ }
    }
  }

  // ---------- Pfade auf Dateien und Ordner (v2.12.0) ----------

  /** Lassen sich Pfade (\\server\…, C:\…, file://) öffnen? Nur, wenn die Seite selbst aus einer Datei kommt (lokale Version); eine Hülle
   *  kann es mit shell.localFiles festlegen. Von einer Webseite aus sperren Browser solche Links. */
  function localFiles() {
    if (shell && typeof shell.localFiles === 'boolean') return shell.localFiles;
    return location.protocol === 'file:';
  }

  /** Pfad in die Zwischenablage, in der Schreibweise von Windows (zum Einfügen in den Explorer). */
  async function copyPath(path) {
    hideContextMenu();
    try {
      await navigator.clipboard.writeText(path);
      hint(localFiles() ? t('Pfad kopiert: {pfad}', { pfad: path }) : t('Pfad kopiert – im Explorer einfügen: {pfad}', { pfad: path }));
    } catch (e) {
      window.prompt(t('Pfad (mit Ctrl+C kopieren):'), path);
    }
  }

  /** Klick auf einen Pfad: lokal öffnet der Link die Datei im neuen Tab (Standard des Browsers); im Dienst kopiert er den Pfad. */
  function onPathClick(e) {
    const a = e.target.closest && e.target.closest('a.md-path');
    if (!a || e.button !== 0) return;
    if (localFiles()) return;
    e.preventDefault();
    e.stopPropagation();
    copyPath(a.dataset.path);
  }

  /** Rechtsklick auf einen Pfad (Link oder Bild): «Öffnen» (nur lokal) und «Pfad kopieren». */
  function onPathContextMenu(e) {
    const target = e.target.closest && e.target.closest('a.md-path, img.md-path-img');
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const path = target.dataset.path;
    const href = target.tagName === 'IMG' ? target.getAttribute('src') : target.getAttribute('href');
    const items = [];
    if (localFiles()) items.push({ label: target.classList.contains('md-path-folder') ? t('Ordner öffnen') : t('Öffnen'), action: () => window.open(href, '_blank', 'noopener') });
    items.push({ label: t('Pfad kopieren'), title: path, action: () => copyPath(path) });
    showContextMenu(items, e.clientX, e.clientY);
  }

  /** «Link kopieren»: volle Adresse der Notiz in die Zwischenablage (sonst zum Kopieren angezeigt). */
  async function copyNoteLink(id) {
    hideContextMenu();
    closeNoteMenu();
    const note = id != null ? await B.getNote(id) : null;
    if (!note) return;
    const titel = note.title.trim() || t('Ohne Titel');
    const url = routes().href({ note: note.id, title: note.title });
    try {
      await navigator.clipboard.writeText(url);
      hint(t('Link zu „{titel}“ kopiert', { titel }));
    } catch (e) {
      window.prompt(t('Link zu „{titel}“ (mit Ctrl+C kopieren):', { titel }), url);
    }
  }

  /** Links auf Notizen dieser App in Texten: Titel der Ziele vorab holen (nur, wenn es solche Links gibt), dann ein Auflöser für die
   *  Darstellung: url → { id, title, missing, area } oder null. Ziele in einem anderen Bereich (lokal) kennen ihren Titel nicht. */
  async function noteLinkResolver(texts) {
    const r = routes();
    const local = target => !target.area || (r.isHere ? r.isHere(target) : false);
    const ids = new Set();
    for (const text of texts) {
      for (const m of String(text || '').matchAll(/(?:https?|file):\/\/[^\s<>()\]]+/g)) {
        const target = r.parse(m[0].replace(/[.,;:!?'"]+$/, ''));
        if (target && target.note != null && local(target)) ids.add(target.note);
        if (ids.size > 50) break;
      }
    }
    const notes = new Map();
    await Promise.all([...ids].map(async id => { const n = await B.getNote(id).catch(() => null); if (n) notes.set(id, n); }));
    return url => {
      const target = r.parse(url);
      if (!target) return null;
      if (target.note == null || !local(target)) return { id: target.note, title: null, missing: false, area: target.area };
      const n = notes.get(target.note);
      return { id: target.note, title: n ? n.title.trim() || t('Ohne Titel') : null, missing: !n || !!n.deleted_at, area: null };
    };
  }

  async function newNote() {
    if (denyWrite()) return;
    const parentId = state.view === 'map' ? selectionAsParent() : null;
    if (state.view === 'map') { await newNoteInMap(parentId); return; }
    const id = await B.createNote(null);
    state.currentId = id;
    if (state.query) { state.query = ''; el.search.value = ''; el.mapSearch.value = ''; }
    if (state.listScope !== 'live') { state.listScope = 'live'; el.listScope.value = 'live'; }
    await renderAll();
    markEdited();
    if (isNarrow()) showEditorView(true);
    el.title.focus();
    pushNav();
  }

  function selectionAsParent() {
    return typeof state.mapSelection === 'number' ? state.mapSelection : null;
  }

  async function newNoteInMap(parentId) {
    if (denyWrite()) return;
    hideContextMenu();
    if (parentId != null && await B.isArchived(parentId)) { hint(t('Unter einer archivierten Notiz lässt sich nichts anlegen. Erst zurückholen.')); return; }
    if (parentId != null) {
      const info = state.map.nodeInfo(parentId);
      if (info && info.collapsed) await B.setCollapsed(parentId, false);
    }
    const id = await B.createNote(parentId);
    state.mapSelection = id;
    markEdited();
    await renderMap();
    await renderCount();
    state.map.ensureVisible(id);
    await beginRename(id, { isNew: true });
  }

  async function newChildOfCurrent() {
    if (denyWrite()) return;
    if (state.currentId == null) return;
    const parentId = state.currentId;
    if (await B.isArchived(parentId)) { hint(t('Unter einer archivierten Notiz lässt sich nichts anlegen. Erst zurückholen.')); return; }
    const id = await B.createNote(parentId);
    const info = state.map.nodeInfo(parentId);
    if (info && info.collapsed) await B.setCollapsed(parentId, false);
    state.currentId = id;
    state.mapSelection = id;
    markEdited();
    await renderList();
    await renderCount();
    await renderEditor();
    el.title.focus();
  }

  // ---------- Speichern der offenen Notiz, Konflikte ----------
  // Jede Notiz im Editor baut auf einem Stand auf (sync.base: Titel, Text und Zeitstempel, wie der Server sie zuletzt hatte).
  // Gespeichert wird immer mit diesem Stand: Hat inzwischen jemand anders gespeichert, meldet das Backend NOTE_CONFLICT. Dann
  // wird zeilenweise zusammengeführt (Merge.merge3); was sich nicht zusammenführen lässt, entscheidet die Person im Dialog.
  // Mehrere Eingaben kurz hintereinander teilen sich einen Speichervorgang (der letzte Text zählt).

  const SAVE_RETRY_MS = 4000;
  const MAX_MERGE_ROUNDS = 5;

  function newSync(note) {
    return {
      id: note ? note.id : null,
      createdAt: note ? note.created_at : null,
      base: note ? { title: note.title, body: note.body, updatedAt: note.updated_at } : null,
      saving: null,        // laufender Speichervorgang (Promise)
      again: false,        // während des Speicherns kam Neues dazu
      conflict: null,      // ungelöster Konflikt: { theirs, mt, mb }
      rounds: 0,
      retryTimer: null,
    };
  }
  state.sync = newSync(null);

  const meName = () => (shell && shell.userName) || null;

  /** Setzt den Inhalt eines Felds; ein Cursor im Feld wandert mit (Zeile wird im neuen Text wiedergefunden). */
  function setFieldKeepingCaret(field, value) {
    if (field.value === value) return;
    const focused = document.activeElement === field;
    const old = field.value;
    const start = field.selectionStart || 0;
    const end = field.selectionEnd || 0;
    const scroll = field.scrollTop;
    field.value = value;
    if (focused) field.setSelectionRange(Merge.mapCaret(old, value, start), Merge.mapCaret(old, value, end));
    field.scrollTop = scroll;
  }

  function noteUnsaved() {
    const sync = state.sync;
    return !!sync.base && state.currentId === sync.id && (el.title.value !== sync.base.title || el.body.value !== sync.base.body);
  }

  /** Eingabe im Editor: sofort anzeigen, was sich aus dem Text ergibt, dann sichern. */
  async function onEdit() {
    if (state.currentId == null) return;
    renderNoteQuestions(el.body.value);
    schedulePreview();
    markEdited();
    await saveNote();
  }

  /** Sichert die offene Notiz. Mehrere Aufrufe teilen sich einen Vorgang; die Antwort kommt, wenn alles gesichert ist. */
  function saveNote() {
    const sync = state.sync;
    if (sync.id == null || sync.conflict) return Promise.resolve();
    sync.again = true;
    if (!sync.saving) {
      sync.saving = (async () => {
        try {
          while (sync.again && !sync.conflict) {
            sync.again = false;
            await saveNoteOnce(sync);
          }
        } finally {
          sync.saving = null;
        }
      })();
    }
    return sync.saving;
  }

  async function saveNoteOnce(sync) {
    if (state.currentId !== sync.id) return; // inzwischen eine andere Notiz: beim Wechsel wurde gesichert
    const title = el.title.value;
    const body = el.body.value;
    if (title === sync.base.title && body === sync.base.body) return;
    let ts;
    try {
      ts = await B.updateNote(sync.id, title, body, { baseUpdatedAt: sync.base.updatedAt });
    } catch (e) {
      if (e && e.code === 'NOTE_CONFLICT') { await onNoteConflict(sync, title, body); return; }
      setStatus(errorText(e), 'error');
      scheduleSaveRetry(sync);
      return;
    }
    clearTimeout(sync.retryTimer);
    sync.base = { title, body, updatedAt: ts };
    sync.rounds = 0;
    renderMeta(sync.createdAt, ts, meName());
    await updateListItem(sync.id, title, body, ts);
    await renderQuestionCounts();
    await renderTaskCounts();
    scheduleSavedEvent(sync.id);
  }

  /** Ein Speichern ist fehlgeschlagen (zum Beispiel keine Verbindung): später noch einmal, der Text bleibt im Editor. */
  function scheduleSaveRetry(sync) {
    clearTimeout(sync.retryTimer);
    sync.retryTimer = setTimeout(() => { if (state.sync === sync) saveNote(); }, SAVE_RETRY_MS);
  }

  /** Bevor eine andere Notiz geöffnet oder der Editor geschlossen wird: alles sichern. false = bitte nicht wechseln. */
  async function ensureSaved() {
    const sync = state.sync;
    if (sync.id == null) return true;
    await saveNote();
    if (sync.conflict) { openConflictDialog(); return false; }
    if (noteUnsaved()) {
      return confirm(t('Die letzten Änderungen an dieser Notiz konnten nicht gespeichert werden. Trotzdem wechseln? Sie gehen dann verloren.'));
    }
    return true;
  }

  /** Eine Änderung von aussen ist da (Neuzeichnen, Wiederverbinden): in den Editor übernehmen oder zusammenführen. */
  function syncEditorWith(note) {
    const sync = state.sync;
    if (sync.id !== note.id) { // eine andere Notiz: Felder setzen, neuen Stand merken
      el.title.value = note.title;
      editor.set(note.body);
      state.sync = newSync(note);
      return;
    }
    // Nur Neueres zählt: ein verspätet eingetroffener älterer Stand darf nichts überschreiben.
    if (!sync.base || !(note.updated_at > sync.base.updatedAt)) return;
    if (sync.saving || sync.conflict) return; // der eigene Speichervorgang meldet einen Konflikt selbst
    const mineTitle = el.title.value;
    const mineBody = el.body.value;
    if (mineTitle === sync.base.title && mineBody === sync.base.body) { // nichts Eigenes im Weg: Neues übernehmen
      setFieldKeepingCaret(el.title, note.title);
      setFieldKeepingCaret(el.body, note.body);
      editor.refresh();
      sync.base = { title: note.title, body: note.body, updatedAt: note.updated_at };
      return;
    }
    mergeWithTheirs(sync, note, mineTitle, mineBody);
  }

  /** Eigene, noch nicht gesicherte Änderungen treffen auf eine neuere Fassung. */
  function mergeWithTheirs(sync, theirs, mineTitle, mineBody) {
    const mt = Merge.merge3(sync.base.title, mineTitle, theirs.title);
    const mb = Merge.merge3(sync.base.body, mineBody, theirs.body);
    if (mt.clean && mb.clean) { applyMerged(sync, theirs, mt.text, mb.text, true); return; }
    sync.conflict = { theirs, mt, mb };
    openConflictDialog();
  }

  /** Setzt den zusammengeführten Text in den Editor, macht die neuere Fassung zur Grundlage und sichert das Ergebnis. */
  function applyMerged(sync, theirs, title, body, announce) {
    setFieldKeepingCaret(el.title, title);
    setFieldKeepingCaret(el.body, body);
    sync.base = { title: theirs.title, body: theirs.body, updatedAt: theirs.updated_at };
    renderNoteQuestions(el.body.value);
    schedulePreview();
    renderMeta(sync.createdAt, theirs.updated_at, theirs.updated_by);
    if (announce) {
      hint(theirs.updated_by
        ? t('Änderungen von {name} wurden mit deinen zusammengeführt', { name: theirs.updated_by })
        : t('Änderungen von jemand anderem wurden mit deinen zusammengeführt'));
    }
    if (title !== theirs.title || body !== theirs.body) {
      sync.rounds++;
      if (sync.rounds > MAX_MERGE_ROUNDS) {
        setStatus(t('Zu viele gleichzeitige Änderungen. Es wird gleich erneut versucht.'), 'error');
        scheduleSaveRetry(sync);
      } else {
        sync.again = true;
        if (!sync.saving) saveNote();
      }
    }
  }

  /** Beim Speichern hat sich gezeigt, dass jemand anders die Notiz geändert hat. */
  async function onNoteConflict(sync, mineTitle, mineBody) {
    const theirs = await B.getNote(sync.id);
    if (!theirs || theirs.deleted_at) {
      setStatus(t('Die Notiz wurde inzwischen gelöscht. Dein Text bleibt im Editor.'), 'error');
      return;
    }
    mergeWithTheirs(sync, theirs, mineTitle, mineBody);
  }

  // ---------- Konfliktdialog ----------

  function openConflictDialog() {
    const c = state.sync.conflict;
    if (!c) return;
    hideBanner();
    renderConflict(c);
    if (typeof el.conflictDialog.showModal === 'function') { if (!el.conflictDialog.open) el.conflictDialog.showModal(); }
    else el.conflictDialog.setAttribute('open', '');
  }

  function closeConflictDialog() {
    if (el.conflictDialog.open) el.conflictDialog.close();
  }

  /** Zeigt die strittigen Stellen: Kontext, dann «Meine Fassung» und «Neue Fassung» untereinander. */
  function renderConflict(c) {
    const who = c.theirs.updated_by;
    const name = c.theirs.title.trim() || t('Ohne Titel');
    el.conflictLead.textContent = who
      ? t('«{titel}» wurde von {name} geändert, während du daran gearbeitet hast. Beide haben dieselbe Stelle verschieden geändert:', { titel: name, name: who })
      : t('«{titel}» wurde von jemand anderem geändert, während du daran gearbeitet hast. Beide haben dieselbe Stelle verschieden geändert:', { titel: name });
    el.conflictLegend.textContent = t('Grün: deine Fassung. Blau: die neue Fassung der anderen. Die Stellen davor und danach sind schon zusammengeführt.');
    const frag = document.createDocumentFragment();
    const line = (cls, text) => {
      const div = document.createElement('div');
      div.className = 'hl ' + cls;
      div.textContent = text === '' ? ' ' : text;
      frag.appendChild(div);
    };
    const head = text => {
      const div = document.createElement('div');
      div.className = 'cf-head';
      div.textContent = text;
      frag.appendChild(div);
    };
    const gap = () => {
      const div = document.createElement('div');
      div.className = 'cf-gap';
      div.textContent = '…';
      frag.appendChild(div);
    };
    let n = 0;
    const show = (parts, isTitle) => {
      parts.forEach((part, i) => {
        if (part.type === 'same') {
          const lines = part.lines;
          const prevConflict = i > 0 && parts[i - 1].type === 'conflict';
          const nextConflict = i < parts.length - 1 && parts[i + 1].type === 'conflict';
          if (!prevConflict && !nextConflict) return;
          const before = prevConflict ? lines.slice(0, 2) : [];
          const after = nextConflict ? lines.slice(Math.max(before.length, lines.length - 2)) : [];
          before.forEach(l => line('same', l));
          if (before.length + after.length < lines.length) gap();
          after.forEach(l => line('same', l));
        } else {
          n++;
          head(isTitle ? t('Titel: strittige Stelle {nummer}', { nummer: n }) : t('Text: strittige Stelle {nummer}', { nummer: n }));
          part.mine.forEach(l => line('cf-mine', l));
          if (!part.mine.length) line('cf-mine', t('(nichts)'));
          part.theirs.forEach(l => line('cf-theirs', l));
          if (!part.theirs.length) line('cf-theirs', t('(nichts)'));
        }
      });
    };
    if (!c.mt.clean) show(c.mt.parts, true);
    if (!c.mb.clean) show(c.mb.parts, false);
    el.conflictText.replaceChildren(frag);
  }

  /** Entscheidung der Person: 'mine' | 'theirs' | 'markers'. Gilt für die strittigen Stellen; der Rest ist schon zusammengeführt. */
  async function resolveConflict(choice) {
    const sync = state.sync;
    const c = sync.conflict;
    if (!c) return;
    const labels = { mine: t('Meine Fassung'), theirs: t('Neue Fassung') };
    const title = Merge.resolve(c.mt.parts, choice === 'markers' ? 'mine' : choice, labels); // ein Titel hat nur eine Zeile: keine Markierungen
    const body = Merge.resolve(c.mb.parts, choice, labels);
    sync.conflict = null;
    closeConflictDialog();
    hideBanner();
    applyMerged(sync, c.theirs, title, body, false);
    await saveNote();
    hint(choice === 'theirs' ? t('Neue Fassung übernommen') : choice === 'markers' ? t('Beide Fassungen mit Markierungen gespeichert') : t('Deine Fassung behalten'));
  }

  /** «Später entscheiden»: der Text bleibt im Editor, gespeichert wird erst nach der Entscheidung. */
  function postponeConflict() {
    if (!state.sync.conflict) return;
    showBanner(t('Diese Notiz wurde von jemand anderem geändert. Gespeichert wird erst nach deiner Entscheidung.'), [
      { label: t('Konflikt anzeigen'), primary: true, onClick: openConflictDialog },
    ]);
  }

  /** Markiert die Zeile(n) unter dem Cursor als Frage ("?") oder Antwort ("!") bzw. hebt es auf. */
  // ---------- Vorlagen (v2.5.0) ----------
  // Woher Vorlagen kommen, sagt die Hülle (shell.templates: lokal der Ordner templates/ und der Browser, im Dienst der Server);
  // Dateiformat, Platzhalter und das Anlegen der Notizen stehen in packages/core/templates.js.

  const Tpl = window.NoNotesTemplates;
  const templateStore = () => (Tpl && shell && shell.templates) || null;
  const canSaveTemplates = () => { const p = templateStore(); return !!p && (!p.canSave || p.canSave()); };

  function showDialog(d) {
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); }
    else d.setAttribute('open', '');
  }

  /** Einträge für Vorlagen zeigen, wenn die Hülle welche kennt. */
  function setupTemplates() {
    const on = !!templateStore();
    el.mapTemplateBtn.hidden = !on;
    el.newTemplateBtn.hidden = !on;
    el.templatesBtn.hidden = !on;
  }

  /** Die Einträge im Menü «Notiz» passend zur offenen Notiz (gesperrt: nur speichern). */
  function syncTemplateMenu(locked, trashed) {
    const on = !!templateStore();
    el.childTemplateBtn.hidden = !on || locked;
    el.insertTemplateBtn.hidden = !on || locked;
    el.saveTemplateBtn.hidden = !on || trashed || !canSaveTemplates();
  }

  function templateContext() {
    const p = templateStore();
    return Object.assign({ now: new Date(), locale: I18n.locale() }, p && p.context ? p.context() : {});
  }

  /** Platzhalter als Hinweis: «{{datum}} (20.10.2026), {{datum+7}} (in sieben Tagen), …» in der Sprache der Oberfläche. */
  function placeholderText() {
    const parts = [];
    for (const p of Tpl.placeholders(templateContext())) {
      parts.push(`{{${p.name}}}` + (p.example ? ` (${p.example})` : ''));
      if (p.offset) parts.push(`{{${p.name}+7}} (${t('in sieben Tagen')})`);
    }
    const formats = Tpl.dateFormats(templateContext()).map(f => `${f.text} (${f.example})`).join(', ');
    return t('Platzhalter, die beim Anlegen ersetzt werden: {liste}', { liste: parts.join(', ') }) + ' ' + t('Das Datum mit Format: {beispiele}', { beispiele: formats });
  }

  /** Eine Notiz und (wahlweise) ihre Unternotizen in Baumreihenfolge, mit Text und Tags; archivierte bleiben draussen. */
  async function subtreeOf(id, withChildren) {
    const rows = await B.getTree();
    const kids = new Map();
    for (const r of rows) {
      const k = r.parent_id == null ? null : r.parent_id;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(r);
    }
    const out = [];
    const walk = async (nid, depth) => {
      const n = await B.getNote(nid);
      if (!n) return;
      out.push({ depth, title: n.title, body: n.body, tags: await B.getTags(nid) });
      if (withChildren) for (const c of kids.get(nid) || []) await walk(c.id, depth + 1);
    };
    await walk(id, 0);
    return out;
  }

  async function descendantCount(id) {
    const rows = await B.getTree();
    let n = 0;
    const walk = pid => { for (const r of rows) if (r.parent_id === pid) { n++; walk(r.id); } };
    walk(id);
    return n;
  }

  /** Zusätzliche Felder der Hülle (zum Beispiel «Sichtbar für» im Dienst) als Auswahlfelder. */
  function renderTemplateFields(p) {
    el.templateSaveFields.replaceChildren();
    for (const f of (p.saveFields ? p.saveFields() : []) || []) {
      const label = document.createElement('label');
      label.className = 'dialog-field';
      const span = document.createElement('span');
      span.textContent = f.label;
      const sel = document.createElement('select');
      sel.dataset.field = f.id;
      for (const o of f.options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
      }
      if (f.value != null) sel.value = f.value;
      label.append(span, sel);
      el.templateSaveFields.appendChild(label);
    }
  }

  function templateFieldValues() {
    const out = {};
    for (const sel of el.templateSaveFields.querySelectorAll('select[data-field]')) out[sel.dataset.field] = sel.value;
    return out;
  }

  async function openTemplateSave(noteId) {
    const p = templateStore();
    hideContextMenu();
    closeNoteMenu();
    if (!p || noteId == null || !canSaveTemplates()) return;
    if (state.currentId === noteId && !(await ensureSaved())) return;
    const note = await B.getNote(noteId);
    if (!note) return;
    state.templateSaveId = noteId;
    const below = await descendantCount(noteId);
    el.templateName.value = (note.title || '').trim();
    el.templateDescription.value = '';
    el.templateChildren.checked = below > 0;
    el.templateChildren.disabled = below === 0;
    el.templateChildrenLabel.textContent = below ? tn('Unternotiz mitnehmen ({n})', 'Unternotizen mitnehmen ({n})', below) : t('Keine Unternotizen');
    el.templateTodayLabel.textContent = t('Heutiges Datum ({datum}) durch {platzhalter} ersetzen', { datum: Dates.formatDue(Dates.todayIso()), platzhalter: `{{${Tpl.placeholderName('date')}}}` });
    renderTemplateFields(p);
    el.templateSaveWhere.textContent = p.saveHint ? await p.saveHint() : '';
    el.templateSaveHint.textContent = placeholderText();
    showDialog(el.templateSaveDialog);
    el.templateName.focus();
    el.templateName.select();
  }

  async function saveTemplate() {
    const p = templateStore();
    const id = state.templateSaveId;
    const name = el.templateName.value.trim();
    if (!p || id == null) return;
    if (!name) { el.templateName.focus(); return; }
    el.templateSaveGoBtn.disabled = true;
    try {
      const children = el.templateChildren.checked;
      const r = Tpl.fromNotes(await subtreeOf(id, children), {
        name, description: el.templateDescription.value, children,
        stripAnswers: el.templateStripAnswers.checked, reopenTasks: el.templateReopenTasks.checked, stripDates: el.templateStripDates.checked,
        todayToPlaceholder: el.templateToday.checked,
      });
      const res = await p.save(r.template, templateFieldValues());
      el.templateSaveDialog.close();
      const done = res.where === 'folder' ? t('Vorlage «{name}» im Ordner «{ordner}» gespeichert.', { name, ordner: res.folder || 'templates' })
        : res.where === 'download' ? t('Vorlage «{name}» heruntergeladen und in diesem Browser gemerkt.', { name })
        : t('Vorlage «{name}» gespeichert.', { name });
      hint(done + (r.images ? ' ' + tn('{n} Bild weggelassen.', '{n} Bilder weggelassen.', r.images) : ''));
      emitPlugins('template:saved', { name, where: res.where, id: res.id });
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      setStatus(t('Vorlage konnte nicht gespeichert werden: {fehler}', { fehler: errorText(e) }), 'error');
    } finally {
      el.templateSaveGoBtn.disabled = false;
    }
  }

  /** Auswahl einer Vorlage: mode 'new' (neue Notiz unter parentId, null = oberste Stufe) oder 'insert' (in die offene Notiz). */
  async function openTemplatePick(mode, parentId) {
    const p = templateStore();
    hideContextMenu();
    closeNoteMenu();
    if (!p || denyWrite()) return;
    if (mode === 'insert' && (state.currentId == null || el.body.readOnly)) return;
    if (mode === 'new' && parentId != null && await B.isArchived(parentId)) { hint(t('Unter einer archivierten Notiz lässt sich nichts anlegen. Erst zurückholen.')); return; }
    state.templatePick = { mode, parentId: parentId == null ? null : parentId, selected: null, caret: mode === 'insert' ? el.body.selectionStart || 0 : null };
    el.templatePickTitle.textContent = mode === 'insert' ? t('Vorlage einfügen') : t('Neue Notiz aus Vorlage');
    el.templatePickGoBtn.textContent = mode === 'insert' ? t('Einfügen') : t('Anlegen');
    let lead;
    if (mode === 'insert') lead = t('Der Text der Vorlage kommt an die Stelle des Cursors, ihre Unternotizen unter diese Notiz.');
    else if (parentId != null) { const n = await B.getNote(parentId); lead = t('Die neue Notiz kommt unter «{titel}».', { titel: (n && n.title.trim()) || t('Ohne Titel') }); }
    else lead = t('Die neue Notiz kommt auf die oberste Stufe.');
    el.templatePickLead.textContent = lead;
    el.templatePickList.replaceChildren();
    el.templatePickPreview.replaceChildren();
    showDialog(el.templatePickDialog);
    await renderTemplatePick();
  }

  const templateSource = it => it.sourceLabel || (it.source === 'folder' ? t('im Ordner') : it.source === 'browser' ? t('nur in diesem Browser') : '');

  async function templateItems(p) {
    // Ein verbundener Ordner braucht nach einem Neustart des Browsers wieder die Erlaubnis: der Klick, der den Dialog öffnete, reicht dafür
    if (p.folder) { try { const f = await p.folder(); if (f.permission === 'prompt') await p.grant(); } catch (e) { /* dann eben ohne Ordner */ } }
    return p.list();
  }

  async function renderTemplatePick() {
    const p = templateStore();
    const pick = state.templatePick;
    let items = [];
    let error = null;
    try { items = await templateItems(p); } catch (e) { error = e; }
    if (state.templatePick !== pick) return;
    el.templatePickList.replaceChildren();
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'template-item';
      b.setAttribute('role', 'option');
      b.dataset.id = it.id;
      const n = document.createElement('strong');
      n.textContent = it.name;
      const d = document.createElement('small');
      d.textContent = [it.description, tn('{n} Notiz', '{n} Notizen', it.notes || 1), templateSource(it)].filter(Boolean).join(' · ');
      b.append(n, d);
      b.addEventListener('click', () => selectTemplate(it.id));
      b.addEventListener('dblclick', () => runTemplatePick());
      el.templatePickList.appendChild(b);
    }
    el.templatePickEmpty.hidden = items.length > 0 && !error;
    el.templatePickEmpty.textContent = error ? errorText(error) : (p.emptyHint ? await p.emptyHint() : t('Noch keine Vorlagen.'));
    el.templatePickGoBtn.disabled = !items.length;
    if (items.length) await selectTemplate(items[0].id);
  }

  async function selectTemplate(id) {
    const p = templateStore();
    const pick = state.templatePick;
    if (!pick) return;
    for (const b of el.templatePickList.querySelectorAll('.template-item')) b.setAttribute('aria-selected', String(b.dataset.id === id));
    let tpl;
    try { tpl = await p.get(id); } catch (e) { el.templatePickPreview.textContent = errorText(e); pick.selected = null; el.templatePickGoBtn.disabled = true; return; }
    if (state.templatePick !== pick) return;
    pick.selected = { id, tpl };
    el.templatePickGoBtn.disabled = false;
    const notes = Tpl.instantiate(tpl, templateContext());
    const frag = document.createDocumentFragment();
    if (pick.mode !== 'insert' && notes[0]) {
      const h = document.createElement('h3');
      h.textContent = notes[0].title || t('Ohne Titel');
      frag.appendChild(h);
    }
    const body = document.createElement('div');
    body.innerHTML = M.render(notes[0] ? notes[0].body : '', { embeds: false });
    frag.appendChild(body);
    if (notes.length > 1) {
      const sub = document.createElement('p');
      sub.className = 'template-sub';
      sub.textContent = tn('Dazu {n} Unternotiz:', 'Dazu {n} Unternotizen:', notes.length - 1);
      const ul = document.createElement('ul');
      ul.className = 'template-subs';
      for (const n of notes.slice(1)) {
        const li = document.createElement('li');
        li.style.marginLeft = `${(n.depth - 1) * 16}px`;
        li.textContent = n.title || t('Ohne Titel');
        ul.appendChild(li);
      }
      frag.append(sub, ul);
    }
    el.templatePickPreview.replaceChildren(frag);
  }

  async function runTemplatePick() {
    const pick = state.templatePick;
    if (!pick || !pick.selected || denyWrite()) return;
    const { tpl } = pick.selected;
    el.templatePickDialog.close();
    const ctx = templateContext();
    try {
      if (pick.mode === 'insert') {
        if (state.currentId == null || el.body.readOnly) return;
        const r = await Tpl.insert(B, tpl, state.currentId, el.body.value, pick.caret, ctx, { author: meName() });
        el.body.value = r.body;
        el.body.focus();
        el.body.setSelectionRange(r.caret, r.caret);
        await onEdit();
        if (r.children.length) { state.mapDirty = true; await renderList(); await renderCount(); }
        hint(t('Vorlage «{name}» eingefügt.', { name: tpl.name }));
        await startPlaceholders({ keep: await keepPlaceholders(tpl), others: r.children, start: r.start, end: r.caret });
      } else {
        const parentId = pick.parentId;
        if (parentId != null && state.map) {
          const info = state.map.nodeInfo(parentId);
          if (info && info.collapsed) await B.setCollapsed(parentId, false);
        }
        const ids = await Tpl.create(B, tpl, parentId, ctx, { author: meName() });
        const id = ids[0];
        markEdited();
        state.mapSelection = id;
        state.mapDirty = true;
        await renderAll();
        await openNote(id);
        hint(t('Notiz aus Vorlage «{name}» angelegt.', { name: tpl.name }));
        if (PH) await startPlaceholders({ keep: await keepPlaceholders(tpl), others: ids.slice(1), start: 0, end: PH.stripDescriptions(el.body.value).replace(/\s+$/, '').length });
      }
      emitPlugins('template:applied', { name: tpl.name, mode: pick.mode });
    } catch (e) {
      setStatus(t('Vorlage konnte nicht angewendet werden: {fehler}', { fehler: errorText(e) }), 'error');
    }
    state.templatePick = null;
  }

  async function openTemplatesDialog() {
    closeMenu();
    hideContextMenu();
    if (!templateStore()) return;
    showDialog(el.templatesDialog);
    await renderTemplatesDialog();
  }

  function smallButton(text, onClick, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls || '';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  /** Zustand des verbundenen Ordners (lokal) mit den passenden Knöpfen. */
  async function renderTemplateFolder(p) {
    el.templatesFolder.replaceChildren();
    if (!p.folder) { el.templatesFolder.hidden = true; return; }
    el.templatesFolder.hidden = false;
    const f = await p.folder();
    const text = document.createElement('p');
    text.className = 'dialog-lead';
    const row = document.createElement('div');
    row.className = 'row';
    const act = fn => async () => {
      try { await fn(); } catch (e) { if (!e || e.name !== 'AbortError') setStatus(errorText(e), 'error'); }
      await renderTemplatesDialog();
    };
    if (!f.supported) {
      text.textContent = t('Dieser Browser kann keine Ordner verbinden: Vorlagen werden heruntergeladen und in diesem Browser gemerkt. In Edge oder Chrome lässt sich der Ordner templates/ verbinden.');
    } else if (!f.name) {
      text.textContent = t('Kein Ordner verbunden. Verbinde den Ordner templates/ neben index.html: NoNotes liest dann die Vorlagen darin und speichert neue direkt dort, für alle Bereiche.');
      row.append(smallButton(t('Ordner verbinden…'), act(() => p.connectFolder()), 'primary'));
    } else if (f.permission === 'granted') {
      text.textContent = t('Verbunden mit dem Ordner «{ordner}».', { ordner: f.name });
      row.append(smallButton(t('Anderen Ordner wählen…'), act(() => p.connectFolder())), smallButton(t('Trennen'), act(() => p.disconnectFolder()), 'ghost'));
      // Termine mit «>» (v3.0.0): Dateien mit alten «@Datum» auf Knopfdruck umstellen
      const old = p.legacyFiles ? await p.legacyFiles().catch(() => []) : [];
      if (old.length && !readOnly()) {
        const info = document.createElement('p');
        info.className = 'dialog-lead templates-legacy';
        info.textContent = tn('{n} Vorlage im Ordner schreibt Termine noch mit «@» (vor v3.0.0): {dateien}. NoNotes liest sie richtig; umgestellt steht in der Datei «>».',
          '{n} Vorlagen im Ordner schreiben Termine noch mit «@» (vor v3.0.0): {dateien}. NoNotes liest sie richtig; umgestellt steht in der Datei «>».', old.length, { dateien: old.join(', ') });
        row.append(smallButton(t('Auf «>» umstellen'), act(async () => {
          const n = await p.convertLegacy();
          hint(tn('{n} Vorlage umgestellt.', '{n} Vorlagen umgestellt.', n));
        }), 'primary'));
        el.templatesFolder.append(text, info, row);
        return;
      }
    } else if (f.permission === 'prompt') {
      text.textContent = t('Verbunden mit dem Ordner «{ordner}». Der Browser braucht noch deine Erlaubnis, ihn zu lesen.', { ordner: f.name });
      row.append(smallButton(t('Zugriff erlauben'), act(() => p.grant()), 'primary'), smallButton(t('Trennen'), act(() => p.disconnectFolder()), 'ghost'));
    } else {
      text.textContent = t('Der Browser hat den Zugriff auf den Ordner «{ordner}» verweigert.', { ordner: f.name });
      row.append(smallButton(t('Anderen Ordner wählen…'), act(() => p.connectFolder())), smallButton(t('Trennen'), act(() => p.disconnectFolder()), 'ghost'));
    }
    el.templatesFolder.append(text, row);
  }

  async function renderTemplatesDialog() {
    const p = templateStore();
    if (!p) return;
    el.templatesLead.textContent = p.manageLead ? p.manageLead() : t('Vorlagen sind Markdown-Dateien (.md) mit Titel, Text und Unternotizen. Sie gelten für alle Bereiche in diesem Browser.');
    el.templatesPlaceholders.textContent = placeholderText(); // gleich, nicht erst nach Ordner und Liste
    el.phKeep.disabled = readOnly();
    try { el.phKeep.checked = (await B.getMeta(KEEP_PLACEHOLDERS)) === '1'; } catch (e) { el.phKeep.checked = false; }
    await renderTemplateFolder(p);
    let items = [];
    let error = null;
    try { items = await p.list(); } catch (e) { error = e; }
    el.templatesList.replaceChildren();
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'template-row';
      row.dataset.id = it.id;
      const info = document.createElement('div');
      const n = document.createElement('strong');
      n.textContent = it.name;
      const d = document.createElement('small');
      d.textContent = [it.description, tn('{n} Notiz', '{n} Notizen', it.notes || 1), templateSource(it)].filter(Boolean).join(' · ');
      info.append(n, d);
      const actions = document.createElement('div');
      actions.className = 'template-actions';
      if (p.download) actions.append(smallButton(t('Herunterladen'), async () => { try { await p.download(it.id); } catch (e) { setStatus(errorText(e), 'error'); } }));
      if (it.canRemove && canSaveTemplates()) {
        actions.append(smallButton(t('Entfernen'), async () => {
          if (!window.confirm(t('Vorlage «{name}» entfernen?', { name: it.name }))) return;
          try { await p.remove(it.id); hint(t('Vorlage «{name}» entfernt.', { name: it.name })); } catch (e) { setStatus(errorText(e), 'error'); }
          await renderTemplatesDialog();
        }, 'danger'));
      }
      row.append(info, actions);
      el.templatesList.appendChild(row);
    }
    el.templatesEmpty.hidden = items.length > 0 && !error;
    el.templatesEmpty.textContent = error ? errorText(error) : (p.emptyHint ? await p.emptyHint() : t('Noch keine Vorlagen.'));
    el.templatesImportBtn.hidden = !p.importFile || !canSaveTemplates();
    el.templatesManageBtn.hidden = !p.manageUrl;
  }

  async function importTemplateFiles(files) {
    const p = templateStore();
    if (!p || !p.importFile) return;
    let ok = 0;
    for (const file of files) {
      try { await p.importFile(file); ok++; } catch (e) { setStatus(t('«{datei}»: {fehler}', { datei: file.name, fehler: errorText(e) }), 'error'); }
    }
    if (ok) hint(tn('{n} Vorlage hinzugefügt.', '{n} Vorlagen hinzugefügt.', ok));
    if (el.templatesDialog.open) await renderTemplatesDialog();
  }

  // ---------- Hilfe ----------

  async function openHelp(tab) {
    closeMenu();
    hideContextMenu();
    await showHelpTab(tab || 'editor');
    if (typeof el.helpDialog.showModal === 'function') { if (!el.helpDialog.open) el.helpDialog.showModal(); }
    else el.helpDialog.setAttribute('open', '');
  }

  /** Zusätzliches Hilfe-Tab «Erweiterungen»: ein Abschnitt je Erweiterung mit Hilfetext (register({ help })). */
  function setupPluginHelp() {
    const items = Plugins.helpEntries(I18n.language());
    const tabBtn = el.helpTabs.querySelector('button[data-tab="plugins"]');
    const box = document.getElementById('helpPlugins');
    tabBtn.hidden = items.length === 0;
    box.replaceChildren();
    for (const item of items) {
      const sec = document.createElement('section');
      sec.className = 'help-plugin';
      sec.dataset.plugin = item.id;
      const h = document.createElement('h3');
      h.textContent = item.name;
      const body = document.createElement('div');
      body.className = 'md';
      body.innerHTML = M.render(item.text); // der Markdown-Renderer maskiert HTML
      // Überschriften des Plugins unter dem Abschnittstitel einordnen (# → h4, … ab h6 gedeckelt)
      for (const hd of [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')]) {
        const lvl = Math.min(6, Number(hd.tagName[1]) + 3);
        const n = document.createElement('h' + lvl);
        n.innerHTML = hd.innerHTML;
        hd.replaceWith(n);
      }
      sec.append(h, body);
      box.appendChild(sec);
    }
  }

  async function showHelpTab(tab) {
    for (const b of el.helpTabs.querySelectorAll('button[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const panel of el.helpDialog.querySelectorAll('.help-panel')) panel.hidden = panel.dataset.panel !== tab;
    if (tab === 'storage') await renderStorageStatus();
  }

  async function renderStorageStatus() {
    const lines = shell.storageLines();
    const n = await B.countNotes();
    const bytes = await B.attachmentsSize();
    const trash = await B.countTrash();
    lines.push(t('Inhalt: {notizen}, {papierkorb} im Papierkorb, Bilder {kb} KB', {
      notizen: tn('{n} Notiz', '{n} Notizen', n),
      papierkorb: trash,
      kb: Math.round(bytes / 1024),
    }));
    lines.push(shell.saveLine());
    el.helpStorageStatus.textContent = lines.join('\n');
  }

  // ---------- Fragen- und Entscheide-Ansicht ----------

  /** Art der Einträge in der aktiven Ansicht: 'question' (Fragen) oder 'decision' (Entscheide). */
  const questionKind = () => state.view === 'decisions' ? 'decision' : 'question';

  /** Beschriftungen der Leiste je nach Ansicht: dieselbe Leiste und Liste zeigt Fragen oder Entscheide. */
  function renderQuestionChrome() {
    const decision = questionKind() === 'decision';
    el.questionsView.setAttribute('aria-label', decision ? t('Entscheide') : t('Fragen'));
    el.qAnsweredBtn.textContent = decision ? t('Entschieden') : t('Beantwortet');
    el.qSearch.placeholder = decision ? t('Entscheide durchsuchen…') : t('Fragen durchsuchen…');
    el.qSearch.setAttribute('aria-label', el.qSearch.placeholder);
    el.qPrintBtn.title = decision ? t('Entscheide drucken (Ctrl+P)') : t('Fragen und Antworten drucken (Ctrl+P)');
  }

  async function setQuestionFilter(status) {
    clearTimeout(state.qSearchTimer);
    state.qQuery = el.qSearch.value;
    state.qStatus = status;
    for (const b of el.qFilter.querySelectorAll('button[data-status]')) {
      b.setAttribute('aria-selected', String(b.dataset.status === status));
    }
    await renderQuestions();
  }

  /** Auswahl «an @kürzel»: alle Kürzel, die Fragen und Entscheide (bzw. Aufgaben) nennen; ohne Kürzel bleibt die Auswahl verborgen.
   *  Liefert die gültige Wahl (eine Person, die es nicht mehr gibt, fällt weg). */
  function fillPersonFilter(people, select, current) {
    select = select || el.qPersonFilter;
    current = current == null ? state.qPerson : current;
    const frag = document.createDocumentFragment();
    const all = document.createElement('option');
    all.value = '';
    all.textContent = t('Alle Personen');
    frag.appendChild(all);
    for (const handle of people) {
      const o = document.createElement('option');
      o.value = handle;
      o.textContent = '@' + handle;
      frag.appendChild(o);
    }
    select.replaceChildren(frag);
    const value = people.some(h => h.toLowerCase() === current.toLowerCase()) ? current : '';
    select.value = value;
    select.hidden = people.length === 0;
    return value;
  }

  async function renderQuestions() {
    if (!inQuestions()) return;
    const kind = questionKind();
    const decision = kind === 'decision';
    const isLatest = fresh('questions');
    const resolve = await wikiResolver();
    // Entwurf eines offenen Antwortfelds sichern, damit ein Neuzeichnen nichts verschluckt.
    const openTa = state.qAnswering != null ? el.qList.querySelector(`.q-item[data-id="${state.qAnswering}"] .q-form textarea`) : null;
    if (openTa) state.qDraft = openTa.value;
    const today = Dates.nowIso();
    const [rows, counts, people] = await Promise.all([
      B.listQuestions({ kind, status: state.qStatus, query: state.qQuery, tag: state.qTag, person: state.qPerson, sort: state.qSort }),
      B.countQuestions(today),
      B.listPeople({ of: 'questions' }),
    ]);
    const noteLink = await noteLinkResolver(rows.map(r => [r.text, r.details, r.answer].join('\n')));
    if (!isLatest()) return;
    const c = decision ? (counts.decisions || { open: 0, total: 0, overdue: 0 }) : counts;
    state.qPerson = fillPersonFilter(people);
    el.qCount.textContent = t('{anzahl} von {gesamt} · {offen} offen', { anzahl: rows.length, gesamt: c.total, offen: c.open }) + (c.overdue ? ' · ' + t('{n} überfällig', { n: c.overdue }) : '');

    const groups = new Map();
    for (const r of rows) {
      const byDue = state.qSort === 'due';
      const key = byDue ? (r.answer ? 'answered' : Dates.urgency(r.due, today)) : `n${r.note_id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          title: byDue ? (key === 'answered' && decision ? t('Entschieden') : Dates.urgencyLabel(key)) : (r.note_title.trim() || t('Ohne Titel')),
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
        nb.title = t('Notiz öffnen');
        nb.addEventListener('click', () => openNote(g.noteId));
        h.appendChild(nb);
      } else {
        h.append(g.title);
      }
      const cnt = document.createElement('span');
      cnt.textContent = decision ? tn('{n} Entscheid', '{n} Entscheide', g.items.length) : tn('{n} Frage', '{n} Fragen', g.items.length);
      h.appendChild(cnt);
      section.appendChild(h);
      // Unter-Einträge eines Blocks direkt unter ihm (wenn er in der Auswahl ist), sonst für sich mit «Teil von …»
      for (const { row, nested } of Q.nest(g.items)) section.appendChild(renderQuestionItem(row, today, resolve, nested, noteLink));
      frag.appendChild(section);
    }
    el.qList.replaceChildren(frag);
    el.qEmpty.hidden = rows.length > 0;
    el.qEmpty.textContent = state.qQuery || state.qTag || state.qPerson ? t('Keine Treffer.')
      : decision
        ? (state.qStatus === 'open' ? t('Keine offenen Entscheide. Eine Zeile, die mit „?!“ beginnt, wird zum Entscheid; „@kürzel“ nennt, wer entscheiden soll.')
          : state.qStatus === 'answered' ? t('Noch keine getroffenen Entscheide.')
          : t('Noch keine Entscheide. Eine Zeile, die mit „?!“ beginnt, wird zum Entscheid.'))
        : (state.qStatus === 'open' ? t('Keine offenen Fragen. Eine Zeile, die mit „?“ beginnt, wird zur Frage, optional mit „>15.10.2026“ am Ende.')
          : state.qStatus === 'answered' ? t('Noch keine beantworteten Fragen.')
          : t('Noch keine Fragen. Eine Zeile, die mit „?“ beginnt, wird zur Frage.'));
    emitPlugins('questions:rendered', {
      kind,
      items: rows.map(r => ({ id: r.id, noteId: r.note_id, kind: r.kind, text: r.text, answer: r.answer, decided: r.decided || null, due: r.due || null, reminders: r.reminders || [], people: r.people || [], details: r.details || null, parentId: r.parent_id == null ? null : r.parent_id, element: el.qList.querySelector(`.q-item[data-id="${r.id}"]`) })),
    });
  }

  function renderQuestionItem(r, today, resolve, nested, noteLink) {
    const decision = r.kind === 'decision';
    const item = document.createElement('article');
    item.className = 'q-item ' + (decision ? 'decision ' : '') + (nested ? 'sub ' : '') + (r.answer ? 'answered' : 'open');
    item.dataset.id = String(r.id);
    item.dataset.kind = r.kind || 'question';

    const head = document.createElement('div');
    head.className = 'q-head';
    const mark = document.createElement('span');
    mark.className = 'q-mark';
    mark.textContent = r.answer ? '✓' : decision ? '?!' : '?';
    const text = document.createElement('div');
    text.className = 'q-text';
    text.innerHTML = M.inline(r.text, { highlight: state.qQuery.trim() || null, resolveRef: resolve, noteLink, people: true });
    head.append(mark, text);
    if (r.due) {
      if (!r.answer) appendReminder(head, r.reminders);
      const due = document.createElement('span');
      const u = r.answer ? 'none' : Dates.urgency(r.due, today || Dates.nowIso());
      due.className = 'due ' + u;
      due.textContent = r.answer ? Dates.formatDue(r.due) : Dates.dueLabel(r.due, today || Dates.nowIso());
      head.appendChild(due);
    }
    if (r.sub) text.insertAdjacentHTML('beforeend', M.subEntriesHtml(r.sub, !!r.answer));
    item.appendChild(head);

    // Unter-Eintrag ohne seinen Block in der Liste: woher er stammt
    if (r.parent_id != null && !nested && r.parent_text) {
      const within = document.createElement('div');
      within.className = 'q-within';
      within.textContent = t('Teil von «{titel}»', { titel: r.parent_text });
      item.appendChild(within);
    }

    // Beschreibung eines mehrzeiligen Eintrags als Zusammenhang: die ersten Zeilen, «Mehr anzeigen» klappt alles auf
    if (r.details) {
      const details = document.createElement('div');
      details.className = 'q-details md';
      details.innerHTML = M.render(r.details, { highlight: state.qQuery.trim() || null, resolveRef: resolve, noteLink });
      item.appendChild(details);
      const long = r.details.split('\n').length > 3 || r.details.length > 240;
      if (long) {
        details.classList.add('clamped');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'ghost q-more';
        more.textContent = t('Mehr anzeigen');
        more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', () => {
          const open = details.classList.toggle('clamped') === false;
          more.textContent = open ? t('Weniger anzeigen') : t('Mehr anzeigen');
          more.setAttribute('aria-expanded', String(open));
        });
        item.appendChild(more);
      }
    }

    if (r.answer) {
      const a = document.createElement('div');
      a.className = 'q-answer';
      a.innerHTML = M.render(r.answer, { highlight: state.qQuery.trim() || null, resolveRef: resolve, noteLink });
      item.appendChild(a);
    }

    const actions = document.createElement('div');
    actions.className = 'q-actions';
    const answerBtn = document.createElement('button');
    answerBtn.type = 'button';
    answerBtn.className = r.answer ? '' : 'primary';
    answerBtn.textContent = decision
      ? (r.answer ? t('Entscheid bearbeiten') : t('Entscheiden'))
      : (r.answer ? t('Antwort bearbeiten') : t('Beantworten'));
    answerBtn.addEventListener('click', () => { if (!denyWrite()) openAnswerForm(item, r); });
    answerBtn.hidden = readOnly();
    const gotoBtn = document.createElement('button');
    gotoBtn.type = 'button';
    gotoBtn.className = 'ghost';
    gotoBtn.textContent = t('Zur Notiz');
    gotoBtn.addEventListener('click', () => openNote(r.note_id, { line: r.line_no }));
    actions.append(answerBtn, gotoBtn);
    if (state.qSort === 'due') {
      const from = document.createElement('span');
      from.className = 't-note';
      from.append(t('aus') + ' ');
      const nb = document.createElement('button');
      nb.type = 'button';
      nb.textContent = r.note_title.trim() || t('Ohne Titel');
      nb.addEventListener('click', () => openNote(r.note_id));
      from.appendChild(nb);
      actions.appendChild(from);
    }
    const meta = document.createElement('span');
    meta.className = 'q-meta';
    meta.textContent = decision
      ? (r.answer ? t('Entschieden {datum}', { datum: r.decided ? Dates.formatDue(r.decided) : fmtDate(r.answered_at) }) : t('Gestellt {datum}', { datum: fmtDate(r.created_at) }))
      : (r.answer && r.answered_at ? t('Beantwortet {datum}', { datum: fmtDate(r.answered_at) }) : t('Gestellt {datum}', { datum: fmtDate(r.created_at) }));
    actions.appendChild(meta);
    item.appendChild(actions);

    const form = document.createElement('form');
    form.className = 'q-form';
    form.hidden = true;
    const ta = document.createElement('textarea');
    ta.placeholder = decision ? t('Entscheid…') : t('Antwort…');
    ta.setAttribute('aria-label', decision ? t('Entscheid') : t('Antwort'));
    const row = document.createElement('div');
    row.className = 'row';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'primary';
    save.textContent = t('Speichern');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = t('Abbrechen');
    cancel.addEventListener('click', () => { form.hidden = true; actions.hidden = false; state.qAnswering = null; state.qDraft = null; });
    row.append(save, cancel);
    form.append(ta, row);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await saveAnswer(r, ta.value);
    });
    ta.addEventListener('keydown', async e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); await saveAnswer(r, ta.value); }
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

  /** Schreibt Antwort oder Entscheid in die Notiz; ein neuer Entscheid bekommt das heutige Datum in den Text. */
  async function saveAnswer(r, text) {
    if (denyWrite()) return;
    const decision = r.kind === 'decision';
    try {
      const options = decision && !r.decided ? { decided: Dates.formatDue(Dates.todayIso()) } : {};
      const noteId = await B.answerQuestion(r.id, text, options);
      state.qAnswering = null;
      state.qDraft = null;
      markEdited();
      await renderQuestionCounts();
      await renderQuestions();
      if (state.currentId === noteId) await renderEditor();
      setStatus(text.trim()
        ? (decision ? t('Entscheid gespeichert') : t('Antwort gespeichert'))
        : (decision ? t('Entscheid entfernt') : t('Antwort entfernt')), 'dirty');
    } catch (e) {
      setStatus(decision
        ? t('Entscheid konnte nicht gespeichert werden: {fehler}', { fehler: errorText(e) })
        : t('Antwort konnte nicht gespeichert werden: {fehler}', { fehler: errorText(e) }), 'error');
    }
  }

  // ---------- Kürzel für die Vervollständigung @kürzel (die Liste zeigt der Editor) ----------

  // Ein begonnenes Kürzel direkt vor dem Cursor: "@" am Wortanfang (auch nach "("), dahinter nichts oder ein Buchstabe und mehr.
  const MENTION_PREFIX_RE = /(?:^|[\s(])\(?@(\p{L}[\p{L}\p{N}_.-]*|)$/u;

  /** Kürzel aus der Datei für die Vorschläge. Für die offene Notiz zählt der Text im Editor ohne das Wort am Cursor: die Notiz wird
   *  beim Tippen gespeichert, und ein halb getipptes «@be» (oder ein Zwischenstand wie «@ben») stünde sonst selbst in der Liste. */
  async function localPeople() {
    const seen = new Map();
    const add = h => { if (h && !seen.has(h.toLowerCase())) seen.set(h.toLowerCase(), h); };
    const open = isEditorOpen() && state.currentId != null ? state.currentId : null;
    for (const r of await B.listQuestions({ kind: 'all', status: 'all' })) if (r.note_id !== open) for (const p of r.people || []) add(p.handle);
    if (open != null) {
      const text = el.body.value;
      const caret = el.body.selectionStart || 0;
      const m = MENTION_PREFIX_RE.exec(text.slice(Math.max(0, caret - 120), caret));
      const without = m ? text.slice(0, caret - m[1].length - 1) + text.slice(caret).replace(/^[\p{L}\p{N}_.-]*/u, '') : text;
      for (const q of Q.parse(without)) for (const p of q.people) add(p.handle);
    }
    return [...seen.values()];
  }

  /** Die nächste Erinnerung (v3.0.0) als kleines Abzeichen mit Glocke vor der Frist, in den Listen der Aufgaben und Fragen. */
  function appendReminder(head, reminders) {
    const next = Dates.nextReminder(reminders);
    if (!next) return;
    const b = document.createElement('span');
    const u = Dates.urgency(next);
    b.className = 'due reminder ' + (u === 'today' ? 'today' : 'none');
    b.textContent = Dates.formatDue(next);
    b.title = (reminders.length > 1 ? tn('{n} Erinnerung, die nächste {datum}', '{n} Erinnerungen, die nächste {datum}', reminders.length, { datum: Dates.formatDue(next) })
      : t('Erinnerung {datum}', { datum: Dates.formatDue(next) }));
    head.appendChild(b);
  }

  // ---------- Aufgaben-Ansicht ----------

  async function setTaskFilter(status) {
    clearTimeout(state.tSearchTimer);
    state.tQuery = el.tSearch.value;
    state.tStatus = status;
    for (const b of el.tFilter.querySelectorAll('button[data-status]')) {
      b.setAttribute('aria-selected', String(b.dataset.status === status));
    }
    await renderTasks();
  }

  const URGENCY_ORDER = ['overdue', 'today', 'week', 'later', 'none', 'done', 'answered'];

  /** Gruppen nach Dringlichkeit in fester Reihenfolge, sonst in Reihenfolge des Auftretens. */
  function orderedGroups(groups, byUrgency) {
    const entries = [...groups.entries()];
    if (byUrgency) entries.sort((a, b) => URGENCY_ORDER.indexOf(a[0]) - URGENCY_ORDER.indexOf(b[0]));
    return entries.map(e => e[1]);
  }

  async function renderTasks() {
    if (state.view !== 'tasks') return;
    const isLatest = fresh('tasks');
    const resolve = await wikiResolver();
    const today = Dates.nowIso();
    const [rows, counts, people] = await Promise.all([
      B.listTasks({ status: state.tStatus, query: state.tQuery, tag: state.tTag, person: state.tPerson, sort: state.tSort === 'person' ? 'due' : state.tSort }),
      B.countTasks(today),
      B.listPeople({ of: 'tasks' }),
    ]);
    const noteLink = await noteLinkResolver(rows.map(r => r.text));
    if (!isLatest()) return;
    state.tPerson = fillPersonFilter(people, el.tPersonFilter, state.tPerson);
    el.tCount.textContent = t('{anzahl} von {gesamt} · {offen} offen', { anzahl: rows.length, gesamt: counts.total, offen: counts.open }) + (counts.overdue ? ' · ' + t('{n} überfällig', { n: counts.overdue }) : '');

    const groups = new Map();
    const add = (key, make, r) => { if (!groups.has(key)) groups.set(key, Object.assign(make(), { items: [] })); groups.get(key).items.push(r); };
    for (const r of rows) {
      if (state.tSort === 'person') {
        // je genannte Person eine Gruppe (eine Aufgabe für zwei Personen steht bei beiden), ohne Person am Schluss
        const handles = taskHandles(r);
        if (!handles.length) add('~', () => ({ title: t('Ohne Person'), noteId: null, cls: 'person-none' }), r);
        for (const h of handles) add('p' + h.toLowerCase(), () => ({ title: '@' + h, noteId: null, cls: 'person' }), r);
        continue;
      }
      const key = state.tSort === 'note' ? `n${r.note_id}` : (r.done ? 'done' : T.urgency(r.due, today));
      add(key, () => ({
        title: state.tSort === 'note' ? (r.note_title.trim() || t('Ohne Titel')) : Dates.urgencyLabel(key),
        noteId: state.tSort === 'note' ? r.note_id : null,
        cls: state.tSort === 'note' ? '' : `urgency-${key}`,
      }), r);
    }
    const ordered = state.tSort === 'person'
      ? [...groups.entries()].sort((a, b) => (a[0] === '~') - (b[0] === '~') || a[0].localeCompare(b[0])).map(e => e[1])
      : orderedGroups(groups, state.tSort !== 'note');

    const frag = document.createDocumentFragment();
    for (const g of ordered) {
      const section = document.createElement('section');
      section.className = 'q-group ' + g.cls;
      const h = document.createElement('h3');
      h.className = 'q-note';
      if (g.noteId != null) {
        const nb = document.createElement('button');
        nb.type = 'button';
        nb.textContent = g.title;
        nb.title = t('Notiz öffnen');
        nb.addEventListener('click', () => openNote(g.noteId));
        h.appendChild(nb);
      } else {
        h.append(g.title);
      }
      const cnt = document.createElement('span');
      cnt.textContent = tn('{n} Aufgabe', '{n} Aufgaben', g.items.length);
      h.appendChild(cnt);
      section.appendChild(h);
      for (const r of g.items) section.appendChild(renderTaskItem(r, today, resolve, noteLink));
      frag.appendChild(section);
    }
    el.tList.replaceChildren(frag);
    el.tEmpty.hidden = rows.length > 0;
    el.tEmpty.textContent = state.tQuery || state.tTag || state.tPerson ? t('Keine Treffer.')
      : state.tStatus === 'open' ? t('Keine offenen Aufgaben. Eine Zeile „- [ ] Text“ wird zur Aufgabe, optional mit „>15.10.2026“ am Ende.')
      : state.tStatus === 'done' ? t('Noch keine erledigten Aufgaben.')
      : t('Noch keine Aufgaben. Eine Zeile „- [ ] Text“ wird zur Aufgabe.');
  }

  /** Kürzel, die eine Aufgabe nennt (auch geerbt), jede einmal, in der Reihenfolge des Texts. */
  function taskHandles(r) {
    const seen = new Set();
    return (r.people || []).map(p => p.handle).filter(h => h && !seen.has(h.toLowerCase()) && seen.add(h.toLowerCase()));
  }

  function renderTaskItem(r, today, resolve, noteLink) {
    const item = document.createElement('article');
    item.className = 'q-item t-item ' + (r.done ? 'done' : 'open') + (r.depth ? ' sub' : '');
    item.dataset.id = String(r.id);
    if (r.depth && state.tSort === 'note') item.style.marginLeft = Math.min(r.depth, 4) * 24 + 'px'; // eingerückt unter der Hauptaufgabe

    const head = document.createElement('div');
    head.className = 'q-head';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 't-check';
    box.checked = !!r.done;
    box.setAttribute('aria-label', r.done ? t('Aufgabe wieder öffnen') : t('Aufgabe abhaken'));
    box.disabled = readOnly();
    box.addEventListener('change', () => toggleTaskDone(r.id, box.checked));
    const text = document.createElement('div');
    text.className = 'q-text';
    text.innerHTML = M.inline(r.text, { highlight: state.tQuery.trim() || null, resolveRef: resolve, noteLink, people: true });
    // Personen der Hauptaufgabe, wenn die Unteraufgabe selbst keine nennt (blass)
    for (const p of (r.people || []).filter(x => x.inherited)) {
      const chip = document.createElement('span');
      chip.className = 'md-person inherited' + (p.optional ? ' optional' : '');
      chip.dataset.handle = p.handle;
      chip.textContent = '@' + p.handle;
      chip.title = t('Über die Hauptaufgabe');
      text.append(' ', chip);
    }
    text.title = t('Doppelklick: Aufgabe samt Unteraufgaben abschliessen');
    text.addEventListener('dblclick', async e => {
      if (e.target.closest('a')) return;
      window.getSelection().removeAllRanges();
      await toggleTaskTreeInList(r.id);
    });
    head.append(box, text);
    if (r.sub_total) {
      const warn = r.done && r.sub_open > 0;
      const prog = document.createElement('span');
      prog.className = 't-progress' + (warn ? ' warn' : r.sub_open === 0 ? ' complete' : '');
      prog.textContent = `${r.sub_done}/${r.sub_total}` + (warn ? ' · ' + t('Unteraufgaben offen') : '');
      prog.title = warn ? t('Erledigt, aber {offen} von {gesamt} Unteraufgaben offen', { offen: r.sub_open, gesamt: r.sub_total }) : t('{erledigt} von {gesamt} Unteraufgaben erledigt', { erledigt: r.sub_done, gesamt: r.sub_total });
      head.appendChild(prog);
    }
    if (r.due) {
      if (!r.done) appendReminder(head, r.reminders);
      const due = document.createElement('span');
      const u = r.done ? 'none' : T.urgency(r.due, today);
      due.className = 'due ' + u;
      due.textContent = (u === 'overdue' ? t('überfällig') + ' · ' : u === 'today' ? t('heute') + ' · ' : '') + T.formatDue(r.due);
      head.appendChild(due);
    }
    item.appendChild(head);

    const actions = document.createElement('div');
    actions.className = 'q-actions';
    if (r.parent_text && state.tSort !== 'note') {
      const part = document.createElement('span');
      part.className = 't-note t-part';
      part.textContent = t('Teil von „{aufgabe}“', { aufgabe: r.parent_text });
      actions.appendChild(part);
    }
    if (state.tSort !== 'note') {
      const from = document.createElement('span');
      from.className = 't-note';
      from.append(t('aus') + ' ');
      const nb = document.createElement('button');
      nb.type = 'button';
      nb.textContent = r.note_title.trim() || t('Ohne Titel');
      nb.addEventListener('click', () => openNote(r.note_id));
      from.appendChild(nb);
      actions.appendChild(from);
    }
    const gotoBtn = document.createElement('button');
    gotoBtn.type = 'button';
    gotoBtn.className = 'ghost';
    gotoBtn.textContent = t('Zur Notiz');
    gotoBtn.addEventListener('click', () => openNote(r.note_id, { line: r.line_no }));
    actions.appendChild(gotoBtn);
    const meta = document.createElement('span');
    meta.className = 'q-meta';
    meta.textContent = r.done && r.done_at ? t('Erledigt {datum}', { datum: fmtDate(r.done_at) }) : t('Erfasst {datum}', { datum: fmtDate(r.created_at) });
    actions.appendChild(meta);
    item.appendChild(actions);
    return item;
  }

  async function toggleTaskDone(taskId, done) {
    if (denyWrite()) return;
    try {
      const noteId = await B.setTaskDone(taskId, done);
      markEdited();
      await renderTaskCounts();
      await renderTasks();
      if (state.currentId === noteId) { await renderEditor(); if (state.editorMode !== 'edit') await renderPreview(); }
      setStatus(done ? t('Aufgabe erledigt') : t('Aufgabe wieder geöffnet'), 'dirty');
    } catch (e) {
      if (e.code === 'SUBTASKS_OPEN') hint(errorText(e));
      else setStatus(t('Aufgabe konnte nicht geändert werden: {fehler}', { fehler: errorText(e) }), 'error');
      await renderTasks();
    }
  }

  /** Doppelklick in der Aufgabenliste: Aufgabe samt Unteraufgaben abschliessen bzw. wieder öffnen. */
  async function toggleTaskTreeInList(taskId) {
    if (denyWrite()) return;
    try {
      const r = await B.toggleTaskTree(taskId);
      markEdited();
      await renderTaskCounts();
      await renderTasks();
      if (state.currentId === r.noteId) { await renderEditor(); if (state.editorMode !== 'edit') await renderPreview(); }
      setStatus(r.action === 'completed' ? t('Aufgabe mit allen Unteraufgaben erledigt') : t('Aufgabe wieder geöffnet'), 'dirty');
    } catch (e) {
      setStatus(t('Aufgabe konnte nicht geändert werden: {fehler}', { fehler: errorText(e) }), 'error');
      await renderTasks();
    }
  }

  function onTaskSearchInput() {
    clearTimeout(state.tSearchTimer);
    state.tSearchTimer = setTimeout(async () => {
      if (el.tSearch.value === state.tQuery) return;
      state.tQuery = el.tSearch.value;
      await renderTasks();
    }, SEARCH_DELAY_MS);
  }

  async function openTaskPrintDialog() {
    hideContextMenu();
    closeMenu();
    const shown = (await B.listTasks({ status: state.tStatus, query: state.tQuery, tag: state.tTag, person: state.tPerson })).length;
    const label = state.tStatus === 'open' ? t('offene Aufgaben') : state.tStatus === 'done' ? t('erledigte Aufgaben') : t('alle Aufgaben');
    el.taskScopeFiltered.textContent = t('Wie angezeigt: {filter} ({anzahl})', {
      filter: joinParts(label, state.tTag ? t('Tag „{tag}“', { tag: state.tTag }) : '', state.tPerson ? t('an @{person}', { person: state.tPerson }) : '', state.tQuery.trim() ? t('Suche „{suche}“', { suche: state.tQuery.trim() }) : ''),
      anzahl: shown,
    });
    const group = el.taskPrintForm.querySelector(`input[name="taskGroup"][value="${state.tSort}"]`);
    if (group) group.checked = true; // gedruckt wird zuerst so, wie die Liste sortiert ist
    if (typeof el.taskPrintDialog.showModal === 'function') el.taskPrintDialog.showModal();
    else el.taskPrintDialog.setAttribute('open', '');
  }

  async function runTaskPrint() {
    const scope = (el.taskPrintForm.querySelector('input[name="taskScope"]:checked') || {}).value || 'filtered';
    const groupBy = (el.taskPrintForm.querySelector('input[name="taskGroup"]:checked') || {}).value || 'due';
    const html = await Printer.buildTasksDocument(B, {
      status: scope === 'filtered' ? state.tStatus : scope,
      tag: scope === 'filtered' ? state.tTag : '',
      query: scope === 'filtered' ? state.tQuery.trim() : '',
      person: scope === 'filtered' ? state.tPerson : '',
      groupBy,
    });
    if (el.taskPrintDialog.open) el.taskPrintDialog.close();
    Printer.print(html);
  }

  /** "/" ausserhalb von Eingabefeldern: Suche der aktuellen Ansicht fokussieren. */
  function focusSearch() {
    const target = state.view === 'map' ? el.mapSearch : inQuestions() ? el.qSearch : state.view === 'tasks' ? el.tSearch : el.search;
    target.focus();
    target.select();
  }

  function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function anyDialogOpen() {
    return [el.exportDialog, el.printDialog, el.qaPrintDialog, el.taskPrintDialog, el.helpDialog, el.calDialog, el.pluginsDialog, el.historyDialog, el.conflictDialog,
      el.templateSaveDialog, el.templatePickDialog, el.templatesDialog, el.nodeLinkDialog, el.detachDialog].some(d => d.open);
  }

  function onQuestionSearchInput() {
    clearTimeout(state.qSearchTimer);
    state.qSearchTimer = setTimeout(async () => {
      if (el.qSearch.value === state.qQuery) return;
      state.qQuery = el.qSearch.value;
      await renderQuestions();
    }, SEARCH_DELAY_MS);
  }

  async function deleteNoteById(id) {
    if (denyWrite()) return;
    hideContextMenu();
    const note = await B.getNote(id);
    if (!note) return;
    const name = note.title.trim() ? t('„{titel}“', { titel: note.title.trim() }) : t('diese Notiz');
    const info = state.map ? state.map.nodeInfo(id) : null;
    const kids = info ? info.childCount : 0;
    const hint = kids ? '\n\n' + tn('Die Unternotiz rückt zum übergeordneten Knoten auf.', '{n} Unternotizen rücken zum übergeordneten Knoten auf.', kids) : '';
    if (!confirm(t('Soll {name} in den Papierkorb verschoben werden?{hinweis}', { name, hinweis: hint }))) return;

    const parentId = note.parent_id;
    let nextInList = null;
    const li = el.list.querySelector(`li[data-id="${id}"]`);
    const neighbour = li && (li.nextElementSibling || li.previousElementSibling);
    if (neighbour) nextInList = Number(neighbour.dataset.id);

    await B.deleteNote(id);
    state.multi.delete(id);

    if (state.currentId === id) {
      state.currentId = state.view === 'list' ? nextInList : null;
      if (state.view === 'map') document.body.classList.remove('editor-open');
    }
    state.mapSelection = parentId == null ? 'root' : parentId;
    await renderAll();
    markEdited();
    if (state.currentId == null) showEditorView(false);
    if (state.view === 'map') el.mindmap.focus({ preventScroll: true });
  }

  /** Archiviert Notizen samt allen Unternotizen, nach Rückfrage mit der Anzahl. */
  async function archiveNotes(ids) {
    if (denyWrite()) return;
    hideContextMenu();
    await pruneMulti();
    const targets = (await Promise.all([...new Set(ids)].map(id => B.getNote(id)))).filter(n => n && !n.deleted_at && !n.archived_at).map(n => n.id);
    if (!targets.length) { hint(t('Nichts zu archivieren')); return; }
    const count = await B.archiveCount(targets);
    let message;
    if (targets.length === 1) {
      const n = await B.getNote(targets[0]);
      const name = n.title.trim() ? t('„{titel}“', { titel: n.title.trim() }) : t('diese Notiz');
      message = count > 1
        ? tn('{name} und {n} Unternotiz archivieren?', '{name} und {n} Unternotizen archivieren?', count - 1, { name })
        : t('{name} archivieren?', { name });
    } else {
      message = count > targets.length
        ? t('{n} Notizen archivieren (mit Unternotizen insgesamt {gesamt})?', { n: targets.length, gesamt: count })
        : t('{n} Notizen archivieren?', { n: targets.length });
    }
    if (!confirm(message + '\n\n' + t('Archivierte Notizen sind ausgeblendet, bleiben aber durchsuchbar und lassen sich einzeln zurückholen.'))) return;

    const first = await B.getNote(targets[0]);
    const archivedIds = new Set();
    for (const id of targets) for (const a of await B.archiveNote(id)) archivedIds.add(a);
    for (const id of archivedIds) state.multi.delete(id);

    let nextInList = null;
    if (state.currentId != null && archivedIds.has(state.currentId)) {
      const li = el.list.querySelector(`li[data-id="${state.currentId}"]`);
      let nb = li && li.nextElementSibling;
      while (nb && archivedIds.has(Number(nb.dataset.id))) nb = nb.nextElementSibling;
      if (!nb && li) { nb = li.previousElementSibling; while (nb && archivedIds.has(Number(nb.dataset.id))) nb = nb.previousElementSibling; }
      if (nb) nextInList = Number(nb.dataset.id);
      state.currentId = state.view === 'list' ? nextInList : null;
      if (state.view === 'map') document.body.classList.remove('editor-open');
    }
    if (typeof state.mapSelection === 'number' && archivedIds.has(state.mapSelection) && !state.showArchive) {
      state.mapSelection = first.parent_id == null ? 'root' : first.parent_id;
    }
    markEdited();
    await renderAll();
    if (state.currentId == null) showEditorView(false);
    setStatus(tn('{n} Notiz archiviert', '{n} Notizen archiviert', archivedIds.size), 'dirty');
    if (state.view === 'map') el.mindmap.focus({ preventScroll: true });
  }

  /** Holt genau diese Notiz aus dem Archiv, dazu die archivierten Notizen darüber. Unternotizen bleiben archiviert. */
  async function unarchiveById(id) {
    if (denyWrite()) return;
    hideContextMenu();
    const note = await B.getNote(id);
    if (!note || !note.archived_at) return;
    const done = await B.unarchiveNote(id);
    if (state.listScope === 'archive') { state.listScope = 'live'; el.listScope.value = 'live'; }
    if (state.view === 'map') state.mapSelection = id;
    markEdited();
    await renderAll();
    const extra = done.length - 1;
    const name = note.title.trim() ? t('„{titel}“', { titel: note.title.trim() }) : t('Notiz');
    setStatus(extra
      ? tn('{name} zurückgeholt, dazu {n} übergeordnete Notiz', '{name} zurückgeholt, dazu {n} übergeordnete Notizen', extra, { name })
      : t('{name} zurückgeholt', { name }), 'dirty');
  }

  async function restoreCurrent() {
    if (denyWrite()) return;
    if (state.currentId == null) return;
    const id = state.currentId;
    await B.restoreNote(id);
    const restored = await B.getNote(id);
    state.listScope = restored && restored.archived_at ? 'archive' : 'live'; // Archiv und Papierkorb sind unabhängig
    el.listScope.value = state.listScope;
    markEdited();
    await renderAll();
    setStatus(restored && restored.archived_at ? t('Notiz wiederhergestellt (liegt weiterhin im Archiv)') : t('Notiz wiederhergestellt'), 'dirty');
  }

  async function purgeCurrent() {
    if (denyWrite()) return;
    if (state.currentId == null) return;
    const note = await B.getNote(state.currentId);
    const name = note && note.title.trim() ? t('„{titel}“', { titel: note.title.trim() }) : t('diese Notiz');
    if (!confirm(t('Soll {name} endgültig gelöscht werden? Das lässt sich nicht rückgängig machen.', { name }))) return;
    await B.purgeNote(state.currentId);
    state.currentId = null;
    markEdited();
    await renderAll();
    showEditorView(false);
  }

  async function emptyTrash() {
    if (denyWrite()) return;
    const n = await B.countTrash();
    if (!n) return;
    if (!confirm(tn('Die Notiz im Papierkorb endgültig löschen?', 'Alle {n} Notizen im Papierkorb endgültig löschen?', n))) return;
    await B.emptyTrash();
    if (state.currentId != null && !await B.getNote(state.currentId)) state.currentId = null;
    markEdited();
    await renderAll();
  }

  /** Ablage aus der Mindmap: als Unternotiz des Ziels oder direkt vor/nach dem Ziel. side: auf der Wurzel abgelegt, auf diese Seite. */
  async function moveNoteTo(id, targetId, where, side) {
    if (denyWrite()) return;
    try {
      if (targetId == null && where === 'child' && side) { // auf die Wurzel: an die Wurzel, auf die Seite, wo losgelassen wurde
        const note = await B.getNote(id);
        if (note && note.parent_id == null) { // schon ein Hauptast: bleibt an seinem Platz, wechselt nur die Seite
          if (note.side !== side) await B.setSides({ [id]: side });
          state.mapSelection = id;
          markEdited();
          await renderMap();
          return;
        }
        await B.setParent(id, null);
        await B.setSides({ [id]: side });
        state.mapSelection = id;
        markEdited();
        await renderMap();
        if (state.currentId === id) await renderEditor();
        return;
      }
      if (where === 'before' || where === 'after') {
        if (targetId == null) return;
        await B.moveNote(id, targetId, where);
        const target = await B.getNote(targetId);
        if (target && target.parent_id != null) {
          const info = state.map.nodeInfo(target.parent_id);
          if (info && info.collapsed) await B.setCollapsed(target.parent_id, false);
        }
      } else {
        await B.setParent(id, targetId);
        if (targetId != null) {
          const info = state.map.nodeInfo(targetId);
          if (info && info.collapsed) await B.setCollapsed(targetId, false);
        }
      }
      state.mapSelection = id;
      markEdited();
      await renderMap();
      if (state.currentId === id) await renderEditor();
    } catch (e) {
      setStatus(errorText(e), 'error');
      await renderMap();
    }
  }

  /** Seiten der Hauptäste in der Mindmap (v3.0.0): Die Mindmap meldet, welche Seite ein neuer Ast bekommen hat; festgehalten wird sie,
   *  damit er beim nächsten Zeichnen nicht springt. Im Lesemodus nicht (dort verteilt die Mindmap jedes Mal gleich). */
  function keepSides(sides) {
    if (readOnly() || !Object.keys(sides || {}).length) return;
    B.setSides(sides).catch(e => console.warn('Seiten der Mindmap', e));
  }

  /** Ein Hauptast auf die andere Seite (Kontextmenü). */
  async function switchSide(id, side) {
    hideContextMenu();
    if (denyWrite()) return;
    await B.setSides({ [id]: side });
    state.mapSelection = id;
    markEdited();
    await renderMap();
  }

  /** Mindmap als Bild (PNG) in die Zwischenablage (v3.0.0), so wie sie zu sehen ist: eingeklappte Äste bleiben zu, Archiv und
   *  Querverweise wie eingeblendet, ohne Hervorhebung der Suche. Nimmt der Browser kein Bild an, lädt er es herunter. Das Bild
   *  entsteht in einem Promise, damit der Aufruf von clipboard.write noch zum Klick gehört (Safari verlangt das).
   *  focus (v3.1.0): Nummern der Knoten, ab denen kopiert wird (der Weg von der Wurzel, die Knoten mit ihren Unternotizen, darüber der
   *  Name des Bereichs); null: die ganze Mindmap; ohne Angabe nach der Auswahl (Mehrfachauswahl, sonst der gewählte Knoten). */
  function copyMapImage(focus) {
    hideContextMenu();
    const shown = state.mapShown;
    if (!shown) return;
    if (focus === undefined) focus = state.multi.size ? [...state.multi] : typeof state.mapSelection === 'number' ? [state.mapSelection] : null;
    const visible = new Set(shown.rows.map(r => r.id));
    const ids = (focus || []).filter(id => visible.has(id));
    const area = shell && shell.area && shell.area.name ? String(shell.area.name).trim() : '';
    const caption = ids.length && area && area.toLowerCase() !== String(shown.mapTitle || '').trim().toLowerCase() ? area : '';
    const titleOf = id => { const r = shown.rows.find(x => x.id === id); return (r && String(r.title || '').trim()) || t('Ohne Titel'); };
    const png = (async () => {
      const style = await mapStyleFor('copy', shown.rows.map(r => r.id));
      const svg = Mindmap.toSvgString(shown.rows, { mapTitle: shown.mapTitle, links: shown.links, accent: await Exporter.accentOf(B), sides: state.map.sides(), focus: ids, caption, style });
      const m = /width="(\d+)" height="(\d+)"/.exec(svg);
      const side = m ? Math.max(Number(m[1]), Number(m[2])) : 0;
      const bytes = await Exporter.svgToPng(svg, side ? Math.min(2, 8000 / side) : 2); // höchstens 8000 Pixel je Seite
      return new Blob([bytes], { type: 'image/png' });
    })();
    const name = ids.length === 1 ? titleOf(ids[0]) : (shown.mapTitle || 'Mindmap');
    const done = !ids.length ? t('Mindmap als Bild in die Zwischenablage kopiert')
      : ids.length === 1 ? t('Ab «{titel}» als Bild in die Zwischenablage kopiert', { titel: name })
      : tn('{n} Ast als Bild in die Zwischenablage kopiert', '{n} Äste als Bild in die Zwischenablage kopiert', ids.length);
    const fallback = async e => {
      if (e) console.warn('Zwischenablage', e);
      let blob;
      try { blob = await png; }
      catch (e2) { console.error(e2); setStatus(t('Die Mindmap konnte nicht als Bild gerendert werden.'), 'error'); return; }
      Store.download(new Uint8Array(await blob.arrayBuffer()), `${Exporter.slugify(name)}.png`, 'image/png');
      setStatus(t('Dieser Browser legt keine Bilder in die Zwischenablage; das Bild wurde heruntergeladen.'), saveState());
    };
    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof window.ClipboardItem !== 'function') { fallback(); return; }
    let item;
    try { item = new ClipboardItem({ 'image/png': png }); }
    catch (e) { fallback(e); return; }
    navigator.clipboard.write([item])
      .then(() => setStatus(done, saveState()))
      .catch(fallback);
  }

  /** «Hauptäste neu verteilen»: alle Hauptäste ausgewogen auf beide Seiten, die grössten zuerst. */
  async function rebalanceMap() {
    hideContextMenu();
    if (denyWrite()) return;
    const sides = state.map.balancedSides();
    if (!Object.keys(sides).length) return;
    await B.setSides(sides);
    markEdited();
    await renderMap();
    state.map.fit();
  }

  async function toggleCollapse(id) {
    const info = state.map.nodeInfo(id);
    if (!info || info.isRoot) return;
    await B.setCollapsed(id, !info.collapsed);
    if (info.collapsed === false && typeof state.mapSelection === 'number'
        && state.mapSelection !== id && isInSubtree(state.mapSelection, id)) {
      state.mapSelection = id;
    }
    markEdited();
    await renderMap();
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

  async function moveSelected(direction) {
    if (denyWrite()) return;
    if (typeof state.mapSelection !== 'number') return;
    if (await B.moveAmongSiblings(state.mapSelection, direction)) {
      markEdited();
      await renderMap();
    }
  }

  async function setAllCollapsed(collapsed) {
    hideContextMenu();
    await B.setAllCollapsed(collapsed);
    if (collapsed) state.mapSelection = typeof state.mapSelection === 'number' ? state.mapSelection : state.mapSelection;
    markEdited();
    await renderMap();
    state.map.fit();
  }

  // ---------- Umbenennen direkt im Knoten ----------

  async function beginRename(id, opts) {
    if (denyWrite()) return;
    hideContextMenu();
    await cancelRename();
    if (id !== 'root' && await B.isArchived(id)) { hint(t('Archivierte Notizen sind schreibgeschützt. Erst zurückholen.')); return; }
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
    input.value = id === 'root' ? await B.getMapTitle() : (await B.getNote(id) || {}).title || '';
    input.hidden = false;
    input.focus();
    input.select();
  }

  async function commitRename() {
    const r = state.rename;
    if (!r) return;
    state.rename = null;
    const value = el.renameInput.value.trim();
    el.renameInput.hidden = true;
    if (r.id === 'root') {
      await B.setMapTitle(value);
    } else if (r.isNew && !value) {
      await B.purgeNote(r.id);
      state.mapSelection = null;
    } else {
      await B.renameNote(r.id, value);
      state.mapSelection = r.id;
    }
    markEdited();
    await renderAll();
    if (state.currentId === r.id) await renderEditor();
    el.mindmap.focus({ preventScroll: true });
  }

  async function cancelRename() {
    const r = state.rename;
    if (!r) return;
    state.rename = null;
    el.renameInput.hidden = true;
    if (r.isNew && r.id !== 'root') {
      await B.purgeNote(r.id);
      state.mapSelection = null;
      markEdited();
      await renderAll();
    }
    el.mindmap.focus({ preventScroll: true });
  }

  // ---------- Kontextmenü ----------

  /** items: { label, key, action, danger, write, checked, title, plugin, panel } oder 'sep'; opts.above: Menü endet über y (etwa über
   *  der Statusleiste). panel() statt action: Untermenü daneben (Inhalt als Element, für Erweiterungen). */
  function showContextMenu(items, x, y, opts) {
    const menu = el.contextMenu;
    closeContextSub();
    menu.replaceChildren();
    if (readOnly()) { // Lesemodus: nur Einträge ohne Schreibzugriff, ohne verwaiste Trennlinien
      items = items.filter(i => i === 'sep' || !i.write)
        .filter((i, k, a) => i !== 'sep' || (k > 0 && k < a.length - 1 && a[k - 1] !== 'sep'));
      if (!items.length) return;
    }
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
      if (item.checked) { b.classList.add('checked'); b.setAttribute('aria-current', 'true'); }
      if (item.title) b.title = item.title;
      if (item.plugin) b.dataset.plugin = item.plugin;
      if (item.panel) { // Untermenü (Erweiterungen, seit 2.8.0): Klick, Zeigen oder Pfeil rechts öffnet es daneben
        const k = document.createElement('span');
        k.className = 'key';
        k.textContent = '▸';
        b.appendChild(k);
        b.classList.add('has-sub');
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        b.addEventListener('click', () => openContextSub(b, item, true));
        b.addEventListener('mouseenter', () => openContextSub(b, item, false));
        b.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); openContextSub(b, item, true); } });
      } else {
        b.addEventListener('click', () => { hideContextMenu(); item.action(); });
        b.addEventListener('mouseenter', closeContextSub);
      }
      menu.appendChild(b);
    }
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
    menu.style.top = opts && opts.above ? `${Math.max(8, y - h - 6)}px` : `${Math.min(y, window.innerHeight - h - 8)}px`;
    const first = menu.querySelector('button');
    if (opts && opts.above && first) first.focus(); // per Tastatur geöffnet: gleich bedienbar
  }

  function hideContextMenu() {
    closeContextSub();
    el.contextMenu.hidden = true;
    finishContextUse();
  }

  /** Das Menü ist zu: wurde mit einem Eintrag der Erweiterungen etwas an der Mehrfachauswahl getan, ist sie erledigt. */
  function finishContextUse() {
    const use = state.contextUse;
    state.contextUse = null;
    if (use && use.applied && use.multi) clearMulti();
  }

  /** Öffnet das Untermenü eines Eintrags neben dem Kontextmenü; focus: gleich hinein (Klick, Tastatur). */
  function openContextSub(anchor, item, focus) {
    const open = state.contextSub;
    if (open && open.anchor === anchor) { if (focus) focusFirstIn(open.el); return; }
    closeContextSub();
    const content = item.panel();
    if (!content || typeof content.nodeType !== 'number') return;
    const sub = document.createElement('div');
    sub.className = 'context-menu context-sub';
    sub.setAttribute('role', 'menu');
    sub.appendChild(content);
    sub.addEventListener('keydown', e => {
      if (e.key !== 'Escape' && e.key !== 'ArrowLeft') return;
      if (e.key === 'ArrowLeft' && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'checkbox') return;
      e.preventDefault();
      e.stopPropagation();
      closeContextSub();
      anchor.focus();
    });
    document.body.appendChild(sub);
    const m = el.contextMenu.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    const w = sub.offsetWidth, h = sub.offsetHeight;
    const left = m.right + 4 + w <= window.innerWidth - 8 ? m.right + 4 : Math.max(8, m.left - w - 4);
    sub.style.left = `${left}px`;
    sub.style.top = `${Math.max(8, Math.min(a.top - 7, window.innerHeight - h - 8))}px`;
    anchor.setAttribute('aria-expanded', 'true');
    state.contextSub = { anchor, el: sub };
    if (focus) focusFirstIn(sub);
  }

  function closeContextSub() {
    const open = state.contextSub;
    if (!open) return;
    state.contextSub = null;
    open.anchor.setAttribute('aria-expanded', 'false');
    open.el.remove();
  }

  function focusFirstIn(container) {
    const f = container.querySelector('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
    if (f) f.focus();
  }

  function showNodeMenu(id, x, y) {
    const fromTemplate = parent => (templateStore() ? [{ write: true, label: parent == null ? t('Neue Notiz aus Vorlage…') : t('Unternotiz aus Vorlage…'), action: () => openTemplatePick('new', parent) }] : []);
    if (id == null) {
      showContextMenu([
        { write: true, label: t('Neue Notiz'), key: 'Tab', action: () => newNoteInMap(null) },
        ...fromTemplate(null),
        { label: t('Einpassen'), key: '0', action: () => state.map.fit() },
        'sep',
        { label: t('Alles ausklappen'), action: () => setAllCollapsed(false) },
        { label: t('Alles einklappen'), action: () => setAllCollapsed(true) },
        { write: true, label: t('Hauptäste neu verteilen'), title: t('Verteilt die Hauptäste ausgewogen auf beide Seiten.'), action: () => rebalanceMap() },
        'sep',
        { label: t('Als Bild kopieren'), key: 'Ctrl+C', action: () => copyMapImage(null) },
      ], x, y);
      return;
    }
    if (id === 'root') {
      showContextMenu([
        { write: true, label: t('Neue Notiz'), key: 'Tab', action: () => newNoteInMap(null) },
        ...fromTemplate(null),
        { write: true, label: t('Titel ändern'), key: 'F2', action: () => beginRename('root') },
        'sep',
        { label: t('Alles ausklappen'), action: () => setAllCollapsed(false) },
        { label: t('Alles einklappen'), action: () => setAllCollapsed(true) },
        { label: t('Einpassen'), key: '0', action: () => state.map.fit() },
        { write: true, label: t('Hauptäste neu verteilen'), title: t('Verteilt die Hauptäste ausgewogen auf beide Seiten.'), action: () => rebalanceMap() },
        'sep',
        { label: t('Als Bild kopieren'), key: 'Ctrl+C', action: () => copyMapImage(null) },
        { label: t('Alles drucken…'), action: () => openPrintDialog({ scope: 'all' }) },
      ], x, y);
      return;
    }
    const info = state.map.nodeInfo(id);
    if (info && info.archived) {
      // Archivierte Notizen: nur ansehen, zurückholen, ein-/ausklappen, löschen
      const archivedItems = [
        { label: t('Öffnen'), key: 'Enter', action: () => openNote(id) },
        { write: true, label: t('Zurückholen'), action: () => unarchiveById(id) },
      ];
      if (info.childCount) archivedItems.push({ label: info.collapsed ? t('Ausklappen') : t('Einklappen'), action: () => toggleCollapse(id) });
      archivedItems.push({ label: t('Als Bild kopieren'), key: 'Ctrl+C', action: () => copyMapImage([id]) });
      archivedItems.push('sep', { write: true, label: t('Löschen'), key: t('Entf'), danger: true, action: () => deleteNoteById(id) });
      showContextMenu(archivedItems, x, y);
      return;
    }
    const items = [
      { label: t('Öffnen'), key: 'Enter', action: () => openNote(id) },
      { write: true, label: t('Unternotiz anlegen'), key: 'Tab', action: () => newNoteInMap(id) },
      ...fromTemplate(id),
      { write: true, label: t('Umbenennen'), key: 'F2', action: () => beginRename(id) },
    ];
    if (info && info.childCount) {
      items.push({ label: info.collapsed ? t('Ausklappen') : t('Einklappen'), action: () => toggleCollapse(id) });
    }
    if (templateStore() && canSaveTemplates()) items.push({ label: t('Als Vorlage speichern…'), action: () => openTemplateSave(id) });
    items.push(
      ...(info && info.link
        ? [{ label: t('Link öffnen'), title: nodeLinkTitle(info.link), action: () => { hideContextMenu(); openNodeLink(id); } },
          { write: true, label: t('Link ändern…'), action: () => openNodeLinkDialog(id) },
          { write: true, label: t('Link entfernen'), action: () => removeNodeLink(id) }]
        : [{ write: true, label: t('Link hinterlegen…'), title: t('Am Knoten einen Link auf eine Webseite, eine Datei, eine Notiz oder einen Bereich hinterlegen'), action: () => openNodeLinkDialog(id) }]),
      ...(canDetach() ? [{ write: true, label: t('In neuen Bereich auslösen…'), title: t('Diese Notiz wird die Wurzel eines neuen Bereichs, ihre Unternotizen ziehen mit'), action: () => openDetachDialog(id) }] : []),
      { label: t('Link kopieren'), action: () => copyNoteLink(id) },
      { label: t('Als Bild kopieren'), key: 'Ctrl+C', title: t('Den Weg von der Wurzel und diesen Ast als Bild in die Zwischenablage kopieren'), action: () => copyMapImage(state.multi.has(id) ? [...state.multi] : [id]) },
      { label: t('Drucken…'), action: () => openPrintDialog({ noteId: id, scope: 'subtree' }) },
      { write: true, label: t('Archivieren…'), action: () => archiveNotes([id]) },
      { write: true, label: t('Nach oben'), key: 'Alt+↑', action: async () => { state.mapSelection = id; await moveSelected(-1); } },
      { write: true, label: t('Nach unten'), key: 'Alt+↓', action: async () => { state.mapSelection = id; await moveSelected(1); } },
    );
    if (info && info.side) { // Hauptast: auf die andere Seite der Mindmap
      items.push(info.side === 'left'
        ? { write: true, label: t('Auf die rechte Seite'), action: () => switchSide(id, 'right') }
        : { write: true, label: t('Auf die linke Seite'), action: () => switchSide(id, 'left') });
    }
    // Einträge der Erweiterungen (seit 2.8.0): für die Mehrfachauswahl, wenn der Knoten dazugehört, sonst für ihn allein
    finishContextUse(); // ein noch offenes Menü (Rechtsklick auf einen anderen Knoten) zuerst abschliessen
    const multi = state.multi.has(id);
    const ids = (multi ? [id, ...[...state.multi].filter(x => x !== id)] : [id])
      .filter(x => { const i = state.map.nodeInfo(x); return !i || !i.archived; });
    const use = { multi, applied: false };
    const fromPlugins = pluginContextEntries(Object.freeze({ id, ids: Object.freeze(ids) }), use);
    if (fromPlugins.length) items.push('sep', ...fromPlugins);
    items.push('sep', { write: true, label: t('Löschen'), key: t('Entf'), danger: true, action: () => deleteNoteById(id) });
    showContextMenu(items, x, y);
    if (fromPlugins.length) state.contextUse = use;
  }

  // ---------- Suche, Menü ----------

  function onSearchInput(source) {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      const value = source === 'map' ? el.mapSearch.value : el.search.value;
      if (source === 'map') el.search.value = value; else el.mapSearch.value = value;
      if (value === state.query) return;
      state.query = value;
      state.mapMatchIndex = -1;
      await renderList();
      if (state.view === 'map') await renderMap(); else state.mapDirty = true;
      if (state.editorMode !== 'edit') await renderPreview();
    }, SEARCH_DELAY_MS);
  }

  function toggleMenu(force) {
    const open = typeof force === 'boolean' ? force : el.menu.hidden;
    if (open && state.closeLangList) state.closeLangList();
    el.menu.hidden = !open;
    el.menuBtn.setAttribute('aria-expanded', String(open));
  }
  function closeMenu() { toggleMenu(false); }

  function toggleNoteMenu(force) {
    const open = typeof force === 'boolean' ? force : el.noteMenu.hidden;
    el.noteMenu.hidden = !open;
    el.noteMenuBtn.setAttribute('aria-expanded', String(open));
  }
  function closeNoteMenu() { toggleNoteMenu(false); }

  // ---------- Tastatur in der Mindmap ----------

  async function onMapKeydown(e) {
    if (state.rename) return;
    const sel = state.mapSelection;
    const key = e.key;
    if (key === 'Tab') {
      e.preventDefault();
      await newNoteInMap(selectionAsParent());
    } else if (key === 'Enter') {
      e.preventDefault();
      if (typeof sel === 'number') await openNote(sel);
      else if (sel === 'root') await beginRename('root');
    } else if (key === 'F2') {
      e.preventDefault();
      if (sel != null) await beginRename(sel);
    } else if (key === 'Delete' || key === 'Backspace') {
      if (typeof sel === 'number') { e.preventDefault(); await deleteNoteById(sel); }
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault();
      if (e.altKey) { await moveSelected(key === 'ArrowUp' ? -1 : 1); return; }
      moveSelection(key === 'ArrowUp' ? 'up' : 'down');
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (e.altKey) return; // Alt+← / Alt+→ sind Zurück und Vor des Browsers
      e.preventDefault();
      moveSelection(key === 'ArrowLeft' ? 'left' : 'right');
    } else if (key === '+' || key === '=') {
      e.preventDefault(); state.map.zoomIn();
    } else if (key === '-') {
      e.preventDefault(); state.map.zoomOut();
    } else if (key === '0') {
      e.preventDefault(); state.map.fit();
    } else if ((key === 'c' || key === 'C') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault(); copyMapImage();
    } else if (key === 'Escape') {
      // Nur das Menü schliessen: ohne stopPropagation höbe das Dokument danach auch die Mehrfachauswahl auf
      if (!el.contextMenu.hidden) { e.stopPropagation(); hideContextMenu(); return; }
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
    el.viewDecisionsBtn.addEventListener('click', () => setView('decisions'));
    el.viewTasksBtn.addEventListener('click', () => setView('tasks'));
    el.tFilter.addEventListener('click', async e => {
      const b = e.target.closest('button[data-status]');
      if (b) await setTaskFilter(b.dataset.status);
    });
    el.tSort.addEventListener('change', async () => { state.tSort = el.tSort.value; await renderTasks(); });
    el.tSearch.addEventListener('input', onTaskSearchInput);
    el.tTagFilter.addEventListener('change', async () => { state.tTag = el.tTagFilter.value; await renderTasks(); });
    el.tPersonFilter.addEventListener('change', async () => { state.tPerson = el.tPersonFilter.value; await renderTasks(); });
    el.tPrintBtn.addEventListener('click', openTaskPrintDialog);
    el.taskPrintGoBtn.addEventListener('click', runTaskPrint);
    el.qFilter.addEventListener('click', async e => {
      const b = e.target.closest('button[data-status]');
      if (b) await setQuestionFilter(b.dataset.status);
    });
    el.qSearch.addEventListener('input', onQuestionSearchInput);
    el.qSort.addEventListener('change', async () => { state.qSort = el.qSort.value; await renderQuestions(); });
    el.menuHelpBtn.addEventListener('click', () => openHelp('editor'));
    setupLanguage();
    setupAccent();
    setupTheme();
    setupPluginHelp();
    el.pluginsBtn.addEventListener('click', openPluginsDialog);
    el.templatesBtn.addEventListener('click', openTemplatesDialog);
    el.mapTemplateBtn.addEventListener('click', () => openTemplatePick('new', selectionAsParent()));
    el.newTemplateBtn.addEventListener('click', () => openTemplatePick('new', null));
    el.childTemplateBtn.addEventListener('click', () => openTemplatePick('new', state.currentId));
    el.insertTemplateBtn.addEventListener('click', () => openTemplatePick('insert', null));
    el.saveTemplateBtn.addEventListener('click', () => openTemplateSave(state.currentId));
    el.templateSaveGoBtn.addEventListener('click', saveTemplate);
    el.templateSaveForm = el.templateSaveDialog.querySelector('form');
    el.templateSaveForm.addEventListener('submit', e => { if (e.submitter && e.submitter.value === 'cancel') return; e.preventDefault(); saveTemplate(); });
    el.templatePickGoBtn.addEventListener('click', runTemplatePick);
    el.templatePickManageBtn.addEventListener('click', async () => { el.templatePickDialog.close(); await openTemplatesDialog(); });
    el.templatePickList.addEventListener('keydown', async e => {
      const items = [...el.templatePickList.querySelectorAll('.template-item')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) { next.focus(); await selectTemplate(next.dataset.id); }
      } else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); await selectTemplate(items[i].dataset.id); await runTemplatePick(); }
    });
    el.phKeep.addEventListener('change', async () => { // Einstellung des Bereichs (im Dienst: des Arbeitsbereichs)
      if (denyWrite()) { el.phKeep.checked = !el.phKeep.checked; return; }
      await B.setMeta(KEEP_PLACEHOLDERS, el.phKeep.checked ? '1' : '');
      hint(el.phKeep.checked ? t('Ausgefüllte Platzhalter bleiben stehen.') : t('Ausgefüllte Platzhalter werden zu Text.'));
    });
    el.templatesImportBtn.addEventListener('click', () => el.templateInput.click());
    el.templateInput.addEventListener('change', async () => { const files = [...el.templateInput.files]; el.templateInput.value = ''; await importTemplateFiles(files); });
    el.templatesManageBtn.addEventListener('click', () => { const p = templateStore(); if (p && p.manageUrl) window.open(p.manageUrl(), '_blank', 'noopener'); });
    el.pluginLoadBtn.addEventListener('click', loadPluginFromInput);
    el.pluginFile.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadPluginFromInput(); } });
    el.storageHelpBtn.addEventListener('click', () => openHelp('storage'));
    el.helpTabs.addEventListener('click', async e => {
      const b = e.target.closest('button[data-tab]');
      if (b) await showHelpTab(b.dataset.tab);
    });
    el.qPersonFilter.addEventListener('change', async () => { state.qPerson = el.qPersonFilter.value; await renderQuestions(); });

    el.newBtn.addEventListener('click', newNote);
    el.mapNewBtn.addEventListener('click', () => newNoteInMap(selectionAsParent()));
    el.mapFitBtn.addEventListener('click', () => state.map.fit());
    // Unterkante der Leiste als CSS-Variable --map-bar-bottom (seit 2.11.0): Elemente von Erweiterungen über der Mindmap setzen sich
    // darunter, auch wenn die Leiste in zwei Zeilen umbricht
    const mapBar = el.mapView.querySelector('.map-toolbar');
    const setMapBar = () => el.mapView.style.setProperty('--map-bar-bottom', `${mapBar.offsetTop + mapBar.offsetHeight}px`);
    if (mapBar) { setMapBar(); if (window.ResizeObserver) new ResizeObserver(setMapBar).observe(mapBar); }
    el.mapZoomInBtn.addEventListener('click', () => state.map.zoomIn());
    el.mapZoomOutBtn.addEventListener('click', () => state.map.zoomOut());
    el.mindmap.addEventListener('keydown', onMapKeydown);

    el.renameInput.addEventListener('keydown', e => {
      e.stopPropagation(); // sofort, nicht erst nach dem Speichern
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
    });
    el.renameInput.addEventListener('blur', async () => { if (state.rename) await commitRename(); });

    el.childBtn.addEventListener('click', newChildOfCurrent);
    el.deleteBtn.addEventListener('click', async () => { if (state.currentId != null) await deleteNoteById(state.currentId); });
    el.historyBtn.addEventListener('click', openHistoryDialog);
    el.historyDiff.addEventListener('change', () => renderHistoryText());
    el.historyRestoreBtn.addEventListener('click', restoreHistoryVersion);
    el.historyClearBtn.addEventListener('click', clearHistory);
    el.conflictMineBtn.addEventListener('click', () => resolveConflict('mine'));
    el.conflictTheirsBtn.addEventListener('click', () => resolveConflict('theirs'));
    el.conflictMarkersBtn.addEventListener('click', () => resolveConflict('markers'));
    el.conflictDialog.addEventListener('close', postponeConflict); // Esc oder «Später entscheiden»
    window.addEventListener('beforeunload', e => { if (noteUnsaved() || state.sync.conflict) { e.preventDefault(); e.returnValue = ''; } });
    // Nicht abgewartete Aufrufe, deren Backend scheitert (keine Verbindung ...): als Meldung zeigen statt als Programmfehler
    window.addEventListener('unhandledrejection', e => {
      const r = e.reason;
      if (r && typeof r.code === 'string' && Object.prototype.hasOwnProperty.call(Backend.ERRORS, r.code)) {
        e.preventDefault();
        setStatus(errorText(r), 'error');
      }
    });
    el.backBtn.addEventListener('click', closeEditorStep);
    el.title.addEventListener('input', onEdit);
    el.title.addEventListener('input', scheduleNavTitle);
    el.search.addEventListener('input', () => onSearchInput('list'));
    el.search.addEventListener('keydown', e => {
      if (e.key === 'Escape' && el.search.value) { el.search.value = ''; onSearchInput('list'); }
    });
    el.mapSearch.addEventListener('input', () => onSearchInput('map'));
    el.mapSearch.addEventListener('keydown', async e => {
      if (e.key === 'Enter') { e.preventDefault(); await nextMapMatch(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') {
        e.stopPropagation();
        if (el.mapSearch.value) { el.mapSearch.value = ''; onSearchInput('map'); }
        else el.mindmap.focus({ preventScroll: true });
      }
    });
    el.listScope.addEventListener('change', async () => { state.listScope = el.listScope.value; await renderList(); await renderCount(); });
    el.tagFilter.addEventListener('change', async () => { state.tagFilter = el.tagFilter.value; await renderList(); });
    el.qTagFilter.addEventListener('change', async () => { state.qTag = el.qTagFilter.value; await renderQuestions(); });
    el.emptyTrashBtn.addEventListener('click', emptyTrash);
    el.restoreBtn.addEventListener('click', restoreCurrent);
    el.mapArchiveBtn.addEventListener('click', toggleArchiveView);
    el.mapLinksBtn.addEventListener('click', toggleLinksView);
    el.archiveBtn.addEventListener('click', async () => { if (state.currentId != null) await archiveNotes([state.currentId]); });
    el.unarchiveBtn.addEventListener('click', async () => { if (state.currentId != null) await unarchiveById(state.currentId); });
    el.multiArchiveBtn.addEventListener('click', () => archiveNotes([...state.multi]));
    el.printArchive.addEventListener('change', updatePrintLabels);
    el.purgeBtn.addEventListener('click', purgeCurrent);
    el.qList.addEventListener('click', onListLinkClick);
    el.tList.addEventListener('click', onListLinkClick);
    el.printBtn.addEventListener('click', () => openPrintDialog({ noteId: state.currentId }));
    el.copyLinkBtn.addEventListener('click', () => copyNoteLink(state.currentId));
    // Link am Knoten und Auslösen in einen neuen Bereich (v3.2.0)
    el.nodeLinkBtn.addEventListener('click', () => openNodeLinkDialog(state.currentId));
    el.nodeLinkEditBtn.addEventListener('click', () => openNodeLinkDialog(state.currentId));
    el.nodeLinkOpen.addEventListener('click', e => { e.preventDefault(); openNodeLink(state.currentId); });
    el.nodeLinkSaveBtn.addEventListener('click', () => saveNodeLink(el.nodeLinkInput.value));
    el.nodeLinkRemoveBtn.addEventListener('click', () => saveNodeLink(''));
    el.nodeLinkInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveNodeLink(el.nodeLinkInput.value); } });
    el.nodeLinkArea.addEventListener('change', () => { if (el.nodeLinkArea.value && shell.areaHref) el.nodeLinkInput.value = shell.areaHref(el.nodeLinkArea.value, null); });
    el.detachBtn.addEventListener('click', () => openDetachDialog(state.currentId));
    el.detachGoBtn.addEventListener('click', detachNode);
    el.detachName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); detachNode(); } });
    el.mapPrintBtn.addEventListener('click', () => openPrintDialog({}));
    el.mapCopyBtn.addEventListener('click', () => copyMapImage());
    el.multiPrintBtn.addEventListener('click', () => openPrintDialog({ scope: 'selection' }));
    el.multiClearBtn.addEventListener('click', clearMulti);
    el.printGoBtn.addEventListener('click', runPrint);
    el.qPrintBtn.addEventListener('click', openQaPrintDialog);
    el.qaPrintGoBtn.addEventListener('click', runQaPrint);
    // Pfade (v2.12.0) überall, wo Markdown steht (Vorschau, Listen): vor den Klicks der Ansichten
    document.addEventListener('click', onPathClick, true);
    document.addEventListener('contextmenu', onPathContextMenu, true);
    el.tagInput.addEventListener('keydown', async e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); await addTagFromInput(); }
      else if (e.key === 'Backspace' && !el.tagInput.value) {
        const tags = currentTags();
        if (tags.length) await removeTag(tags[tags.length - 1]);
      }
    });
    el.tagInput.addEventListener('change', async () => { if (el.tagInput.value.trim()) await addTagFromInput(); });
    el.tagInput.addEventListener('blur', async () => { if (el.tagInput.value.trim()) await addTagFromInput(); });
    el.title.addEventListener('keydown', e => { // Platzhalter im Titel (Tab, Enter, Esc) behandelt der Editor vorher (placeholders.field)
      if (e.key === 'Enter') { e.preventDefault(); el.body.focus(); }
    });

    el.list.addEventListener('click', async e => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      if (e.ctrlKey || e.metaKey) { toggleMulti(Number(li.dataset.id)); return; }
      await selectNote(Number(li.dataset.id), false);
    });
    el.list.addEventListener('keydown', async e => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); await selectNote(Number(li.dataset.id), true); }
      else if (e.key === 'ArrowDown' && li.nextElementSibling) { e.preventDefault(); li.nextElementSibling.focus(); }
      else if (e.key === 'ArrowUp' && li.previousElementSibling) { e.preventDefault(); li.previousElementSibling.focus(); }
    });

    el.menuBtn.addEventListener('click', () => toggleMenu());
    el.noteMenuBtn.addEventListener('click', () => toggleNoteMenu());
    el.toastCloseBtn.addEventListener('click', hideToast);
    el.noteMenu.addEventListener('click', e => { if (e.target.closest('button[role="menuitem"]')) closeNoteMenu(); });
    window.addEventListener('resize', () => { if (isEditorOpen()) fitCrumbs(); });
    document.addEventListener('click', e => {
      if (!el.menu.hidden && !e.target.closest('.menu')) closeMenu();
      if (!el.noteMenu.hidden && !e.target.closest('.note-menu')) closeNoteMenu();
      if (!el.contextMenu.hidden && !e.target.closest('.context-menu')) hideContextMenu();
    });
    document.addEventListener('contextmenu', e => {
      if (!e.target.closest('#mindmap') && !e.target.closest('#preview table.md-table')) hideContextMenu(); // Tabellen: eigenes Menü
    });
    window.addEventListener('resize', async () => { hideContextMenu(); if (state.rename) await cancelRename(); });
    window.addEventListener('blur', hideContextMenu);

    el.exportBtn.addEventListener('click', openExportDialog);
    el.calendarBtn.addEventListener('click', openCalDialog);
    el.calIncludeDone.addEventListener('change', updateCalDialog);
    el.calWriteBtn.addEventListener('click', () => runCalendarExport('write'));
    el.calPickBtn.addEventListener('click', () => runCalendarExport('pick'));
    el.calDownloadBtn.addEventListener('click', () => runCalendarExport('download'));
    el.exportDirBtn.addEventListener('click', () => runExport('dir'));
    el.exportZipBtn.addEventListener('click', () => runExport('zip'));

    document.addEventListener('keydown', async e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); shell.flush(); }
      else if (mod && !e.shiftKey && e.key.toLowerCase() === 'e' && state.currentId != null && !el.editorPane.hidden) { e.preventDefault(); await cycleEditorMode(); }
      else if (e.key === 'F1') { e.preventDefault(); await openHelp('editor'); }
      else if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (inQuestions() && !isEditorOpen()) await openQaPrintDialog();
        else if (state.view === 'tasks' && !isEditorOpen()) await openTaskPrintDialog();
        else await openPrintDialog({ noteId: isEditorOpen() || state.view === 'list' ? state.currentId : undefined });
      }
      else if (e.key === '/' && !mod && !e.altKey && !isTypingTarget(e.target) && !anyDialogOpen() && !isEditorOpen() && !state.rename) {
        e.preventDefault();
        focusSearch();
      }
      else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); await newNote(); }
      else if (e.key === 'Escape') {
        if (state.rename || anyDialogOpen()) return;
        if (state.multi.size && !isEditorOpen() && el.menu.hidden && el.contextMenu.hidden) { clearMulti(); return; }
        if (!el.contextMenu.hidden) { hideContextMenu(); return; }
        if (!el.langList.hidden) { state.closeLangList(); return; }
        if (!el.menu.hidden) { closeMenu(); return; }
        if (!el.noteMenu.hidden) { closeNoteMenu(); return; }
        if (isEditorOpen()) { await closeEditorStep(); return; }
        if (isNarrow() && document.body.classList.contains('view-editor')) showEditorView(false);
      }
    });

  }

  boot().catch(e => {
    console.error(e);
    bootError(t('NoNotes konnte nicht starten.') + '\n' + (e && e.message ? e.message : e));
  });
})();
