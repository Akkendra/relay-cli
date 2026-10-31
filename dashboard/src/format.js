// Pure helpers shared by the dashboard components; no DOM access so they can be tested under node --test.

export function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return Math.round(v / 1e3) + 'K';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
}
export const full = v => Number(v).toLocaleString();

export const METRICS = [
  { value: 'nocache', label: 'Without cache reads', name: 'without cache reads' },
  { value: 'all', label: 'All tokens', name: 'all tokens' },
  { value: 'output', label: 'Output only', name: 'output tokens' },
];
export function metricValue(t, metric) {
  if (!t) return 0;
  if (metric === 'all') return t.total ?? 0;
  if (metric === 'output') return t.output ?? 0;
  return (t.total ?? 0) - (t.cacheRead ?? 0);
}
export const metricName = metric => (METRICS.find(m => m.value === metric) ?? METRICS[0]).name;
export const providerName = p => p === 'codex' ? 'Codex' : 'Claude';

export function ago(iso, now = Date.now()) {
  if (!iso) return '—';
  const s = Math.max(0, (now - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function until(iso, now = Date.now()) {
  const m = Math.round((new Date(iso) - now) / 60000);
  if (m <= 0) return 'window has reset';
  const d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60;
  return 'resets in ' + (d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`);
}
export function windowName(mins) {
  if (mins === 300) return '5-hour window';
  if (mins === 10080) return 'Weekly window';
  return mins ? Math.round(mins / 60) + '-hour window' : 'Window';
}
export const dayLabel = date => new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function niceMax(v) {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v)), r = v / step;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * step;
}
// Bar path with rounded data-end corners and a square baseline.
export function topRounded(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const STATUS = {
  needs_human_decision: ['good', 'Reviewed · needs your decision'],
  tests_failed: ['critical', 'Tests failed'],
  review_failed: ['critical', 'Review failed'],
  interrupted: ['warning', 'Build interrupted'],
  changed_during_run: ['warning', 'Changed during run'],
  review_stale: ['warning', 'Review is stale'],
  building: ['idle', 'Building'], testing: ['idle', 'Testing'], reviewing: ['idle', 'Reviewing'],
  awaiting_review: ['idle', 'Awaiting review'], ready: ['idle', 'Ready'], no_task: ['idle', 'No task'],
};
export const statusLevel = s => STATUS[s]?.[0] ?? 'idle';
export const statusText = s => STATUS[s]?.[1] ?? s;
export function limitLevel(pct) { return pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : ''; }
