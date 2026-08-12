# Agent guide

Luke is a macOS-first Electron sidecar that observes coding-agent sessions while
preserving existing provider workflows. Product naming belongs at the app and
packaging boundary; keep reusable implementation types brand-neutral.
Deployable products belong in `apps/`, and reusable packages belong in
`packages/`. Keep Electron main/preload code in `apps/desktop/` thin, keep the
renderer sandboxed, and put platform-independent behavior in
`packages/sidecar-core/`.

## Read this before opening a pull request

`WORKFLOW.md` is the issue-to-pull-request contract. Read it in full before you
open or update a pull request; the rules below are the ones that fail CI.

- Every user-interface change ships with a screenshot in the pull-request
  description. CI screenshots the desktop app for you and embeds the images.
  For a web change, capture and attach the page yourself.
- CI compares each screenshot with the same render on `main` and embeds a
  before-and-after pair for every scenario that differs. A change no scenario
  shows is not evidenced: add a scenario to `./scripts/evidence.sh` that renders
  the affected surface, or attach a screenshot of your own.
- Publish your own images with `node scripts/publish-pr-media.mjs <pr> <file>`
  and embed the URLs it prints. Never commit generated evidence to a product
  branch, and never assume you can use GitHub's web editor.
- The `Visual evidence` check enforces this. If it fails, the fix is to attach
  the missing image, not to explain its absence. Editing the description re-runs
  the check.

## Where your workspace can run

Check `uname -s` before promising evidence.

- On macOS, `./scripts/verify.sh` runs the whole contract, screenshots
  included.
- In a Linux cloud workspace, `./scripts/check.sh` is everything you can run.
  Say so plainly: report that desktop verification is pending CI, and let the
  macOS CI job produce the screenshots. Do not describe a desktop change as
  verified when no packaged app ever ran.
- A physical-notch check and `pnpm evidence:record` need a physical Mac. Neither
  CI nor a cloud workspace can perform them; report them as not performed.

## Canonical commands

- `./scripts/bootstrap.sh` — install pinned workspace dependencies
- `./scripts/check.sh` — run portable repository, type, test, and build checks
- `./scripts/test-macos.sh` — package and validate the macOS app
- `./scripts/verify.sh` — complete macOS validation plus visual evidence
- `./scripts/run.sh` — launch the app against live sessions, replacing any
  running instance (`--fixture smoke` for fixture data, `--keep-running` to keep
  the running instance)
- `./scripts/evidence.sh` — write the expanded, settings, compact, and speaking
  fixture PNGs under `artifacts/evidence/`
- `pnpm evidence:record` — record the fixture transition on a physical Mac
- `node scripts/publish-pr-media.mjs <pr> <file>...` — publish pull-request
  images and print their URLs
- `pnpm lint:fix` — apply repository formatting and safe lint fixes

## Trust constraints

- Never write provider transcripts or session-state files.
- Never inject terminal input, simulate keystrokes, or request Accessibility.
- Product behavior must not require provider MCP, plugins, hooks, wrappers,
  credentials, or live sessions. A provider whose sessions exist only in a cloud
  service may read a user-supplied API key, but it must observe nothing until
  the user supplies one, must never write through that credential, and must
  leave every other provider working without it.
- Keep unsupported capabilities explicit; do not invent fallback controls.
- Keep Electron renderers sandboxed with context isolation and narrow IPC.
- Commit only synthetic, redacted fixtures and repository-relative paths.
- Keep generated evidence, generated state, and private planning files
  untracked.

Biome is the executable style policy for TypeScript, JavaScript, JSON,
Markdown, and CSS. Husky runs the same checks against staged files as a local
convenience; `./scripts/check.sh` and CI remain authoritative.

## Git workflow

- Follow [Conventional Commits
  1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages.
- Format PR titles as `type[(scope)]: description`, using the matching type
  (`feat`, `fix`, `docs`, `chore`, etc.).
- For Linear work, use its suggested branch name when available and the ticket
  ID as the scope: `feat(LUKE-123): add Codex support`.

## TypeScript value sets and keys

- Do not use stringly typed fixed value sets. Define `as const`
  SCREAMING_SNAKE_CASE objects, derive unions with
  `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the constants at call
  sites. Raw strings are only for freeform, user-facing text.
- Do not construct keys by concatenating or interpolating identifiers. Use
  nested objects or nested `Map` instances keyed by the original identifiers.
