#!/usr/bin/env node
/* NoNotes – MCP-Server für den eigenen Rechner (docs/AGENTS.md). i18n-ignore-file: Texte für Agenten sind englisch (Katalog),
   die Meldungen dieser Befehlszeile deutsch; Sprachpakete gibt es hier nicht.

   Ein Agent auf dem eigenen Rechner (Claude Code, VS Code mit GitHub Copilot, Claude Desktop, Copilot CLI …) startet dieses
   Programm und spricht mit ihm MCP über die Standardeingabe und -ausgabe (eine JSON-Nachricht je Zeile). Das Programm arbeitet
   auf derselben NoNotes.sqlite wie die App im Browser: vor jedem Aufruf prüft es, ob die Datei sich geändert hat (Grösse,
   Zeitstempel, Prüfsumme), und liest sie dann neu; nach einer Änderung schreibt es die Datei atomar (temporäre Datei, umbenennen),
   unter einer Sperre (NoNotes.sqlite.lock), damit zwei Agenten sich nicht überschreiben. Die App merkt die Änderung von aussen
   und lädt sie nach. Alle Meldungen gehen auf die Fehlerausgabe; auf der Standardausgabe stehen nur MCP-Antworten.

   Aufruf:  node agent/nonotes-mcp.cjs --file <Pfad zur NoNotes.sqlite> [--file <weitere>] [--dir <Ordner>] [--templates <Ordner>] [--read-only] [--create] [--verbose]
            node agent/nonotes-mcp.cjs --config [<Datei> …] [--dir <Ordner>]   Einträge für Claude Code, VS Code, Claude Desktop, Copilot CLI
            node agent/nonotes-mcp.cjs --help | --version
   Mehrere Dateien (Bereiche der App, ab v2.3.0): jede wird ein «workspace» mit der Kennung aus ihrem Namen (Arbeit.sqlite → arbeit);
   die Werkzeuge nehmen dann den Parameter workspace, list_workspaces nennt die Dateien. Mit einer Datei bleibt alles wie zuvor.
   Braucht Node 18 oder neuer, sonst nichts: der Kern (js/) und sql.js (vendor/) liegen im selben Ordner wie die App. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const readline = require('node:readline');

const HERE = __dirname;
const CORE_FILES = ['i18n', 'history', 'placeholders', 'dates', 'questions', 'tables', 'tasks', 'links', 'backend', 'merge', 'templates', 'db', 'backend-local', 'catalog', 'protocol'];
const PACKAGE_OF = { i18n: 'core', history: 'core', placeholders: 'core', dates: 'core', questions: 'core', tables: 'core', tasks: 'core', links: 'core', backend: 'core', merge: 'core', templates: 'core', db: 'data', 'backend-local': 'store-local', catalog: 'agent', protocol: 'agent' };
const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 30000;
const READ_RETRIES = 5;

// ---------- Wo liegt der Kern? Im ausgelieferten Ordner (agent/ neben js/ und vendor/) oder im Quelltext (editions/local/agent/) ----------

function layout() {
  const dist = path.resolve(HERE, '..');
  if (fs.existsSync(path.join(dist, 'js', 'db.js'))) {
    let version = 'dev';
    try { version = (/NONOTES_VERSION\s*=\s*'([^']*)'/.exec(fs.readFileSync(path.join(dist, 'js', 'version.js'), 'utf8')) || [])[1] || 'dev'; } catch (e) { /* ohne Version */ }
    return { js: name => path.join(dist, 'js', `${name}.js`), sql: path.join(dist, 'vendor', 'sql.js', 'sql-asm.js'), version };
  }
  const root = path.resolve(HERE, '..', '..', '..');
  return { js: name => path.join(root, 'packages', PACKAGE_OF[name], `${name}.js`), sql: path.join(root, 'vendor', 'sql.js', 'sql-asm.js'), version: 'dev' };
}

