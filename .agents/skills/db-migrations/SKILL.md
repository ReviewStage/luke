---
name: db-migrations
description: 'Use for Drizzle migration rollout, online indexes, backfills, idempotent SQL and migration regeneration or rebase conflicts.'
user-invocable: false
---

# Database Migrations Guide

## Schema conventions

Apply these before generating any migration — they change what the schema file looks like, not just the SQL.

- **No pg enums (and no fixed value sets) for growing domains.** For columns whose value set will keep expanding (resource types, statuses, providers, …), use a plain `text` column typed via `.$type<UnionType>()`. `pgEnum` requires an `ALTER TYPE ... ADD VALUE` migration for every new literal, and even the Drizzle `text('col', { enum: [...] })` option hardwires the value list into the schema file. With `.$type<>()`, onboarding a new value is a type-only change — no migration at all.

  ```ts
  // ✅ Good — type lives in @lobechat/types, column stays plain text
  resourceType: text('resource_type').$type<TransferResourceType>().notNull(),

  // ❌ Bad — pg enum, needs ALTER TYPE per new value
  resourceType: resourceTypeEnum('resource_type').notNull(),

  // ❌ Avoid — value list hardwired into the schema file
  resourceType: text('resource_type', { enum: TRANSFER_RESOURCE_TYPES }).notNull(),
  ```

- **Keep domain constants out of schema files.** In new or modified schema files under `packages/database/src/schemas/`, shared domain literal arrays, union types, and option interfaces belong in `@lobechat/types` (one module per domain, re-exported from its `index.ts`); both the schema (`.$type<>()`) and consumers (routers via `z.enum(...)`, services, UI) import from there. This rule targets domain constants only — table objects, inferred row types, Drizzle relation objects, and zod insert/select schemas (`insertAgentSchema`, …) are the schema file's job and stay put. Existing schema files that already export such constants (e.g. `resourcePermission.ts`) are grandfathered; migrate them opportunistically when the file is next touched, not in bulk.

- **Prefixed ids only for rows that are addressed one at a time.** An `idGenerator` prefix (`task_`, `cmt_`, `brf_`) earns its keep when the id turns up somewhere a person reads it — a URL segment, an API argument, a tool-call payload, a support ticket. A child table whose rows are only ever fetched in bulk for their parent takes a plain uuid instead, like `task_dependencies` / `task_documents` / `task_topics`; there the prefix costs a registry entry in `idGenerator.ts` and buys nothing back.

  ```ts
  // ✅ Addressed individually — deleteComment(commentId), /task/:id
  id: text('id')
    .primaryKey()
    .$defaultFn(() => idGenerator('taskComments'))
    .notNull(),

  // ✅ Only ever read in bulk for one parent
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  ```

- **Column order: identity → scope → the table's own columns → `visibility` → timestamps.** Put `id` and the parent FK first, then the ownership columns (`user_id`, `workspace_id`), then whatever this table is actually for, then `visibility`, then the `...timestamps` / `createdAt()` spread. A reader scanning an unfamiliar table then finds the same field in the same place. `visibility` sitting at the end is the deliberate slot, not an accident of history: of the 22 tables that carry the column today, 17 place it in the last three columns and **none** place it directly after `id`. A new table that hoists it to the front becomes the one outlier — if the placement is ever worth changing, change it repo-wide and update this rule, not one table at a time.

## Choose the rollout strategy

Classify every database change into one of these three rollout paths before generating or editing a migration.

### Expand, migrate, contract

A migration must never break the previous deployment's code. Every build runs `pnpm db:migrate` against the one shared database (`vercel.json`'s web `buildCommand`), while the deployment before it is still serving, and a coding agent's run (any Vercel Workflow run) keeps executing on the deployment it started on for up to 25 hours. So for a day after a build, code that still spells the old names runs against the schema the newest build already migrated. On Oct 17, `20261017014941_rename_plan_to_task` renamed `plan` to `task` in place, and every agent still on older code died at its next step with `relation "plan" does not exist`.

Change a name or shape that old code reads in steps, each in its own deployment. Each step waits until every run pinned to a deployment from before the previous step has drained, which is 25 hours after that step reached production. Keep the old name current for as long as anything may still read it, not just present:

1. **Expand.** Add the new table or column beside the old one. Ship code that writes both and still reads the old one. Backfill the new column with a script ("Data backfill" below), not in the migration, once the writers that knew only the old name have drained.
2. **Migrate.** Ship code that reads the new name and still writes both, because runs on the expand deployment still read the old one.
3. **Stop writing the old name.** Once the expand deployment's runs have drained, ship code that reads and writes only the new name.
4. **Contract.** Drop the old thing in a later migration, at least 25 hours after the code that stopped writing it reached production, since runs pinned to the deployment before it still write the old name. Mark that migration with the reason, on a line of its own:

   ```sql
   -- contract: nothing has read "plan_id" since #3700 reached production on Oct 18, over 25 hours ago
   ALTER TABLE "task" DROP COLUMN IF EXISTS "plan_id";
   ```

Two shortcuts skip the steps:

