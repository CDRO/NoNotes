/* Erweiterungs-Test: Erweiterungen und Designs, Hauptfarbe, Videos in der Vorschau, Querverweise, Entscheide und Personen,
   Sprachen (Pseudo-Sprache, Englisch, Testpaket), WebMCP. Ausführen: node test/extend.cjs (nach tools/build.cjs) */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { suite } = require('./lib.cjs');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'NoNotes');
const APP_URL = 'file://' + path.join(DIST, 'index.html');
const initSqlJs = require(path.join(ROOT, 'vendor/sql.js/sql-asm.js'));
const READY = 'body[data-ready="true"]';
const SCHEMA_VERSION = '15'; // muss zu packages/data/db.js passen
const SAVED = () => document.querySelector('#status').dataset.state === 'saved';

// ============================================================
/* Test der Erweiterungs-Schnittstelle (v1.2.0): Liste im Ordner plugins/, Lader, Schnittstelle der Version 1,
   Ereignisse, Designs, Fehlerisolierung; seit v1.7.0 das Verzeichnis aus dem Build und das Ein- und Ausschalten
   zur Laufzeit im Dialog. Der Build wird kopiert und mit Testerweiterungen bestückt. */
async function runPlugins(browser, part, step) {
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
    'test-help.js': `
      NoNotesPlugins.register({ id: 'test-help', name: 'Test Hilfe', api: 1,
        help: { de: '# Titel\\n\\nHilfe **fett** <b>x</b>', en: 'English help' } });`,
    'test-bad-help.js': `NoNotesPlugins.register({ id: 'test-bad-help', name: 'Schlechte Hilfe', api: 1, help: 42 });`,
    'test-bad-api.js': `NoNotesPlugins.register({ id: 'test-bad-api', name: 'Zu neu', api: 99 });`,
    'test-throws.js': `NoNotesPlugins.register({ id: 'test-throws', name: 'Wirft', api: 1, activate() { throw new Error('kaputt beim Start'); } });`,
    'test-dup.js': `NoNotesPlugins.register({ id: 'test-ok', name: 'Doppelt', api: 1 });`,
    'test-bad-theme.js': `NoNotesPlugins.register({ id: 'test-bad-theme', name: 'Schlechtes Design', api: 1, theme: { light: { 'accent': '#ff0000' } } });`,
    'test-noregister.js': `window.__noregister = true;`,
    'test-event-throw.js': `
      NoNotesPlugins.register({ id: 'test-event-throw', name: 'Ereignis wirft', api: 1,
        activate(ctx) { ctx.on('note:open', () => { throw new Error('Ereignis kaputt'); }); } });`,
    'test-syntax-error.js': `this is not javascript (`,
    'test-deactivate.js': `
      NoNotesPlugins.register({ id: 'test-deactivate', name: 'Räumt auf', api: 1,
        activate(ctx) { window.__deact = 0; ctx.ui.addMenuItem({ label: 'Aufräumer', action() {} }); },
        deactivate() { window.__deact = (window.__deact || 0) + 1; } });`,
  };

  /** Kopie des Builds mit den Testerweiterungen; files = feste Liste, catalog = Verzeichnis, wie es der Build schreibt. */
  function buildWithPlugins(tmp, files, catalog) {
    const dir = path.join(tmp, 'NoNotes');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.cpSync(DIST, dir, { recursive: true });
    for (const [name, text] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, 'plugins', name), text);
    const head = catalog ? `NoNotesPlugins.catalog(${JSON.stringify(catalog)});\n` : '';
    fs.writeFileSync(path.join(dir, 'plugins', 'plugins.js'), `${head}NoNotesPlugins.list(${JSON.stringify(files)});\n`);
    return 'file://' + path.join(dir, 'index.html');
  }

  const ALL = ['test-ok.js', 'test-help.js', 'test-bad-help.js', 'test-theme.js', 'test-bad-api.js', 'test-throws.js', 'test-dup.js', 'test-bad-theme.js', 'test-noregister.js', 'test-event-throw.js', 'fehlt.js', 'test-syntax-error.js'];

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
    assert.match(await pa.locator('#pluginList').innerText(), /keine Erweiterung gefunden/);
    assert.equal(await pa.locator('#pluginFile').isVisible(), true, 'eigene Datei lässt sich per Name laden');
    assert.match(await pa.locator('#pluginsDialog').innerText(), /allen Rechten dieser Seite/, 'Warnhinweis steht im Dialog');
    assert.deepEqual(ea, []);
    await ctxA.close();
    part('Ohne Erweiterungen: Menü unverändert, Dialog erklärt den Weg und warnt');

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
    part('Lader: gültige Erweiterungen aktiv, jede fehlerhafte einzeln gemeldet, die App startet trotzdem');

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
    assert.match(dialogText, /Fest eingetragen in plugins\/plugins\.js/);
    assert.equal(await page.locator('#pluginList input[type="checkbox"]').count(), 0, 'feste Einträge haben keinen Schalter');
    await page.keyboard.press('Escape');
    part('Dialog «Erweiterungen»: Name, Version, Zustand, Fehlertexte; feste Einträge ohne Schalter');

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
    for (const k of ['ready', 'database:replaced', 'note:open', 'note:close', 'note:saved', 'mindmap:rendered', 'mindmap:select']) assert.ok(surface.events.includes(k), `Ereignis ${k}`);
    for (const k of ['bg', 'panel', 'text', 'muted', 'border', 'hover', 'danger', 'ok', 'warn', 'radius', 'shadow']) assert.ok(surface.themeVars.includes(k), `Theme-Variable ${k}`);
    assert.equal(surface.api, 1);
    assert.equal(surface.frozen, true, 'die Schnittstelle ist eingefroren');
    assert.equal(surface.backend, true, 'ctx.backend hat alle Methoden des Backend-Vertrags');
    part('Schnittstelle 1: Namen, eingefroren, Backend-Vertrag');

    // Ereignis «ready» kam
    assert.ok((await page.evaluate(() => window.__events)).some(e => e[0] === 'ready'), 'ready');

    // Menüeintrag und Backend
    await newRootNote(page, 'Alpha');
    await page.click('#menuBtn');
    assert.equal(await page.locator('#pluginMenu').isVisible(), true);
    await page.click('#pluginMenu button:has-text("Zähle Notizen")');
    await page.waitForFunction(() => /Es gibt 1 Notizen/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#menu').isVisible(), false, 'Menü schliesst nach dem Klick');
    part('Menüeintrag: Aktion liest über ctx.backend und meldet in der Statuszeile');

    // Hilfefenster: gemeinsames Tab «Erweiterungen» mit einem Abschnitt je Erweiterung mit Hilfetext
    assert.equal(by('test-bad-help.js').status, 'error');
    assert.match(by('test-bad-help.js').error, /help muss/);
    await page.click('#menuBtn');
    await page.click('#menuHelpBtn');
    await page.waitForSelector('#helpDialog[open]');
    const helpTab = page.locator('#helpTabs button[data-tab="plugins"]');
    assert.equal(await helpTab.isVisible(), true, 'Tab Erweiterungen sichtbar');
    await helpTab.click();
    const secs = await page.locator('#helpPlugins .help-plugin').count();
    assert.equal(secs, 1, 'ein Abschnitt (nur test-help hat Hilfe)');
    assert.equal(await page.locator('#helpPlugins .help-plugin h3').innerText(), 'Test Hilfe');
    assert.equal(await page.locator('#helpPlugins .help-plugin h4').innerText(), 'Titel', 'Überschrift rückt unter den Abschnittstitel');
    assert.equal(await page.locator('#helpPlugins strong').innerText(), 'fett');
    assert.equal(await page.locator('#helpPlugins b').count(), 0, 'HTML im Hilfetext wird maskiert');
    await page.keyboard.press('Escape');
    part('Hilfefenster: Tab «Erweiterungen» mit Abschnitt je Erweiterung, Markdown, maskiertes HTML, ungültige help gemeldet');

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
    assert.ok(evs.includes('mindmap:rendered'), 'mindmap:rendered nach dem Zeichnen der Mindmap');
    const sel = await page.evaluate(() => window.__events.filter(e => e[0] === 'mindmap:select').map(e => e[1].id));
    assert.ok(sel.some(id => typeof id === 'number'), 'mindmap:select meldet die gewählte Notiz');
    const edge = await page.evaluate(() => { const e = document.querySelector('path.mm-edge'); return e && { ...e.dataset }; });
    assert.equal(edge.from, 'root', 'Linie: data-from');
    assert.match(edge.to, /^\d+$/, 'Linie: data-to');
    for (const k of ['x1', 'y1', 'x2', 'y2']) assert.ok(Number.isFinite(parseFloat(edge[k])), 'Linie: data-' + k);
    part('Toolleistenknopf: Editor-Schnittstelle liest die Markierung und ersetzt sie; Ereignisse note:open, note:saved');

    // Fehler im Ereignis einer anderen Erweiterung stört nicht
    const entry = await page.evaluate(() => NoNotesPlugins.all().find(p => p.id === 'test-event-throw').error);
    assert.match(entry, /Ereignis kaputt/, 'Fehler im Ereignis wird bei der Erweiterung vermerkt');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__events.some(e => e[0] === 'note:close'));
    part('Fehler im Ereignis einer Erweiterung: andere Erweiterungen und die App laufen weiter');

    // Daten ändern über das Backend, ctx.refresh und openNote
    await page.click('#menuBtn');
    await page.click('#pluginMenu button:has-text("Neue Notiz per Erweiterung")');
    await page.waitForFunction(() => [...document.querySelectorAll('.mm-node text')].some(x => x.textContent === 'Von Erweiterung'));
    await page.waitForSelector('#editorPane:not([hidden])');
    assert.equal(await page.inputValue('#title'), 'Von Erweiterung');
    await page.waitForFunction(SAVED);
    part('ctx.backend ändert Daten, ctx.refresh zeichnet neu, ctx.openNote öffnet; die Änderung wird gespeichert');
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
    part('Design: Auswahl im Menü, Variablen und CSS gelten, Hauptfarbe bleibt oben');

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
    part('Design: aus der Datenbankdatei (meta theme), Zwischenspeicher nachgeführt');

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
    part('Dateiwechsel meldet database:replaced; Programmcode in Notizen wird nie ausgeführt');

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
    part('Fehlt die Erweiterung eines gewählten Designs, gilt Standard');

    // ---------- Zur Laufzeit ein- und ausschalten (v1.7.0): Verzeichnis aus dem Build, Schalter, eigene Datei per Name ----------
    const catalog = [
      { file: 'test-ok.js', id: 'test-ok', name: 'Test OK', version: '2.0.0', api: 1, description: 'Prüft die Schnittstelle' },
      { file: 'test-theme.js', id: 'test-theme', name: 'Test Theme', api: 1, theme: true },
      { file: 'test-bad-api.js', id: 'test-bad-api', name: 'Zu neu', api: 99 },
      { file: 'test-deactivate.js', id: 'test-deactivate', name: 'Räumt auf', api: 1 },
      { file: '../js/app.js', id: 'boese', name: 'Böse', api: 1 }, // ein Name ausserhalb von plugins/ kommt nicht ins Verzeichnis
    ];
    const url6 = buildWithPlugins(tmp, ['test-event-throw.js'], catalog);
    const ctx6 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
    const { page: p6, errors: e6 } = await openApp(ctx6, url6);
    assert.deepEqual(await p6.evaluate(() => NoNotesPlugins.all().map(p => p.file + ':' + p.status)), ['test-event-throw.js:active'], 'nur die feste Liste ist geladen');
    assert.deepEqual(await p6.evaluate(() => NoNotesPlugins.available().map(a => a.file)), ['test-ok.js', 'test-theme.js', 'test-bad-api.js', 'test-deactivate.js']);
    await p6.click('#menuBtn');
    assert.equal(await p6.locator('#themeRow').isVisible(), false, 'Design der ausgeschalteten Erweiterung noch nicht da');
    await p6.click('#pluginsBtn');
    await p6.waitForSelector('#pluginsDialog[open]');
    const groups = () => p6.evaluate(() => [...document.querySelectorAll('#pluginList .plugin-group')].map(g => g.textContent));
    assert.deepEqual(await groups(), ['Eingeschaltet', 'Verfügbar im Ordner plugins/']);
    const text6 = await p6.locator('#pluginList').innerText();
    assert.match(text6, /Test OK[\s\S]*Prüft die Schnittstelle/, 'Angaben aus dem Verzeichnis, ohne die Datei zu laden');
    assert.match(text6, /Test Theme[\s\S]*Bringt ein Design mit/);
    assert.match(text6, /Zu neu[\s\S]*braucht die Schnittstelle 99, diese App bietet 1/);
    assert.equal(await p6.locator('#pluginList input[data-file="test-bad-api.js"]').isDisabled(), true, 'zu neue Erweiterung hat keinen wirksamen Schalter');
    assert.equal(await p6.locator('#pluginList input[data-file="test-event-throw.js"]').count(), 0, 'fester Eintrag ohne Schalter');
    assert.equal(await p6.evaluate(() => window.__ctx), undefined, 'eine Datei aus dem Verzeichnis läuft nicht, bevor sie eingeschaltet ist');
    part('Verzeichnis: Dialog schlägt vor, was im Ordner plugins/ liegt, mit Name, Beschreibung und Design, ohne etwas zu laden');

    await p6.check('#pluginList input[data-file="test-ok.js"]');
    await p6.waitForFunction(() => NoNotesPlugins.all().some(p => p.id === 'test-ok' && p.status === 'active'));
    await p6.waitForFunction(() => /Test OK» eingeschaltet/.test(document.querySelector('#status').textContent));
    assert.equal(await p6.evaluate(() => localStorage.getItem('nonotes.plugins')), JSON.stringify(['test-ok.js']), 'die Wahl merkt sich der Browser');
    assert.match(await p6.locator('#pluginList').innerText(), /Eingeschaltet[\s\S]*Test OK[\s\S]*2\.0\.0[\s\S]*aktiv/i); // Gruppentitel stehen per CSS in Grossbuchstaben
    await p6.check('#pluginList input[data-file="test-theme.js"]');
    await p6.waitForFunction(() => NoNotesPlugins.all().some(p => p.id === 'test-theme' && p.status === 'active'));
    await p6.keyboard.press('Escape');
    await p6.click('#menuBtn');
    assert.equal(await p6.locator('#themeRow').isVisible(), true, 'Designauswahl erscheint ohne Neuladen');
    assert.equal(await p6.locator('#pluginMenu button:has-text("Zähle Notizen")').count(), 1, 'Menüeintrag ohne Neuladen');
    await p6.selectOption('#themeSelect', 'test-theme');
    await p6.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#112233');
    await p6.waitForFunction(SAVED);
    await p6.keyboard.press('Escape');
    await newRootNote(p6, 'Alpha');
    await p6.dblclick('.mm-node:not(.mm-root)');
    await p6.waitForSelector('#editorPane:not([hidden])');
    assert.equal(await p6.locator('#mdToolbar button[data-plugin="test-ok"]').count(), 1, 'Toolleistenknopf ohne Neuladen');
    await p6.waitForFunction(() => window.__events.some(e => e[0] === 'note:open'));
    await p6.keyboard.press('Escape');
    part('Einschalten: lädt und aktiviert sofort; Menü, Toolleiste, Ereignisse und Design sind da, ohne die Seite neu zu laden');

    await p6.click('#menuBtn');
    await p6.click('#pluginsBtn');
    await p6.waitForSelector('#pluginsDialog[open]');
    await p6.uncheck('#pluginList input[data-file="test-theme.js"]');
    await p6.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#f4f5f7');
    assert.equal(await p6.evaluate(() => localStorage.getItem('nonotes.theme')), null, 'Zwischenspeicher des Designs geleert');
    assert.match(await p6.locator('#pluginList').innerText(), /Verfügbar im Ordner plugins\/[\s\S]*Test Theme[\s\S]*aus/i);
    await p6.check('#pluginList input[data-file="test-theme.js"]');
    await p6.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#112233');
    part('Design ausschalten: Standard gilt; wieder einschalten: die Datei hatte die Angabe behalten, das Design kommt zurück');

    await p6.evaluate(() => { window.__events.length = 0; });
    await p6.uncheck('#pluginList input[data-file="test-ok.js"]');
    await p6.waitForFunction(() => NoNotesPlugins.all().some(p => p.id === 'test-ok' && p.status === 'off'));
    assert.match(await p6.locator('#pluginList').innerText(), /Test OK[\s\S]*verschwindet beim nächsten Laden der Seite/, 'ohne deactivate: Hinweis auf das Neuladen');
    assert.deepEqual(JSON.parse(await p6.evaluate(() => localStorage.getItem('nonotes.plugins'))), ['test-theme.js']);
    await p6.keyboard.press('Escape');
    await p6.dblclick('.mm-node:not(.mm-root)');
    await p6.waitForSelector('#editorPane:not([hidden])');
    assert.equal(await p6.locator('#mdToolbar button[data-plugin="test-ok"]').count(), 0, 'Toolleistenknopf weg');
    await p6.keyboard.press('Escape');
    await p6.waitForTimeout(200);
    assert.deepEqual(await p6.evaluate(() => window.__events), [], 'Ereignisse erreichen die ausgeschaltete Erweiterung nicht mehr');
    await p6.click('#menuBtn');
    assert.equal(await p6.locator('#pluginMenu button:has-text("Zähle Notizen")').count(), 0, 'Menüeintrag weg');
    assert.equal(await p6.locator('#pluginMenu').isVisible(), false, 'Abschnitt im Menü ohne Einträge verschwindet');
    await p6.click('#pluginsBtn');
    await p6.waitForSelector('#pluginsDialog[open]');
    await p6.check('#pluginList input[data-file="test-deactivate.js"]');
    await p6.waitForFunction(() => NoNotesPlugins.all().some(p => p.id === 'test-deactivate' && p.status === 'active'));
    await p6.uncheck('#pluginList input[data-file="test-deactivate.js"]');
    await p6.waitForFunction(() => window.__deact === 1);
    assert.doesNotMatch(await p6.locator('#pluginList .plugin-item', { hasText: 'Räumt auf' }).innerText(), /verschwindet beim nächsten Laden/, 'mit deactivate: kein Hinweis auf das Neuladen');
    part('Ausschalten: Menü, Toolleiste, Ereignisse und Design werden genommen; deactivate() wird gerufen, sonst Hinweis auf das Neuladen');

    // Eigene Datei per Name; unzulässige Namen bleiben im Ordner plugins/
    await p6.fill('#pluginFile', 'test-noregister.js');
    await p6.keyboard.press('Enter');
    await p6.waitForFunction(() => NoNotesPlugins.all().some(p => p.file === 'test-noregister.js' && p.status === 'error'));
    assert.match(await p6.locator('#pluginList').innerText(), /test-noregister\.js[\s\S]*register\(\)/);
    await p6.fill('#pluginFile', '../js/app.js');
    await p6.click('#pluginLoadBtn');
    await p6.waitForFunction(() => /Ungültiger Dateiname/.test(document.querySelector('#status').textContent));
    await p6.fill('#pluginFile', 'plugins/test-ok.js');
    await p6.click('#pluginLoadBtn');
    await p6.waitForFunction(() => NoNotesPlugins.all().some(p => p.id === 'test-ok' && p.status === 'active'));
    assert.equal(await p6.evaluate(() => [...document.querySelectorAll('#pluginMenu button')].some(b => b.textContent === 'Zähle Notizen')), true, 'wieder eingeschaltet: activate lief noch einmal');
    assert.deepEqual(JSON.parse(await p6.evaluate(() => localStorage.getItem('nonotes.plugins'))), ['test-theme.js', 'test-ok.js'], 'nur, was sich gültig gemeldet hat, wird gemerkt');
    await p6.click('#pluginList input[data-file="test-noregister.js"]'); // click statt uncheck: der Eintrag verschwindet mit dem Schalter
    await p6.click('#pluginList input[data-file="../js/app.js"]');
    await p6.waitForFunction(() => !NoNotesPlugins.all().some(p => p.file === 'test-noregister.js' || p.file === '../js/app.js'));
    part('Weitere Datei per Name: gültige Datei läuft, fehlerhafte wird gemeldet, ein Name ausserhalb von plugins/ wird abgelehnt');

    // Neuladen: die Wahl bleibt, das Design kommt aus der Datei
    await p6.reload();
    await p6.waitForSelector(READY);
    assert.deepEqual(await p6.evaluate(() => NoNotesPlugins.all().map(p => p.file + ':' + p.status)), ['test-event-throw.js:active', 'test-theme.js:active', 'test-ok.js:active']);
    assert.equal(await cssVar(p6, '--bg'), '#112233');
    assert.deepEqual(e6, [], 'keine Fehler im Browser');
    await ctx6.close();
    part('Nach dem Neuladen: feste Liste zuerst, dann die gemerkten Erweiterungen; das Design gilt');

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
    part('Mitgelieferte Beispiele: Datum einfügen und Sepia-Design arbeiten wie beschrieben');

    // Pseudo-Sprache: Texte des Dialogs und der Statusanzeige laufen über das Sprachsystem
    const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
    await ctx3.addInitScript(() => { try { localStorage.setItem('nonotes.lang', 'qps'); } catch (e) { /* egal */ } });
    const { page: p3, errors: e3 } = await openApp(ctx3, buildWithPlugins(tmp, ['test-ok.js', 'test-theme.js', 'test-bad-api.js', 'test-dup.js']));
    await p3.click('#menuBtn');
    await p3.click('#pluginsBtn');
    await p3.waitForSelector('#pluginsDialog[open]');
    const texts = await p3.evaluate(() => [...document.querySelectorAll('#pluginsDialog h2, #pluginsDialog .dialog-lead, #pluginList .plugin-group, #pluginList .plugin-state, #pluginList .plugin-error, #pluginList .plugin-note, #pluginList .plugin-switch span, .plugin-load label, #pluginLoadBtn')].map(e => e.textContent));
    for (const x of texts) assert.ok(x.includes('⟦'), `nicht übersetzbar: ${x}`);
    assert.deepEqual(e3, []);
    await ctx3.close();
    part('Pseudo-Sprache: Dialog, Zustände und Fehlertexte der Erweiterungen laufen über das Sprachsystem');

  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ============================================================
