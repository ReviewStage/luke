# Proposal: who an automation belongs to, and where its runs land

Status: round 2, written 2026-10-14 against main at `d4c5477e`. It folds in
Dean's answers to round 1.

- **Design show:** `docs/proposals/automations/index.html`, opened in a
  browser. It is self-contained and fetches nothing.
- **Stack:** frozen until Dean OKs the plan in §4. #2516, #2522, #2525,
  #2541, #2547, and #2564 are drafts, and nothing is in the merge queue.

Dean's asks:

> "I want automations to be workspace level and also personal level (not
> tied to a plan). But there should also be per-plan automations I think…
> For personal workspaces, there is no option for a workspace level
> automation because everything is by definition personal."

> "Automations should have an option to run in a specific chat or just always
> create a new one, just like ChatGPT."

## TL;DR (round 2)

- **An automation has an owner and a repository, and no plan.**
  - The owner is personal, or the workspace in a team workspace.
  - The repository is the agent's only filter, as Cursor, Devin, ChatGPT,
    Copilot, and Linear do it.
  - Per-plan automations are dropped for v1 (D1).
- **Its runs are coding agents with no plan.**
  - Agents and the Inbox are reworked so an agent can belong to a
    workspace, not a plan (D4). It is the large piece: about 10 PRs.
  - A planless agent opens in an agent page that stands in the plan's place,
    as the Inbox does.
- **Runs go to a new agent each run (the default) or continue one agent.**
  Continuing is preselected from an agent's tab. A follow-up goes in exactly
  as a person's message does, even mid-turn, with no skip logic (D5).
- **No bespoke lifecycle states.** When a creator leaves, or a continued
  agent is archived, runs simply fail to start, and the existing
  three-failed-starts guard pauses the automation. Owners and admins can see
  and delete it. That is the industry norm; a real ownership transfer is not
  (D6).
- **It runs as its creator, on the creator's keys, for both scopes** (D3).
  A shared service identity is on the roadmap (§5). It is about L: GitHub is
  already done as the App, and workspace keys and ownership are the work.
- **The webhook body is approved for the agent,** with a narrow AGENTS.md
  carve-out added in #2516 (D10).

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

### When an automation's creator leaves (for D6)

- **GitHub Actions.**
  - "Removing a user from an organization will not prevent scheduled
    workflows which had that user as their actor from running." On
    Enterprise Managed Users, they stop once the actor is deprovisioned.
  - There is no transfer; the next person to edit the cron becomes the
    actor.

  https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- **Slack Workflow Builder.**
  - A deactivated member's tokens are revoked. Whether their workflows break
    is not documented.
  - Owners and admins "can add themselves as workflow managers to any
    published workflow", with the creator's permissions. There is no
    transfer.

  https://slack.com/help/articles/360000446446-Manage-deactivated-members-apps-and-integrations ,
  https://slack.com/help/articles/360053738994-Add-or-remove-workflow-managers
- **Zapier Team and Enterprise.** Removing a member is a guided transfer of
  their Zaps and connections to a chosen user, the account owner by
  default, with each Zap keeping its on or off state. This is the one
  product with a real transfer.
  https://help.zapier.com/hc/en-us/articles/8496281082253-Remove-members-from-your-Team-or-Company-account
- **Power Automate.** An orphaned flow "can fail if they use connections
  tied to that user account". Admins add a co-owner. Owners are notified,
  and the flow turns off in 14 days.
  https://learn.microsoft.com/en-us/troubleshoot/power-platform/power-automate/flow-management/manage-orphan-flow-when-owner-leaves-org ,
  https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/faqs
- **Google Apps Script.** "Installable triggers always run under the
  account of the person who created them", and they can't be transferred.
  https://developers.google.com/apps-script/guides/triggers/installable
- **Cursor** (a "Me" automation) **and Devin** (`run_as: creator`): what
  happens on departure is not documented. Their answer is a non-human
  identity: Cursor's service account ("continue running even as people and
  roles change"), and Devin's organization System User.
  https://cursor.com/docs/account/enterprise/service-accounts ,
  https://docs.devin.ai/api-reference/v3/automations/delete-organizations-automation.md
- **Linear.** Not documented for recurring issues or Loops.

**Synthesis.** The usual behaviour is that nothing transfers: the automation
stays the creator's and fails once something of theirs stops working. Admins
step in by hand. Transfer is not standard; only Zapier does it.

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

## 3. Decisions (round 2)

