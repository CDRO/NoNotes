/* NoNotes – kleiner, sicherer Markdown-Renderer.
   Unterstützt Überschriften, Absätze mit Zeilenumbrüchen, Listen (auch verschachtelt, auch
   Aufgaben), Zitate, Codeblöcke, Trennlinien, fett/kursiv/durchgestrichen, Code, Links,
   Bilder, automatische Links, [[Titel]]-Verweise auf Notizen sowie die NoNotes-Zeilen
   "? Frage" und "! Antwort". Aller Text wird escaped; URLs sind auf sichere Schemata beschränkt. */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const FILE_EXT_RE = /\.(md|markdown|txt|html?|png|jpe?g|gif|svg|webp|pdf|json|csv|js|css|zip|sqlite|db)$/i;

  /** Prüft und normalisiert eine Link-Adresse. Adressen ohne Schema wie www.beispiel.ch oder
   *  beispiel.ch/seite bekommen https://, relative Dateipfade bleiben erhalten. */
  function safeUrl(url) {
    const u = String(url || '').trim();
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // andere Schemata (javascript:, data:) nicht zulassen
    if (/^www\./i.test(u)) return 'https://' + u;
    if (/^(#|\/|\.\/|\.\.\/)/.test(u)) return u; // relative Pfade und Anker
    const host = u.split(/[/?#]/)[0];
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}(:\d+)?$/i.test(host) && !FILE_EXT_RE.test(host)) return 'https://' + u;
    if (/^[\w.-]+(\/|$)/.test(u)) return u; // relative Dateipfade wie notes/x.md
    return null;
  }

  /** Erzeugt den Textrenderer: escaped und hebt optional Suchtreffer hervor. */
  function makeText(highlight) {
    if (!highlight) return s => escapeHtml(s);
    const re = new RegExp(escapeRegExp(highlight), 'gi');
    return s => {
      let out = '';
      let last = 0;
      let m;
      const str = String(s);
      while ((m = re.exec(str))) {
        out += escapeHtml(str.slice(last, m.index)) + '<mark>' + escapeHtml(m[0]) + '</mark>';
        last = m.index + m[0].length;
        if (!m[0].length) re.lastIndex++;
      }
      return out + escapeHtml(str.slice(last));
    };
  }

  // ---------- Inline ----------

  function renderInline(src, ctx) {
    const text = ctx.text;
    let out = '';
    let i = 0;
    const n = src.length;

    const emit = s => { out += text(s); };

    while (i < n) {
      const ch = src[i];

      // Code
      if (ch === '`') {
        const close = src.indexOf('`', i + 1);
        if (close > i) {
          out += '<code>' + escapeHtml(src.slice(i + 1, close)) + '</code>';
          i = close + 1;
          continue;
        }
      }

      // Bild ![alt](src) – auch Anhänge att:ID
      if (ch === '!' && src[i + 1] === '[') {
        const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(src.slice(i));
        if (m) {
          const att = /^att:(\d+)$/.exec(m[2]);
          let url = null;
          if (att) url = ctx.resolveAttachment ? ctx.resolveAttachment(Number(att[1])) : null;
          else url = safeUrl(m[2]);
          if (url) out += `<img src="${escapeHtml(url)}" alt="${escapeHtml(m[1])}"${m[3] ? ` title="${escapeHtml(m[3])}"` : ''}${att ? ` class="md-att" data-attachment-id="${att[1]}"` : ''}>`;
          else if (att) out += `<span class="md-missing" title="Anhang ${att[1]} fehlt">[Bild „${text(m[1] || 'Anhang')}“ fehlt]</span>`;
          else emit(m[0]);
          i += m[0].length;
          continue;
        }
      }

      // [[Titel]]
      if (ch === '[' && src[i + 1] === '[') {
        const close = src.indexOf(']]', i + 2);
        if (close > i) {
          const title = src.slice(i + 2, close).trim();
          const id = ctx.resolveTitle ? ctx.resolveTitle(title) : null;
          out += `<a href="#" class="md-wiki${id == null ? ' missing' : ''}" data-title="${escapeHtml(title)}"${id != null ? ` data-note-id="${id}"` : ''}>${text(title)}</a>`;
          i = close + 2;
          continue;
        }
      }

      // Link [text](url)
      if (ch === '[') {
        const m = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(src.slice(i));
        if (m) {
          const url = safeUrl(m[2]);
          if (url) out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${m[3] ? ` title="${escapeHtml(m[3])}"` : ''}>${renderInline(m[1], ctx)}</a>`;
          else out += renderInline(m[1], ctx);
          i += m[0].length;
          continue;
        }
      }

      // Fett / kursiv / durchgestrichen
      const em = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(src.slice(i));
      if (em) { out += '<strong>' + renderInline(em[2], ctx) + '</strong>'; i += em[0].length; continue; }
      const del = /^~~(?=\S)([\s\S]*?\S)~~/.exec(src.slice(i));
      if (del) { out += '<del>' + renderInline(del[1], ctx) + '</del>'; i += del[0].length; continue; }
      const it = /^(\*|_)(?=\S)([^*_]*?\S)\1(?![\w*_])/.exec(src.slice(i));
      if (it && (i === 0 || !/\w/.test(src[i - 1]))) { out += '<em>' + renderInline(it[2], ctx) + '</em>'; i += it[0].length; continue; }

      // Automatischer Link (https://… oder www.…)
      const auto = /^(https?:\/\/|www\.)[^\s<>()\]]+[^\s<>()\].,;:!?'"]/.exec(src.slice(i));
      if (auto && (i === 0 || !/[\w@]/.test(src[i - 1]))) {
        const href = /^www\./i.test(auto[0]) ? 'https://' + auto[0] : auto[0];
        out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text(auto[0])}</a>`;
        i += auto[0].length;
        continue;
      }

      // Normaler Text bis zum nächsten Sonderzeichen
      let j = i + 1;
      while (j < n && !'`![*_~hw'.includes(src[j])) j++;
      emit(src.slice(i, j));
      i = j;
    }
    return out;
  }

  // ---------- Blöcke ----------

  function render(markdown, options) {
    options = options || {};
    const ctx = { text: makeText(options.highlight), resolveTitle: options.resolveTitle, resolveAttachment: options.resolveAttachment, interactiveTasks: !!options.interactiveTasks };
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    const paragraph = [];
    const flushParagraph = () => {
      if (!paragraph.length) return;
      out.push('<p>' + paragraph.map(l => renderInline(l, ctx)).join('<br>') + '</p>');
      paragraph.length = 0;
    };

    while (i < lines.length) {
      const line = lines[i];

      // Leerzeile
      if (!line.trim()) { flushParagraph(); i++; continue; }

      // Codeblock
      const fence = /^\s*(```|~~~)\s*(\S*)/.exec(line);
      if (fence) {
        flushParagraph();
        const code = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
        i++;
        out.push(`<pre><code${fence[2] ? ` class="lang-${escapeHtml(fence[2])}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }

      // Überschrift
      const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) { flushParagraph(); out.push(`<h${h[1].length}>${renderInline(h[2], ctx)}</h${h[1].length}>`); i++; continue; }

      // Trennlinie
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flushParagraph(); out.push('<hr>'); i++; continue; }

      // Frage mit Antwortzeilen
      const q = /^\s*\?\s?(.*)$/.exec(line);
      if (q && q[1].trim()) {
        flushParagraph();
        const answers = [];
        let j = i + 1;
        while (j < lines.length) {
          const a = /^\s*!(?!\[)\s?(.*)$/.exec(lines[j]);
          if (!a) break;
          answers.push(a[1]);
          j++;
        }
        const answered = answers.join('').trim().length > 0;
        out.push(`<div class="md-q ${answered ? 'answered' : 'open'}"><span class="md-mark" aria-hidden="true">${answered ? '✓' : '?'}</span><div class="md-q-body"><div class="md-q-text">${renderInline(q[1].trim(), ctx)}</div>` +
          (answered ? `<div class="md-a">${answers.map(a => renderInline(a.trim(), ctx)).join('<br>')}</div>` : '') + '</div></div>');
        i = j;
        continue;
      }

      // Antwort ohne Frage davor: als Hinweis darstellen
      const loneAnswer = /^\s*!(?!\[)\s?(.*)$/.exec(line);
      if (loneAnswer) {
        flushParagraph();
        out.push(`<div class="md-a md-a-lone">${renderInline(loneAnswer[1].trim(), ctx)}</div>`);
        i++;
        continue;
      }

      // Zitat
      if (/^\s{0,3}>/.test(line)) {
        flushParagraph();
        const quoted = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
        out.push('<blockquote>' + render(quoted.join('\n'), options) + '</blockquote>');
        continue;
      }

      // Liste
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flushParagraph();
        i = renderList(lines, i, out, ctx);
        continue;
      }

      paragraph.push(line);
      i++;
    }
    flushParagraph();
    return out.join('\n');
  }

  function renderList(lines, start, out, ctx) {
    const items = [];
    let i = start;
    while (i < lines.length) {
      const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
      if (!m) {
        // Fortsetzungszeile eines Listenpunkts (eingerückt) oder Ende
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
          items[items.length - 1].text += '<br>' + renderInline(lines[i].trim(), ctx);
          i++;
          continue;
        }
        break;
      }
      let text = m[3];
      let task = null;
      const t = /^\[( |x|X)\]\s+(.*)$/.exec(text);
      if (t) { task = t[1] !== ' '; text = t[2]; }
      items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: renderInline(text, ctx), task, line: i });
      i++;
    }

    // Verschachtelung über Einrückung
    let html = '';
    const stack = [];
    const open = item => {
      stack.push({ indent: item.indent, ordered: item.ordered });
      html += item.ordered ? '<ol>' : '<ul>';
    };
    const close = () => { const s = stack.pop(); html += s.ordered ? '</ol>' : '</ul>'; };
    for (const item of items) {
      while (stack.length && item.indent < stack[stack.length - 1].indent) { html += '</li>'; close(); }
      if (!stack.length || item.indent > stack[stack.length - 1].indent) {
        open(item);
      } else {
        html += '</li>';
      }
      const box = item.task == null ? '' : `<input type="checkbox"${ctx.interactiveTasks ? '' : ' disabled'}${item.task ? ' checked' : ''} aria-label="${item.task ? 'erledigt' : 'offen'}"> `;
      html += `<li${item.task == null ? '' : ` class="task${item.task ? ' done' : ''}" data-line="${item.line}"`}>${box}${item.text}`;
    }
    while (stack.length) { html += '</li>'; close(); }
    out.push(html);
    return i;
  }

  /** Nur Suchtreffer hervorheben (ohne Markdown), für Listen und Fragen. */
  function highlightText(s, highlight) {
    return makeText(highlight)(s);
  }

  global.NoNotesMarkdown = { render, escapeHtml, highlightText };
})(window);
