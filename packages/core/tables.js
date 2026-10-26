/* NoNotes – Tabellen (v2.10.0). Markdown-Tabellen wie bei GitHub: Zeilen beginnen mit «|», unter der Kopfzeile steht die
   Trennzeile («|---|:---:|», Doppelpunkte richten die Spalte aus). Eine leere Kopfzeile heisst: keine Titelzeile. Eine Zeile
   «<!-- tabelle: {…} -->» direkt über der Tabelle trägt ihr Format als JSON; andere Markdown-Programme blenden sie aus.
   Der Kern kennt «kopfspalte» (erste Spalte als Titel) und «hervorheben» (Titel im Ton der Hauptfarbe); Erweiterungen legen
   ihre Angaben unter ihrer Kennung ab (docs/PLUGINS.md). Was dort in «rows», «cols» und «cells» steht (Schlüssel «2», «h»
   für die Titelzeile, «2,1»), wandert beim Einfügen und Löschen von Zeilen und Spalten mit.
   Reine Funktionen ohne Datenzugriff: lesen (splitRow, parseAt, at), schreiben (format, insert) und die Schritte des Editors
   (Feld wechseln, Zeile anfügen, Zeilen und Spalten einfügen oder löschen, Titelzeile, Format). Jeder Schritt richtet die
   senkrechten Striche neu aus und liefert { text, selStart, selEnd } wie packages/core/editing.js. */
