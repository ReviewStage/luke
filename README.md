# Luke

Luke v0.1 is an Apple Silicon developer preview for macOS 14+. It is a small
Electron sidecar that shows the state of local coding-agent sessions beside the
MacBook camera housing without changing how those agents run.

Luke is early software. Read [Privacy](PRIVACY.md) before using it.

## Download

Download published builds from [GitHub Releases](https://github.com/ReviewStage/luke/releases).

## Current provider support

- Claude Code — reads local session state; no provider credential required
- Codex — reads local session state; no provider credential required
- Conductor — reads cloud session metadata after you supply a Conductor API key
- Cursor — reads local session state for the agents running on this machine,
  and cloud agent metadata after you supply a Cursor API key
- Devin — reads cloud session metadata after you supply a Devin personal access
  token
- Jules — reads cloud session metadata after you supply a Jules API key

Cursor is the one provider Luke watches in two places, and both halves arrive as
Cursor sessions: the ones on this machine need no credential, and its cloud
agents need a key. Conductor, Cursor's cloud half, Devin, and Jules remain silent
until their own credential is saved in Luke's Settings or supplied through
`CONDUCTOR_API_KEY`, `CONDUCTOR_API_TOKEN`, `CURSOR_API_KEY`, `DEVIN_API_KEY`, or
`JULES_API_KEY`.
Devin is the one that asks for a particular credential: Luke reads its v3 API, so
it takes a personal access token (`cog_…`, created under **Devin API · PATs**)
and refuses the deprecated `apk_` keys of v1 and v2. A token that belongs to a
service user rather than to a person is refused too — Devin lists an
organization's sessions, and Luke reports only the sessions belonging to whoever
the token authenticates as. Every provider integration is read-only. None
requires hooks, plugins, wrappers, or changes to how a session is launched.

## What works in v0.1

- A compact, top-center capsule shows how many sessions Luke is tracking.
- Hovering opens a quick peek; clicking opens a panel with one row per session.
- Rows show the provider-assigned title (with a workspace fallback), current
  activity, error or turn recap, repository context, and whether the session is
  working, waiting, complete, failed, or merely observed.
- Sessions that appear to need attention are placed first.
- An options button beside the tabs opens filtering and sorting: the list can be
  narrowed to the sessions running locally, to those running in the cloud, or to
  a single agent, and ordered by what needs you most or by what was observed
  most recently. Each control is offered only where it is a real choice, a
  narrowed list is named on the button itself, and both reset when the panel
  closes, so it always reopens showing every session Luke is tracking.
- Entering a cloud provider's credential narrows the panel to a single field, so
  the page you copy it from stays readable while Luke waits for the paste.
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

Session monitoring does not require `OPENAI_API_KEY`: Claude Code and Codex use
local state, while Conductor, Cursor, and Devin use their separately configured
provider credentials. If `OPENAI_API_KEY` is set, Luke can also send a bounded status update to
the configured Responses endpoint for attention classification. That update can
include the session title, recap, repository, branch, current tool activity, and
reported error; see [PRIVACY.md](PRIVACY.md) for the exact boundary. This does
not enable speech or agent control.

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
