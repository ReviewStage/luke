import type {
  AnyContractProcedure,
  ContractRouterClient,
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import { accountActsContract } from "./account.js";
import { accountAskActsContract } from "./account-asks.js";
import { agentInboxActsContract } from "./agent-inbox.js";
import { agentActsContract } from "./agents.js";
import { automationActsContract } from "./automations.js";
import { browserLiveActsContract } from "./browser-live.js";
import { chaptersActsContract } from "./chapters.js";
import { cliActsContract } from "./cli.js";
import { installedSkillActsContract } from "./installed-skills.js";
import { integrationActsContract } from "./integrations.js";
import type { PortActKind } from "./kinds.js";
import { macCommandActsContract } from "./mac-commands.js";
import { macShellActsContract } from "./mac-shells.js";
import { macTerminalActsContract } from "./mac-terminals.js";
import { portForwardActsContract } from "./port-forwards.js";
import { pushesContract } from "./pushes.js";
import { settingsActsContract } from "./settings.js";
import { tasksActsContract } from "./tasks.js";
import { terminalActsContract } from "./terminals.js";
import { updateActsContract } from "./updates.js";
import { windowSurfaceActsContract } from "./window-surface.js";
import { workspaceActsContract } from "./workspaces.js";

export {
  MAC_COMMAND_DECISION,
  type MacCommandAnswer,
  type MacCommandDecision,
} from "../mac-command-ask.js";
export { ACT_ERROR } from "./base.js";
export { CLI_INSTALL_OUTCOME, type CliInstallAnswer } from "./cli.js";
export {
  ACCOUNT_ACT_KIND,
  ACCOUNT_ASK_ACT_KIND,
  AGENT_ACT_KIND,
  AGENT_INBOX_ACT_KIND,
  AUTOMATION_ACT_KIND,
  BROWSER_LIVE_ACT_KIND,
  CHAPTERS_ACT_KIND,
  CLI_ACT_KIND,
  INSTALLED_SKILL_ACT_KIND,
  INTEGRATION_ACT_KIND,
  MAC_COMMAND_ACT_KIND,
  MAC_SHELL_ACT_KIND,
  MAC_TERMINAL_ACT_KIND,
  PLATFORM_PORT_ACT_KIND,
  type PlatformPortActKind,
  PORT_FORWARD_ACT_KIND,
  type PortActKind,
  SETTINGS_ACT_KIND,
  TASKS_ACT_KIND,
  TERMINAL_ACT_KIND,
  UPDATE_ACT_KIND,
  WINDOW_SURFACE_ACT_KIND,
  WORKSPACE_ACT_KIND,
} from "./kinds.js";
export {
  type EventPushName,
  PUSH,
  PUSH_GUARD,
  PUSH_METHOD,
  PUSH_PROCEDURE,
  type PushEvent,
  type PushName,
  type PushPayload,
} from "./pushes.js";
export type { SettingUpdatePayload } from "./settings.js";
export { CONTACT_MAILTO } from "./window-surface.js";

export const actContract = {
  ...accountActsContract,
  ...accountAskActsContract,
  ...agentActsContract,
  ...agentInboxActsContract,
  ...automationActsContract,
  ...browserLiveActsContract,
  ...chaptersActsContract,
  ...cliActsContract,
  ...installedSkillActsContract,
  ...integrationActsContract,
  ...macCommandActsContract,
  ...macShellActsContract,
  ...macTerminalActsContract,
  ...portForwardActsContract,
  ...settingsActsContract,
  ...tasksActsContract,
  ...terminalActsContract,
  ...updateActsContract,
  ...windowSurfaceActsContract,
  ...workspaceActsContract,
} satisfies Record<PortActKind, AnyContractProcedure>;

export const actPortContract = {
  ...actContract,
  ...pushesContract,
};

export type ActPortClient = ContractRouterClient<typeof actPortContract>;

export type PortActPayload<Kind extends PortActKind> = InferContractRouterInputs<
  typeof actContract
>[Kind];

export type PortActResult<Kind extends PortActKind> = InferContractRouterOutputs<
  typeof actContract
>[Kind];
