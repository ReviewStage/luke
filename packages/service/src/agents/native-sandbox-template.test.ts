/**
 * native-sandbox-template.test.ts -- Luke's own template of the coding agent's image, against a fake of Vercel Sandbox's REST API: reused once ready, built where missing, built once under concurrent launches, built anew for a new image, and swept.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Duration, Effect, Fiber, Layer, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { commandRead } from "../testing/runner-sandbox-fake.js";
import { sandboxListRefusal } from "../testing/vercel-sandbox-fake.js";
import { PREPARE_SCRIPT } from "./agent-runtime/sandbox-image.js";
import {
  AgentSandboxImage,
  agentSandboxImageFromTemplate,
  ImagePreparing,
} from "./agent-sandbox-image.js";
import {
  advanceTemplate,
  awaitTemplate,
  EVE_BASE_IMAGE,
  forgetSnapshot,
  type ImageBuild,
  NATIVE_TEMPLATE,
  recordImageBuild,
  sweepTemplates,
  TEMPLATE_STATE,
} from "./native-sandbox-template.js";
import { vercelSandboxApi } from "./vercel-sandbox-api.js";

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";

/** An unsigned token naming the fixture's project and team. */
function fixtureToken(): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ project_id: PROJECT, owner_id: TEAM })).toString(
    "base64url",
  );
  return Promise.resolve(`${header}.${payload}.`);
}

interface FakeSandbox {
  name: string;
  image: string;
  status: string;
  currentSessionId: string;
  tags: Record<string, string>;
  currentSnapshotId?: string;
  createdAt: number;
  deleted: boolean;
}

interface FakeCommand {
  readonly id: string;
  readonly session: string;
  readonly args: readonly string[];
  exitCode: number | null;
  recorded?: boolean;
}

