import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { answerQuestion, createTask, initialize, projectRoot, readState, locked, runAll, requireSubscriptionEnvironment } from './relay.mjs';
import { loadModels } from './routing.mjs';

// `relay` with no arguments: a prompt where each line is a task. Codex runs inside it, then tests (with consent),
// the Claude review, and fixes in the same Codex session, all without leaving the prompt.

const HELP = `Type a task and press Enter. Codex builds it, Relay asks before running npm test, Claude reviews it,
and you can ask for fixes until you're done. Nothing is committed or pushed.

  /status              the current task: status, models, tokens
  /history             earlier tasks in this folder
  /models              which models each tier uses (~/.config/relay/models.json)
  /ask <question>      answer a question read-only (also automatic for lines ending in ? or starting with where/what/why/how…)
  /task <text>         run the line as a task even if it reads like a question
  /interactive <task>  run a task in Codex's own window, with its approval prompts
  /help                this help
  /quit                leave (or Ctrl-D)`;

const tilde = p => p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p;
const k = t => t ? `${Math.round(t.total / 100) / 10}K` : '—';
const oneLine = (s, n = 70) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

function describeTask(t) {
  const b = t.routing?.build, r = t.routing?.review;
  return [
    `${t.status} · ${oneLine(t.goal)}`,
    b?.model ? `  build  ${b.model} (${b.tier}, ${b.source}) · ${k(b.tokens)} tokens${t.codexRuns?.length > 1 ? ` over ${t.codexRuns.length} Codex runs` : ''}` : null,
    r?.model ? `  review ${r.model} (${r.tier})${t.usage ? ` · ${k({ total: (t.usage.input_tokens ?? 0) + (t.usage.output_tokens ?? 0) + (t.usage.cache_read_input_tokens ?? 0) + (t.usage.cache_creation_input_tokens ?? 0) })} tokens` : ''}` : null,
  ].filter(Boolean).join('\n');
}

async function findProject(cwd, deps) {
  try { return projectRoot(cwd); } catch {}
  console.log(`${tilde(cwd)} isn't a git repository. Relay uses local git to see what changed; nothing is committed or pushed.`);
  if (!await deps.confirm('Set up local git here? [y/N] ')) return null;
  const r = spawnSync('git', ['init', '-q'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.trim() || 'git init failed');
  return projectRoot(cwd);
}

export async function repl(cwd, deps) {
  const root = await findProject(cwd, deps);
  if (!root) return;
  initialize(root);
  const models = loadModels(deps.env);
  console.log(`Relay · ${tilde(root)}`);
  console.log(`Models by task size: Codex ${models.codex.small.model} / ${models.codex.medium.model} / ${models.codex.large.model} · Claude ${models.claude.small.model} / ${models.claude.medium.model} / ${models.claude.large.model}`);
  const current = readState(root).task;
  if (current) console.log(`Last task: ${describeTask(current).split('\n')[0]}`);
  console.log('Type a task, or /help.');
  for (;;) {
    const line = await deps.readLine('relay> ');
    if (line === null) { console.log('Bye.'); return; }
    const input = line.trim();
    if (!input) continue;
    const [command, ...rest] = input.split(/\s+/);
    try {
      if (command === '/quit' || command === '/exit') { console.log('Bye.'); return; }
      else if (command === '/help') console.log(HELP);
      else if (command === '/status') { const t = readState(root).task; console.log(t ? describeTask(t) : 'No task yet. Type one.'); }
      else if (command === '/history') {
        const s = readState(root), all = [...(s.history ?? []), ...(s.task ? [s.task] : [])];
        console.log(all.length ? all.map((t, i) => `${i + 1}. ${describeTask(t)}`).join('\n') : 'No tasks yet.');
      } else if (command === '/models') {
        const m = loadModels(deps.env);
        for (const tier of ['small', 'medium', 'large']) console.log(`  ${tier.padEnd(6)} Codex ${m.codex[tier].model} (${m.codex[tier].effort}) · Claude ${m.claude[tier].model} (${m.claude[tier].effort})`);
        console.log(`  classifier for borderline tasks: Claude ${m.classifier.model}`);
      } else if (command === '/interactive') {
        if (!rest.length) console.log('Usage: /interactive <task>');
        else await runTask(root, rest.join(' '), deps, 'interactive');
      } else if (command === '/ask' || command === '/task') {
        if (!rest.length) console.log(`Usage: ${command} <text>`);
        else if (command === '/ask') await ask(root, rest.join(' '), deps);
        else await runTask(root, rest.join(' '), deps, 'exec');
      } else if (command.startsWith('/')) console.log(`Unknown command ${command}. Type /help.`);
      else if (isQuestion(input)) await ask(root, input, deps);
      else await runTask(root, input, deps, 'exec');
    } catch (e) {
      console.log(`✖ ${e.message}`);
    }
  }
}

export const isQuestion = text => /\?\s*$/.test(text) || /^(where|what|why|how|which|who|when|explain|is there|are there|does|do i|can i)\b/i.test(text);
async function ask(root, question, deps) {
  requireSubscriptionEnvironment(deps.env);
  await locked(root, () => answerQuestion(root, question, deps));
}
async function runTask(root, goal, deps, mode) {
  requireSubscriptionEnvironment(deps.env);
  await locked(root, async () => {
    createTask(root, goal);
    await runAll(root, readState(root), deps, { mode });
  });
}
