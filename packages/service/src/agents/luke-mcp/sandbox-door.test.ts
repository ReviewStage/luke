import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
 * by a command run with every capability dropped, never by Vercel's own
 * file read, a path that is no file is no file, a file past every tool's
 * bound is read only one byte past it, and a conversation that records no
 * session opens no door. The read's command runs in a real bash over a
 * temporary directory standing in for the sandbox's disk, once the fake
 * has checked that `setpriv` empties every capability set ahead of it. The
 * token is a synthetic one.
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

/** What `setpriv` is handed ahead of the command it runs, every capability set emptied. */
const CAPABILITIES_DROPPED = [
  "--inh-caps=-all",
  "--ambient-caps=-all",
  "--bounding-set=-all",
  "--",
];

/** A command's run as Vercel streams it back: its start, its stdout, and its exit. */
function commandStream(exitCode: number, stdout: string): Response {
  return new Response(
    `${JSON.stringify({ command: { exitCode: null } })}\n${JSON.stringify({ stream: "stdout", data: stdout })}\n${JSON.stringify({ command: { exitCode } })}\n`,
  );
}

/** A temporary directory standing in for the sandbox's disk, holding the files given by their path under it. */
function disk(files: Readonly<Record<string, Uint8Array>>): string {
  const root = mkdtempSync(join(tmpdir(), "sandbox-door-"));
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  return root;
}

/** Vercel with one running sandbox tagged with the session, its disk the directory given; what it was asked is kept. */
function vercel(root: string) {
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
      const { command, args } = body as { command: string; args: string[] };
      if (command !== "setpriv") return commandStream(0, "12: const invite = true;\n");
      // The capability drop holds, so the rest runs as the sandbox's user, in the stand-in disk.
      if (args.slice(0, CAPABILITIES_DROPPED.length).join(" ") !== CAPABILITIES_DROPPED.join(" ")) {
        return commandStream(97, "");
      }
      const [program = "", ...rest] = args.slice(CAPABILITIES_DROPPED.length);
      const ran = spawnSync(program, rest, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      return commandStream(ran.status ?? 1, ran.stdout);
    }
    return Response.json({ error: { code: "not_asked" } }, { status: 500 });
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
      const [list, file] = api.asked;
      assert.equal(list?.url.searchParams.get("tags"), `sessionId:${SESSION}`);
      assert.equal(list?.url.searchParams.get("teamId"), TEAM);
      assert.equal(file?.url.pathname, "/api/v2/sandboxes/sessions/sbs_up/cmd");
      // Vercel's own file read reads as root, whatever the path names.
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

it.effect(
  "a command of the checkout's is run in the running sandbox under bash, its environment set by env on its command line, and waited on",
  () =>
    Effect.gen(function* () {
      const api = vercel(tmpdir());
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
