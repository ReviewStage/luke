/**
 * routed-places.ts -- each place the router alone says the window stands on, declared once: its routes, its gate, and every answer the window asks of it.
 *
 * A routed place's route draws it and its own history moves it
 * (`panel-router.tsx`), but the window asks more of it than the router
 * does: whether Back and Forward may reach it, whether it stands over the
 * plan's place, what its step is called, which links Copy link offers on it,
 * which narrow list it steps back to, and which product surface it counts
 * as opened. Each of those is an answer of its declaration here, so a place
 * moved onto the router joins with its route and one declaration, and a
 * declaration missing an answer does not build.
 *
 * Only one place stands at a time, because exactly one leaf route matches
 * an address, so the place standing is read from the router's matches
 * (`useWindowPlace`) and never cleared by another place's door. A place
 * sharing its route with a place the window's state says claims only the
 * addresses its route's gate finds for it, as a workspace not there for
 * the reader claims Home's route under that workspace's address, so the
 * place standing is read with the reader's access.
 */

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { LINK_PLACE, type LinkPlace, taskLinkStep } from "@repo/features/link-grammar";
import { DOCUMENT_REGION } from "@repo/ui/tasks-model";
import {
  type HistoryLocation,
  type RegisteredRouter,
  type RouteIds,
  useRouter,
} from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import { adminLinkFields } from "../admin/routing.js";
import {
  INBOX_WORDS,
  NAMED_STEP,
  type NamedStep,
  type StepTitleTasks,
  taskName,
  VERSION_HISTORY_WORDS,
} from "../history-titles.js";
import {
  agentPageLinks,
  inboxItemPlace,
  LINK_THING,
  type LinkAtHand,
  type LinkThing,
  slugOf,
  type WindowAt,
} from "../links-at-hand.js";
import type { ListBacks, StepTitle } from "../navigation-history.js";
import {
  adminRouteStands,
  type RouteAccess,
  settingsPageRouteStands,
  useRouteAccess,
  versionHistoryRouteStands,
  workspaceRouteStands,
} from "../route-gates.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import type { OpenSurface } from "../use-surface-open.js";

/** A route of the panel's tree, by its id. */
type PanelRouteId = RouteIds<RegisteredRouter["routeTree"]>;

/** The params an address's routes read, every match's together. */
export type PlaceParams = Readonly<Record<string, string | undefined>>;

/** What a declaration reads to name a step later: the task a version history's address names, and the task an Inbox item is of, by the item's id. */
interface PlaceNaming {
  readonly historyTask: string | undefined;
  readonly itemTask: (itemId: string) => string | undefined;
}

/** What the window reads to say whether a step of a routed place is still there: the task a version history's address names, whether a task or an automation still is, and whether a workspace's address step names the workspace listed. */
export interface PlaceThere {
  readonly historyTask: string | undefined;
  readonly taskStands: (taskId: string) => boolean;
  readonly automationStands: (automationId: string) => boolean;
  readonly listed: (workspace: string) => boolean;
}

/** What a declaration reads to offer its links: the Tasks tab, where the window stands, the workspace listed's address step, and the links of the place the window's state says under it. */
interface PlaceLinks {
  readonly tasks: TasksControl;
  readonly at: WindowAt;
  readonly listed: string;
  readonly under: () => readonly LinkAtHand[];
}

/**
 * Everything the window asks of a routed place. Each answer is required,
 * so a declaration missing one does not build; `under` is the answer of the
 * place the window's state says, which a place that stands over it names
 * itself by while its own view has not yet caught up with the router.
 */
