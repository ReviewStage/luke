import { LINK_PLACE, type LinkPlace, type ReadLink, readLink } from "@luke/features/luke-link";
import { decodeMention, MENTION_KIND, type PlanMention } from "@luke/features/mention-link";
import { ACT_KIND, isGitHubAddress, isWebAddress } from "@luke/host/acts";
import { pullRequestAgentOf } from "@luke/ui/pull-request-link";
import { createContext, useCallback, useContext, useMemo } from "react";
import { useAct } from "../act";

/**
 * use-open-link.ts -- how a link in written words opens: a transcript's, the Call tab's, an agent tab's, or an Inbox item's.
 *
 * A Luke link, the address of a task, a section, an agent, an Inbox item,
 * or any other place in Luke (`@luke/features/luke-link`), opens in the
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
 * request one of its agents opened in that agent's Pull request tab rather
 * than on GitHub (`openPullRequestsHere`).
 */

const OpenLinkContext = createContext<((link: ReadLink) => void) | undefined>(undefined);

/** Hands the window's opener for a place in Luke to everything under it. */
export const OpenLinkProvider = OpenLinkContext.Provider;

/** Opens a link where the place stands, answering whether it did; one it did not is the window's to open. */
export type OpenHere = (href: string) => boolean;

const OpenHereContext = createContext<OpenHere | undefined>(undefined);

/** Hands everything under it the place's own opener, asked first of every link opened there. */
export const OpenHereProvider = OpenHereContext.Provider;

/**
 * A place's opener for its agents' pull requests: a link to the page on
 * GitHub of one of them, however it is spelled, opens through `open`, the
 * agent's Pull request tab, and any other link is the window's.
 */
export function openPullRequestsHere(
  pullRequests: ReadonlyMap<string, { readonly url: string }>,
  open: (agentId: string) => void,
): OpenHere {
  return (href) => {
    const opened = [...pullRequests].map(([agentId, { url }]) => ({ agentId, url }));
    const agentId = pullRequestAgentOf(href, opened);
    if (agentId === undefined) return false;
    open(agentId);
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

/** The place a Luke link names, or the plan a link written before the link was settled names; nothing for any other address. */
function lukeLinkOf(href: string): ReadLink | undefined {
  const read = readLink(href);
  if (read !== undefined) return read;
  // Note that no repository is handed, so a GitHub page is never read as a file here: it opens on GitHub.
  const mention = decodeMention(href, null);
  return mention?.kind === MENTION_KIND.TASK || mention?.kind === MENTION_KIND.SECTION
    ? { workspace: "", place: placeOfMention(mention) }
    : undefined;
}

/** Opens a link {@link opensAsLink} admits: a Luke link in the window where it can be, anything else in the browser, over the act it belongs to. */
export function useOpenLink(): (href: string) => void {
  const { tell } = useAct();
  const openPlace = useContext(OpenLinkContext);
  const openHere = useContext(OpenHereContext);
  return useCallback(
    (href: string) => {
      if (openHere?.(href) === true) return;
      const link = openPlace === undefined ? undefined : lukeLinkOf(href);
      if (openPlace !== undefined && link !== undefined) {
        openPlace(link);
      } else if (isGitHubAddress(href)) {
        tell(ACT_KIND.GITHUB_OPEN, { url: href });
      } else {
        tell(ACT_KIND.WEB_OPEN, { url: href });
      }
    },
    [tell, openPlace, openHere],
  );
}
