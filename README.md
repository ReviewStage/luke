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
the token authenticates as. Every provider integration observes read-only, and
none requires hooks, plugins, wrappers, or changes to how a session is
launched. The only writes Luke makes are ones you directly ask for — a
message, a control the provider advertised, or a new workspace, described
below — sent through that provider's own documented endpoint and checked
against the latest observed roster.

The one registration Luke makes on top of that baseline is an observation
hook for Claude Code, converged into `~/.claude/settings.json` at every
launch beside whatever is already there. At each session's turn boundaries it
writes a single fixed status token — never the conversation — into a spool
under Luke's own application data, which is how a row can show a tool call
holding for permission or settle the moment a session closes. The command is
a guarded no-op wherever Luke is gone, and every session still observes from
its transcript alone without it.

Local sessions are also readable on request: ask Luke — out loud or typed —
what a session did, said, or is stuck on, and he reads that session's own
transcript on your machine (Claude Code sessions today) and answers from it.
The read happens when you ask and is kept nowhere; see
[Privacy](PRIVACY.md) for exactly what enters the conversation.

## Issue tracker support

- Linear — reads the issues assigned to you after you supply a Linear personal
  API key (`lin_api_…`, from Settings or `LINEAR_API_KEY`), and sends Linear
  nothing without one.

The board feeds the spoken conversation rather than the panel: with a key
saved, Luke knows each assigned issue's identifier, title, state, and the
states its team's workflow allows, so you can ask where LUKE-123 stands, ask
Luke to move it to one of those states, or add a comment — each only when you
ask, out loud or typed, through Linear's own GraphQL API under your key.

## What works in v0.1

- A compact, top-center capsule shows how many sessions Luke is tracking.
- Hovering opens a quick peek; clicking opens a panel with one row per session.
- Rows show the provider-assigned title (with a workspace fallback), current
  activity, error or turn recap, repository context, and whether the session is
  working, waiting, complete, failed, or merely observed.
- A provider that nests chats in a workspace — Conductor today — gets one row
  per chat: several chats sit inside one tray named by the workspace at its
  top, a workspace holding a single chat stays one row titled by the
  workspace, and each chat can be opened, messaged, or controlled on its own.
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

Luke never injects terminal input or simulates keystrokes. The messaging,
controls, and workspace creation described above happen only when you
directly ask for them, out loud or typed, through each provider's own
documented endpoint.

## Talking to Luke

Voice is off until you give Luke an OpenAI key. It is a real voice session: your
microphone audio goes to OpenAI, and Luke answers out loud. Read
[Privacy](PRIVACY.md) first — this is the one feature that sends audio off your
Mac.

Connect the key in Settings, under **Integrations**: press **Connect** beside
OpenAI, paste the key, and Luke takes it from there — no relaunch, and no
terminal. It is stored encrypted through the macOS Keychain, and the panel never
reads it back. Setting `OPENAI_API_KEY` in the environment still works and is
used when nothing is stored, but a shell export does not reach an app opened from
Finder, which is why the panel is the way in.

One key runs it, and it answers from whatever app is frontmost:

- **Hold** `⌥Space` and talk. Let go to send. The turn lasts exactly as long as
  the key is down, so it cannot be left open by forgetting to press again. Luke
  connects on the first press, which is when macOS asks for the microphone.
- **Tap** it instead — under a quarter of a second — to leave the turn open for
  a question too long to hold through. Tap again to send.
- **Press while Luke is talking** to cut him off and take the turn back.
- **`⌥S`** stops Luke mid-sentence and asks for nothing in its place — S is for
  stop, and it answers from any app. **Escape** does the same while the panel
  is the frontmost window, and discards an open turn instead of sending it.

Settings shows which keys you actually have — or an honest absence, if another
app already owns a chord — on its **Keyboard shortcuts** page, one row each for the
talk, ask, and stop keys. The pencil beside a row records a chord of your own:
hold `⌃`, `⌥` or `⌘` — `⇧` may join, but not carry a chord alone, since `⇧S`
is how capitals are typed — and press a letter or Space, as the row itself
explains while it listens. The change takes effect at once, the reset arrow
beside it returns the defaults, and if something else owns your chord Luke
falls back to the defaults and shows the key that actually answered. The keys
never compete for one chord: the stop key refuses a chord the other two hold,
and a talk or ask key moved onto the stop key's chord wins it — the stop key
stands down, and Escape remains its fallback.

