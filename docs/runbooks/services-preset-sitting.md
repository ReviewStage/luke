# Runbook: the Services preset sitting

How the Vercel project `luke-web` moves from the Vite preset to the Services
preset and merges the two-service `vercel.json` (LUKE-156, PR #1018) without
leaving production on a build that serves no API. Read this at the moment it
is needed; every identifier in it is an example of a shape unless the text
says otherwise.

## What survives this sitting, and what goes with it

This file describes one migration on one project, and most of it is expected
to be deleted once the sitting is done: the preset flip, the two log facts,
the nested-layout path, the `EVE_INTERNAL` line, the `api_dir_ignored`
warning, and the four disagreement cases are all about that one event, and a
live document about a dead migration is the kind nobody feels entitled to
remove. Three parts are general to any change in how production is built and
are written down here for the first time, so they are kept when the rest goes,
under a new name or in `WORKFLOW.md`: the eight probes as a table with why
each code is the right answer and the sentence that a 404 anywhere is the
failure; the rollback anchor read as a record at the moment it is needed and
never trusted from a document, with its two commands; and the read of
production after a merge with a stall said aloud.

## Why the order is fixed

Vercel builds a project as services only when **both** the project's Framework
Preset is Services **and** `vercel.json` has a `services` key. The two states
where they disagree each break production in a different way, and both were
observed on 2026-09-11:

- Preset Services with no key: every production build of `main` fails until
  the preset is reverted. Production keeps serving the last good build.
- Key present with preset Vite: Vercel ignores the block, detects Vite, and
  deploys **successfully** without the web service's `buildCommand`, so
  `pnpm db:migrate && pnpm auth:seed` never run. A green deploy against an
  unmigrated database is worse than a failed one.

So the flip and the merge happen in one sitting, and every merge to `main`
inside the window between them fails production, recoverably.

## What the first attempt cost, and what makes it stop

The sitting was attempted on the night of 2026-09-11 and aborted. The flip
needs the merge queue to stay empty for about twenty minutes, and the PR that
carries the two-service `vercel.json` conflicts with anything that changes
routes or the shared agent guide: it touches `vercel.json` and the route table
(`server/api-rewrites.json`), and it rewrites a paragraph of
`packages/AGENTS.md`. That night it was rebased seven times, each rebase
costing a bootstrap, a full `check.sh`, a CI round, and a fresh review pair,
and each undone by the next merge to `main`. A freeze over one lane's five
workers held perfectly and was not enough, because two merges from another
lane landed in twenty-five minutes and each dirtied the PR through one of the
two paths above. **The PR can only land on a queue that is quiet across every
lane, not just the one running the sitting**, and more discipline inside one
lane does not change that. Only the person who can quiet every lane at once
can open the window, which is why the sitting is scheduled rather than
attempted: quiet the queue first, then rebase once, then flip. The rebase is
the last thing done before the flip, not the first.

Not every merge is a treadmill turn, and the two hazards in this file are
different sizes. The treadmill hazard is narrow: a merge dirties the PR only
if it touches one of three paths, `apps/web/vercel.json`, the route table
`apps/web/server/api-rewrites.json` (or anything under `apps/web/server/routes/`
that regenerates it), or `packages/AGENTS.md`. On 2026-09-12 a merge from
another lane (#1242) landed at 05:41Z, inside the window between the rebase and
the press, touched none of the three, and cost nothing: the PR stayed
mergeable and the queue's merge commit absorbed it. So a lane freeze protects
those three paths and need not stop work that cannot reach them. The
production hazard is the wide one and is bounded in time instead: between the
preset flip and the PR's merge, every merge to `main` fails its production
build whatever it touches, because the preset is Services and `main` has no
`services` key yet. Keep that window to minutes and it is a recoverable
failure; the treadmill is the one that can eat a night.

## Who does what

- **The flip is Dean's.** The Framework Preset is a dashboard setting nobody
  else can change, and it is invisible to the repository and to CI.
- **Everything after the flip is a worker's**: the redeploy, reading the log,
  the probe, the press, and reading production.
- **The press is a watcher's, not a person's.** The merge queue checks review
  threads at enqueue and not at merge, and a verdict landing while queued is
  the trap on record. The watcher is `scripts/queue-watch.sh`, tracked in the
  repository and tested against a fake `gh`, never a copy in a sandbox: it
  presses when the ruleset's required contexts pass, both Cursor bots pass,
  and no unresolved thread stands, it dequeues if a thread appears while
  queued, and it re-reads the pull request after the queue entry vanishes
  before it calls the end a merge or an eviction, because GitHub drops the
  entry before the pull request reads merged.

## The order

1. **Confirm the PR is current and green under Vite.** Head rebased onto
   `main`, `./scripts/check.sh` green after `./scripts/bootstrap.sh`, a fresh
   Bugbot and Security pair on the head, the thread list read in full. Green
   here proves nothing about services mode; it only means the sitting can
   begin.
2. **Read the rollback anchor from the record, now, not from this file.**
   See the section below.
3. **Dean flips the Framework Preset to Services.** A preset change does not
   trigger a deployment.
4. **Dean redeploys the PR's existing preview from the dashboard.** Not a new
   commit: a push would rebuild under the old detection and prove nothing. The
   redeploy's build log is the only evidence of the services shape, because
   the preview URL is behind Deployment Protection and cannot be probed from
   a sandbox.
5. **Dean reads the two log facts and the eight probes** (below) and reports
   them as they are.
6. **The worker presses within the minute** by starting the enqueue watcher
   armed (`scripts/queue-watch.sh --press <number>`). Every other merge to
   `main` in the window fails production, so the window is kept short and the
   PR merges first.
7. **The worker reads production to terminal state and probes it**, cache
   busted, with the same eight codes plus `/eve/v1/health`.

## The two log facts

Both must be present in the redeploy's build log. Their absence is the
failure, not their presence the pass.

**Fact one: the services build lists both services.** Right, the log shows a
build for `web` and a build for `eve`, each with its own install and build
commands. Wrong, the log shows one build that runs `vite build` from the
package's `build` script and mentions no service: that is the Vite detection,
and it means the preset did not take or was not saved.

**Fact two: the eve build ends at the eve service's own root.** Right:

```text
[nitro] ℹ Building server (builder: rolldown, preset: vercel, compatibility date: …)
[BUILD] built output at /vercel/path0/apps/web/eve/.vercel/output
```

The discriminator is the path ending in `apps/web/eve/.vercel/output`. Wrong,
one of:

- `built output at /vercel/path0/apps/web/.vercel/output`: eve resolved the
  directory as its nested layout with the app root one level up, so the output
  landed where the web service reads it and the eve service reads nothing.
  The flat layout of `apps/web/eve` (its own `package.json` declaring `eve`)
  is what prevents this; `apps/web/tests/eve-layout.test.ts` guards it.
- `preset: node-server` with a path ending in `.output`: the build did not run
  under Vercel's marker and produced the self-hosted server, not the Build
  Output tree.
- Any line setting `EVE_INTERNAL_BUILD_OUTPUT_DIRECTORY`: a build command from
  before the flat layout, relocating output by hand through eve's internals.
- `The api/ directory will not be built because services are configured`: this
  warning may or may not appear, and either way it is not a failure. Nothing is
  committed under `api/` any more, so there is nothing for it to protect; the
  redeploy that passed the sitting on 2026-09-12 did not print it at all, and
  the only warnings in that log were pnpm's "Ignored build scripts". It is
  listed so a reader neither aborts on seeing it nor distrusts a log without it.

## The eight probes

Signed in, against the redeployed preview, expecting exactly what production
answers today. The list is derived from what the clients request, never from
the route table or the emitted files: the desktop, the phone, the watch, and
the wire constants in `@sidecar/hosted` are the source. A list derived from
the artifacts once went green on a build that would have 404'd every voice
handshake.

| Request | Expected | Why that is the right answer |
| --- | --- | --- |
| `GET /` | 200 | The page is static and served from the tree. |
| `GET /api/brain/capabilities` | 401 | Handler present; refuses a stranger. |
| `GET /api/observation/tick` | 401 | Handler present; the cron's bearer is absent. |
| `GET /api/devices` | 405 | Handler present; the route takes other methods. |
| `GET /api/brain/ask` | 405 | Handler present; POST only. |
| `GET /api/voice/sessions` | 426 | Handler present; it upgrades WebSockets. |
| `GET /api/voice/introduction` | 426 | Handler present; it upgrades WebSockets. |
| `GET /api/feedback` | 405 | Handler present; POST only; the client's spelling. |

Plus `GET /eve/v1/health` answering a JSON body, which proves the eve service
is served and was the one fact the first sitting got right.

`apps/web/scripts/preview-probe.ts --url <address>` sends these probes to a
deployment, over the whole list the callers check derives rather than these
eight alone, and judges each answer by whose it is; it is also the read of
production after a merge.

A 401, 405, or 426 each mean the handler is there and refusing the caller.
**A 404 of Vercel's own anywhere is the failure** (the platform marks its
answers with an `x-vercel-error` header; better-auth's 404 on an unknown
sub-route carries none and is the handler answering), and it is the failure the first sitting
found: the services build was green, eve answered, and every `/api/` route was
404 because Vercel builds no `api/` in services mode. `/api/feedback.mjs` is a
second data point on the same function, not a gate code, because no client
calls it.

## The rollback anchor

Read it at the sitting, from the deployment records, because the last good
production build moves with every production deploy and an anchor written in
a runbook is stale by the time it is read:

```sh
gh api "repos/ReviewStage/luke/deployments?environment=Production&per_page=5" \
  --jq '.[] | "\(.id) \(.sha[0:8]) \(.created_at)"'
gh api "repos/ReviewStage/luke/deployments/<id>/statuses?per_page=1" \
  --jq '.[0] | "\(.state) \(.description)"'
```

The anchor is the newest record whose environment is Production and whose
state is `success` with "Deployment has completed". Write it down as id, sha,
environment, and state, in the words: for example, record `6403509155`, sha
`cd856635`, Production, success, was the anchor on 2026-09-11 at 23:31Z and
is certainly not the anchor now. A record whose state is `inactive` with
"Skipped - Not affected" is not a deploy. Rolling back is Dean's, from the
dashboard, to that record's build; a worker reports the four codes, the time,
the serving commit, and the anchor, and rolls back nothing.

## When the log and the probe disagree

- **Both facts right, a probe 404.** The services build is real and a function
  is not served. Do not press. It was the first sitting's outcome, and the fix
  was the web service's Build Output tree (#1199), not anything in the
  preset. Check that `main` at the PR's base carries `apps/web/server/build-output.ts`
  and that the log shows `emitted .vercel/output with N functions`.
- **Fact two wrong, probes right.** Eve did not build where its service reads,
  yet the API answers: the web service is fine and `/eve/v1/health` will be
  404 or a refusal. Do not press; read the eve build command against
  `services.eve` in `vercel.json` and the layout guard.
- **Both facts right, `/eve/v1/health` not JSON.** The eve service built but is
  not routed: read the top-level `rewrites` for `/eve/v1/(.*)` to the eve
  service, then eve's own log for the health route.
- **Facts absent, probes all as expected.** The redeploy ran under Vite, so
  the preview proves nothing about services. Do not press; confirm the preset
  was saved and redeploy again.

Whenever the two disagree, the probe decides whether anything serves and the
log decides why; neither alone is the gate, and no press happens on one of
them.

## After the merge

Read `main`'s production deployment record to terminal state (environment
Production, state `success`), then probe production with the eight requests
above plus `/eve/v1/health`, each with `?nocache=<nanoseconds>` and
`Cache-Control: no-cache`, expecting `x-vercel-cache: MISS` on the functions.
Report the record id, the environment in the word, and every code by name.
If production deploys have stalled, say so with the elapsed time rather than
waiting silently: a watcher that sees no record looks identical to one about
to succeed.
