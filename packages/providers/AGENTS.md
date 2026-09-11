## Provider identity and capabilities

`PROVIDER_IDENTITY_BY_ID` in `@sidecar/session` is deliberately narrow. It owns
only each provider's stable id, display name, order, and local/cloud location.
The README platform table is generated from that identity catalog.

The plugins this package ships are Claude Code (plus the Claude desktop
app's session-application reader, which names the Code-tab chats that app
holds and their `claude://` addresses), Codex (local only), Conductor
(cloud, plus the local workspace creator and the session-application reader),
OMP, and Superset. The agents a Conductor or Superset workspace can run
beyond those — Cursor, OpenCode, Copilot, Gemini CLI, Grok Build — are
hosted-agent identities in `@sidecar/session` alone: a mark and a display
name, with no files, hook, or credential behind them.

A provider validates nothing about whether an action may run: `dispatchAction` and
every provider write take an admitted request, which only `admit()` in
`@sidecar/actions` stands behind. What a provider answers for is its own route —
the advertised control, spawn target, rename target, or listed project it reads
back from its own latest pass — and the provider's documented shape.

The plugin seam remains the authority for which acts exist. A provider is a
`SessionProviderPlugin`: one `observe`, the roster that pass published, and a
partial map of the actions and reads it actually implements. An absent handler is
the unsupported answer, so a provider gains an action only by naming its key and
taking on that action's constraint in root `CLAUDE.md` along with it. `dispatchAction`
is the only code that reaches a handler, and it re-resolves every target from
the plugin's own latest roster. Transcript reading belongs inside the plugin,
through `jsonlTranscriptReader` for a provider whose records are JSONL.

Which plugins stand is a `Layer`. `providersLayer` in
`@sidecar/providers/effect` merges one layer per registration, each built from
the registration object `registrations.ts` declares for it, and the
`Providers` service is the registry read out of that merge. A registration
claims the id its plugin publishes while its own layer builds, so two
registrations naming one id fail the build with
`DuplicateProviderRegistration` rather than one silently replacing the other
at a lookup nobody watches. `providerRegistrations` is the strangler shim over
it: the composers that hold the registry are still promises reading a record,
so it builds the layers and reads the service there, and P7-01 and P7-02
delete it once the host takes the layer itself.

There are no base classes: a plugin is a value, and the shared mechanics are
functions with one home each: `observationPass` for a file-backed pass,
`cloudPass` for a key-observed one, `hostClaims` for a workspace manager's
claims, and `AdapterFailure` with `clearsObservedState` for whether a failed
read clears what was observed.

Three of those mechanics reach outside the process, and each reaches it
through Effect's own. A cloud provider's requests are `HttpClient` requests
under the fiber's own deadline, and the 429 cadence is a `Schedule`:
`rateLimitSchedule` in `cloud-wire.ts` steps on the `RateLimitedRead` a
retried read fails with, takes each delay from `rateLimitDelayMs` — the same
doubling, the same honoured `Retry-After`, the same single-wait maximum and
one pass-wide ceiling — spends the pass's budget as it decides, and stops
where that decision gives the request up, which is what leaves the read's own
rate-limited failure standing. The hook spool is a `Stream` over
`FileSystem.watch`, grouped into the window a batch is read in and re-armed
by `Stream.retry` on a spaced schedule, so a spool directory hook
installation has not created yet and a watcher that fails later are the same
answer, tried again later. The window stays `groupedWithin`'s beat rather
than the anchored one the hand-rolled debounce opened at its first id, and
the difference is settled rather than inherited: two hooks two milliseconds
apart do straddle a boundary and arrive as two batches, and neither batch
costs a reader anything to undo. Two sessions straddling are one wake each
either way, since a wake is minted per event and never per batch; one session
straddling is read from the same spool file twice, so both batches carry that
file's own event and its `mtime` — the one mark the brain's inbox folds into
one entry. What the beat costs is the redundant read and never a second
entry, so no anchored pull loop stands here. A read that throws costs its own
entry and neither the batch nor the stream, because the spool only sharpens
the timing of state the adapters read on their own pass anyway. A provider's
own SQLite file is opened read-only inside a `Scope` that closes it, and
never through the store's opener in `@sidecar/brain`, which sets pragmas and
may `VACUUM` — writes a provider's file must never take.

Two of the three keep a promise face as a strangler shim, each `@deprecated`
and listed in `docs/adr/0001-effect.md`: `cloudPass` runs its request effects
because an adapter's `collect` and every caller of a provider write still
hold a promise, and `openReadOnlyDatabase` answers a handle the caller closes
itself in a `finally`. P6-11a and P6-11b move the adapters onto the effects.
The spool has no promise face and, in this build, no consumer either:
`observationSpoolEvents` is the whole of it. The hook wiring that would have
run it is gone — the local loop registers no hook and watches no spool now
that the rows draw the stored roster snapshot — so the window and the dropped
read above are settled on the stream's own terms, and a build that wakes on
hook events again provides `FileSystem` where it runs the stream and needs
nothing else of it.

Every provider passes one contract suite. `describeProviderContract` in
`@sidecar/providers/testing` states the trust constraints as tests over
recorded fixtures under `packages/session/fixtures/providers/<provider>/`,
each case naming the sentence of root `CLAUDE.md` it holds a provider to. A
provider is added by recording its fixtures and calling the suite; an action is
added by declaring its answer in `advertised` or `unadvertised`, and the suite
fails on an action kind neither list names. The golden answers are committed in
one canonical formatting — sorted keys, two-space indent, a trailing newline —
which `repository-checks.sh` enforces and Biome is kept away from;
`LUKE_UPDATE_FIXTURES=1` records them, and `check.sh` never sets it.

Capabilities stay with their owning package in explicit, exhaustive maps:
credentials in `@sidecar/credentials`, analytics connections in
`@sidecar/analytics` and the desktop bridge, hooks and plugin registration in
this package, fixture coverage in `@sidecar/session/fixtures` and the recorded
provider fixtures beside `@sidecar/session`, workspace presentation in the
surface that offers it, and Superset agent kinds in this package.
Provider marks and CSS are presentation owned by their surfaces, not identity.

Add a provider identity and its plugin together, then update every applicable
owner-specific map. `repository-checks.sh` rejects a stale README table;
`PRIVACY.md` remains manually reviewed because changing it is a product
decision, not generated inventory maintenance.

Changing a provider's read or write character is a product and privacy
decision, not registry housekeeping. No declaration may advertise a capability
the plugin does not already implement under the documented provider endpoint.
