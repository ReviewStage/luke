import type {
  AnyContractProcedure,
  ContractRouterClient,
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import type { SendTrace } from "@repo/features/sentry-tracing";
import { ACCOUNT_ACTS, accountActsContract } from "./account.js";
import { ACCOUNT_ASK_ACTS, accountAskActsContract } from "./account-asks.js";
import { AGENT_INBOX_ACTS, agentInboxActsContract } from "./agent-inbox.js";
import { AGENT_ACTS, agentActsContract } from "./agents.js";
import { AUTOMATION_ACTS, automationActsContract } from "./automations.js";
import { browserLiveActsContract } from "./browser-live.js";
import { CHAPTERS_ACTS, chaptersActsContract } from "./chapters.js";
import { cliActsContract } from "./cli.js";
import { INSTALLED_SKILL_ACTS, installedSkillActsContract } from "./installed-skills.js";
import { INTEGRATION_ACTS, integrationActsContract } from "./integrations.js";
import type { PortActKind } from "./kinds.js";
import { MAC_COMMAND_ACTS, macCommandActsContract } from "./mac-commands.js";
import { macShellActsContract } from "./mac-shells.js";
import { macTerminalActsContract } from "./mac-terminals.js";
import { PORT_FORWARD_ACTS, portForwardActsContract } from "./port-forwards.js";
import { pushesContract } from "./pushes.js";
import { SETTINGS_ACTS, settingsActsContract } from "./settings.js";
import { TASKS_ACTS, tasksActsContract } from "./tasks.js";
import { terminalActsContract } from "./terminals.js";
import { updateActsContract } from "./updates.js";
import { windowSurfaceActsContract } from "./window-surface.js";
import { WORKSPACE_ACTS, workspaceActsContract } from "./workspaces.js";

/**
 * index.ts -- the oRPC contract of the acts a window's act port answers, keyed by act kind.
 *
 * A subpath door of its own (`@repo/host/contract`), read by the panel's act
 * door and implemented by `@repo/host/act-port`, so it and everything it
 * imports stay free of Node. The router is flat and keyed by the kind
 * itself, so a window calls a kind by the name it already spells, and a kind
 * with no procedure here cannot be called on the port at all.
 */

export {
  MAC_COMMAND_DECISION,
  type MacCommandAnswer,
  type MacCommandDecision,
} from "../mac-command-ask.js";
export { ACCOUNT_ACTS } from "./account.js";
export { ACCOUNT_ASK_ACTS } from "./account-asks.js";
export { AGENT_INBOX_ACTS } from "./agent-inbox.js";
export { AGENT_ACTS } from "./agents.js";
export { AUTOMATION_ACTS } from "./automations.js";
export { ACT_ERROR } from "./base.js";
export { CHAPTERS_ACTS } from "./chapters.js";
export { CLI_INSTALL_OUTCOME, type CliInstallAnswer } from "./cli.js";
export {
  type ActInput,
  type ActOutput,
  type AnyHostAct,
  type AnyHostActDeclaration,
  declaredActs,
  hostAct,
  panelOnlyOf,
} from "./declared-act.js";
export { INSTALLED_SKILL_ACTS } from "./installed-skills.js";
export { INTEGRATION_ACTS } from "./integrations.js";
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
  MAC_SHELL_ACT_KIND,
  MAC_TERMINAL_ACT_KIND,
  PLATFORM_PORT_ACT_KIND,
  type PlatformPortActKind,
  type PortActKind,
  SETTINGS_ACT_KIND,
  TASKS_ACT_KIND,
  TERMINAL_ACT_KIND,
  UPDATE_ACT_KIND,
  WINDOW_SURFACE_ACT_KIND,
  WORKSPACE_ACT_KIND,
} from "./kinds.js";
export { MAC_COMMAND_ACTS } from "./mac-commands.js";
export { PORT_FORWARD_ACTS } from "./port-forwards.js";
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
export { SETTINGS_ACTS, type SettingUpdatePayload } from "./settings.js";
export { TASKS_ACTS } from "./tasks.js";
export { CONTACT_MAILTO } from "./window-surface.js";
export { WORKSPACE_ACTS } from "./workspaces.js";

/** Every act declared once (`declared-act.ts`), one domain's spread each, in alphabetical order: what the host's composers answer directly. */
export const HOST_ACTS = {
  ...ACCOUNT_ACTS,
  ...ACCOUNT_ASK_ACTS,
  ...AGENT_INBOX_ACTS,
  ...AGENT_ACTS,
  ...AUTOMATION_ACTS,
  ...CHAPTERS_ACTS,
  ...INSTALLED_SKILL_ACTS,
  ...INTEGRATION_ACTS,
  ...MAC_COMMAND_ACTS,
  ...PORT_FORWARD_ACTS,
  ...SETTINGS_ACTS,
  ...TASKS_ACTS,
  ...WORKSPACE_ACTS,
};

/** Every domain's procedures, one spread each, in alphabetical order. */
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

/**
 * Everything a window's act port answers: every act kind's procedure, and
 * beside them the stream of what main pushes the window, under a key no act
 * kind spells.
 */
export const actPortContract = {
  ...actContract,
  ...pushesContract,
};

/**
 * What a window may hand one call of its act port beside its input: the
 * trace of the send it was pressed for, which the port carries to the host
 * as Sentry's own headers (`@repo/features/sentry-tracing`).
 */
export interface ActPortCallContext {
  readonly trace?: SendTrace | undefined;
}

/** The window's typed client of the act port. */
export type ActPortClient = ContractRouterClient<typeof actPortContract, ActPortCallContext>;

/** What one port kind takes. */
export type PortActPayload<Kind extends PortActKind> = InferContractRouterInputs<
  typeof actContract
>[Kind];

/** What one port kind answers, as it crosses the port. */
export type PortActResult<Kind extends PortActKind> = InferContractRouterOutputs<
  typeof actContract
>[Kind];
