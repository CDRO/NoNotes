#!/usr/bin/env node
/* NoNotes – Werkzeug für Sprachpakete.

   node tools/i18n.cjs list                          alle Texte (Schlüssel) mit Fundstellen
   node tools/i18n.cjs check [--strict]              Sprachpakete in lang/ prüfen
   node tools/i18n.cjs init <code> <Name> [<locale>] neues Sprachpaket lang/<code>.js anlegen
   node tools/i18n.cjs update <code>                 Sprachpaket mit dem Quelltext abgleichen
   node tools/i18n.cjs lint                          deutsche Texte im Quelltext, die nicht durch t() laufen

   Der deutsche Text ist der Schlüssel. Gesammelt wird aus dem Quelltext (Aufrufe t('…'), tn('…', '…', n),
   N_('…')) und aus dem festen Markup der Seite (über den Browser, wie translateDom es später ersetzt).
   Beschreibung: docs/LANGUAGES.md */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LANG_DIR = path.join(ROOT, 'lang');
const SOURCE_DIRS = ['packages', 'editions'];
const SKIP_FILES = new Set(['packages/core/i18n.js']);

// ---------- Quelltext lesen ----------

function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function unescapeLiteral(body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, c) => {
    if (c[0] === 'u') return String.fromCodePoint(parseInt(c.replace(/^u\{?|\}$/g, ''), 16));
    if (c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[c] ?? c;
  });
}

/** Liest ein Textliteral ab Position i (Anführungszeichen ' " oder `). Gibt { value, end } oder null. */
function readLiteral(src, i) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (q === '`' && c === '$' && src[j + 1] === '{') return { dynamic: true, end: j };
    if (c === q) return { value: unescapeLiteral(src.slice(i + 1, j)), end: j + 1 };
    if (c === '\n' && q !== '`') return null;
    j++;
  }
  return null;
}

const skipSpace = (src, i) => { while (/\s/.test(src[i] || '')) i++; return i; };

function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

function scanSource() {
  const keys = new Map();   // Schlüssel → { other?: string, where: [] }
  const problems = [];
  const add = (key, where, other) => {
    if (!keys.has(key)) keys.set(key, { other: null, where: [] });
    const entry = keys.get(key);
    entry.where.push(where);
    if (other != null) {
      if (entry.other != null && entry.other !== other) problems.push(`${where}: Mehrzahl zu «${key}» weicht von einer früheren Stelle ab`);
      entry.other = other;
    }
  };
  const call = /(?:(?<![\w$.])|(?<=I18n\.))(tn|t|N_)\s*\(/g;
  for (const dir of SOURCE_DIRS) {
    const base = path.join(ROOT, dir);
    if (!fs.existsSync(base)) continue;
    for (const file of listJs(base)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (SKIP_FILES.has(rel)) continue;
      const src = fs.readFileSync(file, 'utf8');
      let m;
      call.lastIndex = 0;
      while ((m = call.exec(src))) {
        const name = m[1];
        const where = `${rel}:${lineOf(src, m.index)}`;
        const before = src.slice(Math.max(0, m.index - 12), m.index);
        if (/(function|const|let|var)\s+$/.test(before)) continue; // Definition, kein Aufruf
        let i = skipSpace(src, m.index + m[0].length);
        const first = readLiteral(src, i);
        if (!first || first.dynamic) {
          if (src[i] === ')' || src[i] === '.') continue;
          if (/i18n-dynamic/.test(src.split('\n')[lineOf(src, m.index) - 1])) continue; // Schlüssel aus einer Tabelle mit N_()
          problems.push(`${where}: ${name}() braucht ein Textliteral als Schlüssel`);
          continue;
        }
        if (name === 'tn') {
          i = skipSpace(src, first.end);
          if (src[i] !== ',') { problems.push(`${where}: tn() braucht Einzahl, Mehrzahl und Zahl`); continue; }
          i = skipSpace(src, i + 1);
          const second = readLiteral(src, i);
          if (!second || second.dynamic) { problems.push(`${where}: tn() braucht die Mehrzahl als Textliteral`); continue; }
          add(first.value, where, second.value);
        } else {
          add(first.value, where, null);
        }
      }
    }
  }
  return { keys, problems };
}

// ---------- Festes Markup über den Browser ----------

function scanMarkup() {
  const script = `
    const path = require('node:path');
    let pw; try { pw = require('playwright'); } catch (e) { if (process.env.PLAYWRIGHT_MODULE) pw = require(process.env.PLAYWRIGHT_MODULE); else throw e; }
    (async () => {
      const browser = await pw.chromium.launch();
      const page = await browser.newPage();
      await page.goto('file://' + path.join(${JSON.stringify(ROOT)}, 'dist', 'NoNotes', 'index.html'));
      await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
      // Ausgangszustand des Markups: die gebaute index.html, nicht die schon laufende Seite
      const html = require('node:fs').readFileSync(path.join(${JSON.stringify(ROOT)}, 'dist', 'NoNotes', 'index.html'), 'utf8');
      const keys = await page.evaluate(h => {
        const doc = new DOMParser().parseFromString(h, 'text/html');
        return window.NoNotesI18n.collect(doc.body);
      }, html);
      console.log(JSON.stringify(keys));
      await browser.close();
    })().catch(e => { console.error(e); process.exit(1); });
  `;
  const r = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('Das Markup konnte nicht gelesen werden (Browser nötig):\n' + (r.stderr || r.stdout));
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function ensureBuilt() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.cjs')], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Build fehlgeschlagen:\n' + r.stderr + r.stdout);
}

