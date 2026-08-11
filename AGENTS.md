# Agent guide

Luke is a native macOS sidecar that observes coding-agent sessions while
preserving existing provider workflows. Product naming belongs at the app and
packaging boundary; keep reusable implementation types brand-neutral. Keep the
app target in `App/` thin, and put platform-independent behavior in
`Sources/SidecarCore/` with tests in `Tests/SidecarCoreTests/`.

Canonical commands:

- `./scripts/bootstrap.sh` — prepare workspace-scoped state
- `./scripts/check.sh` — run portable repository and core checks
- `./scripts/test-macos.sh` — build and test the macOS app
- `./scripts/run.sh` — launch the deterministic fixture app
- `./scripts/evidence.sh` — write the fixture PNG under `artifacts/`

Trust constraints:

- Never write provider transcripts or session-state files.
- Never inject terminal input, simulate keystrokes, or request Accessibility.
- Do not require MCP, plugins, hooks, wrappers, credentials, or live sessions.
- Keep unsupported capabilities explicit; do not invent fallback controls.
- Commit only synthetic, redacted fixtures and repository-relative paths.

Before handoff, run the checks relevant to the change and report their exact
results. UI changes require visual evidence and a note stating whether a
physical-notch check was performed. Keep generated state and private planning
files untracked.
