/**
 * smolvm-hand-test.ts -- the smolvm launcher run for real, by hand, on a Linux box with `/dev/kvm` or an Apple Silicon Mac with smolvm installed: one agent's VM made, a stand-in runner streamed through it, everything a host relies on checked, and the VM deleted.
 *
 * CI has no KVM, so this is how the launcher (`@luke/host/node`'s
 * `smolvmSandbox`) meets a real smolvm. It makes a folder under the home
 * folder standing in for an agent's, and a stand-in for the runner's bundle
 * beside it, then drives the launcher exactly as the follower does: the VM
 * made and started, the runner run through `machine exec -i` with a secret
 * handed by name, its stdin streamed line by line, a command run in the VM
 * as a tool's would be, the runner signalled and given its grace, and the
 * turn's VM deleted with the token kept for it; then a second turn's VM made
 * fresh over the same folder, and deleted as a discard deletes it. Each
 * check prints PASS or FAIL, and the script exits 1 where any failed.
 *
 *   pnpm --filter @luke/host-daemon hand-test:smolvm [-- --github owner/repo]
 *
 * With `--github`, the token `gh auth token` answers on this machine is
 * handed to the VM as a host hands Luke's: it never enters the VM, which
 * holds only smolvm's placeholder, so `gh api /user` and a `git ls-remote`
 * of the repository named (a private one shows the most) work there while
 * no trace of the token can be found in the VM's processes or the agent's
 * folder. The token is never printed. Everything the script made is
 * removed as it ends, the VM included, whatever the checks found.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
  NodeRuntime,
} from "@effect/platform-node";
import { smolvmSandbox } from "@luke/host/node";
import { Duration, Effect, Exit, Layer, Option, Queue, Stream } from "effect";
import { ChildProcess } from "effect/process";

/** The `smolvm` this machine runs, as its PATH finds it. */
const SMOLVM = "smolvm";

/** How long the stand-in runner has to end once signalled, as the follower gives a runner. */
const GRACE = Duration.seconds(3);

/** How long an echoed line may take to come back while stdin stays open, well past step 0's worst of 32 ms. */
const ECHO_WAIT = Duration.seconds(10);

/** The stand-in runner: each stdin line echoed back at once with what it sees of the VM, a mark left on SIGTERM, and exit 7 at EOF. */
const RUNNER = `import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
process.on("SIGTERM", () => { writeFileSync(process.env.TMPDIR + "/sigterm", "1"); process.exit(0); });
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => process.stdout.write(JSON.stringify({
  echo: line,
  uid: process.getuid(),
  home: process.env.HOME,
  cwd: process.cwd(),
  secret: process.env.LUKE_HAND_TEST_SECRET,
}) + "\\n"));
lines.on("close", () => process.exit(7));
`;

/** What looks for the token's digest, given as its one argument, among every word of every process's environment and command line in the VM and every file of the agent's folder. */
const TOKEN_SEARCH = `const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, statSync } = require("node:fs");
const [digest, folder] = process.argv.slice(1);
const hashed = (text) => text.split(/[\\s\\0="':]+/).some((word) =>
  word.length > 0 && createHash("sha256").update(word).digest("hex") === digest);
let found = 0;
for (const pid of readdirSync("/proc").filter((name) => /^\\d+$/.test(name))) {
  for (const file of ["environ", "cmdline"]) {
    try { if (hashed(readFileSync("/proc/" + pid + "/" + file, "utf8"))) found += 1; } catch {}
  }
}
const walk = (at) => {
  for (const name of readdirSync(at)) {
    const each = at + "/" + name;
    try {
      const info = statSync(each);
      if (info.isDirectory()) walk(each);
      else if (info.size < 1e6 && hashed(readFileSync(each, "utf8"))) found += 1;
    } catch {}
  }
};
walk(folder);
process.stdout.write(String(found));
`;

const failures: string[] = [];

