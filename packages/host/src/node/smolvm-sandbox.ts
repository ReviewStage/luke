import { CLAUDE_CODE_PIN, CODEX_PIN } from "@luke/agent-runner/pins";
import { Duration, Effect, Option, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess } from "effect/process";
import {
  type LocalAgentCommand,
  type LocalAgentRunner,
  type LocalAgentSandbox,
  type LocalAgentSandboxCommand,
  LocalAgentSandboxUnavailable,
} from "../effect/seams.js";

/**
 * smolvm-sandbox.ts -- a sandboxed device's VM per local agent, through the `smolvm` CLI (https://github.com/smol-machines/smolvm): made from Luke's sandbox image with the agent's folder mounted at the same path, the runner run in it, stopped once the runner ends, and deleted with the agent.
 *
 * One machine per agent, named for it, made the first time its runner
 * starts and started again for every later launch, so what the agent
 * installed outside its folder lasts until it is discarded. The machine
 * boots the pinned image (`SANDBOX_IMAGE`), the one the cloud's sandbox is
 * built from, with networking on, the agent's folder and the folder of the
 * runner's bundle mounted at the paths they have on the device (the bundle
 * read-only), so every path the service hands out stands in both, and a
 * workload that only sleeps, as root, since `machine exec` runs inside the
 * running workload's container. Nested KVM is passed through where the
 * device has `/dev/kvm` (`SmolvmSandboxOptions.nested`), and never on a Mac.
 *
 * Every command in the VM, the runner and a tool's command alike, runs
 * through `machine exec -i`, without which its output is held until it
 * exits, and no TTY: as the device's own user (`--user uid:gid`), since a
 * mount keeps the device's owners and the image's own user could not write
 * the folder; with `HOME`, `XDG_CACHE_HOME`, `PNPM_HOME` and
 * `NPM_CONFIG_PREFIX` inside the agent's folder, since the image's point
 * into a home only its own user reads; and with every variable the caller
 * hands, the claim's secrets among them, passed by name (`--secret-env`),
 * read from the command's own environment and never spelled in an
 * argument. The device's own `HOME`, `PATH` and login names stay with
 * `smolvm` itself. Killing `machine exec` ends what it runs at once, with no
 * signal, so `signalled` asks every process of the agent's in the VM to end
 * first (`SIGNAL_EVERY_PROCESS`, as the agent's user, which reaches none of
 * the machine's own).
 *
 * GitHub's credential never enters the VM. The machine is made with two
 * bindings smolvm resolves on the device for each HTTPS request
 * (docs/credential-substitution.md): `GH_TOKEN` for `api.github.com`, which
 * the VM holds only as smolvm's placeholder and `gh` sends as it is, and an
 * `authorization` header smolvm sets on every request to `github.com`, for
 * git, whose own Basic encoding of a placeholder smolvm could not see. Both
 * are fed from files under the device's state, outside every folder the VM
 * mounts, which smolvm reads on every request, so the renewal rewriting
 * them (`githubToken`) takes effect at once; never a variable of the
 * device's, which smolvm reads only as the machine starts, and bindings
 * cannot change on a machine once made. A git run on the device itself, as
 * the worktree's script runs, reads the same file through a credential
 * helper of its environment (`deviceGit`), never the token.
 *
 * Nothing `smolvm` prints is kept but the last line of a failure to make or
 * start a machine, which names no secret: a credential is only ever a
 * reference to its file there.
 */

/** Luke's sandbox image, as CI publishes it from the cloud's own setup script, pinned by digest. */
const SANDBOX_IMAGE =
  "ghcr.io/reviewstage/luke-sandbox:35c90fc1c0bee4e5@sha256:168aedd03509fa3bccb00b84059baea6d19ae7032a7f0ad0c46f43b6a8bf21e0";

/** The machine's workload: one that never exits, so `machine exec` always has a running container to run in. */
const WORKLOAD = ["sh", "-c", "while true; do sleep 3600; done"] as const;

/** The workload's user, root, so no process of the machine's own is ever taken for one of the agent's, who runs as the device's user. */
const WORKLOAD_USER = "0:0";

/** How long making and starting a machine may take: the first start pulls the image, about 1.3 GB. */
const START_TIMEOUT = Duration.minutes(15);
/** How long stopping or deleting a machine may take, past the workload's own stop timeout. */
const STOP_TIMEOUT = Duration.minutes(1);
/** How long the signal to the agent's processes may take to be sent. */
const SIGNAL_TIMEOUT = Duration.seconds(10);
/** How much of a failure smolvm printed is kept. */
const FAILURE_CHARACTERS = 300;

