/* Gemeinsames für die Testläufe: Playwright laden, Schritte melden, Abschnitte nacheinander ausführen.
   Ein Lauf druckt je Abschnitt eine Zeile; die Teilschritte darin bleiben still (NONOTES_TEST_VERBOSE=1 zeigt sie) und
   werden beim Fehlschlag genannt, damit die Stelle schnell zu finden ist. */
'use strict';

function loadPlaywright() {
  try { return require('playwright'); }
  catch (e) {
    if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
    throw e;
  }
}

/** Startoptionen für Chromium: NONOTES_CHROMIUM nennt ein vorhandenes Programm (Chromium, Chrome oder chrome-headless-shell),
 *  sonst nimmt Playwright sein eigenes (npx playwright install chromium). */
function launchOptions(options) {
  const exe = process.env.NONOTES_CHROMIUM;
  return Object.assign({}, exe ? { executablePath: exe } : {}, options);
}

const state = { part: null };
const step = name => console.log('  ✓ ' + name);
const part = name => { state.part = name; if (process.env.NONOTES_TEST_VERBOSE) console.log('      · ' + name); };

/** Seit v3.0.0 gleiten Knoten der Mindmap kurz an ihren neuen Platz. Die Tests messen Positionen gleich nach dem Zeichnen; darum
 *  laufen alle Seiten mit «Bewegung reduzieren» (ohne Gleiten), ausser ein Test verlangt ausdrücklich etwas anderes. */
function calm(browser) {
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = options => newContext(Object.assign({ reducedMotion: 'reduce' }, options));
  browser.newPage = options => newPage(Object.assign({ reducedMotion: 'reduce' }, options));
  return browser;
}