- When only the code's name for a column changes, rename the property and keep the column, since Drizzle maps a property to any column name (`taskId: text("plan_id")`).
- For a table rename, rename the table and create a view under the old name in the same migration, aliasing any renamed column back to its old name. Postgres lets old code read and write a single-table view with no join or aggregate as if it were the table, `INSERT … ON CONFLICT (columns) DO UPDATE` and `RETURNING` included, so nothing has to be kept in step. `ON CONFLICT ON CONSTRAINT <name>` fails through a view, because the constraint belongs to the table; Drizzle's `onConflictDoUpdate` names columns, so check that the old code does too. Mark that migration `-- contract: "plan" stays readable and writable as a view` and drop the view in a later contract step.

The same holds for any change that narrows what old code may do:

- `NOT NULL` without a default on a column old code inserts into, since old code's insert leaves it out.
- Narrowing a column's type.
- Dropping or renaming an enum value.
- Tightening a constraint old code may violate (a new `CHECK`, `UNIQUE`, or foreign key).

Expand first (a nullable column, a default, a `NOT VALID` constraint), ship the code that satisfies it, then tighten in a later migration.

`pnpm --filter @luke/database check:contractions` (run by `scripts/repository-checks.sh`, `packages/database/src/core/migration-contractions.ts`) refuses a new migration that renames a table, column, type, or view, or drops a table, column, type, or view, unless it carries the `-- contract:` marker. Renaming or dropping an index or constraint is not refused, because no statement the code runs names one. The narrowing changes in the list above are not checked: review is the check.

**Generating the expand step.** `drizzle-kit generate` asks "Is `<x>` created or renamed from another?" only when one table or column disappears from the schema modules and another appears in the same run. Without a TTY, such as in an agent's shell, it refuses with "Interactive prompts require a TTY". Its rename option writes the in-place `RENAME` this rule forbids. So for the expand step, keep the old property in the schema module and add the new one beside it: `pnpm db:generate --name=<table>_add_<column>` then writes only the `ADD COLUMN` (or `CREATE TABLE`) and asks nothing. For the contract step, delete the old property in a later change and generate again, which writes the `DROP` with no prompt. Then add the marker line to that `migration.sql`.

### Validate rollout assumptions on the actual Dev database

Do not choose a rollout path from hypothetical claims such as “this migration might be slow” or “installing these triggers could block deployment.” Before deciding that a schema change needs a manual production step, deferred installation, or a dedicated backfill, test the relevant operation against the project's actual Dev database.

- Classify the database target first using the project's approved database-access tooling; never read secret-bearing `.env` files directly.
- Measure the real operation or the closest safe equivalent, such as creating an identically defined probe index under a temporary name or installing temporary triggers inside a transaction that is rolled back.
- Record the tested SQL or operation, representative row count and table size, elapsed time, and cleanup verification.
- Keep probes reversible and remove every temporary database object after the measurement.
- Treat a single Dev result as evidence about the observed Dev scale, not proof of production behavior. State material differences in production scale, load, cache state, and lock contention explicitly, and label any resulting production claim as an inference.

Rollout decisions must combine repository deployment facts with these measurements. Do not add operational tables, delayed activation paths, or manual release steps solely to guard against unmeasured performance concerns.

### 1. Regular Drizzle migration

Use the normal Drizzle workflow for schema changes that are safe to execute during deployment, such as creating a small table or adding a nullable column:

1. Update the Drizzle schema.
2. Run `pnpm db:generate --name=<what_it_does>`.
3. Review and harden the generated artifacts using the steps below.

Before listing a manual migration command as a release step, inspect the target repository's build and deployment scripts. If its deployment pipeline already applies migrations automatically, do not require a redundant manual run.

### 2. Online index creation

Creating an index normally can block writes and queries on a large or frequently accessed table, and a long-running statement can also stall the deployment. In that case:

1. Before deploying the application, execute the index creation manually in the target database's SQL editor using `CONCURRENTLY`:

   ```sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "table_column_idx"
   ON "table" USING btree ("column");
   ```

2. Keep an idempotent, non-`CONCURRENTLY` version in the Drizzle migration:

   ```sql
   CREATE INDEX IF NOT EXISTS "table_column_idx"
   ON "table" USING btree ("column");
   ```

The manual online operation avoids blocking production traffic. When the deployment later runs the migration, `IF NOT EXISTS` makes the statement a no-op, while new or self-hosted databases can still converge through normal migration replay. Do not place `CREATE INDEX CONCURRENTLY` inside a transaction.

### 3. Data backfill

Backfills and historical-data reconciliation must run as dedicated, idempotent scripts rather than inside a Drizzle migration. Keep the schema change in Drizzle, but move row-by-row or batch data processing into a separate script so it does not block deployment.

Decide whether to run the script before or after the application deployment based on compatibility:

- Run it **before deployment** when the new code or a new constraint requires existing rows to be populated immediately.
- Run it **after deployment** when the application safely handles both old and new row shapes and the backfill can converge gradually.

Backfill scripts should be resumable, safe to retry, processed in bounded batches, and observable. Treat optional cleanup or eager reconciliation as optional rather than as a release blocker.

## Development-stage schema changes

