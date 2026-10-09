/* NoNotes – Sprachen.
   Der deutsche Text im Quelltext ist der Schlüssel (wie bei gettext). Ohne Sprachpaket bleibt es deutsch.
   Weitere Sprachen liegen als Dateien in lang/ und werden mit register() angemeldet.

   Im Code:   t('Neue Notiz')                               einfacher Text
              t('{n} Treffer in {ort}', { n: 3, ort: 'X' })  mit Platzhaltern
              tn('{n} Notiz', '{n} Notizen', n)             Einzahl und Mehrzahl, {n} wird gesetzt
   Im Markup: Der feste Text der Seite wird beim Start über translateDom() ersetzt, ohne Auszeichnung:
              Elemente mit reinem Text oder Textauszeichnung (code, kbd, em ...) als Ganzes nach ihrem
              innerHTML, sonst die einzelnen Textknoten; dazu die Attribute title, placeholder, aria-label, alt.

   Wichtig für den Code: Schlüssel müssen Textliterale sein (keine Verkettung), damit das Werkzeug
   tools/i18n.cjs sie findet. Beschreibung: docs/LANGUAGES.md */
(function (global) {
  'use strict';

  const SOURCE = 'de';
  const STORAGE_KEY = 'nonotes.lang';
  const PSEUDO = 'qps'; // Entwicklungs-Sprache: umschliesst jeden Text mit ⟦ ⟧, um nicht übersetzte Stellen zu finden

  const packs = new Map();
  let current = SOURCE;
  let started = false; // init() läuft spätestens beim ersten Gebrauch, wenn alle Sprachpakete registriert sind

  const INLINE = new Set(['A', 'B', 'I', 'U', 'S', 'EM', 'STRONG', 'CODE', 'KBD', 'SPAN', 'SMALL', 'BR', 'ABBR', 'MARK', 'SUP', 'SUB', 'DEL']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'TEXTAREA', 'INPUT']);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];

  function register(code, name, messages, options) {
    const map = new Map(Object.entries(messages || {}));
    packs.set(code, { code, name, locale: (options && options.locale) || code, messages: map, source: !!(options && options.source) });
  }

  function available() {
    return [...packs.values()].map(p => ({ code: p.code, name: p.name }));
  }

  function format(text, params) {
    if (!params) return text;
    return text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  }

  function ensureStarted() { if (!started) init(); }

  function pack() { ensureStarted(); return packs.get(current) || null; }

  function wrap(s) { return current === PSEUDO ? `⟦${s}⟧` : s; }

  /** Markiert einen Text für die Extraktion, ohne ihn zu übersetzen (für Texte in Tabellen und Konstanten). */
  function N_(key) { return key; }

  function t(key, params) {
    const p = pack();
    let text = key;
    if (p && !p.source) {
      const v = p.messages.get(key);
      if (typeof v === 'string' && v !== '') text = v;
    }
    return wrap(format(text, params));
  }

  /** Einzahl und Mehrzahl. Der Schlüssel ist die deutsche Einzahl; im Sprachpaket steht ein Objekt mit den
   *  Kategorien von Intl.PluralRules (zero, one, two, few, many, other). */
  function tn(one, other, n, params) {
    const all = Object.assign({ n }, params || {});
    const p = pack();
    let text = n === 1 ? one : other;
    if (p && !p.source) {
      const v = p.messages.get(one);
      if (v && typeof v === 'object') {
        let cat = 'other';
        try { cat = new Intl.PluralRules(p.locale).select(n); } catch (e) { /* bleibt other */ }
        text = v[cat] || v.other || text;
      }
    }
    return wrap(format(text, all));
  }

  function locale() {
    const p = pack();
    return p ? p.locale : 'de-CH';
  }

  function language() { ensureStarted(); return current; }

  function setLanguage(code, remember) {
    started = true;
    if (code !== PSEUDO && !packs.has(code)) code = SOURCE;
    current = code;
    if (global.document && global.document.documentElement) global.document.documentElement.lang = code === PSEUDO ? SOURCE : code;
    if (remember) { try { global.localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* egal */ } }
  }

  /** Beim Start: gespeicherte Wahl, sonst Browsersprache, sonst Deutsch. */
  function init() {
    started = true;
    let wanted = null;
    try { wanted = global.localStorage.getItem(STORAGE_KEY); } catch (e) { /* egal */ }
    if (!wanted) {
      for (const l of (global.navigator && global.navigator.languages) || []) {
        const code = String(l).toLowerCase();
        if (packs.has(code)) { wanted = code; break; }
        const short = code.split('-')[0];
        if (packs.has(short)) { wanted = short; break; }
      }
    }
    setLanguage(wanted || SOURCE, false);
  }

  // ---------- Festes Markup ----------

  function collapse(s) { return s.replace(/\s+/g, ' ').trim(); }
  function hasLetters(s) { return /[A-Za-zÄÖÜäöüÀ-ÿ]/.test(s); }

  function isInlineText(node) {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) continue;
      if (c.nodeType === 1 && INLINE.has(c.tagName) && isInlineText(c)) continue;
      return false;
    }
    return true;
  }

  /** Geht das feste Markup durch. Mit apply === false werden nur die Schlüssel gesammelt. */
  function walk(root, apply) {
    const found = new Set();
    const p = pack();
    const lookup = key => (p && !p.source ? p.messages.get(key) : undefined);
    const emit = (key, set) => {
      if (!key || !hasLetters(key)) return;
      found.add(key);
      if (apply) {
        const v = lookup(key);
        const text = typeof v === 'string' && v !== '' ? v : key;
        set(current === PSEUDO ? `⟦${text}⟧` : text, v !== undefined || current === PSEUDO);
      }
    };
    const visit = elm => {
      if (SKIP.has(elm.tagName.toUpperCase()) || elm.hasAttribute('data-i18n-skip')) return;
      for (const a of ATTRS) {
        if (elm.hasAttribute(a)) emit(collapse(elm.getAttribute(a)), (text, ok) => { if (ok) elm.setAttribute(a, text); });
      }
      if (elm.tagName === 'OPTION' || (elm.childNodes.length && isInlineText(elm))) {
        const raw = elm.innerHTML;
        emit(collapse(raw), (text, ok) => { if (ok) elm.innerHTML = text; });
        return;
      }
      for (const c of [...elm.childNodes]) {
        if (c.nodeType === 3) emit(collapse(c.nodeValue), (text, ok) => { if (ok) c.nodeValue = text; });
        else if (c.nodeType === 1) visit(c);
      }
    };
    visit(root);
    return [...found];
  }

  function translateDom(root) {
    ensureStarted();
    if (current === SOURCE && !(pack() && !pack().source)) return;
    walk(root || global.document.body, true);
  }

  function collect(root) { return walk(root || global.document.body, false); }

  global.NoNotesI18n = { SOURCE, PSEUDO, N_, register, available, init, setLanguage, language, locale, t, tn, translateDom, collect, format };
})(window);
