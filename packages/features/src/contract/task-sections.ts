/**
 * task-sections.ts -- the sections the account made in its sidebars and the tasks in them (`task-section-wire.ts`): read them, and write one change.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { taskSectionsAnswerSchema, taskSectionWriteSchema } from "../task-section-wire.js";
import { exactInput, hostedProcedure } from "./base.js";

export const taskSectionsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.TASK_SECTIONS }))
    .output(EffectSchema.flip(taskSectionsAnswerSchema)),
  write: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.TASK_SECTIONS }))
    .input(exactInput(taskSectionWriteSchema))
    .output(EffectSchema.flip(taskSectionsAnswerSchema)),
};
