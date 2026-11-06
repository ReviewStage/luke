/**
 * runner-sandbox-fake.ts -- Vercel Sandbox's REST API as a native harness's launch reaches it, faked as a store of what it was asked for, for the suites of `coder-host/runner-sessions.ts`'s harnesses.
 *
 * It keeps every sandbox, command, stdin, upload, network policy, and run it
 * was asked for, opens and resumes sandboxes as Vercel does, and answers a
 * list and a stop only where Vercel would (`vercel-sandbox-fake.ts`). A
 * command `@vercel/sandbox` starts as a user (`asUser`) is kept as that user's
 * command, its environment read back off `sudo`'s command line, where the SDK
 * writes it.
 * Beside it, the lines a launch reads from our store (`runner_line`),
 * read back the way a test reads a command's stdin, and stamped taken as a
 * runner's ACCEPTED would, which no fake runner posts. Synthetic team,
 * project, and tokens throughout.
 */

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
import { runnerTag } from "../agents/machine/vercel-machine.js";
import type { NetworkPolicy } from "../agents/vercel-sandbox-api.js";
import {
  sandboxDeleted,
  sandboxFetchOver,
  sandboxFound,
  sandboxListRefusal,
  sandboxStopRefusal,
  sandboxTagsRefusal,
} from "./vercel-sandbox-fake.js";

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";

/** The user and group the image runs the API's commands as, which `@vercel/sandbox` reads off `id` before it makes a user. */
const DEFAULT_USER = "ubuntu";

/** What `@vercel/sandbox` runs to read the default user and its group. */
const DEFAULT_USER_READ = "id -un; id -gn";

