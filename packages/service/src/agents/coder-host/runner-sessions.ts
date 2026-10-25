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
 * `open` reads the harness's credential and answers, as eve's open answers
 * once eve took the message; past the answer (`after-response.ts`) it opens
 * a sandbox from the coding agent's image (`agent-sandbox-image.ts`),
 * waiting while the image is prepared, checks the agent's repository out
 * into it on eve's terms (`checkout.ts`, the same token at the firewall,
 * but cloned whole, since the history is deepened before the runner starts
 * anyway), or opens it from its workspace's repository snapshot of the
 * same image and fetches only what landed since (`repository-snapshot.ts`),
 * building that snapshot past the answer where none was ready, writes the
 * skills its member installed into Luke beside it (`native-skills.ts`), and
 * launches the runner. A launch that fails there is the agent's failed turn.
 * A launch mints the runner's bearer and records its digest on the
 * agent's row, uploads the runner's bundle (`runner-bundle.ts`), and starts
 * it as a detached command of the sandbox's API as root, which installs the
 * bundle where only root writes, checks its digest, shares the checkout with
 * the `agent` user, and drops to that user with every capability gone
 * (`sandbox-capabilities.ts`). The harness's credential and the bearer are
 * in that command's environment and nowhere else: never in its argv, its
 * config line, a file, or a tag. The config line and the first message are
 * written to its stdin. The command, the sandbox session it runs in, and the
 * first event number of the launch are kept as the sandbox's tags, which is
 * how a later call finds the runner it writes to.
 *
 * A message's words go as text and its images as image blocks; any other
 * file it carries, such as a PDF, is written into the sandbox first, outside
 * the checkout, and the line names its path (`runnerContent`).
 *
 * `send` writes the harness's lines and then a message line to that runner
 * while it runs. Where the sandbox stopped or the runner ended, it resumes
 * the sandbox, sets the repository's credential at its firewall again, and
 * launches the runner anew with the harness's session to resume and the
 * next event number, whose session files the sandbox's persisted disk kept.
 * `cancel` writes `stop` to a runner that runs, scoped to the launch running
 * the turn the Stop names, and nothing once that turn is no longer under way. `reset` retires the runner's
 * bearer and deletes the sandbox. Nothing here streams: the runner posts its
 * events to Luke itself.
 *
 * At a launch's end (`runnerEnded`, which the events route calls on the
 * runner's END event) the sandbox is stopped unless a developer's Terminal
 * holds it, as eve's is at a turn's end; a runner waiting on a background
 * task or a wakeup has posted no END, so its sandbox stays up. An END from a
 * launch a newer one replaced, told by its event number, stops nothing.
 *
 * `open`, `send`, `cancel`, and `retune` each hold the agent's runner lease
 * (`coding-agent-runner-lease.ts`) from before they read where its runner
 * stands until they wrote to it or launched it, so two calls at once never
 * both relaunch, each minting a bearer that shuts the other's runner out,
 * nor write at one stdin offset; the later call waits, and finds the runner
 * the earlier one launched. A call that waits past `CODER.RUNNER_LEASE.WAIT`
 * fails as unavailable.
 *
 * Every call answers in eve's outcomes, so a caller holds one interface
 * whichever runtime answers. What fails here (Vercel, the store, GitHub, a
 * missing credential or snapshot) answers `failed`, with the reason in the
 * log by its kind alone; a launch refused for the account's plan says which
 * way its plan failed. Nothing is retried.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AGENT_USER, RUNNER_DIRECTORY } from "@luke/agent-runner/pins";
