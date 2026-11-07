import { Schema } from "effect";
import { refuses } from "./contract/base.js";
import type { InstalledSkillSummary } from "./installed-skill-route-wire.js";
import { installedSkillScopeSchema, installedSkillSourceSchema } from "./installed-skill-wire.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR, wireUuidSchema } from "./service-wire.js";

/**
 * installed-skill-live.ts -- the skills the account sees in one workspace as the host follows them over the service's held poll: the read declared, and the skills as Settings › Skills draws them.
 *
 * The service answers one statement, the workspace's skills while the
 * reader is a member of it and the reader's own personal ones, each with
 * whether the reader may manage it, worked out in the statement itself by
 * the store's own rule. The rows come in no order, so the reader orders
 * them as the list read answered them: the workspace's first, then the
 * reader's own, each by name.
 */

/**
 * The skills the account sees in one workspace as the host follows them:
 * one part, each skill with the workspace it is, null for a personal one,
 * and who installed it, null once that account is gone; the workspace's
 * first, then the reader's own, each by name, then by id. The service
 * answers `not-found` for a workspace the account is no member of.
 */
export const INSTALLED_SKILLS_READ = liveRead({
  name: LIVE_READ.INSTALLED_SKILLS,
  path: HOSTED_SERVICE_PATH.LIVE_INSTALLED_SKILLS,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER, workspaceId: LIVE_PARAM.TEXT },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    skills: liveRows({
      row: Schema.Struct({
        id: wireUuidSchema,
        scope: installedSkillScopeSchema,
        name: Schema.String,
        description: Schema.String,
        userInvocable: Schema.Boolean,
        source: installedSkillSourceSchema,
        /** Always true, since every installed skill is on. */
        enabled: Schema.Literal(true),
        workspaceId: Schema.NullOr(Schema.String),
        installedBy: Schema.NullOr(Schema.String),
        manageable: Schema.Boolean,
        createdAt: countedNumber,
        updatedAt: countedNumber,
      }),
      key: "id",
      // Note that `workspace` stands after `personal`, so descending puts the workspace's first.
      order: [
        ["scope", ORDER.DESC],
        ["name", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
  },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

export type InstalledSkillsLiveAnswer = LiveReadAnswer<typeof INSTALLED_SKILLS_READ>;

/** One skill as the statement delivers it. */
export type InstalledSkillLiveRow = LiveRowOf<typeof INSTALLED_SKILLS_READ.parts.skills>;

/** The skills as the held read answers them, the workspace's first, then the reader's own, each by name. */
export function installedSkillsOfLiveRows(
  rows: readonly InstalledSkillLiveRow[],
): readonly InstalledSkillSummary[] {
  return orderedLiveRows(INSTALLED_SKILLS_READ.parts.skills, rows).map(
    ({ workspaceId, ...row }) => ({
      ...row,
      ...(workspaceId === null ? undefined : { workspaceId }),
    }),
  );
}
