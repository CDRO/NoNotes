/* NoNotes – Fragen, Entscheide und Antworten im Notiztext.
   Syntax: Eine Zeile, die mit "?" beginnt, ist eine Frage; eine Zeile, die mit "?!" beginnt, ein Entscheid.
   Beide dürfen am Zeilenende einen Termin tragen ("@15.10.2026", siehe dates.js). Direkt darauf folgende
   Zeilen, die mit "!" oder "!!" beginnen, sind die Antwort beziehungsweise der getroffene Entscheid; die
   Zeile mit dem Öffner bestimmt die Art, der Antwortmarker ist nachsichtig. Bei einem Entscheid darf die
   erste Antwortzeile mit dem Datum beginnen ("!! 14.10.2026: Variante B"): es gilt als Tag des Entscheids.
   "@kürzel" im Text nennt, wer antworten oder entscheiden soll, "(@kürzel)" eine Person, die wahlweise dabei ist.
   Der Text bleibt die einzige Wahrheit; die Tabelle "questions" ist nur ein Index darüber. */
(function (global) {
  'use strict';

  const QUESTION_RE = /^\s*\?(!?)\s?(.*)$/;          // Gruppe 1: "!" → Entscheid
  const ANSWER_RE = /^\s*(?:!!|!(?!\[))\s?(.*)$/;    // "![" ist ein Bild, keine Antwort
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

  /** Liest ab Zeile i eine Frage oder einen Entscheid samt Antwortzeilen; null, wenn dort keine steht.
   *  Ergebnis: { kind, text, due, people, answer, decided, decidedRaw, end } – end ist die erste Zeile danach (exklusiv). */
  function parseBlock(lines, i) {
    const m = QUESTION_RE.exec(lines[i]);
    if (!m) return null;
    const kind = m[1] ? 'decision' : 'question';
    const D = global.NoNotesDates;
    const split = D ? D.splitDue(m[2]) : { text: m[2].trim(), due: null };
    const text = split.text;
    if (!text) return null;
    const answerLines = [];
    let j = i + 1;
    while (j < lines.length) {
      const a = ANSWER_RE.exec(lines[j]);
      if (!a) break;
      answerLines.push(a[1]);
      j++;
    }
    let decided = null;
    let decidedRaw = null;
    if (kind === 'decision' && answerLines.length) {
      const first = splitDecided(answerLines[0]);
      decided = first.decided;
      decidedRaw = first.raw;
      answerLines[0] = first.text;
    }
    const answer = answerLines.map(l => l.trim()).join('\n').trim();
    return { kind, text, due: split.due, people: people(text), answer: answer || null, decided: answer ? decided : null, decidedRaw: answer ? decidedRaw : null, end: j };
  }

  /** Zerlegt einen Notiztext in Fragen und Entscheide mit optionaler Antwort. */
  function parse(body) {
    const lines = (body || '').split('\n');
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      const b = parseBlock(lines, i);
      if (!b) continue;
      result.push({
        kind: b.kind,
        text: b.text,
        norm: normalize(b.text),
        due: b.due,
        people: b.people,
        answer: b.answer,
        decided: b.decided,
        decidedRaw: b.decidedRaw,
        lineIndex: i,
        answerStart: i + 1,
        answerEnd: b.end, // exklusiv
      });
    }
    return result;
  }

  /** Schreibt die Antwort (Frage: "!"-Zeilen) oder den Entscheid ("!!"-Zeilen, die erste mit Datum) unter den Eintrag.
   *  options.decided: Datum, wie es im Text stehen soll (zum Beispiel "14.10.2026"); fehlt es, bleibt das Datum aus dem
   *  Text, sonst gilt heute. Leerer Text entfernt die Antwort. */
  function writeAnswer(body, question, answerText, options) {
    const lines = (body || '').split('\n');
    const decision = question.kind === 'decision';
    const marker = decision ? '!! ' : '! ';
    const answerLines = (answerText || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => marker + l);
    if (decision && answerLines.length) {
      const wanted = options && typeof options.decided === 'string' ? splitDecided(options.decided) : { decided: null };
      const raw = wanted.decided ? wanted.raw : question.decidedRaw || (global.NoNotesDates ? global.NoNotesDates.todayIso() : new Date().toISOString().slice(0, 10));
      answerLines[0] = marker + raw + ': ' + answerLines[0].slice(marker.length);
    }
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

  global.NoNotesQuestions = { parse, parseBlock, people, splitDecided, normalize, writeAnswer, locate, toggleLinePrefix, offsetOfLine, PERSON_RE };
})(window);
