# Luke

Luke v0.1 is an Apple Silicon developer preview for macOS 14+. It is a small
Electron sidecar that shows the state of local coding-agent sessions beside the
MacBook camera housing without changing how those agents run.

Luke is early software. Read [Privacy](PRIVACY.md) before using it.

## Download

Download published builds from [GitHub Releases](https://github.com/ReviewStage/luke/releases).

## Current provider support

- Claude Code
- Codex

Both providers work from local session state. Luke does not require provider
credentials, hooks, plugins, wrappers, or changes to how a session is launched.

## What works in v0.1

- A compact, top-center capsule shows how many sessions Luke is tracking.
- Hovering opens a quick peek; clicking opens a panel with one row per session.
- Rows show the provider, a workspace-derived title, a bounded status summary,
  and whether the session is working, waiting, complete, or merely observed.
- Sessions that appear to need attention are placed first.
- An optional microphone visualization can react to local audio levels.
- An optional OpenAI attention review can help decide which updates should be
  prioritized in the interface.

Luke does not speak, send commands to agents, inject terminal input, or expose
agent controls. The microphone feature is an audio-level visualization, not
speech recognition or a voice session.

## Privacy

Luke observes provider state read-only and keeps microphone processing local.
An external attention-review request is made only when `OPENAI_API_KEY` is set.
See [PRIVACY.md](PRIVACY.md) for the exact data boundaries and retention wording.

## Build from source

### Requirements

- Apple Silicon Mac running macOS 14 or newer
- Node.js 22.12 or newer
- pnpm 9.15.0
- Xcode Command Line Tools

From a fresh checkout:

```sh
./scripts/bootstrap.sh
./scripts/check.sh
```

Launch the app or run complete macOS validation:

```sh
./scripts/run.sh
./scripts/verify.sh
```

The run command owns the Electron process, so Control-C stops it. By default it
replaces any running Luke instance. Pass `--keep-running` to leave an existing
instance in place.

Run the public landing page locally with:

```sh
pnpm --filter @luke/web dev
```

Use `./scripts/run.sh --profile speaking` to preview a deterministic fixture
waveform without requesting microphone access.

## Optional attention review

Luke monitors supported providers without an API key. If `OPENAI_API_KEY` is
set, Luke can send a bounded status update to the configured Responses endpoint
for attention classification. This does not enable speech or agent control.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | unset | Enables external attention review |
| `LUKE_ATTENTION_MODEL` | `gpt-5.6-luna` | Selects the review model |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Selects the Responses-compatible endpoint |

Changing `OPENAI_BASE_URL` sends attention-review data to that endpoint instead
of OpenAI. See [PRIVACY.md](PRIVACY.md) before enabling the feature.

## Repository map

- `apps/desktop/` — Electron main and preload processes, React renderer, native
  macOS helper, and packaging
- `apps/web/` — public landing page
- `packages/sidecar-core/` — platform-independent session and attention models
- `scripts/` — canonical development and validation commands

See `WORKFLOW.md` for the issue-to-PR workflow and `AGENTS.md` for repository
guidance.