import {
  type ContentBlock,
  INPUT_LINE,
  type InputLine,
  type IntegrationServer,
  RUNNER_ENV,
  type RunnerConfig,
} from "@luke/agent-runner/protocol";
import { settleRunnerLostTurns } from "@luke/database/models/abandoned-turns";
import {
  claimCodingAgentRunnerLease,
  releaseCodingAgentRunnerLease,
} from "@luke/database/models/coding-agent-runner-lease";
import {
  awaitingLinesOfReached,
  type CodingAgent,
  hasRepository,
  latestTurnsOfReached,
  RUNNING_TURN_STATUSES,
  readCodingAgent,
  readCodingAgentOfConversation,
  readCodingAgentRouting,
  readNativeRunStanding,
  recordCodingAgentRunnerToken,
  type WithRepository,
} from "@luke/database/models/coding-agent-store";
import { replaceCodingAgentWakeups } from "@luke/database/models/coding-agent-wakeups";
import {
  clearNativeRewindHanded,
  readNativeRewind,
} from "@luke/database/models/conversation-rewind";
import { sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { causeKind } from "@luke/runtime/effect";
import type { UserContent } from "ai";
import { Clock, Context, Data, DateTime, Duration, Effect, Option, Result, Stream } from "effect";
import { TURN_ORIGIN } from "../../core.js";
import type { HostedEnvironment } from "../../environment.js";
import {
  recordServerEvent,
  type SERVER_AGENT_HARNESS,
  SERVER_EVENT,
  SERVER_HANDOFF_PATH,
} from "../../events/server-events.js";
import { AfterResponse, afterResponse } from "../../http/after-response.js";
import {
  AgentSandboxImage,
  type AgentSandboxImageService,
  IMAGE_PREPARING_STATUS,
  ImagePreparing,
} from "../agent-sandbox-image.js";
import type { BrainHostTurn } from "../brain-host/bounds.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type KeyRefusal,
  PLAN_REFUSAL,
  type PlanRefusal,
} from "../brain-host/eve-sessions.js";
import { runnerTokenDigest } from "../luke-mcp/bearer.js";
import { REPOSITORY_REFUSAL, type RepositorySandbox } from "../repository-shell.js";
import {
  buildRepositorySnapshot,
  forgetRepositorySnapshot,
  REPOSITORY_SNAPSHOT_STATE,
  type RepositorySnapshotOf,
  readRepositorySnapshot,
} from "../repository-snapshot.js";
import { WITHOUT_CAPABILITIES } from "../sandbox-capabilities.js";
import { capSandboxTimeout } from "../sandbox-keep-alive.js";
import { credentialPolicy, type RepositoryCredential } from "../terminal/agent-sandbox.js";
import {
  deploymentOidcToken,
  type ListedSandbox,
  type NetworkPolicy,
  NOT_FOUND_STATUS,
  OPEN_INTERNET_POLICY,
  SANDBOX_STATUS,
  type SandboxFile,
  SandboxUnavailable,
  SESSION_TAG,
  SNAPSHOT_GONE_STATUS,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import { CODER, sandboxVcpus } from "./bounds.js";
import {
  type AgentRepositoryRead,
  agentDeepenPlan,
  agentRepositoryRead,
  agentRepositoryToken,
  CHECKOUT_DEPTH,
  CheckoutRefused,
  type CheckoutServices,
  cloneAgentRepository,
  deepenCheckoutWith,
  openWorkingFolder,
  refreshAgentCheckout,
} from "./checkout.js";
import { NATIVE_SKILLS_PATH, nativeSkillFiles } from "./native-skills.js";
import { RunnerBundle } from "./runner-bundle.js";
import { type NativeSessions, RUNNER_CHOICE } from "./runtime-sessions.js";
import { nativeSkills } from "./skills.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** What the sessions reach: the store, GitHub, Vercel, the image, the runner's bundle, and the deployment's key ring. */
export type RunnerServices =
  | CheckoutServices
  | AgentSandboxImage
  | RunnerBundle
  | HostedEnvironment;

/** Runs one effect on the edge's runtime; the checkout reaches the sandbox through promises (`repository-shell.ts`). */
export type SandboxRunner = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

/** What every harness's sessions are composed with. */
export interface RunnerSessionsOptions {
  /** The account the sessions act for: the agent's starter, whose conversation and key they read. */
  readonly userId: string;
  /** Where the runner posts its events: the events route (P09), which the composing edge names. */
  readonly eventsUrl: string;
  /** The Luke MCP server's endpoint (P06), which the composing edge names. */
  readonly mcpUrl: string;
  /** The integrations the agent is handed as its launch starts, each an MCP server of its own beside Luke's. */
  readonly integrations: (agent: CodingAgent) => Effect.Effect<readonly IntegrationServer[]>;
  /** Luke's coder instructions for the agent, which the harness's config carries. */
  readonly instructions: (agent: CodingAgent) => Effect.Effect<string>;
  /** One past the last event the store applied of the conversation's runner, where a launch numbers its events from. */
  readonly nextSequence: (
    conversationId: string,
  ) => Effect.Effect<number, { readonly _tag: string }>;
  readonly run: SandboxRunner;
}

/** A launch could not start: no agent, no credential, no snapshot, a model the harness cannot name, or the account's plan or API key refused. */
export class LaunchRefused extends Data.TaggedError("LaunchRefused")<{
  readonly reason: string;
  /** How the account's plan failed, where it is why. */
  readonly planRefusal?: PlanRefusal | undefined;
  /** How the account's API key failed, for an agent it pays for, where it is why. */
  readonly keyRefusal?: KeyRefusal | undefined;
  /** When a reached limit resets, in epoch milliseconds, where the provider said. */
  readonly planResetsAt?: number | undefined;
}> {}

/** What a launch's command is started with of the harness's own. */
interface HarnessLaunch {
  /** The variables beside the bearer: the harness's credential, and whatever else it reads. Never written anywhere but the command's environment. */
  readonly env: Readonly<Record<string, string>>;
}

/** The lines a message to a running runner goes behind. */
interface HarnessAhead {
  readonly lines: readonly InputLine[];
}

/**
 * What a harness's sessions do of their own; everything else is shared. Its
 * effects reach the shared services alone, and fail with `LaunchRefused`, or
 * with anything else tagged, which answers as unavailable.
 */
export interface RunnerHarness<E extends { readonly _tag: string }> {
  /** How the log and a message's unsupported attachment name it. */
  readonly name: string;
  /** Which harness it is, as a counted hand-off names it (`SERVER_EVENT.AGENT_HANDOFF`). */
  readonly runtime: (typeof SERVER_AGENT_HARNESS)[keyof typeof SERVER_AGENT_HARNESS];
  /** What a session id it mints begins with, before a fresh UUID. */
  readonly sessionPrefix: string;
  /** The credential a launch starts with, read afresh for every launch. */
  readonly launch: (
    agent: CodingAgent,
  ) => Effect.Effect<HarnessLaunch, E | LaunchRefused, RunnerServices>;
  /** The config line of a launch, resuming the harness's session where one is named, cut before the line a rewind dropped where one waits. */
  readonly config: (
    agent: CodingAgent,
    resume: string | undefined,
    firstSequence: number,
    rewindBefore: string | undefined,
  ) => Effect.Effect<RunnerConfig, LaunchRefused>;
  /** The checkout's folders the harness finds a repository's skills in, whose names it keeps over an installed skill's. */
  readonly skillRoots: readonly string[];
  /** What goes ahead of a message to a runner already running. */
  readonly ahead: (
    agent: CodingAgent,
  ) => Effect.Effect<HarnessAhead, E | LaunchRefused, RunnerServices>;
}

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

/** How many hex characters of a launch's fingerprint its tag keeps. */
const FINGERPRINT_CHARS = 32;

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

/** What `$0` reads as in the launch's shell. */
const LAUNCH_NAME = "luke-agent-runner";

/**
 * The statuses a failure answers as, which a caller logs: Vercel's own where
 * it answered one, unavailable where it did not, and refused where the
 * launch could not start at all (no agent, no credential, no snapshot, no
 * bundle).
 */
const FAILED_STATUS = { UNAVAILABLE: 503, REFUSED: 422 } as const;

/**
 * How an open past its Start's answer waits on an image still being
 * prepared, a template whose snapshot a create found gone among them: on the
 * template's build to its end (`AgentSandboxImage.prepared`), then asked
 * again at once, and given up where the image is still being prepared after
 * the template's own wait. An open answers preparing before any sandbox
 * stands, so making it again leaves nothing behind. `times` only bounds a
 * template that answers ready yet keeps losing its snapshot. A message's
 * relaunch past its answer retries on it too, its lease let go for each
 * wait (`send`).
 */
const IMAGE_READY = {
  times: 3,
  while: (failure: { readonly _tag: string }) =>
    failure instanceof ImagePreparing
      ? Effect.flatMap(AgentSandboxImage, (image) =>
          image.prepared.pipe(Effect.orElseSucceed(() => false)),
        )
      : Effect.succeed(false),
};

/** The image types a message's file may carry to the harness as an image block. */
const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** How many hex digits a session id spells the instant it was minted in: enough for every millisecond until the year 10889. */
const MINTED_AT_DIGITS = 12;

/**
 * A session id the harness's prefix begins, minted at the instant given: the
 * instant in fixed-width hex, then a fresh UUID. The instant first is what
 * lets a session opened later claim the conversation's record over one that
 * ended (`claimRuntimeSession`, forward only, by the ids' order), as eve's
 * own ids do.
 */
function sessionIdOf(prefix: string, mintedAt: number): string {
  return `${prefix}${mintedAt.toString(16).padStart(MINTED_AT_DIGITS, "0")}-${randomUUID()}`;
}

/** The bearer's bytes before it is spelled, as many as a session key. */
const BEARER_BYTES = 32;

/**
 * Where a message's files that the harness takes no block of are written
 * in its sandbox, one folder per message line: outside the checkout, so no
 * commit picks them up, and readable by `agent`, since the API writes them
 * as its default user with the mode below.
 */
const ATTACHMENT_DIRECTORY = "/tmp/luke-attachments";

/** How a file written for the agent is kept: readable by every user, written by none but the API's. */
const ATTACHMENT_MODE = 0o644;

/** How long a written file's name may be, which a tar header holds whole (`vercel-sandbox-api.ts`'s `tarOf`). */
const ATTACHMENT_NAME_CHARS = 80;

/** A message line and the files it names, which are written into the running session before the line. */
interface RunnerMessage {
  readonly line: InputLine & { readonly uuid: string };
  readonly files: readonly SandboxFile[];
}

/** A file's name as the sandbox's path holds it: a single segment of safe characters, cut short, its extension kept. */
function attachmentFileName(name: string, at: number): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^[.-]+/u, "");
  const dot = safe.lastIndexOf(".");
  const extension = dot > 0 ? safe.slice(dot).slice(0, 16) : "";
  const stem = (dot > 0 ? safe.slice(0, dot) : safe).slice(
    0,
    ATTACHMENT_NAME_CHARS - extension.length,
  );
  return `${at + 1}-${stem === "" ? "attachment" : stem}${extension}`;
}

