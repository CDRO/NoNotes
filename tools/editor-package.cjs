/* NoNotes – wo das Paket nonotes-editor liegt (Markdown-Engine und Editor, seit v4.0.0 ein eigenes Paket, devDependency).
   Für die Werkzeuge in Node (Build, Sprachwerkzeug, Tests): require.resolve sucht vom Projekt aufwärts, so findet es das Paket auch,
   wenn NoNotes als Submodul in einem anderen Projekt liegt (NoNotes-SaaS, SteeringBoard) und das Paket in dessen node_modules.

     const { editorPackage, editorFile } = require('./editor-package.cjs');
     editorPackage()          die Angaben aus files.cjs des Pakets: { version, root, scripts, styles, engine }
     editorFile('tasks.js')   absoluter Pfad einer Datei des Pakets (Name wie im Ergebnis unter js/ bzw. css/) */
'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

let cached = null;
function editorPackage() {
  if (cached) return cached;
  let file;
  try { file = require.resolve('nonotes-editor/files.cjs', { paths: [ROOT] }); }
  catch (e) { throw new Error('Paket nonotes-editor fehlt (devDependency): npm install'); }
  cached = require(file);
  return cached;
}

/** Absoluter Pfad einer Datei des Pakets nach ihrem Namen (labels.js, editor.de.js, tasks.js, editor.css …). */
function editorFile(name) {
  const p = editorPackage();
  const n = name.endsWith('.js') || name.endsWith('.css') ? name : `${name}.js`;
  const hit = p.scripts.concat(p.styles).find(s => s.name === n);
  if (!hit) throw new Error(`Datei ${n} gibt es im Paket nonotes-editor nicht`);
  return hit.file;
}

module.exports = { editorPackage, editorFile };
