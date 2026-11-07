Leaf 4 of "One place module owns where the window stands" (https://vespin.dev/stage/task/1746). Home moves from window state onto the router, declared in the place module. The place module now owns how a place and the host's bound task follow each other. A task link loaded before the account's workspaces are read now waits on its own route instead of resting on Home.

## Intended visible change

- **Back after a reload no longer goes Home.** Reloading a task's address used to write a Home step at `/app` before the link opened, so Back went to Home. Now the task's step takes the entry it loaded on: the history is that one address, and Back leaves the tab. This was decided in the TanStack pilot's thread and approved by the audit pilot.
  - A pairing link (`/connect/<code>`) loaded at its own address follows the same rule. Settings' Hosts page replaces the link's entry instead of being pushed after it. Without this, Back would land on the link again and reopen Settings.

## Summary

- **Routing.**
  - `/app` and `/$workspace/` draw `HomePlace`. Home's route still throws `notFound()` for a workspace that isn't the reader's.
  - The task route `/$workspace/task/$taskId` gets a `loader` that waits for the account's workspaces (`workspacesReadFor` in `route-gates.ts`, heard on the Query cache). Its `pendingComponent` is the task's loading frame (`TaskRouteLoading`).
  - A splat route `$` redirects any address that names no place to `/app`, so an entry with no saved state still opens Home.
- **Place module.**
  - `ROUTED_PLACE.HOME` declares Home: workspace gate, title "Home", Home's link for Copy link, and the HOME surface.
  - Every declaration gains a required `binding` answer (`PLACE_BINDING.NONE` for Home, `KEPT` for every other place).
  - New `places/place-binding.ts` holds `usePlaceBinding`, described below.
- **Route door.** `useHomeRoute` in `workspace-routes.ts`, with `open`, `standingIn`, `onOpen` and `onTurn`. Home stands under the listed workspace, turning in the step's place as the Board and the Inbox do.
- **History.**
  - `PLACE_KIND.HOME` is gone, and a Home step is now a routed step.
  - A Home step saved by an older build (`{ kind: "home" }`) is read back as the routed step at its entry's address.
  - With no task bound and no routed place standing, the window stands on no place and writes nothing.
  - A task whose link isn't drawn yet stands at the address its links name it by. It used to stand at `/app`, which is now Home's address.
  - A routed place left with no task bound is left for Home.
  - `known` now also waits for the workspaces to be read.
- **Tasks tab.**
  - `onLeaveTask` and `onGoHome` are now a navigation to Home. Arriving on Home lets go of the task.
  - The raw TASKS_CLOSE ask is `onUnbindTask`, which only the binding calls.
  - New fields: `atHome` and `taskPlaceStands`.
- **Deleted.** `goHome`'s `closeHistory` and `leaveOverPlan`, and `leaveTask`'s `leaveOverPlan`. Navigation leaves whatever stood.
- **Work column.** `DesktopTasks` is now the task's place only: the task, or its loading frame while the host opens it. Home's page is `DesktopHomePage`. A task started from either one shows as its page until the start answers.

## Binding pattern

For leaf 5 (the task route) to reuse. It lives in `packages/panel/src/places/place-binding.ts`.

- **Who owns what.**
  - The host owns which task is bound (`activeTaskId`, asked for as `boundFor`).
  - The router owns which place stands (`useWindowPlace`).
  - Each declaration says what it holds of the binding (`binding`). Neither side takes the other over.
- **What it reads.** `usePlaceBinding({ known, place, bound, onUnbind, onToBound, onToUnbound })`. It keeps the previous reading `{ place, bound }` and compares it with the current one in an effect, so it acts only on edges:
  1. **Arrival.** The place changed to one that holds no task (Home), and a task is bound: `onUnbind` asks the host for none (TASKS_CLOSE). Any door that arrives counts: Back, the sidebar, a link to `/app`, the history's own move.
  2. **Auto-leave.** `bound` changed to a task while such a place stands: `onToBound` leaves it for the task. Today that is the history's `onLeaveRouted`, which writes the task's step. Leaf 5 would navigate to the task's route.
  3. **Unbinding under the task.** `bound` changed to none while no routed place stands (the task's own place): `onToUnbound` goes Home. A delete closing the open task takes this path.
- **Why edges and not levels.**
  - Arriving on Home with a task bound only unbinds it. That flips `bound` to none, which while Home stands is no edge that leaves, so nothing chases anything.
  - A task the host binds later is a new edge and leaves Home again.
  - **When both edges land in one reading, the arrival wins**: it's the developer's own move, so the task is let go rather than Home left.
- **First reading.** The previous reading is taken as `{ place: <the place it opened on>, bound: undefined }`. A window opening on Home with a task already bound (a desktop launch at `/app`) therefore stands that task, in Home's entry's place, and never counts as arriving.
- **While they settle.** Home with a task still bound writes no step and draws the bound task, because the binding is about to move one or the other. That avoids a one-frame flash in either direction.
- **For leaf 5.**
  - Give the task route `binding: PLACE_BINDING.TASK` (its address's task).
  - Arrival there would ask the host to bind that task.
  - A host binding of another task, or of none, would navigate to that task's route or to Home.
  - The `bindingMove` table in the module is the one place to extend.

## Decisions

1. **The edge is on `boundFor`, not `activeTaskId`.** The task asked for counts as bound, as the history already treats it, so a press moves at once. As a result, the task's place shows its loading frame during the host's select round trip, where Home used to linger. The look is the same skeleton the task's page draws while it reads.
2. **The link's route waits in a `loader`, and its frame stands at once (`pendingMs: 0`) as a lazy route's does.** I tried two alternatives:
   - **The router's default `pendingMs` (1 s).** This held the whole first render, sidebar included, for up to a second: probe dom median 1505 ms against `main`'s 558 ms.
   - **`StatePlace` as the pending component.** This drew the task page twice on every in-app move onto a task. A move onto the route shows the pending frame for the turn the loader takes even once the workspaces are read.

   So the frame is the light `TaskRouteLoading`, never the place itself.
3. **The wait is on the task route only.** Home's `/$workspace/` draws at once, as it did, and its not-found gate still waits on the read through `invalidate`. The routed places keep their own gates.
4. **A task's step address when its link isn't drawn yet** is `/<its workspace, else the listed one>/task/<its number, else its id>`. It used to be `/app`, which would now stand Home and unbind the task. While no workspace of it is known, no step is written.
5. **Home turns under the listed workspace in the step's place**, including `/app` once one is listed. It holds while a task is bound there, so the turn and the auto-leave can't race.
6. **Home's gate is the workspace gate.** Back passes over a Home step under a workspace the reader is no longer in, since that address now draws "workspace not found". On `main`, a Home step named no workspace.
7. **`onUnbindTask` is a door on `TasksControl`, not a navigation.** Only the binding calls it. `onLeaveTask` and `onGoHome` stay as the doors' names, both a navigation to Home. On Home already, they only let go of a task still bound there.
8. **Addresses that name no place redirect to `/app`** through a splat route's `beforeLoad`. Before, the window's Home write replaced them.
9. **Scroll.** The router's `scrollRestoration` is unchanged, and Home's page has no `data-scroll-restoration-id`, as on `main`.
10. **Saved steps from older builds.** A tab's entries may still hold a Home step saved as `{ kind: "home" }` across a deploy. `savedStepOf` reads it back as the routed step at its entry's address, and `taggedPlace` loses its HOME case.
11. **Fixture runs.** A fixture never unbinds a task (`unbindTask` returns early there, as `leaveTask` did). The sidebar's Home press now navigates to Home, where Home's route keeps drawing the bound task. On `main` the press did nothing.

## Fixes from reviewing #7476

Each fix comes with a test I watched fail first.

- **Sidebar current row.** A Home link to an unknown workspace, pressed on an open task, left the task's row current under the not-found page. Test: "a Home link to a workspace the reader is not in, pressed on an open task, leaves no row of the sidebar current…" (`app-admin-link.test.ts`).
- **Press over an open place.** A refused start pressed on the not-found page didn't bring it back: the door compared against a value from the last render. It now reads where the router stands at the call, as the agent page's door does. Test: "a start refused that was pressed on the page saying a workspace is not there stands that page again" (`use-tasks-tab.test.ts`).
- **Off-screen state.** Home standing in a workspace the reader then lost became "workspace not found". It now stands under the workspace listed. Test: "Home standing in a workspace the reader is no longer in stands under the workspace listed now…" (`app-admin-link.test.ts`).
- **No bug found** for Back-list titles, slug fallback, Copy link, the leave guard, or a link/⌘K to the place already standing.

## Follow-ups

- A not-found entry read while the workspaces are still unread, or after the reader joins that workspace, is listed as a nameless step. Low confidence; not changed.
- #7476's replace for a link to an unknown workspace drops the step it was pressed on, so Forward no longer returns there. #7476 decided this; not changed.
- On the dev server, `/app.html` matches Home's route under a workspace named `app.html`. `main` replaced it with `/app` through the Home write. Production sends `/app.html` to `/app`.

## Browser smoke check

Chromium against the web dev server with the fixture runs, driven by Playwright. `inbox` profile for Home, `tasks` profile (a task already open at launch) for the task. I ran the same script on `main` in a worktree.

| Check | This branch | `main` |
| --- | --- | --- |
| Open Home by link (`/personal`) | ✅ Home, Home row current | same |
| Open by link `/app` (a task already bound) | ✅ lands on `/personal/task/42` in `/app`'s entry, 1 step | same address and steps |
| Home by sidebar, from the Inbox | ✅ `/personal`, a step, Home row current | same |
| Back / Forward (window buttons and browser), Home ↔ Inbox | ✅ | same |
| Reload on the task's address | ✅ `/personal/task/42`, window Back disabled, browser Back leaves the tab | same (the fixture reads its workspaces at once) |
| ⌘K to Home while on Home | ✅ no move, no step | same |
| Home's composer takes the caret | ✅ | same |
| Start a task from Home's composer (auto-leave) | ⚠️ the fixture doesn't start tasks, so nothing moves on either tree. Covered by `place-binding.test.ts` | same |
| Open a task by its sidebar row | ⚠️ the fixture doesn't open a task on a press, on either tree | same |
| Home by sidebar on an open task (fixture) | `/personal`, a step; Home's route keeps drawing the task the fixture never lets go of | no move (the fixture never unbinds) |

## Measurements

The first-render agent's probe and runner: a production web build in Playwright Chromium against the fake service, reloading `/<ws>/plan/<id>`, alternating trees, 12 runs plus 4 at 4× CPU throttle, all in one session. The fake service lists no workspaces, so the link never opens on either tree. dom is the sidebar's task name in the DOM.

| Tree | dom | paint | idle | Ends at |
| --- | --- | --- | --- | --- |
| `main` (f95282ab8) | 548 | 657 | 705 | `/app`, a Home step |
| this branch | 602 | 658 | 703 | the link's address, no Home step |
| `main`, 4× throttle | 2547 | 2956 | 3211 | |
| this branch, 4× throttle | 2827 | 3003 | 3138 | |

- **Medians.** In ms. On par with `main` for paint and idle. dom is about 50 ms later, because the router renders the pending frame after a zero-delay timeout. The host was noisy, so take the 4× rows as indicative.
- **Route remounts on reload: 2 → 0.**
  - On `main`, a task link reloaded before the workspaces are read draws the task route, then `/app` (the Home step), then the task route again: `StatePlace` mounts 3 times, 2 remounts, as the first-render agent found.
  - On this branch there is no `/app` in between. The task's loading frame stands, then `StatePlace` mounts once. The probe shows the address: `main` ends at `/app`, this branch at the link's.
  - What I counted directly, with temporary mount logs on the fixture runs (which read their workspaces at once, so they can't stage the slow case):
    - reload on the task's address: `StatePlace` ×1 on both trees;
    - launch at `/app` with a task bound: `StatePlace /app → StatePlace task` on `main`, `HomePlace /app → StatePlace task` here;
    - an in-app move onto a task mounts `StatePlace` once. It mounted twice while the pending frame was `StatePlace`, which is why it no longer is.

## Tests

Each new test names the regression it catches.

- **New `places/place-binding.test.ts`.** Tests the binding through its interface over the real routes:
  - auto-leave;
  - clear on arrival, which doesn't chase;
  - the race (arrival and binding in one breath: arrival wins, and a later binding still leaves);
  - the first reading on Home with a task bound;
  - unbinding under the task, and not under a place over it.
- **`navigation-history.test.ts`.**
  - The harness now stands Home by its route with the binding, as the root does. Its tasks stand in a listed workspace, and its fake unbinds as the real tab does.
  - The fake-`TasksControl` Home rows are replaced, not kept beside new ones:
    - "a move landing on an entry holding no step opens Home" is now Home at `/app` letting go of the task;
    - the `/app` → `/acme` row is moved to the App-level tests.
  - New: "a link loaded before the workspaces are read writes no Home step… Back on that one entry stays on the task". This is the first-render agent's A2 case. On `main` the same steps give `["/app", task]` with `canGoBack` true, as that agent measured. It also asserts the desktop's single-entry Back stays on the task and lets go of nothing.
  - New: "a link loaded into a workspace not the reader's stays at its own address", the account guard.
- **`navigation-history-narrow.test.ts`.** New: "a pairing's link loaded at its own address opens Settings in that entry's place". Fails without the `settings-link.ts` change.
- **`app-account-home.test.ts`.** Rewritten against the router: after Finish, Home stands at its route (`/app`, or the team's workspace), drawn by it.
- **Harnesses.**
  - `windowRouter` and the web's `drawPanel` hand the router the test's own Query client, as the roots do.
  - `testing/shell-router.ts` mirrors Home's route and the task's.
  - `HOME_AWAY` added; `routed-places.test.ts` rows updated.
- **Ran:**
  - the whole `@repo/panel` and `@repo/web` suites. `automations-page.test.ts` failed only under the full run's load and passes alone (113/113); I'm reporting it to the pilot as a flake;
  - `tsc` for `@repo/panel` and `@repo/web`;
  - `pnpm lint`.
- **Left to CI:** the rest.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
