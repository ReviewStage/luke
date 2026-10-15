import { decodeMention, MENTION_KIND, type PlanMention } from "@luke/features/mention-link";
import { ACT_KIND, isGitHubAddress, isWebAddress } from "@luke/host/acts";
import { createContext, useCallback, useContext } from "react";
import { useAct } from "../act";

/**
 * use-open-link.ts -- how a link in written words opens: a transcript's, the Call tab's, an agent tab's, or an Inbox item's.
 *
 * A Luke link, a plan's address on tryluke.dev or one of its sections'
 * (`@luke/features/mention-link`), opens in the window, on the plan's
 * own page scrolled to the section, never the browser, as Linear's and
 * Slack's own links open in their apps. The window's opener for a plan
 * (`App`'s, over the Plans tab) is handed down on a context, as Settings'
 * is (`../open-settings.tsx`); outside the window, as in a test of one
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

const OpenPlanContext = createContext<((mention: PlanMention) => void) | undefined>(undefined);

/** Hands the window's opener for a plan, or one of its sections, to everything under it. */
export const OpenPlanProvider = OpenPlanContext.Provider;

/** The window's opener for a plan, or one of its sections; nothing outside the window. */
export function useOpenPlan(): ((mention: PlanMention) => void) | undefined {
  return useContext(OpenPlanContext);
}

/**
 * Whether a link is one the window opens. Note that it asks the two acts'
 * own schemas, because an address both refuse would be drawn as a press
 * that opens nothing; a Luke link is a web address, and both take it.
 */
export function opensAsLink(href: string): boolean {
  return isGitHubAddress(href) || isWebAddress(href);
}

/** The plan or section a Luke link names; nothing for any other address. */
function lukeLinkOf(href: string): PlanMention | undefined {
  // Note that no repository is handed, so a GitHub page is never read as a file here: it opens on GitHub.
  const mention = decodeMention(href, null);
  return mention?.kind === MENTION_KIND.PLAN || mention?.kind === MENTION_KIND.SECTION
    ? mention
    : undefined;
}

/** Opens a link {@link opensAsLink} admits: a Luke link in the window where it can be, anything else in the browser, over the act it belongs to. */
export function useOpenLink(): (href: string) => void {
  const { tell } = useAct();
  const openPlan = useOpenPlan();
  return useCallback(
    (href: string) => {
      const plan = openPlan === undefined ? undefined : lukeLinkOf(href);
      if (openPlan !== undefined && plan !== undefined) {
        openPlan(plan);
      } else if (isGitHubAddress(href)) {
        tell(ACT_KIND.GITHUB_OPEN, { url: href });
      } else {
        tell(ACT_KIND.WEB_OPEN, { url: href });
      }
    },
    [tell, openPlan],
  );
}
