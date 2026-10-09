/* Sprach-Test: prüft das Sprachsystem in Chromium.
   1. Pseudo-Sprache (qps): jeder feste Text der Oberfläche muss durch t()/tn()/translateDom() gegangen sein.
      Die Seite wird dazu durch alle Ansichten und Dialoge geführt; sichtbarer Text ohne ⟦ ⟧ gilt als
      nicht übersetzbar und lässt den Test fehlschlagen. Eigener Inhalt (Titel, Notiztext) ist ausgenommen.
   2. Echtes Sprachpaket: ein kleines Testpaket wird dem Build beigelegt; Auswahl im Menü, Texte, Mehrzahlformen.
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
const step = name => console.log('  ✓ ' + name);

// Eigener Inhalt der Prüfseiten: Wörter, die nicht übersetzt werden.
const USER_WORDS = ['Alpha', 'Beta', 'Gamma', 'Offerte', 'einholen', 'Budget', 'Intro', 'Unterpunkt', 'Hauptpunkt', 'Liefertermin', 'Tagx', 'Wichtig', 'wichtig'];

/** Sammelt sichtbaren Text und Attribute ohne ⟦ ⟧. Läuft in der Seite. */
function collectUntranslated(userWords) {
  const user = new RegExp(userWords.concat(['Tab', 'Enter', 'Alt', 'Esc', 'Ctrl', 'Shift', 'Entf']).join('|'), 'g');
  const unwrap = s => { let prev; do { prev = s; s = s.replace(/⟦[^⟦⟧]*⟧/g, ' '); } while (s !== prev); return s; };
  const words = s => /[A-Za-zÄÖÜäöüÀ-ÿ]{2}/.test(unwrap(s).replace(user, ' '));
  const IGNORE = '#mindmap, svg, script, style, textarea, input, #version, [data-i18n-skip], .md-code, pre, code, .note-snippet, .note-title';
  const visible = el => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const out = [];
  const BLOCK = 'p, td, th, dt, dd, li, h1, h2, h3, h4, h5, h6, button, label, summary, option, legend, figcaption, div, section, nav, header, a, span';
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentElement;
    if (!p || p.closest(IGNORE) || !visible(p) || !n.nodeValue.trim()) continue;
    // Gemeinsam prüfen, was zu einem Textblock gehört (Textauszeichnung wie <strong> zählt zum Satz).
    let box = p;
    while (box.parentElement && ['STRONG', 'EM', 'B', 'I', 'U', 'DEL', 'SMALL', 'MARK', 'SUB', 'SUP', 'KBD', 'CODE', 'A', 'SPAN'].includes(box.tagName) && !box.id) box = box.parentElement;
    if (seen.has(box)) continue;
    seen.add(box);
    const copy = box.cloneNode(true);
    for (const x of copy.querySelectorAll('kbd, code, svg, script, style')) x.remove();
    const text = copy.textContent.replace(/\s+/g, ' ').trim();
    if (text && words(text)) out.push(`Text «${text.slice(0, 160)}» in <${box.tagName.toLowerCase()}${box.id ? '#' + box.id : ''}${box.className && typeof box.className === 'string' ? '.' + box.className.split(' ')[0] : ''}>`);
  }
  for (const el of document.body.querySelectorAll('[title],[placeholder],[aria-label],[alt]')) {
    if (el.closest('svg, [data-i18n-skip]') || (!visible(el) && !el.closest('dialog[open]'))) continue;
    for (const a of ['title', 'placeholder', 'aria-label', 'alt']) {
      const v = el.getAttribute(a);
      if (v && words(v)) out.push(`Attribut ${a}=«${v}» an <${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}>`);
    }
  }
  for (const o of document.querySelectorAll('select option')) {
    if (o.closest('[data-i18n-skip]')) continue;
    const sel = o.parentElement;
    if (!visible(sel)) continue;
    const v = o.textContent;
    if (v && words(v)) out.push(`Option «${v}» in <select#${sel.id}>`);
  }
  return out;
}

