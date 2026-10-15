import {
  CODING_AGENT_TODO_STATUS,
  type CodingAgentTodos,
  codingAgentDelegationOutputSchema,
} from "@luke/features/coding-agent-wire";
import type { LanguageModel } from "ai";
import { Option, Schema } from "effect";
import {
  type MockModelRequest,
  type MockModelResponse,
  type MockModelToolResult,
  mockModel,
} from "eve/evals";
import type { AgentSkill } from "../agents/agent-runtime/skills.js";
import { CODER_MODEL_FIXTURE } from "../agents/coder-host/bounds.js";
import { CODER_TOOL } from "../agents/coder-host/tool-set.js";

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
 * in progress, and says so. Offered the fixture's skill and told its
 * `/name`, it loads it and repeats the body's last line. It is
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
/** The pair the scripted agent names for every worker, which the fixture records as asked. */
export const SCRIPTED_WORKER_CHOICE = { model: "openai/gpt-6.1-sol", effort: "low" } as const;

/** What the scripted agent says once it has loaded a skill: the skill's last line follows. */
export const SCRIPTED_SKILL_REPLY = "The skill says:";
/** The skills a session under the fixture is offered in place of its repository's, so the eval reaches no GitHub. */
export const SCRIPTED_SKILLS = [
  {
    name: "release-notes",
    description: "Use when the developer asks for release notes.",
    markdown: "# Release notes\n\nWrite one line per change, newest first.",
  },
] as const satisfies readonly AgentSkill[];

/** A skill a developer names in their words, as `/name` at the start of a word. */
const NAMED_SKILL = /(?:^|\s)\/([a-z0-9-]+)/u;

const readDelegationOutput = Schema.decodeUnknownOption(
  Schema.fromJsonString(codingAgentDelegationOutputSchema),
);
/** What `load_skill` answers: the skill's body. */
const readSkillBody = Schema.decodeUnknownOption(Schema.String);

/** eve's own tool that parks a turn until a task it started answers: eve's subagent task, not a Luke task. */
const TASK_WAIT = "task_wait";

/** The line eve puts ahead of the agent's own words when it hands a worker its task. */
const CALLER_MESSAGE_MARK = "Caller message:\n";

/** What the fixture reads back: the agent's task under eve's wrapper for a worker, else the message's first line, which is the plan's title. */
function readBack(message: string): string {
  const mark = message.lastIndexOf(CALLER_MESSAGE_MARK);
  if (mark !== -1) return message.slice(mark + CALLER_MESSAGE_MARK.length).trim();
  return message.split("\n")[0]?.trim() ?? "";
}

/** A delegation's task result as eve hands it to the model: its body, the output of the call that started it. */
const DELEGATED_RESULT = new RegExp(
  `<task_result id="[^"]*" tool="${CODER_TOOL.DELEGATE}" status="completed">([\\s\\S]*?)</task_result>`,
  "u",
);

/** The newest delegation's task result the prompt holds, its body as eve wrote it; nothing before one arrived. */
function delegatedAnswer(request: MockModelRequest): string | undefined {
  for (const message of [...request.messages].reverse()) {
    const body = DELEGATED_RESULT.exec(message.text)?.[1];
    if (body !== undefined) return body;
  }
  return undefined;
}

/** The reply to a worker's answer: its result, or that it answered nothing readable. */
function delegatedReply(body: string): MockModelResponse {
  return Option.match(readDelegationOutput(body), {
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

/** The name of a skill the developer's words name and eve's announcement lists as one the session is offered; nothing otherwise. */
function offeredSkillNamed(request: MockModelRequest): string | undefined {
  const named = NAMED_SKILL.exec(request.lastUserMessage ?? "")?.[1];
  if (named === undefined) return undefined;
  // Note that eve announces a session's dynamic skills in a message of their own, not in its instructions.
  const listed = request.messages.some((message) => message.text.includes(`- ${named}: `));
  return listed ? named : undefined;
}

/** The reply to a loaded skill: the body's last line. */
function skillReply(loaded: MockModelToolResult): MockModelResponse {
  const body = Option.getOrElse(readSkillBody(loaded.output), () => "");
  return { text: `${SCRIPTED_SKILL_REPLY} ${body.trim().split("\n").at(-1) ?? ""}` };
}

function scriptedResponse(request: MockModelRequest): MockModelResponse {
  const loaded = request.toolResults.find((result) => result.name === CODER_TOOL.LOAD_SKILL);
  if (loaded) return skillReply(loaded);
  const skill = offeredSkillNamed(request);
  if (skill !== undefined) {
    return { toolCalls: [{ name: CODER_TOOL.LOAD_SKILL, input: { skill } }] };
  }
  if (request.toolResults.some((result) => result.name === CODER_TOOL.WRITE_TODOS)) {
    return { text: SCRIPTED_TODOS_REPLY };
  }
  if (request.lastUserMessage?.startsWith(SCRIPTED_TODOS)) {
    const input = scriptedTodos(request.lastUserMessage.slice(SCRIPTED_TODOS.length));
    return { toolCalls: [{ name: CODER_TOOL.WRITE_TODOS, input }] };
  }
  // A delegation is waited for, as a foreground one is: its receipt, then the wait, then its answer.
  const answered = delegatedAnswer(request);
  if (answered !== undefined) return delegatedReply(answered);
  const delegated = request.toolResults.some((result) => result.name === CODER_TOOL.DELEGATE);
  const waited = request.toolResults.some((result) => result.name === TASK_WAIT);
  if (delegated && !waited) return { toolCalls: [{ name: TASK_WAIT, input: {} }] };
  if (delegated) return { text: SCRIPTED_DELEGATED_REPLY };
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
