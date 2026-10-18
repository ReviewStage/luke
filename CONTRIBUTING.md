# Contributing to Luke

Luke is a macOS Electron app for working through a task out loud with a voice
agent that reads your code. It started as a sidecar that observes coding-agent
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
./scripts/run.sh --instance second # launch a named instance beside the running one
./scripts/run.sh --preview         # launch against this branch's Vercel Preview, as its own instance
```

### Running more than one Luke Dev

A plain `./scripts/run.sh` is the plain development instance, "Luke Dev", and
replaces its own earlier run (and a running test or release build). `--instance
<name>` (lower-case letters, digits, and single hyphens) launches "Luke Dev
<name>" beside it, replacing only that instance's earlier run. A `--preview` run
is a named instance without asking: `preview-<branch>` for the Preview the script
looks up, `preview-<host>` for an address given by hand, so each Preview keeps a
sign-in of its own and never touches the plain instance's.

Each instance has its own profile under `~/Library/Application Support/Luke Dev
<name>/` (sign-in, settings, window place, single-instance lock), its own
`Luke Dev <name> Safe Storage` Keychain entry, and its own trace folder,
`.build/traces/<name>/`. Its windows' titles end in `(<name>)`, and its app menu
says "Quit Luke Dev <name>". The system-wide talk and stop keys are held by
one Luke only, so a named instance leaves them to the plain one and registers
none (a call starts from the panel instead). No development run claims the
`tryluke:` links, named or not.
Agents' commands for this Mac go to whichever signed-in instance of the account
reads them first, once each, and every instance runs them in the same login
shell; turn "Let agents run commands" off in an instance that should not take
them. A Preview instance is signed in to the Preview's own database, so it
takes only that Preview's commands.

A named instance signs in on its own: sign in from its panel as on a first
launch. To start one over, quit it and delete its profile folder; to forget it
for good, also delete its Keychain entry in Keychain Access.

Two instances launched from one checkout share its build: a second launch
rebuilds `apps/desktop/dist` under the first, which a running instance reads
again only when it opens or reloads a window.

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
  features/       the hosted service's client side: paths, wire, clients, tasks and boards, product events, feedback
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
docs/             design, tasks, style, and workflow; proposals/ for what is not built yet
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
