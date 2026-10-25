/**
 * mac-agents.ts -- a local agent's Mac (`mac-agent-wire.ts`): it registers and beats, holds a read for its lines and one for its requests, claims each, and settles a line or answers a request.
 *
 * Every procedure names the Mac's device id, in the query of a held read
 * and in the body of every other call. The outputs are the wire schemas
 * flipped, so oRPC's output check encodes the handler's value into the
 * bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  MAC_AGENT_BOUNDS,
  macAgentAnswerRequestSchema,
  macAgentClaimRequestSchema,
  macAgentDeviceRequestSchema,
  macAgentDoneAnswerSchema,
  macAgentLineClaimAnswerSchema,
  macAgentLinesAnswerSchema,
  macAgentRegisterRequestSchema,
  macAgentRequestClaimAnswerSchema,
  macAgentRequestsAnswerSchema,
  macAgentSettleRequestSchema,
} from "../mac-agent-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** A register's, a beat's, a claim's, or a settle's body: a few ids and paths, and room to spare. */
const SMALL_BODY_BYTES = 4 * 1_024;

/** An answer's body: a read at its bound in base64, or a command's two outputs at theirs, and room for the rest. */
const ANSWER_BODY_BYTES = Math.ceil((MAC_AGENT_BOUNDS.MAX_ANSWER_BYTES * 2 * 4) / 3) + 64 * 1_024;

export const macAgentsContract = {
  register: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_AGENT_DEVICES }))
    .input(exactInput(macAgentRegisterRequestSchema))
    .output(EffectSchema.flip(macAgentDoneAnswerSchema)),
  beat: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_AGENT_PRESENCE }))
    .input(exactInput(macAgentDeviceRequestSchema))
    .output(EffectSchema.flip(macAgentDoneAnswerSchema)),
  lines: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.MAC_AGENT_LINES }))
    .input(macAgentDeviceRequestSchema)
    .output(EffectSchema.flip(macAgentLinesAnswerSchema)),
  claimLine: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_AGENT_LINE_CLAIM }))
    .input(exactInput(macAgentClaimRequestSchema))
    .output(EffectSchema.flip(macAgentLineClaimAnswerSchema)),
  settleLine: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_AGENT_LINES }))
    .input(exactInput(macAgentSettleRequestSchema))
    .output(EffectSchema.flip(macAgentDoneAnswerSchema)),
  requests: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.MAC_AGENT_REQUESTS }))
    .input(macAgentDeviceRequestSchema)
    .output(EffectSchema.flip(macAgentRequestsAnswerSchema)),
  claimRequest: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_AGENT_REQUEST_CLAIM }))
    .input(exactInput(macAgentClaimRequestSchema))
    .output(EffectSchema.flip(macAgentRequestClaimAnswerSchema)),
  answerRequest: hostedProcedure
    .meta(bodyCap(ANSWER_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MAC_AGENT_REQUESTS }))
    .input(exactInput(macAgentAnswerRequestSchema))
    .output(EffectSchema.flip(macAgentDoneAnswerSchema)),
};