export interface PlaceDeclaration {
  /** The routes it stands on, by id, under whichever parent each stands. */
  readonly routes: readonly PanelRouteId[];
  /** Whether an address its routes match is this place, by its params and the reader's access: every one of them but where it shares a route with a place the window's state says. */
  readonly claims: (params: PlaceParams, access: RouteAccess) => boolean;
  /** Whether the window may stand on it with these params: the one predicate its routes' `beforeLoad` and Back and Forward's `reachable` both ask. */
  readonly gate: (params: PlaceParams, access: RouteAccess) => boolean;
  /** Whether what a step of it names is still there, so Back and Forward may go to it: a step naming a task or an automation deleted since is passed over. */
  readonly stillThere: (params: PlaceParams, search: URLSearchParams, there: PlaceThere) => boolean;
  /** Whether it stands over the plan's place beside the sidebar, the window's state staying as it was under it, its workspace its address's. */
  readonly overThePlan: boolean;
  /** Whether Back and Forward pass over a step of it once another workspace is listed than the one its address names, as a place over the plan that the listed workspace's work fills. */
  readonly listedOnly: boolean;
  /** What its step is called as the window stands on it. */
  readonly title: (
    tasks: StepTitleTasks,
    under: () => StepTitle | undefined,
  ) => StepTitle | undefined;
  /** What a step of it listed later is named again by, by the ids its address names; none where its kept name stands. */
  readonly named: (
    params: PlaceParams,
    search: URLSearchParams,
    naming: PlaceNaming,
  ) => NamedStep | undefined;
  /** The links Copy link offers on it, the most specific first, one of them the step's own. */
  readonly links: (held: PlaceLinks) => readonly LinkAtHand[];
  /** The way back to the list a narrow room stands it after, where it has one. */
  readonly narrowList: keyof ListBacks | undefined;
  /** The product surfaces it counts as opened, a version history by the task its address names. */
  readonly surfaces: (
    params: PlaceParams,
    historyTask: string | undefined,
  ) => readonly OpenSurface[];
}

/** A place a workspace's address step names stands only where that workspace is one of the reader's. */
function workspaceGate(params: PlaceParams, access: RouteAccess): boolean {
  return params.workspace === undefined || workspaceRouteStands(params.workspace, access);
}

/** A place that is every address its routes match. */
function everyAddress(): boolean {
  return true;
}

/** A link that names the step the window stands on. */
function stepLink(place: LinkPlace, thing: LinkThing, workspace: string): LinkAtHand {
  return { link: { workspace, place }, thing, step: true };
}

/** A link of something open within the step the window stands on. */
function withinLink(place: LinkPlace, thing: LinkThing, workspace: string): LinkAtHand {
  return { link: { workspace, place }, thing };
}

/** A version history's links: the version chosen, as the step, then its task; the task alone as the step while no version is chosen or a narrow room's list stands alone. */
function versionLinks({ tasks, at }: PlaceLinks): readonly LinkAtHand[] {
  const { region } = tasks;
  if (region.kind !== DOCUMENT_REGION.READY) return [];
  const { task: drawn } = region;
  const workspace = slugOf(tasks.workspaces, drawn.workspaceId);
  // Note that the task's links name it by its number, where it has one, as every link to it is written.
  const planId = taskLinkStep(drawn);
  const task: LinkAtHand = {
    link: { workspace, place: { kind: LINK_PLACE.TASK, planId } },
    thing: LINK_THING.TASK,
    name: drawn.name,
  };
  const revision = tasks.history.selected;
  // A narrow room's version list stands alone, and has no link of its own, so it is the task's step.
  const listedAlone = at.narrow === true && tasks.history.listed;
  if (revision === undefined || listedAlone) return [{ ...task, step: true }];
  return [
    stepLink({ kind: LINK_PLACE.VERSION, planId, revision }, LINK_THING.VERSION, workspace),
    task,
  ];
}

/**
 * Every routed place's declaration. A place moved onto the router is a new
 * entry here beside its route; whatever the window asks of it is answered
 * here, so `satisfies` refuses an entry missing an answer.
 */