async function newRootNote(page, title) {
  await page.click('#mindmap', { position: { x: 30, y: 700 } });
  await page.keyboard.press('Tab');
  await page.waitForSelector('#renameInput:not([hidden])');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.waitForFunction(t => [...document.querySelectorAll('.mm-node text')].some(x => x.textContent === t), title);
}

const SAVED = () => document.querySelector('#status').dataset.state === 'saved';

async function pseudoTest(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: 'de-CH' });
  await ctx.addInitScript(() => { try { localStorage.setItem('nonotes.lang', 'qps'); } catch (e) { /* egal */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  await page.goto('file://' + path.join(DIST, 'index.html'));
  await page.waitForSelector(READY, { timeout: 30000 });

  const found = new Map();
  const check = async (label) => {
    const list = await page.evaluate(collectUntranslated, USER_WORDS);
    for (const item of list) {
      if (!found.has(item)) found.set(item, label);
    }
  };

  await check('Mindmap leer');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'de', 'html lang bleibt de für qps');

  // Inhalt anlegen
  await newRootNote(page, 'Alpha');
  await page.dblclick('.mm-node:not(.mm-root)');
  await page.waitForSelector('#editorPane:not([hidden])');
  await check('Editor leer');
  await page.fill('#body', [
    'Intro',
    '- [ ] Offerte einholen @15.10.2026',
    '  - [ ] Unterpunkt',
    '- [ ] Hauptpunkt @01.01.2020 10:00',
    '? Budget Alpha? @15.10.2020',
    '! Wichtig',
    '? Liefertermin?',
    '[[Alpha]] [[Gamma]] ![Bild](att:99)',
  ].join('\n'));
  await page.fill('#tagInput', 'Tagx');
  await page.keyboard.press('Enter');
  await page.waitForFunction(SAVED);
  await check('Editor mit Inhalt');
  for (const mode of ['split', 'preview']) {
    await page.click(`#modeSwitch [data-mode="${mode}"]`);
    await page.waitForTimeout(200);
    await check('Editor ' + mode);
  }
  await page.click('#modeSwitch [data-mode="edit"]');

  // Hilfe
  await page.click('#helpBtn');
  await page.waitForSelector('#helpDialog[open]');
  const tabs = await page.locator('#helpTabs [role="tab"], #helpTabs button').count();
  for (let i = 0; i < tabs; i++) {
    await page.locator('#helpTabs [role="tab"], #helpTabs button').nth(i).click();
    await page.waitForTimeout(100);
    await check('Hilfe Tab ' + i);
  }
  await page.keyboard.press('Escape');

  // Weitere Ansichten
  await page.click('#backBtn').catch(() => {});
  await page.waitForTimeout(200);
  for (const view of ['list', 'questions', 'tasks', 'map']) {
    await page.click(`#view${view[0].toUpperCase()}${view.slice(1)}Btn`);
    await page.waitForTimeout(250);
    await check('Ansicht ' + view);
  }
  await page.click('#viewQuestionsBtn');
  await page.waitForTimeout(250);
  const answerBtn = page.locator('#qList button:has-text("⟦Beantworten⟧")');
  if (await answerBtn.count()) {
    await answerBtn.first().click();
    await page.waitForTimeout(150);
    await check('Antwortformular');
    await page.fill('.q-form textarea', 'Alpha');
    await page.click('.q-form button:has-text("⟦Speichern⟧")');
    await check('Status nach Antwort');
  }
  await page.click('#viewTasksBtn');
  await page.waitForTimeout(250);
  await page.selectOption('#tSort', 'note').catch(() => {});
  await check('Aufgaben nach Notiz');
  await page.locator('#tList .t-check').first().click({ force: true });
  await check('Status nach Abhaken mit offenen Unteraufgaben');
  await page.locator('#tList .q-text').first().dblclick();
  await page.waitForTimeout(200);
  await check('Status nach Doppelklick');

  // Menü und Dialoge
  await page.click('#viewMapBtn');
  await page.click('#menuBtn');
  await check('Menü');
  await page.keyboard.press('Escape');
  for (const [btn, dlg, label] of [['#exportBtn', '#exportDialog', 'Export'], ['#calendarBtn', '#calDialog', 'Kalender'], ['#storageHelpBtn', '#helpDialog', 'Datenablage'], ['#pluginsBtn', '#pluginsDialog', 'Erweiterungen']]) {
    await page.click('#menuBtn');
    await page.click(btn);
    await page.waitForSelector(dlg + '[open]');
    await check('Dialog ' + label);
    await page.keyboard.press('Escape');
  }
  await page.click('#mapPrintBtn');
  await page.waitForSelector('#printDialog[open]');
  await check('Dialog Druck');
  await page.keyboard.press('Escape');
  await page.click('#viewQuestionsBtn');
  await page.click('#qPrintBtn');
  await page.waitForSelector('#qaPrintDialog[open]');
  await check('Dialog Fragen drucken');
  await page.keyboard.press('Escape');
  await page.click('#viewTasksBtn');
  await page.click('#tPrintBtn');
  await page.waitForSelector('#taskPrintDialog[open]');
  await page.waitForTimeout(150);
  await check('Dialog Aufgaben drucken');
  await page.keyboard.press('Escape');
  await page.click('#viewMapBtn');

  // Kontextmenü, Rückfragen
  await page.click('#mindmap', { button: 'right', position: { x: 40, y: 700 } });
  await check('Kontextmenü leer');
  await page.keyboard.press('Escape');
  await page.click('.mm-root', { button: 'right' });
  await check('Kontextmenü Wurzel');
  await page.keyboard.press('Escape');
  await page.click('.mm-node:not(.mm-root)', { button: 'right' });
  await check('Kontextmenü Knoten');
  await page.click('#contextMenu button:has-text("⟦Archivieren…⟧")').catch(() => {});
  await page.waitForTimeout(200);
  await page.click('.mm-node:not(.mm-root)', { button: 'right' }).catch(() => {});
  await page.click('#contextMenu button:has-text("⟦Löschen⟧")').catch(() => {});
  await page.waitForTimeout(200);

  // Listenansicht: Papierkorb und Archiv
  await page.click('#viewListBtn');
  for (const scope of ['trash', 'archive', 'live']) {
    await page.selectOption('#listScope', scope).catch(() => {});
    await page.waitForTimeout(200);
    await check('Liste ' + scope);
  }

  const bad = [...found.entries()].map(([text, where]) => `${where}: ${text}`);
  const dialogBad = dialogs.filter(m => !m.includes('⟦'));
  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  assert.deepEqual(bad, [], 'feste Texte ohne Übersetzungsaufruf:\n' + bad.join('\n'));
  assert.deepEqual(dialogBad, [], 'Rückfragen ohne Übersetzungsaufruf');
  assert.ok(dialogs.length >= 1, 'Rückfragen wurden geprüft');
  await ctx.close();
  step('Pseudo-Sprache: jeder feste Text der Oberfläche läuft über das Sprachsystem');
}

/** Baut eine Kopie des Builds mit einem kleinen Testpaket «en». */
function buildWithTestPack(tmp) {
  const dir = path.join(tmp, 'NoNotes');
  fs.cpSync(DIST, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lang', 'en.js'), `NoNotesI18n.register('en', 'English', {
  'Neue Notiz': 'New note',
  'Mindmap': 'Mind map',
  'Liste': 'List',
  'Datenbank ▾': 'Database ▾',
  '{n} Notiz': { one: '{n} note', other: '{n} notes' },
  '{n} Notizen': { one: '{n} note', other: '{n} notes' },
  '{n} Notiz ausgewählt': { one: '{n} note selected', other: '{n} notes selected' },
  'Sprache': 'Language',
  'Ohne Titel': 'Untitled',
  'Meine Notizen': 'My notes',
}, { locale: 'en' });
`);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="lang/de.js"></script>'), 'de.js eingebunden');
  fs.writeFileSync(path.join(dir, 'index.html'), html.replace('<script src="lang/de.js"></script>', '<script src="lang/de.js"></script>\n  <script src="lang/en.js"></script>'));
  return dir;
}

async function packTest(browser, tmp) {
  const dir = buildWithTestPack(tmp);
  const url = 'file://' + path.join(dir, 'index.html');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForSelector(READY, { timeout: 30000 });

  // Browsersprache en und Paket vorhanden → Englisch; Sprachwahl im Menü sichtbar
  assert.equal(await page.evaluate(() => NoNotesI18n.language()), 'en', 'Browsersprache wird übernommen');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  assert.equal(await page.locator('#menuBtn').innerText(), 'Database ▾');
  assert.equal(await page.locator('#viewMapBtn').innerText(), 'Mind map');
  assert.equal(await page.locator('#mapNewBtn').innerText(), 'New note');
  await page.click('#menuBtn');
  assert.equal(await page.locator('#langRow').isVisible(), true, 'Sprachwahl sichtbar bei mehr als einer Sprache');
  assert.equal(await page.locator('#langRow label').innerText(), 'Language');
  assert.deepEqual(await page.locator('#langSelect option').allInnerTexts(), ['Deutsch', 'English']);
  assert.equal(await page.inputValue('#langSelect'), 'en');
  step('Sprachpaket: Browsersprache, Texte aus dem Markup, Sprachwahl im Menü');

  // Mehrzahlformen und nicht übersetzte Texte (Rückfall auf Deutsch)
  await page.keyboard.press('Escape');
  await page.click('#viewListBtn');
  await page.waitForSelector('body.view-list');
  await page.click('#newBtn');
  await page.fill('#title', 'One');
  await page.waitForFunction(SAVED);
  assert.equal(await page.locator('#count').innerText(), '1 note');
  await page.click('#newBtn');
  await page.fill('#title', 'Two');
  await page.waitForFunction(SAVED);
  assert.equal(await page.locator('#count').innerText(), '2 notes');
  assert.match(await page.locator('#viewQuestionsBtn').innerText(), /Fragen/, 'nicht übersetzter Text bleibt deutsch');
  step('Sprachpaket: Einzahl und Mehrzahl, Rückfall auf Deutsch');

  // Wechsel auf Deutsch: gemerkt, nach dem Neuladen deutsch
  await page.click('#menuBtn');
  await page.selectOption('#langSelect', 'de');
  await page.waitForFunction(() => document.querySelector('#menuBtn').textContent.includes('Datenbank') && !document.querySelector('#menuBtn').textContent.includes('Database'));
  await page.waitForSelector(READY);
  assert.equal(await page.evaluate(() => localStorage.getItem('nonotes.lang')), 'de');
  assert.equal(await page.locator('#viewMapBtn').innerText(), 'Mindmap');
  assert.equal(await page.locator('#count').innerText(), '2 Notizen', 'Daten bleiben beim Sprachwechsel erhalten');
  step('Sprachwechsel: gespeichert, Seite neu geladen, Daten bleiben');

  // Standardtitel einer neuen Mindmap folgt der Sprache (frischer Browserkontext, englisch)
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
  const p2 = await ctx2.newPage();
  await p2.goto(url);
  await p2.waitForSelector(READY, { timeout: 30000 });
  assert.equal(await p2.evaluate(() => document.querySelector('.mm-root text').textContent), 'My notes', 'Titel einer neuen Mindmap folgt der Sprache');
  await ctx2.close();

  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  await ctx.close();
  step('Sprachpaket: keine Browserfehler');
}

async function main() {
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-i18n-'));
  try {
    await pseudoTest(browser);
    await packTest(browser, tmp);
    console.log('\nSprach-Test bestanden.');
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error('\nSprach-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
