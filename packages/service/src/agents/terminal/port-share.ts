/**
 * port-share.ts -- one port of an agent's running sandbox shared by a public link: the helper that serves it, the route Vercel opens to the helper, and the tag that marks the sandbox shared.
 *
 * Vercel serves a sandbox's port on a public route, which anyone holding its
 * address may open. Only the helper's own fixed port is ever routed: the
 * helper, one small Node process started detached in the running session,
 * pipes each connection to `127.0.0.1` at the port shared, and rewrites the
 * `Host` and `Origin` request headers to `localhost` at that port as they
 * pass, so a dev server that answers only on localhost still answers. A
 * WebSocket upgrade passes as any other bytes do. The port shared is read
 * from a file in the workspace's state folder at each connection, so
 * sharing another port rewrites the file and the helper already running
 * serves it; a second helper finds the port taken and leaves. Each
 * connection writes the time to a file beside it, the share's last visit,
 * which the sweep reads to close a link no one has visited lately
 * (`maintenance/port-share-sweep.ts`); starting the helper counts as one.
 *
 * The share is marked on the sandbox by a tag, which the sweep lists by.
 * Closing it closes the route, drops the tag, and removes the folder, which
 * the helper notices and leaves. Nothing here reads a byte the link carries.
 */

import { Duration, Effect } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { LINK_SANDBOX_STATE_FOLDER, SANDBOX_STATE_FOLDER } from "../sandbox-state-folder.js";
import {
  type CommandAsk,
  type ListedSandbox,
  SANDBOX_CALL,
  type SandboxSessionApi,
  SandboxUnavailable,
  type VercelSandboxApi,
} from "../vercel-sandbox-api.js";

export const PORT_SHARE = {
  /** The one port routed publicly: the helper's, which no dev server is likely to take. */
  HELPER_PORT: 48_211,
  /** How long a link stays open past its last visit. */
  IDLE: Duration.minutes(10),
  /** The tag a shared sandbox carries, and its one value. */
  TAG: "portShare",
  TAG_ON: "on",
  /** The folder the port shared and the last visit are written in. */
  FOLDER: `${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}/${SANDBOX_STATE_FOLDER}/share`,
} as const;

/** How often the sweep reads a share's last visit, which the lease must outlast. */
const SWEEP_EVERY = Duration.minutes(1);

/** The files in the folder: the port shared, and the last visit in epoch milliseconds. */
const SHARE_FILE = { PORT: "port", VISIT: "visit" } as const;

/** The helper, as Node runs it with the port it listens on and its folder as its arguments. */
export const PORT_SHARE_HELPER_SOURCE = `"use strict";
const net = require("node:net");
const fs = require("node:fs");
const { Transform } = require("node:stream");
const listen = Number(process.argv[1]);
const folder = process.argv[2];
const portFile = folder + "/${SHARE_FILE.PORT}";
const visited = () => { try { fs.writeFileSync(folder + "/${SHARE_FILE.VISIT}", String(Date.now())); } catch {} };
const target = () => { try { return Number(fs.readFileSync(portFile, "utf8")); } catch { return 0; } };
const localhost = (port) => new Transform({
  transform(bytes, _, done) {
    const head = bytes.toString("latin1").replace(/\\r\\n(host|origin):[^\\r\\n]*/gi, (_, name) =>
      name.toLowerCase() === "host" ? "\\r\\n" + name + ": localhost:" + port : "\\r\\n" + name + ": http://localhost:" + port);
    done(null, Buffer.from(head, "latin1"));
  },
});
const server = net.createServer((client) => {
  const port = target();
  if (!Number.isInteger(port) || port <= 0) return client.destroy();
  visited();
  const app = net.connect(port, "127.0.0.1");
  client.pipe(localhost(port)).pipe(app);
  app.pipe(client);
  client.on("error", () => app.destroy());
  app.on("error", () => client.destroy());
  client.on("close", () => app.destroy());
  app.on("close", () => client.destroy());
});
visited();
server.on("error", () => process.exit(0));
server.listen(listen, "0.0.0.0");
setInterval(() => { if (!fs.existsSync(portFile)) process.exit(0); }, 2000);
`;

