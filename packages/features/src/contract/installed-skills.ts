/**
 * installed-skills.ts -- the skills members install into the app (`installed-skill-route-wire.ts`), as procedures: list them, read one, preview a paste, install from it, and remove one.
 *
 * Every output is its wire schema flipped, so oRPC's output check encodes
 * the handler's value into the bytes the wire carries. A body refuses a key
 * it does not name (`exactInput`); a query does not. A
 * path's id is any segment, since one that is no UUID names no skill and is
 * answered as not found, not as malformed. An install answers 201 for the
 * skills it made.
 */

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

/**
 * A body past this is no paste: the paste's bound at six bytes a character,
 * which is the most JSON spends on one (`\u0000`), and the rest of the frame
 * with room for the names and description an install carries.
 */
const PASTE_BODY_BYTES = INSTALLED_SKILL_PASTE_MAX_CHARS * 6 + 16_384;

/** A removal carries nothing, so a body past this is none. */
const SMALL_BODY_BYTES = 1_024;

/** One installed skill, by the id its path names. */
const INSTALLED_SKILL_PATH = `${HOSTED_SERVICE_PATH.INSTALLED_SKILLS}/{id}` as const;

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
