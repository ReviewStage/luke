import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { gunzipSync } from "node:zlib";
import { RUNNER_ENV, type RunnerConfig } from "@repo/agent-runner/protocol";
import { Database } from "@repo/database/core/query";
import { runnerLine } from "@repo/database/schemas/runner-line";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { agentTag } from "../agents/machine/vercel-machine.js";
import type { NetworkPolicy } from "../agents/vercel-sandbox-api.js";
import {
  commandAnswered,
  commandLogsStreamed,
  commandRunStreamed,
  sandboxDeleted,
  sandboxesListed,
  sandboxFetchOver,
  sandboxFound,
  sandboxListRefusal,
  sandboxStopRefusal,
  sandboxTagsRefusal,
  sessionAnswered,
  snapshotOf,
} from "./vercel-sandbox-fake.js";

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";

const DEFAULT_USER = "ubuntu";

const DEFAULT_USER_READ = "id -un; id -gn";

export interface FakeSandbox {
  name: string;
  status: string;
  currentSessionId: string;
  tags: Record<string, string>;
  image: string;
  deleted: boolean;
  timeout: number;
  resumedWith: number[];
  snapshotExpired?: boolean;
  createdAt: number;
  currentSnapshotId?: string;
  mounts?: Record<string, { readonly drive: string; readonly mode: string }>;
}

export interface FakeCommand {
  readonly id: string;
  readonly sandboxSessionId: string;
  readonly user?: string;
  readonly agentId: string | undefined;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly sudo: boolean;
  readonly policiesBefore: number;
  stdin: string;
  exitCode: number | null;
  stderr?: string;
  recorded?: boolean;
}

export interface ReadCommand {
  readonly id: string;
  readonly exitCode: number | null;
  recorded?: boolean;
}

export async function commandRead(
  command: ReadCommand,
  url: URL,
  init: RequestInit,
  hold: boolean,
): Promise<Response> {
  const waits = url.searchParams.get("wait") === "true";
  if (waits && command.exitCode !== null) command.recorded = true;
  if (waits && command.exitCode === null && hold) {
    assert.ok(init.signal, "a held read needs a reader that can give up");
    await once(init.signal, "abort");
    throw new Error("the reader gave up");
  }
  const sessionId = /\/sessions\/([^/]+)\//u.exec(url.pathname)?.[1] ?? "";
  return Response.json(
    commandAnswered({
      id: command.id,
      sessionId,
      exitCode: command.recorded === true ? command.exitCode : null,
    }),
  );
}

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

function asUserCommand(command: string, args: readonly string[]) {
  const [flag, user, dashes, shell, , script, , cwd, ...rest] = args;
  if (command !== "sudo" || flag !== "-u" || dashes !== "--" || shell !== "bash") return undefined;
  if (user === undefined || script === undefined || cwd === undefined) return undefined;
  const env: Record<string, string> = {};
  let at = 0;
  if (rest[0] === "env") {
    at = 1;
    for (; at < rest.length; at += 1) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/su.exec(rest[at] ?? "");
      if (match === null) break;
      env[match[1] ?? ""] = match[2] ?? "";
    }
  }
  const [run = "", ...runArgs] = rest.slice(at);
  return { user, cwd, env, command: run, args: runArgs };
}