/* Test der Hauptfarbe (v1.1.0): Palette, Auswahl im Menü, Speichern in der Datenbankdatei und im Browser,
   helle und dunkle Fassung, Mindmap-Bild in Export und Druck. */
async function runPalette(browser, part, step) {
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
    part('Palette: acht Farben, Schrift lesbar in hell und dunkel, Blau wie im Stylesheet');

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
    part('Hauptfarbe: Auswahl im Menü wirkt sofort und wird gemerkt');

    // Massgebend ist die Datenbank: Zwischenspeicher weg, Farbe bleibt
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.removeItem('nonotes.accent'));
    await page.reload();
    await page.waitForSelector(READY);
    assert.equal(await cssVar(page, '--accent'), '#15803d', 'Farbe kommt aus der Datenbank');
    assert.equal(await page.evaluate(() => localStorage.getItem('nonotes.accent')), 'green', 'Zwischenspeicher wird nachgeführt');
    part('Hauptfarbe: nach dem Neuladen aus der Datenbank, Zwischenspeicher nachgeführt');

    // Datei: meta accent
    await page.click('#menuBtn');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')]);
    const dlPath = path.join(tmp, 'gruen.sqlite');
    await dl.saveAs(dlPath);
    const db = new SQL.Database(new Uint8Array(fs.readFileSync(dlPath)));
    assert.equal(db.exec("SELECT value FROM meta WHERE key='accent'")[0].values[0][0], 'green');
    db.close();
    part('Hauptfarbe: in der Datenbankdatei gespeichert (meta accent)');

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
    part('Hauptfarbe: Mindmap-Bild in Export und Druck');

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
    part('Hauptfarbe: gehört zur Datei, eine Datei ohne Angabe zeigt Blau');

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
    part('Hauptfarbe: helle und dunkle Fassung mit passender Schriftfarbe');

    assert.deepEqual(errors, []);
    assert.deepEqual(errors2, []);
    assert.deepEqual(errors3, []);
    await ctx.close();
    await ctx2.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ============================================================
