import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  type CodingAgentFailure,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
} from "@sidecar/hosted/coding-agent-wire";
import { describeWire } from "@sidecar/wire/effect";
import { isTextUIPart } from "ai";
import { Clock, Effect, Option, Result, Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  isRecord,
  isSettledToolPartState,
  isStoredToolPart,
  isWireString,
  type StoredToolPart,
  type StoredUIMessage,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import type { EveSessions } from "./brain-host/eve-sessions.js";
import { agentPublished } from "./coder-host/published.js";
import { codingAgentFailureOf, codingAgentStatusOf } from "./coder-host/status.js";
import { steerCodingAgent } from "./coder-host/steer.js";
import { CODER_TOOL, CODER_TOOL_SET } from "./coder-host/tool-set.js";
import {
  awaitingLinesOf,
  type CodingAgent,
  latestTurnsOf,
  listCodingAgents,
  readCodingAgent,
} from "./coding-agent-store.js";
import type { HostedRefusal } from "./http-effect.js";
import type { PlanDocumentBinding } from "./plan-notes.js";
import type { StoreWriter } from "./store/index.js";
import { listJournals } from "./store/message-reads.js";
import { logStoreFailure, type StoreFailure } from "./store-failure.js";

/**
 * coding-agent-tools.ts -- the planning model's three tools about the plan's coding agents: list them, read one's recent progress, message one.
 *
 * A planning call may turn to the agents working the plan: the developer
 * asks how one is doing, or tells one what to do, and Luke answers or steers
 * the right agent. Each tool reads the same rows the agent tabs read: the
 * plan's agents and the newest turn each stands on (`coder-host/status.ts`),
 * the branch each row holds, and the transcript's turn journals, rendered
 * as a short tail of what the agent said and did so Luke can summarise it
 * aloud rather than read it out; a read of one agent also asks GitHub what
 * that branch published, as the agent's tab does
 * (`coder-host/published.ts`), and says nothing of it where GitHub could
 * not be asked. A message takes the one path the message
 * box's does (`coder-host/steer.ts`), under the key eve gave the tool call,
 * so a call eve runs again after a lost answer sends once; the words reach
 * the agent's session as the deployment acting for the account, which the
 * coder channel's table admits for exactly this (`coder-host/channel.ts`).
 * Every answer is data the model reads, never a credential: a call's input
 * is named and its output never, since a command's output is the
 * repository's own text and whatever the agent's shell printed.
 */

export const CODING_AGENT_TOOL_BOUNDS = {
  /** The newest turns a progress read walks, the one under way included. */
  TAIL_TURNS: 3,
  /** The most entries a progress read answers, the newest last. */
  TAIL_ENTRIES: 20,
  /** The most characters one entry of the tail carries. */
  ENTRY_CHARS: 300,
  /** The most characters an agent's latest activity carries in the list. */
  ACTIVITY_CHARS: 160,
} as const;

/** Why a call ran nothing, or sent nothing, in words the model can act on. */
export const CODING_AGENT_TOOL_REFUSAL = {
  UNREADABLE:
    "Not run: name the agent by the id list_coding_agents answered, and a message as text of at " +
    `most ${CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS} characters.`,
  NO_AGENT: "Not run: this plan has no coding agent with that id.",
  STORE: "Not run: the agents could not be read just now. The call may be made again.",
  NO_SERVICE: "Not sent: this deployment cannot reach the coding agents' service.",
  NOT_REACHABLE:
    "Not sent: the developer no longer reaches the agent's repository through the Luke GitHub App.",
  SIGN_IN_REQUIRED: "Not sent: the developer must sign in with GitHub again first.",
  NOT_READY:
    "Not sent: the agent's session is still coming up; the same message a moment later is taken.",
  RETIRED:
    "Not sent: the agent's session has ended for good, so nothing reaches it; only a new agent goes on from here.",
  UNAVAILABLE: "Not sent: the service could not take the message just now.",
} as const;

/** The refusal's sentence for each hosted refusal a steer may answer; any other is the service down. */
const REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, CODING_AGENT_TOOL_REFUSAL.NOT_REACHABLE],
  [HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED, CODING_AGENT_TOOL_REFUSAL.SIGN_IN_REQUIRED],
  [HOSTED_API_ERROR.AGENT_NOT_READY, CODING_AGENT_TOOL_REFUSAL.NOT_READY],
  [HOSTED_API_ERROR.AGENT_RETIRED, CODING_AGENT_TOOL_REFUSAL.RETIRED],
  [HOSTED_API_ERROR.NOT_FOUND, CODING_AGENT_TOOL_REFUSAL.NO_AGENT],
]);

