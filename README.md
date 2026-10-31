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

Use `node /path/to/relay/bin/relay.mjs` wherever this README says `relay`. Alternatively, run `npm link` to register a global `relay` command; that changes your global npm setup, so it's opt-in.

Keep Relay separate from the project it works on. Try it on a throwaway repo first:

```bash
mkdir relay-demo && cd relay-demo
git init && echo '# Relay demo' > README.md && git add README.md && git commit -m "Initial demo"
relay init
relay task "Create formatDuration(minutes). Acceptance: 0 -> '0m', 65 -> '1h 5m'; reject negative input; include tests."
relay run
```

## Commands

| Command | What it does |
|---|---|
| `relay doctor` | Shows the Node, git, `codex`, and `claude` versions. It doesn't check sign-in. |
| `relay init` | Creates `.relay/` in the current git repo and excludes it locally through `.git/info/exclude`. |
| `relay task "<goal and acceptance criteria>"` | Records the task and its baseline commit. The working tree must be clean, with no untracked files. One task per project. |
| `relay build` | Opens interactive Codex with `--sandbox workspace-write --ask-for-approval on-request`. |
| `relay review` | Sends the diff to Claude for an advisory review. |
| `relay run` | Runs build, then tests (only if you agree), then review, saving a checkpoint after each step. |
| `relay status` | Prints `.relay/state.json`. |
| `relay dashboard [--port N] [--allow-host NAME]` | Starts the read-only usage dashboard (default `http://localhost:4318`). |

## How `relay run` works

1. **Build.** Codex opens interactively. Relay continues once you exit, and an exit code of 0 is not taken as proof of anything.
2. **Fingerprint.** Relay records a SHA-256 of the diff. Codex can keep a detached task running after the CLI exits ("Any running work continues"). If the diff changes before the tests, during them, or before the review, the run stops with `changed_during_run`. Stop any detached task (`codex agents`) before continuing.
3. **Tests, with consent.** If `package.json` has a `test` script, Relay asks `Run "npm test"? [y/N]`. The default is no, and no flag or environment variable can answer for you.
   - If the tests fail, the run stops with `tests_failed`. The bounded output, exit code, Node version, and diff hash are saved to `.relay/test-failure.json`, and Claude is not called.
4. **Review.** Claude receives:
   - the task;
   - the Node version;
   - the test evidence: the first 4 KB and last 12 KB of output, with any omission labelled, plus the SHA-256 of the tested diff, which Relay has verified matches the reviewed one;
   - the full diff, including new untracked files.
5. **Result.** The best possible status is `needs_human_decision`. Relay never infers approval, and it never commits, pushes, or deploys.

Every step is recorded in `task.run.steps`. An interrupted run doesn't resume automatically. Finish it with `relay review`, or start again with `relay run`.

## Usage dashboard

```bash
relay dashboard               # http://localhost:4318
```

A read-only page covering every Codex and Claude Code session on this machine, not just Relay runs. It reads `~/.codex/sessions` and `~/.claude/projects`, refreshes every 5 seconds (and pauses while the tab is hidden), and shows:

- the plan-limit windows Codex reports (5-hour and weekly), with reset times;
- tokens per day and per model, with or without cache reads, plus a table view;
- every session, with live ones marked;
- Relay tasks found in those sessions' folders: status, steps, test result, and review tokens and cost.

**What it doesn't do:**

- It reads only counts and metadata, never prompts or code.
- It doesn't guess Claude's plan limits; Claude Code doesn't write them to local logs.
- The review cost shown is Claude's list-price estimate, not your subscription bill.
- Both log formats are undocumented, so unreadable lines are counted in the footer rather than guessed at.

**From your phone (Tailscale).** Keep the server on loopback and let Tailscale Serve share it with your own devices only. Use `serve`, never `funnel`; Funnel publishes to the whole internet.

```bash
tailscale serve --bg 4318
relay dashboard --allow-host <your-mac>.<tailnet>.ts.net
```

**Start at login (macOS).** A LaunchAgent with `RunAtLoad` and `KeepAlive` can run `node /path/to/relay/bin/relay.mjs dashboard [--allow-host ...]`. Use the absolute path to your `node`. If Relay lives in `~/Desktop` or `~/Documents`, macOS asks once for folder access.

## Safety model

- **Codex** keeps its own sandbox and approval prompts. Relay asks it not to commit, push, or deploy; that's an instruction, not something Git enforces.
- **Claude reviews with no tools.** It runs as `claude --safe-mode --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools '' --disallowedTools 'mcp__*' -p --output-format json`, reading only the packet on stdin. Unsupported flags make it fail rather than quietly loosen the restrictions.
- **Your git index is never touched.** Untracked, non-ignored files enter the diff through a temporary copy of the index. Ignored files, such as `.env`, stay out. Diffs over 100 KB are rejected, never truncated.
- **Only one Relay operation runs at a time**, enforced by `.relay/lock`. After a crash, check that no provider process is still running before you delete it.
- **The dashboard server:**
  - binds to `127.0.0.1` and answers only `localhost`, `127.0.0.1`, and names you pass with `--allow-host`, so a malicious page can't reach it through DNS rebinding;
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
