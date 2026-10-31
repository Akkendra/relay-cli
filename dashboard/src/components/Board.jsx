import { useLayoutEffect, useRef, useState } from 'react';

const ROW = 4, GAP = 14;
import { SIZES, moveTo } from '../format.js';

// Tiles that can be dragged into place, nudged with arrows, and sized S / M / L while editing.
export function Board({ layout, setLayout, editing, widgets }) {
  const [dragging, setDragging] = useState(null);
  // Masonry packing: each tile spans as many 4px rows as its content needs, and dense flow lets smaller tiles fill gaps.
  const ref = useRef(null);
  // Then each tile stretches down to the next tile below it, so columns end level instead of leaving gaps.
  const [spans, setSpans] = useState({});
  useLayoutEffect(() => {
    const measure = () => {
      const board = ref.current;
      if (!board) return;
      const els = [...board.querySelectorAll(':scope > .widget')];
      board.classList.add('measuring');
      const natural = Object.fromEntries(els.map(el => [el.id, Math.ceil(([...el.children].reduce((h, c) => h + c.getBoundingClientRect().height, 0) + GAP) / ROW)]));
      // Positions come from the natural layout, so a stretched tile never pushes the ones below it down.
      const shown = els.map(el => el.style.gridRowEnd);
      els.forEach(el => { el.style.gridRowEnd = `span ${natural[el.id]}`; });
      const rects = new Map(els.map(el => [el.id, el.getBoundingClientRect()]));
      els.forEach((el, i) => { el.style.gridRowEnd = shown[i]; });
      board.classList.remove('measuring');
      const next = {};
      for (const el of els) {
        const r = rects.get(el.id), bottom = r.top + natural[el.id] * ROW - 1;
        const below = els.map(o => rects.get(o.id)).filter(o => o.top >= bottom && o.left < r.right - 1 && r.left < o.right - 1).map(o => o.top);
        next[el.id] = below.length ? Math.max(natural[el.id], Math.round((Math.min(...below) - r.top) / ROW)) : natural[el.id];
      }
      setSpans(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    let frame;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    for (const el of ref.current?.querySelectorAll(':scope > .widget > *') ?? []) ro.observe(el);
    measure();
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  });
  const update = next => setLayout(next);
  return (
    <div ref={ref} className={`board${editing ? ' editing' : ''}`}>
      {layout.map((w, i) => {
        const widget = widgets[w.id];
        if (!widget) return null;
        return (
          <div key={w.id} id={`w-${w.id}`} className={`widget w-${w.size}${dragging === w.id ? ' dragging' : ''}`} draggable={editing} style={spans[`w-${w.id}`] ? { gridRowEnd: `span ${spans[`w-${w.id}`]}` } : undefined}
            onDragStart={e => { setDragging(w.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => setDragging(null)}
            onDragOver={e => { if (editing && dragging) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); const from = layout.findIndex(x => x.id === dragging); update(moveTo(layout, from, i)); setDragging(null); }}>
            {editing && (
              <div className="widget-bar">
                <span className="grip" aria-hidden="true">⠿</span><b>{widget.title}</b>
                <span className="spacer" />
                <button type="button" aria-label={`Move ${widget.title} earlier`} disabled={i === 0} onClick={() => update(moveTo(layout, i, i - 1))}>←</button>
                <button type="button" aria-label={`Move ${widget.title} later`} disabled={i === layout.length - 1} onClick={() => update(moveTo(layout, i, i + 1))}>→</button>
                <span className="sizes" role="group" aria-label={`${widget.title} size`}>
                  {SIZES.map(([s, short, name]) => <button key={s} type="button" aria-label={name} aria-pressed={w.size === s} onClick={() => update(layout.map(x => (x.id === w.id ? { ...x, size: s } : x)))}>{short}</button>)}
                </span>
              </div>
            )}
            {widget.render(w.size)}
          </div>
        );
      })}
    </div>
  );
}
