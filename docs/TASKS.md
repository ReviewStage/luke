# Tasks: how a task behaves

A task is a name, one saved description, and the agents started on it. This file
describes what the window shows and does for one, section by section: the
list, the description and how it is edited and kept, the agents, and Copy. Code
comments cite it by section heading.

## The Tasks tab

Tasks are the window's first place, `Tasks`, beside `Settings`, and the
one the window opens on, on Home. The tab draws in the work column beside the
sidebar, one page at a time:

```
 ┌──────────────────────────────────────────────────────────────┐
 │  [ Tasks ]   Settings                                        │
 │  [ Description ]  Inbox  Comments  +                  [ ⋯ ]  │
 │ ──────────────────────────────────────────────────────────── │
 │  acme/relay  ›  ACME-42                                      │
 │  # Teammate invitations                          (scrolls)   │
 │  ( In progress )  ( High )  ( Ada )                          │
 │  ## Context                                                  │
 │  Only an admin can add someone to a workspace...             │
 │  ## Goal                                                     │
 │  - A member invites a teammate by email.                     │
 │  ...  (every section written so far, in order)               │
 │  ## Open questions                                           │
 │  - Who can withdraw an invite...                             │
 │  ## Assumptions                                              │
 │  - Members and admins can both invite.                       │
 │  - An invite expires after 7 days.                           │
 └──────────────────────────────────────────────────────────────┘
```

- **Home** (`desktop/desktop-home.tsx`): whenever no task is open the
  window rests on Home, which the sidebar's Home row and ⇧⌘H open too: a
  greeting over New task's composer, then the Inbox's items waiting on the
  developer, then Recent, the tasks worked on latest. An account with
  nothing yet, no task and nothing an agent waits on it for
  (`tasks/fresh-account.ts`), sees a welcome with the composer instead
  (`desktop/desktop-welcome.tsx`). There is no empty page in between. The
  sidebar's rows over its sections are New task, Search, Home, Inbox, Tasks,
  Automations, and, for an admin, Admin.
- **Document page**: the open task's saved document. Its header holds
  still, and only the document scrolls beneath it.

Escape on the document page is Back: one step back through the window's
history, to wherever the task was opened from, or to Home where nothing
stands behind it, which leaves the task; on Home it closes nothing. Escape
on any Settings page leaves Settings.

### Opening and leaving

- Opening a task, from the list or by starting one, makes it the host's one
  **active task**, and every panel's Tasks tab shows it on its document page.
  It opens on the tab it last showed, or on its Overview, its description, where
  none stands, the column's "+" offering **New agent**.
- A task stays open while the developer turns to Settings or closes the
  window.
- A task is left by Back or Escape, by opening another task or page, or by
  a sign-out.
- Nothing polls. An agent's saves reach the open task through its tab: once
  the transcript the tab reads shows an `edit_description` answered, the task is
  read again (`tasks/agent-tab.tsx`).
  The list and the open task are read when a panel shows the Tasks tab; the
  open task again when a task opens, and the list again when one starts or
  is deleted. Leaving the tab leaves the task standing, and coming back
  reads everything again.

### Task list

- The tasks stand in the **Tasks** section, the work under way: the
  reader's own tasks, those assigned to them and those no one is on that
  they created, to do and in progress alone, newest updated first
  (`@repo/ui/task-list-model`). Opening a task moves no row. The backlog and
  the settled tasks are left to the Tasks page, which a quiet line under the
  list opens, saying how many it leaves out. The head's **View options**
  (the Inbox's sliders) chooses how the list is drawn, remembered for each
  workspace on this Mac (`desktop/sidebar-task-view.tsx`): Group by
  Repository (the default) or None, and, in a shared workspace, Assigned to
  Me (the default), Anyone, or a teammate. The head says whose tasks the list
  holds, "My tasks", "Everyone's tasks", or a teammate's name, and while it
  holds anything but the reader's own the button wears a dot. Under
  Repository, the groups stand under their repositories' headers, the
  repository's name with its owner on hover (or `owner/name` where two share
  a name), "No repository" last. A header's chevron folds the group,
  remembered on this Mac, and a repository's + (shown on hover or focus)
  opens New task with that repository already chosen. Each row shows the
  task's name and, muted at its end, its last activity, the later of its
  description's last save and its agents' last turn ("now", "5m", "3h", "2d", "3w",
  then the date), moved on each minute, the full moment on hover. A row
  wears its assignee's face, but in a list of one teammate's tasks, and its
  repository's name where the list is not grouped by repository.
