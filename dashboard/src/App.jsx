import { useEffect, useState } from 'react';
import { Dot, Seg } from './components/Seg.jsx';
import { Limits } from './components/Limits.jsx';
import { Tiles } from './components/Tiles.jsx';
import { DailyChart, DailyTable } from './components/DailyChart.jsx';
import { ModelBars } from './components/ModelBars.jsx';
import { Sessions } from './components/Sessions.jsx';
import { RelayTasks } from './components/RelayTasks.jsx';
import { CodexAccount } from './components/CodexAccount.jsx';
import { Setup } from './components/Setup.jsx';
import { Clock, Core } from './components/Hud.jsx';
import { METRICS, ago, metricName, metricValue } from './format.js';
import { usePersisted, useSummary } from './hooks.js';

const SERIES = ['codex', 'claude'];
const RANGES = [{ value: '7', label: '7d' }, { value: '14', label: '14d' }, { value: '30', label: '30d' }];
const NEXT_THEME = { auto: 'light', light: 'dark', dark: 'auto' };

// Only shown when some log lines or files couldn't be read.
function Footer({ sources }) {
  const skipped = sources.codex.skippedLines + sources.claude.skippedLines;
  const unreadable = sources.codex.unreadable + sources.claude.unreadable;
  if (!skipped && !unreadable) return null;
  return <footer><div><b>{skipped} log lines and {unreadable} files could not be read</b>; log formats are undocumented and may change.</div></footer>;
}

export function App() {
  const { data, error } = useSummary();
  const [metric, setMetric] = usePersisted('metric', 'nocache');
  const [range, setRange] = usePersisted('range', '14');
  const [provider, setProvider] = usePersisted('provider', 'all');
  const [theme, setTheme] = usePersisted('theme', 'auto');
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const root = document.documentElement, media = matchMedia('(prefers-color-scheme: dark)');
    if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
    // The command-center look is the dark theme.
    const apply = () => root.classList.toggle('hud', theme === 'dark' || (theme === 'auto' && media.matches));
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const now = data ? Date.now() : 0;
  const days = data ? data.daily.slice(-Number(range)) : [];
  const rows = days.map(d => ({ date: d.date, values: { codex: metricValue(d.codex, metric), claude: metricValue(d.claude, metric) } }));
  return (
    <main>
      <header>
        <div><h1>Relay</h1><div className="tagline">Your agent command center</div></div>
        <span className={`pill ${error ? 'off' : 'on'}`}>{error ? 'Offline' : data ? 'Connected' : 'Connecting'}</span>
        <span className="sub">{data ? `updated ${ago(data.generatedAt)}` : ''}</span>
        <span className="spacer" />
        <Clock />
        <button type="button" title="Switch theme" onClick={() => setTheme(NEXT_THEME[theme] ?? 'auto')}>Theme: {theme}</button>
      </header>
      {error && <div className="banner" role="alert">Can’t reach the dashboard server ({error}). Is relay dashboard still running?</div>}
      {data && (
        <>
          <section className="hero"><Core live={data.sessions.filter(s => s.live).length} /><Limits limits={data.limits} now={now} /></section>
          <CodexAccount account={data.codexAccount} dates={days.map(d => d.date)} now={now} />
          <CodexAccount provider="claude" account={data.claudeAccount} dates={days.map(d => d.date)} now={now} />
          <Tiles data={data} metric={metric} />
          <section className="grid two">
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
            </div>
            <ModelBars models={data.models} metric={metric} />
          </section>
          <Sessions sessions={data.sessions} provider={provider} onProvider={setProvider} now={now} />
          <RelayTasks relay={data.relay} />
          <Setup catalog={data.catalog} />
          <Footer sources={data.sources} />
        </>
      )}
    </main>
  );
}
