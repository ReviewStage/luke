import {
  tasksIssueLinkAnswerSchema,
  tasksIssueLinkParamsSchema,
  tasksIssueLinksAnswerSchema,
  tasksIssueLinksParamsSchema,
  tasksIssueRelateAnswerSchema,
  tasksIssueRelateParamsSchema,
  tasksIssueUnlinkAnswerSchema,
  tasksIssueUnlinkParamsSchema,
} from "@luke/features/tasks-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { TASK_ISSUE_ACT_KIND } from "./kinds.js";

/**
 * task-issues.ts -- a task page's asks of the host about the issues the task links, as procedures.
 *
 * Each output is its view schema flipped, so oRPC's output check encodes
 * the service's answer, or why there is none, into what crosses the port.
 */
export const taskIssueActsContract = {
  [TASK_ISSUE_ACT_KIND.TASK_ISSUES_READ]: actProcedure(
    "Could not read the task's issues on this system.",
  )
    .input(exactInput(tasksIssueLinksParamsSchema))
    .output(EffectSchema.flip(tasksIssueLinksAnswerSchema)),
  [TASK_ISSUE_ACT_KIND.TASK_ISSUES_LINK]: actProcedure("Could not link that issue on this system.")
    .input(exactInput(tasksIssueLinkParamsSchema))
    .output(EffectSchema.flip(tasksIssueLinkAnswerSchema)),
  [TASK_ISSUE_ACT_KIND.TASK_ISSUES_RELATE]: actProcedure(
    "Could not change that issue's keyword on this system.",
  )
    .input(exactInput(tasksIssueRelateParamsSchema))
    .output(EffectSchema.flip(tasksIssueRelateAnswerSchema)),
  [TASK_ISSUE_ACT_KIND.TASK_ISSUES_UNLINK]: actProcedure(
    "Could not unlink that issue on this system.",
  )
    .input(exactInput(tasksIssueUnlinkParamsSchema))
    .output(EffectSchema.flip(tasksIssueUnlinkAnswerSchema)),
};
