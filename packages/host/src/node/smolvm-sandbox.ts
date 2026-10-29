import {
  type AgentToolPin,
  CLAUDE_CODE_PIN,
  CODEX_PIN,
  SANDBOX_IMAGE,
} from "@luke/agent-runner/pins";
import { Duration, Effect, Option, Ref, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess } from "effect/process";
import {
  type LocalAgentCommand,
  type LocalAgentRunner,
  type LocalAgentSandbox,
  type LocalAgentSandboxCommand,
  LocalAgentSandboxUnavailable,
} from "../effect/seams.js";
import { keptToolBinary, localAgentTool } from "../local-agent-tools.js";

/**
 * smolvm-sandbox.ts -- a sandboxed device's VM per local agent, through the `smolvm` CLI (https://github.com/smol-machines/smolvm): made from Luke's sandbox image with the agent's folder mounted at the same path, the runner run in it, stopped once the runner ends, and deleted with the agent.
 *
 * One machine per agent, named for it, made the first time its runner
 * starts and started again for every later launch, so what the agent
 * installed outside its folder lasts until it is discarded, or until the
 * pin moves: a stopped machine smolvm says was made from another image is
 * deleted and made again from the pinned one, with the mounts of now, as
 * its runner starts, and a running one is never touched. The machine
 * boots the pinned image (`SANDBOX_IMAGE`), the one the cloud's sandbox is
 * built from, with networking on, the agent's folder and the folder of the
 * runner's bundle mounted at the paths they have on the device (the bundle
 * read-only), so every path the service hands out stands in both, and a
 * workload that only sleeps, as root, since `machine exec` runs inside the
 * running workload's container. Nested KVM is passed through where the
 * device has `/dev/kvm` (`SmolvmSandboxOptions.nested`), and never on a Mac.
 *
 * Every command in the VM, the runner and a check of the folder alike, runs
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
 * A Linux host runs the `smolvm` at the path its service names, which its
 * daemon checked answers the pinned release; a Mac runs the pinned release
 * it fetched and checked itself (`SmolvmSandboxOptions.smolvm`), and
 * before it registers as sandboxed (`ready`) pulls the image once through a
 * throwaway machine, which leaves smolvm's own seed of it behind, so every
 * agent's VM made afterwards starts from a copy of that disk rather than
 * pulling the image again.
 *
 * Nothing `smolvm` prints is kept but the last line of a failure to make or
 * start a machine, which names no secret: a credential is only ever a
 * reference to its file there.
 */

/** What a Mac says it could not have, as it registers its setup failed: words of Luke's own, never smolvm's. */
const SETUP_FAILURE = {
  SMOLVM: "smolvm couldn't be downloaded or didn't pass its check",
  IMAGE: "the sandbox image couldn't be downloaded",
} as const;

/** The machine's workload: one that never exits, so `machine exec` always has a running container to run in. */
const WORKLOAD = ["sh", "-c", "while true; do sleep 3600; done"] as const;

/** The workload's user, root, so no process of the machine's own is ever taken for one of the agent's, who runs as the device's user. */
const WORKLOAD_USER = "0:0";

/** How long making and starting a machine may take: the first start pulls the image, about 1.3 GB. */
const START_TIMEOUT = Duration.minutes(15);
/** How long stopping or deleting a machine may take, past the workload's own stop timeout. */
const STOP_TIMEOUT = Duration.minutes(1);
/** How long smolvm may take to say what it has of a machine. */
const STATUS_TIMEOUT = Duration.seconds(30);
/** How long the signal to the agent's processes may take to be sent. */
const SIGNAL_TIMEOUT = Duration.seconds(10);
/** How much of a failure smolvm printed is kept. */
const FAILURE_CHARACTERS = 300;

/** The file under the device's credentials folder that names the image a throwaway machine last pulled, so a Mac pulls it once; a dot keeps it from naming an agent. */
const IMAGE_SEEDED = ".image-seeded";

/** The throwaway machine's command, which only has to boot for smolvm to keep the image's seed. */
const SEED_COMMAND = ["true"] as const;

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
  /** The `smolvm` the device runs: a program at the path given, as on a Linux host, or the pinned release it fetches and checks under its state, as on a Mac. */
  readonly smolvm: string | AgentToolPin;
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

/** The code smolvm gives a machine that does not exist, under `--error-format json`. */
const NOT_FOUND = "NOT_FOUND";

/** The states smolvm says a machine that is not running is in, by its own names: made and never started, stopped, or crashed. */
const STOPPED_STATE = { CREATED: "created", STOPPED: "stopped", FAILED: "failed" } as const;
const STOPPED_STATES: ReadonlySet<string> = new Set(Object.values(STOPPED_STATE));

