# @luke/database

The hosted store's schema, queries, and migrations. The schema modules under
`src/schemas/` are the source of truth; Drizzle's Effect driver runs every
statement (`src/core/query.ts`'s `Database`). `AGENTS.md`'s Drizzle idioms say
how to write a query and roll out a migration.

## Migrations

| Command | What it does |
| --- | --- |
| `pnpm db:generate --name=<what_it_does>` | Write the folder that brings the newest snapshot up to the schema modules |
| `pnpm db:generate --custom --name=<what_it_does>` | Write a folder for hand-written SQL |
| `pnpm --filter @luke/database check:migrations` | `drizzle-kit check`: refuse two branches' migrations that do not commute (`./scripts/check.sh` runs it) |
| `pnpm --filter @luke/web db:migrate` | Apply what a database has not recorded, on `DATABASE_URL_UNPOOLED` |

Each migration is a folder, `migrations/<UTC timestamp>_<name>/`, holding
`migration.sql` and the `snapshot.json` the next one is generated from. A
snapshot's `prevIds` names its parent, so the folders form a graph rather than
a journal, and two branches each adding a migration no longer conflict on a
shared file. `drizzle-kit check` reads that graph and fails when two branches
cut from one parent touch the same object; the fix is to delete this branch's
conflicting folder and every later one it added, and regenerate.

`src/core/migrator.ts`'s `runWebMigrations` is the one runner, for
`db:migrate` and for every test database: Drizzle's `migrate` from
`drizzle-orm/effect-postgres/migrator` over the `Database` service. It applies
every folder `public.__drizzle_migrations` does not name, in folder-name
order, inside one transaction, and answers the names it applied. Nothing
serializes two runs: a second process started while the first is under way
reads the history before the first commits, so a database is migrated by
one process at a time, which is the deploy's to keep. The history
table sits in `public` rather than Drizzle's default `drizzle` schema, because
`20261013123642_dead_tables_drop` drops that schema and would take the table
with it partway through a fresh database's run.

### The history transfer

Until every database has run it once, the runner first copies the old
`effect/sql` runner's history across. That runner recorded what it applied in
`effect_sql_migrations`, under the file tags of the journal the folders
replaced (`0081_better_auth_1_7`), which Drizzle's migrator never reads. When
`public.__drizzle_migrations` is absent and `effect_sql_migrations` stands, the
runner creates Drizzle's table and writes one row per recorded tag, with the
folder that tag moved to (`src/core/effect-migration-folders.ts`), the
folder's `migration.sql` hash, and the millis its name carries: what Drizzle's
migrator would have written had it applied those folders itself. A recorded
tag with no folder fails the run, naming the tag, and writes nothing.

The folders were made by `drizzle-kit up` from the 0.x journal. 0026 through
0094 were written by hand while drizzle-kit was out of the repository and had
no snapshot, so before `up` each was given the one `generate --custom` writes:
the previous snapshot under a fresh id, its parent the previous id.

The transfer and the map go once production and every preview have migrated,
together with `effect_sql_migrations`.
