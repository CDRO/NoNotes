/* NoNotes – Fragen, Entscheide und Antworten im Notiztext.
   Syntax: Eine Zeile, die mit "?" beginnt, ist eine Frage; eine Zeile, die mit "?!" beginnt, ein Entscheid. Dasselbe gilt in einer
   Liste ("- ?! Neues Tool kaufen?"). Beide dürfen am Zeilenende einen Termin tragen ("@15.10.2026", siehe dates.js). Direkt darauf
   folgende Zeilen, die mit "!" oder "!!" beginnen (auch eingerückt), sind die Antwort beziehungsweise der getroffene Entscheid; die
   Zeile mit dem Öffner bestimmt die Art, der Antwortmarker ist nachsichtig. Bei einem Entscheid darf die erste Antwortzeile mit dem
   Datum beginnen ("!! 14.10.2026: Variante B"): es gilt als Tag des Entscheids.
   Mehrzeilig (v2.4.0): "?!```" (oder "?```") öffnet einen Block, eine Zeile "```" schliesst ihn. Der Rest der Öffnerzeile ist der Titel
   (mit Personen und Termin wie sonst), ohne ihn die erste Zeile im Block; die übrigen Zeilen sind die Beschreibung (Markdown). Im Block
   stehen einzeilige Unter-Einträge ("?! …", "? …", auch in Listen) mit ihren eigenen Antworten; Blöcke im Block gibt es nicht. Die
   Antwort des Blocks folgt direkt nach "```". Code im Block steht zwischen "~~~" oder beginnt mit "```sprache".
   "@kürzel" im Titel nennt, wer antworten oder entscheiden soll, "(@kürzel)" eine Person, die wahlweise dabei ist.
   Der Text bleibt die einzige Wahrheit; die Tabelle "questions" ist nur ein Index darüber. */
