# Planning: the voice planning journey and the Plans tab

This is the reference the Feature Planning MVP builds against (LUKE-331). It
fixes what the developer sees and hears, in order, from picking a GitHub
repository to copying the finished plan, and it names the existing piece of Luke
each part of the Plans tab is built from. It is a design, not an
implementation: the issues that build it (LUKE-334 document store, LUKE-337 the
first Mac surface, LUKE-347 its move into the panel, LUKE-338 GitHub source
tools, LUKE-340 GPT Live, LUKE-342 review and Copy) own the code, the tests,
and the `verify.sh` evidence.

The product decisions behind it are settled in the project specification and
are not reopened here. The two that shape everything below:

- **One saved document per named plan**, a Markdown `body` and an `assumptions`
  list of `{ text }`, written only by the plan's notetaker, which takes
  notes into it ("The notetaker" below). The body is always the one fixed
  template (LUKE-352, "The fixed template" below): the service takes each
  note into the plan's stored fields and formats the result into the body.
  There are no versions, no
  stale-revision rejection, no approval state, and no export record.
- **The model drives the workflow.** Question choice, agreement, corrections,
  and the final review live in the planning model's instructions, and the
  planning model never writes the document: it is handed the saved document
  every turn, so Luke keeps talking while the notetaker writes.
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
- The document is always the page. The whiteboard ("Whiteboard" below) and
  the code Luke has on screen stand beside it in a side panel ("Side panel"
  below) that the developer opens and closes; nothing opens it on its own,
  and there are no second documents.
- No window of its own. Planning lives in Luke's one window (LUKE-347): there
  is no separate planning window, Dock tile, Cmd-Tab entry, or app menu for it.

## The Plans tab

Planning is the window's first place, `Plans`, beside `Settings`, and the
one the window opens on. The tab draws in the work column beside the
sidebar, one page at a time:

```
 ┌──────────────────────────────────────────────────────────────┐
 │  [ Plans ]   Settings                                        │
 │  ‹  Teammate invitations                          [ Copy ]   │
 │     acme/relay · main @ 4f2c9e1                              │
 │ ──────────────────────────────────────────────────────────── │
 │  # Teammate invitations                          (scrolls)   │
 │  Repository: acme/relay, branch main                         │
 │  ## Goal                                                     │
 │  ### Problem                                                 │
 │  Only an admin can add someone to a workspace...             │
 │  ### Outcome                                                 │
 │  Unanswered                                                  │
 │  ...  (every section of the template, in order)              │
 │  ## Open questions                                           │
 │  - Who can withdraw an invite...                             │
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
closes the panel. Escape on the Settings tab's front page comes back to Plans.

### Opening, leaving, and the talk key

- Opening a plan, from the list or by starting one, makes it the host's one
  **active plan**, and every panel's Plans tab shows it on its document page.
- A plan stays open while the developer turns to Settings or closes the
  window, so a call about it goes on. The sidebar draws a planning call
  exactly as any call: Luke's face and the waveform beside it, with the
  captions over the work column. They carry no plan name.
- A plan is left by Back (`‹`) or Escape on its document page, by opening
  another plan, or by a sign-out. Leaving ends the plan's call; opening
  another plan ends the old plan's call before the new one is active in any
  call (LUKE-346). Only one plan is ever the spoken conversation.
- While a plan is open, the talk key speaks into that plan's call, whatever
  the panel is showing. With no plan open, it is the desk's talk key.
- Nothing polls. Every change to a plan happens during its call, and the
  notetaker's drafts reach the open plan on the call's own socket as they
  are written. The list and the open plan are read when a panel shows the
  Plans tab, when a plan opens, and when one starts; leaving the tab leaves
  the plan and its call standing, and coming back reads everything again.

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

1. **Plan name**, a single-line field whose placeholder, "e.g. Dark mode
   toggle", reads as an example to replace rather than a filled value.
2. **Folder**, chosen with `Choose folder`: the folder of this Mac the plan
   reads, kept on this Mac alone.
3. **Start plan**, enabled once both are set. Pressing it saves the plan with
   its name and the untouched template as its document, records its folder
   on this Mac, and opens it. If the service cannot be reached, the page
   stays open with the reason and the button can be pressed again.

### Header

- `‹`, back to the list, which leaves the plan.
- The plan's name.
- The repository line, as `owner/repository · branch @ short commit`.
- **Copy**, the one action on the document. It is always enabled, however
  much of the plan is written. It copies the current document as described in
  "Copy". It never launches an agent and never asks the model anything.
- The side panel's toggle, last on the toolbar ("Show panel" / "Hide panel",
  ⌥⌘B).

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

### Whiteboard

Each plan has one whiteboard, an Excalidraw scene that Luke and the developer
both draw on. It shows in the side panel's Board tab, beside the document.

- **Luke draws whole diagrams.** The planning model's `draw_on_board` tool
  sends the whole diagram each time: labelled boxes, ellipses, and diamonds,
  text, and arrows between ids. It replaces his previous drawing and leaves
  what the developer drew. The service only stores it
  (`apps/web/server/hosted/board-tool.ts`). The voice hands a request to
  draw to the planning model, as it does any other request.
- **The Mac converts it.** The canvas turns Luke's drawing into Excalidraw
  elements with Excalidraw's own converter, marks them as his, and puts them
  in place of his previous ones, then saves the scene. An element of his that
  the developer moved goes back where his next drawing says.
- **The developer draws with Excalidraw's own tools.** Images, embeds, and
  export are left out. The scene is saved whole once the canvas pauses, and
  the last write wins.
- **Luke reads the board every turn.** The planning model's standing context
  carries the scene as text under `[board]` (`board-text.ts`), so whatever
  the developer drew is in front of it on its next turn.
- **The Mac reads the board** when a plan opens, when the tab shows, and when
  the call's activity says a drawing just settled.
- **Excalidraw is its own bundle** (`whiteboard.js`), loaded the first time a
  board is shown, with its fonts shipped beside it. The bundle every window
  parses never carries it.
- **The board is never recorded.** Its root is left out of the screen
  recording, because a canvas draws its words as pixels that the recording's
  text masking cannot reach.

### Side panel

The open plan's supporting views stand in a panel at the window's right,
beside the document and its microphone row, the way a devtool's secondary
sidebar does (`desktop/side-panel.tsx`, `planning/use-side-panel.ts`).

- **Tabs.** `Board`, the plan's whiteboard, and `Code`, the code Luke has
  on screen during a call. With none on screen, the Code tab says so quietly
  rather than going away.
- **The developer's alone.** The toolbar's toggle and ⌥⌘B show and hide it;
  choosing a tab, or Luke putting code up, never opens it. Its left edge
  drags it between 280 and 720 pixels wide, and the arrow keys move it once
  it has the focus.
- **Kept across launches.** Whether it is open, its tab, and its width are
  this Mac's preference, kept in the window's own storage rather than in
  anything main holds. A fixture run stages its own and keeps nothing.

### The notetaker

A planning call's plan is written by a notetaker beside the call
(`apps/web/server/voice/plan-scribe.ts`), following GPT-Live's guidance to
react to the transcript on a small model while speech goes on. It keeps both
speakers' words from the call's sideband and the planning model's replies as
research notes. Once the developer has been quiet for about a second, it makes
one `gpt-5.6-luna` call over the plan's saved fields and what was said since
its last note, under its own instructions (`SCRIBE_INSTRUCTIONS`), and saves
the answer through `saveNotes` (`apps/web/server/hosted/plan-notes.ts`). Its
runs never overlap, so it is the plan's only writer, and a run that fails
moves nothing forward.

The answer is notes, the way a person takes notes on a call, never a field
written out again:

- `add` puts a new point under a field: a bullet after what a text field
  holds, an item at the end of open questions or assumptions, or a rule at
  the end of the rules.
- `addExample` adds a Given/When/Then example to a rule by its number.
- `replace` corrects a phrase copied exactly from the field, and `remove`
  strikes the line, item, rule, or example holding one.

A note naming a phrase the plan does not hold is passed over, reported, and
never guessed into another; a note that does not read under the schema is
passed over alone. The rest save.

The notes type in while they are written. The call streams its answer, and
the notes so far are taken over the saved fields and formatted exactly as a
save would be (`notesInProgress` in `packages/hosted/src/plan-template.ts`):
every note before the last is whole, and the last is drawn only when it adds
a point, as its text so far. Each draft is sent to the Mac on the call's own
socket as a `plan.draft` frame, at most every 150 ms, then once more as saved,
so each differs from the one before only where the newest note lands. The
host draws each draft in place of the open plan's document, and the Plans
tab's caret types that difference in where it stands: a point typed at the
end of its field, a correction selected and retyped, a struck line or rule
selected and erased. A unit of the document is known by its heading, and a
rule by its statement, so a rule joining or leaving moves no other words. A
run that breaks off sends the saved document back, so no half-written draft
is left standing.

### The fixed template

Every plan uses one fixed template (LUKE-352). There is no configurable
template, no sections map, and no freeform body: a note names one of the
fields below (`PLAN_FIELD`) and nothing else. The service keeps the plan's
fields in the row's `fields` column, takes the notes over them, formats the
result into the canonical Markdown `body`
(`packages/hosted/src/plan-template.ts`), checks the formatted body against
its bound, and saves the fields, the body, and the assumptions together; no
code parses the body back. The notetaker reads the fields on its next run,
and the planning model reads the canonical Markdown on its next turn.

| Section | Fields | What Luke establishes |
| --- | --- | --- |
| Goal | `goal.problem`, `outcome` | The current problem and who it affects, and the observable improvement. |
| Scope | `scope.included`, `excluded`, `constraints` | What is in, what is explicitly out, and the limits that apply (permissions, privacy, performance, compatibility). |
| Rules | `rules` | Each rule as one sentence, with the Given/When/Then examples that pin it, more of them where a rule is ambiguous. |
| Implementation | `implementation.changeMap`, `contracts`, `patterns`, `order` | Each path the change touches and what it gets there; new or changed types, schema, and signatures written as code, never function bodies; existing code to follow; and, only where it matters, the order steps must land in. |
| Decisions | `decisions` | Each consequential choice, why, and the alternative rejected. |
| Verification | `verification` | The end-to-end check that proves the change works, beyond the examples passing. |
| Left to the agent | `leftToAgent` | Exactly which choices the implementing agent may make itself. |
| Open questions | `openQuestions` | What is still unresolved. |
| Data and migration | `dataAndMigration` | Only when stored data changes: what is stored, how existing data moves, and how the change is undone. |
| Assumptions | `assumptions` | The existing `{ text }` list. |

- **Types.** An ordinary field is `null` or nonblank text; it is `null` until
  a note first answers it, or again once every line of it is struck, and a
  core field renders it as "Unanswered" while it is.
  `implementation.order` and `dataAndMigration` are optional: the body leaves
  them out while null. A rule is exactly its one-sentence `statement` and its
  `examples`, null until one is agreed and rendering "No examples yet"; an
  example is exactly `given`, `when`, and `then`, each one line. `rules` is
  null until one is agreed. `openQuestions` is always a list, rendering "No
  additional questions recorded" while empty.
- **Order and containment.** The formatter owns every heading and its order,
  so the body's order is the template's whatever order notes arrive in. Field text is contained where it stands: a line that would open a
  heading or an HTML block is escaped, and a code fence left open is closed
  at the end of its field, so no answer can impersonate a section or swallow
  the ones after it.
- **A new plan** is the template with every field unanswered, no open
  question, and no assumption; its `fields` column is null and its `body`
  empty until the first save, and the store formats an empty body as the
  untouched template when it reads it. Migration 0053 reset every plan
  written under the earlier template this way.
- **Saving and resuming** go through the same save, so a plan written in the
  template resumes with its answers and its assumptions intact.
- **Structure is the tool's; agreement is the model's.** The schema
  guarantees that every field is present and well formed, not that an answer
  is understood, true, or agreed. Resolving each field, or agreeing an
  explicit "Not applicable: <reason>" or a bounded delegation, is Luke's
  work, and every proposal Luke adds (a default, a rule, a decision, a
  contract, an exclusion, a non-applicable field, a delegated choice) is
  recorded as an assumption.
  Goal, rules, and verification can never be set aside as not applicable.
  A populated template is not evidence that the developer agreed.

The template holds what a coding agent cannot read from the repository, since
the agent explores the code itself: what was decided, the rules and their
examples, and the contracts the change must meet, with pointers into the code
rather than a description of it. Its aim is that two agents given the plan
build the same behavior, structure, and contracts, differing only where
`leftToAgent` allows; no plan makes two runs write identical code.

The field selection is a Luke product decision informed by GitHub's
[Spec Kit](https://github.com/github/spec-kit/blob/main/templates/spec-template.md)
(requirements with acceptance scenarios, a data model only when the feature
has data, contracts but no function bodies), OpenAI's
[ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans)
(exact interfaces and signatures, a decision log), Anthropic's
[Claude Code best practices](https://code.claude.com/docs/en/best-practices)
(name files and interfaces, state what is out of scope, end with an
end-to-end check), Google's
[agent program repair study](https://arxiv.org/pdf/2501.07531) (exact
locations and a runnable check), the
[SWE-Bench Pro](https://arxiv.org/html/2509.16941v1) interface block, and
[Example Mapping](https://cucumber.io/blog/bdd/example-mapping-introduction/)
(rules, each with its examples, and questions). Users, terminology, current
behavior, quality, risks, rollout, and steps were cut: the agent reads the
current system from the code, and no agent-facing source asks for the rest.
None of these validates these exact fields or a voice model; comparative
evaluations are outside this work.

### Microphone row and the panel's voice

- **Microphone button.** One press starts talking to Luke about the open plan.
  The call opens if none stands, and the microphone opens. A call just
  opened is Luke's to begin: the voice service tells it to speak first
  (`planningOpeningInstruction`), asking what to build on an untouched plan
  and the plan's next question on one under way, in its first turn and
  without waiting on the backend, while a call re-attached after a dropped
  socket opens nothing again. The call's seed says which the plan is: an
  untouched plan is seeded as a new plan with nothing answered, and any
  other as the saved plan the call continues. A second press mutes it. The
  microphone stays open between the two presses rather than only while a
  key is held, because a planning conversation runs for minutes.
  The existing talk key keeps its hold-to-talk meaning, and speaks into the
  open plan's call.
- **Status**, beside the button, in two lines, each part of Luke saying only
  what it is doing. The first is the voice: the one word `LIVE_STATUS`
  already names, `Connecting`, `Listening`, `Muted`, `Speaking` (Luke), or
  `Closing`, while a call about this plan stands, and the button's own label
  otherwise. A listening or muted call reads `Handing off` from the voice
  model's delegation until the planning model takes the ask (or it is
  refused), and `About to answer` from words queued for Luke until his voice
  begins them. The second line stands only while the backend works, with the
  thinking dots: `Planning model ·` the command of its pending
  `run_in_repository` call (the tool's name for any other call), or
  `Thinking` with none pending, while an exchange is open; and `Notetaker ·
  Writing notes` while the notetaker's model call runs. No tool's output is
  shown, and the command is cut to 120 characters. The service sends the
  whole snapshot as a `plan.activity` frame on the call's own socket each
  time any part changes: the live session service reports the voice's wait
  and the exchange, the live brain reads the pending call off the turn's
  journal on its own poll, and the notetaker reports its model call. The
  host holds the snapshot in the planning view as it stands, clears it on
  leaving or switching plans, and the call's end is told as nothing doing. A
  silent Luke whose row reads `Listening` with no second line is not working,
  and that is a bug to chase rather than a pause to wait out.
- **Everything else is the panel's own.** The waveform is the wings', the
  captions (Luke's current words, and the developer's own under the captions
  preference) ride the panel's caption strip at its foot, and a voice error
  or notice takes that strip exactly as it does for any call, with the button
  left able to try again. Nothing is kept here; what matters lands in the
  document.

## The journey

The reference plan is "Teammate invitations" on a private repository,
`acme/relay`. Each step shows what the developer does, what Luke says (in
brief), and the document after the notetaker's notes. Luke's lines are
illustrations of tone and order, not prompt text: LUKE-336 writes the
instructions.

### 1. Starting from a GitHub repository

The developer opens the panel's Plans tab. They press
`New plan`, connect GitHub once, name the plan "Teammate invitations", pick
`acme/relay`, and press `Start plan`. The header reads
`acme/relay · main @ 4f2c9e1`, and the document shows the untouched template,
every field "Unanswered".

They press the microphone. The call opens and Luke speaks first, without
waiting for them: a few words of greeting and what they have in mind, asked so
that a problem or a rough idea is as good an answer as a design. They answer:
"I want people to be able to invite a teammate into their workspace by email."

Luke never assumes the developer arrives knowing what to build. Had they said
only "people keep asking how to add a teammate", Luke would start from that
problem, ask who hits it and what they do today, and let the repository suggest
the directions. A developer who answers a question with "I don't know" is not
pressed for one: the planning model puts the same decision back as two or three
concrete options grounded in the code, with the one it recommends, and if the
developer still has no preference that recommendation becomes a working
assumption Luke names aloud.

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

Repository: acme/relay, branch main

## Goal

### Problem

Only an admin can add someone to a workspace, by creating their account by
hand, so members wait on an admin to bring a teammate in.

### Outcome

A member invites a teammate by email; the teammate joins by opening the link.

...

## Implementation

### Change map

- `src/db/schema/memberships.ts`: a `pending` state.

...

## Decisions

Model an invite as a `memberships` row with `state = pending`. Why: removal
covers invites and members alike. Rejected: a separate `invitations` table.

...

## Open questions

- Who may invite?
- What does an invited person see after their invite is withdrawn?
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

Luke rehearses behavior one question at a time, from a queue of every question
whose prerequisites are already settled, each with his recommended answer:

> "Picture this: Priya gets an invite, and before she opens it the admin
> removes it. She clicks the link. I'd show her a plain 'This invite is no
> longer valid' page and not tell her who withdrew it. OK?"

The developer agrees. The notetaker writes the rule it implies, "a withdrawn
or accepted link never grants access again", with the rehearsal as its
example: given an invite the admin withdrew, when Priya opens its link, then
the page reads "This invite is no longer valid". It moves
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
not leave the plan: the call goes on.

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

The plan is done when the document is enough for a separate agent to build
the change without coming back with a question, not when every branch of the
design tree has been asked about: every core field holds an answer or an
agreed reason it does not apply, every rule has an example, nothing open
would change what gets built, and every choice the developer does not mind
either way is left to the agent or stated as an assumption. The planning
model queues only decisions that change what is built or how it is checked,
and states the rest as working assumptions Luke says aloud. Once the plan is
done it queues nothing more and tells Luke the plan is complete, and Luke
drops whatever questions he still holds. A developer who stops before then
is never told the plan is complete: the model says it is not complete yet and
names what is still unanswered, and Luke asks whether to settle it now or
leave it open.

That, or the developer saying "I think that's everything", starts the review:
Luke reviews the document aloud before it is copied. It covers:

- every field still "Unanswered";
- every assumption, one at a time ("I assumed invites expire after 7 days.
  Keep that?");
- anything left in `Open questions`;
- any contradiction between sections;
- the coding choices it proposes to leave to the implementing agent.

The developer keeps the expiry. They drop one open question as out of scope,
and the model moves it into `scope.excluded`. The review is conversation, not
a screen: the tab shows only the document changing as the model saves. Every
assumption left in the list is copied with the plan as a stated working
assumption.

### 7. Copy

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
is the same whether or not the review has happened. There is no separate
handoff prompt: the plan is what the coding agent reads. They paste
it into the coding agent of their choice. If they later ask Luke for one more
change, the model updates the same document, and Copy copies the new one.

## Failures the developer sees

- **Microphone or connection.** The existing voice error and notice lines
  appear in the panel's caption strip, as for any call ("the microphone is not
  allowed yet", "Voice is temporarily unavailable"). The microphone button
  retries.
- **Save.** A notetaker run that fails, or that the allowance refuses, saves
  nothing and says nothing; the next run after the developer speaks again is
  handed the same lines. The tab keeps showing the last saved document.
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
| The tab | The window's shell (`desktop/desktop-shell.tsx`, `desktop/desktop-sidebar.tsx`); `APP_PANEL_TAB` in `@sidecar/guide`, which the sidebar and the counted `panel:tab_change` share (`panel-tabs.tsx`) | `PLANS` in `APP_PANEL_TAB` and the counted tab set; the tab's pages (`desktop/desktop-plans.tsx`) and its control (`use-plans-tab.ts`) (LUKE-347). |
| Acts | `ACT_KIND`, `act-router.ts`, `ActSender`, `registerDesktopIpc` | Rows a panel alone may send, refusing the voice window and the takeover: the plan list read as the tab shows, opening, leaving, starting, and deleting a plan, choosing its folder, and the microphone. |
| Plan list and new-plan page | `@sidecar/panel` controls and the existing button, field, and row styles | The list and the form (LUKE-337). |
| Document body | `MarkdownMessage` (`apps/desktop/src/renderer/markdown-message.tsx`): `react-markdown` with `remark-gfm`, raw HTML not rendered, only `http`/`https` links kept; `styles/markdown.css` | A document-scale style for it. |
| Assumption list | None; it is drawn from `assumptions`, not from Markdown | A bulleted row with the text. |
| Copy | `ACT_KIND.WINDOW_COPY_TEXT` and the clipboard row in `register-desktop-ipc.ts` | The document formatter: body, then `## Assumptions` as `- ` bullets, or "None recorded" (LUKE-352). |
| Voice state | `VoiceView` and `VOICE_COMMAND` (`apps/desktop/src/shared/messages/voice-view.ts`), which main already forwards unchanged to every panel; `useVoiceView` (`use-voice-view.ts`); `LIVE_STATUS` (`@sidecar/live`) | The status word beside the microphone, for the open plan's call alone. |
| Captions, levels, errors | The panel's caption strip (`useCaptionPresentation`, `caption-layout.ts`) and the sidebar's waveform (`desktop/luke-identity.tsx`), unchanged | None. |
| Microphone and notices | `microphoneAccessRow`, `voiceAttentionNote`, `MICROPHONE_UNGRANTED_NOTE`, `hostedVoiceUnavailableNote` (`microphone-access.ts`) | None. |
| The call | The hidden `VoiceWindow` and `VoiceHost` / `useVoiceSession` / `LiveCall` (`renderer/voice/`); `LiveVoiceOrchestrator` (`@sidecar/voice`); the sessions route `/api/voice/sessions` with client delegation | The call is associated with the open plan, and the orchestrator gains the Plans tab's toggle beside the held talk key (LUKE-340); the talk key names the open plan while one is open (LUKE-347). |
| Planning model and document | Hosted storage and the brain host (`apps/web/server/hosted/`); the account client (`packages/hosted`, `packages/credentials`) | The plan record and its one write, `saveNotes` (LUKE-334), the instructions (LUKE-336), research (LUKE-339), the fixed template and its formatter (`packages/hosted/src/plan-template.ts`, LUKE-352), and the notetaker that writes the plan during a call (`apps/web/server/voice/plan-scribe.ts`). |

