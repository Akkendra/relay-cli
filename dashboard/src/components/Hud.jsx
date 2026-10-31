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

// What the agents are doing right now: live sessions, or the most recent one when idle.
export function Core({ sessions, now }) {
  const live = sessions.filter(s => s.live), last = sessions[0];
  return (
    <section className="card agents" aria-label={live.length ? `Working: ${live.length} live` : 'Idle'}>
      <div className="label">Agents</div>
      <div className={`state ${live.length ? 'on' : ''}`}><i />{live.length ? 'Working' : 'Idle'}</div>
      {live.length ? (
        <ul>{live.slice(0, 3).map(s => (
          <li key={`${s.provider}:${s.id}`}><i className={`dot ${s.provider}`} /><b>{base(s.project)}</b><span>{s.models[0] ?? s.provider}</span><em>{short(s.tokens.total)}</em></li>
        ))}</ul>
      ) : last ? (
        <p className="note">Last activity {since(last.lastAt, now)} · {base(last.project)}</p>
      ) : <p className="note">No sessions yet.</p>}
      <div className="note foot">{live.length > 3 ? `+${live.length - 3} more · ` : ''}{sessions.length} sessions in view</div>
    </section>
  );
}
