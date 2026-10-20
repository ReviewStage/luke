/**
 * runner-sessions.ts -- a coding agent's sessions on a native harness: the runner launched in a sandbox Luke opens itself, its stdin written to, and the sandbox stopped, resumed, and deleted around it.
 *
 * The launch machinery the `claude_code` and `codex` implementations of
 * `AgentSessions` (`brain-host/eve-sessions.ts`) share; each names what is
 * its own as a `RunnerHarness` (`claude-code-sessions.ts`,
 * `codex-sessions.ts`): the credential its runner is started with, its
 * config line, and the lines that go ahead of a message to a runner already
 * running. Its session is Luke's own: an id minted as the session opens,
 * carried as the `sessionId` tag on the sandbox it opens, so the Terminal
 * tab, the stop and the cleanup sweep find the sandbox by it exactly as they
 * find eve's (`terminal/agent-sandbox.ts`, `session-sandboxes.ts`). The
 * harness's own session or thread id is the conversation's
 * `native_session`, which the events route records from what the runner
 * reports, and a relaunch resumes.
 *
 * `open` opens a sandbox from the coding agent's image (`agent-sandbox-image.ts`),
 * checks the agent's repository out into it exactly as eve's sandbox does
 * (`checkout.ts`, the same token at the firewall), and launches the runner.
 * A launch mints the runner's bearer and records its digest on the
 * conversation, uploads the runner's bundle (`runner-bundle.ts`), and starts
 * it as a detached command of the sandbox's API as root, which installs the
 * bundle where only root writes, checks its digest, shares the checkout with
 * the `agent` user, and drops to that user with every capability gone
 * (`sandbox-capabilities.ts`). The harness's credential and the bearer are
 * in that command's environment and nowhere else: never in its argv, its
 * config line, a file, or a tag. The config line and the first message are
 * written to its stdin. The command, the sandbox session it runs in, the
 * first event number of the launch, and the stamp of the credential it was
 * started with (a non-secret mark such as an expiry) are kept as the
 * sandbox's tags, which is how a later call finds the runner it writes to
 * and tells whether its credential was since renewed.
 *
 * `send` writes the harness's lines and then a message line to that runner
 * while it runs. Where the sandbox stopped or the runner ended, it resumes
 * the sandbox, sets the repository's credential at its firewall again, and
 * launches the runner anew with the harness's session to resume and the
 * next event number, whose session files the sandbox's persisted disk kept.
 * `cancel` writes `stop` to a runner that runs. `reset` retires the runner's
 * bearer and deletes the sandbox. Nothing here streams: the runner posts its
 * events to Luke itself.
 *
 * At a launch's end (`runnerEnded`, which the events route calls on the
 * runner's END event) the sandbox is stopped unless a developer's Terminal
 * holds it, as eve's is at a turn's end; a runner waiting on a background
 * task or a wakeup has posted no END, so its sandbox stays up. An END from a
 * launch a newer one replaced, told by its event number, stops nothing.
 *
 * Every call answers in eve's outcomes, so a caller holds one interface
 * whichever runtime answers. What fails here (Vercel, the store, GitHub, a
 * missing credential or snapshot) answers `failed`, with the reason in the
 * log by its kind alone; a launch refused for the account's plan says which
 * way its plan failed. Nothing is retried.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type ContentBlock,
  INPUT_LINE,
  type InputLine,
  RUNNER_ENV,
  type RunnerConfig,
} from "@luke/agent-runner/protocol";
import {
  type CodingAgent,
  hasRepository,
  readCodingAgent,
  readCodingAgentOfConversation,
  readCodingAgentRouting,
  recordCodingAgentRunnerToken,
} from "@luke/database/models/coding-agent-store";
import { sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import type { ConversationTarget } from "@luke/database/models/writer";
import type { UserContent } from "ai";
import { Data, DateTime, Duration, Effect, Option, Stream } from "effect";
import type { HostedEnvironment } from "../../environment.js";
import {
  AgentSandboxImage,
  IMAGE_PREPARING_STATUS,
  ImagePreparing,
} from "../agent-sandbox-image.js";
import type { BrainHostTurn } from "../brain-host/bounds.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  PLAN_REFUSAL,
  type PlanRefusal,
} from "../brain-host/eve-sessions.js";
import type { RepositorySandbox } from "../repository-shell.js";
import { WITHOUT_CAPABILITIES } from "../sandbox-capabilities.js";
import {
  credentialPolicy,
  OPEN_INTERNET_POLICY,
  type RepositoryCredential,
} from "../terminal/agent-sandbox.js";
import {
  deploymentOidcToken,
  type ListedSandbox,
  type NetworkPolicy,
  SandboxUnavailable,
  SESSION_TAG,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import { CODER } from "./bounds.js";
import {
  agentRepositoryToken,
  type CheckoutServices,
  checkOutAgentRepository,
  deepenAgentCheckout,
  openWorkingFolder,
} from "./checkout.js";
import { RunnerBundle } from "./runner-bundle.js";

/** What the sessions reach: the store, GitHub, Vercel, the image, the runner's bundle, and the deployment's key ring. */
export type RunnerServices =
  | CheckoutServices
  | AgentSandboxImage
  | RunnerBundle
  | HostedEnvironment;

