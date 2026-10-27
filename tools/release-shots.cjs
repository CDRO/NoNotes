#!/usr/bin/env node
/* NoNotes – Screenshots für die Release-Notizen (ab v2.12.0). Baut die lokale Ausprägung (wahlweise mit Erweiterungen), öffnet sie
   in Chromium mit festen Bedingungen und spielt das Drehbuch docs/releases/<Version>/shots.cjs ab. Die Bilder landen im selben Ordner;
   wer sie neu macht, bekommt dieselben Bilder (gleiche Grösse, Sprache, Zeitzone, Uhrzeit, helles Design, nur Beispieldaten).

   Aufruf:  node tools/release-shots.cjs <Version> [--plugins <Ordner>] [--dir <Ordner>] [--app <gebauter Ordner>] [--only <Name>]
     --plugins  Erweiterungen mitbauen (z. B. ../NoNotes-plugins), wie im Paket «NoNotes-with-Plugins»
     --dir      Ordner mit shots.cjs und für die Bilder (Standard docs/releases/<Version>)
     --app      schon gebauter Ordner statt eines eigenen Builds (Tests)
     --only     nur das Bild mit diesem Namen

   Ein Drehbuch ist ein CommonJS-Modul:
     module.exports = {
       date: '2026-11-02T09:00:00+01:00',        // Uhrzeit der App (Termine, «Erfasst …»), Standard: Montag 09:00
       plugins: ['tag-colors/tag-colors.js'],    // Erweiterungen, die fest eingeschaltet werden (aus plugins/)
       lang: 'de',                               // Sprache der Oberfläche
       async run(s) { … await s.shot('legende', { locator: '.tf-legende', pad: 12 }); },
     };
   s bietet: page, node(Titel), newNote(Titel, Eltern?), edit(Titel, { tags, body, mode }), back(), saved(), mode(Name),
   view(Name) für die Reiter (map, list, questions, decisions, tasks), shot(Name, { locator, pad, fullPage }). */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const READY = 'body[data-ready="true"]';
const VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_DATE = '2026-11-02T09:00:00+01:00';

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {
    if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
    throw new Error('Playwright fehlt: npm install (Chromium wie für die Tests).');
  }
}

function parseArgs(argv) {
  const a = { version: argv[0], plugins: [] };
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--plugins') a.plugins.push(path.resolve(argv[++i]));
    else if (k === '--dir') a.dir = path.resolve(argv[++i]);
    else if (k === '--app') a.app = path.resolve(argv[++i]);
    else if (k === '--only') a.only = argv[++i];
    else throw new Error(`Unbekannte Angabe: ${k}`);
  }
  if (!/^v\d+\.\d+\.\d+$/.test(a.version || '')) throw new Error('Aufruf: node tools/release-shots.cjs <Version> [--plugins <Ordner>] [--dir <Ordner>] [--app <Ordner>] [--only <Name>]');
  a.dir = a.dir || path.join(ROOT, 'docs', 'releases', a.version);
  return a;
}

/** Baut die App in einen eigenen Ordner und schaltet die Erweiterungen des Drehbuchs fest ein (plugins/plugins.js). */
function buildApp(args, script) {
  let app = args.app;
  if (!app) {
    app = path.join(ROOT, 'dist', 'release-shots', args.version);
    fs.rmSync(app, { recursive: true, force: true });
    const extra = args.plugins.flatMap(p => ['--plugins', p]);
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.cjs'), '--edition', 'local', '--version', args.version, '--out', app, ...extra], { stdio: 'inherit' });
  }
  const wanted = script.plugins || [];
  if (wanted.length && args.app) { // den gegebenen Ordner nicht verändern
    const copy = path.join(ROOT, 'dist', 'release-shots', args.version + '-app');
    fs.rmSync(copy, { recursive: true, force: true });
    fs.cpSync(app, copy, { recursive: true });
    app = copy;
  }
  if (wanted.length) {
    const file = path.join(app, 'plugins', 'plugins.js');
    let text = fs.readFileSync(file, 'utf8');
    for (const p of wanted) if (!fs.existsSync(path.join(app, 'plugins', p))) throw new Error(`Erweiterung ${p} fehlt im Build (--plugins <Ordner> angeben).`);
    const at = text.lastIndexOf('NoNotesPlugins.list([');
    if (at < 0) throw new Error('plugins/plugins.js ohne NoNotesPlugins.list([…])');
    const open = at + 'NoNotesPlugins.list(['.length;
    text = text.slice(0, open) + '\n' + wanted.map(p => `  ${JSON.stringify(p)},`).join('\n') + text.slice(open);
    fs.writeFileSync(file, text);
  }
  return app;
}

