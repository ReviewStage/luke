import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { THIS_MAC_HOST_ACT_KIND } from "./kinds.js";

/**
 * this-mac-host.ts -- This Mac's `luke-host` as Settings › Hosts draws it: where it stands, and turning it on again, as procedures.
 *
 * The host answers both (`compose-this-mac-host.ts`): the standing it last
 * found, read again every few seconds while the Local agents experiment is
 * on, with the setup this Mac registered where the service lists it, and the
 * member's own turn-on, which enrolls the Mac again where Luke removed it or
 * the last turn-on failed, and starts `luke-host` again where its setup
 * failed. A browser tab runs no local agents, so it refuses both.
 */

/** Where This Mac's `luke-host` stands. */
export const THIS_MAC_HOST_STANDING = {
  /** The Local agents experiment is off, or there is no account to run them for: nothing to draw. */
  OFF: "off",
  /** Being turned on: the Mac enrolled and its login item registered. */
  TURNING_ON: "turning-on",
  /** `luke-host` is fetching what its VMs run on, which takes no agent until it is done. */
  GETTING_READY: "getting-ready",
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
  /** `luke-host` could not fetch what its VMs run on, for the reason it registered. */
  SETUP_FAILED: "setup-failed",
  /** This Mac runs agents for another Luke account signed in on it before. */
  OTHER_ACCOUNT: "other-account",
} as const;

/** The device this Mac is enrolled as for the account signed in, where it is, so Hosts draws its standing on its row. */
const deviceIdField = EffectSchema.optionalKey(EffectSchema.String);

export const thisMacHostStandingSchema = EffectSchema.Union([
  EffectSchema.Struct({
    standing: EffectSchema.Literals([
      THIS_MAC_HOST_STANDING.OFF,
      THIS_MAC_HOST_STANDING.TURNING_ON,
      THIS_MAC_HOST_STANDING.GETTING_READY,
      THIS_MAC_HOST_STANDING.RUNNING,
      THIS_MAC_HOST_STANDING.NOT_RUNNING,
      THIS_MAC_HOST_STANDING.REQUIRES_APPROVAL,
      THIS_MAC_HOST_STANDING.REMOVED,
      THIS_MAC_HOST_STANDING.OTHER_ACCOUNT,
    ]),
    deviceId: deviceIdField,
  }),
  EffectSchema.Struct({
    standing: EffectSchema.Literals([
      THIS_MAC_HOST_STANDING.FAILED,
      THIS_MAC_HOST_STANDING.SETUP_FAILED,
    ]),
    reason: EffectSchema.String,
    deviceId: deviceIdField,
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
