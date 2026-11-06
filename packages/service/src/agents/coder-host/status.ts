import type { AgentOwnerFacts } from "@repo/database/models/agent-owners";
import {
  type Agent,
  type AgentLatestTurn,
  type AgentLine,
  type AgentStartedFromIt,
  agentBriefOf,
  agentLineOf,
} from "@repo/database/models/agent-store";
import type { Device } from "@repo/database/models/device-store";
import type { StoredArchive, StoredAutomationOrigin } from "@repo/database/schemas/agent";
import {
  agentStatusAt,
  type StatusTurn,
  lineAwaitsTurn as sharedLineAwaitsTurn,
  statusClockEdge as sharedStatusClockEdge,
  turnStoppable,
} from "@repo/features/agent-status";
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
  agentOwnerOf,
  CONTEXT_WINDOW,
  type NativeAgentRuntime,
} from "@repo/features/agent-wire";
import { AUTOMATION_FIRING } from "@repo/features/automation-wire";
import {
  DEVICE_LAUNCH_STEP,
  DEVICE_LAUNCH_STEPS,
  DEVICE_LAUNCH_UNSTARTED,
  type DeviceLaunchStep,
  type DeviceLaunchUnstarted,
} from "@repo/features/device-agent-wire";
import { TURN_FAILURE, TURN_STATUS } from "../../core.js";
import { REPOSITORY_REFUSAL } from "../repository-shell.js";
import { CODER_REFUSAL } from "./bounds.js";

export interface AgentStanding {
  readonly createdAt: Date;
  readonly now: number;
  readonly awaitingLineAt?: Date | undefined;
  readonly blank?: boolean | undefined;
}

export function startedBlank(agent: Agent | Pick<AgentLine, "brief">): boolean {
  const brief = "brief" in agent ? agent.brief : agentBriefOf(agent);
  return brief === AGENT_BRIEF.BLANK;
}

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

export function lineAwaitsTurn(
  turn: AgentLatestTurn | undefined,
  standing: Pick<AgentStanding, "now" | "awaitingLineAt">,
): boolean {
  return sharedLineAwaitsTurn(statusTurnOf(turn), {
    now: standing.now,
    awaitingLineAt: standing.awaitingLineAt?.getTime(),
  });
}

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

const CONTEXT_OVERFLOW_WORDS: readonly string[] = [
  "prompt is too long",
  "context_length_exceeded",
  "maximum context length",
];

const HOST_AWAY_DETAIL = " went away during this turn. Send a message to carry on once it's back.";

export function hostAwayDetail(hostName: string): string {
  return `${hostName}${HOST_AWAY_DETAIL}`;
}

const LAUNCH_STOPPED_DETAIL = "the agent's host settled its launch unstarted at the step ";

const LAUNCH_UNSTARTED_DETAIL = ", because of ";

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
  [AGENT_FAILURE.OTHER, [HOST_AWAY_DETAIL, LAUNCH_STOPPED_DETAIL]],
];

export function hostLostOf(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): { readonly host: string } | undefined {
  if (turn?.status !== TURN_STATUS.FAILED) return undefined;
  if (turn.failure !== TURN_FAILURE.MODEL) return undefined;
  const detail = turn.failureDetail ?? "";
  if (!detail.endsWith(HOST_AWAY_DETAIL)) return undefined;
  const host = detail.slice(0, -HOST_AWAY_DETAIL.length);
  return host.length > 0 ? { host } : undefined;
}

export function launchStoppedDetail(
  step: string | null,
  unstarted?: DeviceLaunchUnstarted,
): string | undefined {
  const known =
    DEVICE_LAUNCH_STEPS.find((each) => each === step) ??
    (unstarted === undefined ? undefined : DEVICE_LAUNCH_STEP.PREPARING);
  if (known === undefined) return undefined;
  const why = unstarted === undefined ? "" : `${LAUNCH_UNSTARTED_DETAIL}${unstarted}`;
  return `${LAUNCH_STOPPED_DETAIL}${known}${why}`;
}

function launchStoppedParts(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): { readonly step: string; readonly unstarted: string | undefined } | undefined {
  if (turn?.status !== TURN_STATUS.FAILED) return undefined;
  if (turn.failure !== TURN_FAILURE.MODEL) return undefined;
  const detail = turn.failureDetail ?? "";
  if (!detail.startsWith(LAUNCH_STOPPED_DETAIL)) return undefined;
  const [step = "", unstarted] = detail
    .slice(LAUNCH_STOPPED_DETAIL.length)
    .split(LAUNCH_UNSTARTED_DETAIL);
  return { step, unstarted };
}

