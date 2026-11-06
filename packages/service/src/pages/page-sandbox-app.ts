import type { DatabaseServices } from "@repo/database/core/query";
import { readPageVersion } from "@repo/database/models/task-pages";
import { withPageScripts } from "@repo/features/page-find";
import { sandboxPageResponseHeaders } from "@repo/features/page-policy";
import { HTTP_METHOD } from "@repo/wire";
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
import { loadsAFrame, PAGE_LINK_ROUTE, PageLinks, readPageLink } from "./page-links.js";

export type PageSandboxAppServices = DatabaseServices | PageLinks;

type PageSandboxServices =
  | PageSandboxAppServices
  | HttpServerRequest.HttpServerRequest
  | Scope.Scope;

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
    if (!loadsAFrame(request)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const address = new URL(request.url);
    const { sandbox } = yield* PageLinks;
    if (sandbox === undefined || address.host !== new URL(sandbox.origin).host) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
    const token = address.searchParams.get(PAGE_LINK_ROUTE.TOKEN_QUERY) ?? "";
    const linked = readPageLink(sandbox, token, yield* Clock.currentTimeMillis);
    if (linked === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const { userId, owner, pageId, version } = linked;
    const page = yield* hostedStoreOrUnavailable(readPageVersion(userId, owner, pageId, version));
    if (Option.isNone(page)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return HttpServerResponse.text(withPageScripts(page.value.html), {
      status: HOSTED_HTTP_STATUS.OK,
      headers: sandboxPageResponseHeaders(sandbox.appOrigins),
    });
  },
);

export function pageSandboxApp(): WebRoutes<PageSandboxAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PAGE_LINK_ROUTE.PATH, hostedRefusing(sandboxPageEndpoint())),
    hostedNotFoundRoute,
  );
}
