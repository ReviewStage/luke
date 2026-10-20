import {
  type CodingAgentActKind,
  type CodingAgentActsDependencies,
  codingAgentActRows,
} from "./coding-agent-acts.js";

import type { ActRows } from "./router.js";

/** Every kind the host's own rows answer, on any platform that runs the host. */
export type HostActKind = CodingAgentActKind;

/** What the host's rows are handed, by the group of rows that uses it. */
export interface HostActDependencies {
  readonly codingAgents: CodingAgentActsDependencies;
}

/** The host's own rows, the same on every platform that runs the host. */
export function hostActRows<Sender>(
  dependencies: HostActDependencies,
): Pick<ActRows<Sender>, HostActKind> {
  return codingAgentActRows(dependencies.codingAgents);
}
