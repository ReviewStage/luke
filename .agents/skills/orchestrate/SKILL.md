---
name: orchestrate
description: Roll out a plan or Linear issue as a set of PRs by acting as an orchestrator. Splits the plan into small PRs, gives each PR to its own Conductor workspace on the user's chosen model and effort, runs independent PRs in parallel, has each workspace babysit its PR and merge it on green or on the user's go, restacks a stack through a short-lived workspace, monitors the workspaces through messages rather than polling, and archives each workspace once its PR is merged. Use when the user says "orchestrate", "roll out this plan", or asks you to farm a plan or issue out to workspaces instead of doing the work here.
---

# Orchestrate

You do no implementation work in this workspace. You are the orchestrator: the
plan or Linear issue describes the work; you split it into PRs, kick each
of them off in a new Conductor workspace, and manage the rollout to merge.

Arguments: `$ARGUMENTS` is the plan (a file path, a Linear issue key such as
`LUKE-159`, or inline text), optionally followed by the model and effort the
user wants the workers on. Pull an issue with the Linear tools; read a plan
file with `cat`. If the user did not name a model and effort, ask once with
`AskUserQuestion`; check `conductor model` for the valid ids for the chosen
agent rather than guessing. If the user did not say whether workers merge
their PRs on green or hold for an explicit go, ask that too, in the same
question when model or effort is also missing; never assume either.

Split the plan into small PRs and draw the dependency graph. Every PR gets
its own worker, which builds, opens, and babysits that one PR, so review
comments on several PRs are fixed in parallel. Independent PRs start in
parallel from `main`. A PR that builds on another is based on that PR's
branch; a linear chain of them is a stack, and where chains branch off a
shared PR (a tree), each branch-off chain is a stack of its own. Prefer small
PRs and deep stacks over a few large PRs. Workers never restack: a
short-lived restack workspace restacks a whole stack in one pass (Step 3).

## Step 1: Kick off each workspace

Record your own session id first; workers report back to it:

```sh
echo "$CONDUCTOR_SESSION_ID"
```

Create one workspace per PR, but only for PRs whose base exists. Kick off
every PR that starts from `main` now with `--branch main`. Do not kick off a
PR that builds on another until that PR's worker reports it open and its
branch pushed; a workspace started earlier would branch from `main` and have
nothing to build on. Then create it with that PR's branch as `--branch`.
`workspace create` defaults to this workspace's project.

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

Every brief must contain:

1. **The task**: the PR's scope, acceptance criteria, and the plan or issue
   text it comes from, plus a line on each PR below and above it in its
   stack. Say plainly what is out of scope.
2. **Branching**: the base branch, the PR's branch, and the instruction to
   open it with `gh pr create --base <base-branch>`. The worker never
   restacks. When the orchestrator says a restack is pending, it pushes or
   discards any work in flight, stops pushing, and replies "holding". When
   told the restack is done, it runs `git fetch` and `git reset --hard
   origin/<branch>` before touching the branch again.
3. **Babysit and merge**: watch CI and review comments on the PR, fix what
   fails, and merge as root `AGENTS.md`'s "Merging" says, taking
   merge-on-green at kickoff as the go or holding for an explicit go from the
   orchestrator, as the user chose; say which. A PR based on another PR
   merges only once that PR has merged and the restack has retargeted it to
   `main`.
4. **Report back, do not wait to be asked**: on each milestone (opened, fix
   pushed, CI green, blocked, merged) send a message to the orchestrator:

   ```sh
   conductor message create --session <ORCHESTRATOR_SESSION_ID> \
     --message "<PR title>: <status>. PR: <url>. <what happened / what is blocking>"
   ```

   Also tell it to answer any message the orchestrator sends it.
5. **Ask, do not guess**: when the task is ambiguous, the plan and the code
   disagree, or a choice would change a PR's shape, send the question to the
   orchestrator the same way and wait for the answer instead of picking an
   interpretation. The orchestrator holds the whole plan and the user's
   intent; the worker holds one PR. Small judgment calls stay with the
   worker.

Keep the workspace id, session id, branch, and PR url of each worker; you
need them to reply, to kick off the PRs above, to restack, and to archive.

## Step 2: Monitor by messages, not polling

Do not poll `session status` or `session message` in a loop. Workers message
this session when something happens, and each message arrives as a new user
turn. On each report:

- **PR opened**: if a PR is waiting on this one, kick its workspace off now
  (Step 1) with this PR's branch as its base.
- **Fix pushed**: if any PR builds on this one, restack (Step 3).
- **PR opened**: under hold, relay the user's go to the worker when it comes.
- **Question or blocked**: answer from the plan and the other PRs' state by
  replying to that worker's session with
  `conductor message create --session <workerSessionId>`. Escalate to the
  user only when the decision is theirs, and relay the answer back yourself.
- **Merged**: if any PR builds on this one, restack (Step 3), which also
  retargets the PR above to `main`. Archive the merged PR's workspace:

  ```sh
  conductor workspace archive <workspaceId>
  ```

If a worker has gone silent for longer than the work plausibly takes, send it
one message asking for status. Only then, if it still does not answer, read
its transcript with `conductor session message <sessionId>`.

## Step 3: Restack

Run one restack at a time per stack. Tell every worker in the stack, and in
each branch-off stack based on it, that a restack is pending, and wait for
each to reply "holding". Then create a short-lived workspace on the stack's
top branch (the Step 1 command, named "Restack <stack title>") whose brief
names the trunk (`main`, or the parent PR's branch for a branch-off stack
whose parent has not merged), every unmerged branch bottom to top, and, after
a merge, the PR to retarget with `gh pr edit <number> --base main`. It first
creates a local branch for each at its remote tip (`git branch <branch>
origin/<branch>`), since the workspace starts with only the top one, then
adopts them with `gh stack init --base <trunk> <branch> ...` and restacks
them in one pass: `gh stack sync` (fetch, cascading rebase, atomic push, and
relink) when nothing conflicts. When `gh stack sync` reports a conflict, it
restores every branch; the workspace then runs `gh stack rebase`, resolves
each conflict and runs `gh stack rebase --continue` (or `--abort` to give
up), and after a successful rebase runs `gh stack push`, which pushes each
branch with `--force-with-lease`. Without the extension, the fallback is to
note the cutoff, which is the old trunk tip (`git rev-parse origin/<trunk>`)
or, after a merge, the merged PR's last head (`gh pr view <number> --json
headRefOid`), then `git fetch` and run `git rebase --update-refs --onto
origin/<trunk> <cutoff>` from the top branch, so neither a rewritten trunk's
old commits nor a squash-merged PR's commits are replayed; on a conflict,
resolve and stage it, then `git rebase --continue` (or `--abort`), and only
after the rebase succeeds push every branch with `--force-with-lease`. It
restacks each branch-off stack the same way onto its parent's new head (or
onto `main`, past the parent's last head, once the parent has merged), asks
you when a conflict needs a judgment call, and reports when done. Then
archive it and tell every held worker to reset and resume.

## Step 4: Finish

When every PR is merged and every workspace is archived, report to the user:
the merged PRs with links, anything that was cut or changed from the plan,
and any follow-ups the workers surfaced. If the rollout came from a Linear
issue, update the issue with the merged PRs.

## Rules

- Never do the PR's implementation work in this workspace.
- Use deep links, not ids, when pointing the user at a workspace or PR.
- One PR per workspace. Do not reuse a worker for a second PR.
- A PR that builds on another gets its workspace only after that PR is open.
- Workers never restack; a restack runs only in a restack workspace, while
  every affected worker holds.
- Do not archive a workspace while its PR is unmerged.