/** Führt die Abschnitte eines Laufs aus: { name, run(browser, part, step) }. Mit browser: true teilt sich der Lauf ein Chromium. */
async function suite(title, sections, options) {
  let browser = null;
  const started = Date.now();
  try {
    if (options && options.browser) browser = calm(await loadPlaywright().chromium.launch(launchOptions()));
    const only = process.env.NONOTES_TEST_ONLY; // nur Abschnitte, deren Name das Wort enthält (Entwicklung)
    for (const s of sections) {
      if (only && !(s.name || '').includes(only)) continue;
      state.part = null;
      await s.run(browser, part, step);
      if (s.name) step(s.name);
    }
    console.log(`\n${title} bestanden (${Math.round((Date.now() - started) / 1000)} s).`);
  } catch (e) {
    console.error(`\n${title} FEHLGESCHLAGEN${state.part ? ` – nach Teilschritt: ${state.part}` : ''}`);
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
  if (process.exitCode) process.exit(process.exitCode);
}

/** Liest eine PDF-Datei, wie sie packages/core/pdf.js schreibt, und prüft dabei den Aufbau: Kopf, Verzeichnis der Byte-Stellen
 *  (jede Stelle zeigt auf ihr Objekt), Ende. Liefert { pages: [{ width, height, text, words, content, annots, images }], outline:
 *  [{ title, depth, page }], info, objects }. text: alle Wörter der Seite mit Leerzeichen, aus den Tj-Anweisungen (WinAnsi). */
function readPdf(buf) {
  const assert = require('node:assert/strict');
  const zlib = require('node:zlib');
  const s = Buffer.from(buf).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.'), 'PDF: Kopf');
  const sx = /startxref\n(\d+)\n%%EOF\n?$/.exec(s);
  assert.ok(sx, 'PDF: startxref und %%EOF am Ende');
  const xref = Number(sx[1]);
  assert.ok(s.startsWith('xref\n', xref), 'PDF: startxref zeigt auf das Verzeichnis');
  const head = /^xref\n0 (\d+)\n/.exec(s.slice(xref));
  const count = Number(head[1]);
  const objects = new Map();
  for (let i = 1; i < count; i++) {
    const entry = s.substr(xref + head[0].length + i * 20, 20);
    const off = Number(entry.slice(0, 10));
    const start = `${i} 0 obj\n`;
    assert.ok(s.startsWith(start, off), `PDF: Objekt ${i} steht an Stelle ${off}`);
    const bodyAt = off + start.length;
    const si = s.indexOf('\nstream\n', bodyAt);
    const ei = s.indexOf('\nendobj', bodyAt);
    if (si >= 0 && si < ei) {
      const dict = s.slice(bodyAt, si);
      const len = Number(/\/Length (\d+)/.exec(dict)[1]);
      let data = Buffer.from(buf).subarray(si + 8, si + 8 + len);
      assert.equal(s.slice(si + 8 + len, si + 8 + len + 10), '\nendstream', `PDF: Länge des Streams ${i}`);
      if (/\/FlateDecode/.test(dict) && !/\/Subtype \/Image/.test(dict)) data = zlib.inflateSync(data);
      objects.set(i, { dict, stream: data });
    } else objects.set(i, { dict: s.slice(bodyAt, ei), stream: null });
  }
  const trailer = /trailer\n<<([\s\S]*?)>>\nstartxref/.exec(s)[1];
  const ref = (dict, key) => { const m = new RegExp('/' + key + ' (\\d+) 0 R').exec(dict); return m ? Number(m[1]) : null; };
  const catalog = objects.get(ref(trailer, 'Root')).dict;
  const kids = [...objects.get(ref(catalog, 'Pages')).dict.match(/\/Kids \[([^\]]*)\]/)[1].matchAll(/(\d+) 0 R/g)].map(m => Number(m[1]));
  const CP = { 0x80: '€', 0x84: '„', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—' };
  const unescape = str => str.replace(/\\([0-7]{3}|.)/g, (m, c) => (c.length === 3 ? String.fromCharCode(parseInt(c, 8)) : c))
    .replace(/[\x80-\x9f]/g, ch => CP[ch.charCodeAt(0)] || ch);
  const pages = kids.map(id => {
    const d = objects.get(id).dict;
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(d);
    const content = objects.get(ref(d, 'Contents')).stream.toString('latin1');
    const words = [...content.matchAll(/\(((?:[^\\)]|\\.)*)\) Tj/g)].map(m => unescape(m[1]));
    const annots = [...((/\/Annots \[([^\]]*)\]/.exec(d) || [])[1] || '').matchAll(/(\d+) 0 R/g)].map(m => objects.get(Number(m[1])).dict);
    return { id, width: Number(box[1]), height: Number(box[2]), content, words, text: words.join(' '), annots, images: (content.match(/ Do /g) || []).length };
  });
  const text16 = hex => { const b = Buffer.from(hex.slice(4), 'hex'); let out = ''; for (let i = 0; i + 1 < b.length; i += 2) out += String.fromCharCode(b.readUInt16BE(i)); return out; };
  const outline = [];
  const walk = (id, depth) => {
    for (let k = id; k; k = ref(objects.get(k).dict, 'Next')) {
      const d = objects.get(k).dict;
      const dest = /\/Dest \[(\d+) 0 R/.exec(d);
      outline.push({ title: text16(/\/Title <([0-9A-F]+)>/.exec(d)[1]), depth, page: dest ? kids.indexOf(Number(dest[1])) : -1 });
      const first = ref(d, 'First');
      if (first) walk(first, depth + 1);
    }
  };
  const root = ref(catalog, 'Outlines');
  if (root) walk(ref(objects.get(root).dict, 'First'), 0);
  const infoDict = objects.get(ref(trailer, 'Info')).dict;
  const titleHex = /\/Title <([0-9A-F]+)>/.exec(infoDict);
  return { pages, outline, info: { title: titleHex ? text16(titleHex[1]) : null, dict: infoDict }, catalog, objects };
}

/** Liest ein ZIP (Methode Store, wie packages/core/zip.js es schreibt) und liefert { pfad: Buffer }. */
function readZip(buf) {
  const b = Buffer.from(buf);
  let eocd = b.length - 22;
  while (eocd >= 0 && b.readUInt32LE(eocd) !== 0x06054B50) eocd--;
  if (eocd < 0) throw new Error('ZIP ohne Endsignatur');
  const count = b.readUInt16LE(eocd + 10);
  let cd = b.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const nameLen = b.readUInt16LE(cd + 28), extraLen = b.readUInt16LE(cd + 30), commentLen = b.readUInt16LE(cd + 32);
    const size = b.readUInt32LE(cd + 24), localOff = b.readUInt32LE(cd + 42);
    const name = b.subarray(cd + 46, cd + 46 + nameLen).toString('utf8');
    const dataStart = localOff + 30 + b.readUInt16LE(localOff + 26) + b.readUInt16LE(localOff + 28);
    files[name] = b.subarray(dataStart, dataStart + size);
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

module.exports = { loadPlaywright, launchOptions, suite, step, part, readPdf, readZip };
