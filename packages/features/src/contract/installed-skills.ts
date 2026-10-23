/**
 * installed-skills.ts -- the skills members install into Luke (`installed-skill-route-wire.ts`), as procedures: list them, preview a paste and read one of its skills' `SKILL.md`, install from it, turn one on or off, check it for an update or update it, and remove it.
 *
 * Every output is its wire schema flipped, so oRPC's output check encodes
 * the handler's value into the bytes the wire carries. A body refuses a key
 * it does not name (`exactInput`, `exactBodyInput`); a query does not. A
 * path's id is any segment, since one that is no UUID names no skill and is
 * answered as not found, not as malformed. An install answers 201 for the
 * skills it made.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  INSTALLED_SKILL_LIST_QUERY,
  INSTALLED_SKILL_PASTE_MAX_CHARS,
  INSTALLED_SKILL_UPDATE_QUERY,
  installedSkillAnswerSchema,
  installedSkillInstallAnswerSchema,
  installedSkillInstallRequestSchema,
  installedSkillListAnswerSchema,
  installedSkillPreviewFileRequestSchema,
  installedSkillPreviewFileSchema,
  installedSkillPreviewRequestSchema,
  installedSkillPreviewSchema,
  installedSkillRemovedAnswerSchema,
  installedSkillToggleRequestSchema,
  installedSkillUpdateCheckSchema,
  installedSkillUpdatedAnswerSchema,
  installedSkillUpdateRequestSchema,
} from "../installed-skill-route-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactBodyInput, exactInput, hostedProcedure } from "./base.js";

/**
 * A body past this is no paste: the paste's bound at six bytes a character,
 * which is the most JSON spends on one (`\u0000`), and the rest of the frame
 * with room for the names and description an install carries.
 */
const PASTE_BODY_BYTES = INSTALLED_SKILL_PASTE_MAX_CHARS * 6 + 16_384;

/** A toggle or an update carries a boolean or a workspace's id, so a body past this is neither. */
const SMALL_BODY_BYTES = 1_024;

/** A previewed skill's `SKILL.md` read names a repository, a commit, and a folder, so a body past this is none. */
const PREVIEW_FILE_BODY_BYTES = 8_192;

/** One installed skill, by the id its path names. */
const INSTALLED_SKILL_PATH = `${HOSTED_SERVICE_PATH.INSTALLED_SKILLS}/{id}` as const;

/** One skill's update: whether one is available (GET), or the update itself (POST). */
const INSTALLED_SKILL_UPDATE_PATH = `${INSTALLED_SKILL_PATH}/update` as const;

/** The path's id, as the router reads it from the public path. */
const pathId = { id: EffectSchema.String };

/** The status an install answers with, for the skills it made. */
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
  previewFile: hostedProcedure
    .meta(bodyCap(PREVIEW_FILE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${HOSTED_SERVICE_PATH.INSTALLED_SKILLS}/preview/file` as const,
      }),
    )
    .input(exactInput(installedSkillPreviewFileRequestSchema))
    .output(EffectSchema.flip(installedSkillPreviewFileSchema)),
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
  setEnabled: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.PATCH,
        path: INSTALLED_SKILL_PATH,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(EffectSchema.Struct(pathId), installedSkillToggleRequestSchema))
    .output(EffectSchema.flip(installedSkillAnswerSchema)),
  checkUpdate: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: INSTALLED_SKILL_UPDATE_PATH }))
    .input(
      EffectSchema.Struct({
        ...pathId,
        [INSTALLED_SKILL_UPDATE_QUERY.WORKSPACE_ID]: EffectSchema.NonEmptyString,
      }),
    )
    .output(EffectSchema.flip(installedSkillUpdateCheckSchema)),
  update: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: INSTALLED_SKILL_UPDATE_PATH,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(EffectSchema.Struct(pathId), installedSkillUpdateRequestSchema))
    .output(EffectSchema.flip(installedSkillUpdatedAnswerSchema)),
  remove: hostedProcedure
    .meta(bodyCap(SMALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: INSTALLED_SKILL_PATH }))
    .input(EffectSchema.Struct(pathId))
    .output(EffectSchema.flip(installedSkillRemovedAnswerSchema)),
};
