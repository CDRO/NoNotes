/* NoNotes – Werkzeugkatalog für KI-Agenten (docs/AGENTS.md). i18n-ignore-file

   Ein Agent (Copilot, Claude, ChatGPT …) sieht NoNotes nicht als Oberfläche, sondern als Satz von Werkzeugen: «offene Fragen
   auflisten», «Frage 12 beantworten», «Notiz anlegen». Dieser Katalog beschreibt die Werkzeuge und führt sie aus, über die
   asynchrone Backend-Schnittstelle (packages/core/backend.js). Er ist reine Logik ohne Oberfläche und ohne Transport:
   - im Browser meldet packages/agent/webmcp.js denselben Katalog beim Agenten des Browsers an (WebMCP),
   - packages/agent/protocol.js spricht damit MCP (Model Context Protocol) für Agenten über das Netz,
   - der Dienst und Tests benutzen ihn direkt.

   Namen, Beschreibungen und Fehlermeldungen sind Englisch, weil Agenten sie lesen; Inhalte bleiben, wie sie in den Notizen stehen.
   Regeln: Der Text ist die einzige Wahrheit (Antworten werden als «!»-Zeilen, Entscheide als «!!»-Zeilen, Aufgaben im Kästchen
   geschrieben, genau wie von Hand). Schreibende Werkzeuge prüfen den Basisstand (base_updated_at), wenn der Agent ihn mitgibt.
   Ein schreibgeschützter Katalog (options.readOnly) kennt nur lesende Werkzeuge.

   Aufruf:  const catalog = NoNotesAgent.create(backend, { readOnly, author, now })
            catalog.list()               → [{ name, title, description, inputSchema, annotations }]
            await catalog.call(name, input) → { content: [{ type: 'text', text }], structuredContent, isError? }  (wirft nie)
            catalog.resources(), catalog.resourceTemplates(), await catalog.readResource(uri) */