/**
 * A message's content as the runner's lines carry it, and the files it
 * names: words as text, an image as an image block, and any other file,
 * such as a PDF, written into the sandbox under the line's own folder and
 * named by its path, as eve stages a file part in its sandbox. A file whose
 * bytes are not in the message, a URL elsewhere, is named as not passed.
 */
function runnerContent(
  message: string | UserContent,
  harness: string,
  lineId: string,
): { readonly content: readonly ContentBlock[]; readonly files: readonly SandboxFile[] } {
  if (typeof message === "string") return { content: [{ type: "text", text: message }], files: [] };
  const files: SandboxFile[] = [];
  const content = message.flatMap((part, at): ContentBlock[] => {
    if (part.type === "text") return [{ type: "text" as const, text: part.text }];
    if (part.type !== "file" && part.type !== "image") return [];
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
    if (base64 === undefined) {
      return [
        {
          type: "text" as const,
          text: `[${name} (${mediaType}) was attached but cannot be passed to ${harness}]`,
        },
      ];
    }
    const path = `${ATTACHMENT_DIRECTORY}/${lineId}/${attachmentFileName(name, at)}`;
    files.push({
      path,
      contents: new Uint8Array(Buffer.from(base64, "base64")),
      mode: ATTACHMENT_MODE,
    });
    return [
      {
        type: "text" as const,
        text: `[${name} (${mediaType}) was attached: it is at ${path} in your sandbox, read it from there]`,
      },
    ];
  });
  return { content, files };
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

/** The runner a sandbox's tags name, where the sandbox runs the session it was started in. */
export interface TaggedRunner {
  readonly sandboxSessionId: string;
  readonly commandId: string;
  readonly firstSequence: number;
  /** None for a launch from before fingerprints were tagged. */
  readonly fingerprint?: string;
}

/** The launch tag read: its first event number and its fingerprint where it has one; none where the tag is missing or unreadable. */
function taggedLaunch(
  tags: Readonly<Record<string, string>>,
): { readonly firstSequence: number; readonly fingerprint?: string } | undefined {
  const [sequence = "", fingerprint] = (tags[RUNNER_TAG.LAUNCH] ?? "").split(
    LAUNCH_FINGERPRINT_MARK,
  );
  const firstSequence = Number(sequence);
  if (sequence === "" || !Number.isSafeInteger(firstSequence)) return undefined;
  return { firstSequence, ...(fingerprint === undefined ? {} : { fingerprint }) };
}

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

/** The tags of a sandbox whose runner is no longer told of: its session, its agent, and its launch, so a late END still reads as that launch's. */
function launchTags(tags: Readonly<Record<string, string>>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of [SESSION_TAG, RUNNER_TAG.AGENT, RUNNER_TAG.LAUNCH]) {
    const value = tags[key];
    if (value !== undefined) kept[key] = value;
  }
  return kept;
}

/**
 * What a runner was launched with that it cannot take up while it runs: its
 * credential, and the integrations it was handed, as a digest. A warm
 * runner whose fingerprint no longer matches is relaunched rather than
 * handed the next message (`sendHolding`). The digest is one-way and
 * truncated, so the tag carries nothing of the credential.
 */
function launchFingerprint(
  credential: HarnessLaunch,
  integrations: readonly IntegrationServer[],
): string {
  const env = Object.entries(credential.env).sort(([one], [other]) => one.localeCompare(other));
  const names = integrations.map((each) => each.name).sort();
  return createHash("sha256")
    .update(JSON.stringify({ env, names }))
    .digest("hex")
    .slice(0, FINGERPRINT_CHARS);
}

/** The tags of a sandbox running the runner given. */
function runnerTags(sessionId: string, agentId: string, runner: TaggedRunner) {
  return {
    [SESSION_TAG]: sessionId,
    [RUNNER_TAG.AGENT]: agentId,
    [RUNNER_TAG.SANDBOX_SESSION]: runner.sandboxSessionId,
    [RUNNER_TAG.COMMAND]: runner.commandId,
    [RUNNER_TAG.LAUNCH]:
      runner.fingerprint === undefined
        ? String(runner.firstSequence)
        : [runner.firstSequence, runner.fingerprint].join(LAUNCH_FINGERPRINT_MARK),
  };
}

/** The runner the sandbox's tags name, where the sandbox is up in the session it was started in, whether or not it has exited since. */
function runnerInSession(sandbox: ListedSandbox): TaggedRunner | undefined {
  const runner = taggedRunner(sandbox);
  if (
    runner === undefined ||
    sandbox.status !== SANDBOX_STATUS.RUNNING ||
    sandbox.currentSessionId !== runner.sandboxSessionId
  ) {
    return undefined;
  }
  return runner;
}

/**
 * Whether the sandbox is up in the session its runner was started in, and
 * that runner has not exited. Only an exit Vercel read, or a command it no
 * longer knows, says the runner is down; Vercel not answering fails the
 * call, so a passing outage neither relaunches a runner beside one still
 * running nor drops a Stop.
 */
function liveRunner(
  api: VercelSandboxApi,
  sandbox: ListedSandbox,
): Effect.Effect<TaggedRunner | undefined, SandboxUnavailable> {
  const runner = runnerInSession(sandbox);
  if (runner === undefined) return Effect.succeed(undefined);
  return api
    .commandExit(runner.sandboxSessionId, runner.commandId)
    .pipe(Effect.map((exit) => (exit === null ? runner : undefined)));
}

/** The session's sandbox, the one its tag names: the newest, which is listed first (`listTagged`). */
function sandboxOf(api: VercelSandboxApi, sessionId: string) {
  return Effect.map(api.listTagged(sessionId), (sandboxes) => Option.fromNullishOr(sandboxes[0]));
}

/** Another call held the agent's runner lease for as long as a call waits on it. */
class RunnerLeaseBusy extends Data.TaggedError("RunnerLeaseBusy") {}

/**
 * The agent's runner lease taken, waiting behind another call's for at most
 * `CODER.RUNNER_LEASE.WAIT`: the holder's id, which lets it go. Run where
 * nothing interrupts, so a claim that landed is always handed back to be let
 * go; only the waits between claims are given to `restore`, so a caller's
 * deadline interrupts a call waiting behind another's lease at once, holding
 * nothing.
 */
const claimRunnerLease = (
  agentId: string,
  restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const holder = randomUUID();
    const hold = Duration.toMillis(CODER.RUNNER_LEASE.HOLD);
    const startedAt = yield* Clock.currentTimeMillis;
    while (true) {
      const now = yield* Clock.currentTimeMillis;
      if (
        yield* claimCodingAgentRunnerLease(agentId, holder, new Date(now), new Date(now + hold))
      ) {
        return holder;
      }
      if (now - startedAt >= Duration.toMillis(CODER.RUNNER_LEASE.WAIT)) {
        return yield* new RunnerLeaseBusy();
      }
      yield* restore(Effect.sleep(CODER.RUNNER_LEASE.POLL));
    }
  });

