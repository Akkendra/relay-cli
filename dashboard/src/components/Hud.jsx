import { useEffect, useState } from 'react';

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const pad = n => String(n).padStart(2, '0');
  return (
    <div className="clock" aria-label={now.toLocaleTimeString()}>
      <span>{pad(now.getHours())}:{pad(now.getMinutes())}</span>
      <em>{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</em>
    </div>
  );
}

const base = p => (p ?? '').split('/').filter(Boolean).pop() ?? '—';
const short = t => t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${Math.round(t / 1e3)}K` : String(t ?? 0);
const since = (iso, now) => { const m = Math.max(0, Math.round((now - new Date(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };

// Each agent's state at a glance: live or idle, what it's on, and today's tokens; then the live sessions.
export function Core({ sessions, today, now }) {
  const live = sessions.filter(s => s.live);
  const projects = new Set(sessions.map(s => s.project)).size;
  const agent = provider => {
    const mine = sessions.filter(s => s.provider === provider), on = mine.filter(s => s.live), last = mine[0];
    return { provider, name: provider === 'codex' ? 'Codex' : 'Claude', live: on.length,
      detail: on.length ? base(on[0].project) : last ? since(last.lastAt, now) : 'no sessions', tokens: today?.[provider]?.total ?? 0 };
  };
  return (
    <section className="card agents" aria-label={live.length ? `Working: ${live.length} live` : 'Idle'}>
      <div className="agents-head"><h2>Agents</h2><span className={`state ${live.length ? 'on' : ''}`}><i />{live.length ? 'Working' : 'Idle'}</span></div>
      <ul className="agent-rows">{['codex', 'claude'].map(agent).map(a => (
        <li key={a.provider}>
          <i className={`dot ${a.provider}`} />
          <div><b>{a.name}</b><span>{a.live ? `Live · ${a.detail}` : `Idle · ${a.detail}`}</span></div>
          <em title="Tokens today">{short(a.tokens)}<small> today</small></em>
        </li>
      ))}</ul>
      {live.length > 0 && (
        <div className="working">
          <h3>Working on</h3>
          <ul>{live.slice(0, 3).map(s => (
            <li key={`${s.provider}:${s.id}`}><i className={`dot ${s.provider}`} /><b>{base(s.project)}</b><span>{s.models[0] ?? s.provider}</span><em>{short(s.tokens.total)}</em></li>
          ))}</ul>
        </div>
      )}
      <div className="note foot">{sessions.length} sessions · {projects} project{projects === 1 ? '' : 's'}</div>
    </section>
  );
}