/** One check's verdict, printed. */
function check(name: string, passed: boolean, detail = ""): void {
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : `: ${detail}`}\n`,
  );
  if (!passed) failures.push(name);
}

/** What one command printed on stdout and how it exited, run to its end; nothing it printed on stderr is kept. */
const output = (command: string, args: readonly string[], env?: Readonly<Record<string, string>>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, [...args], {
        ...(env === undefined ? undefined : { env, extendEnv: false }),
        stdin: "ignore",
        stderr: "ignore",
      });
      const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));
      return { printed: printed.trim(), code: Number(yield* handle.exitCode) };
    }),
  ).pipe(Effect.orElseSucceed(() => ({ printed: "", code: -1 })));

const handTest = Effect.gen(function* () {
  // Note that pnpm 10 hands on the `--` that separates the script's own arguments, which parseArgs would refuse as one of its own.
  const given = process.argv.slice(2);
  const { values } = parseArgs({
    args: given[0] === "--" ? given.slice(1) : given,
    options: { github: { type: "string" } },
  });
  const version = yield* output(SMOLVM, ["--version"]);
  if (version.code !== 0) {
    process.stderr.write("smolvm is not on this machine's PATH; install it as its README says.\n");
    return 1;
  }
  process.stdout.write(`${version.printed} on ${process.platform} ${process.arch}\n`);
  const kvm = process.platform === "linux" && existsSync("/dev/kvm");
  const root = path.join(os.homedir(), ".luke-hand-test");
  const agentId = `hand-test-${randomBytes(4).toString("hex")}`;
  const folder = path.join(root, "agents", agentId);
  const checkout = path.join(folder, "repository");
  const runnerFolder = path.join(root, "lib");
  mkdirSync(checkout, { recursive: true });
  mkdirSync(path.join(folder, "tmp"), { recursive: true, mode: 0o700 });
  mkdirSync(runnerFolder, { recursive: true });
  writeFileSync(path.join(runnerFolder, "agent-runner.mjs"), RUNNER);
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  const vm = smolvmSandbox({
    smolvm: SMOLVM,
    stateRoot: path.join(root, "state"),
    runnerFolder,
    user: { uid, gid },
    nested: kvm,
  });
  const box = vm.sandbox;

  // Note that whatever the checks found, the VM and everything made for it go as the script ends.
  yield* Effect.addFinalizer(() =>
    Effect.andThen(
      box.deleted(agentId),
      Effect.sync(() => rmSync(root, { recursive: true, force: true })),
    ),
  );

  const token =
    values.github === undefined ? undefined : (yield* output("gh", ["auth", "token"])).printed;
  if (values.github !== undefined && (token === undefined || token === "")) {
    process.stderr.write("--github needs `gh auth token` to answer a token on this machine.\n");
    return 1;
  }
  if (token !== undefined) yield* box.githubToken(agentId, token);

  process.stdout.write(
    "Making and starting the VM; the first start pulls the image, about 1.3 GB.\n",
  );
  const startedAt = Date.now();
  const started = yield* Effect.exit(box.started({ agentId, folder, github: token !== undefined }));
  check(
    "the VM is made and started",
    Exit.isSuccess(started),
    `${Math.round((Date.now() - startedAt) / 1000)} s`,
  );
  if (Exit.isFailure(started)) return 1;

  const inVm = (command: string, args: readonly string[]) => {
    const run = box.exec({
      agentId,
      folder,
      cwd: checkout,
      command,
      args,
      env: { HOME: os.homedir(), PATH: process.env.PATH ?? "" },
    });
    return output(run.command, run.args, run.env);
  };

  // The runner, streamed: every line back at once while stdin stays open, as the box's user, in its folder.
  const env = {
    HOME: os.homedir(),
    PATH: process.env.PATH ?? "",
    TMPDIR: path.join(folder, "tmp"),
    LUKE_HAND_TEST_SECRET: "handed-by-name",
  };
  const launched = vm.launch({
    agentId,
    folder,
    checkout,
    node: box.tools.node,
    bundle: path.join(runnerFolder, "agent-runner.mjs"),
    env,
  });
  check("the runner is run with exec -i", launched.args.includes("-i"));
  check(
    "no handed variable's value is an argument",
    !launched.args.join(" ").includes("handed-by-name"),
  );
  const stdin = yield* Queue.unbounded<string>();
  const encoder = new TextEncoder();
  const runner = yield* ChildProcess.make(launched.command, [...launched.args], {
    env: launched.env,
    extendEnv: false,
    stdin: {
      stream: Stream.fromQueue(stdin).pipe(Stream.map((text) => encoder.encode(text))),
      endOnDone: false,
    },
    stderr: "ignore",
  });
  const echoes = yield* Queue.unbounded<string>();
  yield* Effect.forkScoped(
    Stream.runForEach(Stream.splitLines(Stream.decodeText(runner.stdout)), (line) =>
      Queue.offer(echoes, line),
    ),
  );
  for (const word of ["first", "second\twith a tab", "third"]) {
    yield* Queue.offer(stdin, `${word}\n`);
    const echoed = yield* Effect.timeoutOption(Queue.take(echoes), ECHO_WAIT);
    const seen = Option.map(echoed, (line) => JSON.parse(line) as Record<string, unknown>);
    check(
      `"${word}" streams back before stdin closes`,
      Option.exists(seen, (each) => each.echo === word),
    );
    if (word === "first" && Option.isSome(seen)) {
      check(
        "the runner runs as this machine's user",
        seen.value.uid === uid,
        String(seen.value.uid),
      );
      check("its home is inside the agent's folder", seen.value.home === path.join(folder, "home"));
      check("it runs in the agent's worktree at the same path", seen.value.cwd === checkout);
      check("a variable handed by name arrives", seen.value.secret === "handed-by-name");
    }
  }

  // A command run in the VM as a tool's is: files land on the machine at the same path, owned by its user.
  const written = yield* inVm("/bin/sh", ["-c", "echo from-the-vm > written-in-vm && id -u"]);
  const file = path.join(checkout, "written-in-vm");
  check(
    "a command in the VM writes the mounted folder",
    existsSync(file) && readFileSync(file, "utf8") === "from-the-vm\n",
  );
  check("what it writes is this machine's user's", existsSync(file) && statSync(file).uid === uid);
  check("the command runs as this machine's user", written.printed === String(uid));
  if (kvm) {
    const nested = yield* inVm("/bin/sh", ["-c", "test -e /dev/kvm"]);
    check("the VM has /dev/kvm of its own", nested.code === 0);
  }
  if (token !== undefined && values.github !== undefined) {
    const placeholder = yield* inVm("/bin/sh", [
      "-c",
      'case "$GH_TOKEN" in SMOL_PLACEHOLDER_*) echo yes ;; esac',
    ]);
    check("GH_TOKEN in the VM is smolvm's placeholder", placeholder.printed === "yes");
    const login = yield* inVm("gh", ["api", "/user", "--jq", ".login"]);
    check(
      "gh reaches GitHub through the placeholder",
      login.code === 0 && login.printed.length > 0,
      login.printed,
    );
    const remote = yield* inVm("git", [
      "ls-remote",
      `https://github.com/${values.github}.git`,
      "HEAD",
    ]);
    check(`git reaches ${values.github} with no credential helper`, remote.code === 0);
    const digest = createHash("sha256").update(token).digest("hex");
    const search = yield* inVm(box.tools.node, ["-e", TOKEN_SEARCH, digest, folder]);
    check(
      "the token is nowhere in the VM's processes or the agent's folder",
      search.printed === "0",
      `${search.printed} found`,
    );
    const renewed = yield* Effect.exit(box.githubToken(agentId, token));
    const again = yield* inVm("gh", ["api", "/user", "--jq", ".login"]);
    check(
      "a renewal rewrites the token with no restart",
      Exit.isSuccess(renewed) && again.code === 0,
    );
  }

  // The runner ended gracefully: signalled in the VM, then its exec ends with it inside the grace.
  yield* box.signalled(agentId);
  const ended = yield* Effect.timeoutOption(runner.exitCode, GRACE);
  check(
    "the runner hears SIGTERM and ends inside its grace",
    Option.exists(ended, (code) => Number(code) === 0),
  );
  check("it got the signal, not a kill", existsSync(path.join(folder, "tmp", "sigterm")));
  yield* Effect.ignore(runner.kill({ forceKillAfter: GRACE }));

  // The turn's end deletes its VM and the token kept for it; the next turn makes one fresh over the same folder, and a discard deletes that one.
  const stands = Effect.map(
    output(SMOLVM, ["machine", "status", "--name", `luke-${agentId}`, "--json"]),
    (status) => status.code === 0,
  );
  const credentials = path.join(root, "state", "sandboxes", agentId);
  check("the turn's end deletes the VM", (yield* box.deleted(agentId)) && !(yield* stands));
  check("and the token kept for it", !existsSync(credentials));
  check("the agent's folder stays for its next turn", existsSync(file));
  if (token !== undefined) yield* box.githubToken(agentId, token);
  const nextAt = Date.now();
  const next = yield* Effect.exit(box.started({ agentId, folder, github: token !== undefined }));
  check(
    "the next turn makes a fresh VM",
    Exit.isSuccess(next) && (yield* stands),
    `${((Date.now() - nextAt) / 1000).toFixed(1)} s`,
  );
  const kept = yield* inVm("cat", ["written-in-vm"]);
  check("which sees what the turn before wrote in the folder", kept.printed === "from-the-vm");
  yield* box.deleted(agentId);
  check("a discard deletes the VM", !(yield* stands));
  check("and the token kept for it", !existsSync(credentials));
  check("the agent's folder is left for the follower to remove", existsSync(folder));

  process.stdout.write(
    failures.length === 0 ? "Every check passed.\n" : `${failures.length} failed.\n`,
  );
  return failures.length === 0 ? 0 : 1;
});

NodeRuntime.runMain(
  handTest.pipe(
    Effect.scoped,
    Effect.provide(
      NodeChildProcessSpawner.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
      ),
    ),
  ),
  { teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : 1) },
);
