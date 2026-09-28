# Planning: the voice planning journey and the Plans tab

This is the reference the Feature Planning MVP builds against (LUKE-331). It
fixes what the developer sees and hears, in order, from picking a GitHub
repository to copying a handoff prompt, and it names the existing piece of Luke
each part of the Plans tab is built from. It is a design, not an
implementation: the issues that build it (LUKE-334 document store, LUKE-337 the
first Mac surface, LUKE-347 its move into the panel, LUKE-338 GitHub source
tools, LUKE-340 GPT Live, LUKE-342 review and Copy) own the code, the tests,
and the `verify.sh` evidence.

The product decisions behind it are settled in the project specification and
are not reopened here. The two that shape everything below:

- **One saved document per named plan**, a Markdown `body` and an `assumptions`
  list of `{ text, confirmed }`, written only by the model through
  `update_plan({ body, assumptions })`. There are no versions, no stale-revision
  rejection, no approval state, and no export record.
- **The model drives the workflow.** Question choice, agreement, corrections,
  the final review, and the handoff live in the planning model's instructions.
  The tab saves nothing of its own and decides nothing; it shows the saved
  document and the voice state.

## What the tab is not

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
- One visible document. There are no split views or second documents.
- No window of its own. Planning lives in the notch panel (LUKE-347): there is
  no separate planning window, Dock tile, Cmd-Tab entry, or app menu for it.

## The Plans tab

Planning is the panel's fourth tab, `Plans`, between `Conversation` and
`Settings`. It draws inside the panel's own frame (620 wide, at most 520
tall, the expanded window every tab shares), one page at a time, the way the
Conversation tab turns between its thread and its agents:

```
 ┌──────────────────────────────────────────────────────────────┐
 │  Sessions   Conversation   [ Plans ]   Settings              │
 │  ‹  Teammate invitations                          [ Copy ]   │
 │     acme/relay · main @ 4f2c9e1                              │
 │ ──────────────────────────────────────────────────────────── │
 │  # Teammate invitations                          (scrolls)   │
 │  ## Goal                                                     │
 │  Let a workspace member invite a teammate by email...        │
 │  ## Open questions                                           │
 │  - What happens to a pending invite when...                  │
 │  ## Assumptions                                              │
 │  ☑ Members and admins can both invite.        Confirmed      │
 │  ☐ An invite expires after 7 days.        Not confirmed      │
 │ ──────────────────────────────────────────────────────────── │
 │  (●)  Listening                                              │
 │  "So when access is removed, the pending invite..."          │
 └──────────────────────────────────────────────────────────────┘
          ^ the panel's own caption strip, at its foot
```

- **List page**: the tab's front page, with no plan open.
- **New plan page**: the setup fields, opened from the list.
- **Document page**: the open plan's saved document. Its header and its
  microphone row hold still, and only the document scrolls between them.

Escape unwinds one page at a time, after any open microphone has been muted
(Escape mutes first, as it does for any call): the document page back to the
list, which leaves the plan, the new-plan page back to the list, and the list
to the Sessions tab. The panel with no plan open is the desk exactly as it was.

### Opening, leaving, and the talk key

- Opening a plan, from the list or by starting one, makes it the host's one
  **active plan**, and every panel's Plans tab shows it on its document page.
- A plan stays open while the developer turns to another tab or the panel
  closes to the capsule, so a call about it goes on. The capsule and the peek
  draw a planning call exactly as any call: Luke's face, the waveform in the
  wings, and the captions under the shape. They carry no plan name.
- A plan is left by Back (`‹`) or Escape on its document page, by opening
  another plan, or by a sign-out. Leaving ends the plan's call; opening
  another plan ends the old plan's call before the new one is active in any
  call (LUKE-346). Only one plan is ever the spoken conversation.
- While a plan is open, the talk key speaks into that plan's call, whatever
  the panel is showing. With no plan open, it is the desk's talk key.
- The host follows the service (the list every 3 seconds, and the document
  when it moved) only while a panel shows the Plans tab. Leaving the tab
  pauses the follow and leaves the plan and its call standing; coming back
  reads everything again.

### Plan list

- Every named plan the account owns, most recently opened first. Each row
  shows the plan's name and its `owner/repository`.
