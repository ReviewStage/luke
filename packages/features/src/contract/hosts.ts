/**
 * hosts.ts -- the account's hosts as Settings › Hosts draws them (`../host-wire.ts`): listed, removed, the install tokens that add them kept and revoked, and a box's pairing read, approved, or denied by its code.
 *
 * Every procedure is the account's own, on its sign-in or its browser
 * session. The outputs are the wire schemas flipped, so oRPC's output
 * check encodes the handler's value into the bytes the wire carries
 * (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  devicePresenceAnswerSchema,
  hostDoneAnswerSchema,
  hostIdRequestSchema,
  hostInstallTokenAnswerSchema,
  hostInstallTokenRequestSchema,
  hostPairingAnswerSchema,
  hostPairingApproveAnswerSchema,
  hostPairingCodeRequestSchema,
  hostsAnswerSchema,
} from "../host-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** Every body here: an id, a hash, or a code, and room to spare. */
const BODY_BYTES = 1_024;

export const hostsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.HOSTS }))
    .output(EffectSchema.flip(hostsAnswerSchema)),
  presence: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.DEVICE_PRESENCE }))
    .output(EffectSchema.flip(devicePresenceAnswerSchema)),
  remove: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_REMOVE }))
    .input(exactInput(hostIdRequestSchema))
    .output(EffectSchema.flip(hostDoneAnswerSchema)),
  keepInstallToken: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_INSTALL_TOKENS }))
    .input(exactInput(hostInstallTokenRequestSchema))
    .output(EffectSchema.flip(hostInstallTokenAnswerSchema)),
  revokeInstallToken: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_INSTALL_TOKEN_REVOKE }),
    )
    .input(exactInput(hostIdRequestSchema))
    .output(EffectSchema.flip(hostDoneAnswerSchema)),
  readPairing: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_PAIRING }))
    .input(exactInput(hostPairingCodeRequestSchema))
    .output(EffectSchema.flip(hostPairingAnswerSchema)),
  approvePairing: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_PAIRING_APPROVE }))
    .input(exactInput(hostPairingCodeRequestSchema))
    .output(EffectSchema.flip(hostPairingApproveAnswerSchema)),
  denyPairing: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_PAIRING_DENY }))
    .input(exactInput(hostPairingCodeRequestSchema))
    .output(EffectSchema.flip(hostDoneAnswerSchema)),
};
