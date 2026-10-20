import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { getPool, withExplicitSslMode } from "./index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("the pool Better Auth queries holds more than one connection, on an explicit verify-full", async () => {
  vi.stubEnv("DATABASE_URL", " postgres://user:pass@db.example.com/luke?sslmode=require ");

  const pool = getPool();
  try {
    assert.ok((pool.options.max ?? 0) > 1);
    assert.equal(
      pool.options.connectionString,
      "postgres://user:pass@db.example.com/luke?sslmode=verify-full",
    );
  } finally {
    await pool.end();
  }
});

test("a mode pg already treats as verify-full is spelled that way, and nothing else changes", () => {
  const base = "postgres://u:p@host/db";
  const cases: ReadonlyArray<readonly [string, string]> = [
    [`${base}?sslmode=require`, `${base}?sslmode=verify-full`],
    [
      `${base}?sslmode=prefer&application_name=luke`,
      `${base}?sslmode=verify-full&application_name=luke`,
    ],
    [
      `${base}?channel_binding=require&sslmode=verify-ca`,
      `${base}?channel_binding=require&sslmode=verify-full`,
    ],
    [`${base}?sslmode=verify-full`, `${base}?sslmode=verify-full`],
    [`${base}?sslmode=disable`, `${base}?sslmode=disable`],
    [`${base}?sslmode=no-verify`, `${base}?sslmode=no-verify`],
    [`${base}?channel_binding=require`, `${base}?channel_binding=require`],
    [`${base}?uselibpqcompat=true&sslmode=require`, `${base}?uselibpqcompat=true&sslmode=require`],
    [base, base],
  ];

  for (const [given, expected] of cases) {
    assert.equal(withExplicitSslMode(given), expected);
  }
});
