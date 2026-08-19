import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, createPool, getDatabase, POOL_LIMITS } from "../server/db/index";

const TEST_CONNECTION_STRING = "postgresql://user:secret@localhost:5432/luke";

test("database construction is offline and the pool is bounded", () => {
  const database = createDatabase(TEST_CONNECTION_STRING);
  const pool = database.$client;

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

test("a pool is also lazy when constructed directly", () => {
  const pool = createPool(TEST_CONNECTION_STRING);

  assert.equal(pool.totalCount, 0);
  assert.equal(pool.options.connectionString, TEST_CONNECTION_STRING);
});

test("DATABASE_URL is read lazily and a missing value is not cached", () => {
  const previousConnectionString = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    assert.throws(
      () => getDatabase(),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DATABASE_URL/);
        assert.doesNotMatch(error.message, /secret|postgresql:\/\//);
        return true;
      },
    );

    process.env.DATABASE_URL = TEST_CONNECTION_STRING;
    assert.equal(getDatabase().$client.options.connectionString, TEST_CONNECTION_STRING);
  } finally {
    if (previousConnectionString === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousConnectionString;
    }
  }
});
