import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { MIRROR_BOUNDS, mirrorFrameSchema } from "@repo/features/sandbox-mirror-wire";
import { temporaryDirectory } from "@repo/runtime/testing";
import { Schema } from "effect";
import { it, type TestContext } from "vitest";
import { MIRROR_BRIDGE_SOURCE } from "./mirror-bridge.js";

const CHANNEL = 3;
const readMessage = Schema.decodeUnknownSync(mirrorFrameSchema);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function checkout(t: TestContext) {
  const upstream = await temporaryDirectory(t, "mirror-upstream-");
  const root = await temporaryDirectory(t, "mirror-");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
  git(upstream, "init", "--quiet", "--initial-branch=main");
  fs.writeFileSync(path.join(upstream, ".gitignore"), "*.log\n");
  fs.writeFileSync(path.join(upstream, "a.txt"), "tracked");
  git(upstream, "add", ".");
  git(upstream, "commit", "--quiet", "-m", "base");
  git(root, "clone", "--quiet", "--single-branch", "--branch", "main", upstream, ".");
  fs.writeFileSync(path.join(root, "b.sh"), "#!/bin/sh\n", { mode: 0o755 });
  fs.writeFileSync(path.join(root, "out.log"), "ignored");
  fs.symlinkSync("a.txt", path.join(root, "link"));
  return { root, head: git(root, "rev-parse", "HEAD").toString().trim() };
}

function bridge(t: TestContext, root: string) {
  const child = spawn(process.execPath, ["--no-warnings", "-e", MIRROR_BRIDGE_SOURCE, root], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  t.onTestFinished(() => void child.kill());
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const frame = async () => JSON.parse(String((await lines.next()).value));
  const next = async () => {
    const data = await frame();
    assert.equal(data.type, "data");
    assert.equal(data.channel, CHANNEL);
    return readMessage(JSON.parse(Buffer.from(data.data, "base64").toString("utf8")));
  };
  const send = (frame: object) => child.stdin.write(`${JSON.stringify(frame)}\r\n`);
  const ask = (paths: string[]) => {
    const request = JSON.stringify({ type: "request", paths });
    send({ type: "data", channel: CHANNEL, data: Buffer.from(request).toString("base64") });
  };
  return { frame, next, send, ask };
}

function shown(message: Awaited<ReturnType<ReturnType<typeof bridge>["next"]>>) {
  return message.type === "file"
    ? { ...message, bytes: Buffer.from(message.bytes).toString("utf8") }
    : message;
}

const pathOf = (message: object) => ("path" in message ? String(message.path) : "");

it("the open sends git's files without ignored ones or symlinks, and a request is answered in order", async (t) => {
  const { root, head } = await checkout(t);
  const { frame, next, send, ask } = bridge(t, root);
  assert.deepEqual(await frame(), { bridge: "ready" });
  send({ type: "open", channel: CHANNEL });

  assert.deepEqual(await next(), { type: "header", base: head });
  const manifest = await next();
  assert.equal(manifest.type, "manifest");
  assert.deepEqual(
    [...(manifest.type === "manifest" ? manifest.files : [])].sort((a, b) =>
      a.path.localeCompare(b.path),
    ),
    [
      { path: ".gitignore", size: 6, hash: sha256("*.log\n") },
      { path: "a.txt", size: 7, hash: sha256("tracked") },
      { path: "b.sh", size: 10, hash: sha256("#!/bin/sh\n") },
    ],
  );

  ask(["b.sh", "out.log"]);
  assert.deepEqual(shown(await next()), {
    type: "file",
    path: "b.sh",
    mode: "100755",
    bytes: "#!/bin/sh\n",
  });
  assert.deepEqual(await next(), { type: "delete", path: "out.log" });
});

it("a change after the open crosses as a file, a delete, or a skip, in a new folder as in an old one, a chmod included", async (t) => {
  const { root } = await checkout(t);
  const { frame, next, send } = bridge(t, root);
  assert.deepEqual(await frame(), { bridge: "ready" });
  send({ type: "open", channel: CHANNEL });
  await next();
  await next();

  fs.writeFileSync(path.join(root, "a.txt"), "changed");
  fs.mkdirSync(path.join(root, "new"));
  fs.writeFileSync(path.join(root, "new", "c.txt"), "added");
  fs.rmSync(path.join(root, "b.sh"));
  fs.writeFileSync(path.join(root, "more.log"), "still ignored");
  fs.writeFileSync(path.join(root, "big.bin"), "");
  fs.truncateSync(path.join(root, "big.bin"), MIRROR_BOUNDS.FILE_BYTES + 1);

  const changes = [await next(), await next(), await next(), await next()].map(shown);
  assert.deepEqual(
    changes.sort((a, b) => pathOf(a).localeCompare(pathOf(b))),
    [
      { type: "file", path: "a.txt", mode: "100644", bytes: "changed" },
      { type: "delete", path: "b.sh" },
      { type: "skipped", path: "big.bin", size: MIRROR_BOUNDS.FILE_BYTES + 1 },
      { type: "file", path: "new/c.txt", mode: "100644", bytes: "added" },
    ],
  );

  fs.writeFileSync(path.join(root, "new", "c.txt"), "again");
  assert.deepEqual(shown(await next()), {
    type: "file",
    path: "new/c.txt",
    mode: "100644",
    bytes: "again",
  });

  fs.chmodSync(path.join(root, "new", "c.txt"), 0o755);
  assert.deepEqual(shown(await next()), {
    type: "file",
    path: "new/c.txt",
    mode: "100755",
    bytes: "again",
  });
});
