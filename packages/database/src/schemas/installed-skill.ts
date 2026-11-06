import {
  INSTALLED_SKILL_BOUNDS,
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_SCOPE,
  type InstalledSkillScope,
  type InstalledSkillSource,
} from "@repo/features/installed-skill-wire";
import { sql } from "drizzle-orm";
import { boolean, check, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, updatedAt } from "./_helpers.js";
import { organization, user } from "./auth.js";

const literal = (value: string) => sql.raw(`'${value}'`);
const bound = (bytes: number) => sql.raw(String(bytes));

const MAX_MAIN_FILE_BYTES = 64 * 1024;

export const installedSkill = pgTable(
  "installed_skill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    installedByUserId: text("installed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    scope: text("scope").$type<InstalledSkillScope>().notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    userInvocable: boolean("user_invocable").notNull().default(true),
    source: jsonb("source").$type<InstalledSkillSource>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("installed_skill_personal_name")
      .on(table.ownerUserId, table.name)
      .where(sql`${table.scope} = ${literal(INSTALLED_SKILL_SCOPE.PERSONAL)}`),
    uniqueIndex("installed_skill_workspace_name")
      .on(table.organizationId, table.name)
      .where(sql`${table.scope} = ${literal(INSTALLED_SKILL_SCOPE.WORKSPACE)}`),
    check(
      "installed_skill_scope_owner",
      sql`(${table.scope} = ${literal(INSTALLED_SKILL_SCOPE.PERSONAL)} and ${table.ownerUserId} is not null and ${table.organizationId} is null) or (${table.scope} = ${literal(INSTALLED_SKILL_SCOPE.WORKSPACE)} and ${table.organizationId} is not null and ${table.ownerUserId} is null)`,
    ),
    check(
      "installed_skill_name_rule",
      sql`char_length(${table.name}) <= 64 and ${table.name} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
  ],
);

export const installedSkillFile = pgTable(
  "installed_skill_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => installedSkill.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    bytes: bytea("bytes").notNull(),
  },
  (table) => [
    uniqueIndex("installed_skill_file_path").on(table.skillId, table.path),
    check(
      "installed_skill_file_relative",
      sql`${table.path} <> '' and left(${table.path}, 1) <> '/' and ${table.path} !~ '(^|/)\\.\\.?(/|$)' and position(chr(92) in ${table.path}) = 0`,
    ),
    check(
      "installed_skill_file_bytes_bound",
      sql`octet_length(${table.bytes}) <= ${bound(INSTALLED_SKILL_BOUNDS.MAX_FILE_BYTES)} and (${table.path} <> ${literal(INSTALLED_SKILL_MAIN_FILE)} or octet_length(${table.bytes}) <= ${bound(MAX_MAIN_FILE_BYTES)})`,
    ),
  ],
);
