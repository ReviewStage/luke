# `@repo/host`

## Everything of the machine arrives as a seam

`hostAssemblyLayer` (`src/compose-host.ts`) is handed the state root, the
version, the environment, the account source (whose desktop implementation
brings the cipher), and the id source through the services its launch provides
(`host-kernel.ts`'s `HostKernelTag` among them), and derives none of them. Nothing here reads
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

Each concern is a composer owning its own state and timers, the Gateway methods
it answers, and the declared acts it answers directly, as a `HostActTable` of
its domain's acts (`host-acts.ts`) with no Gateway method between the window's
port and the handler. It is built as a scoped layer whose build runs its start
and whose scope closing runs its stop. Two details of that are load-bearing
and look like accidents:

- **The stop is registered before the start runs**, not as the release of a
  successful acquire, because a composer's `stop` is written to give back what a
  partial or failed `start` allocated.
- **The layers are built sequentially, never merged.** `Layer.merge` builds its
  sides concurrently and closes them in parallel; a start that fails must release
  what began, in reverse, at once.

A method two composers claim fails the build with `DuplicateGatewayMethod`
(`composer.ts`), so that one does not need stating here. `client.bootstrap` and
`shutdown` are the two methods no composer owns: `compose-host.ts` answers them
itself, because the first reads several composers and giving it to any would
hand that composer references to the others. They are folded with the
composers' tables, so a composer that claimed one fails the build the same way.

**An act two composers claim fails the build too**, with `DuplicateHostAct`:
`compose-host.ts` folds every composer's act table into the one the assembly
holds, as it folds the methods. A platform concern left out answers its acts
in its composer's place, so that is one claim, not a second. The type holds
the other half, that the fold answers every act in `HOST_ACTS`. Where a
contract's acts are split between two composers, as `TASKS_ACTS` is between
the tasks and the workspaces, the split is one list (`compose-workspaces.ts`'s
`WORKSPACES_TASKS_ACT`) that one side `Pick`s and the other `Omit`s. That list
moves only the types: each side's handlers are written under their own act
names, so moving an act means moving its handler too, since one left behind
still compiles and fails the build as a second claim.

## One domain, one composer

A new method or act goes to the composer whose domain it is, not to whichever
one already holds the client it calls: sign-in to the account; the account's
own asks (provider keys, its GitHub token, memories, a ChatGPT login, hosts
and pairing) to `compose-account-asks.ts`; workspaces, GitHub's connection, and
the admin dashboard to `compose-workspaces.ts`; tasks and agents to their own.

State two composers share crosses only as a dependency `compose-host.ts` hands
the composer it builds: the entity pool, the account, window focus, and another
composer's hook or view, such as `githubMoved`, `repositoriesMoved`, or the
tasks' view the workspaces draw on, so a composer is built after every one whose
hook it takes. The account gate reaches each composer the same way, as
`compose-host.ts` running its `open` when the gate opens and its `reset` when
it closes. An edge that is a genuine cycle goes through the composer's set-once
`link`, written in one list once every concern is built, and a reader that
awaits a link suspends until then. **A composer never reaches into another's
closure**, because that reference is the coupling the split exists to remove,
and one handed in shows in the assembly where one taken does not.

## One drain, in one place

The quit is the closing of the one scope the host layer was built in, and the
scope's finalizers are its order: drain, every composer's stop in
reverse, store closed. The drain runs once whichever door asks for it.

**A caller that ran the steps itself would be a second order for the same quit,
and there is none to run. A shutdown never fabricates a completion for work it
cut off.**

## One door that exists for the graph

`account-preferences-client.ts` would belong beside the task client in
`@repo/features`, but the snapshot it carries is `@repo/settings` vocabulary
and `settings` already reaches `features`. This is the lowest package holding both.

## The doors a browser loads

`@repo/host/acts` and `@repo/host/app-state` are the desktop's
renderer-and-main vocabulary, kept here because this is the lowest package that
reaches every package they name, and `@repo/host/bridge` is the window's bridge
contract built from the app state, which the preload builds its bridge from and
the web bridge does too; `@repo/host/contract` is the act port's oRPC contract that the
window's client is typed by. The panel reads these four, and `@repo/host/act-port`
beside them.

The web app (`apps/web/src/app/web-host.ts`) runs the host itself in the tab,
so it also loads the barrel, `@repo/host/effect`, `@repo/host/client`,
`@repo/host/service-layer`, and `@repo/host/agent-notices`. Every door named
here, and everything it imports, stays free of Node.
