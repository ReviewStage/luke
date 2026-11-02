/**
 * page-frame.ts -- a browser's page frame, answered: sent on to the version's link on the sandbox's own site, minted for the account that asks, or to the page saying pages open in the Mac app where the deployment has no sandbox.
 *
 * The frame's address is the app's own (a plan's page version's `frame`, and
 * its twin under an agent on no task), so the browser asks it with the
 * session cookie, and the answer is a redirect the frame follows at once.
 * The link stands only in the answer's `Location`, never in the app's script,
 * its document, or its screen recording; the answer is kept by no cache
 * (`orpc/handler.ts`) and carries no referrer on; and every load of the
 * frame, a reload among them, mints anew. A load the browser does not name as
 * a frame's, a whole tab's above all, is answered not found and mints nothing
 * (`page-links.ts`'s `loadsAFrame`), so no link ever stands in a tab's history.
 * The version is read on the account's own reach first, the rule the
 * desktop's page read is held to (`@luke/database/models/plan-pages`), so a
 * page the account does not reach answers not found and no link is minted
 * for it, with a sandbox or without.
 *
 * Note that the mint is a GET, which the cookie origin guard lets through from
 * any page, and that this is safe: it changes nothing, and what it answers is
 * a link to the asking account's own page. The session cookie is
 * SameSite=Lax, so no other site's frame or fetch carries it; a top-level
 * link from another site shows the account its own page in its own tab, which
 * that site cannot read; and the page's `frame-ancestors` keeps any other
 * site from framing it.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { readPageVersion } from "@luke/database/models/plan-pages";
import {
  PAGE_FRAME_STATUS,
  PAGE_IN_MAC_APP_PATH,
  type PageFrameAnswer,
} from "@luke/features/page-frame";
import type { PageOwner } from "@luke/features/page-wire";
import { Clock, Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { loadsAFrame, mintPageLink, PageLinks } from "./page-links.js";

/** The frame's answer for one version of one page the account asks for: where to load it from, or not found where the account does not reach it or the request loads no frame. */
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
