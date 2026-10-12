/* Test des Builds mit einer Ausprägung ausserhalb des Projekts (--edition-dir), wie sie ein anderes Projekt mitbringt.
   Ausführen: node test/build.cjs */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'tools', 'build.cjs');
const step = name => console.log('  ✓ ' + name);

const run = args => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8' });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-build-'));
try {
  const ed = path.join(tmp, 'meine-ausprägung');
  fs.mkdirSync(path.join(ed, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(ed, 'a.js'), 'window.__a = 1;');
  fs.writeFileSync(path.join(ed, 'sub', 'b.js'), 'window.__b = 2;');
  fs.writeFileSync(path.join(ed, 'hilfe.html'), '<h3>Wo liegen meine Notizen?</h3>\n<p>Auf dem Server.</p>\n');
  fs.writeFileSync(path.join(ed, 'extra.txt'), 'extra');
  fs.mkdirSync(path.join(ed, 'daten'));
  fs.writeFileSync(path.join(ed, 'daten', 'x.json'), '{}');
  fs.mkdirSync(path.join(ed, 'erw')); // Erweiterungen der Ausprägung, die nach plugins/fremd/ kommen
  fs.writeFileSync(path.join(ed, 'erw', 'x.js'), "NoNotesPlugins.register({ id: 'fremd-x', name: 'Fremd X', version: '0.1', api: 1, description: 'Aus der Ausprägung', theme: { light: { bg: '#fff' } } });");
  fs.writeFileSync(path.join(ed, 'erw', 'kaputt.js'), "document.body.appendChild(1); NoNotesPlugins.register({ id: 'kaputt', api: 1 });"); // läuft nur im Browser
  fs.writeFileSync(path.join(ed, 'edition.json'), JSON.stringify({
    id: 'fremd',
    scripts: ['a.js', '@core/packages/core/zip.js', 'sub/b.js'],
    helpStorage: 'hilfe.html',
    files: ['extra.txt'],
    include: ['NOTICE', 'plugins'],
    copy: { daten: 'daten', 'plugins/fremd': 'erw' },
  }));
  const out = path.join(tmp, 'out');

  let r = run(['--edition-dir', ed, '--out', out, '--version', 'v9.9.9']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Ausprägung fremd/);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const order = ['js/a.js', 'js/zip.js', 'js/b.js'].map(s => html.indexOf(`<script src="${s}"></script>`));
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], 'Skripte der Ausprägung stehen in dieser Reihenfolge: ' + order);
  assert.ok(html.indexOf('js/backend.js') < order[0] && order[2] < html.indexOf('js/mindmap.js'), 'zwischen Backend-Vertrag und Oberfläche');
  assert.ok(html.includes('<p>Auf dem Server.</p>') && !html.includes('Browser-Speicher (automatisch)'), 'Hilfeabschnitt der Ausprägung statt des lokalen');
  assert.ok(html.includes('Termine in den Kalender'), 'der übrige Teil der Hilfe bleibt');
  assert.ok(!html.includes('EDITION-'), 'keine offenen Platzhalter');
  assert.ok(fs.existsSync(path.join(out, 'js', 'a.js')) && fs.existsSync(path.join(out, 'js', 'b.js')));
  assert.ok(fs.existsSync(path.join(out, 'extra.txt')) && fs.existsSync(path.join(out, 'daten', 'x.json')));
  assert.ok(fs.existsSync(path.join(out, 'NOTICE')) && fs.existsSync(path.join(out, 'plugins', 'plugins.js')));
  assert.ok(!fs.existsSync(path.join(out, 'docs')) && !fs.existsSync(path.join(out, 'README.md')) && !fs.existsSync(path.join(out, 'vendor')), 'nur, was die Ausprägung einschliesst');
  assert.ok(!fs.existsSync(path.join(out, 'js', 'db.js')) && !fs.existsSync(path.join(out, 'js', 'local-shell.js')), 'nichts von der lokalen Ausprägung');
  assert.match(fs.readFileSync(path.join(out, 'js', 'version.js'), 'utf8'), /v9\.9\.9/);
  step('Fremde Ausprägung: Skripte in Reihenfolge, eigener Hilfeabschnitt, nur eingeschlossene Teile, Version gesetzt');

  // Verzeichnis der Erweiterungen: alle .js im Zielordner plugins/, auch die der Ausprägung, mit ihren Angaben; die Liste bleibt
  const listJs = fs.readFileSync(path.join(out, 'plugins', 'plugins.js'), 'utf8');
  const cat = JSON.parse(/NoNotesPlugins\.catalog\((\[[\s\S]*?\])\);/.exec(listJs)[1]);
  assert.deepEqual(cat.map(e => e.file), ['beispiele/datum-einfuegen.js', 'beispiele/sepia.js', 'fremd/kaputt.js', 'fremd/x.js']);
  assert.deepEqual(cat.find(e => e.file === 'fremd/x.js'), { file: 'fremd/x.js', id: 'fremd-x', name: 'Fremd X', version: '0.1', api: 1, description: 'Aus der Ausprägung', theme: true });
  assert.deepEqual(cat.find(e => e.file === 'fremd/kaputt.js'), { file: 'fremd/kaputt.js' }, 'eine Datei, die nur im Browser läuft, steht mit ihrem Namen drin');
  assert.equal(cat.find(e => e.file === 'beispiele/sepia.js').theme, true);
  assert.equal(cat.find(e => e.file === 'beispiele/datum-einfuegen.js').name, 'Datum einfügen');
  assert.ok(listJs.indexOf('NoNotesPlugins.catalog(') < listJs.indexOf('NoNotesPlugins.list('), 'das Verzeichnis steht vor der Liste des Projekts');
  assert.ok(fs.existsSync(path.join(out, 'plugins', 'fremd', 'x.js')));
  assert.match(r.stdout, /4 Erweiterungen im Verzeichnis/);
  step('Verzeichnis der Erweiterungen: aus dem Zielordner plugins/ erzeugt, mit Angaben aus register(), vor der Liste');

  // Fehler sind verständlich
  r = run(['--edition-dir', path.join(tmp, 'gibt-es-nicht'), '--out', out]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /edition\.json fehlt/);
  fs.writeFileSync(path.join(ed, 'edition.json'), JSON.stringify({ id: 'kaputt', scripts: ['fehlt.js'] }));
  r = run(['--edition-dir', ed, '--out', out]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Datei fehlt/);
  step('Fehlende Ausprägung und fehlende Datei brechen den Build mit einer klaren Meldung ab');

  // Die lokale Ausprägung ist unverändert vollständig
  r = run(['--edition', 'local', '--out', path.join(tmp, 'lokal'), '--version', 'v1.0.0']);
  assert.equal(r.status, 0, r.stderr);
  const lokal = path.join(tmp, 'lokal');
  for (const f of ['index.html', 'start.ps1', 'start.cmd', 'README.md', 'NOTICE', 'js/db.js', 'js/local-shell.js', 'js/edition.js', 'vendor/sql.js/sql-asm.js', 'docs/BACKEND.md', 'plugins/plugins.js']) {
    assert.ok(fs.existsSync(path.join(lokal, f)), `lokal: ${f}`);
  }
  const lokalCat = JSON.parse(/NoNotesPlugins\.catalog\((\[[\s\S]*?\])\);/.exec(fs.readFileSync(path.join(lokal, 'plugins', 'plugins.js'), 'utf8'))[1]);
  assert.deepEqual(lokalCat.map(e => e.id), ['datum-einfuegen', 'sepia'], 'die Beispiele stehen im Verzeichnis der lokalen Ausprägung');
  step('Lokale Ausprägung: alle Dateien wie bisher, Beispiele im Verzeichnis');

  // --plugins <Ordner>: Erweiterungen eines anderen Repositorys (Aufbau wie CDRO/NoNotes-plugins: ein Unterordner je Erweiterung)
  const erw = path.join(tmp, 'erweiterungen');
  fs.mkdirSync(path.join(erw, 'ordner'), { recursive: true });
  fs.mkdirSync(path.join(erw, '.git'));
  fs.mkdirSync(path.join(erw, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(erw, 'README.md'), '# Erweiterungen\n'); // direkt im Ordner: bleibt draussen (würde mit plugins/README.md kollidieren)
  fs.writeFileSync(path.join(erw, 'LICENSE'), 'MIT');
  fs.writeFileSync(path.join(erw, 'flach.js'), "NoNotesPlugins.register({ id: 'flach', name: 'Flach', api: 1 });");
  fs.writeFileSync(path.join(erw, '.git', 'HEAD'), 'ref: refs/heads/main');
  fs.writeFileSync(path.join(erw, 'node_modules', 'x', 'index.js'), 'module.exports = 1;');
  fs.writeFileSync(path.join(erw, 'ordner', 'plugin.js'), "const REGELN = [1];\nNoNotesPlugins.register({ id: 'im-ordner', name: 'Im Ordner', version: '2.0', api: 1, description: 'Aus einem Unterordner' });");
  fs.writeFileSync(path.join(erw, 'ordner', 'README.md'), '# Im Ordner\n');
  const mit = path.join(tmp, 'mit-erweiterungen');
  r = run(['--edition', 'local', '--out', mit, '--version', 'v1.0.0', '--plugins', erw]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const f of ['plugins/flach.js', 'plugins/ordner/plugin.js', 'plugins/ordner/README.md', 'plugins/beispiele/sepia.js', 'plugins/plugins.js']) assert.ok(fs.existsSync(path.join(mit, f)), `mit: ${f}`);
  for (const f of ['plugins/LICENSE', 'plugins/.git', 'plugins/node_modules']) assert.ok(!fs.existsSync(path.join(mit, f)), `nicht dabei: ${f}`);
  assert.equal(fs.readFileSync(path.join(mit, 'plugins', 'README.md'), 'utf8'), fs.readFileSync(path.join(ROOT, 'plugins', 'README.md'), 'utf8'), 'die README des Ordners plugins/ bleibt die der App');
  const mitCat = JSON.parse(/NoNotesPlugins\.catalog\((\[[\s\S]*?\])\);/.exec(fs.readFileSync(path.join(mit, 'plugins', 'plugins.js'), 'utf8'))[1]);
  assert.deepEqual(mitCat.map(e => e.file), ['beispiele/datum-einfuegen.js', 'beispiele/sepia.js', 'flach.js', 'ordner/plugin.js']);
  assert.deepEqual(mitCat.find(e => e.file === 'ordner/plugin.js'), { file: 'ordner/plugin.js', id: 'im-ordner', name: 'Im Ordner', version: '2.0', api: 1, description: 'Aus einem Unterordner', theme: false });
  assert.match(r.stdout, /4 Erweiterungen im Verzeichnis/);
  r = run(['--edition', 'local', '--out', mit, '--plugins', path.join(tmp, 'nirgends')]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Ordner mit Erweiterungen fehlt/);
  step('--plugins: Unterordner und .js-Dateien eines weiteren Ordners kommen nach plugins/ und ins Verzeichnis; README, LICENSE, .git und node_modules bleiben draussen');

  console.log('\nBuild-Test bestanden.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
