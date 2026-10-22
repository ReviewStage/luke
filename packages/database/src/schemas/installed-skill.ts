import {
  INSTALLED_SKILL_BOUNDS,
  INSTALLED_SKILL_MAIN_FILE,
  INSTALLED_SKILL_SCOPE,
  type InstalledSkillScope,
  type InstalledSkillSource,
} from "@luke/features/installed-skill-wire";
import { sql } from "drizzle-orm";
import { boolean, check, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, updatedAt } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * installed-skill.ts -- the agent skills members install into Luke, personal or their workspace's, and each one's files.
 *
 * A skill is its installer's (`user_id`) and stands in one of two scopes: a
 * personal skill names no workspace, so it follows its installer into
 * every workspace they are a member of, and a workspace skill names the
 * workspace whose every member's agents are offered it; a check holds the
 * two columns to agree. A name is the repository skills' rule (lowercase
 * letters and digits in words joined by single hyphens, at most 64), held
 * once per owner: one personal skill of a name per account, one workspace
 * skill of a name per workspace. `source` says where the files came from,
 * and `computed_hash` is the SHA-256 the store computes over every file's
 * path and hash, so a source read again is known changed or not. `enabled`
 * false keeps it installed and offers it to no agent. The rows go with
 * their installer's account and with their workspace alike.
 */

const literal = (value: string) => sql.raw(`'${value}'`);
const bound = (bytes: number) => sql.raw(String(bytes));

/** The largest `SKILL.md` a skill holds, as a repository's skill is read: 64 KB. */
const MAX_MAIN_FILE_BYTES = 64 * 1024;

export const installedSkill = pgTable(
  "installed_skill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The member who installed it, whose a personal skill is. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The workspace a workspace skill is offered in; null for a personal skill. */
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    scope: text("scope").$type<InstalledSkillScope>().notNull(),
    name: text("name").notNull(),
    /** What the skill is for, which a model routes on: its frontmatter's `description`. */
    description: text("description").notNull(),
    /** Whether a member may pick it by name; a frontmatter's `user-invocable: false` says not. */
    userInvocable: boolean("user_invocable").notNull().default(true),
    /** Where its files came from, such as `{type: "github", owner, repo, path, ref, sha}`. */
    source: jsonb("source").$type<InstalledSkillSource>().notNull(),
    /** The hex SHA-256 over its files' paths and hashes, in path order. */
    computedHash: text("computed_hash").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One personal skill of a name per account; its list is read by the account.
    uniqueIndex("installed_skill_personal_name")
      .on(table.userId, table.name)
      .where(sql`${table.scope} = ${literal(INSTALLED_SKILL_SCOPE.PERSONAL)}`),
    // One workspace skill of a name per workspace; its list is read by the workspace.
    uniqueIndex("installed_skill_workspace_name")
      .on(table.organizationId, table.name)
      .where(sql`${table.scope} = ${literal(INSTALLED_SKILL_SCOPE.WORKSPACE)}`),
    // A personal skill names no workspace and a workspace skill names one.
    check(
      "installed_skill_scope_workspace",
      sql`(${table.scope} = ${literal(INSTALLED_SKILL_SCOPE.PERSONAL)} and ${table.organizationId} is null) or (${table.scope} = ${literal(INSTALLED_SKILL_SCOPE.WORKSPACE)} and ${table.organizationId} is not null)`,
    ),
    // The repository skills' rule for a name.
    check(
      "installed_skill_name_rule",
      sql`char_length(${table.name}) <= 64 and ${table.name} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
  ],
);

/**
 * One file of an installed skill, by its path from the skill's folder,
 * `SKILL.md` among them, its bytes kept here since this deployment keeps no
 * blob store. A path is relative and climbs out of no folder. Each file is
 * held to the skill's whole bound and `SKILL.md` to a repository's; how
 * many a skill holds and how many bytes together are the store's to hold,
 * since a check reads one row. The rows go with their skill.
 */
export const installedSkillFile = pgTable(
  "installed_skill_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => installedSkill.id, { onDelete: "cascade" }),
    /** The file's path from the skill's folder, such as `SKILL.md` or `scripts/run.sh`. */
    path: text("path").notNull(),
    bytes: bytea("bytes").notNull(),
    /** The hex SHA-256 of `bytes`. */
    sha256: text("sha256").notNull(),
  },
  (table) => [
    // A skill holds a path once; its files are read by the skill.
    uniqueIndex("installed_skill_file_path").on(table.skillId, table.path),
    // Relative, and never climbing out of the skill's folder.
    check(
      "installed_skill_file_relative",
      sql`${table.path} <> '' and left(${table.path}, 1) <> '/' and ${table.path} !~ '(^|/)\\.\\.?(/|$)' and position(chr(92) in ${table.path}) = 0`,
    ),
    // No file larger than the skill's bound, and `SKILL.md` no larger than a repository's.
    check(
      "installed_skill_file_bytes_bound",
      sql`octet_length(${table.bytes}) <= ${bound(INSTALLED_SKILL_BOUNDS.MAX_TOTAL_BYTES)} and (${table.path} <> ${literal(INSTALLED_SKILL_MAIN_FILE)} or octet_length(${table.bytes}) <= ${bound(MAX_MAIN_FILE_BYTES)})`,
    ),
  ],
);
