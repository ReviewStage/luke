import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline";
import { it } from "vitest";
import { WebSocketServer } from "ws";
import { BRIDGE_SOURCE } from "./sandbox-browser.js";

/**
 * The bridge the agent's sandbox runs, as its own Node process in front of a
 * local stand-in for Chromium's DevTools: it finds the browser's WebSocket
 * through `/json/version`, says it is ready, sends each line it reads as one
 * message, writes each message as one line however the browser spaced it,
 * and exits when the browser goes. A bridge with no browser to reach says
 * so and exits.
 */

/** A local DevTools stand-in: `/json/version` naming its socket, and a socket that answers each command with its id and method. */
async function devtools() {
  const server = http.createServer();
  const sockets = new WebSocketServer({ server, path: "/devtools/browser/fixture" });
  const received: string[] = [];
  sockets.on("connection", (socket) => {
    socket.on("message", (data) => {
      const text = String(data);
      received.push(text);
      const { id, method } = JSON.parse(text);
      // Spaced over lines, as a browser may write JSON, so the bridge must keep it one line.
      socket.send(JSON.stringify({ id, result: { method, note: "a\nb" } }, null, 2));
      if (method === "Browser.close") socket.close();
    });
  });
  server.on("request", (request, response) => {
    const { port } = server.address() as AddressInfo;
    if (request.url !== "/json/version") return response.writeHead(404).end();
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fixture` }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  // SAFETY: a listening TCP server answers its bound address as AddressInfo, never a pipe path.
  const { port } = server.address() as AddressInfo;
  return {
    port,
    received,
    close: async () => {
      sockets.close();
      server.close();
      await once(server, "close");
    },
  };
}

/** The bridge on the port given, its lines read one at a time. */
function bridge(port: number) {
  const child = spawn(process.execPath, ["--no-warnings", "-e", BRIDGE_SOURCE, String(port)], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async () => JSON.parse(String((await lines.next()).value));
  return { child, next };
}

it("the bridge carries one message a line each way and exits when the browser goes", async () => {
  const browser = await devtools();
  try {
    const { child, next } = bridge(browser.port);
    assert.deepEqual(await next(), { bridge: "ready" });

    child.stdin.write(`${JSON.stringify({ id: 1, method: "Target.getTargets" })}\r\n`);
    const answered = await next();
    child.stdin.write(
      `${JSON.stringify({ id: 2, method: "Runtime.evaluate", params: { expression: "'é☃'" } })}\n`,
    );
    const second = await next();
    const exited = once(child, "exit");
    child.stdin.write(`${JSON.stringify({ id: 3, method: "Browser.close" })}\n`);
    await next();
    const [code] = await exited;

    assert.deepEqual(answered, { id: 1, result: { method: "Target.getTargets", note: "a\nb" } });
    assert.equal(second.id, 2);
    assert.deepEqual(JSON.parse(browser.received[1] ?? "").params, { expression: "'é☃'" });
    assert.equal(code, 0);
  } finally {
    await browser.close();
  }
});

it("a bridge with no browser to reach says so and exits", async () => {
  const browser = await devtools();
  const { port } = browser;
  await browser.close();

  const { child, next } = bridge(port);
  const exited = once(child, "exit");

  assert.deepEqual(await next(), { bridge: "error", reason: "unreachable" });
  assert.equal((await exited)[0], 1);
});