Each decision gives its options and a recommendation (**R**). "Dean:"
marks an answer he gave.

### D1. Per-plan automations: keep or drop?

Dean: "I don't even understand why we would want a per-plan automation. Do
we need this or should we drop it?"

**What a plan link would add, once agents run outside plans (D4):**

1. *Context.* The run's agent reads the plan document, which suits "every
   night, take the next step of this plan" or "keep this plan's pull request
   green". Without the link, the automation's own prompt carries that
   context, which is how every other product works.
2. *Grouping.* The runs sit beside the plan's other agents and Inbox items,
   for the plan's collaborators.
3. *Lifecycle.* Archiving the plan stops them.

**What the industry does.** Only Claude Code Projects (personal,
Pro/Max) and Cowork project tasks scope scheduled work to a project.
Cursor, Devin, ChatGPT Team Tasks, Linear Loops, and Copilot filter by
repository and own by person or team (§1).

**What dropping it removes:**
- #2541 (the plan ⋯ → Automations filter);
- the approved per-plan side-panel tab (4 PRs);
- #2564's plan-archive pause (its webhook-reach half stays);
- the plan-delete confirm line;
- every plan lifecycle rule in D7.

**R: drop it for v1.** None of the three use cases is strong enough to
carry a second home for runs beside planless agents. Use case 1 comes back
later, if asked for, as an optional "use a plan as context" field: the
plan's text goes into the prompt, and the runs stay where every run lives.
`automation.plan_id` becomes nullable and unused in v1, and the contract
step drops it (D9).

### D2. Who can see, edit, run, and pay: accepted

| | Personal | Workspace (team workspaces only) |
| --- | --- | --- |
| See it and its runs | its creator; owners and admins can see and pause | every member |
| Edit or delete | its creator; owners and admins can delete (D6) | its creator, owners, and admins |
| Run now, pause, or resume | its creator | every member |
| Runs as, and pays | its creator | its creator (D3) |

A run is a planless agent (D4) that inherits its automation's visibility. A
personal automation's runs are seen by their creator, owners, and admins; a
workspace automation's runs, by every member.

### D3. Runs as the creator: accepted, with a service identity on the roadmap

Dean: "Let's put that on the roadmap but start with the person who created
it for simplicity first." The estimate is §5.

### D4. Planless agents and Inbox items (Dean chose this over a hidden plan)

Dean: "If we want to support automations as first-class, they should be
able to run agents outside of a plan. So agents and Inbox both need a
rework."

**Today** (cited in the inventory, `d4c5477e`):

- `coding_agent.plan_id` and `inbox_item.plan_id` (and
  `inbox_attachment.plan_id`) are not null, with cascade.
- Access is an EXISTS over the plan's workspace
  (`coding-agent-store.ts:234-242`, `inbox-store.ts:186-193`). Start
  serialises on the plan row's lock (`:250-258`).
- The start path reads the repository, the brief, and the workspace's
  GitHub installation from the plan (`start.ts:126-135`), and
  `planWorkspace(userId, agent.planId)` finds the workspace in five places
  (checkout, published, skills, steer).
- The desktop opens an agent only as a tab in its plan's column
  (`use-main-tabs.ts`, `onShowAgent(planId, agentId)`). The Inbox and the
  agent notices group by plan. There is no "all agents" view and no
  single-agent read (`GET /api/agents/{id}`).
- About 150–200 desktop lines, 40 server lines, and 50 package lines are
  about an agent's plan, across about 32 test files.

**Data model** (expand, then contract; D9):

- `coding_agent`:
  - `organization_id` (the workspace), backfilled from the plan;
  - `plan_id` becomes nullable;
  - `automation_id` (set null), which labels the tab "⚡ <automation>";
  - `visibility` (`workspace` | `private`, default `workspace`).
  - `repository` already lives on the row.
- `inbox_item` and `inbox_attachment`: `organization_id`, with `plan_id`
  nullable.

**Permissions.** An agent is reachable by a member of its
`organization_id`, and a `private` one only by its starter, owners, and
admins. A plan's agents keep their plan check, so nothing changes for
them. Start serialises on the automation's row lock for a planless run,
which `withAutomationLocked` already takes.

**Start, checkout, and steer.**
- `startCodingAgent` takes either a plan or `{workspace, repository,
  task}`.
- The five `planWorkspace` hops read `agent.organization_id` instead.
- Without a plan there is no archive refusal; a deleted automation leaves
  its agents standing, as an archived agent does.

