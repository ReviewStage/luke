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
| Agents (crew, stacks, drones, or windows) | one mark per agent in `agents.total`, in its status's colour, dashed when not named | data |
| A beacon | an open Inbox item | data |
| Rings | `callTaskId` | data |
| A crane and scaffolding | an agent running and `pullRequestTotal` = 0 | derived |
| A purple flag on a roof | every named pull request merged | derived |
| A pull request's cargo (ship, containers, parcels, or crates) | one named pull request, sized on the style's one shared scale from additions + deletions, with its additions' and deletions' shares | data |
| A dashed "?" piece of cargo at a door | `pullRequestTotal` minus the named ones: unknown, not zero, counted in no total | data |
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

## Agents and pull requests, several ways each

The page's header switches how agents and pull requests are drawn. The rest of
the campus stays the same. Nothing is stored; a link can name a pair with
`?agents=` and `?cargo=`.

**Agents.** Each style draws one mark per agent in `agents.total`, with no
cap. All of them use the same colours: blue running, orange asked a question,
red failed, quiet when the turn ended, and dashed when the summary doesn't
name the agent.

- **Crew** (default): a worker per agent at the building's door, in a hard hat
  of the agent's state. Running workers bob with a tool in hand, and the one
  that asked holds up a "?".
- **Stacks:** a chimney per agent on the roof. It smokes while the agent runs,
  shows a lamp when the agent asks or fails, and is cold when its turn ended.
- **Drones:** a drone per agent. Running drones circle the roof, the one that
  asked hovers with its light on, and idle ones are parked on the roof.
- **Windows** (V3): lit windows and the building's own smoke.

In every style except Windows, the windows only glow, so the agents carry the
state. Opening a building shows each agent at its own desk inside, as before.

**Pull requests.** Every style uses one shared scale for every PR, open or
merged. Exact numbers stay in the card and the inspector.

- **Ship** (default): merged PRs are containers loaded onto a ship in a
  harbour past the gate. Open ones wait as containers on the quay, in the gate's
  lanes.
- **Containers:** steel containers whose **length is lines changed, linear**
  (one tile per 150 lines). The diff is a painted band along the side, in
  additions' and deletions' shares, rather than a coloured box.
- **Parcels:** a pallet of small boxes, **one per 25 lines** of additions and
  one per 25 of deletions, rounded up, so the count is the measure. The colour
  is only the tape: green for additions, red for deletions.
- **Crates** (V3): cubes whose volume is lines changed (edge ∝ ∛lines, not
  linear), split green and red across their width.

## Limitations

- **Only named PRs are placed.** At most three agents and three pull requests
  per task are named, so the lanes and the lot cover only named ones. The rest
  show as dashed figures and crates.
- **Some PR states have no spot.** Draft, closed and no-checks pull requests
  would show only in the inspector. The sample has none.
- **The master plan has eight plots.** More tasks need a rule for growing it.
- **Labels can crowd in turned views.** They're placed for the default view.
- **Shared space.** The studio and the block's crane stand close to the gate.
- **The ship holds a sample's worth.** More merged pull requests would need a
  second ship, or a longer one.
