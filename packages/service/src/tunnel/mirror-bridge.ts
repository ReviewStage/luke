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
 * compared by size, modified time, and executable bit with the last
 * listing, held in memory and nowhere else, the folders watched follow the
 * new listing, and then each file new or changed is sent and each one gone
 * is deleted, so a change the Mac sees is never followed by one the bridge
 * misses in a folder it has not watched yet. Note that we
 * watch the listed folders rather than the checkout recursively, because
 * Node on Linux watches a recursive tree file by file, ignored folders such
 * as `node_modules` included, which costs seconds and hundreds of megabytes.
 * A missed watch event costs nothing, since the next listing catches it,
 * and whatever the bridge cannot do, such as a listing git refuses or a
 * base it cannot find, ends it, which the Mac answers by connecting again.
 * A request is answered only for a path the last listing holds, so the Mac
 * can never read outside it. The bridge writes nothing but
 * frames, and git's own words go nowhere.
 */

import {
  MIRROR_BOUNDS,
  MIRROR_FILE_MODE,
  MIRROR_FRAME,
  MIRROR_HASH,
} from "@repo/features/sandbox-mirror-wire";

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
const list = () => {
  const found = new Map();
  for (const name of git(["ls-files", "-co", "--exclude-standard", "-z"]).split("\\0")) {
    if (name === "") continue;
    let stat;
    try { stat = fs.lstatSync(path.join(root, name)); } catch { continue; }
    if (stat.isFile()) found.set(name, stat);
  }
  return found;
};
const base = () => {
  const cloned = git(["config", "--get", "remote.origin.fetch"]).trim().split(":")[1];
  return git(["merge-base", "HEAD", cloned]).trim();
};
const hashOf = (name) => createHash("${MIRROR_HASH.ALGORITHM}").update(fs.readFileSync(path.join(root, name))).digest("${MIRROR_HASH.ENCODING}");
const manifest = () => {
  const files = [];
  for (const [name, stat] of listing) {
    try { files.push({ path: name, size: stat.size, hash: hashOf(name) }); } catch {}
  }
  return { type: "${MIRROR_FRAME.MANIFEST}", files };
};
const fileOf = (name, stat) => {
  if (stat.size > ${MIRROR_BOUNDS.FILE_BYTES}) return { type: "${MIRROR_FRAME.SKIPPED}", path: name, size: stat.size };
  let bytes;
  try { bytes = fs.readFileSync(path.join(root, name)); } catch { return undefined; }
  const mode = (stat.mode & 0o111) === 0 ? "${MIRROR_FILE_MODE.REGULAR}" : "${MIRROR_FILE_MODE.EXECUTABLE}";
  return { type: "${MIRROR_FRAME.FILE}", path: name, mode, bytes: bytes.toString("base64") };
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
    watched.set(folder, fs.watch(path.join(root, folder), stir));
  }
};
const open = (opened) => {
  channel = opened;
  listing = list();
  watchFolders();
  tell({ type: "${MIRROR_FRAME.HEADER}", base: base() });
  tell(manifest());
};
const settle = () => {
  clearTimeout(quiet);
  clearTimeout(longest);
  quiet = undefined;
  longest = undefined;
  if (channel === undefined) return;
  const was = listing;
  listing = list();
  // Note that we watch the new listing's folders before telling any change, because the Mac may answer one with the next at once, in a folder new since.
  watchFolders();
  for (const [name, stat] of listing) {
    const before = was.get(name);
    const moved = before === undefined || before.size !== stat.size || before.mtimeMs !== stat.mtimeMs;
    if (moved || (before.mode & 0o111) !== (stat.mode & 0o111)) send(name, stat);
  }
  for (const name of was.keys()) {
    if (!listing.has(name)) tell({ type: "${MIRROR_FRAME.DELETE}", path: name });
  }
};
const stir = () => {
  clearTimeout(quiet);
  quiet = setTimeout(settle, ${SETTLE.QUIET_MS});
  if (longest === undefined) longest = setTimeout(settle, ${SETTLE.LONGEST_MS});
};
const answer = (paths) => {
  for (const name of paths) {
    const stat = listing.get(name);
    if (stat !== undefined) send(name, stat);
    else tell({ type: "${MIRROR_FRAME.DELETE}", path: name });
  }
};
const asked = (data) => {
  const message = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  if (Array.isArray(message.paths)) answer(message.paths);
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