function collectAll() {
  ensureBuilt();
  const { keys, problems } = scanSource();
  for (const key of scanMarkup()) {
    if (!keys.has(key)) keys.set(key, { other: null, where: [] });
    keys.get(key).where.push('Markup');
  }
  return { keys, problems };
}

// ---------- Sprachpakete lesen und schreiben ----------

function loadPack(file) {
  const registered = [];
  const sandbox = { NoNotesI18n: { register: (code, name, messages, options) => registered.push({ code, name, messages, options: options || {} }) } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  if (registered.length !== 1) throw new Error(`${path.relative(ROOT, file)}: genau ein register()-Aufruf erwartet`);
  return registered[0];
}

function packFiles() {
  if (!fs.existsSync(LANG_DIR)) return [];
  return fs.readdirSync(LANG_DIR).filter(f => /^[a-z]{2,3}(-[A-Za-z]{2,4})?\.js$/.test(f)).sort();
}

// {n} ist in tn() immer gesetzt und darf in jeder Form stehen oder fehlen (zum Beispiel «Eine Notiz»).
const placeholders = (text, plural) => [...new Set([...String(text).matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map(m => m[1]))]
  .filter(p => !(plural && p === 'n')).sort().join(',');

function quote(s) {
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'";
}

function pluralCategories(locale) {
  try { return new Intl.PluralRules(locale).resolvedOptions().pluralCategories; }
  catch (e) { return ['one', 'other']; }
}

function writePack(file, code, name, locale, keys, existing) {
  const cats = pluralCategories(locale);
  const lines = [];
  lines.push(`/* NoNotes – Sprachpaket ${name} (${code}). Mit tools/i18n.cjs erzeugt und abgeglichen; siehe docs/LANGUAGES.md.`);
  lines.push('   Schlüssel ist der deutsche Text. Leer lassen, was nicht übersetzt ist: dann erscheint der deutsche Text. */');
  lines.push(`NoNotesI18n.register(${quote(code)}, ${quote(name)}, {`);
  for (const [key, info] of keys) {
    const old = existing ? existing[key] : undefined;
    if (info.other != null) {
      const o = old && typeof old === 'object' ? old : {};
      const parts = cats.map(c => `${c}: ${quote(o[c] || '')}`);
      lines.push(`  ${quote(key)}: { ${parts.join(', ')} },`);
    } else {
      lines.push(`  ${quote(key)}: ${quote(typeof old === 'string' ? old : '')},`);
    }
  }
  lines.push(`}, { locale: ${quote(locale)} });`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}


// ---------- Lint: deutsche Texte ausserhalb von t() ----------

const GERMAN = /[äöüÄÖÜß„“«»]|\b(und|oder|der|die|das|den|dem|ein|eine|einen|nicht|kein|keine|mit|für|von|zu|wird|werden|wurde|ist|sind|Notiz|Notizen|Aufgabe|Aufgaben|Frage|Fragen|Datei|Fehler|Neue|Neu|Alle|Keine|Ohne|Bitte|bis|aus|im|in|am|auf|noch|nur|als|wie|auch|Archiv|Antwort|Tag|Tags|offen|offene|erledigt|Treffer|Gelöscht|Archiviert|Erstellt|Geändert|Titel|Pfad|Termin|Termine|Unteraufgabe|Unteraufgaben|Unternotiz|Unternotizen)\b/;
const SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|PRAGMA|EXISTS|DROP|WITH|n\.id|\(length|CASE)\b|\bFROM\b|\bWHERE\b/;
const SINGLE_WORD = /^[A-ZÄÖÜ][a-zäöüß…]{2,}…?$/;
const TECH_WORDS = new Set(['Enter', 'Escape', 'Tab', 'Delete', 'Backspace', 'Shift', 'Control', 'Alt', 'Meta', 'Home', 'End', 'Space', 'Event', 'Error', 'Files', 'Content', 'Accept', 'Mindmap']);

function lint() {
  const acorn = require('acorn');
  const problems = [];
  const walk = (node, ancestors, visit) => {
    if (!node || typeof node.type !== 'string') return;
    visit(node, ancestors);
    ancestors.push(node);
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, ancestors, visit));
      else if (v && typeof v.type === 'string') walk(v, ancestors, visit);
    }
    ancestors.pop();
  };
  for (const dir of SOURCE_DIRS) {
    const base = path.join(ROOT, dir);
    if (!fs.existsSync(base)) continue;
    for (const file of listJs(base)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (SKIP_FILES.has(rel)) continue;
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split('\n');
      const ast = acorn.parse(src, { ecmaVersion: 2022, locations: true });
      walk(ast, [], (node, anc) => {
        const parent = anc[anc.length - 1];
        const isLit = node.type === 'Literal' && typeof node.value === 'string';
        const isTpl = node.type === 'TemplateLiteral';
        if (!isLit && !isTpl) return;
        const isT = c => (c.type === 'Identifier' && ['t', 'tn', 'N_'].includes(c.name))
          || (c.type === 'MemberExpression' && /I18n$/.test(c.object.name || '') && ['t', 'tn'].includes(c.property.name));
        if (anc.some(a => a.type === 'CallExpression' && (isT(a.callee) || (a.callee.type === 'Identifier' && a.callee.name === 'fail')))) return; // fail(): Rückfallmeldung des Datenbackends
        if (anc.some(a => a.type === 'CallExpression' && a.callee.type === 'MemberExpression' && a.callee.object.name === 'console')) return;
        if (parent && parent.type === 'Property' && parent.key === node) return;
        if (parent && parent.type === 'MemberExpression' && parent.property === node) return;
        if (parent && (parent.type === 'SwitchCase' || parent.type === 'ImportDeclaration')) return;
        if (parent && parent.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(parent.operator)) return;
        const line = node.loc.start.line;
        if (/i18n-ignore/.test(lines[line - 1] || '')) return;
        let text;
        if (isLit) text = node.value;
        else {
          if (/<[a-z]/.test(src.slice(node.start, node.end))) return; // Markup-Vorlagen
          text = node.quasis.map(q => q.value.cooked).join('§');
        }
        if (SQL.test(text) || !/[A-Za-zÄÖÜäöüß]/.test(text)) return;
        const german = GERMAN.test(text);
        const word = isLit && SINGLE_WORD.test(text) && !TECH_WORDS.has(text);
        if (!german && !word) return;
        problems.push(`${rel}:${line}: deutscher Text ausserhalb von t(): ${JSON.stringify(text.slice(0, 70))}`);
      });
    }
  }
  for (const p of problems) console.error('Fehler: ' + p);
  console.log(problems.length ? `\n${problems.length} Stellen` : 'Alle festen Texte laufen über t()/tn()/N_()');
  return problems.length ? 1 : 0;
}

