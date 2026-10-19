import type { UnparsedWireValue } from "@luke/wire";
import { Schema } from "effect";
import { openTargetOf } from "./open-address.js";

/**
 * link-open.ts -- where the account opens a Luke link, and whether a web page showing one hands it to the Mac app.
 *
 * As Linear's "Open links in the desktop app" does, an account chooses
 * whether a Luke link opened in a browser stays there or goes to Luke for
 * Mac. The choice is the account's (`@luke/settings`' `linkOpen`, its own
 * part of the preferences snapshot), so the web reads it on a signed-in
 * load and decides here. The hand-off is the "Open in Luke" page's own
 * (`open-address.ts`): the place the address names, written again in the
 * desktop's scheme, so nothing else the address carried reaches the app.
 * The browser is the default, because it works without the app.
 */

/** Where an account opens a Luke link. */
export const LINK_OPEN = {
  /** Stay on the web, which works wherever there is a browser. */
  BROWSER: "browser",
  /** Hand the link to Luke for Mac through its own scheme. */
  MAC_APP: "mac-app",
} as const;

export type LinkOpen = (typeof LINK_OPEN)[keyof typeof LINK_OPEN];

/** Every choice, in the order a control offers them. */
export const LINK_OPEN_LIST: readonly LinkOpen[] = [LINK_OPEN.BROWSER, LINK_OPEN.MAC_APP];

/** What a choice reads as on a control. */
export const LINK_OPEN_LABEL = {
  [LINK_OPEN.BROWSER]: "Browser",
  [LINK_OPEN.MAC_APP]: "Luke for Mac",
} as const satisfies Record<LinkOpen, string>;

/** The platform a browser runs on, as far as a hand-off cares: the app is a Mac's alone. */
export const LINK_PLATFORM = {
  MAC: "mac",
  OTHER: "other",
} as const;

export type LinkPlatform = (typeof LINK_PLATFORM)[keyof typeof LINK_PLATFORM];

const readsLinkOpen = Schema.is(Schema.Literals(LINK_OPEN_LIST));

/** Whether a value is one of the choices, as one arriving from storage or the wire is read. */
export function isLinkOpen(value: UnparsedWireValue): value is LinkOpen {
  return readsLinkOpen(value);
}

/** An address read as a URL, or nothing; `new URL` caught, since Safari before 17 has no `URL.canParse`. */
function parsedUrl(address: string): URL | undefined {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
}

/**
 * The link a web page showing `address` hands to the Mac app, or nothing
 * where it stays on the web: the account chose the browser, the browser is
 * on no Mac, or the address names no place in a workspace. The address is
 * the page's own, on Luke's home or a preview alike, read as the "Open in
 * Luke" page reads it.
 */
export function linkOpenTarget(
  preference: LinkOpen,
  platform: LinkPlatform,
  address: string,
): string | undefined {
  if (preference !== LINK_OPEN.MAC_APP || platform !== LINK_PLATFORM.MAC) return undefined;
  const url = parsedUrl(address);
  return url === undefined ? undefined : openTargetOf(url.pathname, url.hash, url.search)?.appLink;
}
