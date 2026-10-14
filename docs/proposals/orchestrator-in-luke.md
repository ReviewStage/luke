# Proposal: building blocks for an orchestrator coding agent

Status: planning only, against main at `3a86637e` (2026-10-14). No code
until Dean OKs it. This replaces revisions 1–4, which designed a Luke
planner conversation, a Conductor bridge, and a long phase list; they stay
in this file's git history.

Dean's ask: "I just need to figure out what building blocks I need to add
to Luke so that I can use one of its coding agents to orchestrate across
multiple agents, similar to how I do in Conductor but improved since I can
work out of the inbox instead of typing into this chat (which other agents
are also typing into). I don't need to support Conductor agents in Luke."

## TL;DR

- **The orchestrator is one ordinary Luke coding agent.** Dean starts it and
  briefs it ("orchestrate this rollout"). It needs six building blocks; the
  last is optional.
- **Most of each block already exists for Luke's planner or the Inbox.**
  The work is mostly offering it to coding agents.

| # | Block | What exists | Smallest change | Size |
| --- | --- | --- | --- | --- |
| 1 | **Start agents** | The planner's `start_coding_agent` | Offer it to coding agents; record the parent; children go on the orchestrator's plan (planless once worker 259's step 4 lands) | M + S migration |
| 2 | **See and steer them** | The planner's list, read and message tools | Offer them to coding agents, scoped to the agents it started; add stop and archive | M |
| 3 | **Hear back** | The Inbox answer path steers an idle agent awake | When a child's turn ends, steer its parent with a short report | M |
| 4 | **Ask Dean** | Inbox choice, recommendation, note and links; answers routed back | Pick the recommendation up front; raise the 20-open-item bound; optionally "Answer all" | S + S (+ M) |
| 5 | **Notice merges and CI** | A child's turn end already reports its CI. Webhooks refresh PR state. Same-agent automations are coming | A heartbeat via a Same-agent automation (no code here); optionally, wake the parent on a child PR's merge or failed checks | 0 (+ M) |
| 6 | **Guardrail** | No cap today | Max live children per agent, and children can't start agents | S, inside block 1 |

**To try it soonest:**
- Blocks 1, 2 and 4's two small changes come first. That is 4 PRs, about
  1,200 lines.
- Block 3 next (1 PR). It turns polling into being woken.
- Block 5, Answer all, and planless children come last.

## Block 1: start other coding agents from inside a coding agent

**Exists:**
- `start_coding_agent` is offered to the planner role only
  (`apps/web/server/hosted/agent-runtime/tools.ts:44-47`).
- It is implemented in `apps/web/server/hosted/coding-agent-tools.ts:549-585`
  over `coder-host/start.ts:121`, the same path as the desktop's Start
  button. It takes `task` (the brief, 16,000 chars), `model` and `effort`.
- It is idempotent on eve's call id, so a replayed call starts nothing
  twice.
- It always starts on the caller's plan, on the plan's repository.
- Planless agents: #2637 (merged) made `coding_agent.plan_id` nullable and
  added `organization_id` and `repositories`. #2663 (in review) reaches a
  planless agent through its workspace. Starting one without a plan is the
  automations plan's step 4, not yet open.

**Smallest change:**
- **Roles.** Add `CODER` to the four tools' roles in `tools.ts`. Coding
  workers (subagents) stay without them.
- **The coder host gets the binding the planner's call has.**
  - The binding is the agent's account, its plan or none, and its workspace.
  - Its eve client is the coder deployment acting for that account, which
    `coder-host/channel.ts`'s deployment rows already admit for a typed
    line.
  - The tool files go in `apps/web/coder/tools/`, beside `delegate.ts`.
- **Start input.** Add `repository?`, which defaults to the orchestrator's
  own. Children land on the orchestrator's plan. Once step 4 lands, `plan:
  "none"` starts a planless child.
- **Parent.** Add `coding_agent.parent_agent_id`: nullable, set to null when
  the parent is deleted. It is one expand migration with a sibling store
  test, and blocks 2, 3 and 6 all key on it.

**Size:** M (about 500 lines), plus an S migration.

**Depends on:** nothing for children on a plan. Planless children need
automations step 4 (start without a plan) and step 7/8 (the desktop shows
planless agents).

## Block 2: see and steer its agents

**Exists:**
- `list_coding_agents`, `read_coding_agent` and `message_coding_agent`
  (`coding-agent-tools.ts:199-229`, `467-547`):
  - the list gives status and latest activity;
  - a read gives status, branch, the PR as GitHub holds it, and a tail of up
    to 20 entries from the last 3 turns;
  - a message steers a running turn or opens one (`coder-host/steer.ts:98`).
- Stop exists only as a route (`coder-host/stop.ts`). Archive is a `PATCH`
  on the agent.

**Smallest change:**
- Offer the three tools to `CODER`, scoped to **the agents it started**
  (`parent_agent_id = me`) rather than the planner's "every agent on the
  plan" (`planAgent`, `coding-agent-tools.ts:414`).
- Add `stop_coding_agent` and `archive_coding_agent` over the existing
  routes' functions. The orchestrator needs them to freeze work, and to
  archive a worker once its PRs merge.
- Desktop: nothing is needed to try it.
  - The orchestrator's tool rows already open the agent they name.
  - Children on a plan already list in its sidebar.
  - A child list in the orchestrator's tab is a nicety for later (see the
    show).

**Size:** M (about 400 lines), mostly tests through the tool's public run
function.

**Depends on:** block 1's `parent_agent_id`.

## Block 3: hear back from its agents

**Exists:**
- When Dean answers an Inbox item that needs a reply, the service steers the
  asking agent with the answer as a message, which opens a turn if the agent
  is idle (`apps/web/server/coding-agents-app.ts:798-812`). That is exactly
  the wake-up an orchestrator needs.
- A child ends its turn with a final message. The turn-end hook
  (`apps/web/coder/hooks/store.ts:136-160`) records the branch and relays
  the end, then tells no one.

**Smallest change:**
- **The hook.** On `turn.completed`, `turn.failed` or `turn.cancelled`, if
  the agent has a parent, steer the parent through `steerCodingAgent`. The
  message is one line, keyed by the child's turn id so a replayed end sends
  once:
  `[child: Mentions PR 1] finished · PR #2601 open, checks green · "<the
  final message, trimmed to about 1,500 characters>"`.
- **Ordering.** It runs after `recordBranch`, so the PR state is current,
  and it is the same hook point rollout #2269 (open) uses to report a
  worker's end to Luke. One "report the end to whoever started it" function
  serves both.
- **No new tool.** A child that needs the orchestrator mid-turn ends its
  turn with what it needs. Rollout #2265's `report` tool could later route
  to the parent the same way.

**Size:** M (about 300 lines).

**Depends on:** block 1.

## Block 4: ask Dean through the Inbox

**Exists:**
- `post_to_inbox`, `close_inbox_item` and `read_inbox` for coding agents
  (`apps/web/server/hosted/coder-host/inbox.ts`; `packages/features/src/inbox-wire.ts`):
  - a choice of up to 6 options, each with a detail, one `recommended`, and
    a note;
  - link blocks (a PR or any https URL), code and screenshots;
  - revisions, so a stale answer is refused;
  - routing back as above.
- The desktop draws it grouped by plan, with Needs you.
- **Planless agents are refused the Inbox** until the automations plan's
  steps 5 and 9.

**What an orchestrator is missing:**
- **The recommendation picked up front.** Today it is a label
  (`apps/desktop/src/renderer/planning/inbox-pane.tsx:452`), so every answer
  takes a press. Picking it means Send alone accepts. S, desktop only.
- **More than 20 open items.** `MAX_OPEN_PER_AGENT` is 20
  (`inbox-wire.ts:100`; enforced at `inbox-store.ts:658`). Dean's
  orchestrator holds 17–25. Raise it to 40. S.
- **Answering several at once** (optional for a first try): an "Answer all"
  for one agent's open choices, each starting on its recommendation.
  - It sends each answer through the existing `POST /api/inbox/{id}`, so no
    new route is needed.
  - The first answer wakes the orchestrator and the rest steer into the same
    turn.
  - M, desktop.
- **Links to PRs and previews already work** as link blocks. No new block
  type is needed.

**Depends on:** nothing for an orchestrator on a plan. A planless
orchestrator needs automations steps 5 and 9.

## Block 5: keep working across turns and events

**Exists:**
- Each child watches its own PR's checks inside its turn, for up to 3 fix
  rounds (`coder-host/instructions.ts:87`). It then ends its turn, which
  block 3 reports.
- The orchestrator has `gh` in its sandbox. Each new turn resumes the
  sandbox, so it can re-check PRs whenever it is woken.
- The GitHub webhook re-reads a PR's state for the agents on its branch on
  every PR or check event (`apps/web/server/github-webhook-app.ts:278-300`),
  but wakes no one.
- The automations plan's Same-agent target (step 10, schema in #2616) sends a
  scheduled follow-up into one chosen agent through `steerCodingAgent`.

**Smallest change:**
- **Use a Same-agent automation as the heartbeat.** For example, "every 30
  minutes: check your agents' PRs and report anything new". It needs no code
  in this plan; it arrives with automations steps 10 and 11.
- **Optionally, merge and CI wakes.** In `readAgainOnBranches`, when an
  agent with a parent has its PR merge, close, or fail checks, steer the
  parent once per delivery. This overlaps stack #2389 (open), which reports
  merges and reviews to Luke for rollout workers. M (about 300 lines).

**Depends on:** automations steps 10 and 11 for the heartbeat; block 1 for
the wakes.

## Block 6: guardrails, only what's essential

- **At most N live children per agent** (default 10). A start past it is
  refused with words the model can act on.
- **Depth 1.** A child (an agent with a parent) is not offered the start
  tool, so one orchestrator can't fan out into a tree.

Both sit inside block 1's start (S). Everything else is left out until it's
needed:
- spend caps;
- a cap on wake-ups;
- merge rules. Nothing stops `gh pr merge` today, and the coder instructions
  only say that watching checks never merges. The orchestrator merges when
  its brief tells it to.

## Order

| Step | PRs | What Dean can do after it |
| --- | --- | --- |
| **A** | 1a `parent_agent_id` migration (S) · 1b start, list, read, message for coding agents, with the cap and depth (M) · 2 stop and archive (S) · 4a recommendation picked up front + open bound 40 (S) | Start an orchestrator on a plan and brief it. It starts and steers children on the same plan, asks Dean in the Inbox, and Dean's answers wake it. It polls its children when woken, or sleeps between reads within a turn |
| **B** | 3 the parent hears a child's turn end (M) | The orchestrator is woken by its children; no polling |
| **C** | 5 heartbeat (automations 10–11; no code here) · optional merge and CI wakes (M) · optional 4b Answer all (M) · planless children (after automations steps 4–9) | It notices merges with no prompt, Dean clears a batch of decisions at once, and short-lived workers need no plan |

Step A is about 1,200 lines. All of A and B together is 5 PRs, about 1,500
lines.

## Decisions for Dean

1. **Who may the orchestrator see and steer?**
   - A. Only the agents it started. *(Recommended)*
   - B. Every agent on its plan, as the planner can.
2. **Can a child start agents?**
   - A. No, depth 1. *(Recommended)*
   - B. Yes, under the same cap.
3. **The cap on live children per orchestrator?**
   - A. 10. *(Recommended)*
   - B. 20.
   - C. None.
4. **Where do children ask their questions?**
   - A. Straight to Dean's Inbox, under their own name; the orchestrator
     reads its children to know what they asked. *(Recommended)*
   - B. Only to the orchestrator, which relays to the Inbox.
5. **How does the orchestrator notice merges and CI first?**
   - A. A Same-agent automation heartbeat now, and webhook wakes only if the
     heartbeat proves too slow. *(Recommended)*
   - B. Build the webhook wakes in step C regardless.
6. **"Answer all" for one agent's open choices?**
   - A. Not for the first try. Ship 4a and see whether one-at-a-time with
     the recommendation picked is enough. *(Recommended)*
   - B. Ship it in step A.
7. **Merging?**
   - A. The orchestrator merges or enqueues when its brief says so, through
     `gh`, which already works. *(Recommended)*
   - B. Every merge is an Inbox approval.

## Overlaps

- **Worker 259 / automations** (#2637 merged, #2663 in review, steps 4–11
  to come): planless children and the Same-agent heartbeat come from there.
  This plan adds no second planless path.
- **Rollout and stack** (#2227–#2391, open): #2269's turn-end hook point and
  #2389's GitHub reports are the same seams blocks 3 and 5 use. Their report
  goes to Luke's planner; here it goes to the parent agent. One function
  should serve both.
- **`one-agent-runtime.md`:** blocks 1–2 are registry role changes on
  existing tools, not new implementations.
- **Charles's Chat** stays separate (Dean). This plan neither uses nor
  changes it.
