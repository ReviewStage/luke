import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net, { type AddressInfo } from "node:net";
import { createInterface } from "node:readline";
import { it } from "vitest";
import { PORT_BRIDGE_SOURCE } from "./bridge.js";

async function echo() {
  const server = net.createServer((socket) => {
    socket.on("data", (bytes) => {
      if (bytes.toString() === "bye") socket.end();
      else socket.write(bytes);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { port, server };
}

function bridge(port: number) {
  const child = spawn(process.execPath, ["--no-warnings", "-e", PORT_BRIDGE_SOURCE, String(port)], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async () => JSON.parse(String((await lines.next()).value));
  const send = (frame: object) => child.stdin.write(`${JSON.stringify(frame)}\r\n`);
  return { child, next, send };
}

it("a channel carries every byte value both ways and closes when its connection does", async () => {
  const { port, server } = await echo();
  const { child, next, send } = bridge(port);
  try {
    assert.deepEqual(await next(), { bridge: "ready" });
    const bytes = Uint8Array.from({ length: 256 }, (_, at) => at);
    send({ type: "open", channel: 7 });
    send({ type: "data", channel: 7, data: Buffer.from(bytes).toString("base64") });

    const received: Buffer[] = [];
    while (Buffer.concat(received).length < bytes.length) {
      const frame = await next();
      assert.equal(frame.type, "data");
      assert.equal(frame.channel, 7);
      received.push(Buffer.from(frame.data, "base64"));
    }
    send({ type: "data", channel: 7, data: Buffer.from("bye").toString("base64") });

    assert.deepEqual(new Uint8Array(Buffer.concat(received)), bytes);
    assert.deepEqual(await next(), { type: "close", channel: 7 });
  } finally {
    child.kill();
    server.close();
  }
});

it("a channel to a port nothing listens on closes as refused", async () => {
  const { port, server } = await echo();
  server.close();
  await once(server, "close");
  const { child, next, send } = bridge(port);
  try {
    assert.deepEqual(await next(), { bridge: "ready" });
    send({ type: "open", channel: 1 });

    assert.deepEqual(await next(), { type: "close", channel: 1, reason: "refused" });
  } finally {
    child.kill();
  }
});
