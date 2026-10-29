import {
  type Agent,
  type AgentLatestTurn,
  type AgentLine,
  type AgentStartedFromIt,
  agentBriefOf,
  agentLineOf,
} from "@luke/database/models/agent-store";
import type { Device } from "@luke/database/models/device-store";
import type { StoredArchive, StoredAutomationOrigin } from "@luke/database/schemas/agent";
import {
  agentStatusAt,
  type StatusTurn,
  lineAwaitsTurn as sharedLineAwaitsTurn,
  statusClockEdge as sharedStatusClockEdge,
  turnStoppable,
} from "@luke/features/agent-status";
import {
  AGENT_BRIEF,
  AGENT_FAILURE,
  AGENT_KIND,
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentArchivedBy,
  type AgentFailure,
  type AgentOrigin,
  type AgentPage,
  type AgentStatus,
  type AgentSummary,
  CONTEXT_WINDOW,
  type NativeAgentRuntime,
} from "@luke/features/agent-wire";
import { AUTOMATION_FIRING } from "@luke/features/automation-wire";
import { TURN_FAILURE, TURN_STATUS } from "../../core.js";
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

/** When the agent was started, when it is being read, which is what an agent with no turn is judged by, when the newest line of the developer's still awaiting its turn was written, and whether it was started blank. */
export interface AgentStanding {
  readonly createdAt: Date;
  /** Epoch milliseconds now. */
  readonly now: number;
  /** When the newest message of the developer's standing in the transcript with no turn yet was written; none where none stands or unsaid. */
  readonly awaitingLineAt?: Date | undefined;
  /** Whether the agent was started blank, handed neither the plan nor a prompt, so no first turn is on its way; unsaid reads as not. */
  readonly blank?: boolean | undefined;
}

/** Whether an agent was started blank, as a full read or a list line says it. */
export function startedBlank(agent: Agent | Pick<AgentLine, "brief">): boolean {
  const brief = "brief" in agent ? agent.brief : agentBriefOf(agent);
  return brief === AGENT_BRIEF.BLANK;
}

/** What of the newest turn the shared rule reads (`@luke/features/agent-status`), each instant in epoch milliseconds. */
function statusTurnOf(turn: AgentLatestTurn | undefined): StatusTurn | undefined {
  return turn === undefined
    ? undefined
    : {
        status: turn.status,
        cancelRequested: turn.cancelRequestedAt !== null,
        cancelRequestedAt: turn.cancelRequestedAt?.getTime(),
        queuedAt: turn.queuedAt.getTime(),
        settledAt: turn.settledAt?.getTime() ?? null,
        sessionEnded: turn.failure === TURN_FAILURE.SESSION_ENDED,
      };
}

/** Whether a line of the developer's awaits the turn it opens, which keeps the agent at work: what an archive or a Stop reads the agent idle by. */
export function lineAwaitsTurn(
  turn: AgentLatestTurn | undefined,
  standing: Pick<AgentStanding, "now" | "awaitingLineAt">,
): boolean {
  return sharedLineAwaitsTurn(statusTurnOf(turn), {
    now: standing.now,
    awaitingLineAt: standing.awaitingLineAt?.getTime(),
  });
}

/**
 * Where an agent stands, from its newest turn; running where a line awaits
 * its turn, failed where one went unanswered past its grace, starting with
 * no turn inside the grace, failed with none past it. An agent started blank
 * with no turn yet has done all it was asked, which is nothing, so it reads
 * as completed, however long ago it started: no first turn is on its way.
 */
export function agentStatusOf(
  turn: AgentLatestTurn | undefined,
  standing: AgentStanding,
): AgentStatus {
  return agentStatusAt(statusTurnOf(turn), {
    createdAt: standing.createdAt.getTime(),
    now: standing.now,
    awaitingLineAt: standing.awaitingLineAt?.getTime(),
    blank: standing.blank === true,
  });
}

/**
 * The next instant past which the clock alone moves the agent's status, in
 * epoch milliseconds: a line's grace running out, from running to failed,
 * or, with no turn and no line, the starting grace running out, from
 * starting to failed. None where nothing but a row changing can move it.
 */
