import { Schema as EffectSchema } from "effect";
import {
  hostDoneAnswerSchema,
  hostPairingAnswerSchema,
  hostPairingApproveAnswerSchema,
  hostPairingCodeRequestSchema,
} from "./host-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * host-pairing-view.ts -- a box's pairing as the approve screen hears it read, approved, or denied by its code: the answer whole, or why there is none.
 *
 * The screen asks by the code its link named (`HOST_WIRE.CONNECT_PATH`), on
 * the member's own sign-in, and is answered one of the shapes here. The
 * failures are the few it draws: the service never answered; no pending
 * pairing has the code, whether it was mistyped, lapsed, or already
 * approved or denied, by this member or another, which the screen says
 * alike; or the member named too many codes that none has, so the service
 * refuses their reads, approves, and denies until the time it names.
 */

/** Why a read, an approve, or a deny of a pairing answered nothing the screen can draw. */
export const HOST_PAIRING_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal, a shape not read. */
  UNANSWERED: "unanswered",
  /** No pending pairing has the code: mistyped, lapsed, or already approved or denied. */
  NOT_FOUND: "not-found",
  /** The member named too many codes no pending pairing has; asked again from `heldUntil` on. */
  HELD: "held",
} as const;

export type HostPairingCallFailure =
  (typeof HOST_PAIRING_CALL_FAILURE)[keyof typeof HOST_PAIRING_CALL_FAILURE];

/** A failed call, with when the member's guesses are taken again, in epoch milliseconds, where it is held and the service said. */
const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(HOST_PAIRING_CALL_FAILURE)),
  heldUntil: EffectSchema.optionalKey(countedNumber),
});

export type HostPairingFailed = typeof failed.Type;

/** What a read, an approve, or a deny names: the code as typed or as its link named it. */
export const hostPairingParamsSchema = hostPairingCodeRequestSchema;

/** A pending pairing, as the screen hears it read: the box and where its start came from, or why there is none. */
export const hostPairingViewSchema = EffectSchema.Union([hostPairingAnswerSchema, failed]);

export type HostPairingView = typeof hostPairingViewSchema.Type;

/** A pairing approved, as the screen hears it: the host it made, or why not. */
export const hostPairingApproveViewSchema = EffectSchema.Union([
  hostPairingApproveAnswerSchema,
  failed,
]);

export type HostPairingApproveView = typeof hostPairingApproveViewSchema.Type;

/** A pairing denied, as the screen hears it: done, or why not. */
export const hostPairingDenyViewSchema = EffectSchema.Union([hostDoneAnswerSchema, failed]);

export type HostPairingDenyView = typeof hostPairingDenyViewSchema.Type;
