/**
 * linux-shell-tools.ts -- the GNU forms eve's code tools run, for a test shell on a Mac.
 *
 * eve's `apply_patch` and `grep` run `realpath -e`, `realpath -m`,
 * `realpath -z`, `stat -c %a`, and `chmod <mode> --`, which the coding
 * agent's Linux sandbox answers through GNU coreutils and a Mac's BSD tools
 * refuse (BSD `chmod` reads the `--` after a mode as a file). A test that
 * runs eve's commands in a real host shell stands for that Linux sandbox,
 * so on a host without the GNU forms it puts these three tools ahead of the
 * host's on PATH. Each answers only the forms eve runs, and refuses any
 * other, so a new GNU form eve starts running fails loudly here rather
 * than passing on a guess. On a host that has the GNU forms the PATH is
 * the host's own.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** GNU `realpath` with `-e`, `-m`, `-z`, and `--`, in Node, as the sandbox's coreutils answers it. */
const REALPATH = `
const fs = require("node:fs");
const path = require("node:path");
let mode = "";
let end = "\\n";
let options = true;
const paths = [];
for (const arg of process.argv.slice(2)) {
  if (options && arg === "--") options = false;
  else if (options && arg.startsWith("-") && arg.length > 1) {
    for (const flag of arg.slice(1)) {
      if (flag === "e" || flag === "m") mode = flag;
      else if (flag === "z") end = "\\0";
      else { process.stderr.write("realpath: unsupported option -" + flag + "\\n"); process.exit(1); }
    }
  } else paths.push(arg);
}
// Note that -m resolves the longest prefix that exists and keeps the rest as written.
function resolve(target) {
  if (mode === "e") return fs.realpathSync(target);
  let head = path.resolve(target);
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(head), ...tail); } catch {}
    if (mode !== "m" && tail.length > 0) throw new Error("No such file or directory");
    if (head === path.dirname(head)) return path.resolve(target);
    tail.unshift(path.basename(head));
    head = path.dirname(head);
  }
}
let status = 0;
for (const target of paths) {
  try { process.stdout.write(resolve(target) + end); }
  catch { process.stderr.write("realpath: " + target + ": No such file or directory\\n"); status = 1; }
}
process.exit(status);
`;

/** GNU `stat -c %a --`, in Node: a file's permission bits in octal. */
const STAT = `
const fs = require("node:fs");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args[0] !== "-c" || args[1] !== "%a" || args.length !== 3) {
  process.stderr.write("stat: unsupported form: " + process.argv.slice(2).join(" ") + "\\n");
  process.exit(1);
}
try { process.stdout.write((fs.statSync(args[2]).mode & 0o7777).toString(8) + "\\n"); }
catch { process.stderr.write("stat: cannot stat '" + args[2] + "'\\n"); process.exit(1); }
`;

/** GNU `chmod <octal mode> -- <path>`, in Node, as eve restores a file's mode. */
const CHMOD = `
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.length !== 3 || !/^[0-7]{3,4}$/.test(args[0]) || args[1] !== "--") {
  process.stderr.write("chmod: unsupported form: " + args.join(" ") + "\\n");
  process.exit(1);
}
try { fs.chmodSync(args[2], parseInt(args[0], 8)); }
catch { process.stderr.write("chmod: cannot access '" + args[2] + "'\\n"); process.exit(1); }
`;

/** Whether the host's shell already answers the GNU forms. */
function hostHasGnuForms(): boolean {
  try {
    execFileSync("/bin/sh", ["-c", "realpath -m -- / && stat -c %a -- / && chmod --version"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** One tool in the directory given, run by this process's own Node. */
function writeTool(directory: string, name: string, source: string): void {
  const script = join(directory, `${name}.cjs`);
  writeFileSync(script, source);
  const tool = join(directory, name);
  writeFileSync(tool, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(tool, 0o755);
}

/** The PATH a test shell standing for the coding agent's Linux sandbox runs on. */
export function linuxShellPath(): string {
  const hostPath = process.env.PATH ?? "";
  if (hostHasGnuForms()) return hostPath;
  const tools = mkdtempSync(join(tmpdir(), "linux-shell-tools-"));
  writeTool(tools, "realpath", REALPATH);
  writeTool(tools, "stat", STAT);
  writeTool(tools, "chmod", CHMOD);
  return `${tools}:${hostPath}`;
}
