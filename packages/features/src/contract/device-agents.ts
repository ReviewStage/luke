/**
 * device-agents.ts -- a local agent's Mac (`device-agent-wire.ts`): it registers and beats, reads which of its agents should still stand, holds a read for its lines and one for its requests, claims each, says which step a launch it claimed has reached, and settles a line or answers a request.
 *
 * A host joins first (`../host-wire.ts`), a box pairing with a code
 * (`startPairing`, then `pollPairing` until a member approves it) for its
 * device secret, or a member's own desktop enrolling its device on its
 * sign-in (`enrollOwn`), and calls every other procedure on that secret,
 * `leave` among them, which removes the host from its account.
 * Every procedure names the Mac's device id, in the query of a held read
 * and in the body of every other call.
 *
 * Each declares the refusals its handler and caller middleware answer
 * beyond any procedure's (`packages/service/src/agents/device-agents-procedures.ts`,
 * `packages/service/src/orpc/base.ts`). A host's every call is refused as
 * needing an upgrade where its daemon is below the floor
 * (`auth/device-secret.ts`), the enroll and the pairing's included. A call
 * on the device secret is refused as not found where it names another
 * device or one the account no longer holds, and its refused bearer
 * carries `hostRemoved` where no standing host holds the secret
 * (`invalid-token`'s fields, which any procedure declares). The enroll is
 * refused as not found for an id it may not convert, and the pairing's
 * start is braked per address (`quota-exhausted`). Each also declares the
 * refusals the service's handler answers on its path before any procedure
 * matches (`packages/service/src/orpc/handler.ts`): `method-not-allowed`,
 * and for the pairing's calls `not-found`, a service from before the
 * route, which a host has always read as refused. The outputs are the wire schemas
 * flipped, so oRPC's output check encodes the handler's value into the
 * bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

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
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A register's, a beat's, a claim's, or a settle's body: a few ids and paths, and room to spare. */
const SMALL_BODY_BYTES = 4 * 1_024;

/** An answer's body: a read at its bound in base64, or a command's two outputs at theirs, and room for the rest. */
const ANSWER_BODY_BYTES =
  Math.ceil((DEVICE_AGENT_BOUNDS.MAX_ANSWER_BYTES * 2 * 4) / 3) + 64 * 1_024;

/** A call on the device secret: refused below the floor, not found for a device it may not act for or one gone, and under a method its path is not served on. */
const deviceProcedure = declaredProcedure.errors(
  refuses(
    HOSTED_API_ERROR.HOST_UPGRADE_NEEDED,
    HOSTED_API_ERROR.NOT_FOUND,
    HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
  ),
);

/** A pairing's call: refused below the floor, on a service from before the route, and under a method its path is not served on. */
const pairingProcedure = declaredProcedure.errors(
  refuses(
    HOSTED_API_ERROR.HOST_UPGRADE_NEEDED,
    HOSTED_API_ERROR.NOT_FOUND,
    HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
  ),
);

export const deviceAgentsContract = {
  startPairing: pairingProcedure
    .errors(refuses(HOSTED_API_ERROR.QUOTA_EXHAUSTED))
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_PAIRING_START }))
    .input(exactInput(hostPairingStartRequestSchema))
    .output(EffectSchema.flip(hostPairingStartAnswerSchema)),
  pollPairing: pairingProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_PAIRING_POLL }))
    .output(EffectSchema.flip(hostPairingPollAnswerSchema)),
  enrollOwn: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.HOST_UPGRADE_NEEDED,
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      ),
    )
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_ENROLL_OWN }))
    .input(exactInput(ownDeviceEnrollRequestSchema))
    .output(EffectSchema.flip(hostEnrollAnswerSchema)),
  leave: deviceProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LEAVE }))
    .input(exactInput(deviceAgentDeviceRequestSchema))
    .output(EffectSchema.flip(deviceAgentDoneAnswerSchema)),
  register: deviceProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_DEVICES }))
    .input(exactInput(deviceAgentRegisterRequestSchema))
    .output(EffectSchema.flip(deviceAgentDoneAnswerSchema)),
  beat: deviceProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_PRESENCE }))
    .input(exactInput(deviceAgentBeatRequestSchema))
    .output(EffectSchema.flip(deviceAgentBeatAnswerSchema)),
  liveAgents: deviceProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LIVE_AGENTS }))
    .input(deviceAgentDeviceRequestSchema)
    .output(EffectSchema.flip(deviceAgentLiveAgentsAnswerSchema)),
  lines: deviceProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LINES }))
    .input(deviceAgentDeviceRequestSchema)
    .output(EffectSchema.flip(deviceAgentLinesAnswerSchema)),
  claimLine: deviceProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LINE_CLAIM }))
    .input(exactInput(deviceAgentClaimRequestSchema))
    .output(EffectSchema.flip(deviceAgentLineClaimAnswerSchema)),
  lineStep: deviceProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LINE_STEP }))
    .input(exactInput(deviceAgentStepRequestSchema))
    .output(EffectSchema.flip(deviceAgentDoneAnswerSchema)),
  settleLine: deviceProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_LINES }))
    .input(exactInput(deviceAgentSettleRequestSchema))
    .output(EffectSchema.flip(deviceAgentDoneAnswerSchema)),
  requests: deviceProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_REQUESTS }))
    .input(deviceAgentDeviceRequestSchema)
    .output(EffectSchema.flip(deviceAgentRequestsAnswerSchema)),
  claimRequest: deviceProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_REQUEST_CLAIM }),
    )
    .input(exactInput(deviceAgentClaimRequestSchema))
    .output(EffectSchema.flip(deviceAgentRequestClaimAnswerSchema)),
  answerRequest: deviceProcedure
    .meta(bodyCap(ANSWER_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.DEVICE_AGENT_REQUESTS }))
    .input(exactInput(deviceAgentAnswerRequestSchema))
    .output(EffectSchema.flip(deviceAgentDoneAnswerSchema)),
};
