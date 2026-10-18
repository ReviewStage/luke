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

Main's Factory now reads a world snapshot for the workspace
(`factory-world-wire.ts`, read through `@luke/ui/factory-world`): every agent
with its status and its pull request, up to 100; the pull requests merged in
a window, with `mergedAt`, up to 200; Linear issues planned, up to 50; and the
repository's zones. The campus draws from that and from what the window
already held:

- **The plan list:** each task's name, repository and `createdAt`.
- **The world snapshot:**
  - every agent with its status and when it last moved;
  - its pull request, with state, one-word checks, additions and deletions;
  - the merged pull requests since `shippedSince`, with `mergedAt`;
  - the planned Linear issues, with key, title, workflow state and priority.
- **The Inbox's open items:** agent, title, `postedAt` and options.
- **`callTaskId`.**

So the plan list's bounded summary (three agents and three pull requests a
task, `TASK_AGENTS_BOUNDS`) no longer limits the scene: every agent's pull
request stands in the yard, and the dashed "not named" containers are gone.
The snapshot's own bounds (`FACTORY_WORLD_BOUNDS`) are what keep it finite.

The sample is the shared comparison work, with the same seven tasks. The
illustrative details the gate needs are:

- **Search ranking's** pull request has failing checks.
- **Invite your teammates'** pull request has checks running.
- **Fix reconnect handling's** pull request is ready.
- **Keyboard shortcuts** has no pull request yet.
- **Faster workspace switching** has five agents and four pull requests, one
  merged eight days ago, outside the shipped window.
- **Polish empty states** has a draft from three days ago, so it is stuck.
- **Three Linear issues** are planned: LUKE-214 Dark mode toggle, LUKE-221
  Faster cold start and LUKE-219 Offline drafts.

## What each thing means

| On the campus | Read from | Kind |
| --- | --- | --- |
| A district | one zone of the repository with something in it, or "Not in code yet" | data |
| Which district a building stands in | the task's primary zone | data |
| A pink outline and belts, while a task is open | the districts that depend on the task's zone, fainter by distance | derived |
| A building | one listed task | data |
| Which plot, and so which silhouette | the task's place in `createdAt` order | derived each draw, never stored. The silhouette is art direction and means nothing. |
| Lit windows and smoke | amber: an agent building; dim amber: stuck; red: a failed agent; orange: an open Inbox item; green: this Mac's call; a few soft lights: nothing happening; smoke: an agent running | data |
| A beacon | an open Inbox item | data |
| A pause sign | stuck: nobody at work, and a draft or an open pull request nobody moved for a day | derived |
| Rings | `callTaskId` | data |
| A crane and scaffolding | an agent running and no pull request yet | derived |
| A green flag on a roof | every pull request of the task merged | derived |
| A blueprint on a plot | a planned Linear issue with no task yet | data |
| A container | one open or merged pull request; length is additions + deletions (linear, one tile per 150), the band its additions' and deletions' shares | data |
| The merge gate's yard | open pull requests in three lanes by `checks` (failing, running, ready nearest the gate), each lane lit at its head, placed by PR number | data. It is not GitHub's merge queue and implies no order. |
| The gatehouse and its lowered barrier | merging happens on GitHub; there is no merge action here | relationship |
| The shipped lot past the gate | pull requests merged since `shippedSince`, newest first | data, labelled with its window |
| The pipeline bar | counts of planned issues, agents building, stuck tasks, merged pull requests in the window, and failed agents | data |
| A cyan outline | what is selected or pointed at | view state |
| A dashed route from a task to its containers, while either is pointed at or open | which task the pull request belongs to | relationship |
| Inside a building, with the roof off | an assembly line, a station per agent in the task's whole list | data |
| Trees, lamps, roads, plaza | nothing | scenery |

Exact numbers appear only on hover or selection:
- `+a −d`, lines, checks and task in a crate's card;
- the split bar and numbers in the inspector;
- the gate's lanes;
- the shipped total and its window.

