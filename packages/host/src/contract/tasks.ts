/**
 * tasks.ts -- the Tasks tab's asks of the host about the task list, the open task, and what a task holds, as procedures.
 *
 * A kind that carries nothing takes `undefined` alone, so a window calls it
 * with no payload and one sent anything is refused, as `app:act` refused it.
 * Each output is its value's schema flipped, so oRPC's output check encodes
 * the row's value into what crosses the port; a write that answers whether
 * the service took it answers a boolean, and one the panel reads nothing of
 * answers `void`.
 */

import { codingAgentMessagesAnswerViewSchema } from "@luke/features/coding-agent-view";
import {
  codeLinesSchema,
  tasksArchiveParamsSchema,
  tasksBoardSaveParamsSchema,
  tasksCommentActParamsSchema,
  tasksCommentAnswerSchema,
  tasksCommentStartParamsSchema,
  tasksCommentsAnswerSchema,
  tasksCommentsParamsSchema,
  tasksEditAnswerSchema,
  tasksEditParamsSchema,
  tasksFileAnswerSchema,
  tasksFileParamsSchema,
  tasksIssueParamsSchema,
  tasksIssueSchema,
  tasksMessagesParamsSchema,
  tasksMoveAnswerSchema,
  tasksMoveParamsSchema,
  tasksPageParamsSchema,
  tasksPageSourceAnswerSchema,
  tasksPagesAnswerSchema,
  tasksPagesParamsSchema,
  tasksPictureAnswerSchema,
  tasksPictureKeepAnswerSchema,
  tasksPictureKeepParamsSchema,
  tasksPictureParamsSchema,
  tasksPinParamsSchema,
  tasksPinRepositoryParamsSchema,
  tasksPullRequestParamsSchema,
  tasksPullRequestSchema,
  tasksRenameParamsSchema,
  tasksRepositoriesAnswerSchema,
  tasksRepositoriesParamsSchema,
  tasksRevisionAnswerSchema,
  tasksRevisionParamsSchema,
  tasksRevisionsAnswerSchema,
  tasksRevisionsParamsSchema,
  tasksSetRepositoryAnswerSchema,
  tasksSetRepositoryParamsSchema,
  tasksSetStandingParamsSchema,
  tasksSkillsAnswerSchema,
  tasksSkillsParamsSchema,
  tasksStartAnswerSchema,
  tasksStartRequestSchema,
  tasksTreeAnswerSchema,
  tasksTreeParamsSchema,
  tasksWriteSectionParamsSchema,
} from "@luke/features/tasks-view";
import { Schema as EffectSchema } from "effect";
import {
  COLOURED_CODE_MAX_CHARS,
  exactId,
  FENCE_LANGUAGE_MAX_CHARS,
  githubAddress,
  webAddress,
} from "../acts.js";
import { actProcedure, exactInput } from "./base.js";
import { TASKS_ACT_KIND } from "./kinds.js";

const takesNothing = exactInput(EffectSchema.Undefined);
const takesTaskId = exactInput(EffectSchema.Struct({ taskId: exactId }));

/** A text admitted as written, refused where it carries nothing or runs past `max`. */
function exactText(max: number) {
  return EffectSchema.String.check(
    EffectSchema.makeFilter((value) => value.trim().length > 0),
    EffectSchema.isMaxLength(max),
  );
}

/** A fenced block to colour: its fence's language and its code, each bounded. */
const colourCodeParamsSchema = EffectSchema.Struct({
  language: exactText(FENCE_LANGUAGE_MAX_CHARS),
  code: exactText(COLOURED_CODE_MAX_CHARS),
});

