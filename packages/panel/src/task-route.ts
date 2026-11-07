/**
 * task-route.ts -- a task's own place as the router stands it: where its address stands, and the navigation that opens one.
 *
 * A task's own place is a routed place (`panel-router.tsx`) at the address
 * its links name it by, `/<workspace>/task/<number>`, or by its id where it
 * has no number (`places/task-step.ts`'s `taskAtOf`), as the history writes
 * its step (`navigation-history.ts`). Which task stands is read from the
 * step the window saved in its entry, else from the address against the
 * tasks the window holds (`taskOfAt`), and the host is
 * asked to bind it as the window arrives there, by whichever door
 * (`places/place-binding.ts`). Opening a task's place is a visit; opening
 * the one already standing moves nothing.
 */

import { useRouter } from "@tanstack/react-router";
import { savedTaskOf } from "./navigation-history.js";
import {
  type PlaceParams,
  placeParamsOf,
  ROUTED_PLACE,
  routedPlaceOf,
  useWindowPlace,
} from "./places/routed-places.js";
import type { TaskAt } from "./places/task-step.js";
import { useRouteAccess } from "./route-gates.js";

/** A task's own place as the router stands it. */
export interface TaskRoute {
  /** Where the task's own place stands by its address, while it stands. */
  readonly at: TaskAt | undefined;
  /** The task the step saved in the entry standing holds, which the window wrote for it, whatever address its link gave it; none in an entry holding no task's step. */
  readonly saved: string | undefined;
  /** Where it stands as the router's history stands at the call, since a door may move the window in the same turn as another. */
  readonly atNow: () => TaskAt | undefined;
  /** The task the step saved in the entry standing at the call holds, as `saved` reads it. */
  readonly savedNow: () => string | undefined;
  /** The address step of the workspace the window stands under at the call, whichever place stands. */
  readonly workspaceNow: () => string | undefined;
  /** Opens a task's own place at `at`, a visit after the step standing. */
  readonly onOpen: (at: TaskAt) => void;
}

/** Where a task's own place stands by the params its address's routes read. */
function taskAtParams(params: PlaceParams): TaskAt | undefined {
  const { workspace, taskId } = params;
  return workspace === undefined || taskId === undefined ? undefined : { workspace, task: taskId };
}

/**
 * A task's own place as the router stands it. Note that where it stands at
 * the call is read from the router's history rather than as the window was
 * last drawn, as an agent's page's door reads it (`agent-route.ts`).
 */
export function useTaskRoute(): TaskRoute {
  const router = useRouter();
  const access = useRouteAccess();
  const here = useWindowPlace();
  const at = here.place === ROUTED_PLACE.TASK ? taskAtParams(here.params) : undefined;
  // Note that the entry is read as the address is, the window drawn again on every move of the router's history.
  const saved = savedTaskOf(router.history.location);
  const atNow = () => {
    const matches = router.matchRoutes(router.history.location.pathname);
    if (routedPlaceOf(matches, access) !== ROUTED_PLACE.TASK) return undefined;
    return taskAtParams(placeParamsOf(matches));
  };
  const savedNow = () => savedTaskOf(router.history.location);
  const workspaceNow = () =>
    placeParamsOf(router.matchRoutes(router.history.location.pathname)).workspace;
  const onOpen = (to: TaskAt) => {
    // Note that the router writes its entry at once, which the history takes the task's step in the place of (`navigation-history.ts`).
    void router.navigate({
      to: "/$workspace/task/$taskId",
      params: { workspace: to.workspace, taskId: to.task },
    });
  };
  return { at, saved, atNow, savedNow, workspaceNow, onOpen };
}