/** An unsigned token naming the fixture's project and team, a year from expiring. */
export function fixtureToken(): string {
  const exp = Math.floor(Date.UTC(2027, 9, 14) / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ project_id: PROJECT, owner_id: TEAM, exp }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

export interface FakeSandbox {
  name: string;
  status: string;
  currentSessionId: string;
  tags: Record<string, string>;
  /** The image it was created from, where it was. */
  image?: string;
  /** The snapshot it was created from, where it was. */
  snapshotId?: string;
  deleted: boolean;
  /** The timeout each session of the sandbox opens with, as its create or a later update set it. */
  timeout: number;
  /** The timeout each session a resume opened started with, in order. */
  resumedWith: number[];
  /** Whether the snapshot the sandbox resumes from expired, so a resume is answered 410 as Vercel answers it. */
  snapshotExpired?: boolean;
  /** When the sandbox was created, as Vercel's list says it: later for each sandbox opened. */
  createdAt: number;
  /** The snapshot it resumes from, which its last snapshot made; none before one is taken. */
  currentSnapshotId?: string;
  /** The drives its create mounted, by path, as the create's body carried them. */
  mounts?: Record<string, { readonly drive: string; readonly mode: string }>;
}

export interface FakeCommand {
  readonly id: string;
  readonly sandboxSessionId: string;
  /** The user `@vercel/sandbox` started the command as (`asUser`); none for one the API started as its own. */
  readonly user?: string;
  /** The agent the command's sandbox was tagged for as it started, whose queued lines a launch reads. */
  readonly agentId: string | undefined;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly sudo: boolean;
  /** How many network policies the API had taken as it started, which `policyAtStart` reads its session's from. */
  readonly policiesBefore: number;
  stdin: string;
  exitCode: number | null;
  /** What the command printed on stderr, which its logs answer. */
  stderr?: string;
  /** Whether Vercel recorded the exit, which it does only once a read that waits for it saw it. */
  recorded?: boolean;
}

/** A command as a read of its exit finds it: its id, the exit it has, and whether Vercel recorded it. */
export interface ReadCommand {
  readonly id: string;
  readonly exitCode: number | null;
  recorded?: boolean;
}

/**
 * A read of a command, as Vercel answers it: a plain read answers no exit
 * until a read that waits (`wait=true`) has seen the command exit, and one
 * that waits records the exit it sees. A command still running holds a
 * waiting read until the reader gives up where `hold` is set, and answers it
 * at once with no exit otherwise, as a hold past the reader's wait ends.
 */
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
  return Response.json({
    command: { id: command.id, exitCode: command.recorded === true ? command.exitCode : null },
  });
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

/**
 * A command `@vercel/sandbox`'s `asUser` started, as it wrote it:
 * `sudo -u <user> -- bash -c <cd and exec> bash <cwd> [env K=V…] <command> <args…>`,
 * read back as the user's command, its folder, and its environment; none for
 * a command written any other way.
 */
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

/** A command as `@vercel/sandbox` reads one: every field its check of the answer asks for. */
function commandAnswer(
  id: string,
  sessionId: string,
  asked: { command: string; args: string[]; cwd?: string },
  exitCode: number | null,
) {
  return {
    command: {
      id,
      name: asked.command,
      args: asked.args,
      cwd: asked.cwd ?? "/",
      sessionId,
      exitCode,
      startedAt: 0,
    },
  };
}

/** Vercel Sandbox's REST API, as a store of the sandboxes and commands it was asked for. */
export function runnerSandboxApi() {
  const sandboxes: FakeSandbox[] = [];
  /** How many stdin writes with data the API refuses next, and with what status: a passing outage by default. */
  const failStdin = { remaining: 0, status: 502 };
  /**
   * How many deletes the API refuses next. Note that the refusal is a 400
   * rather than a passing outage's 503, because `@vercel/sandbox` tries a
   * 5xx again on a real timer, so only a status it never retries fails the
   * delete at once, as a test reads it.
   */
  const failDelete = { remaining: 0 };
  const commands: FakeCommand[] = [];
  /** The snapshots Vercel no longer holds, which a create from one is refused for. */
  const goneSnapshots = new Set<string>();
  const uploads: Map<string, string>[] = [];
  const policies: { readonly session: string; readonly policy: unknown }[] = [];
  const runs: {
    readonly session: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
  }[] = [];
  /** How many reads of a command the API refuses next, as a passing outage. */
  const failCommandReads = { remaining: 0 };
  /** How many network policy updates the API refuses next, as a passing outage. */
  const failPolicy = { remaining: 0 };
  /** How many network policy updates the API holds next, answering none until the caller gives up. */
  const holdPolicy = { remaining: 0 };
  /** Whether a read that waits for a running command's exit is held until the reader gives up. */
  const waits = { hold: false };
  /**
   * The call to a session at which its sandbox begins to stop, as a launch's
   * end or the sweep stops it a moment before a send reaches it, by the
   * path past the session: that call and every one after it are answered
   * 422 `sandbox_stopping`, as Vercel answers them, until a resume opens the
   * sandbox's next session.
   */
  const stopsAt: { call?: ((rest: string) => boolean) | undefined } = {};
  /** What a test does the moment a detached command has started, before the API answers; the exit a waited run ends on, 0 unless it says; and what it does as a waited run arrives, before it ends. */
  const hooks: {
    onStart?: ((command: FakeCommand) => Promise<void>) | undefined;
    runExit?: ((args: readonly string[]) => number) | undefined;
    onRun?: ((env: Readonly<Record<string, string>>, command: string) => Promise<void>) | undefined;
  } = {};
  /** The drives standing, by name. */
  const drives = new Set<string>();
  /** The live running sandbox a drive is mounted in, which Vercel refuses the drive's delete and a second mount for. */
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
  /** The snapshots taken, in order. */
  const snapshots: string[] = [];
  /** The expiration each snapshot was asked with, by its id, as the API's body carried it. */
  const snapshotExpirations = new Map<string, unknown>();
  let next = 0;
  const id = (prefix: string) => {
    next += 1;
    return `${prefix}_${next}`;
  };
  /** A sandbox session's id, unique beyond this fake as Vercel's are, since a firewall's record in the suite's database is kept by it. */
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
      // As Vercel answers a create from a snapshot it no longer holds (the SDK's `isSnapshotNotFoundError`).
      if (asked.source !== undefined && goneSnapshots.has(asked.source.snapshotId)) {
        return Response.json({ error: { code: "snapshot_not_found" } }, { status: 410 });
      }
      // A name a sandbox still holds is refused, which is what makes a name a lock.
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
        ...(asked.source === undefined
          ? { image: asked.image }
          : { snapshotId: asked.source.snapshotId }),
        deleted: false,
        createdAt: sandboxes.length + 1,
        timeout: asked.timeout,
        resumedWith: [],
        ...(asked.mounts === undefined ? undefined : { mounts }),
      };
      sandboxes.push(sandbox);
      return Response.json({ sandbox: listed(sandbox), session: { id: sandbox.currentSessionId } });
    }
    if (method === "GET" && path === "/api/v2/sandboxes") {
      const prefix = parsed.searchParams.get("namePrefix");
      if (prefix !== null) {
        const named = sandboxes
          .filter((each) => !each.deleted && each.name.startsWith(prefix))
          .sort((left, right) => left.name.localeCompare(right.name));
        return Response.json({ sandboxes: named.map(listed), pagination: { next: null } });
      }
      const refused = sandboxListRefusal(parsed);
      if (refused !== undefined) return refused;
      const [key, value] = (parsed.searchParams.get("tags") ?? "").split(":");
      const found = sandboxes.filter(
        (each) => !each.deleted && key !== undefined && each.tags[key] === value,
      );
      return Response.json({ sandboxes: found.map(listed) });
    }
    const drive = /^\/api\/v2\/sandboxes\/drives\/([^/]+)$/u.exec(path);
    if (drive !== null) {
      const name = decodeURIComponent(drive[1] ?? "");
      if (method === "POST") drives.add(name);
      if (!drives.has(name)) return new Response(null, { status: 404 });
      if (method === "DELETE") {
        if (mountedIn(name) !== undefined) {
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
      // A name deleted and taken again is the new sandbox's, as Vercel holds one sandbox per name.
      const name = decodeURIComponent(named[1] ?? "");
      const sandbox =
        sandboxes.find((each) => !each.deleted && each.name === name) ??
        sandboxes.find((each) => each.name === name);
      if (sandbox === undefined || sandbox.deleted) return new Response(null, { status: 404 });
      if (method === "PATCH") {
        // Only the fields given change, as Vercel's update takes them.
        const asked = await body();
        const tagsRefused = sandboxTagsRefusal(asked.tags);
        if (tagsRefused !== undefined) return tagsRefused;
        if (asked.tags !== undefined) sandbox.tags = asked.tags;
        if (asked.timeout !== undefined) sandbox.timeout = asked.timeout;
        return Response.json({ sandbox: listed(sandbox) });
      }
      if (method === "DELETE" && failDelete.remaining > 0) {
        failDelete.remaining -= 1;
        return Response.json({ error: { code: "bad_request" } }, { status: 400 });
      }
      if (method === "DELETE") {
        sandbox.deleted = true;
        return Response.json(sandboxDeleted(listed(sandbox)));
      }
      const resuming = parsed.searchParams.get("resume") === "true";
      if (resuming && sandbox.status === "stopped" && sandbox.snapshotExpired === true) {
        return Response.json({ error: { code: "snapshot_not_found" } }, { status: 410 });
      }
      // A resume of a sandbox still stopping waits the stop out and opens its next session, which
      // `@vercel/sandbox`'s `withResume` relies on.
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
      return Response.json({ session: { id: sessionId } });
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
      // A snapshot stops the session it is taken of, so a second one asked of it is refused.
      const taking = sandboxes.find(
        (each) => !each.deleted && each.currentSessionId === sessionId && each.status === "running",
      );
      if (taking === undefined) return new Response(null, { status: 422 });
      const snapshot = id("snap");
      snapshots.push(snapshot);
      snapshotExpirations.set(snapshot, (await body()).expiration);
      taking.status = "stopped";
      taking.currentSnapshotId = snapshot;
      return Response.json({ snapshot: { id: snapshot }, session: { id: sessionId } });
    }
    if (rest === "network-policy" && holdPolicy.remaining > 0) {
      holdPolicy.remaining -= 1;
      assert.ok(init.signal, "a held update needs a caller that can give up");
      await once(init.signal, "abort");
      throw new Error("the caller gave up");
    }
    if (rest === "network-policy" && failPolicy.remaining > 0) {
      failPolicy.remaining -= 1;
      return new Response(null, { status: 503 });
    }
    if (rest === "network-policy") {
      policies.push({ session: sessionId, policy: await body() });
      return Response.json({});
    }
    if (rest === "fs/write") {
      assert.equal(new Headers(init.headers).get("content-type"), "application/gzip");
      // Note that an upload relayed as text through GitHub's fake is not an archive any more, and is not kept.
      if (typeof init.body !== "string") {
        uploads.push(untar(new Uint8Array(await new Response(init.body).arrayBuffer())));
      }
      return Response.json({});
    }
    if (rest === "fs/mkdir") return Response.json({});
    if (rest === "cmd") {
      const asked = await body();
      if (asked.wait === true) {
        await hooks.onRun?.(asked.env ?? {}, asked.command);
        runs.push({ session: sessionId, args: asked.args, env: asked.env ?? {} });
        const exitCode = hooks.runExit?.(asked.args) ?? 0;
        const ran = id("cmd");
        const stdout =
          asked.args[1] === DEFAULT_USER_READ
            ? [{ stream: "stdout", data: `${DEFAULT_USER}\n${DEFAULT_USER}\n` }]
            : [];
        const lines = [
          commandAnswer(ran, sessionId, asked, null),
          ...stdout,
          commandAnswer(ran, sessionId, asked, exitCode),
        ];
        return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""), {
          headers: { "content-type": "application/x-ndjson" },
        });
      }
      assert.equal(asked.attachStdin, true);
      const asUser = asUserCommand(asked.command, asked.args);
      const command: FakeCommand = {
        id: id("cmd"),
        sandboxSessionId: sessionId,
        ...(asUser === undefined ? undefined : { user: asUser.user }),
        agentId: runnerTag(
          sandboxes.find((sandbox) => sandbox.currentSessionId === sessionId)?.tags,
          "AGENT",
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
      return Response.json(commandAnswer(command.id, sessionId, asked, null));
    }
    const commandCall = /^cmd\/([^/]+)(\/stdin|\/kill|\/logs)?$/u.exec(rest);
    assert.ok(commandCall !== null, `an unexpected call: ${method} ${path}`);
    const command = commands.find((each) => each.id === commandCall[1]);
    if (command === undefined) return new Response(null, { status: 404 });
    if (commandCall[2] === "/kill") {
      command.exitCode = command.exitCode ?? 143;
      return Response.json({ command: { id: command.id, exitCode: command.exitCode } });
    }
    if (commandCall[2] === "/logs") {
      const lines =
        command.stderr === undefined ? [] : [{ stream: "stderr", data: command.stderr }];
      return new Response(lines.map((each) => `${JSON.stringify(each)}\n`).join(""), {
        headers: { "content-type": "application/x-ndjson" },
      });
    }
    if (commandCall[2] === "/stdin") {
      // Vercel refuses stdin to a command that already exited.
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
      return Response.json({
        command: { id: command.id, exitCode: command.recorded === true ? command.exitCode : null },
        bytesWritten: Buffer.byteLength(command.stdin),
      });
    }
    if (failCommandReads.remaining > 0) {
      failCommandReads.remaining -= 1;
      return new Response(null, { status: 503 });
    }
    return commandRead(command, parsed, init, waits.hold);
  };
  /** The network policy a command's session stood at as it started: the last one set for that session by then, none where none was. */
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
    commands,
    goneSnapshots,
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
    hooks,
  };
}

