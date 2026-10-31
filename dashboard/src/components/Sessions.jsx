import { Fragment, useState } from 'react';
import { Dot, Seg } from './Seg.jsx';
import { KEYS, ago, fmt, groupSessions, providerName } from '../format.js';

const PAGE_SIZE = 10;
const PROVIDERS = [{ value: 'all', label: 'All' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }];
function Row({ s, now, count, open, onToggle, child }) {
  return (
    <tr className={`${count > 1 ? 'clickable' : ''}${child ? ' child' : ''}`} onClick={onToggle} aria-expanded={count > 1 ? open : undefined}>
      <td>{s.live ? <span className="status good live">Live</span> : <span className="status idle muted">Idle</span>}</td>
      <td><span className="label plain"><Dot provider={s.provider} />{providerName(s.provider)}</span></td>
      <td className="project" title={s.project ?? ''}>{child ? <span className="muted">↳ session</span> : <>{s.project ?? '—'}{s.relayProject && <span className="muted"> · Relay</span>}</>}</td>
      <td>{count > 1 ? <span className="count">{count} sessions {open ? '▾' : '▸'}</span> : (s.models.join(', ') || '—')}</td>
      <td title={s.lastAt ?? ''}>{ago(s.lastAt, now)}</td>
      {KEYS.map(k => <td key={k} className="n">{k === 'total' ? <b>{fmt(s.tokens[k])}</b> : fmt(s.tokens[k])}</td>)}
      <td className="n">{s.costUSD == null ? '—' : `$${s.costUSD.toFixed(2)}`}</td>
    </tr>
  );
}

export function Sessions({ sessions, provider, onProvider, now }) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(null);
  const groups = groupSessions(sessions.filter(s => provider === 'all' || s.provider === provider));
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  return (
    <section className="card sessions" id="sessions">
      <div className="chart-head">
        <h2>Sessions <span className="muted">· {sessions.length} in {groups.length} group{groups.length === 1 ? '' : 's'}</span></h2>
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
              {rows.map(g => (
                <Fragment key={g.key}>
                  <Row s={g} now={now} count={g.sessions.length} open={open === g.key} onToggle={() => g.sessions.length > 1 && setOpen(open === g.key ? null : g.key)} />
                  {open === g.key && g.sessions.map(s => <Row key={`${s.id}:${s.startedAt}`} s={s} now={now} count={1} child />)}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No sessions found.</div>}
      </div>
      {groups.length > PAGE_SIZE && (
        <nav className="pager" aria-label="Sessions pages">
          <span>{current * PAGE_SIZE + 1}–{current * PAGE_SIZE + rows.length} of {groups.length}</span>
          <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0}>Previous</button>
          <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>Next</button>
        </nav>
      )}
    </section>
  );
}