Holding is read by a small helper Luke ships beside the app, because Electron
reports a global key being pressed but never released. The helper is told the
one chord to watch for and can see no other key, which is why holding costs no
Accessibility or Input Monitoring grant. Where that helper cannot run, the key
falls back to a press-to-start, press-to-send toggle and Settings says so.

Settings lists the microphone under **Permissions**, with a green check once
access is granted and a link to System Settings beside it. The voice Luke
speaks with is chosen on Settings' **Voice** page; a change reaches the next
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
peek closed. Turn on captions on the **Voice** page in Settings — they are off
by default — and Luke's words wrap along the bottom of whatever shape is up as he
says them — capsule, peek, or panel — and leave when the reply does. Nothing is
kept: the caption is the reply being said, not a record of it.

When the Mac itself would swallow the reply — output muted, or the volume at
zero — the captions appear on their own, whatever the switch says, and a short
hint under the words asks for volume. Its **Got it** button rests the hint for
that stretch of silence (the captions stay); once sound has been back for a
while, a fresh mute earns the hint again. Luke only reads the output's mute
switch and volume, and never changes either.

## Privacy

Luke observes provider state read-only. Without an OpenAI key it never opens
the microphone and never asks for it: talking is the only thing it uses the
microphone for, and there is nothing to talk to. With a key — connected in
Settings or read from the environment — an
attention-review request is made, and the spoken conversation sends the audio of
a turn you opened to OpenAI. Deleting the key in Settings takes both away again
immediately. See [PRIVACY.md](PRIVACY.md) for the exact data
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

## Spoken announcements

Luke says it out loud when an observed session starts waiting on you, stops on
an error, or finishes — whether or not a conversation is open. The trigger is
the status change itself, observed locally and never decided by a model. When
no conversation is up, Luke opens a speak-only call for the sentence: no
microphone is captured, no permission is asked, and the call carries only the
worded announcement — never the session roster, the app guide, or the issue
list, which travel only on conversations you open yourself. The announcement
sentence (the session's title, provider, repository or branch, and any
one-line error reason) is synthesized through the same voice service as the
spoken conversation, so announcements need an OpenAI key and follow the
same privacy boundary; see [PRIVACY.md](PRIVACY.md). They can be switched off
in Settings · Voice ("Announce when a session needs you"); the panel and
the capsule count show the same states either way.

## Optional attention review

Session monitoring does not require an OpenAI key: Claude Code, Codex, and
OpenCode use
local state, while Conductor, Cursor, and Devin use their separately configured
provider credentials. Given an OpenAI key, Luke can also send a bounded status update to
the configured Responses endpoint for attention classification. That update can
include the session title, recap, repository, branch, current tool activity, and
reported error; see [PRIVACY.md](PRIVACY.md) for the exact boundary. It is the
same one key as the spoken conversation described above, wherever you put it:
connecting OpenAI in Settings enables both, and deleting it there disables both.
The row says so where the key is entered. Attention review only classifies;
nothing it decides reaches a write path. The spoken conversation can send a
message or run a control, but only when you directly ask it to in a turn you
open yourself.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | unset | Enables external attention review and the spoken conversation, when no key is stored in Settings |
| `LUKE_ATTENTION_MODEL` | `gpt-5.6-luna` | Selects the review model |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Selects the Responses-compatible endpoint |
| `LUKE_REALTIME_MODEL` | `gpt-realtime-2.1` | Selects the conversation model |
| `LUKE_REALTIME_VOICE` | `cedar` | Selects the spoken voice until one is chosen in Settings · Voice |
| `LUKE_REALTIME_SPEED` | `1` | Selects the speaking pace (`0.75`, `1`, `1.25`, or `1.5`) until one is chosen in Settings · Voice |

Changing `OPENAI_BASE_URL` sends attention-review data to that endpoint instead
of OpenAI. It does not redirect the conversation, which always uses OpenAI's own
host. See [PRIVACY.md](PRIVACY.md) before enabling either feature.

## Repository map

- `apps/desktop/` — Electron main and preload processes, React renderer, native
  macOS helper, and packaging
- `apps/web/` — public landing page and Drizzle/Neon server module
- `packages/sidecar-core/` — platform-independent session and attention models
- `scripts/` — canonical development and validation commands

See `WORKFLOW.md` for the issue-to-PR workflow and `AGENTS.md` for repository
guidance.
