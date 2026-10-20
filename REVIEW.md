# Review Guidelines

Report real defects only. Every finding costs a push, a CI run, and another
review round, so leave out anything that does not change what the code does.

## Report

- Bugs: wrong behaviour, crashes, and broken error handling.
- Data loss or corruption.
- Races and ordering bugs.
- Security, including auth, sessions, and token or credential handling.

## Do not report

- Style, naming, comment wording, or formatting.
- Test style: call-count assertions, test structure, or a missing test.
- The conventions in `AGENTS.md` and `docs/STYLE.md`, such as Effect idioms
  (`Schedule` over a loop), `as const`, design tokens, file order, and comment
  length. Lint and CI hold what they can, and the rest isn't worth a review
  round.
- A missing edge case, unless it is reachable in normal use.

## Ignore

These files are generated or fixtures; skip them:

- `vercel.json` rewrites
- `apps/web/server/api-rewrites.json`
- `packages/*/fixtures/**`
- `packages/database/migrations/**/snapshot.json`
- `CHANGELOG.md`
- `pnpm-lock.yaml`
