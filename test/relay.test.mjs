import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { execFileSync } from 'node:child_process';
import { initialize, createTask, reviewPacket, projectRoot, buildArgs, reviewArgs, main } from '../src/relay.mjs';

// realpath keeps the macOS fix: tmpdir() is a symlink, and git reports resolved paths.
function tempDir(t, prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fixture(t) {
  const root = tempDir(t, 'relay-test-');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
  writeFileSync(join(root, 'app.txt'), 'before\n'); git('add', '.'); git('commit', '-m', 'Initial');
  initialize(root); return { root, git };
}
test('nested paths identify same project and initialization preserves identity', t => {
  const { root } = fixture(t); mkdirSync(join(root, 'src'));
  assert.equal(projectRoot(join(root, 'src')), root);
  assert.equal(initialize(root).projectId, initialize(root).projectId);
});
test('a task starts from a snapshot, so earlier uncommitted work is not attributed to it', t => {
  const { root, git } = fixture(t);
  writeFileSync(join(root, 'app.txt'), 'existing user edit\n'); writeFileSync(join(root, 'draft.txt'), 'untracked draft\n');
  const task = createTask(root, 'feature');
  assert.equal(git('status', '--porcelain').toString(), ' M app.txt\n?? draft.txt\n', 'the snapshot changes nothing in the working tree or index');
  assert.throws(() => reviewPacket(root, task), /No changes to review/);
  writeFileSync(join(root, 'app.txt'), 'existing user edit\ntask change\n');
  const packet = reviewPacket(root, task);
  assert.match(packet.prompt, /\+task change/); assert.doesNotMatch(packet.prompt, /untracked draft|^\+existing user edit/m);
});
test('review captures staged, unstaged, and untracked changes without staging', t => {
  const { root, git } = fixture(t); const task = createTask(root, 'Add feature; test it');
  writeFileSync(join(root, 'app.txt'), 'after\n');
  writeFileSync(join(root, 'staged.txt'), 'staged content'); git('add', 'staged.txt');
  writeFileSync(join(root, 'new.txt'), 'new content');
  writeFileSync(join(root, '.gitignore'), 'secret.env\n'); writeFileSync(join(root, 'secret.env'), 'TOKEN=hidden');
  const first = reviewPacket(root, task);
  assert.match(first.prompt, /new content/); assert.match(first.prompt, /\+after/); assert.match(first.prompt, /staged content/);
  assert.doesNotMatch(first.prompt, /hidden/);
  assert.deepEqual(first.untracked.sort(), ['.gitignore', 'new.txt']);
  assert.equal(git('diff', '--cached', '--name-only').toString(), 'staged.txt\n');
  writeFileSync(join(root, 'app.txt'), 'changed again');
  assert.notEqual(reviewPacket(root, task).hash, first.hash);
  const next = createTask(root, 'another task');
  const saved = JSON.parse(readFileSync(join(root, '.relay', 'state.json'), 'utf8'));
  assert.equal(saved.task.id, next.id); assert.deepEqual(saved.history.map(h => h.id), [task.id], 'the earlier task moves to history');
});
test('large review is rejected instead of silently losing changes', t => {
  const { root } = fixture(t); const task = createTask(root, 'large change');
  writeFileSync(join(root, 'app.txt'), 'x'.repeat(100001));
  assert.throws(() => reviewPacket(root, task), /100 KB/);
});
test('provider arguments preserve approval path and remove reviewer tools', () => {
  const args = buildArgs({ goal: 'literal $(do-not-execute)' });
  assert.equal(args[args.indexOf('--ask-for-approval') + 1], 'on-request'); assert.ok(!args.includes('--yolo'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  const review = reviewArgs(); assert.equal(review[review.indexOf('--tools') + 1], '');
  assert.equal(review[review.indexOf('--disallowedTools') + 1], 'mcp__*');
});

// Fake provider executables placed first on PATH; they log what they received and spend no tokens.
const fakes = {
  codex: `const args = process.argv.slice(2);
const n = (fs.existsSync(log('codex-count')) ? Number(fs.readFileSync(log('codex-count'), 'utf8')) : 0) + 1;
fs.writeFileSync(log('codex-count'), String(n));
fs.writeFileSync(log('codex.json'), JSON.stringify(args)); fs.writeFileSync(log('codex-' + n + '.json'), JSON.stringify(args));
const file = 'src/feature' + (n === 1 ? '' : '-' + n) + '.js';
fs.mkdirSync('src', { recursive: true });
if (args[0] === 'exec') {
  fs.writeFileSync(log('codex-prompt-' + n + '.txt'), fs.readFileSync(0, 'utf8'));
  const out = e => process.stdout.write(JSON.stringify(e) + '\\n');
  out({ type: 'thread.started', thread_id: args[1] === 'resume' ? args.at(-2) : 'thread-fake' });
  out({ type: 'item.started', item: { type: 'command_execution', command: 'npm test' } });
  if (process.env.FAKE_CODEX_TOUCH) out({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: process.env.FAKE_CODEX_TOUCH, kind: 'update' }] } });
  if (process.env.FAKE_CODEX_CMD) { out({ type: 'item.started', item: { type: 'command_execution', command: process.env.FAKE_CODEX_CMD } }); fs.writeFileSync(log('codex-waiting'), '1'); require('child_process').execSync('sleep 5'); fs.writeFileSync(log('codex-finished'), '1'); }
  if (process.env.FAKE_CODEX_SECRET) fs.writeFileSync('config.js', 'export const key = ' + JSON.stringify(process.env.FAKE_CODEX_SECRET) + ';\\n');
  if (!process.env.FAKE_CODEX_NOOP) fs.writeFileSync(file, 'export const feature = ' + n + ';\\n');
  out({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: file, kind: 'add' }] } });
  out({ type: 'item.completed', item: { type: 'agent_message', text: 'Implemented ' + file }});
  out({ type: 'turn.completed', usage: { input_tokens: 900, cached_input_tokens: 600, output_tokens: 40 } });
} else {
  const now = new Date().toISOString(), sessions = require('path').join(process.env.HOME, '.codex', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(require('path').join(sessions, 'rollout-fake.jsonl'), [
    { timestamp: now, type: 'session_meta', payload: { id: 'codex-tui', cwd: process.cwd(), timestamp: now } },
    { timestamp: now, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 100, output_tokens: 20 } } } },
  ].map(JSON.stringify).join('\\n'));
  fs.writeFileSync(file, 'export const feature = ' + n + ';\\n');
}
process.exit(Number(process.env.FAKE_CODEX_EXIT || 0));`,
  npm: `fs.writeFileSync(log('npm.json'), JSON.stringify(process.argv.slice(2)));
const runs = (fs.existsSync(log('npm-count')) ? Number(fs.readFileSync(log('npm-count'), 'utf8')) : 0) + 1;
fs.writeFileSync(log('npm-count'), String(runs));
if (runs <= Number(process.env.FAKE_NPM_FAIL_TIMES || 0)) { process.stdout.write('1 failing: cart total\\n'); process.exit(1); }
if (process.env.FAKE_NPM_TOUCH) fs.writeFileSync(process.env.FAKE_NPM_TOUCH, 'written by tests\\n');
process.stdout.write(process.env.FAKE_NPM_BYTES ? 'y'.repeat(Number(process.env.FAKE_NPM_BYTES)) : 'tests ok: 3 passed\\n');
process.exit(Number(process.env.FAKE_NPM_EXIT || 0));`,
  claude: `fs.writeFileSync(log('claude.json'), JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(log('claude-input.txt'), fs.readFileSync(0, 'utf8'));
const mode = process.env.FAKE_CLAUDE;
if (fs.readFileSync(log('claude-input.txt'), 'utf8').startsWith('Answer a question')) {
  console.log(JSON.stringify({ is_error: false, result: process.env.FAKE_QUICK ?? 'NEED_MORE_CONTEXT', usage: { input_tokens: 900, output_tokens: 30 } })); process.exit(0);
}
if (mode === 'exit1') { console.error('authentication expired'); process.exit(1); }
if (mode === 'badjson') { console.log('not json'); process.exit(0); }
console.log(JSON.stringify({ is_error: mode === 'is_error', result: 'Findings: one possible bug.', usage: null }));`,
};
function runHarness(t, { env = {}, answer = true, omit = [], packageJson = { scripts: { test: 'node --test' } }, beforeAnswer = () => {},
  goal = 'Add feature; test it', choices = [], classify, limits = {} } = {}) {
  const { root, git } = fixture(t);
  if (packageJson) { writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson)); git('add', '.'); git('commit', '-m', 'Add package'); }
  const base = createTask(root, goal).base;
  const dir = tempDir(t, 'relay-fakes-');
  const bin = join(dir, 'bin'), logs = join(dir, 'logs'), home = join(dir, 'home'); mkdirSync(bin); mkdirSync(logs); mkdirSync(home);
  for (const [name, body] of Object.entries(fakes)) if (!omit.includes(name)) {
    writeFileSync(join(bin, name), `#!/usr/bin/env node\nconst fs = require('fs'), log = f => require('path').join(process.env.FAKE_LOG, f);\n${body}\n`, { mode: 0o755 });
  }
  const prompts = [], plans = [], classified = [];
  const deps = {
    // A fake HOME keeps fake Codex session logs and model config out of the real home directory.
    env: { PATH: `${bin}${delimiter}${process.env.PATH}`, HOME: home, FAKE_LOG: logs, ...env },
    home, isTTY: true, output: { write() {} },
    confirm: async question => { prompts.push(question); beforeAnswer(root); return answer; },
    choose: async question => { plans.push(question); return choices.shift() ?? ''; },
    classify: classify ?? ((g, o) => { classified.push(g); return { tier: o.fallback, reason: 'fake classifier', usage: null, ok: true }; }),
    limits: async () => ({ codex: limits.codex ?? null }), claudeLimits: () => limits.claude ?? null,
  };
  const read = name => readFileSync(join(logs, name), 'utf8');
  const logged = name => existsSync(join(logs, name));
  const state = () => JSON.parse(readFileSync(join(root, '.relay', 'state.json'), 'utf8')).task;
  const saved = () => JSON.parse(readFileSync(join(root, '.relay', 'state.json'), 'utf8'));
  return { root, git, base, home, deps, prompts, plans, classified, read, logged, state, saved, run: () => main(['run'], root, deps) };
}
test('run builds, tests with consent, and sends unstaged new files and evidence to review', async t => {
  const h = runHarness(t);
  await h.run();
  assert.deepEqual(JSON.parse(h.read('codex.json')),
    ['exec', '--json', '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="low"', '-c', 'approval_policy="never"', '--sandbox', 'workspace-write', '-'],
    'Codex runs to completion on the small model, sandboxed, and can never escalate');
  assert.match(h.read('codex-prompt-1.txt'), /Implement this bounded task: Add feature; test it[\s\S]*Do not push, commit, or deploy/);
  assert.deepEqual(JSON.parse(h.read('npm.json')), ['test']);
  assert.deepEqual(JSON.parse(h.read('claude.json')), reviewArgs({ model: 'haiku', effort: 'low' }), 'a small diff gets the small reviewer');
  assert.equal(h.plans.length, 2, 'the build plan, then what to do after the review'); assert.equal(h.classified.length, 0, 'clear-cut tasks never call the classifier');
  assert.equal(h.prompts.length, 1); assert.match(h.prompts[0], /npm test/);
  const packet = h.read('claude-input.txt');
  assert.match(packet, /export const feature = 1/); assert.match(packet, /src\/feature\.js/);
  assert.match(packet, /Node: v\d+/); assert.match(packet, /Exit code: 0/); assert.match(packet, /tests ok: 3 passed/);
  assert.equal(h.git('diff', '--cached', '--name-only').toString(), '');
  assert.equal(h.git('rev-parse', 'HEAD').toString().trim(), h.state().baseCommit, 'nothing is committed');
  const task = h.state();
  assert.equal(task.status, 'needs_human_decision');
  assert.deepEqual(task.run.steps.map(s => s.step), ['started', 'built', 'testing', 'tests_recorded', 'reviewed', 'done']);
  assert.equal(task.run.tests.diffHash, task.reviewHash);
  assert.equal(task.routing.build.tier, 'small'); assert.equal(task.routing.build.source, 'rules');
  assert.deepEqual(task.routing.build.tokens, { input: 300, cacheRead: 600, cacheWrite: 0, output: 40, reasoning: 0, total: 940 }, 'build tokens come from Codex events');
  assert.equal(task.routing.build.sessionId, 'thread-fake');
  assert.equal(task.routing.review.model, 'haiku');
  assert.match(packet, new RegExp(`Tested diff SHA-256: ${task.reviewHash}`));
  assert.ok(!existsSync(join(h.root, '.relay', 'lock')));
});
test('run never executes tests without consent and says so in the packet', async t => {
  const h = runHarness(t, { answer: false });
  await h.run();
  assert.ok(!h.logged('npm.json'));
  assert.match(h.read('claude-input.txt'), /Not run: the user declined/);
  assert.equal(h.state().run.tests.consent, false);
});
test('run without a test script skips the consent prompt and records it', async t => {
  const h = runHarness(t, { packageJson: null });
  await h.run();
  assert.equal(h.prompts.length, 0); assert.ok(!h.logged('npm.json'));
  assert.match(h.read('claude-input.txt'), /no "test" script/);
});
test('failed tests stop the run, save the failure, and skip review', async t => {
  const h = runHarness(t, { env: { FAKE_NPM_EXIT: '1' } });
  await assert.rejects(h.run(), /npm test failed \(exit 1\).*not complete/);
  assert.ok(!h.logged('claude.json'));
  assert.equal(h.state().status, 'tests_failed');
  const failure = JSON.parse(readFileSync(join(h.root, '.relay', 'test-failure.json'), 'utf8'));
  assert.equal(failure.exitCode, 1); assert.match(failure.output, /tests ok/); assert.match(failure.node, /^v\d+/); assert.match(failure.diffHash, /^[0-9a-f]{64}$/);
});
test('large test output is bounded and labelled in the review packet', async t => {
  const h = runHarness(t, { env: { FAKE_NPM_BYTES: '500000' } });
  await h.run();
  const packet = h.read('claude-input.txt');
  assert.match(packet, /bytes omitted by Relay/);
  assert.ok(Buffer.byteLength(packet) < 20000);
});
test('files changed by the tests stop the run before review', async t => {
  const h = runHarness(t, { env: { FAKE_NPM_TOUCH: 'src/snapshot.txt' } });
  await assert.rejects(h.run(), /changed while npm test ran.*not complete/);
  assert.ok(!h.logged('claude.json'));
  const task = h.state();
  assert.equal(task.status, 'changed_during_run'); assert.equal(task.run.steps.at(-1).when, 'while npm test ran');
});
test('files changed after Codex exits (detached task) stop the run before tests', async t => {
  const h = runHarness(t, { beforeAnswer: root => writeFileSync(join(root, 'src', 'feature.js'), 'late edit\n') });
  await assert.rejects(h.run(), /changed before npm test/);
  assert.ok(!h.logged('npm.json')); assert.ok(!h.logged('claude.json'));
  assert.equal(h.state().status, 'changed_during_run');
});
test('files changed after Codex exits stop the run before review when tests are declined', async t => {
  const h = runHarness(t, { answer: false, beforeAnswer: root => writeFileSync(join(root, 'late.txt'), 'late file\n') });
  await assert.rejects(h.run(), /changed before review/);
  assert.ok(!h.logged('claude.json'));
  const task = h.state();
  assert.equal(task.status, 'changed_during_run'); assert.equal(task.run.steps.at(-1).step, 'changed_during_run');
});
test('a failed Codex session stops before tests and review', async t => {
  const h = runHarness(t, { env: { FAKE_CODEX_EXIT: '2' } });
  await assert.rejects(h.run(), /codex stopped \(2\); task is not complete/);
  assert.equal(h.prompts.length, 0); assert.ok(!h.logged('npm.json')); assert.ok(!h.logged('claude.json'));
  const task = h.state();
  assert.equal(task.status, 'interrupted'); assert.equal(task.run.steps.at(-1).step, 'build_failed');
});
test('missing provider executables fail clearly', async t => {
  const h = runHarness(t, { omit: ['codex'] });
  // PATH points nowhere, so a real codex can never be launched.
  await assert.rejects(main(['run'], h.root, { env: { PATH: '/nonexistent', HOME: h.home }, home: h.home, isTTY: true, confirm: async () => true, choose: async () => '', output: { write() {} } }), /codex not found on PATH/);
  assert.equal(h.state().status, 'interrupted');
});
for (const [mode, pattern] of [['exit1', /Claude review failed \(1\): authentication expired/], ['badjson', /invalid JSON/], ['is_error', /Claude reported an error/]]) {
  test(`review provider error (${mode}) fails clearly and is not accepted`, async t => {
    const h = runHarness(t, { env: { FAKE_CLAUDE: mode } });
    await assert.rejects(h.run(), pattern);
    const task = h.state();
    assert.equal(task.status, 'review_failed'); assert.equal(task.run.steps.at(-1).step, 'review_failed');
  });
}
test('API or proxy overrides block run before any provider starts', async t => {
  const h = runHarness(t, { env: { ANTHROPIC_API_KEY: 'should-not-print' } });
  await assert.rejects(h.run(), error => /API\/proxy/.test(error.message) && !error.message.includes('should-not-print'));
  assert.ok(!h.logged('codex.json'));
});
test("relay build opens Codex's own window, which needs a terminal, and reads tokens from its session log", async t => {
  const h = runHarness(t);
  await assert.rejects(main(['build'], h.root, { ...h.deps, isTTY: false }), /needs your terminal/);
  assert.ok(!h.logged('codex.json'));
  await main(['build'], h.root, h.deps);
  const args = JSON.parse(h.read('codex.json'));
  assert.notEqual(args[0], 'exec'); assert.equal(args[args.indexOf('--ask-for-approval') + 1], 'on-request');
  assert.equal(h.state().routing.build.tokens.total, 520); assert.equal(h.state().routing.build.sessionId, 'codex-tui');
});
test('the build plan can be bumped up before Codex starts, and borderline tasks ask the classifier', async t => {
  const goal = 'Add an export button to the reports page that downloads the visible rows as a CSV file, keeps the current filters, and shows a short confirmation message when the download starts';
  const h = runHarness(t, { goal, choices: ['b'] .concat(['']) });
  await h.run();
  assert.equal(h.classified.length, 1, 'a borderline task gets one classifier call');
  const task = h.state();
  assert.equal(task.routing.build.source, 'you');
  const args = JSON.parse(h.read('codex.json'));
  assert.equal(args[args.indexOf('-m') + 1], task.routing.build.model);
  assert.equal(h.plans.length, 3, 'the plan twice (after the change), then the after-review prompt');
});
test('cancelling the build plan starts nothing', async t => {
  const h = runHarness(t, { choices: ['q'] });
  await assert.rejects(h.run(), /Cancelled before Codex started/);
  assert.ok(!h.logged('codex.json')); assert.equal(h.state().run.steps.at(-1).step, 'cancelled');
});
test('after a review, "f" sends the findings back to the same Codex session and verifies again', async t => {
  const h = runHarness(t, { choices: ['', 'f', ''] });
  await h.run();
  const fix = JSON.parse(h.read('codex-2.json'));
  assert.deepEqual(fix.slice(0, 2), ['exec', 'resume']); assert.equal(fix.at(-2), 'thread-fake', 'the same session is resumed');
  assert.equal(fix[fix.indexOf('-c', fix.indexOf('approval_policy="never"') - 1) + 1], 'approval_policy="never"');
  assert.ok(fix.includes('sandbox_mode="workspace-write"'));
  assert.match(h.read('codex-prompt-2.txt'), /Claude independently reviewed[\s\S]*Findings: one possible bug\./);
  assert.equal(h.prompts.length, 2, 'tests ask for consent again after the fix');
  const task = h.state();
  assert.deepEqual(task.run.steps.map(s => s.step).filter(s => s !== 'testing' && s !== 'tests_recorded'),
    ['started', 'built', 'reviewed', 'fix_requested', 'built', 'reviewed', 'done']);
  assert.equal(task.codexRuns.length, 2); assert.equal(task.routing.build.tokens.total, 1880, 'tokens add up across the build and the fix');
  assert.match(h.read('claude-input.txt'), /feature-2\.js/, 'the second review sees the fix');
});
test('typed follow-up instructions go to Codex instead of the findings', async t => {
  const h = runHarness(t, { choices: ['', 'also add a README section', ''] });
  await h.run();
  assert.match(h.read('codex-prompt-2.txt'), /Follow-up from the user: also add a README section/);
});
test('failing tests can be fixed without leaving: the failure goes to Codex, then tests and review run again', async t => {
  const h = runHarness(t, { env: { FAKE_NPM_FAIL_TIMES: '1' }, choices: ['', 'f', ''] });
  await h.run();
  assert.match(h.read('codex-prompt-2.txt'), /npm test failed[\s\S]*1 failing: cart total/);
  const steps = h.state().run.steps.map(s => s.step);
  assert.ok(steps.includes('tests_failed') && steps.at(-1) === 'done');
  assert.equal(h.state().status, 'needs_human_decision');
});
test('the interactive prompt runs tasks back to back, each reviewed on its own changes', async t => {
  const h = runHarness(t);
  const lines = ['add a banner', '/status', 'add a footer', '/history', '/nope', '/quit'], logs = [];
  const original = console.log; console.log = (...a) => logs.push(a.join(' '));
  try { await main([], h.root, { ...h.deps, isTTY: true, readLine: async () => lines.shift() ?? null }); }
  finally { console.log = original; }
  const saved = h.saved();
  assert.equal(saved.task.goal, 'add a footer'); assert.deepEqual(saved.history.map(x => x.goal), ['Add feature; test it', 'add a banner']);
  const packet = h.read('claude-input.txt');
  assert.match(packet, /feature-2\.js/); assert.doesNotMatch(packet, /src\/feature\.js/, "the first task's file is part of the second task's baseline");
  assert.ok(logs.some(l => l.includes('needs_human_decision · add a banner')), '/status shows the current task');
  assert.ok(logs.some(l => /^2\. needs_human_decision · add a banner/m.test(l)), '/history lists earlier tasks');
  assert.ok(logs.some(l => l.includes('Unknown command /nope')));
  assert.ok(!existsSync(join(h.root, '.relay', 'lock')), 'the lock is only held while a task runs');
});
test('the prompt offers to set up local git in a plain folder, and leaves it alone if declined', async t => {
  const dir = tempDir(t, 'relay-plain-');
  const original = console.log; console.log = () => {};
  try {
    await main([], dir, { isTTY: true, env: { HOME: dir }, confirm: async () => false, readLine: async () => null });
    assert.ok(!existsSync(join(dir, '.git')));
    await main([], dir, { isTTY: true, env: { HOME: dir }, confirm: async () => true, readLine: async () => null });
  } finally { console.log = original; }
  assert.ok(existsSync(join(dir, '.git')) && existsSync(join(dir, '.relay', 'state.json')));
});
test('questions are answered read-only, and a build with no changes skips tests and review', async t => {
  const h = runHarness(t);
  const lines = ['where is the site hosted', '/task Add feature; test it', '/quit'];
  const original = console.log; console.log = () => {};
  try { await main([], h.root, { ...h.deps, readLine: async () => lines.shift() ?? null, env: { ...h.deps.env, FAKE_CODEX_NOOP: '1' } }); }
  finally { console.log = original; }
  const ask = JSON.parse(h.read('codex-1.json'));
  assert.equal(ask[ask.indexOf('--sandbox') + 1], 'read-only'); assert.equal(ask[ask.indexOf('-m') + 1], 'gpt-6-luna');
  assert.match(h.read('codex-prompt-1.txt'), /Do not modify anything[\s\S]*where is the site hosted/);
  assert.equal(h.prompts.length, 0, 'no test prompt'); assert.doesNotMatch(h.read('claude-input.txt'), /independent reviewer/, 'no review');
  assert.equal(h.state().status, 'no_changes'); assert.equal(h.saved().history.length, 1, 'only /task created a task');
});
for (const [text, question] of [['where is the site hosted', true], ['How do I run it?', true], ['add a banner', false], ['Fix the typo in the footer', false]]) {
  test(`"${text}" is ${question ? 'a question' : 'a task'}`, async () => {
    const { isQuestion } = await import('../src/cli.mjs');
    assert.equal(isQuestion(text), question);
  });
}
test('/undo puts back only the task\'s changes, and /diff lists them', async t => {
  const { root, git } = fixture(t);
  writeFileSync(join(root, 'mine.txt'), 'already here\n'); writeFileSync(join(root, '.gitignore'), 'secret.env\n');
  const task = createTask(root, 'edit things');
  writeFileSync(join(root, 'app.txt'), 'changed by task\n'); writeFileSync(join(root, 'added.txt'), 'new\n');
  writeFileSync(join(root, 'secret.env'), 'ignored, keep me');
  const { taskChanges } = await import('../src/relay.mjs');
  assert.deepEqual(taskChanges(root, task).files, [{ status: 'A', path: 'added.txt' }, { status: 'M', path: 'app.txt' }]);
  const logs = [], lines = ['/diff', '/undo', '/diff', '/quit'];
  const original = console.log; console.log = (...a) => logs.push(a.join(' '));
  try { await main([], root, { isTTY: true, env: { HOME: root }, confirm: async () => true, readLine: async () => lines.shift() ?? null }); }
  finally { console.log = original; }
  assert.ok(logs.some(l => l.includes('M app.txt') && l.includes('A added.txt')));
  assert.equal(readFileSync(join(root, 'app.txt'), 'utf8'), 'before\n'); assert.ok(!existsSync(join(root, 'added.txt')));
  assert.equal(readFileSync(join(root, 'mine.txt'), 'utf8'), 'already here\n', 'files from before the task stay');
  assert.ok(existsSync(join(root, 'secret.env')), 'ignored files stay');
  assert.equal(git('diff', '--cached', '--name-only').toString(), '', 'the index is untouched');
  assert.ok(logs.includes('The current task has no changes.'));
});
test('Tab completes slash commands', async () => {
  const { complete } = await import('../src/cli.mjs');
  assert.deepEqual(complete('/st'), [['/status'], '/st']); assert.deepEqual(complete('/'), [complete('/')[0], '/']);
  assert.ok(complete('/').length && complete('/')[0].includes('/undo')); assert.deepEqual(complete('add a'), [[], 'add a']);
});
test('simple questions are answered cheaply by Claude from the file list and README; harder ones fall back to read-only Codex', async t => {
  const h = runHarness(t, { env: { FAKE_QUICK: 'Run npm start, then open http://localhost:8080.\nSources: package.json' } });
  const logs = [], lines = ['how do I run it?', '/quit'];
  const original = console.log; console.log = (...a) => logs.push(a.join(' '));
  try { await main([], h.root, { ...h.deps, readLine: async () => lines.shift() ?? null }); }
  finally { console.log = original; }
  assert.ok(logs.some(l => l.startsWith('Run npm start, then open http://localhost:8080.'))); assert.ok(!h.logged('codex.json'), 'Codex is never started');
  const args = JSON.parse(h.read('claude.json'));
  assert.equal(args[args.indexOf('--tools') + 1], ''); assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  assert.match(h.read('claude-input.txt'), /FILES \(\d+\)[\s\S]*package\.json/);
});
test('near a plan limit, the build and review are capped at cheaper tiers, with the reason shown', async t => {
  const large = 'Refactor the authentication flow across the codebase. (1) migrate the schema (2) keep logins (3) concurrency-safe refresh (4) docs (5) tests (6) benchmark performance';
  const h = runHarness(t, { goal: large, limits: { codex: { primary: { usedPercent: 85, windowMinutes: 300 } }, claude: { secondary: { usedPercent: 93, windowMinutes: 10080 } } } });
  await h.run();
  const task = h.state();
  assert.equal(task.routing.build.tier, 'medium'); assert.ok(task.routing.build.reasons.some(r => /Codex is at 85% of its 5-hour limit, so capped at medium/.test(r)));
  assert.equal(task.routing.review.model, 'haiku');
});
test('fix rounds get a follow-up review of only the new changes, with the earlier findings', async t => {
  const h = runHarness(t, { choices: ['', 'f', ''] });
  await h.run();
  const packet = h.read('claude-input.txt');
  assert.match(packet, /FOLLOW-UP REVIEW[\s\S]*EARLIER FINDINGS\nFindings: one possible bug\./);
  assert.match(packet, /feature-2\.js/); assert.doesNotMatch(packet, /b\/src\/feature\.js/, 'the already-reviewed file is not sent again');
  assert.equal(h.state().reviewHash, h.state().run.tests.diffHash, 'safety checks still cover the whole task');
});
test('/continue sends a follow-up to the same Codex session without a new task', async t => {
  const h = runHarness(t);
  const lines = ['add a banner', '/continue make it blue', '/quit'];
  const original = console.log; console.log = () => {};
  try { await main([], h.root, { ...h.deps, readLine: async () => lines.shift() ?? null }); }
  finally { console.log = original; }
  const args = JSON.parse(h.read('codex-2.json'));
  assert.deepEqual(args.slice(0, 2), ['exec', 'resume']); assert.equal(args.at(-2), 'thread-fake');
  assert.match(h.read('codex-prompt-2.txt'), /Follow-up from the user: make it blue/);
  assert.equal(h.saved().task.goal, 'add a banner'); assert.equal(h.saved().history.length, 1);
});
test('reviews get imported files as context and quotes are checked against the diff', async t => {
  const { root } = fixture(t);
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'cart.js'), 'export const total = () => 0;\n');
  const task = createTask(root, 'receipt');
  writeFileSync(join(root, 'src', 'receipt.js'), "import { total } from './cart.js';\nexport const line = () => total();\n");
  const packet = reviewPacket(root, task);
  assert.match(packet.prompt, /UNCHANGED FILES THE CHANGED CODE IMPORTS[\s\S]*--- src\/cart\.js\nexport const total/);
  const { unverifiedQuotes } = await import('../src/relay.mjs');
  assert.deepEqual(unverifiedQuotes('Bug at `export const line = () => total();` and `throw new Error(oops)`; see `src/cart.js`', packet.diff), ['throw new Error(oops)']);
  assert.deepEqual(unverifiedQuotes('Covers only `cart.js` logic (5 tests). The `disabled` attribute and `throw new Error(oops)`', packet.diff), ['throw new Error(oops)'], 'short spans keep backticks paired; bare names are not quotes');
});
test('a likely secret in the diff blocks the review before anything is sent to Claude', async t => {
  // Built at runtime so the repository never contains a key-shaped literal.
  const h = runHarness(t, { env: { FAKE_CODEX_SECRET: 'AKIA' + 'Q'.repeat(16) }, answer: false });
  await assert.rejects(h.run(), /Possible secret in config\.js; nothing was sent to Claude/);
  assert.ok(!h.logged('claude.json')); assert.equal(h.state().status, 'review_blocked');
});
for (const word of ['exit', 'quit', 'Exit', 'bye']) {
  test(`typing "${word}" leaves the prompt instead of starting a task`, async t => {
    const h = runHarness(t);
    const original = console.log; console.log = () => {};
    try { await main([], h.root, { ...h.deps, readLine: async () => word }); }
    finally { console.log = original; }
    assert.ok(!h.logged('codex.json')); assert.equal(h.saved().history ?? undefined, undefined);
  });
}
test('a blocked command stops Codex at once and the task is halted, with the trace kept', async t => {
  const h = runHarness(t, { env: { FAKE_CODEX_CMD: 'git push origin main' } });
  const started = Date.now();
  await assert.rejects(h.run(), /Stopped by policy \(blocked command: git push origin main\)/);
  assert.ok(Date.now() - started < 4500, 'Codex was stopped instead of running to the end');
  assert.ok(!h.logged('codex-finished')); assert.ok(!h.logged('npm.json'), 'no tests after a halt'); assert.ok(!h.logged('claude.json'), 'no review after a halt');
  const task = h.state();
  assert.equal(task.status, 'halted_by_policy'); assert.equal(task.run.steps.at(-1).step, 'halted_by_policy');
  assert.deepEqual(task.run.flags.map(f => [f.level, f.target]), [['block', 'git push origin main']]);
  assert.ok(task.run.trace.some(e => /git push origin main/.test(e.text))); assert.match(task.run.policyHash, /^[0-9a-f]{12}$/);
});
test('flagged actions are recorded without stopping the run, and show in the runs feed', async t => {
  const h = runHarness(t, { env: { FAKE_CODEX_TOUCH: 'package.json' } });
  await h.run();
  const task = h.state();
  assert.equal(task.status, 'needs_human_decision');
  assert.deepEqual(task.run.flags.map(f => [f.level, f.kind, f.target]), [['flag', 'paths', 'package.json']]);
  assert.ok(task.run.trace.some(e => e.kind === 'file_change') && task.run.trace.some(e => e.kind === 'agent_message'));
  const { summarize } = await import('../src/usage.mjs');
  const fakeSession = join(h.home, '.codex', 'sessions'); mkdirSync(fakeSession, { recursive: true });
  writeFileSync(join(fakeSession, 'r.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 's1', cwd: h.root, timestamp: new Date().toISOString() } }) + '\n');
  const [run] = summarize({ home: h.home }).runs;
  assert.equal(run.status, 'needs_human_decision'); assert.equal(run.flags.length, 1); assert.ok(run.trace.length > 0); assert.ok(run.build.model);
});