/* Test der Videos (v1.6.0), Teil 2, im Browser: Die Vorschau zeigt Karten und löst keine Anfrage an die Anbieter aus; erst der Klick baut den
   Rahmen (abgeschottet, mit Herkunft, ohne Pfad); der Rahmen bleibt beim Neuzeichnen der Vorschau; YouTube in einer geöffneten Datei bietet nur
   den Link; ausgeschaltet gibt es nur Links; im Lesemodus geht es wie sonst; Druck und Export enthalten keinen Rahmen.
   Die Anbieter werden durch Platzhalterseiten ersetzt (kein Netz nötig). */
async function runEmbedsUi(browser, part, step) {
  const PLUGIN = `NoNotesPlugins.register({ id: 'zugriff', name: 'Zugriff', api: 1, activate(ctx) { window.__ctx = ctx; } });`;
  const BODY = 'Anleitung\nhttps://youtu.be/dQw4w9WgXcQ\n\n![Der Clip](https://vimeo.com/76979871)\n\nhttps://www.dailymotion.com/video/x8abc12\n\nEin ![x](https://vimeo.com/76979871) im Satz\n\n![Ein Bild](https://beispiel.example/bild.png)';

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-embeds-'));
  const dir = path.join(tmp, 'NoNotes');
  fs.cpSync(DIST, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'zugriff.js'), PLUGIN);
  fs.writeFileSync(path.join(dir, 'plugins', 'plugins.js'), "NoNotesPlugins.list(['zugriff.js']);\n");
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());

  // Alles, was an die Anbieter geht, aufzeichnen und durch eine Platzhalterseite ersetzen
  const requests = [];
  const HOSTS = /^https:\/\/(www\.youtube(-nocookie)?\.com|youtu\.be|player\.vimeo\.com|vimeo\.com|www\.dailymotion\.com|geo\.dailymotion\.com)\//;
  await page.route(HOSTS, route => { requests.push(route.request().url()); route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Anbieter</title><p>Platzhalter</p>' }); });
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://beispiel.example/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG })); // ein gewöhnliches Bild: nicht Sache dieses Tests
  // Mit Merkzeichen meldet die Hülle embeds = 'off' beziehungsweise readOnly
  await page.addInitScript(() => {
    let edition;
    Object.defineProperty(window, 'NoNotesEdition', {
      configurable: true,
      get: () => edition,
      set: v => {
        edition = v;
        const make = v.createShell;
        v.createShell = host => {
          const shell = make(host);
          if (localStorage.getItem('__embeds_off') === '1') Object.defineProperty(shell, 'embeds', { get: () => 'off' });
          if (localStorage.getItem('__readonly') === '1') Object.defineProperty(shell, 'readOnly', { get: () => true });
          return shell;
        };
      },
    });
  });
  await page.goto('file://' + path.join(dir, 'index.html'));
  await page.waitForSelector(READY, { timeout: 30000 });

  const id = await page.evaluate(async body => {
    const B = __ctx.backend;
    const id = await B.createNote(null);
    await B.updateNote(id, 'Videos', body, {});
    await __ctx.refresh();
    return id;
  }, BODY);
  await page.waitForFunction(SAVED, null, { timeout: 10000 });
  const openPreview = async () => {
    await page.evaluate(i => __ctx.openNote(i), id);
    await page.waitForSelector('#editorPane:not([hidden])');
    await page.click('[data-mode="preview"]');
    await page.waitForSelector('#preview .md-embed');
  };
  await page.evaluate(() => localStorage.setItem('nonotes.lang', 'de'));
  await openPreview();

  // ---------- Karten, keine Anfrage ----------
  assert.equal(await page.locator('#preview .md-embed').count(), 3, 'drei Karten');
  assert.equal(await page.locator('#preview iframe').count(), 0, 'noch kein Rahmen');
  assert.equal(await page.locator('#preview .md-video-link').count(), 1, 'mitten im Satz bleibt es ein Link');
  assert.match(await page.locator('#preview .md-embed').nth(1).innerText(), /Der Clip/);
  await page.waitForTimeout(500);
  assert.deepEqual(requests, [], 'beim Öffnen der Notiz geht nichts an die Anbieter: ' + requests.join(', '));
  part('Vorschau: drei Karten, ein Link im Satz, noch kein Rahmen und keine einzige Anfrage an die Anbieter');

  // YouTube in einer geöffneten Datei: nur der Link
  const yt = page.locator('#preview .md-embed[data-provider="youtube"]');
  assert.equal(await yt.locator('.md-embed-load').count(), 0, 'kein Ladeknopf');
  assert.match(await yt.innerText(), /YouTube das Einbetten nicht zu/);
  assert.equal(await yt.locator('.md-embed-open').getAttribute('href'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  part('YouTube in der geöffneten Datei (file://): nur der Link mit Erklärung');

  // ---------- Klick: Rahmen ----------
  const vimeo = page.locator('#preview .md-embed[data-provider="vimeo"]');
  await vimeo.locator('.md-embed-load').click();
  const frame = vimeo.locator('iframe');
  await frame.waitFor();
  assert.equal(await frame.getAttribute('src'), 'https://player.vimeo.com/video/76979871?dnt=1&autoplay=1');
  assert.equal(await frame.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
  assert.equal(await frame.getAttribute('loading'), 'lazy');
  const sandbox = await frame.getAttribute('sandbox');
  assert.ok(/allow-scripts/.test(sandbox) && /allow-same-origin/.test(sandbox) && !/allow-top-navigation/.test(sandbox) && !/allow-modals/.test(sandbox), sandbox);
  assert.match(await frame.getAttribute('allow'), /fullscreen/);
  assert.equal(await frame.getAttribute('title'), 'Der Clip');
  await page.waitForTimeout(300);
  assert.ok(requests.some(u => u.startsWith('https://player.vimeo.com/video/76979871')), 'nach dem Klick geht die Anfrage an Vimeo: ' + requests.join(', '));
  assert.ok(!requests.some(u => /dailymotion|youtube|youtu\.be/.test(u)), 'nur an den Anbieter des angeklickten Videos');
  part('Klick: Rahmen mit Quelle, Herkunft ohne Pfad, abgeschottet (ohne Wechsel der Seite und ohne Dialoge); Anfrage erst jetzt und nur an Vimeo');

  // ---------- Neuzeichnen behält das geladene Video ----------
  await page.click('[data-mode="split"]');
  await page.waitForSelector('#preview .md-embed');
  await page.waitForSelector('#preview .md-embed[data-provider="vimeo"] iframe');
  assert.equal(await page.locator('#preview .md-embed[data-provider="dailymotion"] iframe').count(), 0, 'andere Karten bleiben Karten');
  part('Neuzeichnen der Vorschau (Ansicht gewechselt): das geladene Video wird wieder eingesetzt, die anderen bleiben Karten');

  // Dailymotion laden
  await page.locator('#preview .md-embed[data-provider="dailymotion"] .md-embed-load').click();
  await page.waitForSelector('#preview .md-embed[data-provider="dailymotion"] iframe');
  assert.equal(await page.locator('#preview .md-embed[data-provider="dailymotion"] iframe').getAttribute('src'), 'https://www.dailymotion.com/embed/video/x8abc12?autoplay=1');
  part('Dailymotion: Rahmen mit der Adresse zum Einbetten');

  // ---------- Druck und Export ----------
  const printHtml = await page.evaluate(i => __ctx.backend.getNote(i).then(n => NoNotesMarkdown.render(n.body, { resolveTitle: () => null })), id);
  assert.ok(!/md-embed|<iframe|<img/.test(printHtml.replace(/<img src="https:\/\/beispiel\.example\/bild\.png"[^>]*>/, '')), 'Druck: Links statt Karten und Rahmen');
  assert.equal(await page.locator('#printArea iframe').count(), 0);
  part('Druck und Listen: ohne die Option gibt es Links, keine Karten, keine Rahmen');

  // ---------- Ausschalten ----------
  await page.evaluate(() => localStorage.setItem('__embeds_off', '1'));
  await page.waitForFunction(SAVED, null, { timeout: 10000 });
  await page.reload();
  await page.waitForSelector(READY, { timeout: 30000 });
  requests.length = 0;
  await page.evaluate(i => __ctx.openNote(i), id);
  await page.waitForSelector('#editorPane:not([hidden])');
  await page.click('[data-mode="preview"]');
  await page.waitForSelector('#preview .md-video-link');
  assert.equal(await page.locator('#preview .md-embed').count(), 0, 'ausgeschaltet: keine Karte');
  assert.equal(await page.locator('#preview .md-video-link').count(), 2, 'die beiden Bild-Schreibweisen werden zu Links, nackte Adressen bleiben normale Links');
  assert.deepEqual(requests, []);
  part('Ausgeschaltet (Hülle meldet embeds = off): nur Links, keine Anfrage');
  await page.evaluate(() => localStorage.removeItem('__embeds_off'));

  // ---------- Lesemodus ----------
  await page.evaluate(() => localStorage.setItem('__readonly', '1'));
  await page.waitForFunction(SAVED, null, { timeout: 10000 });
  await page.reload();
  await page.waitForSelector(READY, { timeout: 30000 });
  await page.evaluate(i => __ctx.openNote(i), id);
  await page.waitForSelector('#editorPane:not([hidden])');
  await page.click('[data-mode="preview"]');
  await page.waitForSelector('#preview .md-embed');
  await page.locator('#preview .md-embed[data-provider="vimeo"] .md-embed-load').click();
  await page.waitForSelector('#preview .md-embed[data-provider="vimeo"] iframe');
  part('Lesemodus: Videos lassen sich wie sonst laden (Lesen ist erlaubt)');
  await page.evaluate(() => localStorage.removeItem('__readonly'));

  assert.deepEqual(errors, [], 'Fehler im Browser:\n' + errors.join('\n'));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ============================================================
/* Test der Querverweise (v1.8.0) im Browser: [[Titel*]] zieht in der Mindmap eine gestrichelte Linie zur Notiz mit diesem Titel,
   [[Titel]] ohne Stern nicht. Der Schalter «Verweise» in der Mindmap-Leiste erscheint nur, wenn es welche gibt; die Wahl merkt sich der
   Browser. Eingeklappte Ziele bekommen keine Linie, bei der Suche werden Linien ohne Treffer blass. Die Vorschau zeigt den Verweis ohne
   Stern und öffnet die Notiz; Export und Druck zeichnen die Linien, der Markdown-Export macht Links daraus. */
async function runLinks(browser, part, step) {
  const PLUGIN = `NoNotesPlugins.register({ id: 'zugriff', name: 'Zugriff', api: 1, activate(ctx) { window.__ctx = ctx; } });`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-links-'));
  const dir = path.join(tmp, 'NoNotes');
  fs.cpSync(DIST, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'zugriff.js'), PLUGIN);
  fs.writeFileSync(path.join(dir, 'plugins', 'plugins.js'), "NoNotesPlugins.list(['zugriff.js']);\n");
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
  part('[[Titel*]] zeichnet eine gestrichelte Linie mit Pfeil; ohne Stern, auf sich selbst oder ohne Ziel keine');

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
  part('Schalter «Verweise» in der Mindmap-Leiste: nur mit Linien sichtbar, blendet sie aus und ein, die Wahl bleibt nach dem Neuladen');

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
  part('Eingeklappte Ziele bekommen keine Linie; bei der Suche werden Linien ohne Treffer blass');

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
  part('Vorschau: [[Titel*]] zeigt den Titel ohne Stern, markiert als Querverweis, und öffnet die Notiz');

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
  part('Ohne Stern ist die Linie weg, der Schalter zählt nach');

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
  part('Export: Mindmap-Bild mit Linie, Markdown mit Link; Druck mit Linie');

  // Gelöschtes Ziel: keine Linie mehr, Schalter verschwindet, wenn keine übrig ist
  await page.evaluate(async id => { await __ctx.backend.deleteNote(id); await __ctx.refresh(); }, ids.gamma);
  await page.waitForFunction(() => document.querySelectorAll('#mindmap path.mm-link').length === 0);
  assert.equal(await btn.isVisible(), false, 'ohne Linien kein Schalter');
  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  part('Gelöschtes Ziel: keine Linie, kein Schalter');

  await ctx.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ============================================================
/* Test der Entscheide (v1.11.0) im Browser: "?!" beginnt einen Entscheid, "!!" darunter trifft ihn (die erste Zeile mit Datum),
   "@kürzel" nennt die Personen. Der Reiter «Entscheide» erscheint nur, wenn es welche gibt; die Ansicht teilt sich Leiste und Liste
   mit den Fragen; «Entscheiden» schreibt "!! Datum: Text" in die Notiz. Vorschau mit Karte und Personen-Marken, Toolleiste und
   Tastenkürzel, Vorschläge beim Tippen von "@" (auch aus einer Erweiterung), Filter nach Person, Marke in der Mindmap,
   Ereignis «questions:rendered» (auch als DOM-Ereignis), Export und Druck. */
async function runDecisions(browser, part, step) {
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

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-decisions-'));
  const dir = path.join(tmp, 'NoNotes');
  fs.cpSync(DIST, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins', 'zugriff.js'), PLUGIN);
  fs.writeFileSync(path.join(dir, 'plugins', 'plugins.js'), "NoNotesPlugins.list(['zugriff.js']);\n");
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
  part('Reiter «Entscheide» erscheint mit den offenen Entscheiden; die Marke am Knoten zählt sie mit');

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
  part('Ansicht «Entscheide»: eigene Beschriftung, Personen-Marken, Filter nach Person, Ereignis für Erweiterungen');

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
  part('«Entscheiden» schreibt den Entscheid mit dem heutigen Datum unter die Zeile');

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
  part('Vorschau mit Karte und Datum, Statusleiste zählt beide Arten, Toolleiste und Ctrl+Shift+D schalten "?!" um');

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
  // Ein halb getipptes Kürzel, das schon gespeichert ist, schlägt sich nicht selbst vor
  await page.keyboard.type(' @ma');
  await page.waitForFunction(() => document.querySelector('#status').dataset.state !== 'saved');
  await page.waitForFunction(SAVED);
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await page.waitForSelector('#mentionPopup:not([hidden])');
  await page.waitForTimeout(150);
  assert.deepEqual(await page.locator('#mentionPopup .mention-handle').allTextContents(), ['@max1234'], 'das eben getippte «@ma» steht nicht in der Liste');
  await page.keyboard.press('Escape');
  await page.waitForFunction(SAVED);
  part('Tippen von "@" schlägt Kürzel vor: Pfeile, Enter, Tab, Esc; Erweiterungen liefern über ctx.people.provide');

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
  part('Markdown-Export mit Zitatblöcken «Offener Entscheid» und «Entschieden Datum»; Druck der Entscheide');

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
  part('Ohne Entscheide verschwindet der Reiter; "!!" ohne Öffner ist ein Hinweis');

  // Mehrzeilige Entscheide (v2.4.0): Übersicht mit Beschreibung als Zusammenhang, Unterentscheide eingerückt, «Teil von …»
  const described = Array.from({ length: 6 }, (_, i) => `Zeile ${i + 1} der Beschreibung.`);
  const blockNote = await page.evaluate(async lines => {
    const B = __ctx.backend;
    const id = await B.createNote(null);
    await B.updateNote(id, 'Ablage', ['?!``` Ablage auf SharePoint umstellen @anna', ...lines, '?! Wer migriert die Altdaten? @ben', '!! 21.10.2026: Externe Firma',
      '- ?! Brauchen wir Schulungen?', '? Wer schult?', '```', '', '- ?! Neues Tool kaufen?', '  !! 20.10.2026: Ja'].join('\n'), {});
    await __ctx.refresh();
    return id;
  }, described);
  await page.waitForFunction(() => !document.querySelector('#viewDecisionsBtn').hidden);
  await page.click('#viewDecisionsBtn');
  await page.waitForSelector('body.view-decisions');
  await page.click('#qFilter button[data-status="all"]');
  await page.waitForFunction(() => document.querySelectorAll('.q-item.decision').length === 4);
  const order = async () => (await page.locator('.q-item .q-text').allInnerTexts()).map(s => s.split(/\s+/).slice(0, 2).join(' '));
  const subs = () => page.locator('.q-item').evaluateAll(els => els.map(e => e.classList.contains('sub')));
  // Nach Termin (Vorgabe): ein entschiedener Unterentscheid steht bei «Entschieden», mit seinem Block als Zusammenhang
  assert.deepEqual(await order(), ['Ablage auf', 'Brauchen wir', 'Wer migriert', 'Neues Tool']);
  assert.deepEqual(await subs(), [false, true, false, false]);
  assert.equal(await page.locator('.q-item', { hasText: 'Wer migriert' }).locator('.q-within').innerText(), 'Teil von «Ablage auf SharePoint umstellen @anna»');
  await page.selectOption('#qSort', 'note');
  await page.waitForFunction(() => document.querySelectorAll('.q-item.sub').length === 2);
  assert.deepEqual(await order(), ['Ablage auf', 'Wer migriert', 'Brauchen wir', 'Neues Tool']);
  assert.deepEqual(await subs(), [false, true, true, false], 'nach Notiz: Unterentscheide direkt unter dem Block, eingerückt');
  assert.equal(await page.locator('.q-item .q-within').count(), 0);
  const head = page.locator('.q-item').first();
  assert.equal(await head.locator('.md-q-subs').first().innerText(), '1 von 2 Unterentscheiden offen');
  assert.equal(await head.locator('.md-q-subs').nth(1).innerText(), '1 von 1 Unterfrage offen');
  assert.match(await head.locator('.q-details').innerText(), /^Zeile 1 der Beschreibung\./);
  assert.equal(await head.locator('.q-details.clamped').count(), 1, 'lange Beschreibung zuerst gekürzt');
  const clampedHeight = await head.locator('.q-details').evaluate(e => e.getBoundingClientRect().height);
  await head.locator('.q-more').click();
  assert.equal(await head.locator('.q-more').innerText(), 'Weniger anzeigen');
  assert.equal(await head.locator('.q-more').getAttribute('aria-expanded'), 'true');
  assert.ok(await head.locator('.q-details').evaluate(e => e.getBoundingClientRect().height) > clampedHeight * 1.5, 'aufgeklappt ganz zu sehen');
  await head.locator('.q-more').click();
  assert.equal(await head.locator('.q-details.clamped').count(), 1);
  await page.click('#qFilter button[data-status="open"]');
  await page.waitForFunction(() => document.querySelectorAll('.q-item.decision').length === 2);
  assert.deepEqual(await page.locator('.q-item').evaluateAll(els => els.map(e => e.classList.contains('sub'))), [false, true], 'offener Block mit offenem Unterentscheid');
  // Unterentscheid entscheiden: die Antwort steht im Block, unter dem Listenpunkt eingerückt
  const sub = page.locator('.q-item.sub', { hasText: 'Brauchen wir' });
  await sub.locator('button:has-text("Entscheiden")').click();
  await sub.locator('.q-form textarea').fill('Nein');
  await sub.locator('.q-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.q-item.decision').length === 1);
  await page.waitForFunction(SAVED);
  const blockBody = await page.evaluate(id => __ctx.backend.getNote(id).then(n => n.body.split('\n')), blockNote);
  assert.deepEqual(blockBody.slice(9, 12), ['- ?! Brauchen wir Schulungen?', `  !! ${todayText()}: Nein`, '? Wer schult?']);
  assert.equal(await page.locator('.q-item .md-q-subs').first().innerText(), 'Alle 2 Unterentscheide getroffen');
  // Im Reiter «Fragen» steht die Unterfrage für sich, mit ihrem Block als Zusammenhang
  await page.click('#viewQuestionsBtn');
  await page.waitForSelector('body.view-questions');
  await page.waitForFunction(() => document.querySelectorAll('.q-item').length === 1);
  assert.equal(await page.locator('.q-item .q-within').innerText(), 'Teil von «Ablage auf SharePoint umstellen @anna»');
  part('Übersicht: Beschreibung als gekürzter Zusammenhang mit «Mehr anzeigen», Unterentscheide eingerückt mit Hinweis am Block, im Block entscheiden, «Teil von» bei Fragen');

  // Vorschau, Toolleiste und Druck
  await page.locator('.q-item button:has-text("Zur Notiz")').click();
  await page.waitForSelector('body.editor-open');
  await page.click('#modeSwitch [data-mode="split"]');
  await page.waitForFunction(() => document.querySelectorAll('#preview .md-q-block').length === 1);
  assert.equal(await page.locator('#preview .md-q-block .md-q-details .md-q').count(), 3, 'Unter-Einträge im Kasten');
  assert.equal(await page.locator('#preview .md-q-block > .md-q-body > .md-q-text').innerText(), 'Ablage auf SharePoint umstellen @anna\nAlle 2 Unterentscheide getroffen\n1 von 1 Unterfrage offen'.replace(/\n/g, ''));
  assert.equal(await page.locator('#preview li.q-li .md-q.answered').count(), 2, 'Entscheide als Listenpunkte');
  await page.evaluate(() => {
    const b = document.querySelector('#body');
    b.value += '\n\nNeuer Titel\nErste Zeile';
    b.dispatchEvent(new Event('input', { bubbles: true }));
    b.focus();
    b.setSelectionRange(b.value.length - 'Neuer Titel\nErste Zeile'.length, b.value.length);
  });
  await page.click('#decisionBtn');
  await page.waitForFunction(() => document.querySelector('#body').value.endsWith('\n?!``` Neuer Titel\nErste Zeile\n```'));
  await page.waitForFunction(() => document.querySelectorAll('#preview .md-q-block').length === 2);
  await page.waitForFunction(SAVED);
  const printed = await page.evaluate(() => NoNotesPrint.buildQuestionsDocument(__ctx.backend, { kind: 'decision', status: 'all' }));
  assert.ok(printed.includes('class="print-details md"') && printed.includes('Zeile 6 der Beschreibung.'), 'Druck mit ganzer Beschreibung');
  assert.equal((printed.match(/class="print-q decision sub /g) || []).length, 2, 'Unterentscheide eingerückt gedruckt');
  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  part('Vorschau: Block als ein Kasten mit Unter-Einträgen, Listenpunkte; mehrere markierte Zeilen und «?!» ergeben einen Block; Druck mit Beschreibung');

  await ctx.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ============================================================
// ============================================================
/* Vorlagen in der lokalen Ausprägung (v2.5.0): Ordner templates/ verbinden (nachgebaut im Speicher), als Vorlage speichern (Ordner,
   sonst Download und Browser), neue Notiz und Unternotiz aus Vorlage, Vorlage einfügen, Erlaubnis nach einem Neustart, Datei
   hinzufügen, entfernen. */
async function runTemplatesUi(browser, part, step) {
  const examples = {};
  for (const f of fs.readdirSync(path.join(DIST, 'templates'))) examples[f] = fs.readFileSync(path.join(DIST, 'templates', f), 'utf8');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH', acceptDownloads: true });
  await ctx.addInitScript(files => {
    // Ein Ordner im Speicher: Dateinamen → Text; die Erlaubnis lässt sich auf 'prompt' setzen (wie nach einem Neustart des Browsers)
    const store = new Map(Object.entries(files));
    window.__tplFiles = store;
    window.__dirPerm = 'granted';
    window.__dirAsked = 0;
    const fileHandle = name => ({
      kind: 'file', name,
      getFile: async () => new File([store.get(name)], name),
      createWritable: async () => {
        let text = '';
        return { write: async d => { text += typeof d === 'string' ? d : new TextDecoder().decode(d); }, close: async () => { store.set(name, text); }, abort: async () => {} };
      },
      queryPermission: async () => window.__dirPerm, requestPermission: async () => window.__dirPerm,
    });
    window.__dir = {
      kind: 'directory', name: 'templates',
      queryPermission: async () => window.__dirPerm,
      requestPermission: async () => { window.__dirAsked++; window.__dirPerm = 'granted'; return 'granted'; },
      entries: async function* () { for (const name of [...store.keys()]) yield [name, fileHandle(name)]; },
      getFileHandle: async (name, o) => {
        if (!store.has(name)) { if (!o || !o.create) throw new DOMException('fehlt', 'NotFoundError'); store.set(name, ''); }
        return fileHandle(name);
      },
      removeEntry: async name => { store.delete(name); },
    };
    window.showDirectoryPicker = async () => window.__dir;
    // Handles lassen sich im Test nicht in IndexedDB ablegen (Funktionen): die Hülle merkt sie sich hier
    const saved = {};
    let ns;
    Object.defineProperty(window, 'NoNotesStorage', {
      configurable: true, get: () => ns,
      set: v => {
        ns = v;
        v.browserStore.saveHandleKey = async (k, h) => { saved[k] = h; };
        v.browserStore.loadHandleKey = async k => saved[k] || null;
        v.browserStore.clearHandleKey = async k => { delete saved[k]; };
      },
    });
  }, examples);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('file://' + path.join(DIST, 'index.html'));
  await page.waitForSelector(READY, { timeout: 30000 });
  const todayText = () => { const d = new Date(); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; };

  // Verwalten: Ordner verbinden, die Beispiele erscheinen (ohne README)
  assert.equal(await page.locator('#mapTemplateBtn').isVisible(), true);
  await page.click('#menuBtn');
  await page.click('#templatesBtn');
  await page.waitForSelector('#templatesDialog[open]');
  await page.waitForFunction(() => /Kein Ordner verbunden/.test(document.querySelector('#templatesFolder').textContent));
  assert.equal(await page.locator('.template-row').count(), 0);
  assert.match(await page.locator('#templatesPlaceholders').innerText(), /\{\{datum\}\} \(\d+\.\d+\.\d{4}\), \{\{datum\+7\}\} \(in sieben Tagen\), \{\{zeit\}\}/);
  await page.locator('#templatesFolder button', { hasText: 'Ordner verbinden' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.template-row').length === 2);
  assert.match(await page.locator('#templatesFolder').innerText(), /Verbunden mit dem Ordner «templates»\./);
  assert.deepEqual(await page.locator('.template-row strong').allInnerTexts(), ['Entscheidungsvorlage', 'Sitzungsprotokoll']);
  assert.match(await page.locator('.template-row').nth(1).innerText(), /3 Notizen · im Ordner/);
  await page.locator('#templatesDialog button[value="close"]').click();
  part('Vorlagen verwalten: Ordner templates/ verbinden, Beispiele aus dem Ordner (ohne README), Platzhalter in der Sprache der Oberfläche');

  // Als Vorlage speichern: aus einer Notiz mit Unternotiz, bereinigt, heutiges Datum als Platzhalter, in den Ordner
  await page.click('#mapNewBtn');
  await page.keyboard.type(`Sitzung ${todayText()}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(SAVED);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Beschlüsse');
  await page.keyboard.press('Enter');
  await page.waitForFunction(SAVED);
  const top = page.locator('#mindmap .mm-node', { hasText: 'Sitzung' }).first();
  await top.dblclick();
  await page.waitForSelector('body.editor-open');
  await page.fill('#body', '- [x] Protokoll genehmigt\n? Budget?\n! 20k');
  await page.waitForFunction(SAVED);
  await page.click('#noteMenuBtn');
  await page.click('#saveTemplateBtn');
  await page.waitForSelector('#templateSaveDialog[open]');
  assert.equal(await page.inputValue('#templateName'), `Sitzung ${todayText()}`);
  assert.equal(await page.locator('#templateChildrenLabel').innerText(), 'Unternotiz mitnehmen (1)');
  assert.match(await page.locator('#templateTodayLabel').innerText(), new RegExp(`Heutiges Datum \\(${todayText().replace(/\./g, '\\.')}\\) durch \\{\\{datum\\}\\} ersetzen`));
  assert.match(await page.locator('#templateSaveWhere').innerText(), /Wird im Ordner «templates» gespeichert/);
  await page.fill('#templateName', 'Meine Sitzung');
  await page.fill('#templateDescription', 'Für den Vorstand');
  await page.click('#templateSaveGoBtn');
  await page.waitForFunction(() => window.__tplFiles.has('Meine Sitzung.md'));
  await page.waitForFunction(() => /Vorlage «Meine Sitzung» im Ordner «templates» gespeichert\./.test(document.querySelector('#status').textContent));
  const saved = await page.evaluate(() => window.__tplFiles.get('Meine Sitzung.md'));
  assert.ok(saved.startsWith('---\nnonotes: 1\nname: "Meine Sitzung"\ndescription: "Für den Vorstand"\ntitle: "Sitzung {{datum}}"\n---\n- [ ] Protokoll genehmigt\n? Budget?\n<!-- nonotes:note {"depth":1,"title":"Beschlüsse","tags":[]} -->'), saved);
  await page.click('#noteMenuBtn');
  await page.click('#saveTemplateBtn');
  await page.fill('#templateName', 'Meine Sitzung');
  await page.click('#templateSaveGoBtn');
  await page.waitForFunction(() => window.__tplFiles.has('Meine Sitzung (2).md'), null, {});
  part('Als Vorlage speichern: Unternotizen, Antworten weg, Aufgaben offen, heutiges Datum als Platzhalter, in den Ordner; gleicher Name wird nummeriert');

  // Neue Unternotiz aus Vorlage (Menü «Notiz»): Auswahl mit Vorschau, Platzhalter ersetzt, Unternotizen der Vorlage
  await page.click('#noteMenuBtn');
  await page.click('#childTemplateBtn');
  await page.waitForSelector('#templatePickDialog[open]');
  await page.waitForFunction(() => document.querySelectorAll('.template-item').length === 4);
  assert.match(await page.locator('#templatePickLead').innerText(), new RegExp(`Die neue Notiz kommt unter «Sitzung ${todayText().replace(/\./g, '\\.')}»\\.`));
  await page.locator('.template-item', { hasText: 'Sitzungsprotokoll' }).click();
  await page.waitForFunction(() => /Sitzung \d/.test(document.querySelector('#templatePickPreview h3').textContent));
  assert.equal(await page.locator('#templatePickPreview .template-sub').innerText(), 'Dazu 2 Unternotizen:');
  assert.deepEqual(await page.locator('#templatePickPreview .template-subs li').allInnerTexts(), ['Entscheide', 'Offene Fragen']);
  await page.click('#templatePickGoBtn');
  await page.waitForFunction(t => document.querySelector('#title').value === `Sitzung ${t}` && document.querySelector('#body').value.includes('## Traktanden'), todayText());
  await page.waitForFunction(SAVED);
  part('Unternotiz aus Vorlage: Auswahl mit Vorschau und Unternotizen, Platzhalter ersetzt, die neue Notiz ist offen');

  // Vorlage einfügen: an der Cursorstelle, Unternotizen unter die offene Notiz
  await page.evaluate(() => { const b = document.querySelector('#body'); b.focus(); b.setSelectionRange(0, 0); });
  await page.click('#noteMenuBtn');
  await page.click('#insertTemplateBtn');
  await page.waitForSelector('#templatePickDialog[open]');
  assert.equal(await page.locator('#templatePickGoBtn').innerText(), 'Einfügen');
  await page.waitForFunction(() => document.querySelectorAll('.template-item').length === 4);
  await page.locator('.template-item', { hasText: 'Entscheidungsvorlage' }).click();
  await page.waitForFunction(() => document.querySelector('#templatePickPreview').textContent.includes('Ausgangslage'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#body').value.startsWith('?!``` Entscheid: … @'));
  await page.waitForFunction(SAVED);
  part('Vorlage einfügen: an der Cursorstelle, Enter wählt, gespeichert');

  // Nach einem Neustart fragt der Browser wieder: der Klick auf «Aus Vorlage…» holt die Erlaubnis
  await page.click('#backBtn');
  await page.evaluate(() => { window.__dirPerm = 'prompt'; });
  await page.click('#viewMapBtn');
  await page.click('#mapTemplateBtn');
  await page.waitForSelector('#templatePickDialog[open]');
  await page.waitForFunction(() => document.querySelectorAll('.template-item').length === 4);
  assert.equal(await page.evaluate(() => window.__dirAsked), 1, 'einmal nach der Erlaubnis gefragt');
  await page.locator('#templatePickDialog button[value="cancel"]').click();
  const nodes = await page.locator('#mindmap .mm-node').allTextContents();
  for (const n of ['Beschlüsse', 'Entscheide', 'Offene Fragen']) assert.ok(nodes.some(x => x.includes(n)), `Knoten ${n}: ${nodes}`);
  part('Erlaubnis nach einem Neustart des Browsers: der Klick, der die Auswahl öffnet, fragt nach');

  // Ohne Ordner: Download und im Browser gemerkt, für alle Bereiche; Datei hinzufügen; entfernen
  await page.click('#menuBtn');
  await page.click('#templatesBtn');
  await page.waitForFunction(() => document.querySelectorAll('.template-row').length === 4);
  await page.locator('#templatesFolder button', { hasText: 'Trennen' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.template-row').length === 0);
  await page.setInputFiles('#templateInput', { name: 'Woche.md', mimeType: 'text/markdown', buffer: Buffer.from('# KW {{woche}}\n- [ ] Plan') });
  await page.waitForFunction(() => document.querySelectorAll('.template-row').length === 1);
  assert.match(await page.locator('.template-row').innerText(), /Woche\n1 Notiz · nur in diesem Browser/);
  await page.locator('#templatesDialog button[value="close"]').click();
  await page.locator('#mindmap .mm-node', { hasText: 'Sitzung' }).first().click({ button: 'right' });
  await page.locator('#contextMenu button', { hasText: 'Als Vorlage speichern' }).click();
  await page.waitForSelector('#templateSaveDialog[open]');
  assert.match(await page.locator('#templateSaveWhere').innerText(), /heruntergeladen und in diesem Browser/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#templateSaveGoBtn')]);
  assert.match(dl.suggestedFilename(), /^Sitzung .*\.md$/);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(text, /^---\nnonotes: 1\n/);
  await page.click('#menuBtn');
  await page.click('#templatesBtn');
  await page.waitForFunction(() => document.querySelectorAll('.template-row').length === 2);
  await page.locator('.template-row', { hasText: 'Woche' }).locator('button', { hasText: 'Entfernen' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.template-row').length === 1);
  await page.locator('#templatesDialog button[value="close"]').click();
  part('Ohne Ordner: Download und im Browser gemerkt, Datei hinzufügen, entfernen');

  assert.deepEqual(errors, [], 'keine Fehler im Browser');
  part('Keine Fehler im Browser');
  await ctx.close();
}

// ============================================================
/* Sprach-Test: prüft das Sprachsystem in Chromium.
   1. Pseudo-Sprache (qps): jeder feste Text der Oberfläche muss durch t()/tn()/translateDom() gegangen sein.
      Die Seite wird dazu durch alle Ansichten und Dialoge geführt; sichtbarer Text ohne ⟦ ⟧ gilt als
      nicht übersetzbar und lässt den Test fehlschlagen. Eigener Inhalt (Titel, Notiztext) ist ausgenommen.
   2. Englisch (echtes Paket): dieselbe Führung durch die Seite; sichtbar darf kein Deutsch mehr stehen.
   3. Spracherkennung des Browsers, Auswahl im Menü, Rückfall auf Deutsch, Mehrzahlformen, Zeitformat.
   4. Mechanismus mit einem kleinen Testpaket «tt»: Texte, Rückfall auf Deutsch, Wechsel. */
async function runI18n(browser, part, step) {
  // Eigener Inhalt der Prüfseiten: Wörter, die nicht übersetzt werden.
  const USER_WORDS = ['Alpha', 'Beta', 'Gamma', 'Offerte', 'einholen', 'Budget', 'Intro', 'Unterpunkt', 'Hauptpunkt', 'Liefertermin', 'Tagx', 'Wichtig', 'wichtig'];

  /** Sammelt sichtbaren Text und Attribute, die nicht übersetzt sind. Läuft in der Seite.
   *  mode 'qps': Text ohne ⟦ ⟧ · mode 'en': Text, in dem noch Deutsch steht. */
  function collectUntranslated({ userWords, mode }) {
    const user = new RegExp(userWords.concat(['Tab', 'Enter', 'Alt', 'Esc', 'Ctrl', 'Shift', 'Entf']).join('|'), 'g');
    const unwrap = s => { let prev; do { prev = s; s = s.replace(/⟦[^⟦⟧]*⟧/g, ' '); } while (s !== prev); return s; };
    const GERMAN = /[äöüÄÖÜß]|\b(und|oder|nicht|Notiz|Notizen|Aufgabe|Aufgaben|Frage|Fragen|Datei|Fehler|Neue|Ohne|Bitte|noch|nur|wird|werden|auch|keine|Keine|Alle|Antwort|Erledigt|Heute|Später|Archiv|Papierkorb|Verlauf|Löschen|Speichern|Abbrechen|Öffnen|Drucken|Hilfe|Suche|Titel|Bearbeiten|Vorschau|Liste|Mindmap)\b/;
    const words = mode === 'en'
      ? s => GERMAN.test(s.replace(user, ' '))
      : s => /[A-Za-zÄÖÜäöüÀ-ÿ]{2}/.test(unwrap(s).replace(user, ' '));
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

  /** Führt die Seite durch alle Ansichten und Dialoge und sammelt Text, der nicht übersetzt ist.
   *  mode 'qps' (Pseudo-Sprache) oder 'en' (Englisch). */
  async function walkTest(browser, mode) {
    const qps = mode === 'qps';
    const L = (de, en) => (qps ? `⟦${de}⟧` : en); // Beschriftung eines Knopfs in der gewählten Sprache
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: 'de-CH' });
    await ctx.addInitScript(lang => { try { localStorage.setItem('nonotes.lang', lang); } catch (e) { /* egal */ } }, mode);
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
      const list = await page.evaluate(collectUntranslated, { userWords: USER_WORDS, mode });
      for (const item of list) {
        if (!found.has(item)) found.set(item, label);
      }
    };

    await check('Mindmap leer');
    assert.equal(await page.evaluate(() => document.documentElement.lang), qps ? 'de' : mode, qps ? 'html lang bleibt de für qps' : 'html lang folgt der Sprache');

    // Inhalt anlegen
    await newRootNote(page, 'Alpha');
    await page.dblclick('.mm-node:not(.mm-root)');
    await page.waitForSelector('#editorPane:not([hidden])');
    await check('Editor leer');
    const SAMPLE_BODY = [
      'Intro',
      '- [ ] Offerte einholen @15.10.2026',
      '  - [ ] Unterpunkt',
      '- [ ] Hauptpunkt @01.01.2020 10:00',
      '? Budget Alpha? @15.10.2020',
      '! Wichtig',
      '? Liefertermin?',
      '[[Alpha]] [[Gamma]] ![Bild](att:99)',
    ].join('\n');
    await page.fill('#body', SAMPLE_BODY);
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

    // Verlauf (zwei Fassungen anlegen, dann den Dialog prüfen)
    await page.evaluate(() => {
      const RealDate = Date;
      window.__skew = 0;
      window.Date = class extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + window.__skew); else super(...a); }
        static now() { return RealDate.now() + window.__skew; }
      };
    });
    for (const text of ['Intro Alpha', 'Intro Beta Gamma']) {
      await page.evaluate(() => { window.__skew += 10 * 60 * 1000; });
      await page.fill('#body', text);
      await page.waitForFunction(SAVED);
    }
    await page.click('#noteMenuBtn');
    await check('Menü Notiz');
    await page.click('#historyBtn');
    await page.waitForSelector('#historyDialog[open]');
    await page.waitForFunction(() => document.querySelectorAll('#historyList button').length >= 1);
    await check('Verlauf');
    await page.uncheck('#historyDiff');
    await check('Verlauf ohne Markierung');
    await page.keyboard.press('Escape');
    await page.fill('#body', SAMPLE_BODY); // zurück zum Ausgangstext der weiteren Schritte
    await page.waitForFunction(SAVED);

    // Hilfe
    await page.click('#helpBtn');
    await page.waitForSelector('#helpDialog[open]');
    const tabs = await page.locator('#helpTabs button:visible').count();
    for (let i = 0; i < tabs; i++) {
      await page.locator('#helpTabs button:visible').nth(i).click();
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
    const answerBtn = page.locator(`#qList button:has-text("${L('Beantworten', 'Answer')}")`);
    if (await answerBtn.count()) {
      await answerBtn.first().click();
      await page.waitForTimeout(150);
      await check('Antwortformular');
      await page.fill('.q-form textarea', 'Alpha');
      await page.click(`.q-form button:has-text("${L('Speichern', 'Save')}")`);
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
    await page.click(`#contextMenu button:has-text("${L('Archivieren…', 'Archive…')}")`).catch(() => {});
    await page.waitForTimeout(200);
    await page.click('.mm-node:not(.mm-root)', { button: 'right' }).catch(() => {});
    await page.click(`#contextMenu button:has-text("${L('Löschen', 'Delete')}")`).catch(() => {});
    await page.waitForTimeout(200);

    // Listenansicht: Papierkorb und Archiv
    await page.click('#viewListBtn');
    for (const scope of ['trash', 'archive', 'live']) {
      await page.selectOption('#listScope', scope).catch(() => {});
      await page.waitForTimeout(200);
      await check('Liste ' + scope);
    }

    const bad = [...found.entries()].map(([text, where]) => `${where}: ${text}`);
    const dialogBad = dialogs.filter(m => (qps ? !m.includes('⟦') : /[äöüÄÖÜß]|\b(Soll|Notiz|Notizen|Archiv|Papierkorb|Verlauf|löschen)\b/.test(m.replace(/Alpha|Beta|Gamma/g, ' '))));
    assert.deepEqual(errors, [], 'keine Fehler im Browser');
    assert.deepEqual(bad, [], (qps ? 'feste Texte ohne Übersetzungsaufruf:\n' : 'Text, der noch deutsch ist:\n') + bad.join('\n'));
    assert.deepEqual(dialogBad, [], qps ? 'Rückfragen ohne Übersetzungsaufruf' : 'Rückfragen, die noch deutsch sind: ' + dialogBad.join(' | '));
    assert.ok(dialogs.length >= 1, 'Rückfragen wurden geprüft');
    await ctx.close();
    part(qps ? 'Pseudo-Sprache: jeder feste Text der Oberfläche läuft über das Sprachsystem' : 'Englisch: in allen Ansichten, Dialogen und Rückfragen steht kein Deutsch mehr');
  }

  /** Baut eine Kopie des Builds mit einem kleinen Testpaket «tt» (Testsprache) hinter den echten Paketen. */
  function buildWithTestPack(tmp) {
    const dir = path.join(tmp, 'NoNotes');
    fs.cpSync(DIST, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'lang', 'tt.js'), `NoNotesI18n.register('tt', 'Testsprache', {
    'Neue Notiz': 'TT new note',
    'Mindmap': 'TT map',
    'Liste': 'TT list',
    'Datenbank ▾': 'TT db ▾',
    '{n} Notiz': { one: '{n} tt-note', other: '{n} tt-notes' },
    '{n} Notiz ausgewählt': { one: '{n} tt-note selected', other: '{n} tt-notes selected' },
    'Sprache': 'TT language',
    'Ohne Titel': 'TT untitled',
    'Meine Notizen': 'TT my notes',
  }, { locale: 'en' });
  `);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.ok(html.includes('<script src="lang/en.js"></script>'), 'en.js eingebunden');
    fs.writeFileSync(path.join(dir, 'index.html'), html.replace('<script src="lang/en.js"></script>', '<script src="lang/en.js"></script>\n  <script src="lang/tt.js"></script>'));
    return dir;
  }

  /** Englisch als echtes Paket: Spracherkennung des Browsers, Auswahl im Menü, Mehrzahl, Zeitformat, Rückfall. */
  async function englishTest(browser) {
    const url = 'file://' + path.join(DIST, 'index.html');
    const open = async (locale, init) => {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale });
      if (init) await ctx.addInitScript(init);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      await page.goto(url);
      await page.waitForSelector(READY, { timeout: 30000 });
      return { ctx, page, errors };
    };

    // Browser auf Englisch: Englisch ohne Zutun
    const en = await open('en-US');
    const { page } = en;
    assert.equal(await page.evaluate(() => NoNotesI18n.language()), 'en');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.locator('#menuBtn').innerText(), 'Database ▾');
    assert.equal(await page.locator('#viewMapBtn').innerText(), 'Mind map');
    assert.equal(await page.evaluate(() => document.querySelector('.mm-root text').textContent), 'My notes', 'Titel einer neuen Mindmap auf Englisch');
    await page.click('#menuBtn');
    assert.deepEqual(await page.locator('#langSelect option').allInnerTexts(), ['Deutsch', 'English']);
    assert.equal(await page.inputValue('#langSelect'), 'en');
    assert.equal(await page.locator('#langRow label').innerText(), 'Language');
    assert.deepEqual(await page.locator('#accentSwatches .swatch').evaluateAll(b => b.map(x => x.getAttribute('aria-label'))), ['Blue', 'Teal', 'Green', 'Yellow', 'Orange', 'Red', 'Violet', 'Grey']);
    await page.keyboard.press('Escape');
    part('Englisch: Browsersprache wird erkannt, Menü, Farben, Titel der Mindmap');

    // Mehrzahl und Zeitformat
    await page.click('#viewListBtn');
    await page.waitForSelector('body.view-list');
    await page.click('#newBtn');
    await page.fill('#title', 'One');
    await page.waitForFunction(SAVED);
    assert.equal(await page.locator('#count').innerText(), '1 note');
    assert.match(await page.locator('#noteMeta').innerText(), /^Created \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} · Modified \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/, 'Zeitformat en-GB');
    await page.click('#newBtn');
    await page.fill('#title', 'Two');
    await page.waitForFunction(SAVED);
    assert.equal(await page.locator('#count').innerText(), '2 notes');
    await page.fill('#body', '- [ ] Alpha @15.10.2026\n? Beta?');
    await page.waitForFunction(SAVED);
    assert.match(await page.locator('#noteQuestions').innerText(), /1 open question out of 1/);
    part('Englisch: Einzahl und Mehrzahl, Zeitformat');

    // Export auf Englisch
    const md = await page.evaluate(async () => {
      const parsed = NoNotesQuestions.parse('? Beta?\n! Gamma');
      return parsed.length;
    });
    assert.equal(md, 1);

    // Wechsel auf Deutsch über das Menü: gespeichert, nach dem Neuladen deutsch, Daten bleiben
    await page.click('#menuBtn');
    await page.selectOption('#langSelect', 'de');
    await page.waitForFunction(() => document.querySelector('#menuBtn').textContent.includes('Datenbank'));
    await page.waitForSelector(READY);
    assert.equal(await page.locator('#count').innerText(), '2 Notizen');
    assert.deepEqual(en.errors, []);
    await en.ctx.close();
    part('Englisch: Wechsel auf Deutsch über das Menü, Daten bleiben');

    // Deutsch bleibt Deutsch; eine Sprache ohne Paket fällt auf Deutsch zurück
    for (const locale of ['de-CH', 'fr-CH']) {
      const c = await open(locale);
      assert.equal(await c.page.evaluate(() => NoNotesI18n.language()), 'de', locale);
      assert.equal(await c.page.locator('#menuBtn').innerText(), 'Datenbank ▾', locale);
      assert.deepEqual(c.errors, []);
      await c.ctx.close();
    }
    part('Deutsch bleibt Deutsch, Sprachen ohne Paket (fr-CH) fallen auf Deutsch zurück');
  }

  async function packTest(browser, tmp) {
    const dir = buildWithTestPack(tmp);
    const url = 'file://' + path.join(dir, 'index.html');
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    // nur beim ersten Laden setzen, sonst überschreibt es die Wahl nach dem Neuladen
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('nonotes.lang')) localStorage.setItem('nonotes.lang', 'tt'); } catch (e) { /* egal */ } });
    const page = await ctx.newPage();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); }); // eine Rückfrage wäre ein Fehler, soll den Lauf aber nicht hängen lassen
    await page.goto(url);
    await page.waitForSelector(READY, { timeout: 30000 });

    // gewähltes Paket, Texte aus dem Markup, Sprachwahl im Menü
    assert.equal(await page.evaluate(() => NoNotesI18n.language()), 'tt');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'tt');
    assert.equal(await page.locator('#menuBtn').innerText(), 'TT db ▾');
    assert.equal(await page.locator('#viewMapBtn').innerText(), 'TT map');
    assert.equal(await page.locator('#mapNewBtn').innerText(), 'TT new note');
    await page.click('#menuBtn');
    assert.equal(await page.locator('#langRow').isVisible(), true, 'Sprachwahl sichtbar bei mehr als einer Sprache');
    assert.equal(await page.locator('#langRow label').innerText(), 'TT language');
    assert.deepEqual(await page.locator('#langSelect option').allInnerTexts(), ['Deutsch', 'English', 'Testsprache']);
    assert.equal(await page.inputValue('#langSelect'), 'tt');
    part('Testpaket: Texte aus dem Markup, Sprachwahl im Menü');

    // Mehrzahlformen und nicht übersetzte Texte (Rückfall auf Deutsch)
    await page.keyboard.press('Escape');
    await page.click('#viewListBtn');
    await page.waitForSelector('body.view-list');
    await page.click('#newBtn');
    await page.fill('#title', 'One');
    await page.waitForFunction(SAVED);
    assert.equal(await page.locator('#count').innerText(), '1 tt-note');
    await page.click('#newBtn');
    await page.fill('#title', 'Two');
    await page.waitForFunction(SAVED);
    assert.equal(await page.locator('#count').innerText(), '2 tt-notes');
    assert.match(await page.locator('#viewQuestionsBtn').innerText(), /Fragen/, 'nicht übersetzter Text bleibt deutsch');
    part('Testpaket: Einzahl und Mehrzahl, Rückfall auf Deutsch');

    // Wechsel auf Deutsch: gemerkt, nach dem Neuladen deutsch. Dabei steht noch eine Eingabe aus (kein Warten auf «gespeichert»):
    // der Wechsel sichert sie selbst, statt an der Rückfrage «ungespeicherte Änderungen» hängen zu bleiben.
    await page.click('#newBtn');
    // Erst wenn die neue, leere Notiz offen ist und den Fokus hat (dann ist newNote durch); sonst trifft die Eingabe noch die alte Notiz
    await page.waitForFunction(() => !document.querySelector('#editorPane').hidden && document.querySelector('#title').value === '' && document.activeElement === document.querySelector('#title'));
    await page.evaluate(() => { // Eingabe und Sprachwechsel im selben Augenblick: das Speichern der Eingabe ist noch nicht ausgelöst
      const title = document.querySelector('#title');
      title.value = 'Three';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      const select = document.querySelector('#langSelect');
      select.value = 'de';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('#menuBtn').textContent.includes('Datenbank') && !document.querySelector('#menuBtn').textContent.includes('TT'));
    await page.waitForSelector(READY);
    assert.equal(await page.evaluate(() => localStorage.getItem('nonotes.lang')), 'de');
    assert.equal(await page.locator('#viewMapBtn').innerText(), 'Mindmap');
    assert.equal(await page.locator('#count').innerText(), '3 Notizen', 'Daten bleiben beim Sprachwechsel erhalten, auch die Eingabe, die noch aussteht');
    assert.ok((await page.locator('#list .note-title').allInnerTexts()).includes('Three'), 'der Titel wurde vor dem Neuladen gesichert');
    assert.deepEqual(dialogs, [], 'keine Rückfrage beim Sprachwechsel');
    part('Sprachwechsel: gespeichert, Seite neu geladen, Daten bleiben');

    // Standardtitel einer neuen Mindmap folgt der Sprache
    const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    await ctx2.addInitScript(() => { try { localStorage.setItem('nonotes.lang', 'tt'); } catch (e) { /* egal */ } });
    const p2 = await ctx2.newPage();
    await p2.goto(url);
    await p2.waitForSelector(READY, { timeout: 30000 });
    assert.equal(await p2.evaluate(() => document.querySelector('.mm-root text').textContent), 'TT my notes', 'Titel einer neuen Mindmap folgt der Sprache');
    await ctx2.close();

    assert.deepEqual(errors, [], 'keine Fehler im Browser');
    await ctx.close();
    part('Testpaket: keine Browserfehler');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-i18n-'));
  try {
    await walkTest(browser, 'qps');
    await walkTest(browser, 'en');
    await englishTest(browser);
    await packTest(browser, tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ============================================================
/* Test der Anbindung an den Agenten des Browsers (WebMCP, v2.1.0): ein Nachbau von document.modelContext nimmt die Werkzeuge an;
   Aufrufe ändern die Daten, die Oberfläche zeichnet neu, gespeichert wird; im Lesemodus nur lesende Werkzeuge; ohne Schnittstelle nichts. */
async function runWebMcp(browser, part, step) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-CH' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => {
    // Nachbau der Schnittstelle, wie Chrome und Edge sie beschreiben: registerTool(def), execute(input) liefert das Ergebnis
    const tools = new Map();
    const mc = {
      registerTool: async def => {
        if (!def || !def.name || !def.description || !def.inputSchema || typeof def.execute !== 'function') throw new Error('bad tool');
        if (tools.has(def.name)) throw new Error('duplicate ' + def.name);
        tools.set(def.name, def);
      },
      unregisterTool: async name => { tools.delete(name); },
    };
    window.__mc = { tools, call: (name, input) => tools.get(name).execute(input) };
    Object.defineProperty(document, 'modelContext', { value: mc, configurable: true });
    // Lesemodus auf Wunsch (wie in test/collab.cjs)
    let edition;
    Object.defineProperty(window, 'NoNotesEdition', {
      configurable: true,
      get: () => edition,
      set: v => {
        edition = v;
        const make = v.createShell;
        v.createShell = host => { const shell = make(host); if (localStorage.getItem('__readonly') === '1') Object.defineProperty(shell, 'readOnly', { get: () => true }); return shell; };
      },
    });
  });
  await page.goto(APP_URL);
  await page.waitForSelector(READY);
  const names = await page.evaluate(() => [...window.__mc.tools.keys()]);
  for (const n of ['get_overview', 'search_notes', 'create_note', 'answer_question', 'record_decision', 'complete_task']) assert.ok(names.includes(n), n);
  const def = await page.evaluate(() => { const t = window.__mc.tools.get('create_note'); return { description: t.description, schema: t.inputSchema, annotations: t.annotations }; });
  assert.equal(def.schema.type, 'object');
  assert.equal(def.annotations.readOnlyHint, false);
  assert.equal(await page.evaluate(() => window.__mc.tools.get('get_overview').annotations.readOnlyHint), true);
  assert.equal(await page.evaluate(() => window.NoNotesWebMcp.available()), true);
  part('WebMCP: alle Werkzeuge beim Nachbau der Browser-Schnittstelle gemeldet, mit Schema und Hinweisen');

  // Der Agent legt eine Notiz mit Frage und Aufgabe an: die Oberfläche zeigt sie, gespeichert wird
  let r = await page.evaluate(() => window.__mc.call('create_note', { title: 'Vom Agenten', body: '? Frage vom Agenten\n- [ ] Aufgabe vom Agenten', tags: ['agent'] }));
  assert.ok(!r.isError, r.content[0].text);
  const id = r.structuredContent.id;
  await page.waitForFunction(() => document.body.textContent.includes('Vom Agenten'));
  await page.waitForFunction(SAVED);
  r = await page.evaluate(() => window.__mc.call('list_questions', {}));
  assert.equal(r.structuredContent.total, 1);
  const qid = r.structuredContent.items[0].id;
  r = await page.evaluate(q => window.__mc.call('answer_question', { id: q, answer: 'Antwort vom Agenten' }), qid);
  assert.ok(!r.isError, r.content[0].text);
  r = await page.evaluate(() => window.__mc.call('list_tasks', {}));
  assert.equal(r.structuredContent.total, 1);
  r = await page.evaluate(t => window.__mc.call('complete_task', { id: t }), r.structuredContent.items[0].id);
  assert.ok(!r.isError, r.content[0].text);
  r = await page.evaluate(i => window.__mc.call('get_note', { id: i }), id);
  assert.equal(r.structuredContent.body, '? Frage vom Agenten\n! Antwort vom Agenten\n- [x] Aufgabe vom Agenten');
  await page.waitForFunction(SAVED);
  // Nach dem Neuladen ist alles da (Browser-Speicher)
  await page.reload();
  await page.waitForSelector(READY);
  r = await page.evaluate(() => window.__mc.call('search_notes', { tag: 'agent' }));
  assert.equal(r.structuredContent.total, 1);
  assert.equal(r.structuredContent.items[0].title, 'Vom Agenten');
  r = await page.evaluate(() => window.__mc.call('get_overview', {}));
  assert.equal(r.structuredContent.questions.open, 0);
  assert.equal(r.structuredContent.tasks.open, 0);
  // Fehler kommen als Ergebnis zurück, nicht als Ausnahme
  r = await page.evaluate(() => window.__mc.call('get_note', { id: 999999 }));
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /NOTE_NOT_FOUND/);
  part('WebMCP: Notiz, Antwort und Aufgabe über die Werkzeuge; Oberfläche folgt; gespeichert und nach dem Neuladen da; Fehler als Ergebnis');

  // Lesemodus: nur lesende Werkzeuge; ohne Schnittstelle: nichts gemeldet, kein Fehler
  await page.evaluate(() => localStorage.setItem('__readonly', '1'));
  await page.reload();
  await page.waitForSelector(READY);
  const roNames = await page.evaluate(() => [...window.__mc.tools.keys()]);
  assert.ok(roNames.includes('get_note') && roNames.includes('list_questions'), roNames.join(','));
  assert.ok(!roNames.includes('create_note') && !roNames.includes('answer_question') && !roNames.includes('delete_note'), roNames.join(','));
  await page.evaluate(() => localStorage.removeItem('__readonly'));
  const plain = await ctx.newPage();
  plain.on('pageerror', e => errors.push('plain: ' + e.message));
  await plain.goto(APP_URL);
  await plain.waitForSelector(READY);
  assert.equal(await plain.evaluate(() => window.NoNotesWebMcp.available()), false);
  assert.equal(await plain.evaluate(() => typeof window.__mc), 'undefined');
  assert.deepEqual(errors, [], errors.join('\n'));
  await ctx.close();
  part('Lesemodus meldet nur lesende Werkzeuge; ohne Schnittstelle im Browser passiert nichts');
}

suite('Erweiterungs-Test', [
  { name: 'Erweiterungen: Lader, Dialog, Schnittstelle 1, Menü, Toolleiste, Ereignisse, Hilfe, Designs, Ein- und Ausschalten zur Laufzeit, Verzeichnis, Beispiele, Pseudo-Sprache', run: runPlugins },
  { name: 'Hauptfarbe: Palette, Auswahl, Datei, Export und Druck, hell und dunkel', run: runPalette },
  { name: 'Videos: Karte statt Rahmen, Klick lädt abgeschottet, Druck und Listen mit Links, ausgeschaltet, Lesemodus', run: runEmbedsUi },
  { name: 'Querverweise: gestrichelte Linien, Schalter, eingeklappte Ziele, Vorschau, Export und Druck, gelöschtes Ziel', run: runLinks },
  { name: 'Entscheide und Personen: Reiter, Ansicht, Entscheiden mit Datum, Vorschau, Toolleiste, Vorschläge beim Tippen von @, Export und Druck', run: runDecisions },
  { name: 'Vorlagen: Ordner verbinden, speichern, aus Vorlage anlegen und einfügen, Erlaubnis, ohne Ordner, Datei hinzufügen', run: runTemplatesUi },
  { name: 'Sprachen: Pseudo-Sprache durch alle Ansichten, Englisch, Browsersprache, Mehrzahl, Testpaket, Wechsel', run: runI18n },
  { name: 'WebMCP: Werkzeuge für den Agenten des Browsers, Aufrufe ändern Daten und Oberfläche, gespeichert, Lesemodus, ohne Schnittstelle nichts', run: runWebMcp },
], { browser: true });
