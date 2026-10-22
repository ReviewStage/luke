/**
 * notifications-press.ts -- Settings' Test notification, pressed: the shell's grantor asked for permission inside the press, then the test posted by the host.
 *
 * The test reaches the host on the act port, a turn or more after the
 * press, and a browser such as Safari prompts only for an ask made inside
 * the press itself. So the shell is asked first, on the press's own stack,
 * where it asks at all (`AppPlatform.askNotificationsPermission`); the Mac
 * app, whose grant is macOS's, asks nothing here and posts the test as before.
 */

import { ACT_KIND } from "@luke/host/acts";
import { tellAct } from "../act.js";
import { appPlatform } from "../app-platform.js";

/** What the Test notification button does when pressed. */
export function testNotifications(): void {
  appPlatform().askNotificationsPermission?.();
  tellAct(ACT_KIND.NOTIFICATIONS_TEST);
}
