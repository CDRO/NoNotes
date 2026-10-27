#!/usr/bin/env node
/* NoNotes – Release-Notizen (ab v2.12.0, Vorgabe vom 2026-10-27).
   Jedes Release hat einen Ordner docs/releases/<Version>/ mit RELEASE.md und den Screenshots der Neuerungen. Dieses Werkzeug
   prüft den Ordner und macht daraus die Beschreibung des Releases auf GitHub. Aufbau und Regeln: docs/releases/README.md.

   Aufruf:
     node tools/release-notes.cjs required <Version>   Rückgabe 0, wenn die Version Release-Notizen braucht (ab v2.12.0), sonst 1
     node tools/release-notes.cjs check <Version> [--dir <Ordner>]
     node tools/release-notes.cjs render <Version> [--dir <Ordner>] [--repo besitzer/name] [--ref <Tag>] [--known "v2.10.0 v2.11.0 …"]
                                         [--out <Datei>] [--title-out <Datei>]
   render schreibt die Beschreibung (ohne die Titelzeile) nach --out oder auf die Standardausgabe, den Titel nach --title-out.
   Bilder und Verweise mit relativem Pfad zeigen danach auf den Stand des Tags im Repository; --known nennt die Releases, die es
   schon gibt (für den Vergleich mit dem vorigen). */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FIRST = 'v2.12.0'; // ab dieser Version Pflicht
const NOTES = 'RELEASE.md';
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_IMAGE_BYTES = 1024 * 1024;
const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(v) {
  const m = VERSION_RE.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error(`Keine Version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Braucht diese Version Release-Notizen? (ab v2.12.0) */
const required = version => compareVersions(version, FIRST) >= 0;

/** Das höchste bekannte Release unter dieser Version, oder null. */
function previousOf(version, known) {
  const lower = (known || []).filter(k => parseVersion(k) && compareVersions(k, version) < 0);
  lower.sort(compareVersions);
  return lower.length ? lower[lower.length - 1] : null;
}

const stripComments = text => text.replace(/<!--[\s\S]*?-->/g, '');

/** Ein Codeblock endet erst bei einem Zaun aus denselben Zeichen, mindestens so lang (````markdown … ```` darf ``` enthalten). */
function fenceStep(fence, line) {
  const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if (!fence) return m ? m[1] : null;
  return m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim() ? null : fence;
}

/** Text mit Leerzeichen statt Code (Blöcke und `…`), gleich lang: für Prüfungen, die nur den Fliesstext meinen. */
function maskCode(text) {
  let fence = null;
  return text.split('\n').map(line => {
    const was = fence;
    fence = fenceStep(fence, line);
    if (was || fence) return ' '.repeat(line.length);
    return line.replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, m => ' '.repeat(m.length));
  }).join('\n');
}

/** Bilder und Verweise ausserhalb von Code: [{ image, alt, target, index }] */
function links(text) {
  const out = [];
  const masked = maskCode(text);
  const re = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(masked))) out.push({ image: m[1] === '!', alt: m[2], target: m[3], index: m.index, length: m[0].length });
  return out;
}

const isRelative = target => !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target);

/** Abschnitte ab «## »: [{ title, body, subs: [{ title, body }] }] und der Text davor. */
function sections(text) {
  const lines = text.split('\n');
  const out = [];
  let cur = null, sub = null;
  const head = [];
  let fence = null;
  for (const line of lines) {
    const was = fence;
    fence = fenceStep(fence, line);
    const code = was || fence; // im Block, die Zäune eingeschlossen
    const h2 = !code && /^##\s+(.+?)\s*$/.exec(line);
    const h3 = !code && /^###\s+(.+?)\s*$/.exec(line);
    if (h2) { cur = { title: h2[1], body: '', subs: [] }; sub = null; out.push(cur); continue; }
    if (h3 && cur) { sub = { title: h3[1], body: '' }; cur.subs.push(sub); continue; }
    if (sub) sub.body += line + '\n';
    else if (cur) cur.body += line + '\n';
    else head.push(line);
  }
  return { head: head.join('\n'), sections: out };
}

/**
 * Prüft den Ordner eines Releases. Gibt { ok, errors, warnings, title } zurück.
 * Regeln (docs/releases/README.md): Titelzeile «# NoNotes <Version> – <Titel>», Kurzfassung, «## Was ist neu» mit Unterabschnitten,
 * je Unterabschnitt ein Screenshot (oder «<!-- ohne Bild: Grund -->»), «## Update …» mit nummerierten Schritten, alle Bilder da
 * (PNG, JPEG, WebP, GIF, höchstens 1 MB), keine Platzhalter mehr.
 */
