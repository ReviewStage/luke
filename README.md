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
- Copilot — reads GitHub Copilot coding-agent task metadata after you supply a
  GitHub fine-grained personal access token
- Cursor — reads local session state for the agents running on this machine,
  and cloud agent metadata after you supply a Cursor API key
- Devin — reads cloud session metadata after you supply a Devin personal access
  token
- Jules — reads cloud session metadata after you supply a Jules API key
- OpenCode — reads local session state; no provider credential required

Cursor is the one provider Luke watches in two places, and both halves arrive as
Cursor sessions: the ones on this machine need no credential, and its cloud
agents need a key. Conductor, Copilot, Cursor's cloud half, Devin, and Jules
remain silent until their own credential is saved in Luke's Settings or supplied
through `CONDUCTOR_API_KEY`, `CONDUCTOR_API_TOKEN`, `COPILOT_API_KEY`,
`CURSOR_API_KEY`, `DEVIN_API_KEY`, or `JULES_API_KEY`.
Copilot's agent-tasks API answers only user tokens: a fine-grained personal
access token with **Agent tasks** read access or a GitHub App user token.
Classic PATs and GitHub App installation tokens are not supported, and the API
is in public preview, so Luke pins the dated API version it was written against.
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
- An optional OpenAI attention review can help decide which updates should be
  prioritized in the interface.
- An optional spoken conversation, described below, lets you ask Luke about your
  sessions and hear the answer.

Luke does not send commands to agents, inject terminal input, or expose agent
controls.

## Talking to Luke

Voice is off unless `OPENAI_API_KEY` is set. It is a real voice session: your
microphone audio goes to OpenAI, and Luke answers out loud. Read
[Privacy](PRIVACY.md) first — this is the one feature that sends audio off your
Mac.

One key runs it, and it answers from whatever app is frontmost:

- **Hold** `⌥Space` and talk. Let go to send. The turn lasts exactly as long as
  the key is down, so it cannot be left open by forgetting to press again. Luke
  connects on the first press, which is when macOS asks for the microphone.
- **Tap** it instead — under a quarter of a second — to leave the turn open for
  a question too long to hold through. Tap again to send.
- **Press while Luke is talking** to cut him off and take the turn back.
- **Escape** discards an open turn instead of sending it, while the panel is the
  frontmost window.

If another app already owns `⌥Space`, Luke falls back to `⌥S`. Settings shows
which key you actually have, under **Keyboard shortcuts**. It is not
configurable yet.

Holding is read by a small helper Luke ships beside the app, because Electron
reports a global key being pressed but never released. The helper is told the
one chord to watch for and can see no other key, which is why holding costs no
Accessibility or Input Monitoring grant. Where that helper cannot run, the key
falls back to a press-to-start, press-to-send toggle and Settings says so.

Settings lists the microphone under **Permissions**, with a green check once
access is granted and a link to System Settings beside it. The voice Luke
speaks with is chosen under **Preferences**; a change reaches the next
conversation to connect, and one already open keeps the voice it answered
with.

macOS asks once, the first time Luke needs the microphone, and keeps your
answer. No app can raise that prompt again, and only you can withdraw the
grant — in System Settings › Privacy & Security › Microphone, which the link
opens. That is the only revoking there is, so Luke offers the way there rather
than a control of its own that would look like the same thing and not be.

Luke's face is the interface: it plays its listening motion while you speak and
its talking motion while it answers, so the capsule says whose turn it is. Colour
says the same thing again — the face and the meter beside it are green while you
have the turn and blue while Luke has it — so a glance is enough even with the
peek closed. Turn on captions under **Preferences** in Settings — they are off
by default — and Luke's words wrap along the bottom of whatever shape is up as he
says them — capsule, peek, or panel — and leave when the reply does. Nothing is
kept: the caption is the reply being said, not a record of it.

## Privacy

Luke observes provider state read-only. Without `OPENAI_API_KEY` it never opens
the microphone and never asks for it: talking is the only thing it uses the
microphone for, and there is nothing to talk to. With the key set, an
attention-review request is made, and the spoken conversation sends the audio of
a turn you opened to OpenAI. See [PRIVACY.md](PRIVACY.md) for the exact data
boundaries and retention wording.

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

### Release a signed DMG

The local release path requires Xcode Command Line Tools, a Developer ID
Application identity in the login keychain, and a `luke-notary` keychain
profile. Configure the profile once without placing credentials in the
repository:

```sh
xcrun notarytool store-credentials luke-notary
```

Build, sign, notarize, staple, and verify the DMG with:

```sh
LUKE_CODESIGN_IDENTITY='Developer ID Application: Charles Pan (FZ47TN3469)' pnpm release:macos
```

The command writes `artifacts/release/Luke-<version>-arm64.dmg`. This path is
gitignored, remains local, and is never uploaded. Publishing it to the website
is a separate deliberate step.

For a local rehearsal that creates a signed DMG without submitting it to Apple,
run `pnpm release:macos --skip-notarization` with the same identity variable.

Before distribution, copy the notarized DMG to a fresh Apple Silicon Mac or
account, open it, drag Luke to Applications, and confirm the first launch passes
Gatekeeper without an override. You can also assess the installed app with
`spctl --assess --type execute -vv /Applications/Luke.app`.

## Optional attention review

Session monitoring does not require `OPENAI_API_KEY`: Claude Code, Codex, and
OpenCode use
local state, while Conductor, Cursor, and Devin use their separately configured
provider credentials. If `OPENAI_API_KEY` is set, Luke can also send a bounded status update to
the configured Responses endpoint for attention classification. That update can
include the session title, recap, repository, branch, current tool activity, and
reported error; see [PRIVACY.md](PRIVACY.md) for the exact boundary. The same
key enables the spoken conversation described above. Neither enables agent
control.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | unset | Enables external attention review and the spoken conversation |
| `LUKE_ATTENTION_MODEL` | `gpt-5.6-luna` | Selects the review model |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Selects the Responses-compatible endpoint |
| `LUKE_REALTIME_MODEL` | `gpt-realtime-2.1` | Selects the conversation model |
| `LUKE_REALTIME_VOICE` | `cedar` | Selects the spoken voice until one is chosen in Settings · Preferences |

Changing `OPENAI_BASE_URL` sends attention-review data to that endpoint instead
of OpenAI. It does not redirect the conversation, which always uses OpenAI's own
host. See [PRIVACY.md](PRIVACY.md) before enabling either feature.

## Repository map

- `apps/desktop/` — Electron main and preload processes, React renderer, native
  macOS helper, and packaging
- `apps/web/` — public landing page
- `packages/sidecar-core/` — platform-independent session and attention models
- `scripts/` — canonical development and validation commands

See `WORKFLOW.md` for the issue-to-PR workflow and `AGENTS.md` for repository
guidance.
