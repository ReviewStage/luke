import type {
  CodingAgent,
  CodingAgentLatestTurn,
  CodingAgentStartedFromIt,
} from "@luke/database/models/coding-agent-store";
import type { StoredArchive, StoredAutomationOrigin } from "@luke/database/schemas/coding-agent";
import { AUTOMATION_FIRING } from "@luke/features/automation-wire";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  CONTEXT_WINDOW,
  type CodingAgentArchivedBy,
  type CodingAgentFailure,
  type CodingAgentOrigin,
  type CodingAgentPage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { Duration } from "effect";
import { BRAIN_REQUEST_FAILURE, TURN_STATUS } from "../../core.js";
import { REPOSITORY_REFUSAL } from "../repository-shell.js";
import { CODER, CODER_REFUSAL } from "./bounds.js";

/**
 * status.ts -- where a coding agent stands, read from its newest turn.
 *
 * An agent's status is its conversation's newest turn row and the one
 * thing beside it, a message of the developer's still awaiting its turn:
 * `starting` before the first turn is queued, `running` while eve runs a
 * turn or a line waits for the turn it will open, and how the newest turn
 * ended after. A turn still running that carries a Stop stamp
 * reads as cancelled already, since the Stop is on its way to eve and
 * nothing the turn still does changes where it ends. An agent with no turn
 * row long past its Start (`CODER.STARTING_GRACE`) reads as failed rather
 * than starting forever, as one that never started: eve took the session,
 * and its first turn lands in seconds or not at all. A line that awaits its
 * turn reads as running whatever the newest turn says, because the session
 * took the message and the turn it opens is on its way
 * (`@luke/database/models/message-reads`'s `awaitingLinesOf` is where a
 * line is counted as waiting), but only for so long: a line that has
 * waited past `CODER.LINE_GRACE` with no turn running reads as failed, as
 * one whose turn is not coming, so the developer is offered Continue on it
 * rather than watching it run forever. Failed rather than as the newest
 * turn says, because the line went unanswered, and a settled agent would
 * offer neither Continue nor any word of why. A line older than the newest
 * turn's queueing that the turn never took awaits nothing either: that turn
 * was its, and ended without the store hearing it received. A failed turn
 * is also read for why, as one of the wire's fixed words: the sweep's own
 * word for a turn it settled, else the host's refusal sentences where the
 * turn's detail carries one, GitHub's or the sandbox's, else a provider's
 * refusal of a prompt longer than the model's window, else the model
 * call, which is what every other eve failure of a coding turn is. An
 * unanswered line after a turn that did not fail has no word, and its end
 * line says Failed alone. Nothing of the detail itself leaves here.
 */

/** The status a turn row's own status word reads as. */
const STATUS_OF_TURN = {
  [TURN_STATUS.QUEUED]: CODING_AGENT_STATUS.RUNNING,
  [TURN_STATUS.RUNNING]: CODING_AGENT_STATUS.RUNNING,
  [TURN_STATUS.SETTLED]: CODING_AGENT_STATUS.COMPLETED,
  [TURN_STATUS.CANCELLED]: CODING_AGENT_STATUS.CANCELLED,
  [TURN_STATUS.FAILED]: CODING_AGENT_STATUS.FAILED,
} as const satisfies Record<string, CodingAgentStatus>;

const STATUS_WORDS: ReadonlySet<string> = new Set(Object.keys(STATUS_OF_TURN));

function isTurnStatusWord(status: string): status is keyof typeof STATUS_OF_TURN {
  return STATUS_WORDS.has(status);
}

/** When the agent was started, when it is being read, which is what an agent with no turn is judged by, and when the newest line of the developer's still awaiting its turn was written. */
export interface AgentStanding {
  readonly createdAt: Date;
  /** Epoch milliseconds now. */
  readonly now: number;
  /** When the newest message of the developer's standing in the transcript with no turn yet was written; none where none stands or unsaid. */
  readonly awaitingLineAt?: Date | undefined;
}

/** Whether an agent with no turn row is still inside the grace its first turn may land in. */
function withinStartingGrace(standing: AgentStanding): boolean {
  return standing.now - standing.createdAt.getTime() <= Duration.toMillis(CODER.STARTING_GRACE);
}

/** Where a line of the developer's with no turn stands: none, awaiting the turn it opens, or unanswered past the grace. */
const LINE_STANDING = {
  NONE: "none",
  AWAITS: "awaits",
  UNANSWERED: "unanswered",
} as const;

type LineStanding = (typeof LINE_STANDING)[keyof typeof LINE_STANDING];

