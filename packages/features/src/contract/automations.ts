/**
 * automations.ts -- the account's automations (`automation-wire.ts`), as procedures: list and make them, read, change and delete one, run one now, and read its runs.
 *
 * Every output is its wire schema flipped, so oRPC's output check encodes
 * the handler's value into the bytes the wire carries
 * (`packages/service/src/orpc/base.ts`). A body refuses a key it does not
 * name (`exactInput`, `exactBodyInput`), as the old group's read did; the
 * list's query does not, as it did not. A path's id beside a body is read
 * apart from it (`inputStructure: "detailed"`), so a change is the keys it
 * was sent with. A path's id is any segment, since one that is no UUID
 * names no automation and is answered as not found, not as malformed. "Run
 * now" answers 201 for the run it made and 200 for one its key already
 * made, so its output is detailed.
 *
 * Note that the webhook address (`/api/automations/{id}/webhook`) is no
 * procedure here: its caller is a third party's sender, and it stays the
 * route group it is (`automation-webhook-app.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  AUTOMATION_BOUNDS,
  AUTOMATION_LIST_QUERY,
  automationAnswerSchema,
  automationChangeRequestSchema,
  automationCreateRequestSchema,
  automationListAnswerSchema,
  automationRunAnswerSchema,
  automationRunRequestSchema,
  automationRunsAnswerSchema,
} from "../automation-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactBodyInput, exactInput, hostedProcedure } from "./base.js";

/**
 * A body past this is no automation: the prompt's bound at six bytes a
 * character, which is the most JSON spends on one (`\u0000`), and the rest of
 * the frame with room, so every prompt the schema takes fits.
 */
const BODY_BYTES = AUTOMATION_BOUNDS.MAX_PROMPT_CHARS * 6 + 16_384;

/** A "Run now" body past this carries more than its key. */
const RUN_BODY_BYTES = AUTOMATION_BOUNDS.MAX_KEY_CHARS * 4 + 64;

/** One automation, by the id its path names. */
const AUTOMATION_PATH = `${HOSTED_SERVICE_PATH.AUTOMATIONS}/{id}` as const;

/** The path's id, as the router reads it from the public path. */
const pathId = { id: EffectSchema.String };

/** The statuses a success answers with: a read or a write that made nothing, and one that made a row. */
const SUCCESS_STATUS = { OK: 200, CREATED: 201 } as const;

/** The list's query: one task's or one workspace's automations, or every one the account reads. */
const automationListQuerySchema = EffectSchema.Struct({
  [AUTOMATION_LIST_QUERY.TASK_ID]: EffectSchema.optionalKey(
    automationCreateRequestSchema.fields.planId.schema,
  ),
  [AUTOMATION_LIST_QUERY.WORKSPACE_ID]: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
});

export const automationsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.AUTOMATIONS }))
    .input(automationListQuerySchema)
    .output(EffectSchema.flip(automationListAnswerSchema)),
  create: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.AUTOMATIONS,
        successStatus: SUCCESS_STATUS.CREATED,
      }),
    )
    .input(exactInput(automationCreateRequestSchema))
    .output(EffectSchema.flip(automationAnswerSchema)),
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: AUTOMATION_PATH }))
    .input(EffectSchema.Struct(pathId))
    .output(EffectSchema.flip(automationAnswerSchema)),
  change: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: AUTOMATION_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(pathId), automationChangeRequestSchema))
    .output(EffectSchema.flip(automationAnswerSchema)),
  remove: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: AUTOMATION_PATH }))
    .input(EffectSchema.Struct(pathId))
    .output(EffectSchema.flip(EffectSchema.Struct({}))),
  run: hostedProcedure
    .meta(bodyCap(RUN_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${AUTOMATION_PATH}/run` as const,
        inputStructure: "detailed",
        outputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(EffectSchema.Struct(pathId), automationRunRequestSchema))
    .output(
      EffectSchema.flip(
        EffectSchema.Struct({
          /** 201 for the run this call made, 200 for the one its key already made. */
          status: EffectSchema.Literals([SUCCESS_STATUS.OK, SUCCESS_STATUS.CREATED]),
          body: automationRunAnswerSchema,
        }),
      ),
    ),
  runs: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${AUTOMATION_PATH}/runs` as const }))
    .input(EffectSchema.Struct(pathId))
    .output(EffectSchema.flip(automationRunsAnswerSchema)),
};
