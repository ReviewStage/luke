import type { IntegrationToolsView } from "./integration-view.js";
import {
  INTEGRATION_NAME,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationProvider,
  type IntegrationToolAnnotations,
  type IntegrationToolParameter,
  type IntegrationToolsProblemReason,
} from "./integration-wire.js";

/**
 * integration-health.ts -- whether a connected integration works, read from what its server answered when asked for its tools.
 *
 * A connection the service stands connected is a grant Vercel Connect holds,
 * which says nothing of whether the provider's MCP server takes it: Slack's
 * refuses a token from an app whose MCP access is off, and the grant still
 * stands. So a surface says a provider is connected only once its server
 * answered with its tools, and draws its count; one whose server answered
 * why it would not is a problem, said in a sentence of ours, with the
 * server's message, where it sent one, quoted on a second line that names
 * it (`saidWords`), never inside our sentence. A refusal, or the server's own error,
 * is mended by reconnecting (a token issued before a provider-side setting
 * changed keeps failing); a server that never answered is an outage a
 * reconnect would not mend, so it keeps its switch and offers nothing. A read
 * not answered yet is still being checked; one Luke's own service could not
 * answer says nothing of the server, so a surface says the tools could not be
 * read and offers to read them again, never that the connection works.
 */

/**
 * One tool as a list draws it: the title a person reads where its server
 * gave one, the hints its server annotated it with where it sent any, and the
 * arguments it takes where its server's input schema was readable.
 */
export interface IntegrationTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly annotations?: IntegrationToolAnnotations;
  readonly parameters?: readonly IntegrationToolParameter[];
}

/** How far a connected provider's server is known to work. */
export const CONNECTION_HEALTH = {
  /** Its server answered with its tools. */
  WORKING: "working",
  /** Its server answered no tools: why, and whether reconnecting mends it. */
  BROKEN: "broken",
  /** Its tools have not been read yet. */
  CHECKING: "checking",
  /** Luke's own service could not ask the server, so nothing is known of it: a read that failed, which asking again may mend. */
  FAILED: "failed",
} as const;

export type ConnectionHealth =
  | { readonly kind: typeof CONNECTION_HEALTH.WORKING; readonly tools: readonly IntegrationTool[] }
  | {
      readonly kind: typeof CONNECTION_HEALTH.BROKEN;
      readonly problem: string;
      /** The server's own message, quoted and naming the server, for a line under the problem's; none where it sent none. */
      readonly said?: string;
      /** Whether reconnecting mends it: a refusal or the server's own error, never an outage. */
      readonly reconnect: boolean;
    }
  | { readonly kind: typeof CONNECTION_HEALTH.CHECKING | typeof CONNECTION_HEALTH.FAILED };

/** How a connected server's count of tools reads. */
export function toolsCount(count: number): string {
  return count === 1 ? "1 tool" : `${count} tools`;
}

/**
 * Someone else's words as a line of their own under a sentence of ours:
 * who said them, then the words quoted as they came. Note that the words
 * are never folded into our sentence, because a provider's text has its own
 * grammar and case, and quoted it reads as theirs rather than as Luke's.
 */
export function saidWords(source: string, words: string): string {
  return `${source} said: “${words}”`;
}

/** The sentence that says why a provider's server listed no tools, and its own message quoted where it sent one. */
function problemLines(
  provider: IntegrationProvider,
  problem: { readonly reason: IntegrationToolsProblemReason; readonly message?: string },
): { readonly problem: string; readonly said?: string } {
  const name = INTEGRATION_NAME[provider];
  if (problem.reason === INTEGRATION_TOOLS_PROBLEM.REFUSED) {
    return { problem: `${name} refused the sign-in.` };
  }
  const sentence = `Could not reach ${name}.`;
  return problem.message === undefined
    ? { problem: sentence }
    : { problem: sentence, said: saidWords(name, problem.message) };
}

/** Whether one connected provider's server works, from its tools read; nothing is a read not answered yet. */
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
