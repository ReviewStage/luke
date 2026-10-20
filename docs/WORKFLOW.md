# Workflow

1. Start from a scoped task, and confirm its non-goals and trust constraints
   before editing.
2. Make the smallest change that does it, tested as root `AGENTS.md`'s
   "Testing" section says, with deterministic fixtures rather than personal data
   or live provider state.
3. Push and let CI, which runs every check, gate the PR; running the tests you
   touched or `pnpm check:affected` beforehand is optional, and
   `./scripts/check.sh` is the full local run. CI is Linux only: a green PR does
   not cover the Mac.
4. Open the PR ready for review and merge it as root `AGENTS.md`'s "Merging"
   says.

Stop and report a genuine blocker when the work needs access, credentials,
hardware, or a product decision you do not have.
