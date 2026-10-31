import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPolicy, checkEvent } from '../src/policy.mjs';

const cmd = command => ({ type: 'item.started', item: { type: 'command_execution', command } });
const file = path => ({ type: 'item.completed', item: { type: 'file_change', changes: [{ path, kind: 'update' }] } });

test('default policy blocks pushes, publishes, sudo, and .env edits, and flags other risky actions', t => {
  const home = mkdtempSync(join(tmpdir(), 'relay-policy-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const p = loadPolicy({ HOME: home });
  assert.equal(checkEvent(cmd('git push origin main'), p).level, 'block');
  assert.equal(checkEvent(cmd('sudo rm x'), p).level, 'block');
  assert.equal(checkEvent(cmd('rm -rf ~'), p).level, 'block');
  assert.equal(checkEvent(file('config/.env.local'), p).level, 'block');
  assert.equal(checkEvent(cmd('curl https://example.com'), p).level, 'flag');
  assert.equal(checkEvent(cmd('rm -rf dist'), p).level, 'flag');
  assert.equal(checkEvent(file('.github/workflows/ci.yml'), p).level, 'flag');
  assert.equal(checkEvent(cmd('npm test'), p), null); assert.equal(checkEvent(file('src/app.js'), p), null);
});
test('a policy file adds patterns, changes the hash, and bad patterns are rejected', t => {
  const home = mkdtempSync(join(tmpdir(), 'relay-policy-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const base = loadPolicy({ HOME: home }).hash;
  mkdirSync(join(home, '.config', 'relay'), { recursive: true });
  writeFileSync(join(home, '.config', 'relay', 'policy.json'), JSON.stringify({ block: { paths: ['^migrations/'] } }));
  const p = loadPolicy({ HOME: home });
  assert.equal(checkEvent(file('migrations/001.sql'), p).level, 'block'); assert.notEqual(p.hash, base);
  writeFileSync(join(home, '.config', 'relay', 'policy.json'), JSON.stringify({ flag: { commands: ['(unclosed'] } }));
  assert.throws(() => loadPolicy({ HOME: home }), /Invalid pattern/);
});
