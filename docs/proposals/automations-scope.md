# Proposal: who an automation belongs to, and where its runs land

Status: decision doc for Dean, written 2026-10-14 against main at
`d4c5477e`. Nothing past this doc is built until the decisions below are
answered. The automations stack is frozen: #2516, #2522, #2525, #2541,
#2547, and #2564 are drafts, and nothing is in the merge queue.

Dean's asks:

> "I want automations to be workspace level and also personal level (not
> tied to a plan). But there should also be per-plan automations I think…
> For personal workspaces, there is no option for a workspace level
> automation because everything is by definition personal."

> "Automations should have an option to run in a specific chat or just always
> create a new one, just like ChatGPT."

## TL;DR

- **Most products ship two ownership levels**: personal, which runs as you
  and bills you, and team/workspace, which runs as a shared identity and
  bills a shared pool, with admins deciding who may make one (Cursor, Devin,
  ChatGPT Team Tasks, Linear Loops). A project or repository is a *filter*
  on what the run reaches, not a third owner. Claude Code Projects is the one
  product with per-project scheduled work, and it is personal-only.
- **A new thread per run is everyone's default.** Only ChatGPT and Devin let
  you aim scheduled runs at one existing conversation instead: ChatGPT by
  creating the task *inside* that chat ("current chat or new chat"), and
  Devin with "Message session" versus "Start session". Gemini sends every
  run of a schedule to one chat of its own.
- **Recommendation for Luke:**
  - Model scope as two separate axes. The first is **owner scope**:
    personal or workspace, with personal workspaces offering personal only.
    The second is an optional **plan**.
  - Keep "runs as its creator, on the creator's keys" for both scopes.
    Luke has no workspace billing or service identity.
  - Offer **new agent each run** (the default) or **continue one agent**,
    the latter preselected when an automation is made from inside an
    agent's tab.
  - An automation with no plan runs in a plan Luke makes to hold its runs.
  - The schema change is one expand migration (nullable `plan_id`, plus
    `organization_id`, `scope`, and the target), with one contract step
    later.

## 1. Research (all URLs accessed 2026-10-14)

### ChatGPT (Tasks / Scheduled, Team Tasks, Pulse)

- **Run target is chosen at creation.** A task made inside a chat offers
  "current chat or new chat". A *standalone* task starts a new chat on
  every run and reports on the Scheduled page. An *in-chat* task "return[s]
  ChatGPT to the same chat" with that chat's context.
  https://learn.chatgpt.com/docs/automations
- **Personal by default.** A shared task link hands over a copy of the
  task, never its runs. Business and Enterprise admins control sharing.
  https://help.openai.com/en/articles/7925741-sharing-conversations-and-scheduled-tasks-in-chatgpt
  (search excerpt; the page answered 403)
- **Team Tasks** (Business and Enterprise) are shared:
  - They run in the cloud under the team's **service account**, on
    workspace credits.
  - Every team member sees every run.
  - Holders of "Create and manage team tasks" create them, and authorized
    teammates edit, pause, or resume them.
  - Individual tasks and runs can't be restricted on their own.

  https://learn.chatgpt.com/docs/enterprise/teams
- **Projects.**
  - Desktop tasks can run in a local project folder or worktree.
  - Tasks scoped to a ChatGPT Project (the sidebar feature) are not
    documented.

  https://learn.chatgpt.com/docs/automations
- **Limits.** 5 active tasks on Plus, 15 on Pro and Enterprise; runs at most
  hourly.
  https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt
  (search excerpt)
- **Pulse** was announced on 2026-06-17 as retiring in favour of scheduled
  tasks. https://www.engadget.com/2196844/chatgpt-now-has-a-hub-for-scheduled-tasks/
- **Codex.** Its automations docs now redirect to the same ChatGPT
  Scheduled page, with the same standalone and in-chat choice.
  https://learn.chatgpt.com/docs/automations?surface=app

### Claude

- **Claude Code Routines**:
  - They "belong to your individual claude.ai account. They are not shared
    with teammates."
  - Every run "creates a new session", and an API or GitHub trigger never
    reuses one.
  - Org Owners can switch routines off org-wide.

  https://code.claude.com/docs/en/routines
