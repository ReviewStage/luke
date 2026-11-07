import { hostsContract } from "./contract/hosts.js";
import { hostPairingCodeRequestSchema } from "./host-wire.js";
import { answerView, failureSetOf } from "./hosted-failure.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

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

/**
 * The failures the screen reads in an older spelling than the refusal's
 * own: a code refused by its shape is one no pending pairing has, and an
 * account past its guesses is held.
 */
export const HOST_PAIRING_RENAMES = {
  [HOSTED_API_ERROR.INVALID_REQUEST]: "not-found",
  [HOSTED_API_ERROR.HOST_PAIRING_HELD]: "held",
} as const;

/** A pairing's procedures, as their contracts declare their refusals. */
const HOST_PAIRING_CALLS = {
  readPairing: hostsContract.readPairing,
  approvePairing: hostsContract.approvePairing,
  denyPairing: hostsContract.denyPairing,
};

/**
 * Why a read, an approve, or a deny of a pairing answered nothing the
 * screen can draw, as their contracts declare it: no answer at all
 * (`unanswered`), no pending pairing has the code, mistyped, lapsed, or
 * already approved or denied (`not-found`), or the member named too many
 * codes no pending pairing has, asked again from `heldUntil` on (`held`).
 */
export const HOST_PAIRING_CALL_FAILURE = failureSetOf(HOST_PAIRING_CALLS, {
  as: HOST_PAIRING_RENAMES,
});

export type HostPairingCallFailure =
  (typeof HOST_PAIRING_CALL_FAILURE)[keyof typeof HOST_PAIRING_CALL_FAILURE];

/** What a read, an approve, or a deny names: the code as typed or as its link named it. */
export const hostPairingParamsSchema = hostPairingCodeRequestSchema;

/** A pending pairing, as the screen hears it read: the box and where its start came from, or why there is none. */
export const hostPairingViewSchema = answerView(hostsContract.readPairing, {
  as: HOST_PAIRING_RENAMES,
});

export type HostPairingView = typeof hostPairingViewSchema.Type;

/** A failed call, with when the member's guesses are taken again, in epoch milliseconds, where it is held and the service said, and the facts of what failed beneath it where it reached no answer. */
export type HostPairingFailed = (typeof hostPairingViewSchema.members)[1]["Type"];

/** A pairing approved, as the screen hears it: the host it made, or why not. */
export const hostPairingApproveViewSchema = answerView(hostsContract.approvePairing, {
  as: HOST_PAIRING_RENAMES,
});

export type HostPairingApproveView = typeof hostPairingApproveViewSchema.Type;

/** A pairing denied, as the screen hears it: done, or why not. */
export const hostPairingDenyViewSchema = answerView(hostsContract.denyPairing, {
  as: HOST_PAIRING_RENAMES,
});

export type HostPairingDenyView = typeof hostPairingDenyViewSchema.Type;
