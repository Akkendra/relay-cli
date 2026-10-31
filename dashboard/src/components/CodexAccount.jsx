import { Fragment, useState } from 'react';
import { Dot, Seg } from './Seg.jsx';
import { DailyChart } from './DailyChart.jsx';
import { ago, duration, fmt } from '../format.js';

const days = n => `${n} day${n === 1 ? '' : 's'}`;

// Account-wide Codex usage (all devices, the desktop app, cloud tasks), as Codex's own /usage reports it.
const TITLES = { codex: 'Codex · all devices', claude: 'Claude · this Mac' };
const RANGES = [{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }];
const iso = d => d.toLocaleDateString('en-CA');
const monthLabel = date => new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
// Weekly and monthly: one bar per day. Yearly: one bar per month, summed from the daily totals.
function rowsFor(range, daily, provider, now = new Date()) {
  const byDate = new Map(daily.map(d => [d.date, d.tokens]));
  if (range === 'year') {
    const byMonth = new Map();
    for (const [date, tokens] of byDate) byMonth.set(date.slice(0, 7), (byMonth.get(date.slice(0, 7)) ?? 0) + tokens);
    return Array.from({ length: 12 }, (_, i) => {
      const m = iso(new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)).slice(0, 7);
      return { date: `${m}-01`, values: { [provider]: byMonth.get(m) ?? 0 } };
    });
  }
  const n = range === 'week' ? 7 : 30;
  return Array.from({ length: n }, (_, i) => {
    const date = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i)));
    return { date, values: { [provider]: byDate.get(date) ?? 0 } };
  });
}
// Codex's account report lags real use by hours, so today's bar is at least what this Mac's logs already show.
const withToday = (daily, local) => {
  const today = iso(new Date()), at = daily.findIndex(d => d.date === today);
  if (!local) return daily;
  if (at < 0) return [...daily, { date: today, tokens: local }];
  return daily.map((d, i) => i === at ? { ...d, tokens: Math.max(d.tokens, local) } : d);
};
export function CodexAccount({ account, now, provider = 'codex', localToday = 0 }) {
  const [range, setRange] = useState('week');
  if (!account) return provider === 'codex' ? <section className="card account"><h2><Dot provider="codex" />{TITLES.codex}</h2><div className="note">Loading account usage from Codex…</div></section> : null;
  if (account.error) {
    return (
      <section className="card account">
        <h2><Dot provider={provider} />{TITLES[provider]}</h2>
        <div className="note">Couldn't read account usage from Codex ({account.error}). Local session logs are still shown.</div>
      </section>
    );
  }
  const s = account.summary;
  const rows = rowsFor(range, withToday(account.daily, localToday), provider);
  const stats = [
    ['Lifetime tokens', s.lifetimeTokens != null && fmt(s.lifetimeTokens)],
    ['Peak day', s.peakDailyTokens != null && fmt(s.peakDailyTokens)],
    [provider === 'codex' ? 'Longest turn' : 'Longest session', s.longestRunningTurnSec != null && duration(s.longestRunningTurnSec)],
    ['Current streak', s.currentStreakDays != null && days(s.currentStreakDays)],
    ['Longest streak', s.longestStreakDays != null && days(s.longestStreakDays)],
  ];
  return (
    <section className="card account">
      <div className="chart-head">
        <h2><Dot provider={provider} />{TITLES[provider]}</h2>
        <span className="spacer" />
        <Seg label="Range" options={RANGES} value={range} onChange={setRange} />
        <span className="note">{provider === 'codex' ? `From Codex, ${ago(account.observedAt, now)}` : 'From session logs'}</span>
      </div>
      <div className="account-body">
        <dl className="kv account-stats">
          {stats.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v || '—'}</dd></Fragment>)}
        </dl>
        <DailyChart rows={rows} series={[provider]} height={140} formatLabel={range === 'year' ? monthLabel : undefined} label={`${TITLES[provider]}: tokens per ${range === 'year' ? 'month' : 'day'}`} />
      </div>
    </section>
  );
}