// ---------- Befehle ----------

function cmdList() {
  const { keys, problems } = collectAll();
  for (const [key, info] of keys) console.log(`${info.other != null ? '[Mehrzahl] ' : ''}${JSON.stringify(key)}  ← ${info.where.slice(0, 2).join(', ')}${info.where.length > 2 ? ` (+${info.where.length - 2})` : ''}`);
  console.log(`\n${keys.size} Texte`);
  for (const p of problems) console.error('Problem: ' + p);
  return problems.length ? 1 : 0;
}

function cmdCheck(strict) {
  const { keys, problems } = collectAll();
  let errors = problems.slice();
  const warnings = [];
  for (const [key, info] of keys) {
    if (info.other != null && placeholders(key, true) !== placeholders(info.other, true)) errors.push(`Platzhalter in Einzahl und Mehrzahl verschieden: «${key}»`);
  }
  for (const f of packFiles()) {
    const file = path.join(LANG_DIR, f);
    let pack;
    try { pack = loadPack(file); } catch (e) { errors.push(`${f}: ${e.message}`); continue; }
    const code = f.replace(/\.js$/, '');
    if (pack.code !== code) errors.push(`${f}: Kennung «${pack.code}» passt nicht zum Dateinamen`);
    if (pack.options.source) { console.log(`${f}: Quellsprache (${keys.size} Texte)`); continue; }
    const locale = pack.options.locale || pack.code;
    const cats = new Set(pluralCategories(locale));
    let done = 0;
    for (const [key, value] of Object.entries(pack.messages)) {
      const info = keys.get(key);
      if (!info) { (strict ? errors : warnings).push(`${f}: unbekannter (veralteter) Schlüssel «${key}»`); continue; }
      if (info.other != null) {
        if (!value || typeof value !== 'object') { errors.push(`${f}: «${key}» braucht ein Objekt mit Mehrzahlformen`); continue; }
        for (const c of Object.keys(value)) if (!cats.has(c)) errors.push(`${f}: «${key}»: Kategorie «${c}» gibt es in ${locale} nicht`);
        if (value.other === undefined) { warnings.push(`${f}: «${key}»: Form «other» fehlt`); continue; }
        let complete = true;
        for (const c of cats) {
          if (!value[c]) { complete = false; continue; }
          const want = placeholders(info.other, true);
          if (placeholders(value[c], true) !== want) errors.push(`${f}: «${key}» [${c}]: Platzhalter {${placeholders(value[c], true)}} statt {${want}}`);
        }
        if (complete) done++;
      } else {
        if (typeof value !== 'string') { errors.push(`${f}: «${key}» muss ein Text sein`); continue; }
        if (value === '') continue;
        if (placeholders(value) !== placeholders(key)) errors.push(`${f}: «${key}»: Platzhalter {${placeholders(value)}} statt {${placeholders(key)}}`);
        done++;
      }
    }
    const missing = keys.size - done;
    console.log(`${f}: ${done} von ${keys.size} Texten übersetzt${missing ? `, ${missing} fehlen` : ''}`);
    if (missing && strict) errors.push(`${f}: ${missing} Texte nicht übersetzt (--strict)`);
  }
  for (const w of warnings) console.warn('Warnung: ' + w);
  for (const e of errors) console.error('Fehler: ' + e);
  console.log(errors.length ? `\n${errors.length} Fehler` : '\nSprachpakete in Ordnung');
  return errors.length ? 1 : 0;
}

