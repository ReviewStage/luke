/**
 * runner-sessions.ts -- a coding agent's sessions on a native harness: the runner launched on the machine Luke opens for it, its stdin written to, and the machine's place stopped, resumed, and thrown away around it.
 *
 * The launch machinery the `claude_code` and `codex` implementations of
 * `AgentSessions` (`eve-host/eve-sessions.ts`) share; each names what is
 * its own as a `RunnerHarness` (`claude-code-sessions.ts`,
 * `codex-sessions.ts`): the credential its runner is started with, its
 * config line, and the lines that go ahead of a message to a runner already
 * running. Its session is Luke's own: an id minted as the session opens,
 * which the machine finds the agent's place by (in a sandbox, its
 * `sessionId` tag, so the Terminal tab, the stop and the cleanup sweep find
 * the sandbox by it exactly as they find eve's: `terminal/agent-sandbox.ts`,
 * `session-sandboxes.ts`). The
 * harness's own session or thread id is the conversation's
 * `native_session`, which the events route records from what the runner
 * reports, and a relaunch resumes.
 *
 * `open` reads the harness's credential and answers, as eve's open answers
 * once eve took the message; past the answer (`after-response.ts`) it opens
 * the agent's place with its repository checked out, waiting while the
 * machine's image is prepared, writes the skills its member installed into
 * Luke beside it (`native-skills.ts`), and launches the runner. A launch that
 * fails there is the agent's failed turn. The place, the launch, and every
 * write to the runner's stdin go through the agent's machine
 * (`../machine/agent-machine.ts`: Vercel Sandbox in
 * `../machine/vercel-machine.ts`, or the starter's Mac in
 * `../machine/device-machine.ts`, which the agent's row picks). A launch mints
 * the runner's bearer and records its digest on the agent's row, and starts
 * the runner with the harness's credential and the bearer in its
 * environment and nowhere else: never in its argv, its config line, a file,
 * or a record. The config line and the first message are its first lines.
 * The machine records the runner and the first event number of its launch
 * beside its place, which is how a later call finds the runner it writes to.
 *
 * A message's words go as text and its images as image blocks; any other
 * file it carries, such as a PDF, is written into the machine first, outside
 * the checkout, and the line names its path (`runnerContent`).
 *
 * `send` writes the harness's lines and then a message line to that runner
 * while it runs. Where the place stopped or the runner ended, it resumes
 * the place, sets the repository's credential at its firewall again, and
 * launches the runner anew with the harness's session to resume and the
 * next event number, whose session files the machine's disk kept.
 * `cancel` writes `stop` to a runner that runs, scoped to the launch running
 * the turn the Stop names, and nothing once that turn is no longer under way;
 * past the answer, a turn still running `CODER.STOP_CONFIRM` on has its
 * runner ended and is settled cancelled. `reset` retires the runner's
 * bearer and throws the place away. Nothing here streams: the runner posts its
 * events to Luke itself.
 *
 * At a launch's end (`runnerEnded`, which the events route calls on the
 * runner's END event) the place is stopped unless a developer's Terminal
 * holds it, as eve's is at a turn's end; a runner waiting on a background
 * task or a wakeup has posted no END, so its place stays up. An END from a
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
 * whichever runtime answers. What fails here (the machine, the store, GitHub, a
 * missing credential or snapshot) answers `failed`, with the reason in the
 * log by its kind alone; a launch refused for the account's plan says which
 * way its plan failed. Nothing is retried.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type ContentBlock,
  INPUT_LINE,
  type InputLine,
  type IntegrationServer,
  MESSAGE_DELIVERY,
  RUNNER_END,
  RUNNER_ENV,
  type RunnerConfig,
  type RunnerEnd,
} from "@luke/agent-runner/protocol";
import type { DatabaseServices, StoreFailure } from "@luke/database/core/query";
import { settleRunnerLostTurns } from "@luke/database/models/abandoned-turns";
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
} from "@luke/database/models/coding-agent-store";
import { replaceCodingAgentWakeups } from "@luke/database/models/coding-agent-wakeups";
import {
  clearNativeRewindHanded,
  readNativeRewind,
} from "@luke/database/models/conversation-rewind";
import {
  ANY_LAUNCH,
  clearRunnerLines,
  queueRunnerLine,
  runnerLinesWaiting,
  withdrawRunnerLine,
} from "@luke/database/models/runner-line-store";
import { sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { causeKind } from "@luke/runtime/effect";
import type { UserContent } from "ai";
import { Clock, Context, DateTime, Duration, Effect, Option } from "effect";
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
  IMAGE_PREPARING_STATUS,
  ImagePreparing,
} from "../agent-sandbox-image.js";
import type { EveHostTurn } from "../eve-host/bounds.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  PLAN_REFUSAL,
  RUNTIME_REFUSAL,
} from "../eve-host/eve-sessions.js";
import { runnerTokenDigest } from "../luke-mcp/bearer.js";
import {
  AgentMachine,
  type AgentMachineService,
  describeFailure,
  type FoundPlace,
  LaunchRefused,
  type MachineLayout,
  type MachineLifecycle,
  type MachineName,
  type MachinePlace,
  PLACE_RESUME,
  type RecordedRunner,
  RUNNER_RECORD,
  type RunnerHandle,
  type RunnerMark,
} from "../machine/agent-machine.js";
import { deploymentLifecycle } from "../machine/agent-machines.js";
import { IMAGE_READY } from "../machine/vercel-machine.js";
import { REPOSITORY_REFUSAL } from "../repository-shell.js";
import type { RepositoryCredential } from "../terminal/agent-sandbox.js";
import {
  COMMAND_GONE,
  NOT_FOUND_STATUS,
  type SandboxFile,
  SandboxUnavailable,
  sessionEnding,
} from "../vercel-sandbox-api.js";
import { CODER } from "./bounds.js";
import { agentRepositoryToken, CheckoutRefused, type CheckoutServices } from "./checkout.js";
import { nativeSkillFiles } from "./native-skills.js";
import type { RunnerBundle } from "./runner-bundle.js";
import { holdingRunner, holdingRunnerIfFree } from "./runner-lease.js";
import { type NativeSessions, RUNNER_CHOICE } from "./runtime-sessions.js";
import { nativeSkills } from "./skills.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import {
  coderTurnMessage,
  deskHandedRead,
  readNativeTurnHanded,
  recordNativeTurnHanded,
} from "./turn-message.js";

/** What the sessions reach: the store, GitHub, Vercel, the agent's machine, the image, the runner's bundle, and the deployment's key ring. */
export type RunnerServices =
  | CheckoutServices
  | AgentMachine
  | AgentSandboxImage
  | RunnerBundle
  | HostedEnvironment;