/** The lines a command's stdin holds, each read back. */
export function linesOf(command: FakeCommand | undefined): unknown[] {
  assert.ok(command !== undefined);
  return command.stdin
    .split("\n")
    .filter((text) => text !== "")
    .map((text) => JSON.parse(text));
}

/**
 * The lines a launch was handed: its config on its stdin, then each line
 * queued for it to read, in the order they were queued (`runner_line`).
 */
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

/** Every message queued for the agent's runner stamped taken, as each one's ACCEPTED would, which the fake runner never posts. */
export const runnerTook = (agentId: string) =>
  Effect.flatMap(Database, (db) =>
    db
      .update(runnerLine)
      .set({ acceptedAt: new Date(0) })
      .where(and(eq(runnerLine.agentId, agentId), isNull(runnerLine.acceptedAt))),
  );

/**
 * The bearer a network policy swaps in on the host given for a request that
 * presents the placeholder as its bearer, as the firewall would set it on
 * the way out; none where the policy carries no such swap.
 */
export function swappedBearer(
  policy: unknown,
  host: string,
  placeholder: string | undefined,
): string | undefined {
  // SAFETY: the policy is the body the API was sent, a `NetworkPolicy` as `updateNetworkPolicy` spells it.
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

/** The bearer a launch's runner reaches the host given with: what the policy standing as its command started swaps in for the placeholder its environment holds. */
export function launchBearer(
  api: ReturnType<typeof runnerSandboxApi>,
  command: FakeCommand | undefined,
  host: string,
): string | undefined {
  return swappedBearer(api.policyAtStart(command), host, command?.env[RUNNER_ENV.BEARER]);
}
