# Tasks: the voice journey and the Tasks tab

This is the reference the Feature Planning MVP builds against (LUKE-331). It
fixes what the developer sees and hears, in order, from picking a GitHub
repository to copying the finished plan, and it names the existing piece of Luke
each part of the Tasks tab is built from. It is a design, not an
implementation: the issues that build it (LUKE-334 document store, LUKE-337 the
first Mac surface, LUKE-347 its move into the panel, LUKE-338 GitHub source
tools, LUKE-340 GPT Live, LUKE-342 review and Copy) own the code and the
tests.

The product decisions behind it are settled in the project specification and
are not reopened here. The two that shape everything below:

- **One saved plan per named task**, one free Markdown text started as a
  copy of the account's template ("The template" below), written by the
  task's coding agents, which take notes into it with `edit_plan` on a call
  or off one, and by the developer, whose editor is the document itself
  ("Editing" below).
  Every save that changes the plan is kept as a revision under the writer
  who made it ("History" below); there is no stale-revision rejection, no
  approval state, and no export record.
- **The model drives the workflow.** Question choice, agreement, corrections,
  and the final review live in the instructions an agent is handed on a call
  (`packages/service/src/agents/coder-host/turn-context.ts`). The agent
  writes the document itself, and a turn opens with the saved document
  where it is new to the agent or someone else saved it since.
  The tab decides nothing; it shows the saved document and the voice state,
  and saves only the developer's own edits of the text.

## What the tab is not

A reviewer can hold the build to these as easily as to the layout:

- No typed-chat composer and no typed fallback. The developer speaks; the only
  text fields are ordinary setup fields (the task's name and the repository
  filter), the editor the document opens in, and a comment thread's reply
  field, and nothing typed into them reaches the model as conversation. An
  edited section reaches it as the document it is handed, marked as the
  developer's own words. The plan's open comment threads reach it the same
  way, as data beside the document; a thread reaches an agent as a request
  only when a member mentions that agent in it with \`@\`, and the agent
  answers it in the thread. An \`@\` of Luke hands the thread to no one.
- No Approve button, no readiness meter, no progress or coverage score, and
  no separate export or handoff screen. Earlier versions of the plan are
  read and restored from its version history ("History" below), which is the
  one place a version is compared with another.
- An assumption is edited like any other line of the text, never confirmed or
  accepted: there is no checkbox, no Accept, and nothing that moves one
  elsewhere.
- The document is the record. What was said on a call can be read back in
  the transcript of the agent it spoke into, but nothing there is a second
  document: it is never copied, edited, or handed to an agent. The document
  itself is what Start hands to a coding agent, as the Markdown Copy puts on
  the clipboard ("From a plan to a pull request" below).
- The work column is the agents'. Each agent started on the task stands in
  a tab of its own, and any of them takes a call; everything else, the plan's document, the task's Inbox, the
  whiteboard ("Whiteboard" below), and the code its agents put on screen, stands
  in a side panel ("Side panel" below) that the developer opens and closes.
  A task opens with the panel shown on its plan; only a first drawing, first
  code, or an Inbox item not yet seen opens it on its own, and there are no
  second documents.
- No window of its own. Tasks live in Luke's one window (LUKE-347): there
  is no separate task window, Dock tile, Cmd-Tab entry, or app menu for it.

## The Tasks tab

Tasks are the window's first place, `Tasks`, beside `Settings`, and the
one the window opens on. The tab draws in the work column beside the
sidebar, one page at a time:

```
 ┌──────────────────────────────────────────────────────────────┐
 │  [ Tasks ]   Settings                                        │
 │  ‹  Teammate invitations                 [ ▶ Start ▾ ] [ ⋯ ]   │
 │     acme/relay                                               │
 │ ──────────────────────────────────────────────────────────── │
 │  # Teammate invitations                          (scrolls)   │
 │  ## Context                                                  │
 │  Only an admin can add someone to a workspace...             │
 │  ## Goal                                                     │
 │  What is true once the work ships, as outcomes a user...     │
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
          ^ the live captions, just above the call bar
