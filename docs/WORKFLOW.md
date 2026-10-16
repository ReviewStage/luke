# Workflow

1. Start from a scoped issue and an isolated workspace. Confirm non-goals and
   trust constraints before editing.
2. Bootstrap with `./scripts/bootstrap.sh`, then make the smallest change that
   satisfies the issue. Use deterministic fixtures instead of personal data or
   live provider state. Choose the test's size, its doubles, and its
   fixtures by root `AGENTS.md`'s "Testing" section.
3. Run `pnpm check:affected` for portable-only work, then push and let CI, which
   runs every check, gate the PR; `./scripts/check.sh` is the full local run,
   for a release, a broad refactor, or on request. For a web UI change, run
   `pnpm --filter @luke/web dev` and inspect the page in a browser. For a
   hosted-service change the Mac talks to, run `./scripts/run.sh --preview`
   against the PR's Vercel Preview before merging; a push that changes nothing
   the services build from (`scripts/vercel-ignore.sh --paths`) builds no
   Preview, and `run.sh --preview` finds the nearest one that did. CI's jobs are Linux only;
   the release rehearsal, `release.yml`'s `macos-15` job on a tag push, is the
   only Mac gate, so do not wait for a macOS check and do not read a green PR
   as covering the Mac.
4. Review the complete diff for secrets, machine-specific paths, generated
   files, unsafe IPC, unsupported provider behavior, and accidental scope
   expansion.
5. Open a focused PR and record commands and results in the template's Evidence
   section. A web UI change needs an inspected capture of the page served by
   `pnpm --filter @luke/web dev`, uploaded through GitHub's PR editor.
6. When pushing follow-up commits to an open PR, re-read the PR description and
   update it if the change made it inaccurate or incomplete. Keep the summary,
   scope, and Evidence section matching the commands and results for the current
   head commit; refresh screenshots whose UI has changed and drop claims that no
   longer hold. Leave the description alone when the new commits do not change
   what it says.
7. When an agent must add inline PR media without the GitHub editor, commit it
   to the shared `pr-assets` branch, not the product branch. Use a per-PR path
   such as `pr-<number>/landing-page.png`, then embed the raw GitHub URL in the
   PR description. Never make another branch for media, a `pr-assets-<topic>`
   included: one cut fresh lacks `pr-assets`'s `vercel.json`, so Vercel builds
   it, fails, and mails the failure on every push. Commit from a
   worktree of `origin/pr-assets`; when the push is refused because another
   workspace pushed first, fetch, rebase onto `origin/pr-assets`, and push
   again. Keep `pr-assets` as the one durable media branch: deleting it breaks
   PR images. Delete an old per-PR asset branch only after every PR URL that
   uses it has moved to `pr-assets`.

Stop and report a genuine blocker when validation requires unavailable access,
credentials, hardware, or a product decision. Agents prepare evidence and
recommendations; humans own final review, merge, release signing, and
notarization decisions.
