import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { THIS_MAC_HOST_ACT_KIND } from "./kinds.js";

/**
 * this-mac-host.ts -- This Mac's `luke-host` as Settings › Agents draws it: where it stands, and turning it on again, as procedures.
 *
 * The host answers both (`compose-this-mac-host.ts`): the standing it last
 * found, read again every few seconds while the switch is on, and an
 * explicit turn-on, which enrolls the Mac again where Luke removed it or
 * where the last turn-on failed. A browser tab runs no local agents, so it
 * refuses both.
 */

/** Where This Mac's `luke-host` stands. */
export const THIS_MAC_HOST_STANDING = {
  /** Run agents on this Mac is off, or there is no account to run them for: nothing to draw. */
  OFF: "off",
  /** Being turned on: the Mac enrolled and its login item registered. */
  TURNING_ON: "turning-on",
  /** `luke-host` holds the machine's lease and follows its agents. */
  RUNNING: "running",
  /** Registered, but not following: starting, between logins, or waiting on Luke. */
  NOT_RUNNING: "not-running",
  /** Registered, and waiting on the member in System Settings › General › Login Items. */
  REQUIRES_APPROVAL: "requires-approval",
  /** Luke refused this Mac's secret: it was removed, and comes back only by turning it on again. */
  REMOVED: "removed",
  /** The last turn-on failed, for the reason it carries. */
  FAILED: "failed",
  /** This Mac runs agents for another Luke account signed in on it before. */
  OTHER_ACCOUNT: "other-account",
} as const;

export const thisMacHostStandingSchema = EffectSchema.Union([
  EffectSchema.Struct({
    standing: EffectSchema.Literals([
      THIS_MAC_HOST_STANDING.OFF,
      THIS_MAC_HOST_STANDING.TURNING_ON,
      THIS_MAC_HOST_STANDING.RUNNING,
      THIS_MAC_HOST_STANDING.NOT_RUNNING,
      THIS_MAC_HOST_STANDING.REQUIRES_APPROVAL,
      THIS_MAC_HOST_STANDING.REMOVED,
      THIS_MAC_HOST_STANDING.OTHER_ACCOUNT,
    ]),
  }),
  EffectSchema.Struct({
    standing: EffectSchema.Literal(THIS_MAC_HOST_STANDING.FAILED),
    reason: EffectSchema.String,
  }),
]);

export type ThisMacHostStanding = typeof thisMacHostStandingSchema.Type;

export const thisMacHostActsContract = {
  [THIS_MAC_HOST_ACT_KIND.THIS_MAC_HOST_READ]: actProcedure("Could not read this Mac's host.")
    .input(exactInput(EffectSchema.Undefined))
    .output(thisMacHostStandingSchema),
  [THIS_MAC_HOST_ACT_KIND.THIS_MAC_HOST_TURN_ON]: actProcedure(
    "Could not turn on agents on this Mac.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(thisMacHostStandingSchema),
};
