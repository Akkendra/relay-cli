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
import { METRICS, metricName, metricValue } from './format.js';
import { usePersisted, useSummary } from './hooks.js';

const SERIES = ['codex', 'claude'];
const RANGES = [{ value: '7', label: '7d' }, { value: '14', label: '14d' }, { value: '30', label: '30d' }];
const NEXT_THEME = { auto: 'light', light: 'dark', dark: 'auto' };

function Footer({ sources }) {
  const skipped = sources.codex.skippedLines + sources.claude.skippedLines;
  const unreadable = sources.codex.unreadable + sources.claude.unreadable;
  return (
    <footer>
      <div>
        Sources: {sources.codex.files} Codex logs in {sources.codex.dir} · {sources.claude.files} Claude Code transcripts in {sources.claude.dir}.
        Read-only; nothing leaves this machine.
      </div>
      <div>
        Totals include cache reads unless a view excludes them. Codex counts cached tokens inside input; they're split out here.
        Log formats are undocumented and may change{(skipped > 0 || unreadable > 0) && <> — <b>{skipped} lines and {unreadable} files could not be read</b></>}.
      </div>
    </footer>
  );
}

export function App() {
  const { data, error } = useSummary();
  const [metric, setMetric] = usePersisted('metric', 'nocache');
  const [range, setRange] = usePersisted('range', '14');
  const [provider, setProvider] = usePersisted('provider', 'all');
  const [theme, setTheme] = usePersisted('theme', 'auto');
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const now = data ? Date.now() : 0;
  const days = data ? data.daily.slice(-Number(range)) : [];
  const rows = days.map(d => ({ date: d.date, values: { codex: metricValue(d.codex, metric), claude: metricValue(d.claude, metric) } }));
  return (
    <main>
      <header>
        <h1>Relay usage</h1>
        <span className="sub">{data ? `Local Codex and Claude Code logs · updated ${new Date(data.generatedAt).toLocaleTimeString()}` : 'Loading…'}</span>
        <span className="spacer" />
        <button type="button" title="Switch theme" onClick={() => setTheme(NEXT_THEME[theme] ?? 'auto')}>Theme: {theme}</button>
      </header>
      {error && <div className="banner" role="alert">Can’t reach the dashboard server ({error}). Is relay dashboard still running?</div>}
      {data && (
        <>
          <Limits limits={data.limits} now={now} />
          <CodexAccount account={data.codexAccount} dates={days.map(d => d.date)} now={now} />
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
