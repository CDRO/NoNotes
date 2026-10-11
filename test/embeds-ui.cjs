/* Test der Videos (v1.6.0), Teil 2, im Browser: Die Vorschau zeigt Karten und löst keine Anfrage an die Anbieter aus; erst der Klick baut den
   Rahmen (abgeschottet, mit Herkunft, ohne Pfad); der Rahmen bleibt beim Neuzeichnen der Vorschau; YouTube in einer geöffneten Datei bietet nur
   den Link; ausgeschaltet gibt es nur Links; im Lesemodus geht es wie sonst; Druck und Export enthalten keinen Rahmen.
   Die Anbieter werden durch Platzhalterseiten ersetzt (kein Netz nötig). Ausführen: npm test (nach tools/build.cjs). */
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
const BODY = 'Anleitung\nhttps://youtu.be/dQw4w9WgXcQ\n\n![Der Clip](https://vimeo.com/76979871)\n\nhttps://www.dailymotion.com/video/x8abc12\n\nEin ![x](https://vimeo.com/76979871) im Satz\n\n![Ein Bild](https://beispiel.example/bild.png)';

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-embeds-'));
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
  step('Vorschau: drei Karten, ein Link im Satz, noch kein Rahmen und keine einzige Anfrage an die Anbieter');

  // YouTube in einer geöffneten Datei: nur der Link
  const yt = page.locator('#preview .md-embed[data-provider="youtube"]');
  assert.equal(await yt.locator('.md-embed-load').count(), 0, 'kein Ladeknopf');
  assert.match(await yt.innerText(), /YouTube das Einbetten nicht zu/);
  assert.equal(await yt.locator('.md-embed-open').getAttribute('href'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  step('YouTube in der geöffneten Datei (file://): nur der Link mit Erklärung');

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
  step('Klick: Rahmen mit Quelle, Herkunft ohne Pfad, abgeschottet (ohne Wechsel der Seite und ohne Dialoge); Anfrage erst jetzt und nur an Vimeo');

  // ---------- Neuzeichnen behält das geladene Video ----------
  await page.click('[data-mode="split"]');
  await page.waitForSelector('#preview .md-embed');
  await page.waitForSelector('#preview .md-embed[data-provider="vimeo"] iframe');
  assert.equal(await page.locator('#preview .md-embed[data-provider="dailymotion"] iframe').count(), 0, 'andere Karten bleiben Karten');
  step('Neuzeichnen der Vorschau (Ansicht gewechselt): das geladene Video wird wieder eingesetzt, die anderen bleiben Karten');

  // Dailymotion laden
  await page.locator('#preview .md-embed[data-provider="dailymotion"] .md-embed-load').click();
  await page.waitForSelector('#preview .md-embed[data-provider="dailymotion"] iframe');
  assert.equal(await page.locator('#preview .md-embed[data-provider="dailymotion"] iframe').getAttribute('src'), 'https://www.dailymotion.com/embed/video/x8abc12?autoplay=1');
  step('Dailymotion: Rahmen mit der Adresse zum Einbetten');

  // ---------- Druck und Export ----------
  const printHtml = await page.evaluate(i => __ctx.backend.getNote(i).then(n => NoNotesMarkdown.render(n.body, { resolveTitle: () => null })), id);
  assert.ok(!/md-embed|<iframe|<img/.test(printHtml.replace(/<img src="https:\/\/beispiel\.example\/bild\.png"[^>]*>/, '')), 'Druck: Links statt Karten und Rahmen');
  assert.equal(await page.locator('#printArea iframe').count(), 0);
  step('Druck und Listen: ohne die Option gibt es Links, keine Karten, keine Rahmen');

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
  step('Ausgeschaltet (Hülle meldet embeds = off): nur Links, keine Anfrage');
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
  step('Lesemodus: Videos lassen sich wie sonst laden (Lesen ist erlaubt)');
  await page.evaluate(() => localStorage.removeItem('__readonly'));

  assert.deepEqual(errors, [], 'Fehler im Browser:\n' + errors.join('\n'));
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nVideo-Test (im Browser) bestanden.');
}

main().catch(e => { console.error(e); process.exit(1); });
