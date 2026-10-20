# `@luke/host`

## Everything of the machine arrives as a seam

`composeHost` is handed the state root, the version, the environment, the account
source (whose desktop implementation brings the cipher), and the id source, and
derives none of them. Nothing here reads
the hosting process's own profile, so a validation run on a temporary state root
is the same composition as a live one.

**A seam that would be easier to read directly — `app.getPath`, `process.cwd`,
`Date.now` at a call site — is the one thing that would make this package the
desktop's again.** Nothing enforces this; it is a line you hold by hand.

The same goes for drawing: there is no `electron`, `react`, or DOM import here,
and the two files that needed one were split at that line into
`apps/desktop/src/main/ipc/` and `apps/desktop/src/main/native/`.

Every environment override is a `Config` read of the variable's own name. The
settings store reads no environment itself — it is handed what was resolved.

## Two shapes in the composition that are easy to undo

Each concern is a composer owning its own state, timers, and Gateway methods,
built as a scoped layer whose build runs `start` and whose scope closing runs
`stop`. Two details of that are load-bearing and look like accidents:

- **The stop is registered before the start runs**, not as the release of a
  successful acquire, because a composer's `stop` is written to give back what a
  partial or failed `start` allocated.
- **The layers are built sequentially, never merged.** `Layer.merge` builds its
  sides concurrently and closes them in parallel; a start that fails must release
  what began, in reverse, at once.

A method two composers claim fails the build with `DuplicateGatewayMethod`, so
that one does not need stating here. `client.bootstrap` is the one method no
composer owns: it reads several of them, and giving it to any would hand that
composer references to the others.

## One drain, in one place

The quit is the closing of the one scope the host layer was built in, and the
scope's finalizers are its order: drain, every composer's stop in
reverse, store closed. The drain runs once whichever door asks for it.

**A caller that ran the steps itself would be a second order for the same quit,
and there is none to run. A shutdown never fabricates a completion for work it
cut off.**

## The live session is the service's exchange, held open from here

**The host reaches no brain and writes no record for a voice session.** The
exchange stands on the voice service: every spoken ask is admitted through
`acceptAsk` there, every reply is appended there over the same socket the
relay pipes, and the account's record is the service's. What this package
keeps is `LiveSessionHolder`, which creates the task call about the open
task for the peer's offer, ends it on the peer's hang-up or the
drain, and carries the peer's idle and the stop key to the service as
`session.activity` and `session.stop`, since the idle decision is made against
appends only the service made and the stop's instruction is the service's to
append. It appends nothing at all, and nothing on this side speaks unprompted:
a call is only ever opened by a press about a task. The sessions route closes a
desktop socket that sends any other frame, so a re-wired local exchange is
refused at the relay rather than heard twice.

The stop is asked for only while Luke is speaking, since the instruction the
service appends for it is standing text a silent model would read as a rule for
its next answer.

## One door that exists for the graph

`account-preferences-client.ts` would belong beside the task client in
`@luke/features`, but the snapshot it carries is `@luke/settings` vocabulary
and `settings` already reaches `features`. This is the lowest package holding both.

## The doors a browser loads

`@luke/host/acts` and `@luke/host/app-state` are the desktop's
renderer-and-main vocabulary, kept here because this is the lowest package that
reaches every package they name (`@luke/gateway` cannot, since `@luke/voice`
already depends on it), and `@luke/host/bridge` is the window's bridge contract
built from the app state, which the preload builds its bridge from and the web
bridge does too; `@luke/host/contract` is the act port's oRPC contract that the
window's client is typed by. The panel reads these four, and `@luke/host/act-port`
beside them.

The web app (`apps/web/src/app/web-host.ts`) runs the host itself in the tab,
so it also loads the barrel, `@luke/host/effect`, `@luke/host/client`,
`@luke/host/service-layer`, and `@luke/host/agent-notices`. Every door named
here, and everything it imports, stays free of Node.
