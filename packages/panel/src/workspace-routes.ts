/**
 * workspace-routes.ts -- a workspace's Board and a person's page as the router stands them: whether each stands, what its address names, and the navigation that opens it.
 *
 * Both are routed places (`panel-router.tsx`) under the workspace their
 * address names, read from the address alone, as Admin is
 * (`admin/admin-route.ts`). Opening one is a visit; opening the one already
 * standing moves nothing, as pressing the place standing always has. A
 * person's page is opened with the name the place that opened it knew them
 * by, which names someone who left; the address holds no name, so the
 * window keeps each one it was handed for as long as it lives, and a step
 * back to the page finds it there.
 */

import { useNavigate, useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { ROUTED_PLACE } from "./route-gates.js";
import { useRoutedLocation } from "./routed-location.js";

/** A workspace's Board as the router stands it. */
export interface BoardRoute {
  readonly open: boolean;
  /** The address step of the workspace whose Board stands, while it stands. */
  readonly standingIn: string | undefined;
  /** Opens the Board of the workspace whose address step is `workspace`. */
  readonly onOpen: (workspace: string) => void;
  readonly onClose: () => void;
  /** Stands the Board of `workspace` in the step's place, as another workspace listed under the Board does. */
  readonly onTurn: (workspace: string) => void;
  /** Reads the Board ahead of a press the pointer says is coming. */
  readonly onPreload: (workspace: string) => void;
}

/** A person's page as the router stands it. */
export interface PersonRoute {
  /** The person whose page stands, none while none does. */
  readonly userId: string | undefined;
  /** The name the page was opened with, where it was handed one. */
  readonly name: string | undefined;
  /** The address step of the workspace the page is the person's in, while it stands. */
  readonly workspace: string | undefined;
  readonly onOpen: (userId: string, name: string | undefined, workspace: string) => void;
  readonly onClose: () => void;
  /** Reads the page ahead of a press the pointer says is coming. */
  readonly onPreload: (userId: string, workspace: string) => void;
}

/** The Board as the router stands it, left by `onClose`, and kept standing by `onStay` where a leave was asked of it before a door asked for the Board standing. */
export function useBoardRoute(input: { onClose: () => void; onStay: () => void }): BoardRoute {
  const router = useRouter();
  const navigate = useNavigate();
  const here = useRoutedLocation();
  const open = here.place === ROUTED_PLACE.BOARD;
  const standingIn = open ? here.params.workspace : undefined;
  const onOpen = (workspace: string) => {
    // Opening the Board standing moves nothing, and keeps it standing where the door that asked for it left the routed place first, as a link's and ⌘K's do.
    if (standingIn === workspace) {
      input.onStay();
      return;
    }
    void navigate({ to: "/$workspace/tasks", params: { workspace } });
  };
  const onTurn = (workspace: string) => {
    if (standingIn === workspace) return;
    void navigate({ to: "/$workspace/tasks", params: { workspace }, replace: true });
  };
  const onPreload = (workspace: string) => {
    void router.preloadRoute({ to: "/$workspace/tasks", params: { workspace } });
  };
  return { open, standingIn, onOpen, onClose: input.onClose, onTurn, onPreload };
}

/** A person's page as the router stands it, left by `onClose`, and kept standing by `onStay` as the Board is. */
export function usePersonRoute(input: { onClose: () => void; onStay: () => void }): PersonRoute {
  const router = useRouter();
  const navigate = useNavigate();
  const here = useRoutedLocation();
  // Only grows: each name a page was opened with, by the person, which the address leaves out.
  const names = useRef(new Map<string, string>()).current;
  const open = here.place === ROUTED_PLACE.PERSON;
  const userId = open ? here.params.userId : undefined;
  const workspace = open ? here.params.workspace : undefined;
  const onOpen = (to: string, name: string | undefined, toWorkspace: string) => {
    if (name !== undefined) names.set(to, name);
    if (to === userId && toWorkspace === workspace) {
      input.onStay();
      return;
    }
    void navigate({
      to: "/$workspace/person/$userId",
      params: { workspace: toWorkspace, userId: to },
    });
  };
  const onPreload = (to: string, toWorkspace: string) => {
    void router.preloadRoute({
      to: "/$workspace/person/$userId",
      params: { workspace: toWorkspace, userId: to },
    });
  };
  return {
    userId,
    name: userId === undefined ? undefined : names.get(userId),
    workspace,
    onOpen,
    onClose: input.onClose,
    onPreload,
  };
}
