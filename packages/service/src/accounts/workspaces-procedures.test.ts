/**
 * workspaces-procedures.test.ts -- the workspaces resource's refusals through the hosted oRPC router, as the old group answered them.
 *
 * What a caller is refused before any row is read, in the order the old
 * group read a request: the caller first, so an unsigned request is
 * unauthenticated whatever its body says; then the body's bound, so a body
 * past it is too large whatever it carries, the photo's bound standing
 * apart from every other write's; then the body's shape, read whole. The
 * signed-in reads and writes are `workspaces-app.test.ts`'s, over the
 * organization plugin on a real dialect.
 *
 * Synthetic accounts and bearers throughout.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { MemberSeams, WorkspaceSeams } from "@luke/database/models/workspace-seams";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { WORKSPACE_PHOTO_BOUNDS } from "@luke/features/workspace-wire";
import { HTTP_METHOD } from "@luke/wire";
import { Context, Effect, Option } from "effect";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { workspacesProcedures } from "./workspaces-procedures.js";

const ORIGIN = "https://luke.test";
const USER_ID = "user-1";
const SESSION_HEADER = "x-test-session";

/** The bound on every workspace write's body but the photo's: a name's, or an id's. */
const BODY_BYTES = 1_024;

/** The photo's bound: its bytes at their bound in base64, and a name's body beside them. */
const PHOTO_BODY_BYTES = Math.ceil(WORKSPACE_PHOTO_BOUNDS.MAX_BYTES / 3) * 4 + BODY_BYTES;

/** Nothing here reaches a row or the plugin: every refusal comes before them. */
const UNREACHED = (): never => assert.fail("the request reached the workspace store");

// SAFETY: every seam fails the test as soon as it is called, and no refusal here calls one.
const workspaces = new Proxy({}, { get: () => UNREACHED }) as WorkspaceSeams;
// SAFETY: as above, for the plugin's member writes.
const members = new Proxy({}, { get: () => UNREACHED }) as MemberSeams;

const handle = hostedFetch({
  workspaces: workspacesProcedures({
    resolveUserId: (request) =>
      Effect.succeed(Option.fromNullishOr(request.headers.has("authorization") ? USER_ID : null)),
    resolveSessionUserId: (request) =>
      Effect.succeed(Option.fromNullishOr(request.headers.has(SESSION_HEADER) ? USER_ID : null)),
    workspaces,
    members,
  }),
});

interface Asked {
  readonly path: string;
  readonly method?: string;
  readonly body?: string;
  readonly caller?: "account" | "session";
}

/** One request's status and body, as the route answers it; a body's length is stated, as every client states it. */
const answer = ({ path, method = HTTP_METHOD.POST, body, caller }: Asked) =>
  Effect.gen(function* () {
    const headers = new Headers();
    if (caller === "account") headers.set("authorization", "Bearer token");
    if (caller === "session") headers.set(SESSION_HEADER, "session");
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      headers.set("content-length", String(new TextEncoder().encode(body).byteLength));
    }
    const request = new Request(new URL(path, ORIGIN), {
      method,
      headers,
      ...(body === undefined ? undefined : { body }),
    });
    // SAFETY: no refusal here yields a service, so an empty context stands in for the web runtime's.
    const services = Context.empty() as Context.Context<WebServices>;
    const response = yield* Effect.promise(() => handle(request, services));
    return { status: response.status, body: yield* Effect.promise(() => response.text()) };
  });

/** A JSON body padded with a key of its own to the exact length given. */
function bodyOf(fields: Readonly<Record<string, string>>, length: number): string {
  const bare = JSON.stringify({ ...fields, pad: "" });
  return JSON.stringify({ ...fields, pad: "x".repeat(length - bare.length) });
}

const refused = (status: number, error: string) => ({
  status,
  body: JSON.stringify({ error }),
});

it.effect("an unsigned request is unauthenticated, whatever its body says", () =>
  Effect.gen(function* () {
    const unauthenticated = refused(
      HOSTED_HTTP_STATUS.UNAUTHORIZED,
      HOSTED_API_ERROR.INVALID_TOKEN,
    );
    assert.deepEqual(
      yield* answer({ path: HOSTED_SERVICE_PATH.WORKSPACES, body: '{"name":7}' }),
      unauthenticated,
    );
    assert.deepEqual(
      yield* answer({ path: HOSTED_SERVICE_PATH.WORKSPACES_RENAME, body: "{}" }),
      unauthenticated,
    );
    assert.deepEqual(
      yield* answer({ path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS, method: HTTP_METHOD.GET }),
      unauthenticated,
    );
  }),
);

it.effect("a session write under the OAuth token alone is unauthenticated", () =>
  Effect.gen(function* () {
    assert.deepEqual(
      yield* answer({
        path: HOSTED_SERVICE_PATH.WORKSPACES_LEAVE,
        body: '{"workspaceId":"w-1"}',
        caller: "account",
      }),
      refused(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
    );
  }),
);

it.effect(
  "a body past its write's bound is too large, the photo's bound standing apart from the rest",
  () =>
    Effect.gen(function* () {
      const tooLarge = refused(
        HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE,
        HOSTED_API_ERROR.REQUEST_TOO_LARGE,
      );
      const invalid = refused(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
      const rename = { workspaceId: "w-1", name: "Acme" };
      assert.deepEqual(
        yield* answer({
          path: HOSTED_SERVICE_PATH.WORKSPACES_RENAME,
          body: bodyOf(rename, BODY_BYTES + 1),
          caller: "session",
        }),
        tooLarge,
      );
      assert.deepEqual(
        yield* answer({
          path: HOSTED_SERVICE_PATH.WORKSPACES_RENAME,
          body: bodyOf(rename, BODY_BYTES),
          caller: "session",
        }),
        invalid,
        "a body at the bound is read, and its stray key refused",
      );
      const photo = { workspaceId: "w-1", photo: "data:image/png;base64,AAAA" };
      assert.deepEqual(
        yield* answer({
          path: HOSTED_SERVICE_PATH.WORKSPACES_PHOTO_SET,
          body: bodyOf(photo, PHOTO_BODY_BYTES),
          caller: "session",
        }),
        invalid,
        "a photo's body at its bound is read",
      );
      assert.deepEqual(
        yield* answer({
          path: HOSTED_SERVICE_PATH.WORKSPACES_PHOTO_SET,
          body: bodyOf(photo, PHOTO_BODY_BYTES + 1),
          caller: "session",
        }),
        tooLarge,
      );
    }),
);

it.effect(
  "a body is read whole, a key its schema does not name refused, and a path asked by another method is not allowed",
  () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* answer({
          path: HOSTED_SERVICE_PATH.WORKSPACES_TRANSFER,
          body: '{"workspaceId":"w-1","userId":"user-2","role":"owner"}',
          caller: "session",
        }),
        refused(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
      );
      assert.deepEqual(
        yield* answer({
          path: HOSTED_SERVICE_PATH.WORKSPACES_MEMBERS_ROLE,
          method: HTTP_METHOD.GET,
          caller: "session",
        }),
        refused(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
      );
    }),
);
