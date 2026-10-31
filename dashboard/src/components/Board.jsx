import { useLayoutEffect, useRef, useState } from 'react';

const ROW = 4, GAP = 14;
import { SIZES, mergeLayout, moveTo } from '../format.js';

// Tiles that can be dragged into place, nudged with arrows, and sized S / M / L while editing.
export function Board({ layout, setLayout, editing, widgets }) {
  const [dragging, setDragging] = useState(null);
  // Masonry packing: each tile spans as many 4px rows as its content needs, and dense flow lets smaller tiles fill gaps.
  const ref = useRef(null);
  const [spans, setSpans] = useState({});
  useLayoutEffect(() => {
    const measure = () => {
      const next = {};
      for (const el of ref.current?.querySelectorAll(':scope > .widget') ?? []) next[el.id] = Math.ceil((el.firstElementChild.getBoundingClientRect().height + (el.children[1]?.getBoundingClientRect().height ?? 0) + GAP) / ROW);
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
