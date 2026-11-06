import { accountCall, HOSTED_SERVICE_PATH } from "@repo/features";
import {
  LINK_OPEN,
  LINK_OPEN_LIST,
  type LinkPlatform,
  linkOpenTarget,
  withoutStayOnWeb,
} from "@repo/features/link-open";
import { savesStep } from "@repo/panel/navigation-history";
import { HTTP_METHOD } from "@repo/wire";
import type { HistoryLocation } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";

const LinkOpenAnswer = Schema.Struct({
  linkOpen: Schema.optionalKey(Schema.Literals(LINK_OPEN_LIST)),
});

const NAVIGATED = "navigate";

export interface MacAppHandoffDoor {
  readonly address: string;
  readonly fresh: boolean;
  readonly platform: LinkPlatform;
  readonly open: (appLink: string) => void;
}

function tookStayOnWeb(): boolean {
  const without = withoutStayOnWeb(location.href);
  if (without !== undefined) history.replaceState(history.state, "", without);
  return without !== undefined;
}

export function browserLoadedFresh(loaded: HistoryLocation): boolean {
  const stay = tookStayOnWeb();
  const [navigation] = performance.getEntriesByType("navigation");
  const navigated =
    navigation !== undefined && "type" in navigation && navigation.type === NAVIGATED;
  return navigated && !stay && !savesStep(loaded);
}

export const handOffToMacApp = /* @__PURE__ */ Effect.fnUntraced(function* (
  door: MacAppHandoffDoor,
  origin: string,
): Effect.fn.Return<void, never, HttpClient.HttpClient> {
  if (!door.fresh) return;
  if (linkOpenTarget(LINK_OPEN.MAC_APP, door.platform, door.address) === undefined) return;
  const answer = yield* accountCall({ baseUrl: origin, credential: {} }).ask(
    { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES },
    LinkOpenAnswer,
  );
  const target = linkOpenTarget(answer?.linkOpen ?? LINK_OPEN.BROWSER, door.platform, door.address);
  if (target !== undefined) door.open(target);
});
