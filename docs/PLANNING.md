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
  list of `{ text }`, written only by the model through
  `update_plan`. The body is always the one fixed template (LUKE-352, "The
  fixed template" below): the model sends every field of it on every call,
  and the service formats them into the body. There are no versions, no
  stale-revision rejection, no approval state, and no export record.
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
- The assumption list is read-only: plain text, with nothing to click.
- No conversation transcript pane. Captions show what is being said now; the
  document is the record.
- One visible document. There are no split views or second documents.
- No window of its own. Planning lives in the notch panel (LUKE-347): there is
  no separate planning window, Dock tile, Cmd-Tab entry, or app menu for it.

## The Plans tab

Planning is the panel's first tab, `Plans`, beside `Settings`, and the tab
the panel opens on. The Sessions and Conversation tabs are hidden for now
(LUKE-350): they are out of the tab bar and nothing opens them, not a key, a
press, a composer's return, or a collapse, while the desk services, stores,
and hosted endpoints behind them stand, so they come back by returning them
to `APP_PANEL_TAB` and the bar's list in `panel-tabs.tsx`. The tab draws
inside the panel's own frame (620 wide, at most 520 tall, the expanded window
every tab shares), one page at a time:

```
 ┌──────────────────────────────────────────────────────────────┐
 │  [ Plans ]   Settings                                        │
 │  ‹  Teammate invitations                          [ Copy ]   │
 │     acme/relay · main @ 4f2c9e1                              │
 │ ──────────────────────────────────────────────────────────── │
 │  # Teammate invitations                          (scrolls)   │
 │  Repository: acme/relay, branch main at commit 4f2c9e1...    │
 │  ## Purpose and users                                        │
 │  ### Problem                                                 │
 │  Only an admin can add someone to a workspace...             │
 │  ### Outcome                                                 │
 │  Unanswered                                                  │
 │  ...  (every section of the template, in order)              │
 │  ## Open questions                                           │
 │  - Who can withdraw an invite...                             │
 │  ## Handoff prompt                                           │
 │  Not prepared                                                │
 │  ## Assumptions                                              │
 │  - Members and admins can both invite.                       │
 │  - An invite expires after 7 days.                           │
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
closes the panel. Escape on the Settings tab's front page comes back to Plans,
and the panel closing to the capsule turns it back to Plans as well.

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
   name, `owner/repository`, default branch, and commit, and the untouched
   template as its document, and opens it. If the resolution fails (access revoked, network,
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
  drawn from the saved `assumptions` list. The body is the fixed template, so
  every section and field shows from the moment the plan starts, an
  unanswered field as "Unanswered".
- It is read-only and selectable, so a selection can be copied.
- When a save lands, the document redraws in place and keeps its scroll
  position. There is no diff, highlight, or animation of what changed.
- Each assumption is a plain bulleted row with its text, and nothing in it
  responds to a click. With no assumptions, the section stands and reads
  "None recorded".
- If the saved document cannot be read, the region shows the failure and a
  `Try again` button. The tab never draws a document it did not read.

### The fixed template

Every plan uses one fixed template (LUKE-352). There is no configurable
template, no sections map, and no freeform body argument: `update_plan`'s
arguments are exactly the sections below, every named field is required on
every call, drafts included, and a call missing a field, naming one the
template does not, sending a freeform `body`, or carrying a blank answer is
refused with the offending field's path and saves nothing. The typed
arguments are an input format only. The service formats them into the
canonical Markdown `body` (`packages/hosted/src/plan-template.ts`), checks
the formatted body against its bound, and saves the same `{ body,
assumptions }` document as before; no code parses the body back, and the
model reads the canonical Markdown on its next turn.

| Section | Fields | What Luke establishes |
| --- | --- | --- |
| Purpose and users | `purpose.problem`, `users`, `outcome` | The current problem, who is affected, and the observable improvement. |
| Scope | `scope.included`, `excluded`, `constraints` | What is in, what is explicitly out, and material limits. |
| Existing system | `context.currentBehavior`, `relevantCode`, `terminology` | What happens today and the paths read at the plan's commit, facts kept apart from hypotheses and proposed changes. |
| Behavior | `behavior.rules`, `invariants`, `scenarios` | Rules, what must stay true across success, failure, cancellation, and retry, and concrete rehearsals. |
| Data and interfaces | `dataAndInterfaces.dataRules`, `interfaces` | Data ownership, validation, lifecycle, and affected contracts with their failure behavior. |
| Quality requirements | `quality.permissionsAndPrivacy`, `usabilityAndAccessibility`, `performanceAndReliability` | Applicable expectations with cited or agreed bounds, never invented to fill a field. |
| Implementation guidance | `delivery.approach`, `decisions`, `stepsAndDependencies`, `risksAndMitigations`, `compatibilityAndMigration`, `rolloutAndRecovery`, `delegatedChoices` | The approach, each consequential decision with its reason, alternative, and accepted cost, ordered steps with prerequisites, material risks with mitigations, and the freedom left to the implementing agent. |
| Acceptance | `acceptance.examples`, `verification` | Concrete examples and the checks that establish the important rules and invariants, with what each proves. |
| Open questions | `openQuestions` | What is still unresolved. |
| Handoff prompt | `handoffPrompt` | The self-contained prompt, written only after the spoken review. |
| Assumptions | `assumptions` | The existing `{ text }` list. |

- **Types.** An ordinary field is `null` or nonblank text, and `null` is the
  only way to leave it unanswered; it renders as "Unanswered". A scenario is
  exactly its name, actor, starting state, trigger, steps (null or a nonempty
  ordered list), expected outcome, and alternatives and failures; an
  acceptance example is exactly `given`, `when`, and `then`. Both lists are
  null until one is identified. `openQuestions` is always a list, rendering
  "No additional questions recorded" while empty, and `handoffPrompt` is null
  until prepared, rendering "Not prepared".
- **Order and containment.** The formatter owns every heading and its order,
  so the body's order is the template's whatever order a call's keys arrive
  in. Field text is contained where it stands: a line that would open a
  heading or an HTML block is escaped, and a code fence left open is closed
  at the end of its field, so no answer can impersonate a section or swallow
  the ones after it.
- **A new plan** is the template with every field unanswered, no open
  question, no handoff, and no assumption. Luke reads that untouched template
  as a new plan and greets the developer; opening saves nothing.
- **Saving and resuming** go through the same whole-document save, so a plan
  written in the template resumes with its answers and its flags intact.
- **Structure is the tool's; agreement is the model's.** The schema
  guarantees that every field is present and well formed, not that an answer
  is understood, true, or agreed. Resolving each field, or agreeing an
  explicit "Not applicable: <reason>" or a bounded delegation, is Luke's
  work, and every proposal Luke adds (a default, an invariant, a decision, a
  risk accepted, an exclusion, a non-applicable field, a delegated choice) is
  recorded as an assumption.
  Purpose, behavior, and acceptance can never be set aside as not applicable.
  A populated template is not evidence that the developer agreed.

The field selection is a Luke product decision informed by Microsoft ISE's
[feature/story](https://microsoft.github.io/code-with-engineering-playbook/design/design-reviews/recipes/templates/feature-story-design-review/)
and [task](https://microsoft.github.io/code-with-engineering-playbook/design/design-reviews/recipes/templates/template-task-design-review/)
design-review templates, the design-doc practice in
[Software Engineering at Google](https://abseil.io/resources/swe-book/html/ch10.html#design_docs)
and the [React RFC template](https://github.com/reactjs/rfcs/blob/main/0000-template.md),
the [TensorFlow](https://github.com/tensorflow/community/blob/master/rfcs/yyyymmdd-rfc-template.md)
and [Fuchsia](https://fuchsia.googlesource.com/fuchsia/+/refs/heads/main/docs/contribute/governance/rfcs/TEMPLATE.md)
RFC templates, AWS's [formal-methods experience report](https://lamport.azurewebsites.net/tla/formal-methods-amazon.pdf)
(adapted to plain-language invariants), Microsoft's
[trade-study template](https://microsoft.github.io/code-with-engineering-playbook/design/design-reviews/trade-studies/template/)
and [arc42](https://arc42.org/overview/), NASA's
[requirements checklist](https://www.nasa.gov/reference/appendix-c-how-to-write-a-good-requirement/),
and [Cockburn's use cases](https://www.cs.otago.ac.nz/coursework/cosc461/weucx.pdf),
[Example Mapping](https://cucumber.io/blog/bdd/example-mapping-introduction/), and
[EARS](https://alistairmavin.com/ears/). None of them validates these exact
fields or a voice model; comparative evaluations are outside this work.

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
`acme/relay · main @ 4f2c9e1`, and the document shows the untouched template,
every field "Unanswered". Luke greets them first.

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

The developer answers "Yes, that's simpler", and the model saves every field
of the template, most of them still null. The body it becomes reads, in part:

```markdown
# Teammate invitations

