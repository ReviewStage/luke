import { Effect } from "effect";
import { THIS_MAC_HOST_ACT_KIND } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { actPort } from "./base.js";

/**
 * this-mac-host-procedures.ts -- This Mac's `luke-host` as Settings › Hosts asks the host: where it stands, and turned on by the member's own act.
 *
 * The host answers both (`../compose-this-mac-host.ts`); one it could not
 * answer, a browser tab's host among them, which runs no local agents, is
 * refused with the procedure's own words.
 */
export interface ThisMacHostProceduresDependencies {
  host: Pick<HostOperator, "thisMacHostStanding" | "turnOnThisMacHost">;
}

export function thisMacHostProcedures(dependencies: ThisMacHostProceduresDependencies) {
  const { host } = dependencies;
  return {
    [THIS_MAC_HOST_ACT_KIND.THIS_MAC_HOST_READ]: actPort[
      THIS_MAC_HOST_ACT_KIND.THIS_MAC_HOST_READ
    ].effect(function* ({ errors }) {
      const standing = yield* host.thisMacHostStanding();
      if (standing === undefined) return yield* Effect.fail(errors.REFUSED());
      return standing;
    }),
    [THIS_MAC_HOST_ACT_KIND.THIS_MAC_HOST_TURN_ON]: actPort[
      THIS_MAC_HOST_ACT_KIND.THIS_MAC_HOST_TURN_ON
    ].effect(function* ({ errors }) {
      const standing = yield* host.turnOnThisMacHost();
      if (standing === undefined) return yield* Effect.fail(errors.REFUSED());
      return standing;
    }),
  };
}
