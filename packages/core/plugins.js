/* NoNotes – Erweiterungen (Plugins). Verzeichnis, Lader und Ereignisse; die Anbindung an die Oberfläche
   steht in packages/ui/app.js. Beschreibung für Autoren: docs/PLUGINS.md

   Eine Erweiterung ist eine Skriptdatei im Ordner plugins/ neben der App. Welche Dateien geladen werden,
   steht in plugins/plugins.js (NoNotesPlugins.list([...])). Die Datenbankdatei liefert nie Programmtext:
   Erweiterungen kommen ausschliesslich aus dem Ordner der App. Sie laufen mit allen Rechten der Seite.

   Eine Erweiterung meldet sich mit NoNotesPlugins.register({ id, name, version, api, description, theme, activate }).
   api ist die Schnittstellenversion (heute 1). Innerhalb der Version 1.x kommt nur Neues dazu, nichts fällt weg
   und nichts ändert seine Bedeutung. Alles, was Daten berührt, ist asynchron (Promise). */
(function (global) {
  'use strict';

  const { t } = global.NoNotesI18n;

  const API = 1;
  const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
  // Farben und Masse, die ein Theme überschreiben darf (CSS-Variablen ohne --). Die Hauptfarbe bleibt Sache der Palette.
  const THEME_VARS = ['bg', 'panel', 'text', 'muted', 'border', 'hover', 'danger', 'ok', 'warn', 'radius', 'shadow'];
  const EVENTS = ['ready', 'database:replaced', 'note:open', 'note:close', 'note:saved'];

  const listed = [];   // { file, url } in der Reihenfolge der Liste
  const plugins = [];  // { id, name, version, description, file, status, error, def, theme }
  const handlers = new Map(); // Ereignis → [{ id, fn }]
  let listBase = '';
  let loading = null;  // Datei, deren Skript gerade läuft

  function scriptBase() {
    const s = global.document && global.document.currentScript;
    return s && s.src ? s.src.replace(/[^/]*$/, '') : '';
  }

  /** Wird von plugins/plugins.js aufgerufen: die Dateien (relativ zum Ordner plugins/), in dieser Reihenfolge. */
  function list(files) {
    if (!listBase) listBase = scriptBase();
    for (const f of Array.isArray(files) ? files : []) {
      if (typeof f === 'string' && f.trim()) listed.push({ file: f.trim() });
    }
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

  /** Melden einer Erweiterung. Prüft die Beschreibung; ein Fehler macht nur diese Erweiterung unbrauchbar. */
  function register(def) {
    const file = loading || '(unbekannt)';
    const entry = { id: def && typeof def.id === 'string' ? def.id : '', name: '', version: '', description: '', file, status: 'loaded', error: '', def: def || null, theme: null };
    plugins.push(entry);
    const fail = msg => { entry.status = 'error'; entry.error = msg; };
    if (!def || typeof def !== 'object') return fail(t('register() braucht ein Objekt'));
    if (!ID_RE.test(entry.id)) return fail(t('id fehlt oder ist ungültig (a-z, 0-9, Bindestrich, 2 bis 41 Zeichen)'));
    if (plugins.some(p => p !== entry && p.id === entry.id)) return fail(t('id «{id}» ist schon vergeben', { id: entry.id }));
    entry.name = typeof def.name === 'string' && def.name.trim() ? def.name.trim() : entry.id;
    entry.version = typeof def.version === 'string' ? def.version : '';
    entry.description = typeof def.description === 'string' ? def.description : '';
    if (!Number.isInteger(def.api)) return fail(t('api fehlt (Schnittstellenversion, heute 1)'));
    if (def.api > API) return fail(t('braucht die Schnittstelle {api}, diese App bietet {angebot}', { api: def.api, angebot: API }));
    if (def.api < 1) return fail(t('api muss mindestens 1 sein'));
    if (def.activate != null && typeof def.activate !== 'function') return fail(t('activate muss eine Funktion sein'));
    if (def.theme != null) {
      const problem = validTheme(def.theme);
      if (problem) return fail(problem);
      entry.theme = {
        id: entry.id,
        name: typeof def.theme.name === 'string' && def.theme.name.trim() ? def.theme.name.trim() : entry.name,
        light: Object.assign({}, def.theme.light), dark: Object.assign({}, def.theme.dark), css: def.theme.css || '',
      };
    }
    return undefined;
  }

  /** Lädt alle Skripte der Liste nacheinander. Eine fehlende oder kaputte Datei ist ein Fehler dieser Erweiterung. */
  async function loadAll() {
    for (const item of listed) {
      const url = new URL(item.file, listBase || global.location.href).href;
      const before = plugins.length;
      loading = item.file;
      const ok = await new Promise(resolve => {
        const s = global.document.createElement('script');
        s.src = url;
        s.onload = () => resolve(null);
        s.onerror = () => resolve(t('Datei nicht gefunden oder nicht lesbar'));
        global.document.head.appendChild(s);
      });
      loading = null;
      if (ok) {
        plugins.push({ id: '', name: item.file, version: '', description: '', file: item.file, status: 'error', error: ok, def: null, theme: null });
      } else if (plugins.length === before) {
        plugins.push({ id: '', name: item.file, version: '', description: '', file: item.file, status: 'error', error: t('Die Datei hat sich nicht mit register() gemeldet'), def: null, theme: null });
      }
    }
  }

  function warn(entry, what, e) {
    console.warn(`Erweiterung ${entry.id || entry.file}: ${what}`, e); // i18n-ignore
  }

  /** Ruft activate(ctx) jeder gültigen Erweiterung auf; makeContext(entry) liefert ihre Schnittstelle. */
  async function activateAll(makeContext) {
    for (const entry of plugins) {
      if (entry.status !== 'loaded') continue;
      try {
        if (entry.def.activate) await entry.def.activate(makeContext(entry));
        entry.status = 'active';
      } catch (e) {
        entry.status = 'error';
        entry.error = (e && e.message) || String(e);
        warn(entry, 'activate fehlgeschlagen', e);
      }
    }
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
        const entry = plugins.find(p => p.id === rec.id);
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

  global.NoNotesPlugins = {
    API, EVENTS, THEME_VARS,
    list, register, loadAll, activateAll, on, emit, themeCss,
    all: () => plugins.slice(),
    themes: () => plugins.filter(p => p.theme && (p.status === 'loaded' || p.status === 'active')).map(p => p.theme),
    theme: id => { const p = plugins.find(x => x.theme && x.id === id && (x.status === 'loaded' || x.status === 'active')); return p ? p.theme : null; },
    listedCount: () => listed.length,
    base: () => listBase,
  };
})(window);
