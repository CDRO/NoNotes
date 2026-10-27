/* NoNotes – Mindmap: Layout, SVG-Darstellung und Interaktion.
   Kennt keine Datenbank. Bekommt flache Zeilen (id, title, parent_id, sort_order, collapsed, badge), dazu Querverweise
   ({ from_id, to_id, title }; gestrichelte Linien quer zur Hierarchie, seit v1.8.0) und meldet Aktionen über Rückrufe. */
(function (global) {
  'use strict';

  const { t, tn } = global.NoNotesI18n;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'; // i18n-ignore
  const FONT = '600 14px ' + FONT_FAMILY;
  const ROOT_FONT = '700 16px ' + FONT_FAMILY;

  const NODE_H = 34;
  const ROOT_H = 46;
  const PAD_X = 14;
  const GAP_X = 56;
  const GAP_Y = 10;
  const MIN_W = 56;
  const MAX_W = 260;
  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 3;
  const GLIDE_MS = 200;   // so lange gleiten die Knoten an ihren neuen Platz (v3.0.0)
  const GLIDE_MAX = 400;  // bei mehr Knoten springen sie, damit grosse Mindmaps flüssig bleiben

  const measureCanvas = document.createElement('canvas').getContext('2d');

  function measure(text, font) {
    measureCanvas.font = font;
    return measureCanvas.measureText(text).width;
  }

  function fitLabel(text, font, maxWidth) {
    let label = text;
    if (measure(label, font) <= maxWidth) return { label, width: measure(label, font) };
    while (label.length > 1 && measure(label.trimEnd() + '…', font) > maxWidth) label = label.slice(0, -1);
    label = label.trimEnd() + '…';
    return { label, width: measure(label, font) };
  }

  function svgEl(name, attrs, parent) {
    const e = document.createElementNS(SVG_NS, name);
    if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------- Baum und Layout ----------

  function buildTree(rows, mapTitle) {
    const byId = new Map();
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id, title: r.title, parentId: r.parent_id, order: r.sort_order,
        collapsed: !!r.collapsed, badge: r.badge || 0, dbadge: r.dbadge || 0, tbadge: r.tbadge || 0, archived: !!r.archived_at, children: [],
        side: r.side === 'left' || r.side === 'right' ? r.side : null,
      });
    }
    const root = { id: 'root', isRoot: true, title: mapTitle, children: [], badge: 0, dbadge: 0, tbadge: 0 };
    for (const n of byId.values()) {
      const parent = n.parentId != null ? byId.get(n.parentId) : null;
      (parent || root).children.push(n);
      if (!parent) n.parentId = null;
    }
    const byOrder = (a, b) => (a.order - b.order) || (a.id - b.id);
    root.children.sort(byOrder);
    for (const n of byId.values()) n.children.sort(byOrder);
    return { root, byId };
  }

  /** layout.ignoreSides: alle Hauptäste neu verteilen («Neu verteilen»), ohne die gespeicherten Seiten. */
  function layoutTree(root, layout) {
    const sizeNode = n => {
      const font = n.isRoot ? ROOT_FONT : FONT;
      const fit = fitLabel((n.title || '').trim() || t('Ohne Titel'), font, MAX_W);
      n.label = fit.label;
      n.w = Math.max(MIN_W, Math.ceil(fit.width) + 2 * PAD_X + (n.isRoot ? 14 : 0));
      n.h = n.isRoot ? ROOT_H : NODE_H;
      n.visibleChildren = (!n.isRoot && n.collapsed) ? [] : n.children;
      n.hiddenCount = n.visibleChildren.length ? 0 : countDescendants(n);
      n.visibleChildren.forEach(sizeNode);
    };
    const countDescendants = n => n.children.reduce((s, c) => s + 1 + countDescendants(c), 0);
    const totalBadge = n => n.badge + n.children.reduce((s, c) => s + totalBadge(c), 0);
    const totalDBadge = n => n.dbadge + n.children.reduce((s, c) => s + totalDBadge(c), 0);
    const totalTBadge = n => n.tbadge + n.children.reduce((s, c) => s + totalTBadge(c), 0);
    sizeNode(root);
    // Eingeklappte Äste zeigen die offenen Fragen, Entscheide und Aufgaben des ganzen Teilbaums.
    const setBadges = n => {
      n.shownBadge = n.isRoot ? 0 : (n.collapsed ? totalBadge(n) : n.badge);
      n.shownDBadge = n.isRoot ? 0 : (n.collapsed ? totalDBadge(n) : n.dbadge);
      n.shownTBadge = n.isRoot ? 0 : (n.collapsed ? totalTBadge(n) : n.tbadge);
      n.visibleChildren.forEach(setBadges);
    };
    setBadges(root);

    const heights = new Map();
    const subtreeH = n => {
      if (heights.has(n)) return heights.get(n);
      const kids = n.visibleChildren;
      const h = kids.length
        ? Math.max(n.h, kids.reduce((s, c) => s + subtreeH(c), 0) + GAP_Y * (kids.length - 1))
        : n.h;
      heights.set(n, h);
      return h;
    };

    // Hauptäste links und rechts (v3.0.0): jeder behält seine gespeicherte Seite (side), damit nichts springt, wenn ein Ast wächst
    // oder einer dazukommt. Einer ohne Seite kommt auf die kürzere, die höchsten zuerst (so verteilt sich eine bestehende Mindmap
    // beim ersten Mal ausgewogen); diese Wahl meldet das Layout zurück (auto), die App speichert sie. Je Seite gilt die Reihenfolge.
    const right = [], left = [];
    let hr = 0, hl = 0;
    const ignore = !!(layout && layout.ignoreSides);
    const given = (layout && layout.sides) || {}; // ersatzweise, etwa für den Export dieselben Seiten wie auf dem Schirm
    const fixed = c => {
      const side = ignore ? null : (c.side || given[c.id]);
      return side === 'left' || side === 'right' ? side : null;
    };
    for (const c of root.children) {
      if (fixed(c) === 'right') hr += subtreeH(c) + GAP_Y;
      else if (fixed(c) === 'left') hl += subtreeH(c) + GAP_Y;
    }
    const auto = new Map();
    const free = root.children.filter(c => !fixed(c)).sort((a, b) => subtreeH(b) - subtreeH(a) || (a.order - b.order) || (a.id - b.id));
    for (const c of free) {
      const side = hr <= hl ? 'right' : 'left';
      auto.set(c.id, side);
      if (side === 'right') hr += subtreeH(c) + GAP_Y; else hl += subtreeH(c) + GAP_Y;
    }
    for (const c of root.children) ((fixed(c) || auto.get(c.id)) === 'left' ? left : right).push(c);

    root.x = -root.w / 2;
    root.y = -root.h / 2;
    root.dir = 0;

    const place = (n, dir, xEdge, yTop) => {
      const H = subtreeH(n);
      n.dir = dir;
      n.y = yTop + (H - n.h) / 2;
      n.x = dir > 0 ? xEdge : xEdge - n.w;
      let y = yTop;
      for (const c of n.visibleChildren) {
        place(c, dir, dir > 0 ? n.x + n.w + GAP_X : n.x - GAP_X, y);
        y += subtreeH(c) + GAP_Y;
      }
    };
    const placeSide = (list, dir) => {
      const total = list.reduce((s, c) => s + subtreeH(c), 0) + GAP_Y * Math.max(0, list.length - 1);
      let y = -total / 2;
      for (const c of list) {
        place(c, dir, dir > 0 ? root.w / 2 + GAP_X : -root.w / 2 - GAP_X, y);
        y += subtreeH(c) + GAP_Y;
      }
    };
    placeSide(right, 1);
    placeSide(left, -1);

    const placed = [];
    const collect = n => { placed.push(n); n.visibleChildren.forEach(collect); };
    collect(root);
    const bounds = placed.reduce((b, n) => ({
      minX: Math.min(b.minX, n.x), minY: Math.min(b.minY, n.y),
      maxX: Math.max(b.maxX, n.x + n.w), maxY: Math.max(b.maxY, n.y + n.h),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    return { placed, bounds, auto };
  }

  // ---------- Querverweise ----------

  const LINK_TURN = 12;   // Abstand der Kehre vom Knoten, wenn die Linie zurück Richtung Wurzel muss
  const LINK_STEPS = 24;  // Stützpunkte je Kurvenstück für die Bewertung
  const LINK_CELL = 64;   // Rasterweite für die Suche nach Knoten in der Nähe eines Stützpunkts
  const LINK_PAD = 6;     // so nah soll eine Linie an fremde Knoten nicht heran

  /** Rechteck eines Knotens; bei eingeklappten Ästen samt Kreis mit der Zahl am äusseren Ende. */
  function boxOf(n) {
    const bubble = !n.isRoot && n.collapsed && n.children.length ? 22 : 0;
    return { x1: n.x - (n.dir < 0 ? bubble : 0), y1: n.y, x2: n.x + n.w + (n.dir > 0 ? bubble : 0), y2: n.y + n.h };
  }

  /** Raster der Knoten für linkPath (einmal je Zeichnen): Zelle → Einträge { n, r: Rechteck, x1…y2: mit Abstand }. */
  function linkIndex(nodes) {
    const cells = new Map();
    const cell = v => Math.floor(v / LINK_CELL);
    for (const n of nodes) {
      const r = boxOf(n);
      const e = { n, r, x1: r.x1 - LINK_PAD, y1: r.y1 - LINK_PAD, x2: r.x2 + LINK_PAD, y2: r.y2 + LINK_PAD };
      for (let cx = cell(e.x1); cx <= cell(e.x2); cx++) {
        for (let cy = cell(e.y1); cy <= cell(e.y2); cy++) {
          const k = cx * 65536 + cy;
          const list = cells.get(k);
          if (list) list.push(e); else cells.set(k, [e]);
        }
      }
    }
    return cells;
  }

  function bezier(s, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * s[0].x + b * s[1].x + c * s[2].x + d * s[3].x, y: a * s[0].y + b * s[1].y + c * s[2].y + d * s[3].y };
  }

  /** Kurvenstück von P (Richtung dir waagerecht) zum Ziel E (E.ax/E.ay: woher die Linie ankommt); f, g: Steifigkeit. Wo eine
   *  Richtung vom anderen Ende weg zeigt, bleibt der Bogen klein. */
  function linkCurve(P, dir, E, f, g) {
    const dx = Math.abs(E.x - P.x), dy = Math.abs(E.y - P.y);
    const k1 = dir * (E.x - P.x) > 0 ? Math.max(30, f * dx) : 30 + 60 * f;
    const toward = E.ax ? E.ax * (P.x - E.x) > 0 : E.ay * (P.y - E.y) > 0;
    const k2 = Math.min(toward ? 160 : 100, Math.max(36, g * (E.ay ? Math.max(dy, dx / 2) : Math.max(dx, dy / 2))));
    return [P, { x: P.x + dir * k1, y: P.y }, { x: E.x + E.ax * k2, y: E.y + E.ay * k2 }, E];
  }

  /** Pfad eines Querverweises von Knoten a zu Knoten b (seit 2.8.2): beginnt am äusseren Ende von a (weg von der Wurzel, wo keine
   *  Linien zu den Elternknoten ansetzen) und endet von unten in der Mitte der Unterkante von b oder, wenn b keine Unternotizen
   *  hat, von aussen an dessen äusserem Ende. Muss die Linie zurück Richtung Wurzel, macht sie zuerst eine Kehre über oder unter
   *  a. Von mehreren Kurven gewinnt die, die am wenigsten durch andere Knoten läuft und kurz ist. index: linkIndex() aller
   *  gezeichneten Knoten. Ergebnis: { d, box } mit dem Rechteck, das die Linie samt Pfeilspitze braucht. */
  function linkPath(a, b, index) {
    const sa = a.dir < 0 ? -1 : 1, sb = b.dir < 0 ? -1 : 1;
    const S = { x: sa > 0 ? a.x + a.w : a.x, y: a.y + a.h / 2 };
    const ends = [{ x: b.x + b.w / 2, y: b.y + b.h, ax: 0, ay: 1 }];
    if (!b.children.length) ends.push({ x: sb > 0 ? b.x + b.w : b.x, y: b.y + b.h / 2, ax: sb, ay: 0 });
    const u = a.h / 2 + LINK_TURN;
    const cands = [];
    for (const E of ends) {
      for (const f of [0.3, 0.55, 0.8]) {
        for (const g of [0.35, 0.7]) {
          cands.push([linkCurve(S, sa, E, f, g)]);
          for (const v of [-1, 1]) {
            const U = { x: S.x, y: S.y + v * u };
            cands.push([[S, { x: S.x + sa * u * 0.8, y: S.y }, { x: U.x + sa * u * 0.8, y: U.y }, U], linkCurve(U, -sa, E, f, g)]);
          }
        }
      }
    }
    // Kosten: Länge, dazu jedes Stück durch einen fremden Knoten (mit Abstand) sechsfach, durch a oder b selbst zwanzigfach
    let best = null;
    for (const segs of cands) {
      let cost = 0;
      for (const s of segs) {
        let prev = s[0];
        for (let i = 1; i <= LINK_STEPS; i++) {
          const p = bezier(s, i / LINK_STEPS);
          const d = Math.hypot(p.x - prev.x, p.y - prev.y), mx = (p.x + prev.x) / 2, my = (p.y + prev.y) / 2;
          cost += d;
          const list = index.get(Math.floor(mx / LINK_CELL) * 65536 + Math.floor(my / LINK_CELL));
          if (list) {
            for (const e of list) {
              const own = e.n === a || e.n === b, r = own ? e.r : e;
              if (mx > r.x1 && mx < r.x2 && my > r.y1 && my < r.y2) cost += d * (own ? 20 : 6);
            }
          }
          prev = p;
        }
      }
      if (!best || cost < best.cost) best = { segs, cost };
    }
    const box = { minX: S.x, minY: S.y, maxX: S.x, maxY: S.y };
    for (const s of best.segs) {
      for (let i = 1; i <= LINK_STEPS; i++) {
        const p = bezier(s, i / LINK_STEPS);
        box.minX = Math.min(box.minX, p.x - 6); box.maxX = Math.max(box.maxX, p.x + 6);
        box.minY = Math.min(box.minY, p.y - 6); box.maxY = Math.max(box.maxY, p.y + 6);
      }
    }
    const f = v => Math.round(v * 10) / 10;
    const d = `M ${f(S.x)} ${f(S.y)} ` + best.segs.map(s => `C ${f(s[1].x)} ${f(s[1].y)}, ${f(s[2].x)} ${f(s[2].y)}, ${f(s[3].x)} ${f(s[3].y)}`).join(' ');
    return { d, box };
  }

  /** Rechteck aus beiden. */
  function unionBox(a, b) {
    return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
  }

  /** Querverweise, deren beide Enden gezeichnet sind (nicht eingeklappt, nicht die Wurzel): [{ a, b, title }], je Paar einmal. */
  function drawableLinks(links, placed) {
    const byId = new Map(placed.filter(n => !n.isRoot).map(n => [n.id, n]));
    const out = [];
    const seen = new Set();
    for (const l of links || []) {
      const a = byId.get(l.from_id);
      const b = byId.get(l.to_id);
      if (!a || !b || a === b) continue;
      const key = `${a.id}>${b.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a, b, title: l.title });
    }
    return out;
  }

  const ARROW_ATTRS = { viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' };
  const ARROW_PATH = 'M 0 0 L 10 5 L 0 10 z';

  // ---------- Instanz ----------

  function create(svg, handlers) {
    handlers = handlers || {};
    const defs = svgEl('defs', null, svg);
    svgEl('path', { d: ARROW_PATH }, svgEl('marker', Object.assign({ id: 'mmLinkArrow', class: 'mm-link-arrow' }, ARROW_ATTRS), defs));
    const viewport = svgEl('g', { class: 'mm-viewport' }, svg);
    const edgesG = svgEl('g', { class: 'mm-edges' }, viewport);
    const linksG = svgEl('g', { class: 'mm-links' }, viewport);
    const nodesG = svgEl('g', { class: 'mm-nodes' }, viewport);
    const overlayG = svgEl('g', { class: 'mm-overlay' }, viewport);
    const dropLine = svgEl('line', { class: 'mm-drop-line', visibility: 'hidden' }, overlayG);

    const inst = {
      k: 1, tx: 0, ty: 0,
      root: null, byId: new Map(), placed: [], bounds: null,
      selectedId: null,
      multi: new Set(),
      needsFit: true,
    };

    function applyTransform() {
      viewport.setAttribute('transform', `translate(${inst.tx} ${inst.ty}) scale(${inst.k})`);
    }

    function nodeOf(id) {
      if (id === 'root') return inst.root;
      return inst.byId.get(Number(id)) || null;
    }

    function nodeElOf(id) {
      return nodesG.querySelector(`.mm-node[data-id="${id}"]`);
    }

    function isAncestorOrSelf(ancestorId, nodeId) {
      // Ist ancestorId (Zahl) ein Vorfahre von nodeId oder gleich?
      let n = nodeOf(nodeId);
      while (n && !n.isRoot) {
        if (n.id === Number(ancestorId)) return true;
        n = n.parentId == null ? inst.root : inst.byId.get(n.parentId);
      }
      return false;
    }

    // ---------- Darstellung ----------

    function drawNode(n) {
      const g = svgEl('g', {
        class: 'mm-node' + (n.isRoot ? ' mm-root' : '') + (String(n.id) === String(inst.selectedId) ? ' mm-selected' : '')
          + (n.archived ? ' mm-archived' : '')
          + (n.match ? ' mm-match' : '') + (n.matchInside ? ' mm-match-inside' : '')
          + (!n.isRoot && inst.multi.has(n.id) ? ' mm-multi' : '')
          + (svg.classList.contains('has-matches') && !n.isRoot && !n.match && !n.matchInside ? ' mm-dim' : ''),
        'data-id': n.id,
        transform: `translate(${n.x} ${n.y})`,
        tabindex: '-1',
      }, nodesG);
      svgEl('rect', { width: n.w, height: n.h, rx: n.isRoot ? 12 : 9, ry: n.isRoot ? 12 : 9 }, g);
      const text = svgEl('text', {
        x: n.w / 2, y: n.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      }, g);
      text.textContent = n.label;
      if (n.label !== ((n.title || '').trim() || t('Ohne Titel'))) {
        svgEl('title', null, g).textContent = n.title;
      }
      if (!n.isRoot && n.children.length) {
        const cx = n.dir > 0 ? n.w + 11 : -11;
        const toggle = svgEl('g', {
          class: 'mm-toggle' + (n.collapsed ? ' mm-collapsed' : ''),
          transform: `translate(${cx} ${n.h / 2})`,
        }, g);
        svgEl('circle', { r: n.collapsed ? 10 : 7 }, toggle);
        const tt = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, toggle);
        tt.textContent = n.collapsed ? String(n.hiddenCount) : '–';
        svgEl('title', null, toggle).textContent = n.collapsed ? t('Ausklappen') : t('Einklappen');
      }
      if (n.shownBadge > 0) {
        const bx = n.dir < 0 ? 0 : n.w;
        const b = svgEl('g', { class: 'mm-badge', transform: `translate(${bx} 0)` }, g);
        svgEl('circle', { r: 9 }, b);
        const bt = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, b);
        bt.textContent = n.shownBadge > 99 ? '99+' : String(n.shownBadge);
        const questions = n.shownBadge - n.shownDBadge;
        svgEl('title', null, b).textContent = [
          questions > 0 ? tn('{n} offene Frage', '{n} offene Fragen', questions) : '',
          n.shownDBadge > 0 ? tn('{n} offener Entscheid', '{n} offene Entscheide', n.shownDBadge) : '',
        ].filter(Boolean).join(', ');
      }
      if (n.shownTBadge > 0) {
        const bx = n.dir < 0 ? 0 : n.w;
        const b = svgEl('g', { class: 'mm-tbadge', transform: `translate(${bx} ${n.h})` }, g);
        svgEl('circle', { r: 9 }, b);
        const bt = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, b);
        bt.textContent = n.shownTBadge > 99 ? '99+' : String(n.shownTBadge);
        svgEl('title', null, b).textContent = tn('{n} offene Aufgabe', '{n} offene Aufgaben', n.shownTBadge);
      }
      return g;
    }

    function drawEdge(parent, child) {
      const e = edgeEnds(parent, child, parent, child);
      // data-*: für Erweiterungen (Verbindung Eltern → Kind samt Endpunkten); 'root' ist die Wurzel
      return svgEl('path', {
        class: 'mm-edge',
        d: edgeD(e),
        'data-from': String(parent.id), 'data-to': String(child.id),
        'data-x1': e.px, 'data-y1': e.py, 'data-x2': e.cx, 'data-y2': e.cy,
      }, edgesG);
    }

    /** Gestrichelte Linie eines Querverweises; bei einer Suche blass, wenn ein Ende kein Treffer ist. */
    function drawLink(l) {
      const dim = svg.classList.contains('has-matches') && [l.a, l.b].some(n => !n.match && !n.matchInside);
      const path = linkPath(l.a, l.b, inst.linkIndex || (inst.linkIndex = linkIndex(inst.placed)));
      const p = svgEl('path', {
        class: 'mm-link' + (dim ? ' mm-dim' : ''),
        d: path.d,
        'data-from': l.a.id, 'data-to': l.b.id,
        'marker-end': 'url(#mmLinkArrow)',
      }, linksG);
      const name = n => (n.title || '').trim() || t('Ohne Titel');
      svgEl('title', null, p).textContent = t('Verweis von „{von}“ auf „{nach}“', { von: name(l.a), nach: name(l.b) });
      return path.box;
    }

    /** rows wie getTree; options.mapTitle, options.matchIds (Suche), options.links (Querverweise, nur sichtbare Enden werden gezeichnet). */
    function render(rows, options) {
      options = options || {};
      const { root, byId } = buildTree(rows, options.mapTitle || '');
      const matches = options.matchIds || null;
      if (matches) {
        const inside = n => n.children.some(c => matches.has(c.id) || inside(c));
        for (const n of byId.values()) {
          n.match = matches.has(n.id);
          n.matchInside = n.collapsed && inside(n);
        }
      } else {
        for (const n of byId.values()) { n.match = false; n.matchInside = false; }
      }
      svg.classList.toggle('has-matches', !!matches);
      const before = shownPositions(); // wo die Knoten bisher standen, zum Gleiten
      const { placed, bounds, auto } = layoutTree(root);
      inst.rows = rows;
      inst.root = root;
      inst.byId = byId;
      inst.placed = placed;
      inst.bounds = bounds;
      if (inst.selectedId != null && inst.selectedId !== 'root' && !byId.has(Number(inst.selectedId))) {
        inst.selectedId = null;
      }

      edgesG.replaceChildren();
      linksG.replaceChildren();
      nodesG.replaceChildren();
      const edges = [];
      for (const n of placed) {
        for (const c of n.visibleChildren) edges.push({ el: drawEdge(n, c), parent: n, child: c });
      }
      inst.linkIndex = null; // wird beim ersten Verweis gebaut
      for (const l of drawableLinks(options.links, placed)) inst.bounds = unionBox(inst.bounds, drawLink(l)); // Einpassen mit den Linien
      const els = new Map(placed.map(n => [n, drawNode(n)]));

      const fitNow = inst.needsFit;
      if (fitNow) { fit(); inst.needsFit = false; }
      else applyTransform();
      if (!fitNow) glide(before, els, edges);
      // Neue Hauptäste haben ihre Seite eben bekommen: die App hält sie fest, damit sie beim nächsten Mal nicht springen
      if (auto.size && handlers.onSides) handlers.onSides(Object.fromEntries(auto));
    }

    // ---------- Gleiten (v3.0.0) ----------

    /** Anfangs- und Endpunkte der Linie Eltern → Kind, mit den Positionen pp (Eltern) und cp (Kind). */
    function edgeEnds(parent, child, pp, cp) {
      const dir = child.dir;
      return {
        px: dir > 0 ? pp.x + parent.w : pp.x, py: pp.y + parent.h / 2,
        cx: dir > 0 ? cp.x : cp.x + child.w, cy: cp.y + child.h / 2,
      };
    }

    function edgeD(e) {
      const mx = (e.px + e.cx) / 2;
      return `M ${e.px} ${e.py} C ${mx} ${e.py}, ${mx} ${e.cy}, ${e.cx} ${e.cy}`;
    }

    /** pos: id → { x, y }, wo die Knoten gerade zu sehen sind, auch mitten im Gleiten, ein eben gezogener Knoten dort, wo er
     *  losgelassen wurde; fading: Knoten, die noch am Einblenden sind (die App zeichnet nach dem Anlegen gleich ein zweites Mal). */
    function shownPositions() {
      const pos = new Map();
      let fading = new Set();
      if (inst.glide) {
        cancelAnimationFrame(inst.glide.raf);
        for (const [id, p] of inst.glide.now) pos.set(id, p);
        fading = inst.glide.fading;
        inst.glide.finish(false);
      } else {
        for (const n of inst.placed) pos.set(String(n.id), { x: n.x, y: n.y });
      }
      if (inst.dropped) { pos.set(inst.dropped.id, inst.dropped); inst.dropped = null; }
      return { pos, fading };
    }

    function reducedMotion() {
      try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
    }

    /** Lässt die Knoten von ihrem bisherigen Platz (before) an den neuen gleiten; neue blenden ein, Querverweise erscheinen am Schluss.
     *  Ohne Bewegung, bei einer ganz anderen Mindmap, sehr vielen Knoten oder «Bewegung reduzieren» steht alles sofort da. */
    function glide(before, els, edges) {
      if (!before.pos.size || inst.placed.length > GLIDE_MAX || reducedMotion() || typeof requestAnimationFrame !== 'function') return;
      const moves = [], fresh = [];
      for (const n of inst.placed) {
        const p = before.pos.get(String(n.id));
        if (!p || before.fading.has(String(n.id))) fresh.push(n);
        else if (Math.abs(p.x - n.x) > 0.5 || Math.abs(p.y - n.y) > 0.5) moves.push({ n, el: els.get(n), x0: p.x, y0: p.y });
      }
      if (!moves.length && !fresh.length) return;
      if (fresh.length >= inst.placed.length - 1) return; // eine andere Mindmap (nur die Wurzel ist gleich): nichts gleitet
      const moving = new Map(moves.map(m => [m.n, m]));
      const freshSet = new Set(fresh);
      const lines = edges.filter(e => moving.has(e.parent) || moving.has(e.child) || freshSet.has(e.child));
      const now = new Map(inst.placed.map(n => [String(n.id), { x: n.x, y: n.y }]));
      const pos = (n, k) => {
        const m = moving.get(n);
        return m ? { x: m.x0 + (n.x - m.x0) * k, y: m.y0 + (n.y - m.y0) * k } : { x: n.x, y: n.y };
      };
      const hideLinks = moves.length && linksG.childNodes.length;
      if (hideLinks) linksG.style.opacity = '0';
      const show = k => {
        for (const m of moves) {
          const p = pos(m.n, k);
          m.el.setAttribute('transform', `translate(${p.x} ${p.y})`);
          now.set(String(m.n.id), p);
        }
        for (const e of lines) {
          e.el.setAttribute('d', edgeD(edgeEnds(e.parent, e.child, pos(e.parent, k), pos(e.child, k))));
          if (freshSet.has(e.child)) e.el.style.opacity = String(k);
        }
        for (const n of fresh) els.get(n).style.opacity = String(k);
      };
      const g = inst.glide = { raf: 0, now, fading: new Set(fresh.map(n => String(n.id))) };
      g.finish = done => {
        if (inst.glide === g) inst.glide = null;
        if (!done) return; // eine neue Darstellung ersetzt ohnehin alles
        show(1);
        for (const e of lines) e.el.style.opacity = '';
        for (const n of fresh) els.get(n).style.opacity = '';
        if (hideLinks) linksG.style.opacity = '';
      };
      const ease = u => 1 - Math.pow(1 - u, 3);
      let t0 = null;
      const step = ts => {
        if (t0 == null) t0 = ts;
        const u = Math.min(1, (ts - t0) / GLIDE_MS);
        if (u >= 1) { g.finish(true); return; }
        show(ease(u));
        g.raf = requestAnimationFrame(step);
      };
      show(0);
      g.raf = requestAnimationFrame(step);
    }

    /** Beendet ein laufendes Gleiten sofort (etwa bevor ein Knoten gezogen wird). */
    function endGlide() {
      if (!inst.glide) return;
      cancelAnimationFrame(inst.glide.raf);
      inst.glide.finish(true);
    }

    /** Seiten der Hauptäste, wie sie gerade zu sehen sind: { id: 'left' | 'right' } (für den Export). */
    function sides() {
      const out = {};
      if (inst.root) for (const c of inst.root.children) if (c.dir) out[c.id] = c.dir < 0 ? 'left' : 'right';
      return out;
    }

    /** «Neu verteilen»: ausgewogene Seiten für alle Hauptäste, die höchsten zuerst auf die kürzere Seite; ohne die gespeicherten. */
    function balancedSides() {
      if (!inst.rows) return {};
      const { root } = buildTree(inst.rows, '');
      return Object.fromEntries(layoutTree(root, { ignoreSides: true }).auto);
    }

    // ---------- Ansicht ----------

    function viewSize() {
      const r = svg.getBoundingClientRect();
      return { w: r.width || 800, h: r.height || 600, left: r.left, top: r.top };
    }

    function fit() {
      if (!inst.bounds || !isFinite(inst.bounds.minX)) return;
      const { w, h } = viewSize();
      const pad = 40;
      const bw = inst.bounds.maxX - inst.bounds.minX;
      const bh = inst.bounds.maxY - inst.bounds.minY;
      const k = Math.max(MIN_ZOOM, Math.min(1.25, (w - 2 * pad) / Math.max(bw, 1), (h - 2 * pad) / Math.max(bh, 1)));
      const cx = (inst.bounds.minX + inst.bounds.maxX) / 2;
      const cy = (inst.bounds.minY + inst.bounds.maxY) / 2;
      inst.k = k;
      inst.tx = w / 2 - cx * k;
      inst.ty = h / 2 - cy * k;
      applyTransform();
    }

    function zoomBy(factor, screenX, screenY) {
      const { w, h, left, top } = viewSize();
      const sx = screenX == null ? w / 2 : screenX - left;
      const sy = screenY == null ? h / 2 : screenY - top;
      const k2 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, inst.k * factor));
      const wx = (sx - inst.tx) / inst.k;
      const wy = (sy - inst.ty) / inst.k;
      inst.k = k2;
      inst.tx = sx - wx * k2;
      inst.ty = sy - wy * k2;
      applyTransform();
    }

    function screenRectOf(id) {
      const g = nodeElOf(id);
      if (!g) return null;
      return g.querySelector('rect').getBoundingClientRect();
    }

    function ensureVisible(id) {
      const n = nodeOf(id);
      if (!n) return;
      const { w, h } = viewSize();
      const sx = n.x * inst.k + inst.tx;
      const sy = n.y * inst.k + inst.ty;
      const sw = n.w * inst.k;
      const sh = n.h * inst.k;
      const margin = 24;
      let dx = 0, dy = 0;
      if (sx < margin) dx = margin - sx;
      else if (sx + sw > w - margin) dx = (w - margin) - (sx + sw);
      if (sy < margin) dy = margin - sy;
      else if (sy + sh > h - margin) dy = (h - margin) - (sy + sh);
      if (dx || dy) { inst.tx += dx; inst.ty += dy; applyTransform(); }
    }

    function setSelected(id) {
      const before = inst.selectedId;
      inst.selectedId = id == null ? null : (id === 'root' ? 'root' : Number(id));
      for (const g of nodesG.children) {
        g.classList.toggle('mm-selected', String(g.dataset.id) === String(inst.selectedId));
      }
      if (before !== inst.selectedId && handlers.onSelectionChange) handlers.onSelectionChange(inst.selectedId);
    }

    /** Nachbar für Tastaturnavigation: 'up' | 'down' | 'left' | 'right'. */
    function neighbor(id, key) {
      const n = nodeOf(id);
      if (!n) return null;
      const parent = n.isRoot ? null : (n.parentId == null ? inst.root : inst.byId.get(n.parentId));
      if (key === 'up' || key === 'down') {
        if (!parent) return null;
        const sibs = parent.visibleChildren.filter(c => n.isRoot || c.dir === n.dir);
        const i = sibs.indexOf(n);
        const j = key === 'up' ? i - 1 : i + 1;
        return sibs[j] ? sibs[j].id : null;
      }
      const dir = key === 'right' ? 1 : -1;
      if (n.isRoot) {
        const kids = n.visibleChildren.filter(c => c.dir === dir);
        return kids.length ? kids[Math.floor(kids.length / 2)].id : null;
      }
      if (n.dir === dir) {
        return n.visibleChildren.length ? n.visibleChildren[Math.floor(n.visibleChildren.length / 2)].id : null;
      }
      return parent ? parent.id : null;
    }

    // ---------- Interaktion ----------

    let drag = null;

    function clearDropTarget() {
      for (const g of nodesG.querySelectorAll('.mm-drop-target')) g.classList.remove('mm-drop-target');
      dropLine.setAttribute('visibility', 'hidden');
    }

    /** Zeigt die Einfügemarke oberhalb ('before') oder unterhalb ('after') eines Knotens. */
    function showDropLine(n, where) {
      const y = where === 'before' ? n.y - GAP_Y / 2 : n.y + n.h + GAP_Y / 2;
      dropLine.setAttribute('x1', n.x - 6);
      dropLine.setAttribute('x2', n.x + n.w + 6);
      dropLine.setAttribute('y1', y);
      dropLine.setAttribute('y2', y);
      dropLine.setAttribute('visibility', 'visible');
    }

    // Kein setPointerCapture: das würde auch click/dblclick auf das SVG umlenken.
    // Stattdessen während des Ziehens am Fenster mithören.
    function onPointerMove(e) {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      if (drag.type === 'pan') {
        inst.tx = drag.tx0 + dx;
        inst.ty = drag.ty0 + dy;
        applyTransform();
        return;
      }
      if (drag.id === 'root') return;
      const n = nodeOf(drag.id);
      if (!n || n.archived) return; // archivierte Notizen lassen sich nicht umhängen
      endGlide();
      drag.el.classList.add('mm-dragging');
      drag.at = { x: n.x + dx / inst.k, y: n.y + dy / inst.k };
      drag.el.setAttribute('transform', `translate(${n.x + dx / inst.k} ${n.y + dy / inst.k})`);
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const targetEl = under && under.closest ? under.closest('.mm-node') : null;
      const targetId = targetEl ? targetEl.dataset.id : null;
      const valid = !!targetId && targetId !== drag.id && !isAncestorOrSelf(drag.id, targetId)
        && !(targetEl && targetEl.classList.contains('mm-archived')); // und nicht unter eine archivierte Notiz
      // Ablagezone: oberes Viertel = davor, unteres Viertel = danach, sonst als Unternotiz. Wurzel: nur Unternotiz.
      let where = 'child';
      if (valid && targetId !== 'root') {
        const rect = targetEl.querySelector('rect').getBoundingClientRect();
        const rel = (e.clientY - rect.top) / Math.max(rect.height, 1);
        if (rel < 0.25) where = 'before';
        else if (rel > 0.75) where = 'after';
      }
      if (targetId !== drag.targetId || where !== drag.where) {
        clearDropTarget();
        if (valid) {
          const tn = nodeOf(targetId);
          if (where === 'child') targetEl.classList.add('mm-drop-target');
          else if (tn) showDropLine(tn, where);
        }
      }
      drag.targetId = targetId;
      drag.where = where;
      drag.valid = valid;
    }

    function onPointerUp(e) {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.type !== 'node') return;
      if (!d.moved) {
        const toggle = !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)) && d.id !== 'root';
        if (!toggle) setSelected(d.id);
        if (handlers.onSelect) handlers.onSelect(d.id === 'root' ? 'root' : Number(d.id), { toggle });
        return;
      }
      d.el.classList.remove('mm-dragging');
      clearDropTarget();
      const n = nodeOf(d.id);
      if (d.valid && handlers.onReparent) {
        // Auf die Wurzel gezogen: auf die Seite, auf der losgelassen wurde (so wechselt ein Hauptast die Seite)
        let side = null;
        if (d.targetId === 'root' && e) {
          const r = screenRectOf('root');
          if (r) side = e.clientX < r.left + r.width / 2 ? 'left' : 'right';
        }
        if (d.at) inst.dropped = { id: d.id, x: d.at.x, y: d.at.y }; // von dort gleitet er an den neuen Platz
        handlers.onReparent(Number(d.id), d.targetId === 'root' ? null : Number(d.targetId), d.where || 'child', side);
      } else if (n) {
        d.el.setAttribute('transform', `translate(${n.x} ${n.y})`);
      }
    }

    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('.mm-toggle')) return;
      const nodeEl = e.target.closest('.mm-node');
      if (nodeEl) {
        drag = { type: 'node', id: nodeEl.dataset.id, el: nodeEl, startX: e.clientX, startY: e.clientY, moved: false, targetId: null, where: null, valid: false };
      } else {
        drag = { type: 'pan', startX: e.clientX, startY: e.clientY, tx0: inst.tx, ty0: inst.ty, moved: false };
      }
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    });

    svg.addEventListener('click', e => {
      const toggle = e.target.closest('.mm-toggle');
      if (toggle) {
        e.stopPropagation();
        const id = Number(toggle.closest('.mm-node').dataset.id);
        if (handlers.onToggleCollapse) handlers.onToggleCollapse(id);
        return;
      }
      if (!e.target.closest('.mm-node')) {
        setSelected(null);
        if (handlers.onSelect) handlers.onSelect(null);
      }
    });

    svg.addEventListener('dblclick', e => {
      const nodeEl = e.target.closest('.mm-node');
      if (!nodeEl || e.target.closest('.mm-toggle')) return;
      e.preventDefault();
      if (nodeEl.dataset.id === 'root') { if (handlers.onOpenRoot) handlers.onOpenRoot(); }
      else if (handlers.onOpen) handlers.onOpen(Number(nodeEl.dataset.id));
    });

    svg.addEventListener('contextmenu', e => {
      e.preventDefault();
      const nodeEl = e.target.closest('.mm-node');
      const id = nodeEl ? (nodeEl.dataset.id === 'root' ? 'root' : Number(nodeEl.dataset.id)) : null;
      if (id != null) {
        setSelected(id);
        if (handlers.onSelect) handlers.onSelect(id);
      }
      if (handlers.onContextMenu) handlers.onContextMenu(id, e.clientX, e.clientY);
    });

    svg.addEventListener('wheel', e => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
    }, { passive: false });

    function setMulti(ids) {
      inst.multi = new Set([...(ids || [])].map(Number));
      for (const g of nodesG.children) {
        g.classList.toggle('mm-multi', g.dataset.id !== 'root' && inst.multi.has(Number(g.dataset.id)));
      }
    }

    return {
      render, fit, setSelected, setMulti, neighbor, screenRectOf, ensureVisible, sides, balancedSides,
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(1 / 1.25),
      requestFit: () => { inst.needsFit = true; },
      getSelected: () => inst.selectedId,
      nodeInfo: id => {
        const n = nodeOf(id);
        return n ? { id: n.id, isRoot: !!n.isRoot, title: n.title, parentId: n.isRoot ? undefined : n.parentId, childCount: n.children.length, collapsed: !!n.collapsed, archived: !!n.archived, dir: n.dir, side: n.isRoot || n.parentId != null ? null : (n.dir < 0 ? 'left' : 'right') } : null;
      },
      nodeCount: () => inst.byId.size,
    };
  }

  // ---------- Eigenständiges SVG für den Export ----------

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Nur der Weg von der Wurzel zu jeder Notiz in focus und diese selbst mit ihren Unternotizen (v3.1.0). Die Knoten auf dem Weg sind
   *  offen; die Unternotizen bleiben, wie sie sind (eingeklappt oder nicht). Ohne einen Treffer: alle Zeilen. */
  function focusRows(rows, focus) {
    const byId = new Map(rows.map(r => [r.id, r]));
    const kids = new Map();
    for (const r of rows) {
      const p = r.parent_id == null ? null : r.parent_id;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(r.id);
    }
    const keep = new Set(), path = new Set();
    for (const id of focus) {
      if (!byId.has(id)) continue;
      const stack = [id];
      while (stack.length) {
        const x = stack.pop();
        if (keep.has(x)) continue;
        keep.add(x);
        for (const k of kids.get(x) || []) stack.push(k);
      }
      for (let p = byId.get(id).parent_id; p != null && byId.has(p) && !path.has(p); p = byId.get(p).parent_id) path.add(p);
    }
    if (!keep.size) return rows;
    return rows.filter(r => keep.has(r.id) || path.has(r.id))
      .map(r => (path.has(r.id) && !keep.has(r.id) && r.collapsed ? Object.assign({}, r, { collapsed: 0 }) : r));
  }

  /** Eine Farbe aus einer Erweiterung, wenn sie sicher in ein Attribut passt (#rgb, rgb(), hsl(), Name, url(#muster)), sonst null. */
  function styleColor(v) {
    const s = typeof v === 'string' ? v.trim() : '';
    return /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/-]+\)|[a-z]{3,20}|url\(#[\w-]+\))$/i.test(s) ? s : null;
  }

  /** Rendert die Mindmap als eigenständige SVG-Zeichenkette (helles Farbschema, Stile eingebettet).
   *  rows wie bei render(); options.mapTitle, options.expandAll (eingeklappte Äste aufklappen), options.links (Querverweise),
   *  options.sides (Seiten der Hauptäste ohne gespeicherte Seite, etwa sides() der Mindmap auf dem Schirm).
   *  Seit v3.1.0: options.focus (Nummern von Notizen: nur der Weg dorthin und ihre Unternotizen, siehe focusRows), options.caption
   *  (Überschrift über dem Bild, etwa der Name des Bereichs), options.style ({ nodes: { id: { fill, stroke, text } }, defs }: Farben
   *  je Knoten und SVG-Definitionen aus Erweiterungen, ctx.export.addMapStyle). */
  function toSvgString(rows, options) {
    options = options || {};
    const chosen = options.focus && options.focus.length ? focusRows(rows, options.focus) : rows;
    const prepared = options.expandAll ? chosen.map(r => Object.assign({}, r, { collapsed: 0 })) : chosen;
    const { root, byId } = buildTree(prepared, options.mapTitle || '');
    for (const n of byId.values()) { n.match = false; n.matchInside = false; }
    const layout = layoutTree(root, { sides: options.sides });
    const placed = layout.placed;
    const drawable = drawableLinks(options.links, placed);
    const index = drawable.length ? linkIndex(placed) : null;
    const links = drawable.map(l => linkPath(l.a, l.b, index));
    const bounds = links.reduce((b, l) => unionBox(b, l.box), layout.bounds); // Platz für die Linien
    const pad = 32;
    const caption = String(options.caption || '').trim();
    const CAPTION_FONT = '600 18px ' + FONT_FAMILY;
    const capH = caption ? 34 : 0; // Platz für die Überschrift über der Mindmap
    const width = Math.ceil(Math.max(bounds.maxX - bounds.minX, caption ? measure(caption, CAPTION_FONT) : 0) + 2 * pad);
    const height = Math.ceil(bounds.maxY - bounds.minY + 2 * pad + capH);
    const ox = -bounds.minX + pad;
    const oy = -bounds.minY + pad + capH;
    const styles = (options.style && options.style.nodes) || {};
    const own = n => (n.isRoot ? null : styles[n.id] || null);

    const c = {
      bg: '#ffffff', panel: '#ffffff', text: '#1c1e22', muted: '#6b7280', border: '#d7dbe2',
      accent: '#2563eb', accentContrast: '#ffffff', tint: '#e3ecfd', warn: '#b45309',
    };
    // Hauptfarbe der Datenbank (NoNotesPalette.light): options.accent = { accent, contrast, tint }
    if (options.accent) Object.assign(c, { accent: options.accent.accent, accentContrast: options.accent.contrast, tint: options.accent.tint });
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(FONT_FAMILY.replace(/"/g, "'"))}">`);
    parts.push(`<title>${esc(caption || options.mapTitle || 'Mindmap')}</title>`);
    if (options.style && options.style.defs) parts.push(`<defs>${options.style.defs}</defs>`); // von Erweiterungen, vorher geprüft
    parts.push(`<rect width="100%" height="100%" fill="${c.bg}"/>`);
    if (caption) parts.push(`<text x="${pad}" y="${pad + 4}" dominant-baseline="central" fill="${c.text}" style="font: 600 18px ${esc(FONT_FAMILY.replace(/"/g, "'"))}">${esc(caption)}</text>`);
    parts.push(`<g transform="translate(${ox} ${oy})">`);
    for (const n of placed) {
      for (const ch of n.visibleChildren) {
        const dir = ch.dir;
        const px = dir > 0 ? n.x + n.w : n.x;
        const py = n.y + n.h / 2;
        const cx = dir > 0 ? ch.x : ch.x + ch.w;
        const cy = ch.y + ch.h / 2;
        const mx = (px + cx) / 2;
        parts.push(`<path d="M ${px} ${py} C ${mx} ${py}, ${mx} ${cy}, ${cx} ${cy}" fill="none" stroke="${c.muted}" stroke-opacity="0.55" stroke-width="2"/>`);
      }
    }
    if (links.length) {
      const attrs = Object.entries(ARROW_ATTRS).map(([k, v]) => `${k}="${v}"`).join(' ');
      parts.push(`<defs><marker id="mmLinkArrow" ${attrs}><path d="${ARROW_PATH}" fill="${c.muted}"/></marker></defs>`);
      for (const l of links) parts.push(`<path d="${l.d}" fill="none" stroke="${c.muted}" stroke-opacity="0.8" stroke-width="1.5" stroke-dasharray="6 4" marker-end="url(#mmLinkArrow)"/>`);
    }
    for (const n of placed) {
      const st = own(n);
      const fill = (st && styleColor(st.fill)) || (n.isRoot ? c.accent : c.panel);
      const stroke = (st && styleColor(st.stroke)) || (n.isRoot ? c.accent : c.border);
      const textFill = (st && styleColor(st.text)) || (n.isRoot ? c.accentContrast : c.text);
      const font = n.isRoot ? '700 16px' : '600 14px';
      parts.push(`<g transform="translate(${n.x} ${n.y})"${n.archived ? ' opacity="0.6"' : ''}>`);
      parts.push(`<rect width="${n.w}" height="${n.h}" rx="${n.isRoot ? 12 : 9}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${n.archived ? ' stroke-dasharray="5 3"' : ''}/>`);
      parts.push(`<text x="${n.w / 2}" y="${n.h / 2}" text-anchor="middle" dominant-baseline="central" fill="${textFill}" style="font: ${font} ${esc(FONT_FAMILY.replace(/"/g, "'"))}">${esc(n.label)}</text>`);
      if (!n.isRoot && n.collapsed && n.children.length) {
        const tx = n.dir > 0 ? n.w + 11 : -11;
        parts.push(`<g transform="translate(${tx} ${n.h / 2})"><circle r="10" fill="${c.tint}" stroke="${c.accent}" stroke-width="1.5"/><text text-anchor="middle" dominant-baseline="central" fill="${c.text}" style="font: 600 11px ${esc(FONT_FAMILY.replace(/"/g, "'"))}">${n.hiddenCount}</text></g>`);
      }
      if (n.shownBadge > 0) {
        const bx = n.dir < 0 ? 0 : n.w;
        parts.push(`<g transform="translate(${bx} 0)"><circle r="9" fill="${c.warn}"/><text text-anchor="middle" dominant-baseline="central" fill="#fff" style="font: 700 11px ${esc(FONT_FAMILY.replace(/"/g, "'"))}">${n.shownBadge > 99 ? '99+' : n.shownBadge}</text></g>`);
      }
      if (n.shownTBadge > 0) {
        const bx = n.dir < 0 ? 0 : n.w;
        parts.push(`<g transform="translate(${bx} ${n.h})"><circle r="9" fill="${c.accent}"/><text text-anchor="middle" dominant-baseline="central" fill="${c.accentContrast}" style="font: 700 11px ${esc(FONT_FAMILY.replace(/"/g, "'"))}">${n.shownTBadge > 99 ? '99+' : n.shownTBadge}</text></g>`);
      }
      parts.push('</g>');
    }
    parts.push('</g></svg>');
    return parts.join('\n');
  }

  global.NoNotesMindmap = { create, toSvgString };
})(window);
