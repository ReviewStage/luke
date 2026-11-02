/**
 * page-sandbox-app.ts -- one version of one page, served as the document a browser's frame draws, on the sandbox's own site and nowhere else.
 *
 * The deployment's routing sends the sandbox's host to this route alone (the
 * root `vercel.json`), a link's `/p/<token>` with its token moved into a
 * query, and this route answers on that host alone, whatever routed a request
 * here: on any address of the app's, its own path among them, it answers not
 * found, so no page is ever a document of the app's origin. What admits a
 * request is the link's token alone (`page-links.ts`): the route reads no
 * cookie, needs no session, and sets none. The version is read again for the
 * account the link was minted for, under the reach its mint was held to, and
 * answered under the policy every server of a page answers with
 * (`@luke/features/page-policy`), framed by the app's own origins alone, with
 * the find's script ahead of it (`@luke/features/page-find`).
 *
 * A link refused for any reason, its signature, its sandbox, its lapse, or the
 * account's reach, is answered not found alike, so a refusal says nothing of
 * which.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { readPageVersion } from "@luke/database/models/plan-pages";
import { withPageFind } from "@luke/features/page-find";
import { sandboxPageResponseHeaders } from "@luke/features/page-policy";
import { HTTP_METHOD } from "@luke/wire";
import { Clock, Effect, Layer, Option, type Scope } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { PAGE_LINK_ROUTE, PageLinks, readPageLink } from "./page-links.js";

/** What the route may require of the function that stands it: the store and the deployment's page links. */
export type PageSandboxAppServices = DatabaseServices | PageLinks;

type PageSandboxServices =
  | PageSandboxAppServices
  | HttpServerRequest.HttpServerRequest
  | Scope.Scope;

/** GET: the version the link admits, as its page, on the sandbox's own host. */
const sandboxPageEndpoint = /* @__PURE__ */ Effect.fn("web/sandboxPageEndpoint")(
  function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    PageSandboxServices
  > {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const address = new URL(request.url);
    const { sandbox } = yield* PageLinks;
    // Note that a page is served on the sandbox's host or not at all, because on an address of the app's it would run as the app's own.
    if (sandbox === undefined || address.host !== new URL(sandbox.origin).host) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
    const token = address.searchParams.get(PAGE_LINK_ROUTE.TOKEN_QUERY) ?? "";
    const linked = readPageLink(sandbox, token, yield* Clock.currentTimeMillis);
    if (linked === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const { userId, owner, pageId, version } = linked;
    const page = yield* hostedStoreOrUnavailable(readPageVersion(userId, owner, pageId, version));
    if (Option.isNone(page)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return HttpServerResponse.text(withPageFind(page.value.html), {
      status: HOSTED_HTTP_STATUS.OK,
      headers: sandboxPageResponseHeaders(sandbox.appOrigins),
    });
  },
);

/** The group: the page route, and the hosted vocabulary's own refusal for any other path. */
export function pageSandboxApp(): WebRoutes<PageSandboxAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PAGE_LINK_ROUTE.PATH, hostedRefusing(sandboxPageEndpoint())),
    hostedNotFoundRoute,
  );
}
