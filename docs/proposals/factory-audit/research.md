# Factory page: how comparable products show "agents at work"

Researched 2026-10-15. Every claim carries a URL. Where a vendor documents
states but not layout, the entry says so rather than guessing. "(forum)" marks
community or staff forum posts, not docs.

## 1. Linear (agent sessions on issues)

- **Model.** Delegating keeps the human as assignee; the agent is a contributor.
  "the user remains the primary assignee, while the agent is added as a
  contributor" https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk
  Delegate by picking an agent in the Assignee field (`A`); bulk delegation
  runs in parallel. https://linear.app/enablement/guide/ai-agents
- **Session states (6):** `pending, active, error, awaitingInput, complete, stale`.
  Linear derives them from the agent's last activity; the agent never sets them.
  https://linear.app/developers/agent-interaction
  User-facing wording: "actively working, waiting for input, have encountered an
  error, or completed" https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk
- **Activity stream:** thought / action ("Searching" -> "Searched") / elicitation
  (asking the user) / response (done) / error. Ephemeral thoughts are replaced by
  the next activity. An agent that emits nothing within ~10 s is marked
  unresponsive. Plans are a checklist with steps that are pending / inProgress /
  completed / canceled. https://linear.app/developers/agent-interaction
- **Where it shows:** a session card in the issue's activity feed (status row plus
  label and preview text) https://linear.app/changelog/2026-06-11-coding-sessions;
  on the issue sidebar under the assignee https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk.
- **Lists:** there is no dedicated agents board. Delegated issues stay in My Issues,
  and teams build custom views filtered by **Delegate**.
  https://linear.app/changelog/2025-10-28-github-copilot-agent ,
  https://linear.app/docs/agents-in-linear . Insights can filter by session status
  (active / completed / errored). https://linear.app/enablement/guide/ai-agents
