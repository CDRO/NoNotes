/* NoNotes – Druck: baut aus Notizen bzw. Fragen ein Druckdokument und öffnet den Druckdialog.
   Der Druckbereich (#printArea) wird nur beim Drucken sichtbar, der Rest der App ausgeblendet. */
(function (global) {
  'use strict';

  const DB = () => global.NoNotesDB;
  const M = () => global.NoNotesMarkdown;
  const Mindmap = () => global.NoNotesMindmap;
  const Exporter = () => global.NoNotesExport;

  const fmtDateTime = new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : fmtDateTime.format(d); };
  const esc = s => M().escapeHtml(s);
  const URGENCY_ORDER = ['overdue', 'today', 'week', 'later', 'none', 'done', 'answered'];
  const byUrgency = (a, b) => URGENCY_ORDER.indexOf(a[0]) - URGENCY_ORDER.indexOf(b[0]);
  /** [[Titel]] im Druck auflösen, damit Verweise als vorhandene Notiz erscheinen. */
  function titleResolver(db) {
    const index = DB().titleIndex(db);
    return title => { const id = index.get(title.trim().toLowerCase()); return id == null ? null : id; };
  }

  /** Teilbaum-IDs (inklusive Wurzelknoten) aus der Baumreihenfolge. */
  function subtreeIds(nodes, id) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const out = [];
    const walk = n => { out.push(n.id); n.children.forEach(walk); };
    const start = byId.get(id);
    if (start) walk(start);
    return out;
  }

  /** Löst die gewünschte Auswahl in eine geordnete Liste von Knoten (Baumreihenfolge) auf. */
  function resolveNotes(db, options) {
    // Archivierte Notizen sind nur dabei, wenn options.archived gesetzt ist. Ausdrücklich gewählte Notizen
    // (diese Notiz, Auswahl) werden auch dann gedruckt, wenn sie selbst archiviert sind.
    const nodes = Exporter().treeOrder(db, { archived: true });
    const byId = new Map(nodes.map(n => [n.id, n]));
    const allowed = n => !!options.archived || !n.archived_at;
    let wanted;
    if (options.scope === 'all') {
      wanted = new Set(nodes.filter(allowed).map(n => n.id));
    } else {
      const ids = options.scope === 'selection' ? (options.ids || []) : [options.noteId];
      wanted = new Set();
      for (const id of ids) {
        if (id == null || !byId.has(id)) continue;
        wanted.add(id);
        if (options.withChildren) subtreeIds(nodes, id).filter(x => allowed(byId.get(x))).forEach(x => wanted.add(x));
      }
    }
    const list = nodes.filter(n => wanted.has(n.id));
    // Überschriftenebene relativ zur gedruckten Menge
    const level = new Map();
    for (const n of list) {
      const parentLevel = n.parentNode && level.has(n.parentNode.id) ? level.get(n.parentNode.id) : 0;
      level.set(n.id, Math.min(6, parentLevel + 1));
      n.printLevel = level.get(n.id);
    }
    return list;
  }

  function mapSvgFor(db, list, scope, archived) {
    if (scope === 'all') return Mindmap().toSvgString(DB().getTree(db, { archive: !!archived }), { mapTitle: DB().getMapTitle(db), expandAll: true });
    const rows = DB().getTree(db, { archive: true });
    const included = new Set(list.map(n => n.id));
    const subset = rows.filter(r => included.has(r.id)).map(r => Object.assign({}, r, {
      parent_id: r.parent_id != null && included.has(r.parent_id) ? r.parent_id : null,
    }));
    return Mindmap().toSvgString(subset, { mapTitle: DB().getMapTitle(db), expandAll: true });
  }

  function metaHtml(db, n, note) {
    const parts = [];
    const path = [];
    let p = n.parentNode;
    while (p) { path.unshift(p.title.trim() || 'Ohne Titel'); p = p.parentNode; }
    if (path.length) parts.push(`Pfad: ${esc(path.join(' › '))}`);
    parts.push(`Erstellt ${esc(fmtDate(note.created_at))} · Geändert ${esc(fmtDate(note.updated_at))}${note.archived_at ? ` · Archiviert ${esc(fmtDate(note.archived_at))}` : ''}`);
    const tags = DB().getTags(db, n.id);
    if (tags.length) parts.push(`Tags: ${esc(tags.join(', '))}`);
    return `<p class="print-meta">${parts.join(' · ')}</p>`;
  }

  /** HTML für den Druck von Notizen.
   *  options: { scope: 'current'|'subtree'|'selection'|'all', noteId, ids, withChildren, archived,
   *             includeMap, includeToc, pageBreaks, resolveAttachment } */
  function buildNotesDocument(db, options) {
    const list = resolveNotes(db, options);
    const mapTitle = DB().getMapTitle(db);
    const index = DB().titleIndex(db);
    const included = new Set(list.map(n => n.id));
    const title = options.scope === 'all' ? mapTitle
      : list.length === 1 ? (list[0].title.trim() || 'Ohne Titel')
      : options.scope === 'subtree' && list.length ? (list[0].title.trim() || 'Ohne Titel')
      : `${mapTitle}: ${list.length} Notizen`;

    const parts = [];
    parts.push(`<header class="print-head"><h1>${esc(title)}</h1><p class="print-meta">${esc(mapTitle)} · Gedruckt ${esc(fmtDate(new Date().toISOString()))} · ${list.length === 1 ? '1 Notiz' : list.length + ' Notizen'}</p></header>`);
    if (options.includeMap && list.length) {
      parts.push(`<figure class="print-map">${mapSvgFor(db, list, options.scope, options.archived)}</figure>`);
    }
    if (options.includeToc && list.length > 1) {
      parts.push('<nav class="print-toc"><h2>Inhalt</h2><ul>' + list.map(n =>
        `<li style="margin-left:${(n.printLevel - 1) * 14}px"><a href="#print-note-${n.id}">${esc(n.title.trim() || 'Ohne Titel')}</a></li>`).join('') + '</ul></nav>');
    }
    list.forEach((n, i) => {
      const note = DB().getNote(db, n.id);
      const level = Math.min(6, n.printLevel + 1);
      let body = M().render(note.body, {
        resolveTitle: t => { const id = index.get(t.trim().toLowerCase()); return id == null ? null : id; },
        resolveAttachment: options.resolveAttachment,
      });
      body = body.replace(/href="#" class="md-wiki" data-title="([^"]*)" data-note-id="(\d+)"/g, (m, t, id) =>
        included.has(Number(id)) ? `href="#print-note-${id}" class="md-wiki" data-title="${t}" data-note-id="${id}"` : `class="md-wiki plain" data-title="${t}" data-note-id="${id}"`);
      parts.push(`<section class="print-note${options.pageBreaks && i > 0 ? ' page-break' : ''}" id="print-note-${n.id}">` +
        `<h${level}>${esc(note.title.trim() || 'Ohne Titel')}</h${level}>` + metaHtml(db, n, note) +
        `<div class="md">${body}</div></section>`);
    });
    if (!list.length) parts.push('<p class="print-meta">Keine Notizen ausgewählt.</p>');
    return parts.join('\n');
  }

  /** HTML für den Druck von Fragen und Antworten.
   *  options: { status: 'open'|'answered'|'all', tag, query, lines, groupBy: 'note'|'due'|'none' } */
  function buildQuestionsDocument(db, options) {
    const D = global.NoNotesDates;
    const today = D.nowIso();
    const groupBy = options.groupBy || (options.grouped === false ? 'none' : 'note');
    const rows = DB().listQuestions(db, { status: options.status || 'all', tag: options.tag || '', query: options.query || '', sort: groupBy === 'due' ? 'due' : 'note' });
    const mapTitle = DB().getMapTitle(db);
    const nodes = Exporter().treeOrder(db);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const pathOf = id => {
      const parts = [];
      let p = byId.get(id) ? byId.get(id).parentNode : null;
      while (p) { parts.unshift(p.title.trim() || 'Ohne Titel'); p = p.parentNode; }
      return parts;
    };
    const filterText = [
      options.status === 'open' ? 'offene Fragen' : options.status === 'answered' ? 'beantwortete Fragen' : 'alle Fragen',
      options.tag ? `Tag „${options.tag}“` : null,
      options.query ? `Suche „${options.query}“` : null,
    ].filter(Boolean).join(', ');
    const open = rows.filter(r => !r.answer).length;
    const resolveTitle = titleResolver(db);

    const item = r => {
      const answered = !!r.answer;
      const ruled = !answered && options.lines ? '<div class="print-lines"><span></span><span></span><span></span></div>' : '';
      const u = answered ? 'none' : D.urgency(r.due, today);
      const due = r.due ? `<span class="due ${u}">${esc(answered ? D.formatDue(r.due) : D.dueLabel(r.due, today))}</span>` : '';
      const from = groupBy === 'note' ? '' : ` · aus ${esc(r.note_title.trim() || 'Ohne Titel')}`;
      return `<div class="print-q ${answered ? 'answered' : 'open'}">` +
        `<span class="print-mark">${answered ? '✓' : '?'}</span>` +
        `<div class="print-q-body"><div class="print-q-text">${M().inline(r.text, { resolveTitle })}${due}</div>` +
        (answered ? `<div class="print-a md">${M().render(r.answer, { resolveTitle })}</div>` : ruled) +
        `<div class="print-q-meta">${answered && r.answered_at ? 'Beantwortet ' + esc(fmtDate(r.answered_at)) : 'Gestellt ' + esc(fmtDate(r.created_at))}${from}</div></div></div>`;
    };

    const parts = [];
    parts.push(`<header class="print-head"><h1>Fragen und Antworten</h1><p class="print-meta">${esc(mapTitle)} · ${esc(filterText)} · ${rows.length} ${rows.length === 1 ? 'Frage' : 'Fragen'}, davon ${open} offen · Gedruckt ${esc(fmtDate(new Date().toISOString()))}</p></header>`);
    if (!rows.length) {
      parts.push('<p class="print-meta">Keine Fragen in dieser Auswahl.</p>');
      return parts.join('\n');
    }
    if (groupBy === 'none') {
      parts.push('<section class="print-qgroup">' + rows.map(r => item(r)).join('') + '</section>');
    } else if (groupBy === 'due') {
      const groups = new Map();
      for (const r of rows) {
        const key = r.answer ? 'answered' : D.urgency(r.due, today);
        if (!groups.has(key)) groups.set(key, { title: D.URGENCY_LABELS[key], items: [] });
        groups.get(key).items.push(r);
      }
      for (const [, g] of [...groups.entries()].sort(byUrgency)) {
        parts.push(`<section class="print-qgroup"><h2>${esc(g.title)}</h2>${g.items.map(r => item(r)).join('')}</section>`);
      }
    } else {
      const groups = new Map();
      for (const r of rows) {
        if (!groups.has(r.note_id)) groups.set(r.note_id, { title: r.note_title, items: [] });
        groups.get(r.note_id).items.push(r);
      }
      for (const [noteId, g] of groups) {
        const path = pathOf(noteId);
        parts.push(`<section class="print-qgroup"><h2>${esc(g.title.trim() || 'Ohne Titel')}</h2>` +
          (path.length ? `<p class="print-meta">${esc(path.join(' › '))}</p>` : '') +
          g.items.map(r => item(r)).join('') + '</section>');
      }
    }
    return parts.join('\n');
  }

  /** HTML für den Druck von Aufgaben als Checkliste.
   *  options: { status: 'open'|'done'|'all', tag, query, groupBy: 'due'|'note' } */
  function buildTasksDocument(db, options) {
    const T = global.NoNotesTasks;
    const rows = DB().listTasks(db, { status: options.status || 'all', tag: options.tag || '', query: options.query || '', sort: options.groupBy === 'note' ? 'note' : 'due' });
    const mapTitle = DB().getMapTitle(db);
    const today = global.NoNotesDates.nowIso();
    const filterText = [
      options.status === 'open' ? 'offene Aufgaben' : options.status === 'done' ? 'erledigte Aufgaben' : 'alle Aufgaben',
      options.tag ? `Tag „${options.tag}“` : null,
      options.query ? `Suche „${options.query}“` : null,
    ].filter(Boolean).join(', ');
    const open = rows.filter(r => !r.done).length;
    const resolveTitle = titleResolver(db);
    const item = r => {
      const u = r.done ? 'none' : T.urgency(r.due, today);
      const meta = [
        r.due ? `bis ${T.formatDue(r.due)}` : null,
        r.sub_total ? `${r.sub_done}/${r.sub_total} Unteraufgaben` : null,
        options.groupBy === 'note' ? null : (r.parent_text ? `Teil von „${r.parent_text}“` : null),
        options.groupBy === 'note' ? null : (r.note_title.trim() || 'Ohne Titel'),
        r.done && r.done_at ? `erledigt ${fmtDate(r.done_at)}` : null,
      ].filter(Boolean).join(' · ');
      const indent = options.groupBy === 'note' && r.depth ? ` style="margin-left:${Math.min(r.depth, 4) * 16}pt"` : '';
      return `<div class="print-task ${r.done ? 'done' : 'open'}"${indent}><span class="print-box" aria-hidden="true"></span>` +
        `<span class="print-task-text">${M().inline(r.text, { resolveTitle })}</span>` +
        (meta ? `<span class="print-task-meta${u === 'overdue' ? ' overdue' : ''}">${esc(meta)}</span>` : '') + '</div>';
    };
    const parts = [];
    parts.push(`<header class="print-head"><h1>Aufgaben</h1><p class="print-meta">${esc(mapTitle)} · ${esc(filterText)} · ${rows.length} ${rows.length === 1 ? 'Aufgabe' : 'Aufgaben'}, davon ${open} offen · Gedruckt ${esc(fmtDate(new Date().toISOString()))}</p></header>`);
    if (!rows.length) { parts.push('<p class="print-meta">Keine Aufgaben in dieser Auswahl.</p>'); return parts.join('\n'); }
    const groups = new Map();
    const labels = { overdue: 'Überfällig', today: 'Heute', week: 'Diese Woche', later: 'Später', none: 'Ohne Termin', done: 'Erledigt' };
    for (const r of rows) {
      const key = options.groupBy === 'note' ? `n${r.note_id}` : (r.done ? 'done' : T.urgency(r.due, today));
      const title = options.groupBy === 'note' ? (r.note_title.trim() || 'Ohne Titel') : labels[key];
      if (!groups.has(key)) groups.set(key, { title, items: [] });
      groups.get(key).items.push(r);
    }
    const ordered = options.groupBy === 'note' ? [...groups.entries()] : [...groups.entries()].sort(byUrgency);
    for (const [, g] of ordered) {
      parts.push(`<section class="print-qgroup"><h2>${esc(g.title)}</h2>${g.items.map(item).join('')}</section>`);
    }
    return parts.join('\n');
  }

  /** Zeigt das Dokument im Druckbereich und öffnet den Druckdialog des Browsers. */
  function print(html) {
    let area = document.getElementById('printArea');
    if (!area) {
      area = document.createElement('div');
      area.id = 'printArea';
      document.body.appendChild(area);
    }
    area.innerHTML = html;
    document.body.classList.add('printing');
    const cleanup = () => {
      document.body.classList.remove('printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    try {
      window.print();
    } finally {
      // Browser blockieren in print(); danach aufräumen, falls afterprint ausbleibt.
      setTimeout(cleanup, 500);
    }
  }

  global.NoNotesPrint = { buildNotesDocument, buildQuestionsDocument, buildTasksDocument, print, resolveNotes };
})(window);
