/**
 * tasks.ts -- the Tasks tab's asks of the host about the task list and the open task, as procedures.
 *
 * A kind that carries nothing takes `undefined` alone, so a window calls it
 * with no payload and one sent anything is refused, as `app:act` refused it.
 * Each output is its value's schema flipped, so oRPC's output check encodes
 * the row's value into what crosses the port; a write that answers whether
 * the service took it answers a boolean, and one the panel reads nothing of
 * answers `void`.
 */

import {
  tasksArchiveParamsSchema,
  tasksBoardSaveParamsSchema,
  tasksEditAnswerSchema,
  tasksEditParamsSchema,
  tasksMoveAnswerSchema,
  tasksMoveParamsSchema,
  tasksPinParamsSchema,
  tasksPinRepositoryParamsSchema,
  tasksRenameParamsSchema,
  tasksRepositoriesAnswerSchema,
  tasksRepositoriesParamsSchema,
  tasksSetRepositoryAnswerSchema,
  tasksSetRepositoryParamsSchema,
  tasksStartAnswerSchema,
  tasksStartRequestSchema,
  tasksWriteSectionParamsSchema,
} from "@luke/features/tasks-view";
import { Schema as EffectSchema } from "effect";
import { exactId, githubAddress, webAddress } from "../acts.js";
import { actProcedure, exactInput } from "./base.js";
import { TASKS_ACT_KIND } from "./kinds.js";

const takesNothing = exactInput(EffectSchema.Undefined);
const takesTaskId = exactInput(EffectSchema.Struct({ taskId: exactId }));

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
};
