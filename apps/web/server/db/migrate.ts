import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const MIGRATION_LOCK = {
  NAMESPACE: 1_280_654_853,
  RESOURCE: 1_146_243_418,
} as const;

type MigrationConnection = Pick<Client, "connect" | "query" | "end">;

/** Keeps same-branch deploys from applying the same migration concurrently. */
export async function migrateWithLock(
  connection: MigrationConnection,
  runMigrations: () => Promise<void>,
): Promise<void> {
  await connection.connect();
  let locked = false;
  try {
    await connection.query("select pg_advisory_lock($1, $2)", [
      MIGRATION_LOCK.NAMESPACE,
      MIGRATION_LOCK.RESOURCE,
    ]);
    locked = true;
    await runMigrations();
  } finally {
    try {
      if (locked) {
        await connection.query("select pg_advisory_unlock($1, $2)", [
          MIGRATION_LOCK.NAMESPACE,
          MIGRATION_LOCK.RESOURCE,
        ]);
      }
    } finally {
      await connection.end();
    }
  }
}

async function migrateConfiguredDatabase(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error("DATABASE_URL_UNPOOLED is required to migrate the database.");
  }
  const connection = new Client({ connectionString });
  await migrateWithLock(connection, async () => {
    await migrate(drizzle(connection), {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
  });
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  await migrateConfiguredDatabase();
}
