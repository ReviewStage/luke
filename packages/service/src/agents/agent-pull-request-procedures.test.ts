import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import { getTestDB } from "@repo/database/testing";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { HTTP_METHOD } from "@repo/wire";
import { type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_BODY_CEILING_BYTES, hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { agentPullRequestProcedures } from "./agent-pull-request-procedures.js";

const ORIGIN = "https://app.test";
const USER_ID = "user-1";
const JSON_TYPE = "application/json";

interface Bytes {
  readonly status: number;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
  readonly text: string;
}

const refused = (status: number, error: string): Bytes => ({
  status,
  contentType: JSON_TYPE,
  cacheControl: null,
  text: JSON.stringify({ error }),
});

const bytes = (request: Request) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<DatabaseServices>().pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
          Layer.succeed(Database, yield* Database),
        ),
      ),
    );
    const handle = hostedFetch({
      agentPullRequests: agentPullRequestProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(
              incoming.headers.get("authorization")?.match(/^Bearer (user-.+)$/u)?.[1],
            ),
          ),
      }),
    });
    const response = yield* Effect.promise(() =>
      handle(request, services as Context.Context<WebServices>),
    );
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      text: yield* Effect.promise(() => response.text()),
    } satisfies Bytes;
  });

function request(
  path: string,
  init: { method?: string; signedIn?: boolean; body?: string; contentLength?: number } = {},
): Request {
  const headers = new Headers();
  if (init.signedIn !== false) headers.set("authorization", `Bearer ${USER_ID}`);
  if (init.body !== undefined) headers.set("content-type", JSON_TYPE);
  if (init.contentLength !== undefined) headers.set("content-length", String(init.contentLength));
  return new Request(new URL(path, ORIGIN), {
    method: init.method ?? HTTP_METHOD.GET,
    headers,
    ...(init.body === undefined ? undefined : { body: init.body }),
  });
}

const READS = [
  "pull-request",
  "pull-request/viewed",
  "overview/pull-request",
  "overview/checks",
  "overview/conversation",
] as const;

const actionPath = (id: string) => `/api/agents/${id}/pull-request/action`;

it.layer(getTestDB())("an agent's Pull request tab's refusals", (it) => {
  it.effect(
    "an unsigned caller is refused as one before its input is read, a change with a malformed body and a read with a malformed number alike",
    () =>
      Effect.gen(function* () {
        const unsigned = refused(HOSTED_HTTP_STATUS.UNAUTHORIZED, "invalid-token");
        assert.deepEqual(
          yield* bytes(
            request(actionPath("not-an-id"), {
              method: HTTP_METHOD.POST,
              signedIn: false,
              body: '{"action":"no-such-change","extra":true}',
            }),
          ),
          unsigned,
        );
        for (const read of READS) {
          assert.deepEqual(
            yield* bytes(
              request(`/api/agents/${randomUUID()}/${read}?number=one&number=two`, {
                signedIn: false,
              }),
            ),
            unsigned,
          );
        }
      }),
  );

  it.effect(
    "an agent the account does not reach, or an id that is no agent's, is not found, on every read and on a change",
    () =>
      Effect.gen(function* () {
        const notFound = refused(HOSTED_HTTP_STATUS.NOT_FOUND, "not-found");
        for (const id of [randomUUID(), "not-an-id"]) {
          for (const read of READS) {
            assert.deepEqual(yield* bytes(request(`/api/agents/${id}/${read}`)), notFound);
          }
          assert.deepEqual(
            yield* bytes(
              request(actionPath(id), {
                method: HTTP_METHOD.POST,
                body: JSON.stringify({ action: PULL_REQUEST_ACTION.READY_FOR_REVIEW }),
              }),
            ),
            notFound,
          );
        }
      }),
  );

  it.effect(
    "a change's body past its cap is too large, and one that names a key no change has, or no change at all, is invalid, before any agent is read",
    () =>
      Effect.gen(function* () {
        const id = randomUUID();
        assert.deepEqual(
          yield* bytes(
            request(actionPath(id), {
              method: HTTP_METHOD.POST,
              body: JSON.stringify({ action: PULL_REQUEST_ACTION.COMMENT, body: "Looks good." }),
              contentLength: HOSTED_BODY_CEILING_BYTES - 1,
            }),
          ),
          refused(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, "request-too-large"),
        );
        const invalid = refused(HOSTED_HTTP_STATUS.BAD_REQUEST, "invalid-request");
        for (const body of [
          { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW, draft: false },
          { action: "no-such-change" },
        ]) {
          assert.deepEqual(
            yield* bytes(
              request(actionPath(id), { method: HTTP_METHOD.POST, body: JSON.stringify(body) }),
            ),
            invalid,
          );
        }
      }),
  );

  it.effect("a read asked by another method, or a change by GET, is a method not allowed", () =>
    Effect.gen(function* () {
      const id = randomUUID();
      const notAllowed = refused(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, "method-not-allowed");
      assert.deepEqual(
        yield* bytes(request(`/api/agents/${id}/overview/checks`, { method: HTTP_METHOD.POST })),
        notAllowed,
      );
      assert.deepEqual(yield* bytes(request(actionPath(id))), notAllowed);
    }),
  );
});
