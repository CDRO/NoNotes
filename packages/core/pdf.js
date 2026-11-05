/* NoNotes – kleiner PDF-Schreiber (seit 4.1.0, ohne fremden Code). Läuft im Browser und in Node. i18n-ignore-file (keine Texte für
   Menschen: Schriftnamen, PDF-Schlüssel)

   Ein Dokument hat Seiten beliebiger Grösse; gezeichnet wird in Punkt (1/72 Zoll), Ursprung oben links:
     const doc = NoNotesPdf.create({ title, author, lang, producer });
     const p = doc.addPage(595.28, 841.89);               A4 hoch (NoNotesPdf.A4)
     p.rect(x, y, w, h, { fill, stroke, lineWidth, radius, dash });
     p.line(x1, y1, x2, y2, { stroke, lineWidth, dash });
     p.path([['M', x, y], ['L', x, y], ['C', x1, y1, x2, y2, x, y], ['Z']], { fill, stroke, lineWidth });
     p.circle(cx, cy, r, { fill, stroke, lineWidth });
     p.text(text, x, baseline, { font, size, color, width });   width: Breite, auf die der Text gestaucht oder gedehnt wird
     p.image(img, x, y, w, h);                            img aus doc.addImage / doc.addJpeg
     p.link(x, y, w, h, { uri } | { page, y } | { file });   page: Seite (Objekt oder Nummer ab 0), file: andere PDF-Datei
     p.clip(x, y, w, h, () => { … });
     doc.addImage({ width, height, rgb, alpha })            8 Bit je Kanal, rgb: width·height·3 Bytes, alpha wahlweise (·1)
     doc.addJpeg(bytes)                                     JPEG unverändert (Graustufen oder RGB; sonst null)
     doc.setOutline([{ title, page, y, children }])         Lesezeichen
     await doc.toBytes()                                    Uint8Array

   Schriften sind die Standardschriften jedes PDF-Programms (Helvetica und Courier, je normal, fett, kursiv, fett kursiv), nicht
   eingebettet, Zeichensatz WinAnsi (westeuropäisch). Andere Zeichen schreibt text() als «?»; wer mehr braucht, prüft vorher mit
   encodable() und zeichnet sie anders (der Satz im Browser legt sie als Bild hinein). Farben: '#rrggbb' oder [r, g, b] (0…1).
   Inhalte und Bilder werden mit Deflate komprimiert (CompressionStream; options.deflate ersetzt das, null schaltet es ab). */
