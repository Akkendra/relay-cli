import { spawn } from 'node:child_process';

// Account-wide Codex usage (every device, the desktop app, cloud tasks), read through Codex's own app server
// so Codex handles authentication and Relay never touches a token. Read-only requests; they spend no tokens.

function connect(env, timeoutMs) {
  const child = spawn('codex', ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map();
  let buffer = '', next = 0, failed = null;
  const fail = error => { failed ??= error; for (const p of pending.values()) p.reject(failed); pending.clear(); };
  const timer = setTimeout(() => { fail(new Error('Codex app server did not answer in time')); child.kill(); }, timeoutMs);
  child.once('error', e => fail(new Error(e.code === 'ENOENT' ? 'codex not found on PATH' : e.message)));
  child.once('exit', () => fail(new Error('Codex app server exited')));
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const p = pending.get(message.id);
      if (!p) continue;
      pending.delete(message.id);
      if (message.error) p.reject(new Error(message.error.message ?? 'Codex app server error'));
      else p.resolve(message.result);
    }
  });
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  return {
    request(method, params = {}) {
      if (failed) return Promise.reject(failed);
      const id = next++;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); send({ method, id, params }); });
    },
    notify(method) { send({ method }); },
    close() { clearTimeout(timer); child.removeAllListeners('exit'); child.kill(); },
  };
}

const window = w => w && Number.isFinite(w.usedPercent)
  ? { usedPercent: w.usedPercent, windowMinutes: w.windowDurationMins ?? null, resetsAt: Number.isFinite(w.resetsAt) ? new Date(w.resetsAt * 1000).toISOString() : null }
  : null;
const count = v => Number.isFinite(v) ? v : null;

export function normalizeAccount(usage, limits, now = new Date()) {
  const s = usage?.summary ?? {};
  const rl = limits?.rateLimits;
  return {
    observedAt: now.toISOString(),
    summary: { lifetimeTokens: count(s.lifetimeTokens), peakDailyTokens: count(s.peakDailyTokens), longestRunningTurnSec: count(s.longestRunningTurnSec),
      currentStreakDays: count(s.currentStreakDays), longestStreakDays: count(s.longestStreakDays) },
    daily: (usage?.dailyUsageBuckets ?? []).filter(b => typeof b?.startDate === 'string' && Number.isFinite(b.tokens)).map(b => ({ date: b.startDate.slice(0, 10), tokens: b.tokens })),
    limits: rl ? { observedAt: now.toISOString(), planType: typeof rl.planType === 'string' ? rl.planType : null, primary: window(rl.primary), secondary: window(rl.secondary) } : null,
  };
}

// Never throws: the dashboard keeps working from local logs when Codex is missing, signed out, or offline.
export async function readCodexAccount({ env = process.env, timeoutMs = 15000, now = () => new Date(), threadIds = [] } = {}) {
  let conn;
  try {
    conn = connect(env, timeoutMs);
    await conn.request('initialize', { clientInfo: { name: 'relay', title: 'Relay', version: '0.1.0' } });
    conn.notify('initialized');
    const [usage, limits, ...threads] = await Promise.all([conn.request('account/usage/read'), conn.request('account/rateLimits/read').catch(() => null),
      ...threadIds.slice(0, 10).map(threadId => conn.request('account/usage/read', { threadId }).catch(() => null))]);
    const account = normalizeAccount(usage, limits, now());
    // Codex's own per-thread estimate, in micro-dollars.
    account.threadCosts = Object.fromEntries(threads.map(t => t?.threadUsage).filter(Boolean)
      .map(u => [u.threadId, (u.estimatedUsageUsdMicros ?? u.nativeUsageUsdMicros ?? null) === null ? null : (u.estimatedUsageUsdMicros ?? u.nativeUsageUsdMicros) / 1e6]));
    return account;
  } catch (e) {
    return { error: e.message, observedAt: now().toISOString() };
  } finally {
    conn?.close();
  }
}

// One Codex call per interval however many browser tabs poll; a refresh runs in the background so polls never wait.
export function accountCache({ read = readCodexAccount, intervalMs = 60000, clock = () => Date.now() } = {}) {
  let value = null, fetchedAt = -Infinity, inflight = null;
  return {
    get() {
      if (!inflight && clock() - fetchedAt >= intervalMs) {
        inflight = read().then(v => { value = v; }).finally(() => { fetchedAt = clock(); inflight = null; });
      }
      return value;
    },
    async refresh() { this.get(); await inflight; return value; },
  };
}
