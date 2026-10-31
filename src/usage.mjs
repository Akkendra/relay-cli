import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Reads local Codex and Claude Code session logs. Only counts and metadata are extracted; message content is never
// returned. Both formats are undocumented and may change, so unknown or malformed lines are counted, never fatal.

const cache = new Map();
function jsonlFiles(dir, depth = 3) {
  if (depth < 0 || !existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsonlFiles(path, depth - 1));
    else if (entry.name.endsWith('.jsonl')) out.push(path);
  }
  return out;
}
// Parsing is cached per file and redone only when its size or mtime changes, so live sessions refresh cheaply.
function parseCached(path, parse) {
  const { size, mtimeMs } = statSync(path);
  const hit = cache.get(path);
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.value;
  const lines = [];
  let skipped = 0;
  for (const text of readFileSync(path, 'utf8').split('\n')) {
    if (!text.trim()) continue;
    try { lines.push(JSON.parse(text)); } catch { skipped++; }
  }
  const value = parse(lines, path);
  value.skippedLines += skipped;
  cache.set(path, { size, mtimeMs, value });
  return value;
}
const n = v => Number.isFinite(v) ? v : 0;
function emptyTokens() { return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 }; }
function addTokens(into, t) { for (const k of Object.keys(into)) into[k] += t[k]; return into; }
function tokens(input, cacheRead, cacheWrite, output, reasoning) {
  return { input, cacheRead, cacheWrite, output, reasoning, total: input + cacheRead + cacheWrite + output };
}
function localDate(iso) { return new Date(iso).toLocaleDateString('en-CA'); }
const localHour = iso => { const d = new Date(iso); return `${localDate(d)}T${String(d.getHours()).padStart(2, '0')}`; };
// Sessions keep per-day and per-model totals instead of raw events, so a poll merges small maps.
function newSession(provider, path) {
  return { provider, path, id: null, cwd: null, startedAt: null, lastAt: null, models: [], tokens: emptyTokens(), byDay: {}, byHour: {}, byModel: {}, limits: null, skippedLines: 0 };
}
function record(s, at, model, t) {
  if (at) { addTokens(s.byDay[localDate(at)] ??= emptyTokens(), t); s.byHour[localHour(at)] = (s.byHour[localHour(at)] ?? 0) + t.total; }
  addTokens(s.byModel[model] ??= emptyTokens(), t);
}

// Codex totals are cumulative per session; each token_count event contributes its delta at its own timestamp.
// OpenAI counts cached tokens inside input_tokens, so uncached input is input - cached.
export function codexUsageTokens(u) { return codexTokens(u); }
function codexTokens(u) {
  const cached = n(u.cached_input_tokens);
  return tokens(Math.max(0, n(u.input_tokens) - cached), cached, n(u.cache_write_input_tokens), n(u.output_tokens), n(u.reasoning_output_tokens));
}
function claudeTokens(u) {
  return tokens(n(u.input_tokens), n(u.cache_read_input_tokens), n(u.cache_creation_input_tokens), n(u.output_tokens), n(u.output_tokens_details?.thinking_tokens));
}
export function parseCodexSession(lines, path) {
  const s = newSession('codex', path);
  for (const l of lines) {
    const p = l?.payload;
    if (l?.timestamp && (!s.lastAt || l.timestamp > s.lastAt)) s.lastAt = l.timestamp;
    if (l?.type === 'session_meta' && p) { s.id = p.id ?? p.session_id ?? null; s.cwd = p.cwd ?? null; s.startedAt = p.timestamp ?? l.timestamp ?? null; }
    else if (l?.type === 'turn_context' && typeof p?.model === 'string' && !s.models.includes(p.model)) s.models.push(p.model);
    else if (l?.type === 'event_msg' && p?.type === 'token_count') {
      if (p.info?.total_token_usage) {
        const total = codexTokens(p.info.total_token_usage), delta = emptyTokens();
        for (const k of Object.keys(delta)) delta[k] = Math.max(0, total[k] - s.tokens[k]);
        if (delta.total) record(s, l.timestamp, s.models.at(-1) ?? 'unknown', delta);
        s.tokens = total;
      }
      if (p.rate_limits) s.limits = { observedAt: l.timestamp, ...codexLimits(p.rate_limits) };
    }
  }
  return s;
}
function codexLimits(r) {
  const window = w => w && Number.isFinite(w.used_percent)
    ? { usedPercent: w.used_percent, windowMinutes: w.window_minutes ?? null, resetsAt: Number.isFinite(w.resets_at) ? new Date(w.resets_at * 1000).toISOString() : null }
    : null;
  return { planType: typeof r.plan_type === 'string' ? r.plan_type : null, primary: window(r.primary), secondary: window(r.secondary) };
}

