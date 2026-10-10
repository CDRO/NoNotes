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
  fs.writeFileSync(path.join(ed, 'edition.json'), JSON.stringify({
    id: 'fremd',
    scripts: ['a.js', '@core/packages/core/zip.js', 'sub/b.js'],
    helpStorage: 'hilfe.html',
    files: ['extra.txt'],
    include: ['NOTICE', 'plugins'],
    copy: { daten: 'daten' },
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
  step('Lokale Ausprägung: alle Dateien wie bisher');

  console.log('\nBuild-Test bestanden.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
