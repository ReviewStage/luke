import { LINK_PLACE, type LinkPlace, linkOf, readLink } from "@repo/features/link-grammar";
import { stayingOnWeb } from "@repo/features/link-open";
import { GLYPH } from "@repo/ui/icons";
import { appPlatform } from "./app-platform.js";
import type { MenuAction } from "./desktop/action-menu.js";

const OPEN_IN_BROWSER = "Open in browser";

type PageLinkPlace = Extract<LinkPlace, { kind: typeof LINK_PLACE.PAGE }>;

export function openPageInBrowserItem(place: PageLinkPlace, workspace: string): MenuAction {
  return {
    label: OPEN_IN_BROWSER,
    icon: <GLYPH.OPEN_EXTERNALLY />,
    onSelect: () => appPlatform().openWeb(stayingOnWeb(linkOf(place, workspace))),
  };
}

export function linkedPageInBrowserItem(href: string): MenuAction | undefined {
  const read = readLink(href);
  return read?.place.kind === LINK_PLACE.PAGE
    ? openPageInBrowserItem(read.place, read.workspace)
    : undefined;
}
