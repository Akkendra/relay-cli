import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { summarize } from '../src/usage.mjs';
import { startDashboard } from '../src/dashboard.mjs';

const jsonl = rows => rows.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n';
// realpath keeps the macOS fix: tmpdir() is a symlink, and git reports resolved paths.
function tempDir(t, prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// A fake home with one Codex session, one Claude Code session, and a Relay project; message text must never leak.
function fakeHome(t) {
  const home = tempDir(t, 'relay-home-');
  const project = join(home, 'proj');
  mkdirSync(join(project, '.relay'), { recursive: true });
  writeFileSync(join(project, '.relay', 'state.json'), JSON.stringify({ version: 1, task: { goal: 'Add a feature', status: 'needs_human_decision',
    run: { steps: [{ step: 'started', at: '2026-10-30T12:00:00Z' }, { step: 'reviewed', at: '2026-10-30T12:05:00Z', status: 'needs_human_decision' }], tests: { ran: true, consent: true, exitCode: 0 } } } }));
  writeFileSync(join(project, '.relay', 'review.json'), JSON.stringify({ session_id: 'claude-1', duration_ms: 9000, total_cost_usd: 0.05, is_error: false, result: 'SECRET-REVIEW-TEXT',
    modelUsage: { 'claude-test': {} }, usage: { input_tokens: 2, cache_read_input_tokens: 10, cache_creation_input_tokens: 20, output_tokens: 30 } }));
  const codexDir = join(home, '.codex', 'sessions', '2026', '10', '30');
  mkdirSync(codexDir, { recursive: true });
  const usage = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 1, total_tokens: input + output });
  const limits = used => ({ plan_type: 'plus', primary: { used_percent: used, window_minutes: 300, resets_at: 1793420000 }, secondary: { used_percent: 6, window_minutes: 10080, resets_at: 1793800000 } });
  writeFileSync(join(codexDir, 'rollout-a.jsonl'), jsonl([
    { timestamp: '2026-10-30T12:00:00Z', type: 'session_meta', payload: { id: 'codex-1', cwd: project, timestamp: '2026-10-30T12:00:00Z', base_instructions: 'SECRET-INSTRUCTIONS' } },
    { timestamp: '2026-10-30T12:00:01Z', type: 'turn_context', payload: { model: 'gpt-test' } },
    { timestamp: '2026-10-30T12:00:02Z', type: 'response_item', payload: { type: 'message', content: 'SECRET-PROMPT' } },
    { timestamp: '2026-10-30T12:00:03Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(100, 60, 10), model_context_window: 1000 }, rate_limits: limits(10) } },
    'not json {',
    { timestamp: '2026-10-30T12:00:09Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(250, 160, 25) }, rate_limits: limits(20) } },
  ]));
  const claudeDir = join(home, '.claude', 'projects', '-proj');
  mkdirSync(claudeDir, { recursive: true });
  const assistant = (id, model, at, u) => ({ type: 'assistant', timestamp: at, sessionId: 'claude-1', cwd: project, message: { id, model, usage: u, content: [{ type: 'text', text: 'SECRET-ANSWER' }] } });
  const u = { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 20, output_tokens_details: { thinking_tokens: 4 } };
  writeFileSync(join(claudeDir, 'claude-1.jsonl'), jsonl([
    { type: 'user', timestamp: '2026-10-30T12:01:00Z', sessionId: 'claude-1', cwd: project, message: { content: 'SECRET-PROMPT' } },
    assistant('m1', 'claude-test', '2026-10-30T12:01:05Z', u),
    assistant('m1', 'claude-test', '2026-10-30T12:01:06Z', u),
    assistant('m2', 'claude-test', '2026-10-30T12:01:09Z', { ...u, output_tokens: 40 }),
    assistant('m3', '<synthetic>', '2026-10-30T12:01:10Z', u),
  ]));
  return { home, project };
}
const now = new Date('2026-10-30T12:01:30Z');
// A stand-in for the Vite build so server tests don't depend on running it.
function fakeDist(t) {
  const dir = tempDir(t, 'relay-dist-');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Relay Usage</title><script type="module" src="/assets/app-abc123.js"></script>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'secret.txt'), 'outside assets');
  return dir;
}
const rawGet = (port, path, host = `127.0.0.1:${port}`) => new Promise((yes, no) =>
  get({ host: '127.0.0.1', port, path, headers: { Host: host } }, r => { let body = ''; r.on('data', c => body += c); r.on('end', () => yes({ status: r.statusCode, body, headers: r.headers })); }).on('error', no));

