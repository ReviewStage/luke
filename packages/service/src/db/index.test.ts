import assert from "node:assert/strict";
import { type AddressInfo, createServer, type Server, type Socket } from "node:net";
import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { afterEach, test, vi } from "vitest";
import { databaseUrl, getPool } from "./index.js";

const CONCURRENT_QUERIES = 5;

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * A server that speaks just enough of Postgres's wire protocol to accept a
 * connection and hold every query unanswered until `held` queries are waiting
 * at once, each on its own connection. It is the database at the process
 * boundary: a pool that serializes its callers never gets `held` queries in
 * flight, so this never answers and the test times out.
 */
function holdingServer(held: number): Promise<{ server: Server; port: number }> {
  const waiting: Socket[] = [];
  const completion = Buffer.concat([
    Buffer.from([0x43, 0, 0, 0, 13]),
    Buffer.from("SELECT 1\0"),
    Buffer.from([0x5a, 0, 0, 0, 5, 0x49]),
  ]);

  const server = createServer((socket) => {
    let started = false;
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      if (!started) {
        // The startup packet carries no type byte: answer it with AuthenticationOk and ReadyForQuery.
        started = true;
        socket.write(
          Buffer.concat([
            Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]),
            Buffer.from([0x5a, 0, 0, 0, 5, 0x49]),
          ]),
        );
        return;
      }
      if (chunk[0] !== 0x51) {
        return;
      }
      waiting.push(socket);
      if (waiting.length === held) {
        for (const each of waiting) {
          each.write(completion);
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      // SAFETY: a server listening on a port answers an `AddressInfo`; only a pipe answers a string.
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

test("one instance runs several queries at once on the pool Better Auth queries", async () => {
  const { server, port } = await holdingServer(CONCURRENT_QUERIES);
  vi.stubEnv("DATABASE_URL", `postgres://user:pass@127.0.0.1:${port}/luke?sslmode=disable`);

  const pool = getPool();
  try {
    await Promise.all(Array.from({ length: CONCURRENT_QUERIES }, () => pool.query("select 1")));
  } finally {
    await pool.end();
    server.close();
  }
});

const readUrl = (environment: Record<string, string>) =>
  databaseUrl.pipe(
    Effect.map(Redacted.value),
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(environment)),
  );

const BASE = "postgres://u:p@host/db";

it.effect(
  "a mode pg already treats as verify-full is spelled that way, and nothing else changes",
  () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [string, string]> = [
        [`${BASE}?sslmode=require`, `${BASE}?sslmode=verify-full`],
        [
          `${BASE}?sslmode=prefer&application_name=luke`,
          `${BASE}?sslmode=verify-full&application_name=luke`,
        ],
        [
          `${BASE}?channel_binding=require&sslmode=verify-ca`,
          `${BASE}?channel_binding=require&sslmode=verify-full`,
        ],
        [`${BASE}?sslmode=verify-full`, `${BASE}?sslmode=verify-full`],
        [`${BASE}?sslmode=disable`, `${BASE}?sslmode=disable`],
        [`${BASE}?sslmode=no-verify`, `${BASE}?sslmode=no-verify`],
        [`${BASE}?channel_binding=require`, `${BASE}?channel_binding=require`],
        [
          `${BASE}?uselibpqcompat=true&sslmode=require`,
          `${BASE}?uselibpqcompat=true&sslmode=require`,
        ],
        [BASE, BASE],
      ];

      for (const [given, expected] of cases) {
        assert.equal(yield* readUrl({ DATABASE_URL: ` ${given} ` }), expected);
      }
    }),
);
