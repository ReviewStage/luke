import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HTTP_STATUS, type JsonValue, jsonResponse, recordingHttpClient } from "@repo/wire/testing";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { accountBearer, CALL_FAULT } from "./account-call.js";
import { FAILURE_FACT } from "./failure-facts.js";
import { hostedCall } from "./hosted-call.js";
import { type HostedClient, hostedClient } from "./hosted-link.js";
import { LIVE_SIGNED_OUT } from "./live-wire.js";
import { REPOSITORY_UNREACHED } from "./repository-reach-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * hosted-call.test.ts -- how one hosted call's answer or failure reads as its domain's: one row per behavior of the translation.
 *
 * `mcpClients.list` declares only the refusals any procedure may answer;
 * `models.list` still declares every refusal, so it stands for a procedure
 * that declares one carrying fields.
 */

const BASE_URL = "https://app.test";

const CLIENTS = { serverUrl: `${BASE_URL}/api/mcp`, clients: [] };

/** The status the service answers an outage under. */
const SERVICE_UNAVAILABLE = 503;

const UNREACHED = { reason: REPOSITORY_UNREACHED.GONE, repository: "Acme/Relay" };

/** An account holding the token given, which renewing never changes. */
function account(token: string | undefined) {
  return accountBearer({
    readAccessToken: () => Effect.succeed(token),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("account-1"),
  });
}

/** An answer with the trace its cause names left out, since every call mints its own. */
function untraced(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null || !("cause" in answer)) return answer;
  const { cause } = answer;
  if (typeof cause !== "object" || cause === null || !("traceId" in cause)) return answer;
  const { traceId: _traceId, ...facts } = cause;
  return { ...answer, cause: facts };
}

/** One behavior: what the service answers, if it is asked, and what the call answers then. */
interface Row {
  readonly behavior: string;
  readonly signedOut?: boolean;
  readonly status: number;
  readonly body: JsonValue;
  readonly call: (hosted: HostedClient) => Effect.Effect<unknown, never, HttpClient.HttpClient>;
  readonly expected: unknown;
}

it.effect.each<Row>([
  {
    behavior: "an answer is the procedure's output",
    status: HTTP_STATUS.OK,
    body: CLIENTS,
    call: (hosted) => hostedCall(hosted.mcpClients.list, undefined),
    expected: CLIENTS,
  },
  {
    behavior: "a declared refusal is its slug with the fields it carries",
    status: HTTP_STATUS.FORBIDDEN,
    body: { error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, unreached: UNREACHED },
    call: (hosted) => hostedCall(hosted.models.list, undefined),
    expected: { failure: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, unreached: UNREACHED },
  },
  {
    behavior: "a refusal the procedure does not declare is no answer",
    status: HTTP_STATUS.NOT_FOUND,
    body: { error: HOSTED_API_ERROR.NOT_FOUND },
    call: (hosted) => hostedCall(hosted.mcpClients.list, undefined),
    expected: {
      failure: "unanswered",
      cause: {
        _tag: FAILURE_FACT.HOSTED_UNANSWERED,
        status: HTTP_STATUS.NOT_FOUND,
        code: HOSTED_API_ERROR.NOT_FOUND,
      },
    },
  },
  {
    behavior: "a refusal any procedure may answer is no answer unless renamed",
    status: SERVICE_UNAVAILABLE,
    body: { error: HOSTED_API_ERROR.UNAVAILABLE },
    call: (hosted) => hostedCall(hosted.mcpClients.list, undefined),
    expected: {
      failure: "unanswered",
      cause: { _tag: FAILURE_FACT.HOSTED_REFUSED, refusal: HOSTED_API_ERROR.UNAVAILABLE },
    },
  },
  {
    behavior: "a call that never reached the service is no answer with its fault",
    signedOut: true,
    status: HTTP_STATUS.OK,
    body: CLIENTS,
    call: (hosted) => hostedCall(hosted.mcpClients.list, undefined),
    expected: {
      failure: "unanswered",
      cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, fault: CALL_FAULT.NO_CREDENTIAL },
    },
  },
  {
    behavior: "a live read's refused bearer is signed out",
    status: HTTP_STATUS.UNAUTHORIZED,
    body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
    call: (hosted) => hostedCall(hosted.mcpClients.list, undefined, { live: true }),
    expected: LIVE_SIGNED_OUT,
  },
  {
    behavior: "a renamed refusal is the spelling that shipped",
    status: HTTP_STATUS.BAD_REQUEST,
    body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
    call: (hosted) =>
      hostedCall(hosted.mcpClients.list, undefined, {
        as: { [HOSTED_API_ERROR.INVALID_REQUEST]: "invalid-choice" },
      }),
    expected: { failure: "invalid-choice" },
  },
])("$behavior", ({ signedOut, status, body, call, expected }) =>
  Effect.gen(function* () {
    const recording = recordingHttpClient(() => jsonResponse(body, status));
    const hosted = hostedClient({
      baseUrl: BASE_URL,
      credential: account(signedOut === true ? undefined : "token-1"),
    });

    const answer = yield* Effect.provide(call(hosted), recording.layer);

    assert.deepEqual(untraced(answer), expected);
  }),
);