/**
 * The body run holding the agent's runner lease, let go as it ends however
 * it ends, an interruption included. A release that fails leaves the lease
 * to lapse at its `HOLD`.
 */
const holdingRunner = <A, E, R>(agentId: string, body: Effect.Effect<A, E, R>) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const holder = yield* claimRunnerLease(agentId, restore);
      return yield* restore(body).pipe(
        Effect.ensuring(
          releaseCodingAgentRunnerLease(agentId, holder).pipe(
            Effect.catch((failure) =>
              Effect.logWarning(`a runner lease was not let go: ${failure._tag}`),
            ),
          ),
        ),
      );
    }),
  );

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

/**
 * A failure as the log says it: a sandbox's own words, which name the call
 * that failed, its status, and Vercel's error or the cause's, never what was
 * sent; the kind alone for any other, since a store failure's message may
 * name a statement.
 */
function describeFailure(failure: { readonly _tag: string }): string {
  return failure instanceof SandboxUnavailable ? failure.message : failure._tag;
}

/** The sessions for one account on the harness given, over the calling fiber's services. */
export const runnerSessions = <
  E extends { readonly _tag: string },
  Turn extends BrainHostTurn = BrainHostTurn,
>(
  harness: RunnerHarness<E>,
  options: RunnerSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
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
     * The member's installed skills, less the repository's, uploaded for the
     * launch to install (`native-skills.ts`), as a new sandbox opens; nothing
     * where there are none. A write that fails is logged, and the agent opens
     * without them rather than not at all.
     */
    const writeInstalledSkills = (running: string, files: readonly SandboxFile[]) =>
      (files.length === 0 ? Effect.void : api.writeFiles(running, files)).pipe(
        Effect.catch((failure) =>
          Effect.logWarning(
            `The installed skills of a ${harness.name} agent were not written: ${describeFailure(failure)}`,
          ),
        ),
      );

    /**
     * One launch of the runner in the running session: a fresh bearer
     * recorded, the bundle uploaded, the launch's tag written, its config
     * read, and the caller's own steps (`alongside`) run, all at once, since
     * none waits on another and the command waits on them all; then the
     * command started, the runner's place kept in the sandbox's tags, and
     * its config line and first message written.
     */
    const launch = <AE, AR>(
      sessionId: string,
      agent: CodingAgent,
      sandbox: { readonly name: string; readonly running: string },
      first: RunnerMessage,
      resume: string | undefined,
      credential: HarnessLaunch,
      alongside: Effect.Effect<void, AE, AR>,
    ) =>
      Effect.gen(function* () {
        const bearer = randomBytes(BEARER_BYTES).toString("base64url");
        const launching = (firstSequence: number) => ({
          [SESSION_TAG]: sessionId,
          [RUNNER_TAG.AGENT]: agent.id,
          [RUNNER_TAG.LAUNCH]: String(firstSequence),
        });
        const [digest, { firstSequence, config, rewind }] = yield* Effect.all(
          [
            Effect.gen(function* () {
              const bundle = yield* (yield* RunnerBundle).contents;
              yield* api.writeFiles(sandbox.running, [
                { path: RUNNER_PATH.UPLOAD, contents: bundle, mode: 0o644 },
              ]);
              return createHash("sha256").update(bundle).digest("hex");
            }),
            Effect.gen(function* () {
              const firstSequence = yield* options.nextSequence(agent.conversationId);
              // A rewind's cut is handed to the launch that resumes the harness's session, and let go
              // once the runner has it; a fresh session never heard the line it names.
              const read = Effect.gen(function* () {
                const rewind = Option.getOrUndefined(
                  yield* readNativeRewind({ userId, conversationId: agent.conversationId }),
                );
                const rewindBefore = resume === undefined ? undefined : rewind;
                const config = yield* harness.config(agent, resume, firstSequence, rewindBefore);
                return { config, rewind };
              });
              // The launch's tag is written before its command starts, so an END the launch it
              // replaces posts late is told apart from this one's and stops nothing.
              const [, made] = yield* Effect.all(
                [api.updateTags(sandbox.name, launching(firstSequence)), read],
                { concurrency: "unbounded" },
              );
              return { firstSequence, ...made };
            }),
            filesWritten(sandbox.running, first),
            recordCodingAgentRunnerToken(userId, agent.id, runnerTokenDigest(bearer)),
            alongside,
          ],
          { concurrency: "unbounded" },
        );
        const commandId = yield* api.start(sandbox.running, {
          command: "bash",
          args: ["-c", LAUNCH_SCRIPT, LAUNCH_NAME, digest],
          cwd: CODER.CHECKOUT_PATH,
          // Note that the credential and the bearer ride in the environment alone, which the API's
          // sudo keeps, as Vercel documents it does, on an image that honours that (`sandbox-image.ts`).
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
              fingerprint: launchFingerprint(credential, yield* options.integrations(agent)),
            }),
          );
          yield* api
            .writeStdin(sandbox.running, commandId, `${line(config)}${line(first.line)}`)
            .pipe(
              Effect.tapError(() =>
                diedAtStart(api, sandbox.running, commandId, [
                  ...Object.values(credential.env),
                  bearer,
                ]),
              ),
            );
          if (rewind !== undefined) yield* clearNativeRewindHanded(agent.conversationId, rewind);
        }).pipe(
          Effect.tapError(() =>
            Effect.ignore(
              Effect.andThen(
                api.kill(sandbox.running, commandId),
                api.updateTags(sandbox.name, launching(firstSequence)),
              ),
            ),
          ),
        );
        // A released wait's wakeups go once the CLI has started again and taken its first
        // message: it restores on resume what it can (`coding-agent-wakeups.ts`), so a copy Luke
        // still held would fire twice, or after the agent cancelled it. A launch that failed
        // before this leaves them for the sweep to deliver, and a delete that failed is logged,
        // never failing the launch that already runs.
        yield* replaceCodingAgentWakeups(agent.id, []).pipe(
          Effect.catch((failure) =>
            Effect.logWarning(`a relaunched agent's wakeups were not handed back: ${failure._tag}`),
          ),
        );
      });

    /** The message as a line, under Luke's id for it where the caller named one, and the files it names. */
    const messageLine = (message: EveMessage<Turn>): RunnerMessage => {
      const uuid = message.lineId ?? randomUUID();
      const { content, files } = runnerContent(message.message, harness.name, uuid);
      return { line: { type: INPUT_LINE.MESSAGE, uuid, content }, files };
    };

    /** The files a message names written into the running session, before its line names them. */
    const filesWritten = (running: string, message: RunnerMessage) =>
      message.files.length === 0 ? Effect.void : api.writeFiles(running, message.files);

    /** A failure as the log says it and the caller reads it: a refusal's reason, a sandbox's own words, the kind alone for any other. */
    const failed = (call: string) => (failure: { readonly _tag: string }) =>
      Effect.as(
        Effect.logWarning(
          `A ${harness.name} ${call} failed: ${failure instanceof LaunchRefused ? failure.reason : describeFailure(failure)}`,
        ),
        {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: failedStatus(failure),
          ...(failure instanceof LaunchRefused && failure.planRefusal !== undefined
            ? { planRefusal: failure.planRefusal }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.planResetsAt !== undefined
            ? { planResetsAt: failure.planResetsAt }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.keyRefusal !== undefined
            ? { keyRefusal: failure.keyRefusal }
            : undefined),
        } as const,
      );

    /** A cancel's or a reset's failure, as the log says it: a sandbox's own words, the kind alone for any other. */
    const unavailable = (call: string) => (failure: { readonly _tag: string }) =>
      Effect.as(
        Effect.logWarning(`A ${harness.name} ${call} failed: ${describeFailure(failure)}`),
        {
          outcome: "failed" as const,
          status: failedStatus(failure),
        },
      );

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
            repositorySandboxOver(api, running, options.run),
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
      of: RepositorySnapshotOf,
      snapshotId: string,
      read: AgentRepositoryRead,
    ) =>
      Effect.gen(function* () {
        const opened = yield* Effect.flatMap(createdFrom(agent, sessionId, snapshotId), runningOf);
        yield* refreshAgentCheckout(
          agent,
          repositorySandboxOver(api, opened.running, options.run),
          read,
        ).pipe(Effect.tapError(() => Effect.ignore(api.deleteSandbox(opened.name))));
        return Option.some(opened);
      }).pipe(
        Effect.catch((failure) =>
          Effect.gen(function* () {
            yield* Effect.logWarning(
              `A ${harness.name} sandbox did not open from its repository snapshot: ${describeFailure(failure)}`,
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
          repositorySandboxOver(api, opened.running, options.run),
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
    const openedCheckout = (target: ConversationTarget, agent: CodingAgent, sessionId: string) =>
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
          ? yield* checkedOutSandbox(image, agent, read, sessionId, snapshot.value)
          : yield* openedFromImage(image, agent, sessionId, snapshot.value);
      });

    /**
     * What a new sandbox's launch reads that needs no sandbox: what the
     * deepen reads of GitHub (`agentDeepenPlan`), and the member's installed
     * skills. Each
     * read is kept as it ended, so one that failed fails the launch only once
     * the sandbox it would delete stands, and never cuts its opening short.
     */
    const launchReads = (target: ConversationTarget, agent: CodingAgent) =>
      Effect.all(
        [
          Effect.exit(
            hasRepository(agent) ? agentDeepenPlan(target, agent) : Effect.succeed(undefined),
          ),
          Effect.map(nativeSkills(target, agent, harness.skillRoots), nativeSkillFiles),
        ],
        { concurrency: "unbounded" },
      );

    /**
     * A new sandbox opened under the session given, the agent's repository
     * checked out in it (`openedCheckout`), then at once what eve's first
     * write does (`deepenAgentCheckout`): the write token at the firewall and
     * the commit identity, since the harness's own shell has no hook for a
     * first write; and the runner launched on the first line. What the launch
     * reads of GitHub and the store is read beside the sandbox's opening and
     * its checkout (`launchReads`), and the deepen and the skills' upload run
     * beside the launch's own uploads. Where the caller waits on an image
     * still being prepared (`IMAGE_READY`), only the opening is asked again,
     * so the reads are made once. A sandbox whose launch failed is deleted
     * again, since no conversation records the session that would find it.
     */
    const openedSandbox = (
      agent: CodingAgent,
      sessionId: string,
      first: RunnerMessage,
      credential: HarnessLaunch,
      waitOnImage: boolean,
    ) =>
      Effect.gen(function* () {
        const target: ConversationTarget = { userId, conversationId: agent.conversationId };
        const opening = openedCheckout(target, agent, sessionId);
        const [{ name, running }, [deepen, skills]] = yield* Effect.all(
          [waitOnImage ? Effect.retry(opening, IMAGE_READY) : opening, launchReads(target, agent)],
          { concurrency: "unbounded" },
        );
        yield* Effect.gen(function* () {
          const repositorySandbox = repositorySandboxOver(api, running, options.run);
          // Note that a sandbox just opened holds no deepen's record, so none is looked for.
          const checkout = Effect.flatMap(deepen, (plan) =>
            plan === undefined
              ? openWorkingFolder(repositorySandbox)
              : deepenCheckoutWith(repositorySandbox, plan),
          );
          yield* launch(
            sessionId,
            agent,
            { name, running },
            first,
            undefined,
            credential,
            Effect.all([checkout, writeInstalledSkills(running, skills)], {
              concurrency: "unbounded",
              discard: true,
            }),
          );
        }).pipe(Effect.tapError(() => Effect.ignore(api.deleteSandbox(name))));
      });

    /** A message to the session, under the agent's runner lease: the sandbox and the agent read afresh, since a call the lease waited behind may have relaunched. */
    /** The runner launched again in the running session given, its credential set afresh and the harness's session resumed. */
    const relaunched = (
      sessionId: string,
      agent: CodingAgent,
      name: string,
      running: string,
      sent: RunnerMessage,
    ) =>
      Effect.gen(function* () {
        const target = { userId, conversationId: agent.conversationId };
        const [, routing, credential] = yield* Effect.all(
          [
            renewCredential(target, agent, running),
            readCodingAgentRouting(userId, agent.id),
            harness.launch(agent),
          ],
          { concurrency: "unbounded" },
        );
        const resume = Option.getOrUndefined(
          Option.flatMapNullishOr(routing, (read) => read.nativeSession),
        );
        yield* launch(sessionId, agent, { name, running }, sent, resume, credential, Effect.void);
      });

    /**
     * Whether the runner is warm, no turn of the agent's under way, and was
     * launched with a credential or integrations that have changed since,
     * which it cannot take up while it runs. A runner at work keeps going on
     * what it has, and one from before fingerprints were tagged is never
     * read as stale.
     */
    const staleWarm = (agent: CodingAgent, runner: TaggedRunner, turnRunning: boolean) =>
      Effect.gen(function* () {
        if (runner.fingerprint === undefined || turnRunning) return false;
        const credential = yield* harness.launch(agent);
        const now = launchFingerprint(credential, yield* options.integrations(agent));
        return now !== runner.fingerprint;
      });

    const sendHolding = (sessionId: string, message: EveMessage<Turn>, sent: RunnerMessage) =>
      Effect.gen(function* () {
        // The agent is read beside the sandbox, and its read answers only for a sandbox found.
        const [found, agentRead] = yield* Effect.all(
          [sandboxOf(api, sessionId), Effect.exit(agentOf(message.conversationId))],
          { concurrency: "unbounded" },
        );
        if (Option.isNone(found)) return { outcome: EVE_SEND_OUTCOME.RETIRED } as const;
        const agent = yield* agentRead;
        // The session must be the conversation's own agent's, which the account reaches.
        if (found.value.tags?.[RUNNER_TAG.AGENT] !== agent.id) {
          return { outcome: EVE_SEND_OUTCOME.RETIRED } as const;
        }
        const target = { userId, conversationId: agent.conversationId };
        const accepted = {
          outcome: EVE_SEND_OUTCOME.ACCEPTED,
          sessionId,
          deliveryId: sent.line.uuid,
        } as const;
        // Where the agent's turns stand as the message arrives, counted with how it reached the runner.
        const { conversationId } = agent;
        const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);
        const turnRunning = turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status);
        const handedAt = yield* Clock.currentTimeMillis;
        const handed = (path: (typeof SERVER_HANDOFF_PATH)[keyof typeof SERVER_HANDOFF_PATH]) =>
          recordServerEvent(SERVER_EVENT.AGENT_HANDOFF, userId, {
            harness: harness.runtime,
            path,
            turn_running: turnRunning,
            ...(turnRunning || turn?.settledAt == null
              ? {}
              : {
                  idle_seconds: Math.max(
                    0,
                    Math.round((handedAt - turn.settledAt.getTime()) / 1_000),
                  ),
                }),
          });
        const running = runnerInSession(found.value);
        if (running !== undefined) {
          // A warm runner launched with what has changed since is ended, and the message relaunches it.
          if (yield* staleWarm(agent, running, turnRunning)) {
            yield* api.kill(running.sandboxSessionId, running.commandId);
            yield* relaunched(sessionId, agent, found.value.name, running.sandboxSessionId, sent);
            yield* handed(SERVER_HANDOFF_PATH.RELAUNCHED);
            return accepted;
          }
          // The harness's lines (the agent's model and effort as they stand) go ahead of the message,
          // which a change since the launch takes effect from. The choice read here stands until
          // the write: a change of it is handed to the runner by `retune`, which holds the same
          // lease, so it is written after this line, never undone by it.
          const [ahead] = yield* Effect.all(
            [harness.ahead(agent), filesWritten(running.sandboxSessionId, sent)],
            { concurrency: "unbounded" },
          );
          // Note that the write is the runner's liveness check: Vercel refuses stdin to a command
          // that exited (`command_not_found_or_exited`, a 404), which relaunches below, because
          // reading the exit first waits out `EXIT_WAIT` on a runner that runs, two seconds a message.
          const wrote = yield* api
            .writeStdin(
              running.sandboxSessionId,
              running.commandId,
              [...ahead.lines, sent.line].map(line).join(""),
            )
            .pipe(
              Effect.as(true),
              Effect.catchIf(
                (failure) => failure.status === NOT_FOUND_STATUS,
                () => Effect.succeed(false),
              ),
            );
          if (wrote) {
            // The installation token lives an hour, so each message sets a fresh one, after the
            // write rather than ahead of it: the model takes seconds to reach its first command, and
            // the agent hears the message a GitHub mint and a policy update sooner. Note that a
            // renewal that fails, or outlasts `CODER.CREDENTIAL_RENEWAL`, is logged and the message
            // stands, since the runner already took it, and a send answered failed, or past the
            // store's dispatch deadline, would record no line for it; the next message renews it.
            const renewed = yield* renewCredential(target, agent, running.sandboxSessionId).pipe(
              Effect.timeoutOption(CODER.CREDENTIAL_RENEWAL),
              Effect.catch((failure) =>
                Effect.as(
                  Effect.logWarning(
                    `A ${harness.name} runner's credential was not renewed: ${describeFailure(failure)}`,
                  ),
                  Option.some(undefined),
                ),
              ),
            );
            if (Option.isNone(renewed)) {
              yield* Effect.logWarning(
                `A ${harness.name} runner's credential renewal outlasted its bound and was given up`,
              );
            }
            yield* handed(SERVER_HANDOFF_PATH.WARM);
            return accepted;
          }
        }
        // The sandbox stopped or the runner ended: resumed, its credential set again, and the runner relaunched on the harness's session.
        // Lowered first, so the session the resume opens lives the timeout, not an old sandbox's day.
        const wasUp = found.value.status === SANDBOX_STATUS.RUNNING;
        yield* capSandboxTimeout(api, found.value);
        const resumed = yield* Effect.result(api.resume(found.value.name));
        if (Result.isFailure(resumed)) {
          if (resumed.failure.status !== SNAPSHOT_GONE_STATUS) return yield* resumed.failure;
          // Note that the snapshot expired (`CODER.SANDBOX_SNAPSHOTS`), so the sandbox can never resume:
          // the session goes on in a fresh one, a clean checkout of the repository under the
          // session's tag, as eve's agents do (eve opens a new sandbox where its snapshot is
          // gone). The harness's own session files went with the old filesystem, so none is
          // resumed. The expired sandbox is deleted only once the fresh one runs, so a launch
          // that fails (the image still preparing, a clone refused) leaves the session standing
          // for the next message to try again rather than retired; a delete that fails leaves
          // the expired one beside the fresh one, which `listTagged` lists after it as the older.
          yield* openedSandbox(agent, sessionId, sent, yield* harness.launch(agent), false);
          yield* api
            .deleteSandbox(found.value.name)
            .pipe(
              Effect.catch((failure) =>
                Effect.logWarning(
                  `An expired ${harness.name} sandbox was not deleted: ${failure.message}`,
                ),
              ),
            );
          yield* handed(SERVER_HANDOFF_PATH.FRESH);
          return accepted;
        }
        const resumedSession = resumed.success.currentSessionId;
        if (resumedSession === undefined) return yield* new SandboxUnavailable({});
        yield* relaunched(sessionId, agent, found.value.name, resumedSession, sent);
        yield* handed(wasUp ? SERVER_HANDOFF_PATH.RELAUNCHED : SERVER_HANDOFF_PATH.RESUMED);
        return accepted;
      });

    /** A Stop of the turn named, under the agent's runner lease, to the runner as it stands once the lease is held. */
    const cancelHolding = (sessionId: string, turnId: string, agent: CodingAgent) =>
      Effect.gen(function* () {
        const found = yield* sandboxOf(api, sessionId);
        const live =
          Option.isSome(found) && found.value.tags?.[RUNNER_TAG.AGENT] === agent.id
            ? yield* liveRunner(api, found.value)
            : undefined;
        if (live === undefined) return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
        const { conversationId } = agent;
        const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);
        if (turn?.id !== turnId || !RUNNING_TURN_STATUSES.has(turn.status)) {
          return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
        }
        yield* api.writeStdin(
          live.sandboxSessionId,
          live.commandId,
          line({ type: INPUT_LINE.STOP, launch: live.firstSequence }),
        );
        return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED } as const;
      });

    /**
     * The session's runner ended, under the agent's runner lease, so the
     * next message relaunches it: a Stop written to it, its exit waited for
     * at most `CODER.RUNNER_HALT`, its command ended where it still runs and
     * waited for again, its bearer let go, so nothing it posts on the way
     * down is taken, and the sandbox's tags cleared of it. Note that the tags
     * are what say a runner runs (`liveRunner`), and Vercel may still answer
     * a command it was just told to end as running, so a message sent next
     * would otherwise be written to a runner on its way down and lost. A
     * session no runner runs in has nothing to end.
     */
    const haltHolding = (sessionId: string, conversationId: string) =>
      Effect.gen(function* () {
        const found = yield* sandboxOf(api, sessionId);
        if (Option.isNone(found)) return;
        const agent = yield* agentOf(conversationId);
        if (found.value.tags?.[RUNNER_TAG.AGENT] !== agent.id) return;
        const live = yield* liveRunner(api, found.value);
        if (live === undefined) return;
        yield* api.writeStdin(
          live.sandboxSessionId,
          live.commandId,
          line({ type: INPUT_LINE.STOP, launch: live.firstSequence }),
        );
        // Note that a read of the exit answers null for a command still running once its own wait is up.
        const exited = api
          .commandExit(live.sandboxSessionId, live.commandId)
          .pipe(Effect.timeoutOption(CODER.RUNNER_HALT));
        const stopped = yield* exited;
        if (Option.isNone(stopped) || stopped.value === null) {
          yield* api.kill(live.sandboxSessionId, live.commandId);
          yield* exited;
        }
        yield* recordCodingAgentRunnerToken(userId, agent.id, null);
        yield* api.updateTags(found.value.name, {
          [SESSION_TAG]: sessionId,
          [RUNNER_TAG.AGENT]: agent.id,
        });
      });

    /** A change of model or effort, under the agent's runner lease. */
    const retuneHolding = (sessionId: string, conversationId: string) =>
      Effect.gen(function* () {
        const found = yield* sandboxOf(api, sessionId);
        if (Option.isNone(found)) return RUNNER_CHOICE.NOT_LIVE;
        const agent = yield* agentOf(conversationId);
        if (found.value.tags?.[RUNNER_TAG.AGENT] !== agent.id) return RUNNER_CHOICE.NOT_LIVE;
        const live = yield* liveRunner(api, found.value);
        if (live === undefined) return RUNNER_CHOICE.NOT_LIVE;
        const ahead = yield* harness.ahead(agent);
        const model = ahead.lines.filter((each) => each.type === INPUT_LINE.MODEL);
        if (model.length === 0) return RUNNER_CHOICE.NOT_LIVE;
        yield* api.writeStdin(live.sandboxSessionId, live.commandId, model.map(line).join(""));
        return RUNNER_CHOICE.WRITTEN;
      });

    /**
     * A launch that failed past its Start's answer: said in the log, and
     * written as the agent's first turn, queued and settled failed as a turn
     * whose runner was lost is (`settleRunnerLostTurns`), with why, so the
     * agent reads failed at once rather than starting until its grace runs
     * out. The line the Start wrote stands. A write that fails is logged.
     */
    const launchFailed = (agent: CodingAgent) => (failure: { readonly _tag: string }) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(
          `A ${harness.name} launch failed after its Start: ${failure instanceof LaunchRefused ? failure.reason : describeFailure(failure)}`,
        );
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const turnId = randomUUID();
        yield* writer.enqueueTurn(
          { userId, conversationId: agent.conversationId },
          { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
        );
        // The checkout's own sentence names GitHub or the sandbox (`status.ts`'s `FAILURE_WORDS`);
        // any other failure, a missing snapshot among them, reads as the sandbox's, with its reason.
        const detail =
          failure instanceof CheckoutRefused
            ? failure.reason
            : failure instanceof LaunchRefused
              ? `${REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE}: ${failure.reason}`
              : REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE;
        yield* settleRunnerLostTurns(
          writer,
          agent.conversationId,
          yield* Clock.currentTimeMillis,
          detail,
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`A failed launch's turn was not written: ${causeKind(cause)}`),
        ),
      );

    const sessions: NativeSessions<Turn> = {
      // An open answers once the plan's credential is read, so a plan refused or at its limit is
      // refused at once, as before; the sandbox, the checkout, and the launch run past the answer of
      // the request that asked (`after-response.ts`), under the runner lease, as eve's open hands its
      // message over and returns. The caller's after-response door is kept beside the sessions' own
      // services for that. A message sent meanwhile waits on the lease, then finds the runner.
      open: (message) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const agent = yield* agentOf(message.conversationId);
            const credential = yield* harness.launch(agent);
            const sessionId = sessionIdOf(harness.sessionPrefix, yield* Clock.currentTimeMillis);
            yield* afterResponse(
              `A ${harness.name} launch`,
              holdingRunner(
                agent.id,
                openedSandbox(agent, sessionId, messageLine(message), credential, true),
              ).pipe(Effect.catch(launchFailed(agent))),
            );
            return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId } as const;
          }).pipe(
            Effect.catch(failed("open")),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      // A relaunch on a fresh sandbox that finds the image still being prepared takes the message
      // all the same, and waits on the image's build once the answer has left. Note that the wait
      // holds no runner lease, because a message sent meanwhile waits on the lease no longer than
      // its own deadline; the lease is taken once the build ended and the message sent afresh, so
      // a sandbox a message sent meanwhile relaunched is written to rather than opened twice, and
      // let go again for another wait where the relaunch finds the image's snapshot gone. A
      // caller with no after-response door is answered that the image is being prepared, as before.
      send: (sessionId, message) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const agent = yield* agentOf(message.conversationId);
            const sent = messageLine(message);
            return yield* holdingRunner(agent.id, sendHolding(sessionId, message, sent)).pipe(
              Effect.catchIf(
                (failure) => failure instanceof ImagePreparing && Option.isSome(after),
                () =>
                  Effect.as(
                    afterResponse(
                      `A ${harness.name} relaunch`,
                      Effect.flatMap(AgentSandboxImage, (image) =>
                        Effect.ignore(image.prepared),
                      ).pipe(
                        Effect.andThen(
                          Effect.retry(
                            holdingRunner(agent.id, sendHolding(sessionId, message, sent)),
                            IMAGE_READY,
                          ),
                        ),
                        Effect.catch(launchFailed(agent)),
                      ),
                    ),
                    {
                      outcome: EVE_SEND_OUTCOME.ACCEPTED,
                      sessionId,
                      deliveryId: sent.line.uuid,
                    } as const,
                  ),
              ),
            );
          }).pipe(
            Effect.catch(failed("send")),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      // The Stop is scoped to the turn it names: written only while that turn is the
      // conversation's turn under way, to the command of the launch running it, and naming that
      // launch, so a Stop delayed past its turn never interrupts the next launch's.
      cancel: (sessionId, turnId) =>
        Effect.gen(function* () {
          const found = yield* sandboxOf(api, sessionId);
          const agentId = Option.isSome(found) ? found.value.tags?.[RUNNER_TAG.AGENT] : undefined;
          const agent =
            agentId === undefined ? Option.none() : yield* readCodingAgent(userId, agentId);
          if (Option.isNone(agent)) return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
          return yield* holdingRunner(
            agent.value.id,
            cancelHolding(sessionId, turnId, agent.value),
          );
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

      halt: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const { id } = yield* agentOf(conversationId);
          yield* holdingRunner(id, haltHolding(sessionId, conversationId));
          return true;
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(`A ${harness.name} halt failed: ${describeFailure(failure)}`),
              false,
            ),
          ),
          Effect.provideContext(context),
        ),

      // A change of model or effort goes to a runner that runs as the harness's `model` lines alone,
      // which it takes at its next model call; a runner not up takes it at the next message's launch.
      retune: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const { id } = yield* agentOf(conversationId);
          return yield* holdingRunner(id, retuneHolding(sessionId, conversationId));
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(`A ${harness.name} model change failed: ${failure._tag}`),
              RUNNER_CHOICE.FAILED,
            ),
          ),
          Effect.provideContext(context),
        ),
    };
    return sessions;
  });

