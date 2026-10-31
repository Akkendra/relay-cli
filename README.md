# Relay

Relay hands a scoped coding task to **Codex** to build and to **Claude** to review independently, using the official CLIs you're already signed in to. A person always makes the final call. It also includes a local **usage dashboard** for your Codex and Claude Code sessions.

It's a prototype. Relay has no runtime dependencies, API clients, stored credentials, or telemetry.

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Commands](#commands)
- [How `relay run` works](#how-relay-run-works)
- [Usage dashboard](#usage-dashboard)
- [Safety model](#safety-model)
- [Development](#development)
- [Limitations](#limitations)

## Requirements

- macOS (tested) with **Node.js 22+** and **git**.
- The `codex` and `claude` CLIs on your `PATH`, each signed in with your own subscription. Check this with `codex login status` and `claude auth status`. Having the desktop apps installed may not put the CLIs on your `PATH`.

Relay never reads credential files. It refuses to run if API-key or proxy overrides are set (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`), and it never prints their values.

## Quick start

```bash
git clone <this repo> relay && cd relay
npm install && npm run build:dashboard   # build tools for the dashboard only
npm test
node bin/relay.mjs doctor
```

Run `npm link` once to get a global `relay` command. That changes your global npm setup, so it's opt-in; otherwise use `node /path/to/relay/bin/relay.mjs`.

Keep Relay separate from the project it works on. Try it on a throwaway repo first:

```bash
mkdir relay-demo && cd relay-demo
relay            # offers to set up local git, then opens the prompt
relay> Create formatDuration(minutes). Acceptance: 0 -> '0m', 65 -> '1h 5m'; reject negative input; include tests.
```

## Commands

| Command | What it does |
|---|---|
| `relay` | Opens the interactive prompt. Each line you type is a task; `/help` lists `/status`, `/diff`, `/undo`, `/history`, `/models`, `/ask`, `/task`, `/interactive <task>`, and `/quit`. Up-arrow recalls earlier lines and Tab completes commands. |
| `relay doctor` | Shows the Node, git, `codex`, and `claude` versions. It doesn't check sign-in. |
| `relay init` | Creates `.relay/` in the current git repo and excludes it locally through `.git/info/exclude`. |
| `relay task "<goal and acceptance criteria>"` | Records a task. Its baseline is a snapshot of the current files, so the tree needn't be clean; the earlier task moves to history. |
| `relay build` | Builds the current task in Codex's own window (`--sandbox workspace-write --ask-for-approval on-request`). |
| `relay review` | Sends the diff to Claude for an advisory review. |
| `relay run` | Same flow as typing the task at the prompt, for the current task. |
| `relay status` | Prints `.relay/state.json`. |
| `relay dashboard [--port N] [--allow-host NAME]` | Starts the local server: landing page at `http://localhost:4318`, read-only dashboard at `/dashboard`. |

## How a task runs

1. **Plan.** Relay shows the model it picked (see [Model routing](#model-routing)). Press Enter to run it, `b` for a bigger model, `s` for a smaller one, or `q` to cancel.
2. **Build.** Codex runs non-interactively (`codex exec`) and finishes on its own, streaming the commands it runs, the files it edits, and its messages. It stays in the workspace-write sandbox with no network, and with `approval_policy="never"` anything outside the sandbox is refused, never auto-approved. Use `/interactive <task>` or `relay build` when you want Codex's own window and approval prompts.
3. **Tests, with consent.** If `package.json` has a `test` script, Relay asks `Run "npm test"? [y/N]` every time. The default is no.
4. **Review.** Claude, with no tools, reviews the task's diff, the Node version, and bounded test output. The packet records the SHA-256 of the tested diff, which Relay has verified matches the reviewed one.
5. **Fix, without leaving.** Type `f` to send the review findings (or failing test output) back to the **same Codex session**, or type your own instructions. Relay then tests and reviews again, as often as you like. Follow-up reviews get only the changes since the last review, plus its findings. Press Enter when you're done. Later, `/continue <text>` picks the task up again in the same Codex session.

**Baselines.** Each task's starting point is a snapshot of the folder: a git tree written through a temporary index. Nothing is committed and your index isn't touched. Tasks run back to back in one folder, and each is reviewed on its own changes only.

**Safety checks.** If files change between the build and the review, the run stops with `changed_during_run`. Failed tests are saved to `.relay/test-failure.json` and the task is never marked done. The best status is `needs_human_decision`: Relay never infers approval and never commits, pushes, or deploys. Every step is checkpointed in `task.run.steps`.

## Model routing

Relay sizes each task so small work goes to cheaper models and complex work to bigger ones.

| Tier | Codex (build) | Claude (review) |
|---|---|---|
| small | `gpt-6-luna`, low effort | `haiku`, low effort |
| medium | `gpt-6.1-sol`, medium effort | `sonnet`, medium effort |
| large | `gpt-6-astra`, high effort | `opus`, medium effort (its default) |

- **Build tier, before Codex starts.** Relay scores the task locally, for free, from its length, the number of acceptance criteria, signal words ("refactor", "security" vs "typo", "docs"), and repo size. Only borderline scores get a second opinion from Claude Haiku, which costs about 1–2K tokens and runs with no tools. You see the plan and press Enter to run it, `b` or `s` to go one tier bigger or smaller, or `q` to cancel.
- **Review tier, after the build,** based on what actually changed: up to 60 lines in at most 3 files is small, over 600 lines or 15 files is large. Changes to auth, payments, secrets, workflows, `package.json`, or `.env*` always get the large reviewer.
- **Limits are respected.** Before each build and review, Relay reads the live limits (Codex from its app server, Claude from `relay statusline`). At 80% of either window the provider is capped at medium, and at 90% at small. The plan shows the reason, and you can still bump the build up with `b`.
- **Usage is recorded.** Each task saves its tiers, which model chose them (rules, classifier, or you), and the build's tokens, read from Codex's session log. The dashboard shows them on the task's card.
- **Model names can be overridden** in `~/.config/relay/models.json`, for example `{"codex": {"small": {"model": "gpt-6-luna", "effort": "low"}}}`. Names and effort levels are validated, so a typo can't become a CLI flag.
- **Local ports for Codex (opt-in).** Codex's sandbox blocks network by default, so a build can't start a dev server. Add `"codexNetwork": true` to `~/.config/relay/models.json` to let builds and fixes open local ports; this also allows outbound network. Read-only questions never get it.

Codex sends its own instructions with every call (about 15K mostly cached input tokens, even for a one-word reply). That fixed cost limits how much a small model can save on tiny tasks.

## Policy, tracing, and halts

While Codex runs, Relay records each command, file edit, and message in the run's trace, and checks it against a policy:

- **Flag** (recorded, the run continues): `git push`, `curl`, `wget`, `rm -rf`, `npm publish`, `sudo`, and edits to `.env*`, `.github/workflows/`, or `package.json`.
- **Block** (Relay stops Codex at once, and the task becomes `halted_by_policy`): `git push`, `npm publish`, `sudo`, `rm -rf /` or `~`, and edits to `.env*`.

Add your own patterns in `~/.config/relay/policy.json`, for example `{"block": {"paths": ["^migrations/"]}, "flag": {"commands": ["\\bdocker\\b"]}}`. Patterns are case-insensitive regular expressions and are checked when loaded. Each run records a short hash of the policy that governed it.

Relay sees actions as Codex reports them, so a blocked command may already have started; Codex's sandbox remains the hard boundary. After a halt, `/diff` shows what changed and `/undo` puts it back.

The dashboard's **Runs** feed lists every Relay run across projects: outcome, models, tokens, duration, flags, and a Build → Test → Review → Decision bar. A row opens its steps, trace, and evidence (tests and review findings).

## Usage dashboard

```bash
relay dashboard               # http://localhost:4318 (landing page) · /dashboard (dashboard)
```

A read-only page covering every Codex and Claude Code session on this machine, not just Relay runs. It reads `~/.codex/sessions` and `~/.claude/projects`, refreshes every 5 seconds (and pauses while the tab is hidden), and shows:

- the plan-limit windows Codex reports (5-hour and weekly), with reset times;
- tokens per day and per model, with or without cache reads, plus a table view;
- every session, with live ones marked;
- your **Codex account** across all devices: lifetime tokens, peak day, streaks, longest turn, and tokens per day, read through `codex app-server` (`account/usage/read`) so Codex handles sign-in. Relay asks at most once a minute, and these read-only calls spend no tokens;
- Relay tasks found in those sessions' folders: status, steps, test result, and review tokens and cost.
- your **setup** for each agent: plugins (on or off, version, and the skills, commands, agents, hooks, and MCP servers each brings), your own skills and agents, hooks, MCP server names, and memory files. Only names and counts are read, never settings values;

**What it doesn't do:**

- It reads only counts and metadata, never prompts or code.
- It never guesses plan limits. Codex's come live from its app server (with the session logs as a fallback), and Claude's from `relay statusline` (see below).
- The review cost shown is Claude's list-price estimate, not your subscription bill.
- Both log formats are undocumented, so unreadable lines are counted in the footer rather than guessed at.

**Claude plan limits.** Claude Code doesn't save its 5-hour and weekly usage to disk, but it passes them to the status line command after each response (Pro, Max, and Ultra plans). Register Relay as the status line in `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "/absolute/path/to/node /path/to/relay/bin/relay.mjs statusline" } }
```

It prints a short line, such as `Opus 5.5 · 42% session · 17% week`. It saves only those two windows and their reset times to `~/.config/relay/claude-limits.json`, never the session's paths, prompts, or IDs. The dashboard then shows Claude bars next to the Codex ones. They update only while Claude Code is running, and a window that has passed its reset time is dropped rather than shown out of date.

**Start at login (macOS).** A LaunchAgent with `RunAtLoad` and `KeepAlive` can run `node /path/to/relay/bin/relay.mjs dashboard`. Use the absolute path to your `node`. If Relay lives in `~/Desktop` or `~/Documents`, macOS asks once for folder access.

## Safety model

- **Codex** keeps its own sandbox and approval prompts. Relay asks it not to commit, push, or deploy; that's an instruction, not something Git enforces.
- **Claude reviews with no tools.** It runs as `claude --safe-mode --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools '' --disallowedTools 'mcp__*' -p --output-format json`, reading only the packet on stdin. Unsupported flags make it fail rather than quietly loosen the restrictions.
- **Your git index is never touched.** Untracked, non-ignored files enter the diff through a temporary copy of the index. Ignored files, such as `.env`, stay out. Diffs over 100 KB are rejected, never truncated.
- **Only one Relay operation runs at a time**, enforced by `.relay/lock`. After a crash, check that no provider process is still running before you delete it.
- **The dashboard server:**
  - binds to `127.0.0.1` and answers only `localhost`, `127.0.0.1`, so a malicious page can't reach it through DNS rebinding;
  - accepts only GET and sends a strict Content-Security-Policy (`script-src 'self'`, no inline scripts);
  - serves only `index.html` and `assets/`.
- **`.relay/` can contain project code** (`review-input.txt`, `review.json`, test output). Keep it local; it's in `.gitignore`.

## Development

```text
bin/relay.mjs            CLI entry point
src/relay.mjs            tasks, build/test/review orchestration, checkpoints
src/usage.mjs            Codex/Claude log parsing → usage summary (counts only)
src/dashboard.mjs        loopback HTTP server for the dashboard
dashboard/               React + Vite source for the dashboard page
test/                    node:test suites (fake providers, fake logs, no tokens spent)
```

```bash
npm test                  # all suites; providers are fake executables on PATH
npm run build:dashboard   # build dashboard/ into dist/dashboard (picked up without restarting)
npm run dev:dashboard     # live reload at http://127.0.0.1:5173, proxying /api to a running dashboard
npm run build:site        # landing page (React, GSAP + ScrollTrigger, Lenis, Inter) → served at / (the dashboard is at /dashboard)
```

Changes go through branches and pull requests, with CI on every pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

React and Vite are pinned dev dependencies used only for the build. `dist/` is gitignored, so rebuild after cloning.

## Limitations

- One task per project. No automatic repairs, no token forecasting, no provider-session resumption.
- The review sees only the diff, not unchanged files the diff depends on, and says so when it needs more context.
- Running AI tools on files sends their contents to those providers.
- Tested on macOS with codex-cli 0.166 and Claude Code 2.1. Other platforms are untested.

## License

[MIT](LICENSE). "Relay" is a working name.
