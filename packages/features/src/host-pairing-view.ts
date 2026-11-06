import { Schema as EffectSchema } from "effect";
import {
  hostDoneAnswerSchema,
  hostPairingAnswerSchema,
  hostPairingApproveAnswerSchema,
  hostPairingCodeRequestSchema,
} from "./host-wire.js";
import { countedNumber } from "./service-wire.js";

export const HOST_PAIRING_CALL_FAILURE = {
  UNANSWERED: "unanswered",
  NOT_FOUND: "not-found",
  HELD: "held",
} as const;

export type HostPairingCallFailure =
  (typeof HOST_PAIRING_CALL_FAILURE)[keyof typeof HOST_PAIRING_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(HOST_PAIRING_CALL_FAILURE)),
  heldUntil: EffectSchema.optionalKey(countedNumber),
});

export type HostPairingFailed = typeof failed.Type;

export const hostPairingParamsSchema = hostPairingCodeRequestSchema;

export const hostPairingViewSchema = EffectSchema.Union([hostPairingAnswerSchema, failed]);

export type HostPairingView = typeof hostPairingViewSchema.Type;

export const hostPairingApproveViewSchema = EffectSchema.Union([
  hostPairingApproveAnswerSchema,
  failed,
]);

export type HostPairingApproveView = typeof hostPairingApproveViewSchema.Type;

export const hostPairingDenyViewSchema = EffectSchema.Union([hostDoneAnswerSchema, failed]);

export type HostPairingDenyView = typeof hostPairingDenyViewSchema.Type;
