import { useLayoutEffect, useRef, useState } from 'react';
import { Dot } from './Seg.jsx';
import { dayLabel, fmt, full, niceMax, providerName, topRounded } from '../format.js';
import { useWidth } from '../hooks.js';

const L = 44, R = 8, T = 10, B = 26;

// Stacked columns, one segment per series (bottom to top), with a 2px surface gap, rounded data-ends, and a
// hover tooltip per day. rows: [{ date, values: { [series]: number } }].
export function DailyChart({ rows, series, label, height = 240, formatLabel = dayLabel }) {
  const [ref, measured] = useWidth();
  const [hover, setHover] = useState(null);
  const tipRef = useRef(null);
  const [tipLeft, setTipLeft] = useState(0);
  const W = Math.max(280, measured), H = height;
  const pw = W - L - R, ph = H - T - B, band = pw / rows.length, bw = Math.min(24, band * 0.62);
  const totals = rows.map(r => series.reduce((sum, s) => sum + (r.values[s] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const y = v => T + ph - (v / max) * ph;
  const every = Math.ceil(56 / band);

  useLayoutEffect(() => {
    if (hover === null || !tipRef.current) return;
    const tw = tipRef.current.offsetWidth, center = L + band * hover + band / 2;
    setTipLeft(Math.min(Math.max(0, center - tw / 2), W - tw));
  }, [hover, band, W]);

  return (
    <div className="chart" ref={ref}>
      {measured > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label={label}>
          {[0, 1, 2, 3, 4].map(i => {
            const v = max * i / 4, yy = y(v);
            return (
              <g key={i}>
                <line x1={L} x2={W - R} y1={yy} y2={yy} stroke={i ? 'var(--grid)' : 'var(--axis)'} strokeWidth="1" />
                <text x={L - 6} y={yy + 4} textAnchor="end">{fmt(v)}</text>
              </g>
            );
          })}
          {rows.map((r, i) => {
            const cx = L + band * i + band / 2, x = cx - bw / 2;
            const drawn = series.filter(s => (r.values[s] ?? 0) > 0);
            let base = 0;
            return (
              <g key={r.date}>
                <rect x={L + band * i} y={T} width={band} height={ph} fill={hover === i ? 'var(--wash)' : 'transparent'}
                  onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
                {drawn.map((s, k) => {
                  const v = r.values[s], h = (v / max) * ph, gap = k > 0 ? 2 : 0, yTop = y(base + v);
                  base += v;
                  return k === drawn.length - 1
                    ? <path key={s} d={topRounded(x, yTop, bw, Math.max(0, h - gap), 4)} fill={`var(--${s})`} pointerEvents="none" />
                    : <rect key={s} x={x} y={yTop} width={bw} height={Math.max(0, h - gap)} fill={`var(--${s})`} pointerEvents="none" />;
                })}
                {(rows.length - 1 - i) % every === 0 && <text x={cx} y={H - 8} textAnchor="middle">{formatLabel(r.date)}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && (
        <div className="tip" ref={tipRef} style={{ left: tipLeft, top: 0 }}>
          <b>{formatLabel(rows[hover].date)}</b>
          {series.map(s => <div key={s}><Dot provider={s} />{providerName(s)}<span className="num">{full(rows[hover].values[s] ?? 0)}</span></div>)}
          {series.length > 1 && <div className="muted">Total<span className="num">{full(totals[hover])}</span></div>}
        </div>
      )}
    </div>
  );
}

export function DailyTable({ rows, series }) {
  const total = r => series.reduce((sum, s) => sum + (r.values[s] ?? 0), 0);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Day</th>{series.map(s => <th key={s} className="n">{providerName(s)}</th>)}{series.length > 1 && <th className="n">Total</th>}</tr></thead>
        <tbody>
          {rows.slice().reverse().map(r => (
            <tr key={r.date}>
              <td>{dayLabel(r.date)}</td>
              {series.map(s => <td key={s} className="n">{full(r.values[s] ?? 0)}</td>)}
              {series.length > 1 && <td className="n">{full(total(r))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
