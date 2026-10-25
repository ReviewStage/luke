/**
 * vercel-machine.ts -- the agent machine over Vercel Sandbox: a sandbox opened from the coding agent's image, the runner launched in it as a detached command, and Luke's doors read through it with every capability dropped.
 *
 * `open` opens a sandbox from the coding agent's image
 * (`../agent-sandbox-image.ts`), waiting while the image is prepared where
 * the caller asks, and checks the agent's repository out into it on eve's
 * terms (`../coder-host/checkout.ts`, the same token at the firewall, but
 * cloned whole, since the history is deepened before the runner starts
 * anyway), or opens it from its workspace's repository snapshot of the same
 * image and fetches only what landed since (`../repository-snapshot.ts`),
 * building that snapshot past the answer where none was ready. The deepen
 * is left to the launch (`finishCheckout`), which runs it beside its own
 * uploads. A sandbox whose use failed is deleted again.
 *
 * `launchRunner` uploads the runner's bundle (`../coder-host/runner-bundle.ts`)
 * and starts it as a detached command of the sandbox's API as root, which
 * installs the bundle where only root writes, checks its digest, shares the
 * checkout with the `agent` user, and drops to that user with every
 * capability gone (`../sandbox-capabilities.ts`). The harness's credential
 * and the bearer are in that command's environment and nowhere else: never
 * in its argv, its config line, a file, or a tag. Its first lines are
 * written to its stdin.
 *
 * The doors read the sandbox carrying the agent's session id as its tag, as
 * every agent's sandbox does, and only its running session: nothing is
 * resumed, since the agent calling the tool runs in that sandbox, so a
 * sandbox not up has nothing to read from. A file is read by a command run
 * with every capability dropped, as a Terminal's shell runs, never through
 * Vercel's own file read, which reads as root: the agent names any path,
 * and a model talked into naming `/proc/<runner pid>/environ`, a file under
 * `agent`'s private home, or a link to either in the checkout would
 * otherwise hand its harness's token to a page, a picture, or the inbox.
 * Under the drop such a path reads as no file. A repository's command is
 * run in the running session and waited on, its environment named by `env`
 * on the command line rather than by the API, as Luke's other commands are
 * run (`../vercel-sandbox-api.ts`).
 *
 * A place is found again by the session's tag, and its runner by the tags a
 * launch writes beside it: the command, the sandbox session it runs in, and
 * the launch's first event number and fingerprint (`RUNNER_TAG`). The
 * firewall is the sandbox's network policy, a stop is the session's, and a
 * resume opens the sandbox's last snapshot, its timeout lowered first, so
 * the session it opens lives a launch's timeout and not an old sandbox's
 * day; a snapshot expired is a place gone for good.
 */

