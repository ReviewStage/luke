import type { IntegrationToolsView } from "./integration-view.js";
import {
  INTEGRATION_NAME,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationProvider,
  type IntegrationToolAnnotations,
  type IntegrationToolParameter,
  type IntegrationToolsProblemReason,
} from "./integration-wire.js";

export interface IntegrationTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly annotations?: IntegrationToolAnnotations;
  readonly parameters?: readonly IntegrationToolParameter[];
}

export const CONNECTION_HEALTH = {
  WORKING: "working",
  BROKEN: "broken",
  CHECKING: "checking",
  FAILED: "failed",
} as const;

export type ConnectionHealth =
  | { readonly kind: typeof CONNECTION_HEALTH.WORKING; readonly tools: readonly IntegrationTool[] }
  | {
      readonly kind: typeof CONNECTION_HEALTH.BROKEN;
      readonly problem: string;
      readonly said?: string;
      readonly reconnect: boolean;
    }
  | { readonly kind: typeof CONNECTION_HEALTH.CHECKING | typeof CONNECTION_HEALTH.FAILED };

export function toolsCount(count: number): string {
  return count === 1 ? "1 tool" : `${count} tools`;
}

export function saidWords(source: string, words: string): string {
  return `${source} said: “${words}”`;
}

function problemLines(
  provider: IntegrationProvider,
  problem: { readonly reason: IntegrationToolsProblemReason; readonly message?: string },
): { readonly problem: string; readonly said?: string } {
  const name = INTEGRATION_NAME[provider];
  if (problem.reason === INTEGRATION_TOOLS_PROBLEM.REFUSED) {
    return { problem: `${name} refused the sign-in.` };
  }
  const sentence = `${name} could not be reached.`;
  return problem.message === undefined
    ? { problem: sentence }
    : { problem: sentence, said: saidWords(name, problem.message) };
}

export function connectionHealth(
  provider: IntegrationProvider,
  read: IntegrationToolsView | undefined,
): ConnectionHealth {
  if (read === undefined) return { kind: CONNECTION_HEALTH.CHECKING };
  if ("failure" in read) return { kind: CONNECTION_HEALTH.FAILED };
  if ("problem" in read) {
    const reason = read.problem.reason;
    return {
      kind: CONNECTION_HEALTH.BROKEN,
      ...problemLines(provider, read.problem),
      reconnect:
        reason === INTEGRATION_TOOLS_PROBLEM.REFUSED ||
        reason === INTEGRATION_TOOLS_PROBLEM.REJECTED,
    };
  }
  return { kind: CONNECTION_HEALTH.WORKING, tools: read.tools };
}