/** Whether a turn row still runs, or is queued to: what takes a line at its next step, however long the step it is on runs. */
function turnRuns(turn: CodingAgentLatestTurn): boolean {
  return (
    isTurnStatusWord(turn.status) && STATUS_OF_TURN[turn.status] === CODING_AGENT_STATUS.RUNNING
  );
}

/**
 * Where the newest line awaiting a turn stands. A turn still running takes
 * it, so it awaits. With none running, a line written before the newest
 * turn was queued was that turn's opener, written under the lock before
 * eve's first write of the turn (`steer.ts`), and the turn ended without the
 * store hearing it received, so it awaits nothing; a line written once the
 * turn was queued was a steer to it and still counts. Else it awaits for
 * the grace, counted from when it was written or the newest turn ended,
 * whichever came later, since that is how long it has stood with nothing
 * running to take it, and is unanswered past it.
 */
function lineStandingOf(
  turn: CodingAgentLatestTurn | undefined,
  standing: Pick<AgentStanding, "now" | "awaitingLineAt">,
): LineStanding {
  const line = standing.awaitingLineAt?.getTime();
  if (line === undefined) return LINE_STANDING.NONE;
  if (turn !== undefined && turnRuns(turn)) return LINE_STANDING.AWAITS;
  if (turn !== undefined && line < turn.queuedAt.getTime()) {
    return LINE_STANDING.NONE;
  }
  const since = Math.max(line, turn?.settledAt?.getTime() ?? 0);
  return standing.now - since <= Duration.toMillis(CODER.LINE_GRACE)
    ? LINE_STANDING.AWAITS
    : LINE_STANDING.UNANSWERED;
}

/** Whether a line of the developer's awaits the turn it opens, which keeps the agent at work: what an archive or a Stop reads the agent idle by. */
export function lineAwaitsTurn(
  turn: CodingAgentLatestTurn | undefined,
  standing: Pick<AgentStanding, "now" | "awaitingLineAt">,
): boolean {
  return lineStandingOf(turn, standing) === LINE_STANDING.AWAITS;
}

/** Where an agent stands, from its newest turn; running where a line awaits its turn, failed where one went unanswered past its grace, starting with no turn inside the grace, failed with none past it. */
export function codingAgentStatusOf(
  turn: CodingAgentLatestTurn | undefined,
  standing: AgentStanding,
): CodingAgentStatus {
  const line = lineStandingOf(turn, standing);
  if (line === LINE_STANDING.AWAITS) return CODING_AGENT_STATUS.RUNNING;
  if (line === LINE_STANDING.UNANSWERED) return CODING_AGENT_STATUS.FAILED;
  if (turn === undefined) {
    return withinStartingGrace(standing)
      ? CODING_AGENT_STATUS.STARTING
      : CODING_AGENT_STATUS.FAILED;
  }
  // A row outside the vocabulary is a write this build does not know, read as the one status that claims nothing.
  if (!isTurnStatusWord(turn.status)) return CODING_AGENT_STATUS.FAILED;
  const status = STATUS_OF_TURN[turn.status];
  return status === CODING_AGENT_STATUS.RUNNING && turn.cancelRequestedAt !== null
    ? CODING_AGENT_STATUS.CANCELLED
    : status;
}

/**
 * What a provider says, in the error eve keeps in a failed turn's detail,
 * when the prompt is longer than the model's window: Anthropic's
 * "prompt is too long: 1368155 tokens > 1000000 maximum", and OpenAI's
 * error code and words for the same.
 */
const CONTEXT_OVERFLOW_WORDS: readonly string[] = [
  "prompt is too long",
  "context_length_exceeded",
  "maximum context length",
];

/** The host's refusal sentences, and a provider's words for a prompt past the window, a failed turn's detail may carry, by the word the wire says for each. */
const FAILURE_WORDS: readonly (readonly [CodingAgentFailure, readonly string[]])[] = [
  [
    CODING_AGENT_FAILURE.GITHUB,
    [
      CODER_REFUSAL.NOT_REACHABLE,
      CODER_REFUSAL.GITHUB_UNAVAILABLE,
      REPOSITORY_REFUSAL.NOT_REACHABLE,
      REPOSITORY_REFUSAL.GITHUB_UNAVAILABLE,
    ],
  ],
  [CODING_AGENT_FAILURE.CONTEXT_OVERFLOW, CONTEXT_OVERFLOW_WORDS],
  [CODING_AGENT_FAILURE.FAST_ON_OWN_KEY, [CODER_REFUSAL.FAST_ON_OWN_KEY]],
  [CODING_AGENT_FAILURE.FAST_NOT_ENABLED, [CODER_REFUSAL.FAST_NOT_ENABLED]],
  [
    CODING_AGENT_FAILURE.PROVIDER_KEY,
    [
      CODER_REFUSAL.ACCOUNT_KEY_UNREADABLE,
      CODER_REFUSAL.ACCOUNT_KEY_REFUSED,
      CODER_REFUSAL.ACCOUNT_KEY_NO_QUOTA,
    ],
  ],
  [
    CODING_AGENT_FAILURE.SANDBOX,
    [
      REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE,
      REPOSITORY_REFUSAL.NO_FIREWALL,
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    ],
  ],
];

