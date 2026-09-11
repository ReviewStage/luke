## Summary

- <!-- What changed and why? -->

## Evidence

- Platform-independent checks: `not run`
- macOS Electron verification (`./scripts/verify.sh`): `not run`

<!-- automated-visual-evidence:start -->
### Automated visual evidence

CI will replace this block with a link to the deterministic macOS screenshots.
<!-- automated-visual-evidence:end -->

### Physical-device evidence

- Screenshot or screen recording: `not attached`
- Physical-notch check: `not performed`
- Device/display configuration: `not recorded`

## Invariants

Fill in every row. Rows marked CI are enforced by `scripts/repository-checks.sh`
or by tests; the rest are yours to state. A row that cannot be ticked without a
judgment call is a reason to stop and ask, not to tick it.

- [ ] `./scripts/check.sh` green; renderer/UI PRs also `./scripts/verify.sh` with evidence inspected. (CI)
- [ ] JSON Schema goldens unchanged (`LUKE_UPDATE_FIXTURES` not run, or diff explained line by line). (CI)
- [ ] Gateway envelope goldens unchanged. (CI)
- [ ] No new `as` type assertion outside the allowlisted files; `as Admitted` only in `admit.ts` and wire's admitted files. (CI via anti-slop + new grep)
- [ ] No `effect` import in an OpenClaw-ported file. (CI grep, added in P2-05)
- [ ] No `Effect.runPromise`/`runSync`/`runFork` outside the runtime edges listed in the ground rules. (CI once P12-09 lands; manual before)
- [ ] No new `setTimeout`/`setInterval`/`new Promise`/`AbortController` in a package already migrated. (CI once P12-09 lands; manual before)
- [ ] Test count equals the pre-PR count or the delta is listed. (manual: `vitest run --reporter=json`)
- [ ] Each hand-rolled file the PR replaces is deleted or marked `@deprecated` with its deletion PR named.
- [ ] Every `CLAUDE.md`/`AGENTS.md` sentence naming a changed part is edited; root pair stays byte-identical. (CI for pair existence; manual for wording)
- [ ] `PRIVACY.md` unchanged, or the change is a product decision called out in the PR body.
- [ ] Package `package.json` deps match what the sources import by bare specifier; `effect` via `catalog:`. (CI)
- [ ] Barrel/door rule: no Node-reaching Effect module (`@effect/platform-node`, `@effect/sql*`) behind a barrel the renderer or a web function opens. (CI: existing renderer `node:` grep plus a new grep for those specifiers in renderer bundles)

## Notes

- Blockers or follow-up verification: None
