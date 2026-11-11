/* NoNotes – Export als PDF (seit 4.1.0). Zwei Formen wie beim Markdown-Export:

   - buildSingle: eine PDF-Datei. Seite 1 ist die Mindmap (A4 quer), danach Titel, Abschnitte der Erweiterungen, Inhaltsverzeichnis
     mit Seitenzahlen, offene Fragen, Entscheide und Aufgaben, dann alle Notizen (Überschrift je Tiefe im Baum). Lesezeichen für jede
     Notiz; Verweise [[…]] und das Inhaltsverzeichnis springen innerhalb der Datei.
   - buildFolder: index.pdf (Mindmap, Inhaltsverzeichnis, offene Punkte) und eine Datei pro Notiz in notes/… mit Ordnern wie im Baum
     (wie der Markdown-Export, Endung .pdf). Verweise und die Liste der Unternotizen führen von Datei zu Datei.

   Gesetzt wird wie im Druck (packages/ui/print.js), gezeichnet mit packages/core/pdf.js über packages/ui/pdf-layout.js. Bilder stecken
   in den Dateien. options: { archived, pageBreaks, version, svg (Mindmap), attachmentUrl(id), tableFormat, mapSections, onProgress(n, gesamt) }

   - buildNote (seit 4.3.0): eine Notiz allein, für den Versand per E-Mail und Teilen. */