```

- **New task page**: the tab's home, whenever no task is open. The task
  list is the window's sidebar, so there is no empty page in between.
- **Document page**: the open task's saved document. Its header and its
  microphone row hold still, and only the document scrolls between them.

Escape unwinds one page at a time, after any open microphone has been muted
(Escape mutes first, as it does for any call): the document page back to the
new-task page, which leaves the task, and the new-task page closes the panel. Escape on the Settings tab's front page comes back to Tasks.

### Opening, leaving, and calls

- Opening a task, from the list or by starting one, makes it the host's one
  **active task**, and every panel's Tasks tab shows it on its document page.
  It opens on the agent tab it last showed, or on its plan: the side panel
  on its Plan tab beside a column that offers **New voice chat** and **New
  agent**.
- A call is about an **agent**, never a task. Any agent's tab can take one,
  from the Call button beside Dictate in its composer, and "+ → New voice
  chat" starts an agent blank and calls it at once. One call stands on a Mac
  at a time: calling another agent asks first, then hangs the call up and
  opens one into that agent. The host creates a call only into an agent of
  the task the panel has open (`compose-live.ts` reads the agent and checks
  its task), and the service checks again.
- A task stays open while the developer turns to Settings or closes the
  window, so a call into one of its agents goes on. While the call's agent's
  tab is on screen, the captions ride its call bar and hold back the spoken
  words its transcript already streams; anywhere else they float at the
  window's foot, and the call card stands while the window has the keyboard.
- A task is left by Back (`‹`) or Escape on its document page, by opening
  another task, or by a sign-out. Leaving a task, or opening another, leaves
  its call standing: the call outlives the tab on screen. Deleting the
  call's task, and signing out, end it.
- Luke takes no keys from the machine. The microphone and speaker mute
  chords answer while a call is in progress wherever the panel stands, and
  Escape mutes and quiets Luke.
- Nothing polls. An agent's saves reach the open task through its tab: once
  the transcript the tab reads shows an `edit_plan` answered, the task is
  read again (`tasks/agent-tab.tsx`).
  The list and the open task are read when a panel shows the Tasks tab; the
  open task again when a task opens, and the list again when one starts or
  is deleted. Leaving the tab leaves the task and its call standing, and
  coming back reads everything again.

### Task list

- Every named task the account owns, newest started first. Opening a task
  moves no row, so a new task stands at the head and nothing else moves.
  The tasks stand in the **Tasks** section, whose head's **View options**
  (the Inbox's sliders) chooses how they are drawn, remembered for each
  workspace on this Mac: Group by Repository (the default), Creator (in a
  shared workspace: You first, then each teammate), or None; Order by Last
  updated (the default), Created, or Name, which orders the groups too; and,
  in a shared workspace, Created by Anyone (the default), Me, or a teammate,
  which while it names someone stands as a chip under the head whose ×
  lifts it, the button wearing a dot. Under Repository, the groups stand
  under their repositories' headers, the repository's name with its owner on
  hover (or `owner/name` where two share a name), "No repository" last. A
  header's chevron folds the group, remembered on this Mac, and a
  repository's + (shown on hover or focus) opens the new-task page with that
  repository already chosen. Each row shows the task's name and, muted at its
  end, the time the order chooses (its last activity, the later of its plan's
  last save and its agents' last turn, or under Created when it was started: "now", "5m", "3h", "2d", "3w", then the date), moved on each
  minute, the full moment on hover. A row says what its group does not: a
  teammate's face under a repository's header, its repository's name under a
  creator's, and both in one run.
- A workspace is a team's shared tasks; the first one, made for the account
  when it signs in, is one like any other. A signed-in account sees the list
  headed by the workspace it lists, its first one until another is chosen. Its menu lists every workspace the
  account is a member of, the listed one checked, then "New workspace…",
  which asks a name and lists the workspace made, and "Workspace settings…",
  which opens Settings' Workspace page on the listed workspace; nothing else
  stands in it. That page (`settings/workspace-page.tsx`) has a picker of
  the account's workspaces, the workspace's name and the account's role,
  and its members: an owner or admin invites an
  address as a member or an admin and sees the invitations still pending,
  each with its accept link to copy and send and a Cancel, under the Mac's
  own Better Auth session; an owner or admin removes a member, and anyone but
  an owner leaves. Its Integrations group holds the GitHub row, with every
  connected GitHub account inset under it, Connected or suspended: for an
  owner or admin, Connect, or once connected, one "Manage on GitHub", which
  opens the GitHub page where accounts are added and repositories chosen;
  a member reads it alone. Linear follows, its Disconnect in its ⋯. Every way into Settings at a place takes one typed link,
  `SettingsLink` (`@luke/settings/settings-views`: a page, a section, a workspace),
  followed by `settings-link.ts`. The list, Pinned, Archived, and the command palette hold the
  chosen workspace's tasks alone, New task starts in it, the repository chip
  lists only the repositories its GitHub reaches (none, read "No repository",
  where it has no GitHub connected, and the task starts with none), and the
  choice is remembered on this Mac. A task whose repository its own
  workspace cannot reach but another of the account's can, one stranded by
  #2524, says so in a banner over every tab of the task, "This plan's
  repository belongs to <workspace> · Move to <workspace>", whose press opens
  Move to workspace on that workspace; nothing moves it without that press,
  since a move shares the task with the other workspace's members.
- An agent an automation started with no task stands among the tasks, not
  in a group of its own: under its repository, under whoever started it, or
  in the one run, ordered with the tasks by its last activity, filtered by
  Created by, and, archived, under Archived tasks. Its row leads with the
  agent's harness mark, as its tab does, giving way to the working mark while
  it works, ends with its automation's clock and its time, and reads in
  semibold while its end is unseen; a press opens the agent's own page, and a
  right-click offers its Copy link, the agent's own link under the listed
  workspace, saying Link copied, then Pin or Unpin, as a task's row offers
  them; ⌘K offers Pin agent or Unpin agent on the agent's own page. An
  archived agent offers no pin.
- Clicking a row opens that task on the document page.
- `New task` at the head of the list leaves any open task for the new-task
  page and focuses its name field. It is drawn as a row of the list, and is
  the selected row whenever the new-task page shows.
- A pinned task stands under **Pinned**, a section above Tasks drawn only
  while any task is pinned, which no view filters. A
  pinned agent with no task stands there among the pinned tasks, ordered the
  same way, and leaves its place among the tasks. Its rows, tabs pinned to
  the sidebar among them, are dragged up and down it to the order the
  developer wants, each drop drawn at once and put back with a toast when
  the service refuses it; a pin not yet dragged stands on top, newest pinned
  first. The order is fractional indexing (`@luke/features/pin-order`): a
  dropped pin takes a key between its new neighbours', so one drop writes one
  pin. A task's or an agent's place is the account's own, beside its pin, and
  follows it to every Mac; a pinned tab's is this Mac's, as the tab's pin is.
  A folded Pinned is not dragged. ⌘K offers Pin task or
  Unpin task for the task on screen, through its row menu's own Pin, and
  none for an archived task.
- An archived task leaves the list. View options' **Archived tasks** turns
  the Tasks section to the archived tasks, grouped and ordered as the view
  says, the pins standing aside, with an Archived chip whose × goes back; it
  is not remembered, so another workspace or the next launch opens on the
  tasks.
  Archiving the open task leaves it for the new-task page, as deleting it
  does, and back and forward pass archived tasks over. A pin is the account's
  own and an archive the workspace's (`PATCH /api/plans/{id}`), so a task of
  a shared workspace one member pinned stands under Pinned for them alone,
  both follow the account to every Mac, and a Pin, an Archive, or the way back from either is drawn at once and
  put back, with a quiet note under the task's row, when the service refuses.
  An agent's pin is the account's own too (`agent_pin`, through
  `PATCH /api/agents/{id}`), drawn at once and put back with a toast when the
  service refuses.
- There is no search in this journey.

### New task

One composer card whose words start a coding agent: the repository chip in
its head row, the Issue chip beside it, and at its foot the model chip on
the account's default, Dictate, File for later, and Start.

1. **Repository**, the chip in the head row: the GitHub mark and the
   `owner/name` of the repository the task is about, which the service keeps
   on the task (`plan.repository`). It starts on the repository of the newest
   started task that has one, and its menu is the app's searchable picker,
   listing the repositories the workspace's GitHub reaches. An agent needs a
   repository, so Start is held without one, and the card says so.
2. **Start**, the round button; Return presses it. It starts the task with
   an empty plan and no call, named by its issue where one was picked and
   Untitled until the agent names it, and the agent on the words, the files,
   and the chosen model, in the one start, then opens the task on the
   agent's tab. ⌘Return on an empty box starts a bare task with no agent,
   and File for later files it in the backlog with the words as its brief;
   neither needs a repository. There is no Plan mode: starting a task never
   opens a call, which only an agent's own tab starts.

### Header

- `‹`, back to the list, which leaves the task.
- The task's name. The toolbar is one row, the side panel's bar's height
  exactly (`--desktop-bar-height`, the one token both take), so their bottom
  borders are one line across the window.
- The task's repository is the sidebar's to name: by the group it stands in,
  or on its row where the list's view groups by creator or not at all.
  A task with none yet, the 13 tasks from before repositories among them,
  shows a compact `Choose repository` chip in the toolbar's actions row, left
  of Start, with the composer's menu: a pick is saved through
  `PATCH /api/plans/{id}`, and a refusal is said beside it. A task can be
  used without a repository.
- **The task's menu**, from the toolbar's ⋯ (drawn while the task's own tab
  is chosen, not on an agent's tab or the Inbox) and from a right-click on the
  task in the sidebar alike: Copy plan (the open task's alone), Rename, Pin or
  Unpin and Archive (an archived task offers Unarchive alone), Change
  repository… (opens the repository picker, hung from the toolbar, opening
  the task first where it is not the open one), Open on GitHub
  (`https://github.com/owner/repository`, for a task with a repository), and
  Permanently delete, last and red, which asks first in a dialog that points
  a task not yet archived at Archive instead. ⇧⌘A archives the open task and
  ⌘⌫ asks to delete it, from any of its tabs.
- An archived task opened from Archived tasks reads and works as any other,
  under a quiet line, "This task is archived", with Unarchive beside it.
- **Start**, a split button (`desktop/start-agent-button.tsx`), drawn
  while the task's own tab is chosen, as the ⋯ is. Its main
  part starts a coding agent on the plan with the account's default model and
  effort; its chevron drops the searchable picker over the models the service
  offers, grouped by provider with the newest first, each under its provider's
  mark and the default checked, with the efforts the chosen model lists and
  "Start with <model> · <effort>" pinned under the scrolling list. What the
  chevron picks is what the main part starts on while the plan's tab stays open, and
  never the account's default, which only Settings changes. A task with no repository has Start unavailable, saying why on
  hover. Each press mints a key of its own, and a press asked again after
  the service did not answer carries the same key, so one press is one agent
  ("From a plan to a pull request" below).
- **Copy plan** stands in the ⋯ menu, with its chord ⇧⌘C still the
  toolbar's, heard on every tab of the task. It is always enabled, however much of the plan is written, and
  copies the current document as described in "Copy". It never launches an
  agent and never asks the model anything.
