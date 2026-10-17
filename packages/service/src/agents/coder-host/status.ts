import type {
  CodingAgent,
  CodingAgentLatestTurn,
  CodingAgentStartedFromIt,
} from "@luke/database/models/coding-agent-store";
import type { StoredArchive, StoredAutomationOrigin } from "@luke/database/schemas/coding-agent";
import { AUTOMATION_FIRING } from "@luke/features/automation-wire";
import {
  codingAgentStatusAt,
  type StatusTurn,
  lineAwaitsTurn as sharedLineAwaitsTurn,
} from "@luke/features/coding-agent-status";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_FAILURE,
  CONTEXT_WINDOW,
  type CodingAgentArchivedBy,
  type CodingAgentFailure,
  type CodingAgentOrigin,
  type CodingAgentPage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { BRAIN_REQUEST_FAILURE, TURN_STATUS } from "../../core.js";
import { REPOSITORY_REFUSAL } from "../repository-shell.js";
import { CODER_REFUSAL } from "./bounds.js";

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
 * row long past its Start (`STARTING_GRACE_MILLIS`) reads as failed rather
 * than starting forever, as one that never started: eve took the session,
 * and its first turn lands in seconds or not at all. A line that awaits its
 * turn reads as running whatever the newest turn says, because the session
 * took the message and the turn it opens is on its way
 * (`@luke/database/models/message-reads`'s `awaitingLinesOf` is where a
 * line is counted as waiting), but only for so long: a line that has
 * waited past `LINE_GRACE_MILLIS` with no turn running reads as failed, as
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

/** When the agent was started, when it is being read, which is what an agent with no turn is judged by, and when the newest line of the developer's still awaiting its turn was written. */
export interface AgentStanding {
  readonly createdAt: Date;
  /** Epoch milliseconds now. */
  readonly now: number;
  /** When the newest message of the developer's standing in the transcript with no turn yet was written; none where none stands or unsaid. */
  readonly awaitingLineAt?: Date | undefined;
}

/** What of the newest turn the shared rule reads (`@luke/features/coding-agent-status`), each instant in epoch milliseconds. */
function statusTurnOf(turn: CodingAgentLatestTurn | undefined): StatusTurn | undefined {
  return turn === undefined
    ? undefined
    : {
        status: turn.status,
        cancelRequested: turn.cancelRequestedAt !== null,
        queuedAt: turn.queuedAt.getTime(),
        settledAt: turn.settledAt?.getTime() ?? null,
        sessionEnded: turn.failure === BRAIN_REQUEST_FAILURE.SESSION_ENDED,
      };
}

/** Whether a line of the developer's awaits the turn it opens, which keeps the agent at work: what an archive or a Stop reads the agent idle by. */
export function lineAwaitsTurn(
  turn: CodingAgentLatestTurn | undefined,
  standing: Pick<AgentStanding, "now" | "awaitingLineAt">,
): boolean {
  return sharedLineAwaitsTurn(statusTurnOf(turn), {
    now: standing.now,
    awaitingLineAt: standing.awaitingLineAt?.getTime(),
  });
}

/** Where an agent stands, from its newest turn, by the rule the desktop reads it by too (`@luke/features/coding-agent-status`): running where a line awaits its turn, failed where one went unanswered past its grace, starting with no turn inside the grace, failed with none past it. */
export function codingAgentStatusOf(
  turn: CodingAgentLatestTurn | undefined,
  standing: AgentStanding,
): CodingAgentStatus {
  return codingAgentStatusAt(statusTurnOf(turn), {
    createdAt: standing.createdAt.getTime(),
    now: standing.now,
    awaitingLineAt: standing.awaitingLineAt?.getTime(),
  });
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
    ...(archive.withTask === true ? { withTask: true } : undefined),
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
