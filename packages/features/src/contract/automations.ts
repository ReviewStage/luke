import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  AUTOMATION_BOUNDS,
  AUTOMATION_LIST_QUERY,
  automationAnswerSchema,
  automationChangeRequestSchema,
  automationCreateRequestSchema,
  automationDeletedAnswerSchema,
  automationListAnswerSchema,
  automationRunAnswerSchema,
  automationRunRequestSchema,
  automationRunsAnswerSchema,
} from "../automation-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactBodyInput, exactInput, hostedProcedure } from "./base.js";

const BODY_BYTES = AUTOMATION_BOUNDS.MAX_PROMPT_CHARS * 6 + 16_384;

const RUN_BODY_BYTES = AUTOMATION_BOUNDS.MAX_KEY_CHARS * 4 + 64;

const AUTOMATION_PATH = `${HOSTED_SERVICE_PATH.AUTOMATIONS}/{id}` as const;

const pathId = { id: EffectSchema.String };

const SUCCESS_STATUS = { OK: 200, CREATED: 201 } as const;

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
    .output(EffectSchema.flip(automationDeletedAnswerSchema)),
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
