---
name: first-day-user
description: Play a brand-new Vespin user's first session against the real app, run locally in a Vespin agent's sandbox: the demo stack with the demo member reset to an account that has never signed in, driven in Playwright as a persona who explores every empty state and menu on the way from sign-in to a started task. Checks that a first workspace is made, keeps a diary with screenshots, and reports a ranked list of what was broken, wrong, or confusing. Use when asked for a first-day, first-run, or new-user test, or by an automation that runs one.
---

# First-day user

A first run is the path nothing else exercises: on Nov 4, 2026, thirteen
people signed up and none could start an agent, because since #3924 no new
account was given a workspace, and nobody saw it for fourteen days. This
skill stands up the real app with an account that has never signed in, and
plays that account's first session as a person would.

It runs in a Vespin agent's Linux sandbox. Budget about ten minutes to stand
the stack up and 20 to 30 to play.

## The persona

A software engineer at a small startup who uses Claude Code in a terminal
every day, installed Vespin today, and will decide by the end of the day
whether to keep it. They explore: they read every empty state, open each menu
once, and make mistakes on purpose (press Enter on an empty form, paste a bad
token, create something and try to take it back). Their goal is to get from
sign-in to a started task. They call it broken when they don't know what to
do next on a screen, when something gives no sign of progress, or when they
can't undo something.

## 1. Stand up the stack

```bash
./scripts/bootstrap.sh    # with PNPM_HOME and XDG_DATA_HOME under $TMPDIR, as below, if pnpm can't write its home
RUN=$TMPDIR/first-day-user
bash .agents/skills/first-day-user/scripts/stack.sh "$RUN"
```

Run `stack.sh` with Bash's `run_in_background` and leave it running until the
end. It starts the demo Postgres, seeds it, deletes the demo member's
memberships and personal workspace so the account looks new, serves the app
at `http://127.0.0.1:5173`, and starts a headless Chromium that takes steps
from a file queue. Wait for `[stack] ready` in its output (about 30 seconds
after a bootstrap). If pnpm itself fails on `/home/vercel-sandbox`, export
`PNPM_HOME=$TMPDIR/pnpm-home XDG_DATA_HOME=$TMPDIR/xdg-data` before the
bootstrap; `stack.sh` sets its own.

Each Bash command in the sandbox has its own network, so nothing outside
that process tree reaches the server: not `curl` from a later command, not
`node` with `pg`, and not your `browser` tool, which answers
`ERR_CONNECTION_REFUSED`. Drive the app through the queue instead:

```bash
bash .agents/skills/first-day-user/scripts/step.sh "$RUN" 01-sign-in <<'EOF'
await page.goto(origin + "/sign-in");
await page.waitForTimeout(5000);
await shot("01-sign-in");
return (await page.evaluate(() => document.body.innerText)).slice(0, 1500);
EOF
```

A step is the body of an async function given `page`, `context`, `shot(name,
options)` (a PNG under `$RUN/shots/`), `sql(text, params)` (the run's
database), `origin`, and `setPage(page)`. It answers JSON with what the body
returned, any error, the page's address, and the console errors it raised.
Give every step a new name. Look at each screenshot with Read; copy the ones
you report to `/tmp/shared/first-day-user/` so the developer can see them.

## 2. The first-run check

The first step signs in: visiting `/sign-in` mints a session for the demo
member (`apps/web/server/local-sign-in.ts`). Then confirm with `sql` that
exactly one `personal_workspace` row and one `member` row now stand for
`dean@example.com`, and that the page shows that workspace in the sidebar.
If there's no workspace, stop: that is the Nov 4 bug again, and it is the
whole report.

## 3. Play

Play the persona for 20 to 30 minutes, one step per action or two, a
screenshot each. Cover at least:

- Home: the composer, its repository picker, Runs on, model, the `+` menu,
  and Enter with nothing chosen.
- The sidebar's Inbox, Tasks, Automations, Search, and their empty states.
- The workspace switcher: make a second workspace, then try to remove it.
- Settings: Account, Agents (connect Claude), Integrations, Workspace
  (connect GitHub, Add repository), and a malformed GitHub token.
- Signing out and in again, and the `personal_workspace` count after it.

Keep a diary at `$RUN/diary.md`: for every issue, what you did, what you
expected, what happened, and the screenshot.

To see the screens a production account meets past what the local stack can
answer, fake the repository list in the browser rather than in the app:

```js
await context.route(/\/api\/github\/repositories(\?|$)/, (route) => route.fulfill({
  status: 200, contentType: "application/json",
  body: JSON.stringify({ installed: false, repositories: [], installationUrl: "https://github.com/apps/vespin/installations/new" }),
}));
```

`installed: false` shows the Connect GitHub card a new account sees; one
repository with `installed: true` (`{ owner, name, fullName, defaultBranch,
private, updatedAt, access: "app" }`) lets Start be pressed.

## What the local stack cannot do

Leave these out of the findings; they are the stack's, not the product's.

- No GitHub App: the repository picker reads "The service did not answer",
  GitHub Connect reads "Could not connect GitHub to that workspace on this
  system", and Start with a faked repository is refused with "Vespin cannot
  see that repository on GitHub". A run ends there: no task is created, so no
  agent starts.
- No model catalog (no outbound network): the model menu reads "The models
  could not be read".
- No live socket (`/api/live/socket` answers 404 by design): the bottom-left
  offline mark and "You're offline." stay up. `driver.cjs` answers the long
  polls from Node so pages still load.
- No Vercel Sandbox: the server logs warnings about listing sandboxes.
- The seeded account keeps its preferences (Follow-up behavior reads
  Modified) and its seeded host and credentials, if any.
- Vite's HMR socket errors in the console.

## 4. Report

Post one thread to the developer with:

- Whether the first-run check passed.
- The ranked issues, broken first, then wrong, then confusing, each with its
  screenshot and the step that found it.
- Where the run stopped and why.
- Tools that were missing or awkward.

Then stop the driver with `touch "$RUN/queue/in/quit.js"` and wait for
`[stack] stopped`, which puts back the tsx shims in
`node_modules/.bin`. Commit nothing from the run.