/** Why an agent read as failed failed, as the wire's word: its newest turn's failure, or a session that never started where no turn stands; nothing for a turn that did not fail. */
export function codingAgentFailureOf(
  turn: Pick<CodingAgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): CodingAgentFailure | undefined {
  if (turn === undefined) return CODING_AGENT_FAILURE.NOT_STARTED;
  if (turn.status !== TURN_STATUS.FAILED) return undefined;
  if (turn.failure === BRAIN_REQUEST_FAILURE.ABANDONED) return CODING_AGENT_FAILURE.ABANDONED;
  if (turn.failure === BRAIN_REQUEST_FAILURE.SESSION_ENDED) {
    return CODING_AGENT_FAILURE.SESSION_ENDED;
  }
  if (turn.failure !== BRAIN_REQUEST_FAILURE.MODEL) return CODING_AGENT_FAILURE.OTHER;
  const detail = turn.failureDetail ?? "";
  const named = FAILURE_WORDS.find(([, words]) => words.some((word) => detail.includes(word)));
  return named?.[0] ?? CODING_AGENT_FAILURE.MODEL;
}

/** What an agent's status is read from: its newest turn, and when the newest line of the developer's awaiting its turn was written. */
export interface AgentTurnStanding {
  readonly turn: CodingAgentLatestTurn | undefined;
  readonly awaitingLineAt: Date | undefined;
}

/** When the run the status is read from began: the newest turn's start, or its queueing before eve starts it, the agent's own before any turn, and none while a line awaits its turn. */
export function codingAgentRunStartedAt(
  turn: CodingAgentLatestTurn | undefined,
  standing: AgentStanding,
): number | undefined {
  if (lineAwaitsTurn(turn, standing)) return undefined;
  return (turn === undefined ? standing.createdAt : (turn.startedAt ?? turn.queuedAt)).getTime();
}

/**
 * When the agent last did something settled, in epoch milliseconds: the
 * latest of when it was started, when its newest turn was handed a message
 * (queued, then begun), and when that turn settled. None of them moves while
 * a turn streams, so a list ordered by it holds still while the agent works,
 * and moves once, when the turn ends. Note that a subagent's turns run inside
 * its parent's, and that an item the agent posts to the Inbox or a pull
 * request it opens is posted inside a turn, so the parent's turn already
 * brackets them, and none is read apart.
 */
export function codingAgentActivityAt(
  turn: CodingAgentLatestTurn | undefined,
  standing: Pick<AgentStanding, "createdAt">,
): number {
  const begun = turn === undefined ? undefined : (turn.startedAt ?? turn.queuedAt);
  return Math.max(
    standing.createdAt.getTime(),
    begun?.getTime() ?? 0,
    turn?.settledAt?.getTime() ?? 0,
  );
}

/** Who archived an agent as its banner says it: the member, where their account stands, the agent acting for them, and why. */
function archivedByOf(
  archive: StoredArchive,
  names: ReadonlyMap<string, string>,
): CodingAgentArchivedBy {
  const member = names.get(archive.userId);
  return {
    by: archive.by,
    ...(member === undefined ? undefined : { member: { userId: archive.userId, name: member } }),
    ...(archive.agentId === undefined
      ? undefined
      : { agent: { id: archive.agentId, name: archive.agentName ?? "" } }),
    ...(archive.reason === undefined ? undefined : { reason: archive.reason }),
  };
}