test('usage summary splits Codex cached input, dedupes Claude messages, and never returns content', t => {
  const { home } = fakeHome(t);
  const s = summarize({ home, now });
  const codex = s.sessions.find(x => x.provider === 'codex'), claude = s.sessions.find(x => x.provider === 'claude');
  assert.deepEqual(codex.tokens, { input: 90, cacheRead: 160, cacheWrite: 0, output: 25, reasoning: 1, total: 275 });
  assert.deepEqual(codex.models, ['gpt-test']);
  assert.deepEqual(claude.tokens, { input: 10, cacheRead: 200, cacheWrite: 100, output: 60, reasoning: 8, total: 370 });
  assert.deepEqual(claude.models, ['claude-test']);
  assert.equal(claude.live, true); assert.equal(codex.live, true);
  assert.equal(s.sources.codex.skippedLines, 1);
  assert.equal(s.limits.codex.primary.usedPercent, 20); assert.equal(s.limits.codex.planType, 'plus');
  const today = s.daily.find(d => d.date === now.toLocaleDateString('en-CA'));
  assert.equal(today.codex.total, 275); assert.equal(today.claude.total, 370);
  assert.deepEqual(s.models.map(m => [m.provider, m.model, m.tokens.total]), [['claude', 'claude-test', 370], ['codex', 'gpt-test', 275]]);
  assert.doesNotMatch(JSON.stringify(s), /SECRET/);
  assert.ok(!JSON.stringify(s).includes(home), 'paths under home are shortened to ~');
});
test('Relay projects are discovered from session folders with review usage and the review session marked', t => {
  const { home } = fakeHome(t);
  const [task] = summarize({ home, now }).relay;
  assert.equal(task.root, '~/proj'); assert.equal(task.status, 'needs_human_decision');
  assert.deepEqual(task.steps.map(s => s.step), ['started', 'reviewed']);
  assert.equal(task.review.model, 'claude-test'); assert.equal(task.review.tokens.total, 62); assert.equal(task.review.costUSD, 0.05);
  assert.equal(task.sessions.find(s => s.provider === 'claude').isReview, true);
  assert.equal(task.sessions.find(s => s.provider === 'codex').isReview, false);
});
test('missing log folders produce an empty summary instead of an error', t => {
  const home = tempDir(t, 'relay-empty-');
  const s = summarize({ home, now });
  assert.equal(s.sessions.length, 0); assert.equal(s.limits.codex, null); assert.equal(s.daily.length, 30);
});
test('dashboard serves read-only data on loopback and rejects foreign hosts', async t => {
  const { home } = fakeHome(t);
  const server = await startDashboard({ port: 0, home, configDir: join(home, '.config', 'relay'), readAccount: async () => null, now: () => now, distDir: fakeDist(t) });
  t.after(() => server.close());
  const { address, port } = server.address();
  assert.equal(address, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'; style-src 'self'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(await page.text(), /<title>Relay Usage<\/title>/);
  const api = await (await fetch(`${base}/api/summary`)).json();
  assert.equal(api.sessions.length, 2);
  assert.equal((await fetch(`${base}/api/summary`, { method: 'POST' })).status, 405);
  // fetch drops custom Host headers, so a DNS-rebinding request is sent with node:http.
  assert.equal((await rawGet(port, '/api/summary', `evil.example:${port}`)).status, 421);
  const asset = await rawGet(port, '/assets/app-abc123.js');
  assert.equal(asset.status, 200); assert.match(asset.headers['content-type'], /^text\/javascript/); assert.match(asset.headers['cache-control'], /immutable/);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await rawGet(port, '/secret.txt')).status, 404);
  for (const path of ['/assets/../secret.txt', '/assets/%2e%2e/secret.txt', '/assets/..%2fsecret.txt', '/assets/%2e%2e%2f%2e%2e%2fpackage.json', '/assets/%E0%A4%A']) {
    const r = await rawGet(port, path);
    assert.equal(r.status, 404, path); assert.doesNotMatch(r.body, /outside assets|relay-local-prototype/);
  }
});
test('an explicitly allowed proxy host is accepted while other hosts stay blocked', async t => {
  const { home } = fakeHome(t);
  const server = await startDashboard({ port: 0, home, configDir: join(home, '.config', 'relay'), readAccount: async () => null, now: () => now, allowHosts: ['mac.tail1234.ts.net'], distDir: fakeDist(t) });
  t.after(() => server.close());
  const { port } = server.address();
  const status = async host => (await rawGet(port, '/api/summary', host)).status;
  assert.equal(await status('mac.tail1234.ts.net'), 200);
  assert.equal(await status('MAC.tail1234.ts.net:443'), 200);
  assert.equal(await status('evil.example'), 421);
  assert.equal(await status('mac.tail1234.ts.net.evil.example'), 421);
});
test('an unbuilt dashboard explains how to build it while the API keeps working', async t => {
  const { home } = fakeHome(t);
  const server = await startDashboard({ port: 0, home, configDir: join(home, '.config', 'relay'), readAccount: async () => null, now: () => now, distDir: join(home, 'missing-dist') });
  t.after(() => server.close());
  const { port } = server.address();
  const page = await rawGet(port, '/');
  assert.equal(page.status, 503); assert.match(page.body, /npm run build:dashboard/);
  assert.equal((await rawGet(port, '/api/summary')).status, 200);
});
test('the landing page is served at /welcome with its assets, under the strict policy', async t => {
  const { home } = fakeHome(t);
  const server = await startDashboard({ port: 0, home, configDir: join(home, '.config', 'relay'), readAccount: async () => null, distDir: fakeDist(t), siteDir: fakeDist(t) });
  t.after(() => server.close());
  const { port } = server.address();
  const page = await rawGet(port, '/welcome');
  assert.equal(page.status, 200); assert.match(page.body, /Relay Usage/); assert.match(page.headers['content-security-policy'], /script-src 'self'; style-src 'self'/);
  assert.equal((await rawGet(port, '/welcome/assets/app-abc123.js')).status, 200);
  assert.equal((await rawGet(port, '/welcome/assets/%2e%2e/secret.txt')).status, 404);
});