- A workspace is a team's shared tasks; the first one, made for the account
  when it signs in, is one like any other. A signed-in account sees the list
  headed by the workspace it lists, its first one until another is chosen. Its menu lists every workspace the
  account is a member of, the listed one checked, then "New workspace",
  which asks a name and lists the workspace made, and "Workspace settings",
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
  `SettingsLink` (`@repo/settings/settings-views`: a page, a section, a workspace),
  followed by `settings-link.ts`. The list, Pinned, and the command palette hold the
  chosen workspace's tasks alone, New task starts in it, the repository chip
  lists only the repositories its GitHub reaches (none, read "No repository",
  where it has no GitHub connected, and the task starts with none), and the
  choice is remembered on this Mac. A task whose repository its own
  workspace cannot reach but another of the account's can, one stranded by
  #2524, says so in a banner over every tab of the task, "This task's
  repository belongs to <workspace> · Move to <workspace>", whose press opens
  Move to workspace on that workspace; nothing moves it without that press,
  since a move shares the task with the other workspace's members.
- An agent an automation started with no task stands among the tasks, not
  in a group of its own: under its repository or in the one run, as the
  reader's where the reader started it, and ordered with the tasks by its
  last activity. Its row leads with the
  agent's harness mark, as its tab does, giving way to the working mark while
  it works, ends with its automation's clock and its time, and reads in
  semibold while its end is unseen; a press opens the agent's own page, and a
  right-click offers its Copy link, the agent's own link under the listed
  workspace, saying Link copied, then Pin or Unpin, as a task's row offers
  them; ⌘K offers Pin agent or Unpin agent on the agent's own page. An
  archived agent offers no pin.
- Clicking a row opens that task on the document page.
- `New task`, the first of the sidebar's rows (`NewTaskButton` in
  `desktop/desktop-sidebar.tsx`), or ⌘N, opens New task in a dialog over the
  window (`tasks/new-task-dialog.tsx`), leaving whatever stands open in
  place, with the focus in its composer; on Home, which holds the same
  composer, it hands that composer the focus instead. Escape, or a press on
  the dimmed window, puts the dialog away, its words and files kept as New
  task's draft, which Home's composer shares.
- A pinned task stands under **Pinned**, a section above Tasks drawn only
  while any task is pinned, which no view filters. A
  pinned agent with no task stands there among the pinned tasks, ordered the
  same way, and leaves its place among the tasks. Its rows, tabs pinned to
  the sidebar among them, are dragged up and down it to the order the
  developer wants, each drop drawn at once and put back with a toast when
  the service refuses it; a pin not yet dragged stands on top, newest pinned
  first. The order is fractional indexing (`@repo/features/pin-order`): a
  dropped pin takes a key between its new neighbors', so one drop writes one
  pin. A task's or an agent's place is the account's own, beside its pin, and
  follows it to every Mac; a pinned tab's is this Mac's, as the tab's pin is.
  A folded Pinned is not dragged. ⌘K offers Pin task or
  Unpin task for the task on screen, through its row menu's own Pin.
- A pin is the account's own (`PATCH /api/plans/{id}`), so a task of a
  shared workspace one member pinned stands under Pinned for them alone, the
  pin follows the account to every Mac, and a Pin or Unpin is drawn at once
  and put back, with a quiet note under the task's row, when the service
  refuses.
  An agent's pin is the account's own too (`agent_pin`, through
  `PATCH /api/agents/{id}`), drawn at once and put back with a toast when the
  service refuses.

### New task

One composer card whose words start an agent: the repository chip in
its head row, and at its foot the model chip on the account's default,
Dictate, and Start.

1. **Repository**, the chip in the head row: the GitHub mark and the
   `owner/name` of the repository the task is about, which the service keeps
   on the task (`task.repository`). It starts on the repository of the newest
   started task that has one, and its menu is the app's searchable picker,
   listing the repositories the workspace's GitHub reaches, with No
   repository pinned under them. A task with no repository starts its agent
   in none: it has no checkout and opens no pull request, and works with what
   it was handed and the MCP servers connected.
2. **Start**, the round button; Return presses it. It starts the task with
   an empty description, Untitled until the agent names it, and the
   agent on the words, the files,
   and the chosen model, in the one start, then opens the task on the
   agent's tab. ⌘Return on an empty box starts a bare task with no agent.
   There is no Plan mode.

### Header

