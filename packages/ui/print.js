/* NoNotes – Druck: baut aus Notizen bzw. Fragen ein Druckdokument und öffnet den Druckdialog.
   Der Druckbereich (#printArea) wird nur beim Drucken sichtbar, der Rest der App ausgeblendet. */
(function (global) {
  'use strict';

  const { t, tn } = global.NoNotesI18n;

  const M = () => global.NoNotesMarkdown;
  const Mindmap = () => global.NoNotesMindmap;
  const Exporter = () => global.NoNotesExport;

  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat(global.NoNotesI18n.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
  const esc = s => M().escapeHtml(s);
  const URGENCY_ORDER = ['overdue', 'today', 'week', 'later', 'none', 'done', 'answered'];
  const byUrgency = (a, b) => URGENCY_ORDER.indexOf(a[0]) - URGENCY_ORDER.indexOf(b[0]);
  /** [[Titel]] im Druck auflösen, damit Verweise als vorhandene Notiz erscheinen. */
  async function titleResolver(backend) {
    const index = new Map(await backend.titleIndex());
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
  async function resolveNotes(backend, options) {
    // Archivierte Notizen sind nur dabei, wenn options.archived gesetzt ist. Ausdrücklich gewählte Notizen
    // (diese Notiz, Auswahl) werden auch dann gedruckt, wenn sie selbst archiviert sind.
    const nodes = await Exporter().treeOrder(backend, { archived: true });
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

  async function mapSvgFor(backend, list, scope, archived) {
    if (scope === 'all') return Mindmap().toSvgString(await backend.getTree({ archive: !!archived }), { mapTitle: await backend.getMapTitle(), expandAll: true });
    const rows = await backend.getTree({ archive: true });
    const included = new Set(list.map(n => n.id));
    const subset = rows.filter(r => included.has(r.id)).map(r => Object.assign({}, r, {
      parent_id: r.parent_id != null && included.has(r.parent_id) ? r.parent_id : null,
    }));
    return Mindmap().toSvgString(subset, { mapTitle: await backend.getMapTitle(), expandAll: true });
  }

  async function metaHtml(backend, n, note) {
    const parts = [];
    const path = [];
    let p = n.parentNode;
    while (p) { path.unshift(p.title.trim() || t('Ohne Titel')); p = p.parentNode; }
    if (path.length) parts.push(esc(t('Pfad: {pfad}', { pfad: path.join(' › ') })));
    parts.push(esc(t('Erstellt {erstellt} · Geändert {geaendert}', { erstellt: fmtDate(note.created_at), geaendert: fmtDate(note.updated_at) })) + (note.archived_at ? ' · ' + esc(t('Archiviert {datum}', { datum: fmtDate(note.archived_at) })) : ''));
    const tags = await backend.getTags(n.id);
    if (tags.length) parts.push(esc(t('Tags: {tags}', { tags: tags.join(', ') })));
    return `<p class="print-meta">${parts.join(' · ')}</p>`;
  }

  /** HTML für den Druck von Notizen.
   *  options: { scope: 'current'|'subtree'|'selection'|'all', noteId, ids, withChildren, archived,
   *             includeMap, includeToc, pageBreaks, attachmentUrl } (attachmentUrl: id → Promise der Anzeige-Adresse) */
  async function buildNotesDocument(backend, options) {
    const list = await resolveNotes(backend, options);
    const mapTitle = await backend.getMapTitle();
    const index = new Map(await backend.titleIndex());
    const included = new Set(list.map(n => n.id));
    const title = options.scope === 'all' ? mapTitle
      : list.length === 1 ? (list[0].title.trim() || t('Ohne Titel'))
      : options.scope === 'subtree' && list.length ? (list[0].title.trim() || t('Ohne Titel'))
      : tn('{titel}: {n} Notiz', '{titel}: {n} Notizen', list.length, { titel: mapTitle });

    const parts = [];
    parts.push(`<header class="print-head"><h1>${esc(title)}</h1><p class="print-meta">${esc(mapTitle)} · ${esc(t('Gedruckt {datum}', { datum: fmtDate(new Date().toISOString()) }))} · ${esc(tn('{n} Notiz', '{n} Notizen', list.length))}</p></header>`);
    if (options.includeMap && list.length) {
      parts.push(`<figure class="print-map">${await mapSvgFor(backend, list, options.scope, options.archived)}</figure>`);
    }
    if (options.includeToc && list.length > 1) {
      parts.push('<nav class="print-toc"><h2>' + esc(t('Inhalt')) + '</h2><ul>' + list.map(n =>
        `<li style="margin-left:${(n.printLevel - 1) * 14}px"><a href="#print-note-${n.id}">${esc(n.title.trim() || t('Ohne Titel'))}</a></li>`).join('') + '</ul></nav>');
    }
    // Bilder vorab auflösen, damit das Rendern danach ohne Warten auskommt.
    const urls = new Map();
    const notes = new Map();
    for (const n of list) {
      const note = await backend.getNote(n.id);
      notes.set(n.id, note);
      if (!options.attachmentUrl) continue;
      for (const m of String(note.body || '').matchAll(/\(att:(\d+)\)/g)) {
        const id = Number(m[1]);
        if (!urls.has(id)) urls.set(id, await options.attachmentUrl(id));
      }
    }
    const metas = new Map();
    for (const n of list) metas.set(n.id, await metaHtml(backend, n, notes.get(n.id)));
    list.forEach((n, i) => {
      const note = notes.get(n.id);
      const level = Math.min(6, n.printLevel + 1);
      let body = M().render(note.body, {
        resolveTitle: title => { const id = index.get(title.trim().toLowerCase()); return id == null ? null : id; },
        resolveAttachment: id => urls.get(id) || null,
      });
      body = body.replace(/href="#" class="md-wiki" data-title="([^"]*)" data-note-id="(\d+)"/g, (m, wikiTitle, id) =>
        included.has(Number(id)) ? `href="#print-note-${id}" class="md-wiki" data-title="${wikiTitle}" data-note-id="${id}"` : `class="md-wiki plain" data-title="${wikiTitle}" data-note-id="${id}"`);
      parts.push(`<section class="print-note${options.pageBreaks && i > 0 ? ' page-break' : ''}" id="print-note-${n.id}">` +
        `<h${level}>${esc(note.title.trim() || t('Ohne Titel'))}</h${level}>` + metas.get(n.id) +
        `<div class="md">${body}</div></section>`);
    });
    if (!list.length) parts.push(`<p class="print-meta">${esc(t('Keine Notizen ausgewählt.'))}</p>`);
    return parts.join('\n');
  }

  /** HTML für den Druck von Fragen und Antworten.
   *  options: { status: 'open'|'answered'|'all', tag, query, lines, groupBy: 'note'|'due'|'none' } */
  async function buildQuestionsDocument(backend, options) {
    const D = global.NoNotesDates;
    const today = D.nowIso();
    const groupBy = options.groupBy || (options.grouped === false ? 'none' : 'note');
    const rows = await backend.listQuestions({ status: options.status || 'all', tag: options.tag || '', query: options.query || '', sort: groupBy === 'due' ? 'due' : 'note' });
    const mapTitle = await backend.getMapTitle();
    const nodes = await Exporter().treeOrder(backend);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const pathOf = id => {
      const parts = [];
      let p = byId.get(id) ? byId.get(id).parentNode : null;
      while (p) { parts.unshift(p.title.trim() || t('Ohne Titel')); p = p.parentNode; }
      return parts;
    };
    const filterText = [
      options.status === 'open' ? t('offene Fragen') : options.status === 'answered' ? t('beantwortete Fragen') : t('alle Fragen'),
      options.tag ? t('Tag „{tag}“', { tag: options.tag }) : null,
      options.query ? t('Suche „{suche}“', { suche: options.query }) : null,
    ].filter(Boolean).join(', ');
    const open = rows.filter(r => !r.answer).length;
    const resolveTitle = await titleResolver(backend);

    const item = r => {
      const answered = !!r.answer;
      const ruled = !answered && options.lines ? '<div class="print-lines"><span></span><span></span><span></span></div>' : '';
      const u = answered ? 'none' : D.urgency(r.due, today);
      const due = r.due ? `<span class="due ${u}">${esc(answered ? D.formatDue(r.due) : D.dueLabel(r.due, today))}</span>` : '';
      const from = groupBy === 'note' ? '' : ` · ${esc(t('aus'))} ${esc(r.note_title.trim() || t('Ohne Titel'))}`;
      return `<div class="print-q ${answered ? 'answered' : 'open'}">` +
        `<span class="print-mark">${answered ? '✓' : '?'}</span>` +
        `<div class="print-q-body"><div class="print-q-text">${M().inline(r.text, { resolveTitle })}${due}</div>` +
        (answered ? `<div class="print-a md">${M().render(r.answer, { resolveTitle })}</div>` : ruled) +
        `<div class="print-q-meta">${answered && r.answered_at ? esc(t('Beantwortet {datum}', { datum: fmtDate(r.answered_at) })) : esc(t('Gestellt {datum}', { datum: fmtDate(r.created_at) }))}${from}</div></div></div>`;
    };

    const parts = [];
    parts.push(`<header class="print-head"><h1>${esc(t('Fragen und Antworten'))}</h1><p class="print-meta">${esc(mapTitle)} · ${esc(filterText)} · ${esc(tn('{n} Frage, davon {offen} offen', '{n} Fragen, davon {offen} offen', rows.length, { offen: open }))} · ${esc(t('Gedruckt {datum}', { datum: fmtDate(new Date().toISOString()) }))}</p></header>`);
    if (!rows.length) {
      parts.push(`<p class="print-meta">${esc(t('Keine Fragen in dieser Auswahl.'))}</p>`);
      return parts.join('\n');
    }
    if (groupBy === 'none') {
      parts.push('<section class="print-qgroup">' + rows.map(r => item(r)).join('') + '</section>');
    } else if (groupBy === 'due') {
      const groups = new Map();
      for (const r of rows) {
        const key = r.answer ? 'answered' : D.urgency(r.due, today);
        if (!groups.has(key)) groups.set(key, { title: D.urgencyLabel(key), items: [] });
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
        parts.push(`<section class="print-qgroup"><h2>${esc(g.title.trim() || t('Ohne Titel'))}</h2>` +
          (path.length ? `<p class="print-meta">${esc(path.join(' › '))}</p>` : '') +
          g.items.map(r => item(r)).join('') + '</section>');
      }
    }
    return parts.join('\n');
  }

  /** HTML für den Druck von Aufgaben als Checkliste.
   *  options: { status: 'open'|'done'|'all', tag, query, groupBy: 'due'|'note' } */
  async function buildTasksDocument(backend, options) {
    const T = global.NoNotesTasks;
    const rows = await backend.listTasks({ status: options.status || 'all', tag: options.tag || '', query: options.query || '', sort: options.groupBy === 'note' ? 'note' : 'due' });
    const mapTitle = await backend.getMapTitle();
    const today = global.NoNotesDates.nowIso();
    const filterText = [
      options.status === 'open' ? t('offene Aufgaben') : options.status === 'done' ? t('erledigte Aufgaben') : t('alle Aufgaben'),
      options.tag ? t('Tag „{tag}“', { tag: options.tag }) : null,
      options.query ? t('Suche „{suche}“', { suche: options.query }) : null,
    ].filter(Boolean).join(', ');
    const open = rows.filter(r => !r.done).length;
    const resolveTitle = await titleResolver(backend);
    const item = r => {
      const u = r.done ? 'none' : T.urgency(r.due, today);
      const meta = [
        r.due ? t('bis {datum}', { datum: T.formatDue(r.due) }) : null,
        r.sub_total ? t('{erledigt}/{gesamt} Unteraufgaben', { erledigt: r.sub_done, gesamt: r.sub_total }) : null,
        options.groupBy === 'note' ? null : (r.parent_text ? t('Teil von „{aufgabe}“', { aufgabe: r.parent_text }) : null),
        options.groupBy === 'note' ? null : (r.note_title.trim() || t('Ohne Titel')),
        r.done && r.done_at ? t('erledigt {datum}', { datum: fmtDate(r.done_at) }) : null,
      ].filter(Boolean).join(' · ');
      const indent = options.groupBy === 'note' && r.depth ? ` style="margin-left:${Math.min(r.depth, 4) * 16}pt"` : '';
      return `<div class="print-task ${r.done ? 'done' : 'open'}"${indent}><span class="print-box" aria-hidden="true"></span>` +
        `<span class="print-task-text">${M().inline(r.text, { resolveTitle })}</span>` +
        (meta ? `<span class="print-task-meta${u === 'overdue' ? ' overdue' : ''}">${esc(meta)}</span>` : '') + '</div>';
    };
    const parts = [];
    parts.push(`<header class="print-head"><h1>${esc(t('Aufgaben'))}</h1><p class="print-meta">${esc(mapTitle)} · ${esc(filterText)} · ${esc(tn('{n} Aufgabe, davon {offen} offen', '{n} Aufgaben, davon {offen} offen', rows.length, { offen: open }))} · ${esc(t('Gedruckt {datum}', { datum: fmtDate(new Date().toISOString()) }))}</p></header>`);
    if (!rows.length) { parts.push(`<p class="print-meta">${esc(t('Keine Aufgaben in dieser Auswahl.'))}</p>`); return parts.join('\n'); }
    const groups = new Map();
    for (const r of rows) {
      const key = options.groupBy === 'note' ? `n${r.note_id}` : (r.done ? 'done' : T.urgency(r.due, today));
      const title = options.groupBy === 'note' ? (r.note_title.trim() || t('Ohne Titel')) : global.NoNotesDates.urgencyLabel(key);
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
