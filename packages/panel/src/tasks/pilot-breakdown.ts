/**
 * pilot-breakdown.ts -- a pilot task's breakdown as it waits for the developer's go: the child tasks still waiting, the pilot that hears the answer, and the words it is told.
 *
 * A pilot writes its breakdown as child tasks that wait in todo, each with
 * no agent, and starts their coding agents only once the developer approves
 * it. Every such child stands in the breakdown that waits, a child the pilot
 * adds after an approval among them, so that one waits for its own go; a
 * child started, settled, or put back in the backlog does not. Nothing waits
 * on a task worked by its agents, whatever its children.
 *
 * The answer goes to the task's pilot as a developer's message does, which
 * wakes it: its pilot not archived (`pilot` on its summary), the newest where more
 * than one stands, since Continue archives the pilot it takes over from.
 * Its words open on a line the pilot's instructions know it by, then name
 * each child task the answer is about as the task's chip, so the pilot reads
 * which by id: an approval asks it to start them, and a request for changes
 * hands it the developer's note and asks it to ask again. An answer sent
 * stands in the buttons' place while the pilot works on it: until the turn
 * it opened has ended, or until a child the answer did not name waits too.
 */

import type { AgentSummary } from "@luke/features/agent-wire";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@luke/features/mention-link";
import { TASK_MODE, TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import { agentStillWriting } from "./agent-model.js";

/** The line each answer opens on, which the pilot's instructions recognize it by. */
const BREAKDOWN_ANSWER_OPENING = {
  APPROVED: "Breakdown approved. Start these child tasks:",
  CHANGES_REQUESTED:
    "Breakdown changes requested. Revise these child tasks, then ask me to approve the breakdown again:",
} as const;

/** What heads the developer's note in a request for changes. */
const NOTE_HEAD = "My note:";

/** Each child task as a line of a Markdown list, by its chip. */
function childLines(children: readonly TaskSummary[], place: MentionPlace): string {
  return children
    .map(
      (child) =>
        `- ${mentionMarkdown({ kind: MENTION_KIND.TASK, taskId: child.id }, child.name, place)}`,
    )
    .join("\n");
}

/**
 * The child tasks of `task` waiting for the developer's go, in the order the
 * pilot made them: todo, with no agent. None for a task not worked by a pilot.
 */
export function waitingChildTasks(
  task: Pick<TaskSummary, "id" | "mode">,
  tasks: readonly TaskSummary[],
): readonly TaskSummary[] {
  if (task.mode !== TASK_MODE.PILOT) return [];
  return tasks
    .filter(
      (each) =>
        each.parentTaskId === task.id &&
        each.status === TASK_STATUS.TODO &&
        (each.agents?.total ?? 0) === 0,
    )
    .toSorted(
      (a, b) =>
        (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt - b.createdAt,
    );
}

/** The agent a pilot task's answer goes to: its newest pilot not archived; none while the task's agents are unread or no pilot stands. */
export function taskPilot(agents: readonly AgentSummary[] | undefined): AgentSummary | undefined {
  return (agents ?? [])
    .filter((agent) => agent.pilot === true && agent.archivedAt === undefined)
    .reduce<AgentSummary | undefined>(
      (newest, agent) =>
        newest === undefined || agent.createdAt > newest.createdAt ? agent : newest,
      undefined,
    );
}

/** An answer the developer sent a pilot: to which agent, at which of its turns, whether that turn still ran, and about which child tasks. */
export interface BreakdownAnswer {
  readonly agentId: string;
  /** The pilot's newest turn as the answer was sent. */
  readonly turnId: string | null;
  /** Whether the pilot was still writing as the answer was sent, which then steered that turn rather than opening one. */
  readonly steered: boolean;
  readonly children: readonly string[];
}

/**
 * Whether `answer` still stands for the breakdown as it waits now: sent to
 * the pilot that stands, about every child that waits, and the pilot not yet
 * through the turn that hears it. That turn is the one running as it was
 * sent, where it steered one, so it stands while the pilot writes; else the
 * one it opens, so it stands too while the turn is still the one it was sent
 * at, since a message waiting on its turn leaves the turn as it was.
 */
export function answerStands(
  answer: BreakdownAnswer | undefined,
  pilot: AgentSummary | undefined,
  waiting: readonly TaskSummary[],
): boolean {
  if (answer === undefined || pilot === undefined || pilot.id !== answer.agentId) return false;
  if (waiting.some((child) => !answer.children.includes(child.id))) return false;
  if (agentStillWriting(pilot.status)) return true;
  return !answer.steered && pilot.turnId === answer.turnId;
}

/** What the pilot is told when the developer approves `children`. */
export function approvalWords(children: readonly TaskSummary[], place: MentionPlace): string {
  return `${BREAKDOWN_ANSWER_OPENING.APPROVED}\n\n${childLines(children, place)}`;
}

/** What the pilot is told when the developer asks for changes to `children`, with their note. */
export function changesWords(
  children: readonly TaskSummary[],
  note: string,
  place: MentionPlace,
): string {
  return `${BREAKDOWN_ANSWER_OPENING.CHANGES_REQUESTED}\n\n${childLines(children, place)}\n\n${NOTE_HEAD}\n\n${note.trim()}`;
}