Repository: acme/relay, branch main at commit 4f2c9e1...

## Purpose and users

### Problem

Only an admin can add someone to a workspace, by creating their account by hand.

### Users

Workspace members, and the teammates they invite.

### Outcome

A member invites a teammate by email; the teammate joins by opening the link.

...

## Implementation guidance

### Approach

_Unanswered_

### Decisions

Model an invite as a `memberships` row with `state = pending` rather than a
separate invitations table (`src/db/schema/memberships.ts`), so removal covers
invites and members alike. Alternative: an `invitations` table. Accepted cost:
pending rows appear in membership queries.

...

## Open questions

- Who may invite?
- What does an invited person see after their invite is withdrawn?

## Handoff prompt

_Not prepared_
```

```json
[
  { "text": "Invites reuse `memberships` with a `pending` state." },
  { "text": "Only admins can invite teammates." }
]
```

The first came from the developer's clear answer to a precise proposal. The
second is Luke's working assumption, drawn from the existing `role` check.

### 3. Concrete feature rehearsal

Luke rehearses behavior one question at a time, choosing the question whose
answer unlocks the most:

> "Picture this: Priya gets an invite, and before she opens it the admin
> removes it. She clicks the link. I'd show her a plain 'This invite is no
> longer valid' page and not tell her who withdrew it. OK?"

The developer agrees. The model fills `behavior.scenarios` with the
rehearsal (its actor, starting state, trigger, the numbered steps, the
expected outcome, and the withdrawn-invite failure), and states the invariant
it implies: a withdrawn or accepted link never grants access again. It moves
the withdrawal question out of `Open questions` and adds
`{ text: "A withdrawn invite shows a generic invalid-invite page." }`.
It also adds `{ text: "An invite expires after 7 days." }` as
a recommended working assumption, which Luke names aloud as one.

### 4. A correction

The developer says: "Actually, no. Any member should be able to invite, not only
admins."

The model treats the correction first, before its own line of questioning:

- It rewrites the assumption to "Members and admins can both invite."
- It updates every field where "admin" was assumed.
- It reopens the question the correction affects: "Then who can withdraw an
  invite: the member who sent it, any admin, or both?" It adds that question
  to `Open questions` until it is answered.

In the Plans tab, the row that read `Only admins can invite teammates.` now
reads `Members and admins can both invite.` Application code tracks no
dependency between answers.

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

When the developer says "I think that's everything", Luke first checks every
field of the template for an answer or an agreed reason it does not apply,
then reviews the document aloud before any handoff. It covers:

- every field still "Unanswered";
- every assumption, one at a time ("I assumed invites expire after 7 days.
  Keep that?");
- anything left in `Open questions`;
- any contradiction between sections;
- the coding choices it proposes to leave to the implementing agent.

The developer keeps the expiry. They drop one open question as out of scope,
and the model moves it into `scope.excluded`. The review is conversation, not
a screen: the tab shows only the document changing as the model saves. Every
assumption left in the list is carried into the handoff as a stated working
assumption.

### 7. The model writes the handoff into the same document

The developer asks: "OK, write the prompt." The model saves the template again
with the prompt in its `handoffPrompt` field. Every other section stays as it
was above it, and the assumption list is kept as it is:

```markdown
## Handoff prompt