/** Runs one effect on the edge's runtime; the checkout reaches the sandbox through promises (`repository-shell.ts`). */
type SandboxRunner = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

/** What every harness's sessions are composed with. */
export interface RunnerSessionsOptions {
  /** The account the sessions act for: the agent's starter, whose conversation and key they read. */
  readonly userId: string;
  /** Where the runner posts its events: the events route (P09), which the composing edge names. */
  readonly eventsUrl: string;
  /** The Luke MCP server's endpoint (P06), which the composing edge names. */
  readonly mcpUrl: string;
  /** Luke's coder instructions for the agent, which the harness's config carries. */
  readonly instructions: (agent: CodingAgent) => Effect.Effect<string>;
  /** One past the last event the store applied of the conversation's runner, where a launch numbers its events from. */
  readonly nextSequence: (conversationId: string) => Effect.Effect<number>;
  readonly run: SandboxRunner;
}

/** A launch could not start: no agent, no credential, no snapshot, a model the harness cannot name, or the account's plan refused. */
export class LaunchRefused extends Data.TaggedError("LaunchRefused")<{
  readonly reason: string;
  /** How the account's plan failed, where it is why. */
  readonly planRefusal?: PlanRefusal | undefined;
}> {}

/** What a launch's command is started with of the harness's own. */
interface HarnessLaunch {
  /** The variables beside the bearer: the harness's credential, and whatever else it reads. Never written anywhere but the command's environment. */
  readonly env: Readonly<Record<string, string>>;
  /** A mark of the credential the launch holds, never the credential itself, kept as a tag so a later message tells it was renewed. */
  readonly stamp?: string | undefined;
}

/** The lines a message to a running runner goes behind, and the stamp of the credential the runner holds once they are written. */
interface HarnessAhead {
  readonly lines: readonly InputLine[];
  readonly stamp?: string | undefined;
}

/**
 * What a harness's sessions do of their own; everything else is shared. Its
 * effects reach the shared services alone, and fail with `LaunchRefused`, or
 * with anything else tagged, which answers as unavailable.
 */
export interface RunnerHarness<E extends { readonly _tag: string }> {
  /** How the log and a message's unsupported attachment name it. */
  readonly name: string;
  /** What a session id it mints begins with, before a fresh UUID. */
  readonly sessionPrefix: string;
  /** The credential a launch starts with, read afresh for every launch. */
  readonly launch: (
    agent: CodingAgent,
  ) => Effect.Effect<HarnessLaunch, E | LaunchRefused, RunnerServices>;
  /** The config line of a launch, resuming the harness's session where one is named. */
  readonly config: (
    agent: CodingAgent,
    resume: string | undefined,
    firstSequence: number,
  ) => Effect.Effect<RunnerConfig, LaunchRefused>;
  /** What goes ahead of a message to a runner already running, given the stamp of the credential it was last handed. */
  readonly ahead: (
    agent: CodingAgent,
    stamp: string | undefined,
  ) => Effect.Effect<HarnessAhead, E | LaunchRefused, RunnerServices>;
}

