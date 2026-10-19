# Proposal: everything is a task, and a task links the issues it works on

Status: **Decided by Dean, open questions in §8.** Dean asked: "Can we add
GitHub issues to the dropdown picker when creating a new task? What are the
considerations for how issues get linked up to tasks?", then "does Luke need
to have its own notion of Issues or should everything just be a Task?" He
chose both recommendations. A task links the issues it works on through one
link shared by every provider. Luke has no issue noun of its own: tasks gain a
status, a priority and a key, and the workspace's built-in issues become
backlog tasks.

## 1. Before

A task can come from two kinds of issue, each stored its own way:

- **A Linear issue**, kept as a snapshot. `task.linear_issue` (`schemas/task.ts`)
  holds the key, title, url and description as read through the workspace's
  grant at the start (`taskLinearIssueSchema`, `linear-wire.ts`). It does not
  hold Linear's own id. A coding agent is told to name its branch
  `luke/<key>-…` and to write `Fixes KEY` or `Part of KEY` in its pull request,
  so that Linear's GitHub integration moves the issue (`linearIssueBrief`,
  `coder-host/start.ts`).
- **A workspace issue** (`schemas/issue.ts`, behind `EXPERIMENT.ISSUES`), kept as
  a live foreign key. `task.issue_id` is set once, at creation
  (`startingIssue`, `tasks-app.ts`). Nothing relinks or unlinks it, a move to
  another workspace clears it, and the agent tool `create_task` cannot set it
  (`task-tools.ts`).
  - Starting an agent moves the issue to in progress (`beginIssueWork`,
    `issue-store.ts`). Nothing marks it done: that rests on one line of the
    coding agent's instructions (`coder-host/instructions.ts`).
  - The issue page lists its tasks and their pull requests (`issue-work.tsx`),
    filtered on the client from the tasks it has loaded. A task's own page
    never shows its issue.

GitHub issues are read one at a time, by number, to draw a link
(`github/issues.ts`, `issueByNumber`). Nothing lists or searches a
repository's issues. Reads use an installation token with `issues: read`, so
only installations that granted Issues reach them (`github-app.ts`,
`issuesReadable`). The webhook reads `issues` deliveries for automations alone
(`automation-github.ts`).

A task and an issue already overlap. Each has a name or title, some prose (a
brief and a plan, or a description), an archived stamp and a workspace. Only
issues have status, priority and a number; only tasks have an owner, a plan, a
conversation, agents and pull requests. "Several attempts at one issue"
already happens inside a single task, as several agents or forks of one.

## 2. Decisions

1. **One noun, the task.** The workspace's backlog is its tasks. A task that
   nobody has started is a task with no conversation, an empty plan and the
   status `backlog` or `todo`.
2. **An issue is outside Luke.** "Issue" means a Linear or GitHub issue. A task
   links any number of them through one table (§3.2), the same shape for every
   provider.
3. **The pull request keyword moves an external issue.** A link is either
   `closes` or `part_of`. The agent writes the provider's own keyword, and the
   provider moves the issue when the pull request merges. Luke changes nothing
   in Linear or GitHub itself.
4. **A task's state is stored, not synced.** Luke stores what it owns (the
   task's status and priority) and reads what it does not (an external
   issue's state, assignee and labels) live.

## 3. What the database stores

### 3.1 `task` gains three columns

| Column | Type | Meaning |
|---|---|---|
| `status` | text, not null | `backlog`, `todo`, `in-progress`, `done` or `canceled`: today's `ISSUE_STATUS`, moved to `task-wire.ts` as `TASK_STATUS`. A New task starts as `todo`, and filing one for later starts it as `backlog` |
| `priority` | text, not null, default `none` | `none`, `urgent`, `high`, `medium` or `low`: today's `ISSUE_PRIORITY` |
| `number` | integer, not null | The task's number in its workspace, counted from one, never reused. Unique on `(organization_id, number)`. The key a window draws is the workspace prefix and this number, `ACME-42`, as `issue-list-model.ts` draws an issue's today |

The archived stamp stays separate from status, as Linear keeps them: a task
can be done without being archived, and archived without being done.

**Backfilling existing tasks:**

- `status` is `in-progress` where the task has a coding agent, and `todo`
  otherwise.
- `priority` is `none`.
- `number` continues after the workspace's highest issue number, in the order
  the tasks were created. Migrated issues keep their own numbers (§3.3), so a
  key someone already wrote down keeps naming the same work.

**A move to another workspace** takes the next number there, so the task's key
changes. That is the one place a key changes.

### 3.2 `task_issue`: the link to an external issue

