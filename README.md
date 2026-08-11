# Luke

Luke is a native macOS sidecar for monitoring coding-agent sessions without
changing how those agents are launched or controlled. This first foundation
contains a deterministic development surface, a platform-independent core
module, and the repository harness used to build and prove later work.

## Requirements

- macOS 14 or newer with Xcode 16 for the app workflow
- Swift 6 on macOS or Linux for platform-independent checks

## Development

From a fresh checkout:

```sh
./scripts/bootstrap.sh
./scripts/check.sh
```

On macOS, build and test the app, launch its fixture, or generate visual proof:

```sh
./scripts/test-macos.sh
./scripts/run.sh
./scripts/evidence.sh
```

Generated build state stays under `.build/`. The evidence command writes
`artifacts/evidence/app-development.png`; both paths are scoped to the current
worktree and ignored by Git.

The app currently uses committed synthetic fixture data. It requires no coding
agent sessions, credentials, transcripts, or personal data.

## Repository map

- `App/` — thin SwiftUI/AppKit application target
- `Sources/SidecarCore/` — platform-independent behavior and fixture model
- `Tests/` — core and macOS app tests
- `scripts/` — canonical non-interactive development commands
- `.conductor/settings.toml` — shared Conductor command configuration

See `WORKFLOW.md` for the issue-to-PR contract and `AGENTS.md` for agent-facing
repository guidance.
