import { useLayoutEffect, useRef } from 'react';
import { startMotion } from './motion.js';

const FEATURES = [
  ['Right-sized models', 'Small tasks stay cheap; risky ones get a careful look.'],
  ['Tests with consent', 'Nothing runs until you say yes.'],
  ['Tool-less review', 'Claude reads the diff and quotes what it means.'],
  ['Fix in place', 'Findings go back to the same Codex session.'],
  ['Limit-aware', 'Near a plan limit, Relay steps down a tier.'],
  ['Secret scan', 'Likely keys never leave your machine.'],
  ['/undo', "Put a task's changes back from its snapshot."],
  ['Live limits', "Both plans' windows on one page."],
];
const STEPS = ['Pick a model sized to the task', 'Build, sandboxed, no network', 'Test, with your consent', 'Independent review', 'Fix in place, or finish'];
// [step it belongs to, line]; the step lights up when its first line appears.
const SESSION = [
  [0, <><span className="you">add a "flavour of the week" banner</span></>],
  [null, <>Build: <span className="cx">Codex small model</span> <span className="dim">· one UI change</span></>],
  [null, <span className="dim">[Enter] run · [b] bigger · [s] smaller</span>],
  [1, <>  ✎ src/banner.js <span className="dim">(add)</span></>],
  [null, <>  ✎ index.html <span className="dim">(update)</span></>],
  [2, <>Run "npm test"? [y/N] <span className="k">y</span></>],
  [null, <span className="ok">✔ 14 passed</span>],
  [3, <>Review: <span className="cl">Claude small model</span> <span className="dim">· 38 lines in 2 files</span></>],
  [null, <span className="dim">Findings: the banner isn't announced to screen readers.</span>],
  [4, <span className="dim">[f] fix these findings · [Enter] done</span>],
  [null, <span className="k">f</span>],
  [null, <>Codex continues the same session… <span className="ok">✔ fixed</span></>],
  [null, <>Done · needs your decision. <span className="dim">Nothing committed.</span></>],
];
const PRINCIPLES = [
  ['You decide', 'The best outcome is "needs your decision". Relay never commits, pushes, or deploys.'],
  ['Consent before execution', "Tests run only after a yes. Codex stays in its sandbox and can't escalate."],
  ['Evidence over claims', 'Findings must quote the diff; unverifiable ones are flagged. Codex\'s "tests pass" is checked against a real run.'],
  ['Nothing leaves without reason', 'Likely secrets stop a review before anything is sent. The dashboard reads counts, never prompts or code.'],
];
const Tile = ({ label, value, w, color, note }) => (
  <div className="tile"><small>{label}</small><b>{value}</b>{w ? <div className="track"><i style={{ '--w': w, background: `var(--${color})` }} /></div> : <small>{note}</small>}</div>
);

export function App() {
  const ref = useRef(null);
  useLayoutEffect(() => startMotion(ref.current), []);
  return (
    <div ref={ref}>
      <header><nav className="top wrap">
        <a className="brand" href="#top">RELAY</a>
        <div className="links"><a href="#how">How it works</a><a href="#dashboard">Dashboard</a><a href="#principles">Principles</a><a href="#install">Install</a></div>
        <div className="right"><a className="pill" href="/dashboard/">Open dashboard</a><a className="pill solid" href="#install">Get started</a></div>
      </nav></header>
      <main id="top">
        <section className="hero">
          <div className="wrap">
            <span className="eyebrow">Codex × Claude</span>
            <h1><span className="reveal-line"><span>Two models.</span></span><span className="reveal-line"><span>One decision: yours.</span></span></h1>
            <p className="sub">Relay hands each coding task to <b>the right-sized Codex model</b>, has <b>Claude review it independently</b>, and leaves the call to you.</p>
          </div>
          <div className="stage" aria-hidden="true">
            <div className="app">
              <div className="bar"><span>Relay</span><span>Connected · updated just now</span></div>
              <Tile label="Codex · weekly window" value="24%" w="24%" color="codex" />
              <Tile label="Claude · weekly window" value="41%" w="41%" color="claude" />
              <Tile label="Live sessions" value="2" note="Codex, Claude" />
              <div className="tile chart">{[30, 52, 20, 68, 44, 90, 36, 58, 26, 74, 48, 62].map((h, i) => <i key={i} style={{ '--h': `${h}%` }} />)}</div>
              <Tile label="Today, without cache reads" value="184K" note="tokens across both" />
            </div>
          </div>
        </section>

        <div className="rail" aria-label="What Relay does">
          <ul>{[...FEATURES, ...FEATURES].map(([t, d], i) => <li key={i} aria-hidden={i >= FEATURES.length || undefined}><b>{t}</b><span>{d}</span></li>)}</ul>
        </div>

        <section className="statement wrap">
          <span className="label">What Relay does</span>
          <p><b>Relay is a local CLI for building with two AI coding agents.</b> Codex writes the change, Claude reviews it without tools, and Relay keeps both honest: it sizes the model to the task, asks before running anything, and never commits on your behalf.</p>
        </section>

        <section className="play" id="how" aria-label="A task, start to finish">
          <div className="stick wrap">
            <div>
              <span className="label">How it works</span>
              <h2>Type the task. Stay until it's done.</h2>
              <p className="lede">Codex runs inside Relay, tests run only when you say so, and fixes go back to the same Codex session.</p>
              <ol className="steps">{STEPS.map(s => <li key={s}>{s}</li>)}</ol>
            </div>
            <div className="term" role="img" aria-label="Example Relay session: build, test, review, fix, done">
              {SESSION.map(([step, line], i) => <p key={i} data-step={step ?? undefined}>{line}</p>)}
            </div>
          </div>
        </section>

        <section className="paper" id="dashboard">
          <div className="wrap">
            <div>
              <span className="label">The dashboard</span>
              <h2>Both plans' limits, side by side.</h2>
              <p>A read-only page on your own machine shows <b>Codex and Claude limits</b>, tokens per day and model, every session's estimated cost, and the plugins and skills you have installed.</p>
              <div className="stats"><div><b>2</b><span>Agents, one page</span></div><div><b>5 h · 7 d</b><span>Limit windows tracked</span></div><div><b>0</b><span>API keys needed</span></div></div>
              <a className="pill" href="#install">Run it locally</a>
            </div>
            <div className="mini" aria-hidden="true">
              <Tile label="Codex · 5-hour window" value="12%" w="12%" color="codex" />
              <Tile label="Claude · 5-hour window" value="63%" w="63%" color="claude" />
              <Tile label="Setup" value="8 plugins" note="196 skills · 3 hooks" />
            </div>
          </div>
        </section>

        <section className="rows wrap" id="principles">
          <span className="label">Principles</span>
          <h2>Careful by default.</h2>
          <ol>{PRINCIPLES.map(([t, d]) => <li key={t}><h3>{t}</h3><p>{d}</p></li>)}</ol>
        </section>

        <section className="install wrap" id="install">
          <div>
            <span className="label">Install</span>
            <h2>Two signed-in CLIs and Node 22.</h2>
            <p className="lede">Relay uses the Codex and Claude Code CLIs you already sign in to with your subscriptions. No API keys.</p>
          </div>
          <pre><span className="c"># once</span>{'\n'}git clone https://github.com/Akkendra/relay-cli{'\n'}cd relay-cli && npm install{'\n'}npm run build:dashboard && npm link{'\n\n'}<span className="c"># in any project</span>{'\n'}relay{'\n'}relay dashboard   <span className="c"># http://localhost:4318/dashboard</span></pre>
        </section>
      </main>
      <footer>
        <div className="wrap">
          <div className="closing">
            <h2>Start with one task.</h2>
            <div className="cta"><a className="pill solid" href="#install">Get started</a><a className="pill" href="https://github.com/Akkendra/relay-cli">View on GitHub</a></div>
          </div>
          <div className="cols">
            <div><span className="brand">RELAY</span><p>Codex builds. Claude reviews. You decide.</p></div>
            <div><h4>Product</h4><a href="#how">How it works</a><a href="/dashboard/">Dashboard</a><a href="#install">Install</a></div>
            <div><h4>Project</h4><a href="https://github.com/Akkendra/relay-cli">GitHub</a><a href="https://github.com/Akkendra/relay-cli/blob/main/README.md">Docs</a><a href="https://github.com/Akkendra/relay-cli/blob/main/LICENSE">License</a></div>
          </div>
          <div className="legal"><span>MIT licensed</span><span>Runs on your machine · no API keys</span></div>
        </div>
      </footer>
    </div>
  );
}
