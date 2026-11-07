import { type ContractedRouter, onError, type Router } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { SentSendTrace, sendTraceOf } from "@repo/features/sentry-tracing";
import { Context } from "effect";
import {
  type actContract,
  HOST_ACTS,
  PLATFORM_PORT_ACT_KIND,
  type PlatformPortActKind,
} from "../contract/index.js";
import type { HostActTable } from "../host-acts.js";
import { type AccountProceduresDependencies, accountProcedures } from "./account-procedures.js";
import {
  type AgentInboxProceduresDependencies,
  agentInboxProcedures,
} from "./agent-inbox-procedures.js";
import { type AgentProceduresDependencies, agentProcedures } from "./agents-procedures.js";
import { type ActPortContext, actPortFor, isRefusal, refusedBy } from "./base.js";
import { declaredActProcedures } from "./declared-acts.js";
import { liveFollowProcedures } from "./live-follows.js";
import { pushProcedures, type WindowPushes } from "./push-procedures.js";
import { type SettingsProceduresDependencies, settingsProcedures } from "./settings-procedures.js";
import { type TasksProceduresDependencies, tasksProcedures } from "./tasks-procedures.js";
import {
  type WorkspaceProceduresDependencies,
  workspaceProcedures,
} from "./workspace-procedures.js";

/**
 * index.ts -- the act port's server: every procedure of `@repo/host/contract`, served over a window's `MessagePort`.
 *
 * The bridge upgrades each window's port with the handler built here, in
 * `apps/desktop/src/main/bridge-host.ts` alone, and hands every call the
 * context `ActPortContext` names.
 */

export type { AccountProceduresDependencies } from "./account-procedures.js";
export type { AgentProceduresDependencies } from "./agents-procedures.js";
export { type ActPortContext, type ActSender, actPortFor } from "./base.js";
export { browserLiveProcedures } from "./browser-live-procedures.js";
export { declaredActProcedures, declaredAnswer } from "./declared-acts.js";
export { type MacShell, macShellProcedures } from "./mac-shell-procedures.js";
export { pushProcedures, WindowPushes } from "./push-procedures.js";
export type {
  ClientSettingSideEffects,
  SettingsProceduresDependencies,
} from "./settings-procedures.js";
export {
  type TerminalPortSeam,
  terminalProcedures,
} from "./terminal-procedures.js";

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
 * answer, so its table stays total and the window draws each refusal.
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
  /** Every declared act's handler, which the port answers directly (`HostAssembly`'s). */
  readonly acts: HostActTable;
  readonly agentInbox: AgentInboxProceduresDependencies;
  /** The agents' holds and notices; the acts they note are answered from `acts`. */
  readonly agents: Omit<AgentProceduresDependencies, "acts">;
  /** What main pushes each window, which the push stream reads. */
  readonly pushes: WindowPushes;
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
 * The host's procedures sit beside the platform's own, and together they
 * answer every kind of the contract.
 *
 * A call a window sent for a press carries the press's trace as Sentry's
 * own headers, which are set as the call's `SentSendTrace`, so a hosted ask
 * it makes continues that trace (`@repo/features/hosted-link`).
 */
export function createActPortHandler<Sender>(
  dependencies: ActPortDependencies,
  platformProcedures: PlatformActProcedures<Sender>,
): ActPortHandler<Sender> {
  const router = {
    ...platformProcedures,
    ...accountProcedures(dependencies.account),
    ...declaredActProcedures(HOST_ACTS, dependencies.acts),
    ...liveFollowProcedures(HOST_ACTS, dependencies.acts),
    ...agentInboxProcedures(dependencies.agentInbox),
    ...agentProcedures({ ...dependencies.agents, acts: dependencies.acts }),
    ...settingsProcedures(dependencies.settings),
    ...tasksProcedures(dependencies.tasks),
    ...workspaceProcedures(dependencies.workspaces, dependencies.acts),
  } satisfies ContractedRouter<typeof actContract, ActPortContext<Sender>>;
  return actPortHandlerOf({ ...router, ...pushProcedures(dependencies.pushes) });
}

/** The act port's handler over the procedures given, every failure but a refusal answered as `createActPortHandler` says. */
export function actPortHandlerOf<Sender>(
  router: Router<ActPortContext<Sender>>,
): ActPortHandler<Sender> {
  return new RPCHandler<ActPortContext<Sender>>(router, {
    interceptors: [
      ({ next, request, context, ...options }) => {
        const trace = sendTraceOf(request.headers);
        if (trace === undefined) return next();
        const services = Context.add(context["effect/context"], SentSendTrace, trace);
        return next({ ...options, request, context: { ...context, "effect/context": services } });
      },
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
