/* NoNotes – Erweiterungen (Plugins). Verzeichnis, Lader und Ereignisse; die Anbindung an die Oberfläche
   steht in packages/ui/app.js. Beschreibung für Autoren: docs/PLUGINS.md

   Eine Erweiterung ist eine Skriptdatei im Ordner plugins/ neben der App. Die Datenbankdatei liefert nie Programmtext:
   Erweiterungen kommen ausschliesslich aus dem Ordner der App. Sie laufen mit allen Rechten der Seite.

   Drei Wege, wie eine Datei (relativ zum Ordner plugins/) geladen wird:
   - plugins/plugins.js nennt sie mit NoNotesPlugins.list([...]): sie wird immer geladen, ohne Schalter («fest»).
   - Sie steht im Verzeichnis (NoNotesPlugins.catalog([...]), das der Build aus dem Ordner plugins/ erzeugt) und die
     Person hat sie im Dialog «Erweiterungen» eingeschaltet. Die Wahl merkt sich der Browser (app.js).
   - Die Person hat ihren Namen im Dialog eingegeben («Weitere Datei laden»).
   Laden und Ausschalten gehen zur Laufzeit (seit v1.7.0). Ein Skript lässt sich nicht entladen; disable() nimmt der
   Erweiterung darum, was die App ihr gegeben hat (Ereignisse; Menü, Toolleiste und Design räumt die Oberfläche), und ruft
   deactivate(), wenn sie eins hat.

   Eine Erweiterung meldet sich mit NoNotesPlugins.register({ id, name, version, api, description, theme, help, activate, deactivate }).
   api ist die Schnittstellenversion (heute 1). Innerhalb der Version 1.x kommt nur Neues dazu, nichts fällt weg
   und nichts ändert seine Bedeutung. Alles, was Daten berührt, ist asynchron (Promise). */
