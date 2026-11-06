# Contributing to Vespin

Vespin is an inbox for all your coding agents.

This page covers how to set up the repository, run the app and the checks, and
open a pull request. It points at the documents that own the rest.

## Before you write code

[AGENTS.md](AGENTS.md) is the guide for coding agents working in this
repository. It lists the rules a pull request is reviewed against; read it to
know what review will check. It is not a setup guide. Its Never section matters
most: a credential or account secret never goes into a response the app sends
to its window, an analytics event, a trace, or a test fixture, and session
replay records the layout of the screen, never its text. A change that widens
what Vespin may read or write, or what leaves the developer's machine, is a
product decision, so open an issue first rather than a pull request.

## Set up

To run the app, you need an Apple silicon Mac on macOS 14 or newer and the
Xcode Command Line Tools.

To run the checks, you need Linux or macOS, Node.js 24 or newer, and the pnpm
version that `packageManager` in the root `package.json` pins. `corepack enable`
installs that pnpm.

```sh
./scripts/bootstrap.sh   # install pinned workspace dependencies
./scripts/run.sh         # launch against live sessions
./scripts/run.sh --fixture smoke   # launch against deterministic fixture data
./scripts/run.sh --instance second # launch a named instance beside the running one
./scripts/run.sh --keep-running    # launch without quitting the running instance
./scripts/run.sh --preview         # launch against this branch's Vercel Preview, as its own instance
```

A plain `./scripts/run.sh` quits any running Vespin first: a development build,
a test build, and the installed release (`scripts/lib/workspace.sh`). Pass
`--instance <name>` to leave the plain instance running, or `--keep-running` to
leave every running instance as it is; the new launch then quits at startup
and only brings the running panel forward. `--preview` needs a Vercel Preview
that a maintainer has approved.

## Developing without Vespin's accounts

- **On Linux**, `./scripts/bootstrap.sh` installs dependencies (it skips
  Electron's binary), and `./scripts/check.sh`, the vitest suites
  (`pnpm exec vitest run <path>`), and lint all work. CI runs on ubuntu-24.04.
  The app itself does not launch there: `run.sh` requires macOS.
- **On a Mac**, `./scripts/run.sh --fixture smoke` runs the app on fixture data
  and needs no credentials.
- **A live run** (`./scripts/run.sh` without `--fixture`) signs in to the
  production service at vespin.dev; `--preview` signs in to a Vercel Preview
  instead.
- **Not supported yet:** self-hosting the backend (`packages/service` and
  `apps/web`).

### Running more than one Vespin Dev

A plain `./scripts/run.sh` is the plain development instance, "Vespin Dev", and
replaces its own earlier run, a running test build, and the installed release.
`--instance <name>` (lower-case letters, digits, and single hyphens) launches
"Vespin Dev <name>" beside it, replacing only that instance's earlier run. A
`--preview` run with no `--instance` gets one named for its Preview:
`preview-<branch>` for the Preview the script looks up, `preview-<host>` for an
address you give it. Each Preview then keeps its own sign-in and never touches
the plain instance's.

Each instance has its own profile under `~/Library/Application Support/Vespin Dev
<name>/` (sign-in, settings, window place, single-instance lock) and its own
`Vespin Dev <name> Safe Storage` Keychain entry. Its windows' titles end in `(<name>)`, and its app menu
says "Quit Vespin Dev <name>". No development run claims the
`vespin:` links, named or not.
Agents can run commands on your Mac. When an agent sends one, the first
signed-in instance of your account to read it runs it, and no other instance
does. Every instance runs it in the same login shell. In an instance that should
not take commands, set Settings › This Mac › "Let agents run commands on this
Mac" to Never. A Preview instance is signed in to the Preview's own database, so
it takes only that Preview's commands.

A named instance signs in on its own: sign in from its panel as on a first
launch. To start one over, quit it and delete its profile folder; to forget it
for good, also delete its Keychain entry in Keychain Access.

Two instances launched from one checkout share one build, in `apps/desktop/dist`.
A second launch rebuilds it while the first is running. The first instance
loads the new build only when it opens or reloads a window.

## Repository layout

```
apps/
  catalog/        every shared @repo/ui component on synthetic data, built and never deployed
  desktop/        the Electron app: main, preload, the renderer windows, build and release scripts
  host/           @repo/host-daemon, the `vespin-host` daemon that runs on a user's own machine; released as host-v* tags
  web/            the site, the web app, the Vercel function routes (server/routes/), and the deployment shell
packages/
  agent-runner/   the runner in a coding agent's sandbox: Claude Code or Codex, messages in and out
  brand/          the design sources, the generators, and the generated art, motion tokens, and geometry
  credentials/    account sign-in: PKCE, loopback consent, the account session manager
  database/       the hosted store's Drizzle schema, queries, migrations, and test databases
  features/       the hosted service's contract and clients: paths, wire, tasks, product events, feedback
  gateway/        the one protocol between the renderer and the host
  host/           the Node kernel the desktop app and the host daemon run on; the desktop reaches it only through the Gateway
  panel/          shared React for the panel every client mounts: the desktop window and the web tab
  runtime/        Effect infrastructure: storage, timers, queues, single-flight, test support
  service/        the hosted backend's logic: agents, maintenance sweep, observability
  settings/       the app settings schema
  ui/             the design system: every component, control, and page pattern the apps draw with
  wire/           the vocabulary every side speaks and the Schema tooling it is declared with
tools/
  anti-slop/      the repository's oxlint rules
  claude-code-probe/  proves Claude Code runs inside a Vespin sandbox
  demo-postgres/  a throwaway Postgres for the local demo
  polish/         screenshots every scene of the app, in both themes and three widths, for a design review
scripts/          bootstrap, check, run, evidence, and release; repository-checks.sh holds the contract checks
docs/             design, tasks, and style; a description lives on its task, never in a document here
```

Application logic lives in `packages/`; an app holds only what is specific to
its platform or deployment, so another platform can share the packages.
[AGENTS.md](AGENTS.md)'s Layout section is the rule in full, and each
package's `package.json` `description` says what it holds.

## Make the change

Before you edit, read what the task rules out and what it must not touch, and
make the smallest change that does the job. Test it as the Testing section of
[AGENTS.md](AGENTS.md) says, with deterministic fixtures rather than personal
data or live provider state.

Keep Electron main and preload code thin, keep the renderer sandboxed, and put
platform-independent behavior in a package (see Repository layout above).

If the work needs access, credentials, hardware, or a product decision you do
not have, stop and say so in the issue or the pull request.

## Check your work

The command table in [AGENTS.md](AGENTS.md) lists each command and when to run
it. Running the tests you touched, or `pnpm check:affected`, before you push is
optional, because CI runs every check; `./scripts/check.sh` is the full local
run. CI runs on Linux only, so a green pull request says nothing about the Mac.

## Open the pull request

Open it ready for review, not as a draft, with a short summary of what changed
and why, and say which tests you ran and which you left to CI. The "Merging"
section of [AGENTS.md](AGENTS.md) says how it merges.

## What happens to your PR

A maintainer reviews it. CI runs every check; the Vercel Preview on a pull
request from a fork waits for a maintainer to approve it. Once it is approved
and green, the merge queue tests it against the latest `main` and lands it.

Contributions are licensed under Apache-2.0, as section 5 of the
[LICENSE](LICENSE) provides: what you submit is under the same terms as the
project, and there is no CLA to sign.

## Reporting problems

Bugs and feature requests go in [GitHub issues](https://github.com/ReviewStage/vespin/issues).
Security vulnerabilities do not. See [SECURITY.md](SECURITY.md).