- In a wide window the task's column has no head of its own: its toolbar
  is its agents' tab strip ("Agent tabs" below), whose actions are the
  chosen agent's ⋯ and the summary's toggle, with no Back and no task name
  (`desktop/desktop-tasks.tsx`). A narrow window draws a head over it
  (`TaskHead`), with Back, the task's name, and one ⋯. The toolbar is one
  row, the side panel's bar's height exactly (`--desktop-bar-height`, the
  one token both take), so their bottom borders are one line across the
  window.
- The description says the rest around its title (`tasks/task-standing.tsx`). Over
  it stands the task's path: its repository, or "Choose a repository" while
  it has none, then its parent task where it has one, then its key. The
  repository's crumb drops the composer's searchable menu, as ⌘K's Change
  repository does: a pick is saved through `PATCH /api/plans/{id}`, and a
  refusal is said under the path. A task can be used without a repository.
  Under the title stand the status, priority, and assignee chips.
- **The task's menu**, from the ⋯ in the side panel's bar while the Description tab
  is chosen and from that tab's right-click, and from a right-click on the
  task's row in the sidebar alike (`desktop/task-actions.tsx`): Copy description
  (the open task's alone) and Copy link, Rename, Version history, Mark as
  unread, the task's relations, Pin or Unpin, Move to workspace, and
  Permanently delete, last and red. The Description tab's menu leaves out the
  task's status, priority, assignee, and repository, which its chips and
  path change; a row's menu, with no chips beside it, holds Status,
  Priority, and Assignee as submenus, and Change repository. Permanently
  delete asks first in a dialog that offers Mark done instead, and ⌘⌫ asks
  to delete the open task from any of its tabs. A task is not archived but
  settled: Mark done, on a sidebar row's hover or in the menu bar, sets it
  Done as Status's Done does.
- **Copy description** stands in the ⋯ menu, with its chord ⌥⌘C, "Copy description or
  transcript", which copies what the focused pane shows: the description where the
  description is focused, an agent's transcript where its tab is. ⇧⌘C is Copy link.
  Copy description is always enabled, however much of the description is written, and
  copies the current document as described in "Copy". It never launches an
  agent and never asks the model anything.
- The side panel's toggle ("Show panel" / "Hide panel", ⌥⌘B) stands at the
  window's top right, past the toolbar's last button, and stays there whether
  the panel is hidden, beside the document, or full screen.

### Document

- Above the text, one muted line says who last edited the description, from its
  newest revision ("History" below): "Edited by you · just now", or an agent by its row's name. The time moves on once a minute. A task whose
  description nobody has written since it started shows no line. A press on the
  line opens the description's version history.
- Each section says the same of the save that last changed it, in a quiet
  line at the end of its heading's row while the pointer or the keyboard is
  on the section, read off the description's revisions (`sectionEdits` on the
  wire): the newest of the last fifty revisions that changed the section,
  each held against the one before it; a section none of them changed says
  nothing. A heading renamed with nothing beneath it changed keeps the line
  it had, and a rename that changes the words beneath is that revision's
  change. A press on a
  section's line, or Return on it from the keyboard, opens the version
  history on the revision that save made, and opens no editor.