export function runnerSandboxApi() {
  const sandboxes: FakeSandbox[] = [];
  const failStdin = { remaining: 0, status: 502 };
  const failDelete = { remaining: 0 };
  const commands: FakeCommand[] = [];
  const uploads: Map<string, string>[] = [];
  const policies: { readonly session: string; readonly policy: unknown }[] = [];
  const runs: {
    readonly session: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
  }[] = [];
  const failCommandReads = { remaining: 0 };
  const failPolicy = { remaining: 0 };
  const holdPolicy = { remaining: 0 };
  const waits = { hold: false };
  const stopsAt: { call?: ((rest: string) => boolean) | undefined } = {};
  const snapshotting = { remaining: 0 };
  const hooks: {
    onStart?: ((command: FakeCommand) => Promise<void>) | undefined;
    runExit?: ((args: readonly string[]) => number) | undefined;
    onRun?:
      | ((
          env: Readonly<Record<string, string>>,
          command: string,
          args: readonly string[],
        ) => Promise<void>)
      | undefined;
  } = {};
  const drives = new Set<string>();
  const driveForks = new Map<string, string>();
  const releasingDrives = new Set<string>();
  const mountedIn = (drive: string) =>
    sandboxes.find(
      (each) =>
        !each.deleted &&
        each.status === "running" &&
        Object.values(each.mounts ?? {}).some((mount) => mount.drive === drive),
    );
  const driveFound = (name: string) => ({
    drive: {
      id: `drv_${name}`,
      name,
      projectId: PROJECT,
      region: "iad1",
      maxSizeBytes: 2 ** 40,
      createdAt: 1,
      updatedAt: 1,
      ...(mountedIn(name) === undefined
        ? undefined
        : { currentSandboxName: mountedIn(name)?.name }),
    },
  });
  const snapshots: string[] = [];
  const snapshotExpirations = new Map<string, unknown>();
  let next = 0;
  const id = (prefix: string) => {
    next += 1;
    return `${prefix}_${next}`;
  };
  const sessionIds = randomUUID();
  const mintSession = () => id(`sbs_${sessionIds}`);
  const listed = (sandbox: FakeSandbox) => ({
    name: sandbox.name,
    status: sandbox.status,
    currentSessionId: sandbox.currentSessionId,
    tags: sandbox.tags,
    createdAt: sandbox.createdAt,
    timeout: sandbox.timeout,
    ...(sandbox.currentSnapshotId === undefined
      ? undefined
      : { currentSnapshotId: sandbox.currentSnapshotId }),
  });
  const respond = async (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = init.method ?? "GET";
    assert.equal(parsed.searchParams.get("teamId"), TEAM);
    const body = async () => JSON.parse(await new Response(init.body).text());
    if (method === "POST" && path === "/api/v3/sandboxes") {
      const asked = await body();
      assert.equal(asked.projectId, PROJECT);
      assert.equal(typeof asked.persistent, "boolean");
      if (sandboxes.some((each) => !each.deleted && each.name === asked.name)) {
        return Response.json({ error: { code: "conflict" } }, { status: 409 });
      }
      const tagsRefused = sandboxTagsRefusal(asked.tags);
      if (tagsRefused !== undefined) return tagsRefused;
      const mounts: Record<string, { drive: string; mode: string }> = asked.mounts ?? {};
      for (const mount of Object.values(mounts)) {
        if (!drives.has(mount.drive)) return new Response(null, { status: 404 });
        if (mountedIn(mount.drive) !== undefined) {
          return Response.json({ error: { code: "conflict" } }, { status: 409 });
        }
      }
      const sandbox: FakeSandbox = {
        name: asked.name,
        status: "running",
        currentSessionId: mintSession(),
        tags: asked.tags,
        image: asked.image,
        deleted: false,
        createdAt: sandboxes.length + 1,
        timeout: asked.timeout,
        resumedWith: [],
        ...(asked.mounts === undefined ? undefined : { mounts }),
      };
      sandboxes.push(sandbox);
      return Response.json(sandboxFound(listed(sandbox)));
    }
    if (method === "GET" && path === "/api/v2/sandboxes") {
      const refused = sandboxListRefusal(parsed);
      if (refused !== undefined) return refused;
      const [key, value] = (parsed.searchParams.get("tags") ?? "").split(":");
      const found = sandboxes.filter(
        (each) => !each.deleted && key !== undefined && each.tags[key] === value,
      );
      return Response.json(sandboxesListed(found.map(listed)));
    }
    const fork = /^\/api\/v2\/sandboxes\/drives\/([^/]+)\/fork$/u.exec(path);
    if (method === "POST" && fork !== null) {
      const source = decodeURIComponent(fork[1] ?? "");
      if (!drives.has(source)) return new Response(null, { status: 404 });
      const { name } = await body();
      drives.add(name);
      driveForks.set(name, source);
      return Response.json(driveFound(name));
    }
    const drive = /^\/api\/v2\/sandboxes\/drives\/([^/]+)$/u.exec(path);
    if (drive !== null) {
      const name = decodeURIComponent(drive[1] ?? "");
      if (method === "POST") drives.add(name);
      if (!drives.has(name)) return new Response(null, { status: 404 });
      if (method === "DELETE") {
        if (mountedIn(name) !== undefined || releasingDrives.delete(name)) {
          return Response.json({ error: { code: "drive_attached" } }, { status: 409 });
        }
        const found = driveFound(name);
        drives.delete(name);
        return Response.json(found);
      }
      return Response.json(driveFound(name));
    }
    const named = /^\/api\/v2\/sandboxes\/([^/]+)$/u.exec(path);
    if (named !== null) {
      const name = decodeURIComponent(named[1] ?? "");
      const sandbox =
        sandboxes.find((each) => !each.deleted && each.name === name) ??
        sandboxes.find((each) => each.name === name);
      if (sandbox === undefined || sandbox.deleted) return new Response(null, { status: 404 });
      if (method === "PATCH") {
        const asked = await body();
        const tagsRefused = sandboxTagsRefusal(asked.tags);
        if (tagsRefused !== undefined) return tagsRefused;
        if (asked.tags !== undefined) sandbox.tags = asked.tags;
        if (asked.timeout !== undefined) sandbox.timeout = asked.timeout;
        return Response.json(sandboxDeleted(listed(sandbox)));
      }
      if (method === "DELETE" && failDelete.remaining > 0) {
        failDelete.remaining -= 1;
        return Response.json({ error: { code: "bad_request" } }, { status: 400 });
      }
      if (method === "DELETE") {
        if (sandbox.status === "running") {
          for (const mount of Object.values(sandbox.mounts ?? {})) releasingDrives.add(mount.drive);
        }
        sandbox.deleted = true;
        return Response.json(sandboxDeleted(listed(sandbox)));
      }
      const resuming = parsed.searchParams.get("resume") === "true";
      if (resuming && sandbox.status === "stopped" && sandbox.snapshotExpired === true) {
        return Response.json({ error: { code: "snapshot_not_found" } }, { status: 410 });
      }
      if (resuming && snapshotting.remaining > 0) {
        snapshotting.remaining -= 1;
        return Response.json(
          { error: { code: "sandbox_snapshotting", message: "Sandbox is being snapshotted." } },
          { status: 422 },
        );
      }
      if (resuming && (sandbox.status === "stopped" || sandbox.status === "stopping")) {
        sandbox.status = "running";
        sandbox.currentSessionId = mintSession();
        sandbox.resumedWith.push(sandbox.timeout);
      }
      return Response.json(sandboxFound(listed(sandbox)));
    }
    const session = /^\/api\/v2\/sandboxes\/sessions\/([^/]+)\/(.+)$/u.exec(path);
    assert.ok(session !== null, `an unexpected call: ${method} ${path}`);
    const [, sessionId = "", rest = ""] = session;
    if (rest === "stop") {
      const refused = sandboxStopRefusal(init);
      if (refused !== undefined) return refused;
      for (const sandbox of sandboxes.filter((each) => each.currentSessionId === sessionId)) {
        sandbox.status = "stopped";
      }
      for (const command of commands.filter((each) => each.sandboxSessionId === sessionId)) {
        command.exitCode = command.exitCode ?? 143;
      }
      return Response.json(sessionAnswered({ id: sessionId, status: "stopped" }));
    }
    const current = sandboxes.find((each) => !each.deleted && each.currentSessionId === sessionId);
    if (current?.status === "running" && stopsAt.call?.(rest) === true) {
      stopsAt.call = undefined;
      current.status = "stopping";
      for (const command of commands.filter((each) => each.sandboxSessionId === sessionId)) {
        command.exitCode = command.exitCode ?? 143;
      }
    }
    if (current?.status === "stopping") {
      return Response.json(
        {
          error: {
            code: "sandbox_stopping",
            message: "Sandbox is stopping and no longer accepts commands.",
          },
        },
        { status: 422 },
      );
    }
    if (rest === "snapshot") {
      const taking = sandboxes.find(
        (each) => !each.deleted && each.currentSessionId === sessionId && each.status === "running",
      );
      if (taking === undefined) return new Response(null, { status: 422 });
      const snapshot = id("snap");
      snapshots.push(snapshot);
      snapshotExpirations.set(snapshot, (await body()).expiration);
      taking.status = "stopped";
      taking.currentSnapshotId = snapshot;
      return Response.json({
        snapshot: snapshotOf({ id: snapshot, status: "created", sourceSessionId: sessionId }),
        ...sessionAnswered({ id: sessionId, status: "stopped" }),
      });
    }
    if (rest === "network-policy" && holdPolicy.remaining > 0) {
      holdPolicy.remaining -= 1;
      assert.ok(init.signal, "a held update needs a caller that can give up");
      await once(init.signal, "abort");
      throw new Error("the caller gave up");
    }
    if (rest === "network-policy" && failPolicy.remaining > 0) {
      failPolicy.remaining -= 1;
      return Response.json({ error: { code: "bad_request" } }, { status: 400 });
    }
    if (rest === "network-policy") {
      policies.push({ session: sessionId, policy: await body() });
      return Response.json(sessionAnswered({ id: sessionId, status: "running" }));
    }
    if (rest === "fs/write") {
      assert.equal(new Headers(init.headers).get("content-type"), "application/gzip");
      if (typeof init.body !== "string") {
        uploads.push(untar(new Uint8Array(await new Response(init.body).arrayBuffer())));
      }
      return Response.json({});
    }
    if (rest === "fs/mkdir") return Response.json({});
    if (rest === "cmd") {
      const asked = await body();
      if (asked.wait === true) {
        await hooks.onRun?.(asked.env ?? {}, asked.command, asked.args);
        runs.push({ session: sessionId, args: asked.args, env: asked.env ?? {} });
        const exitCode = hooks.runExit?.(asked.args) ?? 0;
        const stdout =
          asked.args[1] === DEFAULT_USER_READ ? `${DEFAULT_USER}\n${DEFAULT_USER}\n` : "";
        return commandRunStreamed({ id: id("cmd"), sessionId }, { exitCode, stdout, stderr: "" });
      }
      assert.equal(asked.attachStdin, true);
      const asUser = asUserCommand(asked.command, asked.args);
      const command: FakeCommand = {
        id: id("cmd"),
        sandboxSessionId: sessionId,
        ...(asUser === undefined ? undefined : { user: asUser.user }),
        agentId: agentTag(
          sandboxes.find((sandbox) => sandbox.currentSessionId === sessionId)?.tags,
        ),
        command: asUser?.command ?? asked.command,
        args: asUser?.args ?? asked.args,
        cwd: asUser?.cwd ?? asked.cwd,
        env: asUser?.env ?? asked.env,
        sudo: asked.sudo,
        policiesBefore: policies.length,
        stdin: "",
        exitCode: null,
      };
      commands.push(command);
      await hooks.onStart?.(command);
      return Response.json(commandAnswered({ id: command.id, sessionId, exitCode: null }));
    }
    const commandCall = /^cmd\/([^/]+)(\/stdin|\/kill|\/logs)?$/u.exec(rest);
    assert.ok(commandCall !== null, `an unexpected call: ${method} ${path}`);
    const command = commands.find((each) => each.id === commandCall[1]);
    if (command === undefined) return new Response(null, { status: 404 });
    if (commandCall[2] === "/kill") {
      command.exitCode = command.exitCode ?? 143;
      return Response.json(
        commandAnswered({ id: command.id, sessionId, exitCode: command.exitCode }),
      );
    }
    if (commandCall[2] === "/logs") return commandLogsStreamed(command.stderr ?? "");
    if (commandCall[2] === "/stdin") {
      if (command.exitCode !== null) {
        return Response.json(
          { error: { code: "command_not_found_or_exited", message: "the command exited" } },
          { status: 404 },
        );
      }
      const asked = await body();
      if (asked.data !== undefined && failStdin.remaining > 0) {
        failStdin.remaining -= 1;
        return Response.json(
          { error: { code: "stdin_refused", message: "the command's stdin was refused" } },
          { status: failStdin.status },
        );
      }
      if (asked.data !== undefined) {
        const bytes = Buffer.from(command.stdin, "utf8");
        const data = Buffer.from(asked.data, "base64");
        command.stdin = Buffer.concat([bytes.subarray(0, asked.offset), data]).toString("utf8");
      }
      return Response.json(
        commandAnswered(
          {
            id: command.id,
            sessionId,
            exitCode: command.recorded === true ? command.exitCode : null,
          },
          Buffer.byteLength(command.stdin),
        ),
      );
    }
    if (failCommandReads.remaining > 0) {
      failCommandReads.remaining -= 1;
      return Response.json({ error: { code: "bad_request" } }, { status: 400 });
    }
    return commandRead(command, parsed, init, waits.hold);
  };
  const policyAtStart = (command: FakeCommand | undefined) =>
    command === undefined
      ? undefined
      : policies
          .slice(0, command.policiesBefore)
          .findLast((each) => each.session === command.sandboxSessionId)?.policy;
  return {
    layer: Layer.merge(fakeHttpClientLayer(respond), sandboxFetchOver(respond)),
    respond,
    policyAtStart,
    sandboxes,
    drives,
    driveForks,
    commands,
    snapshots,
    snapshotExpirations,
    uploads,
    policies,
    runs,
    failStdin,
    failDelete,
    failCommandReads,
    failPolicy,
    holdPolicy,
    waits,
    stopsAt,
    snapshotting,
    hooks,
  };
}