The toolbar names its two kinds of waiting separately ("1 question · 1 ready
to merge"), and the Inbox badge counts Inbox items only.

## A town that grows and shrinks

The header's Tasks switch shows the town with 3, 7, 16, 30, 100 or 300 tasks
(the larger ones add seeded, made-up tasks). Plots are filled in start order,
oldest at the back. The first eight are the hand-made master plan. Past them
the town grows in pairs of plot columns with an avenue between each pair, and
in rows down the page, taking as many pairs as keep it about as deep as it is
wide, so a big town is a square rather than a long strip: 30 tasks make a town
about 43 × 39 tiles, 300 tasks about 108 × 110. The ground ends one plot past
the newest task (where "+ New task" waits), so a small town is short. Nothing
about the layout is stored; it is worked out from the task count on every
draw. Adding a pair of columns does reflow the newer plots, so a real view
would want to add columns rarely, or only when the Factory isn't open.

Trees and lamps stand only where plots don't. The gate's lanes and the shipped
lot stack their containers in layers once a row is full.

Names are placed most important first: the open task, then a question, a
failed agent, the call, an agent running. A name that would overlap one
already on screen is left off and answers a hover instead, and in a town past
twelve tasks a quiet building gets no name at all. Names are refitted when the
zoom settles.

## Districts: code areas with tasks inside

The default layout now draws the repository's zones (its packages and
directories, `zones` in the world snapshot) as districts, and each task's
building stands in the district of its primary zone: where its pull requests
changed the most lines, as main's `agent-reading.ts` finds it. A planned
issue's blueprint stands in the district it is placed on (`zonePaths`). Work
that has touched no code yet (a task on a call, a task with no pull request
anywhere, the empty plot, an issue placed nowhere) has a district of its own
near the gate, "Not in code yet". The header's Layout switch goes back to the
plain town.

- **A district is as big as what stands in it**, laid out as near square as
  its plots allow, and the districts are packed into a square below the gate.
  The streets are the gaps between them. Only districts with something in them
  are drawn. Nothing about the layout is stored.
- **A district's name** is painted on the street below its nearest corner, in
  the code font, so it never sits on a building.
- **Hovering a district** says what it depends on and how many districts
  depend on it.
- **The blast radius**, as main's worlds light it: opening a task outlines its
  district in `--signal-blast` pink, and every district that depends on it in
  dashed pink, fainter with each step, with a belt from one to the other. The
  pane names the district and how many depend on it.

The sample's eight zones are illustrative (desktop, web, `@luke/ui`,
`@luke/service`, `@luke/features`, `@luke/database`, `@luke/wire`,
`@luke/brand`), with dependencies as this repository's are roughly shaped.

### Does it cook the Mac?

No more than the town, and a little less in a big one. The districts add one
ground shape and one label each (eight here, at most 200 by the snapshot's
bound), and the blast radius is a separate small layer redrawn only when a
task opens. Same worst case as above, every agent running, each case on a
fresh page (headless Chromium, software rendering):

| Tasks | Town: elements / redraw / fps, fitted · zoomed | Districts: elements / redraw / fps, fitted · zoomed |
| --- | --- | --- |
| 7 | 800 / 8 ms / 61 · 60 | 776 / 11 ms / 61 · 61 |
| 30 | 2,369 / 19 ms / 60 · 61 | 1,397 / 16 ms / 61 · 61 |
| 300 | 12,153 / 137 ms / 50 · 47 | 10,923 / 76 ms / 51 · 55 |

Opening a task, blast radius included, takes 5 to 15 ms in either layout.
Switching sizes, opening and closing tasks, and zooming repeatedly on one page
left no animations, nodes or loops behind.

## What it takes from main's Factory

Main's Factory tab now draws the repository as a choice of Three.js worlds
(`apps/desktop/src/renderer/factory-world/`): its zones as buildings, its
agents as workers, shipped work as lamps and trucks, planned issues as
blueprints and defects as wreckage. The campus stays SVG, with tasks as its
buildings, and takes:

- **The signal palette** (`signal-palette.ts`), unchanged and the same in
  either appearance: planned `#5b6cf0`, building `#b87100`, shipped
  `#15924a`, defect `#dc3e42`, selection `#0891b2`. Lit windows are amber
  while an agent builds and red when one failed; flags and the shipped lot
  are green; what is selected is outlined cyan. A question keeps the app's
  attention orange and its beacon, which no world signal covers.
- **The pipeline bar** (`world-chrome.tsx`): Planned, Building, Stuck,
  Shipped and Defects, each a count and a switch that hides its layer.