export const ROUTED_PLACE = {
  SETTINGS: {
    routes: ["/$workspace/settings", "/app/settings"],
    claims: everyAddress,
    gate: (params, access) =>
      params.page === undefined || settingsPageRouteStands(params.page, access, params.workspace),
    stillThere: () => true,
    overThePlan: false,
    listedOnly: false,
    title: () => ({ label: "Settings" }),
    named: () => undefined,
    links: ({ tasks, at, listed, under }) => {
      if (at.settings === undefined) return under();
      const { view, workspace } = at.settings;
      const slug = workspace === undefined ? listed : slugOf(tasks.workspaces, workspace.id);
      // A narrow room's page list stands alone, so its link names no page.
      const place: LinkPlace =
        at.narrow === true && at.settings.listed === true
          ? { kind: LINK_PLACE.SETTINGS }
          : { kind: LINK_PLACE.SETTINGS, page: view };
      return [stepLink(place, LINK_THING.SETTINGS, slug)];
    },
    narrowList: "settings",
    surfaces: () => [{ surface: PRODUCT_SURFACE.SETTINGS }],
  },
  ADMIN: {
    routes: ["/places/$workspace/admin"],
    claims: everyAddress,
    gate: (_params, access) => adminRouteStands(access),
    stillThere: () => true,
    overThePlan: false,
    listedOnly: false,
    // Note that Admin's step is named as the place the window's state holds under it, as it was while Admin stood in for that place.
    title: (_tasks, under) => under(),
    named: () => undefined,
    // Its workspace is only the one listed, since the place reads every workspace's accounts.
    links: ({ at, listed, under }) => {
      if (at.admin === undefined) return under();
      const root = { kind: LINK_PLACE.ADMIN } as const;
      const fields = adminLinkFields(at.admin);
      if (Object.keys(fields).length === 0) return [stepLink(root, LINK_THING.ADMIN, listed)];
      return [
        stepLink({ ...root, ...fields }, LINK_THING.ADMIN_PAGE, listed),
        withinLink(root, LINK_THING.ADMIN, listed),
      ];
    },
    narrowList: undefined,
    surfaces: () => [{ surface: PRODUCT_SURFACE.ADMIN }],
  },
  BOARD: {
    routes: ["/places/$workspace/tasks"],
    claims: everyAddress,
    gate: workspaceGate,
    stillThere: () => true,
    overThePlan: true,
    listedOnly: true,
    title: (tasks, under) => (tasks.boardView.open ? { label: "Tasks" } : under()),
    named: () => undefined,
    links: ({ tasks, listed, under }) =>
      tasks.boardView.open
        ? [stepLink({ kind: LINK_PLACE.BOARD }, LINK_THING.BOARD, listed)]
        : under(),
    narrowList: undefined,
    surfaces: () => [{ surface: PRODUCT_SURFACE.BOARD }],
  },
  PERSON: {
    routes: ["/places/$workspace/person/$userId"],
    claims: everyAddress,
    gate: workspaceGate,
    stillThere: () => true,
    overThePlan: true,
    listedOnly: true,
    title: (tasks, under) =>
      tasks.personView.userId === undefined
        ? under()
        : { label: tasks.personView.name ?? "Profile" },
    // A person's step is listed by the name they go by now.
    named: (params) =>
      params.userId === undefined ? undefined : { kind: NAMED_STEP.PERSON, userId: params.userId },
    // A person's page is theirs in the workspace it opened in, which their link names.
    links: ({ tasks, listed, under }) => {
      const { userId, workspaceId } = tasks.personView;
      if (userId === undefined) return under();
      const home = workspaceId === undefined ? listed : slugOf(tasks.workspaces, workspaceId);
      return [stepLink({ kind: LINK_PLACE.PERSON, userId }, LINK_THING.PERSON, home)];
    },
    narrowList: undefined,
    surfaces: (params) => [{ surface: PRODUCT_SURFACE.PERSON, of: params.userId }],
  },
  AUTOMATIONS: {
    routes: ["/places/$workspace/automation-pages"],
    claims: everyAddress,
    gate: workspaceGate,
    // An automation's page stands no more once it is deleted.
    stillThere: (params, _search, there) =>
      params.automationId === undefined || there.automationStands(params.automationId),
    overThePlan: true,
    listedOnly: true,
    title: (tasks, under) => (tasks.automationsView.open ? { label: "Automations" } : under()),
    named: () => undefined,
    links: ({ tasks, listed, under }) => {
      if (!tasks.automationsView.open) return under();
      const list: LinkPlace = { kind: LINK_PLACE.AUTOMATIONS };
      const { place } = tasks.automationsView;
      if (place.kind === AUTOMATIONS_PAGE.EDIT) {
        const automation: LinkPlace = {
          kind: LINK_PLACE.AUTOMATION,
          automationId: place.automationId,
        };
        return [
          stepLink(automation, LINK_THING.AUTOMATION, listed),
          withinLink(list, LINK_THING.AUTOMATIONS, listed),
        ];
      }
      // A new automation's page is a step with no link of its own, so it offers the list it is in.
      if (place.kind === AUTOMATIONS_PAGE.NEW) {
        return [withinLink(list, LINK_THING.AUTOMATIONS, listed)];
      }
      return [stepLink(list, LINK_THING.AUTOMATIONS, listed)];
    },
    narrowList: "runs",
    surfaces: () => [{ surface: PRODUCT_SURFACE.AUTOMATIONS }],
  },
  VERSION_HISTORY: {
    routes: ["/version-history"],
    claims: everyAddress,
    gate: (params, access) =>
      params.workspace === undefined || versionHistoryRouteStands(access, params.workspace),
    // Note that a version history is passed over once its task is deleted, as the task's own step is.
    stillThere: (_params, _search, there) =>
      there.historyTask === undefined || there.taskStands(there.historyTask),
    overThePlan: false,
    listedOnly: false,
    // Note that a history whose task is not yet bound for is named as the place under it, as it stands until its task opens.
    title: (tasks, under) => {
      if (tasks.boundFor === undefined) return under();
      const name = taskName(tasks, tasks.boundFor);
      return name === undefined ? undefined : { label: name, detail: VERSION_HISTORY_WORDS };
    },
    // A version history's step is listed by its task's name now.
    named: (_params, _search, { historyTask }) =>
      historyTask === undefined
        ? undefined
        : { kind: NAMED_STEP.VERSION_HISTORY, taskId: historyTask },
    // Note that a history whose task is not yet bound for offers the place under it, as it stands until its task opens.
    links: (held) => (held.tasks.boundFor === undefined ? held.under() : versionLinks(held)),
    narrowList: "versions",
    surfaces: (_params, historyTask) =>
      historyTask === undefined
        ? []
        : [{ surface: PRODUCT_SURFACE.VERSION_HISTORY, of: historyTask }],
  },
  AGENT: {
    // Note that only the page's own address is its place: a worker's, its Changes', or a message's beneath it is a task's tab's, as the window's state says.
    routes: ["/places/$workspace/agent/$agentId/"],
    claims: everyAddress,
    // Note that its route draws the page under any address, as it always has, so this gate is Back and Forward's alone.
    gate: workspaceGate,
    stillThere: () => true,
    overThePlan: true,
    // Note that an agent's page is reached under whichever workspace it opened in, as it always was.
    listedOnly: false,
    title: (tasks, under) => (tasks.agentView.agentId === undefined ? under() : { label: "Agent" }),
    named: () => undefined,
    links: ({ tasks, at, listed, under }) => {
      const { agentId } = tasks.agentView;
      return agentId === undefined ? under() : agentPageLinks(tasks, at, listed, agentId);
    },
    narrowList: undefined,
    surfaces: (params) => [{ surface: PRODUCT_SURFACE.AGENT, of: params.agentId }],
  },
  UNKNOWN_WORKSPACE: {
    // Note that it shares Home's route, whose `beforeLoad` throws `notFound()` where it claims the address (`panel-router.tsx`).
    routes: ["/places/$workspace/"],
    claims: (params, access) =>
      params.workspace !== undefined && !workspaceRouteStands(params.workspace, access),
    // A workspace's address naming none of the reader's is no place of theirs to come back to, so Back and Forward pass over it.
    gate: () => false,
    stillThere: () => true,
    overThePlan: true,
    listedOnly: false,
    // Note that it is no step, so it has no name of its own.
    title: () => undefined,
    named: () => undefined,
    // It has no link of the reader's to offer, so the tab keeps the address it was opened at.
    links: () => [],
    narrowList: undefined,
    surfaces: () => [],
  },
  INBOX: {
    routes: ["/places/$workspace/inbox"],
    claims: everyAddress,
    gate: workspaceGate,
    // Note that an Inbox narrowed to a task is passed over once the task is deleted, as the task's own step is.
    stillThere: (params, search, there) => {
      const narrowed = params.taskId ?? search.get("task") ?? undefined;
      return narrowed === undefined || there.taskStands(narrowed);
    },
    overThePlan: true,
    listedOnly: true,
    title: (tasks, under) => {
      if (!tasks.inboxView.open) return under();
      const { chosen } = tasks.inboxView;
      const holder = chosen !== undefined && "taskId" in chosen ? chosen.taskId : undefined;
      // An Inbox narrowed to a task is named by the task, every item it shows being that task's.
      const detail = taskName(tasks, holder) ?? taskName(tasks, tasks.inboxView.narrowed);
      return { label: INBOX_WORDS, detail };
    },
    // An Inbox step is named by its chosen item's task, else the one its list is narrowed to.
    named: (params, search, { itemTask }) => {
      const holder = params.itemId === undefined ? undefined : itemTask(params.itemId);
      const narrowed = params.taskId ?? search.get("task") ?? undefined;
      return { kind: NAMED_STEP.INBOX, taskId: holder ?? narrowed };
    },
    links: ({ tasks, at, listed, under }) => {
      if (!tasks.inboxView.open) return under();
      // An Inbox narrowed to a task is linked by it, so a copied link or a reload opens it narrowed again.
      const inboxPlace: LinkPlace =
        at.inboxTask === undefined
          ? { kind: LINK_PLACE.INBOX }
          : { kind: LINK_PLACE.INBOX, planId: at.inboxTask };
      const inbox = stepLink(inboxPlace, LINK_THING.INBOX, listed);
      const { chosen } = tasks.inboxView;
      if (chosen === undefined) return [inbox];
      const item = inboxItemPlace(chosen);
      // An item standing alone, in a narrow room or an Inbox showing one column by its own width, is a step of its own.
      if (at.narrow === true || tasks.inboxView.single === true) {
        return [
          stepLink(item, LINK_THING.INBOX_ITEM, listed),
          withinLink(inboxPlace, LINK_THING.INBOX, listed),
        ];
      }
      return [withinLink(item, LINK_THING.INBOX_ITEM, listed), inbox];
    },
    narrowList: "inbox",
    surfaces: () => [{ surface: PRODUCT_SURFACE.INBOX }],
  },
} as const satisfies { readonly [Name in string]: PlaceDeclaration };

