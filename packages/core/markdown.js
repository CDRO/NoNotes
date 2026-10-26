/* NoNotes – kleiner, sicherer Markdown-Renderer.
   Unterstützt Überschriften, Absätze mit Zeilenumbrüchen, Listen (auch verschachtelt, auch
   Aufgaben), Zitate, Codeblöcke, Trennlinien, fett/kursiv/durchgestrichen, Code, Links,
   Bilder, automatische Links, [[Titel]]-Verweise auf Notizen (auch [[Titel*]], Querverweis) sowie die NoNotes-Zeilen
   "? Frage" und "! Antwort" (auch in Listen und mehrzeilig als "?!```" … "```", siehe questions.js). Aller Text wird escaped; URLs
   sind auf sichere Schemata beschränkt.

   Videos (YouTube, Vimeo, Dailymotion; siehe embeds.js): Steht eine Zeile allein aus einer solchen Adresse oder aus ![Titel](Adresse) und
   ist options.embeds gesetzt, entsteht eine Karte «Video von … laden». Sie enthält keinen Rahmen und löst keine Anfrage aus; die Seite baut
   den Rahmen erst nach einem Klick (siehe docs/EMBEDS.md). Ohne options.embeds (Druck, Listen) wird aus ![Titel](Videoadresse) ein Link statt
   eines Bildes, damit der Browser die Seite des Anbieters nicht als Bild abruft. */
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

  /** Link auf eine Notiz dieser App (v2.7.0, ctx.noteLink): öffnet sich in der App; ohne eigenen Linktext steht der Titel der Notiz da. */
  function noteLinkHtml(nl, url, labelHtml, ctx) {
    const label = labelHtml || ctx.text(nl.title || url);
    return `<a href="${escapeHtml(url)}" class="md-note${nl.missing ? ' missing' : ''}" data-note-id="${nl.id}"${nl.area ? ` data-area="${escapeHtml(nl.area)}"` : ''}` +
      `${nl.missing ? ` title="${escapeHtml(t('Diese Notiz gibt es nicht (mehr).'))}"` : ''}>${label}</a>`;
  }

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

      // @kürzel und (@kürzel) als Personen-Marke (nur in Fragen und Entscheiden: ctx.people)
      if (ctx.people && (ch === '@' || (ch === '(' && src[i + 1] === '@')) && (i === 0 || /[\s(]/.test(src[i - 1]))) {
        const m = /^(\(?)@(\p{L}[\p{L}\p{N}_.-]*)(\)?)/u.exec(src.slice(i));
        if (m) {
          const handle = m[2].replace(/[.-]+$/, ''); // Satzzeichen am Ende gehören nicht dazu
          const optional = m[1] === '(' && m[3] === ')' && handle === m[2];
          if (m[1] === '(' && !optional) { emit('('); i += 1; continue; } // "(@x" ohne Klammer zu: nur die Klammer ist Text
          out += `<span class="md-person${optional ? ' optional' : ''}" data-handle="${escapeHtml(handle)}"${optional ? ` title="${escapeHtml(t('optional'))}"` : ''}>@${escapeHtml(handle)}</span>`;
          i += (optional ? 2 : 0) + 1 + handle.length;
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
          const video = !att && global.NoNotesEmbeds ? global.NoNotesEmbeds.parse(m[2]) : null;
          if (video) { // eine Videoadresse ist kein Bild: als Link zeigen
            out += `<a href="${escapeHtml(video.watchUrl)}" target="_blank" rel="noopener noreferrer" class="md-video-link">▶ ${text(m[1] || t('Video: {anbieter}', { anbieter: video.name }))}</a>`;
          } else if (url) out += `<img src="${escapeHtml(url)}" alt="${escapeHtml(m[1])}"${m[3] ? ` title="${escapeHtml(m[3])}"` : ''}${att ? ` class="md-att" data-attachment-id="${att[1]}"` : ''}>`;
          else if (att) out += `<span class="md-missing" title="${escapeHtml(t('Anhang {nummer} fehlt', { nummer: att[1] }))}">${text(t('[Bild „{name}“ fehlt]', { name: m[1] || t('Anhang') }))}</span>`;
          else emit(m[0]);
          i += m[0].length;
          continue;
        }
      }

      // [[Titel]] und [[Titel*]] (Querverweis: dazu eine gestrichelte Linie in der Mindmap, siehe packages/core/links.js); [[Titel#42]]
      // meint genau die Notiz 42 und zeigt nur den Titel (ctx.resolveRef, seit 2.9.0)
      if (ch === '[' && src[i + 1] === '[') {
        const close = src.indexOf(']]', i + 2);
        if (close > i) {
          const raw = src.slice(i + 2, close).trim();
          const cross = raw.endsWith('*');
          const target = (cross ? raw.slice(0, -1) : raw).trim();
          const ref = ctx.resolveRef ? ctx.resolveRef(target) : { id: ctx.resolveTitle ? ctx.resolveTitle(target) : null, label: target };
          const id = ref.id, title = ref.label;
          out += `<a href="#" class="md-wiki${cross ? ' md-wiki-cross' : ''}${id == null ? ' missing' : ''}" data-title="${escapeHtml(title)}"${id != null ? ` data-note-id="${id}"` : ''}>${text(title)}</a>`;
          i = close + 2;
          continue;
        }
      }

      // Link [text](url)
      if (ch === '[') {
        const m = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(src.slice(i));
        const nl = m && ctx.noteLink ? ctx.noteLink(m[2]) : null;
        if (nl) {
          out += noteLinkHtml(nl, m[2], m[1] === m[2] ? null : renderInline(m[1], ctx), ctx);
          i += m[0].length;
          continue;
        }
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

      // Adresse einer Notiz dieser App (auch file:// in der lokalen Version): Link mit dem Titel der Notiz
      if (ctx.noteLink && (ch === 'h' || ch === 'f') && (i === 0 || !/[\w@]/.test(src[i - 1]))) {
        const um = /^(?:https?|file):\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]/.exec(src.slice(i));
        const nl = um ? ctx.noteLink(um[0]) : null;
        if (nl) { out += noteLinkHtml(nl, um[0], null, ctx); i += um[0].length; continue; }
      }

      // Automatischer Link (https://… oder www.…)
      const auto = /^(https?:\/\/|www\.)[^\s<>()\]]+[^\s<>()\].,;:!?'"]/.exec(src.slice(i));
      if (auto && (i === 0 || !/[\w@]/.test(src[i - 1]))) {
        const href = /^www\./i.test(auto[0]) ? 'https://' + auto[0] : auto[0];
        out += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text(auto[0])}</a>`;
        i += auto[0].length;
        continue;
      }

      // Normaler Text bis zum nächsten Sonderzeichen (mit Personen-Marken auch bis "@" und "(")
      const stops = (ctx.people ? '`![*_~hw@(' : '`![*_~hw') + (ctx.noteLink ? 'f' : '');
      let j = i + 1;
      while (j < n && !stops.includes(src[j])) j++;
      emit(src.slice(i, j));
      i = j;
    }
    return out;
  }

  // ---------- Blöcke ----------

  function makeCtx(options) {
    options = options || {};
    return { text: makeText(options.highlight), resolveTitle: options.resolveTitle, resolveRef: options.resolveRef, noteLink: options.noteLink || null, resolveAttachment: options.resolveAttachment, interactiveTasks: !!options.interactiveTasks, lineMap: !!options.lineMap, embeds: !!options.embeds, embedLoad: options.embedLoad, people: !!options.people,
      inBlock: !!options.inBlock, lineOffset: options.lineOffset || 0, options,
      // Tabellen: Format der Erweiterungen (tableFormat) und die Quellzeile (data-src) nur dort, wo sie im Text stimmt
      tableFormat: typeof options.tableFormat === 'function' ? options.tableFormat : null, tableSrc: options.tableSrc !== false && !options.inBlock };
  }

  /** Nur Zeilenformatierung (fett, Code, Links, [[Verweise]]), z. B. für Listeneinträge und den Druck. */
  function inline(src, options) {
    return renderInline(String(src == null ? '' : src), makeCtx(options));
  }

  /** Karte für eine Zeile, die allein aus einer Videoadresse besteht (bloss oder als ![Titel](Adresse)); sonst null. */
  function embedCard(line, ctx, lineAttr) {
    const E = global.NoNotesEmbeds;
    if (!E) return null;
    const trimmed = line.trim();
    let url = null;
    let title = '';
    const img = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(trimmed);
    if (img) { url = img[2]; title = img[1].trim(); }
    else if (/^https?:\/\/\S+$/i.test(trimmed)) url = trimmed;
    const v = url ? E.parse(url) : null;
    if (!v) return null;
    const canLoad = ctx.embedLoad ? !!ctx.embedLoad(v.provider) : true;
    const name = escapeHtml(v.name);
    return `<div class="md-embed" data-provider="${escapeHtml(v.provider)}" data-embed="${escapeHtml(v.embedUrl)}" data-title="${escapeHtml(title || t('Video: {anbieter}', { anbieter: v.name }))}"${lineAttr}>` +
      '<div class="md-embed-card"><span class="md-embed-icon" aria-hidden="true">▶</span><div class="md-embed-text">' +
      `<strong>${escapeHtml(title || t('Video von {anbieter}', { anbieter: v.name }))}</strong>` +
      `<small>${escapeHtml(canLoad ? t('Beim Laden erfährt {anbieter} deine IP-Adresse.', { anbieter: v.name }) : t('Hier lässt {anbieter} das Einbetten nicht zu. Öffne das Video auf der Seite des Anbieters.', { anbieter: v.name }))}</small></div>` +
      (canLoad ? `<button type="button" class="md-embed-load">${escapeHtml(t('Video laden'))}</button>` : '') +
      `<a class="md-embed-open" href="${escapeHtml(v.watchUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('Auf {anbieter} öffnen', { anbieter: v.name }))}</a>` +
      '</div></div>';
  }

  /** Hinweis auf die Unter-Einträge eines Blocks: «2 von 3 Unterentscheiden offen» oder «Alle 3 Unterentscheide getroffen».
   *  counts: { decisions, decisionsOpen, questions, questionsOpen }; answered: der Block selbst ist entschieden (offene Unter-Einträge
   *  sind dann eine Warnung). Auch für die Übersicht und den Druck. */
  function subEntriesHtml(counts, answered) {
    const parts = [];
    const c = counts || {};
    for (const [n, open, kind] of [[c.decisions || 0, c.decisionsOpen || 0, 'decision'], [c.questions || 0, c.questionsOpen || 0, 'question']]) {
      if (!n) continue;
      const label = kind === 'decision'
        ? (open ? tn('{offen} von {n} Unterentscheid offen', '{offen} von {n} Unterentscheiden offen', n, { offen: open }) : tn('{n} Unterentscheid getroffen', 'Alle {n} Unterentscheide getroffen', n))
        : (open ? tn('{offen} von {n} Unterfrage offen', '{offen} von {n} Unterfragen offen', n, { offen: open }) : tn('{n} Unterfrage beantwortet', 'Alle {n} Unterfragen beantwortet', n));
      parts.push(`<span class="md-progress md-q-subs${open ? (answered ? ' warn' : '') : ' complete'}">${escapeHtml(label)}</span>`);
    }
    return parts.join('');
  }

  /** Zähler der Unter-Einträge aus den children eines Blocks (questions.js). */
  function countChildren(children) {
    const of = kind => children.filter(c => c.kind === kind);
    return { decisions: of('decision').length, decisionsOpen: of('decision').filter(c => !c.answer).length, questions: of('question').length, questionsOpen: of('question').filter(c => !c.answer).length };
  }

  /** Kasten für eine Frage oder einen Entscheid (einzeilig, in einer Liste oder als Block); lines ist der Text, in dem qb steht. */
  function entryHtml(qb, lines, ctx, lineAttr) {
    const answered = !!qb.answer;
    const decision = qb.kind === 'decision';
    const D = global.NoNotesDates;
    const options = ctx.options || {};
    const dueHtml = qb.due && D
      ? `<span class="md-due due ${answered ? 'none' : D.urgency(qb.due)}">${escapeHtml(answered ? D.formatDue(qb.due) : D.dueLabel(qb.due))}</span>`
      : '';
    const decidedHtml = decision && answered && qb.decided && D
      ? `<div class="md-decided">${escapeHtml(t('Entschieden {datum}', { datum: D.formatDue(qb.decided) }))}</div>`
      : '';
    const mark = answered ? '✓' : decision ? '?!' : '?';
    let details = '';
    if (qb.block) {
      // Die Zeilen im Block bleiben an ihrem Platz (die Titelzeile wird leer), damit data-line und Aufgaben stimmen
      const inner = global.NoNotesQuestions.contentLines(lines, qb); // im Listenpunkt ohne dessen Einrückung
      if (qb.titleLine != null) inner[qb.titleLine - qb.contentStart] = '';
      const used = inner.filter(l => l.trim());
      const cut = used.length ? Math.min(...used.map(l => (/^\s*/.exec(l) || [''])[0].length)) : 0;
      const html = render(inner.map(l => l.slice(Math.min(cut, (/^\s*/.exec(l) || [''])[0].length))).join('\n'),
        Object.assign({}, options, { inBlock: true, lineOffset: ctx.lineOffset + qb.contentStart }));
      if (html.trim()) details = `<div class="md-q-details">${html}</div>`;
    }
    const subs = qb.block && qb.children.length ? subEntriesHtml(countChildren(qb.children), answered) : '';
    const title = qb.text ? renderInline(qb.text, Object.assign({}, ctx, { people: true })) : '';
    const answerOptions = Object.assign({}, options, { lineMap: false, inBlock: false, lineOffset: 0, interactiveTasks: false, tableSrc: false });
    return `<div class="md-q${decision ? ' md-decision' : ''}${qb.block ? ' md-q-block' : ''} ${answered ? 'answered' : 'open'}"${lineAttr}><span class="md-mark" aria-hidden="true">${mark}</span><div class="md-q-body"><div class="md-q-text">${title}${dueHtml}${subs}</div>` +
      details + (answered ? `<div class="md-a">${decidedHtml}${render(qb.answer, answerOptions)}</div>` : '') + '</div></div>';
  }

  // ---------- Tabellen (v2.10.0) ----------

  // Was Erweiterungen an einer Tabelle setzen dürfen (über tableFormat): Klassen und diese Eigenschaften, Werte ohne url() u. ä.
  const TABLE_PROPS = new Set(['width', 'min-width', 'max-width', 'height', 'min-height', 'background', 'background-color', 'color',
    'font-weight', 'font-style', 'text-decoration', 'text-align', 'vertical-align', 'white-space', 'border-color', 'padding']);
  const TABLE_VALUE = /^[#\w\s.,%()+-]+$/;
  const unescapePipe = s => String(s).replace(/\\\|/g, '|');

  /** { class: 'a b', 'font-weight': 'bold', fontStyle: … } → { classes, css } mit nur erlaubten Angaben. */
  function formatAttrs(spec) {
    const classes = [], css = [];
    if (!spec || typeof spec !== 'object') return { classes, css };
    for (const [k, v] of Object.entries(spec)) {
      if (k === 'class') { for (const c of String(v).split(/\s+/)) if (/^[a-z][a-z0-9_-]*$/i.test(c)) classes.push(c); continue; }
      const prop = k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      const val = String(v == null ? '' : v).trim();
      if (TABLE_PROPS.has(prop) && val && TABLE_VALUE.test(val) && !/url\s*\(|expression|javascript/i.test(val)) css.push(`${prop}: ${val}`);
    }
    return { classes, css };
  }

  /** Eine Tabelle als HTML. Titelzeile in <thead> (bleibt beim Scrollen oben, wiederholt sich im Druck), Titelspalte als <th scope="row">.
   *  ctx.tableFormat(info) liefert Angaben von Erweiterungen (ein Objekt oder eine Liste davon): { table, header, columns: { c: … },
   *  rows: { r: … }, cells: { 'r,c': … } } mit r = 'h' für die Titelzeile. An einem Feld gelten Spalte, dann Zeile, dann Feld (das
   *  Spätere gewinnt); Klassen einer Zeile stehen am <tr>. */
  /** Inhalt eines Felds (v2.11.0): Teile getrennt durch «<br>»; in Zeilen (nicht in der Titelzeile) wird «[ ] Text» zur Aufgabe
   *  mit Kästchen (data-line und data-slot, wenn die Zeile im Text bekannt ist: line) und «? …» / «?! …» samt den Antwort-Teilen
   *  «! …» / «!! …» danach zum Eintrag. Personen und Termine wie in Listen und Fragen. */
  function cellContent(text, r, slots, ctx, line) {
    const Tb = global.NoNotesTables, D = global.NoNotesDates, Q = global.NoNotesQuestions;
    const parts = (Tb ? Tb.splitParts(text).map(p => p.text) : [text]).map(unescapePipe);
    if (r === 'h') return parts.map(p => renderInline(p, ctx)).join('<br>');
    const withPeople = Object.assign({}, ctx, { people: true });
    const badge = (due, quiet) => (due && D ? `<span class="md-due due ${quiet ? 'none' : D.urgency(due)}">${escapeHtml(quiet ? D.formatDue(due) : D.dueLabel(due))}</span>` : '');
    const out = [];
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      const tm = /^\[( |x|X)\]\s+(.*)$/.exec(p);
      const task = tm && D ? D.splitDue(tm[2]) : null;
      if (task && task.text) {
        const done = tm[1] !== ' ';
        const slot = slots.n++;
        const src = line != null ? ` data-line="${line}" data-slot="${slot}"` : '';
        out.push(`<span class="md-cell-task task${done ? ' done' : ''}"${src}><input type="checkbox"${ctx.interactiveTasks && src ? '' : ' disabled'}${done ? ' checked' : ''} aria-label="${escapeHtml(done ? t('erledigt') : t('offen'))}"><span class="task-text">${renderInline(task.text, withPeople)}</span>${badge(task.due, done)}</span>`);
        continue;
      }
      const qm = Q ? Q.QUESTION_RE.exec(p) : null;
      const head = qm && !/^`{3}/.test(qm[2]) ? (D ? D.splitDue(qm[2]) : { text: qm[2].trim(), due: null }) : null;
      if (head && head.text) {
        let j = k + 1;
        const answers = [];
        for (; j < parts.length; j++) { const a = Q.ANSWER_RE.exec(parts[j]); if (!a) break; answers.push(a[1]); }
        const answered = answers.some(a => a.trim());
        const decision = !!qm[1];
        const mark = answered ? '✓' : decision ? '?!' : '?';
        out.push(`<span class="md-cell-q${decision ? ' md-decision' : ''} ${answered ? 'answered' : 'open'}"><span class="md-mark" aria-hidden="true">${mark}</span> ${renderInline(head.text, withPeople)}${badge(head.due, answered)}</span>`);
        for (const a of answers) out.push(`<span class="md-cell-a">${renderInline(a, ctx)}</span>`);
        k = j - 1;
        continue;
      }
      out.push(renderInline(p, ctx));
    }
    return out.join('<br>');
  }

  function tableHtml(tb, ctx, lineAttr, srcLine) {
    const meta = tb.meta || {};
    const headCol = meta.kopfspalte === true;
    let results = [];
    if (ctx.tableFormat) {
      const info = {
        line: srcLine, meta: JSON.parse(JSON.stringify(meta)), header: !!tb.header, headerColumn: headCol, cols: tb.cols, rows: tb.rows.length,
        cells: { header: tb.header ? tb.header.map(unescapePipe) : null, rows: tb.rows.map(r => r.map(unescapePipe)) },
      };
      try { const r = ctx.tableFormat(info); results = (Array.isArray(r) ? r : [r]).filter(x => x && typeof x === 'object'); } catch (e) { results = []; }
    }
    const pick = fn => results.map(r => { try { return fn(r); } catch (e) { return null; } }).filter(Boolean);
    const attrs = (base, specs, firstCss) => {
      const classes = base ? [base] : [], css = firstCss ? [firstCss] : [];
      for (const spec of specs) { const a = formatAttrs(spec); classes.push(...a.classes); css.push(...a.css); }
      return (classes.length ? ` class="${escapeHtml(classes.join(' '))}"` : '') + (css.length ? ` style="${escapeHtml(css.join('; '))}"` : '');
    };
    const align = c => (tb.align[c] ? `text-align: ${tb.align[c]}` : '');
    // Klassen einer Zeile stehen am <tr>, ihre Werte an jedem Feld: sonst deckte der Hintergrund der Felder den der Zeile zu
    const rowSpecs = r => pick(x => (r === 'h' ? x.header : x.rows && x.rows[r]));
    const classOnly = spec => ({ class: spec.class });
    const withoutClass = spec => { const o = Object.assign({}, spec); delete o.class; return o; };
    const slots = { r: null, n: 0 }; // Aufgaben der Zeile in der Reihenfolge der Felder (wie tasks.js sie zählt)
    const cell = (tag, text, r, c, scope, inRow) => `<${tag}${scope ? ` scope="${scope}"` : ''} data-col="${c}"`
      + attrs('', [...pick(x => x.columns && x.columns[c]), ...inRow, ...pick(x => x.cells && x.cells[`${r},${c}`])], align(c))
      + `>${cellContent(text, r, slots, ctx, srcLine == null ? null : tb.head + 2 + (r === 'h' ? 0 : r) + ctx.lineOffset)}</${tag}>`;
    const tr = (r, extra, cells) => { const specs = rowSpecs(r); slots.r = r; slots.n = 0; return `<tr${extra}${attrs('', specs.map(classOnly))}>` + cells(specs.map(withoutClass)) + '</tr>'; };
    const cls = ['md-table', headCol ? 'md-table-col' : '', meta.hervorheben === true ? 'md-table-mark' : '', tb.header ? '' : 'md-table-nohead'].filter(Boolean).join(' ');
    let html = `<table${attrs(cls, pick(x => x.table))}${lineAttr}${srcLine != null ? ` data-src="${srcLine}"` : ''}>`;
    if (tb.header) html += '<thead>' + tr('h', '', inRow => tb.header.map((x, c) => cell('th', x, 'h', c, 'col', inRow)).join('')) + '</thead>';
    html += '<tbody>' + tb.rows.map((row, r) => tr(r, ` data-row="${r}"`,
      inRow => row.map((x, c) => (headCol && c === 0 ? cell('th', x, r, c, 'row', inRow) : cell('td', x, r, c, '', inRow))).join(''))).join('') + '</tbody></table>';
    return html;
  }

  function render(markdown, options) {
    options = options || {};
    const ctx = makeCtx(options);
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    // Mit lineMap tragen die Blöcke data-line (Quellzeile), für das synchrone Scrollen der geteilten Ansicht.
    const la = n => ctx.lineMap ? ` data-line="${n + ctx.lineOffset}"` : '';
    const nested = Object.assign({}, options, { lineMap: false, tableSrc: false });
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

      // Video allein auf einer Zeile: Karte statt Bild oder Link
      if (ctx.embeds) {
        const card = embedCard(line, ctx, la(i));
        if (card) { flushParagraph(); out.push(card); i++; continue; }
      }

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

      // Frage oder Entscheid mit Antwortzeilen, auch als Block (Syntax: packages/core/questions.js); im Block keine Blöcke
      const qb = global.NoNotesQuestions ? global.NoNotesQuestions.parseBlock(lines, i, { inner: ctx.inBlock }) : null;
      if (qb) {
        flushParagraph();
        out.push(entryHtml(qb, lines, ctx, la(i)));
        i = qb.end;
        continue;
      }

      // Antwort ohne Frage davor: als Hinweis darstellen
      const loneAnswer = /^\s*(?:!!|!(?!\[))\s?(.*)$/.exec(line);
      if (loneAnswer) {
        flushParagraph();
        out.push(`<div class="md-a md-a-lone"${la(i)}>${renderInline(loneAnswer[1].trim(), ctx)}</div>`);
        i++;
        continue;
      }

      // Tabelle (v2.10.0, packages/core/tables.js): Zeilen mit «|», darunter die Trennzeile; «<!-- tabelle: {…} -->» direkt darüber
      // trägt das Format
      const Tb = global.NoNotesTables;
      if (Tb && /^\s{0,3}(?:\||<!--)/.test(line)) {
        const tb = Tb.readMeta(line) ? Tb.parseAt(lines, i + 1) : Tb.parseAt(lines, i);
        if (tb && (tb.head === i || tb.metaLine === i)) {
          flushParagraph();
          out.push(tableHtml(tb, ctx, la(tb.start), ctx.tableSrc ? tb.start + ctx.lineOffset : null));
          i = tb.end;
          continue;
        }
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
    const Q = global.NoNotesQuestions;
    let i = start;
    while (i < lines.length) {
      const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
      if (!m) {
        // Fortsetzungszeile eines Listenpunkts (eingerückt) oder Ende; eine Frage oder ein Entscheid darin (auch ein Block, ausser
        // schon in einem Block) wird zum Kasten
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
          const qc = Q ? Q.parseBlock(lines, i, { inner: ctx.inBlock }) : null;
          if (qc) { items[items.length - 1].text += entryHtml(qc, lines, ctx, ''); i = qc.end; continue; }
          items[items.length - 1].text += '<br>' + renderInline(lines[i].trim(), ctx);
          i++;
          continue;
        }
        break;
      }
      // Frage oder Entscheid als Listenpunkt ("- ?! …", als Block "- ?!``` …" ausser im Block), die Antwort eingerückt darunter
      const qe = Q && /^\?/.test(m[3]) ? Q.parseBlock(lines, i, { list: true, inner: ctx.inBlock }) : null;
      if (qe && qe.list) {
        items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: entryHtml(qe, lines, ctx, ''), task: null, line: i, entry: true });
        i = qe.end;
        continue;
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
      items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: renderInline(text, task != null ? Object.assign({}, ctx, { people: true }) : ctx) + dueHtml, task, line: i });
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
      const line = item.line + ctx.lineOffset;
      html += `<li${item.task == null ? `${item.entry ? ' class="q-li"' : ''}${ctx.lineMap ? ` data-line="${line}"` : ''}` : ` class="task${item.task ? ' done' : ''}" data-line="${line}"`}>${content}`;
    }
    while (stack.length) { html += '</li>'; close(); }
    out.push(html);
    return i;
  }

  /** Nur Suchtreffer hervorheben (ohne Markdown), für Listen und Fragen. */
  function highlightText(s, highlight) {
    return makeText(highlight)(s);
  }

  global.NoNotesMarkdown = { render, inline, escapeHtml, highlightText, subEntriesHtml };
})(window);
