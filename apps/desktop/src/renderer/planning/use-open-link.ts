import { useCallback } from "react";
import { ACT_KIND, isGitHubAddress, isWebAddress } from "#shared/messages/acts";
import { useAct } from "../act";

/**
 * use-open-link.ts -- how a link in written words opens: a transcript's, the Call tab's, an agent tab's, or an Inbox item's.
 *
 * A page on GitHub, such as the pull request an agent opened, goes through
 * `github.open`, the act every GitHub press in the window goes through; any
 * other web page goes through `web.open`. Both open in the default browser,
 * and neither asks first. An address neither act takes — a `file:`, a
 * `javascript:`, another app's scheme — is no link, and the surface draws
 * its words going nowhere.
 */

/**
 * Whether a link is one the window opens. Note that it asks the two acts'
 * own schemas, because an address both refuse would be drawn as a press
 * that opens nothing.
 */
export function opensAsLink(href: string): boolean {
  return isGitHubAddress(href) || isWebAddress(href);
}

/** Opens a link {@link opensAsLink} admits in the browser, over the act it belongs to. */
export function useOpenLink(): (href: string) => void {
  const { tell } = useAct();
  return useCallback(
    (href: string) => {
      if (isGitHubAddress(href)) {
        tell(ACT_KIND.GITHUB_OPEN, { url: href });
      } else {
        tell(ACT_KIND.WEB_OPEN, { url: href });
      }
    },
    [tell],
  );
}