- **Claude Code Projects** (Pro and Max only):
  - Work scheduled inside a project "runs as threads in that project" and
    lists on the project's Routines tab.
  - Archiving the project stops its routines.
  - A project belongs to one user.

  https://code.claude.com/docs/en/claude-projects
- **Desktop scheduled tasks** start "a fresh session when a task is due".
  https://code.claude.com/docs/en/desktop-scheduled-tasks .
  Only `/loop` and session cron fire into the same open session, and they
  end with it. https://code.claude.com/docs/en/scheduled-tasks
- **Cowork** projects have "recurring tasks that are specific to the
  project". Projects can be shared view or edit on Team and Enterprise;
  whether teammates see the tasks is not documented.
  https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork

### Gemini scheduled actions

- **Personal.** Available on personal and qualifying Workspace accounts,
  with no sharing documented.
- **One chat per schedule.** Each schedule has "the chat with your
  schedule", marked unread when a run lands, so its runs continue one
  thread.
- **Creation and limits.** A schedule can be made from the chat box or the
  Scheduled page, with up to 10 active.

https://support.google.com/gemini/answer/16316416

### Cursor Automations (Teams and Enterprise)

- **Run as.** "Me" bills you. "Service account" bills the team pool, and
  only admins may choose it.
- **Access.** Private, Members can view, or Members can edit. Admins can
  see and disable a Private automation.
- **Personal accounts** have no sharing.
- **Runs.** Each run creates a cloud agent, and memory carries over in
  `MEMORIES.md`. There is no option to resume one agent.

https://cursor.com/docs/cloud-agent/automations

- **Continuing one agent** happens elsewhere in Cursor: Slack follow-ups
  and event subscriptions arrive in the same agent.
  https://cursor.com/docs/integrations/slack ,
  https://cursor.com/docs/cloud-agent/capabilities

### Devin Automations

- **Scope.** There are org automations, which run as the "Automations
  service", and personal ones (`run_as: creator`).
- **Roles.** View Automations, Manage Automations, and Run Personal
  Automations.

  https://docs.devin.ai/enterprise/security-access/custom-roles ,
  https://docs.devin.ai/api-reference/v3/overview
- **Run target is the user's choice.** "Start session" makes a new
  session every run; "Message session" sends the event to a session you
  pick. https://docs.devin.ai/product-guides/automations

### Linear

- **Recurring issues.** They are team-level, and each occurrence is a new
  issue. https://linear.app/docs/creating-issues
- **Loops** (launched 2026-07-20):
  - Scope: team and workspace level only, with no personal level.
  - Editing: each loop has "Who can edit": all members, workspace admins,
    team owners, or only the loop's owner.
  - Billing: workspace credits.
  - Runs: each run starts a new conversation with Linear Agent.

  https://linear.app/docs/loops ,
  https://linear.app/changelog/2026-07-20-introducing-loops

### GitHub Copilot cloud agent automations

- One repository each, and "billed to the user who created the
  automation".
  https://github.blog/changelog/2026-06-02-schedule-and-automate-tasks-with-copilot-cloud-agent/

## 2. Luke today (cited against `d4c5477e`)

- **Workspaces.**
  - A workspace is an `organization` with `member` rows whose roles are
    owner, admin, and member (`packages/hosted/src/workspace-wire.ts:29-33`).
  - A personal workspace is marked by a `personal_workspace` row and can't
    be managed or left (`packages/database/src/schemas/personal-workspace.ts`).
  - Any member but an owner can leave
    (`apps/web/server/workspaces-app.ts:423`).
  - **Every member reads and writes every plan in the workspace**, its
    coding agents, and its Inbox
    (`packages/database/src/models/plan-store.ts:29-31`,
    `coding-agent-store.ts:57-60`, `apps/web/server/hosted/inbox-store.ts:50-55`).
  - A leaver's plans stay in the workspace, untouched.
