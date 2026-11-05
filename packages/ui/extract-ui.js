/* NoNotes – «In Unterknoten auslagern» in der Oberfläche (seit 4.2.0).

   Ist im Editor Text ausgewählt (Schreiben, geteilte Ansicht oder Vorschau), steht am Ende der Auswahl eine runde Schaltfläche mit
   einer Verzweigung; Klick oder Strg+Alt+U lagert die Auswahl in Unterknoten aus (Regeln: packages/core/extract.js). In der Vorschau
   zählen ganze Blöcke (Absätze, Listenpunkte, Überschriften, Tabellen, Codeblöcke, Einträge); sie sind markiert, solange die
   Schaltfläche steht. Hat die Auswahl mehrere Abschnitte, fragt ein Dialog, welche ein eigener Knoten werden.

   Danach bleibt der Editor auf der Eltern-Notiz; oben steht «… Unterknoten angelegt» mit «Rückgängig» (Text zurück, neue Knoten in den
   Papierkorb), bis die Notiz wechselt. Öffnet die Person einen Knoten, dessen Titel aus dem ersten Satz stammt, steht der Fokus im Titel
   und der Titel ist markiert; wird ein ausgelagerter Knoten in dieser Sitzung umbenannt, folgt der Verweis in der Eltern-Notiz.

   create(host): host gibt, was der App gehört: editor(), backend(), noteId(), canWrite(), denyWrite(), author(), applyEdit(result)
   (Text über den Editor setzen und speichern), refresh(parentId) (Baum, Liste, Zähler nach dem Anlegen), dialog (Elemente des
   Dialogs: dialog, list, ok), showBanner(text, actions), hideBannerIf(text), status(text, kind), errorText(e). */