- Clicking a row opens that plan on the document page (see "Leaving and
  resuming").
- `New plan` at the head of the list opens the new-plan page.
- There is no rename, delete, archive, or search in this journey.

### New plan

A page of ordinary setup fields and buttons under a `‹ New plan` header, and
nothing spoken:

1. **Connect GitHub**, shown only while the account has no repository
   connection. It is the account-bound GitHub connection LUKE-338 adds, and it
   is separate from GitHub sign-in, which asks for `read:user` and
   `user:email` alone.
2. **Plan name**, a single-line field whose placeholder, "e.g. Dark mode
   toggle", reads as an example to replace rather than a filled value.
3. **Repository**, a filterable list of the existing repositories the
   connection can read, private ones included. The filter narrows the list and
   nothing else.
4. **Start plan**, enabled once both fields are filled. Pressing it resolves
   the repository's default branch to one commit, then saves the plan with its
   name, `owner/repository`, default branch, and commit, and an empty
   document, and opens it. If the resolution fails (access revoked, network,
   or an empty repository), the page stays open with the reason and the
   button can be pressed again.

That commit is the plan's source context for its whole life. Resuming reads the
same commit, and nothing refreshes it. The header shows it as
`acme/relay · main @ 4f2c9e1`. The commit is not a version of the plan.

### Header

- `‹`, back to the list, which leaves the plan.
- The plan's name.
- The repository line, as `owner/repository · branch @ short commit`.
- **Copy**, the one action on the document. It is always enabled, including
  before the handoff exists. It copies the current document as described in
  "Copy". It never launches an agent and never asks the model anything.

### Document

- The saved `body`, rendered as Markdown, followed by an `Assumptions` section
  drawn from the saved `assumptions` list.
- It is read-only and selectable, so a selection can be copied.
- When a save lands, the document redraws in place and keeps its scroll
  position. There is no diff, highlight, or animation of what changed.
- A new plan whose body is still empty shows one line in its place: "Press the
  microphone and describe the feature."
- Each assumption row is a disabled checkbox, the text, and a plain status
  field, `Confirmed` or `Not confirmed`. None of the three responds to a
  click. With no assumptions, the section is absent.
- If the saved document cannot be read, the region shows the failure and a
  `Try again` button. The tab never draws a document it did not read.

### Microphone row and the panel's voice

- **Microphone button.** One press starts talking to Luke about the open plan.
  The call opens if none stands, and the microphone opens. A second press
  mutes it. The microphone stays open between the two presses rather than
  only while a key is held, because a planning conversation runs for minutes.
  The existing talk key keeps its hold-to-talk meaning, and speaks into the
  open plan's call.
- **Status**, beside the button: the one word `LIVE_STATUS` already names,
  `Connecting`, `Listening`, `Muted`, `Speaking` (Luke), or `Closing`, while
  a call about this plan stands, and the button's own label otherwise.
- **Everything else is the panel's own.** The waveform is the wings', the
  captions (Luke's current words, and the developer's own under the captions
  preference) ride the panel's caption strip at its foot, and a voice error
  or notice takes that strip exactly as it does for any call, with the button
  left able to try again. Nothing is kept here; what matters lands in the
  document.

## The journey

The reference plan is "Teammate invitations" on a private repository,
`acme/relay`. Each step shows what the developer does, what Luke says (in
brief), and the document after the model's `update_plan`. Luke's lines are
illustrations of tone and order, not prompt text: LUKE-336 writes the
instructions.

### 1. Starting from a GitHub repository

The developer opens the panel's Plans tab. They press
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

In the Plans tab, the row that read `☐ Only admins can invite teammates. Not
confirmed` now reads `☑ Members and admins can both invite. Confirmed`. No
flag other than the one the correction settled changes. Application code
tracks no dependency between answers.

### 5. Leaving and resuming

Mid-conversation, the developer presses `‹` back to the plan list. The call
ends and the microphone closes. Everything the model saved is already the
plan's document, so nothing is lost except the words of an unfinished
sentence. A save the model had not made is not in the document, and the tab
never claims otherwise. Turning to another tab or letting the panel close does
not leave the plan: the call goes on under the capsule.

The next day they open the Plans tab. The plan list shows
"Teammate invitations" first. Selecting it draws the saved document with the
same `acme/relay · main @ 4f2c9e1`. They press the microphone, and the model
starts with the saved document and the plan's relevant conversation. Luke
picks up where they stopped:

> "Last time we'd agreed any member can invite. The open one was who can
> withdraw an invite. I'd say the sender or any admin. Does that work?"

Selecting a different plan while a call stands does the same as leaving: that
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
`## Out of scope`. The review is conversation, not a screen: the tab shows
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
  appear in the panel's caption strip, as for any call ("the microphone is not
  allowed yet", "Voice is temporarily unavailable"). The microphone button
  retries.
- **Save.** A failed `update_plan` is the model's result to act on, so Luke
  says the change did not save and tries again. The tab keeps showing the
  last saved document and never shows an unsaved one.
- **Repository.** A failed or incomplete read is reported to the model as
  such. Luke says it could not read the file and never describes unread code
  as inspected. If access is revoked, the reads fail the same way. Starting a
  new plan shows the reason on the new-plan page.
- **Loading a plan.** The document region shows the failure and `Try again`.

## What each part reuses

This section records where each part comes from. The owning issue may choose
the exact shape.

| Part | Reuse | New |
| --- | --- | --- |
| The tab | The panel's tab bar and its page idiom (`panel-tabs.tsx`, `panel-body.tsx`; the Conversation tab's pages in `agents-panel.tsx`); `APP_PANEL_TAB` in `@sidecar/guide`, which the tab bar and the counted `panel:tab_change` share | `PLANS` in `APP_PANEL_TAB` and the counted tab set; the tab's pages (`renderer/planning/plans-panel.tsx`) and its control (`use-plans-tab.ts`) (LUKE-347). |
| Acts | `ACT_KIND`, `act-router.ts`, `ActSender`, `registerDesktopIpc` | Rows a panel alone may send, refusing the voice window and the takeover: the plan list and its follow and pause, opening, leaving, and starting a plan, the repositories, Connect GitHub, and the microphone. |
| Plan list and new-plan page | `@sidecar/panel` controls and the existing button, field, and row styles | The list, the form, and the repository list read from the GitHub connection (LUKE-337, LUKE-338). |
| GitHub connection | `ConsentConnectSlot` (`apps/desktop/src/renderer/consent-connect-slot.tsx`) and `useConnections` (`use-connections.ts`), the pattern the calendar consent uses | The repository connection itself, with its scopes and token held in connection handling and never in the renderer or a model-visible argument (LUKE-338). |
| Document body | `MarkdownMessage` (`apps/desktop/src/renderer/markdown-message.tsx`): `react-markdown` with `remark-gfm`, raw HTML not rendered, only `http`/`https` links kept; `styles/markdown.css` | A document-scale style for it. |
| Assumption checklist | None; it is drawn from `assumptions`, not from Markdown | A row with a disabled checkbox, the text, and the status field. |
| Copy | `ConversationCopyButton`'s pattern (`conversation-copy.tsx`), `ACT_KIND.WINDOW_COPY_TEXT`, and the clipboard row in `register-desktop-ipc.ts` | The document formatter: body, then `## Assumptions` as `- [x]` / `- [ ]` lines (LUKE-342). |
| Voice state | `VoiceView` and `VOICE_COMMAND` (`apps/desktop/src/shared/messages/voice-view.ts`), which main already forwards unchanged to every panel; `useVoiceView` (`use-voice-view.ts`); `LIVE_STATUS` (`@sidecar/live`) | The status word beside the microphone, for the open plan's call alone. |
| Captions, levels, errors | The panel's caption strip (`useCaptionPresentation`, `caption-layout.ts`) and the wings' waveform (`notch-wings.tsx`), unchanged | None. |
| Microphone and notices | `microphoneAccessRow`, `voiceAttentionNote`, `MICROPHONE_UNGRANTED_NOTE`, `hostedVoiceUnavailableNote` (`microphone-access.ts`) | None. |
| The call | The hidden `VoiceWindow` and `VoiceHost` / `useVoiceSession` / `LiveCall` (`renderer/voice/`); `LiveVoiceOrchestrator` (`@sidecar/voice`); the sessions route `/api/voice/sessions` with client delegation | The call is associated with the open plan, and the orchestrator gains the Plans tab's toggle beside the held talk key (LUKE-340); the talk key names the open plan while one is open (LUKE-347). |
| Planning model and document | Hosted storage and the brain host (`apps/web/server/hosted/`); the account client (`packages/hosted`, `packages/credentials`) | The plan record and `update_plan` (LUKE-334), the instructions (LUKE-336), and research (LUKE-339). |

