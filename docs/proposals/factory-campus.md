# Proposal: Factory as a campus of buildings

Status: **Exploration, undecided.** This is one of four mockups for another
Factory view, made to be compared. It is a mockup, not a feature: nothing in
the app changes. There is no schema, database, backend or stored layout, and
the old Factory's Talk → Build → Ship stations are not used.

The design show is `docs/proposals/factory-campus/index.html`. It is one
self-contained file that fetches nothing. Open it in a browser. It copies the
window's tokens and lucide's glyphs, so the shell, pane, rows and buttons
match the app. The campus is SVG drawn by the page's script.

## Third version: character first, cues quiet

V2 drew every cue at once on identical blocks. V3 goes back to the first
version's architecture:

- a tower and a hall;
- a warehouse;
- a sawtooth works with silos and a stack;
- a gabled workshop with a chimney;
- a block that can go up under a crane;
- a glass studio.

These sit with trees and lamplit roads, at night or by day. The work shows in
a few legible cues on that scene. Exact numbers wait in the inspector for a
click, or for Luke to walk up.

## The data it draws, and nothing more

- **The plan list's `TaskSummary`:** name, repository, `createdAt`, and the
  agents' summary:
  - `total` and `working` counts;
  - at most three named agents, each with model, effort, status and `at`;
  - `pullRequestTotal`;
  - at most three named pull requests, each with number, title, state,
    one-word checks, additions and deletions.
- **The Inbox's open items:** agent, title, `postedAt` and options.
- **`callTaskId`.**

The sample is the shared comparison work, with the same seven tasks. The
illustrative details the gate needs are:

- **Search ranking's** pull request has failing checks.
- **Invite your teammates'** pull request has checks running.
- **Fix reconnect handling's** pull request is ready.
- **Keyboard shortcuts** has no pull request yet.
- **Faster workspace switching** has five agents (three named) and four pull
  requests (three named).

## What each thing means

| On the campus | Read from | Kind |
| --- | --- | --- |
| A building | one listed task | data |
| Which plot, and so which silhouette | the task's place in `createdAt` order on a fixed master plan | derived each draw, never stored. The silhouette is art direction and means nothing. |
| Lit windows | blue: an agent running; orange: an open Inbox item; red: a failed agent; green: this Mac's call; a few soft lights: nothing happening | data |
| Smoke from a stack | an agent running | data |
| A beacon | an open Inbox item | data |
| Rings | `callTaskId` | data |
| A crane and scaffolding | an agent running and `pullRequestTotal` = 0 | derived |
| A purple flag on a roof | every named pull request merged | derived |
| A crate | one named pull request. **Volume** is additions + deletions on one shared scale, so an edge grows with ∛lines. The key labels this as not linear. Green and red are the shares, split across its width. | data |
| A dashed "?" crate at a door | `pullRequestTotal` minus the named ones: unknown, not zero, counted in no total | data |
| The merge gate's yard | open pull requests in three lanes by `checks` (failing, running, ready nearest the gate), each lane lit at its head, placed by PR number | data. It is not GitHub's merge queue and implies no order. |
| The gatehouse and its lowered barrier | merging happens on GitHub; there is no merge action | relationship |
| The shipped lot past the gate | merged pull requests the summaries name | data, labelled as a sample, not all-time |
| A dashed route from a task to its crates, while either is pointed at or open | which task the pull request belongs to | relationship |
| Inside a building, with the roof off | a desk per agent in `agents.total`, with no cap; dashed figures for agents not named | data |
| Trees, lamps, roads, plaza | nothing | scenery |

Exact numbers appear only on hover or selection:
- `+a −d`, lines, checks and task in a crate's card;
- the split bar and numbers in the inspector;
- the gate's lanes;
- the shipped total, `+517 −243` for four PRs.

The toolbar names its two kinds of waiting separately ("1 question · 1 ready
to merge"), and the Inbox badge counts Inbox items only.

## Luke, walking

A small Luke stands on the campus. He is a UI affordance, not work data.

- **Taking the keyboard:** a click on the campus, or Tab to it, gives it the
  keyboard. The hint at the bottom says so.
- **Walking:** the arrow keys walk him, relative to the screen, in every turned
  view. He keeps within the campus and the shipped lot, and goes around
  buildings, crates, trees, the gatehouse and the barrier.
- **Walking up to something** opens the same inspector a click does, with no
  camera jump:
  - stepping onto a plot opens that task, and its roof lifts;
  - stepping up to a crate opens its task with that PR marked;
  - stepping into the gate's yard opens the gate;
  - stepping into the lot opens Shipped.

  Walking off closes what walking opened. A click selection stays until
  another object is reached or Escape closes it. Each arrival is announced
  once to screen readers; steps are not.
- **Wandering:** left alone for about 2.6 seconds, he wanders the roads. He
  never opens, closes or changes anything, and a key press takes over at once.
- **When walking stops:** the keys only walk while the campus holds focus, not
  on the map's controls, the pane or anything else. Tab always leaves. Held
  keys stop on blur, on a move to a control, and when the page is hidden.
- **Reduced motion:** wandering is off; walking still works.
- **Nothing is kept:** his position and the camera are the window's alone.

## Limitations

- **Only named PRs are placed.** At most three agents and three pull requests
  per task are named, so the lanes and the lot cover only named ones. The rest
  show as dashed figures and crates.
- **Some PR states have no spot.** Draft, closed and no-checks pull requests
  would show only in the inspector. The sample has none.
- **The master plan has eight plots.** More tasks need a rule for growing it.
- **Labels can crowd in turned views.** They're placed for the default view.
- **Shared space.** The studio and the block's crane stand close to the gate.