import { createHash, randomUUID } from "node:crypto";
import { AGENT_USER, RUNNER_DIRECTORY } from "@luke/agent-runner/pins";
import {
  type CodingAgent,
  hasRepository,
  type WithRepository,
} from "@luke/database/models/coding-agent-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { Brand, Duration, Effect, Layer, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import { AfterResponse, afterResponse } from "../../http/after-response.js";
import {
  AgentSandboxImage,
  type AgentSandboxImageService,
  ImagePreparing,
} from "../agent-sandbox-image.js";
import { CODER, sandboxVcpus } from "../coder-host/bounds.js";
import {
  type AgentRepositoryRead,
  agentDeepenPlan,
  agentRepositoryRead,
  CHECKOUT_DEPTH,
  CheckoutRefused,
  cloneAgentRepository,
  deepenCheckoutWith,
  openWorkingFolder,
  refreshAgentCheckout,
} from "../coder-host/checkout.js";
import { NATIVE_SKILLS_PATH } from "../coder-host/native-skills.js";
import { RunnerBundle } from "../coder-host/runner-bundle.js";
import type { RepositorySandbox } from "../repository-shell.js";
import {
  buildRepositorySnapshot,
  forgetRepositorySnapshot,
  REPOSITORY_SNAPSHOT_STATE,
  type RepositorySnapshotOf,
  readRepositorySnapshot,
} from "../repository-snapshot.js";
import { WITHOUT_CAPABILITIES } from "../sandbox-capabilities.js";
import { capSandboxTimeout } from "../sandbox-keep-alive.js";
import { credentialPolicy } from "../terminal/agent-sandbox.js";
import {
  type ListedSandbox,
  type NetworkPolicy,
  NOT_FOUND_STATUS,
  type OidcTokenRead,
  OPEN_INTERNET_POLICY,
  SANDBOX_STATUS,
  SandboxUnavailable,
  SESSION_TAG,
  SNAPSHOT_GONE_STATUS,
  UP_STATUSES,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import {
  AgentMachine,
  type AgentMachineService,
  describeFailure,
  type FoundPlace,
  LaunchRefused,
  type MachineKept,
  type MachineLayout,
  type MachineLifecycle,
  type MachineName,
  type MachinePlace,
  type MachineRunning,
  PLACE_RESUME,
  type RepositoryCommand,
  RUNNER_RECORD,
  type RunnerHandle,
  type RunnerMark,
  type RunnerRecord,
} from "./agent-machine.js";

/**
 * The tags a sandbox Luke opens carries beside its session's: its agent, and
 * the runner it runs, so a later call finds both. Note that Vercel refuses a
 * sandbox more than five tags, the session's among them, so a launch's
 * fingerprint rides in its launch tag rather than a tag of its own.
 */
export const RUNNER_TAG = {
  AGENT: "lukeAgent",
  SANDBOX_SESSION: "lukeRunnerSession",
  COMMAND: "lukeRunnerCommand",
  /** The launch's first event number, then `LAUNCH_FINGERPRINT_MARK` and what the launch was started with that a warm runner cannot take up later (`launchFingerprint`). */
  LAUNCH: "lukeRunnerLaunch",
} as const;

/** What parts a launch tag's first event number from its fingerprint. */
const LAUNCH_FINGERPRINT_MARK = "-";

/**
 * Where a message's files that the harness takes no block of are written
 * in its sandbox, one folder per message line: outside the checkout, so no
 * commit picks them up, and readable by `agent`, since the API writes them
 * as its default user with the mode the caller names.
 */
const ATTACHMENT_DIRECTORY = "/tmp/luke-attachments";

/** Where a sandbox keeps an agent's things: the same for every agent, since each has a sandbox of its own. */
const SANDBOX_LAYOUT: MachineLayout = {
  checkoutPath: CODER.CHECKOUT_PATH,
  installedSkills: NATIVE_SKILLS_PATH.INSTALLED,
  skillsUpload: NATIVE_SKILLS_PATH.UPLOAD,
  attachments: ATTACHMENT_DIRECTORY,
  claudeExecutable: undefined,
};

/** What a sandbox Luke opens is named as, beside a fresh UUID; the sweep tells a native sandbox from eve's by it. */
export const SANDBOX_NAME = "luke-agent-";

/**
 * Where the launch stands in the sandbox: the bundle as the file API uploads
 * it, as the default user, and where it is installed root's, in the directory
 * the image made root's (`RUNNER_DIRECTORY`), so no Terminal's shell changes
 * what runs as `agent`.
 */
const RUNNER_PATH = {
  UPLOAD: "/tmp/luke-agent-runner.mjs",
  INSTALLED: `${RUNNER_DIRECTORY}/agent-runner.mjs`,
} as const;

/** The variables the sandbox opens with, as eve's coding-agent environment sets them. */
const SANDBOX_ENV = { NO_COLOR: "1", GH_STACK_NO_UPDATE_NOTIFIER: "1" } as const;

/**
 * The launch, run by bash as root: the uploaded bundle installed where only
 * root writes and checked against the digest Luke computed, the member's
 * installed skills, where the sandbox's opening uploaded them, moved where
 * only root writes and every user reads (`native-skills.ts`), the checkout
 * marked safe for git and shared with `agent`'s group, then the runner in
 * place of the shell as `agent`, every capability dropped. `$1` is the
 * digest; the secrets are in the environment the API hands the command, and
 * `exec` hands them on to the runner alone.
 */
const LAUNCH_SCRIPT = [
  "set -euo pipefail",
  `install -D -o root -g root -m 0444 ${RUNNER_PATH.UPLOAD} ${RUNNER_PATH.INSTALLED}`,
  `rm -f ${RUNNER_PATH.UPLOAD}`,
  `echo "$1  ${RUNNER_PATH.INSTALLED}" | sha256sum --check --status`,
  `if [ -d ${NATIVE_SKILLS_PATH.UPLOAD} ]; then rm -rf ${NATIVE_SKILLS_PATH.INSTALLED} && mkdir -p $(dirname ${NATIVE_SKILLS_PATH.INSTALLED}) && mv ${NATIVE_SKILLS_PATH.UPLOAD} ${NATIVE_SKILLS_PATH.INSTALLED} && chown -R root:root ${NATIVE_SKILLS_PATH.INSTALLED} && chmod -R u=rwX,go=rX ${NATIVE_SKILLS_PATH.INSTALLED}; fi`,
  `git config --system --get-all safe.directory 2>/dev/null | grep -Fxq ${CODER.CHECKOUT_PATH} || git config --system --add safe.directory ${CODER.CHECKOUT_PATH}`,
  `if [ -d ${CODER.CHECKOUT_PATH}/.git ]; then git -C ${CODER.CHECKOUT_PATH} config core.sharedRepository group; fi`,
  `chmod -R g+rwX ${CODER.CHECKOUT_PATH}`,
  `find ${CODER.CHECKOUT_PATH} -type d -exec chmod g+s {} +`,
  `exec ${WITHOUT_CAPABILITIES.COMMAND} --reuid=${AGENT_USER} --regid=${AGENT_USER} --init-groups ${WITHOUT_CAPABILITIES.ARGS.join(" ")} env HOME=/home/${AGENT_USER} USER=${AGENT_USER} LOGNAME=${AGENT_USER} node ${RUNNER_PATH.INSTALLED}`,
].join("\n");

/** What `$0` reads as in the launch's shell. */
const LAUNCH_NAME = "luke-agent-runner";

/** How the read exits where the path is no regular file the sandbox's user may read. */
const READ_EXIT = { NO_FILE: 3 } as const;

/**
 * The read, run by bash: the file named as `$1`, at most `$2` bytes of it,
 * printed in base64 on one line, since a command's output reaches Luke as
 * text. A path that is no regular file the sandbox's user may read exits
 * apart, before anything is printed.
 */
const READ_SCRIPT = [
  "set -o pipefail",
  `[ -f "$1" ] && [ -r "$1" ] || exit ${READ_EXIT.NO_FILE}`,
  `head -c "$2" -- "$1" | base64 | tr -d '\\n'`,
].join("\n");

/**
 * How an open past its Start's answer waits on an image still being
 * prepared, a template whose snapshot a create found gone among them: on the
 * template's build to its end (`AgentSandboxImage.prepared`), then asked
 * again at once, and given up where the image is still being prepared after
 * the template's own wait. An open answers preparing before any sandbox
 * stands, so making it again leaves nothing behind. `times` only bounds a
 * template that answers ready yet keeps losing its snapshot. A message's
 * relaunch past its answer retries on it too, its lease let go for each
 * wait (`runner-sessions.ts`'s `send`).
 */
export const IMAGE_READY = {
  times: 3,
  while: (failure: { readonly _tag: string }) =>
    failure instanceof ImagePreparing
      ? Effect.flatMap(AgentSandboxImage, (image) =>
          image.prepared.pipe(Effect.orElseSucceed(() => false)),
        )
      : Effect.succeed(false),
};

/** Runs one effect on the edge's runtime; the checkout reaches the sandbox through promises (`repository-shell.ts`). */
export type SandboxRunner = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

/** What the machine is made with: the token Vercel is asked under, and the edge's runner the checkout runs through. */
export interface VercelMachineOptions {
  readonly readToken: OidcTokenRead;
  readonly run: SandboxRunner;
}

const runningOfSession = Brand.nominal<MachineRunning>();
const nameOfSandbox = Brand.nominal<MachineName>();

/** The place a sandbox's running session stands for, under Luke's session given. */
function vercelPlace(session: string, sandboxSessionId: string): MachinePlace {
  return {
    machine: CODING_AGENT_MACHINE.VERCEL,
    session,
    running: runningOfSession(sandboxSessionId),
  };
}

/** The runner a sandbox's tags name, where the sandbox runs the session it was started in. */
export interface TaggedRunner {
  readonly sandboxSessionId: string;
  readonly commandId: string;
  readonly firstSequence: number;
  /** None for a launch from before fingerprints were tagged. */
  readonly fingerprint?: string;
}

/** The launch tag read: its first event number and its fingerprint where it has one; none where the tag is missing or unreadable. */
function taggedLaunch(tags: Readonly<Record<string, string>>): RunnerMark | undefined {
  const [sequence = "", fingerprint] = (tags[RUNNER_TAG.LAUNCH] ?? "").split(
    LAUNCH_FINGERPRINT_MARK,
  );
  const firstSequence = Number(sequence);
  if (sequence === "" || !Number.isSafeInteger(firstSequence)) return undefined;
  return { firstSequence, ...(fingerprint === undefined ? {} : { fingerprint }) };
}

/** The runner a sandbox's tags name, whatever the sandbox runs now; none where a tag is missing. */
export function taggedRunner(sandbox: ListedSandbox): TaggedRunner | undefined {
  const tags = sandbox.tags ?? {};
  const sandboxSessionId = tags[RUNNER_TAG.SANDBOX_SESSION];
  const commandId = tags[RUNNER_TAG.COMMAND];
  const launch = taggedLaunch(tags);
  if (sandboxSessionId === undefined || commandId === undefined || launch === undefined) {
    return undefined;
  }
  return { sandboxSessionId, commandId, ...launch };
}

/** The launch tag's value for the mark given. */
function launchTagOf(mark: RunnerMark): string {
  return mark.fingerprint === undefined
    ? String(mark.firstSequence)
    : [mark.firstSequence, mark.fingerprint].join(LAUNCH_FINGERPRINT_MARK);
}

/** The tags a sandbox carries for the record given, beside its session's and its agent's. */
function recordTags(session: string, agentId: string, record: RunnerRecord) {
  const place = { [SESSION_TAG]: session, [RUNNER_TAG.AGENT]: agentId };
  if (record.kind === RUNNER_RECORD.NONE) return place;
  if (record.kind === RUNNER_RECORD.LAUNCHED) {
    return { ...place, [RUNNER_TAG.LAUNCH]: launchTagOf(record.mark) };
  }
  return {
    ...place,
    [RUNNER_TAG.SANDBOX_SESSION]: record.runner.handle.running,
    [RUNNER_TAG.COMMAND]: record.runner.handle.command,
    [RUNNER_TAG.LAUNCH]: launchTagOf(record.runner.mark),
  };
}

/** The runner the sandbox's tags name, where the sandbox is up in the session it was started in, whether or not it has exited since. */
function runnerInSession(session: string, sandbox: ListedSandbox) {
  const runner = taggedRunner(sandbox);
  if (
    runner === undefined ||
    sandbox.status !== SANDBOX_STATUS.RUNNING ||
    sandbox.currentSessionId !== runner.sandboxSessionId
  ) {
    return undefined;
  }
  const { sandboxSessionId, commandId, ...mark } = runner;
  return {
    handle: { ...vercelPlace(session, sandboxSessionId), command: commandId },
    mark,
  };
}

/** A listed sandbox as the place a later call finds, under Luke's session given. */
function foundOf(session: string, sandbox: ListedSandbox): FoundPlace {
  const tags = sandbox.tags ?? {};
  const running =
    sandbox.status === SANDBOX_STATUS.RUNNING && sandbox.currentSessionId !== undefined
      ? vercelPlace(session, sandbox.currentSessionId)
      : undefined;
  return {
    machine: CODING_AGENT_MACHINE.VERCEL,
    session,
    agentId: tags[RUNNER_TAG.AGENT],
    name: nameOfSandbox(sandbox.name),
    running,
    runner: runnerInSession(session, sandbox),
    launch: taggedLaunch(tags),
    // SAFETY: the listing is this machine's own to read back in `resume`; no caller reads it.
    kept: sandbox as unknown as MachineKept,
  };
}

/** The listing a found place was read from, which `foundOf` kept. */
function listedOf(found: FoundPlace): ListedSandbox {
  // SAFETY: a place this machine found keeps the listing it was read from (`foundOf`).
  return found.kept as unknown as ListedSandbox;
}

/**
 * A launch whose stdin was refused, said in the log by how its command
 * ended: its exit code where Vercel has one, and the tail of its stderr,
 * every token-shaped run redacted (`commandStderrTail`), since a runner that
 * dies before it reads its config says why there alone. Every value the
 * launch handed it in its environment is redacted too, whatever its shape,
 * so neither its credential nor its bearer can reach the log.
 */
const diedAtStart = (
  api: VercelSandboxApi,
  sandboxSessionId: string,
  commandId: string,
  secrets: readonly string[],
) =>
  Effect.gen(function* () {
    const exit = yield* api
      .commandExit(sandboxSessionId, commandId)
      .pipe(Effect.orElseSucceed(() => undefined));
    const stderr = yield* api.commandStderrTail(sandboxSessionId, commandId, secrets);
    yield* Effect.logWarning(
      `A runner's launch took no stdin: exit ${exit === null || exit === undefined ? "unknown" : String(exit)}, stderr: ${stderr ?? "none"}`,
    );
  });

/** The eve-shaped policy the checkout sets, as Vercel's API takes it. */
function apiPolicy(
  policy: Parameters<NonNullable<RepositorySandbox["setNetworkPolicy"]>>[0],
): NetworkPolicy | undefined {
  if (policy === "allow-all") return OPEN_INTERNET_POLICY;
  if (typeof policy === "object" && "allow" in policy && !Array.isArray(policy.allow)) {
    // SAFETY: an allow-list of headers per host is the API's own shape, which the SDK sends as it stands.
    return policy as NetworkPolicy;
  }
  return undefined;
}

/** The sandbox session as the checkout reaches it, through the edge's runner. */
function repositorySandboxOver(
  api: VercelSandboxApi,
  running: string,
  run: SandboxRunner,
): RepositorySandbox {
  return {
    run: (ask) =>
      run(
        Effect.map(
          api.run(running, {
            command: "bash",
            args: ["-c", ask.command],
            ...(ask.workingDirectory === undefined ? undefined : { cwd: ask.workingDirectory }),
            ...(ask.env === undefined ? undefined : { env: ask.env }),
          }),
          (ran) => ({ exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr }),
        ),
      ),
    setNetworkPolicy: (policy) => {
      const asked = apiPolicy(policy);
      return asked === undefined
        ? Promise.reject(new Error("a network policy the sandbox's API does not take"))
        : run(api.updateNetworkPolicy(running, asked));
    },
  };
}

/** The read as one command: bash, every capability dropped, the path and bound as its positional arguments. */
function readFileCommand(path: string, maxBytes: number) {
  return {
    command: WITHOUT_CAPABILITIES.COMMAND,
    args: [
      ...WITHOUT_CAPABILITIES.ARGS,
      "bash",
      "-c",
      READ_SCRIPT,
      "luke-read-file",
      path,
      String(maxBytes),
    ],
  };
}

/**
 * What the machine does to a place it already opened, over the API given:
 * everything but opening one and launching a runner in it, so a caller with
 * no edge's runner to hand the checkout, as a launch's end, still reaches it.
 */
export function vercelLifecycle(api: VercelSandboxApi): MachineLifecycle {
  /** The running session of the sandbox tagged with the session; unavailable where none is up. */
  const runningSession = (sessionId: string) =>
    Effect.gen(function* () {
      const sandboxes = yield* api.listTagged(sessionId);
      const running = sandboxes.find(
        (sandbox) => sandbox.status !== undefined && UP_STATUSES.has(sandbox.status),
      )?.currentSessionId;
      if (running === undefined) return yield* new SandboxUnavailable({});
      return running;
    });

  return {
    findPlaces: (session) =>
      Effect.map(api.listTagged(session), (sandboxes) =>
        sandboxes.map((sandbox) => foundOf(session, sandbox)),
      ),

    recordRunner: (place, record) =>
      api.updateTags(place.name, recordTags(place.session, place.agentId, record)),

    setCredential: (place, credential) =>
      api.updateNetworkPolicy(
        place.running,
        credential === undefined ? OPEN_INTERNET_POLICY : credentialPolicy(credential),
      ),

    // Lowered first, so the session the resume opens lives the timeout, not an old sandbox's day.
    resume: (found) =>
      Effect.gen(function* () {
        yield* capSandboxTimeout(api, listedOf(found));
        const resumed = yield* Effect.result(api.resume(found.name));
        if (Result.isFailure(resumed)) {
          if (resumed.failure.status === SNAPSHOT_GONE_STATUS) return PLACE_RESUME.GONE;
          return yield* resumed.failure;
        }
        const session = resumed.success.currentSessionId;
        if (session === undefined) return yield* new SandboxUnavailable({});
        return vercelPlace(found.session, session);
      }),

    stop: (place) => api.stopSession(place.running),

    discard: (found) => api.deleteSandbox(found.name),

    writeFiles: (place, files) => api.writeFiles(place.running, files),

    writeLine: (handle, text) => api.writeStdin(handle.running, handle.command, text),

    runnerExit: (handle, within) => api.commandExit(handle.running, handle.command, within),

    kill: (handle) => api.kill(handle.running, handle.command),

    readFile: (session, path, bound) =>
      Effect.flatMap(runningSession(session), (running) =>
        Effect.map(api.run(running, readFileCommand(path, bound + 1)), (ran) =>
          ran.exitCode === 0 ? new Uint8Array(Buffer.from(ran.stdout, "base64")) : undefined,
        ),
      ),

    runRepositoryCommand: (session, command: RepositoryCommand) =>
      Effect.flatMap(runningSession(session), (running) => {
        const environment = Object.entries(command.env ?? {}).map(
          ([name, value]) => `${name}=${value}`,
        );
        return api.run(running, {
          command: "env",
          args: [...environment, "bash", "-c", command.command],
          ...(command.workingDirectory === undefined ? {} : { cwd: command.workingDirectory }),
        });
      }),
  };
}

/** The machine over the API given, its checkout run through the edge's runner. */
export function vercelMachine(api: VercelSandboxApi, run: SandboxRunner): AgentMachineService {
  /** A new sandbox of the agent's, under the session given, opened from the snapshot named at the size its repository asks for. */
  const createdFrom = (agent: CodingAgent, sessionId: string, snapshotId: string) =>
    api.create({
      name: `${SANDBOX_NAME}${randomUUID()}`,
      snapshotId,
      tags: { [SESSION_TAG]: sessionId, [RUNNER_TAG.AGENT]: agent.id },
      timeoutMs: CODER.SANDBOX_TIMEOUT_MS,
      vcpus: sandboxVcpus(agent.repository),
      keepLastSnapshots: {
        count: CODER.SANDBOX_SNAPSHOTS.count,
        expiration: Duration.toMillis(CODER.SANDBOX_SNAPSHOTS.expiration),
        deleteEvicted: CODER.SANDBOX_SNAPSHOTS.deleteEvicted,
      },
      env: SANDBOX_ENV,
    });

  /** The sandbox as it runs: its name, and the session it runs in; one Vercel names no session of is deleted again. */
  const runningOf = (opened: ListedSandbox) =>
    opened.currentSessionId === undefined
      ? Effect.andThen(
          Effect.ignore(api.deleteSandbox(opened.name)),
          Effect.fail(new SandboxUnavailable({})),
        )
      : Effect.succeed({ name: opened.name, running: opened.currentSessionId });

  /**
   * The repository snapshot the agent's sandbox may open from: one of its
   * workspace's, made on the image this launch opens, of the repository's
   * default branch; none for an agent started on another branch, or on its
   * starter's own token, whose access is not the workspace's.
   */
  const repositorySnapshotOf = (
    agent: WithRepository<CodingAgent>,
    read: AgentRepositoryRead,
    imageSnapshotId: string,
  ): Option.Option<RepositorySnapshotOf> =>
    agent.startBranch === null && read.access.kind === GITHUB_ACCESS.APP
      ? Option.some({
          imageSnapshotId,
          workspaceId: read.workspaceId,
          fullName: read.fullName,
          defaultBranch: read.defaultBranch,
        })
      : Option.none();

  /**
   * The repository snapshot built past the request's answer, apart from
   * the launch and its runner lease, so neither waits on it; nothing where
   * no request's answer is being kept, as for a relaunch a message makes,
   * which leaves the build to the next Start.
   */
  const buildInBackground = (of: RepositorySnapshotOf, read: AgentRepositoryRead) =>
    Effect.gen(function* () {
      if (Option.isNone(yield* Effect.serviceOption(AfterResponse))) return;
      yield* afterResponse(
        "A repository snapshot's build",
        buildRepositorySnapshot(api, of, read, (running) =>
          repositorySandboxOver(api, running, run),
        ),
      );
    });

  /**
   * The agent's sandbox opened from its repository snapshot and its
   * checkout brought up to the default branch; none where the snapshot was
   * gone or its checkout would not refresh, the snapshot then forgotten so
   * the next launch builds it again, and the sandbox this opened deleted.
   * A Vercel that did not answer the create opens nothing here either, and
   * forgets nothing, so the launch goes on as without a snapshot.
   */
  const openedFromRepositorySnapshot = (
    agent: WithRepository<CodingAgent>,
    sessionId: string,
    harness: string,
    of: RepositorySnapshotOf,
    snapshotId: string,
    read: AgentRepositoryRead,
  ) =>
    Effect.gen(function* () {
      const opened = yield* Effect.flatMap(createdFrom(agent, sessionId, snapshotId), runningOf);
      yield* refreshAgentCheckout(
        agent,
        repositorySandboxOver(api, opened.running, run),
        read,
      ).pipe(Effect.tapError(() => Effect.ignore(api.deleteSandbox(opened.name))));
      return Option.some(opened);
    }).pipe(
      Effect.catch((failure) =>
        Effect.gen(function* () {
          yield* Effect.logWarning(
            `A ${harness} sandbox did not open from its repository snapshot: ${describeFailure(failure)}`,
          );
          const unusable =
            failure instanceof CheckoutRefused ||
            failure.status === SNAPSHOT_GONE_STATUS ||
            failure.status === NOT_FOUND_STATUS;
          if (unusable) yield* Effect.ignore(forgetRepositorySnapshot(api, of, snapshotId));
          return Option.none<{ readonly name: string; readonly running: string }>();
        }),
      ),
    );

  /**
   * The agent's sandbox opened from the image, the image prepared again
   * where its snapshot is gone, because otherwise every launch would fail
   * on it until someone deleted the template by hand; this launch answers
   * as preparing meanwhile.
   */
  const openedFromImage = (
    image: AgentSandboxImageService,
    agent: CodingAgent,
    sessionId: string,
    snapshotId: string,
  ) =>
    createdFrom(agent, sessionId, snapshotId).pipe(
      Effect.catchIf(
        (failure) => failure.status === SNAPSHOT_GONE_STATUS,
        () =>
          Effect.flatMap(image.snapshotGone(snapshotId), () => Effect.fail(new ImagePreparing())),
      ),
      Effect.flatMap(runningOf),
    );

  /**
   * The agent's sandbox with its repository checked out, on the read the
   * caller made of it, which confirmed its workspace still reaches it
   * before any sandbox opens on its code. Where its workspace's repository
   * snapshot is ready, the sandbox opens from it and fetches only what
   * landed since; otherwise it opens from the image and clones the
   * repository whole, and the snapshot is built past the answer for the
   * next launch (`repository-snapshot.ts`). A snapshot Vercel could not be
   * asked about is passed by, and no build is started on it.
   */
  const checkedOutSandbox = (
    image: AgentSandboxImageService,
    agent: WithRepository<CodingAgent>,
    read: AgentRepositoryRead,
    sessionId: string,
    harness: string,
    imageSnapshotId: string,
  ) =>
    Effect.gen(function* () {
      const of = repositorySnapshotOf(agent, read, imageSnapshotId);
      if (Option.isSome(of)) {
        const found = yield* readRepositorySnapshot(api, of.value).pipe(Effect.option);
        if (Option.isSome(found) && found.value.state === REPOSITORY_SNAPSHOT_STATE.READY) {
          const fromSnapshot = yield* openedFromRepositorySnapshot(
            agent,
            sessionId,
            harness,
            of.value,
            found.value.snapshotId,
            read,
          );
          if (Option.isSome(fromSnapshot)) return fromSnapshot.value;
        }
        // The build reads the snapshot again and leaves one ready or being built be.
        if (Option.isSome(found)) yield* buildInBackground(of.value, read);
      }
      const opened = yield* openedFromImage(image, agent, sessionId, imageSnapshotId);
      yield* cloneAgentRepository(
        agent,
        repositorySandboxOver(api, opened.running, run),
        read,
        CHECKOUT_DEPTH.WHOLE,
      ).pipe(Effect.tapError(() => Effect.ignore(api.deleteSandbox(opened.name))));
      return opened;
    });

  /**
   * The agent's sandbox opened from the image, its repository checked out
   * in it where it has one (`checkedOutSandbox`). The image's snapshot and
   * the repository are asked at once, since neither waits on the other and
   * both are asked before any sandbox opens.
   */
  const openedCheckout = (
    target: ConversationTarget,
    agent: CodingAgent,
    sessionId: string,
    harness: string,
  ) =>
    Effect.gen(function* () {
      const image = yield* AgentSandboxImage;
      const [snapshot, read] = yield* Effect.all(
        [
          image.snapshotId,
          hasRepository(agent) ? agentRepositoryRead(target, agent) : Effect.succeed(undefined),
        ],
        { concurrency: "unbounded" },
      );
      if (Option.isNone(snapshot)) return yield* new LaunchRefused({ reason: "no snapshot" });
      return hasRepository(agent) && read !== undefined
        ? yield* checkedOutSandbox(image, agent, read, sessionId, harness, snapshot.value)
        : yield* openedFromImage(image, agent, sessionId, snapshot.value);
    });

  return {
    ...vercelLifecycle(api),

    layout: () => Effect.succeed(SANDBOX_LAYOUT),

    // What the deepen reads of GitHub (`agentDeepenPlan`) is read beside the sandbox's opening and
    // the caller's own reads, and kept as it ended, so a read that failed fails the launch only
    // once the sandbox it would delete stands, and never cuts its opening short. Where the caller
    // waits on an image still being prepared (`IMAGE_READY`), only the opening is asked again, so
    // the reads are made once. Note that a sandbox just opened holds no deepen's record, so none
    // is looked for.
    open: (ask, use) =>
      Effect.gen(function* () {
        const opening = openedCheckout(ask.target, ask.agent, ask.session, ask.harness);
        const [{ name, running }, [deepen, beside]] = yield* Effect.all(
          [
            ask.waitOnImage ? Effect.retry(opening, IMAGE_READY) : opening,
            Effect.all(
              [
                Effect.exit(
                  hasRepository(ask.agent)
                    ? agentDeepenPlan(ask.target, ask.agent)
                    : Effect.succeed(undefined),
                ),
                ask.beside,
              ],
              { concurrency: "unbounded" },
            ),
          ],
          { concurrency: "unbounded" },
        );
        const repositorySandbox = repositorySandboxOver(api, running, run);
        const finishCheckout = Effect.flatMap(deepen, (plan) =>
          plan === undefined
            ? openWorkingFolder(repositorySandbox)
            : deepenCheckoutWith(repositorySandbox, plan),
        );
        return yield* use(
          {
            place: vercelPlace(ask.session, running),
            name: nameOfSandbox(name),
            checkoutPath: SANDBOX_LAYOUT.checkoutPath,
            finishCheckout,
          },
          beside,
        ).pipe(Effect.tapError(() => Effect.ignore(api.deleteSandbox(name))));
      }),

    // The bundle's upload and the caller's steps run at once, since none waits on another and the
    // command waits on them all. The runner is kept in the sandbox's tags before it reads anything,
    // so a later call finds it. A runner started but never configured is ended, and the caller
    // undoes what it recorded of it, so the next message relaunches whole rather than writing to a
    // runner that waits for its config.
    launchRunner: (place, launch) =>
      Effect.gen(function* () {
        const running = place.running;
        const [digest, ready] = yield* Effect.all(
          [
            Effect.gen(function* () {
              const bundle = yield* (yield* RunnerBundle).contents;
              yield* api.writeFiles(running, [
                { path: RUNNER_PATH.UPLOAD, contents: bundle, mode: 0o644 },
              ]);
              return createHash("sha256").update(bundle).digest("hex");
            }),
            launch.ready,
          ],
          { concurrency: "unbounded" },
        );
        const commandId = yield* api.start(running, {
          command: "bash",
          args: ["-c", LAUNCH_SCRIPT, LAUNCH_NAME, digest],
          cwd: CODER.CHECKOUT_PATH,
          // Note that the credential and the bearer ride in the environment alone, which the API's
          // sudo keeps, as Vercel documents it does, on an image that honours that (`sandbox-image.ts`).
          env: { ...SANDBOX_ENV, ...launch.env },
          sudo: true,
        });
        const handle: RunnerHandle = { ...place, command: commandId };
        yield* Effect.gen(function* () {
          const { lines, mark } = yield* launch.firstLines(ready, handle);
          yield* api.updateTags(
            launch.name,
            recordTags(place.session, launch.agentId, {
              kind: RUNNER_RECORD.RUNNING,
              runner: { handle, mark },
            }),
          );
          yield* api
            .writeStdin(running, commandId, lines)
            .pipe(
              Effect.tapError(() =>
                diedAtStart(api, running, commandId, Object.values(launch.env)),
              ),
            );
        }).pipe(
          Effect.tapError(() =>
            Effect.ignore(Effect.andThen(api.kill(running, commandId), launch.abandon(ready))),
          ),
        );
        return { handle, ready };
      }),
  };
}

/** The machine over Vercel Sandbox, asked under the token given, its checkout run through the edge's runner. */
export function vercelMachineLayer(
  options: VercelMachineOptions,
): Layer.Layer<AgentMachine, never, HttpClient.HttpClient> {
  return Layer.effect(
    AgentMachine,
    Effect.map(vercelSandboxApi(options.readToken), (api) => vercelMachine(api, options.run)),
  );
}
