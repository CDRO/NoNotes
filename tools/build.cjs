#!/usr/bin/env node
/* NoNotes – Build einer Ausprägung.
   Setzt aus den Paketen die auslieferbare Ordnerstruktur zusammen. Es wird nichts übersetzt oder
   gebündelt: Dateien werden kopiert, die Verweise in der index.html auf die flache Struktur umgeschrieben.

   Aufruf:  node tools/build.cjs [--edition local | --edition-dir <Ordner>] [--version v1.0.0] [--out dist/NoNotes]

   Die Seite ist eine gemeinsame Vorlage (packages/ui/index.html) mit zwei Platzhaltern für die Ausprägung:
     <!-- EDITION-SCRIPTS -->        die Skripte der Ausprägung (Hülle, Backend ...)
     <!-- EDITION-HELP-STORAGE -->   der Abschnitt «Wo liegen meine Notizen?» der Hilfe
   Eine Ausprägung ist ein Ordner mit edition.json:
     { "id": "local",
       "scripts": ["@core/packages/data/db.js", "edition.js"],   @core/ = Wurzel dieses Projekts, sonst relativ zum Ordner
       "helpStorage": "help-storage.html",                       HTML-Abschnitt für die Hilfe (Datenablage)
       "files": ["start.ps1"],                                   Dateien des Ordners, die ins Ergebnis kommen
       "include": ["README.md", "NOTICE", "docs", "plugins", "vendor/sql.js"] }   Teile des Projekts, die mitgehen
   Der Ordner darf ausserhalb dieses Projekts liegen (--edition-dir); sein Name im Ergebnis ist js/<Dateiname>.

   Ergebnis (Ausprägung "local"), genau das, was im ZIP liegt:
     index.html  css/  js/  lang/  vendor/  docs/  start.ps1  start.cmd  README.md  NOTICE
*/
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'packages', 'ui', 'index.html');