- **The agent states** (`agent-reading.ts`): working, waiting, stuck, failed
  and idle. Stuck is new here: nobody at work, and a draft, or an open pull
  request nobody moved for a day. It shows as a pause sign on the roof and
  dim amber windows.
- **Shipped as a window.** The lot holds what merged since `shippedSince`
  (seven days here), newest first, and says so.
- **Planned issues as blueprints**, drawn in dashed planned-blue lines on the
  plots after the empty one. When a task starts on one, its blueprint goes and
  the task takes the next plot (the event script does this with LUKE-214).
- **Its performance rules:** draw only when something changed, rest while
  the page is hidden, and hold a still frame that says everything.

## Keeping it fast

What grows is the number of tasks and agents, not the size of the codebase:
the campus reads nothing of the code. The snapshot is bounded (100 agents, 200
shipped, 50 planned), the plan list leaves archived tasks out, and the
overview fetches nothing beyond what the window and the snapshot hold.

Measured in headless Chromium with software rendering (a Mac with a GPU does
better). The worst case: 300 tasks with every agent running, 505 at once.

| Tasks | Agents running | Elements | Full redraw | Frames a second | Worst frame |
| --- | --- | --- | --- | --- | --- |
| 7 | 2 | 828 | 10 ms | 60 | 17 ms |
| 30 | 43 | 2,414 | 26 ms | 60 | 17 ms |
| 300, fitted | 505 | 12,072 | 105 ms | 54 | 17 ms |
| 300, zoomed in | 505 | 8,781 | 90 ms | 53 | 17 ms |

Before this round's fixes, 300 tasks zoomed in with everything running ran at
7 frames a second. Probing one cost at a time found where it went:

- **A blur filter on every lit window.** With anything moving, the whole
  scene repainted every filter. Past twenty tasks a window now glows with a
  soft stroke instead, and nothing carries a filter.
- **Looping beacons and smoke.** The SVG is one paint layer, so one loop
  repaints every building. A big town draws a still frame, as main's worlds do
  under `still`: windows and signs say everything, nothing loops.
- **Cranes rewritten every frame.** Rewriting one restyles the scene; a small
  town turns at most four, a big town none.
- **The sidebar's working marks.** Three hundred animated marks cost a third
  of the frame on their own. Rows off the sidebar's screen now aren't
  rendered (`content-visibility: auto`). The app's own sidebar would gain from
  the same.

And from before:

- **Interiors only when opened.** Only the open building carries its
  interior, drawn the moment the roof lifts.
- **Level of detail.** When a tile is under 13 pixels across, windows become
  one band a face and shadows go.
- **Culling.** Zoomed in on a town past twenty tasks, only what is on screen
  and a margin round it is drawn.
- **The loop rests.** The animation loop runs only while a truck, forklift,
  sparks or a small town's crane moves, and stops while the page is hidden.

For a real view, beyond this:

- **Redraw what changed.** Each event here redraws the whole scene (about
  100 ms at 300 tasks, in software). The app would redraw only the buildings
  an event touched, keyed by task id.
- **A back lot.** Tasks with nothing open and nothing recent could fold into
  a compact back lot, so the town's size follows active work.
- **Canvas past the bounds.** Well past 300 tasks, a canvas with invisible
  hit targets for the keyboard would be the next step; main's worlds reach for
  WebGL there.

## Inside a building

Opening a task lifts its roof onto an assembly line through the hall: a
station per agent in the task's whole agent list, with no cap. Each station's
lamp is in its agent's state's colour and its belt moves while that agent
runs, and a "?" floats over one with an open question. Only stations whose
agent is still at it are named, so a full hall stays readable. The task's open
pull requests wait packed at the end of the line, by the door they leave
through for the gate.

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

- **One district a task.** A task whose pull requests touch several zones
  stands in the one with the most lines; main's worlds can show an agent's
  work spread across zones. There is no defect wreckage (main's monitor slot
  is empty for now in any case).
- **Many small districts.** A workspace whose tasks touch many zones gets many
  one-building districts; grouping small zones under their parent directory
  would be the next step.
- **Some PR states have no spot.** Draft and closed pull requests show only
  in the pane; a draft's task shows as stuck.
- **Adding a column reflows the newer plots.** A real view would add columns
  rarely, or only while the Factory isn't open.
- **Labels can crowd in turned views.** They're placed for the default view.