/** What the events route names of a launch's end: the agent, its session, and the END event's number. */
export interface RunnerEnding {
  readonly target: ConversationTarget;
  readonly sessionId: string;
  readonly sequence: number;
}

/**
 * Whether the agent's runner may have taken a message since its turn ended:
 * a turn of its run queued or running, or a line of the developer's written
 * since that turn ended that no turn has taken yet, and not so long ago
 * that it reads as unanswered (`CODER.LINE_GRACE`). A send writes its line's
 * row before it takes the runner lease, so read under the lease this sees
 * every message a send wrote to the runner ahead of it.
 */
const runnerMayBeAtWork = (agentId: string, now: Date) =>
  Effect.gen(function* () {
    const standing = yield* readNativeRunStanding(agentId);
    if (Option.isNone(standing)) return false;
    const { conversationId, endedAt } = standing.value;
    if (endedAt === null) return true;
    const awaiting = (yield* awaitingLinesOfReached([conversationId])).get(conversationId);
    return (
      awaiting !== undefined &&
      awaiting.getTime() > endedAt.getTime() &&
      now.getTime() - awaiting.getTime() <= Duration.toMillis(CODER.LINE_GRACE)
    );
  });

/**
 * A warm runner asked to end, under the agent's runner lease: its sandbox
 * read again once the lease is held, and the retire line written to the
 * runner the sandbox runs now, where it still runs in the session given.
 * The runner ends only where it is still warm, so a message a `send` wrote
 * ahead of the line, on the same stdin, keeps it (`INPUT_LINE.RETIRE`); its
 * END then stops the sandbox as any launch's end does. Nothing is written
 * where the runner may have taken a message since its turn ended
 * (`runnerMayBeAtWork`), since the runner would decline the line and its
 * tags, cleared here, would send the next message to a second runner beside
 * it; its next turn's end retires it. Answers whether the line was written.
 */
