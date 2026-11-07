Leaf 5b of "One place module owns where the window stands" (https://vespin.dev/stage/task/1746). Builds on #7504 (5a). The doors that open a task now navigate to `/$workspace/task/$taskId`. The task's binding follows that route through the place module, on its edges, as #7503's binding pattern does for Home. Every hand-written clear of another place is deleted.

## Summary

```diff
 places/
 ├── place-binding.ts
+│     PLACE_BINDING (moved here from routed-places.ts)
+│     useTaskAsk(open) → { boundFor, ask, boundNow }   # `asked` and `boundFor`, out of use-tasks-tab
+│     usePlaceArrivals()                               # the developer's arrivals, the binding's own moves not counted
 │     bindingMove
+│       arrival on a task's place, its task not bound for → SELECT (host: TASKS_SELECT)
+│       bound moved while another task's place stands     → TO_BOUND (history writes the task's step)
 │       arrival on Home, a task bound                     → UNBIND
 │       bound none under the task's place                 → TO_UNBOUND (Home)
+├── task-step.ts      taskOfAt / taskAtOf: which task an address names, and the address a task is opened at
 └── routed-places.ts
+      inTaskPlace: Inbox, agent page, not-found, version history = true; Board, Person, Automations, Admin, Settings = false
+task-route.ts         useTaskRoute(): the task's own place as the router stands it, and its navigation
```

```diff
 openTask(taskId)                          # every door: sidebar, ⌘K, Inbox, pinned tab, link, ⌃Tab, switch
-  leaveOverPlan()
-  setAsked({ taskId, over })
+  ask(taskId)
+  standTaskPlace(taskId)                  # navigate, where the place standing gives way (inTaskPlace)
   sendSelect(taskId)
-showColumnTab / showPanelTab / showOverview / showTaskAgents / showFile / reopenHere / onOpenPinnedTab / startTask
-  leaveOverPlan(); closeHistory()
+  showTask(taskId) | standTaskPlace(taskId)
-command-palette shownOverHistory(tasks, show)
+  tasks.onStandTask(); show()
 history go(task step)
-  tasks.onRestoreTask(taskId)             # the arrival asks for it instead (onArriveTask)
```

`grep -rn "closeHistory\|closeInbox\|leaveOverPlan\|shownOverHistory" packages/panel/src` finds nothing.

## Decisions

1. **A door asks and navigates in the same press.** The task is asked for first, then the window moves. Its arrival finds the task already bound for, so the binding asks nothing more. The binding's `SELECT` covers arrivals no door asked for: Back, Forward, the browser's own move, and a reload on a saved task step. `boundNow` reads the ask as it was last made, not as last drawn, because a render can land between the router's move and the ask's.
2. **An ask stands over the task open at the call**, not the one open when the door was handed. Before, a switch toast's Back asked over a stale task, so the ask was dropped until the host answered. Now that task shows as bound at once, under #7503's accepted press-moves-at-once rule.
3. **The history writes no step while a task's place names another task than the one bound for** (`taskAhead`), as it already did for Home with a task bound: the binding is about to move one or the other. `TO_BOUND` from a task's place goes through `history.onLeaveRouted`, as from Home. Leaving a step lets the history write the bound task's step: a push, as on `main`.
4. **Which task a task's place stands on** comes from the step saved in its entry first, then from its address against the tasks the window holds (`taskOfAt`). An address under a workspace the reader isn't in names none of their tasks by number. An unlisted id that reads as a number gets no address of its own.
5. **`inTaskPlace` replaces the clears with a declaration answer.** On `main`, `leaveOverPlan` left the Inbox, an agent's page, and the not-found page, and `closeHistory` left a version history. The Board, a person's page, Automations, Admin, and Settings stayed standing, the task opening under them (a workspace switch on the Board turns the Board, for instance). Each place now says which kind it is, and one door (`standTaskPlace`) reads it. Behavior matches `main`.
6. **Arrivals are counted by the binding** (`usePlaceArrivals`), per router history. The binding's own moves (`TO_BOUND`, `TO_UNBOUND`) don't count. `pressedOverNow` restores only where the developer arrived nowhere since the press's own move. `startingTask` is hidden for good by any later arrival. Neither reads `navigations` any more.
7. **`navigations` still counts link opens and a person's page**, besides selects, starts, and workspace switches. The link doors' async reads (`readAgentById`, task-by-number, Inbox item home) guard on it, and they are leaf 6's. Narrowing it here would let a late link read open over a later link that moved nothing.
8. **`PLACE_BINDING` moved into `place-binding.ts`.** `use-tasks-tab.ts` now imports the binding module at runtime, and `routed-places.ts` imports `use-tasks-tab.ts` at runtime. The task's route door (`useTaskRoute`) and the arrival count are made in `app.tsx` and handed in, as the other route doors are.
9. **A fixture run** stands its own bound task's place for any task door, which is what `leaveOverPlan` left for. Its press on another task moves nothing, as on `main`.
10. **The history's visit skips a routed place the router has moved off since the render.** A door earlier in the same commit can move it, as a version history giving way to its task does. Without this, the stale render pushed the version history again.
11. **Consequence of arrival-selects:** a link to the open task's own agent, pressed while another task is still asked for, now asks for the open task, because the window stands on its place. On `main` the window kept the other ask.

## Fixes

Each comes with a test I watched fail on `main` first.

- **CodeRabbit's #7504 finding: a refused open pressed on the Inbox, with the Board opened before the refusal, brought the Inbox back over the Board.** The same happened for a refused agent start. Test: `use-tasks-tab.test.ts` › "%s pressed on the Inbox and refused after the Board was opened leaves the Board standing rather than the Inbox" (rows: a task's open, New task's agent start).
- **Leaf 1's follow-up: a refused start during an Inbox item's first read held the item unopened.** An item reached by its address is `{ itemId }` while its home is read. The refusal's restore chose that bare choice, and the Inbox then held it for good. A choice still being found is now held nowhere (`inbox-route.ts`). Test: "a start refused while the Inbox item it was pressed over was still being found by its address leaves it to be found, rather than holding it unopened"; it fails on `main` and on this branch without the `inbox-route.ts` change.

## Fixes from reviewing #7504

Reviewed against the eight bug classes. Each fix comes with a test I watched fail first.

- **Back-list titles and Back's reach (classes 2 and 3).** In a narrow room, a task's step is saved at its side panel tab's link. A Pull request or worker tab's link names the agent alone (`/acme/agent/<id>/changes`), which no routed place claims. Since #7504, such a step was named by nothing and always reachable: a task renamed since kept its old name in the Back list, and Back stopped on a task deleted since, or on a tab closed since. Before #7504, a `"plan"` step was read as the task's whatever its address. Now a step holding a task's step is the task's own place (`stepPlaceOf`), for Back's reach and its names alike. The binding reads the same, so Back onto such a step asks for its task. Test: the `routed-places.test.ts` row "Back passes over a narrow room's task step at its side panel's Pull request address, on a task since deleted".
- **A press over an open place (class 3): a refused open brought the Inbox or an agent's page back over a place opened during the wait.** This is the CodeRabbit finding above. #7504 added the restore to every task open. The arrival count fixes it (Decision 6), covered by the Fixes rows.
- **No bug found** for the sidebar's current row, slug fallback, Copy link, leave-guard asks, off-screen state (beyond the race above), or a link or ⌘K to the place already standing.

## Browser smoke check

Chromium against the web dev server with `?fixture=agent-pull-request`, deep links served `app.html` as the deployment's rewrite serves it. The same Playwright script on `main` gave identical output, line for line.

| Check | This branch | `main` |
| --- | --- | --- |
| Load `/app` with the fixture's task bound | ✅ `/personal/task/42`, 1 step, window Back disabled, its row current | same |
| Sidebar Inbox, then the task's row | ✅ `/personal/inbox` → `/personal/task/42`, a step each, the row current | same |
| Browser Back / Forward; window Back / Forward | ✅ Inbox ↔ task, no extra entry | same |
| Another task's row (the fixture binds none) | ✅ no move, no step | same |
| ⌘K to the task from the Inbox | ✅ `/personal/task/42`, a step | same |
| ⌘K to the task already standing | ✅ no move, no step | same |
| Sidebar Home (the fixture binds its task for good) | ✅ no move, no step | same |
| Reload on the task's address | ⚠️ the fixture rides in the query, which the address drops, so the reload signs out on either tree; covered by the App and history tests that load at a task's address | same |
| Start a task from Home / a task, delete the open task, a refused open, a pinned tab, task ↔ task | ⚠️ the fixtures neither start, delete, refuse, pin, nor bind a second task; covered by the tests below | — |

## Tests

- **Place module** (`places/place-binding.test.ts`), new rows through the module's interface:
  - arriving on a task's place asks for its task, and nothing where the door asked already;
  - the host binding another task under a task's place goes to it, and a place over it stays;
  - **the race**: arriving on a task's place as the host binds another in the same breath asks for the one arrived on;
  - the binding's own move is no arrival, while each of the developer's is.
- **`use-tasks-tab.test.ts`**: its harness now runs the binding in every mount, as the root does, rather than beside the history probe alone. That replaces its hand-wired, history-only binding. The file drives the real tab; it holds no rows over a fake `TasksControl`. Changed rows:
  - "a Vespin link keyed by the agent alone…" now holds the account's workspaces, as a window always does before a link opens, and settles before counting the late read (see Decision 11);
  - three new rows (Fixes).
- **`navigation-history.test.ts`**: "Back to another task whose panel stood shut…" now reads the arrival's ask (`onArriveTask`) instead of `onRestoreTask`. The fake harness reads the task's place from the router.
- **Harness**: `testing/window-router.ts`'s router now follows its history (`updateLatestLocation`) when drawn under no provider, as its provider does. Without this, a navigation back to `/app` read as already there.
- **Ran**:
  - the whole `@repo/panel` suite: 376 files, 4,092 tests, all pass;
  - `tsc` for `@repo/panel` and `@repo/web`;
  - `pnpm lint`;
  - the web's `browser-history-narrow*`, `task-pages`, `load-link`.
- **Left to CI**: the web's `tasks-app.test.ts`, which needs `@sentry/profiling-node` (#7487), not installed in this sandbox, and the rest.

## Follow-ups

- A refused open still pushes the place it lands on after the task's step, as #7504 noted.

## Merge Danger

**Door:** two-way. No stored or wire value changes; the history's saved steps keep their shape.

**Blast Radius:** navigation. Every door that opens a task, Back and Forward onto a task, the refusal restores, and the start's page.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
