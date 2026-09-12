import assert from "node:assert/strict";
import { sql } from "kysely";
import { afterEach, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("with no DATABASE_URL the auth service constructs, and its first query rejects rather than hanging or failing later", async () => {
  vi.stubEnv("DATABASE_URL", undefined);
  vi.resetModules();
  const { authDatabase } = await import("../server/auth");
  await assert.rejects(sql`select 1`.execute(authDatabase));
});
