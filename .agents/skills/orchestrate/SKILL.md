---
name: orchestrate
description: Roll out a plan or Linear issue as a set of PRs by acting as an orchestrator. Kicks each PR off in its own Conductor workspace on the user's chosen model and effort, uses GitHub stacked PRs where PRs depend on one another, has each workspace babysit and merge its own PR, monitors the workspaces through messages rather than polling, and archives each workspace once its PR is merged. Use when the user says "orchestrate", "roll out this plan", or asks you to farm a plan or issue out to workspaces instead of doing the work here.
---

# Orchestrate

You do no implementation work in this workspace. You are the orchestrator: the
plan or Linear issue already names the PRs and which depend on which; you kick
each one off in a new Conductor workspace and manage the rollout to merge.

Arguments: `$ARGUMENTS` is the plan (a file path, a Linear issue key such as
`LUKE-159`, or inline text), optionally followed by the model and effort the
user wants the workers on. Pull an issue with the Linear tools; read a plan
file with `cat`. If the user did not name a model and effort, ask once with
`AskUserQuestion`; check `conductor model` for the valid ids for the chosen
agent rather than guessing.

Read the dependency order off the plan: independent PRs run in parallel from
`main`; dependent PRs form a GitHub stack, each branched from the PR below it
and linked with `gh stack link`.

## Step 1: Kick off each workspace

Record your own session id first; workers report back to it:

```sh
echo "$CONDUCTOR_SESSION_ID"
```

Create one workspace per PR, but only for PRs whose dependencies are met.
Kick off every independent PR now with `--branch main`. Do not kick off a PR
that depends on another until the PR below it has been opened and its branch
is pushed; a workspace started earlier would branch from `main` and have
nothing to build on. When the lower worker reports its PR is open, create the
dependent workspace with that PR's branch as `--branch`. `workspace create`
defaults to this workspace's project.

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
   text it comes from. Say plainly what is out of scope.
2. **Stacking**: the base branch and the full chain of branches below it,
   bottom to top, and the instruction to open the PR with
   `gh pr create --base <base-branch>` and then run
   `gh stack link <bottom-branch> ... <base-branch> <this-branch>` with the
   whole chain so GitHub records one stack however deep it goes. For an
   independent PR, the base is `main` and no link is needed.
3. **Babysit and merge**: watch CI and review comments, fix what fails, and
   merge the PR itself when checks are green, with no approval from the user.
   A stacked PR merges only after the PR below it has merged and this PR has
   been retargeted to `main` (`gh pr edit --base main`) and rebased.
4. **Report back, do not wait to be asked**: on each milestone (PR opened,
   CI green, blocked, merged) send a message to the orchestrator:

   ```sh
   conductor message create --session <ORCHESTRATOR_SESSION_ID> \
     --message "<PR title>: <status>. PR: <url>. <what happened / what is blocking>"
   ```

   Also tell it to answer any message the orchestrator sends it.
5. **Ask, do not guess**: when the task is ambiguous, the plan and the code
   disagree, or a choice would change the PR's shape, send the question to the
   orchestrator the same way and wait for the answer instead of picking an
   interpretation. The orchestrator holds the whole plan and the user's
   intent; the worker holds one PR. Small judgment calls stay with the
   worker.

Keep the workspace id, session id, branch, and PR url of each worker; you
need them to reply, to kick off dependents, and to archive.

## Step 2: Monitor by messages, not polling

Do not poll `session status` or `session message` in a loop. Workers message
this session when something happens, and each message arrives as a new user
turn. On each report:

- **PR opened**: if a stacked PR is waiting on this branch, kick that
  workspace off now (Step 1) with this branch as its base.
- **Question or blocked**: answer from the plan and the other PRs' state by
  replying to that worker's session with
  `conductor message create --session <workerSessionId>`. Escalate to the
  user only when the decision is theirs, and relay the answer back yourself.
- **Merged**: tell the next PR in the stack to retarget to `main`, rebase, and
  merge. Then archive the finished workspace:

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
- One PR per workspace. Do not reuse a worker for a second PR.
- A dependent PR's workspace is created only after the PR it depends on is
  open.
- Do not archive a workspace whose PR is not merged.
