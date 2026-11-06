import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  AGENT_BOUNDS,
  agentMessageAnswerSchema,
  agentMessageRequestSchema,
  agentNewestAnswerSchema,
  agentOlderAnswerSchema,
  agentPartAnswerSchema,
  agentQueueAnswerSchema,
  agentQueueChangeSchema,
  MAXIMUM_ATTACHMENTS_BODY_BYTES,
} from "../agent-wire.js";
import { transcriptNowAnswerSchema } from "../live-wire.js";
import { bodyCap, exactBodyInput, hostedProcedure } from "./base.js";

const MESSAGE_BODY_BYTES =
  6 * AGENT_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 1_024;

const ACCEPTED = 202;

const queryValue = EffectSchema.optionalKey(EffectSchema.String);

const byId = { id: EffectSchema.String };

const byCall = { id: EffectSchema.String, call: EffectSchema.String };

const transcriptQuery = { after: queryValue };

const agentTranscriptQuery = { ...transcriptQuery, wait: queryValue, parts: queryValue };

const byPart = { message: EffectSchema.String, index: EffectSchema.String };

const agentTranscriptAnswerSchema = EffectSchema.Struct({
  ...transcriptNowAnswerSchema.fields,
  holds: EffectSchema.optionalKey(EffectSchema.Boolean),
});

const newestQuery = { before: queryValue, parts: queryValue };

const newestAnswerSchema = EffectSchema.Union([agentNewestAnswerSchema, agentOlderAnswerSchema]);

export const messagesContract = {
  agent: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/agents/{id}/messages" }))
    .input(EffectSchema.Struct({ ...byId, ...agentTranscriptQuery }))
    .output(EffectSchema.flip(agentTranscriptAnswerSchema)),
  send: hostedProcedure
    .meta(bodyCap(MESSAGE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: "/api/agents/{id}/messages",
        successStatus: ACCEPTED,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(EffectSchema.Struct(byId), agentMessageRequestSchema))
    .output(EffectSchema.flip(agentMessageAnswerSchema)),
  queue: hostedProcedure
    .meta(bodyCap(MESSAGE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: "/api/agents/{id}/queue",
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(EffectSchema.Struct(byId), agentQueueChangeSchema))
    .output(EffectSchema.flip(agentQueueAnswerSchema)),
  agentWorker: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/agents/{id}/subagents/{call}/messages" }))
    .input(EffectSchema.Struct({ ...byCall, ...agentTranscriptQuery }))
    .output(EffectSchema.flip(agentTranscriptAnswerSchema)),
  agentNewest: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/agents/{id}/messages/newest" }))
    .input(EffectSchema.Struct({ ...byId, ...newestQuery }))
    .output(EffectSchema.flip(newestAnswerSchema)),
  agentWorkerNewest: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: "/api/agents/{id}/subagents/{call}/messages/newest",
      }),
    )
    .input(EffectSchema.Struct({ ...byCall, ...newestQuery }))
    .output(EffectSchema.flip(newestAnswerSchema)),
  agentPart: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: "/api/agents/{id}/messages/{message}/parts/{index}",
      }),
    )
    .input(EffectSchema.Struct({ ...byId, ...byPart }))
    .output(EffectSchema.flip(agentPartAnswerSchema)),
  agentWorkerPart: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: "/api/agents/{id}/subagents/{call}/messages/{message}/parts/{index}",
      }),
    )
    .input(EffectSchema.Struct({ ...byCall, ...byPart }))
    .output(EffectSchema.flip(agentPartAnswerSchema)),
};
