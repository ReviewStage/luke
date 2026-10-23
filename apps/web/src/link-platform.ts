/**
 * link-platform.ts -- whether this browser runs on a Mac, where Luke for Mac can be.
 *
 * The app's hand-off of a link (`app/mac-app-handoff.ts`) and a landing
 * page's Open Luke (`connect-return.ts`) both ask, so a page that only lands
 * reads it without loading the app's own modules.
 */

import { LINK_PLATFORM, type LinkPlatform } from "@luke/features/link-open";

/**
 * Whether the browser runs on a Mac, where the app can be. An iPad asking
 * for the desktop site names itself a Mac too, and is told apart by its
 * touch screen.
 */
export function browserLinkPlatform(): LinkPlatform {
  const mac = /\bMacintosh\b/u.test(navigator.userAgent) && navigator.maxTouchPoints <= 1;
  return mac ? LINK_PLATFORM.MAC : LINK_PLATFORM.OTHER;
}