export function linesOf(command: FakeCommand | undefined): unknown[] {
  assert.ok(command !== undefined);
  return command.stdin
    .split("\n")
    .filter((text) => text !== "")
    .map((text) => JSON.parse(text));
}

export const launchLines = (command: FakeCommand | undefined) =>
  Effect.gen(function* () {
    assert.ok(command?.agentId !== undefined);
    const [config, ...stdin] = linesOf(command) as [RunnerConfig, ...unknown[]];
    const db = yield* Database;
    const queued = yield* db
      .select({ text: runnerLine.text })
      .from(runnerLine)
      .where(
        and(eq(runnerLine.agentId, command.agentId), eq(runnerLine.launch, config.firstSequence)),
      )
      .orderBy(asc(runnerLine.seq));
    return [config, ...stdin, ...queued.map((row): unknown => JSON.parse(row.text))];
  });

export const runnerTook = (agentId: string) =>
  Effect.flatMap(Database, (db) =>
    db
      .update(runnerLine)
      .set({ acceptedAt: new Date(0) })
      .where(and(eq(runnerLine.agentId, agentId), isNull(runnerLine.acceptedAt))),
  );

export function swappedBearer(
  policy: unknown,
  host: string,
  placeholder: string | undefined,
): string | undefined {
  const sent = policy as NetworkPolicy | undefined;
  if (sent === undefined || !("allow" in sent) || placeholder === undefined) return undefined;
  const swap = (sent.allow[host] ?? []).find((rule) =>
    (rule.match?.headers ?? []).some(
      (header) =>
        header.key.exact === "authorization" && header.value.exact === `Bearer ${placeholder}`,
    ),
  );
  const set = swap?.transform[0]?.headers.authorization;
  return set?.startsWith("Bearer ") ? set.slice("Bearer ".length) : undefined;
}

export function launchBearer(
  api: ReturnType<typeof runnerSandboxApi>,
  command: FakeCommand | undefined,
  host: string,
): string | undefined {
  return swappedBearer(api.policyAtStart(command), host, command?.env[RUNNER_ENV.BEARER]);
}
