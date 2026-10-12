import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import { Effect, Option, Schema } from "effect";
import { ACTION_RESULT_STATUS } from "../../core.js";
import type { PlanDocumentBinding } from "../plan-notes.js";
import { type PlanStoreEffect, readPlan } from "../plan-store.js";
import { EDIT_PLAN_TOOL } from "./plan-edit.js";

/**
 * plan-read.ts -- the coding agent's `read_plan` tool: the agent's plan whole, as it stands now.
 *
 * A rollout's worker is handed one pull request cut from the plan
 * (`brief.ts`), not the plan, and the plan moves under it: the developer
 * plans on, and the other workers take notes on it with `edit_plan`. This
 * reads the plan as Copy spells it (`@sidecar/hosted/plan-markdown`), so
 * the worker can read why a choice was made or what an interface another
 * pull request names says, and can see the saved text a note of its own
 * must quote. The read changes nothing and opens no sandbox. An agent handed
 * a task never saw the plan, so it is refused here as `edit_plan` refuses it.
 */

/** The tool as a coding agent is offered it: its name, its words, and an input that asks for nothing. */
export const READ_PLAN_TOOL = {
  name: "read_plan",
  description:
    "Read the whole plan this conversation implements, as it stands now, as Markdown. The plan " +
    "may have changed since you were handed your first message: the developer plans on, and " +
    `other coding agents take notes on it. Read it before you take a note with ${EDIT_PLAN_TOOL.name}, ` +
    "since a correction quotes the saved text exactly, and whenever you need what your first " +
    "message does not carry.",
  inputSchema: Schema.Struct({}),
} as const;

/** Why a call read nothing, in the words the model reads. */
export const PLAN_READ_REFUSAL = {
  UNAVAILABLE: "Not read: the service could not reach its store.",
  NO_PLAN:
    "Not read: you were handed a task rather than the plan, so there is no plan of yours to read.",
  GONE: "Not read: the plan this conversation implements no longer exists.",
} as const;

/** What a call answers, as the model and the authored file read it: the plan as Markdown, or why nothing was read. */
export type PlanReadResult =
  | { readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED; readonly plan: string }
  | { readonly status: typeof ACTION_RESULT_STATUS.REJECTED; readonly reason: string };

export function planReadRejected(reason: string): PlanReadResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** Runs one call: the plan the binding names as Markdown, or the refusal for a plan no longer there. */
export function readAgentPlan(binding: PlanDocumentBinding): PlanStoreEffect<PlanReadResult> {
  return Effect.map(
    readPlan(binding.userId, binding.planId),
    Option.match({
      onNone: () => planReadRejected(PLAN_READ_REFUSAL.GONE),
      onSome: (stored): PlanReadResult => ({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        plan: planMarkdown(stored.plan),
      }),
    }),
  );
}
