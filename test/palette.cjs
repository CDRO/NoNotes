/* Test der Hauptfarbe (v1.1.0): Palette, Auswahl im Menü, Speichern in der Datenbankdatei und im Browser,
   helle und dunkle Fassung, Mindmap-Bild in Export und Druck.
   Ausführen: npm test (nach tools/build.cjs). */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const APP_URL = 'file://' + path.join(ROOT, 'dist', 'NoNotes', 'index.html');

function loadPlaywright() {
  try { return require('playwright'); }
  catch (e) {
    if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
    throw e;
  }
}
const { chromium } = loadPlaywright();
const initSqlJs = require(path.join(ROOT, 'vendor/sql.js/sql-asm.js'));

const READY = 'body[data-ready="true"]';
const SAVED = () => document.querySelector('#status').dataset.state === 'saved';
const step = name => console.log('  ✓ ' + name);

const lum = h => { const n = parseInt(h.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = h => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

async function openApp(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(APP_URL);
  await page.waitForSelector(READY, { timeout: 30000 });
  return { page, errors };
}

const cssVar = (page, name) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

async function newRootNote(page, title) {
  await page.click('#mindmap', { position: { x: 30, y: 700 } });
  await page.keyboard.press('Tab');
  await page.waitForSelector('#renameInput:not([hidden])');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.waitForFunction(t => [...document.querySelectorAll('.mm-node text')].some(x => x.textContent === t), title);
}

const initScript = () => {
  window.__exported = {};
  window.__printed = [];
  window.print = () => { window.__printed.push(document.getElementById('printArea').innerHTML); };
  const concat = chunks => { const n = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };
  const makeDir = prefix => ({ kind: 'directory', name: 'Export', getDirectoryHandle: async n => makeDir(prefix + n + '/'), getFileHandle: async n => ({ kind: 'file', name: n, createWritable: async () => { const chunks = []; return { write: async d => { chunks.push(typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d)); }, close: async () => { window.__exported[prefix + n] = Array.from(concat(chunks)); }, abort: async () => {} }; } }) });
  window.showDirectoryPicker = async () => makeDir('');
};

async function main() {
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-palette-'));
  const SQL = await initSqlJs();
  try {
    // ---------- Palette als Daten ----------
    const ctx0 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-CH' });
    const { page: p0, errors: errors0 } = await openApp(ctx0);
    const colors = await p0.evaluate(() => NoNotesPalette.COLORS);
    assert.deepEqual(colors.map(c => c.id), ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'violet', 'gray'], 'acht Farben in dieser Reihenfolge');
    for (const c of colors) {
      assert.deepEqual(Object.keys(c.light).sort(), ['accent', 'contrast', 'ink', 'tint']);
      assert.deepEqual(Object.keys(c.dark).sort(), ['accent', 'contrast', 'ink', 'tint']);
      assert.ok(contrast(c.light.accent, c.light.contrast) >= 4.5, `${c.id} hell: Schrift auf der Fläche lesbar`);
      assert.ok(contrast(c.dark.accent, c.dark.contrast) >= 4.5, `${c.id} dunkel: Schrift auf der Fläche lesbar`);
      assert.ok(contrast(c.light.ink, '#ffffff') >= 4.5, `${c.id} hell: Farbe als Schrift lesbar`);
      assert.ok(contrast(c.dark.ink, '#171a20') >= 4.5, `${c.id} dunkel: Farbe als Schrift lesbar`);
    }
    // Blau entspricht dem Stylesheet (wie vor der Palette)
    assert.equal(await cssVar(p0, '--accent'), colors[0].light.accent);
    assert.equal(await cssVar(p0, '--accent-contrast'), colors[0].light.contrast);
    assert.equal(await cssVar(p0, '--accent-ink'), colors[0].light.ink);
    assert.equal(await cssVar(p0, '--active'), colors[0].light.tint);
    assert.equal(await p0.evaluate(() => NoNotesPalette.css('blue') + '|' + NoNotesPalette.normalize('unbekannt')), '|blue', 'Blau braucht kein Zusatz-Stylesheet, Unbekanntes wird Blau');
    assert.equal(await p0.evaluate(() => NoNotesPalette.ids.map(i => NoNotesPalette.name(i)).join(',')), 'Blau,Türkis,Grün,Gelb,Orange,Rot,Violett,Grau');
    assert.deepEqual(errors0, []);
    await ctx0.close();
    step('Palette: acht Farben, Schrift lesbar in hell und dunkel, Blau wie im Stylesheet');

    // ---------- Auswahl im Menü, Speichern, Neuladen ----------
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, locale: 'de-CH' });
    await ctx.addInitScript(initScript);
    const { page, errors } = await openApp(ctx);
    await newRootNote(page, 'Alpha');
    await page.click('#menuBtn');
    assert.equal(await page.locator('#accentSwatches .swatch').count(), 8);
    assert.deepEqual(await page.locator('#accentSwatches .swatch').evaluateAll(b => b.map(x => x.getAttribute('aria-label'))), ['Blau', 'Türkis', 'Grün', 'Gelb', 'Orange', 'Rot', 'Violett', 'Grau']);
    assert.equal(await page.locator('#accentSwatches .swatch[aria-pressed="true"]').getAttribute('data-accent'), 'blue', 'Blau ist vorgewählt');
    await page.click('#accentSwatches .swatch[data-accent="green"]');
    await page.waitForFunction(() => /Hauptfarbe: Grün/.test(document.querySelector('#status').textContent));
    assert.equal(await cssVar(page, '--accent'), '#15803d');
    assert.equal(await cssVar(page, '--active'), '#dcf2e2');
    // das Stylesheet blendet Farben kurz über (transition): auf den Endwert warten
    await page.waitForFunction(c => getComputedStyle(document.querySelector('.mm-root rect')).fill === c && getComputedStyle(document.querySelector('.logo')).backgroundColor === c, rgb('#15803d'));
    assert.equal(await page.locator('#accentSwatches .swatch[aria-pressed="true"]').getAttribute('data-accent'), 'green');
    assert.equal(await page.locator('#menu').isVisible(), true, 'Menü bleibt offen, die Farbe wirkt sofort');
    await page.waitForFunction(SAVED);
    assert.equal(await page.evaluate(() => localStorage.getItem('nonotes.accent')), 'green', 'Zwischenspeicher im Browser');
    step('Hauptfarbe: Auswahl im Menü wirkt sofort und wird gemerkt');

    // Massgebend ist die Datenbank: Zwischenspeicher weg, Farbe bleibt
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.removeItem('nonotes.accent'));
    await page.reload();
    await page.waitForSelector(READY);
    assert.equal(await cssVar(page, '--accent'), '#15803d', 'Farbe kommt aus der Datenbank');
    assert.equal(await page.evaluate(() => localStorage.getItem('nonotes.accent')), 'green', 'Zwischenspeicher wird nachgeführt');
    step('Hauptfarbe: nach dem Neuladen aus der Datenbank, Zwischenspeicher nachgeführt');

    // Datei: meta accent
    await page.click('#menuBtn');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')]);
    const dlPath = path.join(tmp, 'gruen.sqlite');
    await dl.saveAs(dlPath);
    const db = new SQL.Database(new Uint8Array(fs.readFileSync(dlPath)));
    assert.equal(db.exec("SELECT value FROM meta WHERE key='accent'")[0].values[0][0], 'green');
    db.close();
    step('Hauptfarbe: in der Datenbankdatei gespeichert (meta accent)');

    // Mindmap-Bild in Export und Druck
    await page.click('#menuBtn');
    await page.click('#exportBtn');
    await page.waitForSelector('#exportDialog[open]');
    await page.click('#exportDirBtn');
    await page.waitForFunction(() => /Export gespeichert/.test(document.querySelector('#status').textContent) && Object.keys(window.__exported).length > 0);
    const svg = await page.evaluate(() => new TextDecoder().decode(new Uint8Array(window.__exported['mindmap.svg'])));
    assert.ok(svg.includes('#15803d') && !svg.includes('#2563eb'), 'Export: Mindmap-Bild in der Hauptfarbe');
    await page.click('#mapPrintBtn');
    await page.waitForSelector('#printDialog[open]');
    await page.check('#printForm input[value="all"]');
    await page.check('#printIncludeMap');
    await page.click('#printGoBtn');
    await page.waitForFunction(() => window.__printed.length === 1);
    const printed = await page.evaluate(() => window.__printed[0]);
    assert.ok(printed.includes('#15803d') && !printed.includes('#2563eb'), 'Druck: Mindmap-Bild in der Hauptfarbe');
    step('Hauptfarbe: Mindmap-Bild in Export und Druck');

    // Datei öffnen/importieren: die Farbe gehört zur Datei
    const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, locale: 'de-CH' });
    const { page: p2, errors: errors2 } = await openApp(ctx2);
    assert.equal(await cssVar(p2, '--accent'), '#2563eb', 'frischer Browser: Blau');
    await p2.setInputFiles('#importInput', dlPath);
    await p2.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#15803d');
    assert.equal(await p2.evaluate(() => localStorage.getItem('nonotes.accent')), 'green');
    // eine Datei ohne Farbangabe setzt auf Blau zurück
    const old = new SQL.Database(new Uint8Array(fs.readFileSync(dlPath)));
    old.run("DELETE FROM meta WHERE key = 'accent'");
    const oldPath = path.join(tmp, 'ohne-farbe.sqlite');
    fs.writeFileSync(oldPath, Buffer.from(old.export()));
    old.close();
    p2.on('dialog', d => d.accept()); // Rückfrage vor dem Ersetzen
    await p2.setInputFiles('#importInput', oldPath);
    await p2.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#2563eb');
    assert.equal(await p2.evaluate(() => localStorage.getItem('nonotes.accent')), 'blue');
    step('Hauptfarbe: gehört zur Datei, eine Datei ohne Angabe zeigt Blau');

    // Dunkle Fassung
    const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH', colorScheme: 'dark' });
    const { page: p3, errors: errors3 } = await openApp(ctx3);
    assert.equal(await cssVar(p3, '--accent'), '#6ea8fe', 'dunkel: Blau wie bisher');
    await p3.click('#menuBtn');
    await p3.click('#accentSwatches .swatch[data-accent="yellow"]');
    await p3.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#facc15');
    assert.equal(await cssVar(p3, '--accent-contrast'), '#1c1500');
    assert.equal(await cssVar(p3, '--accent-ink'), '#facc15');
    await ctx3.close();
    const ctx4 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH', colorScheme: 'light' });
    const { page: p4 } = await openApp(ctx4);
    await p4.click('#menuBtn');
    await p4.click('#accentSwatches .swatch[data-accent="yellow"]');
    await p4.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#eab308');
    assert.equal(await cssVar(p4, '--accent-contrast'), '#1c1500', 'Gelb: dunkle Schrift auf heller Fläche');
    assert.equal(await cssVar(p4, '--accent-ink'), '#a16207', 'Gelb: Farbe als Schrift ist dunkler');
    await ctx4.close();
    step('Hauptfarbe: helle und dunkle Fassung mit passender Schriftfarbe');

    assert.deepEqual(errors, []);
    assert.deepEqual(errors2, []);
    assert.deepEqual(errors3, []);
    await ctx.close();
    await ctx2.close();
    console.log('\nFarb-Test bestanden.');
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error('\nFarb-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
