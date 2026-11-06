/**
 * mirror-bridge.ts -- the mirror's bridge: the Node script a `MIRROR` tunnel runs in the sandbox's PTY, which tells the Mac what the agent's checkout holds and sends each file as it changes.
 *
 * It speaks the tunnel's channel frames as the port bridge does
 * (`bridge.ts`), and on the one channel the Mac opens it speaks the
 * mirror's messages (`@repo/features/sandbox-mirror-wire`), each one
 * `data` frame. The open sends the header and the manifest of the checkout
 * as git lists it, and from then on a watch on each folder that listing
 * holds is only a trigger: once the checkout has been quiet for a moment,
 * or at most a second after it first stirred, it is listed again and
 * compared by size, modified time, and mode with the last listing, held in
 * memory and nowhere else, each file new or changed is sent, each one gone
 * is deleted, and the folders watched follow the new listing. Note that we
 * watch the listed folders rather than the checkout recursively, because
 * Node on Linux watches a recursive tree file by file, ignored folders such
 * as `node_modules` included, which costs seconds and hundreds of megabytes.
 * A missed watch event costs nothing, since the next listing catches it,
 * and a listing git refuses ends the bridge, which the Mac answers by
 * connecting again. A request is answered only for a path the last listing
 * holds, so the Mac can never read outside it. The bridge writes nothing but
 * frames, and git's own words go nowhere.
 */

import { MIRROR_BOUNDS, MIRROR_FILE_MODE } from "@repo/features/sandbox-mirror-wire";

/** How long the checkout must be quiet before it is listed again, and the longest a stir waits for that. */
const SETTLE = { QUIET_MS: 200, LONGEST_MS: 1000 } as const;

/** The mirror bridge, as Node runs it with the checkout's path as its one argument. */
export const MIRROR_BRIDGE_SOURCE = `"use strict";
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
let channel;
let listing = new Map();
let quiet;
let longest;
const watched = new Map();
const say = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
const tell = (message) => {
  if (channel === undefined) return;
  say({ type: "data", channel, data: Buffer.from(JSON.stringify(message)).toString("base64") });
};
const git = (args) => execFileSync("git", args, {
  cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
});
const gitOr = (args) => { try { return git(args).trim(); } catch { return ""; } };
const list = () => {
  const found = new Map();
  for (const name of git(["ls-files", "-co", "--exclude-standard", "-z"]).split("\\0")) {
    if (name === "" || found.has(name)) continue;
    let stat;
    try { stat = fs.lstatSync(path.join(root, name)); } catch { continue; }
    if (stat.isFile()) found.set(name, stat);
  }
  return found;
};
const clonedBranch = () => {
  const head = gitOr(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]);
  if (head !== "") return head;
  const specs = gitOr(["config", "--get-all", "remote.origin.fetch"]).split("\\n");
  const at = specs[0].indexOf(":refs/remotes/origin/");
  return specs.length !== 1 || at < 0 || specs[0].includes("*") ? "" : specs[0].slice(at + 1);
};
const base = () => {
  const branch = clonedBranch();
  const merged = branch === "" ? "" : gitOr(["merge-base", "HEAD", branch]);
  if (merged !== "") return merged;
  const head = gitOr(["rev-parse", "--verify", "-q", "HEAD"]);
  return head === "" ? null : head;
};
const hashOf = (name) => {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(path.join(root, name), "r");
  try {
    for (let read = fs.readSync(fd, chunk); read > 0; read = fs.readSync(fd, chunk)) {
      hash.update(chunk.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
};
const manifest = () => {
  const files = [];
  for (const [name, stat] of listing) {
    try { files.push({ path: name, size: stat.size, hash: hashOf(name) }); } catch {}
  }
  return { type: "manifest", files };
};
const fileOf = (name, stat) => {
  if (stat.size > ${MIRROR_BOUNDS.FILE_BYTES}) return { type: "skipped", path: name, size: stat.size };
  let bytes;
  try { bytes = fs.readFileSync(path.join(root, name)); } catch { return undefined; }
  if (bytes.length > ${MIRROR_BOUNDS.FILE_BYTES}) return { type: "skipped", path: name, size: bytes.length };
  const mode = (stat.mode & 0o111) === 0 ? "${MIRROR_FILE_MODE.REGULAR}" : "${MIRROR_FILE_MODE.EXECUTABLE}";
  return { type: "file", path: name, mode, bytes: bytes.toString("base64") };
};
const send = (name, stat) => {
  const message = fileOf(name, stat);
  if (message !== undefined) tell(message);
};
const watchFolders = () => {
  const folders = new Set([""]);
  for (const name of listing.keys()) {
    for (let folder = path.posix.dirname(name); folder !== "." && !folders.has(folder); folder = path.posix.dirname(folder)) {
      folders.add(folder);
    }
  }
  for (const [folder, watcher] of watched) {
    if (!folders.has(folder)) { watcher.close(); watched.delete(folder); }
  }
  for (const folder of folders) {
    if (watched.has(folder)) continue;
    try {
      const watcher = fs.watch(path.join(root, folder), stir);
      watcher.on("error", () => { watcher.close(); watched.delete(folder); });
      watched.set(folder, watcher);
    } catch {}
  }
};
const open = (opened) => {
  if (channel !== undefined && channel !== opened) say({ type: "close", channel });
  channel = opened;
  listing = list();
  watchFolders();
  tell({ type: "header", base: base() });
  tell(manifest());
};
const settle = () => {
  clearTimeout(quiet);
  clearTimeout(longest);
  quiet = undefined;
  longest = undefined;
  if (channel === undefined) return;
  const now = list();
  for (const [name, stat] of now) {
    const was = listing.get(name);
    const same = was !== undefined && was.size === stat.size && was.mtimeMs === stat.mtimeMs && was.mode === stat.mode;
    if (!same) send(name, stat);
  }
  for (const name of listing.keys()) {
    if (!now.has(name)) tell({ type: "delete", path: name });
  }
  listing = now;
  watchFolders();
};
const stir = () => {
  clearTimeout(quiet);
  quiet = setTimeout(settle, ${SETTLE.QUIET_MS});
  if (longest === undefined) longest = setTimeout(settle, ${SETTLE.LONGEST_MS});
};
const answer = (paths) => {
  for (const name of paths) {
    const stat = typeof name === "string" ? listing.get(name) : undefined;
    if (stat !== undefined) send(name, stat);
    else if (typeof name === "string") tell({ type: "delete", path: name });
  }
};
const asked = (data) => {
  let message;
  try { message = JSON.parse(Buffer.from(data, "base64").toString("utf8")); } catch { return; }
  if (message !== null && message.type === "request" && Array.isArray(message.paths)) answer(message.paths);
};
const take = (line) => {
  let frame;
  try { frame = JSON.parse(line); } catch { return; }
  if (frame === null || typeof frame !== "object" || !Number.isInteger(frame.channel)) return;
  if (frame.type === "open") open(frame.channel);
  else if (frame.channel !== channel) return;
  else if (frame.type === "data" && typeof frame.data === "string") asked(frame.data);
  else if (frame.type === "close") channel = undefined;
};
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let held = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  held += chunk;
  for (let at = held.indexOf("\\n"); at >= 0; at = held.indexOf("\\n")) {
    const line = held.slice(0, at).replace(/\\r$/, "");
    held = held.slice(at + 1);
    if (line !== "") take(line);
  }
});
process.stdin.on("end", () => process.exit(0));
say({ bridge: "ready" });
`;
