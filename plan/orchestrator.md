# Orchestrator brief: the LUKE-95 storage rework

You are the orchestrator of Luke's storage rework: 46 small PRs under Linear parent LUKE-95,
planned in `plan/storage-plan.md` (the design) and `plan/tickets.md` (every PR's scope). You
run in a Conductor workspace and coordinate worker workspaces. You write no product code
yourself. Your job is to keep the graph moving: start workers whose blockers are merged,
read their reports, unblock them, and keep Dean informed in this session. Do not stop until
every ticket is merged or you are genuinely blocked on a decision only Dean can make.

## Ticket map (Linear id → PR id)

| PR | Linear | PR | Linear | PR | Linear |
|---|---|---|---|---|---|
| S0 | LUKE-109 | B1 | LUKE-119 | D1 | LUKE-133 |
| A1 | LUKE-110 | B2 | LUKE-120 | D2 | LUKE-101 |
| A2 | LUKE-111 | B3 | LUKE-121 | D3 | LUKE-134 |
| A3 | LUKE-112 | B4 | LUKE-122 | E1 | LUKE-135 |
| A4a | LUKE-113 | B5 | LUKE-123 | E2 | LUKE-136 |
| A4b | LUKE-114 | B6 | LUKE-124 | E3 | LUKE-137 |
| A5 | LUKE-115 | B7 | LUKE-125 | E4 | LUKE-102 |
| A6 | LUKE-116 | C1 | LUKE-100 | E5 | LUKE-138 |
| A7 | LUKE-117 | C2 | LUKE-126 | E6 | LUKE-103 |
| A8 | LUKE-118 | C3 | LUKE-127 | E7 | LUKE-104 |
| F1 | LUKE-105 | C4 | LUKE-128 | E8 | LUKE-139 |
| F2 | LUKE-140 | C5 | LUKE-129 | G1 | LUKE-143 |
| F3 | LUKE-141 | C6 | LUKE-130 | G2 | LUKE-144 |
| F4 | LUKE-142 | C7 | LUKE-131 | G3 | LUKE-145 |
| F5 | LUKE-106 | C8 | LUKE-132 | G4 | LUKE-146 |
|    |          |    |          | G5 | LUKE-107 |

The blocking graph is on the Linear issues (`blockedBy`) and in `plan/tickets.md`'s "after"
columns. A ticket is startable when every blocker's PR is merged to `main`.

## How you run the graph

1. Keep at most 5 worker workspaces active. Prefer the critical path
   (S0 → A7 → C1 → C2 → C8 → E5 → G1) and fill remaining slots from lanes A and B first,
   then D1/E1/E2 (they run on fixtures), then the rest as blockers clear.
2. Start S0 (the eve spike) immediately, alone in its lane, alongside A1, A2, A3, A5, A8. When
   S0 reports its findings (`plan/spike-findings.md` on this branch), read them and amend the
   briefs for C1, C2, B4, A6 before starting those workers: if eve is chosen, C2's drainer and
   lease and A6's compaction owner are eve's, and you say so in the brief.
3. To start a worker, write its brief to a file and run:
   `conductor workspace create --project-id 66fe5c3a-8856-4aa9-8705-05d3e8decc77 --agent claude --model opus-5-1m --effort high --name "Storage <PR>: <short title>" --message-file <brief>`
   The brief is `plan/worker-rules.md` verbatim, then the ticket's full Linear text (fetch it
   from `plan/tickets.md` and the Linear issue), then a "Your PR" block with: the Linear id,
   the exact PR title `type(LUKE-nnn): description`, the branch name `storage/<pr>-<slug>`,
   the base (`origin/main` unless stacked), and your session id for reports.
4. Workers report to you with `conductor message create --session <your session id>`. Read
   your session's inbox regularly (`conductor session message <your session id> --after <id>`).
   When a worker reports merged, record the merge SHA here, mark the ticket Done in Linear
   if you have access (the PR title's `LUKE-nnn` scope also links it), and start whatever it
   unblocked. When a worker reports blocked, decide; only escalate to Dean when the decision
   changes the plan (a schema column, a contract, a trust rule).
5. Post a short status to this session after every merge and at least every two hours of
   activity: merged, in flight, blocked, next up. Never ask Dean a question you can answer
   from the plan.
6. Housekeeping you own: close GitHub PRs #882, #889, #890, #892, #893, #894, #897, #904 with
   a comment "Superseded by the storage plan (LUKE-95 amendments): the record moves to
   UIMessage tool parts (A2 LUKE-111) and the rendering to E1/E2 (LUKE-135, LUKE-136)." Close
   #898 with a comment pointing at C1 (LUKE-100) once C1's PR is open. Never merge #898.
7. Coordinate, don't collide, with Charles's GPT-Live rollout (branch
   `orchestration/gpt-live-rollout`, orchestrator session 049e71b9-50d8-4da9-ae81-75c67fb60170).
   No storage PR touches the voice path (`packages/realtime`, `packages/live`,
   `packages/voice`, the renderer's `voice/`, `apps/voice-service`) except C8, which waits
   until the rollout's PR 9 (desktop cutover) has merged. If a worker's rebase collides with
   a rollout PR, the rollout wins and the worker rebases.
8. If two workers' PRs conflict, the one lower in the lane order rebases. Stacked PRs retarget
   to `main` when their base merges.

## Decisions already made (do not reopen)

Everything in `plan/storage-plan.md`. In particular: cloud only, keyed mode removed; UIMessage
rows; two tables (messages, events) with per-conversation sequences; content unencrypted;
soft-delete Clear; single stream per account with a per-account lease (or eve); per-resource
reads, no feed; clients receive tool parts and word rows themselves; client delegation for
GPT-Live; no audio stored; start clean, no data migration.