There is one row per (task, issue). It replaces `task.linear_issue`, and the
GitHub column that would otherwise be added beside it.

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid, primary key | |
| `task_id` | uuid, not null, foreign key to `task`, deleted with it | |
| `provider` | text, not null | `linear` or `github`, as an `as const` set |
| `external_id` | text | Linear's issue UUID, or GitHub's node id. Both stay the same when a Linear issue moves team (which changes its key) or a repository is renamed or moved (which changes `owner/name#N`). Null only for rows backfilled from a snapshot that never held it |
| `repository` | text | `owner/name`, GitHub rows only. What `issueByNumber` and `Closes owner/name#N` need |
| `number` | integer | The issue's number, GitHub rows only |
| `key` | text, not null | `ENG-123` or `owner/name#45`, what a chip draws. Refreshed whenever the issue is read |
| `url` | text, not null | The issue's page |
| `title` | text, not null | Refreshed whenever it is read; never treated as the source of truth |
| `description` | text, not null | The issue's body as Markdown, at most `LINEAR_BOUNDS.MAX_DESCRIPTION_CHARS`, copied when the link is made. What the brain and a coding agent read, so the task keeps it if the integration is disconnected, as today's snapshot does |
| `relation` | text, not null, default `closes` | `closes` or `part_of`: which keyword the agent writes, and so whether merging moves the issue |
| `linked_by` | text, foreign key to `user`, set null on delete | Who made the link. Links are now made after creation too |
| `created_at` | timestamptz | |

**Constraints and indexes:**

- `unique (task_id, provider, external_id)`, so a task cannot link the same issue
  twice.
- `index (provider, external_id)`, so a webhook or a pasted link finds every task
  that links an issue.
- `index (task_id)` comes with the unique index.
- A check that GitHub rows hold `repository` and `number`.

**Not stored:** state, assignee, labels and comments. A chip reads them live,
as `use-link-standing.ts` draws an issue link today. Storing them would make
this a two-way sync, and the snapshot would go stale with no `issues` webhook
to refresh it.

**Several issues per task.** Real cases are one pull request that fixes
several GitHub issues, the same work tracked in both Linear and GitHub, and a
rollout that covers a few issues. The link is capped at 10 per task
(`TASK_BOUNDS.MAX_ISSUES`). New task still picks one, and the task page adds
or removes the rest. The first link by `created_at` names the agent's branch
(`luke/<key>-…`), as the single Linear issue does today. Several tasks may
link one issue: nothing is unique on `external_id` across tasks.

**Backfill:** each non-null `task.linear_issue` becomes a `linear` row with
`relation` `closes`. Its `external_id` is looked up by key through the
workspace's grant where Linear is still connected, and left null otherwise.

### 3.3 The workspace's issues become tasks

Each `issue` row becomes a `task` row:

| Issue | Task |
|---|---|
| `title` | `name` |
| `description` | `brief`. The plan starts from the default template, so nothing is invented |
| `status`, `priority`, `number`, `archived_at`, `created_at` | The same columns |
| `creator_id` | `user_id`. Where the creator's account is gone, the workspace's owner takes it, since a task needs an owner |
| `id` | `id`, so a Luke link to the issue (`luke-link.ts`'s `ISSUE` place) resolves to the task by the same UUID |

An issue that already has tasks (`task.issue_id`) is handled by how many:

- **None:** the issue becomes a new backlog task, as above.
- **One:** the issue folds into that task. The task takes the issue's number,
  status and priority, and the issue's description where its brief is empty.
  The issue's id is mapped to the task's for links.
- **Several:** see §8.1.

`task.issue_id` and the `issue` table are dropped once no running build reads
them, two steps apart, as `task.pinned_at` is being retired.

## 4. Status and keywords

| Event | What happens |
|---|---|
| An agent starts on a task in `backlog` or `todo` | The task moves to `in-progress`, and never backwards. This is `beginIssueWork` moved onto the task |
| The task's pull request merges | Nothing to the task by itself (§8.2). The owner or an agent sets `done` |
| A merged pull request that says `Fixes ENG-123` | Linear moves the issue, through its own GitHub integration |
| A merged pull request into the default branch that says `Closes owner/name#45` | GitHub closes the issue. It needs no permission of Luke's |
| A `part_of` link | The agent writes `Part of ENG-123`, or links the GitHub issue without a keyword, so the issue stays open |

**A task's own key is never a pull request keyword.** A workspace prefix has
the same shape as a Linear team key, so `Fixes ACME-42` would move a Linear
issue wherever a Linear team shares the prefix. A pull request already reaches
its task through the coding agent's row (`coding_agent.task_id` and its
branch).

