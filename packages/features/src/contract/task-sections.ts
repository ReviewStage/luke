/**
 * task-sections.ts -- the sections the account made in its sidebars and the tasks in them (`task-section-wire.ts`): read them, and write one change.
 *
 * A write goes through the write receipt (`writeReceiptMiddleware`), so it
 * declares a write sent again under its key as already written beyond the
 * refusals any procedure may answer (`declaredProcedure`); one the store will
 * not keep is refused as an invalid request, which any procedure may answer.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  taskSectionsAnswerSchema,
  taskSectionsWrittenSchema,
  taskSectionWriteSchema,
} from "../task-section-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A write is two ids, a title, and an emoji at most, so a body past this is not one. */
const WRITE_BODY_BYTES = 2_048;

export const taskSectionsContract = {
  list: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.TASK_SECTIONS }))
    .output(EffectSchema.flip(taskSectionsAnswerSchema)),
  write: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.ALREADY_WRITTEN))
    .meta(bodyCap(WRITE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.TASK_SECTIONS }))
    .input(exactInput(taskSectionWriteSchema))
    .output(EffectSchema.flip(taskSectionsWrittenSchema)),
};
