import { Effect } from "effect";
import { THIS_MAC_HOST_ACT_KIND } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { actPort } from "./base.js";

/**
 * this-mac-host-procedures.ts -- This Mac's host as Settings › Hosts asks the host: the device its record names.
 *
 * The host answers it (`../compose-this-mac-host.ts`); one it could not
 * answer, a browser tab's host among them, which has no This Mac, is
 * refused with the procedure's own words.
 */
export interface ThisMacHostProceduresDependencies {
  host: Pick<HostOperator, "thisMacHost">;
}

export function thisMacHostProcedures(dependencies: ThisMacHostProceduresDependencies) {
  const { host } = dependencies;
  return {
    [THIS_MAC_HOST_ACT_KIND.THIS_MAC_HOST_READ]: actPort[
      THIS_MAC_HOST_ACT_KIND.THIS_MAC_HOST_READ
    ].effect(function* ({ errors }) {
      const read = yield* host.thisMacHost();
      if (read === undefined) return yield* Effect.fail(errors.REFUSED());
      return read;
    }),
  };
}