/** The tags a sandbox Luke opens carries beside its session's: its agent, and the runner it runs, so a later call finds both. */
export const RUNNER_TAG = {
  AGENT: "lukeAgent",
  SANDBOX_SESSION: "lukeRunnerSession",
  COMMAND: "lukeRunnerCommand",
  /**
   * The launch's first event number, and after a `-` the stamp of the
   * credential its runner holds where the harness keeps one: one tag for
   * both, since Vercel keeps at most five.
   */
  LAUNCH: "lukeRunnerLaunch",
} as const;

/** What sets a launch's stamp apart from its first event number in its tag. */
const LAUNCH_STAMP_SEPARATOR = "-";

/** What a sandbox Luke opens is named as, beside a fresh UUID; the sweep tells a native sandbox from eve's by it. */
export const SANDBOX_NAME = "luke-agent-";

/**
 * Where the launch stands in the sandbox: the bundle as the file API uploads
 * it, as the default user, and where root installs it, in a directory only
 * root writes, so no Terminal's shell changes what runs as `agent`.
 */
const RUNNER_PATH = {
  UPLOAD: "/tmp/luke-agent-runner.mjs",
  INSTALLED: "/opt/luke/agent-runner/agent-runner.mjs",
} as const;

/** The unprivileged user the harness runs as, which the image creates. */
export const AGENT_USER = "agent";

/** The variables the sandbox opens with, as eve's coding-agent environment sets them. */
const SANDBOX_ENV = { NO_COLOR: "1", GH_STACK_NO_UPDATE_NOTIFIER: "1" } as const;

/**
 * The launch, run by bash as root: the uploaded bundle installed where only
 * root writes and checked against the digest Luke computed, the checkout
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
  `git config --system --get-all safe.directory 2>/dev/null | grep -Fxq ${CODER.CHECKOUT_PATH} || git config --system --add safe.directory ${CODER.CHECKOUT_PATH}`,
  `if [ -d ${CODER.CHECKOUT_PATH}/.git ]; then git -C ${CODER.CHECKOUT_PATH} config core.sharedRepository group; fi`,
  `chmod -R g+rwX ${CODER.CHECKOUT_PATH}`,
  `find ${CODER.CHECKOUT_PATH} -type d -exec chmod g+s {} +`,
  `exec ${WITHOUT_CAPABILITIES.COMMAND} --reuid=${AGENT_USER} --regid=${AGENT_USER} --init-groups ${WITHOUT_CAPABILITIES.ARGS.join(" ")} env HOME=/home/${AGENT_USER} USER=${AGENT_USER} LOGNAME=${AGENT_USER} node ${RUNNER_PATH.INSTALLED}`,
].join("\n");

/** What `$0` reads as in the launch's shell. */
const LAUNCH_NAME = "luke-agent-runner";

/**
 * The statuses a failure answers as, which a caller logs: Vercel's own where
 * it answered one, unavailable where it did not, and refused where the
 * launch could not start at all (no agent, no credential, no snapshot, no
 * bundle).
 */
const FAILED_STATUS = { UNAVAILABLE: 503, REFUSED: 422 } as const;

/** The image types a message's file may carry to the harness as an image block. */
const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** The bearer's bytes before it is spelled, as many as a session key. */
const BEARER_BYTES = 32;

/** The digest the store keeps of a runner's bearer: its SHA-256, in hex, as the MCP server compares it. */
export function runnerBearerDigest(bearer: string): string {
  return createHash("sha256").update(bearer).digest("hex");
}

