/* NoNotes – Vorlagen der lokalen Ausprägung (v2.5.0), für alle Bereiche gleich.
   Ein Ordner auf der Platte (gewöhnlich templates/ neben index.html) wird einmal verbunden (File System Access API, das Handle liegt
   im Browser); jede .md-Datei darin ist eine Vorlage. Ohne verbundenen Ordner (oder in Browsern ohne Ordnerzugriff) bietet «Als Vorlage
   speichern» die Datei zum Download an und merkt sich die Vorlage im Browser, damit sie sofort in allen Bereichen bereitsteht; gleich
   benannte Dateien im Ordner haben Vorrang. Lesen aus dem Ordner braucht die Erlaubnis des Browsers (nach einem Neustart fragt er
   wieder, auf einen Klick hin: grant()).

   Schnittstelle (shell.templates, auch die anderer Ausprägungen): list(), get(id), save(template, values), remove(id), download(id),
   importFile(file), canSave(), saveFields(), context(); dazu lokal folder(), connectFolder(), grant(), disconnectFolder(). */
(function (global) {
  'use strict';

  const { t } = global.NoNotesI18n;
  const T = () => global.NoNotesTemplates;
  const Store = () => global.NoNotesStorage;

  const KEY = 'templates';          // handle:templates (Ordner), value:templates (Vorlagen im Browser)
  const MAX_BYTES = 1024 * 1024;    // grössere Dateien sind keine Vorlagen
  const MD_RE = /\.(md|markdown)$/i;

  function invalid() { return Object.assign(new Error(t('Diese Datei ist keine Vorlage (Markdown, höchstens 1 MB).')), { code: 'TEMPLATE_INVALID' }); }
  function notFound() { return Object.assign(new Error(t('Vorlage nicht gefunden.')), { code: 'TEMPLATE_NOT_FOUND' }); }

  /** options.areaName(): Name des aktiven Bereichs (für den Platzhalter {{bereich}}). */
  function create(options) {
    const o = options || {};
    const store = () => Store().browserStore;
    let dir = null;        // verbundener Ordner (FileSystemDirectoryHandle) oder null
    let loaded = false;

    const folderSupported = typeof global.showDirectoryPicker === 'function';

    async function loadDir() {
      if (!loaded) {
        loaded = true;
        try { dir = folderSupported ? await store().loadHandleKey(KEY) : null; } catch (e) { dir = null; }
      }
      return dir;
    }

    /** Erlaubnis für den Ordner: 'granted' | 'prompt' | 'denied'. request=true fragt nach (braucht einen Klick). */
    async function permission(request) {
      const d = await loadDir();
      if (!d) return 'none';
      try { return await Store().fileAccess.permission(d, request); } catch (e) { return 'denied'; }
    }

    async function browserList() {
      const v = await store().loadValue(KEY);
      return Array.isArray(v) ? v.filter(x => x && typeof x.text === 'string') : [];
    }

    async function folderFiles() {
      const d = await loadDir();
      if (!d || await permission(false) !== 'granted') return [];
      const out = [];
      for await (const [name, handle] of d.entries()) {
        if (handle.kind !== 'file' || !MD_RE.test(name) || name.startsWith('.') || /^(readme|liesmich)\.md$/i.test(name)) continue;
        out.push({ name, handle });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    async function readFolderFile(handle) {
      const file = await handle.getFile();
      if (file.size > MAX_BYTES) return null;
      return file.text();
    }

    const summary = (id, tpl, source, file) => ({ id, name: tpl.name, description: tpl.description, notes: T().noteCount(tpl), source, file: file || null, canRemove: true });

    async function list() {
      const items = [];
      const names = new Set();
      for (const f of await folderFiles()) {
        try {
          const text = await readFolderFile(f.handle);
          if (text == null) continue;
          const tpl = T().parse(text, f.name);
          items.push(summary('folder:' + f.name, tpl, 'folder', f.name));
          names.add(tpl.name.toLowerCase());
        } catch (e) { /* unlesbare Datei: auslassen */ }
      }
      for (const b of await browserList()) {
        const tpl = T().parse(b.text, b.file);
        if (names.has(tpl.name.toLowerCase())) continue; // die Datei im Ordner hat Vorrang
        items.push(summary('browser:' + b.id, tpl, 'browser', b.file));
      }
      return items.sort((a, b) => a.name.localeCompare(b.name));
    }

    async function textOf(id) {
      const s = String(id || '');
      if (s.startsWith('folder:')) {
        const d = await loadDir();
        if (!d) throw notFound();
        let handle;
        try { handle = await d.getFileHandle(s.slice(7)); } catch (e) { throw notFound(); }
        const text = await readFolderFile(handle);
        if (text == null) throw invalid();
        return { text, file: s.slice(7) };
      }
      if (s.startsWith('browser:')) {
        const b = (await browserList()).find(x => x.id === s.slice(8));
        if (!b) throw notFound();
        return { text: b.text, file: b.file };
      }
      throw notFound();
    }

    async function get(id) {
      const { text, file } = await textOf(id);
      return T().parse(text, file);
    }

    /** Freier Dateiname im Ordner: «Name.md», sonst «Name (2).md» … */
    async function freeName(d, wanted) {
      const base = wanted.replace(MD_RE, '');
      for (let i = 1; i < 100; i++) {
        const name = i === 1 ? `${base}.md` : `${base} (${i}).md`;
        try { await d.getFileHandle(name); } catch (e) { return name; }
      }
      return `${base} ${Date.now()}.md`;
    }

    async function writeFolder(text, wanted) {
      const d = await loadDir();
      if (!d || await permission(true) !== 'granted') return null;
      const name = await freeName(d, wanted);
      const handle = await d.getFileHandle(name, { create: true });
      await Store().fileAccess.write(handle, new TextEncoder().encode(text));
      return name;
    }

    async function keepInBrowser(text, file) {
      const all = await browserList();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      all.push({ id, file, text, savedAt: new Date().toISOString() });
      await store().saveValue(KEY, all);
      return id;
    }

    /** Speichert eine Vorlage: in den Ordner, sonst als Download und im Browser. Gibt { id, where: 'folder'|'download', file } zurück. */
    async function save(template) {
      const text = T().toMarkdown(template);
      const wanted = T().fileName(template.name);
      const inFolder = await writeFolder(text, wanted).catch(() => null);
      if (inFolder) return { id: 'folder:' + inFolder, where: 'folder', file: inFolder, folder: dir ? dir.name : null };
      Store().download(new TextEncoder().encode(text), wanted, 'text/markdown');
      const id = await keepInBrowser(text, wanted);
      return { id: 'browser:' + id, where: 'download', file: wanted };
    }

    /** Eine .md-Datei als Vorlage aufnehmen (in den Ordner, sonst in den Browser). */
    async function importFile(file) {
      if (!file || file.size > MAX_BYTES || !MD_RE.test(file.name || '')) throw invalid();
      const text = await file.text();
      const tpl = T().parse(text, file.name);
      if (!tpl.notes.length) throw invalid();
      const inFolder = await writeFolder(text, file.name).catch(() => null);
      if (inFolder) return { id: 'folder:' + inFolder, where: 'folder', file: inFolder };
      return { id: 'browser:' + await keepInBrowser(text, file.name), where: 'browser', file: file.name };
    }

    async function remove(id) {
      const s = String(id || '');
      if (s.startsWith('folder:')) {
        const d = await loadDir();
        if (!d || await permission(true) !== 'granted') throw notFound();
        await d.removeEntry(s.slice(7));
        return;
      }
      if (s.startsWith('browser:')) {
        const all = await browserList();
        await store().saveValue(KEY, all.filter(x => x.id !== s.slice(8)));
        return;
      }
      throw notFound();
    }

    async function download(id) {
      const { text, file } = await textOf(id);
      Store().download(new TextEncoder().encode(text), file || T().fileName((T().parse(text, file)).name), 'text/markdown');
    }

    /** Ordner: { supported, name, permission: 'granted'|'prompt'|'denied'|'none' }. */
    async function folder() {
      const d = await loadDir();
      return { supported: folderSupported, name: d ? d.name : null, permission: await permission(false) };
    }

    async function connectFolder() {
      if (!folderSupported) throw new Error(t('Dieser Browser kann keine Ordner verbinden.'));
      const d = await global.showDirectoryPicker({ id: 'nonotes-templates', mode: 'readwrite' });
      await store().saveHandleKey(KEY, d);
      dir = d;
      loaded = true;
      return d.name;
    }

    async function grant() { return permission(true); }

    /** Wohin «Speichern» geht, als Satz für den Dialog. */
    async function saveHint() {
      const f = await folder();
      if (f.name && f.permission === 'granted') return t('Wird im Ordner «{ordner}» gespeichert und steht in allen Bereichen bereit.', { ordner: f.name });
      if (f.name && f.permission === 'prompt') return t('Wird im Ordner «{ordner}» gespeichert; der Browser fragt dafür nach deiner Erlaubnis.', { ordner: f.name });
      return t('Wird als Datei heruntergeladen und in diesem Browser für alle Bereiche gemerkt. Unter «Datenbank → Vorlagen…» lässt sich der Ordner templates/ verbinden; dann landen neue Vorlagen direkt dort.');
    }

    /** Hinweis, wenn es keine Vorlagen gibt. */
    async function emptyHint() {
      const f = await folder();
      if (f.name && f.permission !== 'granted') return t('Der Ordner «{ordner}» ist verbunden, aber noch nicht freigegeben: unter «Vorlagen verwalten…» erlauben.', { ordner: f.name });
      if (f.name) return t('Im Ordner «{ordner}» liegen keine Vorlagen (.md).', { ordner: f.name });
      return t('Noch keine Vorlagen. Verbinde unter «Vorlagen verwalten…» den Ordner templates/ neben index.html oder speichere eine Notiz über «Notiz → Als Vorlage speichern…».');
    }

    async function disconnectFolder() {
      await store().clearHandleKey(KEY);
      dir = null;
      loaded = true;
    }

    return {
      kind: 'local',
      list, get, save, remove, download, importFile,
      canSave: () => true,
      saveFields: () => [],
      context: () => ({ area: o.areaName ? o.areaName() : '', me: '' }),
      saveHint, emptyHint,
      folder, connectFolder, grant, disconnectFolder,
    };
  }

  global.NoNotesTemplatesLocal = { create };
})(window);
