# Your assignment

You are implementing ONE pull request of the LUKE-95 storage rework. An orchestrator session
coordinates the rework; you own exactly the PR described under "Your PR" and nothing else.
Do not implement other PRs' scope even when convenient; leave a TODO-free, working tree.

## Non-negotiables

1. Read `CLAUDE.md` at the repo root and every `AGENTS.md` in the subtrees you touch before
   writing code. They are binding (acyclic package graph, `.js` relative imports, wire schemas
   declared once in `@sidecar/wire`, tests assert values and structure never prose, `as const`
   value sets, no narrating comments, docs move with behaviour, Conventional Commits). Where
   CLAUDE.md describes storage the plan replaces (the journal, cursors, generations, encrypted
   payloads, the two conversation tables), the plan wins; note the sentence you contradicted
   in the PR body so PR G5 rewrites it.
2. Read the plan first: `git fetch origin orchestration/storage-plan` then
   `git show origin/orchestration/storage-plan:plan/storage-plan.md` and
   `git show origin/orchestration/storage-plan:plan/tickets.md`. Your ticket's text is in
   "Your PR" below and on the Linear issue.
3. Where the plan names a library, use it as it ships: AI SDK `UIMessage`,
   `validateUIMessages`, `convertToModelMessages`, `tool()` with Zod; Drizzle for Postgres;
   PGlite for store tests. Read the current docs (`ai-sdk.dev`) rather than memory.
4. Branch from the base named under "Your PR" (default `origin/main`). Use the exact branch
   name given. If stacked, open the PR against the base branch and retarget to `main` when
   the base merges (`gh pr edit --base main`); keep rebased with
   `git rebase` + `git push --force-with-lease`, never merge commits from main.
5. One logical change, small. PR title exactly as given (`type(LUKE-nnn): description`).
   PR body: what and why, how it follows the plan, what CLAUDE.md sentence it contradicts if
   any, how to verify, test results. End the body with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
6. Before pushing: `./scripts/check.sh` must pass. If the PR touches macOS or UI code,
   `./scripts/verify.sh` is the completion invariant where it can run; if it cannot run in
   your environment, say so explicitly in the PR body and describe what you inspected.
7. After implementation, run two reviews on your own diff and fix what they find before
   requesting merge: Cursor's "thermonuclear code review" skill and Cursor's "ponytail
   review" skill. Neither is installed; look each up online (GitHub, cursor.directory), read
   its instructions, apply them as written. If one truly cannot be found, do the most rigorous
   adversarial review you can under that name and say so in the PR body.
8. Babysit the PR to merge: `gh pr checks --watch`, fix failures, address review comments,
   keep rebased. Merge it yourself when green (`gh pr merge --squash --auto`, or the merge
   queue if the repo uses one). No human approval is required. Do not stop until merged or
   genuinely blocked.
9. Report to the orchestrator at these moments with
   `conductor message create --session <ORCHESTRATOR_SESSION_ID> --message "<PR-ID>: <status>"`:
   (a) branch pushed and PR open (URL and branch), (b) blocked or needing a decision (say
   exactly what), (c) merged (merge commit SHA), (d) anything you discovered that changes a
   later PR's plan. A few lines each. No routine progress otherwise.
10. Never touch the voice path (`packages/realtime`, `packages/live`, `packages/voice`,
    `apps/desktop/src/renderer/voice/`, `apps/voice-service`) unless your PR is C8. Charles's
    GPT-Live rollout owns it.
