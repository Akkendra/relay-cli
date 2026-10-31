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
test('dirty initial tree cannot be attributed to a new task', t => {
  const { root } = fixture(t); writeFileSync(join(root, 'app.txt'), 'existing user edit');
  assert.throws(() => createTask(root, 'feature'), /clean committed/);
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
  assert.throws(() => createTask(root, 'another task'), /One task/);
});
test('large review is rejected instead of silently losing changes', t => {
  const { root } = fixture(t); const task = createTask(root, 'large change');
  writeFileSync(join(root, 'app.txt'), 'x'.repeat(100001));
  assert.throws(() => reviewPacket(root, task), /100 KB/);
});
test('provider arguments preserve approval path and remove reviewer tools', () => {
  const args = buildArgs({ goal: 'literal $(do-not-execute)' });
  assert.equal(args[3], 'on-request'); assert.ok(!args.includes('--yolo'));
  const review = reviewArgs(); assert.equal(review[review.indexOf('--tools') + 1], '');
  assert.equal(review[review.indexOf('--disallowedTools') + 1], 'mcp__*');
});

// Fake provider executables placed first on PATH; they log what they received and spend no tokens.
const fakes = {
  codex: `fs.writeFileSync(log('codex.json'), JSON.stringify(process.argv.slice(2)));
fs.mkdirSync('src', { recursive: true }); fs.writeFileSync('src/feature.js', 'export const feature = 1;\\n');
process.exit(Number(process.env.FAKE_CODEX_EXIT || 0));`,
  npm: `fs.writeFileSync(log('npm.json'), JSON.stringify(process.argv.slice(2)));
if (process.env.FAKE_NPM_TOUCH) fs.writeFileSync(process.env.FAKE_NPM_TOUCH, 'written by tests\\n');
process.stdout.write(process.env.FAKE_NPM_BYTES ? 'y'.repeat(Number(process.env.FAKE_NPM_BYTES)) : 'tests ok: 3 passed\\n');
process.exit(Number(process.env.FAKE_NPM_EXIT || 0));`,
  claude: `fs.writeFileSync(log('claude.json'), JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(log('claude-input.txt'), fs.readFileSync(0, 'utf8'));
const mode = process.env.FAKE_CLAUDE;
if (mode === 'exit1') { console.error('authentication expired'); process.exit(1); }
if (mode === 'badjson') { console.log('not json'); process.exit(0); }
console.log(JSON.stringify({ is_error: mode === 'is_error', result: 'Findings: one possible bug.', usage: null }));`,
};
function runHarness(t, { env = {}, answer = true, omit = [], packageJson = { scripts: { test: 'node --test' } }, beforeAnswer = () => {} } = {}) {
  const { root, git } = fixture(t);
  if (packageJson) { writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson)); git('add', '.'); git('commit', '-m', 'Add package'); }
  const base = createTask(root, 'Add feature; test it').base;
  const dir = tempDir(t, 'relay-fakes-');
  const bin = join(dir, 'bin'), logs = join(dir, 'logs'); mkdirSync(bin); mkdirSync(logs);
  for (const [name, body] of Object.entries(fakes)) if (!omit.includes(name)) {
    writeFileSync(join(bin, name), `#!/usr/bin/env node\nconst fs = require('fs'), log = f => require('path').join(process.env.FAKE_LOG, f);\n${body}\n`, { mode: 0o755 });
  }
  const prompts = [];
  const deps = {
    env: { PATH: `${bin}${delimiter}${process.env.PATH}`, HOME: process.env.HOME, FAKE_LOG: logs, ...env },
    isTTY: true, output: { write() {} },
    confirm: async question => { prompts.push(question); beforeAnswer(root); return answer; },
  };
  const read = name => readFileSync(join(logs, name), 'utf8');
  const logged = name => existsSync(join(logs, name));
  const state = () => JSON.parse(readFileSync(join(root, '.relay', 'state.json'), 'utf8')).task;
  return { root, git, base, prompts, read, logged, state, run: () => main(['run'], root, deps) };
}
test('run builds, tests with consent, and sends unstaged new files and evidence to review', async t => {
  const h = runHarness(t);
  await h.run();
  assert.deepEqual(JSON.parse(h.read('codex.json')).slice(0, 4), buildArgs({ goal: '' }).slice(0, 4));
  assert.deepEqual(JSON.parse(h.read('npm.json')), ['test']);
  assert.deepEqual(JSON.parse(h.read('claude.json')), reviewArgs());
  assert.equal(h.prompts.length, 1); assert.match(h.prompts[0], /npm test/);
  const packet = h.read('claude-input.txt');
  assert.match(packet, /export const feature = 1/); assert.match(packet, /src\/feature\.js/);
  assert.match(packet, /Node: v\d+/); assert.match(packet, /Exit code: 0/); assert.match(packet, /tests ok: 3 passed/);
  assert.equal(h.git('diff', '--cached', '--name-only').toString(), '');
  assert.equal(h.git('rev-parse', 'HEAD').toString().trim(), h.base);
  const task = h.state();
  assert.equal(task.status, 'needs_human_decision');
  assert.deepEqual(task.run.steps.map(s => s.step), ['started', 'built', 'testing', 'tests_recorded', 'reviewed']);
  assert.equal(task.run.tests.diffHash, task.reviewHash);
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
  await assert.rejects(main(['run'], h.root, { env: { PATH: '/nonexistent' }, isTTY: true, confirm: async () => true, output: { write() {} } }), /codex not found on PATH/);
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
test('run requires an interactive terminal for Codex approvals', async t => {
  const h = runHarness(t);
  await assert.rejects(main(['run'], h.root, { env: {}, isTTY: false }), /interactive terminal/);
  assert.ok(!h.logged('codex.json'));
});
