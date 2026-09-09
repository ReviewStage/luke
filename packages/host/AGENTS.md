# `@sidecar/host`

## Everything of the machine arrives as a seam

`composeHost` is handed the state root, the version, the environment, the
cipher, the store worker, the clock, and the id source, and derives none of
them. Nothing here reads the hosting process's own profile, so a validation
run on a temporary state root is the same composition as a live one, and a
process on the other side of a socket is too. A seam that would be easier to
read directly — `app.getPath`, `process.cwd`, `Date.now` at a call site — is
the one thing that would make this package the desktop's again.

## It draws nothing, and imports no Electron

What a window must learn leaves as a host event; what only the machine a
client runs on can do is asked of the native node by name, and answers a
typed unavailable when no node offers it. There is no `electron`, `react`, or
DOM import in this package, and the two files that needed one were split at
that line: the ipcMain registrations stayed in `apps/desktop/src/main/ipc/`,
and resolving this Mac's EventKit helper bundle stayed in
`apps/desktop/src/main/native/`.

## One composition, seven concerns

`composeHost` constructs, links, merges, and starts; it holds no state of a
concern's own. Each concern is a composer — settings, account, issues,
observation, calendars, speech, brain — that owns its own mutable state, its
own timers, and the Gateway methods of its domain, and answers `start()` and
`stop()` for exactly what it began. The merge folds their method tables into
one and refuses a method two of them claim, so which concern answers a method
is checked at construction rather than left to the fold's order.
`client.bootstrap` is the one method no composer owns: it reads six of them,
and giving it to any would hand that composer references to the other five.

The concerns depend on each other in both directions in five places — the
account's capability gate starts the loops whose owners read that gate, the
calendars hold the speech that reconciles against them — so those edges are
`link()`'s, listed once in the merge and held in a `LateRef` that throws by
name when read before `link()` has run. Everything else is a constructor
argument, in the order the composers are built.

## One drain, in one place

`Host.stop()` is the whole quit, in the coordinator's fixed order:
admissions closed, everything under way cancelled, a bounded wait for it to
settle, whatever did not settle written down as unresolved for the next
launch's recovery, and only then the store closed. A caller that ran the
steps itself would be a second order for the same quit; a shutdown never
fabricates a completion for work it cut off.

## The account preference client is here for the graph's sake

`account-preferences-client.ts` speaks two hosted routes and would otherwise
belong beside the vault client in `@sidecar/hosted`. It cannot: the snapshot
it reads and writes is `AccountPreferences`, which is `@sidecar/settings`
vocabulary, and `settings` already reaches `hosted`. This package is the
lowest one that holds both.

## The test scaffolding is behind its own door

`@sidecar/host/testing` holds the brain composition and the operator a
window's ask crosses, so nothing that ships can reach them. The three
fixtures every test in the repository shares — a temporary directory, a
stated microtask drain, a clock the test drives — are in
`@sidecar/fixtures/testing`.
