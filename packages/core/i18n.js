/* NoNotes – Sprachen.
   Der deutsche Text im Quelltext ist der Schlüssel (wie bei gettext). Ohne Sprachpaket bleibt es deutsch.
   Weitere Sprachen liegen als Dateien in lang/ und werden mit register() angemeldet; extend() ergänzt ein Paket um Texte
   einer Ausprägung oder Erweiterung (auch wenn es erst später geladen wird) und ersetzt dabei seit v4.0.0 auch Texte, die das
   Paket schon hat: die Ergänzung gewinnt.

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
  // Die Wahl gilt nach dem Neuladen. Chromium verliert bei einem schnellen Neuladen gelegentlich den ganzen localStorage der Seite,
  // sessionStorage nicht: dort liegt die Wahl bis zum nächsten Start noch einmal, init() schreibt sie dann wieder fest.
  const PENDING_KEY = 'nonotes.lang.pending';
  const PSEUDO = 'qps'; // Entwicklungs-Sprache: umschliesst jeden Text mit ⟦ ⟧, um nicht übersetzte Stellen zu finden

  const packs = new Map();
  let current = SOURCE;
  let started = false; // init() läuft spätestens beim ersten Gebrauch, wenn alle Sprachpakete registriert sind

  const INLINE = new Set(['A', 'B', 'I', 'U', 'S', 'EM', 'STRONG', 'CODE', 'KBD', 'SPAN', 'SMALL', 'BR', 'ABBR', 'MARK', 'SUP', 'SUB', 'DEL']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'TEXTAREA', 'INPUT']);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];

  const extras = new Map(); // code → Map(Text → Übersetzung): Ergänzungen von Ausprägungen und Erweiterungen

  function register(code, name, messages, options) {
    const map = new Map(Object.entries(messages || {}));
    // Ergänzungen, die vor dem Paket angemeldet wurden, kommen hinzu und gewinnen gegen die Texte des Pakets (seit v4.0.0).
    for (const [k, v] of extras.get(code) || []) map.set(k, v);
    const o = options || {};
    packs.set(code, {
      code, name, locale: o.locale || code, messages: map, source: !!o.source,
      flag: typeof o.flag === 'string' ? o.flag.toUpperCase() : '', // Land der Flagge im Sprachwechsel (ISO 3166, z. B. CH)
      regions: Array.isArray(o.regions) ? o.regions.map(r => String(r).toUpperCase()) : [], // Regionen der Browsersprache, die dieses Paket bekommen
    });
  }

  /** Ergänzt die Texte einer Sprache um weitere (zum Beispiel einer Ausprägung oder Erweiterung), egal ob das Paket schon
   *  geladen ist oder erst danach kommt. Seit v4.0.0 gewinnt die Ergänzung: ein Text, den das Paket schon hat, wird ersetzt
   *  (bis v3.x blieb der des Pakets). Ein späteres extend() ersetzt ein früheres. Leere Texte ('') und andere Werte als Text
   *  oder Mehrzahl-Objekt ersetzen nichts. */
  function extend(code, messages) {
    let more = extras.get(code);
    if (!more) extras.set(code, more = new Map());
    const pack = packs.get(code);
    for (const [k, v] of Object.entries(messages || {})) {
      if (v === '' || v == null || (typeof v !== 'string' && typeof v !== 'object')) continue;
      more.set(k, v);
      if (pack) pack.messages.set(k, v);
    }
  }

  function available() {
    return [...packs.values()].map(p => ({ code: p.code, name: p.name, flag: p.flag, locale: p.locale }));
  }

  /** Das Paket zu einer Browsersprache (de-CH, es-AR, pt …): genau dieselbe Kennung oder dasselbe Gebietsschema; sonst ein Paket
   *  derselben Sprache, das die Region nennt (es-AR → es-MX); sonst das Paket, das nur die Sprache heisst (de, en), oder das erste
   *  dieser Sprache. Ohne Treffer null. */
  function match(tag) {
    const want = String(tag || '').toLowerCase();
    if (!want) return null;
    const list = [...packs.values()];
    const exact = list.find(p => p.code.toLowerCase() === want) || list.find(p => p.locale.toLowerCase() === want);
    if (exact) return exact.code;
    const parts = want.split('-');
    const base = parts[0];
    const region = (parts.slice(1).find(x => /^([a-z]{2}|\d{3})$/.test(x)) || '').toUpperCase();
    const same = list.filter(p => p.code.toLowerCase().split('-')[0] === base);
    if (!same.length) return null;
    const byRegion = region && same.find(p => p.regions.includes(region));
    return (byRegion || same.find(p => p.code.toLowerCase() === base) || same[0]).code;
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

  /** Übersetzung eines Texts in der Sprache der Oberfläche, roh (ohne Pseudo-Klammern), oder null, wenn es keine gibt. */
  function variant(key) {
    const p = pack();
    const v = p && !p.source ? p.messages.get(key) : null;
    return typeof v === 'string' && v !== '' ? v : null;
  }

  /** Alle Übersetzungen eines Texts über alle Sprachpakete (zum Beispiel die Namen der Platzhalter in Vorlagen). */
  function variants(key) {
    const out = [];
    for (const p of packs.values()) {
      const v = p.messages.get(key);
      if (typeof v === 'string' && v !== '' && !out.includes(v)) out.push(v);
    }
    return out;
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
    if (remember) {
      try { global.localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* egal */ }
      try { global.sessionStorage.setItem(PENDING_KEY, code); } catch (e) { /* egal */ }
    }
  }

  /** Beim Start: gespeicherte Wahl, sonst Browsersprache (match), sonst Deutsch. */
  function init() {
    started = true;
    let wanted = null;
    let pending = null;
    try { pending = global.sessionStorage.getItem(PENDING_KEY); if (pending) global.sessionStorage.removeItem(PENDING_KEY); } catch (e) { /* egal */ }
    try { if (pending) global.localStorage.setItem(STORAGE_KEY, pending); wanted = global.localStorage.getItem(STORAGE_KEY); } catch (e) { /* egal */ }
    wanted = pending || wanted;
    if (!wanted) {
      for (const l of (global.navigator && global.navigator.languages) || []) {
        wanted = match(l);
        if (wanted) break;
      }
    }
    setLanguage(wanted || SOURCE, false);
  }

  // ---------- Festes Markup ----------

  const OPAQUE = new Set(['KBD', 'CODE']); // Tastenkürzel und Code zählen nicht als zu übersetzender Text

  function collapse(s) { return s.replace(/\s+/g, ' ').trim(); }
  function hasWords(s) { return /[A-Za-zÄÖÜäöüÀ-ÿ]{2}/.test(s); }

  /** Sichtbarer Text eines Elements ohne Tastenkürzel und Code. */
  function ownText(node) {
    let s = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType === 1 && !OPAQUE.has(c.tagName)) s += ownText(c);
    }
    return s;
  }

  /** Nur Text und Textauszeichnung (ohne Elemente mit id, die das Programm anspricht). */
  function isInlineText(node) {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) continue;
      if (c.nodeType === 1 && INLINE.has(c.tagName) && !c.id && isInlineText(c)) continue;
      return false;
    }
    return true;
  }

  /** Geht das feste Markup durch. Mit apply === false werden nur die Schlüssel gesammelt.
   *  data-i18n-skip lässt ein Element samt Inhalt aus, data-i18n erzwingt die Übersetzung eines Elements,
   *  dessen Text nur aus Tastenkürzeln besteht (zum Beispiel <kbd data-i18n>Entf</kbd>). */
  function walk(root, apply) {
    const found = new Set();
    const p = pack();
    const lookup = key => (p && !p.source ? p.messages.get(key) : undefined);
    const emit = (key, set) => {
      if (!key) return;
      found.add(key);
      if (apply) {
        const v = lookup(key);
        const text = typeof v === 'string' && v !== '' ? v : key;
        set(current === PSEUDO ? `⟦${text}⟧` : text, v !== undefined || current === PSEUDO);
      }
    };
    const visit = elm => {
      if (elm.hasAttribute('data-i18n-skip')) return;
      for (const a of ATTRS) {
        if (elm.hasAttribute(a)) {
          const val = collapse(elm.getAttribute(a));
          if (hasWords(val)) emit(val, (text, ok) => { if (ok) elm.setAttribute(a, text); });
        }
      }
      if (SKIP.has(elm.tagName.toUpperCase())) return; // Inhalt von Skripten, Feldern usw. bleibt unberührt
      const forced = elm.hasAttribute('data-i18n');
      if (elm.tagName === 'OPTION' || (elm.childNodes.length && isInlineText(elm))) {
        if (forced || hasWords(ownText(elm))) {
          emit(collapse(elm.innerHTML), (text, ok) => { if (ok) elm.innerHTML = text; });
          return;
        }
        // Ohne eigenen Text (nur Tasten): erzwungene Teile trotzdem, z. B. <dt><kbd data-i18n>Entf</kbd></dt>
        for (const c of elm.querySelectorAll('[data-i18n]')) visit(c);
        return;
      }
      for (const c of [...elm.childNodes]) {
        if (c.nodeType === 3) {
          const val = collapse(c.nodeValue);
          if (hasWords(val)) emit(val, (text, ok) => { if (ok) c.nodeValue = text; });
        } else if (c.nodeType === 1) visit(c);
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

  global.NoNotesI18n = { SOURCE, PSEUDO, N_, register, extend, available, match, init, setLanguage, language, locale, t, tn, translateDom, collect, format, variant, variants };
})(window);
