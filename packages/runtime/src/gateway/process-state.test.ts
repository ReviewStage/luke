import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GATEWAY_PROTOCOL_VERSION } from "@sidecar/runtime-contracts";
import {
  createGatewayToken,
  GATEWAY_LOOPBACK_HOST,
  type GatewayDiscoveryRecord,
  publishGatewayDiscovery,
  readGatewayDiscovery,
  withdrawGatewayDiscovery,
} from "./discovery.js";
import { acquireGatewayInstanceLock, readGatewayLockHolder } from "./instance-lock.js";
import { shutdownGateway } from "./shutdown.js";

async function scratch(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "luke-gateway-"));
}

function record(pid = process.pid): GatewayDiscoveryRecord {
  return {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    buildVersion: "1.0.0",
    host: GATEWAY_LOOPBACK_HOST,
    port: 43_210,
    token: createGatewayToken(),
    pid,
    startedAt: 1_000,
  };
}

test("the token is 32 random bytes and never repeats", () => {
  const a = createGatewayToken();
  const b = createGatewayToken();
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, "base64url").length, 32);
});

test("discovery is published owner-only, atomically, and read back whole", async () => {
  const root = await scratch();
  const file = path.join(root, "gateway", "discovery.json");
  const published = record();
  await publishGatewayDiscovery(file, published);
  const stat = await fs.stat(file);
  if (process.platform !== "win32") assert.equal(stat.mode & 0o777, 0o600);
  assert.deepEqual(await readGatewayDiscovery(file), published);
  assert.deepEqual(
    (await fs.readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("a record another user could read is refused, and a malformed one reads as nothing", async (t) => {
  if (process.platform === "win32") return t.skip("no file modes");
  const root = await scratch();
  const file = path.join(root, "discovery.json");
  await publishGatewayDiscovery(file, record());
  await fs.chmod(file, 0o644);
  assert.equal(await readGatewayDiscovery(file), undefined);
  await fs.chmod(file, 0o600);
  await fs.writeFile(file, "{not json", { mode: 0o600 });
  assert.equal(await readGatewayDiscovery(file), undefined);
  await fs.writeFile(file, JSON.stringify({ ...record(), host: "0.0.0.0" }), { mode: 0o600 });
  assert.equal(await readGatewayDiscovery(file), undefined);
  assert.equal(await readGatewayDiscovery(path.join(root, "absent.json")), undefined);
});

test("a host withdraws only its own record, never a successor's", async () => {
  const root = await scratch();
  const file = path.join(root, "discovery.json");
  await publishGatewayDiscovery(file, record(41));
  assert.equal(await withdrawGatewayDiscovery(file, 42), false);
  assert.ok(await readGatewayDiscovery(file));
  assert.equal(await withdrawGatewayDiscovery(file, 41), true);
  assert.equal(await readGatewayDiscovery(file), undefined);
});

test("the instance lock refuses a live holder, breaks a dead one, and is released by its holder alone", async () => {
  const root = await scratch();
  const filePath = path.join(root, "instance.lock");
  const alive = new Set([1_001]);
  const first = await acquireGatewayInstanceLock({
    filePath,
    pid: 1_001,
    startedAt: 1,
    isAlive: (pid) => alive.has(pid),
  });
  assert.equal(first.acquired, true);
  const second = await acquireGatewayInstanceLock({
    filePath,
    pid: 1_002,
    startedAt: 2,
    isAlive: (pid) => alive.has(pid),
  });
  assert.deepEqual(second, { acquired: false, holder: { pid: 1_001, startedAt: 1 } });
  alive.delete(1_001);
  const third = await acquireGatewayInstanceLock({
    filePath,
    pid: 1_003,
    startedAt: 3,
    isAlive: (pid) => alive.has(pid),
  });
  assert.equal(third.acquired, true);
  assert.deepEqual(await readGatewayLockHolder(filePath), { pid: 1_003, startedAt: 3 });
  if (first.acquired) await first.release();
  assert.deepEqual(await readGatewayLockHolder(filePath), { pid: 1_003, startedAt: 3 });
  if (third.acquired) await third.release();
  assert.equal(await readGatewayLockHolder(filePath), undefined);
});

test("shutdown closes admissions, cancels, and reports what settled; a deadline leaves work unresolved, never finished", async () => {
  const order: string[] = [];
  const settled = await shutdownGateway(
    {
      closeAdmissions: () => order.push("close"),
      cancelActive: async () => {
        order.push("cancel");
        return ["run-1"];
      },
      awaitSettled: async () => {
        order.push("settled");
      },
      persistUnresolved: async () => {
        order.push("persist");
        return 0;
      },
    },
    { deadlineMs: 50 },
  );
  assert.deepEqual(order, ["close", "cancel", "settled", "persist"]);
  assert.equal(settled.settled, true);
  assert.deepEqual(settled.cancelled, ["run-1"]);

  let aborted = false;
  const late = await shutdownGateway(
    {
      closeAdmissions: () => undefined,
      cancelActive: async () => ["run-2"],
      awaitSettled: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
      persistUnresolved: async () => 1,
    },
    { deadlineMs: 20 },
  );
  assert.equal(late.settled, false);
  assert.equal(late.unresolved, 1);
  assert.equal(aborted, true);
});
