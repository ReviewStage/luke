# Contributing to Luke

Luke is a macOS-first Electron sidecar that observes coding-agent sessions.
This page covers setup, the checks a change has to pass, and the commit and pull
request conventions.

## Before you write code

Read [AGENTS.md](AGENTS.md). It holds the trust constraints every change has to
respect: Luke never writes a provider's transcripts or session state, never
injects terminal input or requests Accessibility, and never requires a provider
MCP, plugin, or wrapper to work. A change that widens what Luke may read or
write is a product decision, so open an issue first rather than a pull
request.

## Set up

Requires an Apple Silicon Mac on macOS 14 or newer, Node.js 24 or newer,
pnpm 9.15.0, and the Xcode Command Line Tools.

```sh
./scripts/bootstrap.sh   # install pinned workspace dependencies
./scripts/run.sh         # launch against live sessions
./scripts/run.sh --fixture smoke   # launch against deterministic fixture data
```

## Make the change

[docs/WORKFLOW.md](docs/WORKFLOW.md) is the step-by-step. In short: start from a
scoped issue, make the smallest change that satisfies it, use fixtures rather
than personal data or live provider state, and put regression coverage at the
cheapest layer that would have caught the bug.

Deployable products live in `apps/`, reusable logic lives in `packages/`. Keep
Electron main and preload code thin, keep the renderer sandboxed, and put
platform-independent behavior in a package.

## Check your work

```sh
./scripts/check.sh    # portable repository, type, test, and build checks
./scripts/verify.sh   # required for any macOS or UI change
```

`./scripts/verify.sh` is required for anything that touches the macOS app, an
Electron window, a native adapter, the microphone, or the desktop UI. For a UI
change, inspect the evidence it generates rather than trusting the exit code.
Biome is the executable style policy; `pnpm lint:fix` applies it.

## Open the pull request

- Commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
- PR titles read `type(scope): description`, as in `fix(voice): stop the capture on a shut lid`.
- Fill in the template's Evidence section with the commands you ran and their
  results. UI changes need a screenshot, attached through GitHub's PR editor
  rather than committed.
- When your branch falls behind, `git rebase origin/main` and force-push with
  `--force-with-lease`. Do not merge main into the branch; main squash-merges
  through a merge queue, and a conflicting branch silently stops CI.

## Reporting problems

Bugs and feature requests go in [GitHub issues](https://github.com/ReviewStage/luke/issues).
Security vulnerabilities do not. See [SECURITY.md](SECURITY.md).
