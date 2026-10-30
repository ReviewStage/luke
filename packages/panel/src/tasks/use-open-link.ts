import { LINK_PLACE, type LinkPlace, type ReadLink } from "@luke/features/link-grammar";
import { MENTION_KIND, type PlanMention } from "@luke/features/mention-link";
import { isGitHubAddress, isWebAddress } from "@luke/host/acts";
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
import { addressOf, HERE, type Here, type Listed, ROUTE, route, THING } from "../route.js";
import { useSteadyDoor } from "../steady-door.js";

/**
 * use-open-link.ts -- how a link in written words opens: a transcript's, an agent tab's, or an Inbox item's.
 *
 * A Luke link, the address of a task, a section, an agent, an Inbox item,
 * or any other place in Luke (`@luke/features/link-grammar`), opens in the
 * window, on that place, never the browser, as Linear's and Slack's own
 * links open in their apps; one written before the link was settled
 * (`luke://plan/<id>`) still opens its task. The window's opener for a
 * place (`App`'s) is handed down on a context, as Settings' is
 * (`../open-settings.tsx`); outside the window, as in a test of one
 * surface, there is none, and a Luke link opens in the browser as any
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
 * (`OpenHereProvider`), as the window's Inbox opens a file, a page, or a pull
 * request of the item's task in the panel beside the item rather than
 * leaving for the task, and a task, or an agent with no task, opens a pull
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

/** Hands the window's opener for a place in Luke to everything under it. */
export const OpenLinkProvider = OpenLinkContext.Provider;

/** The window's opener for a place in Luke as a link reads it, for a place that opens some of them itself before handing them on; nothing outside the window. */
export function useReadLinkOpener(): ((link: ReadLink) => void) | undefined {
  return useContext(OpenLinkContext);
}

/** Opens a link where the place stands, answering whether it did; one it did not is the window's to open. */
export type OpenHere = (href: string) => boolean;

const OpenHereContext = createContext<OpenHere | undefined>(undefined);

/** Hands everything under it the place's own opener, asked first of every link opened there. */
export const OpenHereProvider = OpenHereContext.Provider;

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
  const first = useCallback<OpenHere>(
    (href) => open(href) || around?.(href) === true,
    [open, around],
  );
  return createElement(OpenHereContext.Provider, { value: first }, children);
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
 * which already is that pull request.
 */
export function PullRequestsOnGitHub({ children }: { children: ReactNode }): ReactNode {
  return createElement(
    OpenHereContext.Provider,
    { value: undefined },
    createElement(ListedTasksContext.Provider, { value: undefined }, children),
  );
}

/**
 * A task's or an agent's page's opener for the pull requests the route table
 * opens beside it (`route.ts`): one of its agents', in that agent's Pull
 * request tab through `open`, or another of its repository, by its number in
 * its first agent's; any other address is the window's.
 */
export function openPullRequestsHere(
  here: Extract<Here, { readonly kind: typeof HERE.TASK | typeof HERE.AGENT }>,
  open: (agentId: string, number?: number) => void,
): OpenHere {
  return (href) => {
    const routed = route(addressOf(href), here);
    if (routed.kind !== ROUTE.PREVIEW || routed.thing.kind !== THING.PULL_REQUEST) return false;
    open(routed.thing.agentId, routed.thing.number);
    return true;
  };
}

/** The place a mention of a plan, or of one of its sections, names. */
function placeOfMention(mention: PlanMention): LinkPlace {
  return mention.kind === MENTION_KIND.TASK
    ? { kind: LINK_PLACE.TASK, planId: mention.taskId }
    : { kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor: mention.anchor };
}

/** The window's opener for a plan, or one of its sections, as a mention's chip names it; nothing outside the window. */
export function useOpenTask(): ((mention: PlanMention) => void) | undefined {
  const open = useContext(OpenLinkContext);
  return useMemo(
    () =>
      open === undefined
        ? undefined
        : (mention: PlanMention) => open({ workspace: "", place: placeOfMention(mention) }),
    [open],
  );
}

/** The window's opener for a place in Luke, as a link to it would open it, one of an agent's messages among them; nothing outside the window. */
export function useOpenPlace(): ((place: LinkPlace) => void) | undefined {
  const open = useContext(OpenLinkContext);
  return useMemo(
    () => (open === undefined ? undefined : (place: LinkPlace) => open({ workspace: "", place })),
    [open],
  );
}

/**
 * Whether a link is one the window opens. Note that it asks the two acts'
 * own schemas, because an address both refuse would be drawn as a press
 * that opens nothing; a Luke link is a web address, and both take it.
 */
export function opensAsLink(href: string): boolean {
  return isGitHubAddress(href) || isWebAddress(href);
}

/** Opens a link {@link opensAsLink} admits: where the place it is pressed on opens it, else a Luke link in the window where it can be, a listed task's or a listed agent's on no task's pull request in its Pull request tab, anything else in the browser, over the capability it belongs to (`route.ts`). */
export function useOpenLink(): (href: string) => void {
  const openPlace = useContext(OpenLinkContext);
  const openHere = useContext(OpenHereContext);
  const listed = useContext(ListedTasksContext);
  return useCallback(
    (href: string) => {
      if (openHere?.(href) === true) return;
      const routed = route(addressOf(href), {
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
    },
    [openPlace, openHere, listed],
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
