# Contributing

Relay uses **GitHub Flow**: `main` always works, and every change reaches it through a short-lived branch and a pull request.

## Workflow

1. **Start from an up-to-date `main`:**
   ```bash
   git switch main && git pull
   ```
2. **Create a branch.** Name it `<type>/<short-description>`, using one of these types:

   | Type | Use for |
   |---|---|
   | `feat/` | new features (`feat/dashboard-export`) |
   | `fix/` | bug fixes (`fix/limits-reset-time`) |
   | `refactor/` | code changes that keep behaviour the same |
   | `test/` | tests only |
   | `docs/` | documentation only |
   | `chore/` | tooling, CI, dependencies |

3. **Commit in small steps.** Write the subject in the imperative, for example "Add CSV export to dashboard".
4. **Push the branch and open a pull request:**
   ```bash
   git push -u origin <branch>
   gh pr create --fill
   ```
   Fill in the pull request template.
5. **Wait for CI to pass.** It runs the tests on Linux (Node 22 and 26) and macOS, builds the dashboard, and runs `npm audit`.
6. **Squash-merge** once CI is green and the change has been reviewed. The branch is deleted automatically.
7. **Update your local copy:**
   ```bash
   git switch main && git pull && git branch -d <branch>
   ```

One change per branch. If a branch drifts far from `main`, rebase it (`git rebase origin/main`) instead of merging `main` into it.

## Protecting `main`

GitHub Free doesn't offer branch protection for private repositories, so a git hook enforces it locally. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

The hook then refuses any push to `main`. In an emergency, `git push --no-verify` skips it. If the repository becomes public or moves to GitHub Pro, add a branch ruleset that requires the CI checks to pass before merging.

## Releases

Relay is a local tool, so there's nothing to deploy and no CD pipeline. To mark a version, tag a commit on `main`:

```bash
git switch main && git pull
git tag -a v0.2.0 -m "v0.2.0" && git push origin v0.2.0
```

## Local checks

```bash
npm ci
npm test                  # fake providers; no Codex or Claude tokens are spent
npm run build:dashboard
```
