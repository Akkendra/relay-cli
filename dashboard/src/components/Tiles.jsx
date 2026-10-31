import { Dot } from './Seg.jsx';
import { fmt, metricName, metricValue, providerName } from '../format.js';

function Tile({ label, value, note, provider }) {
  return (
    <div className="card">
      <div className="label">{provider && <Dot provider={provider} />}{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

export function Tiles({ data, metric }) {
  const today = data.daily.at(-1) ?? { codex: {}, claude: {} };
  const live = data.sessions.filter(s => s.live);
  return (
    <section className="grid tiles" aria-label="Today">
      <Tile label="Codex today" value={fmt(metricValue(today.codex, metric))} note={metricName(metric)} provider="codex" />
      <Tile label="Claude today" value={fmt(metricValue(today.claude, metric))} note={metricName(metric)} provider="claude" />
      <Tile label="Output today" value={fmt(metricValue(today.codex, 'output') + metricValue(today.claude, 'output'))} note="both providers" />
      <Tile label="Live sessions" value={String(live.length)}
        note={live.length ? live.map(s => providerName(s.provider)).join(', ') : 'none active in the last 2 minutes'} />
    </section>
  );
}
