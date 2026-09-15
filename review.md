Please cross-review this branch before its PR opens. Run `git diff origin/main...HEAD` and review the whole diff.

Context: this is PR 4 of a series bringing sub-agents ("children") to Luke's hosted brain. A child is a `conversations` row of kind `child` under the conversation that delegated it, run in an eve session of its own. This PR adds `apps/web/server/hosted/brain-host/child-opener.ts` (`openChild`), two store writes in `apps/web/server/hosted/store/children.ts`, migration `0035` (nullable `expects_completion` on `conversations`, default true), and a test file. Nothing outside the tests calls `openChild` yet; spawn limits are the next PR's and completion delivery the one after. The scheduled opener in `opener.ts` is the model for how the deployment opens a turn for an account.

Read `CLAUDE.md` first (it is the repository's agent guide) and hold the diff to it: Effect idioms (no runtime runs outside listed edges, Schema at boundaries, no discarded Effects), `as const` value sets rather than raw strings, no string-built keys, and never letting a secret into a trace, event, or fixture.

Review for: correctness bugs (including races between the insert, eve's session start hook claiming `runtime_session_id`, and the delete on refusal), violations of `CLAUDE.md`'s rules, missing tests, and anything overengineered or beyond the task.

Reply with a numbered list of findings, each with `file:line` and a severity (high / medium / low), or exactly "No findings".