**Brief and tools.**
- A planless agent gets the existing `TASK` brief (`instructions.ts:55-66`),
  which never mentions a plan.
- `edit_plan` already refuses without a plan.
- `show_page` stores pages per plan, so a planless agent is offered no
  `show_page` in v1.
- The Inbox tools write `organization_id` and a null plan.
- Luke's planning tools stay plan-scoped and simply never see planless
  agents.

**Inbox.**
- Items group by plan *or by automation*. A planless item's breadcrumb is
  "⚡ <automation> · <repository>" where a plan's name would stand.
- The account-wide read keeps a plan's archive filter and adds the
  agent's visibility.

**Desktop.**
- A new window place, **an agent page**: one planless agent, full width
  and titled with its automation. It stands in the plan's place as the
  Inbox does and reuses the agent tab's own body.
- It opens from the automation's run list, from its Inbox item, and from
  its notification.
- Agent notices watch planless agents through a new workspace-wide list
  rather than per plan.
- The command palette lists them under Automations.

**Old builds.** v0.12.0 decodes an agent's `planId` as a required UUID.
- Plan-nested routes already leave planless agents out.
- The account Inbox (`/api/inbox`) and the notices' reads leave planless
  items out unless the client asks for them (`?planless=include`, the same
  shape `archived=include` uses), so an old build never sees a row it
  can't read.

**Risks:**
1. Access-control regressions, since every per-id read changes its EXISTS.
   Each store PR ships a cross-account and cross-visibility test.
2. Old desktops decoding a null `planId`, guarded above.
3. The desktop's `planId: string` assumptions. The type system finds them
   once the view types are optional.
4. Deletion: a planless agent has no plan delete to stamp its conversation,
   so its own delete and its workspace's removal stamp it instead.

### D5. Run target: both, with no skip logic

Dean: "adding logic for that is overengineering and we should just still
run the automation."

- **A new agent each run** is the default.
- **Continue one agent** sends each run as a follow-up through
  `steerCodingAgent`, exactly as a person's message is sent. It steers a
  turn under way or opens a new one. There is no busy check.
- "Continue this agent" is preselected when the dialog opens from an
  agent's tab.

### D6. When the creator leaves: no special state

Dean: "I don't want to add any bespoke logic that isn't industry standard."

**R:** the automation stays its creator's and nothing transfers, as on
GitHub Actions, Slack, Apps Script, and Power Automate (§1).

- Its next runs fail to start, because the creator no longer reaches the
  workspace. The run's reason reads "Its creator is no longer in Acme", a
  reason word rather than a state.
- The existing guard pauses it after three failed starts.
- Owners and admins see it (D2) and can delete it.
- A departed creator's webhook answers 404, from #2564's reach gate, as a
  departed member's tokens are revoked elsewhere.
- No transfer and no take-over. A service identity (§5) is the standard
  answer for automations that must outlive a person.

### D7. Lifecycle: shrinks with D1

- **Plans:** none, now that an automation has no plan.
- **Continued agent archived or deleted:** each follow-up it refuses fails
  that run, and the same guard pauses the automation. There is no
  `chat-gone` state; the banner names the last run's reason. A deleted
  agent nulls `target_agent_id`, which the next run reads as a failed start
  in the same way.
- **Automation deleted:** its runs' agents stay. They are ordinary agents,
  so they can be archived or deleted like any other.

### D8. Personal workspaces

There is no workspace scope there. The owner control is hidden.

### D9. Schema: expand then contract

**Expand migration 1, `automation`:**
- `organization_id`, backfilled from the plan;
- `scope` (default `personal`);
- `repository`, backfilled from the plan;
- `target_kind` (default `new-agent`);
- `target_agent_id` (set null);
- `plan_id` becomes nullable.

**Expand migration 2, agents and the Inbox:**
- `coding_agent`: `organization_id` (backfilled), `automation_id`, and
  `visibility`, with `plan_id` nullable;
- `inbox_item` and `inbox_attachment`: `organization_id` (backfilled), with
  `plan_id` nullable;
- indexes on `(organization_id, created_at)`.

**Contract**, once every reader uses the new columns:
- `organization_id` becomes not null on all four tables, after a check for
  nulls;
- `automation.plan_id` is dropped.

Nothing else is dropped. Each expand is additive under v0.12.0, which has no
automations UI and never sees a planless row.

### D10. The webhook body: approved

The carve-out line goes into AGENTS.md in #2516, worded as Dean approved:
"a webhook body an automation's caller sends may reach that run's agent
task, transcript and traces". The dialog says "don't send secrets in the
body".