Two existing rules carry over unchanged:

- **Session replay.** The panel is the one surface that records
  (`apps/desktop/src/renderer/session-replay.ts`, called from `App`), and the
  Plans tab is part of it: every word it draws is masked, as the rest of the
  panel's are, so what leaves the machine is the tab's layout and never the
  plan's words. It draws them with the panel's own text, fields, and
  attributes, and no new way of drawing words.
- **Secrets.** No credential or account secret enters the document, a caption,
  a counted event, or a trace. The GitHub token lives in connection handling,
  and the model is told to keep secrets out of the plan.
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
  - the notetaker saves what the developer said once they are quiet a beat,
    and its drafts are drawn on the Mac as the model writes them;
  - a spoken turn reaching the planning model in the plan's own
    conversation, with the saved document on every turn;
  - re-attaching and resuming on the same plan;
  - switching plans ends the old plan's call, and the new plan is active
    before that call has finished closing;
  - the final review written into the same document;
  - Copy's Markdown, at the store's largest document;
  - the fixed template (LUKE-352), through the tool against a real store: a
    new plan's untouched template, an incomplete draft saving and resuming in
    its sections, the body's order independent of key order, field text
    unable to open a section, an optional field left out until it holds
    something and again once cleared, a renamed field, an extra key, a blank answer, a freeform body, and an oversized
    formatted body each leaving the saved document, a scripted proposal,
    assent, correction, and agreed non-applicable field, and a handoff
    prompt refused as a field the template does not name; these hold data
    flow, not model understanding;
  - the talk key, pressed while a plan is open, speaking into the open
    plan's call.
