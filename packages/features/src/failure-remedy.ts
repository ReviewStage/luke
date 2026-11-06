import { harnessNameOf } from "./agent-runtime-models.js";
import type { ModelProvider } from "./models-wire.js";
import { PRODUCT_NAME } from "./product-name.js";

export const FAILURE_REASON = {
  API_KEY: "api-key",
  CONNECT_GITHUB: "connect-github",
  RECONNECT_GITHUB: "reconnect-github",
  ADD_REPOSITORY: "add-repository",
  CHOOSE_REPOSITORY: "choose-repository",
  MOVE_TASK: "move-description",
  GITHUB_TOKEN: "github-token",
  AUTHORIZE_TOKEN: "authorize-token",
  CONNECT_AGENTS: "connect-agents",
  OTHER: "other",
} as const;

export type FailureReason = (typeof FAILURE_REASON)[keyof typeof FAILURE_REASON];

type TaskRemedyReason =
  | typeof FAILURE_REASON.CONNECT_GITHUB
  | typeof FAILURE_REASON.RECONNECT_GITHUB
  | typeof FAILURE_REASON.CHOOSE_REPOSITORY;

export type Failure =
  | { readonly reason: TaskRemedyReason; readonly text: string; readonly taskId: string }
  | {
      readonly reason: typeof FAILURE_REASON.ADD_REPOSITORY;
      readonly text: string;
      readonly repository: string;
      readonly settingsUrl: string;
    }
  | {
      readonly reason: typeof FAILURE_REASON.MOVE_TASK;
      readonly text: string;
      readonly taskId: string;
      readonly workspace: { readonly id: string; readonly name: string };
    }
  | {
      readonly reason: typeof FAILURE_REASON.AUTHORIZE_TOKEN;
      readonly text: string;
      readonly organization: string;
      readonly authorizeUrl: string;
    }
  | {
      readonly reason: typeof FAILURE_REASON.API_KEY | typeof FAILURE_REASON.CONNECT_AGENTS;
      readonly text: string;
      readonly provider?: ModelProvider | undefined;
    }
  | {
      readonly reason: typeof FAILURE_REASON.GITHUB_TOKEN | typeof FAILURE_REASON.OTHER;
      readonly text: string;
    };

function connectLabel(provider: ModelProvider | undefined): string {
  return provider === undefined ? "Open Settings" : `Connect ${harnessNameOf(provider)}`;
}

export function remedyLabel(failure: Failure): string | undefined {
  switch (failure.reason) {
    case FAILURE_REASON.API_KEY:
      return connectLabel(failure.provider);
    case FAILURE_REASON.CONNECT_GITHUB:
      return "Connect GitHub";
    case FAILURE_REASON.RECONNECT_GITHUB:
      return "Reconnect GitHub";
    case FAILURE_REASON.ADD_REPOSITORY:
      return `Add ${failure.repository} to ${PRODUCT_NAME}'s GitHub App`;
    case FAILURE_REASON.CHOOSE_REPOSITORY:
      return "Choose a repository";
    case FAILURE_REASON.MOVE_TASK:
      return `Move task to ${failure.workspace.name}`;
    case FAILURE_REASON.GITHUB_TOKEN:
      return "Update GitHub token";
    case FAILURE_REASON.AUTHORIZE_TOKEN:
      return `Authorize token for ${failure.organization}`;
    case FAILURE_REASON.CONNECT_AGENTS:
      return connectLabel(failure.provider);
    case FAILURE_REASON.OTHER:
      return undefined;
  }
}

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