- **Chats.** There are two kinds:
  - **The plan's conversation.** One per plan, shared by its members, it
    is the Luke planning chat (`plan.conversation_id`).
  - **A coding agent's thread.** One per agent
    (`coding_agent.conversation_id`), readable and writable by every
    member.

  The server can already send a follow-up into an agent's thread as the
  deployment acting for the account: `steerCodingAgent`, which the voice
  brain uses (`apps/web/server/hosted/coder-host/steer.ts:93`,
  `coding-agent-tools.ts:534`). It refuses an archived agent or an agent
  on an archived plan. **No chat exists without a plan today.** The
  `main` and `observed` conversation kinds are created by nothing in
  production, and the home page from #2550 has no composer.
- **What an automation starts.** A coding agent on its plan. An agent
  needs a plan (`coding_agent.plan_id` not null) and the plan's repository
  (`start.ts:120-131`, `NO_REPOSITORY`).
- **Who pays.** The owner: "the agent runs as the owner on the owner's
  keys" (`automation-runs.ts:49-56`). Provider keys are per account
  (`account_provider_key`), and Luke's own keys are metered per account
  per day (`hosted_usage`). **No billing or key table has a workspace
  column.**
- **The merged tables.**
  - `automation` has `user_id` and `plan_id`, both not null with cascade.
    It also has trigger, action, guards, enabled, paused_reason, and
    next_run_at.
  - `automation_run` has `coding_agent_id`, set null on delete.
  - Migration `20261014130146_automation`.
  - `payload` (the webhook body) exists only on the frozen #2516.

## 3. Decisions

Each decision gives its options and a recommendation (**R**).

### D1. How scope is modelled

- **A. Two axes.**
  - *Owner scope*: `personal` or `workspace`. A personal workspace offers
    `personal` only.
  - An optional *plan*.

  A "per-plan automation" is any automation with a plan. Its list shows on
  the plan's tab, and the global page shows the scope's whole list.
- **B. Three exclusive kinds**: personal, workspace, and plan. A plan
  automation's owner scope then has to be decided anyway (personal or
  workspace), so B collapses into A with a worse name.
