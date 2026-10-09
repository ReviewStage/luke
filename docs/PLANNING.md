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
- The document is the record. What was said on the plan's calls can be read
  back in the side panel's Transcript tab, but nothing there is a second
  document: it is never copied, edited, or handed to an agent. The document
  itself is what Start hands to a coding agent, as the Markdown Copy puts on
  the clipboard ("From a plan to a pull request" below).
- The document is always the page. The whiteboard ("Whiteboard" below), the
  code Luke has on screen, the transcript, and each coding agent started on
  the plan stand beside it in a side panel ("Side panel" below) that the
  developer opens and closes; only a first drawing, first code, or an agent
  just started opens it on its own, and there are no second documents.
- No window of its own. Planning lives in Luke's one window (LUKE-347): there
  is no separate planning window, Dock tile, Cmd-Tab entry, or app menu for it.

## The Plans tab

Planning is the window's first place, `Plans`, beside `Settings`, and the
one the window opens on. The tab draws in the work column beside the
sidebar, one page at a time:

```
 ┌──────────────────────────────────────────────────────────────┐
 │  [ Plans ]   Settings                                        │
 │  ‹  Teammate invitations                 [ ▶ Start ▾ ] [ ⋯ ]   │
 │     acme/relay                                               │
 │ ──────────────────────────────────────────────────────────── │
 │  # Teammate invitations                          (scrolls)   │
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

- **New plan page**: the tab's home, whenever no plan is open. The plan
  list is the window's sidebar, so there is no empty page in between.
- **Document page**: the open plan's saved document. Its header and its
  microphone row hold still, and only the document scrolls between them.

Escape unwinds one page at a time, after any open microphone has been muted
(Escape mutes first, as it does for any call): the document page back to the
new-plan page, which leaves the plan, and the new-plan page closes the panel. Escape on the Settings tab's front page comes back to Plans.

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
  Plans tab; the open plan again when a plan opens, and the list again when
  one starts or is deleted. Leaving the tab leaves the plan and its call
  standing, and coming back reads everything again.

### Plan list

- Every named plan the account owns, newest started first. Opening a plan
  moves no row, so a new plan stands at the head and nothing else moves.
  Each row shows the plan's name and its `owner/repository`.
- Clicking a row opens that plan on the document page (see "Leaving and
  resuming").
- `New plan` at the head of the list leaves any open plan for the new-plan
  page and focuses its name field. It is drawn as a row of the list, and is
  the selected row whenever the new-plan page shows.
- There is no archive or search in this journey.

### New plan

A devtool's new-task page: the heading "What are we planning?" over one
composer card, and nothing spoken. Leaving or deleting a plan lands here.

1. **Plan name**, the card's large single-line field, focused on arrival,
   whose placeholder, "Name the feature, e.g. Dark mode toggle", reads as an
   example to replace rather than a filled value.
2. **Repository**, the chip along the card's foot: the GitHub mark and the
   `owner/name` of the repository the plan is about, which the service keeps
   on the plan (`plan.repository`). It starts on the repository of the newest
   started plan that has one. Its menu is the app's searchable picker
   (`renderer/searchable-menu.tsx`, which the Start button's model menu is
   too): a search field as the first row, focused as the menu opens and
   filtering as it is typed in; under it every repository the Luke GitHub
   App reaches for the account (`GET /api/github/repositories`), the recent
   ones first and the rest as GitHub last saw them change, each under the
   GitHub mark or a lock where it is private, with a check on the chosen
   one, in a list that scrolls past a bounded height; and pinned under the
   list, `GitHub ↗`, which opens the App's installation page in the browser,
   where the developer chooses which repositories Luke can see. With the App
   installed nowhere for the account, the chip reads `Install Luke on GitHub
   ↗` and opens that page directly. With no repository used before it reads
   `Choose repository`; a plan can start without one and be given one later.
   The list is read when the chip mounts and again whenever the window takes
   focus, which is how the chip picks up an App installed in the browser
   meanwhile; nothing polls. The arrows move the highlight while the search
   field keeps focus, Enter picks, Escape closes the menu and hands focus
   back to the chip, and so does focus leaving it.
3. **Start**, the round arrow at the card's other end, enabled once the name
   is set; Enter presses it. Pressing it saves the plan with its name, its
   repository, and the untouched template as its document, and opens it. If
   the service cannot be reached, or it refuses the repository (the App does
   not reach it, or the account must sign in with GitHub again), the reason
   shows under the card and the button can be pressed again.

### Header

- `‹`, back to the list, which leaves the plan.
- The plan's name. The toolbar is one row, the side panel's bar's height
  exactly (`--desktop-bar-height`, the one token both take), so their bottom
  borders are one line across the window.
- The plan's repository is the sidebar row's to name, under the plan's name.
  A plan with none yet, the 13 plans from before repositories among them,
  shows a compact `Choose repository` chip in the toolbar's actions row, left
  of Start, with the composer's menu: a pick is saved through
  `PATCH /api/plans/{id}`, and a refusal is said beside it. A plan can be
  used without a repository; the planning model then says it has none.
- **The plan's menu**, from the toolbar's ⋯ and from a right-click on the
  plan in the sidebar alike: Copy plan (the open plan alone), Rename, Change
  repository… (opens the repository picker, hung from the toolbar, opening
  the plan first where it is not the open one), Open on GitHub
  (`https://github.com/owner/repository`, for a plan with a repository), and
  Delete plan, last and red.
