import { useEffect, useState } from 'react';
import { Dot, Seg } from './components/Seg.jsx';
import { Limits } from './components/Limits.jsx';
import { DailyChart, DailyTable } from './components/DailyChart.jsx';
import { ModelBars } from './components/ModelBars.jsx';
import { Sessions } from './components/Sessions.jsx';
import { CodexAccount } from './components/CodexAccount.jsx';
import { Setup } from './components/Setup.jsx';
import { Runs } from './components/Runs.jsx';
import { Board } from './components/Board.jsx';
import { LatestRun } from './components/LatestRun.jsx';
import { Clock, Core } from './components/Hud.jsx';
import { METRICS, mergeLayout, metricName, metricValue } from './format.js';
import { usePersisted, useSummary } from './hooks.js';

const SERIES = ['codex', 'claude'];
// Tokens per day is the main chart; the account charts and models sit under it as a row of smaller tiles.
const DEFAULT_LAYOUT = [
  { id: 'agents', size: 's' }, { id: 'limits', size: 'm' }, { id: 'latest', size: 's' }, { id: 'daily', size: 'l' },
  { id: 'codex', size: 's' }, { id: 'claude', size: 's' }, { id: 'models', size: 's' }, { id: 'sessions', size: 'l' }, { id: 'runs', size: 'l' }, { id: 'setup', size: 'l' },
];
// v2: new default arrangement, applied once even where an older layout was saved.
const LAYOUT_KEY = 'relay-dash:layout.v2';
function readLayout() { try { return mergeLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY)), DEFAULT_LAYOUT); } catch { return DEFAULT_LAYOUT; } }
const RANGES = [{ value: '7', label: '7d' }, { value: '14', label: '14d' }, { value: '30', label: '30d' }];
const NEXT_THEME = { dark: 'light', light: 'dark' };

// Only shown when some log lines or files couldn't be read.
function Footer({ sources }) {
  const skipped = sources.codex.skippedLines + sources.claude.skippedLines;
  const unreadable = sources.codex.unreadable + sources.claude.unreadable;
  if (!skipped && !unreadable) return null;
  return <footer><div><b>{skipped} log lines and {unreadable} files could not be read</b>; log formats are undocumented and may change.</div></footer>;
}

export function App() {
  const { data, error } = useSummary();
  // New keys so the All tokens / 7 days defaults apply once, even where older choices were saved.
  const [metric, setMetric] = usePersisted('metric.v2', 'all');
  const [range, setRange] = usePersisted('range.v2', '7');
  const [layout, setLayoutState] = useState(readLayout);
  const [editing, setEditing] = useState(false);
  const setLayout = next => { setLayoutState(next); try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch {} };
  const [provider, setProvider] = usePersisted('provider', 'all');
  const [stored, setTheme] = usePersisted('theme', 'dark');
  // The command-center look is the default; light only when chosen (an old 'auto' preference counts as dark).
  const theme = stored === 'light' ? 'light' : 'dark';
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('hud', theme === 'dark');
  }, [theme]);

  const now = data ? Date.now() : 0;
  const days = data ? data.daily.slice(-Number(range)) : [];
  const rows = days.map(d => ({ date: d.date, values: { codex: metricValue(d.codex, metric), claude: metricValue(d.claude, metric) } }));
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/">Relay</a>
        <nav className="sections" aria-label="Sections"><a href="#w-agents">Overview</a><a href="#w-daily">Usage</a><a href="#sessions">Sessions</a><a href="#runs">Runs</a><a href="#setup">Setup</a></nav>
        <div className="tools">
          <Clock />
          {editing && <button type="button" onClick={() => setLayout(DEFAULT_LAYOUT)}>Reset layout</button>}
          <button type="button" aria-pressed={editing} onClick={() => setEditing(v => !v)}>{editing ? 'Done' : 'Edit'}</button>
          <button type="button" className="icon" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setTheme(NEXT_THEME[theme])}>{theme === 'dark' ? '☀' : '☾'}</button>
        </div>
      </header>
      {error && <div className="banner" role="alert">Can’t reach the dashboard server ({error}). Is relay dashboard still running?</div>}
      {data && (
        <>
          <Board layout={layout} setLayout={setLayout} editing={editing} widgets={{
            agents: { title: 'Agents', render: () => <Core sessions={data.sessions} today={data.daily.at(-1)} hourly={data.hourly} now={now} /> },
            latest: { title: 'Latest run', render: () => <LatestRun runs={data.runs} now={now} /> },
            limits: { title: 'Plan limits', render: () => <Limits limits={data.limits} now={now} /> },
            codex: { title: 'Codex · all devices', render: () => <CodexAccount account={data.codexAccount} now={now} localToday={data.daily.at(-1)?.codex?.total} /> },
            claude: { title: 'Claude · this Mac', render: () => <CodexAccount provider="claude" account={data.claudeAccount} now={now} /> },
            daily: { title: 'Tokens per day', render: () => (
              <div className="card">
                <div className="chart-head">
                  <h2>Tokens per day · this Mac</h2>
                  <div className="legend"><span><Dot provider="codex" />Codex</span><span><Dot provider="claude" />Claude</span></div>
                  <span className="spacer" />
                  <Seg label="Metric" options={METRICS} value={metric} onChange={setMetric} />
                  <Seg label="Range" options={RANGES} value={range} onChange={setRange} />
                  <button type="button" aria-pressed={showTable} onClick={() => setShowTable(v => !v)}>Table</button>
                </div>
                {showTable ? <DailyTable rows={rows} series={SERIES} />
                  : <DailyChart rows={rows} series={SERIES} label={`Tokens per day on this Mac, ${metricName(metric)}, Codex and Claude stacked`} />}
              </div>) },
            models: { title: 'By model', render: () => <ModelBars models={data.models} metric={metric} /> },
            sessions: { title: 'Sessions', render: () => <Sessions sessions={data.sessions} provider={provider} onProvider={setProvider} now={now} /> },
            runs: { title: 'Runs', render: () => <Runs runs={data.runs} now={now} /> },
            setup: { title: 'Setup', render: () => <Setup catalog={data.catalog} /> },
          }} />
          <Footer sources={data.sources} />
        </>
      )}
    </main>
  );
}
