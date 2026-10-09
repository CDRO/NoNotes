/* NoNotes – Verlauf einer Notiz: reine Textfunktionen, ohne Datenbank und ohne Seite.

   Gespeichert werden nie ganze frühere Fassungen, sondern Unterschiede. Jede Fassung steht als Rückwärts-Patch
   zur nächstneueren: aus dem neueren Text entsteht der ältere, indem der mittlere Teil ersetzt wird.
     { p, s, r }   p = Zeichen, die beide Texte am Anfang gemeinsam haben
                   s = Zeichen, die beide Texte am Ende gemeinsam haben
                   r = der Teil dazwischen, wie er in der älteren Fassung steht
   Das ist klein bei örtlichen Änderungen (der übliche Fall) und lässt sich beim Aufbewahren von hinten kürzen:
   die älteste Fassung zu entfernen, stört die neueren nicht. */
(function (global) {
  'use strict';

  const isHigh = c => c >= 0xD800 && c <= 0xDBFF;
  const isLow = c => c >= 0xDC00 && c <= 0xDFFF;

  /** Patch, der aus newText den Text oldText macht. Schneidet nie mitten durch ein Zeichen aus zwei Codeeinheiten
   *  (Emoji u. ä.), weil SQLite sonst ein halbes Zeichen verlöre. */
  function diff(newText, oldText) {
    newText = String(newText == null ? '' : newText);
    oldText = String(oldText == null ? '' : oldText);
    const max = Math.min(newText.length, oldText.length);
    let p = 0;
    while (p < max && newText.charCodeAt(p) === oldText.charCodeAt(p)) p++;
    if (p > 0 && isHigh(newText.charCodeAt(p - 1))) p--;
    const maxS = max - p;
    let s = 0;
    while (s < maxS && newText.charCodeAt(newText.length - 1 - s) === oldText.charCodeAt(oldText.length - 1 - s)) s++;
    if (s > 0 && isLow(newText.charCodeAt(newText.length - s))) s--;
    return { p, s, r: oldText.slice(p, oldText.length - s) };
  }

  /** Wendet einen Patch auf den neueren Text an und liefert den älteren. */
  function apply(newText, patch) {
    newText = String(newText == null ? '' : newText);
    return newText.slice(0, patch.p) + patch.r + newText.slice(newText.length - patch.s);
  }

  /** Zeilenunterschied von «from» nach «to»: Liste von { type: 'same' | 'add' | 'del', text }.
   *  'del' steht nur in from, 'add' nur in to. Sehr grosse Texte werden grob als Block verglichen. */
  function lineDiff(from, to) {
    const A = String(from == null ? '' : from).split('\n');
    const B = String(to == null ? '' : to).split('\n');
    let head = 0;
    while (head < A.length && head < B.length && A[head] === B[head]) head++;
    let tail = 0;
    while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;
    const a = A.slice(head, A.length - tail);
    const b = B.slice(head, B.length - tail);
    const out = [];
    for (let i = 0; i < head; i++) out.push({ type: 'same', text: A[i] });
    if (a.length * b.length > 4000000) {
      for (const text of a) out.push({ type: 'del', text });
      for (const text of b) out.push({ type: 'add', text });
    } else {
      const w = b.length + 1;
      const L = new Uint32Array((a.length + 1) * w); // Länge der längsten gemeinsamen Teilfolge ab (i, j)
      for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
          L[i * w + j] = a[i] === b[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
        else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
        else { out.push({ type: 'add', text: b[j] }); j++; }
      }
      while (i < a.length) out.push({ type: 'del', text: a[i++] });
      while (j < b.length) out.push({ type: 'add', text: b[j++] });
    }
    for (let k = A.length - tail; k < A.length; k++) out.push({ type: 'same', text: A[k] });
    return out;
  }

  global.NoNotesHistory = { diff, apply, lineDiff };
})(window);