export const retireWarmRunner = Effect.fn("web/retireWarmRunner")(function* (retiring: {
  readonly sessionId: string;
  readonly agentId: string;
  readonly running: string;
}) {
  const api = yield* vercelSandboxApi(deploymentOidcToken);
  return yield* holdingRunner(
    retiring.agentId,
    Effect.gen(function* () {
      if (yield* runnerMayBeAtWork(retiring.agentId, yield* DateTime.nowAsDate)) return false;
      const found = yield* sandboxOf(api, retiring.sessionId);
      if (Option.isNone(found)) return false;
      const live = yield* liveRunner(api, found.value);
      if (live === undefined || live.sandboxSessionId !== retiring.running) return false;
      yield* api.writeStdin(
        live.sandboxSessionId,
        live.commandId,
        line({ type: INPUT_LINE.RETIRE }),
      );
      // The runner is told of no longer, before the lease goes, so a message sent while it ends
      // relaunches it rather than landing behind the retire, which the runner ends on unread.
      yield* api.updateTags(found.value.name, launchTags(found.value.tags ?? {}));
      return true;
    }),
  );
});

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
 * the launch its sandbox runs now. Decided and stopped under the agent's
 * runner lease, read again once it is held, so a `send` relaunching the
 * runner either finishes first, and its newer launch makes this END stale,
 * or starts after the stop and resumes the sandbox. Fails where Vercel or
 * the store could not be asked, or the lease stayed held past its wait.
 */
