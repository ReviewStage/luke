import type { DatabaseServices } from "@repo/database/core/query";
import { accountExperimentOn } from "@repo/database/models/account-store";
import type { Agent } from "@repo/database/models/agent-store";
import { MEMORY_BOUNDS, type MemorySummary, memoryIdSchema } from "@repo/features/memory-wire";
import { EXPERIMENT } from "@repo/settings";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  saveWorkspaceMemory,
  searchWorkspaceMemories,
  WORKSPACE_MEMORY,
  WORKSPACE_MEMORY_SAVE,
} from "../accounts/workspace-memories.js";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, type WireRecord } from "../core.js";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { type AgentCall, callerAgent, callerUserId, callerWorkspace } from "./agent-tools.js";
import { rememberRefusal } from "./memory-provenance.js";

/**
 * memory-tools.ts -- a coding agent's `save_memory` and `search_memory`: the workspace's shared memory of settled facts, kept and searched as the agent works.
 *
 * The agent decides what is worth keeping and when to look, and nothing asks
 * first; Settings › Memory is where members read and forget what was kept.
 * Both tools act in the workspace the agent reaches agents and tasks in, and
 * keep a memory as the words of the member who started it, both read from
 * the service's own record of the agent (`runAgentRemember`,
 * `runAgentRecall`); the model names neither, so no input carries a
 * workspace or an account. Every member's agents in the workspace share the
 * one, and no agent of another workspace reads it. Only a root coding
 * agent is offered them, never a worker handed one job, since what the
 * workspace keeps is the judgment of an agent that heard its developer. A
 * memory is prior context, not a rule: the developer's words now win, and a
 * memory they contradict is corrected in place through `replaces`. A keep
 * and a search are the ones every surface makes
 * (`../accounts/workspace-memories.ts`), so words that look like a
 * credential are refused before the store is reached, and no key, token, or
 * password is ever kept; and a turn an automation opened
 * or one that read the web keeps nothing (`memory-provenance.ts`), since
 * neither's words are a member's. Every outcome, a store that
 * cannot be reached included, is a result the model reads, so a memory that
 * fails never fails the turn.
 */

/** What a memory call acts in: the agent's workspace, and the member whose words it keeps. */
export interface MemoryCall {
  readonly workspaceId: string;
  readonly userId: string;
}

const REMEMBER_INPUT = Schema.Struct({
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(MEMORY_BOUNDS.MAX_CHARS)),
    "The fact or convention, as one self-contained statement a later task can read without " +
      'this call, such as "The web server\'s tests run on PGlite through `test:store`."',
  ),
  replaces: Schema.optionalKey(
    describeWire(
      memoryIdSchema,
      `The id of the memory this one corrects, as ${AGENT_TOOL.SEARCH_MEMORY} answered it; leave it out for a new memory.`,
    ),
  ),
});

const RECALL_INPUT = Schema.Struct({
  query: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isMaxLength(MEMORY_BOUNDS.MAX_QUERY_CHARS)),
      "A few words naming what to look for, such as the area, tool, or convention at hand; " +
        "leave it out for the memories kept most recently.",
    ),
  ),
});

const readRemember = Schema.decodeUnknownResult(REMEMBER_INPUT);
const readRecall = Schema.decodeUnknownResult(RECALL_INPUT);

/** Why a memory call did nothing, in words the model can act on. */
export const MEMORY_REFUSAL = {
  UNREADABLE_REMEMBER: `Not remembered: give the memory as text of at most ${MEMORY_BOUNDS.MAX_CHARS} characters.`,
  UNREADABLE_RECALL: `Not recalled: give the query as text of at most ${MEMORY_BOUNDS.MAX_QUERY_CHARS} characters.`,
  CREDENTIAL:
    "Not remembered: it looks like it holds a credential. Never keep a key, token, or " +
    "password; keep the fact without it.",
  NOT_FOUND:
    "Not remembered: the memory it replaces no longer exists, as a member may have " +
    "forgotten it. Remember it without replaces if it still matters.",
  FULL:
    `Not remembered: the workspace already holds ${MEMORY_BOUNDS.MAX_MEMORIES} memories. ` +
    "Correct an existing memory with replaces instead.",
  UNAVAILABLE: "Memory is unavailable right now; carry on without it.",
  OFF: "Memory is off for this agent's developer; carry on without it.",
} as const;