Two existing rules carry over unchanged:

- **Session replay.** The panel is the one surface that records
  (`apps/desktop/src/renderer/session-replay.ts`, called from `App`), and the
  Plans tab is part of it: every word it draws is masked, as the rest of the
  panel's are, so what leaves the machine is the tab's layout and never the
  plan's words. It draws them with the panel's own text, fields, and
  attributes, and no new way of drawing words.
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
  - `update_plan` saves, and the host's follow draws them within one beat;
  - a spoken turn reaching the planning model in the plan's own
    conversation, with the saved document on every turn;
  - re-attaching and resuming on the same plan;
  - switching plans ends the old plan's call, and the new plan is active
    before that call has finished closing;
  - the final review and the handoff written into the same document;
  - Copy's Markdown, at the store's largest document;
  - the talk key, pressed while a plan is open, speaking into the open
    plan's call.
- The Plans tab (LUKE-347) is held by renderer tests: the tab bar's four
  tabs, the list and document pages, Back leaving the plan, the follow
  armed while the tab shows and paused when it goes, and the host keeping
  the open plan through a pause and following the list after a plan is left.
  Its regions render as static markup: a read-only checklist, no composer and
  no approve controls, and the empty, failed, missing, and not-connected
  states.

### Not validated

- **A real Mac.** This Linux VM has no Mac, CI builds nothing for one, and
  `./scripts/verify.sh` has not been run on the integrated application. The
  Plans tab in the panel, the document scrolling inside the panel's ceiling,
  the microphone row, and the capsule and captions during a planning call
  have never been seen running. `./scripts/evidence.sh` captures the panel
  expanded on the Plans tab over a synthetic plan
  (`app-smoke-planning.png`, from `--profile planning --expanded`), but that
  capture has not been taken yet.
