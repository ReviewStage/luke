import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
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
  deviceAgentLiveAgentsAnswerSchema,
  deviceAgentRegisterRequestSchema,
  deviceAgentRequestClaimAnswerSchema,
  deviceAgentRequestsAnswerSchema,
  deviceAgentSettleRequestSchema,
  deviceAgentStepRequestSchema,
} from "../device-agent-wire.js";
import {
  hostEnrollAnswerSchema,
  hostPairingPollAnswerSchema,
  hostPairingStartAnswerSchema,
  hostPairingStartRequestSchema,
  ownDeviceEnrollRequestSchema,
} from "../host-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

const SMALL_BODY_BYTES = 4 * 1_024;

const ANSWER_BODY_BYTES =
  Math.ceil((DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES * 2 * 4) / 3) + 64 * 1_024;

export const deviceAgentsContract = {
  startPairing: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_PAIRING_START }))
    .input(exactInput(hostPairingStartRequestSchema))
    .output(EffectSchema.flip(hostPairingStartAnswerSchema)),
  pollPairing: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_PAIRING_POLL }))
    .output(EffectSchema.flip(hostPairingPollAnswerSchema)),
  enrollOwn: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_ENROLL_OWN }))
    .input(exactInput(ownDeviceEnrollRequestSchema))
    .output(EffectSchema.flip(hostEnrollAnswerSchema)),
  leave: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LEAVE }))
    .input(exactInput(deviceAgentDeviceRequestSchema))
    .output(EffectSchema.flip(deviceAgentDoneAnswerSchema)),
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
  liveAgents: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LIVE_AGENTS }))
    .input(deviceAgentDeviceRequestSchema)
    .output(EffectSchema.flip(deviceAgentLiveAgentsAnswerSchema)),
  lines: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LINES }))
    .input(deviceAgentDeviceRequestSchema)
    .output(EffectSchema.flip(deviceAgentLinesAnswerSchema)),
  claimLine: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LINE_CLAIM }))
    .input(exactInput(deviceAgentClaimRequestSchema))
    .output(EffectSchema.flip(deviceAgentLineClaimAnswerSchema)),
  lineStep: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LINE_STEP }))
    .input(exactInput(deviceAgentStepRequestSchema))
    .output(EffectSchema.flip(deviceAgentDoneAnswerSchema)),
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