function parseArgs(argv) {
  const args = { edition: 'local', editionDir: null, version: 'dev', out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--edition') args.edition = argv[++i];
    else if (a === '--edition-dir') args.editionDir = path.resolve(argv[++i]);
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

/** Alle Dateien unter dir, relativ zu base, mit / als Trenner. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const editionDir = args.editionDir || path.join(ROOT, 'editions', args.edition);
  const manifestFile = path.join(editionDir, 'edition.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`Ausprägung nicht gefunden (edition.json fehlt): ${editionDir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const templateDir = path.dirname(TEMPLATE);
  const out = path.resolve(ROOT, args.out || path.join('dist', 'NoNotes'));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  let html = fs.readFileSync(TEMPLATE, 'utf8');
  const copied = new Map(); // Zielpfad → Quelle
  const place = (srcAbs, destRel) => {
    if (!fs.existsSync(srcAbs)) throw new Error(`Datei fehlt: ${path.relative(ROOT, srcAbs)}`);
    const prev = copied.get(destRel);
    if (prev && prev !== srcAbs) throw new Error(`Namenskonflikt im Ziel: ${destRel} aus ${path.relative(ROOT, prev)} und ${path.relative(ROOT, srcAbs)}`);
    copied.set(destRel, srcAbs);
    copy(srcAbs, path.join(out, destRel));
  };
  const fromTemplate = abs => path.relative(templateDir, abs).split(path.sep).join('/');
  const slot = (name, text) => {
    const marker = `<!-- ${name} -->`;
    if (html.split(marker).length !== 2) throw new Error(`Platzhalter ${marker} fehlt oder kommt mehrfach vor in ${path.relative(ROOT, TEMPLATE)}`);
    html = html.replace(marker, () => text);
  };

  // Skripte der Ausprägung (@core/ = Wurzel des Projekts, sonst relativ zum Ordner der Ausprägung)
  const scriptTags = (manifest.scripts || []).map(src => {
    const abs = src.startsWith('@core/') ? path.join(ROOT, src.slice(6)) : path.resolve(editionDir, src);
    return `<script src="${fromTemplate(abs)}"></script>`;
  });
  slot('EDITION-SCRIPTS', scriptTags.join('\n  ') || '<!-- keine Skripte der Ausprägung -->');

  // Hilfeabschnitt «Datenablage»: aus der Ausprägung, sonst ein Hinweis, dass sie keinen mitbringt
  const helpFile = manifest.helpStorage ? path.join(editionDir, manifest.helpStorage) : null;
  if (helpFile && !fs.existsSync(helpFile)) throw new Error(`Hilfeabschnitt fehlt: ${helpFile}`);
  slot('EDITION-HELP-STORAGE', helpFile ? fs.readFileSync(helpFile, 'utf8').replace(/^\s+/, '').replace(/\s+$/, '') : '');

  // Sprachpakete: alle Dateien aus lang/ (ausser Vorlagen mit Unterstrich) werden eingebunden.
  const langDir = path.join(ROOT, 'lang');
  const langFiles = fs.existsSync(langDir)
    ? fs.readdirSync(langDir).filter(f => /^[a-z]{2,3}(-[A-Za-z]{2,4})?\.js$/.test(f)).sort()
    : [];
  const langTags = langFiles.map(f => `  <script src="${fromTemplate(path.join(langDir, f))}"></script>`).join('\n');
  html = html.replace('<!-- LANG-PACKS -->', langTags || '<!-- keine Sprachpakete -->');

  // Skripte und Stylesheets: flach nach js/ bzw. css/, Fremdbestandteile behalten ihren Pfad.
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    const abs = path.resolve(templateDir, src);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    let dest;
    if (rel.startsWith('vendor/')) dest = rel;
    else if (rel.startsWith('lang/')) dest = rel;
    else if (rel.startsWith('plugins/')) dest = rel; // Liste der Erweiterungen: der Ordner wird unten ganz kopiert
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
    const abs = path.resolve(templateDir, href);
    const dest = 'css/' + path.basename(abs);
    place(abs, dest);
    return `<link rel="stylesheet" href="${dest}">`;
  });
  fs.writeFileSync(path.join(out, 'index.html'), html);

  // Weitere Dateien der Ausprägung und des Projekts
  for (const f of manifest.files || []) place(path.join(editionDir, f), f);
  const include = new Set(manifest.include || []);
  if (include.has('README.md')) place(path.join(ROOT, 'README.md'), 'README.md');
  if (include.has('NOTICE') && fs.existsSync(path.join(ROOT, 'NOTICE'))) place(path.join(ROOT, 'NOTICE'), 'NOTICE');
  const docsDir = path.join(ROOT, 'docs'); // die README verweist auf diese Dokumente
  if (include.has('docs') && fs.existsSync(docsDir)) for (const f of fs.readdirSync(docsDir).filter(f => f.endsWith('.md')).sort()) place(path.join(docsDir, f), `docs/${f}`);
  // sql.js: nur Lauf-Dateien und Lizenz, keine Archive
  if (include.has('vendor/sql.js')) {
    const sqlDir = path.join(ROOT, 'vendor', 'sql.js');
    for (const f of fs.readdirSync(sqlDir)) {
      if (/\.zip$/i.test(f)) continue;
      place(path.join(sqlDir, f), `vendor/sql.js/${f}`);
    }
  }

  // Erweiterungen: Liste, Anleitung und Beispiele; der Benutzer ergänzt hier seine eigenen Dateien
  const pluginsDir = path.join(ROOT, 'plugins');
  if (include.has('plugins') && fs.existsSync(pluginsDir)) {
    for (const abs of walk(pluginsDir)) place(abs, path.relative(ROOT, abs).split(path.sep).join('/'));
  }

  // Weitere Dateien, die die Ausprägung mitbringen will (Ordner relativ zu ihrem Ordner)
  for (const [destRel, srcRel] of Object.entries(manifest.copy || {})) {
    const srcAbs = path.resolve(editionDir, srcRel);
    if (fs.statSync(srcAbs).isDirectory()) for (const abs of walk(srcAbs)) place(abs, path.posix.join(destRel, path.relative(srcAbs, abs).split(path.sep).join('/')));
    else place(srcAbs, destRel);
  }

  // Verweise prüfen: jede in der index.html genannte Datei muss im Ziel liegen.
  for (const m of html.matchAll(/(?:src|href)="((?:js|css|lang|vendor|plugins)\/[^"]+)"/g)) {
    if (!fs.existsSync(path.join(out, m[1]))) throw new Error(`Verweis ohne Datei im Ziel: ${m[1]}`);
  }
  console.log(`Gebaut: ${path.relative(ROOT, out)} (Ausprägung ${manifest.id || args.edition}, Version ${args.version}, ${copied.size} Dateien)`);
}

try { main(); } catch (e) { console.error('Build fehlgeschlagen:', e.message); process.exit(1); }
