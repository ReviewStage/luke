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
import { avatarActsContract } from "./avatar.js";
import { browserActsContract } from "./browser.js";
import { chaptersActsContract } from "./chapters.js";
import { factoryActsContract } from "./factory.js";
import { integrationActsContract } from "./integrations.js";
import type { PortActKind } from "./kinds.js";
import { macTerminalActsContract } from "./mac-terminals.js";
import { pushesContract } from "./pushes.js";
import { settingsActsContract } from "./settings.js";
import { taskIssueActsContract } from "./task-issues.js";
import { tasksActsContract } from "./tasks.js";
import { terminalActsContract } from "./terminals.js";
import { updateActsContract } from "./updates.js";
import { voiceRuntimeActsContract } from "./voice-runtime.js";
import { windowSurfaceActsContract } from "./window-surface.js";
import { workspaceActsContract } from "./workspaces.js";

/**
 * index.ts -- the oRPC contract of the acts a window's act port answers, keyed by act kind.
 *
 * A subpath door of its own (`@luke/host/contract`), read by the panel's act
 * door and implemented by `@luke/host/act-port`, so it and everything it
 * imports stay free of Node. The router is flat and keyed by the kind
 * itself, so a window calls a kind by the name it already spells, and a kind
 * with no procedure here cannot be called on the port at all.
 */

export type { ChatShown } from "./agents.js";
export { ACT_ERROR } from "./base.js";
export {
  ACCOUNT_ACT_KIND,
  ACCOUNT_ASK_ACT_KIND,
  AGENT_ACT_KIND,
  AGENT_INBOX_ACT_KIND,
  AUTOMATION_ACT_KIND,
  AVATAR_ACT_KIND,
  BROWSER_ACT_KIND,
  CHAPTERS_ACT_KIND,
  FACTORY_ACT_KIND,
  INTEGRATION_ACT_KIND,
  MAC_TERMINAL_ACT_KIND,
  PLATFORM_PORT_ACT_KIND,
  type PlatformPortActKind,
  type PortActKind,
  SETTINGS_ACT_KIND,
  TASK_ISSUE_ACT_KIND,
  TASKS_ACT_KIND,
  TERMINAL_ACT_KIND,
  UPDATE_ACT_KIND,
  VOICE_RUNTIME_ACT_KIND,
  WINDOW_SURFACE_ACT_KIND,
  WORKSPACE_ACT_KIND,
} from "./kinds.js";
export { MAC_REPOSITORIES_REFUSAL } from "./mac-terminals.js";
export {
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

/** Every domain's procedures, one spread each, in alphabetical order. */
export const actContract = {
  ...accountActsContract,
  ...accountAskActsContract,
  ...agentActsContract,
  ...agentInboxActsContract,
  ...automationActsContract,
  ...avatarActsContract,
  ...browserActsContract,
  ...chaptersActsContract,
  ...factoryActsContract,
  ...integrationActsContract,
  ...macTerminalActsContract,
  ...settingsActsContract,
  ...tasksActsContract,
  ...taskIssueActsContract,
  ...terminalActsContract,
  ...updateActsContract,
  ...voiceRuntimeActsContract,
  ...windowSurfaceActsContract,
  ...workspaceActsContract,
} satisfies Record<PortActKind, AnyContractProcedure>;

/**
 * Everything a window's act port answers: every act kind's procedure, and
 * beside them the stream of what main pushes the window, under a key no act
 * kind spells.
 */
export const actPortContract = {
  ...actContract,
  ...pushesContract,
};

/** The window's typed client of the act port. */
export type ActPortClient = ContractRouterClient<typeof actPortContract>;

/** What one port kind takes. */
export type PortActPayload<Kind extends PortActKind> = InferContractRouterInputs<
  typeof actContract
>[Kind];

/** What one port kind answers, as it crosses the port. */
export type PortActResult<Kind extends PortActKind> = InferContractRouterOutputs<
  typeof actContract
>[Kind];
