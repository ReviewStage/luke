# Planning: the voice planning journey and its window

This is the reference the Feature Planning MVP builds against (LUKE-331). It
fixes what the developer sees and hears, in order, from picking a GitHub
repository to copying a handoff prompt, and it names the existing piece of Luke
each part of the window is built from. It is a design, not an implementation:
the issues that build it (LUKE-334 document store, LUKE-337 Mac window,
LUKE-338 GitHub source tools, LUKE-340 GPT Live, LUKE-342 review and Copy) own
the code, the tests, and the `verify.sh` evidence.

The product decisions behind it are settled in the project specification and
are not reopened here. The two that shape everything below:

- **One saved document per named plan**, a Markdown `body` and an `assumptions`
  list of `{ text, confirmed }`, written only by the model through
  `update_plan({ body, assumptions })`. There are no versions, no stale-revision
  rejection, no approval state, and no export record.
- **The model drives the workflow.** Question choice, agreement, corrections,
  the final review, and the handoff live in the planning model's instructions.
  The window saves nothing of its own and decides nothing; it shows the saved
  document and the voice state.

## What the window is not

A reviewer can hold the build to these as easily as to the layout:

- No typed-chat composer and no typed fallback. The developer speaks; the only
  text fields are ordinary setup fields (the plan's name and the repository
  filter), and nothing typed into them reaches the model as conversation.
- No Approve button, no readiness meter, no progress or coverage score, no
  version history, no diff view, and no separate export or handoff screen.
- The assumption list is read-only. A checkbox cannot be clicked; its state is
  the model's `confirmed` flag, shown as a plain field.
- No conversation transcript pane. Captions show what is being said now; the
  document is the record.
- One visible document. There are no tabs, split views, or second documents.

## The window

A normal Mac window: titled, with traffic lights, resizable, in the Dock and
Cmd-Tab while it is open, closable with Cmd-W. It is the first such window
Luke has, so it is a new window class rather than a variant of the panel. The
panel gains one entry that opens it, and LUKE-337 decides where that entry
sits. Clicking the Dock tile while the window is open brings it forward.

```
┌─ ● ● ●  ─────────────────── Teammate invitations ───────────────────────────┐
│ PLANS             │  Teammate invitations                         [ Copy ]  │
│                   │  acme/relay · main @ 4f2c9e1                            │
│ ▸ Teammate        │ ─────────────────────────────────────────────────────── │
│   invitations     │                                                         │
│   acme/relay      │  # Teammate invitations                                 │
│                   │                                                         │
│   Billing export  │  ## Goal                                                │
│   acme/ledger     │  Let a workspace member invite a teammate by email...   │
│                   │                                                         │
│   Audit log       │  ## Recommendation                                      │
│   acme/relay      │  Reuse `memberships` with a `pending` state rather...   │
│                   │                                                         │
│                   │  ## Behavior                                            │
│                   │  1. An invited person opens the link...                 │
│                   │                                                         │
│                   │  ## Open questions                                      │
│                   │  - What happens to a pending invite when...             │
│                   │                                                         │
│                   │  ## Assumptions                                         │
│                   │  ☑ Members and admins can both invite.     Confirmed    │
│                   │  ☐ An invite expires after 7 days.     Not confirmed    │
│                   │                                                         │
│                   │ ─────────────────────────────────────────────────────── │
│ [ + New plan ]    │  (●) Listening   ▁▃▅▂▁      "So when access is removed, │
│                   │   ^ mic button   waveform     the pending invite..."    │
└───────────────────┴─────────────────────────────────────────────────────────┘
```

The window has three regions. The sidebar and the voice bar stay where they
are; only the document scrolls.

### Plan list (sidebar)

- Every named plan the account owns, most recently opened first. Each row
  shows the plan's name and its `owner/repository`, and the open plan is
  selected.
- Clicking a row opens that plan. It replaces the document and ends any call
  that belongs to the previous plan (see "Leaving and resuming").
- `New plan` at the foot opens the setup sheet.
- There is no rename, delete, archive, or search in this journey.

### Setup sheet (new plan)

A sheet attached to the window, with ordinary setup fields and buttons, and
nothing spoken:

1. **Connect GitHub**, shown only while the account has no repository
   connection. It is the account-bound GitHub connection LUKE-338 adds, and it
   is separate from GitHub sign-in, which asks for `read:user` and
   `user:email` alone.
2. **Name**, a single-line field such as "Teammate invitations".
3. **Repository**, a filterable list of the existing repositories the
   connection can read, private ones included. The filter narrows the list and
   nothing else.
