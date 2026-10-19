import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import {
  type AccountAskProceduresDependencies,
  accountAskProcedures,
} from "./account-ask-procedures.js";
import { type AccountProceduresDependencies, accountProcedures } from "./account-procedures.js";
import { type ActPortContext, isRefusal, refusedBy } from "./base.js";
import { type IssueProceduresDependencies, issueProcedures } from "./issue-procedures.js";
import { type SettingsProceduresDependencies, settingsProcedures } from "./settings-procedures.js";

/**
 * index.ts -- the act port's server: every procedure of `@luke/host/contract`, served over a window's `MessagePort`.
 *
 * The bridge upgrades each window's port with the handler built here, in
 * `apps/desktop/src/main/bridge-host.ts` alone, and hands every call the
 * context `ActPortContext` names.
 */

export type { AccountAskProceduresDependencies } from "./account-ask-procedures.js";
export type { AccountProceduresDependencies } from "./account-procedures.js";
export type { IssueProceduresDependencies } from "./issue-procedures.js";
export type {
  ClientSettingSideEffects,
  SettingsProceduresDependencies,
} from "./settings-procedures.js";

/** The act port's server, which the bridge upgrades each window's port with. */
export type ActPortHandler = RPCHandler<ActPortContext>;

/** What the act port's procedures are handed, by the domain that uses it, in alphabetical order. */
export interface ActPortDependencies {
  readonly account: AccountProceduresDependencies;
  readonly accountAsks: AccountAskProceduresDependencies;
  readonly issues: IssueProceduresDependencies;
  readonly settings: SettingsProceduresDependencies;
}

/**
 * The act port's handler. Note that nothing a procedure ends in crosses as
 * anything but a refusal: a row's own refusal crosses as it is, and every
 * other failure, a defect, an input its schema refused, an answer its
 * schema could not encode, is answered with the procedure's own sentence, so
 * the window never hears what a failure held and never meets an error it
 * does not draw. That failure is logged here, in main, before it is replaced.
 */
export function createActPortHandler(dependencies: ActPortDependencies): ActPortHandler {
  const router = {
    ...accountProcedures(dependencies.account),
    ...accountAskProcedures(dependencies.accountAsks),
    ...issueProcedures(dependencies.issues),
    ...settingsProcedures(dependencies.settings),
  };
  return new RPCHandler<ActPortContext>(router, {
    interceptors: [
      async ({ next, procedure }) => {
        try {
          return await next();
        } catch (error) {
          throw isRefusal(error) ? error : refusedBy(procedure, error);
        }
      },
      onError((error) => {
        if (!isRefusal(error)) console.error("An act failed on the act port.", error);
      }),
    ],
  });
}
