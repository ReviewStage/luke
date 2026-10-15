# Contributing to Luke

Luke is a macOS Electron app for planning features out loud with a voice agent
that reads your code. It started as a sidecar that observes coding-agent
sessions, and that code is still here.

This page covers setup and points at the documents that own the rest.

## Before you write code

Read [AGENTS.md](AGENTS.md). Its Never section holds the rules every change has
to respect: no credential or account secret reaches an answer, an event, the
voice window, a trace, or a fixture, and session replay leaves the machine as
layout, never text. A change that widens what Luke may read or write, or what
leaves the developer's machine, is a product decision, so open an issue first
rather than a pull request.

## Set up

Requires an Apple Silicon Mac on macOS 14 or newer, Node.js 24 or newer, the
pnpm version `packageManager` in the root `package.json` pins, and the Xcode
Command Line Tools.

```sh
./scripts/bootstrap.sh   # install pinned workspace dependencies
./scripts/run.sh         # launch against live sessions
./scripts/run.sh --fixture smoke   # launch against deterministic fixture data
```

## Repository layout

```
apps/
  desktop/        the Electron app: main, preload, the renderer windows, build and release scripts
  dev/            the coding agent's eve app
  luke/           Luke, the orchestrator: the planner's eve app
  web/            the site, the Vercel function routes (server/routes/), and the deployment shell
packages/
  brand/          the design sources, the generators, and the generated art, motion tokens, and geometry
  credentials/    account sign-in: PKCE, loopback consent, the account session manager
  database/       the hosted store's Drizzle schema, queries, migrations, and test databases
  features/       the hosted service's client side: paths, wire, clients, plans and boards, product events, feedback
  gateway/        the one protocol between the renderer and the host, and the trace record of what crosses it
  host/           the desktop's Node kernel, reached only through the Gateway
  live/           the GPT Live protocol as Luke reads it
  panel/          shared React for the desktop panel: Luke's face and glyphs
  runtime/        Effect infrastructure: storage, timers, queues, single-flight, test support
  settings/       the app settings schema
  voice/          the live voice orchestrator
  wire/           the vocabulary every side speaks and the Schema tooling it is declared with
tools/
  anti-slop/      the repository's oxlint rules
  trace-export/   turns a recorded development trace into the unbox-ai viewer's document
scripts/          bootstrap, check, run, evidence, and release; repository-checks.sh holds the contract checks
docs/             design, planning, style, and workflow; proposals/ for what is not built yet
```

Application logic lives in `packages/`; an app holds only what is specific to
its platform or deployment, so another platform can share the packages.
[AGENTS.md](AGENTS.md)'s Layout section is the rule in full, and each
package's `package.json` `description` says what it holds.

## Make the change

[docs/WORKFLOW.md](docs/WORKFLOW.md) is the step-by-step, from the scoped issue
through the evidence in the pull request.

Keep Electron main and preload code thin, keep the renderer sandboxed, and put
platform-independent behavior in a package (see Repository layout above).

## Check your work

The canonical commands and when each one is required are the command table in
[AGENTS.md](AGENTS.md).

## Open the pull request

What the description has to carry is step 5 of
[docs/WORKFLOW.md](docs/WORKFLOW.md).

## Reporting problems

Bugs and feature requests go in [GitHub issues](https://github.com/ReviewStage/luke/issues).
Security vulnerabilities do not. See [SECURITY.md](SECURITY.md).