async function shoot(args) {
  const scriptFile = path.join(args.dir, 'shots.cjs');
  if (!fs.existsSync(scriptFile)) throw new Error(`${path.relative(process.cwd(), scriptFile)} fehlt (Drehbuch der Screenshots, siehe docs/releases/README.md).`);
  const script = require(scriptFile);
  if (typeof script.run !== 'function') throw new Error('shots.cjs exportiert keine Funktion run(s).');
  const app = buildApp(args, script);

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const made = [];
  const errors = [];
  try {
    const lang = script.lang || 'de';
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: lang === 'de' ? 'de-CH' : 'en-GB', timezoneId: 'Europe/Zurich', colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date(script.date || DEFAULT_DATE) });
    await page.goto('file://' + path.join(app, 'index.html'));
    await page.waitForSelector(READY, { timeout: 30000 });

    const node = title => page.locator(`g.mm-node:has(> text:text-is(${JSON.stringify(title)}))`);
    const saved = () => page.waitForFunction(() => { const s = document.querySelector('#status'); return !s || s.dataset.state === 'saved'; }, null, { timeout: 15000 });
    const s = {
      page, node, saved,
      async newNote(title, parent) {
        if (parent) await node(parent).click(); else await page.click('#mindmap', { position: { x: 30, y: VIEWPORT.height - 120 } });
        await page.keyboard.press('Tab');
        await page.waitForSelector('#renameInput:not([hidden])');
        await page.keyboard.type(title);
        await page.keyboard.press('Enter');
        await node(title).waitFor();
      },
      async edit(title, o = {}) {
        await node(title).dblclick();
        await page.waitForFunction(t => document.body.classList.contains('editor-open') && document.querySelector('#title').value === t, title);
        for (const t of o.tags || []) { await page.fill('#tagInput', t); await page.keyboard.press('Enter'); }
        if (o.body != null) { await page.click('[data-mode="edit"]'); await page.fill('#body', o.body); }
        await saved();
        if (o.mode) await s.mode(o.mode);
      },
      async mode(name) { await page.click(`[data-mode="${name}"]`); await page.waitForTimeout(200); },
      async back() { await page.click('#backBtn'); await page.waitForSelector('body:not(.editor-open)'); },
      async view(name) {
        const id = { map: '#viewMapBtn', list: '#viewListBtn', questions: '#viewQuestionsBtn', decisions: '#viewDecisionsBtn', tasks: '#viewTasksBtn' }[name];
        if (!id) throw new Error(`Unbekannter Reiter: ${name}`);
        await page.click(id);
        await page.waitForTimeout(200);
      },
      /** Bild «<Name>.png»: die ganze Seite, oder ein Ausschnitt um locator (mit pad Pixeln Rand). */
      async shot(name, o = {}) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`Name «${name}»: Kleinbuchstaben, Ziffern und «-».`);
        if (args.only && args.only !== name) return;
        await saved().catch(() => {});
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await page.waitForTimeout(300);
        const file = path.join(args.dir, name + '.png');
        if (o.locator) {
          const box = await page.locator(o.locator).first().boundingBox();
          if (!box) throw new Error(`Bild ${name}: ${o.locator} ist nicht zu sehen.`);
          const pad = o.pad == null ? 16 : o.pad;
          const x = Math.max(0, Math.floor(box.x - pad)), y = Math.max(0, Math.floor(box.y - pad));
          const clip = { x, y, width: Math.min(VIEWPORT.width - x, Math.ceil(box.width + 2 * pad)), height: Math.min(VIEWPORT.height - y, Math.ceil(box.height + 2 * pad)) };
          await page.screenshot({ path: file, clip });
        } else {
          await page.screenshot({ path: file, fullPage: !!o.fullPage });
        }
        made.push(file);
      },
    };
    await script.run(s);
    if (errors.length) throw new Error('Fehler in der Seite: ' + errors.join(' | '));
  } finally {
    await browser.close();
  }
  return made;
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const made = await shoot(args);
    for (const f of made) console.log(`${path.relative(process.cwd(), f)}  ${Math.round(fs.statSync(f).size / 1024)} KB`);
    console.log(`${made.length} Bild(er). Danach: node tools/release-notes.cjs check ${args.version}`);
  })().catch(e => { console.error(e.message || e); process.exitCode = 1; });
}

module.exports = { shoot, parseArgs };