/** A message's content as the runner's lines carry it: words as text, an image as an image block, any other file named. */
function runnerContent(message: string | UserContent, harness: string): readonly ContentBlock[] {
  if (typeof message === "string") return [{ type: "text", text: message }];
  return message.flatMap((part): ContentBlock[] => {
    if (part.type === "text") return [{ type: "text" as const, text: part.text }];
    if (part.type === "file" || part.type === "image") {
      const mediaType = part.type === "file" ? part.mediaType : (part.mediaType ?? "");
      const data = part.type === "file" ? part.data : part.image;
      const base64 = base64Of(data);
      if (IMAGE_TYPES.has(mediaType) && base64 !== undefined) {
        return [
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              // SAFETY: the type is one of the four the set holds, which are the protocol's image types.
              media_type: mediaType as "image/png",
              data: base64,
            },
          },
        ];
      }
      const name = part.type === "file" ? (part.filename ?? "a file") : "an image";
      return [
        {
          type: "text" as const,
          text: `[${name} (${mediaType}) was attached but cannot be passed to ${harness}]`,
        },
      ];
    }
    return [];
  });
}

/** A file part's data as base64: a `data:` URL's payload, a string as it stands, or bytes encoded; nothing for a URL elsewhere. */
function base64Of(data: unknown): string | undefined {
  if (data instanceof Uint8Array) return Buffer.from(data).toString("base64");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("base64");
  const text = data instanceof URL ? data.href : typeof data === "string" ? data : undefined;
  if (text === undefined) return undefined;
  if (text.startsWith("data:")) {
    const comma = text.indexOf(",");
    return comma < 0 || !text.slice(0, comma).endsWith(";base64")
      ? undefined
      : text.slice(comma + 1);
  }
  return /^[A-Za-z0-9+/=\s]+$/u.test(text) ? text : undefined;
}

/** A line of the runner's stdin. */
function line(value: RunnerConfig | InputLine): string {
  return `${JSON.stringify(value)}\n`;
}

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

/** The launch tag's value: the first event number, and the credential's stamp where there is one. */
function launchTag(firstSequence: number, stamp: string | undefined): string {
  return stamp === undefined
    ? String(firstSequence)
    : `${firstSequence}${LAUNCH_STAMP_SEPARATOR}${stamp}`;
}

/** The runner a sandbox's tags name, where the sandbox runs the session it was started in. */
interface TaggedRunner {
  readonly sandboxSessionId: string;
  readonly commandId: string;
  readonly firstSequence: number;
  readonly stamp: string | undefined;
}

/** The launch tag read: its first event number and its stamp; none where the tag is missing or unreadable. */
function taggedLaunch(
  tags: Readonly<Record<string, string>>,
): { readonly firstSequence: number; readonly stamp: string | undefined } | undefined {
  const launch = tags[RUNNER_TAG.LAUNCH] ?? "";
  const at = launch.indexOf(LAUNCH_STAMP_SEPARATOR);
  const firstSequence = Number(at < 0 ? launch : launch.slice(0, at));
  if (launch === "" || !Number.isSafeInteger(firstSequence)) return undefined;
  return { firstSequence, stamp: at < 0 ? undefined : launch.slice(at + 1) };
}

function taggedRunner(sandbox: ListedSandbox): TaggedRunner | undefined {
  const tags = sandbox.tags ?? {};
  const sandboxSessionId = tags[RUNNER_TAG.SANDBOX_SESSION];
  const commandId = tags[RUNNER_TAG.COMMAND];
  const launch = taggedLaunch(tags);
  if (sandboxSessionId === undefined || commandId === undefined || launch === undefined) {
    return undefined;
  }
  return { sandboxSessionId, commandId, ...launch };
}

/** The tags of a sandbox running the runner given. */
function runnerTags(sessionId: string, agentId: string, runner: TaggedRunner) {
  return {
    [SESSION_TAG]: sessionId,
    [RUNNER_TAG.AGENT]: agentId,
    [RUNNER_TAG.SANDBOX_SESSION]: runner.sandboxSessionId,
    [RUNNER_TAG.COMMAND]: runner.commandId,
    [RUNNER_TAG.LAUNCH]: launchTag(runner.firstSequence, runner.stamp),
  };
}

