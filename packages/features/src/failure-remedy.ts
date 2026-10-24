import { harnessNameOf } from "./agent-runtime-models.js";
import { INTEGRATION_NAME, type IntegrationProvider } from "./integration-wire.js";
import type { ModelProvider } from "./models-wire.js";

/**
 * failure-remedy.ts -- why a failure stands, as a typed word beside its sentence, and what the press that mends it says.
 */

export const FAILURE_REASON = {
  RECONNECT_INTEGRATION: "reconnect-integration",
  /** The member's own API key was refused or cannot be read: its harness's row on Settings › Agents replaces it. */
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
  /** GitHub refused the member's own token: Settings › Profile replaces it. */
  GITHUB_TOKEN: "github-token",
  /** The member's own token is not authorized for an organization's SAML SSO: GitHub's own page authorizes it. */
  AUTHORIZE_TOKEN: "authorize-token",
  /** No subscription or API key of the member's pays for the model's provider: its harness's row on Settings › Agents connects one. */
  CONNECT_AGENTS: "connect-agents",
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
      readonly reason: typeof FAILURE_REASON.AUTHORIZE_TOKEN;
      readonly text: string;
      /** The organization whose SAML SSO the token is authorized for, which the press names. */
      readonly organization: string;
      /** GitHub's page that authorizes the token, from its `X-GitHub-SSO` header. */
      readonly authorizeUrl: string;
    }
  | {
      readonly reason: typeof FAILURE_REASON.API_KEY | typeof FAILURE_REASON.CONNECT_AGENTS;
      readonly text: string;
      /** The provider whose harness the press connects, which it names and lands on; none where the service named none. */
      readonly provider?: ModelProvider | undefined;
    }
  | {
      readonly reason: typeof FAILURE_REASON.GITHUB_TOKEN;
      readonly text: string;
      /** No token is saved, so the press adds one where a refused token is updated. */
      readonly noneSaved?: boolean | undefined;
    }
  | {
      readonly reason: typeof FAILURE_REASON.OTHER;
      readonly text: string;
    };

/** What a press that connects an agent's credential says: the harness it connects, or Settings where none is known. */
function connectLabel(provider: ModelProvider | undefined): string {
  return provider === undefined ? "Open Settings" : `Connect ${harnessNameOf(provider)}`;
}

/** The remedy's label; none where only Retry answers. */
export function remedyLabel(failure: Failure): string | undefined {
  switch (failure.reason) {
    case FAILURE_REASON.RECONNECT_INTEGRATION:
      return `Reconnect ${failure.name ?? INTEGRATION_NAME[failure.provider]}`;
    case FAILURE_REASON.API_KEY:
      return connectLabel(failure.provider);
    case FAILURE_REASON.CONNECT_GITHUB:
      return "Connect GitHub";
    case FAILURE_REASON.RECONNECT_GITHUB:
      return "Reconnect GitHub";
    case FAILURE_REASON.ADD_REPOSITORY:
      return `Add ${failure.repository} to Luke's GitHub App`;
    case FAILURE_REASON.CHOOSE_REPOSITORY:
      return "Choose a repository";
    case FAILURE_REASON.MOVE_TASK:
      return `Move task to ${failure.workspace.name}`;
    case FAILURE_REASON.GITHUB_TOKEN:
      return failure.noneSaved === true ? "Add GitHub token" : "Update GitHub token";
    case FAILURE_REASON.AUTHORIZE_TOKEN:
      return `Authorize token for ${failure.organization}`;
    case FAILURE_REASON.CONNECT_AGENTS:
      return connectLabel(failure.provider);
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
    failure.reason === FAILURE_REASON.ADD_REPOSITORY ||
    failure.reason === FAILURE_REASON.GITHUB_TOKEN ||
    failure.reason === FAILURE_REASON.AUTHORIZE_TOKEN ||
    failure.reason === FAILURE_REASON.CONNECT_AGENTS
  );
}