(function (global) {
  'use strict';

  const QUESTION_RE = /^\s*\?(!?)\s?(.*)$/;                          // Gruppe 1: "!" → Entscheid
  const LIST_RE = /^(\s*)((?:[-*+]|\d+[.)])\s+)\?(!?)\s?(.*)$/;     // "- ?! Text", "1. ? Text"
  const BLOCK_RE = /^(\s*)\?(!?)\s?```(.*)$/;                       // "?!``` Titel" öffnet einen Block
  const CLOSE_RE = /^\s*```\s*$/;                                   // "```" allein schliesst ihn
  const FENCE_RE = /^\s*(```|~~~)/;
  const ANSWER_RE = /^\s*(?:!!|!(?!\[))\s?(.*)$/;                   // "![" ist ein Bild, keine Antwort
  const FENCED_TEXT_RE = /^`{3}/;                                   // "?!```" ist nie ein einzeiliger Eintrag
  // "@kürzel" am Wortanfang: Buchstabe zuerst, dann Buchstaben, Ziffern, "_", "-" und "." (kein Datum, keine Mailadresse)
  const PERSON_RE = /(^|[\s(])(\(?)@(\p{L}[\p{L}\p{N}_.-]*)(\)?)/gu;
  const LEAD_DATE_RE = /^\s*(?:(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2}))(?=$|\s|[:–—-])\s*(?:[:–—-]\s*)?/;

  function normalize(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function validDate(y, m, d) {
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1000;
  }

  /** Personen im Text: [{ handle, optional }], jede nur einmal (Gross-/Kleinschreibung egal), in Reihenfolge. */
  function people(text) {
    const out = [];
    const seen = new Set();
    for (const m of String(text || '').matchAll(PERSON_RE)) {
      const handle = m[3].replace(/[.-]+$/, ''); // Satzzeichen am Ende gehören nicht dazu
      if (!handle) continue;
      const key = handle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const optional = (m[1] === '(' || m[2] === '(') && m[4] === ')';
      out.push({ handle, optional });
    }
    return out;
  }

  /** Datum am Anfang der ersten Entscheidzeile: { decided: 'YYYY-MM-DD' | null, raw, text }. */
  function splitDecided(line) {
    const m = LEAD_DATE_RE.exec(line || '');
    if (m) {
      const y = Number(m[3] || m[4]);
      const mo = Number(m[2] || m[5]);
      const d = Number(m[1] || m[6]);
      if (validDate(y, mo, d)) {
        return { decided: `${y}-${pad(mo)}-${pad(d)}`, raw: m[0].trim().replace(/[\s:–—-]+$/, ''), text: line.slice(m[0].length) };
      }
    }
    return { decided: null, raw: null, text: line || '' };
  }

  /** Titel eines Eintrags: Text ohne Termin, Termin und genannte Personen. */
  function heading(kind, raw) {
    const D = global.NoNotesDates;
    const split = D ? D.splitDue(raw) : { text: String(raw).trim(), due: null };
    return { kind, text: split.text, due: split.due, people: people(split.text) };
  }

  /** Antwortzeilen ab Zeile j (höchstens bis limit, exklusiv): { lines, end }. */
  function readAnswers(lines, j, limit) {
    const out = [];
    while (j < limit) {
      const a = ANSWER_RE.exec(lines[j]);
      if (!a) break;
      out.push(a[1]);
      j++;
    }
    return { lines: out, end: j };
  }

  /** Antwort und Tag des Entscheids aus den Antwortzeilen. */
  function answerOf(kind, answerLines) {
    let decided = null;
    let decidedRaw = null;
    const rows = answerLines.slice();
    if (kind === 'decision' && rows.length) {
      const first = splitDecided(rows[0]);
      decided = first.decided;
      decidedRaw = first.raw;
      rows[0] = first.text;
    }
    const answer = rows.map(l => l.trim()).join('\n').trim();
    return { answer: answer || null, decided: answer ? decided : null, decidedRaw: answer ? decidedRaw : null };
  }

  function leading(line) { return (/^\s*/.exec(line) || [''])[0]; }

  /** Einzeiliger Eintrag "? …" / "?! …" an Zeile i. */
  function lineEntry(lines, i, limit) {
    const m = QUESTION_RE.exec(lines[i]);
    if (!m || FENCED_TEXT_RE.test(m[2])) return null;
    const head = heading(m[1] ? 'decision' : 'question', m[2]);
    if (!head.text) return null;
    const ans = readAnswers(lines, i + 1, limit);
    return Object.assign(head, answerOf(head.kind, ans.lines), { end: ans.end, answerStart: i + 1, indent: leading(lines[i]) });
  }

  /** Eintrag in einer Liste "- ? …" / "1. ?! …" an Zeile i; die Antwort steht eingerückt darunter. */
  function listEntry(lines, i, limit) {
    const m = LIST_RE.exec(lines[i]);
    if (!m || FENCED_TEXT_RE.test(m[4])) return null;
    const head = heading(m[3] ? 'decision' : 'question', m[4]);
    if (!head.text) return null;
    const ans = readAnswers(lines, i + 1, limit);
    return Object.assign(head, answerOf(head.kind, ans.lines), { end: ans.end, answerStart: i + 1, indent: ' '.repeat(m[1].length + m[2].length), list: true });
  }

  /** Beschreibung eines Blocks: gemeinsame Einrückung weg, Leerzeilen am Rand weg, mehrere Leerzeilen zu einer. */
  function tidy(rows) {
    const used = rows.filter(l => l.trim());
    if (!used.length) return null;
    const cut = Math.min(...used.map(l => leading(l).length));
    const out = [];
    for (const l of rows) {
      const line = l.trim() ? l.slice(cut).replace(/\s+$/, '') : '';
      if (!line && (!out.length || out[out.length - 1] === '')) continue;
      out.push(line);
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') || null;
  }

  /** Mehrzeiliger Eintrag "?!``` Titel" … "```" an Zeile i, samt Unter-Einträgen und der Antwort nach dem Block. */
  function blockEntry(lines, i) {
    const m = BLOCK_RE.exec(lines[i]);
    if (!m) return null;
    const kind = m[2] ? 'decision' : 'question';
    // Ende: die erste Zeile "```" ausserhalb eines Codes im Block ("~~~" oder "```sprache" bis zur nächsten Zeile mit demselben Zeichen)
    let j = i + 1;
    let inner = null;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (inner) { if (l.trim().startsWith(inner)) inner = null; continue; }
      if (CLOSE_RE.test(l)) break;
      const f = FENCE_RE.exec(l);
      if (f) inner = f[1];
    }
    const closed = j < lines.length;
    const contentStart = i + 1;
    const contentEnd = j;
    // Unter-Einträge, einzeilig oder in Listen, ausserhalb von Code
    const children = [];
    const taken = new Set();
    inner = null;
    for (let k = contentStart; k < contentEnd; k++) {
      const l = lines[k];
      if (inner) { if (l.trim().startsWith(inner)) inner = null; continue; }
      const f = FENCE_RE.exec(l);
      if (f) { inner = f[1]; continue; }
      const c = lineEntry(lines, k, contentEnd) || listEntry(lines, k, contentEnd);
      if (!c) continue;
      c.lineIndex = k;
      children.push(c);
      for (let x = k; x < c.end; x++) taken.add(x);
      k = c.end - 1;
    }
    // Titel: Rest der Öffnerzeile, sonst die erste Textzeile im Block (ohne "#")
    let raw = m[3];
    let titleLine = null;
    if (!raw.trim()) {
      for (let k = contentStart; k < contentEnd; k++) {
        if (taken.has(k) || !lines[k].trim()) continue;
        if (FENCE_RE.test(lines[k])) break;
        titleLine = k;
        raw = lines[k].replace(/^\s*#{1,6}\s+/, '');
        break;
      }
    }
    const head = heading(kind, raw);
    const rest = [];
    for (let k = contentStart; k < contentEnd; k++) rest.push(taken.has(k) || k === titleLine ? '' : lines[k]);
    const ans = closed ? readAnswers(lines, j + 1, lines.length) : { lines: [], end: lines.length };
    return Object.assign(head, answerOf(kind, ans.lines), {
      end: ans.end, answerStart: closed ? j + 1 : lines.length, indent: m[1],
      block: true, closed, contentStart, contentEnd, titleLine, details: tidy(rest), children,
    });
  }

  /** Liest ab Zeile i eine Frage oder einen Entscheid samt Antwortzeilen; null, wenn dort keine steht.
   *  Ergebnis: { kind, text, due, people, answer, decided, decidedRaw, end, answerStart, indent } – end ist die erste Zeile danach
   *  (exklusiv). Ein Block hat dazu block: true, closed, contentStart, contentEnd (exklusiv), titleLine (oder null), details
   *  (Beschreibung ohne Unter-Einträge, oder null) und children (die Unter-Einträge mit lineIndex); sein Titel kann leer sein.
   *  options.list: auch "- ? …" (dann list: true); options.inner: keine Blöcke (im Block selbst). */
  function parseBlock(lines, i, options) {
    const o = options || {};
    if (!o.inner) {
      const b = blockEntry(lines, i);
      if (b) return b;
    }
    if (o.list) {
      const l = listEntry(lines, i, lines.length);
      if (l) return l;
    }
    return lineEntry(lines, i, lines.length);
  }

  /** Zerlegt einen Notiztext in Fragen und Entscheide mit optionaler Antwort, in der Reihenfolge des Texts. Unter-Einträge eines
   *  Blocks folgen ihm und tragen in parent dessen Stelle in der Liste. Code (``` und ~~~) zählt nicht, wie in der Vorschau. */
  function parse(body) {
    const lines = (body || '').split('\n');
    const result = [];
    const push = (b, lineIndex, parent) => {
      result.push({
        kind: b.kind,
        text: b.text,
        norm: normalize(b.text),
        due: b.due,
        people: b.people,
        answer: b.answer,
        decided: b.decided,
        decidedRaw: b.decidedRaw,
        lineIndex,
        answerStart: b.answerStart,
        answerEnd: b.end, // exklusiv
        indent: b.indent || '',
        block: !!b.block,
        closed: b.block ? b.closed : true,
        details: b.details || null,
        list: !!b.list,
        parent,
      });
      return result.length - 1;
    };
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (fence) { if (line.trim().startsWith(fence)) fence = null; continue; }
      const b = parseBlock(lines, i, { list: true });
      if (b) {
        const own = b.text ? push(b, i, null) : null;
        if (b.block) for (const c of b.children) push(c, c.lineIndex, own);
        i = b.end - 1;
        continue;
      }
      const f = FENCE_RE.exec(line);
      if (f) fence = f[1];
    }
    return result;
  }

  /** Schreibt die Antwort (Frage: "!"-Zeilen) oder den Entscheid ("!!"-Zeilen, die erste mit Datum) unter den Eintrag.
   *  options.decided: Datum, wie es im Text stehen soll (zum Beispiel "14.10.2026"); fehlt es, bleibt das Datum aus dem
   *  Text, sonst gilt heute. Leerer Text entfernt die Antwort. */
  function writeAnswer(body, question, answerText, options) {
    const lines = (body || '').split('\n');
    const decision = question.kind === 'decision';
    const marker = (question.indent || '') + (decision ? '!! ' : '! '); // eingerückt wie der Eintrag (in Listen unter dessen Text)
    const answerLines = (answerText || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => marker + l);
    if (decision && answerLines.length) {
      const wanted = options && typeof options.decided === 'string' ? splitDecided(options.decided) : { decided: null };
      const raw = wanted.decided ? wanted.raw : question.decidedRaw || (global.NoNotesDates ? global.NoNotesDates.todayIso() : new Date().toISOString().slice(0, 10));
      answerLines[0] = marker + raw + ': ' + answerLines[0].slice(marker.length);
    }
    // Ein Block ohne "```" am Ende bekommt es vor der Antwort, sonst stünde sie im Block
    if (question.block && question.closed === false && answerLines.length) answerLines.unshift((question.indent || '') + '```');
    lines.splice(question.answerStart, question.answerEnd - question.answerStart, ...answerLines);
    return lines.join('\n');
  }

  /** Findet im Text den Eintrag, der zu einer Indexzeile passt: zuerst über die gemerkte Zeile, sonst über den
   *  normalisierten Text (gleicher Art). */
  function locate(body, row) {
    const parsed = parse(body);
    const kind = row.kind || 'question';
    let q = parsed.find(p => p.kind === kind && p.lineIndex === row.line_no && p.norm === row.norm);
    if (!q) q = parsed.find(p => p.kind === kind && p.norm === row.norm);
    return q || null;
  }

  /** Ordnet Indexzeilen (wie listQuestions sie liefert) so, dass Unter-Einträge direkt unter ihrem Block stehen, wenn er in derselben
   *  Liste ist, in der Reihenfolge des Texts: [{ row, nested }]. Die übrige Reihenfolge bleibt; ein Unter-Eintrag ohne seinen Block
   *  steht für sich (nested: false). */
  function nest(rows) {
    const ids = new Set(rows.map(r => r.id));
    const inside = r => r.parent_id != null && ids.has(r.parent_id);
    const kids = new Map();
    for (const r of rows) {
      if (!inside(r)) continue;
      if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
      kids.get(r.parent_id).push(r);
    }
    const out = [];
    for (const r of rows) {
      if (inside(r)) continue;
      out.push({ row: r, nested: false });
      for (const c of (kids.get(r.id) || []).sort((x, y) => x.line_no - y.line_no)) out.push({ row: c, nested: true });
    }
    return out;
  }

  /** Schaltet das Präfix einer Zeile um ("?", "?!" oder "!"). Gibt neuen Text und Cursorposition zurück. */
  function toggleLinePrefix(body, caret, prefix) {
    const text = body || '';
    const start = text.lastIndexOf('\n', caret - 1) + 1;
    let end = text.indexOf('\n', caret);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    const RES = { '?': /^(\s*)\?(?!!)\s?/, '?!': /^(\s*)\?!\s?/, '!': /^(\s*)!(?!\[)!?\s?/ };
    const re = RES[prefix] || RES['!'];
    const others = Object.keys(RES).filter(k => k !== prefix).map(k => RES[k]);
    let newLine;
    if (re.test(line)) {
      newLine = line.replace(re, '$1');
    } else {
      const other = others.find(o => o.test(line));
      newLine = other ? line.replace(other, '$1' + prefix + ' ') : line.replace(/^(\s*)/, '$1' + prefix + ' ');
    }
    const delta = newLine.length - line.length;
    return {
      body: text.slice(0, start) + newLine + text.slice(end),
      caret: Math.max(start, caret + delta),
    };
  }

  /** Zeichenposition des Zeilenanfangs einer Zeile. */
  function offsetOfLine(body, lineIndex) {
    const lines = (body || '').split('\n');
    let offset = 0;
    for (let i = 0; i < lineIndex && i < lines.length; i++) offset += lines[i].length + 1;
    return offset;
  }

  global.NoNotesQuestions = { parse, parseBlock, nest, people, splitDecided, normalize, writeAnswer, locate, toggleLinePrefix, offsetOfLine, PERSON_RE };
})(window);