/** What a planning call about the agents runs under: the plan, eve as the deployment acting for the account, the writer, and the key the one message is sent under. */
export interface CodingAgentCall {
  readonly plan: PlanDocumentBinding;
  /** eve's coding-agent service as the deployment acting for the account; nothing where the deployment names no secret or no origin for eve, which sends nothing. */
  readonly eve: EveSessions | undefined;
  readonly writer: Effect.Effect<StoreWriter>;
  /** The key the message is sent under: eve's own id for the tool call, so a call run again sends once. */
  readonly clientKey: string;
}

/** What a message reaches: the store, GitHub through the App on the developer's standing, and the network to eve. */
type CodingAgentToolServices = SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp;

const AGENT_ID = describeWire(wireUuidSchema, "The agent's id, as list_coding_agents answered it.");

const READ_CODING_AGENT_INPUT = Schema.Struct({ agentId: AGENT_ID });

const MESSAGE_CODING_AGENT_INPUT = Schema.Struct({
  agentId: AGENT_ID,
  text: describeWire(
    Schema.Trim.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS),
    ),
    "What to tell the agent, in the developer's words, as a message typed to it.",
  ),
});

const readAgentRef = Schema.decodeUnknownResult(READ_CODING_AGENT_INPUT);
const readMessage = Schema.decodeUnknownResult(MESSAGE_CODING_AGENT_INPUT);

/** The tools as a planning model is offered them: each its name, its words, and its input schema. */
export const LIST_CODING_AGENTS_TOOL = {
  name: "list_coding_agents",
  description:
    "List the coding agents working on this plan: each with its id, the model and effort it runs " +
    "on, its status (starting, running, completed, failed, cancelled), the branch its sandbox " +
    "is on if a turn has ended, and one line of what it last did. Call it when the developer " +
    "asks about or addresses an agent, to find which one they mean.",
  inputSchema: Schema.Struct({}),
} as const;

export const READ_CODING_AGENT_TOOL = {
  name: "read_coding_agent",
  description:
    "Read one coding agent's recent progress: its status, the branch it pushed and the pull " +
    "request from it as GitHub holds them, and a short tail " +
    "of what it last said and did, newest last. Summarise it for the developer in a sentence or " +
    "two; never read it out.",
  inputSchema: READ_CODING_AGENT_INPUT,
} as const;

export const MESSAGE_CODING_AGENT_TOOL = {
  name: "message_coding_agent",
  description:
    "Send one coding agent a message, exactly as the developer would type it to the agent. It " +
    "steers the turn under way, so the agent sees it at its next step, or starts a turn when " +
    "the agent is idle. Answers `accepted` once the agent's session has taken it, or " +
    "`rejected` and why nothing was sent.",
  inputSchema: MESSAGE_CODING_AGENT_INPUT,
} as const;

/** How a call of one coding tool is said: its verb, and the one input field that names its subject. */
interface CallWords {
  readonly verb: string;
  readonly key: string;
}

/** Each coding tool's words; a patch names its files in its own headers and stands apart. */
const CALL_WORDS: ReadonlyMap<string, CallWords> = new Map([
  [CODER_TOOL.BASH, { verb: "Ran", key: "command" }],
  [CODER_TOOL.READ_FILE, { verb: "Read", key: "filePath" }],
  [CODER_TOOL.WRITE_FILE, { verb: "Wrote", key: "filePath" }],
  [CODER_TOOL.GLOB, { verb: "Searched", key: "pattern" }],
  [CODER_TOOL.GREP, { verb: "Searched", key: "pattern" }],
  [CODER_TOOL.WEB_FETCH, { verb: "Fetched", key: "url" }],
  [CODER_TOOL.WEB_SEARCH, { verb: "Searched the web for", key: "query" }],
]);

/** A patch header naming a file, as `apply_patch` spells one. */
const PATCH_FILE_HEADER = /^\*\*\* (?:Add|Update|Delete|Move to) File: (.+)$/u;

const ENTRY_WORDS = {
  SAID: "Said",
  EDITED: "Edited",
  USED: "Used",
  RUNNING: "(running)",
} as const;

function cut(text: string, maximumChars: number): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > maximumChars ? `${line.slice(0, maximumChars - 1)}…` : line;
}