/** What every read of one agent says of it but its task, its status read at `now`, and the agents started from it where any was. */
function summaryFields(
  agent: CodingAgent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  continuedBy: readonly CodingAgentStartedFromIt[],
): Omit<CodingAgentSummary, "id" | "planId"> {
  const starter = names.get(agent.userId);
  const summary: Omit<CodingAgentSummary, "id" | "planId"> = {
    model: agent.model,
    effort: agent.effort,
    ...(agent.contextWindow === CONTEXT_WINDOW.STANDARD
      ? { contextWindow: agent.contextWindow }
      : undefined),
    title: agent.title,
    createdAt: agent.createdAt.getTime(),
    status: codingAgentStatusOf(standing.turn, {
      createdAt: agent.createdAt,
      now,
      awaitingLineAt: standing.awaitingLineAt,
    }),
    turnId: standing.turn?.id ?? null,
    brief: agent.prompt === null ? CODING_AGENT_BRIEF.PLAN : CODING_AGENT_BRIEF.PROMPT,
    ...(agent.archivedAt === null ? undefined : { archivedAt: agent.archivedAt.getTime() }),
    ...(agent.archivedAt === null || agent.archivedBy === null
      ? undefined
      : { archivedBy: archivedByOf(agent.archivedBy, names) }),
    ...(agent.disabledServers.length === 0
      ? undefined
      : { disabledServers: agent.disabledServers }),
    ...(starter === undefined ? undefined : { startedBy: { userId: agent.userId, name: starter } }),
    ...(agent.automationId === null ? undefined : { automationId: agent.automationId }),
    ...(agent.automationOrigin === null
      ? undefined
      : { automationName: agent.automationOrigin.name }),
    ...(agent.startedFrom === null ? undefined : { from: agent.startedFrom }),
    ...(continuedBy.length === 0
      ? undefined
      : {
          continuedBy: continuedBy.map((each) => ({
            agentId: each.agentId,
            title: each.title,
            forked: each.messageId !== undefined,
            ...(each.messageId === undefined ? undefined : { messageId: each.messageId }),
          })),
        }),
  };
  const started = codingAgentRunStartedAt(standing.turn, {
    createdAt: agent.createdAt,
    now,
    awaitingLineAt: standing.awaitingLineAt,
  });
  return started === undefined ? summary : { ...summary, runStartedAt: started };
}

/**
 * One agent as the tabs draw it, on a task or with none, its status read at
 * `now`, the member who started it named by `names`, the accounts' names
 * by id, where theirs stands, and the agents started from it, none where
 * the read names none.
 */
export function codingAgentSummary(
  agent: CodingAgent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  continuedBy: readonly CodingAgentStartedFromIt[] = [],
): CodingAgentSummary {
  return {
    id: agent.id,
    planId: agent.taskId,
    ...summaryFields(agent, standing, now, names, continuedBy),
  };
}

/**
 * The run that started an agent as its page opens on it: the prompt alone,
 * the issue or pull request a GitHub event named, a webhook's body, and the
 * member who asked for a run now, named by `names` where their account
 * stands.
 */
function originOf(
  origin: StoredAutomationOrigin,
  names: ReadonlyMap<string, string>,
): CodingAgentOrigin {
  const { firing } = origin;
  const subject =
    firing.kind === AUTOMATION_FIRING.GITHUB && firing.number !== undefined
      ? {
          number: firing.number,
          ...(firing.title === undefined ? undefined : { title: firing.title }),
          ...(firing.url === undefined ? undefined : { url: firing.url }),
        }
      : undefined;
  const runner =
    firing.kind === AUTOMATION_FIRING.MANUAL && firing.userId !== undefined
      ? firing.userId
      : undefined;
  const name = runner === undefined ? undefined : names.get(runner);
  return {
    prompt: origin.prompt,
    ...(subject === undefined ? undefined : { subject }),
    ...(origin.body === undefined ? undefined : { body: origin.body }),
    ...(runner === undefined || name === undefined
      ? undefined
      : { runBy: { userId: runner, name } }),
  };
}

/** The accounts an agent's summary names: its starter, and the member it was archived by or for. */
export function summaryAccounts(agent: CodingAgent): readonly string[] {
  return agent.archivedBy === null ? [agent.userId] : [agent.userId, agent.archivedBy.userId];
}

/** The accounts an agent's page names: its summary's, and whoever asked for the run that started it. */
export function pageAccounts(agent: CodingAgent): readonly string[] {
  const firing = agent.automationOrigin?.firing;
  return firing?.kind === AUTOMATION_FIRING.MANUAL && firing.userId !== undefined
    ? [...summaryAccounts(agent), firing.userId]
    : summaryAccounts(agent);
}

/** One agent as its own page reads it, on a task or with none, its status read at `now`, with the agents started from it. */
export function codingAgentPage(
  agent: CodingAgent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  continuedBy: readonly CodingAgentStartedFromIt[] = [],
): CodingAgentPage {
  return {
    id: agent.id,
    planId: agent.taskId,
    ...summaryFields(agent, standing, now, names, continuedBy),
    automationId: agent.automationId,
    ...(agent.automationOrigin === null
      ? undefined
      : { origin: originOf(agent.automationOrigin, names) }),
    workspaceId: agent.organizationId,
    repository: agent.repository,
  };
}
