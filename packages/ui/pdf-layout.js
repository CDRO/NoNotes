/* NoNotes – Satz für den PDF-Export (seit 4.1.0): HTML → Seiten im PDF-Schreiber (packages/core/pdf.js). i18n-ignore-file (keine
   Texte für Menschen: Schriftnamen, CSS-Eigenschaften)

   Der Browser setzt das Dokument in einem unsichtbaren Bereich (#pdfArea) mit den Regeln des Drucks (aus @media print der
   Stylesheets, #printArea → #pdfArea) und in Helvetica. Danach liest dieser Satz ab, was wo steht: Wörter (je mit Schrift, Grösse,
   Farbe, Grundlinie), Flächen und Rahmen, Bilder, Kästchen, Listenzeichen, Links und Anker. Er bricht die Seiten selbst um: nie
   mitten durch eine Zeile, ein Bild oder einen Block mit break-inside: avoid (etwa eine Tabellenzeile oder eine Frage), eine
   Überschrift bleibt bei ihrem Text, break-before: page erzwingt eine neue Seite, und die Titelzeile einer Tabelle steht auf jeder
   Seite, über die die Tabelle läuft. Zeichen ausserhalb der Standardschriften (→, ✓, Emojis, andere Schriften) zeichnet der
   Browser als kleine Bilder hinein; sie sind zu sehen, aber nicht durchsuchbar.

     const doc = NoNotesPdf.create({ … });
     NoNotesPdfLayout.imagePage(doc, image, { landscape: true })      Seite mit einem Bild (Mindmap), eingepasst
     const r = await NoNotesPdfLayout.appendHtml(doc, html, { linkTarget(href), pageNumbers: '.print-toc a' })
       r.pages (die neuen Seiten), r.anchor(id) → { page, y } oder null
     NoNotesPdfLayout.footer(doc, title)                               Fusszeile auf allen Seiten: Titel links, «3 / 12» rechts
     await NoNotesPdfLayout.svgImage(doc, svgString, maxPx)           SVG (Mindmap) als Bild im Dokument */
