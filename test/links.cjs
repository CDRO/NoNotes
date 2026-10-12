/* Test der Querverweise (v1.8.0) im Browser: [[Titel*]] zieht in der Mindmap eine gestrichelte Linie zur Notiz mit diesem Titel,
   [[Titel]] ohne Stern nicht. Der Schalter «Verweise» in der Mindmap-Leiste erscheint nur, wenn es welche gibt; die Wahl merkt sich der
   Browser. Eingeklappte Ziele bekommen keine Linie, bei der Suche werden Linien ohne Treffer blass. Die Vorschau zeigt den Verweis ohne
   Stern und öffnet die Notiz; Export und Druck zeichnen die Linien, der Markdown-Export macht Links daraus.
   Ausführen: npm test (nach tools/build.cjs). */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'NoNotes');

function loadPlaywright() {
  try { return require('playwright'); }
  catch (e) {
    if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
    throw e;
  }
}
const { chromium } = loadPlaywright();

const READY = 'body[data-ready="true"]';
const SAVED = () => document.querySelector('#status').dataset.state === 'saved';
const step = name => console.log('  ✓ ' + name);

const PLUGIN = `NoNotesPlugins.register({ id: 'zugriff', name: 'Zugriff', api: 1, activate(ctx) { window.__ctx = ctx; } });`;

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-links-'));
  const dir = path.join(tmp, 'NoNotes');
  fs.cpSync(DIST, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'zugriff.js'), PLUGIN);
  fs.writeFileSync(path.join(dir, 'plugins', 'plugins.js'), "NoNotesPlugins.list(['zugriff.js']);\n");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.join(dir, 'index.html'));
  await page.waitForSelector(READY, { timeout: 30000 });

  // Alpha und Gamma an der Wurzel, Beta unter «Ordner»; Alpha → Beta (Stern), Alpha → Gamma ohne Stern, Gamma → Alpha (Stern, andere Schreibweise)
  const ids = await page.evaluate(async () => {
    const B = __ctx.backend;
    const alpha = await B.createNote(null);
    const ordner = await B.createNote(null);
    const beta = await B.createNote(ordner);
    const gamma = await B.createNote(null);
    await B.renameNote(ordner, 'Ordner');
    await B.renameNote(beta, 'Beta');
    await B.updateNote(alpha, 'Alpha', 'Siehe [[Beta*]], dazu [[Gamma]] und [[Alpha*]] sowie [[Nirgends*]].', {});
    await B.updateNote(gamma, 'Gamma', 'Zurück zu [[alpha *]].', {});
    await __ctx.refresh();
    return { alpha, ordner, beta, gamma };
  });
  await page.waitForFunction(SAVED, null, { timeout: 10000 });
  const linksDrawn = () => page.evaluate(() => [...document.querySelectorAll('#mindmap path.mm-link')].map(p => p.dataset.from + '>' + p.dataset.to).sort());
  await page.waitForFunction(() => document.querySelectorAll('#mindmap path.mm-link').length === 2);
  assert.deepEqual(await linksDrawn(), [`${ids.alpha}>${ids.beta}`, `${ids.gamma}>${ids.alpha}`].sort());
  const style = await page.evaluate(() => { const p = document.querySelector('#mindmap path.mm-link'); const cs = getComputedStyle(p); return { dash: cs.strokeDasharray, marker: p.getAttribute('marker-end'), title: p.querySelector('title').textContent }; });
  assert.notEqual(style.dash, 'none', 'gestrichelt');
  assert.equal(style.marker, 'url(#mmLinkArrow)', 'mit Pfeilspitze am Ziel');
  assert.match(style.title, /Alpha.*Beta|Gamma.*Alpha/);
  assert.deepEqual(await page.evaluate(() => __ctx.backend.getLinks()), [
    { from_id: ids.alpha, to_id: ids.beta, title: 'Beta' }, { from_id: ids.gamma, to_id: ids.alpha, title: 'alpha' },
  ]);
  step('[[Titel*]] zeichnet eine gestrichelte Linie mit Pfeil; ohne Stern, auf sich selbst oder ohne Ziel keine');

  // Schalter: nur sichtbar, wenn es Linien gibt; die Wahl merkt sich der Browser
  const btn = page.locator('#mapLinksBtn');
  assert.equal(await btn.isVisible(), true);
  assert.match(await btn.innerText(), /Verweise ausblenden \(2\)/);
  assert.equal(await btn.getAttribute('aria-pressed'), 'true');
  await btn.click();
  await page.waitForFunction(() => document.querySelectorAll('#mindmap path.mm-link').length === 0);
  assert.match(await btn.innerText(), /Verweise anzeigen \(2\)/);
  assert.equal(await page.evaluate(() => localStorage.getItem('nonotes.showLinks')), '0');
  await page.reload();
  await page.waitForSelector(READY);
  await page.waitForFunction(() => document.querySelectorAll('#mindmap .mm-node').length >= 5);
  assert.equal(await page.locator('#mindmap path.mm-link').count(), 0, 'nach dem Neuladen bleiben sie ausgeblendet');
  assert.match(await btn.innerText(), /Verweise anzeigen \(2\)/);
  await btn.click();
  await page.waitForFunction(() => document.querySelectorAll('#mindmap path.mm-link').length === 2);
  assert.equal(await page.evaluate(() => localStorage.getItem('nonotes.showLinks')), '1');
  step('Schalter «Verweise» in der Mindmap-Leiste: nur mit Linien sichtbar, blendet sie aus und ein, die Wahl bleibt nach dem Neuladen');

  // Eingeklapptes Ziel: keine Linie; Suche: Linien ohne Treffer werden blass
  await page.evaluate(async id => { await __ctx.backend.setCollapsed(id, true); await __ctx.refresh(); }, ids.ordner);
  await page.waitForFunction(() => document.querySelectorAll('#mindmap path.mm-link').length === 1);
  assert.deepEqual(await linksDrawn(), [`${ids.gamma}>${ids.alpha}`], 'Beta ist eingeklappt, die Linie dorthin fehlt');
  await page.evaluate(async id => { await __ctx.backend.setCollapsed(id, false); await __ctx.refresh(); }, ids.ordner);
  await page.waitForFunction(() => document.querySelectorAll('#mindmap path.mm-link').length === 2);
  await page.fill('#mapSearch', 'Ordner'); // trifft nur «Ordner» (die Suche findet auch Texte, darum nicht «Beta»)
  await page.waitForFunction(() => document.querySelector('#mindmap').classList.contains('has-matches'));
  assert.equal(await page.locator('#mindmap path.mm-link.mm-dim').count(), 2, 'beide Linien haben ein Ende ohne Treffer');
  await page.fill('#mapSearch', 'Gamma'); // trifft Gamma und Alpha (deren Text nennt Gamma): die Linie Gamma → Alpha bleibt kräftig
  await page.waitForFunction(() => document.querySelectorAll('#mindmap path.mm-link.mm-dim').length === 1);
  await page.fill('#mapSearch', '');
  await page.waitForFunction(() => !document.querySelector('#mindmap').classList.contains('has-matches'));
  step('Eingeklappte Ziele bekommen keine Linie; bei der Suche werden Linien ohne Treffer blass');

  // Vorschau: der Verweis erscheint ohne Stern, als Querverweis markiert, und öffnet die Notiz
  await page.dblclick(`#mindmap .mm-node[data-id="${ids.alpha}"]`);
  await page.waitForSelector('#editorPane:not([hidden])');
  await page.click('#modeSwitch [data-mode="preview"]');
  await page.waitForSelector('#preview a.md-wiki-cross');
  const refs = await page.evaluate(() => [...document.querySelectorAll('#preview a.md-wiki')].map(a => ({ text: a.textContent, cross: a.classList.contains('md-wiki-cross'), missing: a.classList.contains('missing'), id: a.dataset.noteId || null })));
  assert.deepEqual(refs, [
    { text: 'Beta', cross: true, missing: false, id: String(ids.beta) },
    { text: 'Gamma', cross: false, missing: false, id: String(ids.gamma) },
    { text: 'Alpha', cross: true, missing: false, id: String(ids.alpha) },
    { text: 'Nirgends', cross: true, missing: true, id: null },
  ]);
  await page.click('#preview a.md-wiki-cross');
  await page.waitForFunction(() => document.querySelector('#title').value === 'Beta');
  await page.click('#backBtn');
  await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
  step('Vorschau: [[Titel*]] zeigt den Titel ohne Stern, markiert als Querverweis, und öffnet die Notiz');

  // Stern entfernen: die Linie verschwindet nach dem Speichern
  await page.dblclick(`#mindmap .mm-node[data-id="${ids.alpha}"]`);
  await page.waitForSelector('#editorPane:not([hidden])');
  await page.click('#modeSwitch [data-mode="edit"]');
  await page.fill('#body', 'Siehe [[Beta]].');
  await page.waitForFunction(SAVED);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
  await page.waitForFunction(() => document.querySelectorAll('#mindmap path.mm-link').length === 1);
  assert.deepEqual(await linksDrawn(), [`${ids.gamma}>${ids.alpha}`]);
  assert.match(await btn.innerText(), /\(1\)/);
  step('Ohne Stern ist die Linie weg, der Schalter zählt nach');

  // Export (SVG und Markdown) und Druck zeichnen die Linien beziehungsweise machen Links daraus
  const out = await page.evaluate(async () => {
    const svg = await NoNotesExport.renderSvg(__ctx.backend, {});
    const md = NoNotesExport.bodyToMarkdown('Siehe [[Beta*]] und [[Gamma]].', title => `${title.toLowerCase()}.md`, null);
    return { svgLinks: (svg.match(/stroke-dasharray="6 4"/g) || []).length, svgMarker: svg.includes('<marker id="mmLinkArrow"'), md };
  });
  assert.equal(out.svgLinks, 1, 'das Mindmap-Bild des Exports hat die Linie');
  assert.equal(out.svgMarker, true);
  assert.equal(out.md, 'Siehe [Beta](beta.md) und [Gamma](gamma.md).', 'im Markdown-Export ist [[Titel*]] ein Link ohne Stern');
  const printed = await page.evaluate(async () => {
    const html = await NoNotesPrint.buildNotesDocument(__ctx.backend, { scope: 'all', includeMap: true, includeToc: false });
    return typeof html === 'string' ? html : JSON.stringify(html);
  });
  assert.ok(printed.includes('stroke-dasharray="6 4"'), 'auch das Mindmap-Bild im Druck hat die Linie');
  step('Export: Mindmap-Bild mit Linie, Markdown mit Link; Druck mit Linie');

  // Gelöschtes Ziel: keine Linie mehr, Schalter verschwindet, wenn keine übrig ist
  await page.evaluate(async id => { await __ctx.backend.deleteNote(id); await __ctx.refresh(); }, ids.gamma);
  await page.waitForFunction(() => document.querySelectorAll('#mindmap path.mm-link').length === 0);
  assert.equal(await btn.isVisible(), false, 'ohne Linien kein Schalter');
  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  step('Gelöschtes Ziel: keine Linie, kein Schalter');

  await ctx.close();
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nQuerverweis-Test bestanden.');
}

main().catch(e => {
  console.error('\nQuerverweis-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
