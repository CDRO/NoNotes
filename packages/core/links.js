/* NoNotes – Querverweise (v1.8.0). [[Titel*]] im Text einer Notiz (Stern vor den schliessenden Klammern) verweist wie [[Titel]]
   auf die Notiz mit diesem Titel und zieht zusätzlich in der Mindmap eine gestrichelte Linie dorthin, quer zur Hierarchie.
   Reine Funktionen ohne Datenzugriff; den Index je Notiz führt packages/data/db.js (Tabelle note_links), das Ziel wird beim
   Lesen über den Titel aufgelöst wie bei [[Titel]] (ohne Gross-/Kleinschreibung; bei mehreren gewinnt die aktive Notiz). */
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

  /** Querverweise eines Notiztexts: [{ title, key, lineIndex }], je Ziel einmal (erstes Vorkommen); Code-Blöcke zählen nicht. */
  function parse(body) {
    const out = [];
    const seen = new Set();
    const lines = String(body == null ? '' : body).replace(/\r\n?/g, '\n').split('\n');
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
      if (fence) continue;
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

  global.NoNotesLinks = { parse, parseRef, normalize };
})(window);