/** What every harness's sessions are composed with. */
export interface RunnerSessionsOptions {
  /** The account the sessions act for: the agent's starter, whose conversation and key they read. */
  readonly userId: string;
  /** Where the runner posts its events: the events route (P09), which the composing edge names. */
  readonly eventsUrl: string;
  /** Where a runner on a machine that has it read its lines reads them (`RUNNER_LINES`), which the composing edge names. */
  readonly linesUrl: string;
  /** The Luke MCP server's endpoint (P06), which the composing edge names. */
  readonly mcpUrl: string;
  /** The integrations the agent is handed as its launch starts, each an MCP server of its own beside Luke's. */
  readonly integrations: (agent: CodingAgent) => Effect.Effect<readonly IntegrationServer[]>;
  /** Luke's coder instructions for the agent, naming its checkout and installed skills where its machine keeps them, which the harness's config carries. */
  readonly instructions: (
    agent: CodingAgent,
    place: Pick<MachineLayout, "checkoutPath" | "installedSkills" | "isolation" | "sharedFiles">,
  ) => Effect.Effect<string>;
  /** One past the last event the store applied of the conversation's runner, where a launch numbers its events from. */
  readonly nextSequence: (
    conversationId: string,
  ) => Effect.Effect<number, { readonly _tag: string }>;
}

