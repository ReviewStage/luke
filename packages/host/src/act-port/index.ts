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
import {
  type AgentInboxProceduresDependencies,
  agentInboxProcedures,
} from "./agent-inbox-procedures.js";
import { type AgentProceduresDependencies, agentProcedures } from "./agents-procedures.js";
import {
  type AutomationProceduresDependencies,
  automationProcedures,
} from "./automation-procedures.js";
import { type ActPortContext, actPortFor, isRefusal, refusedBy } from "./base.js";
import { type ChaptersProceduresDependencies, chaptersProcedures } from "./chapters-procedures.js";
import {
  type InstalledSkillProceduresDependencies,
  installedSkillProcedures,
} from "./installed-skill-procedures.js";
import {
  type IntegrationProceduresDependencies,
  integrationProcedures,
} from "./integration-procedures.js";
import {
  type MacCommandProceduresDependencies,
  macCommandProcedures,
} from "./mac-command-procedures.js";
import { pushProcedures, type WindowPushes } from "./push-procedures.js";
import { type SettingsProceduresDependencies, settingsProcedures } from "./settings-procedures.js";
import { type TasksProceduresDependencies, tasksProcedures } from "./tasks-procedures.js";
import {
  type WorkspaceProceduresDependencies,
  workspaceProcedures,
} from "./workspace-procedures.js";

export { accountAskProcedures } from "./account-ask-procedures.js";
export type { AccountProceduresDependencies } from "./account-procedures.js";
export type { AgentProceduresDependencies } from "./agents-procedures.js";
export type { AutomationProceduresDependencies } from "./automation-procedures.js";
export { type ActPortContext, type ActSender, actPortFor } from "./base.js";
export { browserLiveProcedures } from "./browser-live-procedures.js";
export type { IntegrationProceduresDependencies } from "./integration-procedures.js";
export { type MacShell, macShellProcedures } from "./mac-shell-procedures.js";
export { portForwardProcedures } from "./port-forward-procedures.js";
export { pushProcedures, WindowPushes } from "./push-procedures.js";
export type {
  ClientSettingSideEffects,
  SettingsProceduresDependencies,
} from "./settings-procedures.js";
export {
  type TerminalPortSeam,
  terminalProcedures,
} from "./terminal-procedures.js";

export type ActPortHandler<Sender = unknown> = RPCHandler<ActPortContext<Sender>>;

export type PlatformActProcedures<Sender> = ContractedRouter<
  Pick<typeof actContract, PlatformPortActKind>,
  ActPortContext<Sender>
>;

export function refusedPlatformProcedures<Sender>(): PlatformActProcedures<Sender> {
  const port = actPortFor<Sender>();
  const procedures: Partial<PlatformActProcedures<Sender>> = {};
  for (const kind of Object.values(PLATFORM_PORT_ACT_KIND)) {
    Object.assign(procedures, {
      [kind]: port[kind].handler(({ errors }) => {
        throw errors.REFUSED();
      }),
    });
  }
  return procedures as PlatformActProcedures<Sender>;
}

export interface ActPortDependencies {
  readonly account: AccountProceduresDependencies;
  readonly accountAsks: AccountAskProceduresDependencies;
  readonly agentInbox: AgentInboxProceduresDependencies;
  readonly agents: AgentProceduresDependencies;
  readonly automations: AutomationProceduresDependencies;
  readonly chapters: ChaptersProceduresDependencies;
  readonly installedSkills: InstalledSkillProceduresDependencies;
  readonly integrations: IntegrationProceduresDependencies;
  readonly macCommands: MacCommandProceduresDependencies;
  readonly pushes: WindowPushes;
  readonly settings: SettingsProceduresDependencies;
  readonly tasks: TasksProceduresDependencies;
  readonly workspaces: WorkspaceProceduresDependencies;
}

export function createActPortHandler<Sender>(
  dependencies: ActPortDependencies,
  platformProcedures: PlatformActProcedures<Sender>,
): ActPortHandler<Sender> {
  const router = {
    ...platformProcedures,
    ...accountProcedures(dependencies.account),
    ...accountAskProcedures(dependencies.accountAsks),
    ...agentInboxProcedures(dependencies.agentInbox),
    ...agentProcedures(dependencies.agents),
    ...automationProcedures(dependencies.automations),
    ...chaptersProcedures(dependencies.chapters),
    ...installedSkillProcedures(dependencies.installedSkills),
    ...integrationProcedures(dependencies.integrations),
    ...macCommandProcedures(dependencies.macCommands),
    ...settingsProcedures(dependencies.settings),
    ...tasksProcedures(dependencies.tasks),
    ...workspaceProcedures(dependencies.workspaces),
  } satisfies ContractedRouter<typeof actContract, ActPortContext<Sender>>;
  return actPortHandlerOf({ ...router, ...pushProcedures(dependencies.pushes) });
}

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