export const runnerEnded = Effect.fn("web/runnerEnded")(function* (ending: RunnerEnding) {
  const api = yield* vercelSandboxApi(deploymentOidcToken);
  const found = yield* sandboxOf(api, ending.sessionId);
  if (Option.isNone(found)) return RUNNER_ENDED.STALE;
  const agentId = found.value.tags?.[RUNNER_TAG.AGENT];
  // A sandbox no agent's tag names was never launched into, so no runner of it has a lease to wait out.
  if (agentId === undefined) return yield* stoppedAtEnd(api, ending);
  return yield* holdingRunner(agentId, stoppedAtEnd(api, ending));
});

/**
 * A launch's IDLE, its runner warm past the agent's turn, where the warm
 * window is zero (`CODER.RUNNER_WARM`): the runner retired at once
 * (`retireWarmRunner`), whose END then stops the sandbox. Retiring under
 * the runner lease is what keeps a message sent at the turn's end: one a
 * send wrote first is taken by the runner, which still reads its stdin, and
 * one sent after finds the runner no longer told of and relaunches. Nothing
 * for an IDLE older than the launch its sandbox runs now. Answers whether
 * the retire line was written.
 */
export const runnerIdled = Effect.fn("web/runnerIdled")(function* (idle: RunnerEnding) {
  const api = yield* vercelSandboxApi(deploymentOidcToken);
  const found = yield* sandboxOf(api, idle.sessionId);
  if (Option.isNone(found)) return false;
  const agentId = found.value.tags?.[RUNNER_TAG.AGENT];
  const launch = taggedLaunch(found.value.tags ?? {});
  const running = found.value.currentSessionId;
  if (agentId === undefined || running === undefined) return false;
  if (found.value.status !== SANDBOX_STATUS.RUNNING) return false;
  if (launch !== undefined && idle.sequence < launch.firstSequence) return false;
  return yield* retireWarmRunner({ sessionId: idle.sessionId, agentId, running });
});

