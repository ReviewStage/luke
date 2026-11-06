import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Effect, Layer } from "effect";
import type { HttpClient } from "effect/http";
import {
  commandRunStreamed,
  sandboxesListed,
  sandboxFetchOver,
  sandboxFound,
  sandboxListRefusal,
} from "../../testing/vercel-sandbox-fake.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { vercelMachineLayer } from "../machine/vercel-machine.js";
import { agentSandboxDoors, SANDBOX_DOOR_MAX_BYTES } from "./sandbox-door.js";

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";
const SESSION = "claude-code-fixture";

function fixtureToken(): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ project_id: PROJECT, owner_id: TEAM })).toString(
    "base64url",
  );
  return Promise.resolve(`${header}.${payload}.`);
}

interface Asked {
  readonly url: URL;
  readonly body: unknown;
}

const commandStream = (exitCode: number, stdout: string) =>
  commandRunStreamed({ id: "cmd_1", sessionId: "sbs_up" }, { exitCode, stdout, stderr: "" });

const SANDBOXES = [
  { name: "sbx-stopped", status: "stopped", currentSessionId: "sbs_down", createdAt: 0 },
  { name: "sbx-up", status: "running", currentSessionId: "sbs_up", createdAt: 1 },
] as const;

function disk(files: Readonly<Record<string, Uint8Array>>): string {
  const root = mkdtempSync(join(tmpdir(), "sandbox-door-"));
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  return root;
}

function vercel(root: string) {
  const asked: Asked[] = [];
  const respond = (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    const sent = init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : init.body;
    const body = typeof sent === "string" ? JSON.parse(sent) : undefined;
    asked.push({ url: parsed, body });
    if (parsed.pathname === "/api/v2/sandboxes") {
      return sandboxListRefusal(parsed) ?? Response.json(sandboxesListed(SANDBOXES));
    }
    const named = SANDBOXES.find(({ name }) => parsed.pathname === `/api/v2/sandboxes/${name}`);
    if (named !== undefined) return Response.json(sandboxFound(named));
    if (parsed.pathname.endsWith("/cmd")) {
      const { command, args } = body as { command: string; args: string[] };
      const ran = spawnSync(command, args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      return commandStream(ran.status ?? 1, ran.stdout);
    }
    return Response.json({ error: { code: "not_asked" } }, { status: 400 });
  };
  return { layer: Layer.merge(fakeHttpClientLayer(respond), sandboxFetchOver(respond)), asked };
}

const ADMITTED: AdmittedConversation = {
  caller: "user-fixture",
  target: { userId: "user-fixture", conversationId: "conversation-fixture" },
  runtimeSessionId: SESSION,
  timeZone: undefined,
};

const doorsOver = (admitted: AdmittedConversation) =>
  Effect.map(Effect.context<HttpClient.HttpClient>(), (context) => {
    const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
      Effect.runPromiseWith(context)(effect);
    return agentSandboxDoors(run, vercelMachineLayer({ readToken: fixtureToken, run }))(admitted);
  });

const doorOver = (admitted: AdmittedConversation) =>
  Effect.map(doorsOver(admitted), (doors) => doors.files);

async function bytesOf(stream: ReadableStream<Uint8Array> | null): Promise<number[] | null> {
  if (stream === null) return null;
  return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

it.effect(
  "a file is read from the running sandbox tagged with the agent's session, by its path, under the capability drop, and a path that is no file is no file",
  () =>
    Effect.gen(function* () {
      const root = disk({ "repository/shot.png": new Uint8Array([1, 0, 255, 10, 3]) });
      const api = vercel(root);
      const door = yield* doorOver(ADMITTED).pipe(Effect.provide(api.layer));

      const sandbox = yield* Effect.promise(() => door());
      const readOf = (path: string) =>
        Effect.promise(async () => bytesOf(await sandbox.readFile({ path })));
      const read = yield* readOf(join(root, "repository/shot.png"));
      const missing = yield* readOf(join(root, "repository/none.png"));
      const directory = yield* readOf(join(root, "repository"));

      assert.deepEqual(read, [1, 0, 255, 10, 3]);
      assert.equal(missing, null);
      assert.equal(directory, null);
      const [list] = api.asked;
      const file = api.asked.find(({ url }) => url.pathname.endsWith("/cmd"));
      assert.equal(list?.url.searchParams.get("tags"), `sessionId:${SESSION}`);
      assert.equal(list?.url.searchParams.get("teamId"), TEAM);
      assert.equal(file?.url.pathname, "/api/v2/sandboxes/sessions/sbs_up/cmd");
      assert.equal(
        api.asked.some(({ url }) => url.pathname.endsWith("/fs/read")),
        false,
      );
    }),
);

it.effect("a file past every tool's bound is read only one byte past it", () =>
  Effect.gen(function* () {
    const root = disk({ "big.bin": new Uint8Array(SANDBOX_DOOR_MAX_BYTES + 4096) });
    const api = vercel(root);
    const door = yield* doorOver(ADMITTED).pipe(Effect.provide(api.layer));

    const sandbox = yield* Effect.promise(() => door());
    const read = yield* Effect.promise(async () =>
      bytesOf(await sandbox.readFile({ path: join(root, "big.bin") })),
    );

    assert.equal(read?.length, SANDBOX_DOOR_MAX_BYTES + 1);
  }),
);

it.effect("a conversation that records no session opens no door", () =>
  Effect.gen(function* () {
    const api = vercel(tmpdir());
    const door = yield* doorOver({ ...ADMITTED, runtimeSessionId: undefined }).pipe(
      Effect.provide(api.layer),
    );

    const opened = yield* Effect.promise(() =>
      door().then(
        () => "opened",
        () => "refused",
      ),
    );

    assert.equal(opened, "refused");
    assert.deepEqual(api.asked, []);
  }),
);
