---
name: orchestrate
description: Roll out a plan or Linear issue as a set of PRs by acting as an orchestrator, from a Conductor workspace or a Luke coding agent. Splits the plan into small PRs, gives each PR to its own worker (a Conductor workspace or a Luke coding agent) on the user's chosen model and effort, runs independent PRs in parallel, has each worker babysit its PR and merge it on green or on the user's go, restacks a stack through a short-lived worker, monitors the workers through messages rather than polling, and archives each worker once its PR is merged. Use when the user says "orchestrate", "roll out this plan", or asks you to farm a plan or issue out to workspaces or agents instead of doing the work here.
---

# Orchestrate

You do no implementation work here. You are the orchestrator: the plan or
Linear issue describes the work; you split it into PRs, kick each of them off
with a new worker, and manage the rollout to merge.

You run in one of two hosts, and the steps are the same in both; only the
commands differ. In Conductor, a worker is a Conductor workspace driven by the
`conductor` CLI. In Luke, you are a coding agent and a worker is another
coding agent on a task of its own, driven by your agent tools. Use the column
for the host you are in:

| Action | Conductor | Luke |
| --- | --- | --- |
| Ask the user | `AskUserQuestion` | `post_to_inbox` with a `choice` (or `form`) response and `needsReply` |
| Valid model ids | `conductor model` | `list_models` |
| Your id, for reports | `echo "$CONDUCTOR_SESSION_ID"` | Nothing to record: a started agent is told your id |
| Start a worker | `conductor workspace create` (below) | `start_agent` with `newTask` and `title`, the brief as `prompt`, plus `model` and `effort` (below) |
| Worker's base branch | `--branch <base-branch>` | `start_agent`'s `branch` |
| Open a PR | `gh pr create --base <base-branch>` | `open_pull_request` with `base` |
| Message a worker | `conductor message create --session <sessionId>` | `message_agent` with its agent id |
| Worker reports back | `conductor message create --session <ORCHESTRATOR_SESSION_ID>` | `message_agent` with the orchestrator's agent id |
| Check on a silent worker | `conductor session message <sessionId>` | `read_agent` with its agent id |
| Stop a worker | `conductor session cancel <sessionId>` | `stop_agent` with its agent id |
| Archive a worker | `conductor workspace archive <workspaceId>` | `archive_agent` with a short reason, once the agent is idle |
| Point the user at a worker or PR | Deep links | The mentions `start_agent` answered, and the PR's URL |

Arguments: the plan (a file path, a Linear issue key such as `LUKE-159`, or
inline text), optionally followed by the model and effort the user wants the
workers on. In Conductor they arrive as `$ARGUMENTS`; in Luke they are the
words after `/orchestrate` in the developer's message, and the task's plan is
the plan where those words name none. Pull an issue with the Linear tools;
read a plan file with `cat`. If the user did not name a model and effort, ask
once; check the valid ids for the chosen agent rather than guessing. If the
user did not say whether workers merge their PRs on green or hold for an
explicit go, ask that too, in the same question when model or effort is also
missing; never assume either.

Split the plan into small PRs and draw the dependency graph. Every PR gets
its own worker, which builds, opens, and babysits that one PR, so review
comments on several PRs are fixed in parallel. Independent PRs start in
parallel from `main`. A PR that builds on another is based on that PR's
branch; a linear chain of them is a stack, and where chains branch off a
shared PR (a tree), each branch-off chain is a stack of its own. Prefer small
PRs and deep stacks over a few large PRs. Workers never restack: a
short-lived restack worker restacks a whole stack in one pass (Step 3).

## Step 1: Kick off each worker

In Conductor, record your own session id first; workers report back to it.
In Luke there is nothing to record: every agent you start is told your agent
id and how to message you.

Start one worker per PR, but only for PRs whose base exists. Kick off every
PR that starts from `main` now. Do not kick off a PR that builds on another
until that PR's worker reports it open and its branch pushed; a worker started
earlier would have nothing to build on. Then start it with that PR's branch
as its base.

In Conductor, `workspace create` defaults to this workspace's project:

```sh
conductor workspace create \
  --branch <base-branch> \
  --name "<PR title>" \
  --agent claude \
  --model <model> \
  --effort <effort> \
  --message "$(cat <<'BRIEF'
<brief>
BRIEF
)"
```

In Luke, call `start_agent` with `newTask` set to the PR title, so each
worker stands as its own task in the sidebar as a Conductor workspace does,
and `title` set to the PR title too (at most 80 characters). Set `branch` to
the base branch when it is not `main`; the worker starts on it and is told to
pass it as `base` when it opens its PR. Give the brief as `prompt`, so the
worker works from the brief and not the whole plan, and the chosen `model`
and `effort`, checked against `list_models`. The call carries everything the
worker is told; do not follow it with a message. `prompt` and `note` each
hold at most 64,000 characters, and a `message_agent` message 16,000: put the
PR's own scope and acceptance criteria in `prompt` and the rest of the brief
in `note`, and where the plan is long, quote only the parts this PR needs and
name the plan's file in the repository, if it has one, for the worker to read.

Every brief must contain:

1. **The task**: the PR's scope, acceptance criteria, and the plan or issue
   text this PR comes from (its own part, not the whole plan, where the
   plan is long), plus a line on each PR below and above it in its
   stack. Say plainly what is out of scope.
2. **Branching**: the base branch, the PR's branch, and how to open it
   against that base (the table's "Open a PR" row for the host). The worker
   never restacks.
   When the orchestrator says a restack is pending, it pushes or discards any
   work in flight, stops pushing, and replies "holding". When told the
   restack is done, it runs `git fetch origin <branch>` and `git reset
   --hard FETCH_HEAD` before touching the branch again (its clone may track
   no other branch than the one it started on).
3. **Babysit and merge**: watch CI and review comments on the PR, fix what
   fails, and merge as root `AGENTS.md`'s "Merging" says, taking
   merge-on-green at kickoff as the go or holding for an explicit go from the
   orchestrator, as the user chose; say which. A PR based on another PR
   merges only once that PR has merged and the restack has retargeted it to
   `main`.
4. **Report back, do not wait to be asked**: on each milestone (opened, fix
   pushed, CI green, blocked, merged) send a message to the orchestrator, as
   the table's "Worker reports back" row says, in this shape:

   ```text
   <PR title>: <status>. PR: <url>. <what happened / what is blocking>
   ```

   In Conductor, give the worker your session id to send it to. Also tell it
   to answer any message the orchestrator sends it.
5. **Ask, do not guess**: when the task is ambiguous, the plan and the code
   disagree, or a choice would change a PR's shape, send the question to the
   orchestrator the same way and wait for the answer instead of picking an
   interpretation. The orchestrator holds the whole plan and the user's
   intent; the worker holds one PR. Small judgment calls stay with the
   worker.

Keep each worker's ids (in Conductor its workspace and session ids, in Luke
its agent id and its agent and task mentions), branch, and PR url; you need
them to reply, to kick off the PRs above, to restack, and to archive.

## Step 2: Monitor by messages, not polling

Do not poll workers in a loop. Workers message you when something happens,
and each message arrives as a new turn. On each report:

- **PR opened**: if a PR is waiting on this one, kick its worker off now
  (Step 1) with this PR's branch as its base.
- **Fix pushed**: if any PR builds on this one, restack (Step 3).
- **PR opened**: under hold, relay the user's go to the worker when it comes.
- **Question or blocked**: answer from the plan and the other PRs' state by
  messaging that worker. Escalate to the user only when the decision is
  theirs, and relay the answer back yourself.
- **Merged**: if any PR builds on this one, restack (Step 3), which also
  retargets the PR above to `main`. Archive the merged PR's worker.

If a worker has gone silent for longer than the work plausibly takes, send it
one message asking for status. Only then, if it still does not answer, check
on it as the table says.

If a worker is going the wrong way (out of scope, or against an answer you
gave it) and a message does not turn it, stop it as the table says, then
message it the correction; the message starts a new turn on its kept branch.

