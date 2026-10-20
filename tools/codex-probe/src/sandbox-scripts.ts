/**
 * sandbox-scripts.ts -- the files and shell scripts the probe puts in its sandbox: the token scanner, the fake MCP server, the stand-in for a long CI watch, and the setup that installs Codex and the `agent` user.
 *
 * The scanner is what every isolation check runs, from whichever seat it is
 * checking (the default user's shell, that shell with its capabilities
 * dropped, a command Codex runs, root over the disk). It never prints a
 * value: for each process environment it can read it reports whether an
 * `ACCESS_TOKEN` variable is there, and for every JWT-shaped string it finds
 * in a file or an environment it reports only the SHA-256 of that string and
 * where it was, which the probe compares with the hash of the token it holds.
 * Every script is installed root-owned, so no seat it checks can rewrite it.
 */

import { AGENT_USER, CHATGPT_PROVIDER, CODEX, PROBE_MCP } from "./app-server.js";

/** Where the probe's own scripts live in the sandbox. */
export const PROBE_FILES = {
  DIRECTORY: "/opt/luke-probe",
  SCANNER: "/opt/luke-probe/scan.mjs",
  MCP: PROBE_MCP.SCRIPT,
  CI_WATCH: "/opt/luke-probe/ci-watch",
  REPOSITORY: "/srv/luke-probe-repo",
} as const;

/** The marker a scanner's report line starts with, so it is found inside a command's output. */
export const SCAN_MARKER = "LUKE_PROBE_SCAN ";

/** The scanner, run with `node`; arguments are the directories to walk, `--no-proc` skips processes. */
const SCANNER_SOURCE = String.raw`
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { userInfo } from "node:os";
const args = process.argv.slice(2);
const walkProc = !args.includes("--no-proc");
const roots = args.filter((one) => !one.startsWith("--"));
const JWT = /eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g;
const found = new Map();
const note = (text, where) => {
  for (const match of text.matchAll(JWT)) {
    const hash = createHash("sha256").update(match[0]).digest("hex");
    if (!found.has(hash)) found.set(hash, where);
  }
};
const status = (pid) => { try { return readFileSync("/proc/" + pid + "/comm", "utf8").trim(); } catch { return "?"; } };
const report = {
  uid: process.getuid(),
  user: userInfo().username,
  capEff: (readFileSync("/proc/self/status", "utf8").match(/CapEff:\s*(\w+)/) ?? [])[1] ?? null,
  ownEnvHasAccessToken: "${CHATGPT_PROVIDER.ENV_KEY}" in process.env,
  environsReadable: 0,
  environsDenied: 0,
  processesWithAccessToken: [],
  filesScanned: 0,
  filesDenied: 0,
  jwtSha256: [],
};
if (walkProc) {
  for (const pid of readdirSync("/proc").filter((one) => /^\d+$/.test(one))) {
    if (Number(pid) === process.pid) continue;
    let environ;
    try { environ = readFileSync("/proc/" + pid + "/environ", "latin1"); } catch { report.environsDenied++; continue; }
    report.environsReadable++;
    if (environ.split("\0").some((entry) => entry.startsWith("${CHATGPT_PROVIDER.ENV_KEY}="))) {
      report.processesWithAccessToken.push({ pid: Number(pid), comm: status(pid) });
    }
    note(environ, "proc:" + status(pid));
  }
}
const walk = (path, depth) => {
  let facts;
  try { facts = lstatSync(path); } catch { return; }
  if (facts.isSymbolicLink()) return;
  if (facts.isDirectory()) {
    if (depth > 12 || path === "/proc" || path === "/sys" || path === "/dev") return;
    let names;
    try { names = readdirSync(path); } catch { report.filesDenied++; return; }
    for (const name of names) walk(path === "/" ? "/" + name : path + "/" + name, depth + 1);
    return;
  }
  if (!facts.isFile() || facts.size > 4 * 1024 * 1024) return;
  try { note(readFileSync(path, "latin1"), path); report.filesScanned++; } catch { report.filesDenied++; }
};
for (const root of roots) walk(root, 0);
report.jwtSha256 = [...found].map(([sha256, where]) => ({ sha256, where }));
process.stdout.write("${SCAN_MARKER}" + JSON.stringify(report) + "\n");
`;

/**
 * The fake MCP server, the stand-in for Luke's: one `echo` tool over stdio,
 * whose answer also says whether the server itself was handed the token.
 */
