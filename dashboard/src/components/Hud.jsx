const base = p => (p ?? '').split('/').filter(Boolean).pop() ?? '—';
const short = t => t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${Math.round(t / 1e3)}K` : String(t ?? 0);
const since = (iso, now) => { const m = Math.max(0, Math.round((now - new Date(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };

function Spark({ values, provider, hours }) {
  const max = Math.max(1, ...values), w = 100 / values.length;
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={`Tokens per hour, last ${values.length} hours`}>
      {values.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * 26) : 1;
        return <rect key={i} x={i * w + 0.8} y={28 - h} width={w - 1.6} height={h} rx="0.8" fill={v ? `var(--${provider})` : 'var(--border)'}><title>{`${hours[i].slice(11)}:00 · ${short(v)} tokens`}</title></rect>;
      })}
    </svg>
  );
}

// One card per agent: live or idle, tokens today, the last 12 hours, and what it's on (or when it last ran).
export function Core({ sessions, today, hourly, now }) {
  const cards = ['claude', 'codex'].map(provider => {
    const mine = sessions.filter(s => s.provider === provider), on = mine.filter(s => s.live), last = mine[0];
    return { provider, name: provider === 'codex' ? 'Codex' : 'Claude', live: on.length > 0,
      detail: on.length ? base(on[0].project) : last ? since(last.lastAt, now) : 'no sessions yet',
      tokens: today?.[provider]?.total ?? 0, spark: (hourly ?? []).map(h => h[provider]) };
  }).sort((a, b) => Number(b.live) - Number(a.live));
  return (
    <section className="card agents" aria-label="Agents">
      <h2>Agents</h2>
      <div className="agent-cards">{cards.map(c => (
        <article key={c.provider} className={`agent ${c.live ? 'on' : ''}`}>
          <header><span><i className={`dot ${c.provider}`} />{c.name}</span><b className="badge">{c.live ? 'Live' : 'Idle'}</b></header>
          <div className="big">{short(c.tokens)}<small> today</small></div>
          <Spark values={c.spark} provider={c.provider} hours={(hourly ?? []).map(h => h.hour)} />
          <footer title={c.detail}>{c.detail}</footer>
        </article>
      ))}</div>
    </section>
  );
}