/** What smolvm says of a machine under `machine status --json`: its state, and the image it was made from, as it was named. */
const decodeStatus = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ state: Schema.String, image: Schema.NullOr(Schema.String) }),
  ),
);

/** A failure as smolvm prints it under `--error-format json`: a stable code, and its words. */
const decodeFailure = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ),
);

/**
 * Whether a machine smolvm says was made from `image` runs the pinned one:
 * the same digest where the pin names one, since a registry may be spelled
 * with or without its tag beside it (smolvm's own canonical form drops it),
 * and the same reference otherwise.
 */
function isPinned(image: string | null): boolean {
  const digestOf = (reference: string) => reference.split("@")[1];
  const pinned = digestOf(SANDBOX_IMAGE);
  if (image === null) return false;
  return pinned === undefined ? image === SANDBOX_IMAGE : digestOf(image) === pinned;
}

/** A failure smolvm printed: its code where it printed one as JSON, and its words, the last line where it did not, cut short. */
function failureOf(printed: string): { readonly code: string | undefined; readonly words: string } {
  const last = printed.trim().split("\n").at(-1) ?? "";
  return Option.match(decodeFailure(last), {
    onNone: () => ({ code: undefined, words: last.slice(0, FAILURE_CHARACTERS) }),
    onSome: ({ error }) => ({
      code: error.code,
      words: error.message.slice(0, FAILURE_CHARACTERS),
    }),
  });
}