/** Whether the sandbox is up in the session its runner was started in, and that runner has not exited. */
function liveRunner(
  api: VercelSandboxApi,
  sandbox: ListedSandbox,
): Effect.Effect<TaggedRunner | undefined> {
  const runner = taggedRunner(sandbox);
  if (
    runner === undefined ||
    sandbox.status !== "running" ||
    sandbox.currentSessionId !== runner.sandboxSessionId
  ) {
    return Effect.succeed(undefined);
  }
  return api.commandExit(runner.sandboxSessionId, runner.commandId).pipe(
    Effect.map((exit) => (exit === null ? runner : undefined)),
    Effect.orElseSucceed(() => undefined),
  );
}

/** The session's sandbox, the one its tag names. */
function sandboxOf(api: VercelSandboxApi, sessionId: string) {
  return Effect.map(api.listTagged(sessionId), (sandboxes) => Option.fromNullishOr(sandboxes[0]));
}

/** The status a failure answers as. */
function failedStatus(failure: { readonly _tag: string }): number {
  if (failure instanceof LaunchRefused) {
    return failure.planRefusal === PLAN_REFUSAL.UNREACHABLE
      ? FAILED_STATUS.UNAVAILABLE
      : FAILED_STATUS.REFUSED;
  }
  if (failure._tag === "RunnerBundleMissing") return FAILED_STATUS.REFUSED;
  if (failure instanceof ImagePreparing) return IMAGE_PREPARING_STATUS;
  return failure instanceof SandboxUnavailable
    ? (failure.status ?? FAILED_STATUS.UNAVAILABLE)
    : FAILED_STATUS.UNAVAILABLE;
}

/** The sessions for one account on the harness given, over the calling fiber's services. */
export const runnerSessions = <
  E extends { readonly _tag: string },
  Turn extends BrainHostTurn = BrainHostTurn,
