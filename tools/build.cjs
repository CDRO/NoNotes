#!/usr/bin/env node
/* NoNotes – Build einer Ausprägung.
   Setzt aus den Paketen die auslieferbare Ordnerstruktur zusammen. Es wird nichts übersetzt oder
   gebündelt: Dateien werden kopiert, die Verweise in der index.html auf die flache Struktur umgeschrieben.

   Aufruf:  node tools/build.cjs [--edition local] [--version v1.0.0] [--out dist/NoNotes]

   Ergebnis (Ausprägung "local"), genau das, was im ZIP liegt:
     index.html  css/  js/  lang/  vendor/  start.ps1  start.cmd  README.md
*/
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { edition: 'local', version: 'dev', out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--edition') args.edition = argv[++i];
    else if (a === '--version') args.version = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`Unbekannte Option: ${a}`);
  }
  return args;
}

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const editionDir = path.join(ROOT, 'editions', args.edition);
  if (!fs.existsSync(path.join(editionDir, 'index.html'))) throw new Error(`Ausprägung "${args.edition}" nicht gefunden: ${editionDir}`);
  const out = path.resolve(ROOT, args.out || path.join('dist', 'NoNotes'));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  let html = fs.readFileSync(path.join(editionDir, 'index.html'), 'utf8');
  const copied = new Map(); // Zielpfad → Quelle
  const place = (srcAbs, destRel) => {
    if (!fs.existsSync(srcAbs)) throw new Error(`Datei fehlt: ${path.relative(ROOT, srcAbs)}`);
    const prev = copied.get(destRel);
    if (prev && prev !== srcAbs) throw new Error(`Namenskonflikt im Ziel: ${destRel} aus ${path.relative(ROOT, prev)} und ${path.relative(ROOT, srcAbs)}`);
    copied.set(destRel, srcAbs);
    copy(srcAbs, path.join(out, destRel));
  };

  // Sprachpakete: alle Dateien aus lang/ (ausser Vorlagen mit Unterstrich) werden eingebunden.
  const langDir = path.join(ROOT, 'lang');
  const langFiles = fs.existsSync(langDir)
    ? fs.readdirSync(langDir).filter(f => /^[a-z]{2,3}(-[A-Za-z]{2,4})?\.js$/.test(f)).sort()
    : [];
  const langTags = langFiles.map(f => `  <script src="../../lang/${f}"></script>`).join('\n');
  html = html.replace('<!-- LANG-PACKS -->', langTags || '<!-- keine Sprachpakete -->');

  // Skripte und Stylesheets: flach nach js/ bzw. css/, Fremdbestandteile behalten ihren Pfad.
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    const abs = path.resolve(editionDir, src);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    let dest;
    if (rel.startsWith('vendor/')) dest = rel;
    else if (rel.startsWith('lang/')) dest = rel;
    else dest = 'js/' + path.basename(abs);
    if (path.basename(abs) === 'version.js') {
      fs.mkdirSync(path.join(out, 'js'), { recursive: true });
      fs.writeFileSync(path.join(out, 'js', 'version.js'), `// Von tools/build.cjs gesetzt.\nwindow.NONOTES_VERSION = '${args.version}';\n`);
      copied.set('js/version.js', abs);
    } else {
      place(abs, dest);
    }
    return `<script src="${dest}"></script>`;
  });
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
    const abs = path.resolve(editionDir, href);
    const dest = 'css/' + path.basename(abs);
    place(abs, dest);
    return `<link rel="stylesheet" href="${dest}">`;
  });
  fs.writeFileSync(path.join(out, 'index.html'), html);

  // Weitere Dateien der Ausprägung und des Projekts
  for (const f of ['start.ps1', 'start.cmd']) {
    if (fs.existsSync(path.join(editionDir, f))) place(path.join(editionDir, f), f);
  }
  place(path.join(ROOT, 'README.md'), 'README.md');
  if (fs.existsSync(path.join(ROOT, 'NOTICE'))) place(path.join(ROOT, 'NOTICE'), 'NOTICE');
  // sql.js: nur Lauf-Dateien und Lizenz, keine Archive
  const sqlDir = path.join(ROOT, 'vendor', 'sql.js');
  for (const f of fs.readdirSync(sqlDir)) {
    if (/\.zip$/i.test(f)) continue;
    place(path.join(sqlDir, f), `vendor/sql.js/${f}`);
  }

  // Verweise prüfen: jede in der index.html genannte Datei muss im Ziel liegen.
  for (const m of html.matchAll(/(?:src|href)="((?:js|css|lang|vendor)\/[^"]+)"/g)) {
    if (!fs.existsSync(path.join(out, m[1]))) throw new Error(`Verweis ohne Datei im Ziel: ${m[1]}`);
  }
  console.log(`Gebaut: ${path.relative(ROOT, out)} (Ausprägung ${args.edition}, Version ${args.version}, ${copied.size} Dateien)`);
}

try { main(); } catch (e) { console.error('Build fehlgeschlagen:', e.message); process.exit(1); }