export type RoutedPlace = (typeof ROUTED_PLACE)[keyof typeof ROUTED_PLACE];

const PLACES: readonly RoutedPlace[] = Object.values(ROUTED_PLACE);

/** What a place's gate reads of a match: its route and the params it was matched with. */
interface RouteMatchSeen {
  readonly routeId: string;
  readonly params: PlaceParams;
}

/** The routed place `matches` stand on for a reader with `access`; none where they stand on a place the window's state says. */
export function routedPlaceOf(
  matches: readonly RouteMatchSeen[],
  access: RouteAccess,
): RoutedPlace | undefined {
  const params = placeParamsOf(matches);
  for (const match of matches) {
    const place = PLACES.find(
      (each) => each.routes.some((id) => id === match.routeId) && each.claims(params, access),
    );
    if (place !== undefined) return place;
  }
  return undefined;
}

/** The params every match of an address reads, together. */
export function placeParamsOf(matches: readonly RouteMatchSeen[]): PlaceParams {
  return Object.assign({}, ...matches.map((match) => match.params));
}

/**
 * Whether Back and Forward may go to a step at what `matches` name: a place
 * the window's state says always may; a routed place only where its gate
 * lets the window stand, what it names is still there, and, where the
 * place is the listed workspace's alone, the workspace its address names is
 * the one listed, as it was.
 */