>(
  harness: RunnerHarness<E>,
  options: RunnerSessionsOptions,
): Effect.Effect<AgentSessions<Turn>, never, RunnerServices> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<RunnerServices>();
    const api = yield* vercelSandboxApi(deploymentOidcToken);
    const { userId } = options;

    /** The agent whose conversation the message is for. */
    const agentOf = (conversationId: string) =>
      Effect.flatMap(readCodingAgentOfConversation(userId, conversationId), (agent) =>
        Option.isSome(agent)
          ? Effect.succeed(agent.value)
          : Effect.fail(new LaunchRefused({ reason: "no agent" })),
      );

    /** Whether the agent a sandbox's tag names is one the account reaches. */
    const ownsSandbox = (sandbox: ListedSandbox) => {
      const agentId = sandbox.tags?.[RUNNER_TAG.AGENT];
      return agentId === undefined
        ? Effect.succeed(false)
        : Effect.map(readCodingAgent(userId, agentId), Option.isSome);
    };

    /** The repository's credential set at the running session's firewall again, minted afresh; an agent with no repository has none. */
    const renewCredential = (target: ConversationTarget, agent: CodingAgent, running: string) =>
      Effect.gen(function* () {
        if (!hasRepository(agent)) return;
        const minted = yield* agentRepositoryToken(target, agent);
        const credential: RepositoryCredential = {
          token: minted.token,
          fullName: minted.fullName,
          access: minted.access,
        };
        yield* api.updateNetworkPolicy(running, credentialPolicy(credential));
      });

    /**
     * One launch of the runner in the running session: a fresh bearer
     * recorded, the bundle uploaded, the command started, the runner's
     * place kept in the sandbox's tags, and its config line and first
     * message written.
     */
    const launch = (
      sessionId: string,
      agent: CodingAgent,
      sandbox: { readonly name: string; readonly running: string },
      first: InputLine,
      resume: string | undefined,
    ) =>
      Effect.gen(function* () {
        const credential = yield* harness.launch(agent);
        const bundle = yield* (yield* RunnerBundle).contents;
        const digest = createHash("sha256").update(bundle).digest("hex");
        const bearer = randomBytes(BEARER_BYTES).toString("base64url");
        yield* recordCodingAgentRunnerToken(userId, agent.id, runnerBearerDigest(bearer));
        yield* api.writeFiles(sandbox.running, [
          { path: RUNNER_PATH.UPLOAD, contents: bundle, mode: 0o644 },
        ]);
        // The launch's tag is written before its command starts, so an END the launch it
        // replaces posts late is told apart from this one's and stops nothing.
        const firstSequence = yield* options.nextSequence(agent.conversationId);
        const launching = {
          [SESSION_TAG]: sessionId,
          [RUNNER_TAG.AGENT]: agent.id,
          [RUNNER_TAG.LAUNCH]: launchTag(firstSequence, credential.stamp),
        };
        yield* api.updateTags(sandbox.name, launching);
        const commandId = yield* api.start(sandbox.running, {
          command: "bash",
          args: ["-c", LAUNCH_SCRIPT, LAUNCH_NAME, digest],
          cwd: CODER.CHECKOUT_PATH,
          env: { ...SANDBOX_ENV, ...credential.env, [RUNNER_ENV.BEARER]: bearer },
          sudo: true,
        });
        // A runner started but never configured is ended, and its tags cleared, so the next
        // message relaunches whole rather than writing to a runner that waits for its config.
        yield* Effect.gen(function* () {
          yield* api.updateTags(
            sandbox.name,
            runnerTags(sessionId, agent.id, {
              sandboxSessionId: sandbox.running,
              commandId,
              firstSequence,
              stamp: credential.stamp,
            }),
          );
          const config = yield* harness.config(agent, resume, firstSequence);
          yield* api.writeStdin(sandbox.running, commandId, `${line(config)}${line(first)}`);
        }).pipe(
          Effect.tapError(() =>
            Effect.ignore(
              Effect.andThen(
                api.kill(sandbox.running, commandId),
                api.updateTags(sandbox.name, launching),
              ),
            ),
          ),
        );
      });

    /** The message as a line, under Luke's id for it where the caller named one. */
    const messageLine = (message: EveMessage<Turn>): InputLine & { readonly uuid: string } => ({
      type: INPUT_LINE.MESSAGE,
      uuid: message.lineId ?? randomUUID(),
      content: runnerContent(message.message, harness.name),
    });

    /** A failure as the log says it and the caller reads it: the kind alone, never a value. */
    const failed = (call: string) => (failure: { readonly _tag: string }) =>
      Effect.as(
        Effect.logWarning(
          `A ${harness.name} ${call} failed: ${failure instanceof LaunchRefused ? failure.reason : failure._tag}`,
        ),
        {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: failedStatus(failure),
          ...(failure instanceof LaunchRefused && failure.planRefusal !== undefined
            ? { planRefusal: failure.planRefusal }
            : undefined),
        } as const,
      );

    /** A cancel's or a reset's failure, as the log says it: the kind alone. */
    const unavailable = (call: string) => (failure: { readonly _tag: string }) =>
      Effect.as(Effect.logWarning(`A ${harness.name} ${call} failed: ${failure._tag}`), {
        outcome: "failed" as const,
        status: failedStatus(failure),
      });

    const sessions: AgentSessions<Turn> = {
      open: (message) =>
        Effect.gen(function* () {
          const agent = yield* agentOf(message.conversationId);
          const snapshot = yield* (yield* AgentSandboxImage).snapshotId;
          if (Option.isNone(snapshot))
            return yield* Effect.fail(new LaunchRefused({ reason: "no snapshot" }));
          const sessionId = `${harness.sessionPrefix}${randomUUID()}`;
          const target: ConversationTarget = { userId, conversationId: agent.conversationId };
          const opened = yield* api.create({
            name: `${SANDBOX_NAME}${randomUUID()}`,
            snapshotId: snapshot.value,
            tags: { [SESSION_TAG]: sessionId, [RUNNER_TAG.AGENT]: agent.id },
            timeoutMs: CODER.SANDBOX_TIMEOUT_MS,
            vcpus: CODER.SANDBOX_VCPUS,
            keepLastSnapshots: {
              count: CODER.SANDBOX_SNAPSHOTS.count,
              expiration: Duration.toMillis(CODER.SANDBOX_SNAPSHOTS.expiration),
              deleteEvicted: CODER.SANDBOX_SNAPSHOTS.deleteEvicted,
            },
            env: SANDBOX_ENV,
          });
          // A sandbox whose launch failed is deleted again, since no conversation records the session that would find it.
          yield* Effect.gen(function* () {
            const running = opened.currentSessionId;
            if (running === undefined) return yield* new SandboxUnavailable({});
            const repositorySandbox = repositorySandboxOver(api, running, options.run);
            // The checkout eve's sandbox makes, then at once what eve's first write does
            // (`deepenAgentCheckout`): the write token at the firewall, the whole history, and the
            // commit identity, since the harness's own shell has no hook for a first write.
            if (hasRepository(agent)) {
              yield* checkOutAgentRepository(target, agent, repositorySandbox);
              yield* deepenAgentCheckout(target, agent, repositorySandbox);
            } else {
              yield* openWorkingFolder(repositorySandbox);
            }
            yield* launch(
              sessionId,
              agent,
              { name: opened.name, running },
              messageLine(message),
              undefined,
            );
          }).pipe(Effect.tapError(() => Effect.ignore(api.deleteSandbox(opened.name))));
          return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId } as const;
        }).pipe(Effect.catch(failed("open")), Effect.provideContext(context)),

      send: (sessionId, message) =>
        Effect.gen(function* () {
          const found = yield* sandboxOf(api, sessionId);
          if (Option.isNone(found)) return { outcome: EVE_SEND_OUTCOME.RETIRED } as const;
          // The session must be the conversation's own agent's, which the account reaches.
          const agent = yield* agentOf(message.conversationId);
          if (found.value.tags?.[RUNNER_TAG.AGENT] !== agent.id) {
            return { outcome: EVE_SEND_OUTCOME.RETIRED } as const;
          }
          const target = { userId, conversationId: agent.conversationId };
          const sent = messageLine(message);
          const accepted = {
            outcome: EVE_SEND_OUTCOME.ACCEPTED,
            sessionId,
            deliveryId: sent.uuid,
          } as const;
          const live = yield* liveRunner(api, found.value);
          if (live !== undefined) {
            // The installation token lives an hour, so each message sets a fresh one; and the
            // harness's lines (the agent's model and effort as they stand, a renewed credential)
            // go ahead of the message, which a change since the launch takes effect from.
            yield* renewCredential(target, agent, live.sandboxSessionId);
            const ahead = yield* harness.ahead(agent, live.stamp);
            yield* api.writeStdin(
              live.sandboxSessionId,
              live.commandId,
              [...ahead.lines, sent].map(line).join(""),
            );
            // The runner holds the renewed credential now; a tag not updated only sends it again.
            if (ahead.stamp !== live.stamp) {
              yield* api.updateTags(
                found.value.name,
                runnerTags(sessionId, agent.id, { ...live, stamp: ahead.stamp }),
              );
            }
            return accepted;
          }
          // The sandbox stopped or the runner ended: resumed, its credential set again, and the runner relaunched on the harness's session.
          const resumed = yield* api.resume(found.value.name);
          const running = resumed.currentSessionId;
          if (running === undefined) return yield* new SandboxUnavailable({});
          yield* renewCredential(target, agent, running);
          const routing = yield* readCodingAgentRouting(userId, agent.id);
          const resume = Option.getOrUndefined(
            Option.flatMapNullishOr(routing, (read) => read.nativeSession),
          );
          yield* launch(sessionId, agent, { name: found.value.name, running }, sent, resume);
          return accepted;
        }).pipe(Effect.catch(failed("send")), Effect.provideContext(context)),

      cancel: (sessionId) =>
        Effect.gen(function* () {
          const found = yield* sandboxOf(api, sessionId);
          const owned = Option.isSome(found) && (yield* ownsSandbox(found.value));
          const live =
            Option.isSome(found) && owned ? yield* liveRunner(api, found.value) : undefined;
          if (live === undefined) return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
          yield* api.writeStdin(
            live.sandboxSessionId,
            live.commandId,
            line({ type: INPUT_LINE.STOP }),
          );
          return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED } as const;
        }).pipe(Effect.catch(unavailable("cancel")), Effect.provideContext(context)),

      reset: (sessionId) =>
        Effect.gen(function* () {
          const sandboxes = yield* api.listTagged(sessionId);
          if (sandboxes.length === 0)
            return { outcome: EVE_RESET_OUTCOME.NO_ACTIVE_SESSION } as const;
          let retired = 0;
          for (const sandbox of sandboxes) {
            if (!(yield* ownsSandbox(sandbox))) continue;
            retired += 1;
            // The bearer goes first, so a runner still up is refused by Luke before its sandbox is gone.
            const agentId = sandbox.tags?.[RUNNER_TAG.AGENT];
            if (agentId !== undefined) yield* recordCodingAgentRunnerToken(userId, agentId, null);
            yield* api.deleteSandbox(sandbox.name);
          }
          // A session whose sandboxes are all another account's agents' is none of this account's to retire.
          return retired === 0
            ? ({ outcome: EVE_RESET_OUTCOME.NO_ACTIVE_SESSION } as const)
            : ({ outcome: EVE_RESET_OUTCOME.RESET } as const);
        }).pipe(Effect.catch(unavailable("reset")), Effect.provideContext(context)),

      // The runner posts its events to Luke itself, so there is no stream of a session's to follow here.
      stream: () => Stream.empty,
    };
    return sessions;
  });

