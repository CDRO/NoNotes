/* NoNotes – reine Textfunktionen für die Toolleiste des Editors.
   Jede Funktion bekommt (text, selStart, selEnd) und liefert { text, selStart, selEnd }.
   Keine DOM-Abhängigkeit, damit sich alles in Node prüfen lässt. */
(function (global) {
  'use strict';

  function lineBounds(text, start, end) {
    const from = text.lastIndexOf('\n', start - 1) + 1;
    let to = text.indexOf('\n', Math.max(end, start));
    if (to < 0) to = text.length;
    // Endet die Markierung genau am Zeilenanfang, gehört diese Zeile nicht mehr dazu.
    if (end > start && end > from && text[end - 1] === '\n') to = end - 1;
    return { from, to };
  }

  /** Umschliesst die Markierung mit before/after oder entfernt eine bestehende Umschliessung. */
  function wrap(text, s, e, before, after, placeholder) {
    after = after == null ? before : after;
    const sel = text.slice(s, e);
    // Bereits umschlossen (Marker innerhalb oder ausserhalb der Markierung)?
    if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
      const inner = sel.slice(before.length, sel.length - after.length);
      return { text: text.slice(0, s) + inner + text.slice(e), selStart: s, selEnd: s + inner.length };
    }
    if (text.slice(s - before.length, s) === before && text.slice(e, e + after.length) === after) {
      return { text: text.slice(0, s - before.length) + sel + text.slice(e + after.length), selStart: s - before.length, selEnd: s - before.length + sel.length };
    }
    if (!sel) {
      const ph = placeholder || 'Text';
      return { text: text.slice(0, s) + before + ph + after + text.slice(e), selStart: s + before.length, selEnd: s + before.length + ph.length };
    }
    return { text: text.slice(0, s) + before + sel + after + text.slice(e), selStart: s + before.length, selEnd: s + before.length + sel.length };
  }

  const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;
  const PREFIX_RE = {
    quote: /^(\s*)>\s?/,
    question: /^(\s*)\?(?!\?)\s?/,
    answer: /^(\s*)!(?!\[)\s?/,
    heading: /^(\s*)#{1,6}\s+/,
  };

  /** Wendet fn auf jede Zeile der Markierung an und hält die Markierung auf den Zeilen. */
  function mapLines(text, s, e, fn) {
    const { from, to } = lineBounds(text, s, e);
    const lines = text.slice(from, to).split('\n');
    const out = lines.map((l, i) => fn(l, i, lines)).join('\n');
    return { text: text.slice(0, from) + out + text.slice(to), selStart: from, selEnd: from + out.length };
  }

  function stripLinePrefixes(line) {
    return line.replace(LIST_RE, '$1').replace(PREFIX_RE.quote, '$1').replace(PREFIX_RE.question, '$1').replace(PREFIX_RE.answer, '$1');
  }

  /** Listen umschalten: kind = 'bullet' | 'ordered' | 'task'. */
  function toggleList(text, s, e, kind) {
    const { from, to } = lineBounds(text, s, e);
    const lines = text.slice(from, to).split('\n');
    const isKind = l => kind === 'task' ? /^\s*[-*+]\s+\[[ xX]\]\s+/.test(l)
      : kind === 'ordered' ? /^\s*\d+[.)]\s+(?!\[[ xX]\]\s)/.test(l)
      : /^\s*[-*+]\s+(?!\[[ xX]\]\s)/.test(l);
    const all = lines.filter(l => l.trim()).every(isKind);
    return mapLines(text, s, e, (l, i) => {
      if (!l.trim() && lines.length > 1) return l;
      const indent = (l.match(/^\s*/) || [''])[0];
      const body = stripLinePrefixes(l).replace(/^\s*/, '');
      if (all) return indent + body;
      if (kind === 'task') return indent + '- [ ] ' + body;
      if (kind === 'ordered') return indent + (i + 1) + '. ' + body;
      return indent + '- ' + body;
    });
  }

  /** Zitat, Frage oder Antwort umschalten (kind = 'quote' | 'question' | 'answer'). */
  function togglePrefix(text, s, e, kind) {
    const re = PREFIX_RE[kind];
    const marker = kind === 'quote' ? '> ' : kind === 'question' ? '? ' : '! ';
    const { from, to } = lineBounds(text, s, e);
    const lines = text.slice(from, to).split('\n');
    const all = lines.filter(l => l.trim()).every(l => re.test(l));
    return mapLines(text, s, e, l => {
      if (!l.trim() && lines.length > 1) return l;
      if (all) return l.replace(re, '$1');
      if (re.test(l)) return l;
      const other = kind === 'question' ? PREFIX_RE.answer : kind === 'answer' ? PREFIX_RE.question : null;
      const base = other ? l.replace(other, '$1') : l;
      return base.replace(/^(\s*)/, '$1' + marker);
    });
  }

  /** Überschrift setzen (level 1–6) oder entfernen (0). */
  function setHeading(text, s, e, level) {
    return mapLines(text, s, e, l => {
      const base = l.replace(PREFIX_RE.heading, '$1');
      if (!level) return base;
      return base.replace(/^(\s*)/, '$1' + '#'.repeat(level) + ' ');
    });
  }

  /** Codeblock um die markierten Zeilen oder leere Vorlage. */
  function codeBlock(text, s, e) {
    const { from, to } = lineBounds(text, s, e);
    const block = text.slice(from, to);
    if (!block.trim()) {
      const ins = '```\n' + 'Code' + '\n```';
      return { text: text.slice(0, from) + ins + text.slice(to), selStart: from + 4, selEnd: from + 8 };
    }
    if (/^```/.test(block) && /```\s*$/.test(block)) {
      const inner = block.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
      return { text: text.slice(0, from) + inner + text.slice(to), selStart: from, selEnd: from + inner.length };
    }
    const out = '```\n' + block + '\n```';
    return { text: text.slice(0, from) + out + text.slice(to), selStart: from, selEnd: from + out.length };
  }

  /** Link einfügen: markierte URL → [Text](url), markierter Text → [Text](https://), sonst Vorlage. */
  function link(text, s, e) {
    const sel = text.slice(s, e).trim();
    if (/^(https?:\/\/|www\.|mailto:)\S+$/i.test(sel)) {
      const url = /^www\./i.test(sel) ? 'https://' + sel : sel;
      const ins = `[Text](${url})`;
      return { text: text.slice(0, s) + ins + text.slice(e), selStart: s + 1, selEnd: s + 5 };
    }
    const label = sel || 'Text';
    const ins = `[${label}](https://)`;
    const urlStart = s + label.length + 3;
    return { text: text.slice(0, s) + ins + text.slice(e), selStart: urlStart, selEnd: urlStart + 8 };
  }

  /** Verweis auf eine Notiz: [[Titel]]. */
  function wikiLink(text, s, e) {
    return wrap(text, s, e, '[[', ']]', 'Titel');
  }

  /** Trennlinie auf eigener Zeile. */
  function horizontalRule(text, s, e) {
    const before = text.slice(0, s);
    const after = text.slice(e);
    const pre = before.length && !before.endsWith('\n') ? '\n' : '';
    const post = after.startsWith('\n') || !after.length ? '\n' : '\n\n';
    const ins = pre + '---' + post;
    return { text: before + ins + after, selStart: s + ins.length, selEnd: s + ins.length };
  }

  /** Text an der Cursorposition einfügen (ersetzt die Markierung). */
  function insert(text, s, e, snippet, selectInner) {
    const out = text.slice(0, s) + snippet + text.slice(e);
    if (selectInner) return { text: out, selStart: s + selectInner[0], selEnd: s + selectInner[1] };
    return { text: out, selStart: s + snippet.length, selEnd: s + snippet.length };
  }

  global.NoNotesEditing = { wrap, toggleList, togglePrefix, setHeading, codeBlock, link, wikiLink, horizontalRule, insert, lineBounds };
})(window);
