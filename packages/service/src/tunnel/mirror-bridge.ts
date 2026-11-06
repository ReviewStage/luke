import {
  MIRROR_BOUNDS,
  MIRROR_FILE_MODE,
  MIRROR_FRAME,
  MIRROR_HASH,
} from "@repo/features/sandbox-mirror-wire";

const SETTLE = { QUIET_MS: 200, LONGEST_MS: 1000 } as const;

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
  const now = list();
  for (const [name, stat] of now) {
    const was = listing.get(name);
    const moved = was === undefined || was.size !== stat.size || was.mtimeMs !== stat.mtimeMs;
    if (moved || (was.mode & 0o111) !== (stat.mode & 0o111)) send(name, stat);
  }
  for (const name of listing.keys()) {
    if (!now.has(name)) tell({ type: "${MIRROR_FRAME.DELETE}", path: name });
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
