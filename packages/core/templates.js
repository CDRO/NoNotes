/* NoNotes – Vorlagen (v2.5.0): eine Notiz samt Unternotizen als Markdown-Datei, und neue Notizen daraus.
   Reine Funktionen ohne Ablage: wo Vorlagen liegen, sagt die Hülle (shell.templates, lokal der Ordner templates/, im Dienst der Server).

   Dateiformat (eine .md-Datei je Vorlage):
     ---
     nonotes: 1
     name: "Sitzungsprotokoll"
     description: "Traktanden, Beschlüsse und Pendenzen"
     title: "Sitzung {{datum}}"
     tags: ["sitzung"]
     ---
     Text der obersten Notiz …

     <!-- nonotes:note {"depth":1,"title":"Traktanden","tags":[]} -->
     Text der ersten Unternotiz …
   Der Kopf ist YAML mit Werten in JSON-Schreibweise; jede Unternotiz beginnt mit einem HTML-Kommentar (ausserhalb von NoNotes
   unsichtbar) mit Tiefe, Titel und Tags. Eine Markdown-Datei ohne Kopf ist auch eine Vorlage: Name und Titel aus dem Dateinamen.

   Platzhalter in Titel, Text und Tags: {{datum}}, {{datum+7}} (in sieben Tagen, auch -), {{zeit}}, {{wochentag}}, {{woche}},
   {{jahr}}, {{vorlage}}, {{bereich}}, {{ich}}. Die Namen sind übersetzbar (Sprachpakete, Schlüssel «platzhalter:…»); erkannt werden
   sie in jeder Sprache, damit eine Vorlage auch bei einer anderen Sprache der Oberfläche funktioniert. Unbekannte bleiben stehen. */
