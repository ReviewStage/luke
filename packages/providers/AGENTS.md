## Provider identity and capabilities

`PROVIDER_IDENTITY_BY_ID` in `@sidecar/session` is deliberately narrow. It owns
only each provider's stable id, display name, order, and local/cloud location.
The README platform table is generated from that identity catalog.

The adapters this package ships are Claude Code (plus the Claude desktop
app's session-application reader, which names the Code-tab chats that app
holds and their `claude://` addresses), Codex (local and cloud), Conductor
(cloud, plus the local workspace creator and the session-application reader),
and OMP; Superset's lives in `@sidecar/superset`. The agents a
Conductor or Superset workspace can run beyond those — Cursor, OpenCode,
Copilot, Gemini CLI, Grok Build — are hosted-agent identities in
`@sidecar/session` alone: a mark and a display name, with no adapter, files,
hook, or credential behind them.

The adapter seam remains the authority for acts. Every adapter implements the
total `SessionProviderAdapter` interface through its base class, whose answer is
unsupported. A provider gains an act only by overriding the matching protected
route or delivery seam and preserving every trust constraint in root
`CLAUDE.md`. Transcript reading belongs inside the adapter.

`PROVIDER_CAPABILITIES` in `src/capabilities.ts` states, per observed
provider, what those seams amount to: location, observation hook, credential
kind, and acts. It declares nothing on its own authority. The conformance test
in `capabilities.test.ts` reads each adapter's overridden seams through
`implementedActs` (exported from `@sidecar/providers/testing`) and fails when
the declaration and the adapter disagree in either direction, and the same
test anchors the hand-written provider lists in Luke's guide, the root agent
guide, and `PRIVACY.md` to the declaration. Change the adapter and the row
together; a row is never the place a capability is granted.

Registration is two tables built from one. `providerRegistrations` holds the
observed providers with their credentials and hook installers;
`workspaceProviderRegistrations` adds the two workspace-only providers —
local Conductor, built here, and Superset's workspace adapter, handed in from
above because `@sidecar/superset` sits over this package — each with a
declared observation mode (`REGISTRATION_OBSERVATION`) and an optional
per-pass refresh. The desktop iterates those rows for the act router, the
project offer, and the observation loop, and names no provider of its own.

A workspace host that also carries acts declares `claim` on its
`WorkspaceHostRegistration`: the acts for a session its latest read resolved,
bound to that session's context, or nothing. A host delivers an act only for a
capability its own enrichment advertised on the row — the performer re-checks
the roster first, and `ownsControl` keeps a provider's own control on a
managed row with the provider. Superset's host lives in `@sidecar/superset`.

Capabilities stay with their owning package in explicit, exhaustive maps:
credentials in `@sidecar/credentials`, analytics connections in
`@sidecar/analytics` and the desktop bridge, hooks and adapter registration in
this package, fixture coverage in `@sidecar/fixtures`, workspace presentation
in the surface that offers it, and Superset agent kinds in `@sidecar/superset`.
Provider marks and CSS are presentation owned by their surfaces, not identity.

Add a provider identity and its adapter together, then update every applicable
owner-specific map. `repository-checks.sh` rejects a stale README table;
`PRIVACY.md` remains manually reviewed because changing it is a product
decision, not generated inventory maintenance.

Changing a provider's read or write character is a product and privacy
decision, not registry housekeeping. No declaration may advertise a capability
the adapter does not already implement under the documented provider endpoint.
