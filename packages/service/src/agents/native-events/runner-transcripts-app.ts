/**
 * runner-transcripts-app.ts -- where a cloud runner keeps its CLI's transcript: the Agent SDK's `SessionStore` calls, run against the agent's own rows.
 *
 * A runner whose config names this store (`@repo/agent-runner`'s
 * `RUNNER_TRANSCRIPTS`) mirrors its CLI's transcript here as the CLI writes
 * it, and reads it back to resume on a sandbox that no longer holds the
 * CLI's own files: Claude Code's through the SDK's `sessionStore`, Codex's
 * rollout through the runner itself. Each call is one of Anthropic's
 * reference Postgres store's five (`@repo/database`'s
 * `claude-session-entries.ts`), run on the conversation the bearer names
 * alone, so no runner reads or writes another agent's transcript.
 *
 * The bearer is admitted as the events route admits it
 * (`../workspace-mcp/bearer.ts`): one no standing agent holds, a retired
 * one's among them, is refused. The transcript can hold a tool's output,
 * so nothing of it is logged.
 */

import {
  RUNNER_TRANSCRIPTS,
  type RunnerTranscriptCall,
  RunnerTranscriptCallSchema,
  type RunnerTranscriptLoad,
  type RunnerTranscriptSessions,
  type RunnerTranscriptSubkeys,
} from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  appendSessionEntries,
  deleteSessionEntries,
  listSessionEntrySessions,
  listSessionEntrySubkeys,
  loadSessionEntries,
} from "@repo/database/models/claude-session-entries";
import { HTTP_METHOD } from "@repo/wire";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { admitRunnerBearer, presentedBearer } from "../workspace-mcp/bearer.js";

/** The path a runner keeps its CLI's transcript at. */
export const RUNNER_TRANSCRIPTS_PATH = "/api/agents/runner-transcripts";

/** The most a call's body carries: the platform's own bound on a function's request. */
const MAX_BODY_BYTES = 4.5 * 1024 * 1024;

const decodeCall = Schema.decodeUnknownOption(RunnerTranscriptCallSchema);

/** One call run on the conversation given, and what it is answered. */
const answerOf = Effect.fn("web/runnerTranscriptAnswer")(function* (
  userId: string,
  conversationId: string,
  call: RunnerTranscriptCall,
) {
  switch (call.call) {
    case RUNNER_TRANSCRIPTS.CALL.APPEND:
      yield* appendSessionEntries(userId, conversationId, call.key, call.entries);
      return {};
    case RUNNER_TRANSCRIPTS.CALL.LOAD: {
      const entries = yield* loadSessionEntries(userId, conversationId, call.key);
      // Note that a key never written is answered none, as the SDK's `load` answers null.
      return { entries: Option.getOrNull(entries) } satisfies RunnerTranscriptLoad;
    }
    case RUNNER_TRANSCRIPTS.CALL.LIST_SESSIONS: {
      const sessions = yield* listSessionEntrySessions(userId, conversationId, call.projectKey);
      return { sessions } satisfies RunnerTranscriptSessions;
    }
    case RUNNER_TRANSCRIPTS.CALL.DELETE:
      yield* deleteSessionEntries(userId, conversationId, call.key);
      return {};
    case RUNNER_TRANSCRIPTS.CALL.LIST_SUBKEYS: {
      const subkeys = yield* listSessionEntrySubkeys(userId, conversationId, call.key);
      return { subkeys } satisfies RunnerTranscriptSubkeys;
    }
  }
});

/** POST: one call of the runner's transcript store, admitted by its bearer. */
const runnerTranscriptsEndpoint = /* @__PURE__ */ Effect.fn("web/runnerTranscriptsEndpoint")(
  function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices
  > {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const bearer = presentedBearer(request);
    if (bearer === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const admitted = yield* hostedStoreOrUnavailable(admitRunnerBearer(bearer));
    if (Option.isNone(admitted)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const { target } = admitted.value;
    const body = yield* readBodyBytesEffect(MAX_BODY_BYTES);
    const call = decodeCall(yield* parseJsonBytes(body));
    if (Option.isNone(call)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const answer = yield* hostedStoreOrUnavailable(
      answerOf(target.userId, target.conversationId, call.value),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  },
);

/** The group: the one transcripts path, and the hosted vocabulary's own refusal for any other. */
export function runnerTranscriptsApp(): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      RUNNER_TRANSCRIPTS_PATH,
      hostedRefusing(runnerTranscriptsEndpoint()),
    ),
    hostedNotFoundRoute,
  );
}