(function (global) {
  'use strict';

  const INSTRUCTIONS = [
    'NoNotes is a personal and team note-taking app: notes form a tree (a mind map), each note has a title and a Markdown body.',
    'Conventions inside the body: a line starting with "?" is a question, "?!" is a decision to take; answer lines start with "!" (questions) or "!!" (decisions), directly below.',
    'The same works in a list ("- ?! Buy the tool?" with the answer indented below) and over several lines: "?!``` Title" opens a block that a line "```" closes; the lines inside describe it, single-line "?!"/"?" lines inside are sub-decisions/sub-questions with their own answers, and the block\'s own answer follows right after "```".',
    'Tasks are Markdown checkboxes "- [ ] text"; indented checkboxes are subtasks. A due date is written at the end of a line as "@YYYY-MM-DD" or "@DD.MM.YYYY".',
    '"@handle" names a person who should answer or decide; "(@handle)" marks an optional participant.',
    'Prefer the dedicated tools (answer_question, record_decision, complete_task, append_to_note) over rewriting a whole note; when you must rewrite, pass base_updated_at from get_note so concurrent edits are detected.',
  ].join(' ');

  // Englische Meldungen zu den Fehlerkennungen des Backends (die Oberfläche übersetzt ihre eigenen weiter)
  const ERRORS = {
    NOT_NONOTES_FILE: 'This file is not a NoNotes database.',
    SCHEMA_TOO_NEW: 'The database was written by a newer version of NoNotes.',
    ARCHIVED_NO_CHILD: 'Nothing can be created under an archived note.',
    ARCHIVED_NO_MOVE: 'Archived notes cannot be moved.',
    MOVE_INTO_SELF: 'A note cannot be moved under itself.',
    TARGET_NOT_FOUND: 'Target note not found.',
    NOTE_NOT_FOUND: 'Note not found.',
    TASK_NOT_FOUND: 'Task not found.',
    TASK_STALE: 'The task no longer appears like that in the note; read the note again.',
    QUESTION_NOT_FOUND: 'Question or decision not found.',
    QUESTION_STALE: 'The question no longer appears like that in the note; read the note again.',
    HISTORY_NOT_FOUND: 'This version no longer exists.',
    ARCHIVED_READONLY: 'Archived notes are read-only; unarchive the note first.',
    NOTE_CONFLICT: 'The note was changed in the meantime; read it again and retry with the new base_updated_at.',
    READ_ONLY: 'This workspace is read-only for you.',
    IN_TRASH: 'The note is in the trash; restore it first.',
    INVALID_INPUT: 'Invalid input.',
    UNKNOWN_TOOL: 'Unknown tool.',
  };

  // ---------- Eingaben prüfen (kleine Teilmenge von JSON Schema, genug für diese Werkzeuge) ----------

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  /** Macht aus Texten Zahlen und Wahrheitswerte, wo das Schema sie verlangt (Agenten schicken gern "12" statt 12). */
  function coerce(schema, v) {
    const types = [].concat(schema.type || []);
    if (typeof v === 'string') {
      const s = v.trim();
      if ((types.includes('integer') || types.includes('number')) && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
      if (types.includes('boolean') && /^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
      if (types.includes('null') && (s === '' || s === 'null')) return null;
    }
    if (typeof v === 'number' && !types.includes('number') && !types.includes('integer') && types.includes('string')) return String(v);
    return v;
  }

  function check(schema, v, where, out) {
    if (!schema) return;
    const types = [].concat(schema.type || []);
    if (types.length) {
      const t = typeOf(v);
      const ok = types.some(x => x === t || (x === 'integer' && Number.isInteger(v)) || (x === 'number' && t === 'number'));
      if (!ok) { out.push(`${where}: expected ${types.join(' or ')}, got ${t}`); return; }
    }
    if (schema.enum && !schema.enum.includes(v)) { out.push(`${where}: must be one of ${schema.enum.map(e => JSON.stringify(e)).join(', ')}`); return; }
    if (typeof v === 'string') {
      if (schema.minLength != null && v.trim().length < schema.minLength) out.push(`${where}: must not be empty`);
      if (schema.maxLength != null && v.length > schema.maxLength) out.push(`${where}: at most ${schema.maxLength} characters`);
      if (schema.pattern && !new RegExp(schema.pattern).test(v)) out.push(`${where}: must match ${schema.pattern}`);
    }
    if (typeof v === 'number') {
      if (schema.minimum != null && v < schema.minimum) out.push(`${where}: at least ${schema.minimum}`);
      if (schema.maximum != null && v > schema.maximum) out.push(`${where}: at most ${schema.maximum}`);
    }
    if (Array.isArray(v)) {
      if (schema.maxItems != null && v.length > schema.maxItems) out.push(`${where}: at most ${schema.maxItems} items`);
      if (schema.items) v.forEach((item, i) => { v[i] = coerce(schema.items, item); check(schema.items, v[i], `${where}[${i}]`, out); });
    }
    if (v && typeOf(v) === 'object' && schema.properties) {
      for (const key of schema.required || []) if (v[key] === undefined) out.push(`${where ? where + '.' : ''}${key}: required`);
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (v[key] === undefined) continue;
        v[key] = coerce(sub, v[key]);
        check(sub, v[key], where ? `${where}.${key}` : key, out);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(v)) if (!schema.properties[key]) out.push(`${key}: unknown field`);
      }
    }
  }

  /** Prüft input gegen das Schema; gibt die bereinigte Eingabe oder wirft INVALID_INPUT mit allen Beanstandungen. */
  function validate(schema, input) {
    const v = input == null ? {} : (typeOf(input) === 'object' ? Object.assign({}, input) : input);
    const problems = [];
    check(schema, v, '', problems);
    if (problems.length) throw Object.assign(new Error(problems.join('; ')), { code: 'INVALID_INPUT' });
    return v;
  }

  // ---------- Bausteine für Schemata ----------

  const ID = desc => ({ type: 'integer', minimum: 1, description: desc });
  const STR = (desc, extra) => Object.assign({ type: 'string', description: desc }, extra || {});
  const BOOL = desc => ({ type: 'boolean', description: desc });
  const LIMIT = { type: 'integer', minimum: 1, maximum: 500, description: 'Maximum number of items to return (default 100).' };
  const OFFSET = { type: 'integer', minimum: 0, description: 'Number of items to skip (for paging).' };
  const schema = (properties, required) => ({ type: 'object', properties, required: required || [], additionalProperties: false });

  // ---------- Ausgaben ----------

  function result(text, structured) {
    const out = { content: [{ type: 'text', text: String(text) }] };
    if (structured !== undefined) out.structuredContent = structured;
    return out;
  }

  function failure(e) {
    const code = e && typeof e.code === 'string' ? e.code : 'ERROR';
    let message;
    if (code === 'SUBTASKS_OPEN') message = `Cannot complete this task: ${e.open} subtask${e.open === 1 ? ' is' : 's are'} still open. Complete the subtasks first.`;
    else if (code === 'INVALID_INPUT') message = `Invalid input: ${e.message}`;
    else message = ERRORS[code] || (e && e.message) || 'Unknown error.';
    const structured = { error: { code, message } };
    if (code === 'NOTE_CONFLICT' && e.params && e.params.updated_at) structured.error.updated_at = e.params.updated_at;
    if (code === 'SUBTASKS_OPEN') structured.error.open = e.open;
    return { content: [{ type: 'text', text: `Error (${code}): ${message}` }], structuredContent: structured, isError: true };
  }

  const pathText = path => (path || []).map(p => p.title || '(untitled)').join(' › ');
  const quote = s => JSON.stringify(String(s == null ? '' : s));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /** Kurzer Ausschnitt aus dem Text, möglichst um den Suchbegriff herum. */
  function snippet(body, query, max) {
    const text = String(body || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const q = (query || '').trim().toLowerCase();
    let start = 0;
    if (q) {
      const at = text.toLowerCase().indexOf(q);
      if (at > max / 2) start = at - Math.floor(max / 3);
    }
    const cut = text.slice(start, start + max);
    return (start > 0 ? '…' : '') + cut + (start + max < text.length ? '…' : '');
  }

  // ---------- Gemeinsame Abfragen ----------

  async function liveNote(B, id, opts) {
    const n = await B.getNote(id);
    if (!n) throw Object.assign(new Error('Note not found.'), { code: 'NOTE_NOT_FOUND' });
    if (n.deleted_at && !(opts && opts.trash)) throw Object.assign(new Error('In trash.'), { code: 'IN_TRASH' });
    if (n.archived_at && opts && opts.writable) throw Object.assign(new Error('Archived.'), { code: 'ARCHIVED_READONLY' });
    return n;
  }

  function questionItem(r) {
    const sub = r.sub ? { decisions: r.sub.decisions, open_decisions: r.sub.decisionsOpen, questions: r.sub.questions, open_questions: r.sub.questionsOpen } : null;
    return {
      id: r.id, note_id: r.note_id, note_title: r.note_title, kind: r.kind, text: r.text, answer: r.answer, due: r.due,
      people: r.people || [], decided: r.decided || null, created_at: r.created_at, answered_at: r.answered_at,
      details: r.details || null, parent_id: r.parent_id == null ? null : r.parent_id, sub_entries: sub,
    };
  }

  function questionLine(r) {
    const tag = r.kind === 'decision' ? 'd' : 'q';
    const parts = [`[${tag} ${r.id}] (note ${r.note_id} ${quote(r.note_title)}) ${r.text}`];
    if (r.parent_id != null) parts.push(`inside [${r.parent_kind === 'decision' ? 'd' : 'q'} ${r.parent_id}]${r.parent_text ? ' ' + quote(r.parent_text) : ''}`);
    if (r.due) parts.push(`due ${r.due}`); // die @kürzel stehen schon im Text der Frage
    if (r.answer) parts.push(r.kind === 'decision' ? `decided${r.decided ? ' ' + r.decided : ''}: ${r.answer.replace(/\n/g, ' / ')}` : `answered: ${r.answer.replace(/\n/g, ' / ')}`);
    else parts.push('open');
    if (r.sub) {
      const subs = [];
      if (r.sub.decisions) subs.push(`${r.sub.decisionsOpen} of ${r.sub.decisions} sub-decisions open`);
      if (r.sub.questions) subs.push(`${r.sub.questionsOpen} of ${r.sub.questions} sub-questions open`);
      parts.push(subs.join(', '));
    }
    const line = parts.join(' — ');
    return r.details ? line + '\n    ' + r.details.replace(/\n/g, '\n    ') : line; // die Beschreibung eingerückt darunter
  }

  function taskItem(r) {
    return {
      id: r.id, note_id: r.note_id, note_title: r.note_title, text: r.text, done: !!r.done, due: r.due, depth: r.depth,
      parent_id: r.parent_id, parent_text: r.parent_text || null, subtasks_total: r.sub_total || 0, subtasks_open: r.sub_open || 0,
      created_at: r.created_at, done_at: r.done_at,
    };
  }

  function taskLine(r) {
    const parts = [`[t ${r.id}] (note ${r.note_id} ${quote(r.note_title)}) ${'  '.repeat(r.depth || 0)}${r.text}`];
    if (r.due) parts.push(`due ${r.due}`);
    if (r.sub_total) parts.push(`${r.sub_open} of ${r.sub_total} subtasks open`);
    parts.push(r.done ? 'done' : 'open');
    return parts.join(' — ');
  }

  async function overview(B, ctx) {
    const now = ctx.now();
    const [title, notes, archived, trash, q, tasks, tags, handles] = await Promise.all([
      B.getMapTitle(), B.countNotes({ archived: false }), B.countArchived(), B.countTrash(), B.countQuestions(now), B.countTasks(now), B.listAllTags(), B.listPeople(),
    ]);
    const structured = {
      title, notes, archived, in_trash: trash,
      questions: { open: q.open, total: q.total, overdue: q.overdue },
      decisions: { open: q.decisions.open, total: q.decisions.total, overdue: q.decisions.overdue },
      tasks: { open: tasks.open, total: tasks.total, overdue: tasks.overdue },
      tags: tags.map(t => ({ name: t.name, notes: Number(t.count) || 0 })), people: handles,
    };
    const text = [
      `Map: ${title}`,
      `Notes: ${notes} (archived: ${archived}, in trash: ${trash})`,
      `Questions: ${q.open} open of ${q.total}${q.overdue ? `, ${q.overdue} overdue` : ''}`,
      `Decisions: ${q.decisions.open} open of ${q.decisions.total}${q.decisions.overdue ? `, ${q.decisions.overdue} overdue` : ''}`,
      `Tasks: ${tasks.open} open of ${tasks.total}${tasks.overdue ? `, ${tasks.overdue} overdue` : ''}`,
      `Tags: ${tags.length ? tags.map(t => `${t.name} (${t.count})`).join(', ') : 'none'}`,
      `People: ${handles.length ? handles.map(h => '@' + h).join(', ') : 'none'}`,
    ].join('\n');
    return { text, structured };
  }

  async function noteMarkdown(B, id) {
    const n = await liveNote(B, id, { trash: true });
    return `# ${n.title || '(untitled)'}\n\n${n.body || ''}`;
  }

  // ---------- Die Werkzeuge ----------

  const TOOLS = [
    {
      name: 'get_overview', title: 'Overview', readOnly: true,
      description: 'Overview of the whole workspace: map title, number of notes, open questions, decisions and tasks (with overdue counts), tags and people. Call this first to orient yourself.',
      inputSchema: schema({}),
      async run(B, input, ctx) { const o = await overview(B, ctx); return result(o.text, o.structured); },
    },
    {
      name: 'list_notes', title: 'List notes (tree)', readOnly: true,
      description: 'The note tree (or a subtree) as an indented outline with note ids and the number of open questions, decisions and tasks per note. Archived notes are left out unless include_archived is true.',
      inputSchema: schema({
        parent_id: { type: ['integer', 'null'], minimum: 1, description: 'Only the subtree below this note; omit or null for the whole tree.' },
        depth: { type: 'integer', minimum: 1, maximum: 50, description: 'How many levels to show (default: all).' },
        include_archived: BOOL('Also show archived notes (default false).'),
      }),
      async run(B, input) {
        const rows = await B.getTree({ archive: !!input.include_archived });
        const byParent = new Map();
        for (const r of rows) { const k = r.parent_id == null ? 'root' : r.parent_id; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(r); }
        let start = 'root';
        if (input.parent_id != null) {
          if (!rows.some(r => r.id === input.parent_id)) { const n = await B.getNote(input.parent_id); throw Object.assign(new Error('Note not found.'), { code: !n || n.deleted_at ? 'NOTE_NOT_FOUND' : 'INVALID_INPUT', message: n && !n.deleted_at ? 'The note is archived; pass include_archived: true.' : 'Note not found.' }); }
          start = input.parent_id;
        }
        const lines = [];
        const nodes = [];
        const walk = (key, level) => {
          for (const r of byParent.get(key) || []) {
            const marks = [];
            const openQ = (r.badge || 0) - (r.dbadge || 0); // die Marke des Baums zählt Fragen und Entscheide zusammen
            if (openQ) marks.push(plural(openQ, 'open question', 'open questions'));
            if (r.dbadge) marks.push(plural(r.dbadge, 'open decision', 'open decisions'));
            if (r.tbadge) marks.push(plural(r.tbadge, 'open task', 'open tasks'));
            if (r.archived_at) marks.push('archived');
            if (lines.length < 2000) lines.push(`${'  '.repeat(level)}- [${r.id}] ${r.title || '(untitled)'}${marks.length ? '  (' + marks.join(', ') + ')' : ''}`);
            nodes.push({ id: r.id, title: r.title, parent_id: r.parent_id, depth: level, archived: !!r.archived_at, open_questions: openQ, open_decisions: r.dbadge || 0, open_tasks: r.tbadge || 0 });
            if (!input.depth || level + 1 < input.depth) walk(r.id, level + 1);
          }
        };
        walk(start, 0);
        if (nodes.length > lines.length) lines.push(`… ${nodes.length - lines.length} more`);
        return result(lines.length ? lines.join('\n') : 'No notes.', { notes: nodes });
      },
    },
    {
      name: 'search_notes', title: 'Search notes', readOnly: true,
      description: 'Full-text search over titles and bodies, optionally restricted to a tag. Without a query, lists the most recently changed notes. scope "archive" searches archived notes, "trash" the trash. Returns ids, titles, paths and a snippet.',
      inputSchema: schema({
        query: STR('Words to look for (case-insensitive substring match).'),
        tag: STR('Only notes carrying this tag.'),
        scope: { type: 'string', enum: ['live', 'archive', 'trash'], description: 'Where to search (default live: current notes, archived ones only when a query is given).' },
        limit: Object.assign({}, LIMIT, { description: 'Maximum number of results (default 50).' }), offset: OFFSET,
      }),
      async run(B, input) {
        const rows = await B.listNotes(input.query || '', { tag: input.tag || '', scope: input.scope || 'live' });
        const limit = input.limit || 50;
        const offset = input.offset || 0;
        const page = rows.slice(offset, offset + limit);
        const items = [];
        for (const r of page) {
          const body = r.body != null ? r.body : (await B.getNote(r.id) || {}).body;
          items.push({ id: r.id, title: r.title, path: (await B.getPath(r.id)).map(p => p.title), updated_at: r.updated_at, archived: !!r.archived_at, in_trash: !!r.deleted_at, snippet: snippet(body, input.query, 160) });
        }
        const lines = items.map(i => `[${i.id}] ${i.title || '(untitled)'}${i.path.length ? ' (' + i.path.join(' › ') + ')' : ''}${i.archived ? ' [archived]' : ''}${i.in_trash ? ' [trash]' : ''}${i.snippet ? ' — ' + i.snippet : ''}`);
        const head = `${rows.length} ${rows.length === 1 ? 'note' : 'notes'} found${rows.length > page.length ? `, showing ${offset + 1}–${offset + page.length}` : ''}`;
        return result([head, ...lines].join('\n'), { total: rows.length, offset, items });
      },
    },
    {
      name: 'get_note', title: 'Read a note', readOnly: true,
      description: 'A note in full: title, Markdown body, path in the tree, tags, timestamps, image attachments (names only), plus the questions, decisions and tasks found in it with their ids. Use updated_at as base_updated_at when you later change the note.',
      inputSchema: schema({ id: ID('Note id.') }, ['id']),
      async run(B, input) {
        const n = await liveNote(B, input.id, { trash: true });
        const [path, tags, attachments, questions, tasks] = await Promise.all([
          B.getPath(n.id), B.getTags(n.id), B.listAttachments(n.id),
          B.listQuestions({ kind: 'all', status: 'all', archived: true }), B.listTasks({ status: 'all', archived: true }),
        ]);
        const qs = questions.filter(q => q.note_id === n.id);
        const ts = tasks.filter(t => t.note_id === n.id);
        const structured = {
          id: n.id, title: n.title, body: n.body, path: path.map(p => ({ id: p.id, title: p.title })), parent_id: n.parent_id, tags,
          created_at: n.created_at, updated_at: n.updated_at, updated_by: n.updated_by || null, archived: !!n.archived_at, in_trash: !!n.deleted_at,
          attachments: attachments.map(a => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })),
          questions: qs.map(questionItem), tasks: ts.map(taskItem),
        };
        const meta = [`id ${n.id}`, path.length ? `path: ${pathText(path)}` : 'at the root', tags.length ? `tags: ${tags.join(', ')}` : null, `updated ${n.updated_at}`, n.archived_at ? 'archived' : null, n.deleted_at ? 'in trash' : null].filter(Boolean).join(' · ');
        const text = [`# ${n.title || '(untitled)'}`, `(${meta})`, '', n.body || '(empty)'];
        if (qs.length) text.push('', 'Questions and decisions in this note:', ...qs.map(questionLine));
        if (ts.length) text.push('', 'Tasks in this note:', ...ts.map(taskLine));
        if (attachments.length) text.push('', `Images: ${attachments.map(a => a.name).join(', ')}`);
        return result(text.join('\n'), structured);
      },
    },
    {
      name: 'create_note', title: 'Create a note', readOnly: false,
      description: 'Create a new note with a title, an optional Markdown body and tags, under a parent note or at the root. Returns the new id.',
      inputSchema: schema({
        title: STR('Title of the note.', { minLength: 1, maxLength: 300 }),
        body: STR('Markdown body (may contain questions "?", decisions "?!", tasks "- [ ]").'),
        parent_id: { type: ['integer', 'null'], minimum: 1, description: 'Parent note; omit or null for the root.' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Tags to set.' },
      }, ['title']),
      async run(B, input, ctx) {
        if (input.parent_id != null) await liveNote(B, input.parent_id).catch(e => { throw Object.assign(e, { code: e.code === 'NOTE_NOT_FOUND' || e.code === 'IN_TRASH' ? 'TARGET_NOT_FOUND' : e.code }); });
        const id = await B.createNote(input.parent_id == null ? null : input.parent_id);
        const updated = await B.updateNote(id, input.title.trim(), input.body || '', { author: ctx.author });
        const tags = input.tags && input.tags.length ? await B.setTags(id, input.tags) : [];
        return result(`Created note [${id}] ${quote(input.title.trim())}${input.parent_id != null ? ` under note ${input.parent_id}` : ' at the root'}.`, { id, updated_at: updated, tags });
      },
    },
    {
      name: 'update_note', title: 'Replace title or body', readOnly: false,
      description: 'Replace the title and/or the whole body of a note. Pass base_updated_at (the updated_at you read) so that a change made by someone else in the meantime is detected instead of overwritten. Prefer append_to_note, answer_question, record_decision and complete_task for small changes.',
      inputSchema: schema({
        id: ID('Note id.'), title: STR('New title.', { minLength: 1, maxLength: 300 }), body: STR('New Markdown body (replaces the old one).'),
        base_updated_at: STR('The updated_at of the version your change is based on.'),
      }, ['id']),
      async run(B, input, ctx) {
        if (input.title === undefined && input.body === undefined) throw Object.assign(new Error('give title, body or both'), { code: 'INVALID_INPUT' });
        const n = await liveNote(B, input.id, { writable: true });
        const opts = { author: ctx.author };
        if (input.base_updated_at) opts.baseUpdatedAt = input.base_updated_at;
        const updated = await B.updateNote(n.id, input.title !== undefined ? input.title.trim() : n.title, input.body !== undefined ? input.body : n.body, opts);
        return result(`Updated note [${n.id}].`, { id: n.id, updated_at: updated });
      },
    },
    {
      name: 'append_to_note', title: 'Append text', readOnly: false,
      description: 'Append Markdown text at the end of a note (a new line is inserted before it). The safest way to add information, a question or a task to an existing note.',
      inputSchema: schema({ id: ID('Note id.'), text: STR('Text to append.', { minLength: 1 }), base_updated_at: STR('Optional: the updated_at your change is based on.') }, ['id', 'text']),
      async run(B, input, ctx) {
        const n = await liveNote(B, input.id, { writable: true });
        const body = n.body || '';
        const sep = body === '' ? '' : (body.endsWith('\n') ? '' : '\n');
        const updated = await B.updateNote(n.id, n.title, body + sep + input.text, { author: ctx.author, baseUpdatedAt: input.base_updated_at || n.updated_at });
        return result(`Appended to note [${n.id}].`, { id: n.id, updated_at: updated });
      },
    },
    {
      name: 'move_note', title: 'Move a note', readOnly: false,
      description: 'Move a note (with its subtree) under another note, or to the root with parent_id null.',
      inputSchema: schema({ id: ID('Note id.'), parent_id: { type: ['integer', 'null'], minimum: 1, description: 'New parent note, or null for the root.' } }, ['id', 'parent_id']),
      async run(B, input) {
        await liveNote(B, input.id);
        if (input.parent_id != null) await liveNote(B, input.parent_id).catch(e => { throw Object.assign(e, { code: e.code === 'NOTE_NOT_FOUND' || e.code === 'IN_TRASH' ? 'TARGET_NOT_FOUND' : e.code }); });
        await B.setParent(input.id, input.parent_id == null ? null : input.parent_id);
        return result(`Moved note [${input.id}] ${input.parent_id == null ? 'to the root' : `under note ${input.parent_id}`}.`, { id: input.id, parent_id: input.parent_id == null ? null : input.parent_id });
      },
    },
    {
      name: 'delete_note', title: 'Move to trash', readOnly: false, destructive: true,
      description: 'Move a note to the trash (its child notes move up one level). Can be undone with restore_note.',
      inputSchema: schema({ id: ID('Note id.') }, ['id']),
      async run(B, input) { const n = await liveNote(B, input.id); await B.deleteNote(n.id); return result(`Moved note [${n.id}] ${quote(n.title)} to the trash.`, { id: n.id }); },
    },
    {
      name: 'restore_note', title: 'Restore from trash', readOnly: false,
      description: 'Bring a note back from the trash to its former place in the tree (or to the root if that place is gone).',
      inputSchema: schema({ id: ID('Note id.') }, ['id']),
      async run(B, input) {
        const n = await liveNote(B, input.id, { trash: true });
        if (!n.deleted_at) throw Object.assign(new Error('The note is not in the trash.'), { code: 'INVALID_INPUT' });
        await B.restoreNote(n.id);
        return result(`Restored note [${n.id}] ${quote(n.title)}.`, { id: n.id });
      },
    },
    {
      name: 'archive_note', title: 'Archive', readOnly: false,
      description: 'Archive a note together with its subtree: it stays searchable and readable but is hidden from the map and read-only.',
      inputSchema: schema({ id: ID('Note id.') }, ['id']),
      async run(B, input) { await liveNote(B, input.id); const ids = await B.archiveNote(input.id); return result(`Archived ${plural(ids.length, 'note', 'notes')}.`, { ids }); },
    },
    {
      name: 'unarchive_note', title: 'Unarchive', readOnly: false,
      description: 'Bring a note back from the archive (with its archived ancestors; archived child notes stay archived).',
      inputSchema: schema({ id: ID('Note id.') }, ['id']),
      async run(B, input) { await liveNote(B, input.id); const ids = await B.unarchiveNote(input.id); return result(`Unarchived ${plural(ids.length, 'note', 'notes')}.`, { ids }); },
    },
    {
      name: 'set_tags', title: 'Set tags', readOnly: false,
      description: 'Replace the tags of a note with the given list (an empty list removes all tags).',
      inputSchema: schema({ id: ID('Note id.'), tags: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'The complete new list of tags.' } }, ['id', 'tags']),
      async run(B, input) { const n = await liveNote(B, input.id, { writable: true }); const tags = await B.setTags(n.id, input.tags); return result(`Tags of note [${n.id}]: ${tags.length ? tags.join(', ') : 'none'}.`, { id: n.id, tags }); },
    },
    {
      name: 'list_questions', title: 'List questions', readOnly: true,
      description: 'Questions ("?" lines) across all notes: open by default, or answered, or all. Filter by text, tag, person (@handle) or note; sort by note or by due date. Each item has an id for answer_question.',
      inputSchema: schema({
        status: { type: 'string', enum: ['open', 'answered', 'all'], description: 'Default open.' },
        query: STR('Text to look for in the question, the answer or the note title.'), tag: STR('Only questions in notes with this tag.'),
        person: STR('Only questions that mention this @handle (with or without @).'), note_id: ID('Only questions in this note.'),
        sort: { type: 'string', enum: ['note', 'due'], description: 'Default note (most recently changed note first).' },
        include_archived: BOOL('Also questions in archived notes.'), limit: LIMIT, offset: OFFSET,
      }),
      async run(B, input) { return listQuestionsLike(B, input, 'question'); },
    },
    {
      name: 'answer_question', title: 'Answer a question', readOnly: false,
      description: 'Write the answer under a question in its note (as "!" lines). Replaces an existing answer. For decisions use record_decision.',
      inputSchema: schema({ id: ID('Question id (from list_questions or get_note).'), answer: STR('The answer; several lines allowed.', { minLength: 1 }) }, ['id', 'answer']),
      async run(B, input, ctx) {
        const q = await B.getQuestion(input.id);
        if (!q) throw Object.assign(new Error('not found'), { code: 'QUESTION_NOT_FOUND' });
        if (q.kind === 'decision') throw Object.assign(new Error('this is a decision; use record_decision'), { code: 'INVALID_INPUT' });
        await liveNote(B, q.note_id, { writable: true });
        const noteId = await B.answerQuestion(q.id, input.answer, { author: ctx.author });
        return result(`Answered question [q ${q.id}] in note [${noteId}].`, { id: q.id, note_id: noteId });
      },
    },
    {
      name: 'list_decisions', title: 'List decisions', readOnly: true,
      description: 'Decisions ("?!" lines) across all notes: open (not yet decided) by default, or decided, or all. Same filters as list_questions. Each item has an id for record_decision.',
      inputSchema: schema({
        status: { type: 'string', enum: ['open', 'decided', 'all'], description: 'Default open.' },
        query: STR('Text to look for.'), tag: STR('Only decisions in notes with this tag.'), person: STR('Only decisions that mention this @handle.'), note_id: ID('Only decisions in this note.'),
        sort: { type: 'string', enum: ['note', 'due'] }, include_archived: BOOL('Also decisions in archived notes.'), limit: LIMIT, offset: OFFSET,
      }),
      async run(B, input) { return listQuestionsLike(B, Object.assign({}, input, { status: input.status === 'decided' ? 'answered' : input.status }), 'decision'); },
    },
    {
      name: 'record_decision', title: 'Record a decision', readOnly: false,
      description: 'Record what was decided under a "?!" line (as "!!" lines, the first one carrying the date). Replaces an existing decision text.',
      inputSchema: schema({
        id: ID('Decision id (from list_decisions or get_note).'), decision: STR('What was decided; several lines allowed.', { minLength: 1 }),
        decided: STR('Date of the decision as YYYY-MM-DD (default: the date already in the text, else today).', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
      }, ['id', 'decision']),
      async run(B, input, ctx) {
        const q = await B.getQuestion(input.id);
        if (!q) throw Object.assign(new Error('not found'), { code: 'QUESTION_NOT_FOUND' });
        if (q.kind !== 'decision') throw Object.assign(new Error('this is a question; use answer_question'), { code: 'INVALID_INPUT' });
        await liveNote(B, q.note_id, { writable: true });
        const opts = { author: ctx.author };
        if (input.decided) opts.decided = input.decided;
        const noteId = await B.answerQuestion(q.id, input.decision, opts);
        return result(`Recorded decision [d ${q.id}] in note [${noteId}].`, { id: q.id, note_id: noteId });
      },
    },
    {
      name: 'list_tasks', title: 'List tasks', readOnly: true,
      description: 'Tasks ("- [ ]" lines) across all notes: open by default, or done, or all; with due dates and subtask counts. Filter by text, tag or note; sort by due date (default) or by note. Each item has an id for complete_task.',
      inputSchema: schema({
        status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Default open.' },
        query: STR('Text to look for in the task or the note title.'), tag: STR('Only tasks in notes with this tag.'), note_id: ID('Only tasks in this note.'),
        sort: { type: 'string', enum: ['due', 'note'], description: 'Default due.' }, include_archived: BOOL('Also tasks in archived notes.'), limit: LIMIT, offset: OFFSET,
      }),
      async run(B, input) {
        let rows = await B.listTasks({ status: input.status || 'open', query: input.query || '', tag: input.tag || '', sort: input.sort || 'due', archived: !!input.include_archived });
        if (input.note_id) rows = rows.filter(r => r.note_id === input.note_id);
        const offset = input.offset || 0;
        const page = rows.slice(offset, offset + (input.limit || 100));
        const head = `${plural(rows.length, 'task', 'tasks')}${rows.length > page.length ? `, showing ${offset + 1}–${offset + page.length}` : ''}`;
        return result([head, ...page.map(taskLine)].join('\n'), { total: rows.length, offset, items: page.map(taskItem) });
      },
    },
    {
      name: 'complete_task', title: 'Complete a task', readOnly: false,
      description: 'Tick a task ("- [x]"). Fails while subtasks are still open; complete them first.',
      inputSchema: schema({ id: ID('Task id (from list_tasks or get_note).') }, ['id']),
      async run(B, input) { const t = await taskNote(B, input.id); const noteId = await B.setTaskDone(t.id, true); return result(`Completed task [t ${t.id}] in note [${noteId}].`, { id: t.id, note_id: noteId, done: true }); },
    },
    {
      name: 'reopen_task', title: 'Reopen a task', readOnly: false,
      description: 'Untick a task ("- [ ]"); completed parent tasks are reopened as well.',
      inputSchema: schema({ id: ID('Task id.') }, ['id']),
      async run(B, input) { const t = await taskNote(B, input.id); const noteId = await B.setTaskDone(t.id, false); return result(`Reopened task [t ${t.id}] in note [${noteId}].`, { id: t.id, note_id: noteId, done: false }); },
    },
    {
      name: 'list_people', title: 'List people', readOnly: true,
      description: 'All @handles mentioned in questions and decisions of current notes.',
      inputSchema: schema({}),
      async run(B) { const handles = await B.listPeople(); return result(handles.length ? handles.map(h => '@' + h).join(', ') : 'No people mentioned.', { people: handles }); },
    },
    {
      name: 'get_history', title: 'Note history', readOnly: true,
      description: 'Earlier versions of a note. Without version_id: the list of versions (newest first) with date, author and size of the change. With version_id: that version in full.',
      inputSchema: schema({ id: ID('Note id.'), version_id: ID('A version id from the list.'), limit: LIMIT }, ['id']),
      async run(B, input) {
        const n = await liveNote(B, input.id, { trash: true });
        if (input.version_id) {
          const v = await B.getHistoryVersion(n.id, input.version_id);
          return result(`Version ${v.id} of note [${n.id}] from ${v.at}${v.author ? ` by ${v.author}` : ''}:\n# ${v.title}\n\n${v.body}`, { id: n.id, version: { version_id: v.id, at: v.at, title: v.title, author: v.author, body: v.body } });
        }
        const list = (await B.listHistory(n.id)).slice(0, input.limit || 100);
        const items = list.map(v => ({ version_id: v.id, at: v.at, title: v.title, author: v.author, added: v.added, removed: v.removed, title_changed: v.titleChanged }));
        return result(list.length ? list.map(v => `[v ${v.id}] ${v.at}${v.author ? ` by ${v.author}` : ''} — +${v.added}/−${v.removed} characters${v.titleChanged ? ', title changed' : ''}`).join('\n') : 'No earlier versions.', { id: n.id, versions: items });
      },
    },
  ];

  async function listQuestionsLike(B, input, kind) {
    let rows = await B.listQuestions({ kind, status: input.status || 'open', query: input.query || '', tag: input.tag || '', person: input.person || '', sort: input.sort || 'note', archived: !!input.include_archived });
    if (input.note_id) rows = rows.filter(r => r.note_id === input.note_id);
    const offset = input.offset || 0;
    const page = rows.slice(offset, offset + (input.limit || 100));
    const what = kind === 'decision' ? ['decision', 'decisions'] : ['question', 'questions'];
    const head = `${plural(rows.length, what[0], what[1])}${rows.length > page.length ? `, showing ${offset + 1}–${offset + page.length}` : ''}`;
    return result([head, ...page.map(questionLine)].join('\n'), { total: rows.length, offset, items: page.map(questionItem) });
  }

  async function taskNote(B, id) {
    const t = await B.getTask(id);
    if (!t) throw Object.assign(new Error('not found'), { code: 'TASK_NOT_FOUND' });
    await liveNote(B, t.note_id, { writable: true });
    return t;
  }

  // ---------- Der Katalog ----------

  function describe(tool) {
    return {
      name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema,
      annotations: { title: tool.title, readOnlyHint: !!tool.readOnly, destructiveHint: !!tool.destructive, idempotentHint: false, openWorldHint: false },
    };
  }

  function create(backend, options) {
    const o = options || {};
    const readOnly = !!o.readOnly;
    const ctx = { author: o.author || null, now: typeof o.now === 'function' ? o.now : () => new Date().toISOString() };
    const available = TOOLS.filter(t => !readOnly || t.readOnly);
    const byName = new Map(available.map(t => [t.name, t]));

    async function call(name, input) {
      const tool = byName.get(name);
      if (!tool) return failure({ code: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` });
      try {
        const clean = validate(tool.inputSchema, input);
        return await tool.run(backend, clean, ctx);
      } catch (e) {
        if (!(e && typeof e.code === 'string') && o.log) o.log('agent tool failed', name, e);
        return failure(e);
      }
    }

    const RESOURCES = [{ uri: 'nonotes://overview', name: 'overview', title: 'Workspace overview', description: 'Counts of notes, open questions, decisions and tasks, tags and people.', mimeType: 'text/plain' }];
    const TEMPLATES = [{ uriTemplate: 'nonotes://note/{id}', name: 'note', title: 'A note as Markdown', description: 'Title and body of one note.', mimeType: 'text/markdown' }];

    async function readResource(uri) {
      const u = String(uri || '');
      if (u === 'nonotes://overview') return { uri: u, mimeType: 'text/plain', text: (await overview(backend, ctx)).text };
      const m = /^nonotes:\/\/note\/(\d+)$/.exec(u);
      if (m) return { uri: u, mimeType: 'text/markdown', text: await noteMarkdown(backend, Number(m[1])) };
      throw Object.assign(new Error(`Unknown resource: ${u}`), { code: 'RESOURCE_NOT_FOUND' });
    }

    return {
      readOnly, instructions: INSTRUCTIONS,
      list: () => available.map(describe),
      has: name => byName.has(name),
      call,
      resources: () => RESOURCES.slice(),
      resourceTemplates: () => TEMPLATES.slice(),
      readResource,
    };
  }

  // ---------- Mehrere Datenbanken (Bereiche) ----------

  /** Kennung aus einem Namen, gleich wie die Bereiche der App («Projekt Ä» → «projekt-ae»). */
  function slug(name) {
    const s = String(name || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
    return s || 'workspace';
  }

  const WORKSPACE_PARAM = { type: 'string', description: 'Workspace id (see list_workspaces).' };
  const LIST_WORKSPACES = {
    name: 'list_workspaces', title: 'List workspaces',
    description: 'The workspaces (separate NoNotes databases) you may use, with id and name. Call this first; every other tool takes one of these ids as "workspace".',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List workspaces', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
  const MULTI_NOTE = 'This server has several workspaces (separate databases): call list_workspaces first; every other tool takes "workspace" (an id from that list). Notes, questions, decisions and tasks never span workspaces.';

  /**
   * Ein Katalog über mehrere Datenbanken: jedes Werkzeug bekommt den Parameter «workspace», list_workspaces nennt sie.
   * o: { workspaces() → [{ id, name, ...angaben }] (auch async), catalogFor(id) → Katalog von create() (auch async), readOnly, log }
   */
  function multi(o) {
    const readOnly = !!o.readOnly;
    const template = create({}, { readOnly });
    const tools = template.list().map(t => Object.assign({}, t, {
      inputSchema: Object.assign({}, t.inputSchema, { properties: Object.assign({ workspace: WORKSPACE_PARAM }, t.inputSchema.properties), required: ['workspace', ...(t.inputSchema.required || [])] }),
    }));
    const names = new Set(tools.map(t => t.name));
    const workspaces = async () => (await o.workspaces()).map(w => Object.assign({}, w));
    async function resolve(ref) {
      const v = String(ref == null ? '' : ref).trim().toLowerCase();
      const list = await workspaces();
      return list.find(w => w.id === v) || list.find(w => slug(w.name) === slug(v)) || null;
    }
    const fail = (code, message) => ({ content: [{ type: 'text', text: `Error (${code}): ${message}` }], structuredContent: { error: { code, message } }, isError: true });

    async function call(name, input) {
      if (name === 'list_workspaces') {
        const items = await workspaces();
        const text = items.length ? items.map(w => `[${w.id}] ${w.name}${w.file ? ` (${w.file})` : ''}`).join('\n') : 'No workspaces.';
        return { content: [{ type: 'text', text }], structuredContent: { workspaces: items } };
      }
      if (!names.has(name)) return fail('UNKNOWN_TOOL', `Unknown tool: ${name}`);
      const args = input && typeof input === 'object' && !Array.isArray(input) ? Object.assign({}, input) : {};
      const ref = args.workspace;
      delete args.workspace;
      if (ref == null || ref === '') return fail('INVALID_INPUT', 'Invalid input: workspace: required (see list_workspaces)');
      const w = await resolve(ref);
      if (!w) return fail('WORKSPACE_NOT_FOUND', `Unknown workspace: ${ref}. Call list_workspaces for the ids you may use.`);
      const cat = await o.catalogFor(w.id);
      return cat.call(name, args);
    }

    async function readResource(uri) {
      const m = /^nonotes:\/\/([a-z0-9-]+)\/(overview|note\/\d+)$/.exec(String(uri || ''));
      const w = m ? await resolve(m[1]) : null;
      if (!w) throw Object.assign(new Error(`Unknown resource: ${uri}`), { code: 'RESOURCE_NOT_FOUND' });
      const inner = await (await o.catalogFor(w.id)).readResource(`nonotes://${m[2]}`);
      return { uri: String(uri), mimeType: inner.mimeType, text: inner.text };
    }

    return {
      readOnly, instructions: `${INSTRUCTIONS} ${MULTI_NOTE}`,
      list: () => [Object.assign({}, LIST_WORKSPACES), ...tools],
      has: name => name === 'list_workspaces' || names.has(name),
      call,
      resources: async () => (await workspaces()).map(w => ({ uri: `nonotes://${w.id}/overview`, name: `${w.id} overview`, title: `Overview of ${w.name}`, description: `Counts of notes, open questions, decisions and tasks in ${w.name}.`, mimeType: 'text/plain' })),
      resourceTemplates: () => [
        { uriTemplate: 'nonotes://{workspace}/overview', name: 'overview', title: 'Workspace overview', description: 'Counts of notes, open questions, decisions and tasks.', mimeType: 'text/plain' },
        { uriTemplate: 'nonotes://{workspace}/note/{id}', name: 'note', title: 'A note as Markdown', description: 'Title and body of one note.', mimeType: 'text/markdown' },
      ],
      readResource,
      workspaces,
    };
  }

  global.NoNotesAgent = { create, multi, slug, validate, ERRORS, INSTRUCTIONS, toolNames: () => TOOLS.map(t => t.name) };
})(window);
