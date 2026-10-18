# shots/ (throwaway)

Staging for the 0.12.0 changelog screenshots. Never committed: the patch is
applied on a Mac to the release commit, built, and run as

```
electron . --user-data-dir=$(mktemp -d) --fixture smoke --profile shot-<name>
```

Each `--profile shot-*` (see `RUN_PROFILE` in `packages/host/src/app-state.ts`)
stages one shot of `.context/shots/SPEC.md`. Only a fixture run stages one.

## How a shot is staged

- `shot-profiles.ts` maps each profile to its builder (one file per shot) and
  builds the spec once, lazily, so every reader gets the same objects.
- `shot-spec.ts` is the shape: the tasks view the Tasks tab draws, the side
  panel the task opens with, the call (A only), canned act answers, what main
  would say waits in the Inbox, Settings › Integrations' labels, the layout,
  and extra staging steps.
- `canned-acts.ts` is the act seam: `act.ts`'s one door asks it first. An
  answer is a function of the payload: a value (still checked by the kind's own
  guard), `NEVER` for a long-poll read held open, or `undefined` to let main
  answer (in a fixture run, main answers "unanswered").
- `use-shot-staging.ts` lays the window out once, step by step, as soon as each
  step's precondition is drawn: the sidebar fold, Settings' page, the version
  history, the task column's tab, side panel tabs (Changes, Page), a file tab,
  full screen, and ⌘K with its query typed.
- `account.ts` signs every shot in as Dean Stratakos with his photo
  (`dean-avatar.ts`, generated); `owner-pictures.ts` draws repository owner
  pictures as data URLs; `clock.ts` counts every timestamp back from launch;
  `fixture-rebase.ts` moves the tasks fixture's own timestamps for a shot
  that reuses it.
- `plan-document.ts` holds the shared world: the "Teammate invitations" plan
  written through every heading, its section bylines, its siblings across
  acme/relay, acme/ledger, acme/web, and the ids everything agrees on.
  `coding-agent.ts` holds the task's coding agents (a finished "Add teammate
  invitations" with PR #214, a running "Invite emails") and their answers.

Hooks into the app are marked `Throwaway:` in a comment: `act.ts`, `app.tsx`,
`update-row.ts`, `tasks/use-tasks-tab.ts`, `tasks/use-task-looks.ts`,
`desktop/task-summary.tsx`, `desktop/task-actions.tsx`, `tooltip.tsx`,
`desktop/command-palette.tsx`, `repository-picture.tsx`,
`settings/integrations-page.tsx`, `styles/index.css` (imports `shots.css`), and
`tasks/tasks-fixture.ts` (exports its views for reuse).

## Filling a stub (A `call.ts`, D `inbox.ts`, E `changes.ts`, F `skills.ts`, H `pages.ts`)

Each stub already stages its layout and says in its header what is left. Edit
only that file (and add files beside it) so shots can be filled in parallel:

1. Build the data with `ago()`/`hoursAgo()` times; reuse `shotTasksView`,
   `shotTask`, `SHOT_ID`, and `codingAgentAnswers()`.
2. Answer the acts the surface reads under `answers`, keyed by `ACT_KIND.*`.
   A loop that re-asks as soon as an answer lands gets its page once
   (`after === "0:0"`) and `NEVER` after.
3. Say the layout under `layout`; anything it cannot say goes in `steps`
   (`{ key, ready, run }`, each run once).

## Adding a shot

Add a `RUN_PROFILE.SHOT_*` entry, a `<shot>.ts` exporting a builder that
returns a `ShotSpec`, and one line in `shot-profiles.ts`'s `BUILDERS`.