/** The stop `runnerEnded` decides, on the sandbox as it stands when read here. */
const stoppedAtEnd = Effect.fn("web/stoppedAtEnd")(function* (
  api: VercelSandboxApi,
  ending: RunnerEnding,
) {
  const found = yield* sandboxOf(api, ending.sessionId);
  if (Option.isNone(found)) return RUNNER_ENDED.STALE;
  // Read apart from the runner's other tags, which a launch writes only once its command started.
  const launch = taggedLaunch(found.value.tags ?? {});
  if (launch !== undefined && ending.sequence < launch.firstSequence) return RUNNER_ENDED.STALE;
  const running = found.value.currentSessionId;
  if (found.value.status !== SANDBOX_STATUS.RUNNING || running === undefined)
    return RUNNER_ENDED.STALE;
  // Read last, just before the stop, so a developer who opened a Terminal during the turn keeps the sandbox.
  if (yield* sandboxHeld(ending.target.conversationId, yield* DateTime.nowAsDate))
    return RUNNER_ENDED.HELD;
  // The credential comes off first, and a sandbox it would not come off is left up rather than
  // stopped with it: the call fails, and the sweep (`native-sandbox-sweep.ts`) tries again.
  yield* api.updateNetworkPolicy(running, OPEN_INTERNET_POLICY);
  yield* api.stopSession(running);
  return RUNNER_ENDED.STOPPED;
});
