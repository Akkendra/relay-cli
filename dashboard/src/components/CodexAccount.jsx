import { Fragment } from 'react';
import { Dot } from './Seg.jsx';
import { DailyChart } from './DailyChart.jsx';
import { ago, fmt } from '../format.js';

const minutes = sec => sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.round(sec % 3600 / 60)}m` : `${Math.round(sec / 60)}m`;
const days = n => `${n} day${n === 1 ? '' : 's'}`;

// Account-wide Codex usage (all devices, the desktop app, cloud tasks), as Codex's own /usage reports it.
export function CodexAccount({ account, dates, now }) {
  if (!account) return null;
  if (account.error) {
    return (
      <section className="card account">
        <h2><Dot provider="codex" />Codex account</h2>
        <div className="note">Couldn't read account usage from Codex ({account.error}). Local session logs are still shown.</div>
      </section>
    );
  }
  const s = account.summary;
  const byDate = new Map(account.daily.map(d => [d.date, d.tokens]));
  const rows = dates.map(date => ({ date, values: { codex: byDate.get(date) ?? 0 } }));
  const stats = [
    ['Lifetime tokens', s.lifetimeTokens != null && fmt(s.lifetimeTokens)],
    ['Peak day', s.peakDailyTokens != null && fmt(s.peakDailyTokens)],
    ['Longest turn', s.longestRunningTurnSec != null && minutes(s.longestRunningTurnSec)],
    ['Current streak', s.currentStreakDays != null && days(s.currentStreakDays)],
    ['Longest streak', s.longestStreakDays != null && days(s.longestStreakDays)],
  ];
  return (
    <section className="card account">
      <div className="chart-head">
        <h2><Dot provider="codex" />Codex account · all devices</h2>
        <span className="spacer" />
        <span className="note">Reported by Codex {ago(account.observedAt, now)} · the latest day can lag</span>
      </div>
      <div className="account-body">
        <dl className="kv account-stats">
          {stats.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v || '—'}</dd></Fragment>)}
        </dl>
        <DailyChart rows={rows} series={['codex']} height={180} label="Codex tokens per day, whole account" />
      </div>
    </section>
  );
}
