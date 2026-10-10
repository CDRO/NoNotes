/* NoNotes – Zusammenführen von zwei Fassungen einer Notiz (Dreiwege-Vergleich, zeilenweise).
   Gegeben: der gemeinsame Ausgangstext (base), die eigene Fassung (mine) und die Fassung der anderen (theirs).
   Ändern beide verschiedene Stellen, entsteht ein Text mit beiden Änderungen. Ändern beide dieselbe Stelle verschieden, ist das ein
   Konflikt, den die Oberfläche der Person zur Entscheidung vorlegt. Keine Abhängigkeiten, kein Datenzugriff.

   merge3(base, mine, theirs) → { clean, text, parts }
     parts:  [{ type: 'same', lines }, { type: 'conflict', base, mine, theirs }, …]  (alles Zeilenlisten)
     text:   der zusammengeführte Text; bei Konflikten steht die eigene Fassung der strittigen Stelle darin
   resolve(parts, choice)   choice 'mine' | 'theirs' | 'markers': Text, bei dem jeder Konflikt so aufgelöst ist
   Die Zeilen werden an "\n" getrennt; ein Text ohne Zeilenumbruch ist eine Zeile. */
(function (global) {
  'use strict';

  const MAX_D = 2000; // grösster Unterschied (Zeilen), den der Vergleich ausrechnet; darüber gilt der Mittelteil als ersetzt

  /** Für jede Zeile von a die Nummer der entsprechenden Zeile in b (längste gemeinsame Teilfolge) oder -1. Myers O(N·D). */
  function matches(a, b) {
    const N = a.length;
    const M = b.length;
    const m = new Array(N).fill(-1);
    let lo = 0;
    while (lo < N && lo < M && a[lo] === b[lo]) { m[lo] = lo; lo++; }
    let hiA = N;
    let hiB = M;
    while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) { hiA--; hiB--; m[hiA] = hiB; }
    const n = hiA - lo;
    const k = hiB - lo;
    if (!n || !k) return m;

    const max = Math.min(n + k, MAX_D);
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    let found = -1;
    for (let d = 0; d <= max && found < 0; d++) {
      trace.push(v.slice(off - d - 1, off + d + 2)); // Stand vor dieser Runde, k = -d-1 … d+1
      for (let diag = -d; diag <= d; diag += 2) {
        let x = (diag === -d || (diag !== d && v[off + diag - 1] < v[off + diag + 1])) ? v[off + diag + 1] : v[off + diag - 1] + 1;
        let y = x - diag;
        while (x < n && y < k && a[lo + x] === b[lo + y]) { x++; y++; }
        v[off + diag] = x;
        if (x >= n && y >= k) { found = d; break; }
      }
    }
    if (found < 0) return m; // zu verschieden: der Mittelteil gilt als ersetzt

    // zurücklaufen und die übereinstimmenden Zeilen eintragen
    let x = n;
    let y = k;
    for (let d = found; d > 0; d--) {
      const snap = trace[d];
      const at = diag => snap[diag + d + 1];
      const diag = x - y;
      const prev = (diag === -d || (diag !== d && at(diag - 1) < at(diag + 1))) ? diag + 1 : diag - 1;
      const px = at(prev);
      const py = px - prev;
      while (x > px && y > py) { x--; y--; m[lo + x] = lo + y; }
      x = px;
      y = py;
    }
    while (x > 0 && y > 0) { x--; y--; m[lo + x] = lo + y; }
    return m;
  }

  const same = (a, b) => a.length === b.length && a.every((l, i) => l === b[i]);

  function merge3(base, mine, theirs) {
    if (mine === theirs) return { clean: true, text: mine, parts: [{ type: 'same', lines: mine.split('\n') }] };
    if (mine === base) return { clean: true, text: theirs, parts: [{ type: 'same', lines: theirs.split('\n') }] };
    if (theirs === base) return { clean: true, text: mine, parts: [{ type: 'same', lines: mine.split('\n') }] };

    const B = base.split('\n');
    const M = mine.split('\n');
    const T = theirs.split('\n');
    const mb = matches(B, M);
    const tb = matches(B, T);
    const parts = [];
    let clean = true;
    const add = lines => {
      if (!lines.length) return;
      const last = parts[parts.length - 1];
      if (last && last.type === 'same') last.lines.push(...lines);
      else parts.push({ type: 'same', lines: lines.slice() });
    };

    let i = 0;
    let j = 0;
    let k = 0;
    for (;;) {
      // nächste Zeile des Ausgangstexts, die in beiden Fassungen unverändert (und hinter dem bisherigen Stand) vorkommt
      let p = i;
      while (p < B.length && !(mb[p] >= j && tb[p] >= k)) p++;
      const endM = p < B.length ? mb[p] : M.length;
      const endT = p < B.length ? tb[p] : T.length;
      const cb = B.slice(i, p);
      const cm = M.slice(j, endM);
      const ct = T.slice(k, endT);
      if (same(cm, cb)) add(ct);
      else if (same(ct, cb) || same(cm, ct)) add(cm);
      else {
        clean = false;
        parts.push({ type: 'conflict', base: cb, mine: cm, theirs: ct });
      }
      if (p >= B.length) break;
      add([B[p]]);
      i = p + 1;
      j = endM + 1;
      k = endT + 1;
    }
    return { clean, text: resolve(parts, 'mine'), parts };
  }

  /** Text aus den Teilen; choice: 'mine' | 'theirs' | 'markers' (Konflikt zwischen <<<<<<<, =======, >>>>>>>). */
  function resolve(parts, choice, labels) {
    const l = Object.assign({ mine: 'Meine Fassung', theirs: 'Neue Fassung' }, labels); // i18n-ignore: Beschriftung im Text, vom Aufrufer übersetzt
    const out = [];
    for (const part of parts) {
      if (part.type === 'same') out.push(...part.lines);
      else if (choice === 'theirs') out.push(...part.theirs);
      else if (choice === 'markers') out.push(`<<<<<<< ${l.mine}`, ...part.mine, '=======', ...part.theirs, `>>>>>>> ${l.theirs}`);
      else out.push(...part.mine);
    }
    return out.join('\n');
  }

  /** Wohin wandert ein Textcursor, wenn oldText durch newText ersetzt wird (zum Beispiel nach dem Zusammenführen mit den Änderungen
   *  anderer)? Die Zeile des Cursors wird im neuen Text wiedergefunden; die Spalte bleibt. Ist die Zeile verändert, steht der
   *  Cursor hinter der letzten wiedergefundenen Zeile davor. */
  function mapCaret(oldText, newText, caret) {
    caret = Math.max(0, Math.min(caret, oldText.length));
    if (oldText === newText) return caret;
    const A = oldText.split('\n');
    const Bn = newText.split('\n');
    let line = 0;
    let pos = 0;
    while (line < A.length - 1 && pos + A[line].length + 1 <= caret) { pos += A[line].length + 1; line++; }
    const col = caret - pos;
    const m = matches(A, Bn);
    const starts = [];
    let off = 0;
    for (const l of Bn) { starts.push(off); off += l.length + 1; }
    if (m[line] >= 0) return Math.min(starts[m[line]] + col, starts[m[line]] + Bn[m[line]].length);
    for (let i = line - 1; i >= 0; i--) {
      if (m[i] >= 0) return m[i] + 1 < Bn.length ? starts[m[i] + 1] : newText.length;
    }
    return Math.min(caret, newText.length);
  }

  global.NoNotesMerge = { merge3, resolve, matches, mapCaret };
})(typeof window !== 'undefined' ? window : globalThis);