- The side panel's toggle ("Show panel" / "Hide panel", ⌥⌘B) stands at the
  window's top right, past the toolbar's last button, and stays there whether
  the panel is hidden, beside the document, or full screen.

### Document

- Above the text, one muted line says who last edited the plan, from its
  newest revision ("History" below): "Edited by you · just now", or a coding
  agent by its row's name. A revision a task's own Luke wrote, before tasks
  lost him, still names him. The time moves on once a minute. A task whose
  plan nobody has written since it started shows no line. A press on the
  line opens the plan's version history.
- Each section says the same of the save that last changed it, in a quiet
  line at the end of its heading's row while the pointer or the keyboard is
  on the section, read off the plan's revisions (`sectionEdits` on the
  wire): the newest of the last fifty revisions that changed the section,
  each held against the one before it; a section none of them changed says
  nothing. A heading renamed with nothing beneath it changed keeps the line
  it had, and a rename that changes the words beneath is that revision's
  change. A press on a
  section's line, or Return on it from the keyboard, opens the version
  history on the revision that save made, and opens no editor.
- The sections someone other than the developer changed since they last
  looked at the task on this Mac wear a still tint of Luke's accent, counted
  under the "Edited by" line ("Changed since you last looked · 3 sections ·
  Dismiss") until Dismiss or leaving the task (`planning/use-plan-looks.ts`),
  each section known by its heading.
  A look is the task held open three seconds: from then on every save while
  it stays open counts as seen, so an agent's save typing in while the task
  is open never lights anything. What is kept is the newest save's instant,
  on the
  service's clock, by task id in the renderer's own storage; a task never
  looked at on this Mac lights nothing.
- The sidebar reads the same marks. A task's name stands in the body's
  weight, the open task's too, whose fill is what marks it; a task saved
  after its mark is unread, its name in the heavier weight (and "(unread)"
  to a screen reader), until a look moves the mark past the save. The task
  being looked at is never unread, so a save landing on it while open
  changes nothing. The first list this Mac reads after unread tasks arrived
  marks every task in it no look had marked at its last save, once, so the
  tasks from before are not all unread at once, and so does a list none of
  whose tasks has a mark, which is another account's; a task arriving later
  with no mark, from another Mac, is unread once anything has been saved in
  it since it started.
- The task's name, drawn as its title in the look of a `#` heading
  (`planning/task-title.tsx`), over its text, the saved `body` rendered as
  Markdown, and nothing else: the text has no title line, its assumptions
  are a section of it, and nothing stands in for a section it leaves empty.
  The text is cut into sections as the service cuts it (`planSections` in
  `packages/features/src/plan-document.ts`): what stands before the first
  heading, then each `#` or `##` heading with what stands under it, a
  heading inside a code fence being code. The `assumptions` list beside the
  body, always empty now, is not drawn.
- It is selectable, so a selection can be copied, and it is edited whole in
  place, with its title ("Editing" below).
- When a save lands, the document redraws in place and keeps its scroll
  position, the caret typing in what an agent changed; the developer's own
  edit lands at once.
- If the saved document cannot be read, the region shows the failure and a
  `Try again` button. The tab never draws a document it did not read.

### Whiteboard

Each task has one whiteboard, an Excalidraw scene that the task's agents and
the developer both draw on. It shows in the side panel's Board tab, beside
the document.

- **An agent draws whole diagrams.** Its `draw_on_board` tool
  sends the whole diagram each time: labelled boxes, ellipses, and diamonds,
  text, and arrows between ids. It replaces the previous drawing an agent
  made and leaves what the developer drew. The service only stores it
  (`packages/service/src/tasks/board-tool.ts`). The voice hands a request to
  draw to the agent the call speaks into, as it does any other request.
- **The Mac converts it.** The canvas turns the agents' drawing into
  Excalidraw elements with Excalidraw's own converter, marks them as the
  agents', and puts them in place of the previous ones, then saves the
  scene. An element of theirs that the developer moved goes back where the
  next drawing says.
- **The developer draws with Excalidraw's own tools.** Images, embeds, and
  export are left out. The scene is saved whole once the canvas pauses, and
  the last write wins.
- **An agent reads the board.** A turn opens with the scene as text under
  `[board]` (`board-text.ts`) where it changed since the agent was last
  handed it, so whatever the developer drew is in front of the agent on its
  next turn, and `look_at_board` lets it check what it drew.
- **The Mac reads the board** when a task opens, when the tab shows, and when
  the call's activity says a drawing just settled.
- **Excalidraw is its own bundle** (`whiteboard.js`), loaded the first time a
  board is shown, with its fonts shipped beside it. The bundle every window
  parses never carries it.
- **The board is never recorded.** Its root is left out of the screen
  recording, because a canvas draws its words as pixels that the recording's
  text masking cannot reach.

### Side panel

The open task's supporting views stand in a panel at the window's right,
beside the document and its microphone row, the way a devtool's secondary
sidebar does (`desktop/side-panel.tsx`, `planning/use-side-panel.ts`).

- **Tabs.** `Plan`, the task's document; `Inbox`, what its agents need of
  the developer; `Board`, the task's whiteboard; `Code`, the code its agents
  showed on the task, read by the service from each agent's own checkout
  ("How agents show code" below), live during a call and read back when the
  task opens (`GET /api/plans/{id}/code`,
  `packages/service/src/tasks/task-work-store.ts`), so a restart or a switch
  to another task and back loses none of it; `Comments`, the plan's
  threads; and `Chat`, the task's chat channel. After them stand the workers
  opened from an agent's transcript, then files, pull requests, pages,
  terminals, and browsers, as the "+" lists them. The plan's versions open in
  the whole window ("History" below). The coding agents themselves have tabs
  in the task's column beside the task's own ("Agent tabs" below). The Code
  tab draws every code shown on the task, oldest first, several of one file
  included, a card each under the call it was shown on, the agent's note on
  why it showed it
  above its lines so the feed reads as a walkthrough, a live call's code appending at the
  bottom; the record's copy of a live call's code is told apart by its
  `show_code` call, which the `plan.code` frame carries with its turn and
  time, so it is drawn once. Each card opens its whole file in a File tab,
  one per file, the snippet's lines lit; opening a file already open chooses
  its tab and moves the lit lines, and the "+" lists every file shown under
  Files. The file is read a window of 500 lines at a time as the tab scrolls
  (`GET /api/plans/{id}/file`, `packages/service/src/tasks/task-file.ts`), from GitHub at the
  head of the default branch through the Luke GitHub App, under the rule
  `show_code` keeps
  (`packages/service/src/tasks/shown-file.ts`); a file changed since is drawn as it is now, and
  one not on that branch, or not read at all, says so over the lines an agent
  showed of it. A File tab opened from a code block of the task's Inbox is
  read at the commit the agent named instead. Over the first line of each
  range of the file an agent showed with a note stands that note, a card a
  range, the newest note on a range speaking for it: folded to a line or
  open, as the tab keeps it, its ⋯ offering View in conversation, the
  agent's turn that showed the lines; a tab read at a commit draws only the
  notes shown at that commit. File tabs are kept nowhere. With no code ever shown, the Code tab says so
  quietly rather than going away. The strip scrolls where the agents
  overflow it, and no tab closes.
- **The developer's alone.** The toolbar's toggle and ⌥⌘B show and hide it.
  A closed panel opens on its own only for an agent's first drawing on the
  task's board, the first code an agent puts up, each once per task
  (`planning/use-panel-arrivals.ts`), and a subagent opened from an agent's
  transcript, whose tab it opens on; an open panel keeps its tab, and an arrival on another tab
  sets that tab's label in semibold until it is shown. Its left edge
  drags it between 280 and 720 pixels wide, and the arrow keys move it once
  it has the focus.
- **Kept across launches.** Whether it is open, its tab, and its width are
  this Mac's preference, kept in the window's own storage rather than in
  anything main holds. A kept tab the open task does not have reads as its
  first, so leaving a task or opening another never shows a tab with nothing
  behind it. A fixture run stages its own and keeps nothing.

### Agent tabs

Each agent started on the task has a tab of its own in the task's column
(`desktop/main-tabs.tsx`, `tasks/use-main-tabs.ts`, `tasks/agent-tab.tsx`,
`tasks/use-coding-agents.ts`), opened and selected the moment its Start
lands, and showing its transcript, its calls, and its composer. The column's
strip is the side panel's: tabs drag and step among themselves, close by ×,
Delete, ⌘W, or Close and Close others, hang their cards, and pin to the
sidebar. A column whose last tab closes is back on the plan. The tab each
task last showed is kept, so a task opens as it was left; what an earlier
version kept of the task's Call tab is let go. ⌘T and ⌘W answer the column
holding the focus, the side panel's once the pointer goes into it. A
subagent's tab stays in the side panel.

- **A new agent from the "+".** The column's "+" offers New voice chat,
  where the window has a voice, then New agent, unavailable with Start's
  own reason while Start could not run, then each of the task's agents,
  picking one opening its tab again. Start's split menu offers New voice
  chat at its foot too. New voice chat starts an agent blank, on the
  account's one default model and needing no repository, opens its tab, and
  calls it; a blank agent's first line, typed or spoken, is drawn as any
  other line. New agent opens a draft tab (`tasks/draft-agent-tab.tsx`): no
  transcript yet, the composer focused, and the model chip on the account's
  default. Nothing reaches the service until the first message, which
  starts the agent with those words as its prompt; the agent's own tab then
  takes the draft's place. Closing the draft lets it go.

- **The head.** The model · the effort · the status, which the tab's glyph
  wears (`state-glyph.tsx`): the mark of the harness the model runs in
  (Claude Code or Codex), giving way to the working mark while the agent is
  starting or running, an alert in the danger colour once it failed, and the
  voice's live mark while a call into the agent is in progress. A Stop
  stands while the agent may still write; it asks the service to cancel the
  turn, and anything the agent pushed stays.
- **What it published.** Once the agent has pushed, the head wears a pill
  for its pull request (`tasks/agent-published.tsx`), coloured by where the
  pull request stands with a dot for its checks, which opens it in the
  browser, or a chip naming the branch pushed with no pull request yet. The
  window reads `GET /api/agents/{id}/pull-request` as the tab comes on
  screen, as pages of the transcript land, and the moment the agent ends.
- **The transcript.** The agent's stored `UIMessage`s, drawn with the AI
  Elements components: the plan or prompt it was handed, the developer's
  messages, and each of its turns with its text as Markdown, its reasoning
  folded, and each tool call one row. The lines said on its calls (channel
  `voice`) stand among them in the order said, the developer's in a bubble
  and the agent's as its messages, and each call begins at a divider saying
  its day and time, marked `Live` while it stands, and closes, once it has
  ended, on a line saying how long it ran that hangs the call's card
  (`tasks/call-card.tsx`). Where each call begins and ends is read from the
  agent's calls, `GET /api/agents/{id}/calls` (`tasks/use-agent-calls.ts`),
  read as the tab opens, as a call into the agent ends, and for a call its
  lines name that the read does not hold.
- **The call standing.** Its lines are written into the transcript as they
  are first heard, and the voice window reports them too
  (`VoiceView.callTranscript`); those the transcript does not hold yet grow
  at its foot under the call's divider, so a line is drawn once, from the
  record once the record holds it (`callPlaces`). While the call stands, its
  tab's foot draws the avatar's video, the captions, and the call bar over
  the composer: the voice's status, the speaker, the microphone, and End
  call.
- **Live.** While the tab shows and the agent is starting or running, the
  window reads `GET /api/agents/{id}/messages?after=<cursor>` in a loop on
  the service's held long-poll (`tasks/use-agent-transcript.ts`), ending on
  its own when the agent ends. A call writes its lines whether or not the
  agent still works, so while a call into the agent stands the tab reads it
  through again for each line heard, and once more as the call ends.
- **When it ends.** Main keeps a ledger of where each agent stands
  (`main/agent-notices.ts`) and announces an agent that moves from writing
  to completed or failed once, with a macOS notification titled with the
  task's name and nothing of the transcript, unless the window is focused on
  that agent's tab. The agent's tab reads in semibold until it is shown.
- **Privacy.** Every word is the agent's, the developer's, or the plan's, so
  the tab carries `ph-no-capture`; the call bar and the captions draw inside
  it.
- **The web.** A browser has no voice, so its agent tabs draw their
  transcripts, calls among them, and their composer, with no Call button,
  and its "+" offers no New voice chat.

### Settings › Agents

The model and effort every agent starts on, a voice chat's as a Start's, are
the account's one default, with no voice default of its own, kept on the service with the account preferences
(`/api/account/preferences`'s `codingAgent` part) and shown on the Agents
page of Settings (`settings/coding-agents-page.tsx`): a model menu
with each model under its harness's mark (Claude Code's for Anthropic's,
Codex's for OpenAI's), the efforts the chosen model lists, and, for a
model that offers two context windows (one whose provider prices prompts
past a boundary apart, such as OpenAI's 272K), the two windows with what the
whole one costs past the boundary. The whole window is the default; the
smaller standard one is the opt-in. The Start menu and an agent's chip offer
the same choice as a Context row beside Effort, and the chip says the window
after the effort only where it is the opted-in smaller one ("GPT-5.5 High
272K"). The page
reads the default as it opens, and it is the one place the default changes:
a model chosen from Start's chevron, an agent's chip, a draft, a fork, or by
another agent runs that agent alone. A first-time
account starts on Claude Opus 5.5 at high.

### Transcript

What is said on a call is drawn in the transcript of the agent the call
speaks into ("Agent tabs" above). The service keeps each call's words as
timed fragments (`voice_transcript_segments`) and each line as a row of the
agent's conversation with channel `voice`, and answers an agent's calls,
each with its lines and its record, at `GET /api/agents/{id}/calls`. The
lines are drawn with AI Elements, the AI SDK's chat components, copied into
`packages/panel/src/ai-elements/` and restyled to the panel's tokens.

### Agents' notes

A coding agent writes the task's plan with its `edit_plan` tool
(`packages/service/src/agents/coder-host/plan-edit.ts`): on a call as the talk
settles it, and off one where it meets something the plan does not settle,
finds a fact the plan has wrong, or makes a decision the plan left open. Its
saves go through `saveNotes` (`packages/service/src/tasks/plan-notes.ts`),
the plan's one write.

A call's notes are taken the way a person takes notes on a call, never the
text written out again:

- `add` puts a new point at the end of a section, under the heading it
  names, or opens that section at the end of the text where it has none.
- `replace` is the one generic edit: it replaces text copied exactly from
  the plan, standing once in it, from a phrase to whole sections, headings
  included, with what it becomes; an empty replacement deletes, and a line
  it leaves empty is taken out.

A note's words may open headings of their own, so the notes can rename,
split, merge, move, and drop sections, a move being a deletion and a
replacement or an addition. The notes of one answer save together or not
at all: one naming text or a heading the plan does not hold exactly
once, or one that does not read under the schema, is reported, never guessed
into another, and saves nothing of the call, whose result hands the plan as it
then stands.

Each save is written into
the task's journal (`plan.agent_edits`, the last fifty) as the agent's id,
the instant, and the notes as taken, a deletion kept as a `remove` and a
replaced text cut to 500 characters so the deployment before reads it; a call whose notes do not all land saves
nothing and answers the plan as it stands, to retry from. The agent is named at read time from its
row, so the window's "Edited by" line over the document and the "recent
edits by coding agents" every agent on the task is handed both say what
the row says now.

### Editing

The developer edits the plan whole, in place, with its title
(`planning/plan-document-editor.tsx`; the editor is `renderer/plan-editor/`,
its saves `planning/use-plan-editing.ts` and `@luke/features/plan-edit-model`).
The service lays each save over what others wrote meanwhile
(`packages/features/src/plan-edit.ts`).

- **Opening.** The title and each section are blocks, and nothing on them
  marks them editable. A click into a section's words opens the whole text in
  place, the caret where the click landed. The editor is TipTap, from the editor
  bundle (`plan-editor.js`), which the panel starts loading as it first paints
  and asks for again the first time a block is hovered or selected, and which
  an agent's message box shares (`planning/composer-field.tsx`); it draws the words exactly as the sections were drawn, so
  nothing moves as it opens; a click before the bundle has loaded keeps the
  sections drawn until it has. Everything TipTap's Markdown holds is edited
  as it reads (headings, lists, quotes, code, links, task lists, tables), with
  its own shortcuts; inline HTML, a footnote, a link's definition, and a block
  of HTML are kept byte for byte as locked blocks. A section is added by
  typing its heading.
- **The keyboard.** The document is one Tab stop, at the block selected last
  (the title before any); ↑ and ↓ move between blocks, and with nothing
  focused ↓ selects the first block in view and ↑ the last. Return on a
  section opens the text with the caret at the section's end. Esc or ⌘↩ in
  the editor saves and selects the section the caret stood in.
- **The title.** A click puts the caret in it; Return or ↓ saves it and goes
  into the text at its start; ↑ on the text's first line saves the text and
  comes back into the title; Esc saves it and selects it. It is saved by
  renaming the task, so the name never enters the text, and a title left
  empty or unchanged renames nothing.
- **Saving.** The editor hands its text over once per pause in the typing,
  and the text saves a second after the developer stops and as the editor
  closes, as the document's base and value (`POST /api/plans/{id}/edit`),
  through the plan's one write, under the row's lock, as the developer's
  revision ("History" below). The base is the text the editor opened on,
  then the developer's own last save; one save is out at a time, and the
  editor waits for the last before it goes. A text longer than a document
  may hold says so and is not sent. A block the developer did not touch is
  written back exactly as it stood, so an edit is a change on its own lines
  alone. A save under way says nothing.
- **While others write.** A coding agent, or a teammate, may write while the
  developer types. Where the text still holds the base, the edit replaces
  it. Where it does not, the developer's change is laid over what it holds
  now as a patch, line by line, so a point an agent added meanwhile stays. A
  change to a line someone else also changed is a conflict: nothing is
  saved, and under the editor it says "Luke changed this section while you
  were editing." with **Keep mine**, which saves the developer's words over
  theirs, and **Use Luke's**, which closes the editor on theirs. Each save
  that lands answers with the text merged with what was written since its
  base; the editor takes that part block by block, in place of only the
  blocks it changed where the developer has not changed them since, so the
  caret's block stays, the selection maps through, and it is no step of the
  developer's undo. While the editor is closed, the document types in each
  save that lands.
- **What agents are told.** A turn's standing context names the sections
  the developer last wrote, by heading, under `[sections the developer
  wrote]`, as their decisions, and the agent is told never to reword or
  strike them (`packages/service/src/agents/coder-host/turn-context.ts`). A
  section an agent writes again leaves that list. The voice is not told
  mid-call.
- **Failures.** A save that fails keeps the words and says why under the
  editor ("Not saved: the service did not answer.", "Not saved: this task no
  longer exists.", "Not saved: this task is archived.", or "Not saved: the
  plan would be longer than a plan may be."), with Retry; it is tried again
  when the developer asks or types on, and the editor stays open until it
  saves. Words not yet saved are sent to their task when the developer
  leaves it or opens another. Unsaved words live in the window's memory
  alone, never on disk.
- **Undo.** Inside the editor, the editor's own undo. A saved edit is undone
  from the plan's history.
- **Recording.** The editor and the title stand under `ph-no-capture`, and
  their words are document text, which the recording masks in any case.

### History

Every save that changes the plan is kept as a revision
(`packages/database/src/models/plan-revisions.ts`, table `plan_revision`): the
plan's text as it stood after it, who wrote it (the
developer, editing the text or restoring the earlier revision `restored_from`
names; or a coding agent, by its row; a revision a task's own Luke wrote,
before tasks lost him, keeps the notetaker and the call it was written on),
when its first and latest saves were, and how many notes it took. It is written in
the transaction that saves the plan, so the two never disagree. The same
writer's saves one after another are one revision, an agent's or the
developer's, while the revision's latest save is at most ten minutes old, so
a run of saves is one revision rather than one per pause. Notes that
change nothing are no revision, and a rename is none. A plan written before
history began is found by its first later save, which first records what the
plan held, at its last save, as the plan's first revision ("earlier"). History
starts there: nothing before it is reconstructed. Revisions go when their task
is deleted, and there is no cap on how many a task keeps.

The plan names its newest revision as its last edit, which the document's
"Edited by" line reads ("Document" above), and each section the writer of the
save that last changed it: the actor, the coding agent, and whether on a
call, kept beside the revision by the same locked save, which each section's
line reads.

Version history, in the task's ⋯ menu (the toolbar's and the sidebar row's
right-click alike) and behind the "Edited by" line, takes the whole window
the way Settings does (`desktop/desktop-version-history.tsx`): a column as
wide as the sidebar, with Back at its head, "Version history", and the
revisions newest first, fifty a page
(`GET /api/plans/{id}/revisions`), each as who wrote it ("You", a coding
agent by its row, or "Luke" for a revision a task's own Luke wrote before),
whether on a call, how many changes it made, and
how long ago; the newest is labelled "Current", and the plan from before
history reads "Earlier". The list is read while the view stands and again
whenever the plan is edited meanwhile. The chosen revision, the newest when
the view opens, or, opened from a section's line, the revision that made the
save it names (the oldest whose latest save is at or after the save's
moment, older pages read until one shows it, and the newest where one cannot
be read), is read with the content before it
(`GET /api/plans/{id}/revisions/{seq}`), and drawn read-only under the task's
name as it stands, beside the list (`planning/version-view.tsx`), under a bar with its moment and Restore this
version; the up and down arrows step through the list. A row's ⋯, standing
in its time's place while the row is hovered or focused, and its right-click
offer what applies: Show changes (its sections, for a revision of several
changes), the Open that goes where it was written, and Restore this version.
Over a revision's sections, who wrote it is the one control that opens where
it was written. Every version, the
current one included, is drawn against the one just before it, which is what
the row's change count describes: each section only one side holds is drawn
whole, added or struck, and each section both hold that differs has its
words written in on a green wash and struck out on a red one, word by word
with jsdiff (`planning/plan-history-model.ts`), sections paired by their
headings, the assumptions among them as the section they are. The first
version has nothing before it and is drawn with nothing marked. The view is one step of the window's back and forward
whichever version is chosen, so Back, Escape, and ⌘[ return to the task as
it was left, its side panel untouched. Whatever is opened from it — a
version's Open, a tab from ⌘K — is a visit after it, so ⌘[ comes back to the
view on the version and the sections it was left on, and ⌘] goes on to what
was opened.

Restore this version asks first, in the window's dialog, and then puts the
revision's text back through the plan's one locked save
(`POST /api/plans/{id}/revisions/{seq}/restore`, `restoreRevision` in
`packages/service/src/tasks/plan-notes.ts`). The restore is a revision of the developer's
("You") naming the one it brought back, "Restored the version from Oct 11,
2:14 PM"; it joins no revision and none joins it, so a restore is undone by
restoring the revision before it, and it is allowed during a call. It takes
no base: a save that landed after the version was chosen is the revision
before the restore, and restoring it brings it back. A restore that lands
leaves the version history for the task, whose document the service's answer
replaces at once, and the window's toast says
"Version restored" with an Undo, which restores the version that stood
before it. The newest revision is the plan as it stands, so it offers no
restore.

A save that lands types in where the plan changed. The Tasks tab's caret
types the difference in where it stands (`tasks/task-reveal.ts`): a point
typed at the end of its section, a correction selected and retyped, a struck
line selected and erased. A unit of the document is a section as the
service cuts one ("Document" above), known by its heading, so a section
joining or leaving moves no other words.

### The template

A plan is one free Markdown document (`packages/features/src/plan-document.ts`,
the row's `plan.document`), with no title line, since the task's name is its
own, and its assumptions an ordinary section of the text. Every plan starts
as a copy of its account's own template, copied as the plan starts so a
later edit of the template leaves every plan as it stands. The service keeps
the template in `account_preference.plan_template` and serves it at
`GET`/`PUT /api/account/plan-template` (null goes back to the default); an
account that never wrote one gets `DEFAULT_PLAN_TEMPLATE`
(`packages/features/src/plan-document-template.ts`): the sections below as `##`
headings, each with one plain guidance sentence. The template is plain
Markdown with no convention of its own: whatever guidance it holds is
ordinary text the developer and the agents both see and write over. The first
point an agent's notes add to a section that still holds exactly what the
plan's template put under its heading, where that is one paragraph of prose,
takes the place of those words (`packages/features/src/plan-template.ts`'s
`applyNotesToText`), so a filled section never keeps its prompt above its
answer. A template's list, code, quote, or table is its own starting content
and is kept; once anything else stands in a section, a point is added after
it, and the developer's own edits are never rewritten.

Settings › Plan template is where the developer edits it
(`apps/desktop/src/renderer/settings/plan-template-page.tsx`), signed in
only. The page reads the template as it opens and saves the words a second
after the typing pauses and again as focus leaves the box, one write at a
time, through the `planTemplate.read`/`planTemplate.write` acts and the
coding-agent chain beside the account's default model. A template past
20,000 characters is said and never sent, and words left unsaved as the
page goes that fail to save are said in a toast with a Retry. Reset to
default asks first, waits for any save already out, and writes null, and
stands only while the account holds its own. The template is written in
the plan's own document editor (`settings/plan-template-page.tsx`), under
`ph-no-capture`, with no title and no merged answer to take; Esc leaves it
as focus leaving does. It is built once on the text it opens with and again
only for words it did not write, as a reset's, and should its bundle fail to
load, the template is a plain Markdown textarea instead.

A section is a `#` or `##` heading and what stands under it up to the next,
a deeper heading inside it and a heading in a code fence no heading at all,
known by its heading's words (`planSections`). Who last changed each section
is read off the plan's revisions by heading (`sectionWritersOf`,
`sectionEdits` on the wire), each against the one before it, so a heading
renamed with nothing beneath it changed is the same section under its new
words. An agent's notes may land
anywhere in the text (`applyNotesToText` in `plan-template.ts`): an addition
at the end of the one section under its heading, or as a new section at the
end of the text where the text has none; a replacement names text standing
once in the whole text, headings and whole sections among it, so a heading
is renamed, and a section moved or struck, by replacing it, an empty
replacement deleting; and a note's words may open headings of their own. One answer's notes are taken together or not at all,
under the plan's lock: where one names a phrase or a heading the text does
not hold exactly once, the developer having rewritten it meanwhile among the
reasons, nothing is saved, so a move never strikes without placing, and the
agent's `edit_plan` answers the text as it stands, to retry from. Every plan
the fixed template once kept as fields was carried
over to its text by a one-time backfill (34 plans and 32 revisions in
production), each field's words under its heading.

The agent the developer talks a task through with on a call is their
teammate: someone to bounce ideas off who is also responsible for turning
them into a concrete plan. So the default template is the design doc two
engineering teammates would write after talking a task through in a
meeting, and each section is a question a good teammate asks. The sections
are what the agent asks about, so getting them right is what shapes its
questions. The same document is the whole spec a coding agent builds from,
so the agent talks like a teammate and holds the document to a spec's bar.

Each default section is described once, in `plan-template.ts`: its heading
(`PLAN_FIELD_HEADING`), what it holds and the form it is written in
(`PLAN_FIELD_PURPOSE`), and when it is good enough for an agent to build
from (`PLAN_FIELD_BAR`). An agent on a call is handed all three
(`DOCUMENT_TALK_WORDS` in
`packages/service/src/agents/coder-host/turn-context.ts`).

| Section | The question the agent asks |
| --- | --- |
| Context | What is going on today, and why now? The problem, who it affects, and what prompted the work. |
| Goal | What is true once we are done, as outcomes someone could observe? |
| Approach | How would we build it? The main pieces and how they fit, where each lives by path, the code each follows, and each design decision with its reason. |
| Interfaces | What boundaries change? Every type, schema, table, route, event, tool, or signature added or changed, as code under its file, never function bodies; "None" with the reason. |
| Alternatives | What else could we do, and why not that? |
| Hard parts | What is tricky? Each case as the situation and exactly what the change does: edge cases, failure, cancellation, retry, concurrency, permission, privacy, and performance, and risks. |
| Not doing | What are we leaving out on purpose, and why? |
| Plan of attack | How does the work split, and in what order does it land? Migration and rollout where they apply. |
| Testing | How do we know it works? Each case as "When <situation>, then <exact result>", covering every goal and hard part, then the end-to-end check. |
| Open questions | What do we still need to find out, including a question a coding agent met while implementing, with the assumption it went on under? |
| Assumptions | What the agent proposed and the developer had no preference on. |

- **Decisions live where they answer.** There is no Decisions section. A
  choice of how to build is written under Approach, the option it beat under
  Alternatives, and an edge case's behavior under Hard parts. A proposal of
  the agent's the developer had no view on is an assumption.
- **Agreement is the model's.** Nothing in the text says a section is
  understood, true, or agreed. Resolving each section, or agreeing that one
  does not apply, is the agent's work, and every proposal it takes without
  the developer's view is recorded as an assumption. A filled-in template is not
  evidence that the developer agreed.

The template replaced one built for the coding agent alone (requirements as
rules with Given/When/Then examples, a change map, contracts, a decision log,
and "left to the agent"), drawn from GitHub's
[Spec Kit](https://github.com/github/spec-kit/blob/main/templates/spec-template.md),
OpenAI's
[ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans),
and [Example Mapping](https://cucumber.io/blog/bdd/example-mapping-introduction/).
That template cut alternatives, risks, and steps because no agent-facing
source asked for them, and those are exactly what two teammates argue about.
It also made Luke work through fields rather than think with the developer.
The agent still gets a spec: Interfaces carries the exact shapes, Hard parts
says what the change does in every case a capable agent could guess wrong,
and Testing carries a When/then case with an exact result for every goal and
hard part, which is where the old examples' precision went. The agent
proposes the interfaces and the cases itself for the developer to confirm,
so the call never turns into dictating code or test cases. None of this is validated against a
comparative evaluation.

### Call bar and the panel's voice

- **Call button.** Beside Dictate in an agent's composer, on a platform with
  a voice. One press calls the agent: the call opens and the microphone
  opens. A second press, or the call bar's microphone, mutes it, and the
  microphone stays open between the two because a call runs for minutes. A
  press while another agent's call stands asks first, then hangs that call
  up. The press asks for the microphone first where macOS has not granted
  it, and opens System Settings where it was denied.
- **Status**, at the call bar's left, in two lines. The first is the voice:
  the one word `LIVE_STATUS` names, `Connecting`, `Listening`, `Muted`,
  `Speaking`, or `Closing`, which reads `Handing off` or `About to answer`
  while the voice waits. The second stands only while the agent works on
  the call's turn, with the thinking dots and its pending command. The
  service sends the snapshot as a `plan.activity` frame on the call's own
  socket each time it changes, and the call's end is told as nothing doing.
- **Everything else is the panel's own.** The waveform is the wings', the
  captions ride the call bar, labelled with who is speaking, and a voice
  error or notice takes their strip, with the button left able to try
  again.

### How agents show code

A coding agent reads the task's repository in its own sandbox's checkout
("From a plan to a pull request" below), not a folder on the Mac, and so
does the code it puts on the developer's screen. What only the Mac has, it
reaches with `run_on_mac` (below).

`show_code` (`packages/service/src/tasks/show-code.ts`) reads from the agent's
checkout: the file named and a window of at most 200 lines around the lines
pointed at, each line cut to 400 characters, with the path resolved inside
the checkout root and a `.env` file never read. The call carries a note of
at most 280 characters, the model's own words on what the lines do for the
plan and what to notice, and a call without one shows nothing; a walk
through code is a few calls in order, each a focused range with its own
note. The lines and the note are the call's answer, so they are journaled with the call, told to the voice as the
`code_shown` turn event once the call has answered, held until Luke next
starts to speak, and sent to the Mac on the `plan.code` frame with the
repository they came from; the Mac colours and draws them and reads nothing
of its own (`packages/host/src/task-code.ts`). Every answered call's lines
are read back from the agents' journals when the task opens,
picked by their parts in the statement and read by the same reading
(`shownCodeOf`), which holds to the secret-file rule again, so the Code tab
keeps every code shown after the call. A file that is missing,
outside the checkout, binary, too large, or secret, and a checkout that
cannot be reached, answer `rejected` with why, and nothing goes on screen.

### Commands on the developer's Mac

`run_on_mac` (`packages/service/src/agents/mac-command.ts`) runs one shell
command on the developer's own Mac and answers its exit code and output, for
coding agents and their workers alike, with
no approval: Dean's ruling of 2026-10-13. The call is queued under the
account; a signed-in Mac with Settings › This Mac's "Let agents run commands
on this Mac" on (the default) holds `GET /api/mac-commands` open, takes it,
runs it in the login shell from the home folder
(`packages/host/src/mac-command-runner.ts`), and posts the result back. A
call where no Mac read lately answers `not-run` at once, in one line the
agent repeats. The output is not redacted (`PRIVACY.md`, "Commands agents run on
your Mac").

### From a plan to a pull request

A task with a repository can be handed to a coding agent: a cloud session of
Luke's eve service (`apps/dev`), which checks the repository out in a Vercel
Sandbox of its own, implements the plan given as its first message, runs the
repository's checks, and decides whether to open a pull request. Started
instead on a prompt the developer wrote, it is handed that prompt as its first
message and never the plan, and works in the task's repository the same way. The service,
its routes, and what it is told are described in
`packages/service/README.md` under "The coding-agent service" and "The
coding-agent routes"; the desktop's Start button ("The Tasks tab" above),
the column's New coding agent and the agent tabs ("Agent tabs" above), and Settings › Coding agents are how the
developer starts one, watches it, stops it, and chooses what it runs on.

## Copy

The developer chooses `Copy plan` from the ⋯ menu, or presses ⇧⌘C, and the
toolbar reads `Copied`. The
clipboard holds the current document as readable Markdown: the task's name
as a `#` title over its document exactly as saved, whose assumptions are a
section like any other (`packages/features/src/plan-markdown.ts`), here for
a task named "Teammate invitations":

```markdown
# Teammate invitations

<the document exactly as saved>

## Assumptions

- Invites reuse `memberships` with a `pending` state.
- Members and admins can both invite.
- A withdrawn invite shows a generic invalid-invite page.
- An invite expires after 7 days.
```

This is direct formatting of the saved document, not a second model step.
There is no separate handoff prompt: the plan is what the coding agent
reads. The developer pastes it into the coding agent of their choice, or
presses `Start` instead, and a coding agent of Luke's own checks the
repository out in a sandbox, implements the plan, and decides on a pull
request, watched from its tab in the task's column ("From a plan to a pull
request" above). When an agent or the developer changes the plan later,
Copy copies the new document.

## Failures the developer sees

- **Microphone or connection.** The existing voice error and notice lines
  appear in the panel's caption strip, as for any call ("the microphone is not
  allowed yet", "Voice is temporarily unavailable"). The microphone button
  retries.
- **Save.** An agent's `edit_plan` whose notes do not all land saves nothing
  and answers the plan as it stands, for the agent to retry from. The tab
  keeps showing the last saved document.
- **Repository.** A failed or incomplete read is reported to the agent as
  such, so it never describes unread code as read. If access is revoked, the
  reads fail the same way. Starting a new task shows the reason on the
  new-task page.
- **Loading a task.** The document region shows the failure and `Try again`.
- **Start.** The service refuses to start an agent on a task with no
  repository (`no-repository`, 409), on one the Luke GitHub App no longer
  reaches for the workspace (`repository-not-reachable`, 403), and answers
  `unavailable` where eve did not take the session; the reason is said
  beside the button until the next press. An agent that ends `failed` or
  `cancelled` says so in its tab's head, and anything it pushed stays.

## What each part reuses

This section records where each part comes from. The owning issue may choose
the exact shape.

| Part | Reuse | New |
| --- | --- | --- |
| The tab | The window's shell (`desktop/desktop-shell.tsx`, `desktop/desktop-sidebar.tsx`); `APP_PANEL_TAB` in `@luke/wire/app-settings`, which the sidebar and the counted `panel:tab_change` share (`panel-tabs.tsx`) | `PLANS` in `APP_PANEL_TAB` and the counted tab set; the tab's pages (`desktop/desktop-plans.tsx`) and its control (`use-tasks-tab.ts`) (LUKE-347). |
| Acts | `ACT_KIND`, `@luke/host/act-port`, `ActSender`, `registerDesktopIpc` | Rows a panel alone may send, refusing the voice window and the takeover: the task list read as the tab shows, opening, leaving, starting (in the workspace the sidebar's switcher chose, `desktop/workspace-switcher.tsx` over `desktop/chosen-workspace.ts`), and deleting a task, a workspace made, its pending invitations read, one made, and one canceled, its GitHub organization connected and disconnected, its members read and removed, its photo read and set or removed, and one left (`workspace.create`, `workspace.invitationsRead`, `workspace.invite`, `workspace.invitationCancel`, `workspace.githubConnect`, `workspace.githubDisconnect`, `workspace.membersRead`, `workspace.memberRemove`, `workspace.photoRead`, `workspace.photoSet`, `workspace.leave`), the repositories the account reaches, a task's repository, a page of GitHub's opened in the browser, the microphone, and a task's coding agents (`codingAgents.models`, `codingAgents.defaultRead`, `codingAgents.defaultWrite`, `codingAgents.list`, `codingAgents.start`, `codingAgents.messages`, `codingAgents.stop`, `codingAgents.pullRequest`). |
| Task list and new-task page | `@luke/ui` controls and the existing button, field, and row styles | The list and the form (LUKE-337). |
| Document body | `MarkdownMessage` (`apps/desktop/src/renderer/markdown-message.tsx`): `react-markdown` with `remark-gfm`, raw HTML not rendered, only `http`/`https` links kept; `styles/markdown.css` | A document-scale style for it. |
| Copy | `ACT_KIND.WINDOW_COPY_TEXT` and the clipboard row in `register-desktop-ipc.ts` | The document formatter: the task's name as a title over its text (`packages/features/src/plan-markdown.ts`). |
| Voice state | `VoiceView` and `VOICE_COMMAND` (`packages/voice/src/voice-view.ts`), which main already forwards unchanged to every panel; `useVoiceView` (`use-voice-view.ts`); `LIVE_STATUS` (`@luke/live`) | The status word beside the microphone, for the open task's call alone. |
| Captions, levels, errors | The caption strip (`useCaptionPresentation`, `caption-strip.tsx`) and the sidebar's waveform (`desktop/luke-identity.tsx`) | The strip stands above the call bar and yields spoken words to an on-screen Transcript. |
| Microphone and notices | `microphoneAccessRow`, `voiceAttentionNote`, `MICROPHONE_UNGRANTED_NOTE`, `hostedVoiceUnavailableNote` (`@luke/voice/microphone-access`) | None. |
| The call | The hidden `VoiceWindow` and `VoiceHost` / `useVoiceSession` / `LiveCall` (`renderer/voice/`); `LiveVoiceOrchestrator` (`@luke/voice`); the sessions route `/api/voice/sessions` with client delegation | The call is associated with an agent of the open task, and the orchestrator gains the Tasks tab's toggle beside the held talk key (LUKE-340); the talk key names the open task while one is open (LUKE-347). |
| Start, agent tabs, Settings › Coding agents | The toolbar and the task's column's tabs (`desktop/main-tabs.tsx`, `planning/use-main-tabs.ts`), on the side panel's strip (`desktop/strip-tabs.tsx`, `@luke/ui/tab-strip-model`); the Transcript tab's AI Elements components; the account preferences route | The split button (`desktop/start-agent-button.tsx`), the agent tab (`planning/agent-tab.tsx`), their control (`planning/use-coding-agents.ts`) and the held transcript read (`planning/use-agent-transcript.ts`), and the Settings page (`settings/coding-agents-page.tsx`). |
| The plan | Hosted storage; the account client (`packages/features`, `packages/credentials`) | The task record and its plan's one write, `saveNotes` (LUKE-334), research (LUKE-339), the default template (`packages/features/src/plan-document-template.ts`), the headings and notes it is written in (`packages/features/src/plan-template.ts`, LUKE-352), and a coding agent's `edit_plan` (`packages/service/src/agents/coder-host/plan-edit.ts`). |

Two existing rules carry over unchanged:

- **Session replay.** The panel is the one surface that records
  (`apps/desktop/src/renderer/session-replay.ts`, called from `App`), and the
  Tasks tab is part of it: every word it draws is masked, as the rest of the
  panel's are, so what leaves the machine is the tab's layout and never the
  plan's words. It draws them with the panel's own text, fields, and
  attributes, and no new way of drawing words. An agent's tab is also left
  out of the recording (`ph-no-capture`), as a second line behind the
  masking, since every word in it is the developer's or the agent's.
- **Secrets.** No credential or account secret enters the document, a caption,
  a counted event, or a trace. The GitHub user token is sealed on the
  `account` row and read only by `packages/service/src/github/github-app.ts`; the
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
- The tab's calls and agents are held by hermetic tests at the model and
  transport boundaries (fake OpenAI, fake eve, scripted model, a scripted
  GitHub and a sandbox double, PGlite):
  - a coding agent's checkout of the task's repository, with the token at
    the firewall for the clone alone, and every refusal checking nothing out
    (`packages/service/src/agents/coder-host/checkout.test.ts`); and the
    Start, list, messages, and Stop routes over a fake eve
    (`packages/service/src/agents/coding-agents-app.test.ts`);
  - re-attaching and resuming on the same task;
  - switching tasks and leaving the task leave its call standing, and
    deleting the call's task or signing out ends it;
  - Copy's Markdown, at the store's largest document;
- The Tasks tab (LUKE-347) is held by renderer tests: the tab bar's four
  tabs, the list and document pages, Back leaving the task, the tasks read
  again each time the tab shows, and the host keeping the open task through
  the tab going away, with nothing read on a clock.
  Its regions render as static markup: no composer and no approve controls,
  a new task's untouched template, and the failed, missing, and
  not-connected states.

### Not validated

- **A real Mac.** This Linux VM has no Mac, CI builds nothing for one, and
  the integrated application has not been run on one. The
  Tasks tab in the panel, the document's presentation, the
  document scrolling inside the panel's ceiling,
  the microphone row, and the captions during a call
  have never been seen running. `./scripts/evidence.sh` captures the window
  on the Tasks tab over a synthetic task
  (`app-smoke-tasks.png`, from `--profile tasks`), on the
  task's whiteboard (`app-smoke-tasks-board.png`, from
  `--profile tasks-board`), on its plan beside a call in the task's column
  (`app-smoke-tasks-transcript.png` and `app-smoke-tasks-work.png`, from
  `--profile tasks-transcript` and `--profile tasks-work`),
  and over
  the synthetic task list with none open (`app-smoke-expanded.png`, the
  window opening on Tasks), but neither
  capture has been taken yet.
- **Real voice.** No spoken conversation with Luke has run against GPT Live:
  ordinary assent, interruption, a continuing answer, a correction, resuming,
  and switching tasks by voice are untested outside the fakes.
- **A coding agent.** No coding agent has run against a real provider, a
  real checkout, a push, or a pull request. The coder eval
  (`apps/dev/evals/coder.eval.ts`) runs one turn under a scripted model
  that calls no tool, so no sandbox opens and no repository is checked out,
  and the `dev` service's sandbox `prepare` has not been run on Vercel.

### Known limitations

- **The GitHub App's user token can write.** GitHub sign-in is the Luke
  GitHub App's user authorization (`packages/service/src/auth/auth-policy.ts`,
  `GITHUB_SIGN_IN` with `disableDefaultScope`): it names no OAuth scope, and
  the token reaches the repositories the App is installed on and the
  developer can reach, with the App's registered permissions, contents and
  pull requests read and write among them. The server reads it only to list
  installations and repositories and to confirm a task's repository is
  reachable (`packages/service/src/github/github-app.ts`); a coding agent's
  checkout runs on an installation token cut to contents and pull requests
  write. An account that signed in
  under the earlier OAuth App may still hold its classic `repo` token until
  it signs in again. `PRIVACY.md` discloses it under "Your account".
- **Signing in with GitHub on a Preview.** A Preview's sign-in goes through
  production's registered callback on the OAuth proxy and lands on the
  Preview's signed-in user (`apps/web/server/README.md`, the OAuth proxy); it
  has not yet been exercised against a deployed Preview.
- **`read_web_page` checks addresses without pinning them.** Every host the
  read reaches, and every redirect hop, is resolved and refused unless all of
  its addresses are public unicast. The check is a lookup ahead of the
  request, though, and the socket is not pinned to the checked address. A
  host whose DNS answer changes between the lookup and the connection (DNS
  rebinding) is the one case it does not cover.
- **The task list is read, not followed.** A task started on another Mac
  appears in this Mac's list the next time its Tasks tab shows.
