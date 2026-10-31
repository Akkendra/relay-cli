import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { relayConfigDir } from './routing.mjs';

// Claude Code runs `relay statusline` after each response and passes session JSON on stdin. Its plan-limit
// windows (the numbers /usage shows) aren't stored anywhere on disk, so Relay saves just those for the
// dashboard. Nothing else from the input is kept.

export function claudeCostsPath(env = process.env) { return join(relayConfigDir(env), 'claude-costs.json'); }
export function claudeLimitsPath(env = process.env) { return join(relayConfigDir(env), 'claude-limits.json'); }

export function extractLimits(input, now = new Date()) {
  const r = input?.rate_limits;
  const window = (w, minutes) => w && Number.isFinite(w.used_percentage)
    ? { usedPercent: w.used_percentage, windowMinutes: minutes, resetsAt: Number.isFinite(w.resets_at) ? new Date(w.resets_at * 1000).toISOString() : null }
    : null;
  const limits = { observedAt: now.toISOString(), primary: window(r?.five_hour, 300), secondary: window(r?.seven_day, 10080) };
  return limits.primary || limits.secondary ? limits : null;
}

export function statusText(input, limits) {
  const parts = [];
  if (typeof input?.model?.display_name === 'string') parts.push(input.model.display_name);
  if (limits?.primary) parts.push(`${Math.round(limits.primary.usedPercent)}% session`);
  if (limits?.secondary) parts.push(`${Math.round(limits.secondary.usedPercent)}% week`);
  if (!limits && Number.isFinite(input?.context_window?.used_percentage)) parts.push(`${Math.round(input.context_window.used_percentage)}% context`);
  return parts.join(' · ');
}

// Never throws: a failing status line would put errors in front of the user on every response.
export async function runStatusline({ stdin = process.stdin, env = process.env, now = new Date(), out = process.stdout } = {}) {
  let input = null;
  try {
    let text = '';
    for await (const chunk of stdin) { text += chunk; if (text.length > 1_000_000) break; }
    input = JSON.parse(text);
  } catch { out.write('relay'); return; }
  const limits = extractLimits(input, now);
  if (limits) {
    try {
      const file = claudeLimitsPath(env), tmp = `${file}.${randomUUID()}.tmp`;
      // Claude Code sometimes reports only the 5-hour window; keep the saved weekly one (expired windows drop in usage.mjs).
      let saved = null;
      try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch {}
      limits.primary ??= saved?.primary ?? null; limits.secondary ??= saved?.secondary ?? null;
      mkdirSync(relayConfigDir(env), { recursive: true, mode: 0o700 });
      writeFileSync(tmp, JSON.stringify(limits) + '\n', { mode: 0o600 });
      renameSync(tmp, file);
    } catch {}
  }
  // Per-session cost as Claude Code estimates it (list price), keyed by session id; the newest 500 are kept.
  if (Number.isFinite(input?.cost?.total_cost_usd) && typeof input.session_id === 'string') {
    try {
      let costs = {};
      try { costs = JSON.parse(readFileSync(claudeCostsPath(env), 'utf8')); } catch {}
      costs[input.session_id] = { usd: input.cost.total_cost_usd, at: now.toISOString() };
      const kept = Object.fromEntries(Object.entries(costs).sort((a, b) => (b[1].at > a[1].at ? 1 : -1)).slice(0, 500));
      const file = claudeCostsPath(env), tmp = `${file}.${randomUUID()}.tmp`;
      mkdirSync(relayConfigDir(env), { recursive: true, mode: 0o700 });
      writeFileSync(tmp, JSON.stringify(kept) + '\n', { mode: 0o600 });
      renameSync(tmp, file);
    } catch {}
  }
  out.write(statusText(input, limits) || 'relay');
}
