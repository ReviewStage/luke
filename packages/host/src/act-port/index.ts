import { type ContractedRouter, onError, type Router } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import {
  type actContract,
  PLATFORM_PORT_ACT_KIND,
  type PlatformPortActKind,
} from "../contract/index.js";
import {
  type AccountAskProceduresDependencies,
  accountAskProcedures,
} from "./account-ask-procedures.js";
import { type AccountProceduresDependencies, accountProcedures } from "./account-procedures.js";
import { type AgentProceduresDependencies, agentProcedures } from "./agents-procedures.js";
import {
  type AutomationProceduresDependencies,
  automationProcedures,
} from "./automation-procedures.js";
import { type ActPortContext, actPortFor, isRefusal, refusedBy } from "./base.js";
import { type FactoryProceduresDependencies, factoryProcedures } from "./factory-procedures.js";
import {
  type IntegrationProceduresDependencies,
  integrationProcedures,
} from "./integration-procedures.js";
import { type SettingsProceduresDependencies, settingsProcedures } from "./settings-procedures.js";
import { type TasksProceduresDependencies, tasksProcedures } from "./tasks-procedures.js";
import {
  type WorkspaceProceduresDependencies,
  workspaceProcedures,
} from "./workspace-procedures.js";

/**
 * index.ts -- the act port's server: every procedure of `@luke/host/contract`, served over a window's `MessagePort`.
 *
 * The bridge upgrades each window's port with the handler built here, in
 * `apps/desktop/src/main/bridge-host.ts` alone, and hands every call the
 * context `ActPortContext` names.
 */

export type { AccountAskProceduresDependencies } from "./account-ask-procedures.js";
export type { AccountProceduresDependencies } from "./account-procedures.js";
export type { AgentProceduresDependencies } from "./agents-procedures.js";
export type { AutomationProceduresDependencies } from "./automation-procedures.js";
export { type ActPortContext, actPortFor } from "./base.js";
export type { IntegrationProceduresDependencies } from "./integration-procedures.js";
export type {
  ClientSettingSideEffects,
  SettingsProceduresDependencies,
} from "./settings-procedures.js";
export type { TasksProceduresDependencies } from "./tasks-procedures.js";
export type { WorkspaceProceduresDependencies } from "./workspace-procedures.js";

/** The act port's server, which the bridge upgrades each window's port with. */
export type ActPortHandler<Sender = unknown> = RPCHandler<ActPortContext<Sender>>;

/**
 * The procedures a platform answers itself, built from `actPortFor`: every
 * port kind that reaches its windows, ports, or system, and none of the
 * host's, so each kind has its procedure on exactly one side.
 */
export type PlatformActProcedures<Sender> = ContractedRouter<
  Pick<typeof actContract, PlatformPortActKind>,
  ActPortContext<Sender>
>;

/**
 * Every platform kind refused in its own sentence, as a platform that can
 * carry none of them answers: a shell spreads these under the few it does
 * answer, so its table stays total and the window draws each refusal, as
 * `refusedRows` does for `app:act`.
 */
export function refusedPlatformProcedures<Sender>(): PlatformActProcedures<Sender> {
  const port = actPortFor<Sender>();
  const procedures: Partial<PlatformActProcedures<Sender>> = {};
  for (const kind of Object.values(PLATFORM_PORT_ACT_KIND)) {
    // Note that every kind is refused alike, whatever it takes and answers, so it is assigned rather than typed by the kind.
    Object.assign(procedures, {
      [kind]: port[kind].handler(({ errors }) => {
        throw errors.REFUSED();
      }),
    });
  }
  // SAFETY: the loop above gave every platform kind its procedure.
  return procedures as PlatformActProcedures<Sender>;
}

/** What the act port's procedures are handed, by the domain that uses it, in alphabetical order. */
export interface ActPortDependencies {
  readonly account: AccountProceduresDependencies;
  readonly accountAsks: AccountAskProceduresDependencies;
  readonly agents: AgentProceduresDependencies;
  readonly automations: AutomationProceduresDependencies;
  readonly factory: FactoryProceduresDependencies;
  readonly integrations: IntegrationProceduresDependencies;
  readonly settings: SettingsProceduresDependencies;
  readonly tasks: TasksProceduresDependencies;
  readonly workspaces: WorkspaceProceduresDependencies;
}

/**
 * The act port's handler. Note that nothing a procedure ends in crosses as
 * anything but a refusal: a row's own refusal crosses as it is, and every
 * other failure, a defect, an input its schema refused, an answer its
 * schema could not encode, is answered with the procedure's own sentence, so
 * the window never hears what a failure held and never meets an error it
 * does not draw. That failure is logged here, in main, before it is replaced.
 * The host's procedures sit beside the platform's own, as the host's act
 * rows sit beside the platform's on `app:act` (`createHostActRouter`), and
 * together they answer every kind of the contract.
 */
export function createActPortHandler<Sender>(
  dependencies: ActPortDependencies,
  platformProcedures: PlatformActProcedures<Sender>,
): ActPortHandler<Sender> {
  const router = {
    ...platformProcedures,
    ...accountProcedures(dependencies.account),
    ...accountAskProcedures(dependencies.accountAsks),
    ...agentProcedures(dependencies.agents),
    ...automationProcedures(dependencies.automations),
    ...factoryProcedures(dependencies.factory),
    ...integrationProcedures(dependencies.integrations),
    ...settingsProcedures(dependencies.settings),
    ...tasksProcedures(dependencies.tasks),
    ...workspaceProcedures(dependencies.workspaces),
  } satisfies ContractedRouter<typeof actContract, ActPortContext<Sender>>;
  return actPortHandlerOf(router);
}

/** The act port's handler over the procedures given, every failure but a refusal answered as `createActPortHandler` says. */
export function actPortHandlerOf<Sender>(
  router: Router<ActPortContext<Sender>>,
): ActPortHandler<Sender> {
  return new RPCHandler<ActPortContext<Sender>>(router, {
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
