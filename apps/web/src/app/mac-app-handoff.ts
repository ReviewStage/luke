/**
 * mac-app-handoff.ts -- a Luke link loaded in a tab handed to Luke for Mac, once, where the account chose the Mac app and the tab is on a Mac.
 *
 * An account chooses where its Luke links open (`@luke/features/link-open`,
 * Settings › Profile's Links). The web serves the app at every link's own
 * address, so a link opened in a browser lands here first; the root asks this
 * once per page load, after the panel's first paint, and the address it asks
 * about is the one the tab loaded at. The choice is read from the service
 * under the tab's own cookie rather than from the host's settings, which a
 * browser that never signed in before holds nothing of, so a visitor signed
 * out is refused and stays. The hand-off is a navigation to the desktop's
 * scheme, which leaves this page standing: where the app does not open,
 * the visitor is still on the web, and nothing asks again until the next
 * load.
 */

import { accountCall, HOSTED_SERVICE_PATH } from "@luke/features";
import {
  LINK_OPEN,
  LINK_OPEN_LIST,
  LINK_PLATFORM,
  type LinkPlatform,
  linkOpenTarget,
} from "@luke/features/link-open";
import { HTTP_METHOD } from "@luke/wire";
import { Effect, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";

/**
 * The one part of the account's preferences the hand-off reads. A choice
 * this build does not know refuses the answer, and the link stays.
 */
const LinkOpenAnswer = Schema.Struct({
  linkOpen: Schema.optionalKey(Schema.Literals(LINK_OPEN_LIST)),
});

/** What the hand-off reads of the tab, and how it leaves for the app. */
export interface MacAppHandoffDoor {
  /** The whole address the tab loaded at. */
  readonly address: string;
  readonly platform: LinkPlatform;
  /** Hands the link in the desktop's scheme to the browser, which asks the OS for the app. */
  readonly open: (appLink: string) => void;
}

/**
 * Whether the browser runs on a Mac, where the app can be. An iPad asking
 * for the desktop site names itself a Mac too, and is told apart by its
 * touch screen.
 */
export function browserLinkPlatform(): LinkPlatform {
  const mac = /\bMacintosh\b/u.test(navigator.userAgent) && navigator.maxTouchPoints <= 1;
  return mac ? LINK_PLATFORM.MAC : LINK_PLATFORM.OTHER;
}

/**
 * Hands the loaded link to the Mac app where the signed-in account chose it.
 * An address that could never be handed off, on no Mac or naming no place,
 * asks the service nothing.
 */
export const handOffToMacApp = /* @__PURE__ */ Effect.fnUntraced(function* (
  door: MacAppHandoffDoor,
  origin: string,
): Effect.fn.Return<void, never, HttpClient.HttpClient> {
  if (linkOpenTarget(LINK_OPEN.MAC_APP, door.platform, door.address) === undefined) return;
  // Note that the cookie is the whole credential, so the call carries no header of its own.
  const answer = yield* accountCall({ baseUrl: origin, credential: {} }).ask(
    { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES },
    LinkOpenAnswer,
  );
  const target = linkOpenTarget(answer?.linkOpen ?? LINK_OPEN.BROWSER, door.platform, door.address);
  if (target !== undefined) door.open(target);
});