/** What a launch's command is started with of the harness's own. */
interface HarnessLaunch {
  /** The variables beside the bearer: the harness's credential, and whatever else it reads. Never written anywhere but the command's environment. */
  readonly env: Readonly<Record<string, string>>;
  /**
   * Whether it runs on its Mac's own sign-in, which its environment alone
   * may not tell apart from a credential of the account's (a Mac's Codex
   * launch on the plan carries none either); recorded in the launch's mark.
   */
  readonly ownLogin?: boolean;
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
  /** The config line of a launch on a machine of the layout given, resuming the harness's session where one is named, cut before the line a rewind dropped where one waits. */
  readonly config: (
    agent: CodingAgent,
    layout: MachineLayout,
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

/** How many hex characters of a launch's fingerprint its record keeps. */
const FINGERPRINT_CHARS = 32;

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

/** How a file written for the agent is kept: readable by every user, written by none but the API's. */
const ATTACHMENT_MODE = 0o644;

/** How long a written file's name may be, which a tar header holds whole (`vercel-sandbox-api.ts`'s `tarOf`). */
const ATTACHMENT_NAME_CHARS = 80;

/** The developer's line as the runner takes it, under Luke's id for it. */
type MessageLine = Extract<InputLine, { readonly type: typeof INPUT_LINE.MESSAGE }> & {
  readonly uuid: string;
};

/** A message line and the files it names, which are written into the running session before the line, and the turn it opens as the message named it. */
interface RunnerMessage {
  readonly line: MessageLine;
  readonly files: readonly SandboxFile[];
  readonly turn: EveHostTurn;
  readonly timeZone: string | undefined;
}

/** The message line as the runner takes it, the turn's own words ahead of the developer's, and what to keep once the runner took it. */
interface OpenedLine {
  readonly line: InputLine;
  /** What the session has handed once the line is, written on the row, and the desk's notices it showed marked read; run only once the runner took the line, so one it never took leaves both for the next. */
  readonly taken: Effect.Effect<void, never, DatabaseServices>;
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
 * such as a PDF, written into the machine under the line's own folder of
 * the attachments folder given and named by its path, as eve stages a file
 * part in its sandbox. A file whose bytes are not in the message, a URL
 * elsewhere, is named as not passed.
 */
function runnerContent(
  message: string | UserContent,
  harness: string,
  lineId: string,
  attachments: string,
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
    const path = `${attachments}/${lineId}/${attachmentFileName(name, at)}`;
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

/**
 * What a runner was launched with that it cannot take up while it runs: its
 * credential, and the integrations it was handed, as a digest. A warm
 * runner whose fingerprint no longer matches is relaunched rather than
 * handed the next message (`sendHolding`). The digest is one-way and
 * truncated, so the record carries nothing of the credential.
 */
function launchFingerprint(
  credential: HarnessLaunch,
  integrations: readonly IntegrationServer[],
): string {
  const env = Object.entries(credential.env).sort(([one], [other]) => one.localeCompare(other));
  const names = integrations.map((each) => each.name).sort();
  // Note that the Mac's own sign-in is part of what the launch was started with, so a turn
  // to or from it relaunches a warm runner whose environment reads the same either way.
  const own = credential.ownLogin === true ? { ownLogin: true } : {};
  return createHash("sha256")
    .update(JSON.stringify({ env, names, ...own }))
    .digest("hex")
    .slice(0, FINGERPRINT_CHARS);
}

/** The place a runner's handle names, without the runner. */
function placeOfHandle(handle: RunnerHandle): MachinePlace {
  return { machine: handle.machine, session: handle.session, running: handle.running };
}

/** Where a found place's record is kept, under the agent given. */
function recordOf(found: FoundPlace, agentId: string) {
  return { machine: found.machine, session: found.session, name: found.name, agentId };
}

/** The place found first under the session: the newest, which is listed first (`findPlaces`). */
function firstPlace(machine: MachineLifecycle, sessionId: string) {
  return Effect.map(machine.findPlaces(sessionId), (places) => Option.fromNullishOr(places[0]));
}

/**
 * The runner the found place records, where it is up in the session that
 * runner was started in, and that runner has not exited. Only an exit read,
 * or a command no longer known, says the runner is down; the machine not
 * answering fails the call, so a passing outage neither relaunches a runner
 * beside one still running nor drops a Stop.
 */
function liveRunner(
  machine: MachineLifecycle,
  found: FoundPlace,
): Effect.Effect<RecordedRunner | undefined, SandboxUnavailable> {
  const runner = found.runner;
  if (runner === undefined) return Effect.succeed(undefined);
  return machine
    .runnerExit(runner.handle)
    .pipe(Effect.map((exit) => (exit === null ? runner : undefined)));
}

/**
 * Lines queued for the account's agent's runner to read, written for the
 * launch named by its first event number, each message line under its own
 * id, its caller holding the agent's runner lease, which keeps them in their
 * order; refused where the account holds the agent no longer.
 */
function queuedFor(userId: string, agentId: string, launch: number, lines: readonly InputLine[]) {
  return Effect.forEach(
    lines,
    (each) =>
      Effect.flatMap(
        queueRunnerLine(userId, {
          agentId,
          launch,
          text: JSON.stringify(each),
          ...(each.type === INPUT_LINE.MESSAGE && each.uuid !== undefined
            ? { lineId: each.uuid }
            : undefined),
        }),
        (place) =>
          Option.isSome(place)
            ? Effect.void
            : Effect.fail(new LaunchRefused({ reason: "no agent" })),
      ),
    { discard: true },
  );
}

/**
 * Lines handed to the runner a place records, for the account's agent:
 * queued for it to read where its launch reads its lines, which no 404
 * answers, written to its stdin where it does not.
 */
function deliveredTo(
  machine: MachineLifecycle,
  userId: string,
  agentId: string,
  runner: RecordedRunner,
  lines: readonly InputLine[],
): Effect.Effect<void, LaunchRefused | StoreFailure | SandboxUnavailable, DatabaseServices> {
  return runner.mark.linesRead === true
    ? queuedFor(userId, agentId, runner.mark.firstSequence, lines)
    : machine.writeLine(runner.handle, lines.map(line).join(""));
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
  Turn extends EveHostTurn = EveHostTurn,
>(
  harness: RunnerHarness<E>,
  options: RunnerSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<RunnerServices>();
    const machine: AgentMachineService = yield* AgentMachine;
    const { userId } = options;

    /** The agent whose conversation the message is for. */
    const agentOf = (conversationId: string) =>
      Effect.flatMap(readCodingAgentOfConversation(userId, conversationId), (agent) =>
        Option.isSome(agent)
          ? Effect.succeed(agent.value)
          : Effect.fail(new LaunchRefused({ reason: "no agent" })),
      );

    /** Whether the agent a place names is one the account reaches. */
    const ownsPlace = (found: FoundPlace) =>
      found.agentId === undefined
        ? Effect.succeed(false)
        : Effect.map(readCodingAgent(userId, found.agentId), Option.isSome);

    /** The repository's credential set at the running place's firewall again, minted afresh; an agent with no repository has none. */
    const renewCredential = (target: ConversationTarget, agent: CodingAgent, place: MachinePlace) =>
      Effect.gen(function* () {
        if (!hasRepository(agent)) return;
        const minted = yield* agentRepositoryToken(target, agent);
        const credential: RepositoryCredential = {
          token: minted.token,
          fullName: minted.fullName,
          access: minted.access,
        };
        yield* machine.setCredential(place, credential);
      });

    /**
     * The member's installed skills, less the repository's, uploaded for the
     * launch to install (`native-skills.ts`), as a new place opens; nothing
     * where there are none. A write that fails is logged, and the agent opens
     * without them rather than not at all.
     */
    const writeInstalledSkills = (place: MachinePlace, files: readonly SandboxFile[]) =>
      (files.length === 0 ? Effect.void : machine.writeFiles(place, files)).pipe(
        Effect.catch((failure) =>
          Effect.logWarning(
            `The installed skills of a ${harness.name} agent were not written: ${describeFailure(failure)}`,
          ),
        ),
      );

    /**
     * One launch of the runner in the running place: a fresh bearer
     * recorded, the launch's record written, its config read, and the caller's
     * own steps (`alongside`) run, all at once beside the machine's own, since
     * none waits on another and the runner waits on them all; then the runner
     * started, recorded by the machine before it reads anything, and its
     * config line and first message handed to it as its first lines. On a
     * machine whose runner reads its lines (`MachineLayout`'s `linesRead`),
     * the config names the read and is its only line, the first message is
     * queued for the launch, and the launch is handed beside it every message
     * an earlier launch never took; such a launch may have no first message
     * of its own, as one that hands those on (`deliverWaiting`). A runner
     * started but never configured is ended, its record cleared and its
     * first message withdrawn, so the next message relaunches whole rather
     * than writing to a runner that waits for its config.
     */
    const launch = <AE, AR>(
      agent: CodingAgent,
      place: {
        readonly name: MachineName;
        readonly running: MachinePlace;
        readonly session: string;
      },
      layout: MachineLayout,
      first: RunnerMessage | undefined,
      resume: string | undefined,
      credential: HarnessLaunch,
      alongside: Effect.Effect<void, AE, AR>,
      /** The first message as the Start composed and queued it before it answered, which the launch takes over rather than composes again, its words marked handed once the runner has it. */
      queuedFirst?: OpenedLine,
    ) =>
      Effect.gen(function* () {
        const bearer = randomBytes(BEARER_BYTES).toString("base64url");
        const recorded = {
          machine: place.running.machine,
          session: place.running.session,
          name: place.name,
          agentId: agent.id,
        };
        const launching = (firstSequence: number) =>
          machine.recordRunner(recorded, {
            kind: RUNNER_RECORD.LAUNCHED,
            mark: { firstSequence },
          });
        const ready = Effect.all(
          [
            Effect.gen(function* () {
              const firstSequence = yield* options.nextSequence(agent.conversationId);
              // A rewind's cut is handed to the launch that resumes the harness's session, and let go
              // once the runner has it; a fresh session never heard the line it names.
              const read = Effect.gen(function* () {
                const rewind = Option.getOrUndefined(
                  yield* readNativeRewind({ userId, conversationId: agent.conversationId }),
                );
                const rewindBefore = resume === undefined ? undefined : rewind;
                const config = yield* harness.config(
                  agent,
                  layout,
                  resume,
                  firstSequence,
                  rewindBefore,
                );
                return {
                  config: layout.linesRead ? { ...config, linesUrl: options.linesUrl } : config,
                  rewind,
                };
              });
              // The turn's words ahead of the first message, on what the harness's session has handed;
              // a session not resumed is fresh, and its history holds none of it. A first message the
              // Start already composed and queued is taken over as it stands, its words handed once.
              const opened =
                first === undefined
                  ? Effect.succeed(undefined)
                  : queuedFirst !== undefined
                    ? Effect.succeed(queuedFirst)
                    : openedLine(agent, place.session, first, resume === undefined);
              // The launch's record is written before its command starts, so an END the launch it
              // replaces posts late is told apart from this one's and stops nothing.
              const [, made, opening] = yield* Effect.all(
                [launching(firstSequence), read, opened],
                { concurrency: "unbounded" },
              );
              return { firstSequence, ...made, opening };
            }),
            first === undefined ? Effect.void : filesWritten(place.running, first),
            // An earlier launch's lines go but its untaken messages in the window, which this launch is handed.
            layout.linesRead ? clearedForLaunch(userId, agent.id) : Effect.void,
            recordCodingAgentRunnerToken(userId, agent.id, runnerTokenDigest(bearer)),
            alongside,
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.map(([made]) => made));
        const {
          handle,
          ready: { firstSequence, rewind, opening },
        } = yield* machine.launchRunner(place.running, {
          env: { ...credential.env, [RUNNER_ENV.BEARER]: bearer },
          agentId: agent.id,
          name: place.name,
          ready,
          firstLines: (made) =>
            Effect.gen(function* () {
              const mark: RunnerMark = {
                firstSequence: made.firstSequence,
                fingerprint: launchFingerprint(credential, yield* options.integrations(agent)),
                ...(credential.ownLogin === true ? { ownLogin: true } : undefined),
                ...(layout.linesRead ? { linesRead: true } : undefined),
              };
              const opened = made.opening === undefined ? [] : [made.opening.line];
              if (layout.linesRead) {
                yield* queued(agent, made.firstSequence, opened);
                return { lines: line(made.config), mark };
              }
              // Note that a runner fed on its stdin is never launched without a message, which a launch that hands on waiting lines is only for one that reads them.
              if (opened.length === 0) return yield* new LaunchRefused({ reason: "no message" });
              return { lines: [made.config, ...opened].map(line).join(""), mark };
            }),
          // Note that its first message goes with it, since the send that queued it answers failed.
          abandon: (made) =>
            Effect.andThen(
              layout.linesRead && first !== undefined
                ? withdrawRunnerLine(userId, agent.id, first.line.uuid)
                : Effect.void,
              launching(made.firstSequence),
            ),
        });
        // The runner was handed the first message, so what its words handed is kept for the next.
        if (opening !== undefined) yield* opening.taken;
        if (rewind !== undefined) {
          yield* clearNativeRewindHanded(agent.conversationId, rewind).pipe(
            Effect.tapError(() =>
              Effect.ignore(Effect.andThen(machine.kill(handle), launching(firstSequence))),
            ),
          );
        }
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

    /** Lines queued for the agent's runner to read, written for the launch named (`queuedFor`). */
    const queued = (agent: CodingAgent, launch: number, lines: readonly InputLine[]) =>
      queuedFor(userId, agent.id, launch, lines);

    /** Lines handed to the runner a place records, as it takes them (`deliveredTo`). */
    const delivered = (agent: CodingAgent, runner: RecordedRunner, lines: readonly InputLine[]) =>
      deliveredTo(machine, userId, agent.id, runner, lines);

    /** The message as a line, under Luke's id for it where the caller named one, and the files it names, where the machine's layout keeps them. */
    const messageLine = (message: EveMessage<Turn>, layout: MachineLayout): RunnerMessage => {
      const uuid = message.lineId ?? randomUUID();
      const { content, files } = runnerContent(
        message.message,
        harness.name,
        uuid,
        layout.attachments,
      );
      // A queued message is held by the runner for the next turn; a steer names no delivery, as a runner older than queueing reads it.
      const queued = message.delivery === MESSAGE_DELIVERY.QUEUE;
      return {
        line: {
          type: INPUT_LINE.MESSAGE,
          uuid,
          content,
          ...(queued ? { delivery: MESSAGE_DELIVERY.QUEUE } : undefined),
        },
        files,
        turn: message.turn,
        timeZone: message.timeZone,
      };
    };

    /**
     * The message line with the turn's own words ahead of the developer's
     * (`turn-message.ts`), composed on what the harness's session has handed
     * (`native_handed`): nothing yet for a fresh session, whose history
     * holds none of it, and what the row keeps otherwise. The flush line is
     * eve's alone, whose compaction the row's steps are measured against.
     */
    const openedLine = (
      agent: CodingAgent,
      sessionId: string,
      sent: RunnerMessage,
      fresh: boolean,
    ): Effect.Effect<OpenedLine, never, DatabaseServices> =>
      Effect.gen(function* () {
        const target: ConversationTarget = { userId, conversationId: agent.conversationId };
        const handed = fresh ? {} : yield* readNativeTurnHanded(target);
        const admitted: AdmittedConversation = {
          caller: userId,
          target,
          runtimeSessionId: sessionId,
          timeZone: sent.timeZone,
        };
        const now = yield* Clock.currentTimeMillis;
        const turn = { kind: sent.turn, turnId: undefined };
        const opened = yield* coderTurnMessage(
          admitted,
          agent,
          turn,
          handed,
          now,
          Effect.succeed(false),
        );
        const { content } = sent.line;
        const ahead: readonly ContentBlock[] =
          opened.text === undefined ? [] : [{ type: "text", text: opened.text }];
        const taken = Effect.andThen(
          recordNativeTurnHanded(target, opened.handed),
          deskHandedRead(agent, opened),
        );
        return { line: { ...sent.line, content: [...ahead, ...content] }, taken };
      });

    /** The files a message names written into the running place, before its line names them. */
    const filesWritten = (place: MachinePlace, message: RunnerMessage) =>
      message.files.length === 0 ? Effect.void : machine.writeFiles(place, message.files);

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
          ...(failure instanceof LaunchRefused && failure.deviceRemoved === true
            ? { runtimeRefusal: RUNTIME_REFUSAL.DEVICE_REMOVED }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.deviceAway === true
            ? { runtimeRefusal: RUNTIME_REFUSAL.DEVICE_AWAY }
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

    /**
     * A new place opened under the session given on the agent's machine, the
     * agent's repository checked out in it, then at once what eve's first
     * write does (`deepenAgentCheckout`, the machine's `finishCheckout`): the
     * write token at the firewall and the commit identity, since the
     * harness's own shell has no hook for a first write; and the runner
     * launched on the first line. The member's installed skills are read
     * beside the opening, and the deepen and the skills' upload run beside
     * the launch's own uploads. A place whose launch failed is thrown away
     * again by the machine, since no conversation records the session that
     * would find it.
     */
    const openedPlace = (
      agent: CodingAgent,
      sessionId: string,
      layout: MachineLayout,
      first: RunnerMessage | undefined,
      credential: HarnessLaunch,
      waitOnImage: boolean,
      queuedFirst?: OpenedLine,
    ) =>
      Effect.gen(function* () {
        const target: ConversationTarget = { userId, conversationId: agent.conversationId };
        yield* machine.open(
          {
            session: sessionId,
            target,
            agent,
            harness: harness.name,
            waitOnImage,
            beside: Effect.map(nativeSkills(target, agent, harness.skillRoots), (skills) =>
              nativeSkillFiles(skills, layout.skillsUpload),
            ),
          },
          (opened, skills) =>
            launch(
              agent,
              { name: opened.name, running: opened.place, session: sessionId },
              layout,
              first,
              undefined,
              credential,
              Effect.all([opened.finishCheckout, writeInstalledSkills(opened.place, skills)], {
                concurrency: "unbounded",
                discard: true,
              }),
              queuedFirst,
            ),
        );
      });

    /** The runner launched again in the running place given, its credential set afresh and the harness's session resumed; with no message of its own where it only hands on the lines an earlier launch never took. */
    const relaunched = (
      agent: CodingAgent,
      sessionId: string,
      name: MachineName,
      running: MachinePlace,
      layout: MachineLayout,
      sent: RunnerMessage | undefined,
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
        yield* launch(
          agent,
          { name, running, session: sessionId },
          layout,
          sent,
          resume,
          credential,
          Effect.void,
        );
      });

    /**
     * Whether the runner is warm, no turn of the agent's under way, and was
     * launched with a credential or integrations that have changed since,
     * which it cannot take up while it runs. A runner at work keeps going on
     * what it has, and one from before fingerprints were tagged is never
     * read as stale.
     */
    const staleWarm = (agent: CodingAgent, runner: RunnerMark, turnRunning: boolean) =>
      Effect.gen(function* () {
        if (runner.fingerprint === undefined || turnRunning) return false;
        const credential = yield* harness.launch(agent);
        const now = launchFingerprint(credential, yield* options.integrations(agent));
        return now !== runner.fingerprint;
      });

    /** A message to the session, under the agent's runner lease: the place and the agent read afresh, since a call the lease waited behind may have relaunched. */
    const sendHolding = (
      sessionId: string,
      message: EveMessage<Turn>,
      layout: MachineLayout,
      sent: RunnerMessage,
    ) =>
      Effect.gen(function* () {
        // The agent is read beside the place, and its read answers only for a place found.
        const [found, agentRead] = yield* Effect.all(
          [firstPlace(machine, sessionId), Effect.exit(agentOf(message.conversationId))],
          { concurrency: "unbounded" },
        );
        if (Option.isNone(found)) return { outcome: EVE_SEND_OUTCOME.RETIRED } as const;
        const agent = yield* agentRead;
        // The session must be the conversation's own agent's, which the account reaches.
        if (found.value.agentId !== agent.id) {
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
        const running = found.value.runner;
        if (running !== undefined) {
          const runnerPlace = placeOfHandle(running.handle);
          // A warm runner launched with what has changed since is ended, and the message relaunches it.
          if (yield* staleWarm(agent, running.mark, turnRunning)) {
            yield* machine.kill(running.handle);
            yield* relaunched(agent, sessionId, found.value.name, runnerPlace, layout, sent);
            yield* handed(SERVER_HANDOFF_PATH.RELAUNCHED);
            return accepted;
          }
          // The harness's lines (the agent's model and effort as they stand) go ahead of the message,
          // which a change since the launch takes effect from. The choice read here stands until
          // the write: a change of it is handed to the runner by `retune`, which holds the same
          // lease, so it is written after this line, never undone by it. A runner that reads its
          // lines has its exit read beside them, at most `CODER.RUNNER_EXIT_READ`, as its liveness.
          // A sandbox stopping under the files' upload, or the exit's read, is read as the runner
          // gone, and relaunches below, which uploads the files again.
          const reads = running.mark.linesRead === true;
          const [ahead, opened, uploaded, exit] = yield* Effect.all(
            [
              harness.ahead(agent),
              openedLine(agent, sessionId, sent, false),
              filesWritten(runnerPlace, sent).pipe(
                Effect.as(true),
                Effect.catchIf(sessionEnding, () => Effect.succeed(false)),
              ),
              // Note that an exit Vercel did not answer reads as a runner that runs, so an outage
              // neither fails the message nor relaunches beside a runner still reading.
              reads
                ? machine.runnerExit(running.handle, CODER.RUNNER_EXIT_READ).pipe(
                    Effect.catchIf(sessionEnding, () => Effect.succeed(COMMAND_GONE)),
                    Effect.orElseSucceed(() => null),
                  )
                : Effect.succeed(null),
            ],
            { concurrency: "unbounded" },
          );
          const lines = [...ahead.lines, opened.line];
          // Note that a write to stdin is that runner's liveness check: Vercel refuses stdin to a
          // command that exited (`command_not_found_or_exited`, a 404), or whose sandbox is
          // stopping under it, which relaunches below, because reading the exit first waits out
          // `EXIT_WAIT` on a runner that runs. A runner that reads its lines is queued them only
          // where its exit read none, and one that ends before it takes them hands them to the
          // launch its END starts (`deliverWaiting`).
          const wrote =
            uploaded &&
            (reads
              ? exit === null &&
                (yield* Effect.as(queued(agent, running.mark.firstSequence, lines), true))
              : yield* machine.writeLine(running.handle, lines.map(line).join("")).pipe(
                  Effect.as(true),
                  Effect.catchIf(
                    (failure) =>
                      (failure instanceof SandboxUnavailable &&
                        failure.status === NOT_FOUND_STATUS) ||
                      sessionEnding(failure),
                    () => Effect.succeed(false),
                  ),
                ));
          if (wrote) {
            yield* opened.taken;
            // The installation token lives an hour, so each message sets a fresh one, after the
            // write rather than ahead of it: the model takes seconds to reach its first command, and
            // the agent hears the message a GitHub mint and a policy update sooner. Note that a
            // renewal that fails, or outlasts `CODER.CREDENTIAL_RENEWAL`, is logged and the message
            // stands, since the runner already took it, and a send answered failed, or past the
            // store's dispatch deadline, would record no line for it; the next message renews it.
            const renewed = yield* renewCredential(target, agent, runnerPlace).pipe(
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
        // The place stopped or the runner ended: resumed, its credential set again, and the runner relaunched on the harness's session.
        const wasUp = found.value.running !== undefined;
        // Note that a place whose stop began as the send reached it (a launch's end or the sweep
        // stopped it a moment before) refuses every call until it has stopped, so it is resumed
        // once more and the runner launched in the session that opens, as Vercel's SDK does.
        const resumed = yield* Effect.gen(function* () {
          const place = yield* machine.resume(found.value);
          if (place === PLACE_RESUME.GONE) return place;
          yield* relaunched(agent, sessionId, found.value.name, place, layout, sent);
          return place;
        }).pipe(Effect.retry({ times: 1, while: sessionEnding }));
        if (resumed === PLACE_RESUME.GONE) {
          // Note that the snapshot expired (`CODER.SANDBOX_SNAPSHOTS`), so the sandbox can never resume:
          // the session goes on in a fresh one, a clean checkout of the repository under the
          // session's tag, as eve's agents do (eve opens a new sandbox where its snapshot is
          // gone). The harness's own session files went with the old filesystem, so none is
          // resumed. The expired sandbox is deleted only once the fresh one runs, so a launch
          // that fails (the image still preparing, a clone refused) leaves the session standing
          // for the next message to try again rather than retired; a delete that fails leaves
          // the expired one beside the fresh one, which `listTagged` lists after it as the older.
          yield* openedPlace(agent, sessionId, layout, sent, yield* harness.launch(agent), false);
          yield* machine
            .discard(found.value)
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
        yield* handed(wasUp ? SERVER_HANDOFF_PATH.RELAUNCHED : SERVER_HANDOFF_PATH.RESUMED);
        return accepted;
      });

    /**
     * A Stop of the turn named, under the agent's runner lease, to the runner
     * as it stands once the lease is held; answers the launch the stop line
     * was written to, which its force ends (`forcedStop`). A turn still
     * running whose runner is no longer up, as after a released wait, or
     * exited before the line reached it (Vercel's 404), is a Stop taken all
     * the same, with no line to write, which the force settles.
     */
    const cancelHolding = (sessionId: string, turnId: string, agent: CodingAgent) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, sessionId);
        if (Option.isNone(found) || found.value.agentId !== agent.id) {
          return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
        }
        const { conversationId } = agent;
        const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);
        if (turn?.id !== turnId || !RUNNING_TURN_STATUSES.has(turn.status)) {
          return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
        }
        const live = yield* liveRunner(machine, found.value);
        if (live === undefined) return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED } as const;
        yield* delivered(agent, live, [
          { type: INPUT_LINE.STOP, launch: live.mark.firstSequence },
        ]).pipe(
          Effect.catchIf(
            (failure) =>
              failure instanceof SandboxUnavailable && failure.status === NOT_FOUND_STATUS,
            () => Effect.void,
          ),
        );
        return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED, launch: live.mark.firstSequence } as const;
      });

    /**
     * A Stop's force, `CODER.STOP_CONFIRM` after its line was written: the
     * turn the Stop named, where it still runs with its Stop stamped, has the
     * launch the line went to ended, and is settled cancelled as a turn whose
     * runner was lost is (`settleRunnerLostTurns`), which drops the turn the
     * native projection holds too, so nothing the runner posted late lands
     * on it. Note that a newer launch, which a message after the Stop
     * started, runs on. The ended runner's bearer is let go and the place's
     * record cleared, as `haltHolding` leaves them, so nothing it posts on its
     * way down is taken and the next message relaunches; its sandbox stops
     * at the sweep (`native-sandbox-sweep.ts`), since a killed runner posts
     * no END. A turn ended meanwhile, as a runner that heard the Stop ends
     * it within seconds, is left as it ended.
     */
    const forcedStop = (
      sessionId: string,
      turnId: string,
      agent: CodingAgent,
      launch: number | undefined,
    ) =>
      Effect.andThen(
        Effect.sleep(CODER.STOP_CONFIRM),
        holdingRunner(
          agent.id,
          Effect.gen(function* () {
            const { conversationId } = agent;
            const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);
            if (turn?.id !== turnId || !RUNNING_TURN_STATUSES.has(turn.status)) return;
            if (turn.cancelRequestedAt === null) return;
            const found = yield* firstPlace(machine, sessionId);
            const live =
              Option.isSome(found) && found.value.agentId === agent.id
                ? yield* liveRunner(machine, found.value)
                : undefined;
            if (Option.isSome(found) && live !== undefined && live.mark.firstSequence === launch) {
              yield* Effect.logWarning(
                `A ${harness.name} runner did not end its turn on a Stop, and was ended`,
              );
              yield* machine.kill(live.handle);
              yield* recordCodingAgentRunnerToken(userId, agent.id, null);
              yield* machine.recordRunner(recordOf(found.value, agent.id), {
                kind: RUNNER_RECORD.NONE,
              });
            }
            const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
            const now = yield* Clock.currentTimeMillis;
            yield* settleRunnerLostTurns(writer, conversationId, now, undefined, new Set([turnId]));
          }),
        ),
      );

    /**
     * The session's runner ended, under the agent's runner lease, so the
     * next message relaunches it: a Stop written to it, its exit waited for
     * at most `CODER.RUNNER_HALT`, its command ended where it still runs and
     * waited for again, its bearer let go, so nothing it posts on the way
     * down is taken, and the place's record cleared of it. Note that the
     * record is what says a runner runs (`liveRunner`), and a machine may
     * still answer a command it was just told to end as running, so a
     * message sent next would otherwise be written to a runner on its way
     * down and lost. A session no runner runs in has nothing to end.
     */
    const haltHolding = (sessionId: string, conversationId: string) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, sessionId);
        if (Option.isNone(found)) return;
        const agent = yield* agentOf(conversationId);
        if (found.value.agentId !== agent.id) return;
        const live = yield* liveRunner(machine, found.value);
        if (live === undefined) return;
        const { handle } = live;
        yield* delivered(agent, live, [{ type: INPUT_LINE.STOP, launch: live.mark.firstSequence }]);
        // Note that a read of the exit answers null for a command still running once its own wait is up.
        const exited = machine.runnerExit(handle).pipe(Effect.timeoutOption(CODER.RUNNER_HALT));
        const stopped = yield* exited;
        if (Option.isNone(stopped) || stopped.value === null) {
          yield* machine.kill(handle);
          yield* exited;
        }
        yield* recordCodingAgentRunnerToken(userId, agent.id, null);
        yield* machine.recordRunner(recordOf(found.value, agent.id), { kind: RUNNER_RECORD.NONE });
      });

    /** A change of model or effort, under the agent's runner lease. */
    const retuneHolding = (sessionId: string, conversationId: string) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, sessionId);
        if (Option.isNone(found)) return RUNNER_CHOICE.NOT_LIVE;
        const agent = yield* agentOf(conversationId);
        if (found.value.agentId !== agent.id) return RUNNER_CHOICE.NOT_LIVE;
        const live = yield* liveRunner(machine, found.value);
        if (live === undefined) return RUNNER_CHOICE.NOT_LIVE;
        const ahead = yield* harness.ahead(agent);
        const model = ahead.lines.filter((each) => each.type === INPUT_LINE.MODEL);
        if (model.length === 0) return RUNNER_CHOICE.NOT_LIVE;
        // Note that it goes the way the runner's messages go, so it never overtakes, nor is overtaken by, a message's own model line.
        yield* delivered(agent, live, model);
        return RUNNER_CHOICE.WRITTEN;
      });

