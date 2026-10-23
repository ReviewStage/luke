# Contributing to Luke

Luke is a macOS Electron app for working through a task out loud with a voice
agent that reads your code.

This page covers setup and points at the documents that own the rest.

## Before you write code

[AGENTS.md](AGENTS.md) is the guide for coding agents and holds the rules
reviewers hold a pull request to; read it to know what review will check, not as
a setup guide. Its Never section matters most: no credential or account secret
reaches an answer, an event, the voice window, a trace, or a fixture, and
session replay leaves the machine as layout, never text. A change that widens
what Luke may read or write, or what leaves the developer's machine, is a
product decision, so open an issue first rather than a pull request.

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

## Developing without Luke's accounts

- **On Linux**, `./scripts/bootstrap.sh` installs dependencies (it skips
  Electron's binary), and `./scripts/check.sh`, the vitest suites
  (`pnpm exec vitest run <path>`), and lint all work. CI runs on ubuntu-24.04.
  The app itself does not launch there: `run.sh` requires macOS.
- **On a Mac**, `./scripts/run.sh --fixture smoke` runs the app on fixture data
  and needs no credentials.
- **A live run** (`./scripts/run.sh` without `--fixture`) signs in to the
  production service at tryluke.dev; `--preview` signs in to a Vercel Preview
  instead.
- **Not supported yet:** self-hosting the backend (`packages/service` and
  `apps/web`).

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
says "Quit Luke Dev <name>". No development run claims the
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
  catalog/        every shared @luke/ui component on synthetic data, built and never deployed
  desktop/        the Electron app: main, preload, the renderer windows, build and release scripts
  dev/            the coding agent's eve app
  web/            the site, the Vercel function routes (server/routes/), and the deployment shell
packages/
  agent-runner/   the runner in a coding agent's sandbox: Claude Code or Codex, messages in and out
  brand/          the design sources, the generators, and the generated art, motion tokens, and geometry
  credentials/    account sign-in: PKCE, loopback consent, the account session manager
  database/       the hosted store's Drizzle schema, queries, migrations, and test databases
  features/       the hosted service's contract and clients: paths, wire, tasks and boards, product events, feedback
  gateway/        the one protocol between the renderer and the host, and the trace record of what crosses it
  host/           the desktop's Node kernel, reached only through the Gateway
  live/           the GPT Live protocol as Luke reads it
  panel/          shared React for the panel every client mounts: the desktop window and the web tab
  runtime/        Effect infrastructure: storage, timers, queues, single-flight, test support
  service/        the hosted backend's logic: agents, maintenance sweep, observability
  settings/       the app settings schema
  ui/             the design system: every component, control, and page pattern the apps draw with
  voice/          the live voice orchestrator
  wire/           the vocabulary every side speaks and the Schema tooling it is declared with
tools/
  anti-slop/      the repository's oxlint rules
  claude-code-probe/  proves Claude Code runs inside a Luke sandbox
  codex-probe/    proves Codex runs inside a Luke sandbox
  trace-export/   turns a recorded development trace into a document for a trace viewer
  voice-samples/  records the clip Settings plays for each Live voice, by hand on a Mac
scripts/          bootstrap, check, run, evidence, and release; repository-checks.sh holds the contract checks
docs/             design, tasks, style, and workflow; a plan lives on its task, never in a document here
```

Application logic lives in `packages/`; an app holds only what is specific to
its platform or deployment, so another platform can share the packages.
[AGENTS.md](AGENTS.md)'s Layout section is the rule in full, and each
package's `package.json` `description` says what it holds.

## Make the change

[docs/WORKFLOW.md](docs/WORKFLOW.md) is the step-by-step, from the scoped task
to the merge.

Keep Electron main and preload code thin, keep the renderer sandboxed, and put
platform-independent behavior in a package (see Repository layout above).

## Check your work

The canonical commands and when each one is required are the command table in
[AGENTS.md](AGENTS.md).

## Open the pull request

Open it ready for review, not as a draft, with a short summary of what changed
and why; root [AGENTS.md](AGENTS.md)'s "Merging" says how it merges.

## What happens to your PR

A maintainer reviews it. CI runs every check; the Vercel Preview on a pull
request from a fork waits for a maintainer to approve it. Once it is approved
and green, the merge queue tests it against the latest `main` and lands it.

Contributions are licensed under Apache-2.0, as section 5 of the
[LICENSE](LICENSE) provides: what you submit is under the same terms as the
project, and there is no CLA to sign.

## Reporting problems

Bugs and feature requests go in [GitHub issues](https://github.com/ReviewStage/luke/issues).
Security vulnerabilities do not. See [SECURITY.md](SECURITY.md).