/** The folders under the agent's own its VM's home and caches are kept in. */
const VM_FOLDER = { HOME: "home", CACHE: "cache" } as const;

/** Where under the VM's home pnpm and npm keep what a global install puts there. */
const VM_HOME_FOLDER = { PNPM: ".local/share/pnpm", NPM: ".npm-global" } as const;

/** The variables of the device's own that stay with `smolvm` and are never handed into the VM. */
const DEVICE_VARIABLES: ReadonlySet<string> = new Set(["HOME", "PATH", "SHELL", "USER", "LOGNAME"]);

/** What a command in the VM starts under: pnpm's and npm's global folders first on the image's `PATH`, then the command. */
const IN_VM_START = 'PATH="$PNPM_HOME:$NPM_CONFIG_PREFIX/bin:$PATH"; export PATH; exec "$@"';

/**
 * What asks every process of the agent's in its VM to end: `kill(-1,
 * SIGTERM)` as the agent's user, which reaches every process that user may
 * signal but the caller itself, so none of the machine's own, which run as
 * root. Run on the image's Node rather than a shell's `kill`, whose reading
 * of `-1` differs between shells.
 */
const SIGNAL_EVERY_PROCESS = "try { process.kill(-1, 'SIGTERM'); } catch {}";

/** The folder under the device's state an agent's GitHub credential is kept in, out of reach of its VM. */
const CREDENTIALS_FOLDER = "sandboxes";

/** The two files an agent's GitHub credential is kept as, each the value smolvm sends. */
const CREDENTIAL_FILE = {
  /** The token itself, which smolvm puts in place of `GH_TOKEN`'s placeholder for `gh`. */
  TOKEN: "github-token",
  /** `Basic base64(x-access-token:<token>)`, the header smolvm sets for git. */
  GIT_AUTHORIZATION: "git-authorization",
} as const;

/** The bindings each VM is made with, by smolvm's own names: the binding, the VM's variable, and its hosts and options. */
const CREDENTIAL = {
  GH: { NAME: "github", VARIABLE: "GH_TOKEN", HOSTS: "api.github.com" },
  GIT: { NAME: "git", VARIABLE: "GIT_AUTH", HOSTS: "github.com:set-header=authorization" },
} as const;

/** The username GitHub takes an installation token under over git's HTTPS. */
const GIT_USERNAME = "x-access-token";

/** The git config key of the helper that answers for GitHub's HTTPS remotes. */
const CREDENTIAL_HELPER_KEY = "credential.https://github.com.helper";

/** An agent id fit to name a machine and a folder: no separator, no dot, nothing a shell or a path would read. */
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

interface SmolvmSandboxOptions {
  /** The `smolvm` the device runs. */
  readonly smolvm: string;
  /** The device's own state, under which each agent's GitHub credential is kept, outside every folder a VM mounts. */
  readonly stateRoot: string;
  /** The folder of the runner's bundle, mounted read-only at the same path. */
  readonly runnerFolder: string;
  /** The device's own user, which every command in a VM runs as. */
  readonly user: { readonly uid: number; readonly gid: number };
  /** Whether each VM may run VMs of its own: where the device has `/dev/kvm`, and never on a Mac. */
  readonly nested: boolean;
}

/** A word quoted for a POSIX shell. */
function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The machine an agent runs in, by its id, one per agent. */
function machineOf(agentId: string): string {
  return `luke-${agentId}`;
}

/** The VM's own folders, inside the agent's: its home, its caches, and pnpm's and npm's global folders. */
function vmFolders(folder: string) {
  const home = [folder, VM_FOLDER.HOME].join("/");
  return {
    home,
    cache: [folder, VM_FOLDER.CACHE].join("/"),
    pnpm: [home, VM_HOME_FOLDER.PNPM].join("/"),
    npm: [home, VM_HOME_FOLDER.NPM].join("/"),
  };
}

/** A failure smolvm printed, as its last line, cut short. */
function failureOf(printed: string): string {
  const lines = printed.trim().split("\n");
  return (lines.at(-1) ?? "").slice(0, FAILURE_CHARACTERS);
}

