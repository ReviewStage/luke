# Agent guide

Luke is a macOS-first Electron sidecar that observes coding-agent sessions while
preserving existing provider workflows. Product naming belongs at the app and
packaging boundary; keep reusable implementation types brand-neutral.
Deployable products belong in `apps/`, and reusable packages belong in
`packages/`. Keep Electron main/preload code in `apps/desktop/` thin, keep the
renderer sandboxed, and put platform-independent behavior in
`packages/sidecar-core/`.

Canonical commands:

- `./scripts/bootstrap.sh` — install pinned workspace dependencies
- `./scripts/check.sh` — run portable repository, type, test, and build checks
- `./scripts/test-macos.sh` — package and validate the macOS app
- `./scripts/verify.sh` — complete macOS validation plus visual evidence
- `./scripts/run.sh` — launch the deterministic fixture app
- `./scripts/evidence.sh` — write the fixture PNG under `artifacts/`
- `pnpm evidence:record` — record the fixture transition on a physical Mac
- `pnpm lint:fix` — apply repository formatting and safe lint fixes

Trust constraints:

- Never write provider transcripts or session-state files.
- Never inject terminal input, simulate keystrokes, or request Accessibility.
- Product behavior must not require provider MCP, plugins, hooks, wrappers,
  credentials, or live sessions.
- Keep unsupported capabilities explicit; do not invent fallback controls.
- Keep Electron renderers sandboxed with context isolation and narrow IPC.
- Commit only synthetic, redacted fixtures and repository-relative paths.

Before handoff, run `./scripts/check.sh` for portable-only changes. For any
macOS or UI change, `./scripts/verify.sh` is the completion invariant. Report
exact results; UI changes also require inspection of the visual evidence and a
note stating whether a physical-notch check was performed. CI links generated
evidence from the pull request description. Attach physical-device screenshots
or recordings through GitHub's PR editor; do not commit generated evidence or
one-off QA worksheets. Keep generated state and private planning files
untracked.

Biome is the executable style policy for TypeScript, JavaScript, JSON,
Markdown, and CSS. Husky runs the same checks against staged files as a local
convenience; `./scripts/check.sh` and CI remain authoritative.

## Git workflow

- Follow the [Conventional Commits 1.0.0
  specification](https://www.conventionalcommits.org/en/v1.0.0/) for commit
  messages.
- Name pull requests using the `type[(optional scope)]: lowercase title` format,
  choosing the Conventional Commit type that matches the change, such as
  `feat`, `fix`, `docs`, or `chore`.
- When work has an associated Linear ticket, use Linear's suggested branch name
  when available and use the ticket ID as the pull request scope, for example
  `feat(LINEAR-TICKET-ID): lowercase title`.

## TypeScript value sets and keys

- Do not use stringly typed fixed value sets. Define `as const`
  SCREAMING_SNAKE_CASE objects, derive unions with
  `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the constants at call
  sites. Raw strings are only for freeform, user-facing text.
- Do not construct keys by concatenating or interpolating identifiers. Use
  nested objects or nested `Map` instances keyed by the original identifiers.