/** What a call was done to, read from its input alone. */
function subjectOf(name: string, input: UnparsedWireValue): string {
  if (name === CODER_TOOL.APPLY_PATCH) {
    const patch = isRecord(input) && isWireString(input.patchText) ? input.patchText : "";
    return patch
      .split("\n")
      .flatMap((line) => PATCH_FILE_HEADER.exec(line.trimEnd())?.[1] ?? [])
      .join(", ");
  }
  const words = CALL_WORDS.get(name);
  if (words === undefined || !isRecord(input)) return "";
  const subject = input[words.key];
  return isWireString(subject) ? subject : "";
}

/** One call as a line of the tail: its verb, its subject, and whether it still runs. */
function callEntry(part: StoredToolPart): string {
  const name = part.type.slice("tool-".length);
  const verb =
    name === CODER_TOOL.APPLY_PATCH
      ? ENTRY_WORDS.EDITED
      : (CALL_WORDS.get(name)?.verb ?? ENTRY_WORDS.USED);
  // SAFETY: a stored part's input is the JSON the row carried; the read names one field of it and trusts no other.
  const subject = subjectOf(name, part.input as UnparsedWireValue) || name;
  const running = isSettledToolPartState(part.state) ? "" : ` ${ENTRY_WORDS.RUNNING}`;
  return `${verb}: ${subject}${running}`;
}

/** A journal's entries in order: each of the agent's own texts, and each call with its subject. */
function entriesOf(journal: StoredUIMessage, maximumChars: number): string[] {
  return journal.parts.flatMap((part) => {
    if (isTextUIPart(part) && part.text.trim().length > 0) {
      return [cut(`${ENTRY_WORDS.SAID}: ${part.text}`, maximumChars)];
    }
    if (isStoredToolPart(part)) return [cut(callEntry(part), maximumChars)];
    return [];
  });
}

/** One agent as the model reads it: what it runs on, where it stands, the branch its row holds, and what it last did. */
interface AgentReading {
  readonly id: string;
  readonly model: string;
  readonly effort: string;
  readonly status: CodingAgentStatus;
  readonly failureReason?: CodingAgentFailure;
  readonly repository: string;
  readonly branch: string | null;
  readonly activity: string | null;
}

/** The newest journals of an agent's conversation, oldest first; none where the page does not read. */
const journalsOf = (userId: string, agent: CodingAgent, limit: number) =>
  Effect.map(listJournals(userId, agent.conversationId, CODER_TOOL_SET, limit), (read) =>
    read.ok ? read.value.map((record) => record.message) : [],
  );

/** The agents' standings, read once for the lot: each one's newest turn, and whether a line of the developer's awaits one. */
const standingsOf = (userId: string, agents: readonly CodingAgent[]) =>
  Effect.gen(function* () {
    const ids = agents.map((agent) => agent.conversationId);
    const turns = yield* latestTurnsOf(userId, ids);
    const awaiting = yield* awaitingLinesOf(userId, ids);
    const now = yield* Clock.currentTimeMillis;
    return (agent: CodingAgent) => {
      const turn = turns.get(agent.conversationId);
      const status = codingAgentStatusOf(turn, {
        createdAt: agent.createdAt,
        now,
        lineAwaits: awaiting.has(agent.conversationId),
      });
      // Why the newest turn failed is said only while the agent reads as failed: a line awaiting the next turn makes it running again.
      return {
        status,
        failureReason:
          status === CODING_AGENT_STATUS.FAILED ? codingAgentFailureOf(turn) : undefined,
      };
    };
  });

const readAgent = (
  userId: string,
  agent: CodingAgent,
  standing: {
    readonly status: CodingAgentStatus;
    readonly failureReason: CodingAgentFailure | undefined;
  },
): Effect.Effect<AgentReading, StoreFailure, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const [newest] = yield* journalsOf(userId, agent, 1);
    const activity =
      newest === undefined
        ? undefined
        : entriesOf(newest, CODING_AGENT_TOOL_BOUNDS.ACTIVITY_CHARS).at(-1);
    return {
      id: agent.id,
      model: agent.model,
      effort: agent.effort,
      status: standing.status,
      ...(standing.failureReason === undefined
        ? undefined
        : { failureReason: standing.failureReason }),
      repository: agent.repository,
      branch: agent.branch,
      activity: activity ?? null,
    };
  });

