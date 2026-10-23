/**
 * runner-sandbox-fake.ts -- Vercel Sandbox's REST API as a native harness's launch reaches it, faked as a store of what it was asked for, for the suites of `coder-host/runner-sessions.ts`'s harnesses.
 *
 * It keeps every sandbox, command, stdin, upload, network policy, and run it
 * was asked for, opens and resumes sandboxes as Vercel does, and answers a
 * list and a stop only where Vercel would (`vercel-sandbox-fake.ts`).
 * Synthetic team, project, and tokens throughout.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { gunzipSync } from "node:zlib";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { sandboxListRefusal, sandboxStopRefusal } from "./vercel-sandbox-fake.js";

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";

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
  snapshotId: string;
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
}

export interface FakeCommand {
  readonly id: string;
  readonly sandboxSessionId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly sudo: boolean;
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

/** Vercel Sandbox's REST API, as a store of the sandboxes and commands it was asked for. */
export function runnerSandboxApi() {
  const sandboxes: FakeSandbox[] = [];
  /** How many stdin writes with data the API refuses next, and with what status: a passing outage by default. */
  const failStdin = { remaining: 0, status: 502 };
  /** How many deletes the API refuses next, as a passing outage. */
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
  /** Whether a read that waits for a running command's exit is held until the reader gives up. */
  const waits = { hold: false };
  /** What a test does the moment a detached command has started, before the API answers; the exit a waited run ends on, 0 unless it says; and what it does as a waited run arrives, before it ends. */
  const hooks: {
    onStart?: ((command: FakeCommand) => Promise<void>) | undefined;
    runExit?: ((args: readonly string[]) => number) | undefined;
    onRun?: ((env: Readonly<Record<string, string>>) => Promise<void>) | undefined;
  } = {};
  /** The snapshots taken, in order. */
  const snapshots: string[] = [];
  let next = 0;
  const id = (prefix: string) => {
    next += 1;
    return `${prefix}_${next}`;
  };
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
      assert.equal(asked.persistent, true);
      // As Vercel answers a create from a snapshot it no longer holds (the SDK's `isSnapshotNotFoundError`).
      if (goneSnapshots.has(asked.source.snapshotId)) {
        return Response.json({ error: { code: "snapshot_not_found" } }, { status: 410 });
      }
      // A name a sandbox still holds is refused, which is what makes a name a lock.
      if (sandboxes.some((each) => !each.deleted && each.name === asked.name)) {
        return Response.json({ error: { code: "conflict" } }, { status: 409 });
      }
      const sandbox: FakeSandbox = {
        name: asked.name,
        status: "running",
        currentSessionId: id("sbs"),
        tags: asked.tags,
        snapshotId: asked.source.snapshotId,
        deleted: false,
        createdAt: sandboxes.length + 1,
        timeout: asked.timeout,
        resumedWith: [],
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
        if (asked.tags !== undefined) sandbox.tags = asked.tags;
        if (asked.timeout !== undefined) sandbox.timeout = asked.timeout;
        return Response.json({ sandbox: listed(sandbox) });
      }
      if (method === "DELETE" && failDelete.remaining > 0) {
        failDelete.remaining -= 1;
        return new Response(null, { status: 503 });
      }
      if (method === "DELETE") {
        sandbox.deleted = true;
        return Response.json({});
      }
      const resuming = parsed.searchParams.get("resume") === "true";
      if (resuming && sandbox.status === "stopped" && sandbox.snapshotExpired === true) {
        return Response.json({ error: { code: "snapshot_not_found" } }, { status: 410 });
      }
      if (resuming && sandbox.status === "stopped") {
        sandbox.status = "running";
        sandbox.currentSessionId = id("sbs");
        sandbox.resumedWith.push(sandbox.timeout);
      }
      return Response.json({ sandbox: listed(sandbox), session: { id: sandbox.currentSessionId } });
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
    if (rest === "snapshot") {
      // A snapshot stops the session it is taken of, so a second one asked of it is refused.
      const taking = sandboxes.find(
        (each) => !each.deleted && each.currentSessionId === sessionId && each.status === "running",
      );
      if (taking === undefined) return new Response(null, { status: 422 });
      const snapshot = id("snap");
      snapshots.push(snapshot);
      taking.status = "stopped";
      taking.currentSnapshotId = snapshot;
      return Response.json({ snapshot: { id: snapshot }, session: { id: sessionId } });
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
    if (rest === "cmd") {
      const asked = await body();
      if (asked.wait === true) {
        await hooks.onRun?.(asked.env ?? {});
        runs.push({ session: sessionId, args: asked.args, env: asked.env ?? {} });
        const exitCode = hooks.runExit?.(asked.args) ?? 0;
        return new Response(`${JSON.stringify({ command: { exitCode } })}\n`);
      }
      assert.equal(asked.attachStdin, true);
      const command: FakeCommand = {
        id: id("cmd"),
        sandboxSessionId: sessionId,
        command: asked.command,
        args: asked.args,
        cwd: asked.cwd,
        env: asked.env,
        sudo: asked.sudo,
        stdin: "",
        exitCode: null,
      };
      commands.push(command);
      await hooks.onStart?.(command);
      return Response.json({ command: { id: command.id, exitCode: null } });
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
  return {
    layer: fakeHttpClientLayer(respond),
    respond,
    sandboxes,
    commands,
    goneSnapshots,
    snapshots,
    uploads,
    policies,
    runs,
    failStdin,
    failDelete,
    failCommandReads,
    failPolicy,
    waits,
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
