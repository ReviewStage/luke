import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { join } from "node:path";
import { temporaryDirectory } from "@repo/wire/testing";
import { it } from "vitest";
import { PORT_SHARE_HELPER_SOURCE } from "./port-share.js";

/**
 * The share helper the agent's sandbox runs, as its own Node process in
 * front of a local server that answers with the headers it was sent: a
 * request reaching it through the helper names localhost at the shared port
 * as its host and origin, whatever the public route named, its visit is
 * written, and the helper leaves once its folder is gone.
 */

/** A port free on the loopback now. */
async function freePort(): Promise<number> {
  const probe = net.createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  // SAFETY: a listening TCP server answers its bound address as AddressInfo, never a pipe path.
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, "close");
  return port;
}

it("a request through the helper reaches the app as localhost and is written as a visit", async (t) => {
  const folder = await temporaryDirectory(t, "port-share-");
  const app = http.createServer((request, response) =>
    response.end(JSON.stringify([request.headers.host, request.headers.origin])),
  );
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  // SAFETY: as above.
  const { port } = app.address() as AddressInfo;
  writeFileSync(join(folder, "port"), String(port));
  const listen = await freePort();
  const helper = spawn(
    process.execPath,
    ["--no-warnings", "-e", PORT_SHARE_HELPER_SOURCE, String(listen), folder],
    { stdio: "inherit" },
  );
  const ask = () =>
    fetch(`http://127.0.0.1:${listen}/`, { headers: { origin: "https://shared.vercel.run" } });
  try {
    // The first request that answers waits out the helper's start, which writes a visit of its own.
    while ((await ask().catch(() => undefined)) === undefined);
    const before = Date.now();
    const answer = await (await ask()).json();

    assert.deepEqual(answer, [`localhost:${port}`, `http://localhost:${port}`]);
    assert.ok(Number(readFileSync(join(folder, "visit"), "utf8")) >= before);
    rmSync(join(folder, "port"));
    await once(helper, "exit");
  } finally {
    helper.kill();
    app.close();
  }
});
