import { Dot } from './Seg.jsx';
import { fmt, full, metricName, metricValue } from '../format.js';

const plural = n => `${n} session${n === 1 ? '' : 's'}`;

export function ModelBars({ models, metric }) {
  const rows = models.map(m => ({ ...m, v: metricValue(m.tokens, metric) })).sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...rows.map(r => r.v));
  return (
    <div className="card">
      <h2>By model <span className="muted">· {metricName(metric)}, all time</span></h2>
      <div className="bars">
        {rows.length ? rows.map(r => (
          <div className="bar-row" key={`${r.provider}:${r.model}`} title={`${full(r.v)} tokens across ${plural(r.sessions)}`}>
            <div className="bar-label"><Dot provider={r.provider} />{r.model}<span className="num">{fmt(r.v)}</span></div>
            <div className="bar-track"><span style={{ width: `${(r.v / max) * 100}%`, background: `var(--${r.provider})` }} /></div>
            <div className="note">{plural(r.sessions)} · {fmt(r.tokens.output)} output</div>
          </div>
        )) : <div className="empty">No model usage found.</div>}
      </div>
    </div>
  );
}