function check(version, dir) {
  const errors = [], warnings = [];
  const file = path.join(dir, NOTES);
  if (!parseVersion(version)) return { ok: false, errors: [`Keine Version: ${version} (erwartet z. B. v2.12.0)`], warnings, title: null };
  if (!fs.existsSync(file)) return { ok: false, errors: [`${path.relative(ROOT, file) || file} fehlt. Vorlage: docs/releases/VORLAGE.md`], warnings, title: null };
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const text = stripComments(raw);

  const first = text.split('\n').find(l => l.trim()) || '';
  const t = /^#\s+NoNotes\s+(v\d+\.\d+\.\d+)\s+[–-]\s+(\S.*)$/.exec(first);
  if (!t) errors.push(`Die erste Zeile muss «# NoNotes ${version} – <Titel>» lauten, ist aber «${first}».`);
  else if (t[1] !== version) errors.push(`Die Titelzeile nennt ${t[1]}, das Release ist ${version}.`);

  const { head, sections: secs } = sections(text);
  if (!head.replace(/^#\s.*$/m, '').trim()) errors.push('Unter der Titelzeile fehlt die Kurzfassung (ein, zwei Sätze, was das Release bringt).');

  const neu = secs.find(s => /^Was ist neu\b/i.test(s.title));
  if (!neu) errors.push('Der Abschnitt «## Was ist neu» fehlt.');
  else {
    if (!neu.subs.length) errors.push('«## Was ist neu» braucht je Neuerung einen Unterabschnitt «### …» mit Beschreibung und Screenshot.');
    const rawNeu = sections(raw).sections.find(s => /^Was ist neu\b/i.test(s.title));
    for (const s of neu.subs) {
      const words = s.body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').split(/\s+/).filter(Boolean).length;
      if (words < 15) errors.push(`«### ${s.title}»: die Beschreibung ist zu knapp (${words} Wörter, mindestens 15): was ist neu, wie benutzt man es.`);
      const hasImage = links(s.body).some(l => l.image);
      const rawSub = rawNeu && rawNeu.subs.find(x => x.title === s.title);
      const exempt = rawSub && /<!--\s*ohne Bild:\s*\S[\s\S]*?-->/.test(rawSub.body);
      if (!hasImage && !exempt) errors.push(`«### ${s.title}»: kein Screenshot. Bild einfügen oder begründen: <!-- ohne Bild: Grund -->`);
    }
  }

  const update = secs.find(s => /^Update\b/i.test(s.title));
  if (!update) errors.push('Der Abschnitt «## Update …» (Update-Pfad von der vorigen Version) fehlt.');
  else {
    const all = update.body + update.subs.map(s => s.body).join('');
    if (!/^\s*1\.\s+\S/m.test(all)) errors.push('«## Update»: die Schritte als nummerierte Liste (1., 2., …) beschreiben.');
    if (!/sicher/i.test(all)) errors.push('«## Update»: der erste Schritt ist die Sicherung der Daten (Datenbank → Kopie herunterladen).');
  }

  const left = new Map();
  for (const m of maskCode(text).matchAll(/\bTODO\b|\{\{[^}]*\}\}|\bvX\.Y\.Z\b|\bvA\.B\.C\b|<Titel>/g)) left.set(m[0], (left.get(m[0]) || 0) + 1);
  if (left.size) errors.push(`Platzhalter übrig: ${[...left].map(([k, n]) => `«${k}»${n > 1 ? ` (${n}×)` : ''}`).join(', ')}.`);

  // @name ausserhalb von Code erwähnt auf GitHub das Konto dieses Namens (Benachrichtigung, «Contributors» im Release)
  const mentions = new Set();
  for (const m of maskCode(text).matchAll(/(?<![\w`/.@-])@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?![\w@-])/g)) mentions.add(m[0]);
  if (mentions.size) errors.push(`${[...mentions].map(k => `«${k}»`).join(', ')} ausserhalb von Code: GitHub erwähnt damit das Konto dieses Namens und führt es beim Release als Mitwirkende auf. In Backticks setzen (\`@kürzel\`).`);

  const used = new Set();
  for (const l of links(text)) {
    if (!isRelative(l.target)) continue;
    const target = decodeURIComponent(l.target.split('#')[0]);
    const abs = path.resolve(dir, target);
    if (l.image) {
      used.add(path.resolve(abs));
      if (!IMAGE_EXT.has(path.extname(abs).toLowerCase())) { errors.push(`Bild ${l.target}: nur PNG, JPEG, WebP oder GIF.`); continue; }
      if (!fs.existsSync(abs)) { errors.push(`Bild ${l.target} fehlt im Ordner.`); continue; }
      if (path.dirname(abs) !== path.resolve(dir)) errors.push(`Bild ${l.target}: Screenshots liegen im Ordner des Releases.`);
      const size = fs.statSync(abs).size;
      if (size > MAX_IMAGE_BYTES) errors.push(`Bild ${l.target}: ${Math.round(size / 1024)} KB, höchstens ${MAX_IMAGE_BYTES / 1024} KB.`);
      if (!l.alt.trim()) errors.push(`Bild ${l.target}: der Text in [ ] beschreibt, was zu sehen ist.`);
    } else if (!fs.existsSync(abs)) errors.push(`Verweis ${l.target} zeigt ins Leere.`);
  }
  for (const f of fs.readdirSync(dir)) {
    if (IMAGE_EXT.has(path.extname(f).toLowerCase()) && !used.has(path.resolve(dir, f))) warnings.push(`Bild ${f} liegt im Ordner, kommt aber in RELEASE.md nicht vor.`);
  }
  return { ok: errors.length === 0, errors, warnings, title: t ? `NoNotes ${t[1]} – ${t[2].trim()}` : null };
}

/**
 * Beschreibung für GitHub: ohne Titelzeile und Kommentare, relative Bilder als Adresse der Datei im Tag (raw), relative Verweise als
 * Ansicht im Tag (blob), am Ende die Pakete und der Vergleich mit dem vorigen Release.
 * o: { version, dir, repo, ref, known: [Tags] }
 */
function render(text, o) {
  const repo = o.repo || 'CDRO/NoNotes';
  const ref = o.ref || o.version;
  const rel = path.relative(ROOT, o.dir).split(path.sep).join('/');
  let body = stripComments(text.replace(/\r\n?/g, '\n'));
  body = body.replace(/^\s*#\s+NoNotes\s+v\d+\.\d+\.\d+[^\n]*\n/, '');
  const found = links(body).filter(l => isRelative(l.target)).reverse(); // von hinten ersetzen, die Stellen bleiben gültig
  for (const l of found) {
    const [file, hash] = l.target.split('#');
    const target = path.posix.normalize(path.posix.join(rel, file));
    const url = l.image ? `https://raw.githubusercontent.com/${repo}/${ref}/${target}` : `https://github.com/${repo}/blob/${ref}/${target}${hash ? '#' + hash : ''}`;
    const original = body.slice(l.index, l.index + l.length);
    body = body.slice(0, l.index) + original.replace(`(${l.target}`, `(${url}`) + body.slice(l.index + l.length);
  }
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  const prev = previousOf(o.version, o.known);
  const foot = [
    '---',
    '',
    `**Pakete:** \`NoNotes-${o.version}.zip\` ist die App mit zwei Beispiel-Erweiterungen; \`NoNotes-with-Plugins-${o.version}.zip\` enthält zusätzlich alle Erweiterungen aus [NoNotes-plugins](https://github.com/CDRO/NoNotes-plugins) (einschalten unter *Datenbank → Erweiterungen…*).`,
  ];
  if (prev) foot.push('', `**Alle Änderungen:** https://github.com/${repo}/compare/${prev}...${o.version}`);
  return body + '\n\n' + foot.join('\n') + '\n';
}

function main(argv) {
  const [cmd, version, ...rest] = argv;
  const opt = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith('--')) throw new Error(`Unbekannte Angabe: ${k}`);
    opt[k.slice(2)] = rest[++i];
  }
  if (!cmd || !version || !['required', 'check', 'render'].includes(cmd)) {
    console.error('Aufruf: node tools/release-notes.cjs required|check|render <Version> [--dir <Ordner>] [--repo …] [--ref …] [--known "…"] [--out …] [--title-out …]');
    return 2;
  }
  if (!parseVersion(version)) { console.error(`Keine Version: ${version} (erwartet z. B. v2.12.0)`); return 2; }
  if (cmd === 'required') return required(version) ? 0 : 1;
  const dir = path.resolve(opt.dir || path.join(ROOT, 'docs', 'releases', version));
  const res = check(version, dir);
  for (const w of res.warnings) console.error('Hinweis: ' + w);
  if (!res.ok) {
    console.error(`Release-Notizen ${version} unvollständig (${path.relative(process.cwd(), dir) || dir}):`);
    for (const e of res.errors) console.error('  - ' + e);
    console.error('Regeln: docs/releases/README.md');
    return 1;
  }
  if (cmd === 'check') { console.log(`Release-Notizen ${version} in Ordnung: ${res.title}`); return 0; }
  const text = fs.readFileSync(path.join(dir, NOTES), 'utf8');
  const known = String(opt.known || '').split(/[\s,]+/).filter(Boolean);
  const body = render(text, { version, dir, repo: opt.repo, ref: opt.ref, known });
  if (opt.out) fs.writeFileSync(opt.out, body); else process.stdout.write(body);
  if (opt['title-out']) fs.writeFileSync(opt['title-out'], res.title + '\n');
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 2; }
}

module.exports = { FIRST, required, compareVersions, previousOf, check, render, links, sections };
