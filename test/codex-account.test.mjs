import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { readCodexAccount, normalizeAccount, accountCache } from '../src/codex-account.mjs';
import { summarize } from '../src/usage.mjs';

const usage = { summary: { lifetimeTokens: 1234567, peakDailyTokens: 400000, longestRunningTurnSec: 600, currentStreakDays: 2, longestStreakDays: 3 },
  dailyUsageBuckets: [{ startDate: '2026-10-26', tokens: 250000 }, { startDate: '2026-10-29T00:00:00Z', tokens: 90000 }, { startDate: 7, tokens: 'x' }] };
const limits = { rateLimits: { planType: 'plus', primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1793420000 }, secondary: { usedPercent: 15, windowDurationMins: 10080, resetsAt: 1793800000 } } };
const now = new Date('2026-10-31T03:00:00Z');

// A fake `codex app-server` speaking the same newline-delimited JSON-RPC; FAKE_MODE switches failure cases.
function fakeCodex(t, mode = 'ok') {
  const dir = mkdtempSync(join(tmpdir(), 'relay-appserver-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'codex'), `#!/usr/bin/env node
if (process.argv[2] !== 'app-server') process.exit(2);
const mode = process.env.FAKE_MODE, results = { 'initialize': {}, 'account/usage/read': ${JSON.stringify(usage)}, 'account/rateLimits/read': ${JSON.stringify(limits)} };
let buf = '';
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
  if (m.id == null) continue;
  if (mode === 'silent') continue;
  if (mode === 'signed-out' && m.method === 'account/usage/read') { process.stdout.write(JSON.stringify({ id: m.id, error: { code: -32000, message: 'not logged in' } }) + '\\n'); continue; }
  process.stdout.write(JSON.stringify({ id: m.id, result: results[m.method] ?? {} }) + '\\n'); } });
`, { mode: 0o755 });
  return { PATH: `${dir}${delimiter}${process.env.PATH}`, FAKE_MODE: mode, HOME: dir };
}

test('account usage and live limits are read through the Codex app server', async t => {
  const account = await readCodexAccount({ env: fakeCodex(t), now: () => now });
  assert.deepEqual(account.summary, usage.summary);
  assert.deepEqual(account.daily, [{ date: '2026-10-26', tokens: 250000 }, { date: '2026-10-29', tokens: 90000 }], 'malformed buckets are dropped');
  assert.deepEqual(account.limits.primary, { usedPercent: 40, windowMinutes: 300, resetsAt: new Date(1793420000000).toISOString() });
  assert.equal(account.limits.planType, 'plus');
});
test('Codex problems become an error value, never an exception', async t => {
  assert.match((await readCodexAccount({ env: fakeCodex(t, 'signed-out') })).error, /not logged in/);
  assert.match((await readCodexAccount({ env: fakeCodex(t, 'silent'), timeoutMs: 300 })).error, /did not answer/);
  assert.match((await readCodexAccount({ env: { PATH: '/nonexistent' } })).error, /codex not found/);
});
test('account limits replace session-log limits, and errors leave local data intact', t => {
  const home = mkdtempSync(join(tmpdir(), 'relay-acct-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const s = summarize({ home, now, codexAccount: normalizeAccount(usage, limits, now) });
  assert.equal(s.limits.codex.primary.usedPercent, 40); assert.equal(s.codexAccount.summary.lifetimeTokens, 1234567);
  const failed = summarize({ home, now, codexAccount: { error: 'codex not found on PATH', observedAt: now.toISOString() } });
  assert.equal(failed.limits.codex, null); assert.equal(failed.codexAccount.error, 'codex not found on PATH');
  assert.equal(summarize({ home, now }).codexAccount, null);
});
test('the cache asks Codex at most once per interval and never makes a poll wait', async () => {
  let clock = 0, calls = 0;
  const cache = accountCache({ read: async () => ({ n: ++calls }), intervalMs: 60000, clock: () => clock });
  assert.equal(cache.get(), null, 'the first poll returns immediately');
  await cache.refresh();
  for (let i = 0; i < 20; i++) cache.get();
  assert.equal(calls, 1); assert.deepEqual(cache.get(), { n: 1 });
  clock += 60000; cache.get(); await cache.refresh();
  assert.equal(calls, 2);
});