/** A sandboxed device's VMs through `smolvm`: the launch that starts a runner in its agent's VM, and the VM's lifetime around it. */
export function smolvmSandbox(options: SmolvmSandboxOptions): {
  readonly launch: (runner: LocalAgentRunner) => LocalAgentCommand;
  readonly sandbox: LocalAgentSandbox;
} {
  const user = `${options.user.uid}:${options.user.gid}`;
  const pinned = typeof options.smolvm === "string" ? undefined : options.smolvm;
  const program =
    typeof options.smolvm === "string"
      ? options.smolvm
      : keptToolBinary(options.stateRoot, options.smolvm);
  /** A `smolvm` command as the process it is started as. */
  const spawned = (args: readonly string[]) => ({ command: program, args });
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
        const started = spawned(args);
        const handle = yield* ChildProcess.make(started.command, [...started.args], {
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

  /** What smolvm says of the agent's machine; none where it said nothing it could read, as of a machine it does not have. */
  const statusOf = (agentId: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = spawned(["machine", "status", "--name", machineOf(agentId), "--json"]);
        const handle = yield* ChildProcess.make(started.command, [...started.args], {
          stdin: "ignore",
          stderr: "ignore",
        });
        const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));
        return Number(yield* handle.exitCode) === 0 ? decodeStatus(printed) : Option.none();
      }),
    ).pipe(
      Effect.timeoutOption(STATUS_TIMEOUT),
      Effect.map(Option.flatten),
      Effect.orElseSucceed(() => Option.none<{ state: string; image: string | null }>()),
    );

  /** The names of every machine smolvm keeps, one a line (`machine ls -q`); none where it could not list them in time. */
  const machinesListed = Effect.scoped(
    Effect.gen(function* () {
      const started = spawned(["machine", "ls", "-q"]);
      const handle = yield* ChildProcess.make(started.command, [...started.args], {
        stdin: "ignore",
        stderr: "ignore",
      });
      const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));
      if (Number(yield* handle.exitCode) !== 0) return Option.none<readonly string[]>();
      return Option.some<readonly string[]>(
        printed
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );
    }),
  ).pipe(
    Effect.timeoutOption(STOP_TIMEOUT),
    Effect.map(Option.flatten),
    Effect.orElseSucceed(() => Option.none<readonly string[]>()),
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
    const started = spawned([
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
    ]);
    return {
      ...started,
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

  /**
   * Whether smolvm keeps a seed of the image, pulled now where the device
   * has no record of it: a throwaway machine of the very reference every
   * agent's machine is made from, which smolvm deletes once its command
   * exits, and whose pull it keeps beside its own state for every later
   * machine of that reference. Recorded once it succeeds, so a Mac pulls the
   * image once; a seed smolvm let go of since is pulled again by the next
   * agent's first start, as without one.
   */
  const imageSeeded = (pulling: Effect.Effect<void>) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const folder = [options.stateRoot, CREDENTIALS_FOLDER].join("/");
      const record = [folder, IMAGE_SEEDED].join("/");
      const recorded = yield* fileSystem
        .readFileString(record)
        .pipe(Effect.orElseSucceed(() => ""));
      if (recorded.trim() === SANDBOX_IMAGE) return true;
      yield* pulling;
      const pulled = yield* succeeded(
        ["machine", "run", "--net", "--image", SANDBOX_IMAGE, "--", ...SEED_COMMAND],
        START_TIMEOUT,
      );
      if (!pulled) return false;
      yield* fileSystem.makeDirectory(folder, { recursive: true, mode: 0o700 });
      yield* fileSystem.writeFileString(record, `${SANDBOX_IMAGE}\n`);
      return true;
    }).pipe(Effect.orElseSucceed(() => false));

  const sandbox: LocalAgentSandbox = {
    tools: { node: "node", claude: CLAUDE_CODE_PIN.LINK, codex: CODEX_PIN.LINK },

    ready: (preparing) =>
      Effect.gen(function* () {
        if (pinned === undefined) return;
        // Note that the device says it is getting ready once, whichever of the two fetches begins first.
        const said = yield* Ref.make(false);
        const once = Effect.flatMap(Ref.getAndSet(said, true), (already) =>
          already ? Effect.void : preparing,
        );
        const had = yield* localAgentTool(options.stateRoot, pinned, once);
        if (Option.isNone(had)) return yield* unavailable(SETUP_FAILURE.SMOLVM);
        if (!(yield* imageSeeded(once))) return yield* unavailable(SETUP_FAILURE.IMAGE);
      }),

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
        // Note that a stopped machine made from another image is deleted, its folder and credentials kept, so the start below makes it again from the pinned one; a running one is never touched.
        const status = yield* statusOf(agentId);
        if (
          Option.exists(status, (each) => STOPPED_STATES.has(each.state) && !isPinned(each.image))
        ) {
          const removed = yield* ran(
            ["machine", "delete", "--name", machineOf(agentId), "-f", "--error-format", "json"],
            STOP_TIMEOUT,
          );
          if (Option.isNone(removed)) {
            return yield* unavailable(
              "smolvm did not delete the machine made from an earlier image",
            );
          }
          if (removed.value.code !== 0) {
            return yield* unavailable(
              `the machine made from an earlier image could not be deleted: ${failureOf(removed.value.printed).words}`,
            );
          }
        }
        const start = ["machine", "start", "--name", machineOf(agentId), "--error-format", "json"];
        const first = yield* ran(start, START_TIMEOUT);
        if (Option.isNone(first)) return yield* unavailable("smolvm did not start the machine");
        if (first.value.code === 0) return;
        // Note that only a machine smolvm says does not exist is made; one that exists and will not boot says why, rather than colliding with its own name.
        const why = failureOf(first.value.printed);
        if (why.code !== NOT_FOUND) return yield* unavailable(why.words);
        const made = yield* ran(created(agentId, folder, github), START_TIMEOUT);
        if (Option.isNone(made)) return yield* unavailable("smolvm did not make the machine");
        if (made.value.code !== 0) return yield* unavailable(failureOf(made.value.printed).words);
        const up = yield* ran(start, START_TIMEOUT);
        if (Option.isNone(up)) return yield* unavailable("smolvm did not start the machine");
        if (up.value.code !== 0) return yield* unavailable(failureOf(up.value.printed).words);
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

    // Note that a delete smolvm refused counts as gone only where it no longer lists the machine, as for one that never stood, and the credentials go only once the machine has, since it reads them.
    deleted: (agentId) =>
      Effect.gen(function* () {
        if (!AGENT_ID.test(agentId)) return false;
        const name = machineOf(agentId);
        yield* ran(["machine", "stop", "--name", name], STOP_TIMEOUT);
        const gone =
          (yield* succeeded(["machine", "delete", "--name", name, "-f"], STOP_TIMEOUT)) ||
          Option.exists(yield* machinesListed, (names) => !names.includes(name));
        if (!gone) return false;
        const fileSystem = yield* FileSystem.FileSystem;
        return yield* fileSystem
          .remove(credentialsOf(agentId).folder, { recursive: true, force: true })
          .pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          );
      }),

    held: Effect.gen(function* () {
      const machines = yield* machinesListed;
      if (Option.isNone(machines)) return Option.none<ReadonlySet<string>>();
      const fileSystem = yield* FileSystem.FileSystem;
      const credentials = yield* fileSystem
        .readDirectory([options.stateRoot, CREDENTIALS_FOLDER].join("/"))
        .pipe(Effect.orElseSucceed((): readonly string[] => []));
      const prefix = machineOf("");
      return Option.some<ReadonlySet<string>>(
        new Set([
          ...machines.value.flatMap((name) =>
            name.startsWith(prefix) ? [name.slice(prefix.length)] : [],
          ),
          ...credentials.filter((name) => AGENT_ID.test(name)),
        ]),
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