- The Plans tab (LUKE-347) is held by renderer tests: the tab bar's four
  tabs, the list and document pages, Back leaving the plan, the plans read
  again each time the tab shows, and the host keeping the open plan through
  the tab going away, with nothing read on a clock.
  Its regions render as static markup: a read-only assumption list, no composer and
  no approve controls, a new plan's untouched template with its empty
  assumptions section, and the failed, missing, and not-connected states.

### Not validated

- **A real Mac.** This Linux VM has no Mac, CI builds nothing for one, and
  `./scripts/verify.sh` has not been run on the integrated application. The
  Plans tab in the panel, the fixed template's presentation (LUKE-352), the
  document scrolling inside the panel's ceiling,
  the microphone row, and the captions during a planning call
  have never been seen running. `./scripts/evidence.sh` captures the panel
  expanded on the Plans tab over a synthetic plan
  (`app-smoke-planning.png`, from `--profile planning --expanded`), on the
  plan's whiteboard (`app-smoke-planning-board.png`, from
  `--profile planning-board --expanded`), and over
  the synthetic plan list with none open (`app-smoke-expanded.png`, the
  window opening on Plans), but neither
  capture has been taken yet.
- **Real voice.** No spoken planning conversation has run against GPT Live:
  ordinary assent, interruption, a continuing answer, a correction, resuming,
  and switching plans by voice are untested outside the fakes.
