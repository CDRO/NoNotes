/* NoNotes – Aufgaben im Notiztext.
   Syntax: Markdown-Checkbox "- [ ] Text" (offen) bzw. "- [x] Text" (erledigt), optional mit
   Fälligkeit am Zeilenende: "@15.10.2026" oder "@2026-10-15". Der Text bleibt die einzige
   Wahrheit; die Tabelle "tasks" ist ein Index darüber. */
(function (global) {
  'use strict';

  const TASK_RE = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
  const DUE_RE = /\s*@(?:(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2}))\s*$/;

  function normalize(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Zerlegt eine Aufgabenzeile in Text und Fälligkeit (ISO-Datum oder null). */
  function splitDue(raw) {
    const m = DUE_RE.exec(raw);
    if (!m) return { text: raw.trim(), due: null };
    let y, mo, d;
    if (m[1]) { d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]); }
    else { y = Number(m[4]); mo = Number(m[5]); d = Number(m[6]); }
    const valid = mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
    return { text: raw.slice(0, m.index).trim(), due: valid ? `${y}-${pad(mo)}-${pad(d)}` : null };
  }

  /** Alle Aufgaben eines Notiztexts. */
  function parse(body) {
    const lines = (body || '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const m = TASK_RE.exec(lines[i]);
      if (!m) continue;
      const { text, due } = splitDue(m[4]);
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
    const m = TASK_RE.exec(line);
    if (!m) return body;
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

  /** Heutiges Datum als ISO (lokale Zeit). */
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Datum ISO → "15.10.2026". */
  function formatDue(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : '';
  }

  /** Dringlichkeit einer Fälligkeit: 'overdue' | 'today' | 'week' | 'later' | 'none'. */
  function urgency(iso, today) {
    if (!iso) return 'none';
    const t = today || todayIso();
    if (iso < t) return 'overdue';
    if (iso === t) return 'today';
    const d = new Date(t + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    const week = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return iso <= week ? 'week' : 'later';
  }

  global.NoNotesTasks = { parse, setDone, locate, splitDue, normalize, todayIso, formatDue, urgency, TASK_RE };
})(window);