/** The files a gzipped tar holds, by path. */
function untar(archive: Uint8Array): Map<string, string> {
  const tar = gunzipSync(archive);
  const files = new Map<string, string>();
  let at = 0;
  while (at + 512 <= tar.length) {
    const name = tar
      .subarray(at, at + 100)
      .toString("utf8")
      .replace(/\0.*$/su, "");
    if (name === "") break;
    const prefix = tar
      .subarray(at + 345, at + 500)
      .toString("utf8")
      .replace(/\0.*$/su, "");
    const size = Number.parseInt(tar.subarray(at + 124, at + 136).toString("utf8"), 8);
    files.set(
      `/${prefix === "" ? "" : `${prefix}/`}${name}`,
      tar.subarray(at + 512, at + 512 + size).toString("utf8"),
    );
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Vercel Sandbox's REST API as a store of named sandboxes, their commands, uploads, and snapshots. */
function vercel() {
  const sandboxes: FakeSandbox[] = [];
  const commands: FakeCommand[] = [];
  const uploads: Map<string, string>[] = [];
  const snapshots: string[] = [];
  /** The snapshots Vercel lost, deleted under the template that still names one. */
  const goneSnapshots = new Set<string>();
  const clock = { now: 0 };
  /** What the test does once, the next time a sandbox is read by name, before the read is answered. */
  const hooks: { onceOnRead?: (() => Promise<void>) | undefined } = {};
  /**
   * Whether a read that waits on a running command's exit is held until the
   * command exits, as Vercel holds it, rather than answered at once with no
   * exit, as a read something between cut short is; and how many such reads
   * were made, and the held ones' release.
   */
  const exitReads = { hold: false, made: 0, held: [] as (() => void)[] };
  let next = 0;
  const id = (prefix: string) => {
    next += 1;
    return `${prefix}_${next}`;
  };
  const live = (name: string) => sandboxes.find((each) => each.name === name && !each.deleted);
  const listed = (sandbox: FakeSandbox) => ({
    name: sandbox.name,
    status: sandbox.status,
    currentSessionId: sandbox.currentSessionId,
    tags: sandbox.tags,
    currentSnapshotId: sandbox.currentSnapshotId,
    createdAt: sandbox.createdAt,
  });
  const respond = async (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = init.method ?? "GET";
    assert.equal(parsed.searchParams.get("teamId"), TEAM);
    const body = async () => JSON.parse(await new Response(init.body).text());
    if (method === "POST" && path === "/api/v3/sandboxes") {
      const asked = await body();
      assert.equal(asked.persistent, true);
      // The name is unique among the project's sandboxes, which is the lock.
      if (live(asked.name) !== undefined) return new Response(null, { status: 409 });
      const sandbox: FakeSandbox = {
        name: asked.name,
        image: asked.image,
        status: "running",
        currentSessionId: id("sbs"),
        tags: asked.tags,
        createdAt: clock.now,
        deleted: false,
      };
      sandboxes.push(sandbox);
      return Response.json({ sandbox: listed(sandbox), session: { id: sandbox.currentSessionId } });
    }
    if (method === "GET" && path === "/api/v2/sandboxes") {
      const refused = sandboxListRefusal(parsed);
      if (refused !== undefined) return refused;
      const prefix = parsed.searchParams.get("namePrefix") ?? "";
      const found = sandboxes.filter((each) => !each.deleted && each.name.startsWith(prefix));
      return Response.json({ sandboxes: found.map(listed) });
    }
    const named = /^\/api\/v2\/sandboxes\/([^/]+)$/u.exec(path);
    if (named !== null) {
      const sandbox = live(decodeURIComponent(named[1] ?? ""));
      if (sandbox === undefined) return new Response(null, { status: 404 });
      if (method === "PATCH") {
        sandbox.tags = (await body()).tags;
        return Response.json({ sandbox: listed(sandbox) });
      }
      if (method === "DELETE") {
        sandbox.deleted = true;
        return Response.json({});
      }
      const answer = { sandbox: listed(sandbox), session: { id: sandbox.currentSessionId } };
      const hook = hooks.onceOnRead;
      hooks.onceOnRead = undefined;
      await hook?.();
      return Response.json(answer);
    }
    const snapshotLookup = /^\/api\/v2\/sandboxes\/snapshots\/([^/]+)$/u.exec(path);
    if (method === "GET" && snapshotLookup !== null) {
      const snapshotId = decodeURIComponent(snapshotLookup[1] ?? "");
      if (goneSnapshots.has(snapshotId) || !snapshots.includes(snapshotId)) {
        return Response.json({ error: { code: "not_found" } }, { status: 404 });
      }
      return Response.json({ snapshot: { id: snapshotId, status: "created" } });
    }
    const session = /^\/api\/v2\/sandboxes\/sessions\/([^/]+)\/(.+)$/u.exec(path);
    assert.ok(session !== null, `an unexpected call: ${method} ${path}`);
    const [, sessionId = "", rest = ""] = session;
    const running = sandboxes.find(
      (each) => !each.deleted && each.currentSessionId === sessionId && each.status === "running",
    );
    if (rest === "stop") {
      // A persistent sandbox snapshots itself as it stops.
      if (running !== undefined) {
        running.status = "stopped";
        running.currentSnapshotId = id("snap_on_stop");
      }
      return Response.json({ session: { id: sessionId } });
    }
    if (rest === "snapshot") {
      assert.deepEqual(await body(), { expiration: 0 });
      // A snapshot stops the session at once, so a second one asked of it is refused.
      const taking = sandboxes.find(
        (each) => !each.deleted && each.currentSessionId === sessionId && each.status === "running",
      );
      if (taking === undefined) return new Response(null, { status: 422 });
      taking.status = "stopped";
      const snapshot = id("snap");
      snapshots.push(snapshot);
      taking.currentSnapshotId = snapshot;
      return Response.json({ snapshot: { id: snapshot }, session: { id: sessionId } });
    }
    if (rest === "fs/write") {
      uploads.push(untar(new Uint8Array(await new Response(init.body).arrayBuffer())));
      return Response.json({});
    }
    if (rest === "cmd") {
      const asked = await body();
      assert.equal(asked.sudo, false);
      const command: FakeCommand = {
        id: id("cmd"),
        session: sessionId,
        args: asked.args,
        exitCode: null,
      };
      commands.push(command);
      return Response.json({ command: { id: command.id, exitCode: null } });
    }
    const commandCall = /^cmd\/([^/]+)$/u.exec(rest);
    assert.ok(commandCall !== null, `an unexpected call: ${method} ${path}`);
    const command = commands.find((each) => each.id === commandCall[1]);
    if (command === undefined) return new Response(null, { status: 404 });
    if (parsed.searchParams.get("wait") === "true") {
      exitReads.made += 1;
      if (exitReads.hold && command.exitCode === null) {
        await new Promise<void>((exited, gaveUp) => {
          exitReads.held.push(exited);
          init.signal?.addEventListener("abort", () => gaveUp(new Error("the reader gave up")), {
            once: true,
          });
        });
      }
    }
    return commandRead(command, parsed, init, false);
  };
  return {
    layer: fakeHttpClientLayer(respond),
    sandboxes,
    commands,
    uploads,
    snapshots,
    goneSnapshots,
    clock,
    hooks,
    exitReads,
    /** The build of the template named ends with the exit code given, which lets go every read held on it. */
    finishBuild: (exitCode: number) => {
      for (const command of commands) command.exitCode = command.exitCode ?? exitCode;
      for (const exited of exitReads.held.splice(0)) exited();
    },
  };
}

/** The API over the fake, and today's recorded preparation. */
const setUp = (fake: ReturnType<typeof vercel>) =>
  Effect.gen(function* () {
    const api = yield* vercelSandboxApi(fixtureToken).pipe(Effect.provide(fake.layer));
    const build = yield* recordImageBuild();
    return { api, build };
  });

/** Another image's preparation: the same files under another key. */
function otherImage(build: ImageBuild): ImageBuild {
  const key = "0123456789abcdef";
  return { ...build, key, name: `${NATIVE_TEMPLATE.NAME_PREFIX}${key}` };
}

it.effect(
  "a missing template is built from eve's base image with today's preparation, then snapshotted once its build ends well",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);

      assert.equal((yield* advanceTemplate(api, build)).state, TEMPLATE_STATE.PREPARING);

      assert.equal(fake.sandboxes.length, 1);
      assert.equal(fake.sandboxes[0]?.name, build.name);
      assert.equal(fake.sandboxes[0]?.image, EVE_BASE_IMAGE);
      const uploaded = fake.uploads[0];
      assert.ok(uploaded !== undefined);
      assert.deepEqual(
        fake.commands.map((command) => command.args),
        [[build.entry]],
      );
      // The preparation's own script is among the steps the entry runs.
      assert.ok([...uploaded.values()].includes(PREPARE_SCRIPT));
      assert.ok(uploaded.get(build.entry)?.includes("bash /tmp/luke-template/step-"));
      assert.equal((yield* advanceTemplate(api, build)).state, TEMPLATE_STATE.PREPARING);

      fake.finishBuild(0);
      const ready = yield* advanceTemplate(api, build);

      assert.deepEqual(ready, { state: TEMPLATE_STATE.READY, snapshotId: fake.snapshots[0] });
    }),
);

