/* NoNotes – Export als Markdown mit Mindmap-Bild.
   Zwei Formen: ein Ordner mit index.md und einer Datei pro Notiz, oder eine einzige
   Markdown-Datei mit allen Notizen als Abschnitte. In beiden Fällen liegen mindmap.svg
   und mindmap.png daneben und werden oben in der Übersicht eingebunden.
   Eine Datei pro Notiz bildet den Baum als Ordner ab (seit 2.8.3): notes/planung.md, die Unternotizen in notes/planung/,
   deren Unternotizen in notes/planung/budget/ usw. Namen sind nur unter Geschwistern eindeutig zu machen; gleichnamige
   Notizen an verschiedenen Orten überschreiben sich so nicht. */
(function (global) {
  'use strict';

  const { t, tn } = global.NoNotesI18n;

  const Q = () => global.NoNotesQuestions;
  const Mindmap = () => global.NoNotesMindmap;

  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat(global.NoNotesI18n.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d); };

  function slugify(text) {
    const map = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue', ß: 'ss', é: 'e', è: 'e', ê: 'e', à: 'a', â: 'a', ç: 'c' };
    const s = String(text || '').replace(/[äöüÄÖÜßéèêàâç]/g, ch => map[ch] || ch)
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
    if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(s)) return s + '-notiz'; // unter Windows keine Dateinamen
    return s || 'notiz';
  }

  /** Eindeutige Namen (slug) innerhalb von nodes: gleiche Titel bekommen -2, -3 …, auch wenn ein Name wie «titel-2» schon
   *  aus einem anderen Titel entstanden ist. */
  function uniqueSlugs(nodes) {
    const used = new Set();
    for (const n of nodes) {
      const base = slugify(n.title.trim() || t('Ohne Titel'));
      let slug = base;
      for (let k = 2; used.has(slug); k++) slug = `${base}-${k}`;
      used.add(slug);
      n.slug = slug;
    }
  }

  /** Datei jeder Notiz im Ordner-Export: Notizen an der Wurzel in notes/, Unternotizen im Ordner ihrer Elternnotiz
   *  (notes/planung.md und notes/planung/budget.md). Setzt n.slug (eindeutig unter Geschwistern) und n.file. */
  function placeFiles(nodes) {
    const roots = nodes.filter(n => !n.parentNode);
    const place = (siblings, dir) => {
      uniqueSlugs(siblings);
      for (const n of siblings) {
        n.file = `${dir}/${n.slug}.md`;
        place(n.children, `${dir}/${n.slug}`);
      }
    };
    place(roots, 'notes');
  }

  /** Relativer Link von der Datei from zur Datei to (beide vom Export-Ordner aus, mit / getrennt). */
  function relPath(from, to) {
    const a = from.split('/').slice(0, -1), b = to.split('/');
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    return '../'.repeat(a.length - i) + b.slice(i).join('/');
  }

  /** Lebende Notizen in Baumreihenfolge (Tiefensuche), mit depth und children.
   *  options.archived: auch archivierte Notizen (sonst fehlen sie). */
  async function treeOrder(backend, options) {
    const rows = await backend.getTree({ archive: !!(options && options.archived) });
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
    while (p) { parts.unshift(p.title.trim() || t('Ohne Titel')); p = p.parentNode; }
    return parts;
  }

  /** Wandelt den Notiztext in portables Markdown: ?/?!/! werden zu Zitatblöcken, [[Titel]] zu Links. Ein Block ("?!```" … "```")
   *  wird ein Zitat mit Beschreibung, seine Unter-Einträge darin ein Zitat im Zitat; ein Eintrag in einer Liste bleibt ein Listenpunkt,
   *  ein Block in einer Liste ("- ?!```") ein Listenpunkt mit der Beschreibung eingerückt darunter.
   *  Code bleibt, wie er ist. inner: im Block (dort gibt es keine Blöcke). */
  function bodyToMarkdown(body, resolveLink, resolveAttachment, inner) {
    const P = global.NoNotesPlaceholders; // ausfüllbare Platzhalter (v2.12.0): nur die Werte, ohne Beschreibungen
    const lines = String(P && !inner ? P.plain(String(body || '')) : body || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const Q = global.NoNotesQuestions;
    const D = global.NoNotesDates;
    const md = text => inline(text, resolveLink, resolveAttachment);
    const labelOf = qb => qb.kind === 'decision' ? (qb.answer ? t('Entscheid (getroffen)') : t('Offener Entscheid')) : (qb.answer ? t('Frage (beantwortet)') : t('Offene Frage'));
    const headOf = qb => qb.kind === 'decision' ? (qb.decided && D ? t('Entschieden {datum}', { datum: D.formatDue(qb.decided) }) : t('Entschieden')) : t('Antwort');
    const dueOf = qb => qb.due && D ? ' (' + t('bis {datum}', { datum: D.formatDue(qb.due) }) + ')' : '';
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (fence) { out.push(line); if (line.trim().startsWith(fence)) fence = null; continue; }
      const qb = Q ? Q.parseBlock(lines, i, { list: true, inner: !!inner }) : null;
      if (qb && qb.list) {
        const lm = /^(\s*)((?:[-*+]|\d+[.)])\s+)/.exec(line);
        const pad = ' '.repeat(lm[0].length);
        const answer = qb.answer ? qb.answer.split('\n').map(md) : [];
        const inline = answer.length === 1 && !qb.block;
        out.push(`${lm[1]}${lm[2]}**${labelOf(qb)}:** ${md(qb.text)}${dueOf(qb)}${inline ? ` — **${headOf(qb)}:** ${answer[0]}` : ''}`);
        if (qb.block) {
          const content = Q.contentLines(lines, qb);
          if (qb.titleLine != null) content[qb.titleLine - qb.contentStart] = '';
          const described = bodyToMarkdown(content.join('\n'), resolveLink, resolveAttachment, true);
          if (described) { out.push(''); for (const l of described.split('\n')) out.push(l ? pad + l : ''); }
          if (answer.length) out.push('');
          if (answer.length === 1) out.push(`${pad}**${headOf(qb)}:** ${answer[0]}`);
        }
        if (answer.length > 1) { out.push(`${pad}**${headOf(qb)}:**  `); for (const a of answer) out.push(pad + a + '  '); }
        i = qb.end - 1;
        continue;
      }
      if (qb) {
        if (out.length && out[out.length - 1].trim() !== '' && !out[out.length - 1].startsWith('>')) out.push('');
        out.push(`> **${labelOf(qb)}:** ${md(qb.text)}${dueOf(qb)}`);
        if (qb.block) {
          const content = Q.contentLines(lines, qb);
          if (qb.titleLine != null) content[qb.titleLine - qb.contentStart] = '';
          const described = bodyToMarkdown(content.join('\n'), resolveLink, resolveAttachment, true);
          if (described) { out.push('>'); for (const l of described.split('\n')) out.push(l ? '> ' + l : '>'); }
          if (qb.answer) out.push('>');
        }
        if (qb.answer) {
          const rendered = qb.answer.split('\n').map(md);
          if (rendered.length === 1) out.push(`> **${headOf(qb)}:** ${rendered[0]}`);
          else { out.push(`> **${headOf(qb)}:**`); for (const a of rendered) out.push(`> ${a}`); } // Listen in Antworten bleiben Listen
        }
        if (qb.end < lines.length && lines[qb.end].trim() !== '') out.push('');
        i = qb.end - 1;
        continue;
      }
      const f = /^\s*(```|~~~)/.exec(line);
      if (f) { fence = f[1]; out.push(line); continue; }
      const a = /^\s*(?:!!|!(?!\[))\s?(.*)$/.exec(line);
      if (a) { out.push(`> **${t('Antwort')}:** ${md(a[1].trim())}`); continue; }
      out.push(md(line));
    }
    return out.join('\n').trim();
  }

  /** resolveLink(inhalt) → Pfad, oder { href, label } (seit 2.9.0: [[Titel#42]] zeigt nur «Titel»), oder null. */
  function inline(text, resolveLink, resolveAttachment) {
    let out = text.replace(/\[\[([^\]]+)\]\]/g, (m, inner) => {
      const title = inner.trim().replace(/\*$/, '').trim() || inner.trim(); // [[Titel*]] (Querverweis) wird derselbe Link
      const r = resolveLink ? resolveLink(title) : null;
      const href = r && typeof r === 'object' ? r.href : r;
      const label = r && typeof r === 'object' && r.label ? r.label : title;
      return href ? `[${label}](${href})` : label;
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

  async function metaLines(backend, node, note) {
    const lines = [];
    const path = pathTitles(node);
    if (path.length) lines.push(`*${t('Pfad: {pfad}', { pfad: path.join(' › ') })}*  `);
    lines.push(`*${t('Erstellt {erstellt} · Geändert {geaendert}', { erstellt: fmtDate(note.created_at), geaendert: fmtDate(note.updated_at) })}${note.archived_at ? ' · ' + t('Archiviert {datum}', { datum: fmtDate(note.archived_at) }) : ''}*  `);
    const tags = await backend.getTags(node.id);
    if (tags.length) lines.push(`*${t('Tags: {tags}', { tags: tags.join(', ') })}*  `);
    return lines;
  }

  function tocLines(nodes, hrefOf) {
    return nodes.map(n => `${'  '.repeat(n.depth - 1)}- [${n.title.trim() || t('Ohne Titel')}](${hrefOf(n)})${n.archived_at ? ' *(' + t('archiviert') + ')*' : ''}`);
  }

  async function openQuestionLines(backend, nodes, hrefOf, archived, kind) {
    const D = global.NoNotesDates;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const rows = await backend.listQuestions({ status: 'open', sort: 'due', archived, kind: kind || 'question' });
    if (!rows.length) return [kind === 'decision' ? t('Keine offenen Entscheide.') : t('Keine offenen Fragen.')];
    return rows.map(r => {
      const n = byId.get(r.note_id);
      const due = r.due && D ? ' (' + t('bis {datum}', { datum: D.formatDue(r.due) }) + ')' : '';
      const within = r.parent_text ? ' (' + t('Teil von «{titel}»', { titel: r.parent_text }) + ')' : '';
      return n ? `- ${r.text}${due}${within} — ${t('aus')} [${n.title.trim() || t('Ohne Titel')}](${hrefOf(n)})` : `- ${r.text}${due}${within}`;
    });
  }

  /** Der Abschnitt «Offene Entscheide» erscheint nur, wenn es überhaupt Entscheide gibt (wie der Reiter in der App). */
  async function hasDecisions(backend, archived) {
    return (await backend.listQuestions({ status: 'all', kind: 'decision', archived })).length > 0;
  }

  async function openTaskLines(backend, nodes, hrefOf, archived) {
    const T = global.NoNotesTasks;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const rows = await backend.listTasks({ status: 'open', sort: 'due', archived });
    if (!rows.length) return [t('Keine offenen Aufgaben.')];
    return rows.map(r => {
      const n = byId.get(r.note_id);
      const due = (r.due ? ' (' + t('bis {datum}', { datum: T.formatDue(r.due) }) + ')' : '') + (r.parent_text ? ' · ' + t('Teil von „{aufgabe}“', { aufgabe: r.parent_text }) : '');
      return n ? `- [ ] ${r.text}${due} — ${t('aus')} [${n.title.trim() || t('Ohne Titel')}](${hrefOf(n)})` : `- [ ] ${r.text}${due}`;
    });
  }

  /** Kopf der Übersicht: Titel, Datum, Mindmap-Bild und darunter die Abschnitte der Erweiterungen (sections: [{ title, markdown }],
   *  etwa eine Legende, seit 2.11.0). */
  async function header(backend, version, sections) {
    const title = await backend.getMapTitle();
    const out = [
      `# ${title}`,
      '',
      `*${t('Exportiert am {datum} mit NoNotes {version}', { datum: fmtDate(new Date().toISOString()), version: version || '' })}*`.trim(),
      '',
      '![Mindmap](mindmap.svg)',
      '',
    ];
    for (const sec of sections || []) {
      if (sec.title) out.push(`## ${sec.title}`, '');
      out.push(String(sec.markdown).trim(), '');
    }
    return out;
  }

  /** Erzeugt die Dateiliste. options: { mode: 'folder' | 'single', svg, png, version, archived, sections } */
  async function buildFiles(backend, options) {
    const mode = options.mode === 'single' ? 'single' : 'folder';
    const archived = !!options.archived;
    const nodes = await treeOrder(backend, { archived });
    // [[Titel]] und [[Titel#42]] wie in der App auflösen; Ziele ausserhalb des Exports (etwa archiviert) bleiben Text
    const findRef = global.NoNotesLinks.resolver(await backend.titleIndex());
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const refTo = (title, hrefOf) => {
      const r = findRef(title);
      const target = r.id != null ? nodeById.get(r.id) : null;
      return { href: target ? hrefOf(target) : null, label: r.label || title };
    };
    const files = [];

    // Anhänge: Dateiname aus Nummer und bereinigtem Namen, Pfad relativ zur jeweiligen Markdown-Datei.
    const attachments = await backend.allAttachments({ archived });
    const attName = a => {
      const ext = (a.name.match(/\.[a-z0-9]{2,5}$/i) || [''])[0].toLowerCase();
      const base = slugify(a.name.replace(/\.[a-z0-9]{2,5}$/i, '')) || 'anhang';
      return `${a.id}-${base}${ext}`;
    };
    const attById = new Map(attachments.map(a => [a.id, attName(a)]));
    const attFrom = from => id => attById.has(id) ? relPath(from, `attachments/${attById.get(id)}`) : null;

    if (mode === 'folder') {
      placeFiles(nodes);
      const hrefFromIndex = n => n.file;
      const index = await header(backend, options.version, options.sections);
      index.push('## Inhalt', '');
      index.push(...(nodes.length ? tocLines(nodes, hrefFromIndex) : [t('Noch keine Notizen.')]));
      index.push('', '## ' + t('Offene Fragen'), '', ...await openQuestionLines(backend, nodes, hrefFromIndex, archived), '');
      if (await hasDecisions(backend, archived)) index.push('## ' + t('Offene Entscheide'), '', ...await openQuestionLines(backend, nodes, hrefFromIndex, archived, 'decision'), '');
      index.push('## ' + t('Offene Aufgaben'), '', ...await openTaskLines(backend, nodes, hrefFromIndex, archived), '');
      files.push({ path: 'index.md', data: index.join('\n') });
      for (const n of nodes) {
        const note = await backend.getNote(n.id);
        const lines = [`# ${n.title.trim() || t('Ohne Titel')}`, '', ...await metaLines(backend, n, note), ''];
        const resolve = title => refTo(title, target => relPath(n.file, target.file));
        const body = bodyToMarkdown(note.body, resolve, attFrom(n.file));
        if (body) lines.push(body, '');
        if (n.children.length) {
          lines.push('---', '', `**${t('Unternotizen')}**`, '');
          for (const c of n.children) lines.push(`- [${c.title.trim() || t('Ohne Titel')}](${relPath(n.file, c.file)})`);
          lines.push('');
        }
        files.push({ path: n.file, data: lines.join('\n') });
      }
    } else {
      uniqueSlugs(nodes); // Anker in einer Datei: über alle Notizen eindeutig
      const anchorOf = n => `#${n.slug}`;
      const resolve = title => refTo(title, anchorOf);
      const doc = await header(backend, options.version, options.sections);
      doc.push('## Inhalt', '');
      doc.push(...(nodes.length ? tocLines(nodes, anchorOf) : [t('Noch keine Notizen.')]));
      doc.push('', '## ' + t('Offene Fragen'), '', ...await openQuestionLines(backend, nodes, anchorOf, archived), '');
      if (await hasDecisions(backend, archived)) doc.push('## ' + t('Offene Entscheide'), '', ...await openQuestionLines(backend, nodes, anchorOf, archived, 'decision'), '');
      doc.push('## ' + t('Offene Aufgaben'), '', ...await openTaskLines(backend, nodes, anchorOf, archived), '');
      for (const n of nodes) {
        const note = await backend.getNote(n.id);
        const level = Math.min(6, n.depth + 1);
        doc.push('---', '', `<a id="${n.slug}"></a>`, '', `${'#'.repeat(level)} ${n.title.trim() || t('Ohne Titel')}`, '', ...await metaLines(backend, n, note), '');
        const body = bodyToMarkdown(note.body, resolve, id => (attById.has(id) ? `attachments/${attById.get(id)}` : null));
        if (body) doc.push(body, '');
      }
      files.push({ path: `${slugify(await backend.getMapTitle())}.md`, data: doc.join('\n') });
    }

    for (const a of attachments) files.push({ path: `attachments/${attById.get(a.id)}`, data: a.data });
    if (options.svg) files.push({ path: 'mindmap.svg', data: options.svg });
    if (options.png) files.push({ path: 'mindmap.png', data: options.png });
    return files;
  }

  /** Hauptfarbe der Datenbank (helle Fassung) für das Mindmap-Bild. */
  async function accentOf(backend) {
    const P = global.NoNotesPalette;
    return P.light(await backend.getMeta('accent'));
  }

  async function renderSvg(backend, options) {
    return Mindmap().toSvgString(await backend.getTree({ archive: !!(options && options.archived) }), {
      mapTitle: await backend.getMapTitle(), expandAll: true, accent: await accentOf(backend), links: await backend.getLinks(),
    });
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
        img.onerror = () => reject(new Error(t('Die Mindmap konnte nicht als Bild gerendert werden.')));
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
      const png = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error(t('PNG konnte nicht erzeugt werden.'))), 'image/png'));
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

  async function suggestedZipName(backend) {
    return `NoNotes-${slugify(await backend.getMapTitle())}-${stamp()}.zip`;
  }

  global.NoNotesExport = { buildFiles, renderSvg, accentOf, svgToPng, writeToDirectory, suggestedZipName, slugify, bodyToMarkdown, treeOrder, relPath };
})(window);
