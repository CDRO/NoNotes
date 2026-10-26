/* NoNotes – Querverweise (v1.8.0). [[Titel*]] im Text einer Notiz (Stern vor den schliessenden Klammern) verweist wie [[Titel]]
   auf die Notiz mit diesem Titel und zieht zusätzlich in der Mindmap eine gestrichelte Linie dorthin, quer zur Hierarchie.
   Reine Funktionen ohne Datenzugriff; den Index je Notiz führt packages/data/db.js (Tabelle note_links), das Ziel wird beim
   Lesen über den Titel aufgelöst wie bei [[Titel]] (ohne Gross-/Kleinschreibung; bei mehreren gewinnt die aktive Notiz).
   Seit 2.9.0 meint [[Titel#42]] (auch [[Titel#42*]]) genau die Notiz 42, auch nach Umbenennen oder Verschieben; die
   Vorschlagsliste im Editor schreibt die Nummer, wenn es den Titel mehrfach gibt. Siehe lookup(). */
(function (global) {
  'use strict';

  const REF_RE = /\[\[([^[\]\n]*)\]\]/g;

  /** Inhalt eines Verweises: { title, cross }. Ein Stern am Ende macht ihn zum Querverweis; [[Titel *]] gilt auch. */
  function parseRef(inner) {
    const raw = String(inner == null ? '' : inner).trim();
    const cross = raw.endsWith('*');
    const title = (cross ? raw.slice(0, -1) : raw).trim();
    return { title, cross };
  }

  /** Schlüssel für den Vergleich von Titeln (wie titleIndex in der Datenbankschicht). */
  function normalize(title) {
    return String(title || '').trim().toLowerCase();
  }

  const ID_RE = /^(.*\S)#(\d+)$/;

  /** Ziel eines Verweises. raw: Inhalt ohne Stern («Protokoll» oder «Protokoll#42»); byTitle(key) → id oder null; exists(id) → ob es
   *  die Notiz gibt (auch archiviert, nicht im Papierkorb). Zuerst zählt der ganze Text als Titel (ein Titel darf selbst auf #Zahl
   *  enden), sonst die Nummer hinter dem letzten #: genau diese Notiz; gibt es sie nicht mehr, ist der Verweis offen. Ergebnis:
   *  { id (oder null), label: Text zum Anzeigen, ohne die Nummer }. */
  function lookup(raw, byTitle, exists) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return { id: null, label: '' };
    const full = byTitle(normalize(text));
    if (full != null) return { id: full, label: text };
    const m = ID_RE.exec(text);
    if (!m) return { id: null, label: text };
    const id = Number(m[2]);
    return { id: exists(id) ? id : null, label: m[1].trim() };
  }

  /** Auflöser aus titleIndex() (je lebende Notiz ein Paar [Titel klein, id], bei gleichem Titel die gewinnende zuletzt): raw → { id, label }. */
  function resolver(pairs) {
    const byTitle = new Map();
    const ids = new Set();
    for (const [key, id] of pairs || []) { ids.add(id); if (key) byTitle.set(key, id); }
    return raw => lookup(raw, key => (byTitle.has(key) ? byTitle.get(key) : null), id => ids.has(id));
  }

  /** Querverweise eines Notiztexts: [{ title, key, lineIndex }], je Ziel einmal (erstes Vorkommen); Code-Blöcke zählen nicht.
   *  Ein mehrzeiliger Entscheid oder eine mehrzeilige Frage ("?!```" bis "```", auch als Listenpunkt "- ?!```", siehe questions.js)
   *  ist kein Code. */
  function parse(body) {
    const out = [];
    const seen = new Set();
    const lines = String(body == null ? '' : body).replace(/\r\n?/g, '\n').split('\n');
    let fence = null;
    let block = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (fence) { if (line.trim().startsWith(fence)) fence = null; continue; }
      if (!block && /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\?!?\s?```/.test(line)) block = true;
      else if (block && /^\s*```\s*$/.test(line)) { block = false; continue; }
      else {
        const f = /^\s*(```|~~~)/.exec(line);
        if (f) { fence = f[1]; continue; }
      }
      for (const m of line.matchAll(REF_RE)) {
        const ref = parseRef(m[1]);
        if (!ref.cross || !ref.title) continue;
        const key = normalize(ref.title);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ title: ref.title, key, lineIndex: i });
      }
    }
    return out;
  }

  global.NoNotesLinks = { parse, parseRef, normalize, lookup, resolver };
})(window);