- **Real voice.** No spoken planning conversation has run against GPT Live:
  ordinary assent, interruption, a continuing answer, a correction, resuming,
  and switching plans by voice are untested outside the fakes.
- **A live GitHub connection.** No repository has been connected or read
  through GitHub's OAuth App and hosted MCP service outside the fakes.

### Known limitations

- **GitHub's `repo` scope is broader than Luke's use.** The Connect GitHub
  step (`/connect-github.html`, opened by the new-plan page) links GitHub to the
  Luke account under the existing OAuth App with the classic `repo` scope,
  which grants read and write to every repository the developer can reach.
  Luke only reads, through GitHub's read-only MCP endpoint, but the token
  itself could write. Its `PRIVACY.md` disclosures are waiting on a product
  decision.
- **Connecting on a Preview.** A Preview's link goes through production's
  registered callback on the OAuth proxy, as sign-in does, and lands on the
  Preview's signed-in user (`apps/web/server/README.md`, the OAuth proxy);
  it is held end to end against a fake GitHub in
  `apps/web/tests/auth-proxy-link.test.ts` and has not yet been exercised
  against a deployed Preview.
- **No thinking dots for the planning model.** Nothing on the Mac hears that
  the planning model is working on a delegated question. The sessions route
  forwards `session.delegation.created`, but the host's live session holder
  does not report it, so the Plans tab draws no dots. Luke's own spoken "let
  me look" is the only sign of work in progress.
- **`read_web_page` checks addresses without pinning them.** Every host the
  read reaches, and every redirect hop, is resolved and refused unless all of
  its addresses are public unicast. The check is a lookup ahead of the
  request, though, and the socket is not pinned to the checked address. A
  host whose DNS answer changes between the lookup and the connection (DNS
  rebinding) is the one case it does not cover.
- **Updates are polled.** While a panel shows the Plans tab the host re-reads the plan
  list every 3 seconds, and re-reads the document when its `updatedAt`
  moves. A save shows up within about one beat, not instantly.
