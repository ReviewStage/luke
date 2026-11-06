import { useNavigate, useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { ROUTED_PLACE } from "./route-gates.js";
import { useRoutedLocation } from "./routed-location.js";

export interface BoardRoute {
  readonly open: boolean;
  readonly standingIn: string | undefined;
  readonly onOpen: (workspace: string) => void;
  readonly onClose: () => void;
  readonly onTurn: (workspace: string) => void;
  readonly onPreload: (workspace: string) => void;
}

export interface PersonRoute {
  readonly userId: string | undefined;
  readonly name: string | undefined;
  readonly workspace: string | undefined;
  readonly onOpen: (userId: string, name: string | undefined, workspace: string) => void;
  readonly onClose: () => void;
  readonly onPreload: (userId: string, workspace: string) => void;
}

export function useBoardRoute(input: { onClose: () => void }): BoardRoute {
  const router = useRouter();
  const navigate = useNavigate();
  const here = useRoutedLocation();
  const open = here.place === ROUTED_PLACE.BOARD;
  const standingIn = open ? here.params.workspace : undefined;
  const onOpen = (workspace: string) => {
    if (standingIn === workspace) return;
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

export function usePersonRoute(input: { onClose: () => void }): PersonRoute {
  const router = useRouter();
  const navigate = useNavigate();
  const here = useRoutedLocation();
  const names = useRef(new Map<string, string>()).current;
  const open = here.place === ROUTED_PLACE.PERSON;
  const userId = open ? here.params.userId : undefined;
  const workspace = open ? here.params.workspace : undefined;
  const onOpen = (to: string, name: string | undefined, toWorkspace: string) => {
    if (name !== undefined) names.set(to, name);
    if (to === userId && toWorkspace === workspace) return;
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
