/* NoNotes – Aufgaben im Notiztext.
   Syntax: Markdown-Checkbox "- [ ] Text" (offen) bzw. "- [x] Text" (erledigt), optional mit
   Fälligkeit am Zeilenende: "@15.10.2026" oder "@2026-10-15" (siehe js/dates.js). Der Text
   bleibt die einzige Wahrheit; die Tabelle "tasks" ist ein Index darüber. */
(function (global) {
  'use strict';

  const TASK_RE = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
  const D = () => global.NoNotesDates;

  function normalize(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Alle Aufgaben eines Notiztexts. */
  function parse(body) {
    const lines = (body || '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const m = TASK_RE.exec(lines[i]);
      if (!m) continue;
      const { text, due } = D().splitDue(m[4]);
      if (!text) continue;
      out.push({ text, norm: normalize(text), done: m[3] !== ' ', due, lineIndex: i });
    }
    return out;
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

  global.NoNotesTasks = { parse, setDone, locate, splitDue, normalize, todayIso, formatDue, urgency, TASK_RE };
})(window);
