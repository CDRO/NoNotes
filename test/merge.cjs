/* Test des Zusammenführens (packages/core/merge.js) ohne Browser: Myers-Vergleich gegen eine einfache Berechnung der längsten
   gemeinsamen Teilfolge, Eigenschaften des Dreiwege-Vergleichs mit Zufallsdaten, Konflikte, Grössen.
   Ausführen: node test/merge.cjs */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ctx = vm.createContext({});
ctx.window = ctx;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'packages', 'core', 'merge.js'), 'utf8'), ctx);
const { merge3, resolve, matches, mapCaret } = ctx.NoNotesMerge;
const step = name => console.log('  ✓ ' + name);

// deterministischer Zufall
let seed = 12345;
const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

function lcsLength(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

// 1. Myers findet eine längste gemeinsame Teilfolge, und die Zuordnung ist gültig (gleiche Zeilen, aufsteigend)
for (let t = 0; t < 3000; t++) {
  const alphabet = 1 + rnd(5);
  const a = Array.from({ length: rnd(14) }, () => String(rnd(alphabet)));
  const b = Array.from({ length: rnd(14) }, () => String(rnd(alphabet)));
  const m = matches(a, b);
  let last = -1;
  let n = 0;
  m.forEach((j, i) => {
    if (j < 0) return;
    assert.equal(a[i], b[j], 'gleiche Zeilen');
    assert.ok(j > last, 'aufsteigend');
    last = j;
    n++;
  });
  assert.equal(n, lcsLength(a, b), `längste Teilfolge: ${JSON.stringify([a, b])}`);
}
step('Vergleich: 3000 Zufallspaare liefern eine längste gemeinsame Teilfolge, gültig und aufsteigend');

// 2. Eigenschaften
const doc = n => Array.from({ length: n }, (_, i) => `Zeile ${i}`);
const text = lines => lines.join('\n');
for (let t = 0; t < 2000; t++) {
  const base = doc(1 + rnd(12));
  const b = text(base);
  const edit = (lines) => {
    const out = lines.slice();
    const at = rnd(out.length + 1);
    const kind = rnd(3);
    if (kind === 0) out.splice(at, 0, `neu ${t}-${rnd(1000)}`);
    else if (kind === 1 && out.length) out.splice(Math.min(at, out.length - 1), 1);
    else if (out.length) out[Math.min(at, out.length - 1)] = `geändert ${t}-${rnd(1000)}`;
    return out;
  };
  const m = text(edit(base));
  const th = text(edit(base));
  assert.equal(merge3(b, m, b).text, m);
  assert.equal(merge3(b, b, th).text, th);
  assert.equal(merge3(b, m, m).text, m);
  assert.ok(merge3(b, m, th).clean === merge3(b, th, m).clean, 'Sauberkeit hängt nicht von der Reihenfolge ab');
  const r = merge3(b, m, th);
  if (r.clean) assert.equal(resolve(r.parts, 'theirs'), r.text);
}
step('Eigenschaften: unverändert übernimmt die andere Fassung, gleiche Änderungen sind kein Konflikt, Reihenfolge egal');

// 3. Getrennte Stellen werden zusammengeführt (mit Zeile Abstand)
for (let t = 0; t < 2000; t++) {
  const n = 6 + rnd(20);
  const base = doc(n);
  const a1 = rnd(n - 4);
  const a2 = a1 + 1 + rnd(2);                 // Bereich A: [a1, a2)
  const b1 = a2 + 1 + rnd(Math.max(1, n - a2 - 2)); // mindestens eine unveränderte Zeile dazwischen
  const b2 = Math.min(n, b1 + 1 + rnd(2));
  if (b1 >= n) continue;
  const X = Array.from({ length: rnd(3) }, (_, i) => `X${t}-${i}`);
  const Y = Array.from({ length: rnd(3) }, (_, i) => `Y${t}-${i}`);
  const mine = [...base.slice(0, a1), ...X, ...base.slice(a2)];
  const theirs = [...base.slice(0, b1), ...Y, ...base.slice(b2)];
  const expected = [...base.slice(0, a1), ...X, ...base.slice(a2, b1), ...Y, ...base.slice(b2)];
  const r = merge3(text(base), text(mine), text(theirs));
  assert.ok(r.clean, `getrennte Änderungen müssen sauber zusammengehen: A[${a1},${a2}) B[${b1},${b2}) n=${n}`);
  assert.equal(r.text, text(expected));
  const r2 = merge3(text(base), text(theirs), text(mine));
  assert.ok(r2.clean && r2.text === text(expected), 'auch mit vertauschten Rollen');
}
step('Getrennte Änderungen: 2000 Zufallsfälle ergeben genau den Text mit beiden Änderungen, in beiden Richtungen');

// 4. Konflikte
{
  const base = text(['a', 'b', 'c', 'd']);
  const mine = text(['a', 'B-mein', 'c', 'd']);
  const theirs = text(['a', 'B-dein', 'c', 'd']);
  const r = merge3(base, mine, theirs);
  assert.equal(r.clean, false);
  assert.equal(r.parts.filter(p => p.type === 'conflict').length, 1);
  const c = r.parts.find(p => p.type === 'conflict');
  assert.deepEqual(JSON.parse(JSON.stringify([c.base, c.mine, c.theirs])), [['b'], ['B-mein'], ['B-dein']]);
  assert.equal(r.text, mine);
  assert.equal(resolve(r.parts, 'theirs'), theirs);
  assert.equal(resolve(r.parts, 'mine'), mine);
  assert.equal(resolve(r.parts, 'markers', { mine: 'M', theirs: 'T' }), ['a', '<<<<<<< M', 'B-mein', '=======', 'B-dein', '>>>>>>> T', 'c', 'd'].join('\n'));
  // eine Seite löscht, die andere ändert dieselbe Zeile
  const r2 = merge3(base, text(['a', 'c', 'd']), theirs);
  assert.equal(r2.clean, false);
  // beide fügen an derselben Stelle verschiedenes ein
  const r3 = merge3(text(['a', 'c']), text(['a', 'm', 'c']), text(['a', 't', 'c']));
  assert.equal(r3.clean, false);
  // beide fügen dasselbe ein
  const r4 = merge3(text(['a', 'c']), text(['a', 'x', 'c']), text(['a', 'x', 'c']));
  assert.ok(r4.clean);
  // Änderungen in mehreren Bereichen, einer davon strittig
  const bigBase = doc(30);
  const bigMine = bigBase.slice(); bigMine[3] = 'mein 3'; bigMine[20] = 'mein 20';
  const bigTheirs = bigBase.slice(); bigTheirs[10] = 'dein 10'; bigTheirs[20] = 'dein 20';
  const r5 = merge3(text(bigBase), text(bigMine), text(bigTheirs));
  assert.equal(r5.parts.filter(p => p.type === 'conflict').length, 1);
  assert.match(resolve(r5.parts, 'theirs'), /mein 3/);
  assert.match(resolve(r5.parts, 'theirs'), /dein 10/);
  assert.match(resolve(r5.parts, 'theirs'), /dein 20/);
  assert.doesNotMatch(resolve(r5.parts, 'theirs'), /mein 20/);
}
step('Konflikte: strittige Stelle wird gemeldet, Auflösen nach mine/theirs/Markierungen, die übrigen Änderungen bleiben');

// 5. Notiztypische Fälle: Aufgabenliste, Leerzeilen, Text ohne Umbruch, leerer Text
{
  const base = '# Plan\n\n- [ ] eins\n- [ ] zwei\n\nSchluss\n';
  const mine = base.replace('- [ ] eins', '- [x] eins');
  const theirs = base.replace('Schluss', 'Schluss und mehr');
  const r = merge3(base, mine, theirs);
  assert.ok(r.clean);
  assert.equal(r.text, '# Plan\n\n- [x] eins\n- [ ] zwei\n\nSchluss und mehr\n');
  assert.equal(merge3('', 'a', '').text, 'a');
  assert.equal(merge3('', '', 'b').text, 'b');
  assert.equal(merge3('', 'a', 'b').clean, false);
  assert.equal(merge3('ein Satz', 'ein Satz hier', 'ein Satz').text, 'ein Satz hier');
  assert.equal(merge3('ein Satz', 'ein Satz hier', 'ein Satz da').clean, false, 'dieselbe Zeile verschieden geändert');
}
step('Notizen: Aufgaben abhaken und anderswo ergänzen geht zusammen, leere Texte, Text ohne Umbruch');

// 6. Grösse und Zeit
{
  const base = doc(8000);
  const mine = base.slice(); mine[100] = 'vorn'; mine.splice(7000, 0, 'eingefügt A');
  const theirs = base.slice(); theirs[4000] = 'mitte'; theirs.splice(7900, 1);
  const t0 = Date.now();
  const r = merge3(text(base), text(mine), text(theirs));
  const ms = Date.now() - t0;
  assert.ok(r.clean, 'grosse Notiz, weit auseinander liegende Änderungen');
  assert.ok(r.text.includes('vorn') && r.text.includes('mitte') && r.text.includes('eingefügt A') && !r.text.includes('Zeile 7900\n'));
  assert.ok(ms < 1500, `Zeit ${ms} ms`);
  // völlig verschiedene Texte brechen nicht ab, sondern melden einen Konflikt
  const noise = (seedText) => Array.from({ length: 6000 }, (_, i) => `${seedText}-${(i * 7919) % 6007}`);
  const t1 = Date.now();
  const r2 = merge3(text(doc(6000)), text(noise('p')), text(noise('q')));
  assert.equal(r2.clean, false);
  assert.ok(Date.now() - t1 < 8000, 'verschiedene Texte in vertretbarer Zeit');
  step(`Grösse: 8000 Zeilen in ${ms} ms, völlig verschiedene Texte brechen nicht ab`);
}

// 7. Cursor wandert mit
{
  const old = 'eins\nzwei\ndrei';
  const withTop = 'neu oben\neins\nzwei\ndrei';
  assert.equal(mapCaret(old, withTop, 0), 9, 'am Anfang von «eins»');
  assert.equal(mapCaret(old, withTop, 7), 16, 'mitten in «zwei» (Spalte 2)');
  assert.equal(mapCaret(old, old, 5), 5);
  assert.equal(mapCaret('eins\nzwei', 'eins\nzwei\nunten', 6), 6, 'Änderung hinter dem Cursor verschiebt nichts');
  assert.equal(mapCaret('a\nb', 'a\nX', 3), 2, 'geänderte Zeile: hinter die letzte unveränderte davor');
  assert.equal(mapCaret('abc', 'abcd', 2), 2, 'einzeiliges Feld: Cursor bleibt, wo er war');
  assert.equal(mapCaret('abcdef', 'ab', 5), 2, 'nie hinter dem Ende');
  step('Cursor: wandert mit, wenn davor Zeilen dazukommen, und bleibt sonst stehen');
}

console.log('\nMerge-Test bestanden.');
