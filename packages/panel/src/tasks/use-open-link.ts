import {
  LINK_PLACE,
  type LinkPlace,
  type ReadLink,
  taskNumberOf,
  withTaskId,
} from "@repo/features/link-grammar";
import { MENTION_KIND, type DescriptionMention } from "@repo/features/mention-link";
import type { PagePlace } from "@repo/features/page-wire";
import { isGitHubAddress, isOpenableAddress } from "@repo/host/acts";
import {
  createContext,
  createElement,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { appPlatform } from "../app-platform.js";
import {
  ADDRESS,
  type Address,
  addressOf,
  HERE,
  type Here,
  type Listed,
  ROUTE,
  route,
  THING,
} from "../route.js";
import { useSteadyDoor } from "../steady-door.js";
import { numberedTaskIdNow } from "./use-link-standing.js";

const OpenLinkContext = createContext<((link: ReadLink) => void) | undefined>(undefined);

export const OpenLinkProvider = OpenLinkContext.Provider;

export function useReadLinkOpener(): ((link: ReadLink) => void) | undefined {
  return useContext(OpenLinkContext);
}

export type OpenHere = (href: string) => boolean;

export type OpenAddressHere = (address: Address) => boolean;

const OpenHereContext = createContext<OpenAddressHere | undefined>(undefined);

export const OpenAddressesHere = OpenHereContext.Provider;

function ofLinks(open: OpenHere): OpenAddressHere {
  return (address) => address.href !== undefined && open(address.href);
}

export function OpenHereFirst({
  open,
  children,
}: {
  open: OpenHere;
  children: ReactNode;
}): ReactNode {
  const around = useContext(OpenHereContext);
  const first = useCallback<OpenAddressHere>(
    (address) => ofLinks(open)(address) || around?.(address) === true,
    [open, around],
  );
  return createElement(OpenHereContext.Provider, { value: first }, children);
}

export function OnLeavingHere({
  leaving,
  children,
}: {
  leaving: (address: Address) => void;
  children: ReactNode;
}): ReactNode {
  const around = useContext(OpenHereContext);
  const open = useCallback<OpenAddressHere>(
    (address) => {
      if (around?.(address) === true) return true;
      leaving(address);
      return false;
    },
    [around, leaving],
  );
  return createElement(OpenHereContext.Provider, { value: open }, children);
}

type ListedTasksReader = () => Listed;

const ListedTasksContext = createContext<ListedTasksReader | undefined>(undefined);

export function ListedPullRequests({
  tasks,
  agents,
  children,
}: {
  tasks: Listed["tasks"];
  agents?: Listed["agents"];
  children: ReactNode;
}): ReactNode {
  const read = useSteadyDoor((): Listed => ({ tasks, agents }));
  return createElement(ListedTasksContext.Provider, { value: read }, children);
}

export function PullRequestsOnGitHub({ children }: { children: ReactNode }): ReactNode {
  const around = useContext(OpenHereContext);
  const open = useCallback<OpenAddressHere>(
    (address) => address.kind !== ADDRESS.PULL_REQUEST && around?.(address) === true,
    [around],
  );
  return createElement(
    OpenHereContext.Provider,
    { value: around === undefined ? undefined : open },
    createElement(ListedTasksContext.Provider, { value: undefined }, children),
  );
}

export function openPullRequestsHere(
  here: Extract<Here, { readonly kind: typeof HERE.TASK | typeof HERE.AGENT }>,
  open: (agentId: string, number?: number) => void,
  openPage: (pageId: string, place: PagePlace) => void,
): OpenAddressHere {
  return (address) => {
    if (address.href === undefined) return false;
    const routed = route(address, here);
    if (routed.kind !== ROUTE.PREVIEW) return false;
    const { thing } = routed;
    if (thing.kind === THING.PAGE && thing.place !== undefined) {
      openPage(thing.pageId, thing.place);
      return true;
    }
    if (thing.kind !== THING.PULL_REQUEST) return false;
    open(thing.agentId, thing.number);
    return true;
  };
}

export function placeOfMention(mention: DescriptionMention): LinkPlace {
  return mention.kind === MENTION_KIND.TASK
    ? { kind: LINK_PLACE.TASK, planId: mention.taskId }
    : { kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor: mention.anchor };
}

function byListedTaskId(address: Address): Address {
  if (address.kind !== ADDRESS.PLACE) return address;
  const { link } = address;
  const number = taskNumberOf(link.place);
  const taskId =
    number === undefined ? undefined : numberedTaskIdNow({ workspace: link.workspace, number });
  return taskId === undefined
    ? address
    : { ...address, link: { ...link, place: withTaskId(link.place, taskId) } };
}

function openAddress(
  address: Address,
  doors: {
    readonly openPlace: ((link: ReadLink) => void) | undefined;
    readonly openHere: OpenAddressHere | undefined;
    readonly listed: ListedTasksReader | undefined;
  },
): void {
  const { openPlace, openHere, listed } = doors;
  if (openHere?.(address) === true) return;
  const routed = route(address, {
    kind: HERE.WINDOW,
    opensPlaces: openPlace !== undefined,
    listed: listed?.(),
  });
  if (routed.kind === ROUTE.GO) {
    openPlace?.(routed.link);
  } else if (routed.kind !== ROUTE.EXTERNAL) {
    return;
  } else if (isGitHubAddress(routed.href)) {
    appPlatform().openGitHub(routed.href);
  } else {
    appPlatform().openWeb(routed.href);
  }
}

export function useOpenTask(): ((mention: DescriptionMention) => void) | undefined {
  const open = useOpenPlace();
  return useMemo(
    () =>
      open === undefined
        ? undefined
        : (mention: DescriptionMention) => open(placeOfMention(mention)),
    [open],
  );
}

export function useOpenPlace(): ((place: LinkPlace) => void) | undefined {
  const openPlace = useContext(OpenLinkContext);
  const openHere = useContext(OpenHereContext);
  return useMemo(
    () =>
      openPlace === undefined
        ? undefined
        : (place: LinkPlace) =>
            openAddress(
              { kind: ADDRESS.PLACE, link: { workspace: "", place } },
              { openPlace, openHere, listed: undefined },
            ),
    [openPlace, openHere],
  );
}

export function opensAsLink(href: string): boolean {
  return isGitHubAddress(href) || isOpenableAddress(href);
}

export function useOpenLink(): (href: string) => void {
  const openPlace = useContext(OpenLinkContext);
  const openHere = useContext(OpenHereContext);
  const listed = useContext(ListedTasksContext);
  return useCallback(
    (href: string) => openAddress(byListedTaskId(addressOf(href)), { openPlace, openHere, listed }),
    [openPlace, openHere, listed],
  );
}

export function linkPressOf(
  open: (href: string) => void,
  href: string,
): (event: MouseEvent<HTMLAnchorElement>) => void {
  return (event) => {
    event.preventDefault();
    open(href);
  };
}
