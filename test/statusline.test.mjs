import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { runStatusline, extractLimits, claudeLimitsPath, claudeCostsPath } from '../src/statusline.mjs';
import { summarize } from '../src/usage.mjs';

const now = new Date('2026-10-31T03:00:00Z');
const input = {
  model: { display_name: 'Opus 5.5' }, cwd: '/secret/project', transcript_path: '/secret/t.jsonl', session_id: 'abc',
  context_window: { used_percentage: 12 },
  rate_limits: { five_hour: { used_percentage: 42.6, resets_at: 1793427600 }, seven_day: { used_percentage: 17, resets_at: 1793660400 } },
};
async function run(t, stdinText) {
  const home = mkdtempSync(join(tmpdir(), 'relay-status-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let printed = '';
  await runStatusline({ stdin: Readable.from([stdinText]), env: { HOME: home }, now, out: { write: s => { printed += s; } } });
  return { home, printed, file: claudeLimitsPath({ HOME: home }) };
}

test('statusline saves only the plan-limit windows and prints a short line', async t => {
  const { home, printed, file } = await run(t, JSON.stringify(input));
  assert.equal(printed, 'Opus 5.5 · 43% session · 17% week');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved, extractLimits(input, now));
  assert.equal(saved.primary.windowMinutes, 300); assert.equal(saved.secondary.windowMinutes, 10080);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /secret|abc|Opus/, 'nothing else from the session is kept');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const limits = summarize({ home, now }).limits.claude;
  assert.equal(limits.primary.usedPercent, 42.6); assert.equal(limits.secondary.usedPercent, 17);
});
test('without rate limits (API users, first response) nothing is saved and context is shown', async t => {
  const { printed, file } = await run(t, JSON.stringify({ model: { display_name: 'Sonnet 5.5' }, context_window: { used_percentage: 40.2 } }));
  assert.equal(printed, 'Sonnet 5.5 · 40% context'); assert.ok(!existsSync(file));
});
test('malformed input never throws and never writes', async t => {
  const { printed, file } = await run(t, 'not json');
  assert.equal(printed, 'relay'); assert.ok(!existsSync(file));
});
test('windows past their reset time are dropped from the summary', async t => {
  const { home } = await run(t, JSON.stringify(input));
  const later = new Date('2026-11-01T12:00:00Z');
  const limits = summarize({ home, now: later }).limits.claude;
  assert.equal(limits.primary, null, 'the 5-hour window reset'); assert.equal(limits.secondary.usedPercent, 17);
  assert.equal(summarize({ home, now: new Date('2026-12-01T00:00:00Z') }).limits.claude, null);
});
test('per-session cost from Claude Code is saved by session id and shown on the session', async t => {
  const { home } = await run(t, JSON.stringify({ ...input, cost: { total_cost_usd: 1.25 } }));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(claudeCostsPath({ HOME: home }), 'utf8'))), ['abc']);
  const dir = join(home, '.claude', 'projects', 'p'); (await import('node:fs')).mkdirSync(dir, { recursive: true });
  (await import('node:fs')).writeFileSync(join(dir, 's.jsonl'), JSON.stringify({ type: 'assistant', sessionId: 'abc', timestamp: now.toISOString(), message: { id: 'm', model: 'claude-x', usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');
  assert.equal(summarize({ home, now }).sessions[0].costUSD, 1.25);
});
