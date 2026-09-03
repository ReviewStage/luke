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
