# `@sidecar/providers`

`PROVIDER_IDENTITY_BY_ID` in `@sidecar/session` is deliberately narrow: each
provider's stable id, display name, order, and local/cloud location, and nothing
else. The README platform table is generated from it, and `repository-checks.sh`
rejects a stale table.

The one plugin here is Conductor, observed in the cloud through its documented
API. The local providers the identity catalog still names have no plugin: Luke
observes nothing on this Mac. The agents a Conductor workspace can run beyond
those are hosted-agent identities in `@sidecar/session` alone — a mark and a
display name, with no files, hook, or credential behind them.

## A provider validates nothing about whether an action may run

`dispatchAction` and every provider write take an already-admitted request. What a
provider answers for is its own route — the advertised control, spawn target,
rename target, or listed project it reads back from its own latest pass — and the
provider's documented shape.

`repository-checks.sh` refuses an import of this package under `packages/host/src`
and `apps/desktop/src`, so no path from a turn, a row, or a window reaches a
provider without the service's admission in between.

## The plugin seam is the authority for which acts exist

A provider is a `SessionProviderPlugin`: one `observe`, the roster that pass
published, and a partial map of the actions and reads it actually implements.
**An absent handler is the unsupported answer**, so a provider gains an action
only by naming its key and taking on that action's constraint along with it.

There are no base classes: a plugin is a value, and the shared mechanics are
functions with one home each.

Every pass's reads are reads. The adapter opens its own credential-bound endpoint
for reading alone, and the contract suite pins that no observation pass issues a
request that can change provider state.

Every rendering of a transcript speaks one line vocabulary, held to the same
bounds however the records differ, cutting from the front and saying so.

## Every provider passes one contract suite

`describeProviderContract` in `@sidecar/providers/testing` states the trust
constraints as tests over recorded fixtures under
`packages/session/fixtures/providers/<provider>/`. A provider is added by
recording its fixtures and calling the suite; an action is added by declaring its
answer in `advertised` or `unadvertised`, and **the suite fails on an action kind
neither list names.**

The golden answers are committed in one canonical formatting, which
`repository-checks.sh` enforces and Biome is kept away from.
`LUKE_UPDATE_FIXTURES=1` records them, and `check.sh` never sets it.

**Changing a provider's read or write character is a product and privacy decision,
not registry housekeeping. No declaration may advertise a capability the plugin
does not already implement under the documented provider endpoint.** `PRIVACY.md`
is reviewed by hand for the same reason.
