import { LINK_PLACE, type LinkPlace, linkOf, readLink } from "@repo/features/link-grammar";
import { stayingOnWeb } from "@repo/features/link-open";
import { GLYPH } from "@repo/ui/icons";
import { appPlatform } from "./app-platform.js";
import type { MenuAction } from "./desktop/action-menu.js";

/**
 * open-in-browser-item.tsx -- Open in browser as a page's menus offer it: the page's own app link opened in the browser, flagged to stay there.
 *
 * An agent's page is framed from an address only a frame may load (the
 * desktop's `app-page:` scheme, the web's sandbox site, which answers
 * nothing else), so its Open in browser opens the page's app link, the
 * web app's own address for it, where the page opens in its tab. The link
 * is written from the page's place and the workspace (`linkOf`), never from
 * the address the frame is drawn from, and carries the flag that keeps the
 * web from handing it straight back to the Mac app (`stayingOnWeb`). The
 * shell opens it outside the window (`openWeb`): the Mac app in the
 * default browser, a browser tab in a tab of its own.
 */

/** What the item says, as its label and to a reader. */
const OPEN_IN_BROWSER = "Open in browser";

/** A page's place, on its task or under the agent on no task that showed it. */
type PageLinkPlace = Extract<LinkPlace, { kind: typeof LINK_PLACE.PAGE }>;

/** Open in browser for a page, by its place and the workspace its link is written under. */
export function openPageInBrowserItem(place: PageLinkPlace, workspace: string): MenuAction {
  return {
    label: OPEN_IN_BROWSER,
    icon: <GLYPH.OPEN_EXTERNALLY />,
    onSelect: () => appPlatform().openWeb(stayingOnWeb(linkOf(place, workspace))),
  };
}

/** Open in browser for the page an app link names; none for a link to anything else. */
export function linkedPageInBrowserItem(href: string): MenuAction | undefined {
  const read = readLink(href);
  return read?.place.kind === LINK_PLACE.PAGE
    ? openPageInBrowserItem(read.place, read.workspace)
    : undefined;
}
