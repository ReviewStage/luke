import {
  LINK_PLACE,
  type LinkPlace,
  type ReadLink,
  taskNumberOf,
  withTaskId,
} from "@repo/features/link-grammar";
import { type DescriptionMention, MENTION_KIND } from "@repo/features/mention-link";
import type { PagePlace } from "@repo/features/page-wire";
import { isGitHubAddress, isOpenableAddress } from "@repo/host/acts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
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

/**
 * use-open-link.ts -- how a link in written words opens: a transcript's, an agent tab's, or an Inbox item's.
 *
 * An app link, the address of a task, a section, an agent, an Inbox item,
 * or any other place in the app (`@repo/features/link-grammar`), opens in the
 * window, on that place, never the browser, as Linear's and Slack's own
 * links open in their apps; one written before the link was settled
 * (`luke://plan/<id>`) still opens its task. The window's opener for a
 * place (`App`'s) is handed down on a context, as Settings' is
 * (`../open-settings.tsx`); outside the window, as in a test of one
 * surface, there is none, and an app link opens in the browser as any
 * other web page does.
 *
 * A page on GitHub, such as the pull request an agent opened, goes through
 * `github.open`, the act every GitHub press in the window goes through; any
 * other web page goes through `web.open`. Both open in the default browser,
 * and neither asks first. An address neither act takes — a `file:`, a
 * `javascript:`, another app's scheme — is no link, and the surface draws
 * its words going nowhere.
 *
 * A place may open some links where it stands before the window does
 * (`OpenAddressesHere`), as the window's Inbox opens a file, a page, or a pull
 * request of the item's task in the panel beside the item rather than
 * leaving for the task, and a place a part names rather than a link writes,
 * an agent a message's sender names or a review thread a Pull request tab
 * jumps to, is asked of it the same way (`useOpenPlace`,
 * `OpenAddressesHere`); a task, or an agent with no task, opens a pull
 * request one of its agents opened in that agent's Pull request tab, and any
 * other pull request of its repository in a Pull request tab by its number,
 * rather than on GitHub (`openPullRequestsHere`). Past the place, the window opens
 * a pull request any listed task's agent opened in that agent's Pull request
 * tab, on its task (`ListedPullRequests`), wherever it is pressed:
 * a thread, a version, a task's card, or another task. Inside a pull
 * request's own tab, a link leaves for GitHub (`PullRequestsOnGitHub`).
 * Where each opens is the route table's (`../route.ts`), which each place,
 * then the window, asks of the link's address.
 */

const OpenLinkContext = createContext<((link: ReadLink) => void) | undefined>(undefined);

/** Hands the window's opener for a place in the app to everything under it. */
export const OpenLinkProvider = OpenLinkContext.Provider;

/** The window's opener for a place in the app as a link reads it, for a place that opens some of them itself before handing them on; nothing outside the window. */
export function useReadLinkOpener(): ((link: ReadLink) => void) | undefined {
  return useContext(OpenLinkContext);
}

/** Opens a link where the place stands, answering whether it did; one it did not is the window's to open. */
export type OpenHere = (href: string) => boolean;

/** Opens an address where the place stands, a place handed rather than written among them, answering whether it did; one it did not is the window's to open. */
export type OpenAddressHere = (address: Address) => boolean;

const OpenHereContext = createContext<OpenAddressHere | undefined>(undefined);

/** Hands everything under it the place's own opener of addresses, asked first of every link opened there and every place a part there names. */
export const OpenAddressesHere = OpenHereContext.Provider;

/** Only what a link writes, which a place handed rather than written never is. */
function ofLinks(open: OpenHere): OpenAddressHere {
  return (address) => address.href !== undefined && open(address.href);
}

/**
 * Under it, `open` is asked first of every link opened, and any place's own
 * opener around it after, as a pull request's tab opens a link to one of
 * its own comments on GitHub at that comment (`pull-request-anchors.ts`).
 */
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

/**
 * Under it, an address the place around opens nothing of, so the window
 * goes to it, is told to `leaving` first, as a link pressed in the side
 * panel to an agent elsewhere carries the panel along.
 */
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

/** Reads the tasks and the agents on no task the window lists as they stand now. */
type ListedTasksReader = () => Listed;

const ListedTasksContext = createContext<ListedTasksReader | undefined>(undefined);

