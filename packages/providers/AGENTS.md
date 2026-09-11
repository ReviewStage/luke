## Provider identity and capabilities

`PROVIDER_IDENTITY_BY_ID` in `@sidecar/session` is deliberately narrow. It owns
only each provider's stable id, display name, order, and local/cloud location.
The README platform table is generated from that identity catalog.

The one plugin this package ships is Conductor, observed in the cloud through
its documented API. The local providers the identity catalog still names —
Claude Code, Codex, OMP — have no plugin here any more: Luke observes nothing
on this Mac, and the service's roster carries cloud provider ids alone. The
agents a Conductor workspace can run beyond those — Cursor, OpenCode, Copilot,
Gemini CLI, Grok Build — are hosted-agent identities in `@sidecar/session`
alone: a mark and a display name, with no files, hook, or credential behind
them.

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
the plugin's own latest roster.

Nothing in this package is composed into the desktop. The web functions
compile the Conductor adapter out of it by relative path (`server/hosted/`),
build one plugin per pass with the caller's own decrypted key, and read the
roster and the transcripts through it; `repository-checks.sh` refuses an
import of `@sidecar/providers` anywhere under `packages/host/src` and
`apps/desktop/src`, so no path from a turn, a row, or a window can reach a
provider without the service's admission in between.

There are no base classes: a plugin is a value, and the shared mechanics are
functions with one home each: `cloudPass` for a key-observed pass, and
`AdapterFailure` with `clearsObservedState` for whether a failed read clears
what was observed.

A cloud provider's requests are `HttpClient` requests under the fiber's own
deadline, and the 429 cadence is a `Schedule`: `rateLimitSchedule` in
`cloud-wire.ts` steps on the `RateLimitedRead` a retried read fails with, takes
each delay from `rateLimitDelayMs` — the same doubling, the same honoured
`Retry-After`, the same single-wait maximum and one pass-wide ceiling — spends
the pass's budget as it decides, and stops where that decision gives the
request up, which is what leaves the read's own rate-limited failure standing.

`cloudPass` needs no promise face of its own: its reads, its one write, and
its credential-bound read are effects, and Conductor — the one adapter that
rides it — reaches every one of them through `runAdapterRead` in
`shared/promise-face.ts`, the one `@deprecated` place those effects are run,
because `SessionProviderPlugin` is still promises. P7-05 composed the host's
own observation concern as an effect, but that composer never called a
plugin's `observe()` or a transcript read directly — its roster comes from
the hosted service's own snapshot, and it builds no plugin at all — so this
face's deletion still waits on a caller inside this package holding a fiber
of its own instead of it. Every one of those reads is still a read: the
adapter opens its own credential-bound endpoint for reading alone, and the
contract suite pins that no observation pass issues a request that can change
provider state.

Every rendering of a transcript speaks one line vocabulary — `Developer:` for
the person, the agent's own name for its replies, `→` for a tool call, `←` for
its answer, `Error:` for a failure the provider recorded — and
`shared/jsonl-transcript.ts` holds every rendering to the same bounds however
the records differ, cutting a rendering from the front and saying so.

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
`@sidecar/analytics` and the desktop bridge, plugin declaration in this
package, fixture coverage in `@sidecar/session/fixtures` and the recorded
provider fixtures beside `@sidecar/session`, and workspace presentation in
the surface that offers it.
Provider marks and CSS are presentation owned by their surfaces, not identity.

Add a provider identity and its plugin together, then update every applicable
owner-specific map. `repository-checks.sh` rejects a stale README table;
`PRIVACY.md` remains manually reviewed because changing it is a product
decision, not generated inventory maintenance.

Changing a provider's read or write character is a product and privacy
decision, not registry housekeeping. No declaration may advertise a capability
the plugin does not already implement under the documented provider endpoint.