Schema changes churn during feature development. When the schema changes before the migration has shipped, do not hand-edit the existing migration SQL to chase the new schema shape. Delete the draft migration folder this branch added (its `migration.sql` and `snapshot.json` go together), then run the generator again and re-apply the normal migration review steps below.

For example, if this branch's draft migration is `20261014093000_add_verify_tables` (substitute the branch's real folder — never an already-shipped one):

```bash
# 1. Delete the draft folder
rm -r packages/database/migrations/20261014093000_add_verify_tables

# 2. Regenerate from the current schema
pnpm db:generate --name=add_verify_tables
```

This keeps the generated SQL and snapshot aligned with the actual schema. Manual SQL edits are reserved for review-time hardening such as idempotent clauses and custom SQL.

Before release, if a feature branch accumulated multiple development-only migrations, consolidate them into one migration when possible. Production does not need to replay every intermediate draft shape, and fewer migrations reduce deploy-time risk: delete every draft folder the branch added and regenerate once.

Do not make a migration compatible with earlier development-only versions of the same branch. While the migration has not shipped, there is no production history to preserve. Fix local/dev databases directly with whatever SQL is simplest (drop the draft table, rename a column, delete draft rows), then regenerate the branch migration from the current schema.

After a migration has reached production or the target default branch, treat it as immutable: add a follow-up migration instead of rewriting it.

## Branches and conflicts

Each migration is a folder of its own, `packages/database/migrations/<UTC timestamp>_<name>/`, holding `migration.sql` and `snapshot.json`, and the snapshot's `prevIds` names the snapshot it was generated from. There is no journal, so two branches that each add a migration merge without a file conflict. Drizzle's migrator (`packages/database/src/core/migrator.ts`) applies every folder its history table, `public.__drizzle_migrations`, does not name, in folder-name order, so a branch's migration that lands after main's newer ones is still applied.

What a clean merge does not prove is that the two migrations commute. `pnpm --filter @luke/database check:migrations` (`drizzle-kit check`, run by `./scripts/check.sh`) reads the snapshot graph and fails when two branches cut from one parent touch the same table, column, or index. When it fails after a rebase, delete this branch's conflicting migration folder and every later one this branch added, then regenerate from the rebased schema:

```bash
rm -r packages/database/migrations/<this branch's folders>
pnpm db:generate --name=<what_it_does>
pnpm --filter @luke/database check:migrations
```

## Step 1: Generate Migrations

```bash
pnpm db:generate --name=user_add_avatar_column
```

This writes one folder, `packages/database/migrations/<UTC timestamp>_user_add_avatar_column/`, holding the `migration.sql` to review and the `snapshot.json` the next migration is generated from. Name the migration with `--name` rather than renaming the folder afterwards: the folder's name is the migration's identity in the history table.

## Custom Migrations (e.g. CREATE EXTENSION)

For SQL-only migrations that don't involve Drizzle schema changes and are safe to run during deployment (for example, enabling a PostgreSQL extension), use the `--custom` flag. A backfill or historical-data reconciliation is never one; it runs as its own script ("Data backfill" above):

```bash
pnpm db:generate --custom --name=enable_pg_search
```

This writes a folder whose `migration.sql` holds only a placeholder comment and whose snapshot repeats the previous one with a new `id`. Then add the SQL below the comment:

```sql
-- Custom SQL migration file, put your code below! --
CREATE EXTENSION IF NOT EXISTS pg_search;
```

**Do NOT create a migration folder by hand** — always use `drizzle-kit generate`, so the snapshot and its `prevIds` are what `drizzle-kit check` and the next `generate` read.

## Step 2: Use Idempotent Clauses (Defensive Programming)

Always use defensive clauses to make migrations idempotent (safe to re-run):

### CREATE TABLE

```sql
-- ✅ Good
CREATE TABLE IF NOT EXISTS "agent_eval_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ❌ Bad
CREATE TABLE "agent_eval_runs" (...);
```

### ALTER TABLE - Columns

```sql
-- ✅ Good
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar" text;
ALTER TABLE "posts" DROP COLUMN IF EXISTS "deprecated_field";

-- ❌ Bad
ALTER TABLE "users" ADD COLUMN "avatar" text;
```

### ALTER TABLE - Foreign Key Constraints

PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`. Use `DROP IF EXISTS` + `ADD`:

```sql
-- ✅ Good: Drop first, then add (idempotent)
ALTER TABLE "agent_eval_datasets" DROP CONSTRAINT IF EXISTS "agent_eval_datasets_user_id_users_id_fk";
ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

-- ❌ Bad: Will fail if constraint already exists
ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
```

### DROP TABLE / INDEX

```sql
-- ✅ Good
DROP TABLE IF EXISTS "old_table";
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree ("email");

-- ❌ Bad
DROP TABLE "old_table";
CREATE INDEX "users_email_idx" ON "users" ("email");
```

Never drop or alter `public.__drizzle_migrations` from a migration: the migrator records into it inside the same transaction the migration runs in. (It lives in `public` rather than Drizzle's default `drizzle` schema because `20261013123642_dead_tables_drop` drops that schema.)