export function launchStoppedOf(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): DeviceLaunchStep | undefined {
  const parts = launchStoppedParts(turn);
  return DEVICE_LAUNCH_STEPS.find((each) => each === parts?.step);
}

export function launchUnstartedOf(
  turn: Pick<AgentLatestTurn, "status" | "failure" | "failureDetail"> | undefined,
): DeviceLaunchUnstarted | undefined {
  const parts = launchStoppedParts(turn);
  return Object.values(DEVICE_LAUNCH_UNSTARTED).find((each) => each === parts?.unstarted);
}

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

export interface AgentTurnStanding {
  readonly turn: AgentLatestTurn | undefined;
  readonly awaitingLineAt: Date | undefined;
  readonly runtime?: NativeAgentRuntime | undefined;
}

export function agentRunStartedAt(
  turn: AgentLatestTurn | undefined,
  standing: AgentStanding,
): number | undefined {
  if (lineAwaitsTurn(turn, standing)) return undefined;
  return (turn === undefined ? standing.createdAt : (turn.startedAt ?? turn.queuedAt)).getTime();
}

export function agentActivityAt(
  lastSettledAt: Date | undefined,
  standing: Pick<AgentStanding, "createdAt">,
): number {
  return Math.max(standing.createdAt.getTime(), lastSettledAt?.getTime() ?? 0);
}

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

const NO_MACS: ReadonlyMap<string, Device> = new Map();

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

export function summaryDevices(
  agents: readonly Pick<AgentLine, "machine" | "deviceId">[],
): readonly string[] {
  return agents.flatMap((agent) =>
    agent.machine === AGENT_MACHINE.DEVICE && agent.deviceId != null ? [agent.deviceId] : [],
  );
}

function summaryFields(
  agent: AgentLine,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  owners: AgentOwnerFacts,
  continuedBy: readonly AgentStartedFromIt[],
  macs: ReadonlyMap<string, Device>,
): Omit<AgentSummary, "id" | "planId"> {
  const starter = names.get(agent.userId);
  const mac = macOf(agent, macs);
  const owner = agentOwnerOf({
    taskId: agent.taskId,
    runId: agent.automationRunId,
    runAutomationId:
      agent.automationRunId === null
        ? null
        : (owners.runAutomations.get(agent.automationRunId) ?? null),
  });
  const summary: Omit<AgentSummary, "id" | "planId"> = {
    model: agent.model,
    effort: agent.effort,
    ...(agent.contextWindow === CONTEXT_WINDOW.STANDARD
      ? { contextWindow: agent.contextWindow }
      : undefined),
    ...(standing.runtime === undefined ? undefined : { runtime: standing.runtime }),
    title: agent.title,
    ...(agent.kind === AGENT_KIND.PILOT ? { pilot: true } : undefined),
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
    ...(agent.source == null ? undefined : { source: agent.source }),
    ...(owner === undefined ? undefined : { owner }),
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

export function agentSummary(
  agent: Agent | AgentLine,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  owners: AgentOwnerFacts,
  continuedBy: readonly AgentStartedFromIt[] = [],
  macs: ReadonlyMap<string, Device> = NO_MACS,
): AgentSummary {
  const line = "brief" in agent ? agent : agentLineOf(agent);
  return {
    id: line.id,
    planId: line.taskId,
    ...summaryFields(line, standing, now, names, owners, continuedBy, macs),
  };
}

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

export function summaryAccounts(
  agent: Pick<AgentLine, "userId" | "archivedBy">,
): readonly string[] {
  return agent.archivedBy === null ? [agent.userId] : [agent.userId, agent.archivedBy.userId];
}

export function pageAccounts(agent: Agent): readonly string[] {
  const firing = agent.automationOrigin?.firing;
  return firing?.kind === AUTOMATION_FIRING.MANUAL && firing.userId !== undefined
    ? [...summaryAccounts(agent), firing.userId]
    : summaryAccounts(agent);
}

export function agentPage(
  agent: Agent,
  standing: AgentTurnStanding,
  now: number,
  names: ReadonlyMap<string, string>,
  owners: AgentOwnerFacts,
  continuedBy: readonly AgentStartedFromIt[] = [],
  macs: ReadonlyMap<string, Device> = NO_MACS,
): AgentPage {
  return {
    id: agent.id,
    planId: agent.taskId,
    ...summaryFields(agentLineOf(agent), standing, now, names, owners, continuedBy, macs),
    automationId: agent.automationId,
    ...(agent.automationOrigin === null
      ? undefined
      : { origin: originOf(agent.automationOrigin, names) }),
    workspaceId: agent.organizationId,
    repository: agent.repository,
    ...(agent.branch === null ? undefined : { branch: agent.branch }),
  };
}
