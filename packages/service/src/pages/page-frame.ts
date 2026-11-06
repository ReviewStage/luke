import type { DatabaseServices } from "@repo/database/core/query";
import { readPageVersion } from "@repo/database/models/task-pages";
import {
  PAGE_FRAME_STATUS,
  PAGE_IN_MAC_APP_PATH,
  type PageFrameAnswer,
} from "@repo/features/page-frame";
import type { PageOwner } from "@repo/features/page-wire";
import { Clock, Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { loadsAFrame, mintPageLink, PageLinks } from "./page-links.js";

export const pageFrameAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  userId: string,
  owner: PageOwner,
  pageId: string,
  version: number,
): Effect.fn.Return<PageFrameAnswer, HostedRefusal, DatabaseServices | PageLinks> {
  if (!loadsAFrame(request)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const page = yield* hostedStoreOrUnavailable(readPageVersion(userId, owner, pageId, version));
  if (Option.isNone(page)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { sandbox } = yield* PageLinks;
  const location =
    sandbox === undefined
      ? PAGE_IN_MAC_APP_PATH
      : mintPageLink(sandbox, { userId, owner, pageId, version }, yield* Clock.currentTimeMillis);
  return { status: PAGE_FRAME_STATUS, headers: { location, "referrer-policy": "no-referrer" } };
});