- The sections someone other than the developer changed since they last
  looked at the task on this Mac wear a still tint of Vespin's accent, counted
  under the "Edited by" line ("Changed since you last looked · 3 sections ·
  Dismiss") until Dismiss or leaving the task (`tasks/use-task-looks.ts`),
  each section known by its heading.
  A look is the description opened, whichever of its column's tabs it opens on:
  from then on every save while it stays open counts as seen, so an agent's save landing while the task
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
  (`tasks/task-title.tsx`), over its text, the saved `body` rendered as
  Markdown, and nothing else: the text has no title line, its assumptions
  are a section of it, and nothing stands in for a section it leaves empty.
  The text is cut into sections as the service cuts it (`descriptionSections` in
  `packages/features/src/description-document.ts`): what stands before the first
  heading, then each `#` or `##` heading with what stands under it, a
  heading inside a code fence being code. The `assumptions` list beside the
  body, always empty now, is not drawn.
- It is selectable, so a selection can be copied, and it is edited whole in
  place, with its title ("Editing" below).
- When a save lands, whoever made it, the document redraws in place at once
  and keeps its scroll position.
- If the saved document cannot be read, the region shows the failure and a
  `Try again` button. The tab never draws a document it did not read.

### Side panel

The open task's supporting views stand in a panel at the window's right,
beside the document, the way a devtool's secondary
sidebar does (`desktop/side-panel.tsx`, `tasks/use-side-panel.ts`).

- **Tabs.** `Comments`, the description's threads. The description's document is the
  column's Overview ("Agent tabs" below), and a Description tab an earlier version
  kept or pinned opens it there. The task's Inbox tab of old is drawn and
  offered nowhere: a link to a thread, or a call's row naming one, opens it
  in the window's Inbox as it stands, its search, view, and channel kept,
  and ⌘K's Inbox row, the summary's, and a call's row naming no thread open
  the window's Inbox narrowed to the task (`/inbox/plan/<taskId>`). After them stand the workers
  opened from an agent's transcript, then files, pull requests, pages,
  terminals, and browsers, as the "+" lists them. The description's versions open in
  the whole window ("History" below). The agents themselves have tabs
  in the task's column beside the task's own ("Agent tabs" below). A file
  named in place, by a mention, a code block of an Inbox thread, or ⌘K,
  opens whole in a File tab, one per file, the lines named lit; opening a
  file already open chooses its tab and moves the lit lines. The file is read
  (`GET /api/plans/{id}/file`, `packages/service/src/tasks/task-file.ts`) from GitHub at the
  head of the default branch through the Vespin GitHub App, a `.env` file never
  read (`packages/service/src/tasks/shown-file.ts`); a file changed since is
  drawn as it is now, and one not on that branch, or not read at all, says so
  in its place. A File tab opened from a code block of an Inbox thread is
  read at the commit the agent named instead. File tabs are kept nowhere.
  The strip scrolls where its tabs overflow it. Every tab closes, Description,
  Inbox, and Comments among them, by its ×, Delete, ⌘W, or Close and Close
  others; the "+" opens one again, and closing the last shuts the panel.
- **The developer's alone.** The toolbar's toggle and ⌥⌘B show and hide it.
  It opens only when the developer opens something into it (a tab from its
  "+", a file, a page, a worker, or a pull request pressed elsewhere) or
  presses its toggle, and a first launch leaves it shut. A tab standing in
  the strip never opens it: a task left while the panel stood hidden by its
  empty strip shuts it, and an agent's cloud browser adds no Browser tab by
  itself, its tabs offered under the "+" instead. Reloading the web app
  stands it as the history step held it, and a link opened from outside
  the window opens the tab it names. An open panel keeps its tab, and an
  arrival on another tab sets that tab's label in semibold until it is
  shown. Its left edge
  drags it from 280 pixels wide to as wide as leaves the document its room
  (`--document-reserve`), with no greatest width of its own, and the arrow
  keys move it once it has the focus.
- **Kept across launches.** Whether it is open, its tab, and its width are
  this Mac's preference, kept in the window's own storage rather than in
  anything main holds. A kept tab the open task does not have reads as its
  first, so leaving a task or opening another never shows a tab with nothing
  behind it. A fixture run stages its own and keeps nothing.

### Agent tabs

The task's column leads with its Overview, which shows the description's
document and never closes nor moves. Each agent started on the task has a
tab of its own after it (`desktop/main-tabs.tsx`, `tasks/use-main-tabs.ts`,
`tasks/agent-tab.tsx`, `tasks/use-agents.ts`), opened and selected the
moment its start lands, and showing its transcript and its composer. The column's
strip is the side panel's: tabs drag and step among themselves, close by ×,
Delete, ⌘W, or Close and Close others, hang their cards, and pin to the
sidebar. A column whose last tab closes is back on a new agent's draft. The tab each
task last showed is kept, so a task opens as it was left. ⌘T and ⌘W answer the column
holding the focus, the side panel's once the pointer goes into it. A
subagent's tab stays in the side panel.

- **A new agent from the "+".** The column's "+" offers New agent,
  unavailable with the reason while no agent could start, then each
  of the task's agents, picking one opening its tab again. New agent opens a draft tab (`tasks/draft-agent-tab.tsx`): no
  transcript yet, the composer focused, and the model chip on the account's
  default. Nothing reaches the service until the first message, which
  starts the agent with those words as its prompt; the agent's own tab then
  takes the draft's place. Closing the draft lets it go, and so does leaving
  it with nothing in its composer, for another tab, task, or place; a task
  never opens a draft by itself.

- **No head.** The tab has no head over its transcript
  (`tasks/agent-tab.tsx`): the model chip stands at the composer's foot, and
  the Stop is the composer's, standing while the agent may still write; it
  asks the service to cancel the turn, and anything the agent pushed stays.
  The status is the tab's glyph (`state-glyph.tsx`): the mark of the harness
  the model runs in (Claude Code or Codex), giving way to the working mark
  while the agent is starting or running, with a failed mark at the tab's
  end once it failed.
- **What it published.** Once the agent has opened a pull request, its row
  is pinned over the composer (`tasks/agent-published.tsx`): its mark, its
  number and title, "checks failed" while its checks fail, and the lines it
  adds and removes. A press opens its Pull request tab in the side panel. A
  branch pushed with no pull request yet is a chip at the composer's foot,
  which opens the branch compared on GitHub. The window reads
  `GET /api/agents/{id}/pull-request` as the tab comes on screen, as pages
  of the transcript land, and the moment the agent ends
  (`tasks/use-agent-pull-request.ts`).
- **The transcript.** The agent's stored `UIMessage`s, drawn with the AI
  Elements components: the description or prompt it was handed, the developer's
  messages, and each of its turns with its text as Markdown, its reasoning
  folded, and each tool call one row.
- **Live.** While the tab shows and the agent is starting or running, the
  window reads `GET /api/agents/{id}/messages?after=<cursor>` in a loop on
  the service's held long-poll (`tasks/use-agent-transcript.ts`), ending on
  its own when the agent ends.
- **When it ends.** Main keeps a ledger of where each agent stands
  (`packages/host/src/agent-notices.ts`) and marks an agent that moves from writing
  to completed or failed once, unless the window is focused on that agent's
  tab, with no toast and no notification. The agent's tab reads in semibold
  until it is shown.
- **Privacy.** Every word is the agent's, the developer's, or the description's, so
  the tab carries `ph-no-capture`.

### Settings › Agents

The model and effort every agent starts on are
the account's one default, kept on the service with the account preferences
(`/api/account/preferences`'s `agent` part) and shown on the Agents
page of Settings (`settings/agents-page.tsx`): a model menu
with each model under its harness's mark (Claude Code's for Anthropic's,
Codex's for OpenAI's), the efforts the chosen model lists, and, for a
model that offers two context windows (one whose provider prices prompts
past a boundary apart, such as OpenAI's 272K), the two windows with what the
whole one costs past the boundary. The whole window is the default; the
smaller standard one is the opt-in. New task's model chip and an agent's chip offer
the same choice as a Context row beside Effort, and the chip says the window
after the effort only where it is the opted-in smaller one ("GPT-5.5 High
272K"). The page
reads the default as it opens, and it is the one place the default changes:
a model chosen from New task's chip, an agent's chip, a draft, a fork, or by
another agent runs that agent alone. A first-time
account starts on Claude Opus 5.5 at high.

### Settings › Skills

Beside the skills a task's repository keeps in `.agents/skills` or
`.claude/skills`, which an agent reads from GitHub as its session starts, a
member installs skills into Vespin itself on the Skills page of Settings. Add
skill is one paste box: a GitHub repository as `owner/repo`, a link to it or
to one of its folders, or an `npx skills add` line naming one, its `--skill`
names ticked; or a skill's own text, frontmatter and all. Vespin never runs
the command. The service reads the repository's archive, on the workspace's
GitHub App, the member's own token, or anonymously for a public repository,
lists its outermost skill folders, outside `node_modules`, `.git`, `dist`,
and `build`, to tick before anything is installed, and
pins the files to the commit it read; a later commit on the source is never
taken on its own. Pasted text installs under the name and description the
member confirms, which start as its frontmatter's. A skill needs a valid name
and a description, and a file shaped like a credential is refused. Only GitHub
repositories are read.

A skill is installed for one of two scopes. A personal skill is its
installer's alone and follows them into every workspace they belong to. A
workspace skill reaches every member's agents on that workspace's tasks. Any
member installs one; its installer, while still a member, and the
workspace's owners and admins update, turn off, or remove it; a personal
workspace has no workspace skills. Each skill has a switch,
and one turned off is offered to no agent.

Where two skills share a name, the repository's wins, then the workspace's,
then the member's own, and the one shadowed is not offered. An agent with no
repository is offered the installed skills alone. An agent's skills are read
once, as its session starts, so a skill installed, updated, turned off, or
removed reaches only agents started after it; an agent already running keeps
the skills it started with.

The `/` list in an agent's box offers the same merged skills, each with a
Repo, Workspace, or Personal badge, and the chip and its card say the same.
A repository's skill opens its `SKILL.md` in a File tab; an installed one has
no file of the repository's to open. Where there is no skill yet, the list
points to Settings › Skills.

### Transcript

An agent's transcript is its conversation's rows ("Agent tabs" above),
drawn with AI Elements, the AI SDK's chat components, copied into
`packages/panel/src/ai-elements/` and restyled to the panel's tokens. A
description card and a reasoning row are closed until opened, so they never stand
in the way of the agent's own words.

### Agents' notes

An agent writes the task's description with its `edit_description` tool
(`packages/service/src/agents/coder-host/description-edit.ts`), whose every call
names the task by its id, so it writes any other description of its workspace too,
as a pilot fixes a child task's description, where it meets something the description
does not settle, finds a fact the description has wrong, or makes a decision the
description left open. Its saves go through `saveNotes` (`packages/service/src/tasks/description-notes.ts`),
the description's one write.

An agent's notes are taken the way a person takes notes, never the text
written out again:

- `add` puts a new point at the end of a section, under the heading it
  names, or opens that section at the end of the text where it has none.
- `replace` is the one generic edit: it replaces text copied exactly from
  the description, standing once in it, from a phrase to whole sections, headings
  included, with what it becomes; an empty replacement deletes, and a line
  it leaves empty is taken out.

A note's words may open headings of their own, so the notes can rename,
split, merge, move, and drop sections, a move being a deletion and a
replacement or an addition. The notes of one answer save together or not
at all: one naming text or a heading the description does not hold exactly
once, or one that does not read under the schema, is reported, never guessed
into another, and saves nothing of the call, whose result hands the description as it
then stands.

Each save is written into
the task's journal (`task.agent_edits`, the last fifty) as the agent's id,
the instant, and the notes as taken, a deletion kept as a `remove` and a
replaced text cut to 500 characters. The agent is named at read time from its
row, so the window's "Edited by" line over the document and the "recent
edits by agents" every agent on the task is handed both say what
the row says now.

### Editing

The developer edits the description whole, in place, with its title
(`tasks/description-document-editor.tsx`; the editor is `description-editor/`,
its saves `tasks/use-description-editing.ts` and `@repo/features/description-edit-model`).
The service lays each save over what others wrote meanwhile
(`packages/features/src/description-edit.ts`).

- **Opening.** The title and each section are blocks, and nothing on them
  marks them editable. A click into a section's words opens the whole text in
  place, the caret where the click landed. The editor is TipTap, from the editor
  bundle (`description-editor.js`), which the panel starts loading as it first paints
  and asks for again the first time a block is hovered or selected, and which
  an agent's message box shares (`tasks/composer-field.tsx`); it draws the words exactly as the sections were drawn, so
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
  through the description's one write, under the row's lock, as the developer's
  revision ("History" below). The base is the text the editor opened on,
  then the developer's own last save; one save is out at a time, and the
  editor waits for the last before it goes. A text longer than a document
  may hold says so and is not sent. A block the developer did not touch is
  written back exactly as it stood, so an edit is a change on its own lines
  alone. A save under way says nothing.
- **While others write.** An agent, or a teammate, may write while the
  developer types. Where the text still holds the base, the edit replaces
  it. Where it does not, the developer's change is laid over what it holds
  now as a patch, line by line, so a point an agent added meanwhile stays. A
  change to a line someone else also changed is a conflict: nothing is
  saved, and under the editor it says who wrote it (`tasks/edit-ref.tsx`),
  "<writer> changed this section while you were editing." with **Keep
  mine**, which saves the developer's words over theirs, and **Use
  <writer>'s**, which closes the editor on theirs; with no name, "This
  section changed while you were editing." with **Use theirs**; and for the
  developer's own edit from elsewhere, "You changed this section elsewhere
  while you were editing." with **Use the other**. Each save
  that lands answers with the text merged with what was written since its
  base; the editor takes that part block by block, in place of only the
  blocks it changed where the developer has not changed them since, so the
  caret's block stays, the selection maps through, and it is no step of the
  developer's undo. While the editor is closed, the document redraws in
  place on each save that lands.
- **Failures.** A save that fails keeps the words and says why under the
  editor ("Not saved: the service did not answer.", "Not saved: this task no
  longer exists.", or "Not saved: the description is too long."), with Retry; it is tried again
  when the developer asks or types on, and the editor stays open until it
  saves. Words not yet saved are sent to their task when the developer
  leaves it or opens another. Unsaved words live in the window's memory
  alone, never on disk.
- **Undo.** Inside the editor, the editor's own undo. A saved edit is undone
  from the description's history.
- **Recording.** The editor and the title stand under `ph-no-capture`, and
  their words are document text, which the recording masks in any case.

### History

Every save that changes the description is kept as a revision
(`packages/database/src/models/description-revisions.ts`, table `description_revision`): the
description's text as it stood after it, who wrote it (the
developer, editing the text or restoring the earlier revision `restored_from`
names; or an agent, by its row), when its first and latest saves were, and
how many notes it took. It is written in
the transaction that saves the description, so the two never disagree. The same
writer's saves one after another are one revision, an agent's or the
developer's, while the revision's latest save is at most ten minutes old, so
a run of saves is one revision rather than one per pause. Notes that
change nothing are no revision, and a rename is none. A description written before
history began is found by its first later save, which first records what the
description held, at its last save, as the description's first revision ("earlier"). History
starts there: nothing before it is reconstructed. Revisions go when their task
is deleted, and there is no cap on how many a task keeps.

The description names its newest revision as its last edit, which the document's
"Edited by" line reads ("Document" above), and each section the writer of the
save that last changed it: the actor and the agent, kept beside the
revision by the same locked save, which each section's line reads.

Version history, in the task's ⋯ menu (the toolbar's and the sidebar row's
right-click alike) and behind the "Edited by" line, takes the whole window
the way Settings does (`desktop/desktop-version-history.tsx`): a column as
wide as the sidebar, with Back at its head, "Version history", and the
revisions newest first, fifty a page
(`GET /api/plans/{id}/revisions`), each as who wrote it ("You" or an agent by its row), how many changes it
made, and how long ago; the newest is labeled "Current", and the description from before
history reads "Earlier". The list is read while the view stands and again
whenever the description is edited meanwhile. The chosen revision, the newest when
the view opens, or, opened from a section's line, the revision that made the
save it names (the oldest whose latest save is at or after the save's
moment, older pages read until one shows it, and the newest where one cannot
be read), is read with the content before it
(`GET /api/plans/{id}/revisions/{seq}`), and drawn read-only under the task's
name as it stands, beside the list (`tasks/version-view.tsx`), under a bar with its moment and Restore this
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
with jsdiff (`tasks/description-history-model.ts`), sections paired by their
headings, the assumptions among them as the section they are. The first
version has nothing before it and is drawn with nothing marked. The view is one step of the window's back and forward
whichever version is chosen, so Back, Escape, and ⌘[ return to the task as
it was left, its side panel untouched. Whatever is opened from it — a
version's Open, a tab from ⌘K — is a visit after it, so ⌘[ comes back to the
view on the version and the sections it was left on, and ⌘] goes on to what
was opened.

Restore this version asks first, in the window's dialog, and then puts the
revision's text back through the description's one locked save
(`POST /api/plans/{id}/revisions/{seq}/restore`, `restoreRevision` in
`packages/service/src/tasks/description-notes.ts`). The restore is a revision of the developer's
("You") naming the one it brought back, "Restored the version from Oct 11,
2:14 PM"; it joins no revision and none joins it, so a restore is undone by
restoring the revision before it, and it is allowed while an agent writes. It takes
no base: a save that landed after the version was chosen is the revision
before the restore, and restoring it brings it back. A restore that lands
leaves the version history for the task, whose document the service's answer
replaces at once, and the window's toast says
"Version restored" with an Undo, which restores the version that stood
before it. The newest revision is the description as it stands, so it offers no
restore.

A save that lands redraws the Tasks tab's document in place
(`tasks/description-body.tsx`). A unit of the document is a section as the service
cuts one ("Document" above), known by its heading, so a section joining or
leaving redraws no other section.

### The description's text

A description is one free Markdown document (`packages/features/src/description-document.ts`,
the row's `task.document`), with no title line, since the task's name is its
own, and its assumptions an ordinary section of the text. Every description starts
empty, and its sections are whatever headings the developer and the agents
write into it.

A section is a `#` or `##` heading and what stands under it up to the next,
a deeper heading inside it and a heading in a code fence no heading at all,
known by its heading's words (`descriptionSections`). Who last changed each section
is read off the description's revisions by heading (`sectionWritersOf`,
`sectionEdits` on the wire), each against the one before it, the first
against the template descriptions started as before they started empty, which a
description started empty reads the same against, so a heading renamed with nothing
beneath it changed is the same section under its new words. An agent's notes may land
anywhere in the text (`applyNotesToText` in `description-notes.ts`): an addition
at the end of the one section under its heading, or as a new section at the
end of the text where the text has none; a replacement names text standing
once in the whole text, headings and whole sections among it, so a heading
is renamed, and a section moved or struck, by replacing it, an empty
replacement deleting; and a note's words may open headings of their own. One answer's notes are taken together or not at all,
under the description's lock: where one names a phrase or a heading the text does
not hold exactly once, the developer having rewritten it meanwhile among the
reasons, nothing is saved, so a move never strikes without placing, and the
agent's `edit_description` answers the text as it stands, to retry from. Every description
the fixed template once kept as fields was carried
over to its text by a one-time backfill, each field's words under its
heading.

### Commands on the developer's Mac

`run_on_mac` (`packages/service/src/agents/mac-command.ts`) runs one shell
command on the developer's own Mac and answers its exit code and output, for
agents and their workers alike. The call is queued under the account; a
signed-in Mac whose Settings › This Mac mode is not Never holds
`GET /api/mac-commands` open, takes it, and, by default (Ask every time),
asks the developer before running it in the login shell from the home folder
(`packages/host/src/mac-command-runner.ts`), then posts the result back. A
call where no Mac read lately answers `not-run` at once, in one line the
agent repeats. The output is not redacted (`PRIVACY.md`, "Commands agents run on
your Mac").

### From a description to a pull request

A task can be handed to an agent: a cloud session of
Claude Code or Codex, which checks the task's repository out in a Vercel
Sandbox of its own, implements the description given as its first message, runs the
repository's checks, and decides whether to open a pull request. Started
instead on a prompt the developer wrote, it is handed that prompt as its first
message and never the description, and works in the task's repository the same way.
On a task with no repository it works in an empty folder, with no checkout
and no repository credential installed in its sandbox, and opens no pull request. How it runs,
its routes, and what it is told are described in
`packages/service/README.md` under "The agent service" and "The
agent routes"; New task ("The Tasks tab" above), the column's New agent,
the terminal picker's Start an agent, and the agent tabs ("Agent tabs"
above), and Settings › Agents are how the
developer starts one, watches it, stops it, and chooses what it runs on.

### Where an agent runs

Each agent runs in the cloud or on one of its starter's own devices (a Mac
or a host), chosen as it starts and kept for its life. A start may name the
place; a continue or fork that names another place starts a new agent
there, which is how work moves between them. A start that names none runs where the agent it continues or forks
runs; else where the starter's newest agent on the task runs, never a
teammate's; else where the starter last chose to run one; else in the
cloud. An automation's run always runs in the cloud. A task holds no place
of its own, a sub-task none of its parent's, so New task, New sub-task among
it, draws the Runs on chip for the agent it starts like any other start. A
device that is not the starter's, was removed, or is away refuses the start
by name, and nothing moves it to the cloud on its own.

While Bring your own host is on, an agent's ⋯ menu offers Move to ›: Cloud
and each of the member's own devices, but not the place the agent runs now,
a device that takes no agent now dimmed and saying why. It stands only
where Continue in new agent could run: on an agent at rest, not archived,
that the open task's tab or the agent's own page lists, on a task whose mode
offers it a continue. A pick is that continue at the place picked: the
source stops, a new agent starts there on its transcript, named
`<title> (continued)` where the source has a title, and its tab opens. A
cloud agent's work comes along on a branch of its own, what it had not
committed included but files named the way credentials are kept; from a
device only what it pushed comes along, which each place says, and its
folder stays on that device. An agent on a device the service did not name
is offered the cloud alone. A move that is refused says why in a toast.

## Copy

The developer chooses `Copy description` from the ⋯ menu, or presses ⌥⌘C on the
description, and the window's toast says "Description copied". The
clipboard holds the current document as readable Markdown: the task's name
as a `#` title over its document exactly as saved, whose assumptions are a
section like any other (`packages/features/src/description-markdown.ts`), here for
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
There is no separate handoff prompt: the description is what the agent
reads. The developer pastes it into the agent of their choice, or
starts an agent on it instead, and an agent of Vespin's own checks the
repository out in a sandbox, implements the description, and decides on a pull
request, watched from its tab in the task's column ("From a description to a pull
request" above). When an agent or the developer changes the description later,
Copy copies the new document.

## Failures the developer sees

- **Save.** An agent's `edit_description` whose notes do not all land saves nothing
  and answers the description as it stands, for the agent to retry from. The tab
  keeps showing the last saved document.
- **Repository.** A failed or incomplete read is reported to the agent as
  such, so it never describes unread code as read. If access is revoked, the
  reads fail the same way. Starting a new task shows the reason under New
  task's composer, which stays open.
- **Loading a task.** The document region shows the failure and `Try again`.
- **Start.** The service refuses to start an agent on a task whose
  repository the Vespin GitHub App no longer
  reaches for the workspace (`repository-not-reachable`, 403), on a device
  that is not the starter's, was removed, or is away ("Where an agent runs"
  above), and answers
  `unavailable` where the agent's session could not be started; the reason is said
  under the composer that sent it, or on the window's toast for a start from
  the terminal picker. An agent that ends `failed` or
  `cancelled` says so at the end of its transcript, and anything it pushed
  stays.
