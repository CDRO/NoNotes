/* NoNotes – Export als Markdown mit Mindmap-Bild.
   Zwei Formen: ein Ordner mit index.md und einer Datei pro Notiz, oder eine einzige
   Markdown-Datei mit allen Notizen als Abschnitte. In beiden Fällen liegen mindmap.svg
   und mindmap.png daneben und werden oben in der Übersicht eingebunden. */
(function (global) {
  'use strict';

  const DB = () => global.NoNotesDB;
  const Q = () => global.NoNotesQuestions;
  const Mindmap = () => global.NoNotesMindmap;

  const fmtDateTime = new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : fmtDateTime.format(d); };

  function slugify(text) {
    const map = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue', ß: 'ss', é: 'e', è: 'e', ê: 'e', à: 'a', â: 'a', ç: 'c' };
    const s = String(text || '').replace(/[äöüÄÖÜßéèêàâç]/g, ch => map[ch] || ch)
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
    return s || 'notiz';
  }

  function uniqueSlugs(nodes) {
    const used = new Map();
    for (const n of nodes) {
      const base = slugify(n.title.trim() || 'Ohne Titel');
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      n.slug = count === 0 ? base : `${base}-${count + 1}`;
    }
  }

  /** Lebende Notizen in Baumreihenfolge (Tiefensuche), mit depth und children. */
  function treeOrder(db) {
    const rows = DB().getTree(db);
    const byId = new Map(rows.map(r => [r.id, Object.assign({ children: [] }, r)]));
    const roots = [];
    for (const n of byId.values()) {
      const p = n.parent_id != null ? byId.get(n.parent_id) : null;
      (p ? p.children : roots).push(n);
    }
    const byOrder = (a, b) => (a.sort_order - b.sort_order) || (a.id - b.id);
    roots.sort(byOrder);
    for (const n of byId.values()) n.children.sort(byOrder);
    const out = [];
    const walk = (n, depth, parent) => { n.depth = depth; n.parentNode = parent; out.push(n); n.children.forEach(c => walk(c, depth + 1, n)); };
    roots.forEach(r => walk(r, 1, null));
    return out;
  }

  function pathTitles(node) {
    const parts = [];
    let p = node.parentNode;
    while (p) { parts.unshift(p.title.trim() || 'Ohne Titel'); p = p.parentNode; }
    return parts;
  }

  /** Wandelt den Notiztext in portables Markdown: ?/! werden zu Zitatblöcken, [[Titel]] zu Links. */
  function bodyToMarkdown(body, resolveLink, resolveAttachment) {
    const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const q = /^\s*\?\s?(.*)$/.exec(line);
      if (q && q[1].trim()) {
        let j = i + 1;
        const answers = [];
        while (j < lines.length && /^\s*!(?!\[)\s?/.test(lines[j])) answers.push(lines[j++].replace(/^\s*!(?!\[)\s?/, '').trim());
        const answered = answers.join('').trim().length > 0;
        if (out.length && out[out.length - 1].trim() !== '' && !out[out.length - 1].startsWith('>')) out.push('');
        out.push(`> **${answered ? 'Frage (beantwortet)' : 'Offene Frage'}:** ${inline(q[1].trim(), resolveLink, resolveAttachment)}`);
        if (answered) out.push(`> **Antwort:** ${answers.map(a => inline(a, resolveLink, resolveAttachment)).join(' ')}`);
        if (j < lines.length && lines[j].trim() !== '') out.push('');
        i = j - 1;
        continue;
      }
      const a = /^\s*!(?!\[)\s?(.*)$/.exec(line);
      if (a) { out.push(`> **Antwort:** ${inline(a[1].trim(), resolveLink, resolveAttachment)}`); continue; }
      out.push(inline(line, resolveLink, resolveAttachment));
    }
    return out.join('\n').trim();
  }

  function inline(text, resolveLink, resolveAttachment) {
    let out = text.replace(/\[\[([^\]]+)\]\]/g, (m, title) => {
      const href = resolveLink ? resolveLink(title.trim()) : null;
      return href ? `[${title.trim()}](${href})` : title.trim();
    });
    out = out.replace(/\]\((www\.[^)\s]+)/gi, '](https://$1');
    if (resolveAttachment) {
      out = out.replace(/\]\(att:(\d+)\)/g, (m, id) => {
        const path = resolveAttachment(Number(id));
        return path ? `](${path})` : m;
      });
    }
    return out;
  }

  function metaLines(db, node, note) {
    const lines = [];
    const path = pathTitles(node);
    if (path.length) lines.push(`*Pfad: ${path.join(' › ')}*  `);
    lines.push(`*Erstellt ${fmtDate(note.created_at)} · Geändert ${fmtDate(note.updated_at)}*  `);
    const tags = DB().getTags(db, node.id);
    if (tags.length) lines.push(`*Tags: ${tags.join(', ')}*  `);
    return lines;
  }

  function tocLines(nodes, hrefOf) {
    return nodes.map(n => `${'  '.repeat(n.depth - 1)}- [${n.title.trim() || 'Ohne Titel'}](${hrefOf(n)})`);
  }

  function openQuestionLines(db, nodes, hrefOf) {
    const D = global.NoNotesDates;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const rows = DB().listQuestions(db, { status: 'open', sort: 'due' });
    if (!rows.length) return ['Keine offenen Fragen.'];
    return rows.map(r => {
      const n = byId.get(r.note_id);
      const due = r.due && D ? ` (bis ${D.formatDue(r.due)})` : '';
      return n ? `- ${r.text}${due} — aus [${n.title.trim() || 'Ohne Titel'}](${hrefOf(n)})` : `- ${r.text}${due}`;
    });
  }

  function openTaskLines(db, nodes, hrefOf) {
    const T = global.NoNotesTasks;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const rows = DB().listTasks(db, { status: 'open', sort: 'due' });
    if (!rows.length) return ['Keine offenen Aufgaben.'];
    return rows.map(r => {
      const n = byId.get(r.note_id);
      const due = r.due ? ` (bis ${T.formatDue(r.due)})` : '';
      return n ? `- [ ] ${r.text}${due} — aus [${n.title.trim() || 'Ohne Titel'}](${hrefOf(n)})` : `- [ ] ${r.text}${due}`;
    });
  }

  function header(db, version) {
    const title = DB().getMapTitle(db);
    return [
      `# ${title}`,
      '',
      `*Exportiert am ${fmtDate(new Date().toISOString())} mit NoNotes ${version || ''}*`.trim(),
      '',
      '![Mindmap](mindmap.svg)',
      '',
    ];
  }

  /** Erzeugt die Dateiliste. options: { mode: 'folder' | 'single', svg, png, version } */
  function buildFiles(db, options) {
    const mode = options.mode === 'single' ? 'single' : 'folder';
    const nodes = treeOrder(db);
    uniqueSlugs(nodes);
    const byTitle = new Map();
    for (const n of nodes) {
      const key = n.title.trim().toLowerCase();
      if (key && !byTitle.has(key)) byTitle.set(key, n);
    }
    const files = [];

    // Anhänge: Dateiname aus Nummer und bereinigtem Namen, Pfad relativ zur jeweiligen Markdown-Datei.
    const attachments = DB().allAttachments(db);
    const attName = a => {
      const ext = (a.name.match(/\.[a-z0-9]{2,5}$/i) || [''])[0].toLowerCase();
      const base = slugify(a.name.replace(/\.[a-z0-9]{2,5}$/i, '')) || 'anhang';
      return `${a.id}-${base}${ext}`;
    };
    const attById = new Map(attachments.map(a => [a.id, attName(a)]));
    const attFrom = prefix => id => attById.has(id) ? `${prefix}attachments/${attById.get(id)}` : null;

    if (mode === 'folder') {
      const hrefFromIndex = n => `notes/${n.slug}.md`;
      const hrefFromNote = n => `${n.slug}.md`;
      const resolveFromNote = title => { const t = byTitle.get(title.toLowerCase()); return t ? hrefFromNote(t) : null; };
      const index = header(db, options.version);
      index.push('## Inhalt', '');
      index.push(...(nodes.length ? tocLines(nodes, hrefFromIndex) : ['Noch keine Notizen.']));
      index.push('', '## Offene Fragen', '', ...openQuestionLines(db, nodes, hrefFromIndex), '');
      index.push('## Offene Aufgaben', '', ...openTaskLines(db, nodes, hrefFromIndex), '');
      files.push({ path: 'index.md', data: index.join('\n') });
      for (const n of nodes) {
        const note = DB().getNote(db, n.id);
        const lines = [`# ${n.title.trim() || 'Ohne Titel'}`, '', ...metaLines(db, n, note), ''];
        const body = bodyToMarkdown(note.body, resolveFromNote, attFrom('../'));
        if (body) lines.push(body, '');
        if (n.children.length) {
          lines.push('---', '', '**Unternotizen**', '');
          for (const c of n.children) lines.push(`- [${c.title.trim() || 'Ohne Titel'}](${hrefFromNote(c)})`);
          lines.push('');
        }
        files.push({ path: `notes/${n.slug}.md`, data: lines.join('\n') });
      }
    } else {
      const anchorOf = n => `#${n.slug}`;
      const resolve = title => { const t = byTitle.get(title.toLowerCase()); return t ? anchorOf(t) : null; };
      const doc = header(db, options.version);
      doc.push('## Inhalt', '');
      doc.push(...(nodes.length ? tocLines(nodes, anchorOf) : ['Noch keine Notizen.']));
      doc.push('', '## Offene Fragen', '', ...openQuestionLines(db, nodes, anchorOf), '');
      doc.push('## Offene Aufgaben', '', ...openTaskLines(db, nodes, anchorOf), '');
      for (const n of nodes) {
        const note = DB().getNote(db, n.id);
        const level = Math.min(6, n.depth + 1);
        doc.push('---', '', `<a id="${n.slug}"></a>`, '', `${'#'.repeat(level)} ${n.title.trim() || 'Ohne Titel'}`, '', ...metaLines(db, n, note), '');
        const body = bodyToMarkdown(note.body, resolve, attFrom(''));
        if (body) doc.push(body, '');
      }
      files.push({ path: `${slugify(DB().getMapTitle(db))}.md`, data: doc.join('\n') });
    }

    for (const a of attachments) files.push({ path: `attachments/${attById.get(a.id)}`, data: a.data });
    if (options.svg) files.push({ path: 'mindmap.svg', data: options.svg });
    if (options.png) files.push({ path: 'mindmap.png', data: options.png });
    return files;
  }

  function renderSvg(db) {
    return Mindmap().toSvgString(DB().getTree(db), { mapTitle: DB().getMapTitle(db), expandAll: true });
  }

  /** SVG-Zeichenkette → PNG-Bytes über ein Canvas. */
  async function svgToPng(svgString, scale) {
    const k = scale || 2;
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Die Mindmap konnte nicht als Bild gerendert werden.'));
        img.src = url;
      });
      const m = /width="(\d+)" height="(\d+)"/.exec(svgString);
      const w = img.naturalWidth || (m ? Number(m[1]) : 800);
      const h = img.naturalHeight || (m ? Number(m[2]) : 600);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * k));
      canvas.height = Math.max(1, Math.round(h * k));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(k, k);
      ctx.drawImage(img, 0, 0);
      const png = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG konnte nicht erzeugt werden.')), 'image/png'));
      return new Uint8Array(await png.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function writeToDirectory(dir, files) {
    const enc = new TextEncoder();
    for (const f of files) {
      const parts = f.path.split('/');
      const name = parts.pop();
      let d = dir;
      for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
      const fh = await d.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      try {
        await w.write(f.data instanceof Uint8Array ? f.data : enc.encode(String(f.data)));
        await w.close();
      } catch (e) {
        try { await w.abort(); } catch (e2) { /* egal */ }
        throw e;
      }
    }
  }

  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function suggestedZipName(db) {
    return `NoNotes-${slugify(DB().getMapTitle(db))}-${stamp()}.zip`;
  }

  global.NoNotesExport = { buildFiles, renderSvg, svgToPng, writeToDirectory, suggestedZipName, slugify, bodyToMarkdown, treeOrder };
})(window);