/** Writes the port shared and starts the helper in the workspace, its output dropped. */
function startHelper(port: number): CommandAsk {
  const workspace = REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE;
  return {
    command: "sh",
    args: [
      "-c",
      `cd ${workspace} && ${LINK_SANDBOX_STATE_FOLDER} && mkdir -p ${PORT_SHARE.FOLDER} && printf %s "$1" >${PORT_SHARE.FOLDER}/${SHARE_FILE.PORT} && exec node --no-warnings -e "$2" "$3" ${PORT_SHARE.FOLDER} >/dev/null 2>&1`,
      "sh",
      String(port),
      PORT_SHARE_HELPER_SOURCE,
      String(PORT_SHARE.HELPER_PORT),
    ],
  };
}

/** Reads the port shared, then the last visit, one a line. */
function readShare(): CommandAsk {
  return {
    command: "sh",
    args: [
      "-c",
      `cat ${PORT_SHARE.FOLDER}/${SHARE_FILE.PORT}; echo; cat ${PORT_SHARE.FOLDER}/${SHARE_FILE.VISIT}`,
    ],
  };
}

/** The sandbox's tags with the share's mark set or dropped. */
function tagsOf(sandbox: ListedSandbox, shared: boolean): Record<string, string> {
  const { [PORT_SHARE.TAG]: _mark, ...rest } = sandbox.tags ?? {};
  return shared ? { ...rest, [PORT_SHARE.TAG]: PORT_SHARE.TAG_ON } : rest;
}

/** The instant a share last visited at the instant given holds its sandbox's lease to: the idle bound, and the minute the sweep may wait to move it on. */
export function shareHeldUntil(visitedAt: number): Date {
  return new Date(visitedAt + Duration.toMillis(Duration.sum(PORT_SHARE.IDLE, SWEEP_EVERY)));
}

/** The share as the folder holds it: the port shared and its last visit; none where it holds no port. */
export function readSharedPort(
  running: SandboxSessionApi,
): Effect.Effect<
  { readonly port: number; readonly visitedAt: number } | undefined,
  SandboxUnavailable
> {
  return Effect.map(running.run(readShare()), (run) => {
    const [port, visitedAt] = run.stdout.split("\n").map(Number);
    return port === undefined || !Number.isInteger(port) || port <= 0
      ? undefined
      : { port, visitedAt: visitedAt ?? 0 };
  });
}

/** Shares the port from the running sandbox, replacing any shared before, answering its public link. */
export function sharePort(
  api: VercelSandboxApi,
  sandbox: ListedSandbox,
  running: SandboxSessionApi,
  port: number,
): Effect.Effect<string, SandboxUnavailable> {
  return Effect.gen(function* () {
    yield* running.start({ ...startHelper(port), env: {}, sudo: false });
    const routes = yield* api.updatePorts(
      sandbox.name,
      [PORT_SHARE.HELPER_PORT],
      tagsOf(sandbox, true),
    );
    const route = routes.find((each) => each.port === PORT_SHARE.HELPER_PORT);
    if (route === undefined) {
      return yield* new SandboxUnavailable({ call: SANDBOX_CALL.PORTS, detail: "no route" });
    }
    return route.url;
  });
}

/** Closes the sandbox's share: no public route, no mark, and, while it runs, the helper gone with its folder. */
export function unsharePort(
  api: VercelSandboxApi,
  sandbox: ListedSandbox,
  running: SandboxSessionApi | undefined,
): Effect.Effect<void, SandboxUnavailable> {
  return Effect.gen(function* () {
    yield* api.updatePorts(sandbox.name, [], tagsOf(sandbox, false));
    if (running !== undefined)
      yield* running.run({ command: "rm", args: ["-rf", PORT_SHARE.FOLDER] });
  });
}

/** The port the running sandbox shares now and its link: its helper's route and the port the helper serves. */
export function sharedPortOf(
  api: VercelSandboxApi,
  sandbox: ListedSandbox,
  running: SandboxSessionApi,
): Effect.Effect<{ readonly port: number; readonly url: string } | null, SandboxUnavailable> {
  return Effect.gen(function* () {
    const named = yield* api.getNamed(sandbox.name);
    const route = named?.routes?.find((each) => each.port === PORT_SHARE.HELPER_PORT);
    if (route === undefined) return null;
    const share = yield* readSharedPort(running);
    return share === undefined ? null : { port: share.port, url: route.url };
  });
}