/**
 * Hands everything under it the tasks and the agents on no task the window
 * lists, whose pull requests open in their Pull request tabs. Note that it hands a reader
 * standing across draws rather than the list, which is read as a link is
 * opened, because the list is new on every patch to any listed task, and
 * every part opening links would be drawn again with it.
 */
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

/**
 * Under it, a link to a pull request leaves for GitHub, neither the place
 * nor the window opening it in a tab: as inside a pull request's own tab,
 * which already is that pull request. Any other address is still the
 * place's to open first, as a review thread the tab jumps to is beside an
 * Inbox item.
 */
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

/**
 * A task's or an agent's page's opener for what the route table opens beside
 * it (`route.ts`): a pull request of one of its agents', in that agent's Pull
 * request tab through `open`, or another of its repository, by its number in
 * its first agent's; and a page of another place through `openPage`, read on
 * that place; any other address is the window's.
 */
export function openPullRequestsHere(
  here: Extract<Here, { readonly kind: typeof HERE.TASK | typeof HERE.AGENT }>,
  open: (agentId: string, number?: number) => void,
  openPage: (pageId: string, place: PagePlace) => void,
): OpenAddressHere {
  return (address) => {
    // Only what a link writes, which a place handed rather than written never is.
    if (address.href === undefined) return false;
    const routed = route(address, here);
    if (routed.kind !== ROUTE.BESIDE) return false;
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

/** The place a mention of a plan, or of one of its sections, names. */
export function placeOfMention(mention: DescriptionMention): LinkPlace {
  return mention.kind === MENTION_KIND.TASK
    ? { kind: LINK_PLACE.TASK, planId: mention.taskId }
    : { kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor: mention.anchor };
}

/**
 * The address with the task its place names by its number, `…/task/42`,
 * named by its id where the window lists that task, so a place asked of it
 * knows the task as its own; any other address as it is. Note that a number
 * the window lists no task for stays a number, which only the window opens,
 * finding the task on the service (`use-tasks-tab.ts`'s `openLink`).
 */
function byListedTaskId(address: Address, client: QueryClient): Address {
  if (address.kind !== ADDRESS.PLACE) return address;
  const { link } = address;
  const number = taskNumberOf(link.place);
  const taskId =
    number === undefined
      ? undefined
      : numberedTaskIdNow(client)({ workspace: link.workspace, number });
  return taskId === undefined
    ? address
    : { ...address, link: { ...link, place: withTaskId(link.place, taskId) } };
}

/** Opens an address where the place it is pressed on opens it, else where the window does (`route.ts`): a place in the app there, a listed task's or a listed agent's on no task's pull request in its Pull request tab, anything else in the browser. */
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

/** The opener for a plan, or one of its sections, as a mention's chip names it: where the place it is pressed on opens it, else in the window; nothing outside the window. */
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

/** The opener for a place in the app a part names rather than a link writes, as a link to it would open it, one of an agent's messages among them: where the place it is pressed on opens it, else in the window; nothing outside the window. */
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

/**
 * Whether a link is one the window opens. Note that it asks the two acts'
 * own schemas, because an address both refuse would be drawn as a press
 * that opens nothing; an app link is a web address, and both take it.
 */
export function opensAsLink(href: string): boolean {
  return isGitHubAddress(href) || isOpenableAddress(href);
}

/** Opens a link {@link opensAsLink} admits: where the place it is pressed on opens it, else an app link in the window where it can be, a listed task's or a listed agent's on no task's pull request in its Pull request tab, anything else in the browser, over the capability it belongs to (`route.ts`). */
export function useOpenLink(): (href: string) => void {
  const openPlace = useContext(OpenLinkContext);
  const openHere = useContext(OpenHereContext);
  const listed = useContext(ListedTasksContext);
  const queryClient = useQueryClient();
  return useCallback(
    (href: string) =>
      openAddress(byListedTaskId(addressOf(href), queryClient), { openPlace, openHere, listed }),
    [openPlace, openHere, listed, queryClient],
  );
}

/**
 * The press of a link that opens a page outside the window, over `open`
 * ({@link useOpenLink}'s): the page opens through the platform's link-open
 * act, so a refused address toasts as any refused open does, and the browser
 * does not follow the address a second time. Note that the link is still an
 * `<a href>`, so a right-click offers its link menu and a reader's link list
 * finds it.
 */
export function linkPressOf(
  open: (href: string) => void,
  href: string,
): (event: MouseEvent<HTMLAnchorElement>) => void {
  return (event) => {
    event.preventDefault();
    open(href);
  };
}