- **C. Workspace and plan only** (Linear's shape, with no personal level).
  This fails Dean's ask.

**R: A.** It is what Cursor and Devin do (an owner scope, with the
repository or project as a filter) and what Claude's per-project routines
add (a project as the home).

### D2. Who can see, edit, run, and pay, per scope

| | Personal | Workspace (team workspaces only) |
| --- | --- | --- |
| See it and its runs' list | its creator; owners and admins can see and pause (Cursor's admin view) | every member |
| Edit or delete | its creator | its creator, owners, and admins (Linear's "Who can edit", with this as the fixed default) |
| Run now, pause, or resume | its creator | every member |
| Runs as, and pays | its creator, on the creator's keys and meter | **its creator** (see D3) |

- **Options for workspace editing.**
  - (a) Every member, as ChatGPT Team Tasks and Cursor's "Members can
    edit" allow.
  - (b) Its creator plus owners and admins.
  - (c) A per-automation setting, as Linear and Cursor offer.

  **R: (b) now, (c) later if asked.**
- **The runs themselves** are coding agents. On a plan, every member sees
  them, whatever the automation's scope, because a plan's agents are
  workspace-visible today. "Personal" therefore governs the automation's
  settings, not its results. The UI should say so in the dialog: "Runs
  land on <plan>, which everyone in <workspace> can see."

### D3. Whose identity and keys a workspace automation runs on

- **A. Its creator's.** This is today's behaviour. The dialog shows "Runs
  as Dean · uses Dean's keys". A teammate's Run now spends the creator's
  keys.
- **B. A workspace service identity** (Cursor's and Devin's service
  account, ChatGPT's team service account). It needs workspace-owned
  provider keys and a workspace meter, which Luke doesn't have: keys and
  `hosted_usage` are per account.
- **C. Whoever presses Run now**, with scheduled runs on the creator. This
  bills unpredictably.

**R: A for v1.** B is the right end state once workspaces own keys or
billing; it needs its own proposal.

### D4. What an automation with no plan runs against

- **A. A plan of its own.**
  - Luke makes one plan per planless automation, named after it, on the
    repository chosen in the dialog, to hold its runs (agents, Inbox items,
    notifications), all of which already key on a plan.
  - It is marked so that the sidebar lists it under Automations rather
    than among the developer's plans (a `plan.kind`, or the automation
    pointing at it).
  - It lives in the automation's workspace. A personal automation in a team
    workspace therefore lands its runs where members can see them (D2).
- **B. No plan at all.**
  - `coding_agent.plan_id`, `inbox_item.plan_id`, notifications, and the
    agent's working context would all go nullable.
  - It is the larger change and touches every agent path.
- **C. A planless brain chat.** No such chat exists, and the brain runs no
  coding work of its own.

**R: A.** It reuses every agent path unchanged. The cost is a plan kind the
sidebar knows to file away.

**Sub-decision D4.1.** Should a personal automation in a *team* workspace
keep its runs private by living in the creator's personal workspace?

- **R: no.** The repository is reached through the team workspace's GitHub
  installation, so a personal-workspace plan couldn't reach it.
- The dialog states the visibility instead (D2).

### D5. Where a run lands: a new chat or the same chat

- **A. New agent each run** (the current behaviour; everyone's default).
- **B. Continue one agent.**
  - Each run is a follow-up into a chosen agent's thread, through
    `steerCodingAgent`, as Devin's "Message session" and ChatGPT's in-chat
    tasks do.
  - A firing while that agent's turn is still running is skipped as
    `concurrency`, not stacked.
- **C. The plan's conversation** (the Luke planning chat). The brain would
  take a turn on a schedule. This is a new server-side brain path, and the
  brain doesn't run code.

**R: A and B now, C later if wanted.**

Defaults by where the dialog opens:

| Opened from | Default |
| --- | --- |
| The global page | new agent each run |
| The plan's tab | new agent each run |
| An agent's tab, or its ⋯ "Run this on a schedule" | continue this agent (ChatGPT's in-chat default) |
| Webhook and GitHub triggers | new agent each run (one event, one thread); continuing is still offered |

### D6. When the creator leaves the workspace

- **A. Pause it as `owner-left`.** It stays visible to owners and admins,
  and an owner or admin can **take it over**, which makes them its creator
  and the one it runs as and bills (D3). A personal automation is paused and
  shown to its creator nowhere, since they lost the workspace; admins can
  delete it.
- **B. Delete it.**
- **C. Keep it running as the leaver.** This is impossible: they no longer
  reach the plan.

**R: A.** Today the runs fail quietly at the reach gate, and #2564 makes a
departed owner's webhook answer 404.

### D7. When the plan is archived, deleted, or moved, and when the chat is deleted

- **Archived** (#2564, Dean confirmed): paused as `plan-archived`, and
  bringing the plan back resumes nothing.
- **Deleted.**
  - Options:
    - (a) The automations go with it (today's cascade, as its agents do).
    - (b) They are detached and kept as planless (D4) automations.
  - **R: (a)**, with the delete confirm saying "and its 2 automations".
- **Moved between workspaces.** Plans can't move today, so there is
  nothing to decide.
- **The continued chat is archived or deleted** (D5-B).
  - Options:
    - (a) Pause the automation as `chat-gone`, and the owner picks a new
      target.
    - (b) Fall back to a new agent each run, silently.
  - **R: (a).** A silent change of where results land surprises.

### D8. Personal workspaces

- No workspace scope is offered (Dean's rule). The scope control is hidden,
  not disabled.
- Every automation there is personal, with or without a plan.

### D9. Schema: expand then contract, against the merged tables

**Expand** is one additive migration, safe under v0.12.0, which has no
automations UI. It touches `automation` only:

- `organization_id` text, nullable, references `organization`, on delete
  cascade. It is backfilled from `plan.organization_id`.
- `scope` text, not null, default `personal`. Every existing row is
  personal.
- `plan_id` drops `NOT NULL`, keeping cascade, so a plan's automations
  still go with it (D7).
- `target_kind` text, not null, default `new-agent`.
- `target_agent_id` uuid, nullable, references `coding_agent`, on delete
  set null; the null is read as `chat-gone` (D7).
- An index on `(organization_id, scope, created_at)` for the workspace
  list.
- `paused_reason` gains `owner-left` and `chat-gone` beside `failures` and
  `plan-archived`. It is a text column, so the change is to the wire enum
  only.

Readers and writers move to the new columns in the same deploy, and the
API grows optional `scope`, `target`, and nullable `planId` fields, all
additive.

**Contract** follows once every reader uses `organization_id`:

- `organization_id` becomes `NOT NULL`, after a check that the backfill
  left no nulls.
- Nothing is dropped. `user_id` stays as the creator, who is the one it
  runs as (D3).

D4-A also needs `plan.kind` (`plan` | `automation`), default `plan`, as its
own expand.

The frozen `automation_run.payload` (#2516) is unaffected.

### D10. The webhook body (open since #2516's review)

A webhook's body is handed to the run's agent as fenced data, so whatever
the caller posts reaches the agent's transcript and traces. The webhook's
secret never does. AGENTS.md's carve-outs cover `run_on_mac` output and MCP
results, not this.

- **A. Keep passing the body.** It is the point of a webhook (a deploy,
  Sentry, or CI payload). This needs an approved third carve-out, plus the
  dialog line "the body is handed to the agent as data; don't send secrets
  in it".
- **B. Don't pass it.** The agent only learns that the webhook was called,
  and the body stays on the run's row.
- **C. Pass an allowlisted field** (`text`) only.

**R: A**, with the carve-out worded narrowly to "a webhook body the
automation's own caller sends". The line goes into AGENTS.md only with
Dean's explicit approval.

### D11. What happens to the open PRs

| PR | Verdict |
| --- | --- |
| #2516 webhook trigger | **Survives.** It is scope-agnostic. It needs D10's answer, and its lookups gain the scope reach (members for a workspace automation, the creator for a personal one) |
| #2564 archive pause, departed-owner webhook | **Survives**, as D6 and D7's first half. The `owner-left` pause folds in |
| #2522 desktop plumbing | **Survives with small rework.** Params gain optional `scope`, `target`, and nullable `planId` |
| #2525 Automations page and dialog | **Rework.** The dialog gains a scope control (team workspaces only), the plan becomes optional ("No plan: Luke keeps its runs together"), and the run target is added. The list groups or filters by scope |
| #2541 plan ⋯ → Automations narrowed | **Survives.** It is the plan-filtered view, superseded later by the plan tab |
| #2547 list cleanup; the unopened detail cleanup | **Survive.** They are visual only. The page-head move Dean asked for goes on top |
| Per-plan side-panel tab (approved, not opened) | **Survives** as the view of D1's plan axis, after the rework above |
| Merged backend (#2511–#2515) | **Kept.** The expand migration (D9) and a scope-aware reach predicate rework it in place, and the sweep stays scope-agnostic |

Nothing needs closing. The order after Dean's answers:
1. D9's expand migration and the store and API for scope and target,
   with tests.
2. #2516, #2564, and #2522 rebased onto it.
3. #2525's rework.
4. The cleanup PRs and the page heads.
5. The plan tab.
6. D5-B's continue-one-agent runs.
7. D4-A's automation plans.

## 4. Open questions for Dean, in one list

1. D1: two axes (owner scope plus an optional plan)?
2. D2: workspace automations are edited by their creator and owners/admins;
   any member can see, run, and pause them?
3. D3: runs stay on the creator's identity and keys for both scopes until
   workspaces own keys?
4. D4: a planless automation keeps its runs in a plan of its own, filed
   under Automations?
5. D5: new agent each run, or continue one agent, with the defaults above?
6. D6: a leaver's automations pause as `owner-left`, and admins can take
   them over?
7. D7: deleting a plan deletes its automations; a continued chat that's
   gone pauses the automation?
8. D10: keep handing the webhook body to the agent, under a narrow
   carve-out?