(function (global) {
  'use strict';

  const I18n = global.NoNotesI18n;
  const N_ = I18n ? I18n.N_ : k => k;
  const t = I18n ? I18n.t : k => k;

  const FORMAT = 1;
  const NOTE_RE = /^<!--\s*nonotes:note\s+(\{.*\})\s*-->\s*$/;
  const FENCE_RE = /^\s*(```|~~~)/;
  const ANSWER_RE = /^\s*(?:!!|!(?!\[))/;
  const DONE_TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[[xX]\]/;
  const DUE_TAIL_RE = /\s*@(?:\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2})(?:[ T]\d{1,2}[:.]\d{2})?\s*$/;
  const IMAGE_RE = / ?!\[[^\]]*\]\(att:\d+(?:\s+"[^"]*")?\)/g;
  const MAX_NOTES = 200;

  // Platzhalter: Kennung und übersetzbarer Name (der Teil nach dem Doppelpunkt ist der deutsche Name)
  const PLACEHOLDERS = [
    { id: 'date', key: N_('platzhalter:datum'), offset: true },
    { id: 'time', key: N_('platzhalter:zeit') },
    { id: 'weekday', key: N_('platzhalter:wochentag') },
    { id: 'week', key: N_('platzhalter:woche') },
    { id: 'year', key: N_('platzhalter:jahr') },
    { id: 'template', key: N_('platzhalter:vorlage') },
    { id: 'area', key: N_('platzhalter:bereich') },
    { id: 'me', key: N_('platzhalter:ich') },
  ];

  const sourceName = p => p.key.slice(p.key.indexOf(':') + 1);

  /** Name eines Platzhalters in der Sprache der Oberfläche (ohne Klammern). */
  function placeholderName(id) {
    const p = PLACEHOLDERS.find(x => x.id === id);
    if (!p) return id;
    const name = I18n && I18n.variant ? I18n.variant(p.key) : null;
    return name || sourceName(p);
  }

  /** Alle Namen eines Platzhalters, klein geschrieben: deutsch, die Kennung und jede Übersetzung. */
  function namesOf(p) {
    const out = new Set([sourceName(p), p.id]);
    if (I18n && I18n.variants) for (const v of I18n.variants(p.key)) if (v && !v.includes(':')) out.add(v);
    return [...out].map(n => n.toLowerCase());
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  }

  /** Wert eines Platzhalters. ctx: { now: Date, template, area, me, locale }. */
  function valueOf(id, offset, ctx) {
    const now = ctx.now && typeof ctx.now.getTime === 'function' ? ctx.now : new Date();
    switch (id) {
      case 'date': {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (offset || 0));
        return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
      }
      case 'time': return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      case 'weekday': {
        try { return new Intl.DateTimeFormat(ctx.locale || (I18n ? I18n.locale() : 'de-CH'), { weekday: 'long' }).format(now); } catch (e) { return ''; }
      }
      case 'week': return String(isoWeek(now));
      case 'year': return String(now.getFullYear());
      case 'template': return ctx.template || '';
      case 'area': return ctx.area || '';
      case 'me': return ctx.me || '';
      default: return null;
    }
  }

  /** Ersetzt die Platzhalter in einem Text. Unbekannte {{…}} bleiben, wie sie sind. */
  function fill(text, ctx) {
    const c = ctx || {};
    const table = new Map();
    for (const p of PLACEHOLDERS) for (const n of namesOf(p)) table.set(n, p);
    return String(text == null ? '' : text).replace(/\{\{\s*([\p{L}_][\p{L}\p{N}_]*)\s*(?:([+-])\s*(\d{1,4}))?\s*\}\}/gu, (m, name, sign, num) => {
      const p = table.get(name.toLowerCase());
      if (!p || (sign && !p.offset)) return m;
      const v = valueOf(p.id, sign ? (sign === '-' ? -1 : 1) * Number(num) : 0, c);
      return v == null ? m : v;
    });
  }

  /** Die Platzhalter für Hilfe und Dialog: [{ id, name, example }] mit dem Namen in der Sprache der Oberfläche. */
  function placeholders(ctx) {
    const c = Object.assign({ template: t('Vorlage'), area: '', me: '' }, ctx || {});
    return PLACEHOLDERS.map(p => ({ id: p.id, name: placeholderName(p.id), offset: !!p.offset, example: valueOf(p.id, 0, c) }));
  }

  // ---------- Aus Notizen eine Vorlage ----------

  /** Bereinigt den Text einer Notiz: Antworten und Entscheide weg, Aufgaben offen, Termine weg (je nach options), Bilder aus der
   *  Datei immer weg (eine Markdown-Datei trägt sie nicht). Code bleibt, wie er ist. Gibt { body, images } zurück. */
  function clean(body, options) {
    const o = Object.assign({ stripAnswers: true, reopenTasks: true, stripDates: false }, options || {});
    let images = 0;
    const out = [];
    let fence = null;
    for (const line of String(body || '').replace(/\r\n?/g, '\n').split('\n')) {
      if (fence) { out.push(line); if (line.trim().startsWith(fence)) fence = null; continue; }
      const f = FENCE_RE.exec(line);
      if (f) { fence = f[1]; out.push(line); continue; }
      if (o.stripAnswers && ANSWER_RE.test(line)) continue;
      let l = line.replace(IMAGE_RE, () => { images++; return ''; });
      if (o.reopenTasks) l = l.replace(DONE_TASK_RE, '$1[ ]');
      if (o.stripDates) l = l.replace(DUE_TAIL_RE, '');
      if (!l.trim() && line.trim()) continue; // nur ein Bild auf der Zeile: die Zeile fällt weg
      out.push(l);
    }
    return { body: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), images };
  }

  /** Ersetzt das Datum eines Tages (Schreibweisen 20.10.2026, 20.10.26 nicht, 2026-10-20) durch den Platzhalter {{datum}} in der Sprache
   *  der Oberfläche. Ausserhalb von Code. */
  function datesToPlaceholder(text, day) {
    const d = day && typeof day.getTime === 'function' ? day : new Date();
    const name = `{{${placeholderName('date')}}}`;
    const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
    const re = new RegExp(`(^|[^\\d.])(?:0?${dd}\\.0?${m}\\.${y}|${y}-${pad(m)}-${pad(dd)})(?![\\d])`, 'g');
    const out = [];
    let fence = null;
    for (const line of String(text || '').split('\n')) {
      if (fence) { out.push(line); if (line.trim().startsWith(fence)) fence = null; continue; }
      const f = FENCE_RE.exec(line);
      if (f) { fence = f[1]; out.push(line); continue; }
      out.push(line.replace(re, (m0, lead) => lead + name));
    }
    return out.join('\n');
  }

  /** Vorlage aus einer Notiz und (wahlweise) ihren Unternotizen. nodes: [{ depth, title, body, tags }] in Baumreihenfolge, die erste
   *  ist die Notiz selbst (depth 0). options: { name, description, children (Standard true), stripAnswers, reopenTasks, stripDates,
   *  todayToPlaceholder (das heutige Datum wird {{datum}}; options.today ersetzt «heute») }.
   *  Ergebnis: { template: { name, description, notes }, images } – images zählt die weggelassenen Bilder. */
  function fromNotes(nodes, options) {
    const o = options || {};
    const list = (o.children === false ? (nodes || []).slice(0, 1) : (nodes || []).slice(0, MAX_NOTES));
    if (!list.length) throw Object.assign(new Error(t('Die Vorlage ist leer.')), { code: 'TEMPLATE_EMPTY' });
    let images = 0;
    const base = list[0].depth || 0;
    const notes = list.map(n => {
      const c = clean(n.body, o);
      images += c.images;
      const day = o.todayToPlaceholder ? s => datesToPlaceholder(s, o.today) : s => s;
      return { depth: Math.max(0, (n.depth || 0) - base), title: day(String(n.title || '').trim()), tags: (n.tags || []).map(String), body: day(c.body) };
    });
    const name = String(o.name || notes[0].title || '').trim() || t('Vorlage');
    return { template: { name, description: String(o.description || '').trim(), notes }, images };
  }

  // ---------- Datei ----------

  const json = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  /** Vorlage als Markdown-Text (Dateiformat oben). */
  function toMarkdown(template) {
    const t = template || {};
    const notes = t.notes && t.notes.length ? t.notes : [{ depth: 0, title: t.name || '', tags: [], body: '' }];
    const root = notes[0];
    const head = ['---', `nonotes: ${FORMAT}`, `name: ${json(String(t.name || root.title || ''))}`];
    if (t.description) head.push(`description: ${json(String(t.description))}`);
    head.push(`title: ${json(String(root.title || ''))}`);
    if (root.tags && root.tags.length) head.push(`tags: ${json(root.tags.map(String))}`);
    head.push('---');
    const parts = [head.join('\n'), String(root.body || '')];
    for (const n of notes.slice(1)) {
      parts.push(`<!-- nonotes:note ${json({ depth: Math.max(1, n.depth | 0), title: String(n.title || ''), tags: (n.tags || []).map(String) })} -->\n${String(n.body || '')}`);
    }
    return parts.join('\n').replace(/\n*$/, '\n');
  }

  function frontValue(raw) {
    const v = raw.trim();
    if (!v) return '';
    try { return JSON.parse(v); } catch (e) { /* kein JSON: Text */ }
    return v.replace(/^'(.*)'$/, '$1');
  }

  const asTags = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(Boolean);

  /** Liest eine Vorlage aus Markdown. fileName (ohne Pfad) gibt Name und Titel, wenn der Kopf fehlt. */
  function parse(text, fileName) {
    const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const fallback = String(fileName || '').replace(/\.(md|markdown|txt)$/i, '').trim();
    let head = {};
    let rest = src;
    const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
    if (m) {
      for (const line of m[1].split('\n')) {
        const kv = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
        if (kv) head[kv[1].toLowerCase()] = frontValue(kv[2]);
      }
      rest = src.slice(m[0].length);
    }
    const notes = [{ depth: 0, title: String(head.title != null ? head.title : (head.name || fallback)), tags: asTags(head.tags), body: [] }];
    for (const line of rest.split('\n')) {
      const n = NOTE_RE.exec(line);
      let info = null;
      if (n) { try { info = JSON.parse(n[1]); } catch (e) { info = null; } }
      if (info && typeof info === 'object' && notes.length < MAX_NOTES) {
        const prev = notes[notes.length - 1].depth;
        const depth = Math.min(Math.max(1, Number(info.depth) | 0), prev + 1); // nie tiefer als eine Stufe unter der vorigen
        notes.push({ depth, title: String(info.title || ''), tags: asTags(info.tags), body: [] });
        continue;
      }
      notes[notes.length - 1].body.push(line);
    }
    for (const n of notes) n.body = n.body.join('\n').replace(/^\n+|\s+$/g, '');
    const name = String(head.name || notes[0].title || fallback || '').trim() || t('Vorlage');
    return { name, description: String(head.description || '').trim(), notes };
  }

  /** Dateiname für eine Vorlage: aus dem Namen, ohne heikle Zeichen. */
  function fileName(name) {
    const base = String(name || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80).trim();
    return (base || t('Vorlage')) + '.md';
  }

  // ---------- Anwenden ----------

  /** Notizen einer Vorlage mit ersetzten Platzhaltern: [{ depth, title, body, tags }]. */
  function instantiate(template, ctx) {
    const c = Object.assign({ template: template && template.name }, ctx || {});
    return ((template && template.notes) || []).map(n => ({
      depth: n.depth, title: fill(n.title, c), body: fill(n.body, c), tags: (n.tags || []).map(x => fill(x, c)).filter(Boolean),
    }));
  }

  /** Legt Notizen über das Backend an: die erste unter parentId (oder an der Wurzel), die übrigen nach ihrer Tiefe darunter. Gibt die
   *  Kennungen zurück (die erste ist die oberste Notiz). options.author wie bei updateNote. */
  async function createNotes(backend, notes, parentId, options) {
    const ids = [];
    const stack = []; // stack[d] = Kennung der letzten Notiz der Tiefe d
    const base = notes.length ? notes[0].depth : 0;
    for (const n of notes) {
      const depth = n.depth - base;
      const parent = depth <= 0 ? parentId : stack[Math.min(depth, stack.length) - 1];
      const id = await backend.createNote(parent == null ? null : parent);
      await backend.updateNote(id, n.title || '', n.body || '', options && options.author ? { author: options.author } : {});
      if (n.tags && n.tags.length) await backend.setTags(id, n.tags);
      const level = Math.max(0, Math.min(depth, stack.length));
      stack[level] = id;
      stack.length = level + 1;
      ids.push(id);
    }
    return ids;
  }

  /** Neue Notiz aus einer Vorlage unter parentId: gibt die Kennung der obersten Notiz zurück. */
  async function apply(backend, template, parentId, ctx, options) {
    const notes = instantiate(template, ctx);
    if (!notes.length) throw Object.assign(new Error(t('Die Vorlage ist leer.')), { code: 'TEMPLATE_EMPTY' });
    const ids = await createNotes(backend, notes, parentId, options);
    return ids[0];
  }

  /** Vorlage in eine bestehende Notiz einfügen: der Text der obersten Notiz an der Stelle caret, ihre Unternotizen unter noteId.
   *  Gibt { body, caret, children } zurück (children: Kennungen der neuen Unternotizen); gespeichert wird der Text vom Aufrufer. */
  async function insert(backend, template, noteId, body, caret, ctx, options) {
    const notes = instantiate(template, ctx);
    const text = String(body || '');
    const at = Math.max(0, Math.min(caret == null ? text.length : caret, text.length));
    const piece = notes.length ? notes[0].body : '';
    const before = text.slice(0, at);
    const after = text.slice(at);
    const lead = before && !before.endsWith('\n') ? '\n' : '';
    const tail = after && !after.startsWith('\n') ? '\n' : '';
    const children = notes.length > 1 ? await createNotes(backend, notes.slice(1).map(n => Object.assign({}, n, { depth: n.depth - 1 })), noteId, options) : [];
    return { body: before + lead + piece + tail + after, caret: before.length + lead.length + piece.length, children };
  }

  /** Kurzbeschreibung für Listen: Zahl der Notizen. */
  function noteCount(template) { return ((template && template.notes) || []).length; }

  global.NoNotesTemplates = { FORMAT, PLACEHOLDERS, fill, placeholders, placeholderName, clean, datesToPlaceholder, fromNotes, toMarkdown, parse, fileName, instantiate, createNotes, apply, insert, noteCount };
})(window);