- **Start**, a split button (`desktop/start-agent-button.tsx`). Its main
  part starts a coding agent on the plan with the account's default model and
  effort; its chevron drops the searchable picker over the models the service
  offers, grouped by provider with the newest first, each under its provider's
  mark and the default checked, with the efforts the chosen model lists and
  "Start with <model> · <effort>" pinned under the scrolling list, which the
  service also keeps as the account's default. A plan with no repository has Start unavailable, saying why on
  hover. Each press mints a key of its own, and a press asked again after
  the service did not answer carries the same key, so one press is one agent
  ("From a plan to a pull request" below).
- **Copy plan** stands in the ⋯ menu, with its chord ⇧⌘C still the
  toolbar's. It is always enabled, however much of the plan is written, and
  copies the current document as described in "Copy". It never launches an
  agent and never asks the model anything.
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

- **Tabs.** `Board`, the plan's whiteboard; `Code`, the code Luke has on
  screen during a call, read by the service from the plan's repository ("How
  the planning model reads code" below); `Transcript`, what was said on the
  plan's calls ("Transcript" below); and, after them, one tab per coding
  agent started on the plan, named by its model with a dot for where it
  stands ("Agent tabs" below). With none on screen, the Code tab says so
  quietly rather than going away. The strip scrolls where the agents
  overflow it, and no tab closes.
- **The developer's alone.** The toolbar's toggle and ⌥⌘B show and hide it.
  A closed panel opens on its own only for Luke's first drawing on the
  plan's board, the first code he puts up, each once per plan
  (`planning/use-panel-arrivals.ts`), and an agent just started, whose tab
  it opens on; an open panel keeps its tab, and an arrival on another tab
  marks that tab with a dot until it is shown. Its left edge
  drags it between 280 and 720 pixels wide, and the arrow keys move it once
  it has the focus.
- **Kept across launches.** Whether it is open, its tab, and its width are
  this Mac's preference, kept in the window's own storage rather than in
  anything main holds. A kept tab naming an agent the open plan has none of
  reads as the board, so leaving a plan or opening another never shows a tab
  with nothing behind it. A fixture run stages its own and keeps nothing.

### Agent tabs

Each coding agent started on the plan has a tab of its own
(`planning/agent-tab.tsx`, `planning/use-coding-agents.ts`), opened and
selected the moment its Start lands.

- **The head.** The model · the effort · the status, with the dot the tab
  wears: starting or running (pulsing), completed, failed, or cancelled. A
  Stop stands while the agent may still write; it asks the service to cancel
  the turn and stop the sandbox, and anything the agent pushed stays.