/** The tools as a coding agent is offered them: each its name, its words, and its input schema. */
export const SAVE_MEMORY_TOOL = {
  name: AGENT_TOOL.SAVE_MEMORY,
  description:
    "Keep a fact or convention for the workspace's later work, in any repository. Every member " +
    "of the workspace shares what you keep: a decision the team settled, how the team builds, " +
    "tests, or ships, a constraint someone stated, or a fact you confirmed in the code that a " +
    "later agent would otherwise have to rediscover. Keep only what was settled, will still " +
    "hold next time, and helps the team, never a guess, an idea still being weighed, this task's own " +
    "detail, a remark about one member, or anything that would be a credential, " +
    `key, token, or password. When what was said contradicts a memory ${AGENT_TOOL.SEARCH_MEMORY} answered, pass ` +
    "that memory's id as replaces with the corrected statement, so the old one is rewritten " +
    "rather than kept beside it. Do it quietly: never ask the developer whether to keep something and " +
    "never mention a memory you kept unless they ask. Answers `accepted` with the outcome " +
    "(kept, already_kept, corrected) and the memory, or `rejected` with the reason.",
  inputSchema: REMEMBER_INPUT,
} as const;

export const SEARCH_MEMORY_TOOL = {
  name: AGENT_TOOL.SEARCH_MEMORY,
  description:
    "Search what the workspace's agents kept: the settled facts and conventions every " +
    "member shares. Call it once the task comes into focus, with a few words for the " +
    "area at hand, and again when a new area comes up; with no query it answers the memories " +
    "kept most recently. Treat what it answers as prior context, not as rules: the developer's " +
    "words now win, and a memory they contradict is corrected with " +
    `${AGENT_TOOL.SAVE_MEMORY}'s replaces. Answers \`accepted\` with the matching memories, each with its id and ` +
    "when it was last kept, and how many memories the workspace holds.",
  inputSchema: RECALL_INPUT,
} as const;

/**
 * Whether the member turned Memory on (`EXPERIMENT.MEMORY`): what decides
 * whether their agents are offered `save_memory` and `search_memory` and told of the
 * memory. Where it cannot be read, it is off, logged for the operator.
 */
export function memoryOnFor(userId: string): Effect.Effect<boolean, never, DatabaseServices> {
  return accountExperimentOn(userId, EXPERIMENT.MEMORY).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => false),
  );
}

function rejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** A memory as the model reads it. */
function memoryRecord(memory: MemorySummary): WireRecord {
  return {
    id: memory.id,
    text: memory.text,
    updatedAt: new Date(memory.updatedAt).toISOString(),
  };
}

/** A store that could not be reached is the one refusal, logged for the operator and said to the model, so the turn carries on. */
const orUnavailable = <R>(
  effect: Effect.Effect<WireRecord, StoreFailure, R>,
): Effect.Effect<WireRecord, never, R> =>
  Effect.catch(effect, (failure) =>
    Effect.as(logStoreFailure(failure), rejected(MEMORY_REFUSAL.UNAVAILABLE)),
  );

/** Each refusal of a keep in the model's words; an account no member of the workspace is none a caller that read its workspace meets, so the store is said to be down. */
const SAVE_REFUSAL_WORDS = {
  [WORKSPACE_MEMORY_SAVE.NOT_MEMBER]: MEMORY_REFUSAL.UNAVAILABLE,
  [WORKSPACE_MEMORY_SAVE.CREDENTIAL]: MEMORY_REFUSAL.CREDENTIAL,
  [WORKSPACE_MEMORY_SAVE.NOT_FOUND]: MEMORY_REFUSAL.NOT_FOUND,
  [WORKSPACE_MEMORY_SAVE.FULL]: MEMORY_REFUSAL.FULL,
} as const;

