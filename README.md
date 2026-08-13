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

Luke's menu bar item is drawn by the system rather than by the renderer, so it
cannot be captured through the app. With Luke running, `./scripts/menu-bar-evidence.sh`
photographs the right end of the menu bar into
`artifacts/evidence/menu-bar-item.png`; the terminal needs Screen Recording
permission the first time. Open the item afterwards to check its menu, which
offers **Settings…**, with Command-, shown against it, and Quit. The shortcut is claimed inside Luke's own window rather
than registered with the system, because Command-, belongs to whichever app is
frontmost; it switches the open panel to its Settings tab.

## The capsule, the peek, and the panel

The surface has three sizes and they are all the same black shape:

- **Capsule** — at rest beside the camera housing: the mark of the provider that
  needs you soonest, and the count of tracked sessions.
- **Peek** — under the pointer. The capsule widens on a spring and shows the
  rest of what it is watching: a mark for every provider with a session, up to
  the five the room beside the housing holds, and what the count means —
  `2 need you` — on the right. This is the affordance; nothing is committed by
  hovering.
- **Panel** — on a press. Full-width rows, one session per line: provider mark,
  title, what it is doing, a state chip. A **Settings** tab holds the cloud API
  keys, microphone access, and Quit. Press the capsule again, or press Escape,
  to close it; moving the pointer off it closes it just as readily, except while
  a key is being entered, which is the one thing the pointer must not discard.

Settings lists one line per cloud provider — its mark, its name, and whether it
is connected. A provider with no key offers **Connect**; one with a stored key
offers **Edit** and **Delete**. The field appears only while a key is being
entered, along with a link that opens that provider's own API-key page in your
browser. Luke opens it by provider id rather than by an address the panel
supplies, so the pages it can ever open are the ones in its provider registry.

Sessions are ordered by how much they need a person, so whatever is waiting on
you is the top row and the mark the capsule keeps.

The header is anchored to the notch, not to a state: the count sits to the right
of the housing and the provider marks and speech meter to its left, in the same
place in all three. Growing unfolds what the capsule had no room for: the marks
on one side and what the count means on the other travel the same distance, on
the same spring, so the two wings read as one gesture rather than two. More
providers than fit are counted at the end of the row rather than dropped from
it.

The surface is opaque black in every state and shaped like the housing it sits
beside: the convex bottom corners and the concave flare where its sides meet
the top edge are both derived from the reported notch inset, at the ratios
measured off photographs of the hardware (0.348 and 0.170 of its height). The
panel's corners are its own rather than the housing's, so its flare keeps the
proportion between the two rather than the size — 0.489 of whatever corner it
turns — and all three states still meet the top edge the same way. Depth comes
from a shadow and a hairline edge rather than from letting anything show
through. A display with no housing to blend into gets a free-floating pill
instead.

The panel's shadow arrives once the shape has settled, so a blurred shadow is
never repainted mid-spring; the peek's is small enough to ride along with it. A
real blur of the desktop is not available here: a transparent Electron window
gives `backdrop-filter` no backdrop to sample, and reaching the desktop would
mean native vibrancy, which cannot be masked to a shape that animates.

The window is a stage, never the shape. It snaps to the size a state needs and
the renderer animates the surface inside it, so the motion stays on the
compositor — and because a compact window is already wide enough to hold the
peek, hovering never touches the main process at all. Growing, the surface leads
and the content follows it in; shrinking, the content leaves first and the
surface closes behind it, so nothing is ever drawn outside the black. Every resize runs on one sampled damped
spring at one duration — a real spring's motion is a property of the spring, not
of how far it is asked to travel — and the window carries slack on every side
for the overshoot to land in. The same spring carries the content: the panel's
rows arrive as one compressed stack whose gaps spring open, rather than as
elements that fade in where they will end up. The surface also ends where the content does, so a
session arriving or finishing resizes the panel.

## Provider marks

Sessions are labelled with each provider's own mark, inlined as path data in
`apps/desktop/src/renderer/provider-marks.tsx`: the Claude Code mark via
[Simple Icons](https://simpleicons.org) (CC0-1.0, sourced from code.claude.com),
the Codex mark via [@lobehub/icons](https://github.com/lobehub/lobe-icons)
(MIT), and Conductor's letter mark verbatim from its published
[brand kit](https://www.conductor.build/brandkit). Each keeps its brand colour —
Claude Code's `#D97757` coral, Codex's `#B1A7FF → #3941FF` gradient, and the
`#EAE8E6` half of Conductor's two-colour palette, whose dark half is the surface
the mark already sits on — declared as `--mark-*` custom properties in
`styles/base.css`. Session state is carried by the count badge, the state chips,
and the row tints instead, so brand colour and state colour never land on the
same pixel. The marks are trademarks of their respective owners and are used
here only to identify which provider a session belongs to; Luke is not
affiliated with or endorsed by any of them. A provider with no registered mark
falls back to a neutral glyph rather than to another provider's.

The marks are keyed by the provider ids in `PROVIDER_ID`, which adapters report
and `CREDENTIAL_PROVIDER_ID` draws from, so a session row and a key field name
the same provider with the same mark.

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
no configuration. A cloud provider has no local state to read, so it stays
silent until you press the capsule to open the panel, choose the **Settings**
tab, and connect it with a key. Each provider holds its own credential and also
reads its own `<PROVIDER>_API_KEY` from the environment; Conductor accepts
`CONDUCTOR_API_KEY` or `CONDUCTOR_API_TOKEN` and issues keys at
<https://app.conductor.build/users/api-keys>, and Cursor accepts
`CURSOR_API_KEY` and issues keys at <https://cursor.com/dashboard/api>. A
provider you give no key to reports nothing and issues no request. A key you
enter is encrypted with `safeStorage`, whose key comes from the login Keychain,
and it is never returned to the renderer. Luke reads only cloud workspaces and
agents you created, issues only read requests, and labels each session by its
repository rather than by a provider workspace, agent, or session name, because
those names are generated from the opening prompt.

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
