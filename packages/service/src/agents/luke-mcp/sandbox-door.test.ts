import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect } from "effect";
import type { HttpClient } from "effect/http";
import { sandboxListRefusal } from "../../testing/vercel-sandbox-fake.js";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import { agentSandboxDoors, SANDBOX_DOOR_MAX_BYTES } from "./sandbox-door.js";

/**
 * The door to a native agent's sandbox, over Vercel Sandbox's REST API as
 * the deployment asks it under its own OIDC token: the sandbox tagged with
 * the agent's session is found, the file is read from its running session
 * by a POST of its path, a file Vercel has not is no file, a file past
 * every tool's bound is read only one byte past it, and a conversation that
 * records no session opens no door. The token is a synthetic one.
 */

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";
const SESSION = "luke-claude-code-fixture";

/** An unsigned token naming the fixture's project and team. */
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

/** Vercel with one running sandbox tagged with the session, holding the files given; what it was asked is kept. */
function vercel(files: Readonly<Record<string, Uint8Array<ArrayBuffer>>>) {
  const asked: Asked[] = [];
  const layer = fakeHttpClientLayer((url, init) => {
    const parsed = new URL(url);
    const sent = init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : init.body;
    const body = typeof sent === "string" ? JSON.parse(sent) : undefined;
    asked.push({ url: parsed, body });
    if (parsed.pathname === "/api/v2/sandboxes") {
      return (
        sandboxListRefusal(parsed) ??
        Response.json({
          sandboxes: [
            { name: "sbx-stopped", status: "stopped" },
            { name: "sbx-up", status: "running", currentSessionId: "sbs_up" },
          ],
        })
      );
    }
    if (parsed.pathname.endsWith("/cmd")) {
      return new Response(
        `${JSON.stringify({ command: { exitCode: null } })}\n${JSON.stringify({ stream: "stdout", data: "12: const invite = true;\n" })}\n${JSON.stringify({ command: { exitCode: 0 } })}\n`,
      );
    }
    const bytes = files[(body as { path: string }).path];
    return bytes === undefined
      ? Response.json({ error: { code: "file_not_found" } }, { status: 404 })
      : new Response(bytes);
  });
  return { layer, asked };
}

const ADMITTED: AdmittedConversation = {
  caller: "user-fixture",
  target: { userId: "user-fixture", conversationId: "conversation-fixture" },
  runtimeSessionId: SESSION,
  timeZone: undefined,
};

/** The doors over the layer given, their effects run on this test's own context. */
const doorsOver = (admitted: AdmittedConversation) =>
  Effect.map(Effect.context<HttpClient.HttpClient>(), (context) =>
    agentSandboxDoors((effect) => Effect.runPromiseWith(context)(effect), fixtureToken)(admitted),
  );

/** The file door over the layer given. */
const doorOver = (admitted: AdmittedConversation) =>
  Effect.map(doorsOver(admitted), (doors) => doors.files);

/** A stream read whole. */
async function bytesOf(stream: ReadableStream<Uint8Array> | null): Promise<number[] | null> {
  if (stream === null) return null;
  return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

it.effect(
  "a file is read from the running sandbox tagged with the agent's session, by its path, and one Vercel has not is no file",
  () =>
    Effect.gen(function* () {
      const api = vercel({ "/workspace/repository/shot.png": new Uint8Array([1, 2, 3]) });
      const door = yield* doorOver(ADMITTED).pipe(Effect.provide(api.layer));

      const sandbox = yield* Effect.promise(() => door());
      const read = yield* Effect.promise(async () =>
        bytesOf(await sandbox.readFile({ path: "/workspace/repository/shot.png" })),
      );
      const missing = yield* Effect.promise(async () =>
        bytesOf(await sandbox.readFile({ path: "/workspace/repository/none.png" })),
      );

      assert.deepEqual(read, [1, 2, 3]);
      assert.equal(missing, null);
      const [list, file] = api.asked;
      assert.equal(list?.url.searchParams.get("tags"), `sessionId:${SESSION}`);
      assert.equal(list?.url.searchParams.get("teamId"), TEAM);
      assert.equal(file?.url.pathname, "/api/v2/sandboxes/sessions/sbs_up/fs/read");
      assert.deepEqual(file?.body, { path: "/workspace/repository/shot.png" });
    }),
);

it.effect("a file past every tool's bound is read only one byte past it", () =>
  Effect.gen(function* () {
    const api = vercel({ "/big.bin": new Uint8Array(SANDBOX_DOOR_MAX_BYTES + 4096) });
    const door = yield* doorOver(ADMITTED).pipe(Effect.provide(api.layer));

    const sandbox = yield* Effect.promise(() => door());
    const read = yield* Effect.promise(async () =>
      bytesOf(await sandbox.readFile({ path: "/big.bin" })),
    );

    assert.equal(read?.length, SANDBOX_DOOR_MAX_BYTES + 1);
  }),
);

it.effect(
  "a command of the checkout's is run in the running sandbox under bash, its environment set by env on its command line, and waited on",
  () =>
    Effect.gen(function* () {
      const api = vercel({});
      const doors = yield* doorsOver(ADMITTED).pipe(Effect.provide(api.layer));

      const sandbox = yield* Effect.promise(() => doors.repository());
      const ran = yield* Effect.promise(() =>
        sandbox.run({
          command: 'sed -n "12p" "$LUKE_FILE"',
          workingDirectory: "/workspace/repository",
          env: { LUKE_FILE: "src/invite.ts" },
        }),
      );

      assert.deepEqual(
        [ran.exitCode, ran.stdout, ran.stderr],
        [0, "12: const invite = true;\n", ""],
      );
      const command = api.asked.at(-1);
      assert.equal(command?.url.pathname, "/api/v2/sandboxes/sessions/sbs_up/cmd");
      assert.deepEqual(command?.body, {
        command: "env",
        args: ["LUKE_FILE=src/invite.ts", "bash", "-c", 'sed -n "12p" "$LUKE_FILE"'],
        cwd: "/workspace/repository",
        wait: true,
        logs: true,
      });
    }),
);

it.effect("a conversation that records no session opens no door", () =>
  Effect.gen(function* () {
    const api = vercel({});
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
