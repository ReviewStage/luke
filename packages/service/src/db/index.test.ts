import assert from "node:assert/strict";
import { once } from "node:events";
import { type AddressInfo, createServer, type Server, type Socket } from "node:net";
import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { afterEach, test, vi } from "vitest";
import { databaseUrl, getPool } from "./index.js";

const CONCURRENT_QUERIES = 5;

afterEach(() => {
  vi.unstubAllEnvs();
});

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

function answeringServer(): Promise<{ server: Server; port: number; sockets: Socket[] }> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    let started = false;
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      if (!started) {
        started = true;
        socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]));
        return;
      }
      if (chunk[0] === 0x51) {
        socket.write(
          Buffer.concat([
            Buffer.from([0x43, 0, 0, 0, 13]),
            Buffer.from("SELECT 1\0"),
            Buffer.from([0x5a, 0, 0, 0, 5, 0x49]),
          ]),
        );
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port, sockets });
    });
  });
}

test("an idle client whose connection ends is dropped, and the next query opens a fresh one", async () => {
  const { server, port, sockets } = await answeringServer();
  vi.stubEnv("DATABASE_URL", `postgres://user:pass@127.0.0.1:${port}/luke?sslmode=disable`);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
  const { getPool: getFreshPool } = await import("./index.js");

  const pool = getFreshPool();
  try {
    await pool.query("select 1");
    const removed = once(pool, "remove");
    for (const socket of sockets) socket.destroy();
    await removed;
    await pool.query("select 1");
    assert.equal(sockets.length, 2);
  } finally {
    await pool.end();
    server.close();
    vi.restoreAllMocks();
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
