/* NoNotes – Adressen von Notizen (v2.7.0): die Nummer der Notiz mit dem Titel als lesbarem Zusatz, «42-sitzungsprotokoll».
   Massgebend ist die Nummer; der Zusatz darf veralten (ein Link übersteht das Umbenennen).
   Wo dieser Teil in der Adresse steht, sagt die Hülle (shell.routes): lokal hinter dem # («index.html#w=arbeit&n=42-…»), im Dienst als
   Pfad («/w/<id>/42-…», damit auch ein Server die Notiz ansprechen kann). Ohne eigene Form gilt hashRoutes() («#n=42-…»).

   Schnittstelle shell.routes (siehe docs/BACKEND.md):
     current()            → { note: Nummer oder null, area?: Bereich } aus der jetzigen Adresse
     href({ note, title }) → volle Adresse für die Notiz (note null: die Übersicht); für den Verlauf und «Link kopieren»
     parse(url)           → { note, area? } für eine Adresse dieser App (dieses Bereichs oder Arbeitsbereichs), sonst null
     enter(target)?       → Promise<boolean>: Daten passend machen (lokal: in den Bereich wechseln); false bricht ab */
(function (global) {
  'use strict';

  const SEGMENT_RE = /^(\d{1,12})(?:-[^/?#]*)?$/;
  const MAX_SLUG = 60;

  /** Titel als lesbarer Teil einer Adresse: klein, Umlaute ausgeschrieben, nur Buchstaben, Ziffern und «-». */
  function slug(title) {
    return String(title || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, MAX_SLUG).replace(/-+$/, '');
  }

  /** «42-sitzungsprotokoll» (ohne Titel nur «42»). */
  function segment(id, title) {
    const s = slug(title);
    return s ? `${id}-${s}` : String(id);
  }

  /** Nummer aus «42-…» (auch URL-kodiert), sonst null. */
  function noteOf(value) {
    let v = String(value == null ? '' : value);
    try { v = decodeURIComponent(v); } catch (e) { /* so lassen */ }
    const m = SEGMENT_RE.exec(v.trim());
    return m ? Number(m[1]) : null;
  }

  const hashParams = url => new URLSearchParams(String(url.hash || '').replace(/^#/, ''));
  const samePage = (a, b) => a.origin === b.origin && a.pathname.replace(/index\.html$/, '') === b.pathname.replace(/index\.html$/, '');

  /** Vorgabe ohne eigene Form der Hülle: «#n=42-titel» an der jetzigen Seite; andere Teile hinter dem # bleiben. */
  function hashRoutes(options) {
    const o = options || {};
    const param = o.param || 'n';
    const loc = () => new URL(global.location.href);
    return {
      current() { return { note: noteOf(hashParams(loc()).get(param)) }; },
      href({ note, title }) {
        const u = loc();
        const h = hashParams(u);
        if (note == null) h.delete(param); else h.set(param, segment(note, title));
        u.hash = h.toString();
        return u.href;
      },
      parse(url) {
        let u;
        try { u = new URL(url, global.location.href); } catch (e) { return null; }
        if (!samePage(u, loc())) return null;
        const note = noteOf(hashParams(u).get(param));
        return note == null ? null : { note };
      },
    };
  }

  global.NoNotesRoutes = { slug, segment, noteOf, hashParams, samePage, hashRoutes, SEGMENT_RE };
})(window);