**Objective:** teammate invitations, because...

**Scope, and what is out of it:** ...
**Repository context:** `src/db/schema/memberships.ts`, `src/auth/signup.ts`...
**Behavior and invariants:** step by step, including the withdrawn and expired
invite cases; a withdrawn or accepted link never grants access again...
**Steps, dependencies, and accepted risks:** ...
**Acceptance and verification:** ...
**Left to you:** routine internal choices such as naming, file layout, and the
email template's markup...
If anything here conflicts with the agreed behavior, surface the conflict
before overriding it.
```

The prompt is self-contained. It makes sense to an agent that never heard the
conversation, carries the agreed details and adds no new requirement, names
repository-relative paths, and carries no credential or secret. Luke says it is written and that Copy takes the whole document. A
later change that invalidates the prompt is Luke's to revise or clear; no
version mechanism tracks it.

### 8. Copy

The developer presses `Copy`, and the button shows the check mark. The
clipboard holds the current document as readable Markdown: the body as saved,
every section of the template in order, then the assumption list, which
reads `_None recorded_` while the list is empty:

```markdown
<body exactly as saved>

## Assumptions

- Invites reuse `memberships` with a `pending` state.
- Members and admins can both invite.
- A withdrawn invite shows a generic invalid-invite page.
- An invite expires after 7 days.
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
| The tab | The panel's tab bar and its page idiom (`panel-tabs.tsx`, `panel-body.tsx`; the Conversation tab's pages in `agents-panel.tsx`); `APP_PANEL_TAB` in `@sidecar/guide`, which the tab bar and the counted `panel:tab_change` share | `PLANS` in `APP_PANEL_TAB` and the counted tab set; the tab's pages (`renderer/planning/plans-panel.tsx`) and its control (`use-plans-tab.ts`) (LUKE-347). `SESSIONS` and `CONVERSATION` out of both, and every way into a tab typed to the shown set (`ShownPanelTab`) while the body still draws the hidden two (LUKE-350). |
| Acts | `ACT_KIND`, `act-router.ts`, `ActSender`, `registerDesktopIpc` | Rows a panel alone may send, refusing the voice window and the takeover: the plan list and its follow and pause, opening, leaving, and starting a plan, the repositories, Connect GitHub, and the microphone. |
| Plan list and new-plan page | `@sidecar/panel` controls and the existing button, field, and row styles | The list, the form, and the repository list read from the GitHub connection (LUKE-337, LUKE-338). |
| GitHub connection | `ConsentConnectSlot` (`apps/desktop/src/renderer/consent-connect-slot.tsx`) and `useConnections` (`use-connections.ts`), the pattern the calendar consent uses | The repository connection itself, with its scopes and token held in connection handling and never in the renderer or a model-visible argument (LUKE-338). |
| Document body | `MarkdownMessage` (`apps/desktop/src/renderer/markdown-message.tsx`): `react-markdown` with `remark-gfm`, raw HTML not rendered, only `http`/`https` links kept; `styles/markdown.css` | A document-scale style for it. |
| Assumption list | None; it is drawn from `assumptions`, not from Markdown | A bulleted row with the text. |
| Copy | `ConversationCopyButton`'s pattern (`conversation-copy.tsx`), `ACT_KIND.WINDOW_COPY_TEXT`, and the clipboard row in `register-desktop-ipc.ts` | The document formatter: body, then `## Assumptions` as `- ` bullets, or "None recorded" (LUKE-352). |
| Voice state | `VoiceView` and `VOICE_COMMAND` (`apps/desktop/src/shared/messages/voice-view.ts`), which main already forwards unchanged to every panel; `useVoiceView` (`use-voice-view.ts`); `LIVE_STATUS` (`@sidecar/live`) | The status word beside the microphone, for the open plan's call alone. |
| Captions, levels, errors | The panel's caption strip (`useCaptionPresentation`, `caption-layout.ts`) and the wings' waveform (`notch-wings.tsx`), unchanged | None. |
| Microphone and notices | `microphoneAccessRow`, `voiceAttentionNote`, `MICROPHONE_UNGRANTED_NOTE`, `hostedVoiceUnavailableNote` (`microphone-access.ts`) | None. |
| The call | The hidden `VoiceWindow` and `VoiceHost` / `useVoiceSession` / `LiveCall` (`renderer/voice/`); `LiveVoiceOrchestrator` (`@sidecar/voice`); the sessions route `/api/voice/sessions` with client delegation | The call is associated with the open plan, and the orchestrator gains the Plans tab's toggle beside the held talk key (LUKE-340); the talk key names the open plan while one is open (LUKE-347). |
| Planning model and document | Hosted storage and the brain host (`apps/web/server/hosted/`); the account client (`packages/hosted`, `packages/credentials`) | The plan record and `update_plan` (LUKE-334), the instructions (LUKE-336), research (LUKE-339), and the fixed template and its formatter (`packages/hosted/src/plan-template.ts`, LUKE-352). |

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
  - the fixed template (LUKE-352), through the tool against a real store: a
    new plan's untouched template, an incomplete draft saving and resuming in
    its sections, the body's order independent of key order, field text
    unable to open a section, each of the four added fields (invariants,
    decisions, steps and dependencies, risks and mitigations) as a draft null,
    an answer, and a non-applicability, refused omissions of each, a renamed
    field, an extra key, a blank answer, a freeform body, and an oversized
    formatted body each leaving the saved document, a scripted proposal,
    assent, correction, and agreed non-applicable field, and a handoff
    carrying a bulk import's agreed invariant, decision, prerequisite, risk,
    and check; these hold data flow, not model understanding;
  - the talk key, pressed while a plan is open, speaking into the open
    plan's call.
- The Plans tab (LUKE-347) is held by renderer tests: the tab bar's four
  tabs, the list and document pages, Back leaving the plan, the follow
  armed while the tab shows and paused when it goes, and the host keeping
  the open plan through a pause and following the list after a plan is left.
  Its regions render as static markup: a read-only assumption list, no composer and
  no approve controls, a new plan's untouched template with its empty
  assumptions section, and the failed, missing, and not-connected states.

### Not validated

- **A real Mac.** This Linux VM has no Mac, CI builds nothing for one, and
  `./scripts/verify.sh` has not been run on the integrated application. The
  Plans tab in the panel, the fixed template's presentation (LUKE-352), the
  document scrolling inside the panel's ceiling,
  the microphone row, and the capsule and captions during a planning call
  have never been seen running. `./scripts/evidence.sh` captures the panel
  expanded on the Plans tab over a synthetic plan
  (`app-smoke-planning.png`, from `--profile planning --expanded`) and over
  the synthetic plan list with none open (`app-smoke-expanded.png`, the panel
  opening on Plans with Sessions and Conversation hidden), but neither
  capture has been taken yet.
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
