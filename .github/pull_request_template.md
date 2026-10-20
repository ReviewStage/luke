## Summary

- <!-- What changed and why? -->

## Evidence

- Platform-independent checks: `not run`

## Invariants

Fill in every row. Rows marked CI are enforced by `scripts/repository-checks.sh`
or by tests; the rest are yours to state. A row that cannot be ticked without a
judgment call is a reason to stop and ask, not to tick it.

- [ ] `./scripts/check.sh` green. (CI)
- [ ] JSON Schema goldens unchanged (`LUKE_UPDATE_FIXTURES` not run, or diff explained line by line). (CI)
- [ ] Every behavior change has, in this PR, the test that fails without it; no change-detector test added. (manual; root `AGENTS.md` "Testing")
- [ ] Gateway envelope goldens unchanged. (CI)
- [ ] No new `as` type assertion outside the allowlisted files. (CI via anti-slop)
- [ ] No `Effect.runPromise`/`runSync`/`runFork` outside the runtime edges and the shims `tools/anti-slop/effect-edges.json` records. (CI via `anti-slop/no-run-promise-outside-edges`)
- [ ] No new `setTimeout`/`setInterval`/`new Promise`/`AbortController`/`fs.watch` outside the files `tools/anti-slop/effect-edges.json` records. (CI via `anti-slop/no-raw-async-primitives`)
- [ ] No Effect, Stream, or Layer written as a statement and dropped; a description a caller walks past runs nothing. (CI via `pnpm discarded-effect`)
- [ ] Test count equals the pre-PR count or the delta is listed. (manual: `vitest run --reporter=json`)
- [ ] Each hand-rolled file the PR replaces is deleted, or the part that remains is a permanent adaptor named in root `AGENTS.md`'s "The permanent adaptors" with the reason it stays.
- [ ] `PRIVACY.md` unchanged, or the change is a product decision called out in the PR body.
- [ ] Package `package.json` deps match what the sources import by bare specifier; `effect` via `catalog:`. (CI)
- [ ] Barrel/door rule: no Node-reaching Effect module (`@effect/platform-node`, `effect/sql`) behind a barrel the renderer or a web function opens. (CI: existing renderer `node:` grep plus a new grep for those specifiers in renderer bundles)

## Notes

- Blockers or follow-up verification: None
