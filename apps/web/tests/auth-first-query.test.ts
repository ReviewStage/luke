import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { afterEach, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("with no DATABASE_URL the auth service constructs, and its first query rejects rather than hanging or failing later", async () => {
  vi.stubEnv("DATABASE_URL", undefined);
  vi.resetModules();
  await import("../server/auth");
  const { authDatabase } = await import("../server/auth-database");
  await assert.rejects(authDatabase.execute(sql`select 1`));
});