(function (global) {
  'use strict';

  const A4 = Object.freeze({ width: 595.28, height: 841.89 });
  const MM = 72 / 25.4;

  const FONTS = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'];

  // Breiten in Tausendsteln der Schriftgrösse (AFM von Helvetica und Helvetica-Bold), Zeichen 32 bis 126 …
  const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
    278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667,
    944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
    278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
    333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667,
    944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556,
    333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  // … und 128 bis 255 (WinAnsi; 0 = nicht belegt)
  const X_REG = [556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500];
  const X_BOLD = [556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667,
    278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556];

  // WinAnsi (Windows-1252): Zeichen, die nicht in Latin-1 an derselben Stelle stehen
  const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
    '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

  /** Byte in WinAnsi oder -1. Ein geschütztes Leerzeichen und weiche Trennung zählen mit. */
  function winAnsi(ch) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c <= 126) return c;
    if (c >= 0xa0 && c <= 0xff) return c;
    if (CP1252[ch] != null) return CP1252[ch];
    return -1;
  }

  /** Lässt sich der Text mit den Standardschriften schreiben? (nach NFC, ohne Steuerzeichen ausser Leerraum) */
  function encodable(text) {
    for (const ch of String(text).normalize('NFC')) {
      if (ch === '\n' || ch === '\t') continue;
      if (winAnsi(ch) < 0) return false;
    }
    return true;
  }

  const isMono = font => font.startsWith('Courier');
  const isBold = font => /Bold/.test(font);

  /** Breite des Texts in Punkt. */
  function measure(text, font, size) {
    const f = FONTS.includes(font) ? font : 'Helvetica';
    let units = 0;
    for (const ch of String(text).normalize('NFC')) {
      if (isMono(f)) { units += 600; continue; }
      const b = winAnsi(ch);
      const low = isBold(f) ? W_BOLD : W_REG;
      const high = isBold(f) ? X_BOLD : X_REG;
      if (b >= 32 && b <= 126) units += low[b - 32];
      else if (b >= 128) units += high[b - 128] || 556;
      else units += 556;
    }
    return units / 1000 * size;
  }

  const num = v => {
    const r = Math.round(v * 1000) / 1000;
    return Object.is(r, -0) ? '0' : String(r);
  };

  function parseColor(c) {
    if (Array.isArray(c)) return c.slice(0, 3).map(v => Math.max(0, Math.min(1, Number(v) || 0)));
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
    const s = /^#?([0-9a-f]{3})$/i.exec(String(c || '').trim());
    if (s) return s[1].split('').map(h => parseInt(h + h, 16) / 255);
    return [0, 0, 0];
  }
  const rgbOp = (c, op) => parseColor(c).map(num).join(' ') + ' ' + op;

  /** Text als PDF-Zeichenkette in WinAnsi; nicht darstellbare Zeichen werden zu «?». */
  function pdfString(text) {
    let out = '(';
    for (const ch of String(text).normalize('NFC')) {
      let b = winAnsi(ch);
      if (b < 0) b = ch === '\t' ? 32 : 63;
      if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
      else if (b >= 32 && b <= 126) out += String.fromCharCode(b);
      else out += '\\' + b.toString(8).padStart(3, '0');
    }
    return out + ')';
  }

  /** Text für Lesezeichen und Angaben zum Dokument: UTF-16BE mit Kennung, als Hex. */
  function textString(text) {
    let hex = '<FEFF';
    const s = String(text == null ? '' : text);
    for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    return hex + '>';
  }

  /** Dateiname oder Adresse als PDF-Zeichenkette (nur ASCII; andere Zeichen als %-Folge wie in einer Adresse). */
  function asciiString(text) {
    let out = '(';
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      if (c < 32 || c > 126) { out += Array.from(new TextEncoder().encode(ch), b => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join(''); continue; }
      out += c === 40 || c === 41 || c === 92 ? '\\' + ch : ch;
    }
    return out + ')';
  }

  const ascii = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };

  async function defaultDeflate(bytes) {
    if (typeof CompressionStream !== 'function' || typeof Blob !== 'function' || typeof Response !== 'function') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** PNG-Vorhersage «Paeth» je Zeile (macht Bilder für Deflate kleiner): jede Zeile beginnt mit dem Filter-Byte 4. */
  function paeth(data, width, height, channels) {
    const row = width * channels;
    const out = new Uint8Array((row + 1) * height);
    for (let y = 0; y < height; y++) {
      const o = y * (row + 1);
      out[o] = 4;
      const cur = y * row;
      const up = cur - row;
      for (let x = 0; x < row; x++) {
        const a = x >= channels ? data[cur + x - channels] : 0;
        const b = y > 0 ? data[up + x] : 0;
        const c = x >= channels && y > 0 ? data[up + x - channels] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        out[o + 1 + x] = (data[cur + x] - pred) & 0xff;
      }
    }
    return out;
  }

  /** Breite, Höhe und Farbkanäle aus dem SOF-Abschnitt eines JPEG; null, wenn es keines ist. */
  function jpegInfo(bytes) {
    if (!(bytes && bytes[0] === 0xff && bytes[1] === 0xd8)) return null;
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
      }
      i += 2 + len;
    }
    return null;
  }

  const KAPPA = 0.5522847498;

  function create(options) {
    const opts = options || {};
    const deflate = opts.deflate === null ? null : (opts.deflate || defaultDeflate);
    const pages = [];
    const images = [];
    let outline = [];
    const usedFonts = new Set();

    function addPage(width, height) {
      const ops = [];
      const annots = [];
      const page = { width, height, ops, annots, index: pages.length, fonts: new Set(), images: new Set() };
      const Y = y => height - y;
      const pathOps = (segs) => segs.map(s => {
        if (s[0] === 'M') return `${num(s[1])} ${num(Y(s[2]))} m`;
        if (s[0] === 'L') return `${num(s[1])} ${num(Y(s[2]))} l`;
        if (s[0] === 'C') return `${num(s[1])} ${num(Y(s[2]))} ${num(s[3])} ${num(Y(s[4]))} ${num(s[5])} ${num(Y(s[6]))} c`;
        return 'h';
      }).join(' ');
      const roundRect = (x, y, w, h, r) => {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        if (!r) return `${num(x)} ${num(Y(y + h))} ${num(w)} ${num(h)} re`;
        const k = r * KAPPA;
        return pathOps([['M', x + r, y], ['L', x + w - r, y], ['C', x + w - r + k, y, x + w, y + r - k, x + w, y + r], ['L', x + w, y + h - r],
          ['C', x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h], ['L', x + r, y + h], ['C', x + r - k, y + h, x, y + h - r + k, x, y + h - r],
          ['L', x, y + r], ['C', x, y + r - k, x + r - k, y, x + r, y], ['Z']]);
      };
      const paint = (o, shape) => {
        const fill = o.fill != null && o.fill !== 'none';
        const stroke = o.stroke != null && o.stroke !== 'none';
        if (!fill && !stroke) return;
        const parts = ['q'];
        if (fill) parts.push(rgbOp(o.fill, 'rg'));
        if (stroke) {
          parts.push(rgbOp(o.stroke, 'RG'), `${num(o.lineWidth == null ? 1 : o.lineWidth)} w`);
          if (o.dash && o.dash.length) parts.push(`[${o.dash.map(num).join(' ')}] 0 d`);
          if (o.cap != null) parts.push(`${o.cap} J`);
        }
        parts.push(shape, fill && stroke ? 'B' : fill ? 'f' : 'S', 'Q');
        ops.push(parts.join(' '));
      };
      Object.assign(page, {
        rect(x, y, w, h, o) { if (w > 0 && h > 0) paint(o || {}, roundRect(x, y, w, h, (o && o.radius) || 0)); },
        line(x1, y1, x2, y2, o) { paint(Object.assign({ stroke: '#000' }, o, { fill: null }), `${num(x1)} ${num(Y(y1))} m ${num(x2)} ${num(Y(y2))} l`); },
        path(segs, o) { paint(o || {}, pathOps(segs)); },
        circle(cx, cy, r, o) { paint(o || {}, roundRect(cx - r, cy - r, 2 * r, 2 * r, r)); },
        text(text, x, baseline, o) {
          o = o || {};
          const font = FONTS.includes(o.font) ? o.font : 'Helvetica';
          const size = o.size || 10;
          const str = String(text);
          if (!str) return;
          usedFonts.add(font);
          page.fonts.add(font);
          let scale = 100;
          if (o.width > 0) {
            const natural = measure(str, font, size);
            if (natural > 0) scale = Math.max(50, Math.min(200, o.width / natural * 100));
            if (Math.abs(scale - 100) < 0.5) scale = 100;
          }
          ops.push(`BT /F${FONTS.indexOf(font) + 1} ${num(size)} Tf ${rgbOp(o.color || '#000', 'rg')} ${num(scale)} Tz 1 0 0 1 ${num(x)} ${num(Y(baseline))} Tm ${pdfString(str)} Tj ET`);
        },
        image(img, x, y, w, h) {
          if (!img || !(w > 0) || !(h > 0)) return;
          page.images.add(img);
          ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(Y(y + h))} cm /Im${img.n} Do Q`);
        },
        link(x, y, w, h, target) {
          if (!target || !(w > 0) || !(h > 0)) return;
          annots.push({ rect: [x, Y(y + h), x + w, Y(y)], target });
        },
        clip(x, y, w, h, fn) {
          ops.push(`q ${num(x)} ${num(Y(y + h))} ${num(w)} ${num(h)} re W n`);
          try { fn(); } finally { ops.push('Q'); }
        },
      });
      pages.push(page);
      return page;
    }

    function addImage(img) {
      const width = Math.max(1, img.width | 0), height = Math.max(1, img.height | 0);
      const rgb = img.rgb;
      if (!rgb || rgb.length < width * height * 3) throw new Error('addImage: rgb fehlt');
      const alpha = img.alpha && img.alpha.some(v => v !== 255) ? img.alpha : null;
      const handle = { kind: 'raw', width, height, rgb, alpha, n: images.length + 1 };
      images.push(handle);
      return handle;
    }

    function addJpeg(bytes) {
      const info = jpegInfo(bytes);
      if (!info || (info.components !== 1 && info.components !== 3)) return null;
      const handle = { kind: 'jpeg', width: info.width, height: info.height, gray: info.components === 1, bytes, n: images.length + 1 };
      images.push(handle);
      return handle;
    }

    function setOutline(items) { outline = Array.isArray(items) ? items : []; }

    async function toBytes() {
      if (!pages.length) addPage(A4.width, A4.height);
      const objs = []; // [id] = string | { dict, data }
      const alloc = () => { objs.push(null); return objs.length; };
      const catalogId = alloc();
      const pagesId = alloc();
      const infoId = alloc();
      const fontIds = new Map();
      for (const f of FONTS) if (usedFonts.has(f)) fontIds.set(f, alloc());
      const pageIds = pages.map(() => alloc());
      const contentIds = pages.map(() => alloc());
      const imageIds = new Map();
      const smaskIds = new Map();
      for (const img of images) {
        imageIds.set(img, alloc());
        if (img.alpha) smaskIds.set(img, alloc());
      }
      const pageRef = p => {
        const page = typeof p === 'number' ? pages[p] : p;
        return page && pages.includes(page) ? page : null;
      };
      const set = (id, v) => { objs[id - 1] = v; };
      /** Stream-Objekt: inner sind die Einträge des Wörterbuchs ohne << >>; compress: mit Deflate, wenn möglich. */
      const stream = async (inner, bytes, compress) => {
        if (compress && deflate) {
          const z = await deflate(bytes);
          if (z) return { dict: `<< ${inner} /Filter /FlateDecode /Length ${z.length} >>`, data: z };
        }
        return { dict: `<< ${inner} /Length ${bytes.length} >>`, data: bytes };
      };
      /** Bild mit 8 Bit je Kanal: mit Deflate und PNG-Vorhersage, sonst roh. */
      const imageStream = async (inner, data, w, h, channels) => {
        if (deflate) {
          const z = await deflate(paeth(data, w, h, channels));
          if (z) return { dict: `<< ${inner} /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${channels} /BitsPerComponent 8 /Columns ${w} >> /Length ${z.length} >>`, data: z };
        }
        const raw = data.subarray(0, w * h * channels);
        return { dict: `<< ${inner} /Length ${raw.length} >>`, data: raw };
      };

      for (const [f, id] of fontIds) set(id, `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`);
      for (const img of images) {
        const id = imageIds.get(img);
        const head = `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /BitsPerComponent 8`;
        if (img.kind === 'jpeg') {
          set(id, await stream(`${head} /ColorSpace /${img.gray ? 'DeviceGray' : 'DeviceRGB'} /Filter /DCTDecode`, img.bytes, false));
          continue;
        }
        set(id, await imageStream(`${head} /ColorSpace /DeviceRGB${img.alpha ? ` /SMask ${smaskIds.get(img)} 0 R` : ''}`, img.rgb, img.width, img.height, 3));
        if (img.alpha) set(smaskIds.get(img), await imageStream(`${head} /ColorSpace /DeviceGray`, img.alpha, img.width, img.height, 1));
      }

      const destOf = (p, y) => {
        const page = pageRef(p);
        if (!page) return null;
        const top = page.height - Math.max(0, Number(y) || 0);
        return `[${pageIds[page.index]} 0 R /XYZ 0 ${num(top)} null]`;
      };
      for (const page of pages) {
        const i = page.index;
        const res = [];
        if (page.fonts.size) res.push('/Font << ' + [...page.fonts].map(f => `/F${FONTS.indexOf(f) + 1} ${fontIds.get(f)} 0 R`).join(' ') + ' >>');
        if (page.images.size) res.push('/XObject << ' + [...page.images].map(img => `/Im${img.n} ${imageIds.get(img)} 0 R`).join(' ') + ' >>');
        const annotIds = [];
        for (const a of page.annots) {
          let action = null;
          const t = a.target;
          if (t.uri) action = `/A << /S /URI /URI ${asciiString(t.uri)} >>`;
          else if (t.file) action = `/A << /S /GoToR /F ${asciiString(t.file)} /D [0 /Fit] /NewWindow false >>`;
          else if (t.page != null) { const d = destOf(t.page, t.y); if (d) action = `/Dest ${d}`; }
          if (!action) continue;
          const id = alloc();
          set(id, `<< /Type /Annot /Subtype /Link /Rect [${a.rect.map(num).join(' ')}] /Border [0 0 0] ${action} >>`);
          annotIds.push(id);
        }
        set(pageIds[i], `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << ${res.join(' ')} >> /Contents ${contentIds[i]} 0 R` +
          (annotIds.length ? ` /Annots [${annotIds.map(id => `${id} 0 R`).join(' ')}]` : '') + ' >>');
        set(contentIds[i], await stream('', ascii(page.ops.join('\n')), true));
      }
      set(pagesId, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);

      // Lesezeichen: Baum mit /First, /Last, /Next, /Prev, /Count
      let outlineId = null;
      const valid = list => (list || []).filter(it => it && pageRef(it.page));
      const writeItems = (list, parentId) => {
        const items = valid(list);
        const ids = items.map(() => alloc());
        let total = 0;
        items.forEach((it, k) => {
          const kids = writeItems(it.children, ids[k]);
          total += 1 + kids.count;
          set(ids[k], `<< /Title ${textString(it.title)} /Parent ${parentId} 0 R` + (k > 0 ? ` /Prev ${ids[k - 1]} 0 R` : '') + (k < ids.length - 1 ? ` /Next ${ids[k + 1]} 0 R` : '') +
            (kids.first ? ` /First ${kids.first} 0 R /Last ${kids.last} 0 R /Count ${kids.top}` : '') + ` /Dest ${destOf(it.page, it.y)} >>`);
        });
        return { first: ids[0] || null, last: ids[ids.length - 1] || null, count: total, top: ids.length };
      };
      if (valid(outline).length) {
        outlineId = alloc();
        const top = writeItems(outline, outlineId);
        set(outlineId, `<< /Type /Outlines /First ${top.first} 0 R /Last ${top.last} 0 R /Count ${top.top} >>`);
      }

      const lang = opts.lang ? ` /Lang ${asciiString(opts.lang)}` : '';
      set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R${outlineId ? ` /Outlines ${outlineId} 0 R /PageMode /UseOutlines` : ''}${lang} /ViewerPreferences << /DisplayDocTitle true >> >>`);
      const d = opts.date instanceof Date ? opts.date : new Date();
      const p2 = v => String(v).padStart(2, '0');
      const stamp = `D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
      set(infoId, '<< ' + [opts.title ? `/Title ${textString(opts.title)}` : '', opts.author ? `/Author ${textString(opts.author)}` : '',
        opts.subject ? `/Subject ${textString(opts.subject)}` : '', `/Producer ${textString(opts.producer || 'NoNotes')}`, `/CreationDate (${stamp})`].filter(Boolean).join(' ') + ' >>');

      // Zusammensetzen mit Verzeichnis der Byte-Stellen
      const chunks = [];
      let offset = 0;
      const push = b => { chunks.push(b); offset += b.length; };
      push(ascii('%PDF-1.7\n'));
      push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
      const offsets = [];
      objs.forEach((o, k) => {
        offsets[k] = offset;
        if (typeof o === 'string') { push(ascii(`${k + 1} 0 obj\n${o}\nendobj\n`)); return; }
        push(ascii(`${k + 1} 0 obj\n${o.dict}\nstream\n`));
        push(o.data);
        push(ascii('\nendstream\nendobj\n'));
      });
      const xref = offset;
      let table = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
      for (const off of offsets) table += String(off).padStart(10, '0') + ' 00000 n \n';
      push(ascii(table + `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
      const out = new Uint8Array(offset);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      return out;
    }

    return { addPage, addImage, addJpeg, setOutline, toBytes, pages };
  }

  global.NoNotesPdf = { create, measure, encodable, jpegInfo, A4, MM, FONTS };
})(window);
