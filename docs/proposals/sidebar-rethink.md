# Proposal: the sidebar's task list, grouped, ordered and filtered

Status: **A decided by Dean on 2026-10-15, with every recommended pick in
§6, and being built in the PR order in §5.** Dean: "let's do A, and also
separately pins should be per-user, not per-workspace, if they aren't
already." A task's pin was a column on the shared plan row, so one member's
pin showed for every member. A PR of its own moves it to a per-user
`plan_pin` table. Repository pins were already per user.

Dean: "I don't really like any of the options for the created by me filter.
It feels weird because we already have groups in the sidebar. Although the
groups are weird because they are by repo but also pinned/archived. Should we
rethink the whole sidebar? Maybe users want some more sorting/filtering
options."

The design show is `docs/proposals/sidebar-rethink/index.html`. It is one
self-contained file that fetches nothing. It is drawn by the renderer's real
components and stylesheet: `WorkspaceSwitcher`, `SidebarGroupHeader`,
`SidebarPlan` with #2873's creator face, `ActionMenu` and its submenus,
`ActorMark` and `SidebarFoot`. About a dozen lines of new CSS sit on top.

The show uses a synthetic Acme of five members plus Priya Raman, who left:

- 15 tasks over 3 repositories, plus one stranded in an Acme Labs repository and one with no repository;
- 2 pinned, 2 archived and 3 unread tasks, and 3 Inbox items waiting;
- light and dark, at 264px, 200px and floating over the work.

The research behind it, with a URL on every claim, is
`docs/proposals/sidebar-rethink/research.md`.

## 1. What is wrong today

`desktop-sidebar.tsx` draws one run of headers under the rule:

1. Pinned;
2. one group per repository, the latest first (#2818), with "No repository" last;
3. Archived.

They look alike and fold alike, but they answer three different questions:

- **Pinned** is a choice the developer made;
- **a repository** is a property of the task;
- **Archived** is a state the task is in.

A "Created by me" filter would add a fourth axis on top of the three. That is
why every place proposed for it in `plan-ownership.md` §3 felt bolted on.

## 2. Recommended: A, one Tasks section and its View options

The sidebar's lists become two sections, each named in the headings' voice
(`.section-heading`):

- **Pinned** is a fixed section. Pressing its name folds it, as today, and its
  pins sort newest first, as today. It stops being a group among the
  repositories.
- **Tasks** is everything else. At the right of its head stands **View
  options**: the same sliders and `ActionMenu` the Inbox head already uses
  (`inbox-list.tsx`'s `ViewOptions`), always in sight.

The menu holds:

| Item | Choices | Default |
| --- | --- | --- |
| Group by › | Repository, Creator, None | Repository |
| Order by › | Last updated, Created, Name | Last updated |
| Created by › | Anyone, Me, each member by face (team workspaces only) | Anyone |
| Archived tasks | A view, checked while shown | Off |

While a filter holds, two things say so. A chip stands under the head
("Created by me ×", "Archived ×"), and its × lifts the filter. The button
wears a dot. Together they mean a filtered list never passes for the whole
list.

**Archived leaves the list.** It is a view of the Tasks section, reached from
the menu. The head reads "Archived tasks", Pinned steps aside, and the chip
leads back. ⌘K still finds an archived task.

**A row says what its group doesn't:**

| Grouping | The group's header says | The row adds |
| --- | --- | --- |
| Repository | The repository | A teammate's face (#2873) |
| Creator | The person, by face | The repository, muted, in the time's slot |
| None | Nothing | The repository and a teammate's face |

Your own tasks wear no face, and a list filtered to one creator wears none
either.

The default view is today's list, so an upgrade moves nothing but Pinned's
head and Archived.

**Precedent:**

- **Linear's Display options and filters.** Grouping and ordering are chosen
  per view, and Created by is a filter beside them. The Archive is a page of
  its own, and display options are kept per user.
  https://linear.app/docs/display-options, https://linear.app/docs/filters,
  https://linear.app/docs/delete-archive-issues
- **The agent tools have moved to a chosen grouping.**
  - Devin groups by repository, PR status, status or None, and filters to
    "sessions… that you started" by default.
    https://docs.devin.ai/release-notes/2026
  - Codex has a "filter icon next to Chats" that switches projects to
    Chronological. https://developers.openai.com/codex/app/troubleshooting
  - ChatGPT will "organize Recents as one combined list, or group chats by
    project". https://help.openai.com/en/articles/6825453-chatgpt-release-notes
  - Conductor filters by "By: a teammate or Anyone" and "Archived: show or
    hide". https://www.conductor.build/docs/cloud/collaboration
- **Pinned and Favorites are a fixed top section almost everywhere:** Linear,
  Cursor, Codex, ChatGPT, Arc and Notion.
- **Archive is a place almost everywhere:** Linear, Codex, ChatGPT, Things and
  Arc. Devin is the exception, with an Archived section.

## 3. The alternatives drawn

- **B: fixed sections, no menu.** The sections are Pinned, Yours, Teammates
  and Archived. "Created by me" is folding Teammates.
  - For: every section is about you, so the axes stop clashing, and there is
    nothing to configure.
  - Against: the repository is lost as a grouping, so every row must carry it.
    That costs name width on every row, and the most useful split for a team
    working one repository at a time goes.
  - Today / This week sections lose the repository the same way.
  - Closest to Conductor's cloud sidebar (Pinned, My workspaces).
- **C: one list by recency, filters in a menu.** This is the chat apps'
  Recents.
  - For: it is the simplest list.
  - Against: the repository labels do the headers' work, and a repository
    can't be folded away.
  - It is A with Group by None, so choosing A keeps C available.

## 4. Behaviour (A)

- **Kept per workspace on this Mac**, as the folds are. Group by, Order by and
  Created by are stored in renderer storage under one key, holding a record
  keyed by workspace id. The Archived view is not kept, so the next launch
  opens on the tasks. A fixture run keeps nothing.
- **Folds are kept per grouping.** Repository folds stay as they are kept
  today. A creator's fold is kept by user id. The open task still stands
  under its fold.
- **Order also orders the groups:** by their latest task, their newest, or by
  name. Pinned repositories (the repository ⋯'s Pin) still lead under Group
  by Repository. The row's time follows the order, so Created shows when the
  task was created.
- **Pins are never filtered**, because a pin is already the developer's own
  choice.
- **Unread** stays the bold name, in every grouping.
- **Needs you** stays the Inbox row's count and the Inbox's own Needs you
  filter. The task list doesn't filter on it.
- **⌥↑ and ⌥↓** walk the rows as drawn: Pinned, then each group not folded. In
  the Archived view they walk the archived rows.
- **The floating sidebar:** a choice in View options does not put it away, as
  choosing a task does, because the developer is still reading the list.
- **At 200px** the head and the chip still fit, and names give way first.
- **A personal workspace** offers Group by Repository or None, Order by and
  Archived tasks. It has no Creator grouping and no Created by.
- **Empty:** a filter that leaves nothing says "None of your tasks here", with
  Show all to lift it.

## 5. PR plan

Desktop only. The wire already carries `createdAt`, `createdBy`, `pinnedAt`
and `archivedAt`.

| # | PR | Size |
|---|---|---|
| 0 | #2873 and worker 319's other face PRs land as they are | - |
| 1 | `feat(desktop): the sidebar's tasks are one section with view options, grouped by repository, creator, or none, in the order chosen`. Adds the Pinned and Tasks heads, the menu, the per-workspace view store beside `folded-groups.ts`, row labels, and folds per grouping | M |
| 2 | `feat(desktop): the sidebar's tasks filter by who created them`. Adds Created by, the chip, the button's dot and the empty state. This is worker 319's held filter, folded in | S |
| 3 | `feat(desktop): archived tasks are a view of the sidebar's list, not a group at its foot` | S |
| 4 | `feat(desktop): ⌘K groups, orders, and filters the sidebar's tasks` (decision 8) | XS |

PRs 2 and 3 stand on PR 1 and can run in parallel.

**Migration:**

- Account pins are untouched: a task's `pinnedAt`, and a repository's pin.
- The kept repository folds (`luke.sidebarFoldedGroups`) become Group by
  Repository's folds as they stand.
- Pinned's fold (`luke.sidebarPinnedFolded`) is kept.
- Archived's fold was only ever in memory, so there is nothing to move.
- Every workspace starts on today's view.

## 6. Decisions (Dean took every recommendation)

1. **The model:** **A** (recommended), B or C.
2. **Created by:** a submenu of Anyone, Me and each member (recommended), or a single checkable "Created by me" item.
3. **Pins under a filter:** pins stay listed (recommended), or pins filter too.
4. **Archived:**
   - (recommended) a view reached from the menu, with a chip back;
   - a "Show archived" toggle that adds today's Archived group at the foot;
   - Settings › Archived, as Codex and ChatGPT do.
5. **Group by Status** (Working, In review, Merged, Quiet, read from the row's mark): not now (recommended), since a task has no status of its own yet and the Inbox already covers needs-you. Or add it, as Devin, Cursor and Conductor have.
6. **Default for a team workspace:** today's Repository and Anyone (recommended), or Created by me, as Devin defaults.
7. **The row's time follows the order:** yes (recommended), or always the last update.
8. **⌘K commands for the view** ("Group tasks by creator", "Show my tasks", "Show archived tasks"): yes, as PR 4 (recommended), or none.
9. **The button:** on the Tasks head and always in sight (recommended), or revealed on hover, as Notion's and Slack's section ••• are.