4. **Start plan**, enabled once both fields are filled. Pressing it resolves
   the repository's default branch to one commit, then saves the plan with its
   name, `owner/repository`, default branch, and commit, and an empty
   document. If the resolution fails (access revoked, network, or an empty
   repository), the sheet stays open with the reason and the button can be
   pressed again.

That commit is the plan's source context for its whole life. Resuming reads the
same commit, and nothing refreshes it. The header shows it as
`acme/relay · main @ 4f2c9e1`. The commit is not a version of the plan.

### Header

- The plan's name.
- The repository line, as `owner/repository · branch @ short commit`.
- **Copy**, the one action on the document. It is always enabled, including
  before the handoff exists. It copies the current document as described in
  "Copy". It never launches an agent and never asks the model anything.

### Document

- The saved `body`, rendered as Markdown, followed by an `Assumptions` section
  drawn from the saved `assumptions` list.
- It is read-only and selectable, so Cmd-C on a selection works.
- When a save lands, the document redraws in place and keeps its scroll
  position. There is no diff, highlight, or animation of what changed.
- A new plan whose body is still empty shows one line in its place: "Press the
  microphone and describe the feature."
- Each assumption row is a disabled checkbox, the text, and a plain status
  field, `Confirmed` or `Not confirmed`. None of the three responds to a
  click. With no assumptions, the section is absent.
- If the saved document cannot be read, the region shows the failure and a
  `Try again` button. The window never draws a document it did not read.

### Voice bar

- **Microphone button.** One press starts talking to Luke about the open plan.
  The call opens if none stands, and the microphone opens. A second press
  mutes it. The microphone stays open between the two presses rather than
  only while a key is held, because a planning conversation runs for minutes.
  The existing talk key
  keeps its hold-to-talk meaning, and while the planning window is the key
  window it speaks into the open plan's call.
- **Status**, the one word `LIVE_STATUS` already names: `Connecting`,
  `Listening`, `Muted`, `Speaking` (Luke), or `Closing`. A `failed` or
  `unavailable` status shows the existing voice error or notice line in its
  place, with the button left able to try again.
- **Waveform**: the developer's and Luke's levels while the call stands.
- **Captions**: Luke's current words, and the developer's own words under the
  captions preference, replaced as speech moves on. Nothing is kept here; what
  matters lands in the document.
- **Thinking**: the thinking dots, while the planning model is working on a
  delegated question (reading files, researching, or saving) and Luke has
  nothing to say yet.

## The journey

The reference plan is "Teammate invitations" on a private repository,
`acme/relay`. Each step shows what the developer does, what Luke says (in
brief), and the document after the model's `update_plan`. Luke's lines are
illustrations of tone and order, not prompt text: LUKE-336 writes the
instructions.

### 1. Starting from a GitHub repository

The developer opens the planning window from the panel. They press
`New plan`, connect GitHub once, name the plan "Teammate invitations", pick
`acme/relay`, and press `Start plan`. The header reads
`acme/relay · main @ 4f2c9e1`, and the document shows its empty-state line.

They press the microphone and speak: "I want people to be able to invite a
teammate into their workspace by email."

The model browses `acme/relay` at `4f2c9e1` through GitHub's hosted
`get_file_contents` tool. The thinking dots show while it reads, and Luke says
only what it is doing: "Let me look at how workspaces and members work first."

### 2. A useful, opinionated recommendation

Luke comes back with a finding and a direction rather than a questionnaire:

> "You already have a `memberships` table with a `role` column, and sign-up in
> `src/auth/signup.ts` creates one. I'd add a `pending` state to memberships
> instead of a separate invitations table. An invite is then just a membership
> that hasn't been accepted, and removing access works the same way for both.
> Does that match how you think about it?"

The developer answers "Yes, that's simpler", and the model saves:

```markdown
# Teammate invitations

## Goal
A workspace member invites a teammate by email; the teammate joins the
workspace by opening the link.

## Recommendation
Model an invite as a `memberships` row with `state = pending` rather than a
separate invitations table (`src/db/schema/memberships.ts`), so accepting is a
state change and removal covers invites and members alike.

## Open questions
- Who may invite?
- What does an invited person see after their invite is withdrawn?
```

```json
[
  { "text": "Invites reuse `memberships` with a `pending` state.", "confirmed": true },
  { "text": "Only admins can invite teammates.", "confirmed": false }
]
```

