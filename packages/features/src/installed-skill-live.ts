import { Schema as EffectSchema } from "effect";
import type { InstalledSkillSummary } from "./installed-skill-route-wire.js";
import {
  INSTALLED_SKILL_SCOPE,
  installedSkillScopeSchema,
  installedSkillSourceSchema,
} from "./installed-skill-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * installed-skill-live.ts -- the skills the account sees in one workspace as the host follows them over the service's held poll: the statement the service answers, the rows it delivers, and the skills as Settings › Skills draws them.
 *
 * The service answers one statement, the workspace's skills while the
 * reader is a member of it and the reader's own personal ones, each with
 * whether the reader may manage it, worked out in the statement itself by
 * the store's own rule. The rows come in no order, so the reader orders
 * them as the list read answered them: the workspace's first, then the
 * reader's own, each by name.
 */

/** The skills the account sees in one workspace sealed for following: the address, and one statement. The service answers `not-found` for a workspace the account is no member of. */
export const installedSkillsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ skills: sealedLiveQuerySchema }),
});

export type InstalledSkillsLiveAnswer = typeof installedSkillsLiveAnswerSchema.Type;

/** One skill as the statement delivers it: the workspace it is, null for a personal one, and who installed it, null once that account is gone. */
const installedSkillLiveRowSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  scope: installedSkillScopeSchema,
  name: EffectSchema.String,
  description: EffectSchema.String,
  userInvocable: EffectSchema.Boolean,
  source: installedSkillSourceSchema,
  /** Always true, since every installed skill is on. */
  enabled: EffectSchema.Literal(true),
  workspaceId: EffectSchema.NullOr(EffectSchema.String),
  installedBy: EffectSchema.NullOr(EffectSchema.String),
  manageable: EffectSchema.Boolean,
  createdAt: countedNumber,
  updatedAt: countedNumber,
});

export type InstalledSkillLiveRow = typeof installedSkillLiveRowSchema.Type;

/** The skills as Realtime delivers them, decoded at the boundary before anything reads them. */
export const installedSkillsLiveRowsSchema = EffectSchema.Struct({
  skills: EffectSchema.Array(installedSkillLiveRowSchema),
});

/** The workspace's skills before the reader's own, then by name, then by id, so two alike keep one order. */
function workspaceFirst(a: InstalledSkillLiveRow, b: InstalledSkillLiveRow): number {
  const rank = (row: InstalledSkillLiveRow) =>
    row.scope === INSTALLED_SKILL_SCOPE.WORKSPACE ? 0 : 1;
  return (
    rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1)
  );
}

/** The skills as the held read answers them, the workspace's first, then the reader's own, each by name. */
export function installedSkillsOfLiveRows(
  rows: readonly InstalledSkillLiveRow[],
): readonly InstalledSkillSummary[] {
  return rows.toSorted(workspaceFirst).map(({ workspaceId, ...row }) => ({
    ...row,
    ...(workspaceId === null ? undefined : { workspaceId }),
  }));
}