/** What the agent published as GitHub holds it, or nothing where GitHub could not be asked, which is said as no publication rather than none. */
const publishedOf = (
  userId: string,
  agent: CodingAgent,
): Effect.Effect<
  CodingAgentPullRequestAnswer | undefined,
  never,
  SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp
> =>
  Effect.map(Effect.result(agentPublished(userId, agent)), (read) =>
    Result.isSuccess(read) ? read.success : undefined,
  );

/** The plan's agent under the id, or nothing: another plan's, another account's, or none. */
const planAgent = (call: CodingAgentCall, agentId: string) =>
  Effect.map(readCodingAgent(call.plan.userId, agentId), (found) =>
    Option.filter(found, (agent) => agent.planId === call.plan.planId),
  );

function rejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** A steer's refusal in the model's words. */
function refusalWords(refusal: HostedRefusal): string {
  return REFUSAL_WORDS.get(refusal.error) ?? CODING_AGENT_TOOL_REFUSAL.UNAVAILABLE;
}

/** A store that could not be read is the one refusal, logged for the operator and said to the model. */
const orStoreRefusal = <R>(
  effect: Effect.Effect<WireRecord, StoreFailure, R>,
): Effect.Effect<WireRecord, never, R> =>
  Effect.catch(effect, (failure) =>
    Effect.as(logStoreFailure(failure), rejected(CODING_AGENT_TOOL_REFUSAL.STORE)),
  );

/** The agents as the reading spells them, which the wire holds to be JSON. */
function readingsRecord(readings: readonly AgentReading[]): WireRecord[] {
  return readings.map((reading) => ({ ...reading }));
}

/** One call of `list_coding_agents`: every agent of the plan, in the order started. */
export function runListCodingAgents(
  call: CodingAgentCall,
): Effect.Effect<WireRecord, never, SqlClient.SqlClient> {
  return orStoreRefusal(
    Effect.gen(function* () {
      const { userId, planId } = call.plan;
      const agents = yield* listCodingAgents(userId, planId);
      const standing = yield* standingsOf(userId, agents);
      const readings = yield* Effect.forEach(agents, (agent) =>
        readAgent(userId, agent, standing(agent)),
      );
      return { status: ACTION_RESULT_STATUS.ACCEPTED, agents: readingsRecord(readings) };
    }),
  );
}

/** One call of `read_coding_agent`: the agent as the list reads it, and the tail of its newest turns. */
export function runReadCodingAgent(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const asked = readAgentRef(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(rejected(CODING_AGENT_TOOL_REFUSAL.UNREADABLE));
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* planAgent(call, asked.success.agentId);
      if (Option.isNone(found)) return rejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT);
      const agent = found.value;
      const { userId } = call.plan;
      const standing = yield* standingsOf(userId, [agent]);
      const reading = yield* readAgent(userId, agent, standing(agent));
      const published = yield* publishedOf(userId, agent);
      const journals = yield* journalsOf(userId, agent, CODING_AGENT_TOOL_BOUNDS.TAIL_TURNS);
      const tail = journals
        .flatMap((journal) => entriesOf(journal, CODING_AGENT_TOOL_BOUNDS.ENTRY_CHARS))
        .slice(-CODING_AGENT_TOOL_BOUNDS.TAIL_ENTRIES);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: { ...reading },
        ...(published === undefined
          ? undefined
          : { published: { branch: published.branch, pullRequest: published.pullRequest } }),
        tail,
      };
    }),
  );
}

/** One call of `message_coding_agent`: the words handed to the plan's agent, or why nothing was sent. */
export function runMessageCodingAgent(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const asked = readMessage(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(rejected(CODING_AGENT_TOOL_REFUSAL.UNREADABLE));
  }
  const { agentId, text } = asked.success;
  const eve = call.eve;
  if (eve === undefined) return Effect.succeed(rejected(CODING_AGENT_TOOL_REFUSAL.NO_SERVICE));
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* planAgent(call, agentId);
      if (Option.isNone(found)) return rejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT);
      const sent = yield* steerCodingAgent(eve, call.writer, call.plan.userId, found.value, {
        text,
        clientKey: call.clientKey,
      }).pipe(Effect.result);
      if (Result.isFailure(sent)) return rejected(refusalWords(sent.failure));
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        delivery: sent.success,
        agent: { id: found.value.id, status: CODING_AGENT_STATUS.RUNNING },
      };
    }),
  );
}
