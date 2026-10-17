import type { ActKind } from "../acts.js";
import {
  type AccountActKind,
  type AccountActsDependencies,
  accountActRows,
} from "./account-acts.js";
import {
  type AutomationActKind,
  type AutomationActsDependencies,
  automationActRows,
} from "./automation-acts.js";
import {
  type CodingAgentActKind,
  type CodingAgentActsDependencies,
  codingAgentActRows,
} from "./coding-agent-acts.js";
import {
  type IntegrationActKind,
  type IntegrationActsDependencies,
  integrationActRows,
} from "./integration-acts.js";
import { type IssueActKind, type IssueActsDependencies, issueActRows } from "./issue-acts.js";
import { type ActRouter, type ActRows, createActRouter } from "./router.js";
import {
  type SettingsActKind,
  type SettingsActsDependencies,
  settingsActRows,
} from "./settings-acts.js";
import { type TasksActKind, type TasksActsDependencies, tasksActRows } from "./tasks-acts.js";

export {
  ActRefused,
  type ActRouter,
  type ActRows,
  type ActSender,
  createActRouter,
} from "./router.js";
export type { ClientSettingSideEffects } from "./settings-acts.js";

/** Every kind the host's own rows answer, on any platform that runs the host. */
type HostActKind =
  | AccountActKind
  | SettingsActKind
  | TasksActKind
  | CodingAgentActKind
  | IntegrationActKind
  | AutomationActKind
  | IssueActKind;

/**
 * The rows a platform answers itself: every kind the host's rows leave, and
 * no other. Derived rather than listed, so a kind added to the vocabulary
 * with a row on neither side does not build.
 */
export type PlatformActRows<Sender> = Pick<ActRows<Sender>, Exclude<ActKind, HostActKind>>;

/** What the host's rows are handed, by the group of rows that uses it. */
export interface HostActDependencies<Sender> {
  readonly account: AccountActsDependencies;
  readonly settings: SettingsActsDependencies<Sender>;
  readonly tasks: TasksActsDependencies;
  readonly codingAgents: CodingAgentActsDependencies;
  readonly integrations: IntegrationActsDependencies;
  readonly automations: AutomationActsDependencies;
  readonly issues: IssueActsDependencies;
}

/**
 * The one act table, assembled: the host's rows over the platform's. A
 * platform hands in the rows only it can answer (its windows, ports,
 * dialogs, and updater) and its own handle on the window that asked; the
 * host's rows win on every kind they answer, so a platform table that
 * carried one of them anyway is never consulted for it.
 */
export function createHostActRouter<Sender>(
  dependencies: HostActDependencies<Sender>,
  platformRows: PlatformActRows<Sender>,
): ActRouter<Sender> {
  const rows: ActRows<Sender> = {
    ...platformRows,
    ...accountActRows(dependencies.account),
    ...settingsActRows(dependencies.settings),
    ...tasksActRows(dependencies.tasks),
    ...codingAgentActRows(dependencies.codingAgents),
    ...integrationActRows(dependencies.integrations),
    ...automationActRows(dependencies.automations),
    ...issueActRows(dependencies.issues),
  };
  return createActRouter(rows);
}