    /**
     * The lines an earlier launch never took handed on, under the agent's
     * runner lease: where a message line no launch took was queued no longer
     * ago than a line reads as awaiting its turn (`CODER.LINE_GRACE`), and no
     * runner runs to read it, the place is resumed, or a fresh one opened
     * where its disk is gone, and the runner launched on the harness's session
     * with no message of its own, which reads them. Nothing on a machine
     * whose runner takes its lines on stdin, which queues none. Answers
     * whether a runner was launched.
     */
    const deliverWaitingHolding = (sessionId: string, agent: CodingAgent) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, sessionId);
        if (Option.isNone(found) || found.value.agentId !== agent.id) return false;
        if (!(yield* linesWaitAt(userId, agent.id))) return false;
        if ((yield* liveRunner(machine, found.value)) !== undefined) return false;
        const layout = yield* machine.layout(agent);
        if (!layout.linesRead) return false;
        const resumed = yield* machine.resume(found.value);
        if (resumed === PLACE_RESUME.GONE) {
          yield* openedPlace(
            agent,
            sessionId,
            layout,
            undefined,
            yield* harness.launch(agent),
            false,
          );
          yield* Effect.ignore(machine.discard(found.value));
          return true;
        }
        yield* relaunched(agent, sessionId, found.value.name, resumed, layout, undefined);
        return true;
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

    /**
     * A message queued while another call held the lease handed on once that
     * call let go, under the lease: by `deliverWaitingHolding`, where the
     * session's place is the agent's; taken back where no place stands for the
     * session by then, said in the log, so no line waits that no launch will
     * read.
     */
    const handedOn = (sessionId: string, agent: CodingAgent, lineId: string) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, sessionId);
        if (Option.isSome(found) && found.value.agentId === agent.id) {
          return yield* deliverWaitingHolding(sessionId, agent);
        }
        yield* Effect.logWarning(
          `A ${harness.name} message queued behind another call found its session ended`,
        );
        yield* withdrawRunnerLine(userId, agent.id, lineId);
        return false;
      });

    const sessions: NativeSessions<Turn> = {
      // An open answers once the plan's credential is read, so a plan refused or at its limit is
      // refused at once, as before; the sandbox, the checkout, and the launch run past the answer of
      // the request that asked (`after-response.ts`), under the runner lease, as eve's open hands its
      // message over and returns. The caller's after-response door is kept beside the sessions' own
      // services for that. On a machine whose runner reads its lines, the first message is queued
      // before the answer, so no message sent after it can be read ahead of it; the launch's own
      // queue of it finds it queued under its id, and a message sent meanwhile is queued behind it.
      open: (message) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const agent = yield* agentOf(message.conversationId);
            const credential = yield* harness.launch(agent);
            const layout = yield* machine.layout(agent);
            const sessionId = sessionIdOf(harness.sessionPrefix, yield* Clock.currentTimeMillis);
            const first = messageLine(message, layout);
            const withdrawn = layout.linesRead
              ? Effect.ignore(withdrawRunnerLine(userId, agent.id, first.line.uuid))
              : Effect.void;
            const opened = layout.linesRead
              ? yield* openedLine(agent, sessionId, first, true)
              : undefined;
            if (opened !== undefined) yield* queued(agent, ANY_LAUNCH, [opened.line]);
            // Note that a launch that failed takes its first message back, as its turn reads failed,
            // and so does an open that fails once it queued it, which answers failed.
            yield* Effect.gen(function* () {
              yield* afterResponse(
                `A ${harness.name} launch`,
                holdingRunner(
                  agent.id,
                  openedPlace(agent, sessionId, layout, first, credential, true, opened),
                ).pipe(
                  Effect.catch((failure) =>
                    Effect.andThen(withdrawn, launchFailed(agent)(failure)),
                  ),
                ),
              );
            }).pipe(Effect.onError(() => withdrawn));
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
      // A message to a runner that reads its lines never waits behind another call's lease, as a
      // Start's launch holds it while its sandbox comes up: it is queued at once, read by the runner
      // that call leaves running, and handed on past the answer where none does (`deliverWaiting`).
      // Note that one naming files waits as before, since they are written into a running place.
      send: (sessionId, message) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const agent = yield* agentOf(message.conversationId);
            const layout = yield* machine.layout(agent);
            const sent = messageLine(message, layout);
            const queues = layout.linesRead && sent.files.length === 0 && Option.isSome(after);
            const handed = yield* (
              queues
                ? holdingRunnerIfFree(agent.id, sendHolding(sessionId, message, layout, sent))
                : Effect.map(
                    holdingRunner(agent.id, sendHolding(sessionId, message, layout, sent)),
                    Option.some,
                  )
            ).pipe(
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
                            holdingRunner(agent.id, sendHolding(sessionId, message, layout, sent)),
                            IMAGE_READY,
                          ),
                        ),
                        Effect.catch(launchFailed(agent)),
                      ),
                    ),
                    Option.some({
                      outcome: EVE_SEND_OUTCOME.ACCEPTED,
                      sessionId,
                      deliveryId: sent.line.uuid,
                    } as const),
                  ),
              ),
            );
            if (Option.isSome(handed)) return handed.value;
            // A session another agent's place stands for has ended for this one, as `sendHolding`
            // answers it. Note that no place at all is no answer yet, because a Start's launch still
            // opening its sandbox holds the lease, which is the very case this queue is for.
            const found = yield* firstPlace(machine, sessionId);
            if (Option.isSome(found) && found.value.agentId !== agent.id) {
              return { outcome: EVE_SEND_OUTCOME.RETIRED } as const;
            }
            // The harness's lines are read as `sendHolding` reads them, so a plan refused now refuses
            // the message, and where a runner is recorded they go ahead of it for that runner's launch,
            // so a change of model since it launched holds; a launch still opening its sandbox reads
            // the agent's model as it starts, and is queued the message alone for whichever launch runs.
            // Note that the runner's repository credential is not renewed for this message, as
            // `sendHolding` renews it, because the lease is another call's; it lives an hour, and the
            // next message renews it. The message is queued as the developer's words alone, since
            // the turn's own words (`openedLine`) are marked handed only once a runner took them, and
            // no runner may take this line: they go ahead of the next message handed over instead.
            // Its hand-on waits as long as a lease can stand, so it outlasts the launch it is behind.
            const ahead = yield* harness.ahead(agent);
            const recorded = Option.isSome(found) ? found.value.runner : undefined;
            yield* recorded === undefined
              ? queued(agent, ANY_LAUNCH, [sent.line])
              : queued(agent, recorded.mark.firstSequence, [...ahead.lines, sent.line]);
            yield* afterResponse(
              `A ${harness.name} hand-on`,
              holdingRunner(
                agent.id,
                handedOn(sessionId, agent, sent.line.uuid),
                CODER.RUNNER_LEASE.HOLD,
              ),
            );
            return {
              outcome: EVE_SEND_OUTCOME.ACCEPTED,
              sessionId,
              deliveryId: sent.line.uuid,
            } as const;
          }).pipe(
            Effect.catch(failed("send")),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      // The Stop is scoped to the turn it names: written only while that turn is the
      // conversation's turn under way, to the command of the launch running it, and naming that
      // launch, so a Stop delayed past its turn never interrupts the next launch's. A Stop taken
      // is forced past the answer (`forcedStop`), its wait run there rather than holding the
      // request; a caller with no after-response door leaves an unconfirmed Stop to the sweep, as
      // before.
      cancel: (sessionId, turnId) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const found = yield* firstPlace(machine, sessionId);
            const agentId = Option.isSome(found) ? found.value.agentId : undefined;
            const agent =
              agentId === undefined ? Option.none() : yield* readCodingAgent(userId, agentId);
            if (Option.isNone(agent)) {
              return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
            }
            const cancelled = yield* holdingRunner(
              agent.value.id,
              cancelHolding(sessionId, turnId, agent.value),
            );
            if (cancelled.outcome !== EVE_CANCEL_OUTCOME.ACCEPTED || Option.isNone(after)) {
              return { outcome: cancelled.outcome } as const;
            }
            const launch = "launch" in cancelled ? cancelled.launch : undefined;
            yield* afterResponse(
              `A ${harness.name} Stop's force`,
              forcedStop(sessionId, turnId, agent.value, launch),
            );
            return { outcome: cancelled.outcome } as const;
          }).pipe(
            Effect.catch(unavailable("cancel")),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      reset: (sessionId) =>
        Effect.gen(function* () {
          const places = yield* machine.findPlaces(sessionId);
          if (places.length === 0) return { outcome: EVE_RESET_OUTCOME.NO_ACTIVE_SESSION } as const;
          let retired = 0;
          for (const place of places) {
            if (!(yield* ownsPlace(place))) continue;
            retired += 1;
            // The bearer goes first, so a runner still up is refused by Luke before its place is gone.
            if (place.agentId !== undefined) {
              yield* recordCodingAgentRunnerToken(userId, place.agentId, null);
            }
            yield* machine.discard(place);
          }
          // A session whose places are all another account's agents' is none of this account's to retire.
          return retired === 0
            ? ({ outcome: EVE_RESET_OUTCOME.NO_ACTIVE_SESSION } as const)
            : ({ outcome: EVE_RESET_OUTCOME.RESET } as const);
        }).pipe(Effect.catch(unavailable("reset")), Effect.provideContext(context)),

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

      // A launch's END that left a message untaken hands it on (`runnerEnded`'s `LINES_WAITING`); a
      // launch that fails here is written as the agent's failed turn, as a Start's is.
      deliverWaiting: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const agent = yield* agentOf(conversationId);
          return yield* holdingRunner(agent.id, deliverWaitingHolding(sessionId, agent)).pipe(
            Effect.catch((failure) => Effect.as(launchFailed(agent)(failure), false)),
          );
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} hand-on of waiting lines failed: ${describeFailure(failure)}`,
              ),
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

/** What the events route names of a launch's end: the agent, its session, the END event's number, and why it ended where the END said. */
export interface RunnerEnding {
  readonly target: ConversationTarget;
  readonly sessionId: string;
  readonly sequence: number;
  readonly reason?: RunnerEnd | undefined;
}

/**
 * Whether the agent's runner may have taken a message since its turn ended:
 * a turn of its run queued or running, or a line of the developer's no turn
 * has taken yet, written not so long ago that it reads as unanswered
 * (`CODER.LINE_GRACE`). A send writes its line's row before it takes the
 * runner lease, and the runner names the line taken only in an event posted
 * after its IDLE, so read under the lease this sees every message a send
 * wrote to the runner ahead of it. Note that a line is not weighed against
 * when the turn ended, because that is when the IDLE's batch landed, which
 * may come after the next line was written.
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
      now.getTime() - awaiting.getTime() <= Duration.toMillis(CODER.LINE_GRACE)
    );
  });

/**
 * A warm runner asked to end, under the agent's runner lease: its place
 * read again once the lease is held, and the retire line written to the
 * runner the place runs now, where it still runs in the session given.
 * The runner ends only where it is still warm, so a message a `send` wrote
 * ahead of the line, on the same stdin, keeps it (`INPUT_LINE.RETIRE`); its
 * END then stops the place as any launch's end does. Nothing is written
 * where the runner may have taken a message since its turn ended
 * (`runnerMayBeAtWork`), since the runner would decline the line and its
 * record, cleared here, would send the next message to a second runner beside
 * it; its next turn's end retires it. Answers whether the line was written.
 */
export const retireWarmRunner = Effect.fn("web/retireWarmRunner")(function* (retiring: {
  readonly sessionId: string;
  /** The agent's starter, whose account its retire line is queued under. */
  readonly userId: string;
  readonly agentId: string;
  readonly running: string;
}) {
  const machine = yield* deploymentLifecycle;
  return yield* holdingRunner(
    retiring.agentId,
    Effect.gen(function* () {
      if (yield* runnerMayBeAtWork(retiring.agentId, yield* DateTime.nowAsDate)) return false;
      const found = yield* firstPlace(machine, retiring.sessionId);
      if (Option.isNone(found)) return false;
      const live = yield* liveRunner(machine, found.value);
      if (live === undefined || live.handle.running !== retiring.running) return false;
      const retire: InputLine = { type: INPUT_LINE.RETIRE };
      yield* deliveredTo(machine, retiring.userId, retiring.agentId, live, [retire]);
      // The runner is told of no longer, before the lease goes, so a message sent while it ends
      // relaunches it rather than landing behind the retire, which the runner ends on unread.
      const { launch } = found.value;
      yield* machine.recordRunner(
        recordOf(found.value, found.value.agentId ?? retiring.agentId),
        launch === undefined
          ? { kind: RUNNER_RECORD.NONE }
          : { kind: RUNNER_RECORD.LAUNCHED, mark: launch },
      );
      return true;
    }),
  );
});

/** How a launch's end left its place. */
export const RUNNER_ENDED = {
  STOPPED: "stopped",
  /** A developer's Terminal holds the place, which the sweep stops once its lease lapses. */
  HELD: "held",
  /** The END is from a launch a newer one replaced, or the place is gone or already down. */
  STALE: "stale",
  /**
   * The launch read its lines, and a message line no launch took waits, so
   * the place is left up for the launch that hands it on (`deliverWaiting`).
   * Not for a launch that failed, whose relaunch might fail before it read
   * the line just as well, again and again; its turn reads failed, and the
   * developer's Continue relaunches it.
   */
  LINES_WAITING: "lines_waiting",
} as const;

/**
 * A launch's end, as its END event tells it, for either harness: the
 * place stopped, its repository credential taken off the firewall first,
 * unless a developer's Terminal holds it, and nothing for an END older than
 * the launch its place runs now. Decided and stopped under the agent's
 * runner lease, read again once it is held, so a `send` relaunching the
 * runner either finishes first, and its newer launch makes this END stale,
 * or starts after the stop and resumes the place. Fails where the machine or
 * the store could not be asked, or the lease stayed held past its wait.
 */
export const runnerEnded = Effect.fn("web/runnerEnded")(function* (ending: RunnerEnding) {
  const machine = yield* deploymentLifecycle;
  const found = yield* firstPlace(machine, ending.sessionId);
  if (Option.isNone(found)) return RUNNER_ENDED.STALE;
  const { agentId } = found.value;
  // A place no agent is recorded for was never launched into, so no runner of it has a lease to wait out.
  if (agentId === undefined) return yield* stoppedAtEnd(machine, ending);
  return yield* holdingRunner(agentId, stoppedAtEnd(machine, ending));
});

/**
 * A launch's IDLE, its runner warm past the agent's turn, where the warm
 * window is zero (`CODER.RUNNER_WARM`): the runner retired at once
 * (`retireWarmRunner`), whose END then stops the place. Retiring under
 * the runner lease is what keeps a message sent at the turn's end: one a
 * send wrote first is taken by the runner, which still reads its stdin, and
 * one sent after finds the runner no longer told of and relaunches. Nothing
 * for an IDLE older than the launch its place runs now. Answers whether
 * the retire line was written.
 */
export const runnerIdled = Effect.fn("web/runnerIdled")(function* (idle: RunnerEnding) {
  const machine = yield* deploymentLifecycle;
  const found = yield* firstPlace(machine, idle.sessionId);
  if (Option.isNone(found)) return false;
  const { agentId, launch, running } = found.value;
  if (agentId === undefined || running === undefined) return false;
  if (launch !== undefined && idle.sequence < launch.firstSequence) return false;
  return yield* retireWarmRunner({
    sessionId: idle.sessionId,
    userId: idle.target.userId,
    agentId,
    running: running.running,
  });
});

/** The agent's lines a new launch is not handed dropped (`clearRunnerLines`): a message is handed no longer after it was queued than a line reads as awaiting its turn. */
const clearedForLaunch = (userId: string, agentId: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* clearRunnerLines(userId, agentId, new Date(now - Duration.toMillis(CODER.LINE_GRACE)));
  });

/** Whether a message line of the agent no launch took waits, queued no longer ago than a line reads as awaiting its turn. */
const linesWaitAt = (userId: string, agentId: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return yield* runnerLinesWaiting(
      userId,
      agentId,
      new Date(now - Duration.toMillis(CODER.LINE_GRACE)),
    );
  });

/** The stop `runnerEnded` decides, on the place as it stands when read here. */
const stoppedAtEnd = Effect.fn("web/stoppedAtEnd")(function* (
  machine: MachineLifecycle,
  ending: RunnerEnding,
) {
  const found = yield* firstPlace(machine, ending.sessionId);
  if (Option.isNone(found)) return RUNNER_ENDED.STALE;
  // Read apart from the runner's record, which a launch writes only once its command started.
  const { launch, running, agentId } = found.value;
  if (launch !== undefined && ending.sequence < launch.firstSequence) return RUNNER_ENDED.STALE;
  if (running === undefined) return RUNNER_ENDED.STALE;
  if (
    launch?.linesRead === true &&
    agentId !== undefined &&
    ending.reason !== RUNNER_END.FAILED &&
    (yield* linesWaitAt(ending.target.userId, agentId))
  ) {
    return RUNNER_ENDED.LINES_WAITING;
  }
  // Read last, just before the stop, so a developer who opened a Terminal during the turn keeps the place.
  if (yield* sandboxHeld(ending.target.conversationId, yield* DateTime.nowAsDate))
    return RUNNER_ENDED.HELD;
  // The credential comes off first, and a place it would not come off is left up rather than
  // stopped with it: the call fails, and the sweep (`native-sandbox-sweep.ts`) tries again.
  yield* machine.setCredential(running, undefined);
  yield* machine.stop(running);
  return RUNNER_ENDED.STOPPED;
});
