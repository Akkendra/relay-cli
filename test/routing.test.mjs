import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scoreTask, planBuild, planReview, diffStats, loadModels, shiftTier, DEFAULT_MODELS, classifierArgs } from '../src/routing.mjs';

test('clear small and large tasks are decided by rules alone', () => {
  assert.equal(scoreTask('Fix the typo in the README heading').tier, 'small');
  const large = 'Refactor the authentication flow across the codebase to support token rotation. (1) migrate the session schema (2) keep existing logins working (3) add concurrency-safe refresh (4) update docs (5) add tests (6) benchmark performance';
  assert.equal(scoreTask(large).tier, 'large');
});
test('borderline tasks go to the classifier and fall back safely when it fails', () => {
  const goal = 'Add an export button to the reports page that downloads the visible rows as a CSV file, keeps the current filters, and shows a short confirmation message when the download starts';
  assert.equal(scoreTask(goal).borderline, true);
  const asked = planBuild(goal, { models: DEFAULT_MODELS, classify: () => ({ tier: 'large', reason: 'many parts', usage: { output_tokens: 9 }, ok: true }) });
  assert.deepEqual([asked.tier, asked.source], ['large', 'classifier']);
  const failed = planBuild(goal, { models: DEFAULT_MODELS, classify: (g, o) => ({ tier: o.fallback, reason: 'classifier unavailable; used rules', usage: null, ok: false }) });
  assert.equal(failed.source, 'rules'); assert.ok(['small', 'medium'].includes(failed.tier));
});
test('reviews are sized by the actual diff, and sensitive files get the large reviewer', () => {
  const diff = (file, n) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n${'+x\n'.repeat(n)}`;
  assert.equal(planReview(diffStats(diff('src/app.css', 20))).tier, 'small');
  assert.equal(planReview(diffStats(diff('src/app.js', 200))).tier, 'medium');
  assert.equal(planReview(diffStats(diff('src/app.js', 900))).tier, 'large');
  assert.equal(planReview(diffStats(diff('src/auth/login.js', 5))).tier, 'large');
  assert.equal(planReview(diffStats(diff('package.json', 2))).tier, 'large');
  assert.deepEqual(diffStats(diff('a.js', 3) + diff('b.js', 2)), { files: ['a.js', 'b.js'], lines: 5, sensitive: [] });
});
test('model names can be overridden in ~/.config/relay/models.json, and bad values are rejected', t => {
  const home = mkdtempSync(join(tmpdir(), 'relay-models-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  assert.deepEqual(loadModels({ HOME: home }), DEFAULT_MODELS);
  mkdirSync(join(home, '.config', 'relay'), { recursive: true });
  writeFileSync(join(home, '.config', 'relay', 'models.json'), JSON.stringify({ codex: { small: { model: 'gpt-7-mini' } } }));
  const models = loadModels({ HOME: home });
  assert.deepEqual(models.codex.small, { model: 'gpt-7-mini', effort: 'low' }); assert.deepEqual(models.claude, DEFAULT_MODELS.claude);
  writeFileSync(join(home, '.config', 'relay', 'models.json'), JSON.stringify({ claude: { large: { effort: 'ultra' } } }));
  assert.throws(() => loadModels({ HOME: home }), /Invalid model setting/);
  writeFileSync(join(home, '.config', 'relay', 'models.json'), JSON.stringify({ codex: { small: { model: '--dangerously-bypass' } } }));
  assert.throws(() => loadModels({ HOME: home }), /Invalid model setting/, 'a model name can never become a flag');
});
test('tier shifting is bounded and the classifier keeps the reviewer restrictions', () => {
  assert.deepEqual([shiftTier('small', -1), shiftTier('small', 1), shiftTier('large', 1)], ['small', 'medium', 'large']);
  const args = classifierArgs(DEFAULT_MODELS.classifier);
  assert.equal(args[args.indexOf('--tools') + 1], ''); assert.ok(args.includes('--safe-mode'));
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
});
