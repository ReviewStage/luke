# Contributing to Luke

Luke is a macOS-first Electron sidecar that observes coding-agent sessions.
This page covers setup and points at the documents that own the rest.

## Before you write code

Read [AGENTS.md](AGENTS.md). It holds the trust constraints every change has to
respect: Luke never writes a provider's transcripts or session state, never
injects terminal input or requests Accessibility, and never requires a provider
MCP, plugin, or wrapper to work. A change that widens what Luke may read or
write is a product decision, so open an issue first rather than a pull
request.

## Set up

Requires an Apple Silicon Mac on macOS 14 or newer, Node.js 24 or newer, the
pnpm version `packageManager` in the root `package.json` pins, and the Xcode
Command Line Tools.

```sh
./scripts/bootstrap.sh   # install pinned workspace dependencies
./scripts/run.sh         # launch against live sessions
./scripts/run.sh --fixture smoke   # launch against deterministic fixture data
```

## Make the change

[docs/WORKFLOW.md](docs/WORKFLOW.md) is the step-by-step, from the scoped issue
through the evidence in the pull request.

Deployable products live in `apps/`, reusable logic lives in `packages/`. Keep
Electron main and preload code thin, keep the renderer sandboxed, and put
platform-independent behavior in a package.

## Check your work

The canonical commands and when each one is required are the command table and
the handoff invariant in [AGENTS.md](AGENTS.md).

## Open the pull request

The commit, PR title, and rebase conventions are the "Git workflow" section of
[AGENTS.md](AGENTS.md); what the description has to carry is step 5 of
[docs/WORKFLOW.md](docs/WORKFLOW.md).

## Reporting problems

Bugs and feature requests go in [GitHub issues](https://github.com/ReviewStage/luke/issues).
Security vulnerabilities do not. See [SECURITY.md](SECURITY.md).
