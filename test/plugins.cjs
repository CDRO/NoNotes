/* Test der Erweiterungs-Schnittstelle (v1.2.0): Liste im Ordner plugins/, Lader, Schnittstelle der Version 1,
   Ereignisse, Designs, Fehlerisolierung. Der Build wird kopiert und mit Testerweiterungen bestückt.
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
const initSqlJs = require(path.join(ROOT, 'vendor/sql.js/sql-asm.js'));

const READY = 'body[data-ready="true"]';
const SAVED = () => document.querySelector('#status').dataset.state === 'saved';
const step = name => console.log('  ✓ ' + name);

const FILES = {
  // Eine vollständige Erweiterung: Menü, Toolleiste, Editor, Daten, Ereignisse
  'test-ok.js': `
    window.__events = [];
    NoNotesPlugins.register({
      id: 'test-ok', name: 'Test OK', version: '2.0.0', api: 1, description: 'Prüft die Schnittstelle',
      activate(ctx) {
        window.__ctx = ctx;
        for (const ev of NoNotesPlugins.EVENTS) ctx.on(ev, data => window.__events.push([ev, data]));
        ctx.ui.addMenuItem({ label: 'Zähle Notizen', action: async () => {
          const n = await ctx.backend.countNotes({ archived: false });
          ctx.ui.setStatus('Es gibt ' + n + ' Notizen', 'saved');
        } });
        ctx.ui.addToolbarButton({ label: 'Stempel', title: 'Fügt einen Stempel ein', action: async editor => {
          window.__editorBefore = { id: editor.noteId(), writable: editor.isWritable(), selection: editor.selection() };
          await editor.replaceSelection('[Stempel]');
        } });
        ctx.ui.addMenuItem({ label: 'Neue Notiz per Erweiterung', action: async () => {
          const id = await ctx.backend.createNote(null);
          await ctx.backend.renameNote(id, 'Von Erweiterung');
          await ctx.refresh();
          await ctx.openNote(id);
        } });
      },
    });`,
  'test-theme.js': `
    NoNotesPlugins.register({
      id: 'test-theme', name: 'Test Theme', api: 1,
      theme: { name: 'Test-Design', light: { bg: '#112233', radius: '2px' }, dark: { bg: '#223344' }, css: '.logo { letter-spacing: 3px; }' },
    });`,
  'test-bad-api.js': `NoNotesPlugins.register({ id: 'test-bad-api', name: 'Zu neu', api: 99 });`,
  'test-throws.js': `NoNotesPlugins.register({ id: 'test-throws', name: 'Wirft', api: 1, activate() { throw new Error('kaputt beim Start'); } });`,
  'test-dup.js': `NoNotesPlugins.register({ id: 'test-ok', name: 'Doppelt', api: 1 });`,
  'test-bad-theme.js': `NoNotesPlugins.register({ id: 'test-bad-theme', name: 'Schlechtes Design', api: 1, theme: { light: { 'accent': '#ff0000' } } });`,
  'test-noregister.js': `window.__noregister = true;`,
  'test-event-throw.js': `
    NoNotesPlugins.register({ id: 'test-event-throw', name: 'Ereignis wirft', api: 1,
      activate(ctx) { ctx.on('note:open', () => { throw new Error('Ereignis kaputt'); }); } });`,
  'test-syntax-error.js': `this is not javascript (`,
};

function buildWithPlugins(tmp, files) {
  const dir = path.join(tmp, 'NoNotes');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(DIST, dir, { recursive: true });
  for (const [name, text] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, 'plugins', name), text);
  fs.writeFileSync(path.join(dir, 'plugins', 'plugins.js'), `NoNotesPlugins.list(${JSON.stringify(files)});\n`);
  return 'file://' + path.join(dir, 'index.html');
}

const ALL = ['test-ok.js', 'test-theme.js', 'test-bad-api.js', 'test-throws.js', 'test-dup.js', 'test-bad-theme.js', 'test-noregister.js', 'test-event-throw.js', 'fehlt.js', 'test-syntax-error.js'];

async function openApp(ctx, url) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => {
    if (/Unexpected identifier 'is'/.test(e.message)) return; // der absichtliche Syntaxfehler in test-syntax-error.js
    errors.push('pageerror: ' + e.message);
  });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return; // die absichtlich fehlende Datei
    errors.push('console: ' + m.text());
  });
  await page.goto(url);
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

async function main() {
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-plugins-'));
  const SQL = await initSqlJs();
  try {
    // ---------- Ohne Erweiterungen ----------
    const plainUrl = buildWithPlugins(tmp, []);
    const ctxA = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
    const { page: pa, errors: ea } = await openApp(ctxA, plainUrl);
    await pa.click('#menuBtn');
    assert.equal(await pa.locator('#themeRow').isVisible(), false, 'ohne Designs keine Auswahl');
    assert.equal(await pa.locator('#pluginMenu').isVisible(), false, 'ohne Erweiterungen kein Abschnitt im Menü');
    await pa.click('#pluginsBtn');
    await pa.waitForSelector('#pluginsDialog[open]');
    assert.match(await pa.locator('#pluginList').innerText(), /Keine Erweiterungen geladen/);
    assert.match(await pa.locator('#pluginsDialog').innerText(), /allen Rechten dieser Seite/, 'Warnhinweis steht im Dialog');
    assert.deepEqual(ea, []);
    await ctxA.close();
    step('Ohne Erweiterungen: Menü unverändert, Dialog erklärt den Weg und warnt');

    // ---------- Mit Erweiterungen ----------
    const url = buildWithPlugins(tmp, ALL);
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, locale: 'de-CH' });
    const { page, errors } = await openApp(ctx, url);
    assert.equal(await page.evaluate(() => window.__noregister), true, 'Skript der Datei lief');

    // Verzeichnis und Zustände
    const list = await page.evaluate(() => NoNotesPlugins.all().map(p => ({ id: p.id, name: p.name, status: p.status, error: p.error, file: p.file })));
    const by = file => list.find(p => p.file === file);
    assert.equal(by('test-ok.js').status, 'active');
    assert.equal(by('test-theme.js').status, 'active');
    assert.equal(by('test-bad-api.js').status, 'error');
    assert.match(by('test-bad-api.js').error, /Schnittstelle 99/);
    assert.equal(by('test-throws.js').status, 'error');
    assert.match(by('test-throws.js').error, /kaputt beim Start/);
    assert.equal(by('test-dup.js').status, 'error');
    assert.match(by('test-dup.js').error, /schon vergeben/);
    assert.equal(by('test-bad-theme.js').status, 'error');
    assert.match(by('test-bad-theme.js').error, /unbekannte Variable/);
    assert.equal(by('test-noregister.js').status, 'error');
    assert.match(by('test-noregister.js').error, /register\(\)/);
    assert.equal(by('fehlt.js').status, 'error');
    assert.match(by('fehlt.js').error, /nicht gefunden/);
    assert.equal(by('test-syntax-error.js').status, 'error', 'Skript mit Syntaxfehler wird gemeldet');
    assert.equal(by('test-event-throw.js').status, 'active');
    step('Lader: gültige Erweiterungen aktiv, jede fehlerhafte einzeln gemeldet, die App startet trotzdem');

    // Dialog
    await page.click('#menuBtn');
    await page.click('#pluginsBtn');
    await page.waitForSelector('#pluginsDialog[open]');
    const dialogText = await page.locator('#pluginList').innerText();
    assert.match(dialogText, /Test OK/);
    assert.match(dialogText, /2\.0\.0/);
    assert.match(dialogText, /aktiv/);
    assert.match(dialogText, /kaputt beim Start/);
    assert.match(dialogText, /Bringt ein Design mit/);
    assert.equal(await page.locator('#pluginList .plugin-state.error').count() >= 6, true);
    await page.keyboard.press('Escape');
    step('Dialog «Erweiterungen»: Name, Version, Zustand, Fehlertexte');

    // Schnittstelle Version 1: stabile Namen (neue dürfen dazukommen, nichts darf wegfallen)
    const surface = await page.evaluate(() => {
      const c = window.__ctx;
      return {
        top: Object.keys(c), ui: Object.keys(c.ui), editor: Object.keys(c.editor), api: c.api,
        frozen: Object.isFrozen(c) && Object.isFrozen(c.ui) && Object.isFrozen(c.editor),
        events: NoNotesPlugins.EVENTS, themeVars: NoNotesPlugins.THEME_VARS,
        backend: NoNotesBackend.METHODS.every(m => typeof c.backend[m] === 'function'),
      };
    });
    for (const k of ['id', 'api', 'appVersion', 'backend', 'language', 'on', 'openNote', 'refresh', 'ui', 'editor']) assert.ok(surface.top.includes(k), `ctx.${k}`);
    for (const k of ['setStatus', 'addMenuItem', 'addToolbarButton']) assert.ok(surface.ui.includes(k), `ctx.ui.${k}`);
    for (const k of ['noteId', 'isWritable', 'selection', 'replaceSelection']) assert.ok(surface.editor.includes(k), `ctx.editor.${k}`);
    for (const k of ['ready', 'database:replaced', 'note:open', 'note:close', 'note:saved']) assert.ok(surface.events.includes(k), `Ereignis ${k}`);
    for (const k of ['bg', 'panel', 'text', 'muted', 'border', 'hover', 'danger', 'ok', 'warn', 'radius', 'shadow']) assert.ok(surface.themeVars.includes(k), `Theme-Variable ${k}`);
    assert.equal(surface.api, 1);
    assert.equal(surface.frozen, true, 'die Schnittstelle ist eingefroren');
    assert.equal(surface.backend, true, 'ctx.backend hat alle Methoden des Backend-Vertrags');
    step('Schnittstelle 1: Namen, eingefroren, Backend-Vertrag');

    // Ereignis «ready» kam
    assert.ok((await page.evaluate(() => window.__events)).some(e => e[0] === 'ready'), 'ready');

    // Menüeintrag und Backend
    await newRootNote(page, 'Alpha');
    await page.click('#menuBtn');
    assert.equal(await page.locator('#pluginMenu').isVisible(), true);
    await page.click('#pluginMenu button:has-text("Zähle Notizen")');
    await page.waitForFunction(() => /Es gibt 1 Notizen/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#menu').isVisible(), false, 'Menü schliesst nach dem Klick');
    step('Menüeintrag: Aktion liest über ctx.backend und meldet in der Statuszeile');

    // Toolleistenknopf und Editor-Schnittstelle, Ereignisse beim Öffnen und Schreiben
    await page.dblclick('.mm-node:not(.mm-root)');
    await page.waitForSelector('#editorPane:not([hidden])');
    await page.fill('#body', 'Anfang ENDE');
    await page.evaluate(() => { const b = document.querySelector('#body'); b.focus(); b.setSelectionRange(7, 11); });
    await page.click('#mdToolbar button[data-plugin="test-ok"]');
    await page.waitForFunction(() => document.querySelector('#body').value === 'Anfang [Stempel]');
    const before = await page.evaluate(() => window.__editorBefore);
    assert.equal(before.writable, true);
    assert.equal(typeof before.id, 'number');
    assert.deepEqual(before.selection, { start: 7, end: 11, text: 'ENDE' });
    await page.waitForFunction(SAVED);
    await page.waitForFunction(() => window.__events.some(e => e[0] === 'note:saved'));
    const evs = await page.evaluate(() => window.__events.map(e => e[0]));
    assert.ok(evs.includes('note:open'), 'note:open');
    step('Toolleistenknopf: Editor-Schnittstelle liest die Markierung und ersetzt sie; Ereignisse note:open, note:saved');

    // Fehler im Ereignis einer anderen Erweiterung stört nicht
    const entry = await page.evaluate(() => NoNotesPlugins.all().find(p => p.id === 'test-event-throw').error);
    assert.match(entry, /Ereignis kaputt/, 'Fehler im Ereignis wird bei der Erweiterung vermerkt');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__events.some(e => e[0] === 'note:close'));
    step('Fehler im Ereignis einer Erweiterung: andere Erweiterungen und die App laufen weiter');

    // Daten ändern über das Backend, ctx.refresh und openNote
    await page.click('#menuBtn');
    await page.click('#pluginMenu button:has-text("Neue Notiz per Erweiterung")');
    await page.waitForFunction(() => [...document.querySelectorAll('.mm-node text')].some(x => x.textContent === 'Von Erweiterung'));
    await page.waitForSelector('#editorPane:not([hidden])');
    assert.equal(await page.inputValue('#title'), 'Von Erweiterung');
    await page.waitForFunction(SAVED);
    step('ctx.backend ändert Daten, ctx.refresh zeichnet neu, ctx.openNote öffnet; die Änderung wird gespeichert');
    await page.keyboard.press('Escape');

    // Design
    await page.click('#menuBtn');
    assert.equal(await page.locator('#themeRow').isVisible(), true, 'Designauswahl erscheint mit einem Design');
    assert.deepEqual(await page.locator('#themeSelect option').allInnerTexts(), ['Standard', 'Test-Design']);
    assert.equal(await cssVar(page, '--bg'), '#f4f5f7', 'Standard zuerst');
    await page.selectOption('#themeSelect', 'test-theme');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#112233');
    assert.equal(await cssVar(page, '--radius'), '2px');
    assert.equal(await page.locator('.logo').evaluate(l => getComputedStyle(l).letterSpacing), '3px', 'zusätzliches CSS des Designs gilt');
    await page.click('#accentSwatches .swatch[data-accent="green"]');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#15803d');
    assert.equal(await cssVar(page, '--bg'), '#112233', 'Hauptfarbe und Design gelten zusammen');
    const order = await page.evaluate(() => [...document.head.querySelectorAll('style')].map(s => s.id));
    assert.ok(order.indexOf('accentStyle') > order.indexOf('themeStyle'), 'die Hauptfarbe steht nach dem Design und gewinnt');
    await page.waitForFunction(SAVED);
    assert.equal(await page.evaluate(() => localStorage.getItem('nonotes.theme')), 'test-theme');
    await page.keyboard.press('Escape');
    step('Design: Auswahl im Menü, Variablen und CSS gelten, Hauptfarbe bleibt oben');

    // Neuladen: Design aus der Datenbank, auch ohne Zwischenspeicher
    await page.evaluate(() => localStorage.removeItem('nonotes.theme'));
    await page.reload();
    await page.waitForSelector(READY);
    assert.equal(await cssVar(page, '--bg'), '#112233', 'Design kommt aus der Datenbank');
    await page.click('#menuBtn');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')]);
    const dlPath = path.join(tmp, 'design.sqlite');
    await dl.saveAs(dlPath);
    const db = new SQL.Database(new Uint8Array(fs.readFileSync(dlPath)));
    assert.equal(db.exec("SELECT value FROM meta WHERE key='theme'")[0].values[0][0], 'test-theme');
    // Notiz mit Skript im Text: die Datei lädt nie Programmcode
    db.run("UPDATE notes SET body = '<script>window.__pwned = 1</script><img src=x onerror=\"window.__pwned = 2\">' WHERE id = (SELECT min(id) FROM notes)");
    fs.writeFileSync(path.join(tmp, 'skript.sqlite'), Buffer.from(db.export()));
    db.close();
    step('Design: aus der Datenbankdatei (meta theme), Zwischenspeicher nachgeführt');

    // Datei wechseln: database:replaced und Design der anderen Datei; Skripte im Text laufen nicht
    await page.evaluate(() => { window.__events.length = 0; });
    page.on('dialog', d => d.accept());
    await page.setInputFiles('#importInput', path.join(tmp, 'skript.sqlite'));
    await page.waitForFunction(() => window.__events.some(e => e[0] === 'database:replaced'));
    await page.dblclick('.mm-node:not(.mm-root)');
    await page.waitForSelector('#editorPane:not([hidden])');
    await page.click('#modeSwitch [data-mode="preview"]');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'Programmcode im Notiztext wird nicht ausgeführt');
    step('Dateiwechsel meldet database:replaced; Programmcode in Notizen wird nie ausgeführt');

    // Erweiterung entfernt: unbekanntes Design fällt auf Standard zurück, die Datei behält die Angabe
    assert.deepEqual(errors, [], 'keine Fehler im Browser');
    await ctx.close();

    const url2 = buildWithPlugins(tmp, ['test-ok.js']);
    const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
    await ctx2.addInitScript(() => { try { localStorage.setItem('nonotes.theme', 'test-theme'); } catch (e) { /* egal */ } });
    const { page: p2, errors: e2 } = await openApp(ctx2, url2);
    assert.equal(await cssVar(p2, '--bg'), '#f4f5f7', 'unbekanntes Design: Standard');
    assert.equal(await p2.evaluate(() => localStorage.getItem('nonotes.theme')), null, 'Zwischenspeicher wird bereinigt');
    assert.deepEqual(e2, []);
    await ctx2.close();
    step('Fehlt die Erweiterung eines gewählten Designs, gilt Standard');

    // Die mitgelieferten Beispiele funktionieren, wenn man sie in plugins/plugins.js freigibt
    const exDir = path.join(tmp, 'NoNotes');
    buildWithPlugins(tmp, []);
    fs.writeFileSync(path.join(exDir, 'plugins', 'plugins.js'), fs.readFileSync(path.join(DIST, 'plugins', 'plugins.js'), 'utf8').replace(/\/\/ ('beispiele\/)/g, '$1'));
    const ctx5 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
    const { page: p5, errors: e5 } = await openApp(ctx5, 'file://' + path.join(exDir, 'index.html'));
    assert.deepEqual(await p5.evaluate(() => NoNotesPlugins.all().map(p => p.id + ':' + p.status)), ['datum-einfuegen:active', 'sepia:active']);
    await newRootNote(p5, 'Alpha');
    await p5.dblclick('.mm-node:not(.mm-root)');
    await p5.waitForSelector('#editorPane:not([hidden])');
    await p5.fill('#body', 'Heute ist ');
    await p5.evaluate(() => { const b = document.querySelector('#body'); b.focus(); b.setSelectionRange(10, 10); });
    await p5.click('#mdToolbar button[data-plugin="datum-einfuegen"]');
    await p5.waitForFunction(() => /^Heute ist \d{1,2}\.\d{1,2}\.\d{4}$/.test(document.querySelector('#body').value));
    await p5.keyboard.press('Escape');
    await p5.click('#menuBtn');
    await p5.click('#pluginMenu button:has-text("Notizen zählen")');
    await p5.waitForFunction(() => /1 Notizen \(ohne Archiv\)/.test(document.querySelector('#status').textContent));
    await p5.click('#menuBtn');
    await p5.selectOption('#themeSelect', 'sepia');
    await p5.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#f3ead8');
    assert.deepEqual(e5, []);
    await ctx5.close();
    step('Mitgelieferte Beispiele: Datum einfügen und Sepia-Design arbeiten wie beschrieben');

    // Pseudo-Sprache: Texte des Dialogs und der Statusanzeige laufen über das Sprachsystem
    const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
    await ctx3.addInitScript(() => { try { localStorage.setItem('nonotes.lang', 'qps'); } catch (e) { /* egal */ } });
    const { page: p3, errors: e3 } = await openApp(ctx3, buildWithPlugins(tmp, ['test-ok.js', 'test-theme.js', 'test-bad-api.js', 'test-dup.js']));
    await p3.click('#menuBtn');
    await p3.click('#pluginsBtn');
    await p3.waitForSelector('#pluginsDialog[open]');
    const texts = await p3.evaluate(() => [...document.querySelectorAll('#pluginsDialog h2, #pluginsDialog .dialog-lead, #pluginList .plugin-state, #pluginList .plugin-error, #pluginList .plugin-note')].map(e => e.textContent));
    for (const x of texts) assert.ok(x.includes('⟦'), `nicht übersetzbar: ${x}`);
    assert.deepEqual(e3, []);
    await ctx3.close();
    step('Pseudo-Sprache: Dialog, Zustände und Fehlertexte der Erweiterungen laufen über das Sprachsystem');

    console.log('\nErweiterungs-Test bestanden.');
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error('\nErweiterungs-Test FEHLGESCHLAGEN');
  console.error(e);
  process.exit(1);
});
