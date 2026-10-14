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

- **One saved document per named plan**, one free Markdown text started as a
  copy of the account's template ("The template" below), written by the
  plan's notetaker, which takes notes into it ("The notetaker" below), by
  coding agents through the same notes, and by the developer, whose editor
  is the document itself ("Editing" below).
  Every save that changes the plan is kept as a revision under the writer
  who made it ("History" below); there is no stale-revision rejection, no
  approval state, and no export record.
- **The model drives the workflow.** Question choice, agreement, corrections,
  and the final review live in the planning model's instructions, and the
  planning model never writes the document: it is handed the saved document
  every turn, so Luke keeps talking while the notetaker writes.
  The tab decides nothing; it shows the saved document and the voice state,
  and saves only the developer's own edits of the text.

## What the tab is not

A reviewer can hold the build to these as easily as to the layout:

- No typed-chat composer and no typed fallback. The developer speaks; the only
  text fields are ordinary setup fields (the plan's name and the repository
  filter) and the editor the document opens in, and nothing typed into them
  reaches the model as conversation. An edited section reaches it as the
  document it is handed, marked as the developer's own words. Roll out
  ("Header" below) sends Luke one fixed line, `PLAN_ASK.ROLL_OUT`, as the
  developer's typed words; it is a button, not a composer, and no other
  typed line reaches Luke.
- No Approve button, no readiness meter, no progress or coverage score, and
  no separate export or handoff screen. Earlier versions of the plan are
  read and restored from its version history ("History" below), which is the
  one place a version is compared with another.
- An assumption is edited like any other line of the text, never confirmed or
  accepted: there is no checkbox, no Accept, and nothing that moves one
  elsewhere.
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
  captions just above the plan's call bar, or at the window's foot where no
  call bar is drawn. They carry no plan name, and hold back spoken words
  while the side panel is showing the Transcript, which streams the same
  ones.
- A plan is left by Back (`‹`) or Escape on its document page, by opening
  another plan, or by a sign-out. Leaving a plan, or opening another, leaves
  its call standing: the call outlives the plan on screen, and Luke goes on
  hearing, speaking, and writing the call's plan. Only one plan is ever the
  spoken conversation, so another plan's Talk press, or starting a plan,
  hangs the call up and opens one about that plan. Deleting the call's plan,
  open or not, and signing out end it.
- While a call stands, the talk key speaks into it, whatever plan the panel
  has open. With no call, it opens the call about the open plan, and with no
  plan open it does nothing. The microphone and speaker mute chords answer
  while a call is in progress wherever the panel stands, on another plan,
  in Settings, or on the new-plan page.
- Nothing polls. Every change to a plan happens during its call, and the
  notetaker's drafts reach the open plan on the call's own socket as they
  are written. The list and the open plan are read when a panel shows the
  Plans tab; the open plan again when a plan opens, and the list again when
  one starts or is deleted. Leaving the tab leaves the plan and its call
  standing, and coming back reads everything again.

### Plan list

- Every named plan the account owns, newest started first. Opening a plan
  moves no row, so a new plan stands at the head and nothing else moves.
  The plans are grouped under their repositories' headers, the repository's
  name with its owner on hover (or `owner/name` where two share a name), the
  group whose plan was updated most recently first and "No repository" last;
  within a group the order stays newest started first, so no row moves while
  Luke writes. A header's chevron folds the group, remembered on this Mac,
  and its + (shown on hover or focus) opens the new-plan page with that
  repository already chosen. Each row shows the plan's name and, muted at its
  end, how long ago it was last updated ("now", "5m", "3h", "2d", "3w", then
  the date), moved on each minute, the full moment on hover. Pinned and
  archived rows stay flat and name their `owner/repository` beneath.
- A workspace is the account's personal plans or a team's shared plans. A
  signed-in account sees the list headed by the workspace it lists, the
  personal one until another is chosen. Its menu lists every workspace the
  account is a member of, the listed one checked, then "New workspace…",
  which asks a name and lists the workspace made, and "Workspace settings…",
  which opens Settings' Workspace page on the listed workspace; nothing else
  stands in it. That page (`settings/workspace-page.tsx`) has a picker of
  the account's workspaces, the workspace's name and the account's role,
  and for a team's workspace its members: an owner or admin invites an
  address as a member or an admin and sees the invitations still pending,
  each with its accept link to copy and send and a Cancel, under the Mac's
  own Better Auth session; an owner or admin removes a member, and anyone but
  an owner leaves. For a team's owner or admin it holds GitHub repositories: Connect, or the
  connected account's repositories with Disconnect and "Choose repositories
  on GitHub". Every way into Settings at a place takes one typed link,
  `SettingsLink` (`settings-views.ts`: a page, a section, a workspace),
  followed by `settings-link.ts`. The list, Pinned, Archived, and the command palette hold the
  chosen workspace's plans alone, New plan starts in it, the repository chip
  lists its repositories, and the choice is remembered on this Mac.
