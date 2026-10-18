import { INTEGRATION_NAME, type IntegrationProvider } from "./integration-wire.js";

/**
 * failure-remedy.ts -- why a failure stands, as a typed word beside its sentence, and what the press that mends it says.
 */

export const FAILURE_REASON = {
  RECONNECT_INTEGRATION: "reconnect-integration",
  API_KEY: "api-key",
  /** The task's workspace has no GitHub connected: Settings › Workspace connects it. */
  CONNECT_GITHUB: "connect-github",
  /** The task's workspace's GitHub was uninstalled or suspended: Settings › Workspace connects it again. */
  RECONNECT_GITHUB: "reconnect-github",
  /** The installation was not given the repository: its settings page on GitHub gives it. */
  ADD_REPOSITORY: "add-repository",
  /** The repository is not one the workspace can reach at all: the task names another. */
  CHOOSE_REPOSITORY: "choose-repository",
  /** The repository's owner is connected to another workspace of the account's: the task moves there. */
  MOVE_TASK: "move-plan",
  OTHER: "other",
} as const;

export type FailureReason = (typeof FAILURE_REASON)[keyof typeof FAILURE_REASON];

/** The remedies that mend a task's repository in the task's own place, and so name the task. */
type TaskRemedyReason =
  | typeof FAILURE_REASON.CONNECT_GITHUB
  | typeof FAILURE_REASON.RECONNECT_GITHUB
  | typeof FAILURE_REASON.CHOOSE_REPOSITORY;

export type Failure =
  | {
      readonly reason: typeof FAILURE_REASON.RECONNECT_INTEGRATION;
      readonly text: string;
      readonly provider: IntegrationProvider;
      /** The account to sign in again, by its connection name, where it is not the provider's first. */
      readonly connection?: string;
      /** What the account is called among its provider's others, where it has others. */
      readonly name?: string;
    }
  | { readonly reason: TaskRemedyReason; readonly text: string; readonly taskId: string }
  | {
      readonly reason: typeof FAILURE_REASON.ADD_REPOSITORY;
      readonly text: string;
      /** `owner/name`, which the press names. */
      readonly repository: string;
      /** The installation's settings page on GitHub, where its repositories are chosen. */
      readonly settingsUrl: string;
    }
  | {
      readonly reason: typeof FAILURE_REASON.MOVE_TASK;
      readonly text: string;
      readonly taskId: string;
      /** The workspace the task moves to, whose name the press says. */
      readonly workspace: { readonly id: string; readonly name: string };
    }
  | {
      readonly reason: typeof FAILURE_REASON.API_KEY | typeof FAILURE_REASON.OTHER;
      readonly text: string;
    };

/** The remedy's label; none where only Retry answers. */
export function remedyLabel(failure: Failure): string | undefined {
  switch (failure.reason) {
    case FAILURE_REASON.RECONNECT_INTEGRATION:
      return `Reconnect ${failure.name ?? INTEGRATION_NAME[failure.provider]}`;
    case FAILURE_REASON.API_KEY:
      return "Open API keys";
    case FAILURE_REASON.CONNECT_GITHUB:
      return "Connect GitHub";
    case FAILURE_REASON.RECONNECT_GITHUB:
      return "Reconnect GitHub";
    case FAILURE_REASON.ADD_REPOSITORY:
      return `Add ${failure.repository} to Luke on GitHub`;
    case FAILURE_REASON.CHOOSE_REPOSITORY:
      return "Choose a repository";
    case FAILURE_REASON.MOVE_TASK:
      return `Move task to ${failure.workspace.name}`;
    case FAILURE_REASON.OTHER:
      return undefined;
  }
}

/**
 * Whether Retry stands beside the remedy: a remedy finished somewhere Luke
 * cannot watch, on GitHub or in Settings, leaves the same send to be made
 * again once it is done.
 */
export function retriesBesideRemedy(failure: Failure): boolean {
  return (
    failure.reason === FAILURE_REASON.CONNECT_GITHUB ||
    failure.reason === FAILURE_REASON.RECONNECT_GITHUB ||
    failure.reason === FAILURE_REASON.ADD_REPOSITORY
  );
}
