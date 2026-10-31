import { Stages } from './Runs.jsx';
import { ago, fmt, statusLevel, statusText } from '../format.js';

// The most recent Relay run, for a glance without scrolling to the Runs feed.
export function LatestRun({ runs, now }) {
  const r = runs?.[0];
  return (
    <section className="card latest">
      <div className="latest-head"><h2>Latest run</h2>{r && <span className={`status ${statusLevel(r.status)}`}>{statusText(r.status)}</span>}</div>
      {r ? (
        <>
          <div className="label plain">{r.root}</div>
          <p className="goal" title={r.goal}>{r.goal}</p>
          <Stages run={r} />
          <div className="meta"><span>{ago(r.startedAt, now)}{r.flags.length ? ` · ${r.flags.length} flagged` : ''}</span><span><b>{fmt((r.build?.tokens ?? 0) + (r.review?.tokens ?? 0))}</b> tokens</span></div>
        </>
      ) : <p className="note">No Relay runs yet. Run <code>relay</code> in a project and type a task.</p>}
    </section>
  );
}
