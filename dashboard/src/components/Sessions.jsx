import { useState } from 'react';
import { Dot, Seg } from './Seg.jsx';
import { ago, fmt, providerName } from '../format.js';

const PAGE_SIZE = 10;
const PROVIDERS = [{ value: 'all', label: 'All' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }];

export function Sessions({ sessions, provider, onProvider, now }) {
  const [page, setPage] = useState(0);
  const matching = sessions.filter(s => provider === 'all' || s.provider === provider);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = matching.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  return (
    <section className="card sessions">
      <div className="chart-head">
        <h2>Sessions</h2>
        <span className="spacer" />
        <Seg label="Provider" options={PROVIDERS} value={provider} onChange={p => { setPage(0); onProvider(p); }} />
      </div>
      <div className="table-wrap">
        {rows.length ? (
          <table>
            <thead>
              <tr>
                <th>Status</th><th>Provider</th><th>Project</th><th>Model</th><th>Last activity</th>
                <th className="n">Input</th><th className="n">Cache read</th><th className="n">Cache write</th><th className="n">Output</th><th className="n">Total</th><th className="n" title="List-price estimate from Claude Code or Codex; not your subscription bill">Est. cost</th>
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
                  <td className="n">{s.costUSD == null ? '—' : `$${s.costUSD.toFixed(2)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No sessions found.</div>}
      </div>
      {matching.length > PAGE_SIZE && (
        <nav className="pager" aria-label="Sessions pages">
          <span>{current * PAGE_SIZE + 1}–{current * PAGE_SIZE + rows.length} of {matching.length}</span>
          <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0}>Previous</button>
          <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>Next</button>
        </nav>
      )}
    </section>
  );
}