/** What the events route names of a launch's end: the agent, its session, and the END event's number. */
export interface RunnerEnding {
  readonly target: ConversationTarget;
  readonly sessionId: string;
  readonly sequence: number;
}

/** How a launch's end left its sandbox. */
export const RUNNER_ENDED = {
  STOPPED: "stopped",
  /** A developer's Terminal holds the sandbox, which the sweep stops once its lease lapses. */
  HELD: "held",
  /** The END is from a launch a newer one replaced, or the sandbox is gone or already down. */
  STALE: "stale",
} as const;

/**
 * A launch's end, as its END event tells it, for either harness: the
 * sandbox stopped, its repository credential taken off the firewall first,
 * unless a developer's Terminal holds it, and nothing for an END older than
 * the launch its sandbox runs now. Fails where Vercel or the store could not
 * be asked.
 */
export const runnerEnded = Effect.fn("web/runnerEnded")(function* (ending: RunnerEnding) {
  const api = yield* vercelSandboxApi(deploymentOidcToken);
  const found = yield* sandboxOf(api, ending.sessionId);
  if (Option.isNone(found)) return RUNNER_ENDED.STALE;
  // Read apart from the runner's other tags, which a launch writes only once its command started.
  const launch = taggedLaunch(found.value.tags ?? {});
  if (launch !== undefined && ending.sequence < launch.firstSequence) return RUNNER_ENDED.STALE;
  const running = found.value.currentSessionId;
  if (found.value.status !== "running" || running === undefined) return RUNNER_ENDED.STALE;
  // Read last, just before the stop, so a developer who opened a Terminal during the turn keeps the sandbox.
  if (yield* sandboxHeld(ending.target.conversationId, yield* DateTime.nowAsDate))
    return RUNNER_ENDED.HELD;
  yield* Effect.ignore(api.updateNetworkPolicy(running, OPEN_INTERNET_POLICY));
  yield* api.stopSession(running);
  return RUNNER_ENDED.STOPPED;
});
