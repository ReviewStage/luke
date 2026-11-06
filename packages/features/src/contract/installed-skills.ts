import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  INSTALLED_SKILL_LIST_QUERY,
  INSTALLED_SKILL_PASTE_MAX_CHARS,
  installedSkillContentSchema,
  installedSkillInstallAnswerSchema,
  installedSkillInstallRequestSchema,
  installedSkillListAnswerSchema,
  installedSkillPreviewRequestSchema,
  installedSkillPreviewSchema,
  installedSkillRemovedAnswerSchema,
} from "../installed-skill-route-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

const PASTE_BODY_BYTES = INSTALLED_SKILL_PASTE_MAX_CHARS * 6 + 16_384;

const SMALL_BODY_BYTES = 1_024;

const INSTALLED_SKILL_PATH = `${HOSTED_SERVICE_PATH.INSTALLED_SKILLS}/{id}` as const;

const pathId = { id: EffectSchema.String };

const CREATED_STATUS = 201;

export const installedSkillsContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.INSTALLED_SKILLS }))
    .input(
      EffectSchema.Struct({
        [INSTALLED_SKILL_LIST_QUERY.WORKSPACE_ID]: EffectSchema.NonEmptyString,
      }),
    )
    .output(EffectSchema.flip(installedSkillListAnswerSchema)),
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: INSTALLED_SKILL_PATH }))
    .input(EffectSchema.Struct(pathId))
    .output(EffectSchema.flip(installedSkillContentSchema)),
  preview: hostedProcedure
    .meta(bodyCap(PASTE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${HOSTED_SERVICE_PATH.INSTALLED_SKILLS}/preview` as const,
      }),
    )
    .input(exactInput(installedSkillPreviewRequestSchema))
    .output(EffectSchema.flip(installedSkillPreviewSchema)),
  install: hostedProcedure
    .meta(bodyCap(PASTE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.INSTALLED_SKILLS,
        successStatus: CREATED_STATUS,
      }),
    )
    .input(exactInput(installedSkillInstallRequestSchema))
    .output(EffectSchema.flip(installedSkillInstallAnswerSchema)),
  remove: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: INSTALLED_SKILL_PATH }))
    .input(EffectSchema.Struct(pathId))
    .output(EffectSchema.flip(installedSkillRemovedAnswerSchema)),
};
