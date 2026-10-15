import {
  CODING_AGENT_TODOS_TOOL,
  codingAgentTodosInputSchema,
} from "@luke/features/coding-agent-wire";

/**
 * todos.ts -- the coding agent's to-do list: one tool that writes it whole.
 *
 * The list is the call's own input, so the transcript is where it is kept:
 * each call lands as a tool part in the agent's turn and a tab draws the
 * newest one open (`coding-agent-wire.ts`'s `CODING_AGENT_TODOS_TOOL`).
 * Nothing is stored beside it and nothing is read back, since the model
 * holds its last list in its own context. A worker writes none, because the
 * developer reads the agent's list and a worker's slice is one item of it.
 */

/** The tool as the model is shown it (`apps/dev/tools/write_todos.ts`): its name, its words, and the list it takes. */
export const TODOS_TOOL = {
  name: CODING_AGENT_TODOS_TOOL,
  description:
    "Write your to-do list for the work in hand, which the developer sees in your transcript. " +
    "Pass the whole list on every call, in order, each item pending, in_progress, or done; " +
    "the call replaces the list you wrote before.",
  inputSchema: codingAgentTodosInputSchema,
} as const;

/** What a call answers: the list is taken, and there is nothing more to read. */
export const TODOS_SAVED = "The to-dos are updated.";