The first assumption is confirmed because the developer answered a precise
proposal clearly. The second is Luke's working assumption, drawn from the
existing `role` check, and nobody has agreed to it, so it stays unconfirmed.

### 3. Concrete feature rehearsal

Luke rehearses behavior one question at a time, choosing the question whose
answer unlocks the most:

> "Picture this: Priya gets an invite, and before she opens it the admin
> removes it. She clicks the link. I'd show her a plain 'This invite is no
> longer valid' page and not tell her who withdrew it. OK?"

The developer agrees. The model adds a `## Behavior` section with the numbered
walk-through (the invite is sent, the link is opened, the invite is accepted,
the invite is withdrawn, the link is opened after withdrawal). It moves the
withdrawal question out of `Open questions` and adds
`{ text: "A withdrawn invite shows a generic invalid-invite page.", confirmed: true }`.
It also adds `{ text: "An invite expires after 7 days.", confirmed: false }` as
a recommended working assumption, which Luke names aloud as one.

### 4. A correction

The developer says: "Actually, no. Any member should be able to invite, not only
admins."

The model treats the correction first, before its own line of questioning:

- It rewrites the assumption to "Members and admins can both invite." and sets
  it to `confirmed: true`, because the developer's correction settles the new
  value.
- It updates the body wherever "admin" was assumed.
- It reopens the question the correction affects: "Then who can withdraw an
  invite: the member who sent it, any admin, or both?" It adds that question
  to `Open questions` until it is answered.

In the window, the row that read `☐ Only admins can invite teammates. Not
confirmed` now reads `☑ Members and admins can both invite. Confirmed`. No
flag other than the one the correction settled changes. Application code
tracks no dependency between answers.

### 5. Leaving and resuming

Mid-conversation, the developer closes the window. The call ends and the
microphone closes. Everything the model saved is already the plan's document,
so nothing is lost except the words of an unfinished sentence. A save the
model had not made is not in the document, and the window never claims
otherwise.

The next day they open the planning window. The plan list shows
"Teammate invitations" first. Selecting it draws the saved document with the
same `acme/relay · main @ 4f2c9e1`. They press the microphone, and the model
starts with the saved document and the plan's relevant conversation. Luke
picks up where they stopped:

> "Last time we'd agreed any member can invite. The open one was who can
> withdraw an invite. I'd say the sender or any admin. Does that work?"

Selecting a different plan while a call stands does the same as closing: that
plan's call ends before the other plan opens. Only one plan is ever the
spoken conversation.

### 6. The spoken final review

When the developer says "I think that's everything", Luke reviews the document
aloud before any handoff. It covers:

