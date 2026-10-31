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
  assert.equal(until('2026-10-30T11:00:00Z', now), 'window has reset');
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