(function (global) {
  'use strict';

  const Pdf = () => global.NoNotesPdf;
  const PX = 0.75; // Punkt je CSS-Pixel
  const MARGIN = 16 * 72 / 25.4; // wie @page im Druck
  const GLYPH_SCALE = 4; // Auflösung für Zeichen als Bild

  // ---------- Stylesheet für #pdfArea aus den Druckregeln ----------

  /** Ergänzt die festen Regeln in app.css (:is(#printArea, #pdfArea) …, #pdfArea): Regeln aus @media print der lesbaren
   *  Stylesheets, umgeschrieben auf #pdfArea (etwa die von Erweiterungen), und die hellen Farben aus :root (etwa die Hauptfarbe).
   *  Stylesheets, die von file:// kommen, lassen sich nicht lesen; darum stehen die Regeln des Drucks selbst nicht in @media print. */
  function pdfCss() {
    const rules = [];
    const vars = [];
    const mapSelector = sel => {
      const s = sel.trim().replace(/^body\.printing\s+/, '');
      if (/:not\([^)]*#printArea/.test(s)) return null;
      if (/^#printArea\b/.test(s)) return s.replace(/#printArea\b/g, '#pdfArea');
      if (/^(html|body|:root)\b/.test(s) || s.includes('#printArea')) return null;
      return '#pdfArea ' + s;
    };
    const walk = (list, inPrint) => {
      for (const r of list) {
        if (r.media && r.cssRules) {
          const m = r.media.mediaText;
          walk(r.cssRules, inPrint || (/\bprint\b/.test(m) && !/\bnot\s+print\b/.test(m)));
          continue;
        }
        if (r.cssRules && !r.selectorText) { walk(r.cssRules, inPrint); continue; } // @supports, @layer
        if (!r.selectorText || !r.style) continue;
        if (inPrint) {
          const sels = r.selectorText.split(/,(?![^(]*\))/).map(mapSelector).filter(Boolean);
          if (sels.length) rules.push(`${sels.join(', ')} { ${r.style.cssText} }`);
        } else if (r.selectorText.trim() === ':root') {
          for (let i = 0; i < r.style.length; i++) {
            const name = r.style[i];
            if (name.startsWith('--')) vars.push(`${name}: ${r.style.getPropertyValue(name)};`);
          }
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let list = null;
      try { list = sheet.cssRules; } catch (e) { continue; } // fremde Stylesheets lassen sich nicht lesen
      if (list) walk(list, false);
    }
    return [`#pdfArea { ${vars.join(' ')} }`, ...rules, '#pdfArea img { max-height: 230mm; }'].join('\n');
  }

  // ---------- Farben und Schriften ----------

  let colorCanvas = null;
  /** CSS-Farbe → [r, g, b] (0…1) auf weissem Papier (Deckkraft eingerechnet) oder null für durchsichtig. */
  function colorOf(css, opacity) {
    if (!css || css === 'transparent') return null;
    let r, g, b, a = 1;
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(css);
    if (m) { r = +m[1] / 255; g = +m[2] / 255; b = +m[3] / 255; if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]; }
    else if ((m = /^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(css))) {
      r = +m[1]; g = +m[2]; b = +m[3]; if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
    } else {
      colorCanvas = colorCanvas || document.createElement('canvas').getContext('2d');
      colorCanvas.fillStyle = '#000';
      colorCanvas.fillStyle = css;
      const v = colorCanvas.fillStyle;
      if (v === css || !/^(#|rgb)/.test(v)) return [0, 0, 0];
      return colorOf(v, opacity);
    }
    a *= opacity == null ? 1 : opacity;
    if (a <= 0.01) return null;
    const mix = v => Math.max(0, Math.min(1, v * a + (1 - a)));
    return [mix(r), mix(g), mix(b)];
  }

  const px = v => parseFloat(v) || 0;

  /** Schrift im PDF zur berechneten Schrift: Courier für Festbreite, sonst Helvetica; fett ab 600, kursiv. */
  function pdfFont(cs) {
    const mono = /mono|courier|consolas|menlo|monaco/i.test(cs.fontFamily);
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
    const italic = /italic|oblique/.test(cs.fontStyle);
    const base = mono ? 'Courier' : 'Helvetica';
    if (bold && italic) return base + '-BoldOblique';
    if (bold) return base + '-Bold';
    if (italic) return base + '-Oblique';
    return base;
  }

  const cssFont = cs => `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ratios = new Map();
  /** Lage der Grundlinie im Kasten eines Textstücks (Anteil der Höhe von oben), aus den Massen der benutzten Schrift. */
  function baselineRatio(cs) {
    const key = cssFont(cs);
    if (ratios.has(key)) return ratios.get(key);
    let ratio = 0.8;
    try {
      const c = document.createElement('canvas').getContext('2d');
      c.font = key;
      const m = c.measureText('Hg');
      if (m.fontBoundingBoxAscent > 0) ratio = m.fontBoundingBoxAscent / (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent);
    } catch (e) { /* Vorgabe */ }
    ratios.set(key, ratio);
    return ratio;
  }

  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  /** Zeichen (Graphem-Cluster) mit ihrer Stelle im Text. */
  function graphemes(text, from, to) {
    const out = [];
    const part = text.slice(from, to);
    if (segmenter) { for (const s of segmenter.segment(part)) out.push({ s: from + s.index, e: from + s.index + s.segment.length, str: s.segment }); }
    else { let i = from; for (const ch of part) { out.push({ s: i, e: i + ch.length, str: ch }); i += ch.length; } }
    return out;
  }

  // ---------- Ablesen ----------

  /** Ersetzt ::before und ::after mit Text durch echte Elemente, damit ihr Text messbar wird (etwa «↗ » vor Links auf Notizen). */
  function materializePseudo(area) {
    for (const el of area.querySelectorAll('*')) {
      for (const which of ['before', 'after']) {
        const ps = getComputedStyle(el, '::' + which);
        const content = ps.content;
        if (!content || content === 'none' || content === 'normal') continue;
        const m = /^"((?:[^"\\]|\\.)*)"$/.exec(content);
        if (!m) continue; // Zähler, Bilder, attr(): nicht nachgebaut
        const span = document.createElement('span');
        span.textContent = m[1].replace(/\\(.)/g, '$1');
        const st = span.style;
        for (const p of ['color', 'opacity', 'font-weight', 'font-style', 'font-size', 'vertical-align', 'margin-left', 'margin-right', 'letter-spacing', 'border-radius']) st.setProperty(p, ps.getPropertyValue(p));
        if (ps.display !== 'inline') { st.display = ps.display === 'block' ? 'block' : 'inline-block'; st.width = ps.width; st.height = ps.height; }
        const masked = (ps.maskImage && ps.maskImage !== 'none') || (ps.webkitMaskImage && ps.webkitMaskImage !== 'none');
        st.backgroundColor = masked ? 'transparent' : ps.backgroundColor;
        if (which === 'before') el.insertBefore(span, el.firstChild); else el.appendChild(span);
        el.setAttribute('data-pdf-' + which, '');
      }
    }
  }

  function waitForImages(area) {
    const imgs = [...area.querySelectorAll('img')];
    return Promise.all(imgs.map(img => new Promise(resolve => {
      const done = () => { if (img.decode) img.decode().then(resolve, resolve); else resolve(); };
      if (img.complete) { done(); return; }
      const timer = setTimeout(resolve, 15000);
      img.addEventListener('load', () => { clearTimeout(timer); done(); }, { once: true });
      img.addEventListener('error', () => { clearTimeout(timer); resolve(); }, { once: true });
    })));
  }

  const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  function counterText(n, type) {
    if (/roman/.test(type)) {
      let s = '', v = n;
      for (const [k, r] of ROMAN) while (v >= k) { s += r; v -= k; }
      return type.startsWith('upper') ? s.toUpperCase() : s;
    }
    if (/alpha|latin/.test(type)) {
      let s = '', v = n;
      while (v > 0) { v--; s = String.fromCharCode(97 + (v % 26)) + s; v = Math.floor(v / 26); }
      return type.startsWith('upper') ? s.toUpperCase() : s;
    }
    if (type === 'decimal-leading-zero') return String(n).padStart(2, '0');
    return String(n);
  }

  /** Liest den gesetzten Bereich ab. Alle Masse in CSS-Pixeln relativ zur linken oberen Ecke des Bereichs. */
  function collect(area, contentHeight) {
    const origin = area.getBoundingClientRect();
    const R = r => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
    const items = [];
    const atoms = [];
    const breaks = [];
    const keepNext = [];
    const anchors = new Map();
    const links = [];
    const theads = [];
    const styles = new Map();
    const style = el => { let s = styles.get(el); if (!s) { s = getComputedStyle(el); styles.set(el, s); } return s; };
    const range = document.createRange();
    const atom = (top, bottom) => { if (bottom - top > 0.5) atoms.push([top, bottom]); };

    function decorations(el) {
      const out = [];
      for (let e = el; e && e !== area.parentNode; e = e.parentElement) {
        const s = style(e);
        const lines = String(s.textDecorationLine || '');
        for (const l of ['underline', 'line-through']) if (lines.includes(l)) out.push({ line: l, color: colorOf(s.textDecorationColor), dashed: /dashed|dotted/.test(s.textDecorationStyle) });
        if (s.display !== 'inline' && s.display !== 'contents') break;
      }
      return out;
    }

    function borders(cs, rects, op) {
      const sides = ['Top', 'Right', 'Bottom', 'Left'].map(S => ({ w: px(cs['border' + S + 'Width']), style: cs['border' + S + 'Style'], color: colorOf(cs['border' + S + 'Color'], op) }));
      const shown = s => s.w > 0 && s.style !== 'none' && s.style !== 'hidden' && s.color;
      if (!sides.some(shown)) return;
      const radius = px(cs.borderTopLeftRadius);
      const same = sides.every(s => shown(s) && s.w === sides[0].w && s.style === sides[0].style && String(s.color) === String(sides[0].color));
      for (const raw of rects) {
        const r = R(raw);
        if (r.w <= 0 || r.h <= 0) continue;
        if (same && radius > 0) {
          const w = sides[0].w;
          items.push({ k: 'stroke', x: r.x + w / 2, y: r.y + w / 2, w: r.w - w, h: r.h - w, color: sides[0].color, lw: w, radius: Math.max(0, radius - w / 2), dash: /dashed|dotted/.test(sides[0].style) ? [w * 3, w * 2] : null });
          continue;
        }
        const [t, rt, b, l] = sides;
        const side = (s, x1, y1, x2, y2, fill) => {
          if (!shown(s)) return;
          if (/dashed|dotted/.test(s.style)) items.push({ k: 'line', x1, y1, x2, y2, y: Math.min(y1, y2), h: Math.abs(y2 - y1), color: s.color, lw: s.w, dash: s.style === 'dotted' ? [s.w, s.w] : [s.w * 3, s.w * 2] });
          else items.push(Object.assign({ k: 'fill', color: s.color, radius: 0 }, fill));
        };
        side(t, r.x, r.y + t.w / 2, r.x + r.w, r.y + t.w / 2, { x: r.x, y: r.y, w: r.w, h: t.w });
        side(b, r.x, r.y + r.h - b.w / 2, r.x + r.w, r.y + r.h - b.w / 2, { x: r.x, y: r.y + r.h - b.w, w: r.w, h: b.w });
        side(l, r.x + l.w / 2, r.y, r.x + l.w / 2, r.y + r.h, { x: r.x, y: r.y, w: l.w, h: r.h });
        side(rt, r.x + r.w - rt.w / 2, r.y, r.x + r.w - rt.w / 2, r.y + r.h, { x: r.x + r.w - rt.w, y: r.y, w: rt.w, h: r.h });
      }
    }

    function textNode(node, parent, cs, op) {
      const text = node.data;
      if (!text.trim()) return;
      const color = colorOf(cs.color, op);
      if (!color) return;
      const font = pdfFont(cs);
      const size = px(cs.fontSize);
      const ratio = baselineRatio(cs);
      const transform = cs.textTransform === 'uppercase' ? s => s.toUpperCase() : cs.textTransform === 'lowercase' ? s => s.toLowerCase() : s => s;
      const deco = decorations(parent);
      const rectsOf = (s, e) => { range.setStart(node, s); range.setEnd(node, e); return [...range.getClientRects()].filter(r => r.width > 0.01 && r.height > 0.01); };
      const pieces = [];
      const push = (s, e, raw, raster) => {
        const r = R(raw);
        pieces.push({ s, e, x: r.x, y: r.y, w: r.w, h: r.h, raster });
      };
      const re = /\S+/g;
      let m;
      while ((m = re.exec(text))) {
        const s = m.index, e = s + m[0].length;
        const word = transform(m[0]);
        if (Pdf().encodable(word)) {
          const rects = rectsOf(s, e);
          if (rects.length === 1) { push(s, e, rects[0], false); continue; }
          if (!rects.length) continue;
        }
        // Zeichen für Zeichen: umbrochene Wörter, Zeichen ausserhalb der Standardschriften
        let run = null;
        const flush = () => { if (run) { for (const r of rectsOf(run.s, run.e)) push(run.s, run.e, r, false); run = null; } };
        for (const g of graphemes(text, s, e)) {
          if (Pdf().encodable(transform(g.str))) {
            const rs = rectsOf(g.s, g.e);
            if (run && rs.length === 1 && Math.abs(R(rs[0]).y - run.y) < 1) { run.e = g.e; continue; }
            flush();
            if (rs.length) run = { s: g.s, e: g.e, y: R(rs[0]).y };
            continue;
          }
          flush();
          for (const r of rectsOf(g.s, g.e)) push(g.s, g.e, r, true);
        }
        flush();
      }
      const lines = new Map();
      for (const p of pieces) {
        const str = transform(text.slice(p.s, p.e));
        if (p.raster) items.push({ k: 'glyph', x: p.x, y: p.y, w: p.w, h: p.h, str, css: cssFont(cs), color, base: p.h * ratio });
        else items.push({ k: 'text', x: p.x, y: p.y, w: p.w, h: p.h, base: p.y + p.h * ratio, str, font, size: size * PX, color });
        const key = Math.round(p.y * 2);
        const line = lines.get(key);
        if (line) { line.x1 = Math.min(line.x1, p.x); line.x2 = Math.max(line.x2, p.x + p.w); line.h = Math.max(line.h, p.h); }
        else lines.set(key, { x1: p.x, x2: p.x + p.w, y: p.y, h: p.h });
      }
      for (const line of lines.values()) {
        atom(line.y, line.y + line.h);
        for (const d of deco) {
          const base = line.y + line.h * ratio;
          const yy = d.line === 'underline' ? base + size * 0.12 : base - size * 0.3;
          items.push({ k: 'line', x1: line.x1, y1: yy, x2: line.x2, y2: yy, y: yy, h: 0, color: d.color || color, lw: Math.max(0.6, size * 0.065), dash: d.dashed ? [2, 2] : null });
        }
      }
    }

    function marker(li, cs, op, from) {
      const type = cs.listStyleType;
      if (!type || type === 'none' || cs.listStylePosition === 'inside') return;
      const color = colorOf(cs.color, op);
      if (!color) return;
      const r = R(li.getBoundingClientRect());
      const size = px(cs.fontSize);
      const first = items.slice(from).find(it => it.k === 'text' || it.k === 'glyph');
      const base = first ? (first.k === 'text' ? first.base : first.y + first.base) : r.y + size * 0.9;
      const gap = size * 0.3;
      if (type === 'disc' || type === 'circle' || type === 'square') {
        const d = size * 0.34;
        const cx = r.x - gap - d / 2 - size * 0.12;
        const cy = base - size * 0.3;
        items.push({ k: 'bullet', shape: type, x: cx - d / 2, y: cy - d / 2, w: d, h: d, color });
        return;
      }
      const list = li.parentElement;
      let n = list && list.tagName === 'OL' ? (parseInt(list.getAttribute('start'), 10) || 1) : 1;
      for (const sib of list ? list.children : []) {
        if (sib === li) break;
        if (sib.tagName === 'LI') n = (sib.hasAttribute('value') ? parseInt(sib.getAttribute('value'), 10) : n) + 1;
      }
      if (li.hasAttribute('value')) n = parseInt(li.getAttribute('value'), 10) || n;
      const str = counterText(n, type) + '.';
      const font = pdfFont(cs);
      const w = Pdf().measure(str, font, size * PX) / PX;
      items.push({ k: 'text', x: r.x - gap - w, y: base - size, w, h: size * 1.2, base, str, font, size: size * PX, color });
    }

    function walk(el, opacity) {
      const cs = style(el);
      if (cs.display === 'none') return;
      const op = opacity * (cs.opacity === '' ? 1 : px(cs.opacity) || (cs.opacity === '0' ? 0 : 1));
      if (op <= 0.01) return;
      const box = el.getBoundingClientRect();
      const r = R(box);
      if (el.id) anchors.set(el.id, r.y);
      if (cs.breakBefore === 'page' || cs.pageBreakBefore === 'always') breaks.push(r.y);
      const inline = cs.display === 'inline';
      const rects = inline ? [...el.getClientRects()] : [box];
      const hidden = cs.visibility === 'hidden';
      if (!hidden) {
        const bg = colorOf(cs.backgroundColor, op);
        if (bg) for (const raw of rects) { const q = R(raw); if (q.w > 0 && q.h > 0) items.push({ k: 'fill', x: q.x, y: q.y, w: q.w, h: q.h, color: bg, radius: px(cs.borderTopLeftRadius) }); }
        borders(cs, rects, op);
      }
      if (!inline && (cs.breakInside === 'avoid' || cs.pageBreakInside === 'avoid') && r.h <= contentHeight) atom(r.y, r.y + r.h);
      if (!inline && cs.breakAfter === 'avoid') keepNext.push(r);
      const tag = el.tagName;
      if (tag === 'THEAD') { const table = el.closest('table'); if (table) theads.push({ head: r, table: R(table.getBoundingClientRect()) }); }
      if (tag === 'IMG') { if (!hidden && r.w > 0 && r.h > 0) { items.push({ k: 'img', x: r.x, y: r.y, w: r.w, h: r.h, el }); atom(r.y, r.y + Math.min(r.h, contentHeight)); } return; }
      if (tag === 'svg' || tag === 'SVG' || tag === 'CANVAS') { if (!hidden && r.w > 0 && r.h > 0) { items.push({ k: tag === 'CANVAS' ? 'canvas' : 'svg', x: r.x, y: r.y, w: r.w, h: r.h, el, color: cs.color }); atom(r.y, r.y + Math.min(r.h, contentHeight)); } return; }
      if (tag === 'INPUT') {
        if (!hidden && (el.type === 'checkbox' || el.type === 'radio') && r.w > 0) { items.push({ k: 'check', x: r.x, y: r.y, w: r.w, h: r.h, checked: el.checked, radio: el.type === 'radio' }); atom(r.y, r.y + r.h); }
        return;
      }
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') return;
      if (tag === 'A' && el.getAttribute('href') != null) {
        links.push({ href: el.getAttribute('href'), rects: [...el.getClientRects()].map(R).filter(q => q.w > 0 && q.h > 0), el });
      }
      const from = items.length;
      for (const child of el.childNodes) {
        if (child.nodeType === 1) walk(child, op);
        else if (child.nodeType === 3 && !hidden) textNode(child, el, cs, op);
      }
      if (cs.display === 'list-item' && !hidden) marker(el, cs, op, from);
    }

    walk(area, 1);
    // Überschrift mit break-after: avoid bleibt mit der ersten Zeile danach zusammen
    atoms.sort((a, b) => a[0] - b[0]);
    for (const h of keepNext) {
      const next = atoms.find(a => a[0] >= h.y + h.h - 0.5);
      if (next && next[1] - h.y <= contentHeight / 2) atoms.push([h.y, next[1]]);
    }
    atoms.sort((a, b) => a[0] - b[0]);
    return { items, atoms, breaks: breaks.filter(y => y > 1).sort((a, b) => a - b), anchors, links, theads, height: area.getBoundingClientRect().height };
  }

  // ---------- Umbruch ----------

  /** Teilt die Höhe in Seiten: [{ from, to, repeat }] (repeat: Bereich der Titelzeile einer Tabelle, die oben wiederholt wird). */
  function paginate(layout, H) {
    const { atoms, breaks, theads, height } = layout;
    const blockedTop = y => {
      let top = null;
      for (const [a, b] of atoms) {
        if (a > y) break;
        if (a < y - 0.5 && b > y + 0.5) top = top == null ? a : Math.min(top, a);
      }
      return top;
    };
    const pages = [];
    let start = 0;
    let guard = 0;
    while (start < height - 0.5 && guard++ < 100000) {
      const head = theads.find(t => t.table.y < start - 0.5 && t.table.y + t.table.h > start + 0.5 && t.head.y + t.head.h <= start + 0.5 && t.head.h < H / 3);
      const rh = head ? head.head.h : 0;
      const limit = start + H - rh;
      const forced = breaks.find(b => b > start + 0.5 && b <= limit);
      let cut;
      if (forced != null) cut = forced;
      else if (limit >= height) cut = height;
      else {
        let y = limit;
        for (let t = blockedTop(y); t != null; t = blockedTop(y)) y = t;
        cut = y <= start + 0.5 ? limit : y;
      }
      pages.push({ from: start, to: cut, repeat: head ? { from: head.head.y, to: head.head.y + head.head.h, x: head.table.x, w: head.table.w } : null });
      start = cut;
    }
    if (!pages.length) pages.push({ from: 0, to: Math.max(1, height), repeat: null });
    return pages;
  }

  // ---------- Bilder ----------

  function imageData(canvas) {
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const n = canvas.width * canvas.height;
    const rgb = new Uint8Array(n * 3);
    const alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) { rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2]; alpha[i] = data[i * 4 + 3]; }
    return { width: canvas.width, height: canvas.height, rgb, alpha };
  }

  function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image'));
      img.src = src;
    });
  }

  /** Bild im Dokument zu einem <img>: ein JPEG unverändert, wenn es nicht viel grösser ist als nötig, sonst über ein Canvas.
   *  bytesOf(el) liefert die Bytes des Bilds (etwa eines Anhangs aus dem Backend) oder null; sonst wird die Adresse geholt (im Dienst
   *  verbietet die Content-Security-Policy fetch() auf blob:, dann bleibt das Canvas). */
  async function imageFor(doc, el, wPt, hPt, cache, bytesOf) {
    const src = el.currentSrc || el.src;
    const maxPx = Math.max(64, Math.ceil(Math.max(wPt, hPt) * 3)); // etwa 216 dpi
    const key = src + '|' + maxPx;
    if (cache.has(key)) return cache.get(key);
    let handle = null;
    const nw = el.naturalWidth || 0, nh = el.naturalHeight || 0;
    if (Math.max(nw, nh) <= maxPx * 1.5) {
      try {
        let bytes = bytesOf ? await bytesOf(el) : null;
        if (!bytes && (/^(blob:|data:image\/jpeg)/.test(src) || /\.jpe?g(\?|#|$)/i.test(src))) bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
        if (bytes && Pdf().jpegInfo(bytes)) handle = doc.addJpeg(bytes);
      } catch (e) { /* über das Canvas */ }
    }
    if (!handle && nw && nh) {
      try {
        const k = Math.min(1, maxPx / Math.max(nw, nh));
        const c = canvasOf(nw * k, nh * k);
        c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
        handle = doc.addImage(imageData(c));
      } catch (e) { handle = null; } // fremdes Bild ohne Freigabe: bleibt leer
    }
    cache.set(key, handle);
    return handle;
  }

  /** SVG-Zeichenkette → Bild im Dokument, längste Seite höchstens maxPx Pixel, auf Weiss. */
  async function svgImage(doc, svg, maxPx) {
    const m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = await loadImage(url);
      const w = img.naturalWidth || (m ? +m[1] : 800), h = img.naturalHeight || (m ? +m[2] : 600);
      const k = Math.min(4, (maxPx || 3000) / Math.max(w, h));
      const c = canvasOf(w * k, h * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const data = imageData(c);
      data.alpha = null;
      return Object.assign(doc.addImage(data), { ratio: w / h });
    } finally { URL.revokeObjectURL(url); }
  }

  async function elementSvgImage(doc, el, item, cache) {
    const clone = el.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(item.w));
    clone.setAttribute('height', String(item.h));
    clone.style.color = item.color;
    const text = new XMLSerializer().serializeToString(clone);
    if (cache.has(text)) return cache.get(text);
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
    let handle = null;
    try {
      const img = await loadImage(url);
      const c = canvasOf(item.w * 3, item.h * 3);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      handle = doc.addImage(imageData(c));
    } catch (e) { handle = null; } finally { URL.revokeObjectURL(url); }
    cache.set(text, handle);
    return handle;
  }

  function glyphImage(doc, item, cache) {
    const key = item.str + '|' + item.css + '|' + item.color.join(',');
    if (cache.has(key)) return cache.get(key);
    const S = GLYPH_SCALE;
    const c = canvasOf(Math.ceil(item.w * S) + 2, Math.ceil(item.h * S) + 2);
    const ctx = c.getContext('2d');
    ctx.font = item.css.replace(/([\d.]+)px/, (m0, v) => `${parseFloat(v) * S}px`);
    ctx.fillStyle = `rgb(${item.color.map(v => Math.round(v * 255)).join(',')})`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(item.str, 1, 1 + item.base * S);
    let handle = null;
    try { handle = doc.addImage(imageData(c)); } catch (e) { handle = null; }
    cache.set(key, handle);
    return handle;
  }

  // ---------- Zeichnen ----------

  function drawCheck(page, x, y, w, h, checked, radio) {
    const s = Math.min(w, h);
    const ox = x + (w - s) / 2, oy = y + (h - s) / 2;
    if (radio) {
      page.circle(ox + s / 2, oy + s / 2, s / 2 - 0.4, { stroke: '#555555', lineWidth: 0.8 });
      if (checked) page.circle(ox + s / 2, oy + s / 2, s / 4, { fill: '#333333' });
      return;
    }
    if (checked) {
      page.rect(ox, oy, s, s, { fill: '#333333', radius: s * 0.18 });
      page.path([['M', ox + s * 0.22, oy + s * 0.52], ['L', ox + s * 0.42, oy + s * 0.72], ['L', ox + s * 0.78, oy + s * 0.3]], { stroke: '#ffffff', lineWidth: s * 0.14 });
    } else page.rect(ox + 0.4, oy + 0.4, s - 0.8, s - 0.8, { stroke: '#555555', lineWidth: 0.8, radius: s * 0.18 });
  }

  /** Setzt html in den versteckten Bereich, bricht um und hängt die Seiten an doc. options: { linkTarget(href, el) → Ziel |
   *  null (Vorgabe: Adressen mit Schema als URI, «#id» intern, relative *.pdf als andere Datei), pageNumbers: Selektor der Links,
   *  hinter die rechts die Seitenzahl ihres Ziels kommt, css: Stylesheet statt pdfCss() (für viele Dateien nacheinander einmal
   *  berechnen), imageBytes(img) → Bytes eines Bilds oder null (Anhänge aus dem Backend), width, height } */
  async function appendHtml(doc, html, options) {
    const opts = options || {};
    const W = opts.width || Pdf().A4.width, H = opts.height || Pdf().A4.height;
    const contentW = (W - 2 * MARGIN) / PX;
    const contentH = (H - 2 * MARGIN) / PX;
    let style = document.getElementById('pdfAreaStyle');
    if (!style) { style = document.createElement('style'); style.id = 'pdfAreaStyle'; document.head.appendChild(style); }
    style.textContent = opts.css || pdfCss();
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;left:-100000px;top:0;width:${contentW}px;pointer-events:none;contain:layout style;`;
    const area = document.createElement('div');
    area.id = 'pdfArea';
    area.innerHTML = html;
    host.appendChild(area);
    document.body.appendChild(host);
    try {
      await waitForImages(area);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      materializePseudo(area);
      const layout = collect(area, contentH);
      const plan = paginate(layout, contentH);
      const first = doc.pages.length;
      const pages = plan.map(() => doc.addPage(W, H));
      const pageAt = y => { let i = plan.findIndex(p => y >= p.from - 0.5 && y < p.to - 0.5); if (i < 0) i = y < 0 ? 0 : plan.length - 1; return i; };
      const posOf = y => { const i = pageAt(y); const p = plan[i]; const off = p.repeat ? p.repeat.to - p.repeat.from : 0; return { page: pages[i], y: Math.max(0, MARGIN + (y - p.from + off) * PX - 6) }; };
      const anchor = id => (layout.anchors.has(id) ? posOf(layout.anchors.get(id)) : null);

      // Bilder vorbereiten (asynchron), danach zeichnen
      const cache = new Map();
      const handles = new Map();
      for (const it of layout.items) {
        if (it.k === 'img') handles.set(it, await imageFor(doc, it.el, it.w * PX, it.h * PX, cache, opts.imageBytes));
        else if (it.k === 'svg') handles.set(it, await elementSvgImage(doc, it.el, it, cache));
        else if (it.k === 'canvas') { try { handles.set(it, doc.addImage(imageData(it.el))); } catch (e) { /* leer */ } }
        else if (it.k === 'glyph') handles.set(it, glyphImage(doc, it, cache));
      }

      const ATOMIC = new Set(['text', 'glyph', 'img', 'svg', 'canvas', 'check', 'bullet']);
      const X = x => MARGIN + x * PX;
      const draw = (page, it, Y) => {
        switch (it.k) {
          case 'fill': page.rect(X(it.x), Y(it.y), it.w * PX, it.h * PX, { fill: it.color, radius: it.radius * PX }); break;
          case 'stroke': page.rect(X(it.x), Y(it.y), it.w * PX, it.h * PX, { stroke: it.color, lineWidth: it.lw * PX, radius: it.radius * PX, dash: it.dash && it.dash.map(v => v * PX) }); break;
          case 'line': page.line(X(it.x1), Y(it.y1), X(it.x2), Y(it.y2), { stroke: it.color, lineWidth: it.lw * PX, dash: it.dash && it.dash.map(v => v * PX) }); break;
          case 'text': page.text(it.str, X(it.x), Y(it.base), { font: it.font, size: it.size, color: it.color, width: it.w * PX }); break;
          case 'check': drawCheck(page, X(it.x), Y(it.y), it.w * PX, it.h * PX, it.checked, it.radio); break;
          case 'bullet':
            if (it.shape === 'square') page.rect(X(it.x), Y(it.y), it.w * PX, it.h * PX, { fill: it.color });
            else page.circle(X(it.x + it.w / 2), Y(it.y + it.h / 2), it.w * PX / 2, it.shape === 'circle' ? { stroke: it.color, lineWidth: 0.6 } : { fill: it.color });
            break;
          default: { const h = handles.get(it); if (h) page.image(h, X(it.x), Y(it.y), it.w * PX, it.h * PX); }
        }
      };
      const drawRange = (page, from, to, Y, within) => {
        for (const it of layout.items) {
          if (within && !within(it)) continue;
          const top = it.y, bottom = it.y + (it.h || 0);
          if (ATOMIC.has(it.k) ? !(top >= from - 0.5 && top < to - 0.5) : !(top < to && bottom > from)) continue;
          draw(page, it, Y);
        }
      };
      plan.forEach((p, i) => {
        const page = pages[i];
        const off = p.repeat ? p.repeat.to - p.repeat.from : 0;
        if (p.repeat) {
          const rp = p.repeat;
          page.clip(0, MARGIN, W, off * PX, () => drawRange(page, rp.from, rp.to, y => MARGIN + (y - rp.from) * PX,
            it => (it.x == null ? Math.min(it.x1, it.x2) : it.x) >= rp.x - 1 && (it.x == null ? Math.max(it.x1, it.x2) : it.x + it.w) <= rp.x + rp.w + 1));
        }
        const Y = y => MARGIN + (y - p.from + off) * PX;
        page.clip(0, MARGIN + off * PX, W, (p.to - p.from) * PX + 0.5, () => drawRange(page, p.from, p.to, Y));
      });

      // Links und Seitenzahlen im Inhaltsverzeichnis
      const numbered = opts.pageNumbers ? new Set(area.querySelectorAll(opts.pageNumbers)) : new Set();
      const defaultTarget = href => {
        if (!href || href === '#') return null;
        if (href.startsWith('#')) return anchor(decodeURIComponent(href.slice(1)));
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return /^(javascript|data|blob|att):/i.test(href) ? null : { uri: href };
        if (/\.pdf(#.*)?$/i.test(href)) return { file: href.replace(/#.*$/, '') };
        return null;
      };
      for (const link of layout.links) {
        const target = opts.linkTarget ? opts.linkTarget(link.href, link.el, defaultTarget) : defaultTarget(link.href);
        if (!target) continue;
        for (const q of link.rects) {
          const i = pageAt(q.y);
          const p = plan[i];
          const off = p.repeat ? p.repeat.to - p.repeat.from : 0;
          pages[i].link(X(q.x), MARGIN + (q.y - p.from + off) * PX, q.w * PX, q.h * PX, target);
        }
        if (numbered.has(link.el) && target.page && link.rects.length) {
          const q = link.rects[link.rects.length - 1];
          const i = pageAt(q.y);
          const p = plan[i];
          const off = p.repeat ? p.repeat.to - p.repeat.from : 0;
          const cs = getComputedStyle(link.el);
          const size = px(cs.fontSize) * PX;
          const str = String(doc.pages.indexOf(target.page) + 1);
          const w = Pdf().measure(str, 'Helvetica', size);
          const base = MARGIN + (q.y - p.from + off) * PX + q.h * PX * baselineRatio(cs);
          pages[i].text(str, W - MARGIN - w, base, { size, color: colorOf(cs.color) || '#000' });
          pages[i].link(W - MARGIN - w - 2, base - size, w + 4, size * 1.3, target);
        }
      }
      return { pages, first, anchor };
    } finally {
      host.remove();
    }
  }

  /** Seite mit einem Bild, eingepasst und mittig (die Mindmap: quer). */
  function imagePage(doc, image, options) {
    const opts = options || {};
    const A4 = Pdf().A4;
    const W = opts.landscape ? A4.height : A4.width, H = opts.landscape ? A4.width : A4.height;
    const page = doc.addPage(W, H);
    if (!image) return page;
    const maxW = W - 2 * MARGIN, maxH = H - 2 * MARGIN;
    const ratio = image.ratio || image.width / image.height;
    let w = maxW, h = maxW / ratio;
    if (h > maxH) { h = maxH; w = maxH * ratio; }
    page.image(image, (W - w) / 2, MARGIN + (maxH - h) / 2, w, h);
    return page;
  }

  /** Fusszeile auf allen Seiten: Titel links (gekürzt), Seite und Zahl der Seiten rechts. */
  function footer(doc, title) {
    const total = doc.pages.length;
    const size = 8;
    let label = [...String(title || '')].filter(ch => Pdf().encodable(ch)).join('').trim();
    doc.pages.forEach((page, i) => {
      const right = `${i + 1} / ${total}`;
      const rw = Pdf().measure(right, 'Helvetica', size);
      const maxW = page.width - 2 * MARGIN - rw - 24;
      let text = label;
      while (text && Pdf().measure(text, 'Helvetica', size) > maxW) text = text.slice(0, -2).trimEnd() + '…';
      const base = page.height - MARGIN / 2 + 3;
      if (text) page.text(text, MARGIN, base, { size, color: '#777777' });
      page.text(right, page.width - MARGIN - rw, base, { size, color: '#777777' });
    });
  }

  global.NoNotesPdfLayout = { appendHtml, imagePage, footer, svgImage, pdfCss, MARGIN };
})(window);