/** One call of `save_memory` in the call's workspace, as the member's words, kept by the one keep every surface makes (`saveWorkspaceMemory`): the memory kept or corrected, or why nothing was. */
export function runRemember(
  call: MemoryCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readRemember(input);
  if (Result.isFailure(asked)) return Effect.succeed(rejected(MEMORY_REFUSAL.UNREADABLE_REMEMBER));
  const { text, replaces } = asked.success;
  return orUnavailable(
    Effect.map(
      saveWorkspaceMemory(call.userId, call.workspaceId, text, replaces),
      (answer): WireRecord =>
        answer.kind === WORKSPACE_MEMORY_SAVE.SAVED
          ? {
              status: ACTION_RESULT_STATUS.ACCEPTED,
              outcome: answer.outcome,
              memory: memoryRecord(answer.memory),
            }
          : rejected(SAVE_REFUSAL_WORDS[answer.kind]),
    ),
  );
}

/** One call of `search_memory` in the call's workspace, by the one search every surface makes (`searchWorkspaceMemories`): its memories the query finds, and how many it holds. */
export function runRecall(
  call: MemoryCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const asked = readRecall(input);
  if (Result.isFailure(asked)) return Effect.succeed(rejected(MEMORY_REFUSAL.UNREADABLE_RECALL));
  return orUnavailable(
    Effect.map(
      searchWorkspaceMemories(call.userId, call.workspaceId, asked.success.query),
      (answer): WireRecord =>
        answer.kind === WORKSPACE_MEMORY.NOT_MEMBER
          ? rejected(MEMORY_REFUSAL.UNAVAILABLE)
          : {
              status: ACTION_RESULT_STATUS.ACCEPTED,
              memories: answer.memories.map(memoryRecord),
              total: answer.total,
            },
    ),
  );
}

/**
 * A coding agent's memory call: the workspace the agent reaches tasks in and
 * its starter, read from the service's record of the agent as every agent
 * tool reads them (`callerWorkspace`), then the call itself. An agent whose
 * workspace cannot be read for its starter now keeps and recalls nothing, and
 * neither does one whose starter has Memory off (`EXPERIMENT.MEMORY`): eve
 * and our MCP server (`tool-catalog/catalog.ts`) list neither tool to such an
 * agent, but a harness may still call a tool it was not listed, or Memory
 * may go off mid-run, so the refusal stands here as well.
 */
function agentMemory(
  call: AgentCall,
  run: (memory: MemoryCall) => Effect.Effect<WireRecord, never, DatabaseServices>,
  refusal?: (agent: Agent) => Effect.Effect<string | undefined, StoreFailure, DatabaseServices>,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return orUnavailable(
    Effect.gen(function* () {
      const userId = callerUserId(call.caller);
      if (!(yield* memoryOnFor(userId))) return rejected(MEMORY_REFUSAL.OFF);
      // A refusal reads the calling agent's turn; a member's call is their own words, and has none.
      const agent = callerAgent(call.caller);
      const refused =
        refusal === undefined || agent === undefined ? undefined : yield* refusal(agent);
      if (refused !== undefined) return rejected(refused);
      const workspace = yield* callerWorkspace(call.caller);
      if (Option.isNone(workspace)) return rejected(MEMORY_REFUSAL.UNAVAILABLE);
      return yield* run({ workspaceId: workspace.value, userId });
    }),
  );
}

/** One call of `save_memory` from a coding agent, refused on a turn whose words are no member's (`rememberRefusal`). */
export function runAgentRemember(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return agentMemory(call, (memory) => runRemember(memory, input), rememberRefusal);
}

/** One call of `search_memory` from a coding agent. */
export function runAgentRecall(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return agentMemory(call, (memory) => runRecall(memory, input));
}