- every assumption still `Not confirmed`, one at a time ("I assumed invites
  expire after 7 days. Keep that?");
- anything left in `Open questions`;
- any contradiction between sections;
- the coding choices it proposes to leave to the implementing agent.

The developer confirms the expiry, and the model sets that flag to `true`. They
drop one open question as out of scope, and the model moves it under
`## Out of scope`. The review is conversation, not a screen: the window shows
only the document changing as the model saves. The developer may also choose to
leave an assumption unconfirmed, and it is carried into the handoff as a stated
working assumption.

### 7. The model writes the handoff into the same document

The developer asks: "OK, write the prompt." The model saves a body whose final
section is the handoff prompt. The plan above it stays, and the assumption list
is kept as it is:

```markdown
## Handoff prompt

You are implementing teammate invitations in `acme/relay`, at commit
`4f2c9e1` of `main`...

Goal, agreed scope, and out of scope...
Repository context: `src/db/schema/memberships.ts`, `src/auth/signup.ts`...
Behavior, step by step, including the withdrawn and expired invite cases...
Acceptance examples...
Left to you: routine internal choices such as naming, file layout, and the
email template's markup...
```

The prompt is self-contained. It makes sense to an agent that never heard the
conversation, names repository-relative paths and the commit, and carries no
credential or secret. Luke says it is written and that Copy takes the whole
document.

### 8. Copy

The developer presses `Copy`, and the button shows the check mark. The
clipboard holds the current document as readable Markdown: the body as saved,
then the assumption checklist:

```markdown
<body exactly as saved>

## Assumptions

- [x] Invites reuse `memberships` with a `pending` state.
- [x] Members and admins can both invite.
- [x] A withdrawn invite shows a generic invalid-invite page.
- [x] An invite expires after 7 days.
```

This is direct formatting of the saved document, not a second model step. It
is the same whether or not the review or the handoff has happened. They paste
it into the coding agent of their choice. If they later ask Luke for one more
change, the model updates the same document, and Copy copies the new one.

## Failures the developer sees

- **Microphone or connection.** The existing voice error and notice lines
  appear in the voice bar in place of the status word ("the microphone is not
  allowed yet", "Voice is temporarily unavailable"). The microphone button
  retries.
- **Save.** A failed `update_plan` is the model's result to act on, so Luke
  says the change did not save and tries again. The window keeps showing the
  last saved document and never shows an unsaved one.
- **Repository.** A failed or incomplete read is reported to the model as
  such. Luke says it could not read the file and never describes unread code
  as inspected. If access is revoked, the reads fail the same way. Starting a
  new plan shows the reason in the setup sheet.
- **Loading a plan.** The document region shows the failure and `Try again`.

## What each part reuses

This section records where each part comes from. The owning issue may choose
the exact shape.

| Part | Reuse | New |
| --- | --- | --- |
| Window class | `hardenedWebPreferences` and `refuseForeignNavigation` (`apps/desktop/src/main/window/hardened-window.ts`); wiring beside the panel in `createWindowService` (`apps/desktop/src/main/services/window-service.ts`) | A titled, resizable `BrowserWindow` class beside `PanelManager` and `VoiceWindow` (LUKE-337). It must not call `dressMacWindow`: that helper hides the traffic lights, keeps the window off Mission Control, and pins it stationary. |
| Dock and Cmd-Tab | `DockPresence` (`dock-presence.ts`) | The app runs under the `accessory` activation policy with `Menu.setApplicationMenu(null)` (`apps/desktop/src/main/main.ts`). While the window is open it needs the Dock tile, and a minimal app menu with the standard Edit and Window roles so Cmd-C and Cmd-W work (LUKE-337). |
| Window role | `WINDOW_ROLE` (`apps/desktop/src/shared/messages/session.ts`) and the role branch in `apps/desktop/src/renderer/index.tsx` | A planning role that mounts the planning surface. |
| Acts | `ACT_KIND`, `act-router.ts`, `ActSender`, `registerDesktopIpc` | A sender flag for the planning window. The panel-only rows keep refusing it. New rows only for the plan list, opening a plan, and starting a plan. |
| Plan list and setup sheet | `@sidecar/panel` controls and the existing button, field, and row styles | The sidebar, the sheet, and the repository list read from the GitHub connection (LUKE-337, LUKE-338). |
| GitHub connection | `ConsentConnectSlot` (`apps/desktop/src/renderer/consent-connect-slot.tsx`) and `useConnections` (`use-connections.ts`), the pattern the calendar consent uses | The repository connection itself, with its scopes and token held in connection handling and never in the renderer or a model-visible argument (LUKE-338). |
| Document body | `MarkdownMessage` (`apps/desktop/src/renderer/markdown-message.tsx`): `react-markdown` with `remark-gfm`, raw HTML not rendered, only `http`/`https` links kept; `styles/markdown.css` | A document-scale style for it. |
| Assumption checklist | None; it is drawn from `assumptions`, not from Markdown | A row with a disabled checkbox, the text, and the status field. |
| Copy | `ConversationCopyButton`'s pattern (`conversation-copy.tsx`), `ACT_KIND.WINDOW_COPY_TEXT`, and the clipboard row in `register-desktop-ipc.ts` | The document formatter: body, then `## Assumptions` as `- [x]` / `- [ ]` lines (LUKE-342). |
| Voice state | `VoiceView` and `VOICE_COMMAND` (`apps/desktop/src/shared/messages/voice-view.ts`), which main already forwards unchanged to every panel; `useVoiceView`, `voiceErrorToShow`, `voiceNoticeToShow` (`use-voice-view.ts`); `LIVE_STATUS` (`@sidecar/live`) | Forwarding the same snapshot to the planning window. |
| Captions | `LiveCaptions` (`renderer/voice/live-captions.ts`), `captionSegments` (`caption-layout.ts`), and `useCaptionPresentation` for which of Luke's words show | A bar-shaped caption layout. The panel's sizing is not reused. |
| Levels and thinking | `Waveform`, `waveformLive` (`waveform.tsx`); `ThinkingDots` (`thinking-dots.tsx`) | None. |
| Microphone and notices | `microphoneAccessRow`, `voiceAttentionNote`, `MICROPHONE_UNGRANTED_NOTE`, `hostedVoiceUnavailableNote` (`microphone-access.ts`) | None. |
| The call | The hidden `VoiceWindow` and `VoiceHost` / `useVoiceSession` / `LiveCall` (`renderer/voice/`); `LiveVoiceOrchestrator` (`@sidecar/voice`); the sessions route `/api/voice/sessions` with client delegation | The call is associated with the open plan, and the orchestrator gains the planning window's toggle beside the held talk key (LUKE-340). |
| Planning model and document | Hosted storage and the brain host (`apps/web/server/hosted/`); the account client (`packages/hosted`, `packages/credentials`) | The plan record and `update_plan` (LUKE-334), the instructions (LUKE-336), and research (LUKE-339). |

Two existing rules carry over unchanged:

- **Session replay.** The panel is the one surface that records
  (`apps/desktop/src/renderer/session-replay.ts`, called from `App`). The
  planning window mounts its own surface and does not call
  `applySessionReplay`.
- **Secrets.** No credential or account secret enters the document, a caption,
  a counted event, or a trace. The GitHub token lives in connection handling,
  and the model is told to keep secrets out of the plan and the prompt.
  Nothing scans for this, so each owning issue holds it by construction.

## Known limitations and validation

This section records what the MVP was checked against when it was
integrated (LUKE-346) and what it was not. It records results only. It
changes when a check is run, not when one is planned.

### Validated

- `./scripts/check.sh` exits 0 on the integrated branch, on Linux. That run
  covers repository checks, types, lint, the hermetic unit and store tests,
  and the builds.
- The journey is held by hermetic tests at the model and transport
  boundaries (fake OpenAI, fake eve, scripted model, fake GitHub MCP, PGlite):
  - starting a plan at a resolved commit, and reads at that commit;
  - `update_plan` saves, and the window's host follow draws them within one
    beat;
  - a spoken turn reaching the planning model in the plan's own
    conversation, with the saved document on every turn;
  - re-attaching and resuming on the same plan;
  - switching plans ends the old plan's call, and the new plan is active
    before that call has finished closing;
  - the final review and the handoff written into the same document;
  - Copy's Markdown, at the store's largest document;
  - the talk key, pressed while the planning window holds the keyboard,
    speaking into the open plan's call.
- The planning window's regions render as static markup in tests: a
  read-only checklist, no composer and no approve controls, and the empty,
  failed, missing, and not-connected states.

### Not validated

- **A real Mac.** This Linux VM has no Mac, CI builds nothing for one, and
  `./scripts/verify.sh` has not been run on the integrated application. The
  normal window chrome, the Dock tile and Cmd-Tab, Cmd-W and Cmd-C, the menu
  handing over between the planning window and the panel, and the voice bar
  during a call have never been seen running. `./scripts/evidence.sh` now
  captures the planning window over a synthetic plan
  (`app-smoke-planning.png`, from `--profile planning`), but that capture has
  not been taken yet.
- **Real voice.** No spoken planning conversation has run against GPT Live:
  ordinary assent, interruption, a continuing answer, a correction, resuming,
  and switching plans by voice are untested outside the fakes.
- **A live GitHub connection.** No repository has been read through GitHub's
  hosted MCP service outside the fake.

### Known limitations

- **GitHub is not connected in production.** The plan, repository, and brain
  routes run on `githubAccessWithoutConnections`
  (`apps/web/server/hosted/github-source.ts`), which answers `not-connected`,
  and the desktop's Connect GitHub press is refused ("Connecting GitHub from
  Luke is not available yet"). So a deployed build cannot list repositories,
  start a plan, or read a file. How a developer authorizes repository reads
  is waiting on a product decision and will land as a separate LUKE-338
  follow-up, with its `PRIVACY.md` disclosures.
- **No thinking dots in the voice bar.** Nothing on the Mac hears that the
  planning model is working on a delegated question. The sessions route
  forwards `session.delegation.created`, but the host's live session holder
  does not report it, so the planning window passes `thinking={false}`.
  Luke's own spoken "let me look" is the only sign of work in progress.
- **`read_web_page` checks addresses without pinning them.** Every host the
  read reaches, and every redirect hop, is resolved and refused unless all of
  its addresses are public unicast. The check is a lookup ahead of the
  request, though, and the socket is not pinned to the checked address. A
  host whose DNS answer changes between the lookup and the connection (DNS
  rebinding) is the one case it does not cover.
- **Updates are polled.** While the window is open the host re-reads the plan
  list every 3 seconds, and re-reads the document when its `updatedAt`
  moves. A save shows up within about one beat, not instantly.