(function (global) {
  'use strict';

  const META_RE = /^\s{0,3}<!--\s*(?:tabelle|table)\s*:\s*(\{.*\})\s*-->\s*$/i;
  const ROW_RE = /^\s{0,3}\|/;
  const DELIM_RE = /^\s*:?-+:?\s*$/;

  /** Felder einer Zeile «| a | b |» → ['a', 'b'] (getrimmt, Text wie geschrieben); «\|» trennt nicht. */
  function splitRow(line) {
    let s = String(line).trim();
    if (s.startsWith('|')) s = s.slice(1);
    const cells = [];
    let cur = '', ended = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; ended = false; continue; }
      if (ch === '|') { cells.push(cur.trim()); cur = ''; ended = true; continue; }
      cur += ch;
      if (!/\s/.test(ch)) ended = false;
    }
    if (!ended || cur.trim()) cells.push(cur.trim());
    return cells;
  }

  const isRow = line => ROW_RE.test(String(line || ''));
  const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
  const BLOCK_OPEN_RE = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\?!?\s?```/;

  /** Steht Zeile L in einem Codeblock («```»/«~~~»)? Dort ist «|» nur Text. Blöcke «?!``` …» bis «```» sind kein Code. */
  function inCode(lines, L) {
    let fence = null, block = false;
    for (let k = 0; k < L; k++) {
      const s = lines[k];
      const m = FENCE_RE.exec(s);
      if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = null; continue; }
      if (BLOCK_OPEN_RE.test(s)) { block = true; continue; }
      if (block && /^\s*```\s*$/.test(s)) { block = false; continue; }
      if (m) fence = m[1];
    }
    return !!fence;
  }
  function isDelimiter(line) {
    if (!isRow(line)) return false;
    const cells = splitRow(line);
    return cells.length > 0 && cells.every(c => DELIM_RE.test(c));
  }
  const alignOf = c => { const l = c.startsWith(':'), r = c.endsWith(':'); return l && r ? 'center' : r ? 'right' : l ? 'left' : null; };

  /** Format aus der Zeile «<!-- tabelle: {…} -->» (oder null, wenn die Zeile keine gültige ist). */
  function readMeta(line) {
    const m = META_RE.exec(String(line || ''));
    if (!m) return null;
    try {
      const v = JSON.parse(m[1]);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch (e) { return null; }
  }

  /** Tabelle mit der Kopfzeile in lines[i]: { start (erste Zeile, mit Format-Zeile), head, end (exklusiv), meta, metaLine,
   *  header (Felder oder null bei leerer Kopfzeile), align, rows, cols } oder null. */
  function parseAt(lines, i) {
    if (!isRow(lines[i]) || !isDelimiter(lines[i + 1])) return null;
    const head = splitRow(lines[i]);
    const delim = splitRow(lines[i + 1]);
    if (head.length !== delim.length) return null;
    const cols = delim.length;
    const fit = cells => { const c = cells.slice(0, cols); while (c.length < cols) c.push(''); return c; };
    const rows = [];
    let j = i + 2;
    while (j < lines.length && isRow(lines[j]) && !isDelimiter(lines[j])) rows.push(fit(splitRow(lines[j++])));
    const meta = i > 0 ? readMeta(lines[i - 1]) : null;
    return {
      start: meta ? i - 1 : i, head: i, end: j, meta: meta || {}, metaLine: meta ? i - 1 : -1,
      header: head.every(c => !c) ? null : head, align: delim.map(alignOf), rows, cols,
    };
  }

  const width = s => Array.from(String(s)).length;
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));

  /** Text einer Tabelle, ausgerichtet: { lines, cell(r, c) } mit r = -1 für die Kopfzeile; cell liefert { line, from, to }
   *  (Zeile in lines, Anfang und Ende des Feldinhalts in dieser Zeile). */
  function format(t) {
    const cols = t.cols;
    const head = t.header || new Array(cols).fill('');
    const w = [];
    for (let c = 0; c < cols; c++) w[c] = Math.max(3, width(head[c] || ''), ...t.rows.map(r => width(r[c] || '')));
    const row = cells => '| ' + cells.map((x, c) => pad(x || '', w[c])).join(' | ') + ' |';
    const dash = (n, a) => (a === 'center' ? ':' + '-'.repeat(n - 2) + ':' : a === 'right' ? '-'.repeat(n - 1) + ':' : a === 'left' ? ':' + '-'.repeat(n - 1) : '-'.repeat(n));
    const keys = Object.keys(t.meta || {});
    const lines = [];
    if (keys.length) lines.push(`<!-- tabelle: ${JSON.stringify(t.meta)} -->`);
    const first = lines.length;
    lines.push(row(head), '| ' + w.map((n, c) => dash(n, t.align[c])).join(' | ') + ' |', ...t.rows.map(row));
    const cell = (r, c) => {
      const cells = r < 0 ? head : t.rows[r];
      let from = 2;
      for (let k = 0; k < c; k++) from += w[k] + 3;
      return { line: first + (r < 0 ? 0 : 2 + r), from, to: from + width(cells[c] || '') };
    };
    return { lines, cell };
  }

  // ---------- Text und Positionen ----------

  function linesOf(text) { return String(text).split('\n'); }
  function offsets(lines) { const o = []; let p = 0; for (const l of lines) { o.push(p); p += l.length + 1; } return o; }
  function lineAt(starts, pos) { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= pos) k++; return k; }

  /** Tabelle, die in Zeile line (0-basiert) beginnt: mit der Format-Zeile oder, ohne sie, mit der Kopfzeile. Oder null.
   *  Diese erste Zeile bleibt, wo sie ist, wenn das Format dazukommt oder wegfällt. */
  function tableAtLine(text, line) {
    const lines = linesOf(text);
    const t = readMeta(lines[line]) ? parseAt(lines, line + 1) : parseAt(lines, line);
    return t ? { lines, t } : null;
  }

  // ---------- Angaben der Erweiterungen je Zeile, Spalte und Feld ----------

  const isMap = v => v && typeof v === 'object' && !Array.isArray(v);
  const CELL_KEY = /^(\d+|h),(\d+)$/;
  function rekey(obj, fn) {
    if (!isMap(obj)) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) { const nk = fn(k); if (nk != null) out[nk] = v; }
    return out;
  }
  function eachPluginMeta(meta, fn) { for (const v of Object.values(meta || {})) if (isMap(v)) fn(v); }

  /** Zeilen (kind 'row') oder Spalten ('col') ab Nummer at um delta verschieben; mit delta < 0 fällt at weg. */
  function shift(meta, kind, at, delta) {
    const idx = k => {
      if (!/^\d+$/.test(k)) return k;
      const n = Number(k);
      if (n < at) return k;
      return delta < 0 && n === at ? null : String(n + delta);
    };
    eachPluginMeta(meta, ns => {
      if (kind === 'row') ns.rows = rekey(ns.rows, idx);
      else ns.cols = rekey(ns.cols, idx);
      ns.cells = rekey(ns.cells, k => {
        const m = CELL_KEY.exec(k);
        if (!m) return k;
        const r = kind === 'row' ? idx(m[1]) : m[1], c = kind === 'col' ? idx(m[2]) : m[2];
        return r == null || c == null ? null : `${r},${c}`;
      });
    });
  }

  /** Titelzeile aus (on false: «h» wird zu Zeile 0, die anderen rücken nach) oder an (Zeile 0 wird zu «h»). */
  function swapHeader(meta, on) {
    if (!on) shift(meta, 'row', 0, 1);
    const from = on ? '0' : 'h', to = on ? 'h' : '0';
    eachPluginMeta(meta, ns => {
      ns.rows = rekey(ns.rows, k => (k === from ? to : k === to ? null : k));
      ns.cells = rekey(ns.cells, k => { const m = CELL_KEY.exec(k); return !m ? k : m[1] === from ? `${to},${m[2]}` : m[1] === to ? null : k; });
    });
    if (on) shift(meta, 'row', 0, -1); // «0» ist schon «h», die übrigen rücken auf
  }

  /** Tabelle am Cursor: { lines, t, row (-1 Kopf, -2 Trennzeile, 0.. Zeile), col } oder null. */
  function at(text, pos) {
    const lines = linesOf(text);
    const starts = offsets(lines);
    const L = lineAt(starts, pos);
    if (!isRow(lines[L]) || inCode(lines, L)) return null;
    let h = L;
    while (h > 0 && isRow(lines[h - 1])) h--;
    let t = parseAt(lines, h);
    // mehrere Tabellen ohne Leerzeile dazwischen: die passende suchen
    while (t && L >= t.end) t = parseAt(lines, t.end);
    if (!t || L < t.head) return null;
    const row = L === t.head ? -1 : L === t.head + 1 ? -2 : L - t.head - 2;
    const before = lines[L].slice(0, pos - starts[L]);
    const seps = (before.match(/(?<!\\)\|/g) || []).length;
    const col = Math.max(0, Math.min(t.cols - 1, seps - 1));
    return { lines, t, row, col };
  }

  /** Ersetzt die Tabelle t in lines durch ihren neuen Stand und setzt die Auswahl ins Feld (r, c), ganz (select) oder an den Anfang. */
  function replace(lines, t, r, c, select) {
    const f = format(t);
    const out = [...lines.slice(0, t.start), ...f.lines, ...lines.slice(t.end)];
    const starts = offsets(out);
    const pos = f.cell(r, c);
    const base = starts[t.start + pos.line];
    return { text: out.join('\n'), selStart: base + pos.from, selEnd: base + (select ? pos.to : pos.from) };
  }

  const emptyRow = t => new Array(t.cols).fill('');
  const copy = t => Object.assign({}, t, { meta: JSON.parse(JSON.stringify(t.meta || {})), header: t.header && t.header.slice(), align: t.align.slice(), rows: t.rows.map(r => r.slice()) });

  // ---------- Schritte im Editor ----------

  /** Tab (dir 1) und Umschalt+Tab (dir -1): ins nächste oder vorige Feld, Inhalt markiert. Hinter dem letzten Feld kommt eine
   *  neue Zeile dazu. Ohne Titelzeile wird die (leere) Kopfzeile übersprungen. null ausserhalb einer Tabelle. */
  function move(text, pos, dir) {
    const a = at(text, pos);
    if (!a) return null;
    const t = copy(a.t);
    const order = [];
    if (t.header) for (let c = 0; c < t.cols; c++) order.push([-1, c]);
    for (let r = 0; r < t.rows.length; r++) for (let c = 0; c < t.cols; c++) order.push([r, c]);
    const row = a.row === -2 ? -1 : a.row; // in der Trennzeile wie im Kopf
    let k = order.findIndex(([r, c]) => r === row && c === a.col);
    if (k < 0) k = dir > 0 ? -1 : 0;
    let next = k + dir;
    if (next >= order.length) { t.rows.push(emptyRow(t)); return replace(a.lines, t, t.rows.length - 1, 0, false); }
    if (next < 0) next = 0;
    const [r, c] = order[next];
    return replace(a.lines, t, r, c, true);
  }

  /** Enter in einer Tabelle: neue leere Zeile unter der aktuellen (in der Kopf- oder Trennzeile als erste Zeile). In einer leeren
   *  letzten Zeile endet die Tabelle: die Zeile verschwindet, der Cursor steht eine Leerzeile tiefer. Die Leerzeile braucht es, sonst
   *  wäre der nächste Text nach GitHub-Markdown eine weitere Zeile der Tabelle; folgt Text, steht auch vor ihm eine. */
  function enter(text, pos) {
    const a = at(text, pos);
    if (!a) return null;
    const t = copy(a.t);
    const last = t.rows.length - 1;
    if (a.row >= 0 && a.row === last && t.rows[last].every(x => !x)) {
      t.rows.pop();
      shift(t.meta, 'row', last, -1);
      const f = format(t);
      const after = a.lines.slice(a.t.end);
      let k = 0;
      while (k < after.length && !after[k].trim()) k++;
      const need = k < after.length ? 3 : 2; // Leerzeile, Zeile für den Cursor, (Leerzeile vor dem Text)
      const blanks = after.slice(0, k).concat(new Array(Math.max(0, need - k)).fill(''));
      const out = [...a.lines.slice(0, a.t.start), ...f.lines, ...blanks, ...after.slice(k)];
      const caret = offsets(out)[a.t.start + f.lines.length + 1];
      return { text: out.join('\n'), selStart: caret, selEnd: caret };
    }
    const at0 = a.row < 0 ? 0 : a.row + 1;
    t.rows.splice(at0, 0, emptyRow(t));
    shift(t.meta, 'row', at0, 1);
    return replace(a.lines, t, at0, 0, false);
  }

  /** Neue Tabelle an Stelle der Markierung: cols Spalten, rows Zeilen insgesamt (mit Titelzeile ist die erste davon der Kopf).
   *  options: { header (Titelzeile), headerColumn (Titelspalte), label(n) für die Spaltentitel }. Leerzeilen davor und danach,
   *  der erste Titel ist markiert (ohne Titelzeile steht der Cursor im ersten Feld). */
  function insert(text, s, e, cols, rows, options) {
    const o = options || {};
    cols = Math.max(1, Math.min(20, cols | 0));
    rows = Math.max(1, Math.min(50, rows | 0));
    const label = typeof o.label === 'function' ? o.label : n => `Spalte ${n}`; // i18n-ignore: Vorgabe, die App übergibt die Übersetzung
    const t = {
      meta: o.headerColumn ? { kopfspalte: true } : {}, cols, align: new Array(cols).fill(null),
      header: o.header === false ? null : Array.from({ length: cols }, (_, c) => label(c + 1)),
    };
    t.rows = Array.from({ length: o.header === false ? rows : Math.max(0, rows - 1) }, () => new Array(cols).fill(''));
    if (!t.header && !t.rows.length) t.rows.push(new Array(cols).fill(''));
    const f = format(t);
    const before = text.slice(0, s), after = text.slice(e);
    const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const block = f.lines.join('\n');
    const base = s + pre.length;
    const lineStarts = offsets(f.lines);
    const pos = f.cell(t.header ? -1 : 0, 0);
    const from = base + lineStarts[pos.line] + pos.from, to = base + lineStarts[pos.line] + pos.to;
    return { text: before + pre + block + post + after, selStart: from, selEnd: t.header ? to : from };
  }

  // ---------- Schritte per Rechtsklick in der Vorschau (line = erste Zeile der Tabelle, siehe tableAtLine) ----------

  /** Wendet fn(t) auf die Tabelle an, die in Zeile line beginnt; fn ändert t und liefert das Feld [r, c] für den Cursor (oder
   *  nichts: der Cursor bleibt, wo er war, verschoben um die Längenänderung, wenn er hinter der Tabelle stand). */
  function change(text, line, fn, caret) {
    const found = tableAtLine(text, line);
    if (!found) return null;
    const t = copy(found.t);
    const target = fn(t);
    if (target) return replace(found.lines, t, target[0], target[1], false);
    const f = format(t);
    const out = [...found.lines.slice(0, found.t.start), ...f.lines, ...found.lines.slice(found.t.end)];
    const result = out.join('\n');
    const starts = offsets(found.lines);
    const tableStart = starts[found.t.start];
    const tableEnd = found.t.end < found.lines.length ? starts[found.t.end] : text.length;
    let pos = caret == null ? tableStart : caret;
    if (pos >= tableEnd) pos += result.length - text.length;
    else if (pos > tableStart) pos = tableStart;
    return { text: result, selStart: pos, selEnd: pos };
  }

  /** Format der Tabelle ändern: fn(meta) ändert das Objekt (oder liefert ein neues). Leere Angaben fallen weg. */
  function setMeta(text, line, fn, caret) {
    return change(text, line, t => {
      const next = fn(t.meta);
      t.meta = next && typeof next === 'object' && !Array.isArray(next) ? next : t.meta;
      for (const k of Object.keys(t.meta)) if (t.meta[k] == null || t.meta[k] === false) delete t.meta[k];
      return null;
    }, caret);
  }

  /** Titelzeile ein (die erste Zeile wird zum Kopf; ohne Zeilen Spaltentitel) oder aus (der Kopf wird zur ersten Zeile). */
  function toggleHeader(text, line, label, caret) {
    return change(text, line, t => {
      if (t.header) { t.rows.unshift(t.header); t.header = null; }
      else if (t.rows.length) t.header = t.rows.shift().map((x, c) => x || (label ? label(c + 1) : ''));
      else t.header = Array.from({ length: t.cols }, (_, c) => (label ? label(c + 1) : `Spalte ${c + 1}`)); // i18n-ignore: Vorgabe
      swapHeader(t.meta, !!t.header);
      return null;
    }, caret);
  }

  /** Zeile einfügen über (where 'above') oder unter ('below') der Zeile r (-1 = Kopf: als erste Zeile). Cursor ins neue Feld. */
  function insertRow(text, line, r, where) {
    return change(text, line, t => {
      const i = r < 0 ? 0 : where === 'above' ? r : r + 1;
      t.rows.splice(i, 0, emptyRow(t));
      shift(t.meta, 'row', i, 1);
      return [i, 0];
    });
  }

  function deleteRow(text, line, r, caret) {
    return change(text, line, t => {
      if (r >= 0 && r < t.rows.length) { t.rows.splice(r, 1); shift(t.meta, 'row', r, -1); }
      return null;
    }, caret);
  }

  /** Spalte links ('left') oder rechts ('right') von Spalte c einfügen; Cursor in den Titel der neuen Spalte (oder ins erste Feld). */
  function insertColumn(text, line, c, where, label) {
    return change(text, line, t => {
      const i = where === 'left' ? c : c + 1;
      if (t.header) t.header.splice(i, 0, label ? label(i + 1) : '');
      t.align.splice(i, 0, null);
      for (const row of t.rows) row.splice(i, 0, '');
      t.cols++;
      shift(t.meta, 'col', i, 1);
      return t.header ? [-1, i] : t.rows.length ? [0, i] : null;
    });
  }

  function deleteColumn(text, line, c, caret) {
    return change(text, line, t => {
      if (t.cols <= 1 || c < 0 || c >= t.cols) return null;
      if (t.header) t.header.splice(c, 1);
      t.align.splice(c, 1);
      for (const row of t.rows) row.splice(c, 1);
      t.cols--;
      shift(t.meta, 'col', c, -1);
      return null;
    }, caret);
  }

  global.NoNotesTables = {
    META_RE, splitRow, isRow, isDelimiter, inCode, readMeta, parseAt, format, at, tableAtLine, shift, swapHeader,
    move, enter, insert, setMeta, toggleHeader, insertRow, deleteRow, insertColumn, deleteColumn,
  };
})(window);