- **What it published.** Once the agent has pushed, the head wears a pill
  for its pull request (`planning/agent-published.tsx`): the GitHub mark
  and `#123`, coloured by where the pull request stands (open green, draft
  grey, merged purple, closed red) with a dot for the checks on its head
  (pending, passing, failing, or none), which opens the pull request in the
  browser; or, with a branch pushed and no pull request from it yet, a chip
  naming the branch. A ⋯ beside either offers Open pull request, Copy
  branch name, Copy checkout command (`git fetch origin <branch> && git
  switch <branch>`), and View changes on GitHub (the pull request's Files
  tab, or the branch compared). Once the agent has ended with a pull
  request, the transcript ends on one row summing it up ("Opened #123 ·
  +210 −14 in 6 files") with Open. The window reads
  `GET /api/agents/{id}/pull-request` (`planning/use-agent-pull-request.ts`)
  as the tab comes on screen, as pages of the transcript land no closer
  than fifteen seconds apart, and the moment a page says the agent ended;
  the service keeps its answer thirty seconds per agent, reading afresh
  the first time after the agent ends, so a tab reading beside every held
  page asks GitHub a few times a minute at most and the pull request an
  agent opens last shows the moment it ends. The branch and the pull
  request are the agent's own: read off the commands it ran and the
  addresses in its words and its tools' answers, with a pull request
  counted only on the branch the agent itself named, so a link in a file
  it read is never worn as its own.
- **The transcript.** The agent's stored `UIMessage`s, drawn with the same
  AI Elements components as the Transcript tab, on the same spacing: the
  plan it was handed, the first of the developer's messages, as a Plan card
  folded under its title; any message the developer sent it since as the
  developer's bubble; and each of its own turns with its text as Markdown,
  its reasoning folded under one line, each tool call one row saying what
  it did with the input and the output under it once opened, a call that
  ended in an error said in red, and a link to the pull request it opened,
  which opens on GitHub in the browser. A copy of a turn's words waits
  under it. While the agent may still write, a shimmering "Working…" stands
  at the end; it goes the moment the agent ends. The list keeps to its
  newest line while it is scrolled there. Under the transcript is the room
  for a composer, which the tab is handed (`AgentTab`'s `composer`) and
  does not draw itself.
- **Live.** While the tab shows and the agent is starting or running, the
  window reads `GET /api/agents/{id}/messages?after=<cursor>` in a loop on
  the service's held long-poll (`planning/use-agent-transcript.ts`): each
  page joins the messages held by id, and each carries the agent's status,
  so the loop ends on its own when the agent ends. A tab hidden, a plan
  left, or an agent that ended stops the reads; the agents list is read when
  the plan opens and after a Start or a Stop. The one other read is main's
  watch, below.
- **When it ends.** Main keeps a ledger of where each agent stands
  (`main/agent-notices.ts`), fed by every coding-agent answer that passes
  through its acts, and lists a plan's agents again every thirty seconds
  while one of them is starting or running, so an agent on a plan the
  developer has left is still watched. An agent that moves from writing to
  completed or failed is announced once: a macOS notification titled with
  the plan's name, saying the model's name and "finished" or "failed" and
  nothing of the transcript, unless the window is focused on that agent's
  tab; its click brings Luke forward on the plan with that tab open. The
  agent's tab wears the unseen dot until it is shown or the window comes
  forward on it. A Stop is the developer's own and is not announced, and an
  agent first seen already ended, as after a relaunch, is not either. The
  "opened #N" wording waits on a read of the agent's pull request, and a
  Settings toggle for the notifications is a follow-up.
- **Privacy.** Every word is the agent's or the plan's, so the tab carries
  `ph-no-capture`, as the Transcript tab does.

### Settings › Coding agents

The model and effort a click on Start runs an agent on are the account's
one default, kept on the service with the account preferences
(`/api/account/preferences`'s `codingAgent` part) and shown on the Coding
agents page of Settings (`settings/coding-agents-page.tsx`): a model menu
with each provider's mark, and the efforts the chosen model lists. The page
reads the default as it opens, so a model chosen from Start's chevron, which
the service keeps as the default too, shows there next. A first-time
account starts on Claude Opus 5.5 at high.

### Transcript

The Transcript tab reads back what was said on the plan's calls with Luke,
as a chat does: each call from a divider saying its day and time, oldest
first, and each run of lines from one speaker as one turn, the developer's
in a bubble at the right and Luke's under his mark at the left, with a copy
of the turn's words under it (`planning/plan-transcript.tsx`,
`planning/transcript-model.ts`).

- **The record.** The service keeps each call's words as timed fragments
  (`voice_transcript_segments`) and answers them at
  `GET /api/plans/{id}/transcript` (`hosted/transcript-store.ts`), grouped
  into turns by the same ledger the captions use, so a call that ended reads
  back in the lines its captions drew. Each turn is answered as an AI SDK
  `UIMessage` (`packages/hosted/src/transcript-wire.ts`): its place on the
  call as the id, the speaker as the role, and its words as one text part,
  the shape Luke's `messages` table keeps every conversation in. The newest
  4,000 fragments are read; past that, the tab says earlier lines are not
  shown. The host reads it with the plan's document, and again when a call
  about the plan ends, once at the end and once more five seconds on, after
  the call's last words have reached the record.
- **The call standing now.** Its words are not on record yet, so the voice
  window reports them as they are said (`VoiceView.callTranscript`),
  whatever the captions preference, and the tab grows the call at the
  bottom, marked `Live`, each heard line a message of the same shape under
  the ledger's row id. The two are told apart by the store's id for the
  call's session, so a call is drawn once, from the record once the
  record's copy has as many words as were heard; hanging up, or calling again
  at once, keeps the heard words drawn until then.
- **The components.** The turns are drawn with AI Elements, the AI SDK's
  chat components, copied from its registry into
  `apps/desktop/src/renderer/ai-elements/` and restyled to the renderer's
  tokens: `Conversation` is the log, `Message` one turn by its role, and
  `MessageResponse` the turn's words as markdown. They are written in
  Tailwind utilities, which `scripts/tailwind.mjs` compiles into the one
  stylesheet the renderer ships, over tokens aliased from `base.css`
  (`styles/tailwind.css`); the rest of the renderer stays plain CSS. A
  coding agent's transcript is drawn with the same components over the same
  shape ("Agent tabs" above).
- **Following.** The list keeps to its newest line while it is scrolled
  there; scrolling up to read leaves it in place, with a button back to the
  newest line, until the developer scrolls back down.
- **States.** Reading, a read that failed with `Try again`, and a plan with
  nothing said yet: "Nothing said yet — start a call and the transcript
  appears here."

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

### How the planning model reads code

The planning model reads the plan's repository, never a folder on the Mac,
and so does the code it puts on the developer's screen.
`run_in_repository` runs one bash command in a Vercel Sandbox the planning
conversation's eve session owns (`apps/web/eve/sandbox.ts`), on a checkout of
the plan's GitHub repository (`apps/web/server/hosted/repository-shell.ts`).
The first call that finds no checkout of the plan's repository makes one, at
the repository's current default branch and one commit deep, and later calls
reuse it; a plan whose repository changed is checked out again. Before the
checkout, the service confirms the developer still reaches the repository
through the Luke GitHub App and mints an installation token for that one
repository with contents read, which it sets as a header at the sandbox's
firewall for the clone and withdraws after it; the token never enters the
sandbox. The sandbox's network is otherwise eve's default, open internet.
The worker subagent shares the session's sandbox, so its reads see the same
checkout. A call that runs nothing answers `not-run` with a reason the model
can act on and repeats to Luke: the plan has no repository yet (the developer
picks one in the app), the developer must sign in with GitHub again, the
repository is no longer reachable through the App, or the checkout failed;
in every case nothing of the code has been read, and Luke never describes it
as read.

`show_code` (`apps/web/server/hosted/show-code.ts`) reads from the same
checkout: the file named and a window of at most 200 lines around the lines
pointed at, each line cut to 400 characters, with the path resolved inside
the checkout root and a `.env` file never read. The lines are the call's
answer, so they are journaled with the call, told to the voice as the
`code_shown` turn event once the call has answered, held until Luke next
starts to speak, and sent to the Mac on the `plan.code` frame with the
repository they came from; the Mac colours and draws them and reads nothing
of its own (`packages/host/src/plan-code.ts`). A file that is missing,
outside the checkout, binary, too large, or secret, and a checkout that
cannot be reached, answer `rejected` with why, and nothing goes on screen.

### From a plan to a pull request

A plan with a repository can be handed to a coding agent: a cloud session of
Luke's second eve service, which checks the repository out in a Vercel
Sandbox of its own, implements the plan given as its first message, runs the
repository's checks, and decides whether to open a pull request. The service,
its routes, and what it is told are described in
`apps/web/server/README.md` under "The coding-agent service" and "The
coding-agent routes"; the desktop's Start button ("The Plans tab" above),
agent tabs ("Agent tabs" above), and Settings › Coding agents are how the
developer starts one, watches it, stops it, and chooses what it runs on.

## The journey

The reference plan is "Teammate invitations" on a private repository,
`acme/relay`. Each step shows what the developer does, what Luke says (in
brief), and the document after the notetaker's notes. Luke's lines are
illustrations of tone and order, not prompt text: LUKE-336 writes the
instructions.

### 1. Starting from a GitHub repository

The developer opens the panel's Plans tab. They press
`New plan`, name the plan "Teammate invitations", pick `acme/relay` from the
chip (a repository is reachable once they have signed in with GitHub and
installed the Luke GitHub App on it, which the chip's menu offers), and press
`Start plan`. The header's chip reads `acme/relay`,
and the document shows the untouched template, every field "Unanswered".

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

The model reads `acme/relay` through `run_in_repository`, on a checkout of
`main` in the conversation's sandbox, made on its first call. The thinking dots
show while it reads, and Luke says only what it is doing: "Let me look at how
workspaces and members work first."

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
same `acme/relay` on its chip. They press the microphone, and the model
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

The developer chooses `Copy plan` from the ⋯ menu, or presses ⇧⌘C, and the
toolbar reads `Copied`. The
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
it into the coding agent of their choice, or press `Start` instead, and a
coding agent of Luke's own checks `acme/relay` out in a sandbox, implements
the plan, and decides on a pull request, watched from its tab in the side
panel ("From a plan to a pull request" above). If they later ask Luke for one
more change, the model updates the same document, and Copy copies the new
one.

## Failures the developer sees

- **Microphone or connection.** The existing voice error and notice lines
  appear in the panel's caption strip, as for any call ("the microphone is not
  allowed yet", "Voice is temporarily unavailable"). The microphone button
  retries.
- **Save.** A notetaker run that fails saves nothing and says nothing; the
  next run after the developer speaks again is
  handed the same lines. The tab keeps showing the last saved document.
- **Repository.** A failed or incomplete read is reported to the model as
  such. Luke says it could not read the file and never describes unread code
  as inspected. If access is revoked, the reads fail the same way. Starting a
  new plan shows the reason on the new-plan page.
- **Loading a plan.** The document region shows the failure and `Try again`.
- **Start.** The service refuses to start an agent on a plan with no
  repository (`no-repository`, 409), on one the Luke GitHub App no longer
  reaches for the account (`repository-not-reachable`, 403), or while the
  account must sign in with GitHub again (`github-sign-in-required`, 403),
  and answers `unavailable` where eve did not take the session; the reason is
  said beside the button until the next press. An agent that ends `failed`
  or `cancelled` says so in its tab's head, and anything it pushed stays.

## What each part reuses

This section records where each part comes from. The owning issue may choose
the exact shape.

| Part | Reuse | New |
| --- | --- | --- |
| The tab | The window's shell (`desktop/desktop-shell.tsx`, `desktop/desktop-sidebar.tsx`); `APP_PANEL_TAB` in `@sidecar/guide`, which the sidebar and the counted `panel:tab_change` share (`panel-tabs.tsx`) | `PLANS` in `APP_PANEL_TAB` and the counted tab set; the tab's pages (`desktop/desktop-plans.tsx`) and its control (`use-plans-tab.ts`) (LUKE-347). |
| Acts | `ACT_KIND`, `act-router.ts`, `ActSender`, `registerDesktopIpc` | Rows a panel alone may send, refusing the voice window and the takeover: the plan list read as the tab shows, opening, leaving, starting, and deleting a plan, the repositories the account reaches, a plan's repository, a page of GitHub's opened in the browser, the microphone, and a plan's coding agents (`codingAgents.models`, `codingAgents.defaultRead`, `codingAgents.defaultWrite`, `codingAgents.list`, `codingAgents.start`, `codingAgents.messages`, `codingAgents.stop`, `codingAgents.pullRequest`). |
| Plan list and new-plan page | `@sidecar/panel` controls and the existing button, field, and row styles | The list and the form (LUKE-337). |
| Document body | `MarkdownMessage` (`apps/desktop/src/renderer/markdown-message.tsx`): `react-markdown` with `remark-gfm`, raw HTML not rendered, only `http`/`https` links kept; `styles/markdown.css` | A document-scale style for it. |
| Assumption list | None; it is drawn from `assumptions`, not from Markdown | A bulleted row with the text. |
| Copy | `ACT_KIND.WINDOW_COPY_TEXT` and the clipboard row in `register-desktop-ipc.ts` | The document formatter: body, then `## Assumptions` as `- ` bullets, or "None recorded" (LUKE-352). |
| Voice state | `VoiceView` and `VOICE_COMMAND` (`apps/desktop/src/shared/messages/voice-view.ts`), which main already forwards unchanged to every panel; `useVoiceView` (`use-voice-view.ts`); `LIVE_STATUS` (`@sidecar/live`) | The status word beside the microphone, for the open plan's call alone. |
| Captions, levels, errors | The panel's caption strip (`useCaptionPresentation`, `caption-layout.ts`) and the sidebar's waveform (`desktop/luke-identity.tsx`), unchanged | None. |
| Microphone and notices | `microphoneAccessRow`, `voiceAttentionNote`, `MICROPHONE_UNGRANTED_NOTE`, `hostedVoiceUnavailableNote` (`microphone-access.ts`) | None. |
| The call | The hidden `VoiceWindow` and `VoiceHost` / `useVoiceSession` / `LiveCall` (`renderer/voice/`); `LiveVoiceOrchestrator` (`@sidecar/voice`); the sessions route `/api/voice/sessions` with client delegation | The call is associated with the open plan, and the orchestrator gains the Plans tab's toggle beside the held talk key (LUKE-340); the talk key names the open plan while one is open (LUKE-347). |
| Start, agent tabs, Settings › Coding agents | The toolbar and the side panel (`desktop/side-panel.tsx`, `planning/use-side-panel.ts`); the Transcript tab's AI Elements components; the account preferences route | The split button (`desktop/start-agent-button.tsx`), the agent tab (`planning/agent-tab.tsx`), their control (`planning/use-coding-agents.ts`) and the held transcript read (`planning/use-agent-transcript.ts`), and the Settings page (`settings/coding-agents-page.tsx`). |
| Planning model and document | Hosted storage and the brain host (`apps/web/server/hosted/`); the account client (`packages/hosted`, `packages/credentials`) | The plan record and its one write, `saveNotes` (LUKE-334), the instructions (LUKE-336), research (LUKE-339), the fixed template and its formatter (`packages/hosted/src/plan-template.ts`, LUKE-352), and the notetaker that writes the plan during a call (`apps/web/server/voice/plan-scribe.ts`). |

Two existing rules carry over unchanged:

- **Session replay.** The panel is the one surface that records
  (`apps/desktop/src/renderer/session-replay.ts`, called from `App`), and the
  Plans tab is part of it: every word it draws is masked, as the rest of the
  panel's are, so what leaves the machine is the tab's layout and never the
  plan's words. It draws them with the panel's own text, fields, and
  attributes, and no new way of drawing words. The Transcript tab's root is
  also left out of the recording (`ph-no-capture`), as a second line behind
  the masking, since every word in it is the developer's or Luke's.
- **Secrets.** No credential or account secret enters the document, a caption,
  a counted event, or a trace. The GitHub user token is sealed on the
  `account` row and read only by `apps/web/server/github/github-app.ts`; the
  installation tokens it mints are set at the sandbox's firewall and never
  enter the sandbox; and the model is told to keep secrets out of the plan.
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
  boundaries (fake OpenAI, fake eve, scripted model, a scripted GitHub and a
  sandbox double, PGlite):
  - the checkout of a plan's repository at its default branch, one commit
    deep, with the token at the firewall for the clone alone, and every
    refusal (no repository, not reachable, sign-in required, no sandbox or
    firewall) checking nothing out (`apps/web/tests/repository-shell.test.ts`);
    a coding agent's checkout on the same terms
    (`apps/web/tests/coder-host-checkout.test.ts`); and the Start, list,
    messages, and Stop routes over a fake eve
    (`apps/web/tests/coding-agents-app.test.ts`);
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
  `--profile planning-board --expanded`), on its transcript mid-call
  (`app-smoke-planning-transcript.png`, from
  `--profile planning-transcript --expanded`), and over
  the synthetic plan list with none open (`app-smoke-expanded.png`, the
  window opening on Plans), but neither
  capture has been taken yet.
- **Real voice.** No spoken planning conversation has run against GPT Live:
  ordinary assent, interruption, a continuing answer, a correction, resuming,
  and switching plans by voice are untested outside the fakes.
- **A live GitHub checkout.** No repository has been checked out in a real
  Vercel Sandbox through the Luke GitHub App outside the fakes: the shell is
  held against a sandbox double at eve's boundary and a scripted GitHub
  (`apps/web/tests/repository-shell.test.ts`), and the eve build's sandbox
  prewarm has not been run on Vercel.
- **A coding agent.** No coding agent has run against a real provider, a
  real checkout, a push, or a pull request. The coder eval
  (`apps/web/coder/evals/coder.eval.ts`) runs one turn under a scripted model
  that calls no tool, so no sandbox opens and no repository is checked out,
  and the `coder` service's sandbox `prepare` has not been run on Vercel.

### Known limitations

- **The GitHub App's user token can write.** GitHub sign-in is the Luke
  GitHub App's user authorization (`apps/web/server/auth-policy.ts`,
  `GITHUB_SIGN_IN` with `disableDefaultScope`): it names no OAuth scope, and
  the token reaches the repositories the App is installed on and the
  developer can reach, with the App's registered permissions, contents and
  pull requests read and write among them. The server reads it only to list
  installations and repositories and to confirm a plan's repository is
  reachable (`apps/web/server/github/github-app.ts`); a planning checkout
  runs on an installation token cut to contents read, and a coding agent on
  one cut to contents and pull requests write. An account that signed in
  under the earlier OAuth App may still hold its classic `repo` token until
  it signs in again. `PRIVACY.md` discloses it under "Your account".
- **Signing in with GitHub on a Preview.** A Preview's sign-in goes through
  production's registered callback on the OAuth proxy and lands on the
  Preview's signed-in user (`apps/web/server/README.md`, the OAuth proxy); it
  is held end to end against a fake GitHub in
  `apps/web/tests/auth-proxy-sign-in.test.ts` and has not yet been exercised
  against a deployed Preview.
- **`read_web_page` checks addresses without pinning them.** Every host the
  read reaches, and every redirect hop, is resolved and refused unless all of
  its addresses are public unicast. The check is a lookup ahead of the
  request, though, and the socket is not pinned to the checked address. A
  host whose DNS answer changes between the lookup and the connection (DNS
  rebinding) is the one case it does not cover.
- **The plan list is read, not followed.** A plan started on another Mac
  appears in this Mac's list the next time its Plans tab shows.