/** A sandboxed device's VMs through `smolvm`: the launch that starts a runner in its agent's VM, and the VM's lifetime around it. */
export function smolvmSandbox(options: SmolvmSandboxOptions): {
  readonly launch: (runner: LocalAgentRunner) => LocalAgentCommand;
  readonly sandbox: LocalAgentSandbox;
} {
  const user = `${options.user.uid}:${options.user.gid}`;
  const credentialsOf = (agentId: string) => {
    const folder = [options.stateRoot, CREDENTIALS_FOLDER, agentId].join("/");
    return {
      folder,
      token: [folder, CREDENTIAL_FILE.TOKEN].join("/"),
      gitAuthorization: [folder, CREDENTIAL_FILE.GIT_AUTHORIZATION].join("/"),
    };
  };

  /** One `smolvm` command run to its end: its exit code, and what it printed on stderr; none where it could not run in time. */
  const ran = (args: readonly string[], within: Duration.Input) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(options.smolvm, [...args], {
          stdin: "ignore",
          stdout: "ignore",
        });
        const printed = yield* Stream.mkString(Stream.decodeText(handle.stderr));
        return { code: Number(yield* handle.exitCode), printed };
      }),
    ).pipe(
      Effect.timeoutOption(within),
      Effect.orElseSucceed(() => Option.none<{ code: number; printed: string }>()),
    );

  /** Whether a `smolvm` command ran and exited 0. */
  const succeeded = (args: readonly string[], within: Duration.Input) =>
    Effect.map(
      ran(args, within),
      Option.exists((each) => each.code === 0),
    );

  const exec = (command: LocalAgentSandboxCommand): LocalAgentCommand => {
    const folders = vmFolders(command.folder);
    const handed = Object.keys(command.env).filter((name) => !DEVICE_VARIABLES.has(name));
    return {
      command: options.smolvm,
      args: [
        "machine",
        "exec",
        "--name",
        machineOf(command.agentId),
        "-i",
        "--user",
        user,
        "-w",
        command.cwd,
        "-e",
        `HOME=${folders.home}`,
        "-e",
        `XDG_CACHE_HOME=${folders.cache}`,
        "-e",
        `PNPM_HOME=${folders.pnpm}`,
        "-e",
        `NPM_CONFIG_PREFIX=${folders.npm}`,
        ...handed.flatMap((name) => ["--secret-env", `${name}=${name}`]),
        "--",
        "sh",
        "-c",
        IN_VM_START,
        "sh",
        command.command,
        ...command.args,
      ],
      // Note that smolvm reads each variable it hands in by name from its own environment, beside the device's own it runs under.
      env: command.env,
    };
  };

  /** The arguments that make the agent's machine. */
  const created = (agentId: string, folder: string, github: boolean): readonly string[] => {
    const credentials = credentialsOf(agentId);
    return [
      "machine",
      "create",
      "--name",
      machineOf(agentId),
      "--image",
      SANDBOX_IMAGE,
      "--net",
      "--user",
      WORKLOAD_USER,
      "-v",
      `${folder}:${folder}`,
      "-v",
      `${options.runnerFolder}:${options.runnerFolder}:ro`,
      ...(options.nested ? ["--nested"] : []),
      ...(github
        ? [
            "--secret-file",
            `${CREDENTIAL.GH.VARIABLE}=${credentials.token}`,
            "--credential",
            `${CREDENTIAL.GH.NAME}=${CREDENTIAL.GH.VARIABLE}@${CREDENTIAL.GH.HOSTS}`,
            "--secret-file",
            `${CREDENTIAL.GIT.VARIABLE}=${credentials.gitAuthorization}`,
            "--credential",
            `${CREDENTIAL.GIT.NAME}=${CREDENTIAL.GIT.VARIABLE}@${CREDENTIAL.GIT.HOSTS}`,
          ]
        : []),
      "--",
      ...WORKLOAD,
    ];
  };

  /** A file written whole beside its place and moved over it, so smolvm never reads half of one. */
  const replaced = (target: string, contents: string) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const writing = `${target}.writing`;
      yield* fileSystem.writeFileString(writing, contents, { mode: 0o600 });
      yield* fileSystem.chmod(writing, 0o600);
      yield* fileSystem.rename(writing, target);
    });

  /** The agent's credential folder, readable by the device's user alone. */
  const credentialFolder = (agentId: string) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const credentials = credentialsOf(agentId);
      yield* fileSystem.makeDirectory(credentials.folder, { recursive: true, mode: 0o700 });
      yield* fileSystem.chmod(credentials.folder, 0o700);
      return credentials;
    });

  const unavailable = (detail: string) => new LocalAgentSandboxUnavailable({ detail });

  const sandbox: LocalAgentSandbox = {
    tools: { node: "node", claude: CLAUDE_CODE_PIN.LINK, codex: CODEX_PIN.LINK },

    started: ({ agentId, folder, github }) =>
      Effect.gen(function* () {
        if (!AGENT_ID.test(agentId)) return yield* unavailable("the agent's id names no machine");
        const fileSystem = yield* FileSystem.FileSystem;
        const folders = vmFolders(folder);
        for (const each of [folders.home, folders.cache]) {
          yield* fileSystem.makeDirectory(each, { recursive: true, mode: 0o700 });
        }
        if (github) {
          // Note that both files stand before the machine is made, a token or not, so smolvm finds what its bindings name.
          const credentials = yield* credentialFolder(agentId);
          for (const each of [credentials.token, credentials.gitAuthorization]) {
            if (!(yield* fileSystem.exists(each))) yield* replaced(each, "");
          }
        }
        const name = machineOf(agentId);
        if (yield* succeeded(["machine", "start", "--name", name], START_TIMEOUT)) return;
        const made = yield* ran(created(agentId, folder, github), START_TIMEOUT);
        if (Option.isNone(made)) return yield* unavailable("smolvm did not make the machine");
        if (made.value.code !== 0) return yield* unavailable(failureOf(made.value.printed));
        const up = yield* ran(["machine", "start", "--name", name], START_TIMEOUT);
        if (Option.isNone(up)) return yield* unavailable("smolvm did not start the machine");
        if (up.value.code !== 0) return yield* unavailable(failureOf(up.value.printed));
      }).pipe(
        Effect.catchTag("PlatformError", () =>
          Effect.fail(unavailable("the agent's folders could not be made")),
        ),
      ),

    woken: (agentId) =>
      AGENT_ID.test(agentId)
        ? succeeded(["machine", "start", "--name", machineOf(agentId)], START_TIMEOUT)
        : Effect.succeed(false),

    exec,

    signalled: (agentId) =>
      Effect.asVoid(
        ran(
          [
            "machine",
            "exec",
            "--name",
            machineOf(agentId),
            "--user",
            user,
            "--",
            sandbox.tools.node,
            "-e",
            SIGNAL_EVERY_PROCESS,
          ],
          SIGNAL_TIMEOUT,
        ),
      ),

    // Note that a graceful stop that fails is followed by one that kills the workload at once, so a later launch never finds the agent's leftovers still running.
    stopped: (agentId) =>
      Effect.gen(function* () {
        const name = machineOf(agentId);
        if (yield* succeeded(["machine", "stop", "--name", name], STOP_TIMEOUT)) return true;
        return yield* succeeded(
          ["machine", "stop", "--name", name, "--timeout", "0"],
          STOP_TIMEOUT,
        );
      }),

    deleted: (agentId) =>
      Effect.gen(function* () {
        if (!AGENT_ID.test(agentId)) return;
        const name = machineOf(agentId);
        yield* ran(["machine", "stop", "--name", name], STOP_TIMEOUT);
        yield* ran(["machine", "delete", "--name", name, "-f"], STOP_TIMEOUT);
        const fileSystem = yield* FileSystem.FileSystem;
        yield* Effect.ignore(
          fileSystem.remove(credentialsOf(agentId).folder, { recursive: true, force: true }),
        );
      }),

    githubToken: (agentId, token) =>
      Effect.gen(function* () {
        if (!AGENT_ID.test(agentId)) return;
        const credentials = yield* credentialFolder(agentId);
        yield* replaced(credentials.token, token);
        yield* replaced(credentials.gitAuthorization, `Basic ${btoa(`${GIT_USERNAME}:${token}`)}`);
      }),

    deviceGit: (agentId) => ({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: CREDENTIAL_HELPER_KEY,
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: CREDENTIAL_HELPER_KEY,
      GIT_CONFIG_VALUE_1: `!f() { test "$1" = get || exit 0; printf 'username=${GIT_USERNAME}\\npassword=%s\\n' "$(cat ${shellQuoted(credentialsOf(agentId).token)})"; }; f`,
    }),
  };

  return {
    launch: (runner) =>
      exec({
        agentId: runner.agentId,
        folder: runner.folder,
        cwd: runner.checkout,
        command: runner.node,
        args: [runner.bundle],
        env: runner.env,
      }),
    sandbox,
  };
}