export function statusClockEdge(
  turn: AgentLatestTurn | undefined,
  standing: AgentStanding,
): number | undefined {
  return sharedStatusClockEdge(statusTurnOf(turn), {
    createdAt: standing.createdAt.getTime(),
    now: standing.now,
    awaitingLineAt: standing.awaitingLineAt?.getTime(),
    blank: standing.blank === true,
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
export const FAILURE_WORDS: readonly (readonly [AgentFailure, readonly string[]])[] = [
  [
    AGENT_FAILURE.GITHUB,
    [
      CODER_REFUSAL.NOT_REACHABLE,
      CODER_REFUSAL.GITHUB_UNAVAILABLE,
      REPOSITORY_REFUSAL.NOT_REACHABLE,
      REPOSITORY_REFUSAL.GITHUB_UNAVAILABLE,
    ],
  ],
  [AGENT_FAILURE.CONTEXT_OVERFLOW, CONTEXT_OVERFLOW_WORDS],
  [AGENT_FAILURE.FAST_ON_OWN_KEY, [CODER_REFUSAL.FAST_ON_OWN_KEY]],
  [AGENT_FAILURE.FAST_NOT_ENABLED, [CODER_REFUSAL.FAST_NOT_ENABLED]],
  [
    AGENT_FAILURE.PROVIDER_KEY,
    [
      CODER_REFUSAL.ACCOUNT_KEY_UNREADABLE,
      CODER_REFUSAL.ACCOUNT_KEY_REFUSED,
      CODER_REFUSAL.ACCOUNT_KEY_NO_QUOTA,
    ],
  ],
  [
    AGENT_FAILURE.SANDBOX,
    [
      REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE,
      REPOSITORY_REFUSAL.NO_FIREWALL,
      REPOSITORY_REFUSAL.CHECKOUT_FAILED,
    ],
  ],
];

/**
 * What the turn of an agent its Mac refused to start records, the agent
 * having run directly on that Mac, which now runs every agent in a VM,
 * followed by the folder of its checkout there, which still holds its work.
 */
export const RAN_DIRECTLY_DETAIL =
  "the agent ran directly on its Mac, which now runs every agent in a VM; its work is still in ";

/** The folder an agent its Mac refused for having run directly on it left its work in, as its failed turn records it; nothing for any other turn. */
export function ranDirectlyFolderOf(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): string | undefined {
  if (turn?.status !== TURN_STATUS.FAILED) return undefined;
  if (turn.failure !== TURN_FAILURE.SESSION_ENDED) return undefined;
  const detail = turn.failureDetail ?? "";
  if (!detail.startsWith(RAN_DIRECTLY_DETAIL)) return undefined;
  const folder = detail.slice(RAN_DIRECTLY_DETAIL.length);
  return folder.length > 0 ? folder : undefined;
}

/** Why an agent read as failed failed, as the wire's word: its newest turn's failure, or a session that never started where no turn stands; nothing for a turn that did not fail. */
export function agentFailureOf(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): AgentFailure | undefined {
  if (turn === undefined) return AGENT_FAILURE.NOT_STARTED;
  if (turn.status !== TURN_STATUS.FAILED) return undefined;
  if (turn.failure === TURN_FAILURE.ABANDONED) return AGENT_FAILURE.ABANDONED;
  if (turn.failure === TURN_FAILURE.SESSION_ENDED) {
    return AGENT_FAILURE.SESSION_ENDED;
  }
  if (turn.failure !== TURN_FAILURE.MODEL) return AGENT_FAILURE.OTHER;
  const detail = turn.failureDetail ?? "";
  const named = FAILURE_WORDS.find(([, words]) => words.some((word) => detail.includes(word)));
  return named?.[0] ?? AGENT_FAILURE.MODEL;
}

/** What an agent's status is read from: its newest turn, and when the newest line of the developer's awaiting its turn was written. */
export interface AgentTurnStanding {
  readonly turn: AgentLatestTurn | undefined;
  readonly awaitingLineAt: Date | undefined;
  /** The provider's own harness its conversation runs on; none on eve, and where the read named none. */
  readonly runtime?: NativeAgentRuntime | undefined;
}

/** When the run the status is read from began: the newest turn's start, or its queueing before eve starts it, the agent's own before any turn, and none while a line awaits its turn. */
export function agentRunStartedAt(
  turn: AgentLatestTurn | undefined,
  standing: AgentStanding,
): number | undefined {
  if (lineAwaitsTurn(turn, standing)) return undefined;
  return (turn === undefined ? standing.createdAt : (turn.startedAt ?? turn.queuedAt)).getTime();
}

/**
 * When the agent last did something settled, in epoch milliseconds: the
 * later of when it was started and when its newest turn to end ended
 * (`lastSettledTurnsOfReached`). Note that a turn's start is no activity,
 * because a turn starts on whatever wakes the agent, a check finishing or a
 * wakeup it set as often as a line of the developer's, and the row would
 * read "now" with nothing new on it; what the turn did shows once it ends.
 * So a list ordered by it holds still while the agent works, and moves once,
 * when the turn ends. Note too that a subagent's turns run inside its
 * parent's, and that an item the agent posts to the Inbox or a pull request
 * it opens is posted inside a turn, so the parent's turn already brackets
 * them, and none is read apart.
 */
export function agentActivityAt(
  lastSettledAt: Date | undefined,
  standing: Pick<AgentStanding, "createdAt">,
): number {
  return Math.max(standing.createdAt.getTime(), lastSettledAt?.getTime() ?? 0);
}

/** Who archived an agent as its banner says it: the member, where their account stands, the agent acting for them, and why. */
function archivedByOf(archive: StoredArchive, names: ReadonlyMap<string, string>): AgentArchivedBy {
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

/** No Mac read: a summary built from it names no Mac. */
const NO_MACS: ReadonlyMap<string, Device> = new Map();

/** The Mac a local agent runs on as its summary names it, by its name and when it last beat; none for an agent in a sandbox or whose Mac was not read. */
function macOf(
  agent: Pick<AgentLine, "machine" | "deviceId">,
  macs: ReadonlyMap<string, Device>,
): AgentSummary["mac"] {
  if (agent.machine !== AGENT_MACHINE.DEVICE || agent.deviceId == null) return undefined;
  const device = macs.get(agent.deviceId);
  return device === undefined
    ? undefined
    : { name: device.name, seenAt: device.lastSeenAt.getTime(), deviceId: device.id };
}

/** The Macs a read's local agents are pinned to, by id, which `devicesNamed` reads. */
export function summaryDevices(
  agents: readonly Pick<AgentLine, "machine" | "deviceId">[],
): readonly string[] {
  return agents.flatMap((agent) =>
    agent.machine === AGENT_MACHINE.DEVICE && agent.deviceId != null ? [agent.deviceId] : [],
  );
}

/** What every read of one agent says of it but its task, its status read at `now`, the agents started from it where any was, and the Mac it runs on where `macs` holds it. */
function summaryFields(
  agent: AgentLine,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  continuedBy: readonly AgentStartedFromIt[],
  macs: ReadonlyMap<string, Device>,
): Omit<AgentSummary, "id" | "planId"> {
  const starter = names.get(agent.userId);
  const mac = macOf(agent, macs);
  const summary: Omit<AgentSummary, "id" | "planId"> = {
    model: agent.model,
    effort: agent.effort,
    ...(agent.contextWindow === CONTEXT_WINDOW.STANDARD
      ? { contextWindow: agent.contextWindow }
      : undefined),
    ...(standing.runtime === undefined ? undefined : { runtime: standing.runtime }),
    title: agent.title,
    // Note that only an operator says its kind, so a coder's summary is as it was; a pilot says it is one.
    ...(agent.kind === AGENT_KIND.OPERATOR ? { kind: agent.kind } : undefined),
    ...(agent.kind === AGENT_KIND.PILOT ? { pilot: true } : undefined),
    // Likewise only a local agent says where it runs, so a sandboxed agent's summary is as it was.
    ...(agent.machine === AGENT_MACHINE.DEVICE ? { machine: agent.machine } : undefined),
    ...(mac === undefined ? undefined : { mac }),
    createdAt: agent.createdAt.getTime(),
    status: agentStatusOf(standing.turn, {
      createdAt: agent.createdAt,
      now,
      awaitingLineAt: standing.awaitingLineAt,
      blank: startedBlank(agent),
    }),
    turnId: standing.turn?.id ?? null,
    brief: agent.brief,
    ...(agent.archivedAt === null ? undefined : { archivedAt: agent.archivedAt.getTime() }),
    ...(agent.archivedAt === null || agent.archivedBy === null
      ? undefined
      : { archivedBy: archivedByOf(agent.archivedBy, names) }),
    ...(agent.disabledServers.length === 0
      ? undefined
      : { disabledServers: agent.disabledServers }),
    ...(starter === undefined ? undefined : { startedBy: { userId: agent.userId, name: starter } }),
    ...(agent.automationId === null ? undefined : { automationId: agent.automationId }),
    ...(agent.automationName === null ? undefined : { automationName: agent.automationName }),
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
  const started = agentRunStartedAt(standing.turn, {
    createdAt: agent.createdAt,
    now,
    awaitingLineAt: standing.awaitingLineAt,
  });
  const stoppable =
    summary.status !== AGENT_STATUS.RUNNING || turnStoppable(statusTurnOf(standing.turn));
  return {
    ...summary,
    ...(started === undefined ? undefined : { runStartedAt: started }),
    ...(stoppable ? undefined : { stoppable: false }),
  };
}

/**
 * One agent as the tabs draw it, on a task or with none, read whole or as a
 * list's line, its status read at `now`, the member who started it named by
 * `names`, the accounts' names by id, where theirs stands, the agents
 * started from it, none where the read names none, and the Mac a local
 * agent runs on, where `macs` holds it.
 */
export function agentSummary(
  agent: Agent | AgentLine,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  continuedBy: readonly AgentStartedFromIt[] = [],
  macs: ReadonlyMap<string, Device> = NO_MACS,
): AgentSummary {
  const line = "brief" in agent ? agent : agentLineOf(agent);
  return {
    id: line.id,
    planId: line.taskId,
    ...summaryFields(line, standing, now, names, continuedBy, macs),
  };
}

/**
 * The run that started an agent as its page opens on it: the prompt alone,
 * the issue or pull request a GitHub event named, a webhook's body, and the
 * member who asked for a run now, named by `names` where their account
 * stands.
 */
function originOf(origin: StoredAutomationOrigin, names: ReadonlyMap<string, string>): AgentOrigin {
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
export function summaryAccounts(
  agent: Pick<AgentLine, "userId" | "archivedBy">,
): readonly string[] {
  return agent.archivedBy === null ? [agent.userId] : [agent.userId, agent.archivedBy.userId];
}

/** The accounts an agent's page names: its summary's, and whoever asked for the run that started it. */
export function pageAccounts(agent: Agent): readonly string[] {
  const firing = agent.automationOrigin?.firing;
  return firing?.kind === AUTOMATION_FIRING.MANUAL && firing.userId !== undefined
    ? [...summaryAccounts(agent), firing.userId]
    : summaryAccounts(agent);
}

/** One agent as its own page reads it, on a task or with none, its status read at `now`, with the agents started from it and the Mac it runs on. */
export function agentPage(
  agent: Agent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  continuedBy: readonly AgentStartedFromIt[] = [],
  macs: ReadonlyMap<string, Device> = NO_MACS,
): AgentPage {
  return {
    id: agent.id,
    planId: agent.taskId,
    ...summaryFields(agentLineOf(agent), standing, now, names, continuedBy, macs),
    automationId: agent.automationId,
    ...(agent.automationOrigin === null
      ? undefined
      : { origin: originOf(agent.automationOrigin, names) }),
    workspaceId: agent.organizationId,
    repository: agent.repository,
  };
}