- **A live GitHub connection.** No repository has been connected or read
  through GitHub's OAuth App and hosted MCP service outside the fakes.

### Known limitations

- **GitHub's `repo` scope is broader than Luke's use.** GitHub sign-in and the
  Connect GitHub page (`/connect-github.html`) both ask under the existing OAuth App for the classic `repo` scope,
  which grants read and write to every repository the developer can reach.
  Luke only reads, through GitHub's read-only MCP endpoint, but the token
  itself could write. `PRIVACY.md` discloses it under "Your account".
- **Connecting on a Preview.** A Preview's link goes through production's
  registered callback on the OAuth proxy, as sign-in does, and lands on the
  Preview's signed-in user (`apps/web/server/README.md`, the OAuth proxy);
  it is held end to end against a fake GitHub in
  `apps/web/tests/auth-proxy-link.test.ts` and has not yet been exercised
  against a deployed Preview.
- **`read_web_page` checks addresses without pinning them.** Every host the
  read reaches, and every redirect hop, is resolved and refused unless all of
  its addresses are public unicast. The check is a lookup ahead of the
  request, though, and the socket is not pinned to the checked address. A
  host whose DNS answer changes between the lookup and the connection (DNS
  rebinding) is the one case it does not cover.
- **The plan list is read, not followed.** A plan started on another Mac
  appears in this Mac's list the next time its Plans tab shows.