- Clicking a row opens that plan on the document page (see "Leaving and
  resuming").
- `New plan` at the head of the list leaves any open plan for the new-plan
  page and focuses its name field. It is drawn as a row of the list, and is
  the selected row whenever the new-plan page shows.
- A pinned plan stands under **Pinned**, a section above the rest drawn only
  while any plan is pinned, newest pinned first.
- An archived plan leaves the list for **Archived (n)**, a quiet row at the
  list's foot that unfolds the archived plans, newest archived first.
  Archiving the open plan leaves it for the new-plan page, as deleting it
  does, and back and forward pass archived plans over. Pins and archives are
  the account's (`PATCH /api/plans/{id}`), so they follow it to every Mac,
  and a Pin, an Archive, or the way back from either is drawn at once and
  put back, with a quiet note under the plan's row, when the service refuses.
- There is no search in this journey.

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
   one, in a list that scrolls past a bounded height. The chip only chooses:
   with no GitHub connected to the workspace, its menu says so, with one
   `Open Settings` row for an owner or an admin to the workspace's GitHub
   repositories in Settings, where the App is installed and its
   repositories chosen, and for a member a line to ask one. With no repository used before it reads
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
- The plan's repository is the sidebar's to name, by the group it stands in.
  A plan with none yet, the 13 plans from before repositories among them,
  shows a compact `Choose repository` chip in the toolbar's actions row, left
  of Start, with the composer's menu: a pick is saved through
  `PATCH /api/plans/{id}`, and a refusal is said beside it. A plan can be
  used without a repository; the planning model then says it has none.
- **The plan's menu**, from the toolbar's ⋯ (drawn while the plan's own tab
  is chosen, not on an agent's tab or the Inbox) and from a right-click on the
  plan in the sidebar alike: Copy plan (the open plan alone), Rename, Pin or
  Unpin and Archive (an archived plan offers Unarchive alone), Change
  repository… (opens the repository picker, hung from the toolbar, opening
  the plan first where it is not the open one), Open on GitHub
  (`https://github.com/owner/repository`, for a plan with a repository), and
  Permanently delete, last and red, which asks first in a dialog that points
  a plan not yet archived at Archive instead. ⇧⌘A archives the open plan and
  ⌘⌫ asks to delete it, from any of its tabs.
- An archived plan opened from under Archived reads and works as any other,
  under a quiet line, "This plan is archived", with Unarchive beside it.
- **Start**, a split button (`desktop/start-agent-button.tsx`), drawn
  while the plan's own tab is chosen, as the ⋯ is. Its main
  part starts a coding agent on the plan with the account's default model and
  effort; its chevron drops the searchable picker over the models the service
  offers, grouped by provider with the newest first, each under its provider's
  mark and the default checked, with the efforts the chosen model lists and
  "Start with <model> · <effort>" pinned under the scrolling list, which the
  service also keeps as the account's default. A plan with no repository has Start unavailable, saying why on
  hover. Each press mints a key of its own, and a press asked again after
  the service did not answer carries the same key, so one press is one agent
  ("From a plan to a pull request" below). While the plan's rollout names
  more than one pull request the button reads **Roll out** instead, and says
  "Luke starts a coding agent per PR and one to keep the stack" on hover:
  its main part sends Luke the fixed line "Roll out the plan."
  (`PLAN_ASK.ROLL_OUT`, through `ACT_KIND.PLANNING_MESSAGE`) and Luke starts
  a builder per pull request and one stack keeper for the rollout, on the
  account's default, which the chevron's menu still sets.
  The line's key is kept across a press the service did not answer, as a
  Start's is, so Luke takes it once. A rollout of one pull request, or none,
  keeps Start and its one agent.
- **Copy plan** stands in the ⋯ menu, with its chord ⇧⌘C still the
  toolbar's, heard on every tab of the plan. It is always enabled, however much of the plan is written, and
  copies the current document as described in "Copy". It never launches an
  agent and never asks the model anything.
- The side panel's toggle ("Show panel" / "Hide panel", ⌥⌘B) stands at the
  window's top right, past the toolbar's last button, and stays there whether
  the panel is hidden, beside the document, or full screen.

### Document

- Above the text, one muted line says who last edited the plan, from its
  newest revision ("History" below): "Edited by Luke during your call · 2h
  ago", "Edited by you · just now", or a coding agent by its row's name. The
  notetaker is "Luke", because the developer talks to Luke and never meets a
  notetaker. The time moves on once a minute, and a save the notetaker makes
  on the open plan's call moves the line as it lands. A plan nobody has
  written since it started shows no line. A press on the line opens the
  plan's version history.
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
  looked at the plan on this Mac wear a still tint of Luke's accent, counted
  under the "Edited by" line ("Changed since you last looked · 3 sections ·
  Dismiss") until Dismiss or leaving the plan (`planning/use-plan-looks.ts`),
  each section known by its heading.
  A look is the plan held open three seconds: from then on every save while
  it stays open counts as seen, so the notetaker typing in on a call never
  lights anything. What is kept is the newest save's instant, on the
  service's clock, by plan id in the renderer's own storage; a plan never
  looked at on this Mac lights nothing.
- The sidebar reads the same marks. A plan's name stands in the body's
  weight, the open plan's too, whose fill is what marks it; a plan saved
  after its mark is unread, its name in the heavier weight (and "(unread)"
  to a screen reader), until a look moves the mark past the save. The plan
  being looked at is never unread, so a save landing on it while open
  changes nothing. The first list this Mac reads after unread plans arrived
  marks every plan in it no look had marked at its last save, once, so the
  plans from before are not all unread at once, and so does a list none of
  whose plans has a mark, which is another account's; a plan arriving later
  with no mark, from another Mac, is unread once anything has been saved in
  it since it started.
- The plan's name, drawn as its title in the look of a `#` heading
  (`planning/plan-title.tsx`), over its text, the saved `body` rendered as
  Markdown, and nothing else: the text has no title line, its assumptions
  are a section of it, and nothing stands in for a section it leaves empty.
  The text is cut into sections as the service cuts it (`planSections` in
  `packages/hosted/src/plan-document.ts`): what stands before the first
  heading, then each `#` or `##` heading with what stands under it, a
  heading inside a code fence being code. The `assumptions` list beside the
  body, always empty now, is not drawn.
- It is selectable, so a selection can be copied, and it is edited whole in
  place, with its title ("Editing" below).
- When a save lands, the document redraws in place and keeps its scroll
  position, the caret typing in what the notetaker changed; the developer's
  own edit lands at once.
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

- **Tabs.** `Board`, the plan's whiteboard; `Code`, the code Luke last
  showed on the plan, read by the service from the plan's repository ("How
  the planning model reads code" below), live during a call and read back
  with the plan's work when the plan opens; `Transcript`, what was said on the
  plan's calls ("Transcript" below); `History`, the plan's versions
  ("History" below), which stands once anyone has written the plan since its
  history began; and, after them, the subagents opened from the Work tab or
  an agent's transcript. The coding agents themselves have tabs in the plan's
  column beside the plan's own ("Agent tabs" below). The Work tab, what the planning model wrote
  and ran on the plan's calls, is told live during a call and read back
  from the plan's conversation when the plan opens
  (`GET /api/plans/{id}/work`, `hosted/plan-work-store.ts`), so a restart
  or a switch to another plan and back loses neither it nor the code. The
  read answers twenty turns a page, the newest first; scrolling to the
  oldest turn drawn reads the page before it (`?before=<turn>`), and the
  newest page also carries every code shown on the plan, oldest first,
  several of one file included, all of which the Code tab draws, a card
  each under the call it was shown on, Luke's note on why he showed it
  above its lines so the feed reads as a walkthrough, a live call's code appending at the
  bottom; the record's copy of a live call's code is told apart by its
  `show_code` call, which the `plan.code` frame carries with its turn and
  time, so it is drawn once. Each card opens its whole file in a File tab,
  one per file, the snippet's lines lit; opening a file already open chooses
  its tab and moves the lit lines, and the "+" lists every file shown under
  Files. The file is read a window of 500 lines at a time as the tab scrolls
  (`GET /api/plans/{id}/file`, `hosted/plan-file.ts`), from GitHub at the
  head of the default branch through the Luke GitHub App, since no checkout
  stands outside a call, under the rule `show_code` keeps
  (`hosted/shown-file.ts`); a file changed since is drawn as it is now, and
  one not on that branch, or not read at all, says so over the lines Luke
  showed of it. A File tab opened from a code block of the plan's Inbox is
  read at the commit the agent named instead. Over the first line of each
  range of the file Luke showed with a note stands his note, a card a
  range, the newest note on a range speaking for it: folded to a line or
  open, as the tab keeps it, and a link back to the range's card in the
  Code tab; a tab read at a commit draws none, since his lines are his
  checkout's. File tabs are kept nowhere. With no code ever shown, the Code tab says so
  quietly rather than going away. The strip scrolls where the agents
  overflow it, and no tab closes.
- **The developer's alone.** The toolbar's toggle and ⌥⌘B show and hide it.
  A closed panel opens on its own only for Luke's first drawing on the
  plan's board, the first code he puts up, each once per plan
  (`planning/use-panel-arrivals.ts`), and a subagent opened from an agent's
  transcript, whose tab it opens on; an open panel keeps its tab, and an arrival on another tab
  sets that tab's label in semibold until it is shown. Its left edge
  drags it between 280 and 720 pixels wide, and the arrow keys move it once
  it has the focus.
- **Kept across launches.** Whether it is open, its tab, and its width are
  this Mac's preference, kept in the window's own storage rather than in
  anything main holds. A kept tab the open plan does not have reads as its
  first, so leaving a plan or opening another never shows a tab with nothing
  behind it. A fixture run stages its own and keeps nothing.

### Agent tabs

Each coding agent started on the plan has a tab of its own in the plan's
column, after the plan's tab (`desktop/main-tabs.tsx`,
`planning/use-main-tabs.ts`, `planning/agent-tab.tsx`,
`planning/use-coding-agents.ts`), opened and selected the moment its Start
lands, and showing its transcript and composer where the document stands.
The column's strip is the side panel's: tabs drag and step among
themselves, close by ×, Delete, ⌘W, or Close and Close others, hang their
cards, and pin to the sidebar. The plan's tab stands first for good: it
never closes or moves, a press chooses it, and its right-click offers Close
others and Rename. The tab each plan last showed is kept, so a plan opens
as it was left. ⌘T and ⌘W answer the column holding the focus, the side
panel's once the pointer goes into it. A subagent's tab stays in the side
panel.

- **A new agent from the "+".** The column's "+" offers New coding
  agent, unavailable with Start's own reason while Start could not run, and
  each of the plan's agents, picking one opening its tab again. It
  opens a draft tab (`planning/draft-agent-tab.tsx`): no transcript yet,
  the composer focused, and the model chip on the account's default.
  Nothing reaches the service until the first message, which starts the
  agent with those words as its task, never the plan, in the plan's
  repository; the agent's own tab then takes the draft's place. Closing
  the draft lets it go with nothing left behind. An agent handed a task
  draws it as the developer's first message rather than as the plan's card.

- **The head.** The model · the effort · the status, which the tab's glyph
  wears (`state-glyph.tsx`): the mark of the harness the model runs in
  (Claude Code or Codex), giving way in its own slot to the working mark
  (`working-mark.tsx`) while the agent is starting or running, an alert in
  the danger colour once it failed, and
  the mark alone once it completed or was stopped; the tab's hint says
  "Working", "Failed", or "Stopped" beside the model. A
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
  agent opens last shows the moment it ends. The branch is the one
  checked out in the agent's sandbox as its turn ended, written on its row
  by the service as the sandbox stops, and the pull request is the newest
  from that branch.
- **The transcript.** The agent's stored `UIMessage`s, drawn with the same
  AI Elements components as the Transcript tab, on the same spacing: the
  plan it was handed, the first of the developer's messages, as a Plan card
  folded under its title; any message the developer sent it since as the
  developer's bubble; and each of its own turns with its text as Markdown,
  its reasoning folded under one line that previews its first words, each
  tool call one row saying what it did with the input and the output under
  it once opened (a command's row, drawn muted as the reasoning's line is,
  drops its command while open, since the body shows it whole), a call that
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
  agent's tab reads in semibold until it is shown or the window comes
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
with each model under its harness's mark (Claude Code's for Anthropic's,
Codex's for OpenAI's), the efforts the chosen model lists, and, for a
model that offers two context windows (one whose provider prices prompts
past a boundary apart, such as OpenAI's 272K), the two windows with what the
whole one costs past the boundary. The whole window is the default; the
smaller standard one is the opt-in. The Start menu and an agent's chip offer
the same choice as a Context row beside Effort, and the chip says the window
after the effort only where it is the opted-in smaller one ("GPT-5.5 High
272K"). The page
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
  `GET /api/plans/{id}/transcript` (`packages/database/src/models/transcript-store.ts`), grouped
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
one `gpt-5.6-luna` call over the plan's saved text and what was said since
its last note, under its own instructions (`SCRIBE_INSTRUCTIONS`), and saves
the answer through `saveNotes` (`apps/web/server/hosted/plan-notes.ts`). Its
runs never overlap, so no run of its own races another, and a run that fails
moves nothing forward.

The answer is notes, the way a person takes notes on a call, never the text
written out again:

- `add` puts a new point at the end of a section, under the heading it
  names, or opens that section at the end of the text where it has none.
- `replace` corrects a phrase copied exactly from the text, standing once in
  it and touching no heading, and `remove` strikes the line holding one.

A note naming a phrase the plan does not hold is passed over, reported, and
never guessed into another; a note that does not read under the schema is
passed over alone. The rest save.

A coding agent takes the same notes through its `edit_plan` tool
(`apps/web/server/hosted/coder-host/plan-edit.ts`). Its save is written into
the plan's journal (`plan.agent_edits`, the last fifty) as the agent's id,
the instant, and the notes as taken; the agent is named at read time from its
row, so the window's "Edited by" line over the document and the "recent
edits by coding agents" the planning model is handed both say what the row
says now.

### Editing

The developer edits the plan whole, in place, with its title
(`planning/plan-document-editor.tsx`; the editor is `renderer/plan-editor/`,
its saves `planning/use-plan-editing.ts` and `planning/plan-edit-model.ts`).
The service lays each save over what Luke wrote meanwhile
(`packages/hosted/src/plan-edit.ts`).

- **Opening.** The title and each section are blocks, and nothing on them
  marks them editable. A click into a section's words opens the whole text in
  place, the caret where the click landed. The editor is TipTap, loaded as a
  bundle of its own (`plan-editor.js`) the first time a block is hovered or
  selected, and it draws the words exactly as the sections were drawn, so
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
  renaming the plan, so the name never enters the text, and a title left
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
- **During a call.** Luke may write while the developer types. Where the
  text still holds the base, the edit replaces it. Where it does not, the
  developer's change is laid over what it holds now as a patch, line by
  line, so a point Luke added meanwhile stays. A change to a line Luke also
  changed is a conflict: nothing is saved, and under the editor it says
  "Luke changed this section while you were editing." with **Keep mine**,
  which saves the developer's words over his, and **Use Luke's**, which
  closes the editor on his. The notetaker's drafts never redraw the open
  editor. Each save that lands answers with the text merged with what Luke
  wrote since its base; the editor takes Luke's part block by block, in place
  of only the blocks he changed where the developer has not changed them
  since, so the caret's block stays, the selection maps through, and it is no
  step of the developer's undo. While the editor is closed, the document
  draws Luke's drafts with its typing. A draft the notetaker drew over a
  save older than the developer's edit is dropped rather than drawn, so the
  edit never flickers back out (each `plan.draft` frame names the save it
  was drawn over).
- **What Luke is told.** The planning model's standing context names the
  sections the developer last wrote, by heading, under `[sections the
  developer wrote]`, as their decisions; the notetaker is told the same
  sections and never rewords or strikes them unless the call says to. A
  section the notetaker writes again leaves that list. The voice is not told
  mid-call, and a coding agent already running keeps the plan it was handed.
- **Failures.** A save that fails keeps the words and says why under the
  editor ("Not saved: the service did not answer.", "Not saved: this plan no
  longer exists.", "Not saved: this plan is archived.", or "Not saved: the
  plan would be longer than a plan may be."), with Retry; it is tried again
  when the developer asks or types on, and the editor stays open until it
  saves. Words not yet saved are sent to their plan when the developer
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
names; the notetaker, on the call it listens to; or a coding agent, by its
row), when its first and latest saves were, and how many notes it took. It is written in
the transaction that saves the plan, so the two never disagree. The same
writer's saves one after another are one revision: the notetaker's on one
call, an agent's, or the developer's, while the revision's latest save is at
most ten minutes old, so a call is about one revision rather than one per
pause. Notes that
change nothing are no revision, and a rename is none. A plan written before
history began is found by its first later save, which first records what the
plan held, at its last save, as the plan's first revision ("earlier"). History
starts there: nothing before it is reconstructed. Revisions go when their plan
is deleted, and there is no cap on how many a plan keeps.

The plan names its newest revision as its last edit, which the document's
"Edited by" line reads ("Document" above), and each section the writer of the
save that last changed it: the actor, the coding agent, and whether on a
call, kept beside the revision by the same locked save, which each section's
line reads.

Version history, in the plan's ⋯ menu (the toolbar's and the sidebar row's
right-click alike) and behind the "Edited by" line, takes the whole window
the way Settings does (`desktop/desktop-version-history.tsx`): a column as
wide as the sidebar, with Back at its head, "Version history", and the
revisions newest first, fifty a page
(`GET /api/plans/{id}/revisions`), each as who wrote it ("Luke", "You", or a
coding agent by its row), whether on a call, how many changes it made, and
how long ago; the newest is labelled "Current", and the plan from before
history reads "Earlier". The list is read while the view stands and again
whenever the plan is edited meanwhile. The chosen revision, the newest when
the view opens, or, opened from a section's line, the revision that made the
save it names (the oldest whose latest save is at or after the save's
moment, older pages read until one shows it, and the newest where one cannot
be read), is read with the content before it
(`GET /api/plans/{id}/revisions/{seq}`), and drawn read-only under the plan's
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
whichever version is chosen, so Back, Escape, and ⌘[ return to the plan as
it was left, its side panel untouched. Whatever is opened from it — a
version's Open, a tab from ⌘K — is a visit after it, so ⌘[ comes back to the
view on the version and the sections it was left on, and ⌘] goes on to what
was opened.

Restore this version asks first, in the window's dialog, and then puts the
revision's text back through the plan's one locked save
(`POST /api/plans/{id}/revisions/{seq}/restore`, `restoreRevision` in
`hosted/plan-notes.ts`). The restore is a revision of the developer's
("You") naming the one it brought back, "Restored the version from Oct 11,
2:14 PM"; it joins no revision and none joins it, so a restore is undone by
restoring the revision before it, and it is allowed during a call. It takes
no base: a save that landed after the version was chosen is the revision
before the restore, and restoring it brings it back. A restore that lands
leaves the version history for the plan, whose document the service's answer
replaces at once, and the window's toast says
"Version restored" with an Undo, which restores the version that stood
before it. Until the notetaker's next save lands, the host draws no draft
of the open plan's call, since a turn in flight was written over the
content the restore replaced. The newest revision is the plan as it
stands, so it offers no restore.

The notes type in while they are written. The call streams its answer, and
the notes so far are taken over the saved text exactly as a save would take
them (`textNotesInProgress` in `packages/hosted/src/plan-template.ts`):
every note before the last is whole, and the last is drawn only when it adds
a point, as its text so far. Each draft is sent to the Mac on the call's own
socket as a `plan.draft` frame, at most every 150 ms, then once more as saved,
so each differs from the one before only where the newest note lands. The
host draws each draft in place of the open plan's document, and the Plans
tab's caret types that difference in where it stands: a point typed at the
end of its section, a correction selected and retyped, a struck line selected
and erased. A unit of the document is a section as the service cuts one
("Document" above), known by its heading, so a section joining or leaving
moves no other words. A
run that breaks off sends the saved document back, so no half-written draft
is left standing.

### The template

A plan is one free Markdown document (`packages/hosted/src/plan-document.ts`,
the row's `plan.document`), with no title line, since the plan's name is its
own, and its assumptions an ordinary section of the text. Every plan starts
as a copy of its account's own template, copied as the plan starts so a
later edit of the template leaves every plan as it stands. The service keeps
the template in `account_preference.plan_template` and serves it at
`GET`/`PUT /api/account/plan-template` (null goes back to the default); an
account that never wrote one gets `DEFAULT_PLAN_TEMPLATE`
(`packages/hosted/src/plan-document-template.ts`): the sections below as `##`
headings, each with one plain guidance sentence. The template is plain
Markdown with no convention of its own: whatever guidance it holds is
ordinary text the developer and Luke both see and write over. The first
point Luke's notes add to a section that still holds exactly what the
plan's template put under its heading, where that is one paragraph of prose,
takes the place of those words (`packages/hosted/src/plan-template.ts`'s
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
words. Luke's notes land under the
developer's headings (`applyNotesToText` in `plan-template.ts`): an addition
at the end of its section, or as a new section at the end of the text where
the text has none; a correction or a strike names a phrase standing once in
the whole text and touching no heading, since the headings are the
developer's. Every plan the fixed template once kept as fields was carried
over to its text by a one-time backfill (34 plans and 32 revisions in
production), each field's words under its heading.

Luke is the developer's teammate: someone to bounce ideas off who is also
responsible for turning them into a concrete plan. So the default template is
the design doc two engineering teammates would write after talking a task
through in a meeting, and each section is a question a good teammate asks.
The sections are what the planning model asks about, so getting them right
is what shapes Luke's questions. The same document is the whole spec a coding
agent builds from, so Luke talks like a teammate and holds the document to a
spec's bar.

Each default section is described once, in `plan-template.ts`: its heading
(`PLAN_FIELD_HEADING`), what it holds and the form it is written in
(`PLAN_FIELD_PURPOSE`), and when it is good enough for an agent to build
from (`PLAN_FIELD_BAR`). The planning model is handed all three; the
notetaker is handed the purpose alone, since it records what was said
rather than judging it.

| Section | The question Luke asks |
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
| Assumptions | What Luke proposed and the developer had no preference on. |

- **Decisions live where they answer.** There is no Decisions section. A
  choice of how to build is written under Approach, the option it beat under
  Alternatives, and an edge case's behavior under Hard parts. A proposal of
  Luke's the developer had no view on is an assumption.
- **Agreement is the model's.** Nothing in the text says a section is
  understood, true, or agreed. Resolving each section, or agreeing that one
  does not apply, is Luke's work, and every proposal Luke takes without the
  developer's view is recorded as an assumption. A filled-in template is not
  evidence that the developer agreed.
- **The rollout stands beside the text.** A plan's rollout is the pull
  requests its work lands as, in order, each `{ title, scope, base,
  acceptance }`: `base` is `"main"` or the position, counted from one, of an
  earlier pull request it cannot build without, which the schema holds so
  the rollout has no cycle, and `acceptance` is null while unsaid; at most
  twenty (`ROLLOUT_BOUNDS`). It is no section of the text: the service keeps
  it in `plan.rollout`, answers it as the plan's top-level `rollout`, and
  keeps it on every revision (`plan_revision.rollout`), so the History tab
  marks what a version changed in it and a restore puts it back with the
  text. It is drawn after the text and never stored in it (`rolloutSection`
  in `plan-template.ts`): a `## Rollout` numbered list, `**Title** · base:
  main` or `· base: #2` with the scope under it and `Done when: …` where set,
  or "No rollout yet" while empty, read-only in the window, last in Copy and
  in what a coding agent is handed, and handed to the planning model beside
  the text once it holds one. Nothing writes it yet; the notetaker's rollout
  notes come next. Migration 0096 added both columns, every existing plan and
  revision with an empty rollout.
  `rolloutStacksOf` (`plan-wire.ts`) cuts it into the GitHub stacks it lands
  as, since a stack is a line: each pull request on main starts a chain on
  main, and at each pull request its lowest-numbered child goes on up the
  chain while every other child starts a chain based on it.

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
hard part, which is where the old examples' precision went. Luke proposes
the interfaces and the cases himself for the developer to confirm, so the
call never turns into dictating code or test cases. None of this is validated against a
comparative evaluation.

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
  preference) ride the caption strip just above the call bar, labelled with
  who is speaking, and a voice error
  or notice takes that strip exactly as it does for any call, with the button
  left able to try again. Nothing is kept here; what matters lands in the
  document.

### How the planning model reads code

The planning model reads the plan's repository, not a folder on the Mac,
and so does the code it puts on the developer's screen. What only the Mac
has, it reaches with `run_on_mac` (below).
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
the checkout root and a `.env` file never read. The call carries a note of
at most 280 characters, the model's own words on what the lines do for the
plan and what to notice, and a call without one shows nothing; a walk
through code is a few calls in order, each a focused range with its own
note. The lines and the note are the call's answer, so they are journaled with the call, told to the voice as the
`code_shown` turn event once the call has answered, held until Luke next
starts to speak, and sent to the Mac on the `plan.code` frame with the
repository they came from; the Mac colours and draws them and reads nothing
of its own (`packages/host/src/plan-code.ts`). Every answered call's lines
are read back from the journals with the plan's work when the plan opens,
picked by their parts in the statement and read by the same reading
(`shownCodeOf`), which holds to the secret-file rule again, so the Code tab
keeps every code shown after the call. A file that is missing,
outside the checkout, binary, too large, or secret, and a checkout that
cannot be reached, answer `rejected` with why, and nothing goes on screen.

### Commands on the developer's Mac

`run_on_mac` (`apps/web/server/hosted/mac-command.ts`) runs one shell
command on the developer's own Mac and answers its exit code and output, for
the planning model, its worker, coding agents, and their workers alike, with
no approval: Dean's ruling of 2026-10-13. The call is queued under the
account; a signed-in Mac with Settings › This Mac's "Let agents run commands
on this Mac" on (the default) holds `GET /api/mac-commands` open, takes it,
runs it in the login shell from the home folder
(`packages/host/src/mac-command-runner.ts`), and posts the result back. A
call where no Mac read lately answers `not-run` at once, in one line Luke
repeats. The output is not redacted (`PRIVACY.md`, "Commands agents run on
your Mac").

### From a plan to a pull request

A plan with a repository can be handed to a coding agent: a cloud session of
Luke's second eve service, which checks the repository out in a Vercel
Sandbox of its own, implements the plan given as its first message, runs the
repository's checks, and decides whether to open a pull request. Started
instead on a task the developer wrote, it is handed that task as its first
message and never the plan, and works in the plan's repository the same way. The service,
its routes, and what it is told are described in
`apps/web/server/README.md` under "The coding-agent service" and "The
coding-agent routes"; the desktop's Start button ("The Plans tab" above),
the column's New coding agent and the agent tabs ("Agent tabs" above), and Settings › Coding agents are how the
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
and the document shows the untouched template, every core section
"Unanswered".

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

The developer answers "Yes, that's simpler", and the notetaker takes its
notes. The body reads, in part:

```markdown
# Teammate invitations

## Context

Only an admin can add someone to a workspace, by creating their account by
hand, so members wait on an admin to bring a teammate in.

## Goal

A member invites a teammate by email; the teammate joins by opening the link.

## Approach

- Model an invite as a `memberships` row with `state = pending`, so removal
  covers invites and members alike.
- `src/db/schema/memberships.ts`: a `pending` state.

## Alternatives

- A separate `invitations` table: a second place removal has to reach.

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

Luke hunts for the hard parts one question at a time, from a queue of every
question whose prerequisites are already settled, each with his recommended
answer:

> "Picture this: Priya gets an invite, and before she opens it the admin
> removes it. She clicks the link. I'd show her a plain 'This invite is no
> longer valid' page and not tell her who withdrew it. OK?"

The developer agrees. The notetaker writes it under Hard parts: a withdrawn
or accepted link never grants access again, and the page reads "This invite
is no longer valid". It moves
the withdrawal question out of `Open questions` and adds
`{ text: "A withdrawn invite shows a generic invalid-invite page." }`.
It also adds `{ text: "An invite expires after 7 days." }` as
a recommended working assumption, which Luke names aloud as one.

### 4. A correction

The developer says: "Actually, no. Any member should be able to invite, not only
admins."

The model treats the correction first, before its own line of questioning:

- It rewrites the assumption to "Members and admins can both invite."
- It updates every section where "admin" was assumed.
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
design tree has been asked about: every core section holds an answer or an
agreed reason it does not apply, every hard part says how the change
behaves, nothing open would change what gets built, and every choice the
developer does not mind either way is stated as an assumption. The planning
model queues only decisions that change what is built or how it is checked,
and states the rest as working assumptions Luke says aloud. Once the plan is
done it queues nothing more and tells Luke the plan is complete, and Luke
drops whatever questions he still holds. A developer who stops before then
is never told the plan is complete: the model says it is not complete yet and
names what is still unanswered, and Luke asks whether to settle it now or
leave it open.

That, or the developer saying "I think that's everything", starts the review:
Luke reviews the document aloud before it is copied. It covers:

- every section still holding only its template's guidance;
- every assumption, one at a time ("I assumed invites expire after 7 days.
  Keep that?");
- anything left in `Open questions`;
- any contradiction between sections.

The developer keeps the expiry. They drop one open question as out of scope,
and the model moves it into Not doing. The review is conversation, not
a screen: the tab shows only the document changing as the model saves. Every
assumption left in the list is copied with the plan as a stated working
assumption.

### 7. Copy

The developer chooses `Copy plan` from the ⋯ menu, or presses ⇧⌘C, and the
toolbar reads `Copied`. The
clipboard holds the current document as readable Markdown: the plan's name
as a `#` title over its document exactly as saved, whose assumptions are a
section like any other, then the rollout, which reads `_No rollout yet_`
until one is cut (`packages/hosted/src/plan-markdown.ts`):

```markdown
# Teammate invitations

<the document exactly as saved>

## Assumptions

- Invites reuse `memberships` with a `pending` state.
- Members and admins can both invite.
- A withdrawn invite shows a generic invalid-invite page.
- An invite expires after 7 days.

## Rollout

_No rollout yet_
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
  reaches for the workspace (`repository-not-reachable`, 403), and answers
  `unavailable` where eve did not take the session; the reason is said
  beside the button until the next press. An agent that ends `failed` or
  `cancelled` says so in its tab's head, and anything it pushed stays.

## What each part reuses

This section records where each part comes from. The owning issue may choose
the exact shape.

| Part | Reuse | New |
| --- | --- | --- |
| The tab | The window's shell (`desktop/desktop-shell.tsx`, `desktop/desktop-sidebar.tsx`); `APP_PANEL_TAB` in `@sidecar/guide`, which the sidebar and the counted `panel:tab_change` share (`panel-tabs.tsx`) | `PLANS` in `APP_PANEL_TAB` and the counted tab set; the tab's pages (`desktop/desktop-plans.tsx`) and its control (`use-plans-tab.ts`) (LUKE-347). |
| Acts | `ACT_KIND`, `act-router.ts`, `ActSender`, `registerDesktopIpc` | Rows a panel alone may send, refusing the voice window and the takeover: the plan list read as the tab shows, opening, leaving, starting (in the workspace the sidebar's switcher chose, `desktop/workspace-switcher.tsx` over `desktop/chosen-workspace.ts`), and deleting a plan, a workspace made, its pending invitations read, one made, and one canceled, its GitHub organization connected and disconnected, its members read and removed, and one left (`workspace.create`, `workspace.invitationsRead`, `workspace.invite`, `workspace.invitationCancel`, `workspace.githubConnect`, `workspace.githubDisconnect`, `workspace.membersRead`, `workspace.memberRemove`, `workspace.leave`), the repositories the account reaches, a plan's repository, a page of GitHub's opened in the browser, the microphone, and a plan's coding agents (`codingAgents.models`, `codingAgents.defaultRead`, `codingAgents.defaultWrite`, `codingAgents.list`, `codingAgents.start`, `codingAgents.messages`, `codingAgents.stop`, `codingAgents.pullRequest`). |
| Plan list and new-plan page | `@sidecar/panel` controls and the existing button, field, and row styles | The list and the form (LUKE-337). |
| Document body | `MarkdownMessage` (`apps/desktop/src/renderer/markdown-message.tsx`): `react-markdown` with `remark-gfm`, raw HTML not rendered, only `http`/`https` links kept; `styles/markdown.css` | A document-scale style for it. |
| Copy | `ACT_KIND.WINDOW_COPY_TEXT` and the clipboard row in `register-desktop-ipc.ts` | The document formatter: the plan's name as a title over its text, then `## Rollout` (`packages/hosted/src/plan-markdown.ts`). |
| Voice state | `VoiceView` and `VOICE_COMMAND` (`apps/desktop/src/shared/messages/voice-view.ts`), which main already forwards unchanged to every panel; `useVoiceView` (`use-voice-view.ts`); `LIVE_STATUS` (`@sidecar/live`) | The status word beside the microphone, for the open plan's call alone. |
| Captions, levels, errors | The caption strip (`useCaptionPresentation`, `caption-strip.tsx`) and the sidebar's waveform (`desktop/luke-identity.tsx`) | The strip stands above the call bar and yields spoken words to an on-screen Transcript. |
| Microphone and notices | `microphoneAccessRow`, `voiceAttentionNote`, `MICROPHONE_UNGRANTED_NOTE`, `hostedVoiceUnavailableNote` (`microphone-access.ts`) | None. |
| The call | The hidden `VoiceWindow` and `VoiceHost` / `useVoiceSession` / `LiveCall` (`renderer/voice/`); `LiveVoiceOrchestrator` (`@sidecar/voice`); the sessions route `/api/voice/sessions` with client delegation | The call is associated with the open plan, and the orchestrator gains the Plans tab's toggle beside the held talk key (LUKE-340); the talk key names the open plan while one is open (LUKE-347). |
| Start, agent tabs, Settings › Coding agents | The toolbar and the plan's column's tabs (`desktop/main-tabs.tsx`, `planning/use-main-tabs.ts`), on the side panel's strip (`desktop/strip-tabs.tsx`, `planning/tab-strip-model.ts`); the Transcript tab's AI Elements components; the account preferences route | The split button (`desktop/start-agent-button.tsx`), the agent tab (`planning/agent-tab.tsx`), their control (`planning/use-coding-agents.ts`) and the held transcript read (`planning/use-agent-transcript.ts`), and the Settings page (`settings/coding-agents-page.tsx`). |
| Planning model and document | Hosted storage and the brain host (`apps/web/server/hosted/`); the account client (`packages/hosted`, `packages/credentials`) | The plan record and its one write, `saveNotes` (LUKE-334), the instructions (LUKE-336), research (LUKE-339), the default template (`packages/hosted/src/plan-document-template.ts`), the headings and notes it is written in (`packages/hosted/src/plan-template.ts`, LUKE-352), and the notetaker that writes the plan during a call (`apps/web/server/voice/plan-scribe.ts`). |

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
  - switching plans and leaving the plan leave its call standing, and
    deleting the call's plan or signing out ends it;
  - the final review written into the same document;
  - Copy's Markdown, at the store's largest document;
  - the talk key, pressed while a plan is open, speaking into the open
    plan's call.
- The Plans tab (LUKE-347) is held by renderer tests: the tab bar's four
  tabs, the list and document pages, Back leaving the plan, the plans read
  again each time the tab shows, and the host keeping the open plan through
  the tab going away, with nothing read on a clock.
  Its regions render as static markup: no composer and no approve controls,
  a new plan's untouched template, and the failed, missing, and
  not-connected states.

### Not validated

- **A real Mac.** This Linux VM has no Mac, CI builds nothing for one, and
  `./scripts/verify.sh` has not been run on the integrated application. The
  Plans tab in the panel, the document's presentation, the
  document scrolling inside the panel's ceiling,
  the microphone row, and the captions during a planning call
  have never been seen running. `./scripts/evidence.sh` captures the window
  on the Plans tab over a synthetic plan
  (`app-smoke-planning.png`, from `--profile planning`), on the
  plan's whiteboard (`app-smoke-planning-board.png`, from
  `--profile planning-board`), on its transcript mid-call
  (`app-smoke-planning-transcript.png`, from
  `--profile planning-transcript`), on its Work tab mid-call
  (`app-smoke-planning-work.png`, from `--profile planning-work`),
  and over
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
  has not yet been exercised against a deployed Preview.
- **`read_web_page` checks addresses without pinning them.** Every host the
  read reaches, and every redirect hop, is resolved and refused unless all of
  its addresses are public unicast. The check is a lookup ahead of the
  request, though, and the socket is not pinned to the checked address. A
  host whose DNS answer changes between the lookup and the connection (DNS
  rebinding) is the one case it does not cover.
- **The plan list is read, not followed.** A plan started on another Mac
  appears in this Mac's list the next time its Plans tab shows.
