import test from 'node:test';
import assert from 'node:assert/strict';
import { fmt, metricValue, metricName, ago, until, windowName, niceMax, topRounded, statusLevel, statusText, limitLevel } from '../dashboard/src/format.js';

test('token counts are compacted for display', () => {
  assert.deepEqual([0, 999, 1234, 12345, 7568776, 2.5e9].map(fmt), ['0', '999', '1.2K', '12K', '7.6M', '2.5B']);
});
test('metrics select all tokens, tokens without cache reads, or output only', () => {
  const t = { total: 1000, cacheRead: 700, output: 50 };
  assert.equal(metricValue(t, 'all'), 1000); assert.equal(metricValue(t, 'nocache'), 300); assert.equal(metricValue(t, 'output'), 50);
  assert.equal(metricValue(undefined, 'all'), 0); assert.equal(metricName('bogus'), 'without cache reads');
});
test('relative times and limit reset countdowns', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.equal(ago(null, now), '—'); assert.equal(ago('2026-10-30T11:59:30Z', now), 'just now');
  assert.equal(ago('2026-10-30T11:45:00Z', now), '15m ago'); assert.equal(ago('2026-10-30T09:00:00Z', now), '3h ago');
  assert.equal(until('2026-10-30T14:50:00Z', now), 'resets in 2h 50m'); assert.equal(until('2026-11-03T23:00:00Z', now), 'resets in 4d 11h');
  assert.equal(until('2026-10-30T11:00:00Z', now), 'Window reset');
  assert.equal(windowName(300), '5-hour window'); assert.equal(windowName(10080), 'Weekly window'); assert.equal(windowName(120), '2-hour window');
});
test('chart scale and bar geometry', () => {
  assert.deepEqual([0, 0.4, 1, 1.5, 3, 7, 382980].map(niceMax), [1, 0.5, 1, 2, 5, 10, 500000]);
  assert.equal(topRounded(0, 0, 20, 100, 4), 'M0,100V4Q0,0 4,0H16Q20,0 20,4V100Z');
  assert.match(topRounded(0, 0, 20, 2, 4), /V2Q0,0 2,0/, 'radius never exceeds the bar height');
});
test('Relay and limit statuses map to labelled levels', () => {
  assert.equal(statusLevel('needs_human_decision'), 'good'); assert.equal(statusText('changed_during_run'), 'Changed during run');
  assert.equal(statusLevel('something_new'), 'idle'); assert.equal(statusText('something_new'), 'something_new');
  assert.deepEqual([20, 70, 95].map(limitLevel), ['', 'warning', 'critical']);
});
test('saved layouts keep their order and sizes, add new tiles, and drop unknown ones', async () => {
  const { mergeLayout, moveTo } = await import('../dashboard/src/format.js');
  const defaults = [{ id: 'a', size: 's' }, { id: 'b', size: 'l' }, { id: 'c', size: 'm' }];
  assert.deepEqual(mergeLayout([{ id: 'c', size: 'l' }, { id: 'x', size: 's' }, { id: 'a', size: 'huge' }], defaults), [{ id: 'c', size: 'l' }, { id: 'b', size: 'l' }, { id: 'a', size: 's' }], 'b was added later, so it goes back to its default slot');
  assert.deepEqual(mergeLayout('garbage', defaults), defaults);
  assert.deepEqual(moveTo(defaults, 0, 2).map(w => w.id), ['b', 'c', 'a']); assert.equal(moveTo(defaults, 0, 5), defaults);
});
test('sessions of the same agent and project fold into one summary row', async () => {
  const { groupSessions } = await import('../dashboard/src/format.js');
  const s = (provider, project, lastAt, total, live = false) => ({ provider, project, lastAt, live, models: [`${provider}-m`], costUSD: 1, tokens: { input: total, cacheRead: 0, cacheWrite: 0, output: 0, total } });
  const groups = groupSessions([s('claude', '~/a', '2026-10-30', 10), s('claude', '~/a', '2026-10-31', 5, true), s('codex', '~/a', '2026-10-29', 7)]);
  assert.deepEqual(groups.map(g => [g.provider, g.sessions.length, g.tokens.total, g.live, g.lastAt, g.costUSD]), [['claude', 2, 15, true, '2026-10-31', 2], ['codex', 1, 7, false, '2026-10-29', 1]]);
});
test('project names are the last folder of the path', async () => {
  const { projectName } = await import('../dashboard/src/format.js');
  assert.deepEqual(['~/Desktop/relay-demo', '/private/tmp/x/', '~', null].map(projectName), ['relay-demo', 'x', '~', '—']);
});
