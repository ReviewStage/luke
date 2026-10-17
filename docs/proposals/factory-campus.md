# Proposal: Factory as a campus of buildings

Status: **Exploration; Windows and Containers chosen.** This is one of four mockups for another
Factory view, made to be compared. It is a mockup, not a feature: nothing in
the app changes. There is no schema, database, backend or stored layout, and
the old Factory's Talk → Build → Ship stations are not used.

The design show is `docs/proposals/factory-campus/index.html`. It is one
self-contained file that fetches nothing. Open it in a browser. It copies the
window's tokens and lucide's glyphs, so the shell, pane, rows and buttons
match the app. The campus is SVG drawn by the page's script.

## Third version: character first, cues quiet

V2 drew every cue at once on identical blocks. V3 went back to the first
version's architecture:

- a tower and a hall;
- a warehouse;
- a sawtooth works with silos and a stack;
- a gabled workshop with a chimney;
- a block that can go up under a crane;
- a glass studio.

These sit with trees and lamplit roads, at night or by day. The work shows in
a few legible cues on that scene. Exact numbers wait in the inspector for a
click.

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
- **Opening a task** also reads the task's whole agent list (the per-plan
  agent list, `GET` a plan's agents) and each agent's published pull request.

### What "summary" means

The Factory, like the sidebar, reads the plan list. Each row of it is a
`TaskSummary`, and its `agents` field is a *bounded* summary
(`TASK_AGENTS_BOUNDS` in `task-wire.ts`, cut in the service's
`task-agents.ts`): counts of every agent and of those working, but only three
agents in full (working first, then newest) and only three pull requests
(newest first). Anything past three stands only as a count. The overview draws
from that row, so a task with five agents shows all five in its window light
and counts but only three by name, and a fourth pull request shows as a dashed
container at the task's door. Opening the task reads the whole lists, so the
interior and the pane show everyone. In the page, `summarize()` derives the row
from the whole lists exactly so.

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
| Lit windows and smoke | blue: an agent running; orange: an open Inbox item; red: a failed agent; green: this Mac's call; a few soft lights: nothing happening; smoke: an agent running | data |
| A beacon | an open Inbox item | data |
| Rings | `callTaskId` | data |
| A crane and scaffolding | an agent running and `pullRequestTotal` = 0 | derived |
| A purple flag on a roof | every named pull request merged | derived |
| A container | one named pull request; length is additions + deletions (linear, one tile per 150), the band its additions' and deletions' shares | data |
| A dashed container at a door | `pullRequestTotal` minus the named ones: unknown, not zero, counted in no total | data |
| The merge gate's yard | open pull requests in three lanes by `checks` (failing, running, ready nearest the gate), each lane lit at its head, placed by PR number | data. It is not GitHub's merge queue and implies no order. |
| The gatehouse and its lowered barrier | merging happens on GitHub; there is no merge action | relationship |
| The shipped lot past the gate | merged pull requests the summaries name | data, labelled as a sample, not all-time |
| A dashed route from a task to its containers, while either is pointed at or open | which task the pull request belongs to | relationship |
| Inside a building, with the roof off | a desk per agent in `agents.total`, with no cap; dashed figures for agents not named | data |
| Trees, lamps, roads, plaza | nothing | scenery |

Exact numbers appear only on hover or selection:
- `+a −d`, lines, checks and task in a crate's card;
- the split bar and numbers in the inspector;
- the gate's lanes;
- the shipped total, `+517 −243` for four PRs.

The toolbar names its two kinds of waiting separately ("1 question · 1 ready
to merge"), and the Inbox badge counts Inbox items only.

## A town that grows and shrinks

The header's Tasks switch shows the town with 3, 7, 16 or 30 tasks (the larger
ones add seeded, made-up tasks). Plots are filled in start order, oldest at
the back. The first eight are the hand-made master plan; past them the town
adds a street and a row of four plots at a time, two either side of the
avenue, each taking one of the smaller buildings in turn. The ground ends one
plot past the newest task (where "+ New task" waits), so a small town is short
and a big one long, and nothing about the layout is stored. Trees and lamps
stand only where plots don't. The gate's lanes and the shipped lot stack their
containers in layers once a row is full. In a town past twelve tasks, only
buildings where something is happening keep a name label; the rest answer a
hover.

## Inside a building

