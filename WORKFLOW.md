# Workflow

The contract from a scoped issue to a merged pull request. `AGENTS.md` carries
the repository conventions this assumes.

## 1. Scope

Start from a scoped issue in an isolated workspace. Confirm non-goals and trust
constraints before editing.

## 2. Change

Bootstrap with `./scripts/bootstrap.sh`, then make the smallest change that
satisfies the issue. Use deterministic fixtures instead of personal data or live
provider state. Put regression coverage at the cheapest layer that would have
caught a behavior bug; use visual evidence for appearance-only changes.

## 3. Verify

Run the checks your change and your machine allow.

| Change                                       | Command                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| Portable code only                           | `./scripts/check.sh`                                       |
| macOS, Electron window, native adapter, microphone, or desktop UI | `./scripts/verify.sh`                 |
| Web UI                                       | `pnpm --filter @luke/web dev`, then inspect the page       |
| Desktop motion                               | `pnpm evidence:record` on a physical Mac                   |

`./scripts/verify.sh` packages the desktop app and writes PNGs to
`artifacts/evidence/`. Inspect every one of them; generating a screenshot is not
the same as looking at it.

A Linux cloud workspace cannot run `verify.sh`, `evidence.sh`, or
`evidence:record`. Run `./scripts/check.sh`, then say in the pull request that
desktop verification is pending the macOS CI job. Do not claim verification you
did not perform.

## 4. Review your own diff

Read the complete diff for secrets, machine-specific paths, generated files,
unsafe IPC, unsupported provider behavior, and accidental scope expansion.

## 5. Open the pull request

Fill in the template's Evidence section with the commands you ran and their
results. Then attach visual evidence:

- **Desktop UI** — CI packages the app on macOS, screenshots every scenario in
  `./scripts/evidence.sh`, and compares each with the same render on `main`. It
  embeds a before-and-after pair for the scenarios that differ and names the
  ones that did not. Inspect them once they appear and state whether a
  physical-notch check was performed.

  When no scenario differs, the screenshots cannot show your change and the
  gate fails. That is a gap in the evidence, not a formality: add a scenario
  that renders the surface you changed — `--view` opens a named panel view, and
  `--profile` and `--fixture` select the state it renders — or attach a
  screenshot of your own.
- **Web UI** — CI cannot screenshot the web app. Capture the page yourself,
  publish it with `node scripts/publish-pr-media.mjs <pr> <file>`, and embed the
  URLs it prints in the Evidence section.
- **Physical-device screenshots and recordings** — capture on a physical Mac and
  publish them the same way.

The `Visual evidence` check fails a pull request that changes a user-facing
surface without evidence that shows the change. Editing the description re-runs
it. When no image can apply, apply the `evidence-exempt` label and comment
saying why.

## 6. Keep the description true

When you push follow-up commits, re-read the description and update it if the
change made it inaccurate or incomplete. Keep the summary, scope, and Evidence
section matching the commands and results for the current head commit. Refresh
screenshots whose interface has changed and drop claims that no longer hold.
Leave the description alone when the new commits do not change what it says.

## Pull-request media

`scripts/publish-pr-media.mjs` writes to the shared `pr-assets` branch under
`pr-<number>/<commit>/` and prints raw URLs that render inline. Two properties
matter:

- Media never belongs on a product branch.
- `pr-assets` is the one durable media branch. Deleting it breaks images in open
  and historical pull requests. The per-commit path exists because GitHub caches
  image URLs, so a refreshed screenshot needs a new path to be visible.

## Blockers

Stop and report a genuine blocker when validation requires unavailable access,
credentials, hardware, or a product decision. Agents prepare evidence and
recommendations; humans own final review, merge, release signing, and
notarization decisions.
