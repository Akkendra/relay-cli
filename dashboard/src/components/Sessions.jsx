import { Dot, Seg } from './Seg.jsx';
import { ago, fmt, providerName } from '../format.js';

const PROVIDERS = [{ value: 'all', label: 'All' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }];

export function Sessions({ sessions, provider, onProvider, now }) {
  const rows = sessions.filter(s => provider === 'all' || s.provider === provider);
  return (
    <section className="card sessions">
      <div className="chart-head">
        <h2>Sessions</h2>
        <span className="spacer" />
        <Seg label="Provider" options={PROVIDERS} value={provider} onChange={onProvider} />
      </div>
      <div className="table-wrap">
        {rows.length ? (
          <table>
            <thead>
              <tr>
                <th>Status</th><th>Provider</th><th>Project</th><th>Model</th><th>Last activity</th>
                <th className="n">Input</th><th className="n">Cache read</th><th className="n">Cache write</th><th className="n">Output</th><th className="n">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={`${s.provider}:${s.id}:${s.startedAt}`}>
                  <td>{s.live ? <span className="status good live">Live</span> : <span className="status idle muted">Idle</span>}</td>
                  <td><span className="label plain"><Dot provider={s.provider} />{providerName(s.provider)}</span></td>
                  <td className="project" title={s.project ?? ''}>{s.project ?? '—'}{s.relayProject && <span className="muted"> · Relay</span>}</td>
                  <td>{s.models.join(', ') || '—'}</td>
                  <td title={s.lastAt ?? ''}>{ago(s.lastAt, now)}</td>
                  <td className="n">{fmt(s.tokens.input)}</td>
                  <td className="n">{fmt(s.tokens.cacheRead)}</td>
                  <td className="n">{fmt(s.tokens.cacheWrite)}</td>
                  <td className="n">{fmt(s.tokens.output)}</td>
                  <td className="n"><b>{fmt(s.tokens.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No sessions found.</div>}
      </div>
    </section>
  );
}
