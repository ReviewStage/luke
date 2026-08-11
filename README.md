# Luke

Luke is a macOS-first Electron sidecar for monitoring coding-agent sessions
without changing how those agents are launched or controlled. Its compact React
surface attaches to the MacBook camera housing, and its reusable behavior stays
in brand-neutral TypeScript packages.

## Requirements

- Node.js 22.12 or newer
- macOS 14 or newer with Xcode Command Line Tools for the app workflow

## Development

From a fresh checkout:

```sh
./scripts/bootstrap.sh
./scripts/check.sh
```

On macOS, launch the fixture app or run complete validation:

```sh
./scripts/run.sh
./scripts/verify.sh
```

Run the public landing page locally with:

```sh
npm run dev --workspace @luke/web
```

Use `./scripts/run.sh --profile speaking` to preview the deterministic waveform
to the left of the notch without requesting microphone access.

The run command directly owns the Electron process, so Control-C stops it.
`verify.sh` packages the desktop app and writes deterministic visual evidence to
`artifacts/evidence/app-smoke-expanded.png`,
`artifacts/evidence/app-smoke-compact.png`, and
`artifacts/evidence/app-smoke-speaking.png`.

For PR motion evidence, run `npm run evidence:record` on a Mac with `ffmpeg`
installed and Screen & System Audio Recording permission granted to Conductor.
It records the fixture-only compact/expanded transition against a synthetic
backdrop and writes MP4 and GIF versions under `artifacts/evidence/`. Generated
evidence remains untracked.

The compact window is anchored to the display's top edge—not centered within
the desktop. A small packaged AppKit helper reads `NSScreen.safeAreaInsets` and
the auxiliary top areas so the black Electron surface can join the physical
camera housing. Macs and external displays without a notch use the same
top-center attachment with no invented hardware geometry.

The app currently uses synthetic fixture data. It requires no coding-agent
sessions, credentials, transcripts, or personal data.

## Repository map

- `apps/desktop/` — Electron main/preload processes, React renderer, macOS adapter, and app packaging
- `apps/web/` — Vite React public landing page
- `packages/sidecar-core/` — platform-independent models, fixtures, geometry, and tests
- `scripts/` — canonical non-interactive development commands
- `.conductor/settings.toml` — shared Conductor command configuration

See `WORKFLOW.md` for the issue-to-PR contract and `AGENTS.md` for agent-facing
repository guidance.
