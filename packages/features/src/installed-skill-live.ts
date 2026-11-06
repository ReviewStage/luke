import { Schema as EffectSchema } from "effect";
import type { InstalledSkillSummary } from "./installed-skill-route-wire.js";
import {
  INSTALLED_SKILL_SCOPE,
  installedSkillScopeSchema,
  installedSkillSourceSchema,
} from "./installed-skill-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

export const installedSkillsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ skills: sealedLiveQuerySchema }),
});

export type InstalledSkillsLiveAnswer = typeof installedSkillsLiveAnswerSchema.Type;

const installedSkillLiveRowSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  scope: installedSkillScopeSchema,
  name: EffectSchema.String,
  description: EffectSchema.String,
  userInvocable: EffectSchema.Boolean,
  source: installedSkillSourceSchema,
  enabled: EffectSchema.Literal(true),
  workspaceId: EffectSchema.NullOr(EffectSchema.String),
  installedBy: EffectSchema.NullOr(EffectSchema.String),
  manageable: EffectSchema.Boolean,
  createdAt: countedNumber,
  updatedAt: countedNumber,
});

export type InstalledSkillLiveRow = typeof installedSkillLiveRowSchema.Type;

export const installedSkillsLiveRowsSchema = EffectSchema.Struct({
  skills: EffectSchema.Array(installedSkillLiveRowSchema),
});

function workspaceFirst(a: InstalledSkillLiveRow, b: InstalledSkillLiveRow): number {
  const rank = (row: InstalledSkillLiveRow) =>
    row.scope === INSTALLED_SKILL_SCOPE.WORKSPACE ? 0 : 1;
  return (
    rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1)
  );
}

export function installedSkillsOfLiveRows(
  rows: readonly InstalledSkillLiveRow[],
): readonly InstalledSkillSummary[] {
  return rows.toSorted(workspaceFirst).map(({ workspaceId, ...row }) => ({
    ...row,
    ...(workspaceId === null ? undefined : { workspaceId }),
  }));
}
