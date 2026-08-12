# Luke

Luke is a macOS-first Electron sidecar for monitoring coding-agent sessions
without changing how those agents are launched or controlled. Its compact React
surface attaches to the MacBook camera housing, and its reusable behavior stays
in brand-neutral TypeScript packages.

## Requirements

- Node.js 22.12 or newer
- pnpm 9.15.0
- macOS 14 or newer with Xcode Command Line Tools for the app workflow

## Development

From a fresh checkout:

```sh
./scripts/bootstrap.sh
./scripts/check.sh
```

On macOS, launch the app or run complete validation:

```sh
./scripts/run.sh
./scripts/verify.sh
```

Run the public landing page locally with:

```sh
pnpm --filter @luke/web dev
```

Use `./scripts/run.sh --profile speaking` to preview the deterministic waveform
to the left of the notch without requesting microphone access.

The run command directly owns the Electron process, so Control-C stops it. It
also replaces an instance that is already running: Electron's single-instance
lock belongs to the older process, so without this the newer launch would quit
on startup and leave the previous build on screen. That lock is keyed on the app
name, which every checkout shares, so the replaced instance can be one launched
from a different worktree; it is named on stdout before it is stopped. Pass
`--keep-running` to leave a running instance in place, which re-asserts its
panel instead of starting a new one.

`verify.sh` packages the desktop app and writes deterministic visual evidence to
`artifacts/evidence/app-smoke-expanded.png`,
`artifacts/evidence/app-smoke-compact.png`, and
`artifacts/evidence/app-smoke-speaking.png`.

For PR motion evidence, run `pnpm evidence:record` on a Mac with `ffmpeg`
installed and Screen & System Audio Recording permission granted to Conductor.
It records the fixture-only compact/expanded transition against a synthetic
backdrop and writes MP4 and GIF versions under `artifacts/evidence/`. Generated
evidence remains untracked.

The compact window is anchored to the display's top edge—not centered within
the desktop. A small packaged AppKit helper reads `NSScreen.safeAreaInsets` and
the auxiliary top areas so the black Electron surface can join the physical
camera housing. Macs and external displays without a notch use the same
top-center attachment with no invented hardware geometry.

The evidence mode uses synthetic fixture data. Live mode passively observes
bounded coding-agent session metadata without requiring provider plugins, hooks,
wrappers, live-session changes, or transcript retention.

Claude Code and Codex sessions are observed from local provider state and need
no configuration. Conductor cloud sessions have no local state to read, so that
provider stays silent until you open the expanded panel, choose **Settings**,
and paste a Conductor API key; Luke also accepts one from `CONDUCTOR_API_KEY` or
`CONDUCTOR_API_TOKEN`. A key you enter is encrypted with `safeStorage`, whose
key comes from the login Keychain, and it is never returned to the renderer.
Luke reads only cloud workspaces you created, issues only read requests, and
labels each session by its repository rather than by a Conductor workspace or
session name, because those names are generated from the opening prompt.

## Attention intelligence

When a session reports a development, Luke asks a background model whether that
development is worth saying out loud. The model receives one bounded, redacted
update—provider, session title, previous and current status, and the observed
summary—and answers with a structured decision: stay silent, speak during the
turn, or speak once the turn ends. Anything outside that contract, and any API
failure, leaves Luke silent. Repeated decisions about the same session are
deduplicated so one development is never announced twice, and a decision is
discarded when the session moves past the state it was made about—answering a
waiting session while the model is still thinking should not produce a stale
interruption.

The layer is optional. Without `OPENAI_API_KEY`, Luke observes sessions and
stays silent, and no other behavior changes:

| Variable               | Default                     | Purpose                                    |
| ---------------------- | --------------------------- | ------------------------------------------ |
| `OPENAI_API_KEY`       | unset                       | Enables attention review when it is present |
| `LUKE_ATTENTION_MODEL` | `gpt-5.6-luna`              | Model used for the decision                |
| `OPENAI_BASE_URL`      | `https://api.openai.com/v1` | Alternate OpenAI-compatible endpoint       |

Requests set `store: false`, so the API is not asked to retain them. Tune how
conservative Luke is by editing the redacted examples in
`packages/sidecar-core/src/attention-examples.ts`; they are synthetic and
double as the prompt's few-shot guidance and its regression coverage.

## Pull-request media

Keep generated screenshots and recordings out of product branches. Inline PR
media is stored on the shared `pr-assets` branch under `pr-<number>/` and linked
with its `raw.githubusercontent.com` URL. Keep that one branch: deleting it
breaks rendered images in open and historical PRs.

## Repository map

- `apps/desktop/` — Electron main/preload processes, React renderer, macOS adapter, and app packaging
- `apps/web/` — Vite React public landing page
- `packages/sidecar-core/` — platform-independent models, fixtures, geometry, and tests
- `scripts/` — canonical non-interactive development commands
- `.conductor/settings.toml` — shared Conductor command configuration

See `WORKFLOW.md` for the issue-to-PR contract and `AGENTS.md` for agent-facing
repository guidance.