**GitHub closes an issue only on a merge into the default branch.** A stack
here is retargeted to `main` before it merges (AGENTS.md, "Merging"), so the
pull request at the bottom of the stack closes it. An agent working in a stack
writes `Closes` in the pull request that lands last.

## 5. GitHub issues in New task

- **A list and search read.** Add `GET /repos/{o}/{n}/issues?state=open` with
  pull requests filtered out, and `GET /search/issues` for typed words, behind a
  route, a wire answer and an act beside the Linear ones. Search allows 30
  requests a minute per installation, so it waits for the typing to rest, as the
  Linear search does (`SEARCH_PAUSE`).
- **The repository comes from the task.** GitHub issues belong to a repository,
  while the chip's readers take only the workspace. The picker lists the chosen
  repository's issues, reads again when the repository changes, and drops a
  GitHub pick when it does.
  - With no repository chosen, picking a GitHub issue (found by a pasted link or
    `owner/name#N`) sets the repository.
- **Installations without Issues.** Where `issuesReadable` is false, the picker
  says to grant Issues on GitHub rather than showing an empty list.
- **Untrusted text.** Anyone can open an issue on a public repository, and its
  body reaches a coding agent that can push. It is fenced as data, as Linear
  and workspace issue bodies already are (`planBrief`). The chip marks an issue
  whose author is not a member, collaborator or owner (GitHub's
  `author_association`).
- **Duplicates.** A team that syncs GitHub issues into Linear sees the same work
  under both headings. Nothing deduplicates them; linking both is allowed and
  harmless.

## 6. What else changes

| Surface | Change |
|---|---|
| The Issues page (`issues-page.tsx`, its list, board, detail, peek and New issue dialog) | Becomes the workspace's tasks by status and priority, with the same filters and board. Opening one opens the task |
| The sidebar | Filters by status, so backlog and settled tasks do not crowd the work in progress. The sidebar-rethink proposal (§6, item 5, "Group by Status") put grouping by status off because a task had no status |
| Agent tools (`issue-tools.ts`, `apps/dev/tools/*_issue.ts`) | `create_issue`, `list_issues`, `read_issue` and `update_issue` go. `create_task` takes `status`, `priority` and issues to link; `list_tasks` filters by status; `update_task` sets status and priority and adds or removes links |
| Briefs (`brain.ts`, `coder-host/start.ts`) | One issue section built from `task_issue`, each link with its keyword instruction. Removes the separate Linear and workspace-issue briefs, and gives the brain the same guidance for every provider |
| ⌘K and mentions (`command-palette.tsx`, `task-mentions.tsx`) | A task is found by its key. An issue link resolves to its task (§3.3) |
| `EXPERIMENT.ISSUES`, the counted events and settings anchors for issues | Retired with the page |

## 7. PR order

1. **`task_issue`**, with Linear moved onto it. The table, the backfill, writing
   both the new table and the old column at the start, reading from the new
   table, and the briefs built from it. Desktop is unchanged.
2. **GitHub issues in New task.** The list and search read, the picker following
   the repository, linking at the start, the `Closes` brief, and the grant
   state.
3. **Links on the task page.** Show, add and remove links; set `relation`;
   `create_task` and `update_task` take links.
4. **Task status, priority and number.** The columns and their backfill, moving
   to in progress on an agent's start, the agent tools, and the task page's
   status and priority.
5. **The tasks board and the sidebar's status filter.** The Issues page
   repurposed.
6. **Luke issues become tasks.** The migration of §3.3, link redirects, and
   retiring the issue tools, page and experiment.
7. **Drop** `task.linear_issue`, `task.issue_id` and `issue`, once no running
   build reads them.

PRs 1 and 2 stand alone and ship GitHub issues soonest. Work on PRs 3 and 4
can start alongside them.

## 8. Open questions

1. **An issue with several tasks.** Count them first:
   `select issue_id, count(*) from task where issue_id is not null group by 1 having count(*) > 1`.
   If there are few, the issue becomes its own backlog task, and each of its
   tasks gets a line in its brief naming that task's key. If there are many,
   this argues for a `parent_task_id`, the way Linear has sub-issues, which is
   a feature of its own.
2. **Done on merge.** Should a task move to `done` by itself when the pull
   request of one of its agents merges? A rollout's tasks merge several pull
   requests, so the first merge is not the end. Recommended: no for now. The
   owner or an agent sets it, and the task page offers it once every pull
   request of the task's agents has merged or closed.
3. **Assignees.** A filed task's owner is whoever filed it. A separate assignee
   is out of scope, as plan-ownership.md §4 decided ("Created by, not
   assigned to").