## 4. The revised PR plan

**Merged and kept:** #2511–#2515, the research, wire, store, API, and
GitHub triggers. The expand migrations rework them in place.

| PR | Verdict |
| --- | --- |
| #2516 webhook trigger | **Survives.** Adds the D10 carve-out line |
| #2564 archive pause + webhook reach | **Reworked to the webhook-reach gate alone.** The plan-archive pause goes (D1) |
| #2522 desktop plumbing | **Survives, small rework**: owner, repository, and target in the params, and no plan |
| #2525 page and dialog | **Reworked**: Owner, Repository, and Runs land in (the show's dialog) |
| #2541 plan ⋯ filter | **Closed** (D1) |
| #2547 list cleanup and the unopened detail cleanup | **Survive**, with the page-head move on top and `Segments` on the shared `Segmented` (main renamed its classes, so the frozen editor's segments draw unstyled) |
| Per-plan tab (approved, never opened) | **Not built** (D1) |

**New, in order** (S, M, and L are rough sizes):

1. **Automation scope, expand migration 1 and the store** (M): owner,
   repository, and target; the scope reach (D2); webhook carve-out
   wording.
2. **Agents and Inbox, expand migration 2** (M): backfill, plus
   cross-account tests.
3. **Agent and Inbox reach by workspace and visibility** (M/L): every
   per-id read, and Start's lock for planless runs.
4. **Start, checkout, steer, skills, and published without a plan** (M).
5. **Coder brief and tools for planless agents** (S/M): the `TASK` brief,
   no `show_page`, and planless Inbox writes.
6. **Inbox server** (M): group by plan or automation, the old-build filter,
   and the breadcrumb data.
7. **Wire, API, and gateway** (M): optional `planId`,
   `GET /api/agents/{id}`, and a planless list for an automation's runs.
8. **Desktop agent page** (L, likely two PRs): a new navigation place, the
   tab body outside a column, and file and PR reads without a plan.
9. **Desktop Inbox and notices for planless items** (M).
10. **Automation runs start planless agents; continue-one-agent through
    steer** (M).
11. **#2525 rework, #2522, and the cleanup stack with page heads**
    (M, about 3 PRs).
12. **Contract** (S).

That is about 14–16 PRs. Items 2–9 are the planless-agent rework, and they
ship value on their own: a planless agent is useful beyond automations.

## 5. Roadmap: a workspace service identity (Dean's ask; not built now)

| Part | Size | Today and what it takes |
| --- | --- | --- |
| GitHub authorship | **S** | Already the App. Pushes and pull requests use the workspace installation token and commit as `luke[bot]` (`checkout.ts:71-79`, `115-139`). What's left: drop the starter-membership hop (`planWorkspace`, which D4 already replaces), and give the GitHub MCP tools an installation-token fallback |
| Workspace model keys and a meter | **M/L** | Keys are per account (`account_provider_key`), and the meter counts per account and day with no spend or limits (`hosted_usage`). It takes a workspace key table, key resolution of user → workspace → Luke, and a workspace meter through every userId-typed meter seam. It is L if real spend limits are wanted |
| A service owner for agents | **L** | `user_id` is on agents, conversations, turns, the Inbox, and automations, and about 61 reads are per user. Either a synthetic "service user" (a member row, no login, hidden from member lists, never given a personal workspace) or ownership reads by workspace. D4's workspace reach covers much of the second |
| Admin UI | **S/M** | The workspace settings page already gates on owner and admin. Add a "Workspace keys" and a "Runs as" section |

The total is about L, around 6–8 PRs, and best done after D4, whose
workspace-scoped reach it reuses.

**Risks:**
1. Work owned by the service silently vanishes from people's Inbox and
   transcripts if any read stays per user.
2. A workspace key that can't be opened must refuse, never fall back to
   Luke's key, keeping today's rule (`account-keys.ts:22-27`).
3. A synthetic user tripping Better Auth flows (personal workspace, member
   counts, role checks, delete cascades), and the loss of who pressed Run
   now unless it is recorded on the run.

## 6. For Dean

1. D1: drop per-plan automations for v1, with the repository as the only
   filter?
2. D4: the planless-agent plan and order above (about 10 PRs of the
   14–16)?
3. D6: no special state on departure, with the guard pausing and admins
   deleting?
4. The revised PR plan in §4: close #2541, rework #2564 to webhook reach
   alone, rework #2525, and build in the order listed?
