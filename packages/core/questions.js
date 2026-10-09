/* NoNotes – Fragen und Antworten im Notiztext.
   Syntax: Eine Zeile, die mit "?" beginnt, ist eine Frage, optional mit Fälligkeit
   "@15.10.2026" am Zeilenende (siehe js/dates.js). Direkt darauf folgende Zeilen, die mit
   "!" beginnen, sind die Antwort. Der Text bleibt die einzige Wahrheit; die Tabelle
   "questions" ist nur ein Index darüber. */
(function (global) {
  'use strict';

  const QUESTION_RE = /^\s*\?\s?(.*)$/;
  const ANSWER_RE = /^\s*!(?!\[)\s?(.*)$/; // "![" ist ein Bild, keine Antwort

  function normalize(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Zerlegt einen Notiztext in Fragen mit optionaler Antwort. */
  function parse(body) {
    const lines = (body || '').split('\n');
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      const m = QUESTION_RE.exec(lines[i]);
      if (!m) continue;
      const D = global.NoNotesDates;
      const split = D ? D.splitDue(m[1]) : { text: m[1].trim(), due: null };
      const text = split.text;
      if (!text) continue;
      const answerLines = [];
      let j = i + 1;
      while (j < lines.length) {
        const a = ANSWER_RE.exec(lines[j]);
        if (!a) break;
        answerLines.push(a[1].trim());
        j++;
      }
      const answer = answerLines.join('\n').trim();
      result.push({
        text,
        norm: normalize(text),
        due: split.due,
        answer: answer || null,
        lineIndex: i,
        answerStart: i + 1,
        answerEnd: j, // exklusiv
      });
    }
    return result;
  }

  /** Schreibt eine Antwort unter die Frage mit Index questionIndex (Reihenfolge wie parse()). */
  function writeAnswer(body, question, answerText) {
    const lines = (body || '').split('\n');
    const answerLines = (answerText || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => '! ' + l);
    lines.splice(question.answerStart, question.answerEnd - question.answerStart, ...answerLines);
    return lines.join('\n');
  }

  /** Findet im Text die Frage, die zu einer Indexzeile passt: zuerst über die gemerkte Zeile,
   *  sonst über den normalisierten Text. */
  function locate(body, row) {
    const parsed = parse(body);
    let q = parsed.find(p => p.lineIndex === row.line_no && p.norm === row.norm);
    if (!q) q = parsed.find(p => p.norm === row.norm);
    return q || null;
  }

  /** Schaltet das Präfix einer Zeile um ("?" oder "!"). Gibt neuen Text und Cursorposition zurück. */
  function toggleLinePrefix(body, caret, prefix) {
    const text = body || '';
    const start = text.lastIndexOf('\n', caret - 1) + 1;
    let end = text.indexOf('\n', caret);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    const re = prefix === '?' ? /^(\s*)\?\s?/ : /^(\s*)!(?!\[)\s?/;
    const other = prefix === '?' ? /^(\s*)!(?!\[)\s?/ : /^(\s*)\?\s?/;
    let newLine;
    if (re.test(line)) {
      newLine = line.replace(re, '$1');
    } else if (other.test(line)) {
      newLine = line.replace(other, '$1' + prefix + ' ');
    } else {
      newLine = line.replace(/^(\s*)/, '$1' + prefix + ' ');
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

  global.NoNotesQuestions = { parse, normalize, writeAnswer, locate, toggleLinePrefix, offsetOfLine };
})(window);
