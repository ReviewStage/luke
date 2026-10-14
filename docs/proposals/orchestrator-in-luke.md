# Proposal: an orchestrator coding agent, the smallest version

Status: approved by Dean on 2026-10-14 and built as one PR, held until Dean
has tried it. Dean's constraint: "I want everything to be as simple and not
overengineered as possible. Let's proceed with things that minimize code
complexity and don't include any special handling or logic." Earlier
revisions of this file (a planner conversation, a Conductor bridge, a phase
list, and six building blocks) are in its git history.

Dean's ask: "I just need to figure out what building blocks I need to add
to Luke so that I can use one of its coding agents to orchestrate across
multiple agents, similar to how I do in Conductor but improved since I can
work out of the inbox instead of typing into this chat (which other agents
are also typing into). I don't need to support Conductor agents in Luke."

## What is built

The orchestrator is one ordinary Luke coding agent. Dean starts it on a
plan and briefs it ("orchestrate this rollout").

- **Coding agents get the planning model's four existing tools, unchanged:**
  - `list_coding_agents`;
  - `read_coding_agent`: status, the PR from its branch, and a tail of what
    it last said and did;
  - `message_coding_agent`: steers a running turn or opens one;
  - `start_coding_agent`: a brief, a model and an effort.
- **Each is bound to the agent's own plan,** exactly as a planning call is,
  through the same implementation (`apps/web/server/hosted/coding-agent-tools.ts`).
  An agent reaches the agents on its plan and no other plan's.
- **The wiring:**
  - `CODER` added to the four tools' roles in
    `apps/web/server/hosted/agent-runtime/tools.ts`;
  - four tool files under `apps/web/coder/tools/`;
  - one host door (`coder-host/host.ts`'s `codingAgents`), which reaches
    eve as the deployment acting for the member whose turn it is, as a
    planning call does;
  - the descriptions, reworded for an agent ("agents on this plan") in
    `CODER_CODING_AGENT_TOOLS`.
- **The one guard is the one that already exists.** A start and a message
  run under eve's id for the tool call, so a retried call starts or sends
  nothing twice.

How it works day to day, all with what exists:

- **Children ask Dean in the Inbox,** as every coding agent already can, and
  his answer goes back to the child that asked.
- **The orchestrator asks Dean in the Inbox too.** His answer wakes it,
  which the Inbox already does for any agent.
- **When woken,** by an answer or a message, the orchestrator re-checks its
  children with `list_coding_agents` and `read_coding_agent`. It can also
  read PRs with `gh` in its sandbox.
- **Merging** is the orchestrator using `gh`, as its brief says.

## Later, if needed

None of these is built. Each waits until trying the orchestrator shows it is
needed.

| Block | What it would add | Rough size |
| --- | --- | --- |
| **Hear back** | When a child's turn ends, steer the agent that started it with one line (status, PR, final message), so the orchestrator is woken rather than re-checking. Needs a record of who started whom | M + S migration |
| **Periodic nudge** | A Same-agent automation (the automations plan, steps 10–11) that messages the orchestrator every N minutes. No code in this plan | 0 |
| **Merge and CI wakes** | The GitHub webhook wakes the orchestrator when a child's PR merges or fails checks | M |
| **Planless children** | Start children with no plan once worker 259's planless agents can be started (automations step 4); #2637 is merged and #2663 is in review | S |
| **Stop and archive tools** | Offer the existing stop and archive routes as tools | S |
| **Inbox for a heavy orchestrator** | The recommendation picked up front, more than 20 open items per agent, and Answer all for one agent's choices | S + S + M |
| **Guardrails** | A cap on live children, and children that can't start agents | S |

## Overlaps

- **Worker 259 / automations:** planless children and the periodic nudge
  come from there.
- **Rollout and stack** (#2227–#2391, open): they report to Luke's planner.
  This orchestrator is a coding agent, so it uses none of them.
- **`one-agent-runtime.md`:** this is a role change on registry entries, as
  that proposal intended.