Opening a task lifts its roof onto one of two interiors, switched in the
header. Both draw the task's whole agent list, with no cap.

- **Desks:** a desk per agent with a screen that says how it stands (lines
  scrolling while it runs, "!" when it failed, a tick when its turn ended), a
  "?" over one with an open question, and the task's pull requests pinned to
  the back wall in their checks' colours. Only agents still at it are named
  over their desks.
- **Line:** an assembly line through the hall, a station per agent with a
  lamp in its state's colour and a belt that moves while that agent runs. The
  task's open pull requests wait packed at the end of the line, by the door
  they leave through for the gate.

## The chosen styles

Agents are drawn as **Windows**: lit by what the task's agents are doing, with
smoke while one runs. Opening a building shows a desk per agent. Pull requests
are drawn as **Containers**: a steel container per pull request whose length
is lines changed (linear, one tile per 150). The diff is a painted band along
its side. The other styles from the comparison round are gone.

## Simulated events

The page plays a fixed script of events over the sample work, then replays it.
The header has Pause, Play and Restart, and `?events=off` starts it paused.
Nothing in it is real. Each event changes the illustrative data as the window
would hear it, and the campus, the sidebar, the pane and a passing notice all
follow:

- **Agents:** Sonnet starts on Keyboard shortcuts. Sonnet's turn ends on
  Improve search ranking. Opus is archived on Fix reconnect handling, which
  leaves the task's count. Opus starts on a new task.
- **Checks:** checks run again on #3088, then pass. A forklift moves its
  container between lanes.
- **Merges:** #3081 and then #3088 merge. A truck carries each container out of
  its lane, the barrier lifts, and sparks go up as it reaches the shipped lot.
- **A new task**, Dark mode toggle, rises on the last plot. It goes up under a
  crane until its first pull request opens.
- **A question:** Opus asks about Keyboard shortcuts, and the beacon comes on.

Reduced motion still applies the events; the forklift and truck jump straight
to their places.

## Fun, without overdoing it

Added this round, each tied to an event:

- the truck through the gate on a merge;
- the forklift on a checks change;
- sparks at the shipped lot;
- a building rising for a new task;
- a ring spreading from a plot when something happens there.

Further ideas, not built:

- **Time of day:** follow the Mac's clock, so it's night after sunset.
- **Failing checks:** a short red flicker in the lane's lamp.
- **A quiet campus:** when nothing is running, the lamps dim one by one.

## Built from the app's own components

- **The pane** is the side panel: its bar, a tab named for what's open with a
  close button, `section-heading` titles ("Coding agents", "Pull requests"),
  and 30px rows.
- **Agents** are drawn with:
  - the Claude Code harness mark, or the working mark while the agent runs;
  - a model label ("Opus" with a "High" detail);
  - a red failed mark or an attention mark;
  - the short time ("4m").
- **Pull requests** use the published-row: the state's pull-request mark (red
  when checks fail), "#3081 · title", the Factory's words ("checks running",
  "ready to merge", "merged"), and `+84 −31`.
- **Questions** use the Inbox's byline, with an agent chip and "asked 4m", the
  question, and the option buttons.
- **Hover cards** follow `tooltip.tsx`. A card shows after a 500ms rest, at once
  for 500ms after the last one, and lingers 180ms after the pointer leaves.
  Every card has a head (glyph, name, sub-line, corner), a note, and a rule
  above its rows. The cards hang from buildings, containers, the yards,
  sidebar rows, pane rows, agent chips, and "2 need you".
- **Notices** are the window's passing notices: a stack of up to three in the
  corner, each with words and where.
- **Sidebar task rows** are the sidebar's plan rows: the name, the working
  mark or attention mark, and the time.
- **Scene labels** take a mention chip's corner and weight.

## Limitations

- **Only the summary's PRs are placed.** The overview reads the bounded row,
  so the lanes and the lot cover at most three pull requests a task. The rest
  show as dashed containers at their task's door until the task is opened.
- **Some PR states have no spot.** Draft, closed and no-checks pull requests
  would show only in the inspector. The sample has none.
- **A very large town gets long.** Thirty tasks already make the fitted view
  small; past that, the camera would need to start zoomed in on the newest
  rows, or quiet old tasks fold into a back lot.
- **Labels can crowd in turned views.** They're placed for the default view.
- **Shared space.** The studio and the block's crane stand close to the gate.