async function loadCore() {
  const where = layout();
  const sandbox = { console: { log: () => {}, info: () => {}, warn: (...a) => console.error(...a), error: (...a) => console.error(...a) } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  for (const name of CORE_FILES) {
    const file = where.js(name);
    if (!fs.existsSync(file)) throw new Error(`Datei des Kerns fehlt: ${file}`);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  const SQL = await require(where.sql)();
  return { SQL, DB: sandbox.NoNotesDB, Backend: sandbox.NoNotesBackend, BackendLocal: sandbox.NoNotesBackendLocal, Agent: sandbox.NoNotesAgent, Mcp: sandbox.NoNotesMcp, Templates: sandbox.NoNotesTemplates, version: where.version };
}

// ---------- Vorlagen: die .md-Dateien eines Ordners (Standard: templates/ neben der App), nur lesen ----------

/** Ordner mit Vorlagen: --templates, sonst templates/ neben der App (ausgeliefert) oder im Projekt; null, wenn keiner da ist. */
function templatesDir(arg) {
  if (arg) return path.resolve(arg);
  for (const dir of [path.resolve(HERE, '..', 'templates'), path.resolve(HERE, '..', '..', '..', 'templates')]) if (fs.existsSync(dir)) return dir;
  return null;
}

/** Dieselbe Schnittstelle wie shell.templates in der App, nur lesend: list(), get(id), context(). area: Name des Bereichs. */
function folderTemplates(core, dir, area) {
  const files = () => {
    try { return fs.readdirSync(dir).filter(n => /\.(md|markdown)$/i.test(n) && !n.startsWith('.') && !/^(readme|liesmich)\.md$/i.test(n)).sort((a, b) => a.localeCompare(b)); } catch (e) { return []; }
  };
  const read = name => {
    const file = path.join(dir, name);
    if (path.dirname(file) !== dir || !fs.existsSync(file) || fs.statSync(file).size > 1024 * 1024) throw Object.assign(new Error('Template not found.'), { code: 'TEMPLATE_NOT_FOUND' });
    return core.Templates.parse(fs.readFileSync(file, 'utf8'), name);
  };
  return {
    list: async () => files().map(name => { const t = read(name); return { id: name, name: t.name, description: t.description, notes: t.notes.length }; }),
    get: async id => read(path.basename(String(id))),
    context: () => ({ area }),
  };
}

// ---------- Die Datei: lesen, Änderungen erkennen, atomar schreiben, Sperre ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hashOf = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

class FileStore {
  constructor(o) {
    this.file = path.resolve(o.file);
    this.lockFile = this.file + '.lock';
    this.core = o.core;
    this.readOnly = !!o.readOnly;
    this.log = o.log || (() => {});
    this.db = null;
    this.stamp = null; // { size, mtimeMs, hash } des Stands, den wir zuletzt gelesen oder geschrieben haben
  }

  async readBytes() {
    let lastError = null;
    for (let i = 0; i < READ_RETRIES; i++) {
      try {
        const bytes = fs.readFileSync(this.file);
        const stat = fs.statSync(this.file);
        return { bytes, stat };
      } catch (e) { lastError = e; await sleep(50); } // die App schreibt gerade: gleich noch einmal
    }
    throw lastError;
  }

  _open(bytes) {
    const { DB, SQL } = this.core;
    const db = DB.open(SQL, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    if (this.db) { try { this.db.close(); } catch (e) { /* egal */ } }
    this.db = db;
  }

  async open() {
    const { bytes, stat } = await this.readBytes();
    let lastError = null;
    for (let i = 0; i < READ_RETRIES; i++) {
      try { this._open(bytes); lastError = null; break; } catch (e) {
        if (e && (e.code === 'NOT_NONOTES_FILE' || e.code === 'SCHEMA_TOO_NEW')) throw e;
        lastError = e; // halb geschriebene Datei: noch einmal lesen
        await sleep(100);
        const again = await this.readBytes();
        bytes.set ? Object.assign(bytes, again.bytes) : null;
      }
    }
    if (lastError) throw lastError;
    this.stamp = { size: stat.size, mtimeMs: stat.mtimeMs, hash: hashOf(bytes) };
  }

  create() {
    const { DB, SQL } = this.core;
    this.db = DB.open(SQL, null);
    this.write();
  }

  /** Hat jemand anders die Datei geändert? Dann neu lesen. Gibt true zurück, wenn der Stand neu ist. */
  async refresh() {
    let stat;
    try { stat = fs.statSync(this.file); } catch (e) { throw Object.assign(new Error(`Die Datei ist weg: ${this.file}`), { code: 'FILE_GONE' }); }
    if (this.stamp && stat.size === this.stamp.size && stat.mtimeMs === this.stamp.mtimeMs) return false;
    const { bytes, stat: fresh } = await this.readBytes();
    const hash = hashOf(bytes);
    if (this.stamp && hash === this.stamp.hash) { this.stamp = { size: fresh.size, mtimeMs: fresh.mtimeMs, hash }; return false; } // nur der Zeitstempel
    this._open(bytes);
    this.stamp = { size: fresh.size, mtimeMs: fresh.mtimeMs, hash };
    this.log('Datei von aussen geändert, neu gelesen');
    return true;
  }

  /** Schreibt den Stand atomar: temporäre Datei daneben, dann umbenennen. */
  write() {
    if (this.readOnly) throw Object.assign(new Error('Nur lesen.'), { code: 'READ_ONLY' });
    const bytes = Buffer.from(this.core.DB.exportBytes(this.db));
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, this.file);
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { /* schon umbenannt */ }
    }
    const stat = fs.statSync(this.file);
    this.stamp = { size: stat.size, mtimeMs: stat.mtimeMs, hash: hashOf(bytes) };
  }

  /** Sperre für Schreibvorgänge (NoNotes.sqlite.lock, exklusiv angelegt). Eine verwaiste Sperre verfällt nach 30 Sekunden. */
  async locked(fn) {
    const started = Date.now();
    for (;;) {
      try { fs.writeFileSync(this.lockFile, String(process.pid), { flag: 'wx' }); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try { if (Date.now() - fs.statSync(this.lockFile).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(this.lockFile); continue; } } catch (e2) { /* schon weg */ }
        if (Date.now() - started > LOCK_TIMEOUT_MS) throw Object.assign(new Error('Ein anderes Programm hält die Datei gesperrt (NoNotes.sqlite.lock).'), { code: 'LOCKED' });
        await sleep(LOCK_WAIT_MS);
      }
    }
    try { return await fn(); }
    finally { try { fs.unlinkSync(this.lockFile); } catch (e) { /* egal */ } }
  }
}

/** Der Katalog, geschützt: lesende Werkzeuge nach einem Blick auf die Datei, schreibende unter der Sperre mit Schreiben danach.
 *  Hat die App zwischen Lesen und Schreiben die Datei geändert, läuft das Werkzeug auf dem frischen Stand noch einmal. */
function guardedCatalog(catalog, store, log) {
  const readOnlyTools = new Set(catalog.list().filter(t => t.annotations.readOnlyHint).map(t => t.name));
  async function call(name, input) {
    if (!catalog.has(name)) return catalog.call(name, input);
    if (readOnlyTools.has(name) || store.readOnly) { await store.refresh(); return catalog.call(name, input); }
    return store.locked(async () => {
      for (let attempt = 0; ; attempt++) {
        await store.refresh();
        const before = store.stamp;
        const r = await catalog.call(name, input);
        if (r.isError) return r;
        const stat = fs.statSync(store.file);
        if (stat.size !== before.size || stat.mtimeMs !== before.mtimeMs) {
          if (attempt === 0) { log('Datei wurde während des Aufrufs geändert, Aufruf wird wiederholt'); continue; }
          return { content: [{ type: 'text', text: 'Error (FILE_CHANGED): The file was changed by another program while writing; please retry.' }], structuredContent: { error: { code: 'FILE_CHANGED' } }, isError: true };
        }
        store.write();
        return r;
      }
    });
  }
  return {
    readOnly: catalog.readOnly, instructions: catalog.instructions,
    list: () => catalog.list(), has: n => catalog.has(n), call,
    resources: () => catalog.resources(), resourceTemplates: () => catalog.resourceTemplates(),
    readResource: async uri => { await store.refresh(); return catalog.readResource(uri); },
  };
}

// ---------- Befehlszeile ----------

function usage() {
  return [
    'NoNotes als MCP-Server für Agenten auf diesem Rechner (Claude Code, VS Code mit Copilot, Claude Desktop, Copilot CLI).',
    '',
    'Aufruf:',
    '  node agent/nonotes-mcp.cjs --file <Pfad zur NoNotes.sqlite> [--file …] [--dir <Ordner>] [--templates <Ordner>] [--read-only] [--create] [--verbose]',
    '  node agent/nonotes-mcp.cjs --config [<Datei> …] [--dir <Ordner>]   Einträge für die Agenten zum Kopieren',
    '  node agent/nonotes-mcp.cjs --help | --version',
    '',
    '  --file       die Datenbankdatei der App (Datenbank → Datenbankdatei anlegen…); die App darf sie gleichzeitig offen haben.',
    '               Mehrmals angegeben: je Datei ein Bereich («workspace», Kennung aus dem Dateinamen)',
    '  --dir        alle .sqlite-Dateien dieses Ordners als Bereiche (beim Start gelesen)',
    '  --read-only  nur lesende Werkzeuge, es wird nie geschrieben',
    '  --create     legt die Datei an, wenn sie fehlt',
    '  --templates  Ordner mit Vorlagen (.md) für list_templates und create_note_from_template; ohne Angabe templates/ neben der App',
    '  --verbose    jeden Werkzeugaufruf auf der Fehlerausgabe melden',
    '',
    'Das Programm spricht MCP über Standardeingabe und -ausgabe; es wird vom Agenten gestartet, nicht von Hand. Beschreibung: docs/AGENTS.md',
  ].join('\n');
}

function configText(files, dirs, order) {
  const program = path.resolve(__filename);
  const sources = [];
  for (const src of order || []) sources.push(src.file ? '--file' : '--dir', path.resolve(src.file || src.dir));
  if (!sources.length) sources.push('--file', '<Pfad zur NoNotes.sqlite>');
  const args = [program, ...sources];
  const q = s => (/[\s"]/.test(s) ? JSON.stringify(s) : s);
  const entry = extra => JSON.stringify({ nonotes: Object.assign({}, extra, { command: 'node', args }) }, null, 2).replace(/\n/g, '\n  ');
  const shown = sources.filter((x, i) => i % 2 === 1).join(', ');
  return [
    `Einträge für «nonotes» (Programm: ${program}, ${files.length + dirs.length > 1 || dirs.length ? 'Bereiche' : 'Datei'}: ${shown}). Pfade nach Bedarf anpassen; «node» muss im Pfad liegen.`,
    '',
    'Claude Code (Terminal, gilt für dieses Benutzerkonto):',
    `  claude mcp add --scope user nonotes -- node ${q(program)} ${sources.map(q).join(' ')}`,
    '  oder in .mcp.json im Projektordner bzw. ~/.claude.json:',
    `  { "mcpServers": ${entry({ type: 'stdio' })} }`,
    '',
    'VS Code mit GitHub Copilot (.vscode/mcp.json im Projektordner oder Befehl «MCP: Add Server»):',
    `  { "servers": ${entry({ type: 'stdio' })} }`,
    '',
    'Claude Desktop (claude_desktop_config.json, Einstellungen → Entwickler):',
    `  { "mcpServers": ${entry({})} }`,
    '',
    'GitHub Copilot CLI (~/.copilot/mcp-config.json oder «copilot mcp add»):',
    `  { "mcpServers": ${entry({ type: 'local' })} }`,
    '',
    'Danach den Agenten neu starten und zum Beispiel fragen: «Welche Fragen sind in NoNotes offen?»',
  ].join('\n');
}

function parseArgs(argv) {
  const a = { files: [], dirs: [], sources: [], templates: null, readOnly: false, create: false, verbose: false, config: false, help: false, version: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--file') { if (argv[i + 1] !== undefined) { a.files.push(argv[++i]); a.sources.push({ file: argv[i] }); } }
    else if (x === '--dir') { if (argv[i + 1] !== undefined) { a.dirs.push(argv[++i]); a.sources.push({ dir: argv[i] }); } }
    else if (x === '--templates') { if (argv[i + 1] !== undefined) a.templates = argv[++i]; }
    else if (x === '--read-only') a.readOnly = true;
    else if (x === '--create') a.create = true;
    else if (x === '--verbose') a.verbose = true;
    else if (x === '--config') { a.config = true; while (argv[i + 1] && !argv[i + 1].startsWith('--')) { a.files.push(argv[++i]); a.sources.push({ file: argv[i] }); } }
    else if (x === '--help' || x === '-h') a.help = true;
    else if (x === '--version') a.version = true;
    else a.rest.push(x);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (...m) => console.error('[nonotes-mcp]', ...m);
  if (args.help) { console.log(usage()); return 0; }
  if (args.version) { console.log(layout().version); return 0; }
  if (args.config) { console.log(configText(args.files, args.dirs, args.sources)); return 0; }
  if (args.rest.length) { console.error(`Unbekannte Angabe: ${args.rest.join(' ')}\n\n${usage()}`); return 2; }

  // Dateien sammeln, in der Reihenfolge der Befehlszeile; ein --dir bringt seine .sqlite-Dateien alphabetisch
  const files = [];
  for (const src of args.sources) {
    if (src.file) { files.push(path.resolve(src.file)); continue; }
    let names;
    try { names = fs.readdirSync(src.dir); } catch (e) { console.error(`Ordner nicht lesbar: ${path.resolve(src.dir)}`); return 2; }
    for (const n of names.filter(n => /\.(sqlite3?|db)$/i.test(n) && !n.startsWith('.')).sort((a, b) => a.localeCompare(b))) files.push(path.resolve(src.dir, n));
  }
  const unique = [...new Set(files)];
  if (!unique.length) { console.error(`${args.dirs.length ? 'Keine .sqlite-Datei im Ordner.' : '--file fehlt.'}\n\n${usage()}`); return 2; }

  const core = await loadCore();
  const stores = [];
  for (const file of unique) {
    const store = new FileStore({ file, core, readOnly: args.readOnly, log: args.verbose ? log : () => {} });
    if (!fs.existsSync(store.file)) {
      if (!args.create) { console.error(`Datei nicht gefunden: ${store.file} (--create legt eine neue an)`); return 2; }
      if (args.readOnly) { console.error('--create und --read-only schliessen sich aus.'); return 2; }
      try { store.create(); } catch (e) { console.error(`Datei konnte nicht angelegt werden: ${e.message}`); return 2; }
      log(`Neue Datei angelegt: ${store.file}`);
    } else {
      try { await store.open(); } catch (e) {
        if (e && e.code === 'NOT_NONOTES_FILE') console.error(`Diese Datei stammt nicht von NoNotes: ${store.file}`);
        else if (e && e.code === 'SCHEMA_TOO_NEW') console.error(`Die Datei stammt von einer neueren NoNotes-Version; bitte die App (und dieses Programm) aktualisieren: ${store.file}`);
        else console.error(`Datei lässt sich nicht öffnen: ${store.file}: ${e.message}`);
        return 2;
      }
    }
    stores.push(store);
  }
  const tplDir = templatesDir(args.templates);
  if (args.templates && (!tplDir || !fs.existsSync(tplDir))) { console.error(`Ordner mit Vorlagen fehlt: ${path.resolve(args.templates)}`); return 2; }
  if (tplDir) log(`Vorlagen aus ${tplDir}`);
  const areaName = store => path.basename(store.file).replace(/\.(sqlite3?|db)$/i, '');
  const catalogOf = store => guardedCatalog(core.Agent.create(core.BackendLocal.create({ getDb: () => store.db, onChange: () => {} }),
    { readOnly: args.readOnly, log, templates: tplDir ? folderTemplates(core, tplDir, areaName(store)) : null }), store, log);

  let catalog;
  let where;
  if (stores.length === 1) {
    catalog = catalogOf(stores[0]);
    where = `the file ${stores[0].file}`;
  } else {
    // Bereiche: Kennung aus dem Dateinamen wie in der App (Arbeit.sqlite → arbeit), doppelte bekommen -2, -3 …
    const entries = [];
    for (const store of stores) {
      const name = path.basename(store.file).replace(/\.(sqlite3?|db)$/i, '');
      let id = core.Agent.slug(name);
      for (let n = 2; entries.some(e => e.id === id); n++) id = `${core.Agent.slug(name)}-${n}`;
      entries.push({ id, name, file: store.file, catalog: catalogOf(store) });
    }
    catalog = core.Agent.multi({
      readOnly: args.readOnly, log,
      workspaces: () => entries.map(e => ({ id: e.id, name: e.name, file: e.file })),
      catalogFor: id => entries.find(e => e.id === id).catalog,
    });
    where = `${entries.length} files (${entries.map(e => `${e.id}: ${e.file}`).join('; ')})`;
    log(`Bereiche: ${entries.map(e => e.id).join(', ')}`);
  }
  const server = core.Mcp.createServer({
    catalog, name: 'nonotes', title: 'NoNotes', version: core.version, log,
    instructions: `${catalog.instructions} This server works on ${where}${args.readOnly ? ' (read-only)' : ''}; the NoNotes app may have the same files open and picks up changes.`,
  });

  // Standardeingabe: eine Nachricht je Zeile, Antworten in derselben Reihenfolge
  let queue = Promise.resolve();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  rl.on('line', line => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      const started = Date.now();
      const resp = await server.handleText(line);
      if (args.verbose) { try { const m = JSON.parse(line); log(m.method + (m.params && m.params.name ? ' ' + m.params.name : ''), `${Date.now() - started} ms`); } catch (e) { /* kaputte Zeile, schon beantwortet */ } }
      if (resp !== null && resp !== undefined) process.stdout.write(JSON.stringify(resp) + '\n');
    }).catch(e => log('Fehler', e && e.stack || e));
  });
  await new Promise(resolve => { rl.on('close', resolve); process.on('SIGINT', resolve); process.on('SIGTERM', resolve); });
  await queue;
  for (const store of stores) { try { if (store.db) store.db.close(); } catch (e) { /* egal */ } }
  return 0;
}

main().then(code => { process.exitCode = code; }, e => { console.error('[nonotes-mcp]', e && e.stack || e); process.exitCode = 1; });
