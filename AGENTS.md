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
- `./scripts/run.sh` — launch the app against live sessions, replacing any
  running instance (`--fixture smoke` for fixture data, `--keep-running` to keep
  the running instance)
- `./scripts/evidence.sh` — write the fixture PNG under `artifacts/`
- `pnpm evidence:record` — record the fixture transition on a physical Mac
- `pnpm lint:fix` — apply repository formatting and safe lint fixes

Trust constraints:

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

- Follow [Conventional Commits
  1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages.
- Format PR titles as `type[(scope)]: description`, using the matching type
  (`feat`, `fix`, `docs`, `chore`, etc.).
- For Linear work, use its suggested branch name when available and the ticket
  ID as the scope: `feat(LUKE-123): add Codex support`.

## Panel motion

The window never animates its own frame: it snaps to the size a mode needs, and
the renderer animates the black surface inside it. An animated `setBounds`
re-lays out the whole renderer on every frame, because the panel is anchored to
the viewport's centre. Everything layered on that surface must move with
`transform` and `opacity` only — animating width, height, padding, or font-size
on the wings, the count badge, or the rows re-shapes text on every frame and is
what makes the transition stutter. `setWindowMode` owns the ordering for every
caller: grow the window before the panel unfolds, and draw the capsule before
the window shrinks to it. `COLLAPSE_ANIMATION_MS` is the sum of
`--duration-exit` and `--duration-collapse`; the three move together.

## TypeScript value sets and keys

- Do not use stringly typed fixed value sets. Define `as const`
  SCREAMING_SNAKE_CASE objects, derive unions with
  `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the constants at call
  sites. Raw strings are only for freeform, user-facing text.
- Do not construct keys by concatenating or interpolating identifiers. Use
  nested objects or nested `Map` instances keyed by the original identifiers.
