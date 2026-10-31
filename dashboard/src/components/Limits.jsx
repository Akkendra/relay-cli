import { Dot } from './Seg.jsx';
import { ago, limitLevel, providerName, until, windowName } from '../format.js';

const SOURCE = { codex: 'Codex', claude: 'Claude Code' };

function LimitWindow({ provider, limits, window: w, now }) {
  const pct = Math.min(100, Math.max(0, w.usedPercent));
  const level = limitLevel(pct);
  const name = windowName(w.windowMinutes);
  return (
    <div className="card">
      <div className="label"><Dot provider={provider} />{providerName(provider)} · {name}</div>
      <div className="value">{Math.round(pct)}<small>% used</small></div>
      <div className={`meter ${provider} ${level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${providerName(provider)} ${name} used`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {level && <span className={`status ${level}`}>{level === 'critical' ? 'Near limit' : 'Getting high'} </span>}
      <div className="note" title={`Reported by ${SOURCE[provider]} ${ago(limits.observedAt, now)}; updates while ${SOURCE[provider]} runs.`}>
        {[w.resetsAt && until(w.resetsAt, now), limits.planType && `${limits.planType[0].toUpperCase()}${limits.planType.slice(1)} plan`].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

function NotReported({ provider, note }) {
  return (
    <div className="card">
      <div className="label"><Dot provider={provider} />{providerName(provider)} limits</div>
      <div className="value muted">Not reported yet</div>
      <div className="note">{note}</div>
    </div>
  );
}

export function Limits({ limits, now }) {
  const cards = [];
  for (const provider of ['codex', 'claude']) {
    const l = limits[provider];
    const windows = l ? [l.primary, l.secondary].filter(Boolean) : [];
    for (const w of windows) cards.push(<LimitWindow key={`${provider}:${w.windowMinutes}`} provider={provider} limits={l} window={w} now={now} />);
    if (!windows.length) cards.push(<NotReported key={provider} provider={provider} note={provider === 'codex'
      ? 'No Codex session has reported plan limits yet.'
      : 'Claude Code reports plan limits to relay statusline after its next response.'} />);
  }
  return <section className="grid limits" aria-label="Plan limits">{cards}</section>;
}
