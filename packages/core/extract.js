/* NoNotes – Text in Unterknoten auslagern (seit 4.2.0). i18n-ignore-file

   Eine Auswahl im Text einer Notiz wird zu einer oder mehreren Unternotizen; an ihrer Stelle steht ein Verweis [[Titel#42]] auf jede
   (mit Nummer, damit er auch nach dem Umbenennen trifft).

   - Beginnt die Auswahl am Anfang einer Zeile (Zeilenmodus), zählen Überschriften: Die höchste Ebene in der Auswahl teilt sie in
     Abschnitte, je Abschnitt ein Knoten mit der Überschrift als Titel; tiefere Überschriften bleiben unverändert im Text des Knotens.
     Text vor der ersten Überschrift dieser Ebene ist ein eigener Abschnitt. Ohne Überschrift ist die ganze Auswahl ein Abschnitt.
   - Ein Abschnitt ohne Überschrift bekommt als Titel den ersten Satz (höchstens 80 Zeichen, sonst am Wortende gekürzt mit «…»).
   - Mitten in einer Zeile (Inline) wird genau die Auswahl ausgelagert, als ein Knoten mit dem ersten Satz als Titel.
   - Wählt die Person Abschnitte ab (Dialog bei mehreren), kommt ein abgewählter Abschnitt samt Überschrift in den Knoten davor; steht
     davor keiner, bleibt er im Text der Eltern-Notiz.
   - Bilder ![…](att:ID) der Eltern-Notiz im ausgelagerten Text werden an den neuen Knoten kopiert; braucht der Text der Eltern-Notiz
     sie danach nicht mehr, werden sie dort entfernt (dropUnused).

   Reine Funktionen (plan, build, replacement, firstSentence …) und drei Schritte über die Backend-Schnittstelle (createNodes, dropUnused,
   undo); die Oberfläche (packages/ui/extract-ui.js) und das Agenten-Werkzeug extract_to_child (packages/agent/catalog.js) benutzen
   dieselben. Ohne DOM, läuft auch in Node (Programm für Agenten, Server des Dienstes). */