(function (global) {
  'use strict';

  const { t } = global.NoNotesI18n;

  const API = 1;
  const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
  // Dateiname relativ zu plugins/: Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich, Unterordner; kein Teil beginnt mit
  // einem Punkt (also kein ..), Endung .js. Damit bleibt jede Datei im Ordner plugins/.
  const FILE_RE = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.js$/;
  // Farben und Masse, die ein Theme überschreiben darf (CSS-Variablen ohne --). Die Hauptfarbe bleibt Sache der Palette.
  const THEME_VARS = ['bg', 'panel', 'text', 'muted', 'border', 'hover', 'danger', 'ok', 'warn', 'radius', 'shadow'];
  const EVENTS = ['ready', 'database:replaced', 'note:open', 'note:close', 'note:saved', 'mindmap:rendered', 'mindmap:select', 'questions:rendered'];

  const listed = [];    // { file } aus plugins/plugins.js, in dieser Reihenfolge (immer geladen)
  const available = []; // Verzeichnis aus dem Build: { file, id, name, version, api, description, theme }
  const plugins = [];   // { id, name, version, description, file, fixed, status, error, def, theme, help, valid, needsReload }
  const handlers = new Map(); // Ereignis → [{ id, fn }]
  let listBase = '';
  let loading = null;   // { file, fixed } der Datei, deren Skript gerade läuft
  let queue = Promise.resolve(); // Laden läuft immer nacheinander

  function scriptBase() {
    const s = global.document && global.document.currentScript;
    return s && s.src ? s.src.replace(/[^/]*$/, '') : '';
  }

  /** Ordner plugins/ als Adresse: der von plugins/plugins.js, sonst plugins/ neben der Seite. */
  function baseUrl() {
    return listBase || new URL('plugins/', global.location.href).href;
  }

  /** Dateiname bereinigt (ohne führendes ./) oder '' wenn unzulässig. */
  function cleanFile(file) {
    if (typeof file !== 'string') return '';
    const s = file.trim().replace(/^(?:\.\/)+/, '');
    return FILE_RE.test(s) ? s : '';
  }

  /** Wird von plugins/plugins.js aufgerufen: die Dateien, die immer geladen werden, in dieser Reihenfolge. */
  function list(files) {
    if (!listBase) listBase = scriptBase();
    for (const f of Array.isArray(files) ? files : []) {
      if (typeof f === 'string' && f.trim()) listed.push({ file: f.trim() });
    }
  }

  /** Vom Build in plugins/plugins.js eingetragen: die Dateien im Ordner plugins/ mit ihren Angaben (ohne sie zu laden). */
  function catalog(entries) {
    if (!listBase) listBase = scriptBase();
    const str = v => (typeof v === 'string' ? v.trim() : '');
    for (const e of Array.isArray(entries) ? entries : []) {
      const file = e && cleanFile(e.file);
      if (!file || available.some(a => a.file === file)) continue;
      available.push({
        file, id: str(e.id), name: str(e.name) || file, version: str(e.version),
        api: Number.isInteger(e.api) ? e.api : null, description: str(e.description), theme: !!e.theme,
      });
    }
  }

  function entryFor(file, fixed) {
    return { id: '', name: file, version: '', description: '', file, fixed: !!fixed, status: 'loaded', error: '', def: null, theme: null, help: null, valid: false, needsReload: false };
  }

  function validTheme(theme) {
    if (!theme || typeof theme !== 'object') return t('theme muss ein Objekt sein');
    for (const mode of ['light', 'dark']) {
      const vars = theme[mode];
      if (vars == null) continue;
      if (typeof vars !== 'object') return t('theme.{modus} muss ein Objekt sein', { modus: mode });
      for (const [k, v] of Object.entries(vars)) {
        if (!THEME_VARS.includes(k)) return t('theme.{modus}.{name}: unbekannte Variable (erlaubt: {erlaubt})', { modus: mode, name: k, erlaubt: THEME_VARS.join(', ') });
        if (typeof v !== 'string' || /[;{}<>]/.test(v)) return t('theme.{modus}.{name}: ungültiger Wert', { modus: mode, name: k });
      }
    }
    if (theme.css != null && (typeof theme.css !== 'string' || /<\/?style/i.test(theme.css))) return t('theme.css muss Text ohne <style> sein');
    return null;
  }

  /** help: Markdown-Text oder { sprache: text }. Liefert { sprache: text } (Schlüssel '' = für jede Sprache) oder null. */
  function normalizeHelp(help) {
    const ok = v => typeof v === 'string' && v.trim() && v.length <= 50000;
    if (ok(help)) return { '': help };
    if (!help || typeof help !== 'object' || Array.isArray(help)) return null;
    const out = {};
    for (const [k, v] of Object.entries(help)) {
      if (!ok(v)) return null;
      out[k.toLowerCase()] = v;
    }
    return Object.keys(out).length ? out : null;
  }

  /** Text in der Sprache lang: genau, dann ihre Hauptsprache (de-ch → de), dann en, dann de, dann irgendeiner. */
  function pickHelp(map, lang) {
    const l = String(lang || '').toLowerCase();
    return map[l] || map[l.split('-')[0]] || map[''] || map.en || map.de || map[Object.keys(map)[0]];
  }

  /** Melden einer Erweiterung. Prüft die Beschreibung; ein Fehler macht nur diese Erweiterung unbrauchbar. */
  function register(def) {
    const entry = entryFor(loading ? loading.file : '(unbekannt)', loading && loading.fixed);
    entry.id = def && typeof def.id === 'string' ? def.id : '';
    entry.def = def || null;
    plugins.push(entry);
    const fail = msg => { entry.status = 'error'; entry.error = msg; };
    if (!def || typeof def !== 'object') return fail(t('register() braucht ein Objekt'));
    if (!ID_RE.test(entry.id)) return fail(t('id fehlt oder ist ungültig (a-z, 0-9, Bindestrich, 2 bis 41 Zeichen)'));
    if (plugins.some(p => p !== entry && p.id === entry.id && p.valid)) return fail(t('id «{id}» ist schon vergeben', { id: entry.id }));
    entry.name = typeof def.name === 'string' && def.name.trim() ? def.name.trim() : entry.id;
    entry.version = typeof def.version === 'string' ? def.version : '';
    entry.description = typeof def.description === 'string' ? def.description : '';
    if (!Number.isInteger(def.api)) return fail(t('api fehlt (Schnittstellenversion, heute 1)'));
    if (def.api > API) return fail(t('braucht die Schnittstelle {api}, diese App bietet {angebot}', { api: def.api, angebot: API }));
    if (def.api < 1) return fail(t('api muss mindestens 1 sein'));
    if (def.activate != null && typeof def.activate !== 'function') return fail(t('activate muss eine Funktion sein'));
    if (def.deactivate != null && typeof def.deactivate !== 'function') return fail(t('deactivate muss eine Funktion sein'));
    if (def.help != null) {
      entry.help = normalizeHelp(def.help);
      if (!entry.help) return fail(t('help muss ein Markdown-Text oder ein Objekt mit einem Text je Sprache sein'));
    }
    if (def.theme != null) {
      const problem = validTheme(def.theme);
      if (problem) return fail(problem);
      entry.theme = {
        id: entry.id,
        name: typeof def.theme.name === 'string' && def.theme.name.trim() ? def.theme.name.trim() : entry.name,
        light: Object.assign({}, def.theme.light), dark: Object.assign({}, def.theme.dark), css: def.theme.css || '',
      };
    }
    entry.valid = true;
    return undefined;
  }

  /** Lädt eine Datei aus plugins/ und liefert ihren Eintrag; eine fehlende oder kaputte Datei ist ein Fehler dieser Erweiterung.
      Eine schon geladene Datei wird nicht noch einmal geladen (ihr Eintrag kommt zurück). */
  async function loadOne(file, fixed) {
    const clean = cleanFile(file);
    const known = plugins.find(p => p.file === (clean || String(file || '').trim()));
    if (known) return known;
    const bad = (name, error) => { const e = entryFor(name, fixed); e.status = 'error'; e.error = error; plugins.push(e); return e; };
    if (!clean) return bad(String(file || '').trim() || '?', t('Ungültiger Dateiname: erlaubt sind Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich und Unterordner innerhalb von plugins/, Endung .js'));
    const url = new URL(clean, baseUrl()).href;
    const before = plugins.length;
    loading = { file: clean, fixed: !!fixed };
    const problem = await new Promise(resolve => {
      const s = global.document.createElement('script');
      s.src = url;
      s.onload = () => resolve(null);
      s.onerror = () => resolve(t('Datei nicht gefunden oder nicht lesbar'));
      global.document.head.appendChild(s);
    });
    loading = null;
    if (problem) return bad(clean, problem);
    if (plugins.length === before) return bad(clean, t('Die Datei hat sich nicht mit register() gemeldet'));
    return plugins[before];
  }

  function serial(fn) {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  }

  /** Lädt die feste Liste und danach die eingeschalteten Dateien (chosen), alle nacheinander. */
  function loadAll(chosen) {
    return serial(async () => {
      for (const item of listed) await loadOne(item.file, true);
      for (const f of Array.isArray(chosen) ? chosen : []) await loadOne(f, false);
    });
  }

  /** Lädt eine Datei zur Laufzeit (relativ zu plugins/) und liefert ihren Eintrag. Danach activateAll() aufrufen. */
  function load(file) {
    return serial(() => loadOne(file, false));
  }

  function warn(entry, what, e) {
    console.warn(`Erweiterung ${entry.id || entry.file}: ${what}`, e); // i18n-ignore
  }

  async function activateOne(entry, makeContext) {
    try {
      if (entry.def.activate) await entry.def.activate(makeContext(entry));
      entry.status = 'active';
    } catch (e) {
      entry.status = 'error';
      entry.error = (e && e.message) || String(e);
      warn(entry, 'activate fehlgeschlagen', e);
    }
  }

  /** Ruft activate(ctx) jeder geladenen, noch nicht aktivierten Erweiterung auf; makeContext(entry) liefert ihre Schnittstelle. */
  async function activateAll(makeContext) {
    for (const entry of plugins) {
      if (entry.status === 'loaded' && entry.valid) await activateOne(entry, makeContext);
    }
  }

  /** Schaltet eine ausgeschaltete Erweiterung wieder ein (ihr Skript ist schon da): activate(ctx) läuft noch einmal. */
  async function activate(entry, makeContext) {
    if (!entry || !entry.valid || entry.status !== 'off') return;
    entry.status = 'loaded';
    entry.error = '';
    entry.needsReload = false;
    await activateOne(entry, makeContext);
  }

  /** Schaltet aus: nimmt die Ereignisse, ruft deactivate(), wenn vorhanden. Liefert false, wenn der Eintrag ganz entfernt
      wurde (eine Datei, die sich nie gültig gemeldet hat, hinterlässt nichts). Menü, Toolleiste und Design räumt die Oberfläche. */
  function disable(entry) {
    if (!entry || !plugins.includes(entry)) return false;
    if (!entry.valid) { plugins.splice(plugins.indexOf(entry), 1); return false; }
    if (entry.status === 'off') return true;
    for (const arr of handlers.values()) {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i].id === entry.id) arr.splice(i, 1);
    }
    if (entry.def.deactivate) {
      try { entry.def.deactivate(); } catch (e) { warn(entry, 'deactivate fehlgeschlagen', e); }
      entry.needsReload = false;
    } else {
      entry.needsReload = entry.status === 'active' && !!entry.def.activate;
    }
    entry.status = 'off';
    entry.error = '';
    return true;
  }

  function on(id, event, fn) {
    if (!EVENTS.includes(event)) throw new Error(t('Unbekanntes Ereignis «{ereignis}» (bekannt: {bekannt})', { ereignis: event, bekannt: EVENTS.join(', ') }));
    if (typeof fn !== 'function') throw new Error(t('Der Rückruf muss eine Funktion sein'));
    if (!handlers.has(event)) handlers.set(event, []);
    const rec = { id, fn };
    handlers.get(event).push(rec);
    return () => {
      const arr = handlers.get(event) || [];
      const i = arr.indexOf(rec);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  /** Meldet ein Ereignis. Rückrufe laufen nacheinander; ein Fehler trifft nur die Erweiterung, nicht die App. */
  async function emit(event, data) {
    for (const rec of (handlers.get(event) || []).slice()) {
      try { await rec.fn(data); }
      catch (e) {
        const entry = plugins.find(p => p.valid && p.id === rec.id);
        if (entry) { entry.error = (e && e.message) || String(e); }
        warn(entry || { id: rec.id }, `Fehler im Ereignis ${event}`, e); // i18n-ignore: Protokoll
      }
    }
  }

  /** CSS-Text eines Themes (leer für kein Theme). */
  function themeCss(theme) {
    if (!theme) return '';
    const block = vars => Object.entries(vars || {}).map(([k, v]) => `--${k}: ${v};`).join(' ');
    const light = block(theme.light);
    const dark = block(theme.dark);
    let out = '';
    if (light) out += `:root { ${light} }\n`;
    if (dark) out += `@media (prefers-color-scheme: dark) { :root { ${dark} } }\n`;
    if (theme.css) out += theme.css + '\n';
    return out;
  }

  const live = p => p.status === 'loaded' || p.status === 'active';

  global.NoNotesPlugins = {
    API, EVENTS, THEME_VARS,
    list, catalog, register, loadAll, load, activateAll, activate, disable, on, emit, themeCss, cleanFile,
    all: () => plugins.slice(),
    available: () => available.map(a => Object.assign({}, a)),
    /** Hilfetexte der eingeschalteten Erweiterungen in der Sprache lang: [{ id, name, text }] */
    helpEntries: lang => plugins.filter(p => p.help && live(p)).map(p => ({ id: p.id, name: p.name, text: pickHelp(p.help, lang) })),
    themes: () => plugins.filter(p => p.theme && live(p)).map(p => p.theme),
    theme: id => { const p = plugins.find(x => x.theme && x.id === id && live(x)); return p ? p.theme : null; },
    listedCount: () => listed.length,
    base: () => baseUrl(),
  };
})(window);
