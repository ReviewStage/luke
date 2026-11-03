/**
 * open-app.ts -- the Open link, the one way back every sign-in and connect page offers, as the Mac app at its home.
 *
 * A page a flow the Mac started passes through has nothing but the Mac app to
 * go back to: on a Mac it opens the app through its own scheme, at the app's home
 * (`@repo/features/link-home`), which brings it forward; on any other
 * platform there is no app to open, and the page's words stand alone. A
 * connect's landing offers the web app's tab first (`connect-return.ts`).
 */

import { APP_HOME_LINK } from "@repo/features/link-home";
import { LINK_PLATFORM, type LinkPlatform } from "@repo/features/link-open";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { AuthAction } from "@repo/ui";
import { browserLinkPlatform } from "./link-platform";

/** The words every way back is offered in. */
export const OPEN_APP = `Open ${PRODUCT_NAME}`;

/** The Open link as the Mac app at its home, on a Mac; nothing on any other platform. */
export function openMacApp(platform: LinkPlatform): AuthAction | undefined {
  return platform === LINK_PLATFORM.MAC ? { label: OPEN_APP, href: APP_HOME_LINK } : undefined;
}

/** The Open link on a page a flow the Mac started passes through, on the browser's own platform. */
export function openAppFromMac(): AuthAction | undefined {
  return openMacApp(browserLinkPlatform());
}