(function (global) {
  'use strict';

  const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/; // wie NoNotesMarkdown
  const LIST_RE = /^(\s*)([-*+]|(\d+)([.)]))\s+(?:\[[ xX]\]\s+)?/;
  const ATT_RE = /\(att:(\d+)\)/g;
  const TITLE_MAX = 80;
  // Abkürzungen, nach deren Punkt kein Satz endet (klein, ohne Punkt)
  const ABBREV = new Set(['bzw', 'usw', 'etc', 'ca', 'evtl', 'inkl', 'exkl', 'vgl', 'nr', 'bspw', 'ggf', 'zb', 'resp', 'dh', 'ua', 'uvm',
    'hr', 'fr', 'dr', 'prof', 'st', 'mio', 'mrd', 'abs', 'art', 'bd', 'jh', 'eg', 'ie', 'vs', 'mr', 'mrs', 'ms', 'no', 'approx', 'cf',
    'env', 'sr', 'sra', 'ecc', 'pag', 'sig', 'mme', 'mlle', 'cie']);

  const str = v => String(v == null ? '' : v);
  const lineStart = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd = (text, pos) => { const i = text.indexOf('\n', pos); return i < 0 ? text.length : i; };
  const lineIndex = (text, pos) => { let n = 0; for (let i = text.indexOf('\n'); i >= 0 && i < pos; i = text.indexOf('\n', i + 1)) n++; return n; };

  /** Je Zeile, ob sie in einem Code-Block oder einem mehrzeiligen Eintrag ("?!```" … "```") liegt: dort gibt es keine Überschriften. */
  function codeMask(lines) {
    const out = new Array(lines.length).fill(false);
    let fence = null;
    let block = false;
    lines.forEach((line, i) => {
      if (fence) { out[i] = true; if (line.trim().startsWith(fence)) fence = null; return; }
      if (block) { out[i] = true; if (/^\s*```\s*$/.test(line)) block = false; return; }
      if (/^\s*(?:(?:[-*+]|\d+[.)])\s+)?\?!?\s?```/.test(line)) { block = true; out[i] = true; return; }
      const f = /^\s*(```|~~~)/.exec(line);
      if (f) { fence = f[1]; out[i] = true; }
    });
    return out;
  }

  /** Markdown einer Zeile als schlichter Text (für Titel): Bilder und Links als ihr Text, Verweise als Titel, ohne Hervorhebungen. */
  function plain(s) {
    let v = str(s);
    if (global.NoNotesPlaceholders && global.NoNotesPlaceholders.flatten) v = global.NoNotesPlaceholders.flatten(v);
    return v
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[\[([^[\]\n]*?)(?:#\d+)?\s*\*?\s*\]\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<((?:https?|mailto|file):[^>\s]*)>/gi, '$1')
      .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
      .replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/(\s+>\s?\d[\d.\-/: ]*)+\s*$/, '') // Termine am Zeilenende (">6.11.2026", ">2026-11-06 14:00")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Inhalt einer Zeile ohne Zeichen für Zitat, Liste, Kästchen, Frage, Entscheid, Antwort und Tabelle. '' für Zeilen ohne Text. */
  function lineContent(line) {
    let v = str(line);
    if (/^\s*(```|~~~)\s*$/.test(v) || /^\s*[|+:=\s-]+$/.test(v) && /[-=]/.test(v)) return ''; // Zaun, Trennlinie, Rahmen
    v = v.replace(/^\s*(?:>\s?)+/, '');
    v = v.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
    v = v.replace(/^\[[ xX]\]\s+/, '');
    v = v.replace(/^(?:\?!?|!!?)\s?(?:```\s*)?/, '');
    v = v.replace(/^\s*(```|~~~)\S*\s*/, '');
    const h = HEADING_RE.exec(v);
    if (h) v = h[2];
    if (/^\s*\|/.test(v)) v = v.split('|').map(c => c.trim()).filter(Boolean).join(' ');
    return plain(v);
  }

  /** Erster Satz eines Texts als Titel, höchstens max Zeichen (Standard 80): bis zum ersten «.», «!», «?» oder «…» vor einem
   *  Leerraum (nicht nach einer Zahl oder Abkürzung wie «z. B.», «bzw.»), ohne Punkt am Ende; zu lang: am letzten Wortende vor der
   *  Grenze gekürzt mit «…». Leer, wenn der Text keine Wörter hat. */
  function firstSentence(text, max) {
    const limit = max || TITLE_MAX;
    let line = '';
    for (const l of str(text).replace(/\r\n?/g, '\n').split('\n')) { line = lineContent(l); if (line) break; }
    if (!line) return '';
    let end = line.length;
    const re = /[.!?…]+(?=\s|$)/g;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const stop = m.index + m[0].length;
      if (m[0][0] === '.' && m[0] === '.') {
        const before = line.slice(0, m.index);
        const word = (/([\p{L}\d]+)$/u.exec(before) || [])[1] || '';
        if (!word || /\d$/.test(word) || word.length === 1 || ABBREV.has(word.toLowerCase())) continue;
      }
      end = stop;
      break;
    }
    let s = line.slice(0, end).trim().replace(/[.:;,]+$/, '').trim();
    if (s.length > limit) {
      const cut = s.slice(0, limit - 1);
      const sp = cut.lastIndexOf(' ');
      s = (sp > limit / 2 ? cut.slice(0, sp) : cut).replace(/[\s.,;:–-]+$/, '') + '…';
    }
    return s;
  }

  /** Text für einen Verweis: ohne eckige Klammern und Zeilenumbrüche. */
  function label(title) {
    return str(title).replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim();
  }

  /** [[Titel#42]] */
  function link(title, id) {
    return `[[${label(title)}#${id}]]`;
  }

  /** Nummern der Bilder im Text (![…](att:12)), je einmal, in der Reihenfolge. */
  function attachmentRefs(text) {
    const out = [];
    for (const m of str(text).matchAll(ATT_RE)) { const id = Number(m[1]); if (!out.includes(id)) out.push(id); }
    return out;
  }

  /** Bilder im Text umschreiben: map alte Nummer → neue. */
  function rewriteAttachments(text, map) {
    if (!map || !map.size) return str(text);
    return str(text).replace(ATT_RE, (m, id) => (map.has(Number(id)) ? `(att:${map.get(Number(id))})` : m));
  }

  /** Bereich ganzer Zeilen (Index ab 0, beide eingeschlossen): { start, end } ohne den Zeilenumbruch am Schluss. */
  function rangeOfLines(body, from, to) {
    const text = str(body);
    const starts = [0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    const a = Math.max(0, Math.min(from, starts.length - 1));
    const b = Math.max(a, Math.min(to, starts.length - 1));
    return { start: starts[a], end: b + 1 < starts.length ? starts[b + 1] - 1 : text.length };
  }

  const leading = l => (/^[ \t]*/.exec(l) || [''])[0].replace(/\t/g, '    ').length;

  /** Gemeinsame Einrückung entfernen (eine ausgelagerte Unterliste beginnt im neuen Knoten links). */
  function dedent(lines) {
    const used = lines.filter(l => l.trim());
    if (!used.length) return lines.slice();
    const n = Math.min(...used.map(leading));
    if (!n) return lines.slice();
    return lines.map(l => {
      let cut = 0;
      let w = 0;
      while (cut < l.length && w < n && (l[cut] === ' ' || l[cut] === '\t')) { w += l[cut] === '\t' ? 4 : 1; cut++; }
      return l.slice(cut);
    });
  }

  /** Leerzeilen am Anfang und am Ende weg. */
  function trimBlank(lines) {
    let a = 0;
    let b = lines.length;
    while (a < b && !lines[a].trim()) a++;
    while (b > a && !lines[b - 1].trim()) b--;
    return lines.slice(a, b);
  }

  /** Plan für eine Auswahl [start, end) im Text: { start, end (bereinigt), lineMode, list, parts: [{ title, auto, heading (Ebene oder
   *  null), from, to (Zeilen ab 0), body (Text des Knotens), raw (Abschnitt samt Überschrift, für «zum vorigen Knoten»), source (wie im
   *  Text, für «bleibt»)}] } oder null, wenn die Auswahl nur Leerraum ist. */
  function plan(body, start, end) {
    const text = str(body);
    let s = Math.max(0, Math.min(Number(start) || 0, text.length));
    let e = Math.max(s, Math.min(Number(end) || 0, text.length));
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (s >= e) return null;
    const ls = lineStart(text, s);
    const lineMode = text.slice(ls, s).trim() === '';
    if (lineMode) {
      s = ls;
      const le = lineEnd(text, e);
      if (text.slice(e, le).trim() === '') e = le;
    }
    const selected = text.slice(s, e);
    const first = lineIndex(text, s);
    if (!lineMode) {
      const title = firstSentence(selected);
      const part = { title, auto: true, heading: null, from: first, to: first + selected.split('\n').length - 1, body: selected, raw: selected, source: selected };
      return { start: s, end: e, lineMode, list: null, parts: [part] };
    }
    const lines = selected.split('\n');
    const mask = codeMask(text.split('\n')).slice(first, first + lines.length);
    const plainLines = dedent(lines);
    const heads = [];
    lines.forEach((l, k) => {
      if (mask[k]) return;
      const m = HEADING_RE.exec(l);
      if (m) heads.push({ k, level: m[1].length, text: m[2] });
    });
    const headAt = new Map(heads.map(h => [h.k, h]));
    const makePart = (a, b) => {
      const own = lines.slice(a, b);
      const ded = plainLines.slice(a, b);
      let f = 0;
      while (f < own.length && !own[f].trim()) f++;
      const h = headAt.get(a + f);
      const title = h ? plain(h.text) : '';
      const bodyLines = h && title ? ded.slice(f + 1) : ded;
      return {
        title: title || firstSentence(ded.join('\n')), auto: !(h && title), heading: h && title ? h.level : null,
        from: first + a, to: first + b - 1,
        body: trimBlank(bodyLines).join('\n'), raw: trimBlank(ded).join('\n'), source: trimBlank(own).join('\n'),
      };
    };
    const parts = [];
    if (!heads.length) parts.push(makePart(0, lines.length));
    else {
      const top = Math.min(...heads.map(h => h.level));
      const cuts = heads.filter(h => h.level === top).map(h => h.k);
      if (cuts[0] > 0 && lines.slice(0, cuts[0]).some(l => l.trim())) parts.push(makePart(0, cuts[0]));
      cuts.forEach((k, j) => parts.push(makePart(k, j + 1 < cuts.length ? cuts[j + 1] : lines.length)));
    }
    const lm = headAt.has(0) ? null : LIST_RE.exec(lines[0]);
    const list = lm ? { indent: lm[1], bullet: lm[3] ? null : lm[2], number: lm[3] ? Number(lm[3]) : null, delim: lm[4] || null } : null;
    return { start: s, end: e, lineMode, list, parts };
  }

  /** Die Knoten nach der Wahl (chosen[i] === false: Abschnitt i ist kein eigener Knoten): { nodes: [{ part, title, auto, body }], kept:
   *  [Text, der in der Eltern-Notiz bleibt] } oder null, wenn kein Abschnitt gewählt ist. */
  function build(p, chosen) {
    if (!p) return null;
    const pick = i => !chosen || chosen[i] !== false;
    const nodes = [];
    const kept = [];
    p.parts.forEach((part, i) => {
      if (pick(i)) nodes.push({ part: i, title: part.title, auto: part.auto, body: part.body });
      else if (nodes.length) { const n = nodes[nodes.length - 1]; n.body = n.body ? `${n.body}\n\n${part.raw}` : part.raw; }
      else kept.push(part.source);
    });
    return nodes.length ? { nodes, kept } : null;
  }

  /** Ersatz für die Auswahl: der Verweis (mehrere als Liste; beginnt die Auswahl mit einem Listenpunkt, bleibt dessen Einrückung und
   *  Zeichen), davor der Text, der in der Eltern-Notiz bleibt. titles[i]: Titel des Knotens i, ids[i]: seine Nummer. */
  function replacement(p, built, ids, titles) {
    const links = built.nodes.map((n, i) => link(titles ? titles[i] : n.title, ids[i]));
    const prefix = i => {
      const l = p.list;
      if (!l) return '- ';
      return l.indent + (l.number != null ? `${l.number + i}${l.delim}` : l.bullet) + ' ';
    };
    let out;
    if (!p.lineMode || (links.length === 1 && !p.list)) out = links[0];
    else out = links.map((x, i) => prefix(i) + x).join('\n');
    if (built.kept.length) out = `${built.kept.join('\n\n')}\n\n${out}`;
    return out;
  }

  /** Neuer Text der Eltern-Notiz: die Auswahl durch den Ersatz ersetzt. */
  function splice(body, p, text) {
    const b = str(body);
    return b.slice(0, p.start) + text + b.slice(p.end);
  }

  // ---------- Schritte über das Backend ----------

  /** Legt die Knoten als Unternotizen von noteId an (am Ende, in dieser Reihenfolge) und kopiert die Bilder der Eltern-Notiz, die ihr
   *  Text braucht. opts: { author, fallbackTitle (Titel, wenn der Text keine Wörter hat) }. Gibt { ids, titles, moved: [{ from, to,
   *  note }] }; schlägt ein Schritt fehl, kommen die schon angelegten Knoten weg und der Fehler geht weiter. */
  async function createNodes(B, noteId, built, opts) {
    const o = opts || {};
    const own = new Set((await B.listAttachments(noteId)).map(a => a.id));
    const ids = [];
    const titles = [];
    const moved = [];
    try {
      for (const n of built.nodes) {
        const id = await B.createNote(noteId);
        ids.push(id);
        const map = new Map();
        for (const ref of attachmentRefs(n.body)) {
          if (!own.has(ref)) continue;
          const a = await B.getAttachment(ref);
          if (!a || !a.data) continue;
          const copy = await B.addAttachment(id, { name: a.name, mime: a.mime, bytes: a.data });
          map.set(ref, copy);
          moved.push({ from: ref, to: copy, note: id });
        }
        const title = str(n.title).trim() || str(o.fallbackTitle).trim();
        titles.push(title);
        await B.updateNote(id, title, rewriteAttachments(n.body, map), { author: o.author });
      }
    } catch (e) {
      for (const id of ids) { try { await B.deleteNote(id); await B.purgeNote(id); } catch (x) { /* weiter aufräumen */ } }
      throw e;
    }
    return { ids, titles, moved };
  }

  /** Entfernt die Bilder der Eltern-Notiz, die nur der ausgelagerte Text brauchte (parentBody: ihr neuer Text). Gibt ihre Nummern. */
  async function dropUnused(B, noteId, parentBody, moved) {
    const still = new Set(attachmentRefs(parentBody));
    const removed = [];
    for (const from of new Set((moved || []).map(m => m.from))) {
      if (still.has(from)) continue;
      await B.deleteAttachment(from);
      removed.push(from);
    }
    return removed;
  }

  /** Stelle des Ersatzes im heutigen Text: an der alten Stelle oder, wenn er genau einmal vorkommt, dort; sonst -1. */
  function findReplacement(body, rec) {
    const b = str(body);
    if (b.slice(rec.start, rec.start + rec.replacement.length) === rec.replacement) return rec.start;
    const i = b.indexOf(rec.replacement);
    return i >= 0 && b.indexOf(rec.replacement, i + 1) < 0 ? i : -1;
  }

  /** Rückgängig: rec = { start, original, replacement, ids, moved, removed }. Holt entfernte Bilder (aus den Kopien) an die Eltern-Notiz
   *  zurück und legt die neuen Knoten in den Papierkorb. Gibt { body (Text der Eltern-Notiz mit dem ursprünglichen Text), start, end }
   *  oder null, wenn der Ersatz nicht mehr so im Text steht (dann bleibt alles, wie es ist). */
  async function undo(B, noteId, body, rec) {
    const at = findReplacement(body, rec);
    if (at < 0) return null;
    const map = new Map();
    for (const from of rec.removed || []) {
      const m = (rec.moved || []).find(x => x.from === from);
      const a = m ? await B.getAttachment(m.to).catch(() => null) : null;
      if (a && a.data) map.set(from, await B.addAttachment(noteId, { name: a.name, mime: a.mime, bytes: a.data }));
    }
    const original = rewriteAttachments(rec.original, map);
    for (const id of rec.ids) { try { await B.deleteNote(id); } catch (e) { /* schon weg */ } }
    const b = str(body);
    return { body: b.slice(0, at) + original + b.slice(at + rec.replacement.length), start: at, end: at + original.length };
  }

  global.NoNotesExtract = {
    TITLE_MAX, plan, build, replacement, splice, firstSentence, plain, label, link, attachmentRefs, rewriteAttachments, rangeOfLines,
    createNodes, dropUnused, findReplacement, undo,
  };
})(window);
