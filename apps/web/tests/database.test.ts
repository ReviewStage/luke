import assert from "node:assert/strict";
import { test } from "vitest";
import { createPool, getPool, POOL_LIMITS } from "../server/db/index";

const TEST_CONNECTION_STRING = "postgresql://user:secret@localhost:5432/luke";

test("a pool is bounded and lazy: nothing connects at construction", () => {
  const pool = createPool(TEST_CONNECTION_STRING);

  assert.equal(pool.totalCount, 0);
  assert.equal(pool.idleCount, 0);
  assert.equal(pool.waitingCount, 0);
  assert.equal(pool.options.connectionString, TEST_CONNECTION_STRING);
  assert.equal(pool.options.max, POOL_LIMITS.max);
  assert.equal(pool.options.idleTimeoutMillis, POOL_LIMITS.idleTimeoutMillis);
  assert.equal(pool.options.connectionTimeoutMillis, POOL_LIMITS.connectionTimeoutMillis);
  assert.ok(Number.isFinite(pool.options.max));
  assert.ok(Number.isFinite(pool.options.idleTimeoutMillis));
  assert.ok(Number.isFinite(pool.options.connectionTimeoutMillis));
});

test("DATABASE_URL is read lazily and a missing value is not cached", () => {
  const previousConnectionString = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    assert.throws(
      () => getPool(),
      (error) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );

    process.env.DATABASE_URL = TEST_CONNECTION_STRING;
    assert.equal(getPool().options.connectionString, TEST_CONNECTION_STRING);
  } finally {
    if (previousConnectionString === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousConnectionString;
    }
  }
});
