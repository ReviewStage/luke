/**
 * messages.ts -- the held message reads and the writes beside them on the same paths, as procedures.
 *
 * Every read here is held open by the service while nothing it reads has
 * moved (`packages/service/src/http/held-read.ts`, `coder-host/transcript.ts`),
 * and answers once it has or once the hold ends: a long-held JSON read, not
 * an event iterator, so the wire is the one released desktops read. The
 * client asks each under the held deadline (`HOSTED_DEADLINE.HELD`).
 *
 * A read's query is taken loosely and checked by its handler, as the old
 * groups checked it, so a cursor that is none is refused as it was, and a
 * key no read names is ignored as it was. A write's body is exact
 * (`exactBodyInput`). The outputs are the wire schemas flipped
 * (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { chatAnswerSchema, chatWriteAnswerSchema, chatWriteRequestSchema } from "../chat-wire.js";
import {
  codingAgentAnswerSchema,
  codingAgentMessageRequestSchema,
  codingAgentMessagesAnswerSchema,
} from "../coding-agent-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { exactBodyInput, exactInput, hostedProcedure } from "./base.js";

/** The status a message handed to an agent is answered with: taken, its turn yet to read it. */
const ACCEPTED = 202;

/** A query value as the handler reads it, checked there rather than here. */
const queryValue = EffectSchema.optionalKey(EffectSchema.String);

/** One agent, or one task, by the id its path names. */
const byId = { id: EffectSchema.String };

/** One worker, by its parent's id and the delegation call that started it. */
const byCall = { id: EffectSchema.String, call: EffectSchema.String };

/** A transcript read past a cursor. */
const transcriptQuery = { after: queryValue };

/** An agent's or a worker's transcript read past a cursor, held, or at once where `wait=none` asks (`TRANSCRIPT_NOW_QUERY`). */
const agentTranscriptQuery = { ...transcriptQuery, wait: queryValue };

/** A page of an agent's or a worker's transcript, with whether the held read would have held on it where it was read at once (`transcriptNowAnswerSchema`). */
const agentTranscriptAnswerSchema = EffectSchema.Struct({
  ...codingAgentMessagesAnswerSchema.fields,
  holds: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/** A workspace's chat, named in the query, with any key beside it taken as it comes. */
const chatQuery = EffectSchema.StructWithRest(EffectSchema.Struct({ workspaceId: queryValue }), [
  EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
]);

export const messagesContract = {
  /** One agent's transcript past the cursor, held while it runs, or read at once where `wait=none` asks. */
  agent: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/agents/{id}/messages" }))
    .input(EffectSchema.Struct({ ...byId, ...agentTranscriptQuery }))
    .output(EffectSchema.flip(agentTranscriptAnswerSchema)),
  /** One message handed to an agent, answering the agent as it then stands. */
  send: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: "/api/agents/{id}/messages",
        successStatus: ACCEPTED,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(EffectSchema.Struct(byId), codingAgentMessageRequestSchema))
    .output(EffectSchema.flip(codingAgentAnswerSchema)),
  /** One agent's worker's transcript past the cursor, held while it runs, or read at once where `wait=none` asks. */
  agentWorker: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/agents/{id}/subagents/{call}/messages" }))
    .input(EffectSchema.Struct({ ...byCall, ...agentTranscriptQuery }))
    .output(EffectSchema.flip(agentTranscriptAnswerSchema)),
  /** One task's conversation, past the cursor and held while a turn runs, or a page of its turns. */
  task: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/plans/{id}/messages" }))
    .input(EffectSchema.Struct({ ...byId, ...transcriptQuery, before: queryValue }))
    .output(EffectSchema.flip(codingAgentMessagesAnswerSchema)),
  /** One task's brain worker's transcript past the cursor, held while it runs. */
  taskWorker: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/plans/{id}/subagents/{call}/messages" }))
    .input(EffectSchema.Struct({ ...byCall, ...transcriptQuery }))
    .output(EffectSchema.flip(codingAgentMessagesAnswerSchema)),
  /** A workspace's chat past the cursor, held while nothing moved. */
  chat: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACES_CHAT }))
    .input(EffectSchema.Struct({ workspaceId: queryValue, after: queryValue }))
    .output(EffectSchema.flip(chatAnswerSchema)),
  /** One write to a workspace's chat: a post, an answer, a resolve, or a read. */
  chatWrite: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.WORKSPACES_CHAT,
        inputStructure: "detailed",
      }),
    )
    .input(
      exactInput(
        EffectSchema.Struct({
          params: EffectSchema.optionalKey(EffectSchema.Unknown),
          query: chatQuery,
          headers: EffectSchema.optionalKey(EffectSchema.Unknown),
          body: chatWriteRequestSchema,
        }),
      ),
    )
    .output(EffectSchema.flip(chatWriteAnswerSchema)),
};
