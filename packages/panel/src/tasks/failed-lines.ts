/**
 * failed-lines.ts -- the messages to agents that were not delivered and wait on the developer's Retry, Edit, or Delete, kept past their tab, so a tab opened again draws them where they went and the rows and tabs that lead to them say so.
 *
 * A message refused for now stays in its transcript where it went, marked as
 * not delivered, until the developer sends it again, takes it back into the
 * box, or deletes it, as a chat app keeps a message that did not go
 * (`use-agent-composer.ts`). Its tab is not the only place that knows: the
 * line is held here, for the account that sent it, as a description comment
 * refused is (`heldLines`), so a tab closed, or a task left, while the
 * refusal landed draws the line again on its return, and the task's row,
 * the agent's row, and its tab wear the failed mark in the draft pencil's
 * place while one waits (`draft-mark.tsx`). Note that each window holds
 * its own, so a relaunch lets them go.
 */

import type { Failure } from "@repo/features/failure-remedy";
import { useSelector } from "@tanstack/react-store";
import { Equal } from "effect";
import { heldLines } from "../composer-drafts.js";
import type { SentLine } from "./agent-model.js";

/** A message not delivered: the agent and task it went to, the line as it went, and why it did not go. */
export interface FailedLine {
  readonly agentId: string;
  /** The agent's task, whose row marks it; null for an agent with no task. */
  readonly taskId: string | null;
  readonly line: SentLine;
  /** Why it did not go, which its mark's menu is headed by, with the answer that said so. */
  readonly note: Failure & { readonly cause?: unknown };
}

/** Every message not delivered in this window, for the account signed in, in the order they failed. */
export const failedLines = heldLines<FailedLine>();

/** The agents holding a message not delivered. */
function failedAgents(all: readonly FailedLine[]): readonly string[] {
  return [...new Set(all.map((failed) => failed.agentId))];
}

/** The messages not delivered to `agentId`, in the order they failed. */
export function failedLinesOf(all: readonly FailedLine[], agentId: string): readonly FailedLine[] {
  return all.filter((failed) => failed.agentId === agentId);
}

/** The agents holding a message not delivered, which their tabs and rows mark, compared by their ids, so a tab draws again only as one comes or goes. */
export function useFailedAgents(): readonly string[] {
  return useSelector(failedLines.store, failedAgents, { compare: Equal.equals });
}

/** Whether a task holds a message not delivered to one of its agents, which its row marks. */
export function useTaskSendFailed(taskId: string): boolean {
  return useSelector(failedLines.store, (all) => all.some((failed) => failed.taskId === taskId));
}