it.effect(
  "a ready template is answered as it stands, and nothing is built or snapshotted again",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);
      yield* advanceTemplate(api, build);
      fake.finishBuild(0);
      const first = yield* advanceTemplate(api, build);

      const again = yield* awaitTemplate(api, build);

      assert.deepEqual(again, first);
      assert.equal(fake.sandboxes.length, 1);
      assert.equal(fake.commands.length, 1);
      assert.equal(fake.snapshots.length, 1);
    }),
);

it.effect(
  "launches that find no template at once build it once, and each opens on its one snapshot",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);
      const launches = yield* Effect.forkChild(
        Effect.all(
          [awaitTemplate(api, build), awaitTemplate(api, build), awaitTemplate(api, build)],
          {
            concurrency: "unbounded",
          },
        ),
      );
      yield* TestClock.adjust(NATIVE_TEMPLATE.POLL);

      fake.finishBuild(0);
      yield* TestClock.adjust(NATIVE_TEMPLATE.POLL);
      const answered = yield* Fiber.join(launches);

      assert.equal(fake.sandboxes.length, 1);
      assert.equal(fake.commands.length, 1);
      assert.equal(fake.snapshots.length, 1);
      for (const each of answered) {
        assert.deepEqual(each, { state: TEMPLATE_STATE.READY, snapshotId: fake.snapshots[0] });
      }
    }),
);

/** Real turns of the event loop enough for a forked fiber to reach whatever it waits on next. */
const turnsPass = Effect.promise(async () => {
  for (let turn = 0; turn < 50; turn += 1) {
    await new Promise<void>((settle) => setImmediate(settle));
  }
});

it.effect(
  "a launch waiting on a build reads the template again the moment the build exits, with no clock between",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      fake.exitReads.hold = true;
      const { api, build } = yield* setUp(fake);

      const launch = yield* Effect.forkChild(awaitTemplate(api, build));
      yield* turnsPass;
      assert.equal(fake.exitReads.held.length, 1);
      assert.equal(fake.snapshots.length, 0);
      fake.finishBuild(0);
      const ready = yield* Fiber.join(launch);

      assert.deepEqual(ready, { state: TEMPLATE_STATE.READY, snapshotId: fake.snapshots[0] });
      assert.equal(fake.commands.length, 1);
    }),
);

