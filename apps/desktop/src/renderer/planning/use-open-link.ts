import { LINK_PLACE, type LinkPlace, type ReadLink, readLink } from "@luke/features/luke-link";
import { decodeMention, MENTION_KIND, type PlanMention } from "@luke/features/mention-link";
import { ACT_KIND, isGitHubAddress, isWebAddress } from "@luke/host/acts";
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
 */

const OpenLinkContext = createContext<((link: ReadLink) => void) | undefined>(undefined);

/** Hands the window's opener for a place in Luke to everything under it. */
export const OpenLinkProvider = OpenLinkContext.Provider;

/** The place a mention of a plan, or of one of its sections, names. */
function placeOfMention(mention: PlanMention): LinkPlace {
  return mention.kind === MENTION_KIND.PLAN
    ? { kind: LINK_PLACE.TASK, planId: mention.planId }
    : { kind: LINK_PLACE.SECTION, planId: mention.planId, anchor: mention.anchor };
}

/** The window's opener for a plan, or one of its sections, as a mention's chip names it; nothing outside the window. */
export function useOpenPlan(): ((mention: PlanMention) => void) | undefined {
  const open = useContext(OpenLinkContext);
  return useMemo(
    () =>
      open === undefined
        ? undefined
        : (mention: PlanMention) => open({ workspace: "", place: placeOfMention(mention) }),
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
  return mention?.kind === MENTION_KIND.PLAN || mention?.kind === MENTION_KIND.SECTION
    ? { workspace: "", place: placeOfMention(mention) }
    : undefined;
}

/** Opens a link {@link opensAsLink} admits: a Luke link in the window where it can be, anything else in the browser, over the act it belongs to. */
export function useOpenLink(): (href: string) => void {
  const { tell } = useAct();
  const openPlace = useContext(OpenLinkContext);
  return useCallback(
    (href: string) => {
      const link = openPlace === undefined ? undefined : lukeLinkOf(href);
      if (openPlace !== undefined && link !== undefined) {
        openPlace(link);
      } else if (isGitHubAddress(href)) {
        tell(ACT_KIND.GITHUB_OPEN, { url: href });
      } else {
        tell(ACT_KIND.WEB_OPEN, { url: href });
      }
    },
    [tell, openPlace],
  );
}
