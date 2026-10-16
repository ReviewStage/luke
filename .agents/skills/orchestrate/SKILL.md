---
name: orchestrate
description: Roll out a plan or Linear issue as a set of PRs by acting as an orchestrator. Splits the plan into small PRs, gives each linear chain to one Conductor workspace as a GitHub stack on the user's chosen model and effort, runs independent chains in parallel, has each workspace babysit its PRs and merge them on green or on the user's go, monitors the workspaces through messages rather than polling, and archives each workspace once its PRs are merged. Use when the user says "orchestrate", "roll out this plan", or asks you to farm a plan or issue out to workspaces instead of doing the work here.
---

# Orchestrate

You do no implementation work in this workspace. You are the orchestrator: the
plan or Linear issue describes the work; you split it into PRs, kick each
stack of them off in a new Conductor workspace, and manage the rollout to
merge.

Arguments: `$ARGUMENTS` is the plan (a file path, a Linear issue key such as
`LUKE-159`, or inline text), optionally followed by the model and effort the
user wants the workers on. Pull an issue with the Linear tools; read a plan
file with `cat`. If the user did not name a model and effort, ask once with
`AskUserQuestion`; check `conductor model` for the valid ids for the chosen
agent rather than guessing. If the user did not say whether workers merge
their PRs on green or hold for an explicit go, ask that too, in the same
question when model or effort is also missing; never assume either.

Split the plan into small PRs and draw the dependency graph. Every linear
chain in it becomes one GitHub stack owned by one worker, which builds,
opens, restacks, and babysits every PR in it. Independent PRs and chains each
get their own worker, in parallel from `main`. Where chains branch off a
shared PR (a tree), each branch-off chain gets its own worker based on that
PR's branch, so siblings run in parallel. Prefer small PRs and deep stacks
over a few large PRs.

## Step 1: Kick off each workspace

Record your own session id first; workers report back to it:

```sh
echo "$CONDUCTOR_SESSION_ID"
```

Create one workspace per stack (an independent PR is a stack of one), but
only for stacks whose base exists. Kick off every stack that starts from
`main` now with `--branch main`. Do not kick off a branch-off chain until the
shared PR's owner reports that PR open and its branch pushed; a workspace
started earlier would branch from `main` and have nothing to build on. Then
create the branch-off workspace with that PR's branch as `--branch`.
`workspace create` defaults to this workspace's project.

```sh
conductor workspace create \
  --branch <base-branch> \
  --name "<stack title>" \
  --agent claude \
  --model <model> \
  --effort <effort> \
  --message "$(cat <<'BRIEF'
<brief>
BRIEF
)"
```

Every brief must contain:

1. **The task**: every PR in the stack, bottom to top, each with its scope,
   acceptance criteria, and the plan or issue text it comes from. Say plainly
   what is out of scope.
2. **Stacking**: the base branch, and the instruction to build the stack
   bottom-up with `gh stack init --base <base-branch> <first-branch>` and
   `gh stack add <next-branch>` for each PR above it, then open every PR with
   `gh stack submit --auto --open` (without `--open`, `--auto` opens drafts).
   After any change or merge below a PR, the owner restacks the whole stack
   in one pass: `gh stack sync` (fetch, cascading rebase, atomic push, and
   relink) when nothing conflicts. When `gh stack sync` reports a conflict,
   it restores every branch; the owner then runs `gh stack rebase`, resolves
   each conflict and runs `gh stack rebase --continue` (or `--abort` to give
   up), and after a successful rebase runs `gh stack push`, which pushes each
   branch with `--force-with-lease`. Without the extension, the fallback is
   to note the old base tip (`git rev-parse origin/<base-branch>`), `git
   fetch`, and run `git rebase --update-refs --onto origin/<base-branch>
   <old-base-tip>` from the top branch, so a rewritten base's old commits
   are not replayed; on a conflict, resolve and stage it, then
   `git rebase --continue` (or `--abort`), and only after the rebase
   succeeds push every branch with `--force-with-lease`.
3. **Babysit and merge**: watch CI and review comments on every PR in the
   stack, fix what fails, and merge as root `AGENTS.md`'s "Merging" says,
   taking merge-on-green at kickoff as the go or holding for an explicit go
   from the orchestrator, as the user chose; say which. A stack based on
   another worker's PR merges only once that PR has merged and the stack's
   bottom PR has been retargeted to `main` (`gh pr edit --base main`).
4. **Report back, do not wait to be asked**: on each milestone of each PR
   (opened, restacked, CI green, blocked, merged) send a message to the
   orchestrator:

   ```sh
   conductor message create --session <ORCHESTRATOR_SESSION_ID> \
     --message "<PR title>: <status>. PR: <url>. <what happened / what is blocking>"
   ```

   Also tell it to answer any message the orchestrator sends it.
5. **Ask, do not guess**: when the task is ambiguous, the plan and the code
   disagree, or a choice would change a PR's shape, send the question to the
   orchestrator the same way and wait for the answer instead of picking an
   interpretation. The orchestrator holds the whole plan and the user's
   intent; the worker holds one stack. Small judgment calls stay with the
   worker.

Keep the workspace id, session id, branches, and PR urls of each worker; you
need them to reply, to kick off branch-off chains, and to archive.

## Step 2: Monitor by messages, not polling

Do not poll `session status` or `session message` in a loop. Workers message
this session when something happens, and each message arrives as a new user
turn. You restack nothing; each owner restacks its own stack. On each report:

- **PR opened**: if a branch-off chain is waiting on this PR, kick that
  workspace off now (Step 1) with this PR's branch as its base.
- **Shared PR restacked**: when an owner reports it pushed a restacked PR
  that a branch-off chain is based on, tell each of those chains' workers to
  fetch and restack onto the new head.
- **PR opened**: under hold, relay the user's go to the worker when it comes.
- **Question or blocked**: answer from the plan and the other PRs' state by
  replying to that worker's session with
  `conductor message create --session <workerSessionId>`. Escalate to the
  user only when the decision is theirs, and relay the answer back yourself.
- **Merged**: if a branch-off chain is based on this PR, tell its worker to
  retarget its bottom PR to `main` and restack. When every PR in a stack has
  merged, archive that workspace:

  ```sh
  conductor workspace archive <workspaceId>
  ```

If a worker has gone silent for longer than the work plausibly takes, send it
one message asking for status. Only then, if it still does not answer, read
its transcript with `conductor session message <sessionId>`.

## Step 3: Finish

When every PR is merged and every workspace is archived, report to the user:
the merged PRs with links, anything that was cut or changed from the plan,
and any follow-ups the workers surfaced. If the rollout came from a Linear
issue, update the issue with the merged PRs.

## Rules

- Never do the PR's implementation work in this workspace.
- Use deep links, not ids, when pointing the user at a workspace or PR.
- One stack per workspace: a linear chain of PRs belongs to one worker. Do
  not reuse a worker for a second stack.
- A branch-off chain's workspace is created only after the PR it builds on
  is open.
- Do not archive a workspace while any PR in its stack is unmerged.