it.effect(
  "a read of the build's exit Vercel answers early with none is made again only once a poll has passed, never in a loop",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);

      const launch = yield* Effect.forkChild(awaitTemplate(api, build));
      yield* turnsPass;
      const first = fake.exitReads.made;
      yield* turnsPass;
      assert.equal(fake.exitReads.made, first);
      yield* TestClock.adjust(NATIVE_TEMPLATE.POLL);
      yield* turnsPass;
      assert.ok(fake.exitReads.made > first);
      fake.finishBuild(0);
      yield* TestClock.adjust(NATIVE_TEMPLATE.POLL);

      assert.equal((yield* Fiber.join(launch)).state, TEMPLATE_STATE.READY);
    }),
);

it.effect(
  "readers racing to snapshot a finished build take one snapshot, and the one ready record",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);
      yield* advanceTemplate(api, build);
      fake.finishBuild(0);

      yield* Effect.all([advanceTemplate(api, build), advanceTemplate(api, build)], {
        concurrency: "unbounded",
      });
      const settled = yield* advanceTemplate(api, build);

      assert.equal(fake.snapshots.length, 1);
      assert.deepEqual(settled, { state: TEMPLATE_STATE.READY, snapshotId: fake.snapshots[0] });
    }),
);

it.effect(
  "a new image's template is built anew beside the old one, which the sweep deletes once it is old enough",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);
      const old = otherImage(build);
      yield* advanceTemplate(api, old);
      fake.finishBuild(0);
      const oldReady = yield* advanceTemplate(api, old);
      assert.equal(oldReady.state, TEMPLATE_STATE.READY);

      assert.equal((yield* advanceTemplate(api, build)).state, TEMPLATE_STATE.PREPARING);
      fake.finishBuild(0);
      const current = yield* advanceTemplate(api, build);

      assert.ok(current.state === TEMPLATE_STATE.READY);
      assert.notEqual(
        current.snapshotId,
        oldReady.state === TEMPLATE_STATE.READY ? oldReady.snapshotId : "",
      );
      assert.deepEqual(yield* sweepTemplates(api, build), {
        current: TEMPLATE_STATE.READY,
        deleted: 0,
        template: build.name,
        listed: 2,
      });

      yield* TestClock.adjust(NATIVE_TEMPLATE.SWEEP_AFTER);
      const swept = yield* sweepTemplates(api, build);

      assert.deepEqual(swept, {
        current: TEMPLATE_STATE.READY,
        deleted: 1,
        template: build.name,
        listed: 2,
      });
      assert.deepEqual(
        fake.sandboxes.filter((each) => !each.deleted).map((each) => each.name),
        [build.name],
      );
    }),
);

it.effect(
  "the sweep starts the current image's build with no cohort, plan, or setting to gate it",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);

      const swept = yield* sweepTemplates(api, build);

      assert.deepEqual(swept, {
        current: TEMPLATE_STATE.PREPARING,
        deleted: 0,
        template: build.name,
        listed: 1,
      });
      assert.equal(fake.commands.length, 1);
    }),
);

it.effect(
  "a failed preparation answers failed until its retry window passes, then is built again",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);
      yield* advanceTemplate(api, build);
      fake.finishBuild(1);

      assert.equal((yield* advanceTemplate(api, build)).state, TEMPLATE_STATE.FAILED);
      assert.equal((yield* advanceTemplate(api, build)).state, TEMPLATE_STATE.FAILED);
      assert.equal(fake.commands.length, 1);

      yield* TestClock.adjust(NATIVE_TEMPLATE.RETRY_AFTER);
      assert.equal((yield* advanceTemplate(api, build)).state, TEMPLATE_STATE.PREPARING);
      assert.equal(fake.commands.length, 2);
    }),
);

it.effect(
  "a reader retrying a failed build on a stale read leaves the replacement another built",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);
      yield* advanceTemplate(api, build);
      fake.finishBuild(1);
      yield* advanceTemplate(api, build);
      yield* TestClock.adjust(NATIVE_TEMPLATE.RETRY_AFTER);
      // Another reader retries the build whole between this reader's read and its own retry.
      fake.hooks.onceOnRead = async () => {
        // Its clock is the real one, long past the failure the fake's clock marked at zero.
        await Effect.runPromise(advanceTemplate(api, build));
      };

      const retried = yield* advanceTemplate(api, build);

      assert.equal(retried.state, TEMPLATE_STATE.PREPARING);
      const standing = fake.sandboxes.filter((each) => !each.deleted);
      assert.equal(standing.length, 1);
      assert.equal(fake.commands.length, 2);
      assert.equal(fake.commands[1]?.session, standing[0]?.currentSessionId);
    }),
);

