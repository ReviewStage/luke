# Proposal: Factory as a campus of buildings

Status: **Exploration, undecided.** This is one of four mockups for another
Factory view, made to be compared. It is a mockup, not a feature: nothing in
the app changes. There is no schema, database, backend or stored layout, and
the old Factory's Talk → Build → Ship stations are not used.

The design show is `docs/proposals/factory-campus/index.html`. It is one
self-contained file that fetches nothing. Open it in a browser. It copies the
window's tokens from `base.css`, `desktop.css` and the generated motion
tokens, and lucide's glyphs, so the sidebar, toolbar, inspector pane, rows and
buttons match the app. The campus itself is SVG drawn by the page's script.

## The data it draws, and nothing more

The sample is shaped as the fields the window already holds:

- **The plan list's `TaskSummary`:** its name, repository and `createdAt`, and
  its agents' summary. That summary holds `total` and `working` counts, at most
  three named agents (model, effort, status, `at`), `pullRequestTotal`, and at
  most three named pull requests (number, title, state, one-word checks,
  additions, deletions).
- **The Inbox's open items:** the agent that posted, the title, `postedAt`,
  and the choice options.
- **`callTaskId`:** the task on this Mac's call.

The sample is the shared comparison work, with the same tasks and states. The
details the new visuals need are illustrative additions:

- pull requests on the two working tasks, so the gate shows checks failing
  and checks running;
- three named pull requests and a fourth unnamed one on Faster workspace
  switching;
- five agents on that task, two of them not named.

## What each thing means

| On the campus | Read from | Kind |
| --- | --- | --- |
| A building | one listed task | data |
| Its plot | the task's place in `createdAt` order, oldest at the back | derived each draw, never stored |
| A floor | one agent; floors = `agents.total`, with no cap | data |
| A floor's light | the named agent's `status`: blue running or starting, red failed, dim when its turn ended or it was stopped; orange when an open Inbox item is that agent's (`agentId`) | data |
| A dashed floor | counted in `total` but not named in the summary | data: unknown, not zero |
| A beacon, with a count past one | open Inbox items on the task | data |
| Rings | `callTaskId` | data |
| A single glass storey | a task with no agents yet | derived |
| A crate | one named pull request | data |
| Its size | additions + deletions on one shared scale: **volume** proportional to lines, so an edge grows with the cube root. The key labels this as not linear, with 50, 200 and 800-line references. | data, nonlinear scale |
| Its green and red | the additions' and deletions' shares, split across the crate's width so the top and front both show it | data |
| A grey dashed crate with "?" at a task's door | `pullRequestTotal` minus the named ones: state and size unknown, not zero, and counted in no total | data |
| The gate yard's three bays | open pull requests grouped by `checks`: failing (red), running (amber, pulsing), passing (green, "ready to merge"). The ready bay stands nearest the gate. Within a bay, crates are placed by PR number. | data. This is not GitHub's merge queue and implies no order. |
| The gate and its lowered barrier | merging happens on GitHub; the mockup offers no merge action | relationship |
| The shipped yard and its totals | merged pull requests the listed tasks' summaries name, with their count and summed additions and deletions | data, labelled as a sample, not all-time |
| A dashed route from a task to its crates, while either is pointed at or open | which task the pull request belongs to | relationship |
| The toolbar's "1 question · 1 ready to merge" | open Inbox items, and open pull requests with passing checks, named separately | data |
| The sidebar's Inbox badge | open Inbox items only | data |

Animation runs only while something is happening: a beacon while a question
waits, rings while a call is live, a pulse while checks run, and a breathing
window while an agent runs. Every loop answers `--loop-motion`. The trees,
lamps, carts, smoke, crane and flags of earlier drafts are gone. Shadows and
the ground slab remain only as 3D shading.

## What you can do in the show

- **Point at a crate** to read its numbers: `+additions −deletions`, lines
  changed, its state and its task. The keyboard reaches each crate too.
- **Click a building or a crate**, or a task in the sidebar. A building's
  floors spread apart so you can see each agent at its desk, a question over
  the agent that asked it, and a dashed figure for each agent not named. The
  inspector lists:
  - the question and its options;
  - every named agent, plus a "+N more" row;
  - every named pull request, with its chip, its additions/deletions split
    bar and its numbers, plus an unknown row.
- **Answer the question.** That is the Inbox item's reply, which Luke already
  has. The beacon goes out and that agent's floor turns blue.
- Drag to pan, scroll to zoom, and turn the campus with ⟳ or R. Escape
  closes. Switch between Night and Day in the header. The key folds away.
- The URL takes `?theme=light`, `?open=<task id>` and `?rot=<1–3>`. Each value
  is checked against the page's own, so a reviewer can link to one frame.

## Limitations

- **The summaries are bounded.** Only three agents and three pull requests per
  task are named. The campus shows the rest as dashed floors and dashed crates
  rather than leaving them out. A ready, failing or merged pull request beyond
  the three can't be placed, so the bays and the shipped yard cover only the
  named ones.
- **Draft, closed and no-checks pull requests.** A draft or closed one isn't
  waiting on a merge, so it would stay off the yards and show only in the
  inspector. A "no checks" bay would appear only when such a pull request
  exists. The sample has none of these.
- **Height means agents, not effort.** A task with many agents is a tall
  tower, uncapped, so a very large one would need the camera to pull back.
- **Plots run out.** The district has eight plots, which this sample fills.
  More tasks would need a rule for growing the grid, still worked out from
  `createdAt` each time.
- **Times shown** are only an agent's `at` and an Inbox item's `postedAt`.
  Merge times, check counts, file counts and call length are not shown,
  because the summaries don't carry them.
- **Signs are placed for the default view.** In turned views they can crowd
  one another.
