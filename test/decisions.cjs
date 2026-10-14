/* Test der Entscheide (v1.11.0) im Browser: "?!" beginnt einen Entscheid, "!!" darunter trifft ihn (die erste Zeile mit Datum),
   "@kürzel" nennt die Personen. Der Reiter «Entscheide» erscheint nur, wenn es welche gibt; die Ansicht teilt sich Leiste und Liste
   mit den Fragen; «Entscheiden» schreibt "!! Datum: Text" in die Notiz. Vorschau mit Karte und Personen-Marken, Toolleiste und
   Tastenkürzel, Vorschläge beim Tippen von "@" (auch aus einer Erweiterung), Filter nach Person, Marke in der Mindmap,
   Ereignis «questions:rendered» (auch als DOM-Ereignis), Export und Druck.
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

const PLUGIN = `NoNotesPlugins.register({ id: 'zugriff', name: 'Zugriff', api: 1, activate(ctx) {
  window.__ctx = ctx;
  window.__events = [];
  ctx.on('questions:rendered', d => { window.__events.push(d); });
  document.addEventListener('nonotes:questions:rendered', e => { window.__dom = e.detail; });
  ctx.people.provide(prefix => [{ handle: 'zoe4321', name: 'Zoe Zürcher' }]);
} });`;

function todayText() {
  const d = new Date();
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-decisions-'));
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

  // Ohne Entscheide: kein Reiter
  assert.equal(await page.locator('#viewDecisionsBtn').isVisible(), false, 'ohne Entscheide kein Reiter');

  const ids = await page.evaluate(async () => {
    const B = __ctx.backend;
    const plan = await B.createNote(null);
    await B.updateNote(plan, 'Planung', [
      'Intro',
      '? Wie hoch ist das Budget? @max1234',
      '! 20k',
      '?! Variante B oder C? @lea5678 (@tom9012) @01.11.2026',
      '?! Lieferant wählen @max1234',
      'Ende',
    ].join('\n'), {});
    await __ctx.refresh();
    return { plan };
  });
  await page.waitForFunction(() => document.querySelector('#viewDecisionsBtn') && !document.querySelector('#viewDecisionsBtn').hidden);
  assert.match(await page.locator('#viewDecisionsBtn').innerText(), /Entscheide\s*2/, 'Reiter mit Zahl der offenen Entscheide');
  assert.equal(await page.locator('#viewQuestionsBtn .count').count(), 0, 'die einzige Frage ist beantwortet');
  await page.click('#viewMapBtn');
  await page.waitForSelector('body.view-map');
  const badge = page.locator(`#mindmap .mm-node[data-id="${ids.plan}"] .mm-badge`);
  await page.waitForFunction(id => document.querySelector(`#mindmap .mm-node[data-id="${id}"] .mm-badge text`), ids.plan);
  assert.equal(await badge.locator('text').textContent(), '2');
  assert.equal(await badge.locator('title').textContent(), '2 offene Entscheide');
  step('Reiter «Entscheide» erscheint mit den offenen Entscheiden; die Marke am Knoten zählt sie mit');

  // Ansicht: Liste, Beschriftung, Personenfilter
  await page.click('#viewDecisionsBtn');
  await page.waitForSelector('body.view-decisions');
  await page.waitForFunction(() => document.querySelectorAll('.q-item.decision').length === 2);
  assert.equal(await page.locator('#qAnsweredBtn').innerText(), 'Entschieden');
  assert.equal(await page.locator('#qSearch').getAttribute('placeholder'), 'Entscheide durchsuchen…');
  assert.equal(await page.locator('.q-item.decision .q-mark').first().innerText(), '?!');
  const people = await page.locator('#qPersonFilter option').allTextContents();
  assert.deepEqual(people, ['Alle Personen', '@lea5678', '@max1234', '@tom9012']);
  assert.equal(await page.locator('.q-item .md-person').count(), 3);
  assert.equal(await page.locator('.q-item .md-person.optional').innerText(), '@tom9012', '(@kürzel) ist wahlweise');
  await page.selectOption('#qPersonFilter', 'max1234');
  await page.waitForFunction(() => document.querySelectorAll('.q-item').length === 1);
  assert.match(await page.locator('.q-item .q-text').innerText(), /Lieferant wählen/);
  await page.selectOption('#qPersonFilter', '');
  await page.waitForFunction(() => document.querySelectorAll('.q-item').length === 2);
  const ev = await page.evaluate(() => ({ last: window.__events[window.__events.length - 1], dom: window.__dom }));
  assert.equal(ev.last.kind, 'decision');
  assert.equal(ev.last.items.length, 2);
  assert.deepEqual(ev.last.items[0].people.map(p => p.handle), ['lea5678', 'tom9012']);
  assert.equal(ev.dom.kind, 'decision', 'auch als DOM-Ereignis nonotes:questions:rendered');
  assert.equal(await page.evaluate(() => window.__events[window.__events.length - 1].items[0].element instanceof HTMLElement), true, 'das Element des Eintrags ist dabei');
  step('Ansicht «Entscheide»: eigene Beschriftung, Personen-Marken, Filter nach Person, Ereignis für Erweiterungen');

  // Entscheiden schreibt "!! Datum: Text" in die Notiz
  const first = page.locator('.q-item.decision', { hasText: 'Variante B oder C' });
  await first.locator('button:has-text("Entscheiden")').click();
  await first.locator('.q-form textarea').fill('Variante B, weil billiger\nund schneller');
  await first.locator('.q-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.q-item').length === 1);
  await page.waitForFunction(SAVED);
  await page.click('#qFilter button[data-status="answered"]');
  await page.waitForFunction(() => document.querySelectorAll('.q-item.decision.answered').length === 1);
  assert.match(await page.locator('.q-item.answered .q-meta').innerText(), new RegExp('Entschieden ' + todayText().replace(/\./g, '\\.')));
  assert.match(await page.locator('.q-item.answered .q-answer').innerText(), /Variante B, weil billiger/);
  assert.equal(await page.locator('.q-item.answered button:has-text("Entscheid bearbeiten")').count(), 1);
  const body = await page.evaluate(id => __ctx.backend.getNote(id).then(n => n.body), ids.plan);
  assert.equal(body, [
    'Intro', '? Wie hoch ist das Budget? @max1234', '! 20k',
    '?! Variante B oder C? @lea5678 (@tom9012) @01.11.2026',
    `!! ${todayText()}: Variante B, weil billiger`, '!! und schneller',
    '?! Lieferant wählen @max1234', 'Ende',
  ].join('\n'), 'der Entscheid steht mit Datum als "!!"-Zeilen im Text');
  assert.match(await page.locator('#viewDecisionsBtn').innerText(), /Entscheide\s*1/);
  step('«Entscheiden» schreibt den Entscheid mit dem heutigen Datum unter die Zeile');

  // Vorschau, Statusleiste, Toolleiste, Tastenkürzel
  await page.locator('.q-item.answered button:has-text("Zur Notiz")').click();
  await page.waitForSelector('body.editor-open');
  assert.equal(await page.locator('#noteQuestions').innerText(), '1 Frage, alle beantwortet · 1 offener Entscheid von 2');
  await page.click('#modeSwitch [data-mode="split"]');
  await page.waitForFunction(() => document.querySelectorAll('#preview .md-q.md-decision').length === 2);
  assert.equal(await page.locator('#preview .md-q.md-decision.answered').count(), 1);
  assert.match(await page.locator('#preview .md-q.md-decision.answered .md-decided').innerText(), /^Entschieden /);
  assert.equal(await page.locator('#preview .md-q.md-decision.open .md-mark').innerText(), '?!');
  assert.equal(await page.locator('#preview .md-person').count(), 4, 'Personen-Marken in Frage und Entscheiden');
  assert.equal(await page.locator('#preview .md-person.optional').count(), 1);
  await page.evaluate(() => { const b = document.querySelector('#body'); b.focus(); b.setSelectionRange(2, 2); });
  await page.click('#decisionBtn');
  await page.waitForFunction(() => document.querySelector('#body').value.startsWith('?! Intro\n'));
  assert.equal(await page.locator('#noteQuestions').innerText(), '1 Frage, alle beantwortet · 2 offene Entscheide von 3');
  await page.keyboard.press('Control+Shift+D');
  await page.waitForFunction(() => document.querySelector('#body').value.startsWith('Intro\n'));
  await page.keyboard.press('Control+Shift+F');
  await page.waitForFunction(() => document.querySelector('#body').value.startsWith('? Intro\n'));
  await page.keyboard.press('Control+Shift+D');
  await page.waitForFunction(() => document.querySelector('#body').value.startsWith('?! Intro\n'), null, {});
  await page.keyboard.press('Control+Shift+D');
  await page.waitForFunction(() => document.querySelector('#body').value.startsWith('Intro\n'));
  await page.waitForFunction(SAVED);
  step('Vorschau mit Karte und Datum, Statusleiste zählt beide Arten, Toolleiste und Ctrl+Shift+D schalten "?!" um');

  // Vorschläge beim Tippen von "@": Kürzel aus der Datei und aus der Erweiterung
  await page.evaluate(() => { const b = document.querySelector('#body'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); });
  await page.keyboard.type('\n?! Neu @');
  await page.waitForSelector('#mentionPopup:not([hidden])');
  const suggested = await page.locator('#mentionPopup .mention-handle').allTextContents();
  assert.deepEqual(suggested, ['@lea5678', '@max1234', '@tom9012', '@zoe4321'], 'Datei und Erweiterung liefern, jedes Kürzel einmal');
  await page.keyboard.press('ArrowDown'); // zweiter Eintrag
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#body').value.endsWith('\n?! Neu @max1234 '));
  assert.equal(await page.locator('#mentionPopup').isVisible(), false, 'nach dem Übernehmen ist die Liste zu');
  await page.keyboard.type('(@zo');
  await page.waitForSelector('#mentionPopup:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#mentionPopup button').length === 1);
  assert.deepEqual(await page.locator('#mentionPopup .mention-handle').allTextContents(), ['@zoe4321']);
  assert.equal(await page.locator('#mentionPopup .mention-name').innerText(), 'Zoe Zürcher');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.querySelector('#body').value.endsWith('(@zoe4321 '));
  await page.keyboard.type('@q');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#mentionPopup').isVisible(), false, 'ohne Treffer keine Liste');
  await page.keyboard.press('Backspace');
  await page.waitForSelector('#mentionPopup:not([hidden])');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#mentionPopup').isVisible(), false);
  assert.equal(await page.locator('body.editor-open').count(), 1, 'Esc schliesst nur die Liste, nicht den Editor');
  await page.keyboard.type('@15.10.2026');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#mentionPopup').isVisible(), false, 'ein Termin ist kein Kürzel');
  await page.waitForFunction(SAVED);
  step('Tippen von "@" schlägt Kürzel vor: Pfeile, Enter, Tab, Esc; Erweiterungen liefern über ctx.people.provide');

  // Export und Druck
  const out = await page.evaluate(async id => {
    const note = await __ctx.backend.getNote(id);
    const md = NoNotesExport.bodyToMarkdown(note.body, null, null);
    const print = await NoNotesPrint.buildQuestionsDocument(__ctx.backend, { kind: 'decision', status: 'all' });
    const printQ = await NoNotesPrint.buildQuestionsDocument(__ctx.backend, { kind: 'question', status: 'all' });
    return { md, print, printQ };
  }, ids.plan);
  assert.ok(out.md.includes('> **Entscheid (getroffen):** Variante B oder C? @lea5678 (@tom9012) (bis 1.11.2026)'), out.md);
  assert.ok(out.md.includes(`> **Entschieden ${todayText()}:**\n> Variante B, weil billiger\n> und schneller`), out.md);
  assert.ok(out.md.includes('> **Offener Entscheid:** Lieferant wählen @max1234'), out.md);
  assert.ok(out.md.includes('> **Frage (beantwortet):** Wie hoch ist das Budget? @max1234\n> **Antwort:** 20k'), out.md);
  assert.ok(out.print.includes('<h1>Entscheide</h1>') && out.print.includes('class="print-q decision open"') && out.print.includes('md-person'), 'Druck der Entscheide');
  assert.ok(/3 Entscheide, davon 2 offen/.test(out.print), out.print.slice(0, 400));
  assert.ok(out.printQ.includes('<h1>Fragen und Antworten</h1>') && !out.printQ.includes('Variante B'), 'der Fragen-Druck enthält keine Entscheide');
  step('Markdown-Export mit Zitatblöcken «Offener Entscheid» und «Entschieden Datum»; Druck der Entscheide');

  // Ohne Entscheide verschwindet der Reiter wieder, sobald man die Ansicht verlässt
  await page.fill('#body', 'Nur Text\n!! allein');
  await page.waitForFunction(SAVED);
  await page.waitForFunction(() => document.querySelectorAll('#preview .md-a-lone').length === 1);
  await page.click('#backBtn');
  await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
  await page.click('#viewMapBtn');
  await page.waitForSelector('body.view-map');
  await page.waitForFunction(() => document.querySelector('#viewDecisionsBtn').hidden);
  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  step('Ohne Entscheide verschwindet der Reiter; "!!" ohne Öffner ist ein Hinweis');

  await ctx.close();
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nEntscheide-Test bestanden.');
}

main().catch(e => {
  console.error('\nEntscheide-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