- **Waiting on you:** the elicitation activity, plus Inbox notifications. Completion
  notifications go to the person who delegated
  (https://linear.app/changelog/2026-06-11-coding-sessions). A Priority inbox tab
  splits "what needs your attention from what can wait"
  https://linear.app/changelog/2026-09-03-priority-inbox
- **Takeaway:** Linear keeps the issue as the primary object and puts agent state
  on it as a secondary badge. It does not keep a separate agent list.

## 2. Cursor (Agents Window, cursor.com/agents)

- Cursor 3 has an Agents Window that runs agents "locally, in worktrees, in the cloud,
  and on remote SSH" https://cursor.com/changelog/3-0 . Cloud agents launch from
  cursor.com/agents, Slack, GitHub, or Linear. https://cursor.com/help/ai-features/background-agents
- **Status vocabulary (forum, no official doc):** orange/amber dot = "waiting for you,
  it asked a question or the plan is ready"; spinner = working; blue dot = "done
  but you have not opened it yet".
  https://forum.cursor.com/t/agent-tags-t-indicate-agent-state-beyond-simply-stating-where-its-working-or-not/163927
  The animated dot-matrix means working. https://forum.cursor.com/t/glass-ui-session-bar-shows-working-dot-matrix-instead-of-orange-awaiting-confirmation-dot-when-a-subagent-needs-an-allow-confirm/164687
- **Grouping:** group by Status gives Draft / Running / Needs attention / Done. A plan
  awaiting approval goes under Needs attention (a bug that showed it as complete was
  fixed in v3.2.21). https://forum.cursor.com/t/agent-window-statuses-broken/157310
  Needs-attention rows are "agents blocked on approvals or pending plans" plus
  completed-and-unseen work. The Dock badge instead counts unseen activity, and staff
  admit the two counts "tell two different stories".
  https://forum.cursor.com/t/dock-menu-bar-badge-count-does-not-match-agents-sidebar-needs-attention-glass/168982
- **Web filters:** a single-select scope (My agents / Team agents / Collaborating)
  plus Filter > Source; status views include Merged and Closed. Users ask for
  multi-select. https://forum.cursor.com/t/show-both-my-agents-and-team-agents-on-web-sidebar/154417 ,
  https://forum.cursor.com/t/cursor-cloud-agent-filtering-is-very-confusing/167363
  The desktop sidebar is sorted by last activity and capped at about 100 (forum).
  https://forum.cursor.com/t/unarchived-cloud-agents-disappear-from-the-agents-sidebar-after-a-couple-of-days-of-inactivity/166306
- **Failures:** start failures show on the agent; they are often platform incidents.
  https://forum.cursor.com/t/repeated-cloud-agent-failures-going-on-24h/161038
- **Recurring request:** users keep asking for distinct colours for ready, waiting,
  and working. https://forum.cursor.com/t/making-list-of-agents-more-visual/157526

## 3. Devin (sessions sidebar / All Sessions)

- **States:** `status` is new / claimed / running / exit / error / suspended / resuming.
  When running, `status_detail` is `working`, `waiting_for_user` ("needs user input"),
  `waiting_for_approval` (awaiting action approval in safe mode), or `finished`. When
  suspended, the reason is given (inactivity, usage_limit_exceeded, out_of_credits,
  ...). Sessions carry `pull_requests[{pr_url, pr_state}]`.
  https://docs.devin.ai/api-reference/v3/sessions/get-organizations-session.md
- **Sidebar:** by default it shows your own unarchived sessions; filters are saveable
  https://docs.devin.ai/it/release-notes/2024 . Filters cover PR status, user,
  playbook, and tags (Mar 2025). The PR-only view was merged into "All Sessions"
  (Sep 2025). Batch child sessions are indented under their parent (Dec 2025).
  Merged PRs update session status live (Jul 2025).
  https://docs.devin.ai/release-notes/2025
- **2026:** the sidebar can group by PR status or by repository, with filters by Devin
  mode https://releases.sh/cognition/release-notes (-> https://docs.devin.ai/release-notes/overview#september-2-2026).
  It also gained multi-select tag filters with per-tag counts (same source, Aug 28 2026).
- **Takeaway:** keep one coarse status, and give a waiting or suspended agent a
  sub-reason. Grouping by PR state is the axis teams actually asked for.

## 4. GitHub Copilot coding agent (Agents panel, github.com/copilot/agents)

- The Agents panel opens from any github.com page and lists delegated tasks "with
  a clear status for each". Clicking a row opens the PR.
  https://github.blog/changelog/2025-08-19-agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github-com
- The list includes sessions you started and sessions others prompted. A repo's
  Agents tab has an "All sessions" view. Stopped sessions can be archived but not
  deleted. Opening a session shows its log plus progress, token usage, and duration.
  https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/track-copilot-sessions ,
  https://docs.github.com/en/copilot/how-tos/use-copilot-agents/manage-agents
- **Status vocabulary:** queued / working / waiting for review / completed. The
  session appears under the assignee on an issue. Projects table and board views can
  "Show agent sessions".
  https://github.blog/changelog/2026-03-26-agent-activity-in-github-issues-and-projects/
- In VS Code: "See task status at a glance and jump in when Copilot needs your input".
  https://github.blog/changelog/2025-11-13-manage-copilot-coding-agent-tasks-in-visual-studio-code/
  In JetBrains, the unified sessions row shows title, agent type, elapsed time, and
  status, with a status filter.
  https://github.blog/changelog/2026-05-14-introducing-copilot-cli-agent-and-unified-sessions-view-in-github-copilot-for-jetbrains-ides/
- **VS Code Agents window** (closest to a native desktop list): each row shows
  "session name, workspace, harness, and file change stats". Sessions are grouped by
  workspace by default, or by timeframe, or into custom groups. The default view is
  active only, with Done and Archived behind a filter. "Mark as Done" stands in for
  archive. The app-icon badge counts unread finished sessions, sessions waiting for
  input, and sessions whose open PR has failing CI.
  https://code.visualstudio.com/docs/copilot/chat/chat-sessions

## 5. OpenAI Codex (cloud tasks, Codex app)

- **Web flow:** pick a repo and environment, then prompt. When the task finishes,
  "Review the changes and test results, request follow-ups, and commit or open a pull
  request". https://learn.chatgpt.com/docs/cloud.md
- Opening a task shows a diff tab (green and red lines) and a Logs tab. Progress
  appears as steps (Starting container, Exploring files, Running a command), and
  "Create Pull Request" opens a branch and PR (Jun 2025). https://habr.com/en/articles/918002
- An archived tab exists (`tab=archived`), and the diff limit was raised to 5 MB.
  https://developers.openai.com/codex/changelog (-> https://learn.chatgpt.com/docs/changelog)
- **Codex app sidebar (2026):** "sidebar pull request status updates" (26.609). An
  "Activity view" shows "which chats you engaged with recently and require attention"
  (26.727). There is an Unread chats section, pinned chats, and projects in saved
  order "as chat activity changes". https://learn.chatgpt.com/docs/changelog
- `codex cloud list` and `codex cloud diff <id>` are in the CLI.
  https://developers.openai.com/codex/cli/reference
- **Not verified:** the exact web row anatomy (diff +/- counts on each row,
  "Open"/"Merged" labels). No official source describes it, so it is not claimed here.

## 6. Vercel deployments list

- **Statuses:** QUEUED / BUILDING / READY / ERROR / CANCELED (plus DELETED; the API
  also has INITIALIZING and BLOCKED). "The dot animates while BUILDING or QUEUED and
  goes static once the deployment reaches a terminal state." "Color is not the only
  signal: every state ships with a distinct title and label." Labels are sentence-cased
  ("Building", "Ready", "Error"). https://vercel.com/geist/status-dot ,
  https://vercel.com/docs/rest-api/deployments/list-deployments
- **Row redesign (May 27 2026):** "denser layout, so you can see more deployments at
  once"; "Environments are now grouped with statuses"; branches and commits "easier
  to scan". https://vercel.com/changelog/redesigned-deployments-list
- **Filters:** Branch, Date Range, Environment, Status
  https://vercel.com/docs/deployments/managing-deployments . Aug 27 2026 added
  suggested filter presets, typeahead, and natural-language filtering.
  https://vercel.com/changelog/find-deployments-faster-with-redesigned-filters
- **Row anatomy (docs do not list fields):** the changelog confirms status + env,
  branch, and commit. Author avatar and relative age are commonly seen on the row but
  are not documented in the sources above; treat them as unverified.
- **Pattern:** a flat reverse-chronological list. Status is a filter, not a section,
  and the only action is a row's "..." menu (Redeploy, Promote, Delete).

## 7. Others

- **Claude Code agent view** (`claude agents`; the most fully documented list
  found). https://code.claude.com/docs/en/agent-view
  - Row: state glyph · name · current activity / last result · PR label (`#1234`) ·
    age. Age freezes at run length when finished.
  - Default sections: **Pinned, Ready for review, Needs input, Working, Completed**.
    "Ready for review" means an open PR needing review *or failing checks*.
    Completed folds finished, failed, and stopped together. Overflow becomes `… N more`.
  - Colours: Working animated, Needs input yellow, Idle dimmed, Completed green,
    Failed red, Stopped grey. PR label: yellow for waiting on checks or review (or
    failed), green for ready, purple for merged, grey for draft or closed. Several PRs
    show "3 PRs", coloured by the one that needs the most attention.
  - The tab title reads "2 awaiting input". A peek panel shows the exact question and
    lets you answer inline. Filters `s:blocked`, `s:ready`, `o:merged`.
  - Empty state: "the empty section headers with a description under each".
- **Conductor:** workspaces are grouped by status "backlog, in progress, in review,
  and done", labelled by PR title (0.35.0).
  https://www.conductor.build/changelog/0.35.0-workspace-status . The sidebar shows
  GitHub status ("merged, failing CI, conflicts") at a glance, hovering shows metadata
  and next actions, and it "now shows when an agent needs permission" (0.44.0).
  https://www.conductor.build/changelog/0.44.0-new-sidebar-rebuilt-composer-codex-checkpoints
  The 0.39 sidebar had distinct icons for plan approval and for user input.
  https://www.conductor.build/changelog/0.39.0-insta-summarize-command-palette-opus-4-6
  The All Workspaces page has project filters, repo icons, last-active time, and a
  PR badge. https://www.conductor.build/changelog/0.74.0-lots-of-little-things
- **Jules:** QUEUED, PLANNING, AWAITING_PLAN_APPROVAL ("Plan is ready for user
  approval"), AWAITING_USER_FEEDBACK ("Jules needs user input"), IN_PROGRESS, PAUSED,
  FAILED, COMPLETED. It separates plan approval from question asking.
  https://jules.google/docs/api/reference/types
- **Factory.ai:** the desktop app gives each session a sidebar entry; "Mission
  Control" tracks orchestrator, workers, and validators.
  https://factory.ai/news/factory-desktop , https://docs.factory.ai/jp/web/missions
- **Amp:** nothing found about its list.

## Cross-product synthesis

| | List/board | Ordering | "Waiting on you" | Failure | PR state on row |
|---|---|---|---|---|---|
| Linear | issue list + custom views | issue sort | elicitation + inbox | `error` session state | linked PR on issue |
| Cursor | sidebar list | last activity; opt. group by status | orange dot, Needs attention group | red/err row (forum) | Merged/Closed filter |
| Devin | sidebar list | time; group by PR status/repo | `waiting_for_user` / `waiting_for_approval` detail | `error`, suspended + reason | `pr_state` |
| Copilot | panel list; Projects board opt. | recency | "waiting for review"; VS Code needs-input flag | (not documented) | click row -> PR |
| Codex | sidebar list | recency, pins, projects | Activity view "require attention", unread | (not documented) | sidebar PR status |
| Vercel | flat list | reverse chrono | n/a | Error dot+label | n/a (branch+commit) |
| Claude agent view | sectioned list | sections by state, then manual | yellow, own section, tab-title count | red, folded into Completed | coloured `#PR` label |
| Conductor | sectioned sidebar | backlog/in progress/in review/done | needs-permission icon | failing CI badge | merged/CI/conflict badge |

Every product converged on a **list, not a board**. Copilot's board exists only as an
optional Projects view, and Linear's is the generic issue board.

## Worth borrowing (ranked for a simple, standard macOS devtool list)

1. **Fixed status sections in attention order.** Use Needs you -> Working -> Ready to
   merge -> Shipped/Done, with folded overflow (`… N more`). This follows Claude agent
   view and Conductor's backlog/in progress/in review/done. Skip empty sections, or
   show headers with one-line descriptions only when everything is empty (Claude
   agent view's empty state).
2. **One coarse state plus a sub-reason.** "Needs you · plan to approve" vs "· question"
   vs "· permission" (Devin `status_detail`, Jules' two AWAITING_* states, Conductor's
   distinct plan-approval and input icons). Show the agent's actual question as the
   row's secondary text (Claude agent view: `Needs input · double jump or wall climb?`).
3. **Status dot with a word, never colour alone.** Animate only while running and keep
   the dot static once terminal (Geist status dot). Use one colour per meaning: amber
   = needs you, animated = working, green = ready/passed, purple = merged, red =
   failed, grey = stopped/draft (Claude agent view, Cursor). This maps well onto macOS
   system colours.
4. **A PR chip on the right edge carrying its own state colour.** Show `#1234` coloured
   by checks, review, or merge, and with several PRs show "3 PRs" coloured by the
   worst. Failing CI promotes the row into "needs attention" (Claude agent view; VS
   Code's badge counts failing-CI PRs; Conductor's merged/failing CI/conflicts badges).
5. **Row anatomy: state glyph · title (plan or PR title) · one line of current
   activity · repo/branch muted · PR chip · relative age** (frozen at run length when
   finished). This is the Claude agent view row with Conductor's "labelled by PR title"
   and Vercel's scannable branch/commit and density.
6. **The count of "needs you" outside the page.** Put it in the sidebar badge or Dock
   (Claude's "2 awaiting input" tab title, VS Code's app badge). Use the *same*
   definition as the section: Cursor's mismatch between badge and sidebar is a known
   complaint.
7. **Failures as a state, not a toast.** Show a red dot, keep the row in place, and
   show a one-line reason ("possibly low memory", "out of credits", Devin's suspension
   reasons). Fold old failures into Done rather than giving them a permanent section
   (Claude agent view).
8. **Light filters, not a filter bar.** A Mine/Team scope toggle plus repo filter
   (Cursor, Conductor's project filters, Devin's default of "your unarchived
   sessions"). Make it multi-select from the start, because single-select is Cursor's
   top filter complaint.

## Avoid

- **A kanban board of columns.** No product in this set made the board its primary
  agent view. Columns waste width in a macOS window and split "needs you" across
  lanes. Use sections in one list instead.
- **Diverging attention signals.** Cursor's unread badge, needs-attention section, and
  Live Activity "Waiting" disagree, and users file bugs about it
  (https://forum.cursor.com/t/dock-menu-bar-badge-count-does-not-match-agents-sidebar-needs-attention-glass/168982).
  Have one definition of "needs you" feed every surface. Also avoid a "completed" label
  for something that is actually awaiting plan approval
  (https://forum.cursor.com/t/agent-window-statuses-broken/157310).
- **Streaming the agent's internals on the overview row.** Linear replaces ephemeral
  thoughts, and Codex/Copilot keep logs behind the row. Show one current-activity line
  and keep the transcript in the detail view.