export const tasksActsContract = {
  [TASKS_ACT_KIND.TASKS_REFRESH]: actProcedure("Could not read your tasks on this system.")
    .input(takesNothing)
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.TASKS_SELECT]: actProcedure("Could not open that task on this system.")
    .input(takesTaskId)
    .output(EffectSchema.Boolean),
  [TASKS_ACT_KIND.TASKS_CLOSE]: actProcedure("Could not leave that task on this system.")
    .input(takesNothing)
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.TASKS_START]: actProcedure("Could not start that task on this system.")
    .input(exactInput(tasksStartRequestSchema))
    .output(EffectSchema.flip(tasksStartAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_DELETE]: actProcedure("Could not delete that task on this system.")
    .input(takesTaskId)
    .output(EffectSchema.Boolean),
  [TASKS_ACT_KIND.TASKS_RENAME]: actProcedure("Could not rename that task on this system.")
    .input(exactInput(tasksRenameParamsSchema))
    .output(EffectSchema.Boolean),
  [TASKS_ACT_KIND.TASKS_PIN]: actProcedure("Could not pin that task on this system.")
    .input(exactInput(tasksPinParamsSchema))
    .output(EffectSchema.Boolean),
  [TASKS_ACT_KIND.TASKS_PIN_REPOSITORY]: actProcedure(
    "Could not pin that repository on this system.",
  )
    .input(exactInput(tasksPinRepositoryParamsSchema))
    .output(EffectSchema.Boolean),
  [TASKS_ACT_KIND.TASKS_WRITE_SECTION]: actProcedure(
    "Could not change that section on this system.",
  )
    .input(exactInput(tasksWriteSectionParamsSchema))
    .output(EffectSchema.Boolean),
  [TASKS_ACT_KIND.TASKS_ARCHIVE]: actProcedure("Could not archive that task on this system.")
    .input(exactInput(tasksArchiveParamsSchema))
    .output(EffectSchema.Boolean),
  [TASKS_ACT_KIND.TASKS_REPOSITORIES]: actProcedure(
    "Could not read your GitHub repositories on this system.",
  )
    .input(exactInput(tasksRepositoriesParamsSchema))
    .output(EffectSchema.flip(tasksRepositoriesAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_SET_REPOSITORY]: actProcedure(
    "Could not change that task's repository on this system.",
  )
    .input(exactInput(tasksSetRepositoryParamsSchema))
    .output(EffectSchema.flip(tasksSetRepositoryAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_MOVE]: actProcedure("Could not move that task on this system.")
    .input(exactInput(tasksMoveParamsSchema))
    .output(EffectSchema.flip(tasksMoveAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_EDIT]: actProcedure("Could not save that edit on this system.")
    .input(exactInput(tasksEditParamsSchema))
    .output(EffectSchema.flip(tasksEditAnswerSchema)),
  [TASKS_ACT_KIND.GITHUB_OPEN]: actProcedure("Could not open GitHub on this system.")
    .input(exactInput(EffectSchema.Struct({ url: githubAddress })))
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.WEB_OPEN]: actProcedure("Could not open that link on this system.")
    .input(exactInput(EffectSchema.Struct({ url: webAddress })))
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.GITHUB_CONNECT]: actProcedure(
    "Could not open GitHub's connection page on this system.",
  )
    .input(takesNothing)
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.GITHUB_DISCONNECT]: actProcedure("Could not disconnect GitHub on this system.")
    .input(takesNothing)
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.TASKS_TALK]: actProcedure("Could not talk about that task on this system.")
    .input(takesNothing)
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.TASKS_BOARD_SAVE]: actProcedure("Could not save the board on this system.")
    .input(exactInput(tasksBoardSaveParamsSchema))
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.TASKS_SET_STANDING]: actProcedure(
    "Could not change where that task stands on this system.",
  )
    .input(exactInput(tasksSetStandingParamsSchema))
    .output(EffectSchema.Boolean),
  [TASKS_ACT_KIND.TASKS_WORK_EARLIER]: actProcedure(
    "Could not read that task's earlier work on this system.",
  )
    .input(takesNothing)
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.TASKS_CONVERSATION_EARLIER]: actProcedure(
    "Could not read that task's earlier conversation on this system.",
  )
    .input(takesNothing)
    .output(EffectSchema.Void),
  [TASKS_ACT_KIND.TASKS_MESSAGES]: actProcedure(
    "Could not read that task's conversation on this system.",
  )
    .input(exactInput(tasksMessagesParamsSchema))
    .output(EffectSchema.flip(codingAgentMessagesAnswerViewSchema)),
  [TASKS_ACT_KIND.TASKS_FILE]: actProcedure("Could not read that file on this system.")
    .input(exactInput(tasksFileParamsSchema))
    .output(EffectSchema.flip(tasksFileAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_TREE]: actProcedure("Could not list that folder on this system.")
    .input(exactInput(tasksTreeParamsSchema))
    .output(EffectSchema.flip(tasksTreeAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_SKILLS]: actProcedure(
    "Could not read this repository's skills on this system.",
  )
    .input(exactInput(tasksSkillsParamsSchema))
    .output(EffectSchema.flip(tasksSkillsAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_PULL_REQUEST]: actProcedure(
    "Could not read that pull request on this system.",
  )
    .input(exactInput(tasksPullRequestParamsSchema))
    .output(EffectSchema.flip(tasksPullRequestSchema)),
  [TASKS_ACT_KIND.TASKS_ISSUE]: actProcedure("Could not read that issue on this system.")
    .input(exactInput(tasksIssueParamsSchema))
    .output(EffectSchema.flip(tasksIssueSchema)),
  [TASKS_ACT_KIND.TASKS_COLOUR_CODE]: actProcedure("Could not colour that code on this system.")
    .input(exactInput(colourCodeParamsSchema))
    .output(EffectSchema.flip(codeLinesSchema)),
  [TASKS_ACT_KIND.TASKS_REVISIONS]: actProcedure(
    "Could not read that plan's history on this system.",
  )
    .input(exactInput(tasksRevisionsParamsSchema))
    .output(EffectSchema.flip(tasksRevisionsAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_REVISION]: actProcedure("Could not read that version on this system.")
    .input(exactInput(tasksRevisionParamsSchema))
    .output(EffectSchema.flip(tasksRevisionAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_RESTORE]: actProcedure("Could not restore that version on this system.")
    .input(exactInput(tasksRevisionParamsSchema))
    .output(EffectSchema.Boolean),
  [TASKS_ACT_KIND.TASKS_PAGE_SOURCE]: actProcedure(
    "Could not read that page's source on this system.",
  )
    .input(exactInput(tasksPageParamsSchema))
    .output(EffectSchema.flip(tasksPageSourceAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_PAGES]: actProcedure("Could not read that plan's pages on this system.")
    .input(exactInput(tasksPagesParamsSchema))
    .output(EffectSchema.flip(tasksPagesAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_PICTURE_READ]: actProcedure("Could not read that picture on this system.")
    .input(exactInput(tasksPictureParamsSchema))
    .output(EffectSchema.flip(tasksPictureAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_PICTURE_KEEP]: actProcedure("Could not keep that picture on this system.")
    .input(exactInput(tasksPictureKeepParamsSchema))
    .output(EffectSchema.flip(tasksPictureKeepAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_COMMENTS]: actProcedure(
    "Could not read the task's comments on this system.",
  )
    .input(exactInput(tasksCommentsParamsSchema))
    .output(EffectSchema.flip(tasksCommentsAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_COMMENT_START]: actProcedure(
    "Could not comment on the task on this system.",
  )
    .input(exactInput(tasksCommentStartParamsSchema))
    .output(EffectSchema.flip(tasksCommentAnswerSchema)),
  [TASKS_ACT_KIND.TASKS_COMMENT_ACT]: actProcedure(
    "Could not change the task's comment on this system.",
  )
    .input(exactInput(tasksCommentActParamsSchema))
    .output(EffectSchema.flip(tasksCommentAnswerSchema)),
};
