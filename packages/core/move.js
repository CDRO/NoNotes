/* NoNotes – Notizen in einen anderen Bereich mitnehmen (v3.2.0, «In neuen Bereich auslösen»). Reine Funktionen ohne Datenzugriff:
   sie schreiben Texte und Links so um, dass Bilder, Querverweise und Links auf Notizen nach dem Umzug weiter stimmen. Den Umzug selbst
   machen exportSubtree und importSubtree in packages/data/db.js; wie eine Adresse aussieht, weiss die Hülle (lokal «#w=…&n=…», im
   Dienst «/w/<id>/…»), darum kommen Lesen und Bilden von Adressen als Funktionen herein.

     rewriteMoved(body, o)   Text einer Notiz, die mitgeht
     rewriteStaying(body, o) Text einer Notiz, die im alten Bereich bleibt und auf mitgenommene verweist
     rewriteLink(url, o)     ein einzelner Link (Link am Knoten), nach denselben Regeln

   o (alle Funktionen):
     notes            Map alte Nummer → neue Nummer der mitgenommenen Notizen
     atts             Map alte → neue Nummer der Bilder (nur rewriteMoved)
     resolve(raw)     [[…]]-Ziel im alten Bereich: { id, label } wie NoNotesLinks.resolver (id null: offen)
     parse(url)       Adresse dieser App → { note, area } (area null: der alte Bereich) oder null
     source(id, label)  Adresse einer Notiz im alten Bereich
     target(id, label)  Adresse einer Notiz im neuen Bereich (neue Nummer)
   Code (```-Blöcke und `…`) bleibt unberührt. */
(function (global) {
  'use strict';

  const REF_RE = /\[\[([^[\]\n]*)\]\]/g;
  const MD_LINK_RE = /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"]*")?\))/g;
  const BARE_RE = /(^|[^\w@(<[])((?:https?|file):\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"])/g;

  /** Wendet fn auf alle Stellen ausserhalb von Code an: Zeilen in ```-Blöcken und `…` in einer Zeile bleiben, wie sie sind. Ein
   *  mehrzeiliger Entscheid oder eine Frage ("?!```" bis "```", auch als Listenpunkt) ist kein Code (wie in links.js). */
  function outsideCode(body, fn) {
    const lines = String(body == null ? '' : body).split('\n');
    let fence = null;
    let block = false;
    return lines.map(line => {
      if (fence) { if (line.trim().startsWith(fence)) fence = null; return line; }
      if (!block && /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\?!?\s?```/.test(line)) block = true;
      else if (block && /^\s*```\s*$/.test(line)) { block = false; return line; }
      else {
        const f = /^\s*(```|~~~)/.exec(line);
        if (f) { fence = f[1]; return line; }
      }
      return line.split(/(`[^`\n]*`)/).map((part, i) => (i % 2 ? part : fn(part))).join('');
    }).join('\n');
  }

  const parseRef = inner => {
    const raw = String(inner == null ? '' : inner).trim();
    const cross = raw.endsWith('*');
    return { text: (cross ? raw.slice(0, -1) : raw).trim(), cross };
  };
  const mdText = s => String(s).replace(/([\\[\]])/g, '\\$1');
  const mdUrl = u => (/[\s()<>]/.test(u) ? `<${u}>` : u);

  /** Ein Link nach dem Umzug, oder null, wenn er bleibt. moving: der Text gehört einer mitgenommenen Notiz. */
  function movedUrl(url, o, moving) {
    const target = o.parse ? o.parse(url) : null;
    if (!target || target.note == null || target.area) return null; // fremd, nur Bereich, oder ausdrücklich ein anderer Bereich
    if (o.notes.has(target.note)) return o.target(o.notes.get(target.note), '');
    // Ziel bleibt im alten Bereich: aus dem neuen Bereich heraus braucht der Link den alten Bereich
    return moving ? o.source(target.note, '') : null;
  }

  function rewriteUrls(text, o, moving) {
    let s = text.replace(MD_LINK_RE, (m, head, rawUrl, tail) => {
      if (head.startsWith('!')) return m; // Bilder: att:… regelt rewriteMoved
      const url = rawUrl.startsWith('<') ? rawUrl.slice(1, -1) : rawUrl;
      const next = movedUrl(url, o, moving);
      return next ? `${head}${mdUrl(next)}${tail}` : m;
    });
    s = s.replace(BARE_RE, (m, before, url) => {
      const next = movedUrl(url, o, moving);
      return next ? before + next : m;
    });
    return s;
  }

  /** [[…]]: geht das Ziel mit, bleibt der Verweis (mit neuer Nummer, wenn er eine trägt); sonst wird er zum Link in den anderen Bereich. */
  function rewriteRefs(text, o, moving) {
    return text.replace(REF_RE, (m, inner) => {
      const ref = parseRef(inner);
      if (!ref.text) return m;
      const hit = o.resolve(ref.text);
      if (hit.id == null) return m;
      const label = hit.label || ref.text;
      if (o.notes.has(hit.id)) {
        const neu = o.notes.get(hit.id);
        if (moving) {
          const num = /^(.*\S)#(\d+)$/.exec(ref.text);
          return num && Number(num[2]) === hit.id ? `[[${num[1]}#${neu}${ref.cross ? '*' : ''}]]` : m;
        }
        return `[${mdText(label)}](${mdUrl(o.target(neu, label))})`;
      }
      return moving ? `[${mdText(label)}](${mdUrl(o.source(hit.id, label))})` : m;
    });
  }

  // Erst die Links, dann [[…]]: ein Link, der aus einem Verweis entsteht, ist schon richtig und wird nicht noch einmal umgeschrieben
  // (er behielte sonst nur die Nummer ohne den lesbaren Titel).
  function rewriteMoved(body, o) {
    return outsideCode(body, part => {
      let s = part.replace(/(!\[[^\]\n]*\]\()att:(\d+)((?:\s+"[^"]*")?\))/g, (m, a, id, b) => (o.atts && o.atts.has(Number(id)) ? `${a}att:${o.atts.get(Number(id))}${b}` : m));
      s = rewriteUrls(s, o, true);
      return rewriteRefs(s, o, true);
    });
  }

  function rewriteStaying(body, o) {
    return outsideCode(body, part => rewriteRefs(rewriteUrls(part, o, false), o, false));
  }

  /** Link am Knoten: wie ein Link im Text. moving: der Knoten geht mit. */
  function rewriteLink(url, o, moving) {
    if (!url) return url;
    return movedUrl(url, o, !!moving) || url;
  }

  global.NoNotesMove = { rewriteMoved, rewriteStaying, rewriteLink, outsideCode };
})(typeof window !== 'undefined' ? window : globalThis);
