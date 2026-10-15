# Proposal: which tasks are mine (the creator's face)

Status: **A decided by Dean on 2026-10-15 and being built in the PR order in
§5. Where the filter lives is still Dean's pick (§3).** Dean: "Let's go with
A, with a small icon for filtering (not the All/Mine sliders). And make sure
faces are pushed to the right instead of all in the same column, because we
don't want to give up space for the title if we don't have to." Then, on the
filter: "I don't know how the filter icon would fit into the sidebar, to be
honest. Can we get some designs of what that would look like? I want to do
whatever is standard", with the bar "standard and obvious".

Dean asked: "I can't tell which plans are 'mine' vs Charles. I think it should
be based on who created the plan." Since then the sidebar's units have been
renamed tasks (#2848), and each task's document is its plan, so this doc
says task.

The design show is `docs/proposals/plan-ownership/index.html`. It is one
self-contained file that fetches nothing. It is built from the desktop
renderer's real stylesheet and components (`ActorMark`, `PersonCard`,
`SidebarGroupHeader`, `PlanStatusMark`, `RepositoryDetail`, `HoverCard`,
`MenuItem`, `Segmented`, cmdk) over a synthetic Acme of five plus a former
member, in light and dark (the toggle at its head). The research behind it,
with a URL on every claim, is `docs/proposals/plan-ownership/research.md`.

## 1. Before

A team workspace's tasks are shared: every member sees every task. The
sidebar lists them in repository groups by last update (#2818). Each row has
the unread weight (#2801), the "!" (#2804), and the status mark and time at
its end. Nothing on a row says whose task it is. The only place that did was
the ⋯ menu's footer, "Created by [face] Charles Pan · 3d ago" (#2775).

The wire already carries the creator. `PlanSummary.createdBy` is
`{userId, name}`, and `ownerId` is the same account. `@luke/ui/actor-model`'s
`creatorActor` draws it, and the members read carries every teammate's photo
(#2779).

## 2. The face (decided)

A task someone else created wears its creator's 14px `ActorMark`
(`ACTOR_SIZE.MARK`) inside the time's own slot, just before its mark and
time, right-aligned with them. That slot has always been as wide as Pin and
Archive, so a short time leaves room in it, and the face takes that room
before it takes any of the name's. A long time, or one led by a mark,
pushes the name back only by what it needs. Your own tasks wear nothing and
keep the full width.

Under the pointer, the face steps out with the time, as the status mark
already does, and Pin and Archive take the slot. Nothing jumps and nothing
overlaps. While you hover, the hover card names the creator. A former
member's task wears the quiet outline. A personal workspace is unchanged.

A face that stayed in sight under the pointer would need either a column
of its own (Dean's objection), a jump, or an overlap with Pin and Archive.
The first show drew it in a column before the time's slot, a face on every
row, a "Mine / All" segmented control (B), and "Yours" / "Teammates" runs
in each repository (C). Its "Explored before the pick" section keeps them.

Everywhere else a task appears:

| Place | Change |
|---|---|
| The task's hover card (sidebar row, tab, Inbox crumb) | A line under the repository: the creator's face, "Created by Charles Pan · 3d ago", or "Created by you". Team workspaces only |
| The plan crumb ("Acme › relay · 5 can edit") | The crumb itself is unchanged. Its facepile leads with the creator, and its people card leads with "Created by [face] Charles Pan · 3d ago"; the creator's row says "Creator · Admin" |
| Home, Recent | The same face in the time's slot, on teammates' tasks |
| Factory (experiment) | The same face in the time's slot |
| ⌘K | The face at a task row's end. The creator's name is one of the words a task is found by ("charles" finds his tasks), and the detail names the creator after the repository when the name is what matched |
| The Move dialog | Unchanged: only a task's creator may move it |

## 3. Where a "Created by me" filter lives (Dean to pick)

Every option is drawn in the show with its filtered state and the way back.
In each one, the open task stays listed while filtered, as it does under a
fold. The choice is kept per workspace on this Mac, as the folds are. A
personal workspace offers no filter.

- **(c) A "My tasks" row under Inbox (recommended).** It is drawn as Home
  and Inbox are. Pressing it lists only the tasks you created and marks the
  row. Pressing it again, or "Show all" in the line heading the list, lists
  everything. It is the most standard and obvious of the four: Linear puts
  "My issues" in the sidebar under Inbox
  (https://linear.app/docs/my-issues), Drive's sidebar leads with "My
  Drive", and GitHub's dashboards name "Created by me" and "Authored by me"
  views. It is labelled, never hover-revealed, and costs one row.
- **(a) A filter icon on a "Tasks" header, revealed on hover**, dropping
  "All tasks" and "Created by me", as Notion's and Slack's section headers
  reveal ••• with Sort and Filter
  (https://www.notion.com/help/navigate-with-the-sidebar,
  https://slack.com/help/articles/360043207674). It is standard but not
  obvious, and it adds a header row.
- **(b) A view option in the workspace switcher's menu.** It adds nothing at
  rest, but it is the least obvious: that menu chooses a workspace, not a
  view.
- **(d) No sidebar filter, only ⌘K.** Typing "created by me" or a
  teammate's name finds their tasks, which PR 3 makes nearly free. This is
  how Notion, Figma and Drive treat a creator: as a search filter. But
  nothing keeps the list to your tasks while you work.

## 4. Created by, not assigned to

The face means *who created the task*. A task has no assignee, and editing a
teammate's task doesn't make it yours.

- **A move to another workspace** keeps the creator. Only the creator can
  move a task (`ownsPlan`, enforced by the service), so it arrives as theirs.
- **A creator who leaves** leaves their tasks in the workspace. The face
  becomes the outline, and the card says "Created by Priya Raman, who left".
  A deleted account sends no `createdBy`, so the outline stands with no name.
- **Transfer** doesn't exist. If it is built, the face follows the owner,
  who can move the task, and the card adds "Owned by".
- **A task with neither `createdBy` nor `ownerId`** wears no face.

## 5. PR plan

Desktop only, since `createdBy` and members' photos are already on the wire.

| # | PR | Size |
|---|---|---|
| 1 | `feat(desktop): a task someone else created wears its creator's face in the sidebar`. Adds `teammateCreator` to `@luke/ui/actor-model` and `ACTOR_SIZE.MARK`, puts the face in the time's slot, puts a `MemberDirectory` around the list, and updates this doc and its show | S |
| 2 | `feat(desktop): a task's card and its plan's crumb say who created it` | S |
| 3 | `feat(desktop): Home, Factory and ⌘K name a task's creator` | S |
| 4 | The filter, once Dean picks where it lives (§3) | S |

PRs 2 and 3 stand on PR 1 and can run in parallel.