export function routedStepStands(
  matches: readonly RouteMatchSeen[],
  search: URLSearchParams,
  access: RouteAccess,
  there: PlaceThere,
): boolean {
  const place = routedPlaceOf(matches, access);
  if (place === undefined) return true;
  const params = placeParamsOf(matches);
  if (!place.gate(params, access) || !place.stillThere(params, search, there)) return false;
  return !place.listedOnly || params.workspace === undefined || there.listed(params.workspace);
}

/** The location the router's history stands on, redrawn as it moves. */
function useHistoryLocation(): HistoryLocation {
  const { history } = useRouter();
  return useSyncExternalStore(history.subscribe, () => history.location);
}

/** Where the window stands by the router: the routed place there, where one is, the address, the route its address ends on, and the params and query its routes read. */
export interface WindowPlace {
  readonly place: RoutedPlace | undefined;
  readonly href: string;
  /** The id of the route the address ends on, the deepest it matches; none where it matches none. */
  readonly leaf: string | undefined;
  readonly params: PlaceParams;
  /** The keys its query carries, each the string it is, as the router reads them (`panel-router.tsx`). */
  readonly search: Readonly<Record<string, string>>;
}

/**
 * Where the window stands by the router, from the matches of the address
 * its history stands on. Note that it is read off the router's history
 * itself rather than the router's matches as they load, because the history
 * moves at once while those matches wait on a route's chunk still on its
 * way, and the window must know a routed place stands from the moment its
 * entry is written (`navigation-history.ts`).
 */
export function useWindowPlace(): WindowPlace {
  const router = useRouter();
  const access = useRouteAccess();
  const { pathname, href, search } = useHistoryLocation();
  const matches = useMemo(() => router.matchRoutes(pathname), [router, pathname]);
  return useMemo(
    () => ({
      place: routedPlaceOf(matches, access),
      href,
      leaf: matches.at(-1)?.routeId,
      params: matches.at(-1)?.params ?? {},
      search: Object.fromEntries(new URLSearchParams(search)),
    }),
    [matches, access, href, search],
  );
}
