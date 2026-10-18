import assert from "node:assert/strict";
import "@orpc/experimental-effect/extensions/effect";
import { it } from "@effect/vitest";
import { HOSTED_ERRORS } from "@luke/features/contract";
import { REPOSITORY_UNREACHED } from "@luke/features/repository-reach-wire";
import { HTTP_METHOD } from "@luke/wire";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { implement } from "@orpc/server";
import { Context, Effect, Layer, Schema, SchemaTransformation } from "effect";
import { HttpRouter } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  hostedJsonResponse,
  hostedRefusalResponse,
  repositoryNotReachable,
} from "../http/http-effect.js";
import type { WebServices } from "../runtime.js";
import type { HostedContext } from "./base.js";
import { hostedFetch } from "./handler.js";

/**
 * The handler's proof that an oRPC procedure answers the bytes an old route
 * group answered: the same request is put to a test-only router behind
 * `hostedFetch` and to an `HttpRouter` group answering the same value the
 * way the old groups did, and the two answers are compared whole: status,
 * the two headers a caller reads, and the body's bytes. The cases are the
 * ones a later resource copies: an answer whose wire schema transforms (a
 * date the wire carries as text, an id folded to lower case), a refusal
 * carrying more than its slug, an input its schema refuses, and a defect.
 */

const ORIGIN = "https://luke.test";
const WHEN_PATH = "/api/test/{id}/when";
const REACH_PATH = "/api/test/reach";
const ITEMS_PATH = "/api/test/items";
const DEFECT_PATH = "/api/test/defect";

/** A wire answer whose `Type` is not its `Encoded`: a date carried as ISO text, and an id read folded to lower case. */
const whenSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase())),
  at: Schema.DateFromString,
});

const itemSchema = Schema.Struct({ name: Schema.String });

const AT = new Date(Date.UTC(2026, 9, 18, 12, 30));
const UNREACHED = {
  reason: REPOSITORY_UNREACHED.OTHER_OWNER,
  repository: "acme/app",
  connectedTo: "someone-else",
} as const;

const testContract = {
  when: oc
    .errors(HOSTED_ERRORS)
    .meta(openapi({ method: HTTP_METHOD.GET, path: WHEN_PATH }))
    .input(Schema.Struct({ id: Schema.String }))
    .output(Schema.flip(whenSchema)),
  reach: oc
    .errors(HOSTED_ERRORS)
    .meta(openapi({ method: HTTP_METHOD.GET, path: REACH_PATH }))
    .output(Schema.flip(itemSchema)),
  create: oc
    .errors(HOSTED_ERRORS)
    .meta(openapi({ method: HTTP_METHOD.POST, path: ITEMS_PATH }))
    .input(itemSchema)
    .output(Schema.flip(itemSchema)),
  defect: oc
    .errors(HOSTED_ERRORS)
    .meta(openapi({ method: HTTP_METHOD.GET, path: DEFECT_PATH }))
    .output(Schema.flip(itemSchema)),
};

const test = implement(testContract).$context<HostedContext>();

const testRouter = test.router({
  when: test.when.handler(({ input }) => ({ id: input.id.toLowerCase(), at: AT })),
  reach: test.reach.effect(function* () {
    return yield* Effect.fail(repositoryNotReachable(UNREACHED));
  }),
  create: test.create.handler(({ input }) => ({ name: input.name })),
  defect: test.defect.effect(function* () {
    return yield* Effect.die(new Error("a defect"));
  }),
});

/** The old groups' way of answering the same values: `hostedJsonResponse`, `hostedRefusalResponse`, and a defect left to the platform. */
const oldGroup = Layer.mergeAll(
  HttpRouter.add(
    HTTP_METHOD.GET,
    "/api/test/:id/when",
    hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { id: "abc", at: AT }),
  ),
  HttpRouter.add(
    HTTP_METHOD.GET,
    REACH_PATH,
    hostedRefusalResponse(repositoryNotReachable(UNREACHED)),
  ),
  HttpRouter.add(
    HTTP_METHOD.POST,
    ITEMS_PATH,
    hostedRefusalResponse(HOSTED_REFUSAL.INVALID_REQUEST),
  ),
  HttpRouter.add(HTTP_METHOD.GET, DEFECT_PATH, Effect.die(new Error("a defect"))),
);

interface Bytes {
  readonly status: number;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly text: string;
}

const read = (response: Response) =>
  Effect.map(
    Effect.promise(() => response.text()),
    (text): Bytes => ({
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      text,
    }),
  );

/** The same request answered by the oRPC router and by the old group. */
const bothAnswer = (init: { path: string; method?: string; body?: string }) =>
  Effect.gen(function* () {
    const request = () => {
      const requestInit: RequestInit = { method: init.method ?? HTTP_METHOD.GET };
      if (init.body !== undefined) {
        requestInit.body = init.body;
        requestInit.headers = { "content-type": "application/json" };
      }
      return new Request(new URL(init.path, ORIGIN), requestInit);
    };
    // SAFETY: the test procedures yield no service, so an empty context stands in for the web runtime's.
    const services = Context.empty() as Context.Context<WebServices>;
    const handle = hostedFetch(testRouter);
    const orpc = yield* read(yield* Effect.promise(() => handle(request(), services)));
    const { handler, dispose } = HttpRouter.toWebHandler(oldGroup, { disableLogger: true });
    const old = yield* read(yield* Effect.promise(() => handler(request())));
    yield* Effect.promise(() => dispose());
    return { orpc, old };
  });

it.effect(
  "an answer whose wire schema transforms is written in its wire encoding, the bytes hostedJsonResponse wrote",
  () =>
    Effect.gen(function* () {
      const { orpc, old } = yield* bothAnswer({ path: "/api/test/ABC/when" });
      assert.deepEqual(orpc, old);
      assert.equal(orpc.text, '{"id":"abc","at":"2026-10-18T12:30:00.000Z"}');
    }),
);

it.effect(
  "a repository out of reach is refused with why, beside the slug at the top level, as hostedRefusalResponse refused it",
  () =>
    Effect.gen(function* () {
      const { orpc, old } = yield* bothAnswer({ path: REACH_PATH });
      assert.deepEqual(orpc, old);
      assert.equal(orpc.status, HOSTED_HTTP_STATUS.FORBIDDEN);
      assert.deepEqual(JSON.parse(orpc.text), {
        error: "repository-not-reachable",
        unreached: UNREACHED,
      });
    }),
);

it.effect("an input its schema refuses is the hosted vocabulary's invalid request", () =>
  Effect.gen(function* () {
    const { orpc, old } = yield* bothAnswer({
      path: ITEMS_PATH,
      method: HTTP_METHOD.POST,
      body: JSON.stringify({ name: 7 }),
    });
    assert.deepEqual(orpc, old);
    assert.equal(orpc.text, '{"error":"invalid-request"}');
  }),
);

it.effect("a defect is a bare 500, as the platform's web handler answered one", () =>
  Effect.gen(function* () {
    const { orpc, old } = yield* bothAnswer({ path: DEFECT_PATH });
    assert.deepEqual(orpc, old);
    assert.equal(orpc.status, HOSTED_HTTP_STATUS.INTERNAL_ERROR);
  }),
);
