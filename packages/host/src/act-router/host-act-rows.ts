import {
  type AccountActKind,
  type AccountActsDependencies,
  accountActRows,
} from "./account-acts.js";
import {
  type CodingAgentActKind,
  type CodingAgentActsDependencies,
  codingAgentActRows,
} from "./coding-agent-acts.js";
import type { ActRows } from "./router.js";
import {
  type SettingsActKind,
  type SettingsActsDependencies,
  settingsActRows,
} from "./settings-acts.js";
import { type TasksActKind, type TasksActsDependencies, tasksActRows } from "./tasks-acts.js";

/** Every kind the host's own rows answer, on any platform that runs the host. */
export type HostActKind = AccountActKind | SettingsActKind | TasksActKind | CodingAgentActKind;

/** What the host's rows are handed, by the group of rows that uses it. */
export interface HostActDependencies<Sender> {
  readonly account: AccountActsDependencies;
  readonly settings: SettingsActsDependencies<Sender>;
  readonly tasks: TasksActsDependencies;
  readonly codingAgents: CodingAgentActsDependencies;
}

/** The host's own rows, the same on every platform that runs the host. */
export function hostActRows<Sender>(
  dependencies: HostActDependencies<Sender>,
): Pick<ActRows<Sender>, HostActKind> {
  return {
    ...accountActRows(dependencies.account),
    ...settingsActRows(dependencies.settings),
    ...tasksActRows(dependencies.tasks),
    ...codingAgentActRows(dependencies.codingAgents),
  };
}