const MCP_SOURCE = String.raw`
import { createInterface } from "node:readline";
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "luke-probe", version: "1" } } });
  } else if (message.method === "tools/list") {
    send({ id: message.id, result: { tools: [{ name: "${PROBE_MCP.TOOL}", description: "Echo the text back. Luke's probe uses it to prove MCP tool calls work.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });
  } else if (message.method === "tools/call") {
    const text = String(message.params?.arguments?.text ?? "");
    send({ id: message.id, result: { content: [{ type: "text", text: "luke-probe-echo:" + text + " access_token_in_env=" + ("${CHATGPT_PROVIDER.ENV_KEY}" in process.env) }] } });
  } else {
    send({ id: message.id, error: { code: -32601, message: "method not found" } });
  }
});
`;

/**
 * A stand-in for `gh pr checks --watch`: it prints a pending line every
 * fifteen seconds for as long as it is told, then the passing line with the
 * marker it was given, which only an agent that waited to the end can quote.
 */
const CI_WATCH_SOURCE = `#!/bin/bash
seconds="\${1:-300}"; marker="\${2:-done}"; waited=0
while [ "$waited" -lt "$seconds" ]; do echo "checks pending (\${waited}s)"; sleep 15; waited=$((waited + 15)); done
echo "all checks passed: $marker"
`;

/** Every file the probe installs, from the default user's staging path to its root-owned place. */
export const PROBE_SCRIPTS: readonly { readonly path: string; readonly source: string }[] = [
  { path: PROBE_FILES.SCANNER, source: SCANNER_SOURCE },
  { path: PROBE_FILES.MCP, source: MCP_SOURCE },
  { path: PROBE_FILES.CI_WATCH, source: CI_WATCH_SOURCE },
];

/** Where a script is staged by the SDK's file write (as the default user) before root installs it. */
export function stagedPath(path: string): string {
  return `/tmp/luke-probe-stage-${path.split("/").at(-1) ?? "file"}`;
}

/**
 * The setup run as root: the probe's scripts root-owned, the pinned Codex
 * under a root-owned prefix, the `agent` user with a home only it can read
 * (not the SDK's `createUser`, whose homes the default user's group can
 * read), its `CODEX_HOME`, which Codex refuses to start without, and a
 * checkout directory both `agent` and the default user's group may write.
 */
export function setupScript(defaultGroup: string): string {
  const install = PROBE_SCRIPTS.map(
    (script) => `install -o root -g root -m 0755 ${stagedPath(script.path)} ${script.path}`,
  );
  return [
    "set -e",
    `install -d -o root -g root -m 0755 ${PROBE_FILES.DIRECTORY}`,
    ...install,
    `npm install --global --prefix ${CODEX.PREFIX} ${CODEX.PACKAGE}@${CODEX.VERSION} >/dev/null`,
    `chown -R root:root ${CODEX.PREFIX}`,
    `${CODEX.BIN} --version`,
    `id -u ${AGENT_USER.NAME} >/dev/null 2>&1 || useradd --create-home --home-dir ${AGENT_USER.HOME} --shell /bin/bash ${AGENT_USER.NAME}`,
    `chmod 0700 ${AGENT_USER.HOME}`,
    `install -d -o ${AGENT_USER.NAME} -g ${AGENT_USER.NAME} -m 0700 ${AGENT_USER.CODEX_HOME}`,
    `install -d -o ${AGENT_USER.NAME} -g ${defaultGroup} -m 2770 ${PROBE_FILES.REPOSITORY}`,
    "command -v setpriv",
  ].join("\n");
}

/** As the default user: every path on the agent's launch that the default user could rewrite. */
export const WRITABLE_LAUNCH_PATHS_SCRIPT = [
  `for p in ${CODEX.PREFIX} ${PROBE_FILES.DIRECTORY} /usr/local/bin /usr/local/lib/node_modules /usr/bin /bin "$(readlink -f "$(command -v node)")" "$(readlink -f "$(command -v setpriv)")"; do`,
  '  [ -e "$p" ] && find "$p" -maxdepth 3 -writable -print 2>/dev/null | head -5 | sed "s/^/WRITABLE /"',
  "done",
  "echo checked",
].join("\n");

/**
 * As root: the default user's sudo taken away, as P03 would take it, by
 * deleting every sudoers line that names the user or a group of theirs.
 */
export function dropSudoScript(defaultUser: string): string {
  return [
    "set -e",
    `groups=$(id -Gn ${defaultUser})`,
    "for f in /etc/sudoers /etc/sudoers.d/*; do",
    '  [ -f "$f" ] || continue',
    `  sed -i -E "/^${defaultUser}[[:space:]]/d" "$f"`,
    '  for g in $groups; do sed -i -E "/^%$g[[:space:]]/d" "$f"; done',
    "done",
    "visudo -c >/dev/null",
  ].join("\n");
}

/** What drops a shell's capabilities, the mitigation the Terminal would need. */
export const DROP_CAPS = [
  "setpriv",
  "--inh-caps=-all",
  "--ambient-caps=-all",
  "--bounding-set=-all",
] as const;
