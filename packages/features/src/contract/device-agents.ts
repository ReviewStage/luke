/**
 * device-agents.ts -- a local agent's Mac (`device-agent-wire.ts`): it registers and beats, holds a read for its lines and one for its requests, claims each, and settles a line or answers a request.
 *
 * A host enrolls first (`../host-wire.ts`), trading an install token for
 * its device secret, or a member's own desktop enrolls its device on its
 * sign-in (`enrollOwn`), and calls every other procedure on that secret.
 * Every procedure names the Mac's device id, in the query of a held read
 * and in the body of every other call. The outputs are the wire schemas
 * flipped, so oRPC's output check encodes the handler's value into the
 * bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  DEVICE_AGENT_BOUNDS,
  deviceAgentAnswerRequestSchema,
  deviceAgentBeatAnswerSchema,
  deviceAgentBeatRequestSchema,
  deviceAgentClaimRequestSchema,
  deviceAgentDeviceRequestSchema,
  deviceAgentDoneAnswerSchema,
  deviceAgentLineClaimAnswerSchema,
  deviceAgentLinesAnswerSchema,
  deviceAgentRegisterRequestSchema,
  deviceAgentRequestClaimAnswerSchema,
  deviceAgentRequestsAnswerSchema,
  deviceAgentSettleRequestSchema,
} from "../device-agent-wire.js";
import {
  hostEnrollAnswerSchema,
  hostEnrollRequestSchema,
  ownDeviceEnrollRequestSchema,
} from "../host-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** A register's, a beat's, a claim's, or a settle's body: a few ids and paths, and room to spare. */
const SMALL_BODY_BYTES = 4 * 1_024;

/** An answer's body: a read at its bound in base64, or a command's two outputs at theirs, and room for the rest. */
const ANSWER_BODY_BYTES =
  Math.ceil((DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES * 2 * 4) / 3) + 64 * 1_024;

export const deviceAgentsContract = {
  enroll: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_ENROLL }))
    .input(exactInput(hostEnrollRequestSchema))
    .output(EffectSchema.flip(hostEnrollAnswerSchema)),
  enrollOwn: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_ENROLL_OWN }))
    .input(exactInput(ownDeviceEnrollRequestSchema))
    .output(EffectSchema.flip(hostEnrollAnswerSchema)),
  register: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES }))
    .input(exactInput(deviceAgentRegisterRequestSchema))
    .output(EffectSchema.flip(deviceAgentDoneAnswerSchema)),
  beat: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE }))
    .input(exactInput(deviceAgentBeatRequestSchema))
    .output(EffectSchema.flip(deviceAgentBeatAnswerSchema)),
  lines: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LINES }))
    .input(deviceAgentDeviceRequestSchema)
    .output(EffectSchema.flip(deviceAgentLinesAnswerSchema)),
  claimLine: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LINE_CLAIM }))
    .input(exactInput(deviceAgentClaimRequestSchema))
    .output(EffectSchema.flip(deviceAgentLineClaimAnswerSchema)),
  settleLine: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LINES }))
    .input(exactInput(deviceAgentSettleRequestSchema))
    .output(EffectSchema.flip(deviceAgentDoneAnswerSchema)),
  requests: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_REQUESTS }))
    .input(deviceAgentDeviceRequestSchema)
    .output(EffectSchema.flip(deviceAgentRequestsAnswerSchema)),
  claimRequest: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_REQUEST_CLAIM }),
    )
    .input(exactInput(deviceAgentClaimRequestSchema))
    .output(EffectSchema.flip(deviceAgentRequestClaimAnswerSchema)),
  answerRequest: hostedProcedure
    .meta(bodyCap(ANSWER_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_REQUESTS }))
    .input(exactInput(deviceAgentAnswerRequestSchema))
    .output(EffectSchema.flip(deviceAgentDoneAnswerSchema)),
};
