import {
  CODING_AGENT_TODO_STATUS,
  type CodingAgentTodos,
  codingAgentDelegationOutputSchema,
} from "@sidecar/hosted/coding-agent-wire";
import type { LanguageModel } from "ai";
import { Option, Schema } from "effect";
import {
  type MockModelRequest,
  type MockModelResponse,
  type MockModelToolResult,
  mockModel,
} from "eve/evals";
import { CODER_MODEL_FIXTURE } from "../server/hosted/coder-host/bounds.js";
import { CODER_TOOL } from "../server/hosted/coder-host/tool-set.js";

/**
 * The fixture model the end-to-end eval runs the coding agent under: a
 * scripted stand-in for the providers, so the eval exercises eve's loop and
 * the relay into the store without a key, a network, or a sandbox. Handed a
 * plan, it answers in words that it read the plan and has nothing to
 * publish, and calls no tool, so no sandbox opens and no repository is
 * checked out. Told to delegate the rest, it hands it to a worker on the
 * pair below and repeats the worker's answer; the worker, running on the
 * same model, reads the task back under eve's wrapper as the agent reads
 * the plan's title back. Handed a list of to-dos, it writes them, the first
 * in progress, and says so. Told to read the plan, it reads it whole and
 * says the plan's first line. It is
 * selected only by the fixture's own environment variable and a deployment
 * never names it.
 */

/** What the scripted agent answers a plan with: the plan's first line, read back, and no pull request. */
export const SCRIPTED_CODER_REPLY = "I read the plan and have nothing to publish:";
/** What a developer's words start with when they ask the scripted agent to hand the rest to a worker. */
export const SCRIPTED_DELEGATE = "Delegate: ";
/** The reply once the worker has answered: the worker's own words follow. */
export const SCRIPTED_DELEGATED_REPLY = "The worker says:";
/** What a developer's words start with when they hand the scripted agent to-dos, each ended by a semicolon but the last. */
export const SCRIPTED_TODOS = "To-dos: ";
/** The reply once the to-dos are written. */
export const SCRIPTED_TODOS_REPLY = "The to-dos are written.";
/** What a developer's words start with when they ask the scripted agent to read its plan whole. */
export const SCRIPTED_READ_PLAN = "Read the plan: ";
/** The reply once the plan is read: the plan's first line follows. */
export const SCRIPTED_READ_PLAN_REPLY = "The plan opens:";
/** The pair the scripted agent names for every worker, which the fixture records as asked. */
export const SCRIPTED_WORKER_CHOICE = { model: "openai/gpt-6.1-sol", effort: "low" } as const;

const readDelegationOutput = Schema.decodeUnknownOption(codingAgentDelegationOutputSchema);

/** What the fixture reads of a plan read's answer: the plan, where the read was taken. */
const readPlanOutput = Schema.decodeUnknownOption(Schema.Struct({ plan: Schema.String }));

/** The line eve puts ahead of the agent's own words when it hands a worker its task. */
const CALLER_MESSAGE_MARK = "Caller message:\n";

/** What the fixture reads back: the agent's task under eve's wrapper for a worker, else the message's first line, which is the plan's title. */
function readBack(message: string): string {
  const mark = message.lastIndexOf(CALLER_MESSAGE_MARK);
  if (mark !== -1) return message.slice(mark + CALLER_MESSAGE_MARK.length).trim();
  return message.split("\n")[0]?.trim() ?? "";
}

/** The reply to a worker's answer: its result, or that it answered nothing readable. */
function delegatedReply(delegated: MockModelToolResult): MockModelResponse {
  return Option.match(readDelegationOutput(delegated.output), {
    onNone: () => ({ text: SCRIPTED_DELEGATED_REPLY }),
    onSome: (output) => ({ text: `${SCRIPTED_DELEGATED_REPLY} ${output.result}` }),
  });
}

/** The list the scripted agent writes for the words after `SCRIPTED_TODOS`: one item for each, the first in progress. */
function scriptedTodos(words: string): CodingAgentTodos {
  return {
    todos: words.split(";").map((content, index) => ({
      content: content.trim(),
      status: index === 0 ? CODING_AGENT_TODO_STATUS.IN_PROGRESS : CODING_AGENT_TODO_STATUS.PENDING,
    })),
  };
}

/** The reply to a plan read: the plan's first line, or that nothing was read. */
function planReadReply(read: MockModelToolResult): MockModelResponse {
  return Option.match(readPlanOutput(read.output), {
    onNone: () => ({ text: SCRIPTED_READ_PLAN_REPLY }),
    onSome: (output) => ({ text: `${SCRIPTED_READ_PLAN_REPLY} ${readBack(output.plan)}` }),
  });
}

function scriptedResponse(request: MockModelRequest): MockModelResponse {
  const read = request.toolResults.find((result) => result.name === CODER_TOOL.READ_PLAN);
  if (read) return planReadReply(read);
  if (request.lastUserMessage?.startsWith(SCRIPTED_READ_PLAN)) {
    return { toolCalls: [{ name: CODER_TOOL.READ_PLAN, input: {} }] };
  }
  if (request.toolResults.some((result) => result.name === CODER_TOOL.WRITE_TODOS)) {
    return { text: SCRIPTED_TODOS_REPLY };
  }
  if (request.lastUserMessage?.startsWith(SCRIPTED_TODOS)) {
    const input = scriptedTodos(request.lastUserMessage.slice(SCRIPTED_TODOS.length));
    return { toolCalls: [{ name: CODER_TOOL.WRITE_TODOS, input }] };
  }
  const delegated = request.toolResults.find((result) => result.name === CODER_TOOL.DELEGATE);
  if (delegated) return delegatedReply(delegated);
  const offered = request.tools.some((tool) => tool.name === CODER_TOOL.DELEGATE);
  if (offered && request.lastUserMessage?.startsWith(SCRIPTED_DELEGATE)) {
    const task = request.lastUserMessage.slice(SCRIPTED_DELEGATE.length);
    return {
      toolCalls: [{ name: CODER_TOOL.DELEGATE, input: { task, ...SCRIPTED_WORKER_CHOICE } }],
    };
  }
  return { text: `${SCRIPTED_CODER_REPLY} ${readBack(request.lastUserMessage ?? "")}` };
}

export function scriptedModel(): LanguageModel {
  return mockModel({
    modelId: CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID,
    provider: "luke-fixtures",
    respond: scriptedResponse,
  });
}