function cmdInit(args) {
  const [code, name, locale] = args;
  if (!code || !name || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(code)) {
    console.error('Aufruf: node tools/i18n.cjs init <code> <Name> [<locale>]   zum Beispiel: init en English en');
    return 2;
  }
  const file = path.join(LANG_DIR, `${code}.js`);
  if (fs.existsSync(file)) { console.error(`${path.relative(ROOT, file)} gibt es schon; mit «update ${code}» abgleichen.`); return 2; }
  const { keys, problems } = collectAll();
  if (problems.length) { problems.forEach(p => console.error('Problem: ' + p)); return 1; }
  fs.mkdirSync(LANG_DIR, { recursive: true });
  writePack(file, code, name, locale || code, keys, null);
  console.log(`${path.relative(ROOT, file)} angelegt mit ${keys.size} Texten. Übersetzungen eintragen, dann «check» ausführen.`);
  return 0;
}

function cmdUpdate(args) {
  const [code] = args;
  const file = path.join(LANG_DIR, `${code}.js`);
  if (!code || !fs.existsSync(file)) { console.error('Aufruf: node tools/i18n.cjs update <code>'); return 2; }
  const pack = loadPack(file);
  if (pack.options.source) { console.error('Die Quellsprache braucht keinen Abgleich.'); return 2; }
  const { keys, problems } = collectAll();
  if (problems.length) { problems.forEach(p => console.error('Problem: ' + p)); return 1; }
  const added = [...keys.keys()].filter(k => !(k in pack.messages));
  const dropped = Object.keys(pack.messages).filter(k => !keys.has(k));
  writePack(file, pack.code, pack.name, pack.options.locale || pack.code, keys, pack.messages);
  console.log(`${path.relative(ROOT, file)}: ${added.length} neue Texte, ${dropped.length} veraltete entfernt`);
  for (const k of dropped) console.log('  entfernt: ' + JSON.stringify(k));
  return 0;
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'list': return cmdList();
    case 'check': return cmdCheck(args.includes('--strict'));
    case 'init': return cmdInit(args);
    case 'update': return cmdUpdate(args);
    case 'lint': return lint();
    default:
      console.error('Aufruf: node tools/i18n.cjs list | check [--strict] | init <code> <Name> [<locale>] | update <code> | lint');
      return 2;
  }
}

process.exit(main());
