/**
 * tasks-page-held.ts -- what a workspace's Tasks page holds across its visits, which the shell keeps while the page itself is drawn only as its route stands.
 *
 * The page is its route's (`board-route.lazy.tsx`), so leaving it lets it
 * go; what the reader was in the middle of is kept here instead, one set
 * per workspace, so the page drawn again finds it as it stood: the tasks
 * chosen in each view, the column a narrow room's Columns view showed, the
 * find, and what each run of rows measured, so a long list drawn again lays
 * its rows out as they stood and the router's restored scroll lands on the
 * same row (`@repo/ui/virtual-rows`). What the page keeps on this Mac across launches, its view,
 * filters, display, folds, and scroll, is kept by the page itself
 * (`tasks-page.tsx`). A question the page asked, as Permanently delete's,
 * is kept nowhere, since a question does not outlive the surface it was
 * asked on (`packages/panel/AGENTS.md`).
 */

import type { VirtualRowMeasurements } from "@repo/ui/virtual-rows";
import { Store } from "@tanstack/react-store";
import { type FindStore, NO_FIND } from "../find-in-tab.js";
import type { TasksView } from "./tasks-page.js";
import type { ChosenTasksStore } from "./tasks-selection.js";

/** What one workspace's Tasks page holds across its visits. */
export class TasksPageHeld {
  readonly #chosen = new Map<TasksView, ChosenTasksStore>();
  readonly #measured = new Map<TasksView, Map<string, VirtualRowMeasurements>>();
  /** The column a narrow room's Columns view showed; none before one is chosen. */
  readonly column = new Store<string | undefined>(undefined);
  readonly find: FindStore = new Store(NO_FIND);

  /** What each run of `view`'s rows measured, by the run's own key, a group's or a column's, which it is drawn again by. */
  measuredIn(view: TasksView): Map<string, VirtualRowMeasurements> {
    const measured = this.#measured.get(view) ?? new Map<string, VirtualRowMeasurements>();
    this.#measured.set(view, measured);
    return measured;
  }

  /** The tasks chosen in `view`, which keeps a choice of its own. */
  chosenIn(view: TasksView): ChosenTasksStore {
    const chosen = this.#chosen.get(view) ?? new Store<ReadonlySet<string>>(new Set<string>());
    this.#chosen.set(view, chosen);
    return chosen;
  }
}

/** Each workspace's Tasks page holdings, by the workspace's id, made at its first visit. */
export class TasksPagesHeld {
  readonly #held = new Map<string, TasksPageHeld>();

  /** The holdings of the Tasks page of the workspace `workspaceId`. */
  of(workspaceId: string): TasksPageHeld {
    const held = this.#held.get(workspaceId) ?? new TasksPageHeld();
    this.#held.set(workspaceId, held);
    return held;
  }
}
