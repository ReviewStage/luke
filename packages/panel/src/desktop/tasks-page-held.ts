import type { VirtualRowMeasurements } from "@repo/ui/virtual-rows";
import { Store } from "@tanstack/react-store";
import { type FindStore, NO_FIND } from "../find-in-tab.js";
import type { TasksView } from "./tasks-page.js";
import type { ChosenTasksStore } from "./tasks-selection.js";

export class TasksPageHeld {
  readonly #chosen = new Map<TasksView, ChosenTasksStore>();
  readonly #measured = new Map<TasksView, Map<string, VirtualRowMeasurements>>();
  readonly column = new Store<string | undefined>(undefined);
  readonly find: FindStore = new Store(NO_FIND);

  measuredIn(view: TasksView): Map<string, VirtualRowMeasurements> {
    const measured = this.#measured.get(view) ?? new Map<string, VirtualRowMeasurements>();
    this.#measured.set(view, measured);
    return measured;
  }

  chosenIn(view: TasksView): ChosenTasksStore {
    const chosen = this.#chosen.get(view) ?? new Store<ReadonlySet<string>>(new Set<string>());
    this.#chosen.set(view, chosen);
    return chosen;
  }
}

export class TasksPagesHeld {
  readonly #held = new Map<string, TasksPageHeld>();

  of(workspaceId: string): TasksPageHeld {
    const held = this.#held.get(workspaceId) ?? new TasksPageHeld();
    this.#held.set(workspaceId, held);
    return held;
  }
}