it.effect(
  "a template stopped before its build was snapshotted is built again rather than opened",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);
      yield* advanceTemplate(api, build);
      const first = fake.sandboxes[0];
      assert.ok(first !== undefined);
      // Vercel stopped it at its timeout, which snapshots a persistent sandbox mid-build.
      first.status = "stopped";
      first.currentSnapshotId = "snap_half_built";

      assert.equal((yield* advanceTemplate(api, build)).state, TEMPLATE_STATE.PREPARING);

      assert.equal(first.deleted, true);
      assert.equal(fake.commands.length, 2);
      assert.equal(fake.snapshots.length, 0);
    }),
);

it.effect(
  "the seam waits on a build a bounded while, then fails as preparing; once built it answers the snapshot",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const seam = Layer.provide(agentSandboxImageFromTemplate(fixtureToken), fake.layer);
      const snapshotId = Effect.flatMap(AgentSandboxImage, (image) => image.snapshotId).pipe(
        Effect.provide(seam),
      );
      const waiting = yield* Effect.forkChild(Effect.result(snapshotId));
      yield* TestClock.adjust(Duration.sum(NATIVE_TEMPLATE.WAIT, NATIVE_TEMPLATE.POLL));
      const waited = yield* Fiber.join(waiting);
      assert.ok(Result.isFailure(waited) && waited.failure instanceof ImagePreparing);

      fake.finishBuild(0);
      const ready = yield* snapshotId;

      assert.deepEqual(ready, Option.some(fake.snapshots[0]));
    }),
);

it.effect("the template starts from the base image of the eve this repository installs", () =>
  Effect.sync(() => {
    const manifest = createRequire(import.meta.url).resolve("eve/package.json");
    const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
    assert.equal(EVE_BASE_IMAGE, `vcr.vercel.com/vercel/eve/base:${version.split("+")[0]}`);
  }),
);

it.effect(
  "a snapshot a launch hands back as gone has the template prepared again, and launches wait on the new build",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);
      yield* advanceTemplate(api, build);
      fake.finishBuild(0);
      const ready = yield* advanceTemplate(api, build);
      assert.ok(ready.state === TEMPLATE_STATE.READY);
      fake.goneSnapshots.add(ready.snapshotId);
      const image = yield* AgentSandboxImage.pipe(
        Effect.provide(
          Layer.provide(agentSandboxImageFromTemplate(fixtureToken, Duration.zero), fake.layer),
        ),
      );

      yield* image.snapshotGone(ready.snapshotId);
      const next = yield* Effect.result(image.snapshotId);

      assert.ok(Result.isFailure(next) && next.failure instanceof ImagePreparing);
      assert.equal(fake.sandboxes.filter((each) => !each.deleted).length, 1);
      assert.equal(fake.sandboxes[0]?.deleted, true);
      assert.equal(fake.commands.length, 2);
      fake.finishBuild(0);
      assert.deepEqual(yield* image.snapshotId, Option.some(fake.snapshots[1]));
    }),
);

it.effect(
  "a gone snapshot handed back after another reader already prepared the template again leaves the new one be",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);
      yield* advanceTemplate(api, build);
      fake.finishBuild(0);
      const first = yield* advanceTemplate(api, build);
      assert.ok(first.state === TEMPLATE_STATE.READY);
      yield* forgetSnapshot(api, build, first.snapshotId);
      fake.finishBuild(0);
      const second = yield* advanceTemplate(api, build);

      const late = yield* forgetSnapshot(api, build, first.snapshotId);

      assert.deepEqual(late, second);
      assert.equal(fake.commands.length, 2);
    }),
);

it.effect(
  "the sweep finds a ready template's lost snapshot at its next check and prepares the image again",
  () =>
    Effect.gen(function* () {
      const fake = vercel();
      const { api, build } = yield* setUp(fake);
      yield* advanceTemplate(api, build);
      fake.finishBuild(0);
      assert.deepEqual(yield* sweepTemplates(api, build), {
        current: TEMPLATE_STATE.READY,
        deleted: 0,
        template: build.name,
        listed: 1,
      });
      const lost = fake.snapshots[0];
      assert.ok(lost !== undefined);
      fake.goneSnapshots.add(lost);

      // A sweep between checks reads the template's record alone, which still names the snapshot.
      yield* TestClock.adjust(NATIVE_TEMPLATE.SWEEP_PERIOD);
      const between = yield* sweepTemplates(api, build);
      yield* TestClock.adjust(
        Duration.subtract(NATIVE_TEMPLATE.SNAPSHOT_CHECK, NATIVE_TEMPLATE.SWEEP_PERIOD),
      );
      const checked = yield* sweepTemplates(api, build);

      assert.equal(between.current, TEMPLATE_STATE.READY);
      assert.equal(checked.current, TEMPLATE_STATE.PREPARING);
      assert.equal(fake.commands.length, 2);
    }),
);
