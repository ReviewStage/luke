Leaf 6b-1 of "One place module owns where the window stands" (https://vespin.dev/stage/task/1746). Leaf 6b is split by family, agreed with the pilot:
- **6b-1, this PR:** the mechanism plus a task's own link places: section, comment thread, and page (a task's, and an agent page's).
- **6b-2:** an agent's link places: agent tab, message, worker, Changes, review thread.
- **6b-3:** the Inbox item, task by number, the routed places still in `openPlace`, and the switch's deletion.

## Summary

```diff
 places/
+├── link-places.ts     # LINK_ROUTED_PLACE: COMMENT, SECTION, PAGE — each its routes and the place it reads there
+│     routedLinkOf(router, link, standingIn)  # canonical (linkOf) → router.matchRoutes → the declaration that reads it
+│     useLinkPlaceLandings(open)              # a load (or a landing with no saved step) at a link place's address opens it
+│     opensAtItsRoute(link)                   # the web's load-link leaves these to their route
 ├── task-step.ts       + LinkStep { taskId, column?, side?: { tab, link } }
 navigation-history.ts
+  useHistory.visit(place)                    # writes the step as the window's watch would, before it stands there
+  TaskVisits.onVisitTask(at, step)           # the task's address, or a narrow room's panel-tab link, with the step in typed state
 tasks/use-tasks-tab.ts
-  openPlace: case SECTION / COMMENT / PAGE
+  openLinked(link) → routedLinkOf → openRouted(declared) | openPlace(link)
+  standTaskPlace: a link's step pending → visitTask(at, step) instead of taskView.onOpen(at)
 apps/web/src/app/load-link.ts
+  a link place's address → replaced by its canonical address in the same entry, not said through onShowLink
```

How a link place opens now:
- **In the app** (a press, desktop `SHOW_LINK`, ⌘K): the link is matched on the route tree at its canonical address and opened through the Tasks tab's doors. Where the window moves to another task, it writes the step once, straight at its address, with the tab or pane in typed history state. In a wide room that is `/ws/task/<n>`. In a narrow room opening a page it is the page tab's own link, `/ws/task/<n>/page/<id>`.
- **Loaded at its own address** (a web reload or a fresh link): the web's `load-link.ts` replaces an older spelling with the canonical address in the same entry. The route standing then reads its params (`useLinkPlaceLandings`) and opens it, and the step takes the address in place, as `main` settles a load.

## Decisions

1. **The split.** As above. 6b-2 and 6b-3 start from `main` after the one before merges.
2. **The `visit` door.** `useHistory.visit(place)` runs the same `visitWrite` the window's watch runs, with the presses and side-panel opens heard since the last write, through the history's own write (`own`). So the leave guard is never asked twice, and the window's later watch finds the step standing and writes nothing new, or replaces it in place at the same address. `useWindowHistory` exposes it as `onVisitTask(at, step)` on a new `TaskVisits` interface, not on `WindowHistory`, which the shell's stubs implement and have no use for.
3. **One navigation point.** A link door sets the step it opens (`linking`) and runs the doors it always ran (`showOverview`, `showMention`, `linkPanelTab`, `showTaskAgents`). `standTaskPlace` is the only place a task's place is navigated to, and where a link's step is pending it visits with that step instead of `taskView.onOpen(at)`. Everything else the doors did is unchanged: the ask before the move, the refusal restore read before the move, a fixture run's own task, a place standing beside the task (the Board) keeping its stand, and the doors that open no new task.
4. **The route of a link place is where its params are read and where a loaded address lands. An in-app open never passes through it.** An in-app open's step is written at the step's address, which for a section or a comment is the task's own address with no fragment or query, so the link place's route never stands.
5. **Until the linked task opens, its step stands at the address the link wrote.** The window's step for a task bound for but not yet open is held (no write), and the task's address is the link's (`linked`), until the task opens with its own link drawn. Before this, the link of the task drawn before stood in. This is what keeps a narrow room's address from flashing.
6. **A link naming no workspace** (a mention's, as `luke://plan/<id>#a` or a chip) is matched under the workspace the window stands under, and still names none as its doors read it, as `openPlace` read it.
7. **Search params** are read through the route's own Effect Schema (`taskSearchSchema`), by matching with `router.matchRoutes(pathname, router.options.parseSearch(search))`. Only public router API is used.
8. **Nothing is left in `openPlace` for these kinds.** All three have routes; nothing went unrouted.

## Fixes

- **Narrow room: a link to another task's page no longer flashes through other addresses.** On `main` the address went `/ws/task/<other>` → `/ws/task/<open task>/page/<id>` (the page under the task drawn before) → `/ws/task/<other>/page/<id>`. Now it is the page's address alone. Test: "in a narrow room a link to another task's page goes straight to the page's address, and no other address stands as the task opens". It fails with the probe's `visitTask` routed to the old navigation.

## Review of #7506

Against the bug classes:
- **No bug found** for the sidebar's current row, Back-list titles, a press over an open place, slug fallback, Copy link, leave-guard asks, off-screen state, a link or ⌘K to the place already standing, or a refusal or late read landing over a place opened meanwhile.
  - `savedNow()` holds a task only on a task's step. The router's own pushes carry no step until `followRouted` stamps them as routed steps with no task.
  - `useLinkReads` counts only moves to another path, and passes over the history's own replace of its step.
- **Left as is:** a move within the same path still lets a late read land over it. That is #7506's Decision 1, and the pilot confirmed it stays.

## Tests

- `use-tasks-tab.test.ts`: the section, comment, and both page link rows are rewritten against `onOpenLink` with links read from their addresses (`addressOf`), matched on the window's router. Spelling tables, one row per spelling:
  - section: `/task/<id>#a`, `/plan/<id>#A`, task key `/task/VSP-7#a`, the app's own scheme `vespin://…/plan/<id>#a`, and `luke://plan/<id>#a`
  - comment: `/task/<id>?comment=`, `/plan/<id>?comment=`, and by task key
  - page: `/task/<id>/page/<p>`, `/plan/<id>/page/<p>`, by task key, and an agent page's `/agent/<a>/page/<p>`
- New:
  - the narrow-room no-flash test above
  - "a page loaded at a section's own address lands on its route, which opens the section, and its step then takes the task's address in place" (fails without `useLinkPlaceLandings`)
- `apps/web/tests/load-link.test.ts`: "a tab opened at a link place in an older spelling stands on its link written now in the same entry" (fails on `main`'s `load-link.ts`), and "a tab opened at a link place keeps every other key its query carries" (fails without the second commit).
- `/work/n`, `/worker/` under a task, pictures, and `/channel/` read as a task or the Inbox, so their rows belong to 6b-2 and 6b-3. `use-open-link.test.ts` is 6b-2's.
- **Ran:** `use-tasks-tab`, `places/`, `navigation-history*`, `use-open-link`, `tasks-list-select*`, `app-fixture-places`, `app-account-home`, `app-admin-link`, `desktop-shell`, `command-palette`, the web's `load-link`, `browser-history-narrow*`, `task-pages`, and `link-platform` (all pass), plus `tsc` for `@repo/panel` and `@repo/web`, `pnpm oxlint`, the anti-slop guards, `repository-checks.sh`, and `knip` (no new findings against `main`).
- **Left to CI:** the rest.

## Browser smoke check

Chromium against the web dev server, `?fixture=agent-page` (the task `/personal/task/42` with the agent's page `Invite funnel` held), deep links served `app.html` as the deployment's rewrite serves it. The same Playwright script ran on `main` and on this branch, each step read once the address and history length held still for two seconds.

| Link place, spelling | Fresh load | Reload | Back / Forward | Load again while open | vs `main` |
| --- | --- | --- | --- | --- | --- |
| Page, `/task/42/page/<id>` | ✅ settles at `/personal/task/42`, one entry | ✅ same address, no entry | ✅ no extra entry | ✅ one entry | same |
| Page, `/plan/42/page/<id>` | ✅ as above | ✅ | ✅ | ✅ | same |
| Page, `/task/<id>/page/<id>` (task by id) | ✅ as above | ✅ | ✅ | ✅ | same at every step |
| Page, `/task/VSP-42/page/<id>` (task key) | ✅ as above | ✅ | ✅ | ✅ | same at every step |
| Section, `/task/42#rollout` | ✅ settles at `/personal/task/42` | ✅ | ✅ | ✅ | same |
| Section, `/plan/42#Rollout` | ✅ as above | ✅ | ✅ | ✅ | same |
| Comment, `/task/42?comment=thread-1` | ✅ settles at `/personal/task/42` | ✅ | ✅ | ✅ | same |
| Comment, `/plan/42?comment=thread-1` | ✅ as above | ✅ | ✅ | ✅ | same |
| Agent page's page, `/agent/<a>/page/<id>` | ✅ `/personal/agent/<a>`, its own step after the loaded entry | ✅ | ✅ Back to the loaded entry, its `?fixture=` kept | ✅ | same |

- **Press in the app:** the fixture profiles have nothing on screen to press that links to a section, a comment, or a page, so the in-app open can't be driven there. It's covered by the `use-tasks-tab.test.ts` rows, the narrow-room no-flash test among them.
- **What the first smoke run caught:** this branch dropped the loaded entry's other query keys (`?fixture=`) where no step replaces that entry (the agent page's row). That broke the no-change rule, so `load-link.ts` now keeps every key the link doesn't name, with a test that fails without the fix.


## Follow-ups

- **Narrow room, a link to another task's page:** once the task opens, the panel reads shut for a moment before the page's read lands. Each change of sub-step pushes an entry, so the link leaves three entries. This happens on `main` too (same count in the test above). Holding the step until the panel settles would make it one. Kept as on `main`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
