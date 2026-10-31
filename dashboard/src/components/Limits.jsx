import { Dot } from './Seg.jsx';
import { ago, limitLevel, until, windowName } from '../format.js';

function CodexWindow({ limits, window: w, now }) {
  const pct = Math.min(100, Math.max(0, w.usedPercent));
  const level = limitLevel(pct);
  const name = windowName(w.windowMinutes);
  return (
    <div className="card">
      <div className="label"><Dot provider="codex" />Codex · {name}</div>
      <div className="value">{pct}% used</div>
      <div className={`meter ${level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Codex ${name} used`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {level && <span className={`status ${level}`}>{level === 'critical' ? 'Near limit' : 'Getting high'} </span>}
      {w.resetsAt && <span className="note">{until(w.resetsAt, now)}</span>}
      <div className="note">
        Reported by Codex {ago(limits.observedAt, now)}{limits.planType && ` · ${limits.planType} plan`}. Updates only while Codex runs.
      </div>
    </div>
  );
}

export function Limits({ limits, now }) {
  const codex = limits.codex;
  const windows = codex ? [codex.primary, codex.secondary].filter(Boolean) : [];
  return (
    <section className="grid limits" aria-label="Plan limits">
      {windows.map(w => <CodexWindow key={w.windowMinutes ?? 'w'} limits={codex} window={w} now={now} />)}
      {!codex && (
        <div className="card">
          <div className="label"><Dot provider="codex" />Codex limits</div>
          <div className="value muted">Not reported</div>
          <div className="note">No Codex session has reported plan limits yet.</div>
        </div>
      )}
      <div className="card">
        <div className="label"><Dot provider="claude" />Claude limits</div>
        <div className="value muted">Not reported</div>
        <div className="note">Claude Code doesn't write plan-limit usage to its local logs, so this dashboard doesn't guess it.</div>
      </div>
    </section>
  );
}
