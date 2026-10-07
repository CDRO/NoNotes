/* NoNotes – Mindmap: Layout, SVG-Darstellung und Interaktion.
   Kennt keine Datenbank. Bekommt flache Zeilen (id, title, parent_id, sort_order, collapsed, badge)
   und meldet Aktionen über Rückrufe. */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
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
        collapsed: !!r.collapsed, badge: r.badge || 0, children: [],
      });
    }
    const root = { id: 'root', isRoot: true, title: mapTitle, children: [], badge: 0 };
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

  function layoutTree(root) {
    const sizeNode = n => {
      const font = n.isRoot ? ROOT_FONT : FONT;
      const fit = fitLabel((n.title || '').trim() || 'Ohne Titel', font, MAX_W);
      n.label = fit.label;
      n.w = Math.max(MIN_W, Math.ceil(fit.width) + 2 * PAD_X + (n.isRoot ? 14 : 0));
      n.h = n.isRoot ? ROOT_H : NODE_H;
      n.visibleChildren = (!n.isRoot && n.collapsed) ? [] : n.children;
      n.hiddenCount = n.visibleChildren.length ? 0 : countDescendants(n);
      n.visibleChildren.forEach(sizeNode);
    };
    const countDescendants = n => n.children.reduce((s, c) => s + 1 + countDescendants(c), 0);
    const totalBadge = n => n.badge + n.children.reduce((s, c) => s + totalBadge(c), 0);
    sizeNode(root);
    // Eingeklappte Äste zeigen die offenen Fragen des ganzen Teilbaums.
    const setBadges = n => {
      n.shownBadge = n.isRoot ? 0 : (n.collapsed ? totalBadge(n) : n.badge);
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

    // Kinder der Wurzel ausgewogen auf rechts und links verteilen.
    const right = [], left = [];
    let hr = 0, hl = 0;
    for (const c of root.children) {
      if (hr <= hl) { right.push(c); hr += subtreeH(c) + GAP_Y; }
      else { left.push(c); hl += subtreeH(c) + GAP_Y; }
    }

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
    return { placed, bounds };
  }

  // ---------- Instanz ----------

  function create(svg, handlers) {
    handlers = handlers || {};
    const viewport = svgEl('g', { class: 'mm-viewport' }, svg);
    const edgesG = svgEl('g', { class: 'mm-edges' }, viewport);
    const nodesG = svgEl('g', { class: 'mm-nodes' }, viewport);

    const inst = {
      k: 1, tx: 0, ty: 0,
      root: null, byId: new Map(), placed: [], bounds: null,
      selectedId: null,
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
          + (n.match ? ' mm-match' : '') + (n.matchInside ? ' mm-match-inside' : '')
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
      if (n.label !== ((n.title || '').trim() || 'Ohne Titel')) {
        svgEl('title', null, g).textContent = n.title;
      }
      if (!n.isRoot && n.children.length) {
        const cx = n.dir > 0 ? n.w + 11 : -11;
        const t = svgEl('g', {
          class: 'mm-toggle' + (n.collapsed ? ' mm-collapsed' : ''),
          transform: `translate(${cx} ${n.h / 2})`,
        }, g);
        svgEl('circle', { r: n.collapsed ? 10 : 7 }, t);
        const tt = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, t);
        tt.textContent = n.collapsed ? String(n.hiddenCount) : '–';
        svgEl('title', null, t).textContent = n.collapsed ? 'Ausklappen' : 'Einklappen';
      }
      if (n.shownBadge > 0) {
        const bx = n.dir < 0 ? 0 : n.w;
        const b = svgEl('g', { class: 'mm-badge', transform: `translate(${bx} 0)` }, g);
        svgEl('circle', { r: 9 }, b);
        const bt = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, b);
        bt.textContent = n.shownBadge > 99 ? '99+' : String(n.shownBadge);
        svgEl('title', null, b).textContent = n.shownBadge === 1 ? '1 offene Frage' : `${n.shownBadge} offene Fragen`;
      }
      return g;
    }

    function drawEdge(parent, child) {
      const dir = child.dir;
      const px = dir > 0 ? parent.x + parent.w : parent.x;
      const py = parent.y + parent.h / 2;
      const cx = dir > 0 ? child.x : child.x + child.w;
      const cy = child.y + child.h / 2;
      const mx = (px + cx) / 2;
      svgEl('path', {
        class: 'mm-edge',
        d: `M ${px} ${py} C ${mx} ${py}, ${mx} ${cy}, ${cx} ${cy}`,
      }, edgesG);
    }

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
      const { placed, bounds } = layoutTree(root);
      inst.root = root;
      inst.byId = byId;
      inst.placed = placed;
      inst.bounds = bounds;
      if (inst.selectedId != null && inst.selectedId !== 'root' && !byId.has(Number(inst.selectedId))) {
        inst.selectedId = null;
      }

      edgesG.replaceChildren();
      nodesG.replaceChildren();
      for (const n of placed) {
        for (const c of n.visibleChildren) drawEdge(n, c);
      }
      for (const n of placed) drawNode(n);

      if (inst.needsFit) { fit(); inst.needsFit = false; }
      else applyTransform();
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
      inst.selectedId = id == null ? null : (id === 'root' ? 'root' : Number(id));
      for (const g of nodesG.children) {
        g.classList.toggle('mm-selected', String(g.dataset.id) === String(inst.selectedId));
      }
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
      if (!n) return;
      drag.el.classList.add('mm-dragging');
      drag.el.setAttribute('transform', `translate(${n.x + dx / inst.k} ${n.y + dy / inst.k})`);
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const targetEl = under && under.closest ? under.closest('.mm-node') : null;
      const targetId = targetEl ? targetEl.dataset.id : null;
      const valid = !!targetId && targetId !== drag.id && !isAncestorOrSelf(drag.id, targetId);
      if (targetId !== drag.targetId) {
        clearDropTarget();
        if (valid) targetEl.classList.add('mm-drop-target');
      }
      drag.targetId = targetId;
      drag.valid = valid;
    }

    function onPointerUp() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.type !== 'node') return;
      if (!d.moved) {
        setSelected(d.id);
        if (handlers.onSelect) handlers.onSelect(d.id === 'root' ? 'root' : Number(d.id));
        return;
      }
      d.el.classList.remove('mm-dragging');
      clearDropTarget();
      const n = nodeOf(d.id);
      if (d.valid && handlers.onReparent) {
        handlers.onReparent(Number(d.id), d.targetId === 'root' ? null : Number(d.targetId));
      } else if (n) {
        d.el.setAttribute('transform', `translate(${n.x} ${n.y})`);
      }
    }

    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('.mm-toggle')) return;
      const nodeEl = e.target.closest('.mm-node');
      if (nodeEl) {
        drag = { type: 'node', id: nodeEl.dataset.id, el: nodeEl, startX: e.clientX, startY: e.clientY, moved: false, targetId: null, valid: false };
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

    return {
      render, fit, setSelected, neighbor, screenRectOf, ensureVisible,
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(1 / 1.25),
      requestFit: () => { inst.needsFit = true; },
      getSelected: () => inst.selectedId,
      nodeInfo: id => {
        const n = nodeOf(id);
        return n ? { id: n.id, isRoot: !!n.isRoot, title: n.title, parentId: n.isRoot ? undefined : n.parentId, childCount: n.children.length, collapsed: !!n.collapsed, dir: n.dir } : null;
      },
      nodeCount: () => inst.byId.size,
    };
  }

  // ---------- Eigenständiges SVG für den Export ----------

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Rendert die Mindmap als eigenständige SVG-Zeichenkette (helles Farbschema, Stile eingebettet).
   *  rows wie bei render(); options.mapTitle, options.expandAll (eingeklappte Äste aufklappen). */
  function toSvgString(rows, options) {
    options = options || {};
    const prepared = options.expandAll ? rows.map(r => Object.assign({}, r, { collapsed: 0 })) : rows;
    const { root, byId } = buildTree(prepared, options.mapTitle || '');
    for (const n of byId.values()) { n.match = false; n.matchInside = false; }
    const { placed, bounds } = layoutTree(root);
    const pad = 32;
    const width = Math.ceil(bounds.maxX - bounds.minX + 2 * pad);
    const height = Math.ceil(bounds.maxY - bounds.minY + 2 * pad);
    const ox = -bounds.minX + pad;
    const oy = -bounds.minY + pad;

    const c = {
      bg: '#ffffff', panel: '#ffffff', text: '#1c1e22', muted: '#6b7280', border: '#d7dbe2',
      accent: '#2563eb', accentContrast: '#ffffff', warn: '#b45309',
    };
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(FONT_FAMILY.replace(/"/g, "'"))}">`);
    parts.push(`<title>${esc(options.mapTitle || 'Mindmap')}</title>`);
    parts.push(`<rect width="100%" height="100%" fill="${c.bg}"/>`);
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
    for (const n of placed) {
      const fill = n.isRoot ? c.accent : c.panel;
      const stroke = n.isRoot ? c.accent : c.border;
      const textFill = n.isRoot ? c.accentContrast : c.text;
      const font = n.isRoot ? '700 16px' : '600 14px';
      parts.push(`<g transform="translate(${n.x} ${n.y})">`);
      parts.push(`<rect width="${n.w}" height="${n.h}" rx="${n.isRoot ? 12 : 9}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
      parts.push(`<text x="${n.w / 2}" y="${n.h / 2}" text-anchor="middle" dominant-baseline="central" fill="${textFill}" style="font: ${font} ${esc(FONT_FAMILY.replace(/"/g, "'"))}">${esc(n.label)}</text>`);
      if (!n.isRoot && n.collapsed && n.children.length) {
        const tx = n.dir > 0 ? n.w + 11 : -11;
        parts.push(`<g transform="translate(${tx} ${n.h / 2})"><circle r="10" fill="#e3ecfd" stroke="${c.accent}" stroke-width="1.5"/><text text-anchor="middle" dominant-baseline="central" fill="${c.text}" style="font: 600 11px ${esc(FONT_FAMILY.replace(/"/g, "'"))}">${n.hiddenCount}</text></g>`);
      }
      if (n.shownBadge > 0) {
        const bx = n.dir < 0 ? 0 : n.w;
        parts.push(`<g transform="translate(${bx} 0)"><circle r="9" fill="${c.warn}"/><text text-anchor="middle" dominant-baseline="central" fill="#fff" style="font: 700 11px ${esc(FONT_FAMILY.replace(/"/g, "'"))}">${n.shownBadge > 99 ? '99+' : n.shownBadge}</text></g>`);
      }
      parts.push('</g>');
    }
    parts.push('</g></svg>');
    return parts.join('\n');
  }

  global.NoNotesMindmap = { create, toSvgString };
})(window);
