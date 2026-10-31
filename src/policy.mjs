import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { relayConfigDir } from './routing.mjs';

// What Relay watches for while Codex runs. "flag" marks an action in the run's trace; "block" also stops Codex.
// Codex's sandbox stays the hard boundary: Relay sees actions as Codex reports them, so a blocked command may
// already have started when Codex is stopped.
export const DEFAULT_POLICY = {
  flag: {
    commands: ['\\bgit\\s+push\\b', '\\bcurl\\b', '\\bwget\\b', '\\brm\\s+-[a-z]*r[a-z]*f?\\b', '\\bnpm\\s+publish\\b', '\\bsudo\\b'],
    paths: ['(^|/)\\.env(\\..*)?$', '^\\.github/workflows/', '(^|/)package(-lock)?\\.json$'],
  },
  block: {
    commands: ['\\bgit\\s+push\\b', '\\bnpm\\s+publish\\b', '\\bsudo\\b', '\\brm\\s+-[a-z]*r[a-z]*\\s+(/|~)(\\s|$)'],
    paths: ['(^|/)\\.env(\\..*)?$'],
  },
};

export function policyPath(env = process.env) { return join(relayConfigDir(env), 'policy.json'); }
// The user's file adds to the defaults; every pattern must compile.
export function loadPolicy(env = process.env) {
  let custom = {};
  try { custom = JSON.parse(readFileSync(policyPath(env), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error(`Invalid ${policyPath(env)}: ${e.message}`); }
  const merged = {};
  for (const level of ['flag', 'block']) {
    merged[level] = {};
    for (const kind of ['commands', 'paths']) {
      const extra = custom[level]?.[kind] ?? [];
      if (!Array.isArray(extra) || !extra.every(p => typeof p === 'string')) throw new Error(`Invalid ${policyPath(env)}: ${level}.${kind} must be a list of patterns`);
      merged[level][kind] = [...new Set([...DEFAULT_POLICY[level][kind], ...extra])];
      for (const p of merged[level][kind]) { try { new RegExp(p, 'i'); } catch { throw new Error(`Invalid pattern in ${policyPath(env)}: ${p}`); } }
    }
  }
  return { rules: merged, hash: createHash('sha256').update(JSON.stringify(merged)).digest('hex').slice(0, 12) };
}

// The strongest match for one Codex event, or null.
export function checkEvent(e, policy) {
  const item = e?.item ?? {};
  const targets = e?.type === 'item.started' && item.type === 'command_execution' ? [['commands', String(item.command ?? '')]]
    : e?.type === 'item.completed' && item.type === 'file_change' ? (item.changes ?? []).map(c => ['paths', String(c.path ?? '')]) : [];
  for (const level of ['block', 'flag']) {
    for (const [kind, target] of targets) {
      const rule = policy.rules[level][kind].find(p => new RegExp(p, 'i').test(target));
      if (rule) return { level, kind, rule, target: target.slice(0, 200) };
    }
  }
  return null;
}
