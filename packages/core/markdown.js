/* NoNotes – kleiner, sicherer Markdown-Renderer.
   Unterstützt Überschriften, Absätze mit Zeilenumbrüchen, Listen (auch verschachtelt, auch
   Aufgaben), Zitate, Codeblöcke, Trennlinien, fett/kursiv/durchgestrichen, Code, Links,
   Bilder, automatische Links, [[Titel]]-Verweise auf Notizen sowie die NoNotes-Zeilen
   "? Frage" und "! Antwort". Aller Text wird escaped; URLs sind auf sichere Schemata beschränkt. */
(function (global) {
  'use strict';

  const { t, tn } = global.NoNotesI18n;

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
          else if (att) out += `<span class="md-missing" title="${escapeHtml(t('Anhang {nummer} fehlt', { nummer: att[1] }))}">${text(t('[Bild „{name}“ fehlt]', { name: m[1] || t('Anhang') }))}</span>`;
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

  function makeCtx(options) {
    options = options || {};
    return { text: makeText(options.highlight), resolveTitle: options.resolveTitle, resolveAttachment: options.resolveAttachment, interactiveTasks: !!options.interactiveTasks, lineMap: !!options.lineMap };
  }

  /** Nur Zeilenformatierung (fett, Code, Links, [[Verweise]]), z. B. für Listeneinträge und den Druck. */
  function inline(src, options) {
    return renderInline(String(src == null ? '' : src), makeCtx(options));
  }

  function render(markdown, options) {
    options = options || {};
    const ctx = makeCtx(options);
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    // Mit lineMap tragen die Blöcke data-line (Quellzeile), für das synchrone Scrollen der geteilten Ansicht.
    const la = n => ctx.lineMap ? ` data-line="${n}"` : '';
    const nested = Object.assign({}, options, { lineMap: false });
    const paragraph = [];
    let paragraphStart = 0;
    const flushParagraph = () => {
      if (!paragraph.length) return;
      out.push(`<p${la(paragraphStart)}>` + paragraph.map(l => renderInline(l, ctx)).join('<br>') + '</p>');
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
        const start = i;
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
        i++;
        out.push(`<pre${la(start)}><code${fence[2] ? ` class="lang-${escapeHtml(fence[2])}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }

      // Überschrift
      const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) { flushParagraph(); out.push(`<h${h[1].length}${la(i)}>${renderInline(h[2], ctx)}</h${h[1].length}>`); i++; continue; }

      // Trennlinie
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flushParagraph(); out.push(`<hr${la(i)}>`); i++; continue; }

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
        const D = global.NoNotesDates;
        const split = D ? D.splitDue(q[1]) : { text: q[1].trim(), due: null };
        const dueHtml = split.due && D
          ? `<span class="md-due due ${answered ? 'none' : D.urgency(split.due)}">${escapeHtml(answered ? D.formatDue(split.due) : D.dueLabel(split.due))}</span>`
          : '';
        out.push(`<div class="md-q ${answered ? 'answered' : 'open'}"${la(i)}><span class="md-mark" aria-hidden="true">${answered ? '✓' : '?'}</span><div class="md-q-body"><div class="md-q-text">${renderInline(split.text, ctx)}${dueHtml}</div>` +
          (answered ? `<div class="md-a">${render(answers.join('\n'), Object.assign({}, nested, { interactiveTasks: false }))}</div>` : '') + '</div></div>');
        i = j;
        continue;
      }

      // Antwort ohne Frage davor: als Hinweis darstellen
      const loneAnswer = /^\s*!(?!\[)\s?(.*)$/.exec(line);
      if (loneAnswer) {
        flushParagraph();
        out.push(`<div class="md-a md-a-lone"${la(i)}>${renderInline(loneAnswer[1].trim(), ctx)}</div>`);
        i++;
        continue;
      }

      // Zitat
      if (/^\s{0,3}>/.test(line)) {
        flushParagraph();
        const quoted = [];
        const start = i;
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
        out.push(`<blockquote${la(start)}>` + render(quoted.join('\n'), nested) + '</blockquote>');
        continue;
      }

      // Liste
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flushParagraph();
        i = renderList(lines, i, out, ctx);
        continue;
      }

      if (!paragraph.length) paragraphStart = i;
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
      let dueHtml = '';
      const tm = /^\[( |x|X)\]\s+(.*)$/.exec(text);
      if (tm) {
        task = tm[1] !== ' ';
        text = tm[2];
        const D = global.NoNotesDates;
        if (D) {
          const split = D.splitDue(text);
          if (split.due) {
            text = split.text;
            dueHtml = `<span class="md-due due ${task ? 'none' : D.urgency(split.due)}">${escapeHtml(task ? D.formatDue(split.due) : D.dueLabel(split.due))}</span>`;
          }
        }
      }
      items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: renderInline(text, ctx) + dueHtml, task, line: i });
      i++;
    }

    // Fortschritt der Unteraufgaben: alle tiefer eingerückten Aufgaben direkt darunter
    for (let k = 0; k < items.length; k++) {
      if (items[k].task == null) continue;
      let total = 0, done = 0;
      for (let j = k + 1; j < items.length && items[j].indent > items[k].indent; j++) {
        if (items[j].task != null) { total++; if (items[j].task) done++; }
      }
      items[k].sub = total ? { total, done } : null;
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
      // Wechsel zwischen Bullet und Nummer auf gleicher Einrückung beginnt eine neue Liste
      if (stack.length && item.indent === stack[stack.length - 1].indent && item.ordered !== stack[stack.length - 1].ordered) { html += '</li>'; close(); }
      if (!stack.length || item.indent > stack[stack.length - 1].indent) {
        open(item);
      } else {
        html += '</li>';
      }
      const box = item.task == null ? '' : `<input type="checkbox"${ctx.interactiveTasks ? '' : ' disabled'}${item.task ? ' checked' : ''} aria-label="${escapeHtml(item.task ? t('erledigt') : t('offen'))}"> `;
      let progress = '';
      if (item.sub) {
        const open = item.sub.total - item.sub.done;
        const warn = item.task && open > 0;
        const progressTitle = warn
          ? t('Erledigt, aber {offen} von {gesamt} Unteraufgaben offen', { offen: open, gesamt: item.sub.total })
          : t('{erledigt} von {gesamt} Unteraufgaben erledigt', { erledigt: item.sub.done, gesamt: item.sub.total });
        progress = `<span class="md-progress${warn ? ' warn' : open === 0 ? ' complete' : ''}" title="${escapeHtml(progressTitle)}">${item.sub.done}/${item.sub.total}${warn ? ' · ' + escapeHtml(t('Unteraufgaben offen')) : ''}</span>`;
      }
      const content = item.task == null ? `${item.text}${progress}` : `<span class="task-text">${box}${item.text}</span>${progress}`; // Durchstreichen nur am eigenen Text, nicht an Unteraufgaben
      html += `<li${item.task == null ? (ctx.lineMap ? ` data-line="${item.line}"` : '') : ` class="task${item.task ? ' done' : ''}" data-line="${item.line}"`}>${content}`;
    }
    while (stack.length) { html += '</li>'; close(); }
    out.push(html);
    return i;
  }

  /** Nur Suchtreffer hervorheben (ohne Markdown), für Listen und Fragen. */
  function highlightText(s, highlight) {
    return makeText(highlight)(s);
  }

  global.NoNotesMarkdown = { render, inline, escapeHtml, highlightText };
})(window);
