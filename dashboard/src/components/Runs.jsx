import { Fragment, useState } from 'react';
import { ago, fmt, statusLevel, statusText } from '../format.js';

const duration = s => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round(s % 3600 / 60)}m` : s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`;
// Build → Test → Review → Decision, each done, failed, or skipped, from the run's checkpoints.
function stages(r) {
  const has = s => r.steps.some(x => x.step === s);
  const build = has('built') ? 'done' : has('build_failed') || has('halted_by_policy') || has('cancelled') ? 'failed' : 'skipped';
  const test = has('tests_failed') ? 'failed' : r.tests?.ran ? 'done' : 'skipped';
  const review = has('reviewed') ? 'done' : has('review_failed') || r.status === 'review_blocked' ? 'failed' : 'skipped';
  const decision = ['needs_human_decision', 'done'].includes(r.status) ? 'done' : build === 'failed' || test === 'failed' || review === 'failed' ? 'failed' : 'skipped';
  return [['Build', build], ['Test', test], ['Review', review], ['Decision', decision]];
}
function Stages({ run }) {
  return <span className="stages" role="img" aria-label={stages(run).map(([n, s]) => `${n} ${s}`).join(', ')}>{stages(run).map(([n, s]) => <i key={n} className={s} title={`${n}: ${s}`} />)}</span>;
}
const tests = t => !t ? '—' : !t.ran ? `not run (${t.reason})` : t.exitCode === 0 ? 'passed' : `failed (exit ${t.exitCode})`;

// Every Relay run across projects; a row opens its timeline: steps, what Codex did, flags, and the evidence.
export function Runs({ runs, now }) {
  const [open, setOpen] = useState(null);
  if (!runs?.length) return null;
  const week = runs.filter(r => now - new Date(r.startedAt) < 7 * 864e5);
  const flagged = week.filter(r => r.flags.length).length, halted = week.filter(r => r.status === 'halted_by_policy').length;
  const avg = week.length ? Math.round(week.reduce((n, r) => n + (r.build?.tokens ?? 0) + (r.review?.tokens ?? 0), 0) / week.length) : 0;
  return (
    <section className="card runs" id="runs">
      <h2>Runs</h2>
      <div className="strip">
        <div><b>{week.length}</b><span>runs this week</span></div>
        <div className={flagged ? 'warn' : ''}><b>{flagged}</b><span>flagged</span></div>
        <div className={halted ? 'crit' : ''}><b>{halted}</b><span>halted by policy</span></div>
        <div><b>{fmt(avg)}</b><span>avg tokens per run</span></div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Project</th><th>Task</th><th>Models</th><th className="n">Tokens</th><th className="n">Took</th><th>Flags</th><th>Stages</th><th>Outcome</th></tr></thead>
        <tbody>{runs.map((r, i) => {
          const key = `${r.root}:${r.startedAt}`, blocked = r.flags.filter(f => f.level === 'block').length;
          return (
            <Fragment key={key}>
              <tr className="clickable" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                <td title={r.startedAt}>{ago(r.startedAt, now)}</td>
                <td className="project">{r.root}</td>
                <td className="project" title={r.goal}>{r.goal}</td>
                <td>{[r.build?.model, r.review?.model].filter(Boolean).join(' → ') || '—'}</td>
                <td className="n">{fmt((r.build?.tokens ?? 0) + (r.review?.tokens ?? 0))}</td>
                <td className="n">{duration(r.durationSec)}</td>
                <td>{r.flags.length ? <span className={`status ${blocked ? 'critical' : 'warning'}`}>{blocked ? 'Blocked' : `${r.flags.length} flagged`}</span> : <span className="muted">—</span>}</td>
                <td><Stages run={r} /></td>
                <td><span className={`status ${statusLevel(r.status)}`}>{statusText(r.status)}</span></td>
              </tr>
              {open === key && (
                <tr className="detail"><td colSpan={9}>
                  <div className="trace">
                    <div><h4>Steps</h4><ol>{r.steps.map((s, j) => <li key={j}><span>{s.step.replaceAll('_', ' ')}</span><em>{new Date(s.at).toLocaleTimeString()}</em></li>)}</ol></div>
                    <div><h4>What Codex did</h4>{r.trace.length ? <ul>{r.trace.map((t, j) => <li key={j} className={t.kind}>{t.text}</li>)}</ul> : <p className="muted">{i < 10 ? 'No trace recorded (runs before tracing, or interactive Codex).' : 'Open recent runs for their trace.'}</p>}</div>
                    <div><h4>Evidence</h4>
                      <dl className="kv"><dt>Tests</dt><dd>{tests(r.tests)}</dd><dt>Flags</dt><dd>{r.flags.length ? r.flags.map((f, j) => <div key={j}>{f.level === 'block' ? '✋' : '⚠'} {f.target}</div>) : 'none'}</dd><dt>Policy</dt><dd>{r.policyHash ?? '—'}</dd></dl>
                      {r.findings && <p className="findings">{r.findings}</p>}
                    </div>
                  </div>
                </td></tr>
              )}
            </Fragment>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}
