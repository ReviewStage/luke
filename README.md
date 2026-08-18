# Luke

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/brand/luke-wordmark-dark.svg">
    <img src="design/brand/luke-wordmark-light.svg" alt="Luke" width="360">
  </picture>
</p>

**Your AI engineering manager.**

Luke is an open-source macOS app that watches your coding-agent sessions and
shows you which ones need your attention. It sits beside the MacBook camera
housing and works without changing how your agents run.

Luke v0.1 is an Apple Silicon developer preview for macOS 14 and newer.

## Download

Download the latest build from
[GitHub Releases](https://github.com/ReviewStage/luke/releases).

Luke asks for an identity-only Google or GitHub sign-in when it first opens —
see [Privacy](PRIVACY.md) for exactly what the account does and does not
carry.

Visit [tryluke.dev](https://tryluke.dev) to see Luke in action.

## Features

- See local and cloud coding-agent sessions in one place.
- Know which sessions are working, waiting, complete, or failed.
- Review current activity, errors, repository context, and turn recaps.
- Filter and sort sessions by location, provider, urgency, or recency.
- Ask Luke about supported local sessions by voice or text.
- Send messages and supported controls only when you explicitly ask Luke to.
- Receive optional spoken announcements — with a pressable notice at the
  notch naming the session Luke is talking about — when a session needs you.
- View assigned Linear issues and, when asked, update their state or add a
  comment.

## Supported integrations

| Integration | Support | Credential required |
| --- | --- | --- |
| Claude Code | Local sessions | No |
| Codex | Local sessions | No |
| Conductor | Cloud sessions | Yes |
| GitHub Copilot | Cloud agent tasks | Yes |
| Cursor | Local and cloud sessions | Cloud only |
| Devin | Cloud sessions | Yes |
| Jules | Cloud sessions | Yes |
| OpenCode | Local sessions | No |
| Orca | Workspace context on local sessions | No |
| Linear | Assigned issues | Yes |
| Google Calendar | Meeting busy times | Yes (sign-in) |

Cloud integrations remain inactive until you add their credentials in Luke's
Settings. Voice and the optional attention review are included with the
signed-in account under a daily allowance; connecting your own OpenAI API key
lifts the allowance and runs both on that key instead.

## Calendar support

- Google Calendar — reads when your meetings start and end after you sign in,
  and sends Google nothing without a connected account.

Connect it in Settings under **Integrations**: press **Connect** beside Google
Calendar and the browser opens Google's own consent page. The grant asks for
two things only — your availability (`calendar.freebusy`) and your calendar
list — so Google answers Luke with busy intervals, and meeting titles cannot
even reach the machine. Several accounts can be connected side by side with
**Add account**, and under each account a checkbox per calendar chooses which
ones count. The project's registered client id stands in the source, and packaging a
release injects its secret from the release environment — so shipped builds
always offer the integration, while a bare checkout offers it once
`GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` is set (with
`GOOGLE_CALENDAR_OAUTH_CLIENT_ID` to develop against your own registration).
Register such a Desktop-app client in the **same Google Cloud project** as the
Luke sign-in's web client: Google's consent-screen branding — the app name,
logo, and links — is configured per project, so one project is what makes
both consent pages introduce themselves identically as Luke. The clients
themselves stay separate on purpose; see PRIVACY.md.

The meeting times are used for one thing: while a meeting is on, spoken
announcements wait, and once it ends the backlog is read out together — Luke's
face sleeps beside the housing for as long as the hold stands, so you can see
the quiet at a glance. The behavior is the **Quiet during meetings** switch
under the accounts, on by default and shown once a calendar is connected; the
panel keeps showing every session state throughout either way.

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

Luke never injects terminal input or simulates keystrokes. A message or a
provider-advertised control reaches a session only when you explicitly ask —
typed on its row, or requested of Luke in a conversation you opened.

## Talking to Luke

Voice works as soon as you sign in — the account includes a daily allowance —
and runs on your own OpenAI key once you connect one. Either way it is a real
voice session: your microphone audio goes to OpenAI, and Luke answers out
loud. Read [Privacy](PRIVACY.md) first — this is the one feature that sends
audio off your Mac.

Connect a key of your own in Settings, at the top of the **Voice** page: paste
the key and Luke takes it from there — no relaunch, and no terminal. It is
stored encrypted through the macOS Keychain, and the panel never
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

Luke observes provider state without changing provider transcripts or session
files. Its one provider-side write is an observation hook registered for
Claude Code and Codex in their own hook settings — it records a session's
status, never its conversation, and Codex asks you to trust it before it
runs. Local session data stays on your Mac unless you start a feature that
requires an external service. Messages, controls, workspace creation, and issue
updates run only when you explicitly request them, and Luke reads a local
session's transcript only when you ask about that session.

See [PRIVACY.md](PRIVACY.md) for the data sent by each optional integration and
how credentials are stored.

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
./scripts/run.sh
```

`./scripts/run.sh` replaces any running Luke instance by default and stops the
app when you press Control-C. Pass `--keep-running` to leave an existing
instance in place.

Run the complete macOS validation suite with:

```sh
./scripts/verify.sh
```

Run the website locally with:

```sh
pnpm --filter @luke/web dev
```

## Project structure

- `apps/desktop/` — Electron app, renderer, native macOS helper, and packaging
- `apps/web/` — public website
- `packages/sidecar-core/` — shared session and attention models
- `scripts/` — development and validation commands

## Contributing

See [WORKFLOW.md](WORKFLOW.md) for the issue-to-pull-request workflow.

## Documentation

- [Privacy details](PRIVACY.md)
- [Maintainer release guide](.github/RELEASE.md)

## License

Luke is licensed under the [Apache License 2.0](LICENSE).
