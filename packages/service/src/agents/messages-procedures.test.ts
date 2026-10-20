/**
 * messages-procedures.test.ts -- the held message routes' refusals as the hosted oRPC router answers them, before any row is read.
 *
 * Each case is decided before a store is reached, so the router runs on no
 * service at all: the caller is resolved before the input is read, so an
 * unsigned caller is refused as unauthenticated whatever it sent; an id
 * that is no UUID names nothing; a message whose words run past the bound
 * is refused as too long, and one that does not read, or names a key no
 * message has, as invalid; a body past its cap is too large; and a path
 * the router serves under another method is refused as such. The held
 * reads themselves, answered when something moves and let go at the hold,
 * are `workspace-chat.test.ts`'s and `coding-agents-app.test.ts`'s, over a
 * real dialect.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { HOSTED_API_ERROR } from "@luke/features";
import { CODING_AGENT_BOUNDS } from "@luke/features/coding-agent-wire";
import { Context, Effect, Option } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_BODY_CEILING_BYTES, hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { messagesProcedures } from "./messages-procedures.js";

const ORIGIN = "https://luke.test";
const USER_ID = "user-1";
const AGENT_ID = randomUUID();

const handle = hostedFetch({
  messages: messagesProcedures({
    eveOrigin: () => undefined,
    resolveUserId: (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(
          incoming.headers.get("authorization") === `Bearer ${USER_ID}` ? USER_ID : undefined,
        ),
      ),
  }),
});

/** One request's status and bytes, as the route answers it. */
const answer = (
  path: string,
  init: {
    readonly method?: string;
    readonly signedIn?: boolean;
    readonly body?: string;
    readonly contentLength?: number;
  } = {},
) =>
  Effect.gen(function* () {
    const headers = new Headers();
    if (init.signedIn !== false) headers.set("authorization", `Bearer ${USER_ID}`);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (init.contentLength !== undefined) {
      headers.set("content-length", String(init.contentLength));
    }
    // SAFETY: every case here is refused before a procedure yields a service, so an empty context stands in for the web runtime's.
    const services = Context.empty() as Context.Context<WebServices>;
    const response = yield* Effect.promise(() =>
      handle(
        new Request(new URL(path, ORIGIN), {
          method: init.method ?? "GET",
          headers,
          ...(init.body === undefined ? undefined : { body: init.body }),
        }),
        services,
      ),
    );
    return { status: response.status, text: yield* Effect.promise(() => response.text()) };
  });

const refused = (status: number, error: string) => ({ status, text: JSON.stringify({ error }) });

const MESSAGES = `/api/agents/${AGENT_ID}/messages`;

it.effect(
  "an unsigned caller is refused as unauthenticated on every held read and write, before its input is read",
  () =>
    Effect.gen(function* () {
      const unauthenticated = refused(
        HOSTED_HTTP_STATUS.UNAUTHORIZED,
        HOSTED_API_ERROR.INVALID_TOKEN,
      );
      for (const path of [
        `${MESSAGES}?after=not-a-cursor`,
        `/api/agents/${AGENT_ID}/subagents/call-1/messages`,
        `/api/plans/${AGENT_ID}/messages?after=x&before=y`,
        `/api/plans/${AGENT_ID}/subagents/call-1/messages`,
        "/api/workspaces/chat?after=-1",
      ]) {
        assert.deepEqual(yield* answer(path, { signedIn: false }), unauthenticated, path);
      }
      assert.deepEqual(
        yield* answer(MESSAGES, { method: "POST", signedIn: false, body: '{"text":7}' }),
        unauthenticated,
      );
      assert.deepEqual(
        yield* answer("/api/workspaces/chat", { method: "POST", signedIn: false, body: "{}" }),
        unauthenticated,
      );
    }),
);

it.effect("an agent or a task named by an id that is no UUID is not found", () =>
  Effect.gen(function* () {
    const notFound = refused(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
    assert.deepEqual(yield* answer("/api/agents/not-an-id/messages"), notFound);
    assert.deepEqual(yield* answer("/api/plans/not-an-id/messages"), notFound);
    assert.deepEqual(yield* answer("/api/plans/not-an-id/subagents/call-1/messages"), notFound);
  }),
);

it.effect(
  "a message whose words run past the bound is too long, one that does not read or names a key no message has is invalid, and a body past its cap is too large",
  () =>
    Effect.gen(function* () {
      const long = "x".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + 1);
      assert.deepEqual(
        yield* answer(MESSAGES, {
          method: "POST",
          body: JSON.stringify({ text: long, clientKey: "key-1" }),
        }),
        refused(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.MESSAGE_TOO_LONG),
      );
      // A message at the bound reads, and reaches the handler, which finds no agent by an id that is none.
      assert.deepEqual(
        yield* answer("/api/agents/not-an-id/messages", {
          method: "POST",
          body: JSON.stringify({
            text: "x".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS),
            clientKey: "key-1",
          }),
        }),
        refused(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
      const invalid = refused(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
      assert.deepEqual(
        yield* answer(MESSAGES, { method: "POST", body: JSON.stringify({ text: 7 }) }),
        invalid,
      );
      assert.deepEqual(
        yield* answer(MESSAGES, {
          method: "POST",
          body: JSON.stringify({ text: "Hello.", clientKey: "key-1", extra: true }),
        }),
        invalid,
      );
      assert.deepEqual(
        yield* answer(MESSAGES, { method: "POST", body: "{}", contentLength: 10_000_000 }),
        refused(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE),
      );
      // A body that states no length is held to the handler's ceiling.
      assert.deepEqual(
        yield* answer(MESSAGES, {
          method: "POST",
          body: JSON.stringify({ text: "x".repeat(HOSTED_BODY_CEILING_BYTES), clientKey: "k" }),
        }),
        refused(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE),
      );
      assert.deepEqual(
        yield* answer("/api/workspaces/chat?workspaceId=w", {
          method: "POST",
          body: "{}",
          contentLength: 10_000_000,
        }),
        refused(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE),
      );
    }),
);

it.effect("a held read's path under a method it does not take is refused as such", () =>
  Effect.gen(function* () {
    const notAllowed = refused(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
    assert.deepEqual(yield* answer(MESSAGES, { method: "PUT" }), notAllowed);
    assert.deepEqual(
      yield* answer(`/api/plans/${AGENT_ID}/messages`, { method: "POST" }),
      notAllowed,
    );
    assert.deepEqual(
      yield* answer(`/api/agents/${AGENT_ID}/subagents/call-1/messages`, { method: "POST" }),
      notAllowed,
    );
  }),
);
