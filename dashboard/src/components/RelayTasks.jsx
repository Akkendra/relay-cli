import { Dot } from './Seg.jsx';
import { fmt, statusLevel, statusText } from '../format.js';

function testsText(t) {
  if (!t) return '—';
  if (!t.ran) return `Not run: ${t.reason}`;
  return t.exitCode === 0 ? 'Passed (exit 0)' : `Failed (exit ${t.exitCode})`;
}
function reviewText(rv) {
  if (!rv) return '—';
  const tokens = rv.tokens ? `${fmt(rv.tokens.total)} tokens (${fmt(rv.tokens.output)} output)` : 'usage unknown';
  return `${rv.model ?? 'unknown model'} · ${tokens}${rv.durationMs ? ` · ${Math.round(rv.durationMs / 1000)}s` : ''}`;
}

function Task({ task }) {
  const rv = task.review;
  return (
    <div className="card">
      <div className="label strong">{task.root}</div>
      <div><span className={`status ${statusLevel(task.status)}`}>{statusText(task.status)}</span></div>
      {task.goal && <div className="goal" title={task.goal}>{task.goal}</div>}
      {task.steps.length > 0 && (
        <div className="steps">{task.steps.map((s, i) => <span key={i} title={s.at}>{s.step.replaceAll('_', ' ')}</span>)}</div>
      )}
      <dl className="kv">
        <dt>Tests</dt><dd>{testsText(task.tests)}</dd>
        <dt>Review</dt><dd>{reviewText(rv)}</dd>
        {rv?.costUSD != null && <><dt>List-price est.</dt><dd>${rv.costUSD.toFixed(3)} <span className="muted">(not your subscription bill)</span></dd></>}
        <dt>Sessions in folder</dt>
        <dd>{task.sessions.length ? task.sessions.map(s => (
          <span key={`${s.provider}:${s.id}`} className="label inline"><Dot provider={s.provider} />{fmt(s.total)}{s.isReview && ' review'}</span>
        )) : '—'}</dd>
      </dl>
    </div>
  );
}

export function RelayTasks({ relay }) {
  return (
    <section>
      <h2 className="section-title">Relay tasks</h2>
      <div className="grid tasks">
        {relay.length ? relay.map(t => <Task key={t.root} task={t} />) : <div className="empty card">No Relay projects found in session history.</div>}
      </div>
    </section>
  );
}
