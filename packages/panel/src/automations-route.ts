import { type NavigateOptions, useNavigate, useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { ROUTED_PLACE } from "./route-gates.js";
import { pathUnder, useRoutedLocation } from "./routed-location.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "./tasks/use-tasks-tab.js";

const AUTOMATIONS_LIST: AutomationsPlace = { kind: AUTOMATIONS_PAGE.LIST };

const AUTOMATIONS_LEAF = {
  "/places/$workspace/automation-pages/automations/": { kind: AUTOMATIONS_PAGE.LIST, runs: false },
  "/places/$workspace/automation-pages/automations/runs": {
    kind: AUTOMATIONS_PAGE.RUNS,
    runs: false,
  },
  "/places/$workspace/automation-pages/automations/new": {
    kind: AUTOMATIONS_PAGE.NEW,
    runs: false,
  },
  "/places/$workspace/automation-pages/automation/$automationId/": {
    kind: AUTOMATIONS_PAGE.EDIT,
    runs: false,
  },
  "/places/$workspace/automation-pages/automation/$automationId/runs": {
    kind: AUTOMATIONS_PAGE.EDIT,
    runs: true,
  },
  "/places/$workspace/automation-pages/automation/$automationId/run/$runId": {
    kind: AUTOMATIONS_PAGE.EDIT,
    runs: true,
  },
} as const;

export interface AutomationsRoute {
  readonly open: boolean;
  readonly place: AutomationsPlace;
  readonly runs: boolean;
  readonly standingIn: string | undefined;
  readonly deleted: ReadonlySet<string>;
  readonly setupAddress: string | undefined;
  readonly onOpen: (to: AutomationsPlace, workspace: string) => void;
  readonly onRuns: (shown: boolean) => void;
  readonly onClose: () => void;
  readonly onTurn: (workspace: string) => void;
}

function placeOf(
  leaf: string | undefined,
  params: Readonly<Record<string, string | undefined>>,
): { place: AutomationsPlace; runs: boolean } | undefined {
  const page = Object.entries(AUTOMATIONS_LEAF).find(([id]) => id === leaf)?.[1];
  if (page === undefined) return undefined;
  const { automationId, runId } = params;
  if (page.kind !== AUTOMATIONS_PAGE.EDIT) return { place: { kind: page.kind }, runs: false };
  if (automationId === undefined) return undefined;
  const place: AutomationsPlace =
    runId === undefined
      ? { kind: AUTOMATIONS_PAGE.EDIT, automationId }
      : { kind: AUTOMATIONS_PAGE.EDIT, automationId, runId };
  return { place, runs: page.runs };
}

function navigationTo(to: AutomationsPlace, workspace: string): NavigateOptions {
  switch (to.kind) {
    case AUTOMATIONS_PAGE.LIST:
      return { to: "/$workspace/automations", params: { workspace } };
    case AUTOMATIONS_PAGE.RUNS:
      return { to: "/$workspace/automations/runs", params: { workspace } };
    case AUTOMATIONS_PAGE.NEW:
      return { to: "/$workspace/automations/new", params: { workspace } };
    case AUTOMATIONS_PAGE.EDIT:
      return to.runId === undefined
        ? {
            to: "/$workspace/automation/$automationId",
            params: { workspace, automationId: to.automationId },
          }
        : {
            to: "/$workspace/automation/$automationId/run/$runId",
            params: { workspace, automationId: to.automationId, runId: to.runId },
          };
  }
}

export function useAutomationsRoute(input: { onClose: () => void }): AutomationsRoute {
  const router = useRouter();
  const navigate = useNavigate();
  const here = useRoutedLocation();
  const deleted = useRef(new Set<string>()).current;
  const standing =
    here.place === ROUTED_PLACE.AUTOMATIONS ? placeOf(here.leaf, here.params) : undefined;
  const standingIn = standing === undefined ? undefined : here.params.workspace;
  const onOpen = (to: AutomationsPlace, workspace: string) => {
    if (to.kind === AUTOMATIONS_PAGE.LIST && to.deleted !== undefined) deleted.add(to.deleted);
    const options = navigationTo(to, workspace);
    if (router.buildLocation(options).href === here.href) return;
    const replace = to.kind === AUTOMATIONS_PAGE.EDIT && to.created === true;
    void navigate({ ...options, replace });
  };
  const automation =
    standing?.place.kind === AUTOMATIONS_PAGE.EDIT && standingIn !== undefined
      ? { workspace: standingIn, automationId: standing.place.automationId }
      : undefined;
  const setup =
    automation === undefined
      ? undefined
      : ({ to: "/$workspace/automation/$automationId", params: automation } as const);
  const onRuns = (shown: boolean) => {
    if (setup === undefined || standing?.runs === shown) return;
    if (shown)
      void navigate({ to: "/$workspace/automation/$automationId/runs", params: setup.params });
    else void navigate({ ...setup, replace: true });
  };
  const onTurn = (workspace: string) => {
    if (standingIn === undefined || standingIn === workspace) return;
    const { pathname } = router.history.location;
    void navigate({ href: pathUnder(pathname, workspace), replace: true });
  };
  return {
    open: standing !== undefined,
    place: standing?.place ?? AUTOMATIONS_LIST,
    runs: standing?.runs ?? false,
    standingIn,
    deleted,
    setupAddress:
      setup === undefined || standing?.runs !== true ? undefined : router.buildLocation(setup).href,
    onOpen,
    onRuns,
    onClose: input.onClose,
    onTurn,
  };
}