// Claude Code writes one line per content block, repeating the message's usage; keep one entry per message id.
export function parseClaudeSession(lines, path) {
  const s = newSession('claude', path);
  const byMessage = new Map();
  for (const l of lines) {
    if (l?.timestamp) {
      if (!s.startedAt || l.timestamp < s.startedAt) s.startedAt = l.timestamp;
      if (!s.lastAt || l.timestamp > s.lastAt) s.lastAt = l.timestamp;
    }
    if (!s.id && typeof l?.sessionId === 'string') s.id = l.sessionId;
    if (!s.cwd && typeof l?.cwd === 'string') s.cwd = l.cwd;
    const m = l?.type === 'assistant' ? l.message : null;
    if (!m?.usage || typeof m.model !== 'string' || m.model.startsWith('<')) continue;
    byMessage.set(m.id ?? l.requestId ?? l.uuid, { at: l.timestamp, model: m.model, tokens: claudeTokens(m.usage) });
  }
  for (const e of byMessage.values()) {
    addTokens(s.tokens, e.tokens); record(s, e.at, e.model, e.tokens);
    if (!s.models.includes(e.model)) s.models.push(e.model);
  }
  return s;
}

// The newest Codex session started in `cwd` since `since`, for per-task token accounting after an interactive build.
export function findCodexSession({ home, cwd, since }) {
  let best = null;
  for (const file of jsonlFiles(join(home, '.codex', 'sessions'))) {
    let s;
    try { s = parseCached(file, parseCodexSession); } catch { continue; }
    if (s.cwd === cwd && s.startedAt && s.startedAt >= since && (!best || s.startedAt > best.startedAt)) best = s;
  }
  return best && { id: best.id, tokens: best.tokens, models: best.models };
}