(function (global) {
  'use strict';

  const { t, tn } = global.NoNotesI18n;
  const X = () => global.NoNotesExtract;
  const SVG = 'http://www.w3.org/2000/svg';
  const MARK = 'nn-extract-mark';

  function icon() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const [cx, cy] of [[6, 5], [12, 19], [18, 5]]) {
      const c = document.createElementNS(SVG, 'circle');
      c.setAttribute('cx', String(cx));
      c.setAttribute('cy', String(cy));
      c.setAttribute('r', '2.2');
      svg.appendChild(c);
    }
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', 'M12 16.8V13M6 7.2v.8a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4v-.8');
    svg.appendChild(p);
    return svg;
  }

  /** Lage des Zeichens pos im Textfeld (Viewport): { x, y, h } über einen unsichtbaren Spiegel mit denselben Schriftmassen. */
  function caretRect(ta, pos) {
    const cs = getComputedStyle(ta);
    const div = document.createElement('div');
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'letterSpacing', 'lineHeight', 'textTransform',
      'wordSpacing', 'textIndent', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth',
      'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'direction']) div.style[p] = cs[p];
    Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-10000px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
      wordBreak: cs.wordBreak, boxSizing: 'border-box', overflow: 'hidden', height: 'auto' });
    div.style.width = (ta.clientWidth + parseFloat(cs.borderLeftWidth || 0) + parseFloat(cs.borderRightWidth || 0)) + 'px';
    div.textContent = ta.value.slice(0, pos);
    const span = document.createElement('span');
    span.textContent = ta.value.slice(pos, pos + 1) || '.';
    div.appendChild(span);
    document.body.appendChild(div);
    const box = ta.getBoundingClientRect();
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const r = { x: box.left + span.offsetLeft - ta.scrollLeft, y: box.top + span.offsetTop - ta.scrollTop, h: lh };
    div.remove();
    return r;
  }

  function create(host) {
    let btn = null;
    let current = null;   // { kind: 'text', start, end } | { kind: 'preview', from, to }
    let last = null;      // das letzte Auslagern, für Rückgängig
    let lastBanner = '';
    let busy = false;
    let frame = 0;
    const titleFocus = new Set();      // Knoten mit Titel aus dem ersten Satz, noch nicht geöffnet
    const links = new Map();           // Knoten → { parent, label }: der Verweis folgt dem Umbenennen (diese Sitzung)

    const ed = () => host.editor();

    function button() {
      if (btn) return btn;
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'extractBtn';
      btn.className = 'extract-btn';
      btn.hidden = true;
      btn.title = t('In Unterknoten auslagern (Strg+Alt+U)');
      btn.setAttribute('aria-label', t('In Unterknoten auslagern'));
      btn.appendChild(icon());
      btn.addEventListener('mousedown', e => e.preventDefault()); // Auswahl und Fokus bleiben im Editor
      btn.addEventListener('click', () => { run(); });
      document.body.appendChild(btn);
      return btn;
    }

    function unmark() {
      const e = ed();
      if (!e) return;
      for (const m of e.preview.querySelectorAll('.' + MARK)) m.classList.remove(MARK);
    }

    function hide() {
      current = null;
      if (btn) btn.hidden = true;
      unmark();
    }

    function place(x, y, bounds) {
      const b = button();
      b.hidden = false;
      const w = b.offsetWidth || 28;
      const h = b.offsetHeight || 28;
      let left = Math.min(Math.max(x, bounds.left + 2), bounds.right - w - 2);
      let top = y;
      if (top + h > bounds.bottom - 2) top = bounds.bottom - h - 2;
      top = Math.max(top, bounds.top + 2);
      left = Math.max(2, Math.min(left, window.innerWidth - w - 2));
      b.style.left = Math.round(left) + 'px';
      b.style.top = Math.round(top) + 'px';
    }

    const visible = node => !!node && node.getClientRects().length > 0 && !node.closest('[hidden]');

    /** Blöcke der Vorschau mit Quellzeile, in der Reihenfolge; Teile von Tabellen, Einträgen und Zitaten zählen zu ihrem Block. */
    function anchors() {
      return [...ed().preview.querySelectorAll('[data-line]')].filter(a => !(a.parentElement && a.parentElement.closest('table, .md-q, .md-embed, blockquote')));
    }

    function anchorOf(node, list) {
      const set = new Set(list);
      for (let n = node && node.nodeType === 1 ? node : node && node.parentElement; n && n !== ed().preview; n = n.parentElement) if (set.has(n)) return n;
      return null;
    }

    /** Zeilen der Auswahl in der Vorschau, auf ganze Blöcke erweitert: { from, to, marks } oder null. */
    function previewLines(range) {
      const list = anchors();
      if (!list.length) return null;
      const hits = list.filter(a => range.intersectsNode(a));
      let first = anchorOf(range.startContainer, list) || hits[0];
      let lastA = anchorOf(range.endContainer, list) || hits[hits.length - 1];
      if (!first || !lastA) return null;
      // endet die Auswahl ganz am Anfang eines Blocks (dreifacher Klick), gehört dieser Block nicht dazu
      const head = document.createRange();
      head.setStart(lastA, 0);
      head.setEnd(range.endContainer, range.endOffset);
      if (!head.toString().trim() && lastA !== first) lastA = list[Math.max(list.indexOf(first), list.indexOf(lastA) - 1)];
      const from = Number(first.dataset.line);
      const endLine = Number(lastA.dataset.line);
      if (!Number.isFinite(from) || !Number.isFinite(endLine)) return null;
      const lines = ed().get().split('\n');
      let to = lines.length - 1;
      for (let i = list.indexOf(lastA) + 1; i < list.length; i++) {
        const n = Number(list[i].dataset.line);
        if (Number.isFinite(n) && n > endLine) { to = n - 1; break; }
      }
      if (to < from) return null;
      return { from: Math.min(from, endLine), to, marks: list.filter(a => { const n = Number(a.dataset.line); return n >= from && n <= to; }) };
    }

    /** Schaltfläche nachführen: nach jeder Änderung der Auswahl, beim Scrollen, bei Grössenänderungen. */
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateNow);
    }

    function updateNow() {
      const e = ed();
      if (busy || !e || host.noteId() == null || !host.canWrite() || !visible(e.el)) { hide(); return; }
      const ta = e.textarea;
      if (document.activeElement === ta && ta.selectionStart !== ta.selectionEnd && visible(ta)) {
        unmark();
        const p = X().plan(ta.value, ta.selectionStart, ta.selectionEnd);
        if (!p) { hide(); return; }
        current = { kind: 'text', start: ta.selectionStart, end: ta.selectionEnd };
        const c = caretRect(ta, ta.selectionEnd);
        const box = ta.getBoundingClientRect();
        // ganz ausserhalb des Sichtbaren: keine Schaltfläche; liegt nur das Ende ausserhalb, steht sie am Rand
        if (c.y + c.h < box.top || caretRect(ta, ta.selectionStart).y > box.bottom) { if (btn) btn.hidden = true; return; }
        place(c.x + 4, c.y + c.h + 2, box);
        return;
      }
      const sel = window.getSelection();
      const pv = e.preview;
      if (sel && sel.rangeCount && !sel.isCollapsed && visible(pv)) {
        const range = sel.getRangeAt(0);
        if (pv.contains(range.startContainer) && pv.contains(range.endContainer) && range.toString().trim()) {
          const r = previewLines(range);
          if (r) {
            unmark();
            for (const m of r.marks) m.classList.add(MARK);
            current = { kind: 'preview', from: r.from, to: r.to };
            const rects = [...range.getClientRects()].filter(x => x.width || x.height);
            const end = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
            place(end.right + 4, end.bottom + 2, pv.getBoundingClientRect());
            return;
          }
        }
      }
      hide();
    }

    /** Dialog bei mehreren Abschnitten: ein Haken je Abschnitt; gibt die Wahl (true/false je Abschnitt) oder null bei Abbruch. */
    function ask(p) {
      const d = host.dialog;
      return new Promise(resolve => {
        d.list.replaceChildren();
        p.parts.forEach((part, i) => {
          const li = document.createElement('li');
          const label = document.createElement('label');
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = true;
          box.dataset.part = String(i);
          const name = document.createElement('span');
          name.className = 'extract-title';
          name.textContent = part.title || t('Ausgelagerter Text');
          label.append(box, ' ', name);
          if (part.auto) {
            const small = document.createElement('small');
            small.textContent = ' ' + t('(Titel aus dem ersten Satz)');
            label.appendChild(small);
          }
          li.appendChild(label);
          d.list.appendChild(li);
        });
        const boxes = () => [...d.list.querySelectorAll('input[type="checkbox"]')];
        const sync = () => { d.ok.disabled = !boxes().some(b => b.checked); };
        d.list.onchange = sync;
        sync();
        const done = () => {
          d.dialog.removeEventListener('close', done);
          resolve(d.dialog.returnValue === 'ok' ? boxes().map(b => b.checked) : null);
        };
        d.dialog.returnValue = '';
        d.dialog.addEventListener('close', done);
        if (typeof d.dialog.showModal === 'function') d.dialog.showModal(); else d.dialog.setAttribute('open', '');
        d.ok.focus();
      });
    }

    async function run() {
      const sel = current;
      const e = ed();
      if (!sel || !e || busy) return;
      if (host.denyWrite()) return;
      const noteId = host.noteId();
      const body = e.get();
      let p;
      if (sel.kind === 'text') p = X().plan(body, sel.start, sel.end);
      else { const r = X().rangeOfLines(body, sel.from, sel.to); p = X().plan(body, r.start, r.end); }
      if (!p) { hide(); return; }
      hide();
      let chosen = null;
      if (p.parts.length > 1) {
        chosen = await ask(p);
        if (!chosen) { e.focus(); return; }
      }
      const built = X().build(p, chosen);
      if (!built) return;
      const B = host.backend();
      busy = true;
      let made = null;
      try {
        made = await X().createNodes(B, noteId, built, { author: host.author(), fallbackTitle: t('Ausgelagerter Text') });
        const original = body.slice(p.start, p.end);
        // inzwischen getippt (langsames Netz)? Dann dort ersetzen, wo der ausgewählte Text noch steht
        const now = e.get();
        let at = p.start;
        if (now !== body) {
          at = now.slice(p.start, p.end) === original ? p.start : now.indexOf(original);
          if (at < 0 || (at !== p.start && now.indexOf(original, at + 1) >= 0)) throw Object.assign(new Error(t('Der ausgewählte Text hat sich inzwischen geändert.')), { code: 'EXTRACT_STALE' });
        }
        const rep = X().replacement(p, built, made.ids, made.titles);
        const next = now.slice(0, at) + rep + now.slice(at + original.length);
        if (host.noteId() !== noteId) throw Object.assign(new Error(t('Inzwischen ist eine andere Notiz offen.')), { code: 'EXTRACT_STALE' });
        await host.applyEdit({ text: next, selStart: at + rep.length, selEnd: at + rep.length });
        const removed = await X().dropUnused(B, noteId, next, made.moved);
        for (const id of removed) e.forgetAttachment(id);
        if (removed.length) await e.renderAttachments();
        last = { noteId, start: at, original, replacement: rep, ids: made.ids, moved: made.moved, removed };
        built.nodes.forEach((n, i) => {
          if (n.auto) titleFocus.add(made.ids[i]);
          links.set(made.ids[i], { parent: noteId, label: X().label(made.titles[i]) });
        });
        made = null;
        await host.refresh(noteId);
        const count = last.ids.length;
        host.status(tn('Text in {n} Unterknoten ausgelagert', 'Text in {n} Unterknoten ausgelagert', count), 'saved');
        lastBanner = tn('{n} Unterknoten angelegt. Hier steht ein Verweis darauf.', '{n} Unterknoten angelegt. Hier stehen Verweise darauf.', count);
        host.showBanner(lastBanner, [
          { label: t('Rückgängig'), onClick: () => { undo(); } },
          { label: t('Schliessen'), onClick: () => { host.hideBannerIf(lastBanner); } },
        ]);
      } catch (err) {
        if (made) for (const id of made.ids) { try { await B.deleteNote(id); await B.purgeNote(id); } catch (x) { /* weiter */ } }
        host.status(t('Auslagern fehlgeschlagen: {fehler}', { fehler: host.errorText(err) }), 'error');
      } finally {
        busy = false;
      }
    }

    async function undo() {
      const rec = last;
      host.hideBannerIf(lastBanner);
      const e = ed();
      if (!rec || !e || busy || host.noteId() !== rec.noteId) return;
      if (host.denyWrite()) return;
      busy = true;
      try {
        const r = await X().undo(host.backend(), rec.noteId, e.get(), rec);
        if (!r) { host.status(t('Die Verweise stehen nicht mehr so im Text; Rückgängig geht nicht mehr.'), 'error'); return; }
        await host.applyEdit({ text: r.body, selStart: r.start, selEnd: r.end });
        if (rec.removed.length) await e.renderAttachments();
        for (const id of rec.ids) { titleFocus.delete(id); links.delete(id); }
        last = null;
        await host.refresh(rec.noteId);
        host.status(t('Auslagern rückgängig gemacht; die neuen Unterknoten liegen im Papierkorb.'), 'saved');
      } catch (err) {
        host.status(t('Rückgängig fehlgeschlagen: {fehler}', { fehler: host.errorText(err) }), 'error');
      } finally {
        busy = false;
      }
    }

    /** Eine andere Notiz ist offen (oder keine): Schaltfläche weg, Rückgängig nicht mehr. */
    function noteChanged() {
      hide();
      if (last) { host.hideBannerIf(lastBanner); last = null; }
    }

    /** Beim Öffnen: true, wenn der Titel den Fokus bekommen soll (erster Satz, erstes Öffnen). */
    function takeTitleFocus(id) {
      return titleFocus.delete(id);
    }

    /** Ein ausgelagerter Knoten hat einen neuen Titel: der Verweis in der Eltern-Notiz folgt (nur in dieser Sitzung). Nacheinander,
     *  damit zwei rasche Speichervorgänge beim Tippen des Titels sich nicht überholen (der zweite baut auf dem Verweis des ersten auf). */
    let renameChain = Promise.resolve();
    function renamed(id, title) {
      const run = renameChain.then(() => renameNow(id, title));
      renameChain = run.catch(() => {});
      return run;
    }

    async function renameNow(id, title) {
      const entry = links.get(id);
      if (!entry) return;
      titleFocus.delete(id);
      const next = X().label(title);
      if (!next || next === entry.label) return;
      const oldLink = `[[${entry.label}#${id}]]`;
      const newLink = `[[${next}#${id}]]`;
      try {
        if (host.noteId() === entry.parent && ed()) {
          const text = ed().get();
          if (!text.includes(oldLink)) { links.delete(id); return; }
          await host.applyEdit({ text: text.split(oldLink).join(newLink) });
        } else {
          const B = host.backend();
          const parent = await B.getNote(entry.parent);
          if (!parent || parent.deleted_at || parent.archived_at || !String(parent.body || '').includes(oldLink)) { links.delete(id); return; }
          await B.updateNote(parent.id, parent.title, parent.body.split(oldLink).join(newLink), { author: host.author(), baseUpdatedAt: parent.updated_at });
        }
        entry.label = next;
      } catch (err) {
        if (err && err.code === 'NOTE_CONFLICT') { links.delete(id); return; } // jemand anders hat die Eltern-Notiz geändert: nicht anfassen
        throw err;
      }
    }

    /** Ereignisse am Editor anmelden (einmal nach dem Bau des Editors). */
    function attach() {
      const e = ed();
      const ta = e.textarea;
      button();
      for (const type of ['select', 'mouseup', 'keyup', 'input', 'scroll', 'focus']) ta.addEventListener(type, update);
      ta.addEventListener('blur', () => setTimeout(update, 0));
      e.preview.addEventListener('mouseup', update);
      e.preview.addEventListener('keyup', update);
      e.preview.addEventListener('scroll', update);
      document.addEventListener('selectionchange', update);
      window.addEventListener('resize', update);
      window.addEventListener('scroll', update, true);
      document.addEventListener('keydown', ev => {
        if (!(ev.ctrlKey || ev.metaKey) || !ev.altKey || ev.shiftKey || (ev.key || '').toLowerCase() !== 'u') return;
        if (ev.getModifierState && ev.getModifierState('AltGraph')) return; // AltGr+U schreibt auf manchen Tastaturen ein Zeichen
        updateNow();
        if (!current) return;
        ev.preventDefault();
        run();
      });
    }

    return { attach, update, hide, run, undo, noteChanged, takeTitleFocus, renamed, get last() { return last; } };
  }

  global.NoNotesExtractUI = { create, caretRect };
})(window);