In Luke, a worker that reads `running` long after its last activity may be
dead. Send it a one-line status message. If `message_agent` refuses it with
"session has ended for good", the worker is dead, whether `list_agents` then
reads it `failed` or still `running`. Post an inbox to-do (`post_to_inbox`
with a `task` response) naming the worker's mention and PR and asking the
user to Continue it in the app, then wait for it. Never start a replacement
worker from scratch. Continue starts a new agent, named after the dead one
with "(continued)", on its transcript and with its work copied to a snapshot
branch, and tells it to open a PR from that branch. So the to-do gives the
user a note to send with Continue, which reaches the new agent before it
acts: "Open no PR. Keep PR <url>: fetch `<pr-branch>`, carry your snapshot
branch's commits past its tip onto it, push them to `<pr-branch>`, and work
there from now on. Report to agent <your agent id>." Then find the new agent
with `list_agents`, send it the same words if it has not taken them up, and
track it in the dead worker's place, on `<pr-branch>`.

## Step 3: Restack

Run one restack at a time per stack. Tell every worker in the stack, and in
each branch-off stack based on it, that a restack is pending, and wait for
each to reply "holding"; stop one that does not hold, as the table says. Then
start a short-lived restack worker (the Step 1 start, named "Restack <stack
title>"; in Conductor on the stack's top branch; in Luke without `branch`, on
`main`, since a Luke agent never pushes the branch it was started on, so its
checkout is a single-branch clone of `main`, possibly shallow, and its brief
has it first run `git remote set-branches origin '*'`, then `git fetch
origin`, with `--unshallow` when `git rev-parse --is-shallow-repository` says
`true`) whose brief names the
trunk (`main`, or the parent PR's branch for a branch-off stack whose parent
has not merged), every unmerged branch bottom to top, and, after a merge, the
PR to retarget with `gh pr edit <number> --base main`. It first points a
local branch at each one's remote tip, bottom to top (`git checkout -B
<branch> origin/<branch>`, which in Conductor also resets the top branch the
worker starts on), then adopts them with `gh stack init --base <trunk> <branch> ...` and
restacks them in one pass: `gh stack sync` (fetch, cascading rebase, atomic
push, and relink) when nothing conflicts. When `gh stack sync` reports a
conflict, it restores every branch; the worker then runs `gh stack rebase`,
resolves each conflict and runs `gh stack rebase --continue` (or `--abort` to
give up), and after a successful rebase runs `gh stack push`, which pushes
each branch with `--force-with-lease`. Only when `gh stack` is missing or
fails, the fallback is to note the cutoff, which is the old trunk tip (`git
rev-parse origin/<trunk>`) or, after a merge, the merged PR's last head (`gh
pr view <number> --json headRefOid`), then `git fetch` and run `git rebase
--update-refs --onto origin/<trunk> <cutoff>` from the top branch, so neither
a rewritten trunk's old commits nor a squash-merged PR's commits are
replayed; on a conflict, resolve and stage it, then `git rebase --continue`
(or `--abort`), and only after the rebase succeeds push every branch with
`--force-with-lease`. It restacks each branch-off stack the same way onto its
parent's new head (or onto `main`, past the parent's last head, once the
parent has merged), asks you when a conflict needs a judgment call, opens no
PR of its own, and reports when done. Then archive it and tell every held
worker to reset and resume.

## Step 4: Finish

When every PR is merged and every worker is archived, report to the user:
the merged PRs with links, anything that was cut or changed from the plan,
and any follow-ups the workers surfaced. If the rollout came from a Linear
issue, update the issue with the merged PRs.

## Rules

- Never do the PR's implementation work yourself.
- Point the user at a worker or PR with a deep link or mention, not an id.
- One PR per worker. Do not reuse a worker for a second PR; a continuation
  of a dead worker takes over its PR.
- A PR that builds on another gets its worker only after that PR is open.
- Workers never restack; a restack runs only in a restack worker, while
  every affected worker holds.
- Do not archive a worker while its PR is unmerged.
- Stop a worker only when it goes the wrong way or will not hold for a
  restack; never start a fresh worker to replace one whose session died.
