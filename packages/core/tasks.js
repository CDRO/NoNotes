/* NoNotes – Aufgaben im Notiztext.
   Syntax: Markdown-Checkbox "- [ ] Text" (offen) bzw. "- [x] Text" (erledigt), optional mit
   Fälligkeit am Zeilenende: "@15.10.2026" oder "@2026-10-15" (siehe js/dates.js). Der Text
   bleibt die einzige Wahrheit; die Tabelle "tasks" ist ein Index darüber.
   Unteraufgaben: Eine Checkbox-Zeile, die tiefer eingerückt direkt unter einer Aufgabe steht, gehört
   zu ihr (beliebig tief). Eine Zeile ohne Kästchen, die nicht tiefer eingerückt ist, beendet den
   Teilbaum; Leerzeilen und tiefer eingerückter Text tun das nicht. Eine Aufgabe lässt sich erst
   abschliessen, wenn alle Unteraufgaben erledigt sind. */
(function (global) {
  'use strict';

  const TASK_RE = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
  const D = () => global.NoNotesDates;

  function normalize(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Breite der Einrückung; ein Tabulator zählt vier. */
  function indentOf(ws) {
    let n = 0;
    for (const c of ws) n += c === '\t' ? 4 : 1;
    return n;
  }

  /** Alle Aufgaben eines Notiztexts, mit Einrückung, Tiefe und Verweis auf die Hauptaufgabe
   *  (parent = Index in der Ergebnisliste, -1 ohne Hauptaufgabe). */
  function parse(body) {
    const lines = (body || '').split('\n');
    const out = [];
    const stack = []; // offene Hauptaufgaben: { indent, index }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = TASK_RE.exec(line);
      const indent = indentOf(m ? m[1] : /^\s*/.exec(line)[0]);
      if (!m || !D().splitDue(m[4]).text) {
        if (line.trim()) while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        continue;
      }
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const { text, due } = D().splitDue(m[4]);
      out.push({ text, norm: normalize(text), done: m[3] !== ' ', due, lineIndex: i, indent, parent: stack.length ? stack[stack.length - 1].index : -1, depth: stack.length });
      stack.push({ indent, index: out.length - 1 });
    }
    return out;
  }

  /** Indizes aller Unteraufgaben (jeder Tiefe) der Aufgabe an Position idx in der Ergebnisliste von parse. */
  function descendantIndexes(parsed, idx) {
    const found = [];
    for (let k = idx + 1; k < parsed.length; k++) {
      let p = parsed[k].parent;
      while (p > idx) p = parsed[p].parent;
      if (p !== idx) break; // der Teilbaum ist zusammenhängend
      found.push(k);
    }
    return found;
  }

  /** Indizes aller übergeordneten Aufgaben, von der nächsten bis zur obersten. */
  function ancestorIndexes(parsed, idx) {
    const found = [];
    for (let p = parsed[idx].parent; p >= 0; p = parsed[p].parent) found.push(p);
    return found;
  }

  function indexOfLine(parsed, lineIndex) {
    return parsed.findIndex(t => t.lineIndex === lineIndex);
  }

  /** Hinweistext, wenn eine Aufgabe wegen offener Unteraufgaben nicht abgeschlossen werden kann. */
  function openMessage(n) {
    return `${n} ${n === 1 ? 'Unteraufgabe ist' : 'Unteraufgaben sind'} noch offen`;
  }

  /** Anzahl noch offener Unteraufgaben der Aufgabe in dieser Zeile. */
  function openSubtasks(body, lineIndex) {
    const parsed = parse(body);
    const idx = indexOfLine(parsed, lineIndex);
    if (idx < 0) return 0;
    return descendantIndexes(parsed, idx).filter(k => !parsed[k].done).length;
  }

  function setLines(body, lineIndexes, done) {
    const lines = (body || '').split('\n');
    for (const li of lineIndexes) {
      const line = lines[li];
      if (line != null && TASK_RE.test(line)) lines[li] = line.replace(/\[([ xX])\]/, done ? '[x]' : '[ ]');
    }
    return lines.join('\n');
  }

  /** Schliesst die Aufgabe und alle ihre Unteraufgaben ab. */
  function completeTree(body, lineIndex) {
    const parsed = parse(body);
    const idx = indexOfLine(parsed, lineIndex);
    if (idx < 0) return body;
    return setLines(body, [lineIndex, ...descendantIndexes(parsed, idx).map(k => parsed[k].lineIndex)], true);
  }

  /** Öffnet die Aufgabe wieder und mit ihr alle erledigten übergeordneten Aufgaben. Unteraufgaben bleiben. */
  function reopen(body, lineIndex) {
    const parsed = parse(body);
    const idx = indexOfLine(parsed, lineIndex);
    if (idx < 0) return body;
    return setLines(body, [lineIndex, ...ancestorIndexes(parsed, idx).map(k => parsed[k].lineIndex)], false);
  }

  /** Doppelklick: Ist im Teilbaum etwas offen, wird alles abgeschlossen, sonst die Aufgabe wieder geöffnet.
   *  Gibt { body, action: 'completed' | 'reopened' } zurück. */
  function doubleClick(body, lineIndex) {
    const parsed = parse(body);
    const idx = indexOfLine(parsed, lineIndex);
    if (idx < 0) return { body, action: null };
    const anythingOpen = !parsed[idx].done || descendantIndexes(parsed, idx).some(k => !parsed[k].done);
    return anythingOpen ? { body: completeTree(body, lineIndex), action: 'completed' } : { body: reopen(body, lineIndex), action: 'reopened' };
  }

  /** Setzt das Kästchen einer Zeile auf erledigt/offen. */
  function setDone(body, lineIndex, done) {
    const lines = (body || '').split('\n');
    const line = lines[lineIndex];
    if (line == null) return body;
    if (!TASK_RE.test(line)) return body;
    lines[lineIndex] = line.replace(/\[([ xX])\]/, done ? '[x]' : '[ ]');
    return lines.join('\n');
  }

  /** Findet die Aufgabe zu einem Indexeintrag: zuerst über die Zeile, sonst über den Text. */
  function locate(body, row) {
    const parsed = parse(body);
    let t = parsed.find(p => p.lineIndex === row.line_no && p.norm === row.norm);
    if (!t) t = parsed.find(p => p.norm === row.norm);
    return t || null;
  }

  const splitDue = raw => D().splitDue(raw);
  const todayIso = () => D().todayIso();
  const formatDue = iso => D().formatDue(iso);
  const urgency = (iso, today) => D().urgency(iso, today);

  global.NoNotesTasks = {
    parse, setDone, locate, splitDue, normalize, todayIso, formatDue, urgency, TASK_RE,
    descendantIndexes, ancestorIndexes, openSubtasks, openMessage, completeTree, reopen, doubleClick,
  };
})(window);
