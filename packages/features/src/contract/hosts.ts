/**
 * hosts.ts -- the account's hosts as Settings › Hosts draws them (`../host-wire.ts`): listed, removed, and a box's pairing read, approved, or denied by its code.
 *
 * Every procedure is the account's own, on its sign-in or its browser
 * session. The outputs are the wire schemas flipped, so oRPC's output
 * check encodes the handler's value into the bytes the wire carries
 * (`packages/service/src/orpc/base.ts`).
 *
 * Each declares its own refusals (`declaredProcedure`): the list and the
 * presence refuse only as any procedure may, the store among them; a
 * remove refuses a host the account does not hold as not found; and a
 * pairing's read, approve, or deny refuses a code no pending pairing has as
 * not found and an account past its guesses as held, with until when.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  devicePresenceAnswerSchema,
  hostDoneAnswerSchema,
  hostIdRequestSchema,
  hostPairingAnswerSchema,
  hostPairingApproveAnswerSchema,
  hostPairingCodeRequestSchema,
  hostsAnswerSchema,
} from "../host-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** Every body here: an id or a code, and room to spare. */
const BODY_BYTES = 1_024;

export const hostsContract = {
  list: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.HOSTS }))
    .output(EffectSchema.flip(hostsAnswerSchema)),
  presence: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.DEVICE_PRESENCE }))
    .output(EffectSchema.flip(devicePresenceAnswerSchema)),
  remove: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_REMOVE }))
    .input(exactInput(hostIdRequestSchema))
    .output(EffectSchema.flip(hostDoneAnswerSchema)),
  readPairing: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.HOST_PAIRING_HELD))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_PAIRING }))
    .input(exactInput(hostPairingCodeRequestSchema))
    .output(EffectSchema.flip(hostPairingAnswerSchema)),
  approvePairing: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.HOST_PAIRING_HELD))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_PAIRING_APPROVE }))
    .input(exactInput(hostPairingCodeRequestSchema))
    .output(EffectSchema.flip(hostPairingApproveAnswerSchema)),
  denyPairing: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.HOST_PAIRING_HELD))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.HOST_PAIRING_DENY }))
    .input(exactInput(hostPairingCodeRequestSchema))
    .output(EffectSchema.flip(hostDoneAnswerSchema)),
};
