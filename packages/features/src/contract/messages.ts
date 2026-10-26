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
 * (`packages/service/src/orpc/base.ts`). Beside them, one part of a
 * transcript's message read whole, at once, for a part a page carried cut.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  CODING_AGENT_BOUNDS,
  codingAgentMessageAnswerSchema,
  codingAgentMessageRequestSchema,
  codingAgentNewestAnswerSchema,
  codingAgentOlderAnswerSchema,
  codingAgentPartAnswerSchema,
  MAXIMUM_ATTACHMENTS_BODY_BYTES,
} from "../coding-agent-wire.js";
import { transcriptNowAnswerSchema } from "../live-wire.js";
import { bodyCap, exactBodyInput, hostedProcedure } from "./base.js";

/** A message is its words, its files, and a key: the bound's characters at JSON's widest escape, the files, and room for the keys around them. */
const MESSAGE_BODY_BYTES =
  6 * CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 1_024;

/** The status a message handed to an agent is answered with: taken, its turn yet to read it. */
const ACCEPTED = 202;

/** A query value as the handler reads it, checked there rather than here. */
const queryValue = EffectSchema.optionalKey(EffectSchema.String);

/** One agent, by the id its path names. */
const byId = { id: EffectSchema.String };

/** One worker, by its parent's id and the delegation call that started it. */
const byCall = { id: EffectSchema.String, call: EffectSchema.String };

/** A transcript read past a cursor. */
const transcriptQuery = { after: queryValue };

/** An agent's or a worker's transcript, read past a cursor, held, or at once where `wait=none` asks (`TRANSCRIPT_NOW_QUERY`), its heavy parts cut where `parts=cut` asks (`TRANSCRIPT_PARTS_QUERY`). */
const agentTranscriptQuery = { ...transcriptQuery, wait: queryValue, parts: queryValue };

/** One part of a transcript's message, by the message's id and the part's index, each a path segment the handler checks. */
const byPart = { message: EffectSchema.String, index: EffectSchema.String };

/** A page of an agent's or a worker's transcript, with whether the held read would have held on it, and how soon the clock alone may end that, where it was read at once (`transcriptNowAnswerSchema`). */
const agentTranscriptAnswerSchema = EffectSchema.Struct({
  ...transcriptNowAnswerSchema.fields,
  holds: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/** An agent's or a worker's transcript read back from its end: the newest page, or the page below `before`. */
/** A transcript read back from its end, below `before` where it names one, its heavy parts cut where `parts=cut` asks. */
const newestQuery = { before: queryValue, parts: queryValue };

/** The newest page with all it carries, or an older page, as the read named `before` or not. */
const newestAnswerSchema = EffectSchema.Union([
  codingAgentNewestAnswerSchema,
  codingAgentOlderAnswerSchema,
]);

export const messagesContract = {
  /** One agent's transcript past the cursor, held while it runs, or read at once where `wait=none` asks. */
  agent: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/agents/{id}/messages" }))
    .input(EffectSchema.Struct({ ...byId, ...agentTranscriptQuery }))
    .output(EffectSchema.flip(agentTranscriptAnswerSchema)),
  /** One message handed to an agent, answering the agent as it then stands. */
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
    .input(exactBodyInput(EffectSchema.Struct(byId), codingAgentMessageRequestSchema))
    .output(EffectSchema.flip(codingAgentMessageAnswerSchema)),
  /** One agent's worker's transcript past the cursor, held while it runs, or read at once where `wait=none` asks. */
  agentWorker: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/agents/{id}/subagents/{call}/messages" }))
    .input(EffectSchema.Struct({ ...byCall, ...agentTranscriptQuery }))
    .output(EffectSchema.flip(agentTranscriptAnswerSchema)),
  /** One agent's transcript read back from its end, at once: its newest page, or, with `before`, the page below it. */
  agentNewest: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: "/api/agents/{id}/messages/newest" }))
    .input(EffectSchema.Struct({ ...byId, ...newestQuery }))
    .output(EffectSchema.flip(newestAnswerSchema)),
  /** One agent's worker's transcript read back from its end, at once: its newest page, or, with `before`, the page below it. */
  agentWorkerNewest: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: "/api/agents/{id}/subagents/{call}/messages/newest",
      }),
    )
    .input(EffectSchema.Struct({ ...byCall, ...newestQuery }))
    .output(EffectSchema.flip(newestAnswerSchema)),
  /** One part of a message of an agent's transcript, whole, read at once: what a page carried cut. */
  agentPart: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: "/api/agents/{id}/messages/{message}/parts/{index}",
      }),
    )
    .input(EffectSchema.Struct({ ...byId, ...byPart }))
    .output(EffectSchema.flip(codingAgentPartAnswerSchema)),
  /** One part of a message of an agent's worker's transcript, whole, read at once. */
  agentWorkerPart: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: "/api/agents/{id}/subagents/{call}/messages/{message}/parts/{index}",
      }),
    )
    .input(EffectSchema.Struct({ ...byCall, ...byPart }))
    .output(EffectSchema.flip(codingAgentPartAnswerSchema)),
};
