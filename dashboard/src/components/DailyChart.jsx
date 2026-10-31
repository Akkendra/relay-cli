import { useLayoutEffect, useRef, useState } from 'react';
import { Dot } from './Seg.jsx';
import { dayLabel, fmt, full, metricName, metricValue, niceMax, topRounded } from '../format.js';
import { useWidth } from '../hooks.js';

const H = 240, L = 44, R = 8, T = 10, B = 26;

// Stacked columns (Codex below, Claude above) with a 2px surface gap, rounded data-ends, and a hover tooltip per day.
export function DailyChart({ days, metric }) {
  const [ref, measured] = useWidth();
  const [hover, setHover] = useState(null);
  const tipRef = useRef(null);
  const [tipLeft, setTipLeft] = useState(0);
  const W = Math.max(280, measured);
  const pw = W - L - R, ph = H - T - B, band = pw / days.length, bw = Math.min(24, band * 0.62);
  const values = days.map(d => ({ codex: metricValue(d.codex, metric), claude: metricValue(d.claude, metric) }));
  const max = niceMax(Math.max(0, ...values.map(v => v.codex + v.claude)));
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
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tokens per day, ${metricName(metric)}, Codex and Claude stacked`}>
          {[0, 1, 2, 3, 4].map(i => {
            const v = max * i / 4, yy = y(v);
            return (
              <g key={i}>
                <line x1={L} x2={W - R} y1={yy} y2={yy} stroke={i ? 'var(--grid)' : 'var(--axis)'} strokeWidth="1" />
                <text x={L - 6} y={yy + 4} textAnchor="end">{fmt(v)}</text>
              </g>
            );
          })}
          {days.map((d, i) => {
            const cx = L + band * i + band / 2, x = cx - bw / 2, v = values[i];
            const hc = (v.codex / max) * ph, hl = (v.claude / max) * ph, gap = hc > 0 && hl > 0 ? 2 : 0;
            return (
              <g key={d.date}>
                <rect x={L + band * i} y={T} width={band} height={ph} fill={hover === i ? 'var(--wash)' : 'transparent'}
                  onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
                {hc > 0 && (hl > 0
                  ? <rect x={x} y={y(v.codex)} width={bw} height={hc} fill="var(--codex)" pointerEvents="none" />
                  : <path d={topRounded(x, y(v.codex), bw, hc, 4)} fill="var(--codex)" pointerEvents="none" />)}
                {hl > 0 && <path d={topRounded(x, y(v.codex + v.claude), bw, Math.max(0, hl - gap), 4)} fill="var(--claude)" pointerEvents="none" />}
                {(days.length - 1 - i) % every === 0 && <text x={cx} y={H - 8} textAnchor="middle">{dayLabel(d.date)}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && (
        <div className="tip" ref={tipRef} style={{ left: tipLeft, top: 0 }}>
          <b>{dayLabel(days[hover].date)}</b>
          <div><Dot provider="codex" />Codex<span className="num">{full(values[hover].codex)}</span></div>
          <div><Dot provider="claude" />Claude<span className="num">{full(values[hover].claude)}</span></div>
          <div className="muted">{metricName(metric)}<span className="num">{full(values[hover].codex + values[hover].claude)}</span></div>
        </div>
      )}
    </div>
  );
}

export function DailyTable({ days, metric }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Day</th><th className="n">Codex</th><th className="n">Claude</th><th className="n">Total</th></tr></thead>
        <tbody>
          {days.slice().reverse().map(d => {
            const c = metricValue(d.codex, metric), l = metricValue(d.claude, metric);
            return <tr key={d.date}><td>{dayLabel(d.date)}</td><td className="n">{full(c)}</td><td className="n">{full(l)}</td><td className="n">{full(c + l)}</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