function findRelayRoot(cwd) {
  for (let dir = cwd, i = 0; dir && i < 6; dir = dirname(dir), i++) {
    if (existsSync(join(dir, '.relay', 'state.json'))) return dir;
    if (dirname(dir) === dir) break;
  }
  return null;
}
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
const routed = c => c && { tier: c.tier ?? null, model: c.model ?? null, effort: c.effort ?? null, source: c.source ?? null, tokens: c.tokens ?? null };
function routingSummary(r) { return r ? { build: routed(r.build), review: routed(r.review) } : null; }
// One entry per Relay run (current task and history) for the cross-project Runs feed.
function runsFor(root, state) {
  return [...(state?.history ?? []), ...(state?.task ? [state.task] : [])].filter(t => t?.run).map(t => {
    const r = t.run, last = r.steps?.at(-1)?.at ?? r.startedAt, u = t.usage;
    return {
      root, goal: String(t.goal ?? '').slice(0, 160), status: t.status, startedAt: r.startedAt, endedAt: last,
      durationSec: Math.max(0, Math.round((new Date(last) - new Date(r.startedAt)) / 1000)),
      build: t.routing?.build ? { model: t.routing.build.model, tier: t.routing.build.tier, tokens: t.routing.build.tokens?.total ?? null } : null,
      review: t.routing?.review ? { model: t.routing.review.model, tier: t.routing.review.tier, tokens: u ? (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : null } : null,
      tests: r.tests ? { ran: r.tests.ran, exitCode: r.tests.exitCode ?? null, reason: r.tests.reason ?? null } : null,
      flags: (r.flags ?? []).map(({ level, kind, target }) => ({ level, kind, target })), policyHash: r.policyHash ?? null,
      steps: (r.steps ?? []).map(({ step, at }) => ({ step, at })), trace: r.trace ?? [], findings: String(t.lastReview?.findings ?? '').slice(0, 1200),
    };
  });
}

function relayTask(root, sessions) {
  const task = readJson(join(root, '.relay', 'state.json'))?.task;
  const review = readJson(join(root, '.relay', 'review.json'));
  const tests = task?.run?.tests;
  return {
    root, status: task?.status ?? 'no_task', goal: task?.goal ?? null,
    steps: (task?.run?.steps ?? []).map(({ step, at }) => ({ step, at })),
    tests: tests ? { ran: tests.ran, exitCode: tests.exitCode ?? null, reason: tests.reason ?? null } : null,
    routing: routingSummary(task?.routing),
    review: review ? { model: Object.keys(review.modelUsage ?? {})[0] ?? null, durationMs: review.duration_ms ?? null, costUSD: review.total_cost_usd ?? null,
      tokens: review.usage ? claudeTokens(review.usage) : null } : null,
    sessions: sessions.map(s => ({ provider: s.provider, id: s.id, lastAt: s.lastAt, total: s.tokens.total, isReview: Boolean(review?.session_id) && s.id === review.session_id })),
  };
}

// Claude plan limits come from `relay statusline` (see statusline.mjs); windows past their reset time are dropped.
// Account-style totals from this Mac's session logs (Claude Code has no account-wide history to read).
function localAccount(sessions, now) {
  if (!sessions.length) return null;
  const byDay = {};
  let lifetime = 0, longest = 0;
  for (const s of sessions) {
    lifetime += s.tokens.total;
    for (const [date, t] of Object.entries(s.byDay)) byDay[date] = (byDay[date] ?? 0) + t.total;
    if (s.startedAt && s.lastAt) longest = Math.max(longest, (new Date(s.lastAt) - new Date(s.startedAt)) / 1000);
  }
  const dates = Object.keys(byDay).filter(d => byDay[d] > 0).sort(), day = 86400000;
  let run = 0, best = 0;
  dates.forEach((d, i) => { run = i && new Date(d) - new Date(dates[i - 1]) === day ? run + 1 : 1; best = Math.max(best, run); });
  const last = dates.at(-1), today = localDate(now), yesterday = localDate(new Date(now - day));
  return { observedAt: now.toISOString(), daily: dates.map(date => ({ date, tokens: byDay[date] })),
    summary: { lifetimeTokens: lifetime, peakDailyTokens: Math.max(0, ...Object.values(byDay)), longestRunningTurnSec: Math.round(longest),
      currentStreakDays: last === today || last === yesterday ? run : 0, longestStreakDays: best } };
}

export function claudeLimits(configDir, now = new Date()) {
  const saved = readJson(join(configDir, 'claude-limits.json'));
  if (!saved?.observedAt) return null;
  const live = w => w && Number.isFinite(w.usedPercent) && (!w.resetsAt || new Date(w.resetsAt) > now) ? w : null;
  const limits = { observedAt: saved.observedAt, planType: null, primary: live(saved.primary), secondary: live(saved.secondary) };
  return limits.primary || limits.secondary ? limits : null;
}

// codexAccount is the account-wide report from codex-account.mjs (or null); its limits are fresher than the session logs'.
export function summarize({ home, configDir = join(home, '.config', 'relay'), now = new Date(), days = 30, liveWindowMs = 120000, codexAccount = null }) {
  const sources = {
    codex: { dir: join(home, '.codex', 'sessions'), parse: parseCodexSession },
    claude: { dir: join(home, '.claude', 'projects'), parse: parseClaudeSession },
  };
  const sessions = [], sourceInfo = {}, seen = new Set();
  for (const [name, src] of Object.entries(sources)) {
    const files = jsonlFiles(src.dir);
    let skippedLines = 0, unreadable = 0;
    for (const file of files) {
      seen.add(file);
      try { const s = parseCached(file, src.parse); skippedLines += s.skippedLines; if (s.id || s.tokens.total) sessions.push(s); }
      catch { unreadable++; }
    }
    sourceInfo[name] = { dir: src.dir, files: files.length, skippedLines, unreadable };
  }
  for (const file of cache.keys()) if (!seen.has(file)) cache.delete(file);

  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (days - 1));
  const daily = [];
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) daily.push({ date: localDate(d), codex: emptyTokens(), claude: emptyTokens() });
  const dayIndex = new Map(daily.map(d => [d.date, d]));
  // The last 12 hours, oldest first, for the Agents sparklines.
  const hourly = Array.from({ length: 12 }, (_, i) => ({ hour: localHour(new Date(now - (11 - i) * 3600000)), codex: 0, claude: 0 }));
  const hourIndex = new Map(hourly.map(h => [h.hour, h]));
  const models = new Map(), rootOf = new Map(), byRoot = new Map();
  for (const s of sessions) {
    for (const [date, t] of Object.entries(s.byDay)) if (dayIndex.has(date)) addTokens(dayIndex.get(date)[s.provider], t);
    for (const [hour, n] of Object.entries(s.byHour ?? {})) if (hourIndex.has(hour)) hourIndex.get(hour)[s.provider] += n;
    for (const [model, t] of Object.entries(s.byModel)) {
      const key = `${s.provider}\0${model}`;
      if (!models.has(key)) models.set(key, { provider: s.provider, model, tokens: emptyTokens(), sessions: 0 });
      const m = models.get(key); addTokens(m.tokens, t); m.sessions++;
    }
    if (s.cwd && !rootOf.has(s.cwd)) rootOf.set(s.cwd, findRelayRoot(s.cwd));
    const root = s.cwd ? rootOf.get(s.cwd) : null;
    if (root) byRoot.set(root, [...(byRoot.get(root) ?? []), s]);
  }
  const claudeCosts = readJson(join(configDir, 'claude-costs.json')) ?? {}, codexCosts = codexAccount?.threadCosts ?? {};
  const costOf = s => (s.provider === 'claude' ? claudeCosts[s.id]?.usd : codexCosts[s.id]) ?? null;
  const claudeAccount = localAccount(sessions.filter(s => s.provider === 'claude'), now);
  const latestCodexLimits = sessions.filter(s => s.limits).sort((a, b) => a.limits.observedAt < b.limits.observedAt ? 1 : -1)[0]?.limits ?? null;
  const short = p => p && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  return {
    generatedAt: now.toISOString(),
    sources: Object.fromEntries(Object.entries(sourceInfo).map(([k, v]) => [k, { ...v, dir: short(v.dir) }])),
    limits: { codex: codexAccount?.limits?.primary || codexAccount?.limits?.secondary ? codexAccount.limits : latestCodexLimits, claude: claudeLimits(configDir, now) },
    claudeAccount,
    codexAccount: codexAccount && (codexAccount.error ? { error: codexAccount.error, observedAt: codexAccount.observedAt }
      : { observedAt: codexAccount.observedAt, summary: codexAccount.summary, daily: codexAccount.daily }),
    daily,
    hourly,
    models: [...models.values()].sort((a, b) => b.tokens.total - a.tokens.total),
    sessions: sessions.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '')).slice(0, 300).map(s => ({
      provider: s.provider, id: s.id, project: short(s.cwd), relayProject: Boolean(s.cwd && rootOf.get(s.cwd)), models: s.models, startedAt: s.startedAt, lastAt: s.lastAt,
      live: Boolean(s.lastAt) && now - new Date(s.lastAt) < liveWindowMs, tokens: s.tokens, costUSD: costOf(s),
    })),
    relay: [...byRoot.keys()].sort().map(root => ({ ...relayTask(root, byRoot.get(root)), root: short(root) })),
    // Newest first; only the latest 10 carry their full trace, to keep each poll small.
    runs: [...byRoot.keys()].flatMap(root => runsFor(short(root), readJson(join(root, '.relay', 'state.json'))))
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')).slice(0, 30).map((r, i) => (i < 10 ? r : { ...r, trace: [], findings: '' })),
  };
}