(function (global) {
  'use strict';

  const { t, tn } = global.NoNotesI18n;
  const Pdf = () => global.NoNotesPdf;
  const Layout = () => global.NoNotesPdfLayout;
  const Exporter = () => global.NoNotesExport;
  const Printer = () => global.NoNotesPrint;
  const M = () => global.NoNotesMarkdown;
  const esc = s => M().escapeHtml(s);
  const titleOf = n => n.title.trim() || t('Ohne Titel');
  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat(global.NoNotesI18n.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
  const MAP_PX = 3200; // längste Seite des Mindmap-Bilds in Pixeln
  // Platz für die Seitenzahlen rechts im Inhaltsverzeichnis
  const EXTRA_CSS = '#pdfArea .print-toc li { padding-right: 2.5em; } #pdfArea .print-open { margin-bottom: 14pt; } #pdfArea .print-children { margin-top: 14pt; border-top: 1px solid #ccc; padding-top: 6pt; }';

  function newDoc(title, version) {
    return Pdf().create({ title, lang: global.NoNotesI18n.locale(), producer: `NoNotes ${version || ''}`.trim() });
  }

  const stampText = version => t('Exportiert am {datum} mit NoNotes {version}', { datum: fmtDate(new Date().toISOString()), version: version || '' });

  function headHtml(title, meta) {
    return `<header class="print-head"><h1>${esc(title)}</h1><p class="print-meta">${meta.map(esc).join(' · ')}</p></header>`;
  }

  function sectionsHtml(sections, resolveRef) {
    return (sections || []).map(sec => `<section class="print-map-section">${sec.title ? `<h2>${esc(sec.title)}</h2>` : ''}` +
      `<div class="md">${M().render(sec.markdown, { resolveRef, tableSrc: false })}</div></section>`).join('\n');
  }

  function tocHtml(nodes, hrefOf) {
    return '<nav class="print-toc" id="pdf-toc"><h2>' + esc(t('Inhalt')) + '</h2><ul>' + nodes.map(n =>
      `<li style="margin-left:${(Math.min(6, n.depth) - 1) * 14}px"><a href="${esc(hrefOf(n))}">${esc(titleOf(n))}</a></li>`).join('') + '</ul></nav>';
  }

  async function openHtml(backend, nodes, hrefOf, archived, resolveRef) {
    const lines = await Exporter().openLines(backend, nodes, hrefOf, archived);
    return `<section class="print-open"><div class="md">${M().render(lines.join('\n'), { resolveRef, tableSrc: false, placeholders: 'plain' })}</div></section>`;
  }

  /** Bytes eines Anhangs (<img data-attachment-id>) aus dem Backend, damit ein JPEG unverändert in die Datei kommt. */
  const imageBytes = backend => async el => {
    const id = Number(el.getAttribute('data-attachment-id'));
    if (!id) return null;
    const row = await backend.getAttachment(id);
    return row && row.data ? new Uint8Array(row.data) : null;
  };

  async function mapPage(doc, svg) {
    if (!svg) return false;
    try { Layout().imagePage(doc, await Layout().svgImage(doc, svg, MAP_PX), { landscape: true }); return true; }
    catch (e) { console.warn('PDF: Mindmap', e); return false; } // i18n-ignore: Protokoll
  }

  async function notesOf(backend, nodes, attachmentUrl) {
    const notes = new Map();
    for (const n of nodes) notes.set(n.id, await backend.getNote(n.id));
    return { notes, urls: await Printer().attachmentUrls(notes.values(), attachmentUrl) };
  }

  /** Lesezeichen aus der Baumreihenfolge: jede Notiz unter ihrer Elternnotiz. */
  function outlineOf(nodes, anchor) {
    const top = [];
    const byId = new Map();
    for (const n of nodes) {
      const pos = anchor(`print-note-${n.id}`);
      if (!pos) continue;
      const item = { title: titleOf(n), page: pos.page, y: pos.y, children: [] };
      byId.set(n.id, item);
      const parent = n.parentNode && byId.get(n.parentNode.id);
      (parent ? parent.children : top).push(item);
    }
    return top;
  }

  async function buildSingle(backend, options) {
    const opts = options || {};
    const archived = !!opts.archived;
    const nodes = await Exporter().treeOrder(backend, { archived });
    const mapTitle = await backend.getMapTitle();
    const resolveRef = await Printer().titleResolver(backend);
    const included = new Set(nodes.map(n => n.id));
    const { notes, urls } = await notesOf(backend, nodes, opts.attachmentUrl);
    const hrefOf = n => `#print-note-${n.id}`;
    const parts = [headHtml(mapTitle, [stampText(opts.version), tn('{n} Notiz', '{n} Notizen', nodes.length)])];
    parts.push(sectionsHtml(opts.mapSections, resolveRef));
    if (nodes.length) parts.push(tocHtml(nodes, hrefOf));
    parts.push(await openHtml(backend, nodes, hrefOf, archived, resolveRef));
    for (const [i, n] of nodes.entries()) {
      const note = notes.get(n.id);
      const level = Math.min(6, n.depth + 1);
      const body = Printer().noteBodyHtml(n, note, { resolveRef, urls, tableFormat: opts.tableFormat, refHref: id => (included.has(id) ? `#print-note-${id}` : null) });
      // Die erste Notiz beginnt auf einer neuen Seite, mit «Jede Notiz auf einer neuen Seite» auch jede weitere
      parts.push(`<section class="print-note${i === 0 || opts.pageBreaks ? ' page-break' : ''}" id="print-note-${n.id}"><h${level}>${esc(titleOf(n))}</h${level}>` +
        await Printer().metaHtml(backend, n, note) + `<div class="md">${body}</div></section>`);
    }
    if (!nodes.length) parts.push(`<p class="print-meta">${esc(t('Noch keine Notizen.'))}</p>`);

    const doc = newDoc(mapTitle, opts.version);
    const withMap = await mapPage(doc, opts.svg);
    if (opts.onProgress) opts.onProgress(0, 1);
    const r = await Layout().appendHtml(doc, parts.join('\n'), { pageNumbers: '.print-toc a', css: Layout().pdfCss() + '\n' + EXTRA_CSS, imageBytes: imageBytes(backend) });
    const outline = [];
    if (withMap) outline.push({ title: t('Mindmap'), page: 0, y: 0 });
    const toc = r.anchor('pdf-toc');
    if (toc) outline.push({ title: t('Inhalt'), page: toc.page, y: toc.y });
    outline.push(...outlineOf(nodes, r.anchor));
    doc.setOutline(outline);
    Layout().footer(doc, mapTitle);
    if (opts.onProgress) opts.onProgress(1, 1);
    return { name: (await Exporter().suggestedZipName(backend)).replace(/\.zip$/, '.pdf'), data: await doc.toBytes(), pages: doc.pages.length };
  }

  async function buildFolder(backend, options) {
    const opts = options || {};
    const archived = !!opts.archived;
    const nodes = await Exporter().treeOrder(backend, { archived });
    Exporter().placeFiles(nodes, '.pdf');
    const byId = new Map(nodes.map(n => [n.id, n]));
    const mapTitle = await backend.getMapTitle();
    const resolveRef = await Printer().titleResolver(backend);
    const { notes, urls } = await notesOf(backend, nodes, opts.attachmentUrl);
    const css = Layout().pdfCss() + '\n' + EXTRA_CSS;
    const stamp = stampText(opts.version);
    const files = [];
    const total = nodes.length + 1;
    const progress = n => { if (opts.onProgress) opts.onProgress(n, total); };

    progress(0);
    const index = newDoc(mapTitle, opts.version);
    await mapPage(index, opts.svg);
    const parts = [headHtml(mapTitle, [stamp, tn('{n} Notiz', '{n} Notizen', nodes.length)]), sectionsHtml(opts.mapSections, resolveRef)];
    parts.push(nodes.length ? tocHtml(nodes, n => n.file) : `<p class="print-meta">${esc(t('Noch keine Notizen.'))}</p>`);
    parts.push(await openHtml(backend, nodes, n => n.file, archived, resolveRef));
    await Layout().appendHtml(index, parts.join('\n'), { css, imageBytes: imageBytes(backend) });
    Layout().footer(index, mapTitle);
    files.push({ path: 'index.pdf', data: await index.toBytes() });
    progress(1);

    for (const [i, n] of nodes.entries()) {
      const note = notes.get(n.id);
      const doc = newDoc(titleOf(n), opts.version);
      const refHref = id => (byId.has(id) ? Exporter().relPath(n.file, byId.get(id).file) : null);
      const body = Printer().noteBodyHtml(n, note, { resolveRef, urls, tableFormat: opts.tableFormat, refHref });
      let html = headHtml(titleOf(n), [mapTitle, stamp]) +
        `<section class="print-note">${await Printer().metaHtml(backend, n, note)}<div class="md">${body}</div></section>`;
      if (n.children.length) {
        html += `<section class="print-children"><h2>${esc(t('Unternotizen'))}</h2><ul>` +
          n.children.map(c => `<li><a href="${esc(Exporter().relPath(n.file, c.file))}">${esc(titleOf(c))}</a></li>`).join('') + '</ul></section>';
      }
      await Layout().appendHtml(doc, html, { css, imageBytes: imageBytes(backend) });
      Layout().footer(doc, `${mapTitle} · ${titleOf(n)}`);
      files.push({ path: n.file, data: await doc.toBytes() });
      progress(i + 2);
    }
    return files;
  }

  /** Eine einzelne Notiz als PDF (seit 4.3.0, Versand per E-Mail und Teilen): Kopf mit Titel, Karte und Datum, Angaben, Text mit
   *  Bildern, darunter die Titel der Unternotizen. Verweise auf andere Notizen bleiben Text (die Datei steht allein); Adressen bleiben
   *  Links. Archivierte Notizen gehen auch. Ergebnis: { title, name (Titel.pdf), data, pages }. */
  async function buildNote(backend, id, options) {
    const opts = options || {};
    const nodes = await Exporter().treeOrder(backend, { archived: true });
    const n = nodes.find(x => x.id === id);
    if (!n) throw Object.assign(new Error(t('Notiz nicht gefunden.')), { code: 'NOTE_NOT_FOUND' });
    const mapTitle = await backend.getMapTitle();
    const resolveRef = await Printer().titleResolver(backend);
    const { notes, urls } = await notesOf(backend, [n], opts.attachmentUrl);
    const note = notes.get(n.id);
    const title = titleOf(n);
    const body = Printer().noteBodyHtml(n, note, { resolveRef, urls, tableFormat: opts.tableFormat, refHref: () => null });
    let html = headHtml(title, [mapTitle, stampText(opts.version)]) +
      `<section class="print-note">${await Printer().metaHtml(backend, n, note)}<div class="md">${body}</div></section>`;
    const children = n.children.filter(c => !c.archived_at || n.archived_at); // archivierte Unternotizen nur unter einer archivierten Notiz
    if (children.length) {
      html += `<section class="print-children"><h2>${esc(t('Unternotizen'))}</h2><ul>` + children.map(c => `<li>${esc(titleOf(c))}</li>`).join('') + '</ul></section>';
    }
    const doc = newDoc(title, opts.version);
    await Layout().appendHtml(doc, html, { css: Layout().pdfCss() + '\n' + EXTRA_CSS, imageBytes: imageBytes(backend) });
    Layout().footer(doc, `${mapTitle} · ${title}`);
    return { title, name: global.NoNotesMail.fileName(title, '.pdf', t('Notiz')), data: await doc.toBytes(), pages: doc.pages.length };
  }

  global.NoNotesPdfExport = { buildSingle, buildFolder, buildNote };
})(window);
