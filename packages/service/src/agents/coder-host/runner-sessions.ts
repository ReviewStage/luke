/**
 * runner-sessions.ts -- a coding agent's sessions on a native harness: the runner launched on the machine we open for it, its stdin written to, and the machine's place stopped, resumed, and thrown away around it.
 *
 * The launch machinery the `claude_code` and `codex` implementations of
 * `AgentSessions` (`eve-host/eve-sessions.ts`) share; each names what is
 * its own as a `RunnerHarness` (`claude-code-sessions.ts`,
 * `codex-sessions.ts`): the credential its runner is started with, its
 * config line, and the lines that go ahead of a message to a runner already
 * running. Its session is our own: an id minted as the session opens,
 * which the machine finds the agent's place by (in a sandbox, its
 * `sessionId` tag, so the Terminal tab, the stop and the cleanup sweep find
 * the sandbox by it exactly as they find eve's: `terminal/agent-sandbox.ts`,
 * `session-sandboxes.ts`). The
 * harness's own session or thread id is the conversation's
 * `native_session`, which the events route records from what the runner
 * reports, and a relaunch resumes.
 *
 * `open` reads the harness's credential and answers; past the answer (`after-response.ts`) it opens
 * the agent's place with its repository checked out, writes the skills its member installed into
 * the app beside it (`native-skills.ts`), and launches the runner. A launch that
 * fails there is the agent's failed turn. The place, the launch, and every
 * write to the runner's stdin go through the agent's machine
 * (`../machine/agent-machine.ts`: Vercel Sandbox in
 * `../machine/vercel-machine.ts`, or the starter's Mac in
 * `../machine/device-machine.ts`, which the agent's row picks). A launch mints
 * the runner's bearer and records its digest on the agent's row, and starts
 * the runner with the harness's credential and the bearer in its
 * environment and nowhere else: never in its argv, its config line, a file,
 * or a record. A credential the harness holds at the place's firewall
 * (`HarnessLaunch`'s `held`) is set there before the runner starts, its
 * placeholder in the environment in its place, and is taken off with every
 * other at the place's stop, or alone at a launch's end that leaves the place
 * up, for a Terminal or for the launch that hands its lines on. In a sandbox
 * the bearer goes no further than its firewall either: the runner is handed
 * a placeholder for it, which the firewall swaps for the bearer on requests
 * to our host (`heldBearer`), set and taken off on the same terms. The config
 * line and the first message are its first lines.
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
 * next event number, whose session files the machine's disk kept. A
 * runner warm past its machine's window (`CODER.RUNNER_WARM`), or one a
 * Stop was written to since its launch, is ended rather than written to,
 * and the message relaunches it, so no line goes to a runner on its way down.
 * `cancel` writes `stop` to a runner that runs, scoped to the launch running
 * the turn the Stop names, and nothing once that turn is no longer under way;
 * past the answer, a turn still running `CODER.STOP_CONFIRM` on has its
 * runner ended and is settled canceled. `reset` retires the runner's
 * bearer and throws the place away. Nothing here streams: the runner posts its
 * events to the service itself.
 *
 * At a launch's end (`runnerEnded`, which the events route calls on the
 * runner's END event) the place is stopped unless a developer's Terminal
 * holds it; a runner waiting on a background
 * task or a wakeup has posted no END, so its place stays up. An END from a
 * launch a newer one replaced, told by its event number, stops nothing.
 *
 * `open`, `send`, `cancel`, and `retune` each hold the agent's runner lease
 * (`agent-runner-lease.ts`) from before they read where its runner
 * stands until they wrote to it or launched it, so two calls at once never
 * both relaunch, each minting a bearer that shuts the other's runner out,
 * nor write at one stdin offset; the later call waits, and finds the runner
 * the earlier one launched. A call that waits past `CODER.RUNNER_LEASE.WAIT`
 * fails as unavailable.
 *
 * Every call answers in eve's outcomes, so a caller holds one interface
 * whichever runtime answers. What fails here (the machine, the store, GitHub, a
 * missing credential or snapshot) answers `failed`, said once in the log as an
 * error naming the agent, in the failure's own words, Vercel's answer for a
 * sandbox's, and reported where no named refusal explains it (`agent-log.ts`);
 * a launch refused for the account's plan says which way its plan failed.
 * A launch past its Start's answer says each step it reaches, and one that
 * fails, dies, or is interrupted there is the agent's failed turn, with why.
 * Nothing is retried but a resume that meets its sandbox still stopping or
 * being snapshotted, and a create on an image the registry is still preparing
 * (`vercel-machine.ts`).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type ContentBlock,
  INPUT_LINE,
  type InputLine,
  type IntegrationServer,
  RUNNER_END,
  RUNNER_ENV,
  type RunnerConfig,
  type RunnerEnd,
} from "@repo/agent-runner/protocol";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import { readAgentRepositories } from "@repo/database/models/agent-repositories";
import {
  type Agent,
  type AgentLatestTurn,
  awaitingLinesOfReached,
  hasRepository,
  latestTurnsOfReached,
  RUNNING_TURN_STATUSES,
  readAgent,
  readAgentOfConversation,
  readAgentRouting,
  readNativeRunStanding,
  recordAgentRunnerToken,
} from "@repo/database/models/agent-store";
import { replaceAgentWakeups } from "@repo/database/models/agent-wakeups";
import {
  clearNativeRewindHanded,
  readNativeRewind,
} from "@repo/database/models/conversation-rewind";
import { deviceAgentAwaitsUpdate } from "@repo/database/models/device-agent-store";
import {
  ANY_LAUNCH,
  clearRunnerLines,
  queueRunnerLine,
  runnerLinesWaiting,
  withdrawRunnerLine,
} from "@repo/database/models/runner-line-store";
import { sandboxHeld } from "@repo/database/models/sandbox-terminal-lease";
import { type ConversationTarget, storeWriter } from "@repo/database/models/writer";
import { AGENT_MACHINE, type AgentMachineKind } from "@repo/features/agent-wire";
import { TURN_FAILURE } from "@repo/features/turn-run";
import { causeKind, failureKind } from "@repo/runtime/effect";
import type { UserContent } from "ai";
import {
  Cause,
  Clock,
  Context,
  Data,
  DateTime,
  Duration,
  Effect,
  Option,
  Redacted,
  Ref,
  Schedule,
} from "effect";
import { TURN_ORIGIN } from "../../core.js";
import type { HostedEnvironment } from "../../environment.js";
import {
  recordServerEvent,
  type SERVER_AGENT_HARNESS,
  SERVER_EVENT,
  SERVER_HANDOFF_PATH,
} from "../../events/server-events.js";
import { AfterResponse, afterResponse } from "../../http/after-response.js";
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
import {
  AgentMachine,
  type AgentMachineService,
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
import { extraCheckoutPaths } from "../repository-sandbox-contract.js";
import { REPOSITORY_REFUSAL } from "../repository-shell.js";
import {
  FIREWALL_SLOT,
  type FirewallEntry,
  type FirewallSlot,
  githubEntry,
  newPlaceholder,
  placeholderSwap,
  RUNNER_SLOTS,
} from "../sandbox-firewall.js";
import {
  COMMAND_GONE,
  NOT_FOUND_STATUS,
  type SandboxFile,
  SandboxUnavailable,
  sessionEnding,
} from "../vercel-sandbox-api.js";
import { BEARER_PREFIX, runnerTokenDigest } from "../workspace-mcp/bearer.js";
import { type AgentImage, AgentImageMissing } from "./agent-image.js";
import { agentFailureSaid, agentLogIds, keptFailureWords, runningLogId } from "./agent-log.js";
import { CODER, CODER_REFUSAL } from "./bounds.js";
import { agentRepositoryToken, CheckoutRefused, type CheckoutServices } from "./checkout.js";
import { nativeSkillFiles } from "./native-skills.js";
import { holdingRunner, holdingRunnerIfFree } from "./runner-lease.js";
import { type NativeSessions, RUNNER_CHECKOUT, RUNNER_CHOICE } from "./runtime-sessions.js";
import { nativeSkills } from "./skills.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import { coderTurnMessage, readNativeTurnHanded, recordNativeTurnHanded } from "./turn-message.js";

/** What the sessions reach: the store, GitHub, Vercel, the agent's machine, the agents' image, and the deployment's key ring. */
export type RunnerServices = CheckoutServices | AgentMachine | AgentImage | HostedEnvironment;

/** What every harness's sessions are composed with. */
export interface RunnerSessionsOptions {
  /** The account the sessions act for: the agent's starter, whose conversation and key they read. */
  readonly userId: string;
  /**
   * Where the runner posts its events: the events route, which the composing
   * edge names. Every address the runner reaches us at is under its origin
   * (`native-agent-sessions.ts`), whose host a sandbox's firewall swaps the
   * runner's bearer in on (`heldBearer`).
   */
  readonly eventsUrl: string;
  /** Where a runner on a machine that has it read its lines reads them (`RUNNER_LINES`), which the composing edge names. */
  readonly linesUrl: string;
  /** Our MCP server's endpoint, which the composing edge names. */
  readonly mcpUrl: string;
  /** The integrations the agent is handed as its launch starts, each an MCP server of its own beside ours. */
  readonly integrations: (agent: Agent) => Effect.Effect<readonly IntegrationServer[]>;
  /** Our coder instructions for the agent, naming its checkout and installed skills where its machine keeps them, which the harness's config carries. */
  readonly instructions: (
    agent: Agent,
    place: Pick<MachineLayout, "checkoutPath" | "installedSkills" | "sharedFiles">,
  ) => Effect.Effect<string>;
  /** One past the last event the store applied of the conversation's runner, where a launch numbers its events from. */
  readonly nextSequence: (
    conversationId: string,
  ) => Effect.Effect<number, { readonly _tag: string }>;
}

/** What a launch's command is started with of the harness's own. */
export interface HarnessLaunch {
  /** The variables beside the bearer: the harness's credential, and whatever else it reads. Never written anywhere but the command's environment. */
  readonly env: Readonly<Record<string, string>>;
  /** The credential held at the place's firewall rather than handed to the command: the variables carrying the launch's placeholder, the swap set in its slot before the runner starts, and what a fingerprint reads in the placeholder's place. */
  readonly held?: {
    readonly env: Readonly<Record<string, string>>;
    readonly slot: FirewallSlot;
    readonly entry: FirewallEntry;
    /** The real credential, digested into the fingerprint so a warm runner on a changed key relaunches; none where the service renews the swap itself. */
    readonly fingerprint?: Redacted.Redacted;
  };
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
    agent: Agent,
  ) => Effect.Effect<HarnessLaunch, E | LaunchRefused, RunnerServices>;
  /** The config line of a launch on a machine of the layout given, resuming the harness's session where one is named, cut before the line a rewind dropped where one waits. */
  readonly config: (
    agent: Agent,
    layout: MachineLayout,
    resume: string | undefined,
    firstSequence: number,
    rewindBefore: string | undefined,
  ) => Effect.Effect<RunnerConfig, LaunchRefused>;
  /** The checkout's folders the harness finds a repository's skills in, whose names it keeps over an installed skill's. */
  readonly skillRoots: readonly string[];
  /** What goes ahead of a message to a runner already running. */
  readonly ahead: (agent: Agent) => Effect.Effect<HarnessAhead, E | LaunchRefused, RunnerServices>;
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

/** The header the runner presents its bearer in, named in lower case as the firewall matches it. */
const BEARER_HEADER = "authorization";

/** The bearer as a launch hands it to its runner, and the swap its machine's firewall carries for it, where it carries one. */
interface HeldBearer {
  readonly handed: string;
  readonly swap: FirewallEntry | undefined;
}

/**
 * The runner's bearer as its launch holds it. In a sandbox, whose firewall
 * holds a launch's secrets, the runner is handed a placeholder minted for
 * the launch, and the firewall sets the bearer in its place on requests to
 * our host that present it, so the bearer's bytes never enter the machine.
 * Note that the swap matches the placeholder and not our host alone, because
 * every process in the sandbox reaches us through that firewall, a
 * Terminal's shell and a page in the agent's browser among them, and only
 * one that reads the placeholder, the runner's own user, may act as the
 * agent. A Mac has no firewall of ours, and its runner is handed the bearer
 * itself.
 */
function heldBearer(bearer: string, agent: Agent, host: string): HeldBearer {
  if (agent.machine === AGENT_MACHINE.DEVICE) return { handed: bearer, swap: undefined };
  const placeholder = Redacted.value(newPlaceholder());
  const swap = placeholderSwap({
    domain: host,
    header: BEARER_HEADER,
    placeholder: Redacted.make(`${BEARER_PREFIX}${placeholder}`),
    value: Redacted.make(`${BEARER_PREFIX}${bearer}`),
  });
  return { handed: placeholder, swap };
}

/** How a file written for the agent is kept: readable by every user, written by none but the API's. */
const ATTACHMENT_MODE = 0o644;

/** How long a written file's name may be, which a tar header holds whole (`vercel-sandbox-api.ts`'s `tarOf`). */
const ATTACHMENT_NAME_CHARS = 80;

/** The developer's line as the runner takes it, under our id for it. */
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
  /** What the session has handed once the line is, written on the row; run only once the runner took the line, so one it never took leaves it for the next. */
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

/** Lines as one write to the runner's stdin. */
function stdinText(lines: readonly InputLine[]): string {
  return lines.map(line).join("");
}

/**
 * The stop a Stop or a halt writes to the runner of the launch named, by its
 * first event number. One spelling, because a send looks for the very write
 * a Stop made (`stopWritten`), so a field added to the line moves both.
 */
function stopLine(launch: number): InputLine {
  return { type: INPUT_LINE.STOP, launch };
}

/**
 * What a runner was launched with that it cannot take up while it runs: its
 * credential, and the integrations it was handed, as a digest. A warm
 * runner whose fingerprint no longer matches is relaunched rather than
 * handed the next message (`sendHolding`). The digest is one-way and
 * truncated, so the record carries nothing of the credential. Note that a
 * credential held at the firewall is read by its slot and its real value,
 * never its placeholder, which every launch mints afresh; and that a launch
 * holding none digests what it did before any was held.
 */
function launchFingerprint(
  credential: HarnessLaunch,
  integrations: readonly IntegrationServer[],
): string {
  const env = Object.entries(credential.env).sort(([one], [other]) => one.localeCompare(other));
  const names = integrations.map((each) => each.name).sort();
  const { held } = credential;
  const swapped =
    held === undefined
      ? undefined
      : {
          slot: held.slot,
          credential: held.fingerprint === undefined ? undefined : Redacted.value(held.fingerprint),
        };
  return createHash("sha256")
    .update(JSON.stringify({ env, names, held: swapped }))
    .digest("hex")
    .slice(0, FINGERPRINT_CHARS);
}

/**
 * Whether the agent's turn ended longer ago than the warm window of the
 * machine given (`CODER.RUNNER_WARM`), so we have closed or are closing it,
 * and the runner may soon end itself at its own idle cap. Never where the
 * window is zero, whose runner is launched to end at its turn's end. An
 * ended turn with no settle time stamped reads as ended long ago, as the
 * sweep reads it.
 */
function pastWarmWindow(
  machine: AgentMachineKind,
  turn: AgentLatestTurn | undefined,
  now: number,
): boolean {
  const window = CODER.RUNNER_WARM[machine];
  if (Duration.isZero(window) || turn === undefined) return false;
  if (RUNNING_TURN_STATUSES.has(turn.status)) return false;
  return turn.settledAt === null || now - turn.settledAt.getTime() > Duration.toMillis(window);
}

/** The place a runner's handle names, without the runner. */
function placeOfHandle(handle: RunnerHandle): MachinePlace {
  return { machine: handle.machine, session: handle.session, running: handle.running };
}

/** Where a found place's record is kept, under the agent given. */
function recordOf(found: FoundPlace, agentId: string) {
  return { machine: found.machine, session: found.session, name: found.name, agentId };
}

/** How a message reached its runner, as the handoff counts it. */
type HandoffPath = (typeof SERVER_HANDOFF_PATH)[keyof typeof SERVER_HANDOFF_PATH];

/** A resume past an answer tried again while its sandbox is still stopping or being snapshotted (`CODER.RESUME_WHILE_ENDING`). */
const RESUME_WHILE_ENDING = {
  schedule: Schedule.spaced(CODER.RESUME_WHILE_ENDING.SPACING),
  times: CODER.RESUME_WHILE_ENDING.TRIES,
  while: sessionEnding,
};

/** The place found first under the session: the newest, which is listed first (`findPlaces`). */
function firstPlace(machine: MachineLifecycle, sessionId: string) {
  return Effect.map(machine.findPlaces(sessionId), (places) => Option.fromNullishOr(places[0]));
}

/**
 * The runner the found place records, where it is up in the session that
 * runner was started in, and that runner has not exited. Only an exit read,
 * or a command no longer known, says the runner is down; the machine not
 * answering fails the call, so a passing outage neither relaunches a runner
 * beside one still running nor drops a Stop. The exit is waited for at most
 * `within`, the machine's own wait where none is given, which a live runner
 * costs whole.
 */
function liveRunner(
  machine: MachineLifecycle,
  found: FoundPlace,
  within?: Duration.Duration,
): Effect.Effect<RecordedRunner | undefined, SandboxUnavailable> {
  const runner = found.runner;
  if (runner === undefined) return Effect.succeed(undefined);
  return machine
    .runnerExit(runner.handle, within)
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
    : machine.writeLine(runner.handle, stdinText(lines));
}

/**
 * Whether a Stop's line was written to the runner since its launch, as
 * `deliveredTo` wrote it, which the runner ends on whether or not its turn
 * still runs: at once with no turn under way, and as `RUNNER_END.STOPPED`
 * once the turn it interrupts ends. Read under the agent's runner lease, which every
 * Stop holds while it writes, so a Stop written ahead of the caller is seen.
 * False on a machine that keeps nothing of what it wrote (`wrote`).
 */
function stopWritten(machine: MachineLifecycle, runner: RecordedRunner) {
  return machine.wrote(runner.handle, stdinText([stopLine(runner.mark.firstSequence)]));
}

/** The status a failure answers as. */
function failedStatus(failure: { readonly _tag: string }): number {
  if (failure instanceof LaunchRefused) {
    return failure.planRefusal === PLAN_REFUSAL.UNREACHABLE
      ? FAILED_STATUS.UNAVAILABLE
      : FAILED_STATUS.REFUSED;
  }
  if (failure instanceof AgentImageMissing) return FAILED_STATUS.REFUSED;
  return failure instanceof SandboxUnavailable
    ? (failure.status ?? FAILED_STATUS.UNAVAILABLE)
    : FAILED_STATUS.UNAVAILABLE;
}

/** A launch past its Start's answer that died, or was interrupted, rather than failing: what ended it, by its kind alone. */
class LaunchCut extends Data.TaggedError("LaunchCut")<{
  readonly kind: string;
  readonly interrupted: boolean;
}> {}

/** A launch's cause past its Start's answer as the failure it is written as: the failure where one failed it, else what cut it off. */
function launchFailureOf(cause: Cause.Cause<{ readonly _tag: string }>): { readonly _tag: string } {
  return Option.getOrElse(
    Cause.findErrorOption(cause),
    () => new LaunchCut({ kind: causeKind(cause), interrupted: Cause.hasInterruptsOnly(cause) }),
  );
}

/**
 * A failure in the words a line and a turn's record keep: a refusal's
 * reason, with what the sandbox's run threw where it threw; a sandbox's own
 * words (Vercel's call, its status, and its error's code and message); what
 * cut a launch off; and the kind alone for any other.
 */
function failureWords(failure: { readonly _tag: string }): string {
  if (failure instanceof LaunchRefused) return failure.reason;
  if (failure instanceof CheckoutRefused) {
    return failure.detail === undefined ? failure.reason : `${failure.reason} ${failure.detail}`;
  }
  if (failure instanceof LaunchCut) {
    return failure.interrupted ? "the launch was interrupted" : `the launch died: ${failure.kind}`;
  }
  return failure instanceof SandboxUnavailable ? failure.message : failureKind(failure);
}

/** The failure's kind, as its line's `reason` annotation and its report name it. */
function kindOf(failure: { readonly _tag: string }): string {
  return failure instanceof LaunchCut ? failure.kind : failureKind(failure);
}

/**
 * Whether a failure is a named outcome the developer is told as such, which
 * is logged and never reported: the account's plan or key refused, its
 * device removed or away, or the repository its workspace no longer reaches.
 */
function namedOutcome(failure: { readonly _tag: string }): boolean {
  if (failure instanceof CheckoutRefused) return failure.reason === CODER_REFUSAL.NOT_REACHABLE;
  return (
    failure instanceof LaunchRefused &&
    (failure.planRefusal !== undefined ||
      failure.keyRefusal !== undefined ||
      failure.deviceRemoved === true ||
      failure.deviceAway === true)
  );
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
    const serviceHost = new URL(options.eventsUrl).hostname;

    /** The agent whose conversation the message is for. */
    const agentOf = (conversationId: string) =>
      Effect.flatMap(readAgentOfConversation(userId, conversationId), (agent) =>
        Option.isSome(agent)
          ? Effect.succeed(agent.value)
          : Effect.fail(new LaunchRefused({ reason: "no agent" })),
      );

    /** Whether the agent a place names is one the account reaches. */
    const ownsPlace = (found: FoundPlace) =>
      found.agentId === undefined
        ? Effect.succeed(false)
        : Effect.map(readAgent(userId, found.agentId), Option.isSome);

    /** Where the repositories the agent works in beside its own are checked out, which its launch marks as it marks its own checkout; none for an agent in one repository or none. */
    const extraCheckoutsOf = (agent: Agent) =>
      hasRepository(agent)
        ? Effect.map(readAgentRepositories(userId, agent.id), ([, ...extras]) =>
            extraCheckoutPaths(extras.map((extra) => extra.repository)),
          )
        : Effect.succeed([]);

    /** The repository's credential set at the running place's firewall again, minted afresh; an agent with no repository has none. */
    const renewCredential = (target: ConversationTarget, agent: Agent, place: MachinePlace) =>
      Effect.gen(function* () {
        if (!hasRepository(agent)) return;
        const minted = yield* agentRepositoryToken(target, agent);
        const entry = githubEntry({
          token: minted.token,
          fullName: minted.fullName,
          access: minted.access,
        });
        yield* machine.firewall.set(place, agent.userId, FIREWALL_SLOT.GITHUB, entry);
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
            `The installed skills of a ${harness.name} agent were not written: ${keptFailureWords(failureWords(failure))}`,
          ),
        ),
      );

    /**
     * One launch of the runner in the running place: a fresh bearer
     * recorded, the launch's record written, its config read, and the caller's
     * own steps (`alongside`) run, and the bearer's swap set at the place's
     * firewall where its machine holds it there (`heldBearer`), all at once
     * beside the machine's own, since none waits on another and the runner
     * waits on them all; then the runner
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
      agent: Agent,
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
        const runnerBearer = heldBearer(bearer, agent, serviceHost);
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
                // Note that a runner stays warm past the agent's turn only on a machine with a warm
                // window (`CODER.RUNNER_WARM`), for its sweep to retire; a sandbox's ends at its turn's end.
                const warm = !Duration.isZero(CODER.RUNNER_WARM[place.running.machine]);
                return {
                  config: {
                    ...config,
                    ...(layout.linesRead ? { linesUrl: options.linesUrl } : undefined),
                    ...(warm ? { warm } : undefined),
                  },
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
            recordAgentRunnerToken(userId, agent.id, runnerTokenDigest(bearer)),
            // The held credential's swap and the bearer's stand before the runner starts, so its
            // first request carries the real value: the machine starts the runner once every step
            // here, each firewall write's settle included, is done. Note that a post refused for
            // want of its bearer is refused for good.
            credential.held === undefined
              ? Effect.void
              : machine.firewall.set(
                  place.running,
                  agent.userId,
                  credential.held.slot,
                  credential.held.entry,
                ),
            runnerBearer.swap === undefined
              ? Effect.void
              : machine.firewall.set(
                  place.running,
                  agent.userId,
                  FIREWALL_SLOT.RUNNER,
                  runnerBearer.swap,
                ),
            alongside,
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.map(([made]) => made));
        const {
          handle,
          ready: { firstSequence, rewind, opening },
        } = yield* machine.launchRunner(place.running, {
          env: {
            ...credential.env,
            ...credential.held?.env,
            [RUNNER_ENV.BEARER]: runnerBearer.handed,
          },
          agentId: agent.id,
          extraCheckouts: yield* extraCheckoutsOf(agent),
          name: place.name,
          ready,
          firstLines: (made) =>
            Effect.gen(function* () {
              const mark: RunnerMark = {
                firstSequence: made.firstSequence,
                fingerprint: launchFingerprint(credential, yield* options.integrations(agent)),
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
        // message: it restores on resume what it can (`agent-wakeups.ts`), so a copy the service
        // still held would fire twice, or after the agent canceled it. A launch that failed
        // before this leaves them for the sweep to deliver.
        yield* replaceAgentWakeups(agent.id, []).pipe(
          Effect.catch((failure) =>
            Effect.logWarning(
              `a relaunched agent's wakeups were not handed back: ${failureKind(failure)}`,
            ),
          ),
        );
      });

    /** Lines queued for the agent's runner to read, written for the launch named (`queuedFor`). */
    const queued = (agent: Agent, launch: number, lines: readonly InputLine[]) =>
      queuedFor(userId, agent.id, launch, lines);

    /** Lines handed to the runner a place records, as it takes them (`deliveredTo`). */
    const delivered = (agent: Agent, runner: RecordedRunner, lines: readonly InputLine[]) =>
      deliveredTo(machine, userId, agent.id, runner, lines);

    /** The message as a line, under our id for it where the caller named one, and the files it names, where the machine's layout keeps them. */
    const messageLine = (message: EveMessage<Turn>, layout: MachineLayout): RunnerMessage => {
      const uuid = message.lineId ?? randomUUID();
      const { content, files } = runnerContent(
        message.message,
        harness.name,
        uuid,
        layout.attachments,
      );
      return {
        line: { type: INPUT_LINE.MESSAGE, uuid, content },
        files,
        turn: message.turn,
        timeZone: message.timeZone,
      };
    };

    /**
     * The message line with the turn's own words ahead of the developer's
     * (`turn-message.ts`), composed on what the harness's session has handed
     * (`native_handed`): nothing yet for a fresh session, whose history
     * holds none of it, and what the row keeps otherwise.
     */
    const openedLine = (
      agent: Agent,
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
        const opened = yield* coderTurnMessage(admitted, agent, turn, handed, now);
        const { content } = sent.line;
        const ahead: readonly ContentBlock[] =
          opened.text === undefined ? [] : [{ type: "text", text: opened.text }];
        const taken = recordNativeTurnHanded(target, opened.handed);
        return { line: { ...sent.line, content: [...ahead, ...content] }, taken };
      });

    /** The files a message names written into the running place, before its line names them. */
    const filesWritten = (place: MachinePlace, message: RunnerMessage) =>
      message.files.length === 0 ? Effect.void : machine.writeFiles(place, message.files);

    /**
     * A failure as the log says it and the caller reads it, in its own words
     * (`failureWords`): said once as an error, since the caller refuses what
     * was asked, and reported where no named refusal explains it
     * (`agentFailureSaid`).
     */
    const failed = (call: string) => (failure: { readonly _tag: string }) =>
      Effect.as(
        agentFailureSaid(
          `A ${harness.name} ${call} failed: ${keptFailureWords(failureWords(failure))}`,
          kindOf(failure),
          !namedOutcome(failure),
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
        Effect.logWarning(
          `A ${harness.name} ${call} failed: ${keptFailureWords(failureWords(failure))}`,
        ),
        {
          outcome: "failed" as const,
          status: failedStatus(failure),
        },
      );

    /**
     * A new place opened under the session given on the agent's machine, the
     * agent's repository checked out in it, then at once its deepen
     * (`deepenCheckoutWith`, the machine's `finishCheckout`): the
     * write token at the firewall and the commit identity, since the
     * harness's own shell has no hook for a first write; and the runner
     * launched on the first line. The member's installed skills are read
     * beside the opening, and the deepen and the skills' upload run beside
     * the launch's own uploads. A place whose launch failed is thrown away
     * again by the machine, since no conversation records the session that
     * would find it. `sandboxOpened` runs once the place stands, before the
     * launch.
     */
    const openedPlace = (
      agent: Agent,
      sessionId: string,
      layout: MachineLayout,
      first: RunnerMessage | undefined,
      credential: HarnessLaunch,
      queuedFirst?: OpenedLine,
      sandboxOpened: Effect.Effect<void> = Effect.void,
    ) =>
      Effect.gen(function* () {
        const target: ConversationTarget = { userId, conversationId: agent.conversationId };
        yield* machine.open(
          {
            session: sessionId,
            target,
            agent,
            harness: harness.name,
            beside: Effect.map(nativeSkills(target, agent, harness.skillRoots), (skills) =>
              nativeSkillFiles(skills, layout.skillsUpload),
            ),
          },
          (opened, skills) =>
            Effect.andThen(
              Effect.andThen(
                Effect.logInfo(`A ${harness.name} launch opened its sandbox`),
                sandboxOpened,
              ),
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
            ).pipe(Effect.annotateLogs(runningLogId(opened.place.running))),
        );
      });

    /** The runner launched again in the running place given, its credential set afresh and the harness's session resumed; with no message of its own where it only hands on the lines an earlier launch never took. */
    const relaunched = (
      agent: Agent,
      sessionId: string,
      name: MachineName,
      running: MachinePlace,
      layout: MachineLayout,
      sent: RunnerMessage | undefined,
    ) =>
      Effect.gen(function* () {
        const target = { userId, conversationId: agent.conversationId };
        // Note that a repository added beside the agent's own while its place stood is cloned here, which its launch then shares.
        const [, , routing, credential] = yield* Effect.all(
          [
            renewCredential(target, agent, running),
            machine.checkOutExtras(running, target, agent, false),
            readAgentRouting(userId, agent.id),
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
    const staleWarm = (agent: Agent, runner: RunnerMark, turnRunning: boolean) =>
      Effect.gen(function* () {
        if (runner.fingerprint === undefined || turnRunning) return false;
        const credential = yield* harness.launch(agent);
        const now = launchFingerprint(credential, yield* options.integrations(agent));
        return now !== runner.fingerprint;
      });

    /**
     * A message to the session, under the agent's runner lease: the place and
     * the agent read afresh, since a call the lease waited behind may have
     * relaunched. `handsOn` says whether a runner that must be resumed or
     * launched again is left to the hand-on past the answer (`handedOnAfter`),
     * the message queued for the launch it starts.
     */
    const sendHolding = (
      sessionId: string,
      message: EveMessage<Turn>,
      layout: MachineLayout,
      sent: RunnerMessage,
      handsOn: boolean,
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
        const handed = (path: HandoffPath) =>
          recordServerEvent(
            SERVER_EVENT.AGENT_HANDOFF,
            { userId, workspaceId: agent.organizationId },
            {
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
            },
          );
        const running = found.value.runner;
        if (running !== undefined) {
          const runnerPlace = placeOfHandle(running.handle);
          // A runner that would not take the message as it should is ended, and the message
          // relaunches it: one warm past its machine's window, which may end itself at its idle cap
          // as the line lands; one a Stop was written to since its launch, which ends on it; and a
          // warm one launched with what has changed since. Note that the first two hold whether
          // or not the sweep or the IDLE's retire ran, since a Mac drops a line once its runner
          // has gone, so a line written to a runner on its way down is lost.
          if (
            pastWarmWindow(found.value.machine, turn, handedAt) ||
            (yield* stopWritten(machine, running)) ||
            (yield* staleWarm(agent, running.mark, turnRunning))
          ) {
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
          // Note that a runner that reads its lines, as a sandbox's does, is queued them only where
          // its exit read none, and one that ends before it takes them hands them to the launch its
          // END starts (`deliverWaiting`). A write to a Mac's runner is its own liveness check: one
          // whose launch line its Mac settled answers `NOT_FOUND_STATUS`, which relaunches below.
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
            yield* Effect.gen(function* () {
              const renewed = yield* renewCredential(target, agent, runnerPlace).pipe(
                Effect.timeoutOption(CODER.CREDENTIAL_RENEWAL),
                Effect.catch((failure) =>
                  Effect.as(
                    Effect.logWarning(
                      `A ${harness.name} runner's credential was not renewed: ${keptFailureWords(failureWords(failure))}`,
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
            }).pipe(Effect.annotateLogs(runningLogId(runnerPlace.running)));
            yield* handed(SERVER_HANDOFF_PATH.WARM);
            return accepted;
          }
        }
        // The place stopped or the runner ended: resumed, its credential set again, and the runner relaunched on the harness's session.
        const wasUp = found.value.running !== undefined;
        if (handsOn) {
          // Note that the request answers once the message is queued, the turn's words ahead of it
          // composed on whether the harness's session resumes, and the resume and the launch that
          // reads it run past the answer, so a resume that waits out a stop's snapshot never holds
          // the send past the store's dispatch deadline. Its words count as handed once queued, as
          // a warm runner's do, since whichever launch runs next reads the line.
          const routing = yield* readAgentRouting(userId, agent.id);
          const fresh = Option.isNone(
            Option.flatMapNullishOr(routing, (read) => read.nativeSession),
          );
          const opened = yield* openedLine(agent, sessionId, sent, fresh);
          yield* queued(agent, ANY_LAUNCH, [opened.line]);
          yield* opened.taken;
          yield* handedOnAfter(sessionId, agent, sent.line.uuid, handed);
          return accepted;
        }
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
          // session's tag. The harness's own session files went with the old filesystem, so none is
          // resumed. The expired sandbox is deleted only once the fresh one runs, so a launch
          // that fails (a clone refused, say) leaves the session standing
          // for the next message to try again rather than retired; a delete that fails leaves
          // the expired one beside the fresh one, which `listTagged` lists after it as the older.
          yield* openedPlace(agent, sessionId, layout, sent, yield* harness.launch(agent));
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
    const cancelHolding = (sessionId: string, turnId: string, agent: Agent) =>
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
        // Note that its exit is read at most `CODER.RUNNER_EXIT_READ`, as a message reads it, so a Stop never waits out a live runner's exit.
        const live = yield* liveRunner(machine, found.value, CODER.RUNNER_EXIT_READ);
        if (live === undefined) return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED } as const;
        yield* delivered(agent, live, [stopLine(live.mark.firstSequence)]).pipe(
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
     * launch the line went to ended, and is settled canceled as a turn whose
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
      agent: Agent,
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
              yield* recordAgentRunnerToken(userId, agent.id, null);
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
        yield* delivered(agent, live, [stopLine(live.mark.firstSequence)]);
        // Note that a read of the exit answers null for a command still running once its own wait is up.
        const exited = machine.runnerExit(handle).pipe(Effect.timeoutOption(CODER.RUNNER_HALT));
        const stopped = yield* exited;
        if (Option.isNone(stopped) || stopped.value === null) {
          yield* machine.kill(handle);
          yield* exited;
        }
        yield* recordAgentRunnerToken(userId, agent.id, null);
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
     * A repository added beside the agent's own handed to the place it runs
     * in now, under the agent's runner lease: the credential set afresh for
     * the whole set, and every extra the place does not hold cloned and
     * shared with the runner's user (`checkOutExtras`). Nothing where no place
     * runs, since the next launch clones it, a fresh place's with the rest
     * and a resumed one's as it relaunches (`relaunched`).
     */
    const checkOutHolding = (sessionId: string, conversationId: string) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, sessionId);
        if (Option.isNone(found)) return RUNNER_CHECKOUT.NOT_LIVE;
        const agent = yield* agentOf(conversationId);
        const running = found.value.running;
        if (found.value.agentId !== agent.id || running === undefined) {
          return RUNNER_CHECKOUT.NOT_LIVE;
        }
        const target = { userId, conversationId: agent.conversationId };
        yield* renewCredential(target, agent, running);
        yield* machine.checkOutExtras(running, target, agent, true);
        return RUNNER_CHECKOUT.CHECKED_OUT;
      });

    /**
     * The lines an earlier launch never took handed on, under the agent's
     * runner lease: where a message line no launch took was queued no longer
     * ago than a line reads as awaiting its turn (`CODER.LINE_GRACE`), and no
     * runner runs to read it, the place is resumed, or a fresh one opened
     * where its disk is gone, and the runner launched on the harness's session
     * with no message of its own, which reads them. A resume that meets the
     * sandbox still stopping or being snapshotted waits it out
     * (`RESUME_WHILE_ENDING`), since this runs past an answer. Nothing on a
     * machine whose runner takes its lines on stdin, which queues none.
     * Answers how the launch reached its runner, or none where no runner was
     * launched.
     */
    const deliverWaitingHolding = (sessionId: string, agent: Agent) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, sessionId);
        if (Option.isNone(found) || found.value.agentId !== agent.id) return undefined;
        if (!(yield* linesWaitAt(userId, agent.id))) return undefined;
        if ((yield* liveRunner(machine, found.value)) !== undefined) return undefined;
        const layout = yield* machine.layout(agent);
        if (!layout.linesRead) return undefined;
        const wasUp = found.value.running !== undefined;
        const resumed = yield* Effect.gen(function* () {
          const place = yield* machine.resume(found.value);
          if (place === PLACE_RESUME.GONE) return place;
          yield* relaunched(agent, sessionId, found.value.name, place, layout, undefined);
          return place;
        }).pipe(Effect.retry(RESUME_WHILE_ENDING));
        if (resumed === PLACE_RESUME.GONE) {
          yield* openedPlace(agent, sessionId, layout, undefined, yield* harness.launch(agent));
          yield* Effect.ignore(machine.discard(found.value));
          return SERVER_HANDOFF_PATH.FRESH;
        }
        return wasUp ? SERVER_HANDOFF_PATH.RELAUNCHED : SERVER_HANDOFF_PATH.RESUMED;
      });

    /**
     * A launch that failed past its Start's answer, or died or was
     * interrupted there: said once as an error with the agent's ids and why,
     * and reported where no named refusal explains it (`agentFailureSaid`);
     * then written as the agent's first turn, queued and settled failed as a
     * turn whose runner was lost is (`settleRunnerLostTurns`), with why, so
     * the agent reads failed at once rather than starting until its grace
     * runs out. The line the Start wrote stands. A write that fails is logged.
     */
    const launchFailed =
      (agent: Agent, sessionId: string) => (failure: { readonly _tag: string }) =>
        Effect.gen(function* () {
          const words = keptFailureWords(failureWords(failure));
          // The turn's failure is the one `settleRunnerLostTurns` writes below.
          yield* agentFailureSaid(
            `A ${harness.name} launch failed after its Start: ${words}`,
            kindOf(failure),
            !namedOutcome(failure),
            TURN_FAILURE.MODEL,
          );
          const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
          const turnId = randomUUID();
          yield* writer.enqueueTurn(
            { userId, conversationId: agent.conversationId },
            { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
          );
          // The checkout's own sentence names GitHub or the sandbox (`status.ts`'s `FAILURE_WORDS`);
          // any other failure, a missing snapshot among them, reads as the sandbox's, with its reason,
          // and a sandbox's failure with Vercel's own answer after the sentence the status reads it by.
          const detail =
            failure instanceof CheckoutRefused
              ? words
              : failure instanceof LaunchRefused
                ? `${REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE}: ${failure.reason}`
                : `${REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE} ${words}`;
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
          Effect.annotateLogs(agentLogIds(agent, sessionId)),
        );

    /**
     * The launch a Start's open hands on past its answer, under the agent's
     * runner lease, each step said in the log as it is reached (begun, its
     * sandbox opened, its runner started), so a launch cut off where nothing
     * can say so, its function frozen or ended under it, is known by the last
     * step it reached. One that fails or dies takes its first message back
     * and is written as the agent's failed turn (`launchFailed`), and so is
     * one interrupted before its sandbox opened, in a finalizer the
     * interruption cannot cut short. Note that one interrupted once its
     * sandbox opened is said and reported alone, its first message and its
     * turns left as they stand, because its runner may already have started
     * and taken the message, and a failed turn would be written over its work.
     */
    const launchedAfterStart = <R>(
      agent: Agent,
      sessionId: string,
      launching: (
        sandboxOpened: Effect.Effect<void>,
      ) => Effect.Effect<void, { readonly _tag: string }, R>,
      withdrawn: Effect.Effect<void, never, DatabaseServices>,
    ) =>
      Effect.gen(function* () {
        const opened = yield* Ref.make(false);
        const failedWith = (cause: Cause.Cause<{ readonly _tag: string }>) =>
          Effect.andThen(withdrawn, launchFailed(agent, sessionId)(launchFailureOf(cause)));
        const interrupted = Effect.flatMap(Ref.get(opened), (up) =>
          up
            ? agentFailureSaid(
                `A ${harness.name} launch was interrupted after its sandbox opened, so its runner may run`,
                causeKind(Cause.interrupt()),
                true,
              )
            : failedWith(Cause.interrupt()),
        );
        return yield* Effect.gen(function* () {
          yield* Effect.logInfo(`A ${harness.name} launch began after its Start`);
          yield* holdingRunner(agent.id, launching(Ref.set(opened, true)));
          yield* Effect.logInfo(`A ${harness.name} launch started its runner`);
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : failedWith(cause),
          ),
          Effect.onInterrupt(() => interrupted),
        );
      }).pipe(Effect.annotateLogs(agentLogIds(agent, sessionId)));

    /**
     * A queued message handed on, under the lease: by `deliverWaitingHolding`,
     * where the session's place is the agent's, how it reached its runner
     * counted where `handed` is given, as warm where a runner already up, or
     * one another call launched, reads it; taken back where no place stands
     * for the session by then, said in the log, so no line waits that no
     * launch will read.
     */
    const handedOn = (
      sessionId: string,
      agent: Agent,
      lineId: string,
      handed: ((path: HandoffPath) => Effect.Effect<void>) | undefined,
    ) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, sessionId);
        if (Option.isSome(found) && found.value.agentId === agent.id) {
          const path = yield* deliverWaitingHolding(sessionId, agent);
          if (handed !== undefined) yield* handed(path ?? SERVER_HANDOFF_PATH.WARM);
          return;
        }
        yield* Effect.logWarning(
          `A ${harness.name} message queued behind another call found its session ended`,
        );
        yield* withdrawRunnerLine(userId, agent.id, lineId);
      });

    /**
     * A queued message's hand-on (`handedOn`) run past the answer, under the
     * lease, waiting on it as long as a lease can stand, so it outlasts a
     * launch it is behind. Note that a hand-on that fails is only
     * logged, and its line read as failed once it has waited past
     * `CODER.LINE_GRACE`, which offers Continue.
     */
    const handedOnAfter = (
      sessionId: string,
      agent: Agent,
      lineId: string,
      handed?: (path: HandoffPath) => Effect.Effect<void>,
    ) =>
      afterResponse(
        `A ${harness.name} hand-on`,
        holdingRunner(
          agent.id,
          handedOn(sessionId, agent, lineId, handed),
          CODER.RUNNER_LEASE.HOLD,
        ),
      );

    /**
     * A message to the session for the agent its conversation is, as `send`
     * hands it on: held behind the agent's runner lease, or queued at once
     * where the lease is another call's, as `send` says. `answersFirst` says
     * whether work may run past the request's answer.
     */
    const sentTo = (
      agent: Agent,
      sessionId: string,
      message: EveMessage<Turn>,
      answersFirst: boolean,
    ) =>
      Effect.gen(function* () {
        const layout = yield* machine.layout(agent);
        const sent = messageLine(message, layout);
        const queues = layout.linesRead && sent.files.length === 0 && answersFirst;
        const handed = yield* queues
          ? holdingRunnerIfFree(agent.id, sendHolding(sessionId, message, layout, sent, true))
          : Effect.map(
              holdingRunner(agent.id, sendHolding(sessionId, message, layout, sent, false)),
              Option.some,
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
        // the message, and go ahead of it for a recorded runner's launch; with none recorded, the
        // message alone is queued for whichever launch runs. Note that the credential is not renewed
        // here, because the lease is another call's; it lives an hour, and the next message renews it.
        // The turn's own words (`openedLine`) go ahead of the next message instead, since they are
        // marked handed only once a runner took them. Its hand-on waits as long as a lease can stand, so it outlasts the launch it is behind.
        const ahead = yield* harness.ahead(agent);
        const recorded = Option.isSome(found) ? found.value.runner : undefined;
        yield* recorded === undefined
          ? queued(agent, ANY_LAUNCH, [sent.line])
          : queued(agent, recorded.mark.firstSequence, [...ahead.lines, sent.line]);
        yield* handedOnAfter(sessionId, agent, sent.line.uuid);
        return {
          outcome: EVE_SEND_OUTCOME.ACCEPTED,
          sessionId,
          deliveryId: sent.line.uuid,
        } as const;
      });

    const sessions: NativeSessions<Turn> = {
      // An open answers once the plan's credential is read, so a plan refused or at its limit is
      // refused at once; the sandbox, the checkout, and the launch run past the answer of the
      // request that asked (`after-response.ts`), under the runner lease. On a machine whose runner
      // reads its lines, the first message is queued before the answer, so no message sent after it
      // can be read ahead of it; the launch's own queue of it finds it queued under its id, and a
      // message sent meanwhile is queued behind it.
      open: (message) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const agent = yield* agentOf(message.conversationId);
            const sessionId = sessionIdOf(harness.sessionPrefix, yield* Clock.currentTimeMillis);
            return yield* Effect.gen(function* () {
              const credential = yield* harness.launch(agent);
              const layout = yield* machine.layout(agent);
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
              yield* afterResponse(
                `A ${harness.name} launch`,
                launchedAfterStart(
                  agent,
                  sessionId,
                  (sandboxOpened) =>
                    openedPlace(agent, sessionId, layout, first, credential, opened, sandboxOpened),
                  withdrawn,
                ),
              ).pipe(Effect.onError(() => withdrawn));
              return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId } as const;
            }).pipe(
              Effect.catch(failed("open")),
              Effect.annotateLogs(agentLogIds(agent, sessionId)),
            );
          }).pipe(
            Effect.catch(failed("open")),
            Effect.annotateLogs(agentLogIds({ conversationId: message.conversationId })),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      // A message to a runner that reads its lines never waits behind another call's lease, as a
      // Start's launch holds it while its sandbox comes up: it is queued at once, read by the runner
      // that call leaves running, and handed on past the answer where none does (`deliverWaiting`).
      // One that finds no runner up is queued too, and its sandbox resumed and its runner launched
      // past the answer (`handedOnAfter`), so the send answers once its line is written. Note that
      // one naming files still waits on the lease, and resumes in the request, since they are
      // written into a running place before its line names them, which a launch another message's
      // hand-on started could read first.
      send: (sessionId, message) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const agent = yield* agentOf(message.conversationId);
            return yield* sentTo(agent, sessionId, message, Option.isSome(after)).pipe(
              Effect.catch(failed("send")),
              Effect.annotateLogs(agentLogIds(agent, sessionId)),
            );
          }).pipe(
            Effect.catch(failed("send")),
            Effect.annotateLogs(agentLogIds({ conversationId: message.conversationId }, sessionId)),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      // The Stop is scoped to the turn it names: written only while that turn is the
      // conversation's turn under way, to the command of the launch running it, and naming that
      // launch, so a Stop delayed past its turn never interrupts the next launch's. A Stop taken
      // is forced past the answer (`forcedStop`), its wait run there rather than holding the
      // request; a caller with no after-response door leaves an unconfirmed Stop to the sweep.
      cancel: (sessionId, turnId) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const found = yield* firstPlace(machine, sessionId);
            const agentId = Option.isSome(found) ? found.value.agentId : undefined;
            const agent = agentId === undefined ? Option.none() : yield* readAgent(userId, agentId);
            if (Option.isNone(agent)) {
              return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
            }
            const canceled = yield* holdingRunner(
              agent.value.id,
              cancelHolding(sessionId, turnId, agent.value),
            );
            if (canceled.outcome !== EVE_CANCEL_OUTCOME.ACCEPTED || Option.isNone(after)) {
              return { outcome: canceled.outcome } as const;
            }
            const launch = "launch" in canceled ? canceled.launch : undefined;
            yield* afterResponse(
              `A ${harness.name} Stop's force`,
              forcedStop(sessionId, turnId, agent.value, launch).pipe(
                Effect.annotateLogs(agentLogIds(agent.value, sessionId)),
              ),
            );
            return { outcome: canceled.outcome } as const;
          }).pipe(
            Effect.catch(unavailable("cancel")),
            Effect.annotateLogs(agentLogIds({}, sessionId)),
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
            // The bearer goes first, so a runner still up is refused by us before its place is gone.
            if (place.agentId !== undefined) {
              yield* recordAgentRunnerToken(userId, place.agentId, null);
            }
            yield* machine.discard(place);
          }
          // A session whose places are all another account's agents' is none of this account's to retire.
          return retired === 0
            ? ({ outcome: EVE_RESET_OUTCOME.NO_ACTIVE_SESSION } as const)
            : ({ outcome: EVE_RESET_OUTCOME.RESET } as const);
        }).pipe(
          Effect.catch(unavailable("reset")),
          Effect.annotateLogs(agentLogIds({}, sessionId)),
          Effect.provideContext(context),
        ),

      halt: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const { id } = yield* agentOf(conversationId);
          yield* holdingRunner(id, haltHolding(sessionId, conversationId));
          return true;
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} halt failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              false,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),

      // A launch's END that left a message untaken hands it on (`runnerEnded`'s `LINES_WAITING`); a
      // launch that fails here is written as the agent's failed turn, as a Start's is.
      deliverWaiting: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const agent = yield* agentOf(conversationId);
          return yield* holdingRunner(agent.id, deliverWaitingHolding(sessionId, agent)).pipe(
            Effect.map((path) => path !== undefined),
            Effect.catch((failure) => Effect.as(launchFailed(agent, sessionId)(failure), false)),
            Effect.annotateLogs(agentLogIds(agent, sessionId)),
          );
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} hand-on of waiting lines failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              false,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),

      checkOut: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const { id } = yield* agentOf(conversationId);
          return yield* holdingRunner(id, checkOutHolding(sessionId, conversationId));
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} checkout of an added repository failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              RUNNER_CHECKOUT.FAILED,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
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
              Effect.logWarning(
                `A ${harness.name} model change failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              RUNNER_CHOICE.FAILED,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
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

/** A warm runner a retire names: the session its place is found by, the agent's starter, whose account its retire line is queued under, the agent, and the machine's session the caller found the place running. */
interface WarmRunner {
  readonly sessionId: string;
  readonly userId: string;
  readonly agentId: string;
  readonly running: string;
}

/**
 * The retire `retireWarmRunner` makes, its caller holding the agent's
 * runner lease: the place read again, and the retire line written to the
 * runner it runs now, where it still runs in the session given.
 */
const retiredHolding = (machine: MachineLifecycle, retiring: WarmRunner) =>
  Effect.gen(function* () {
    if (yield* runnerMayBeAtWork(retiring.agentId, yield* DateTime.nowAsDate)) return false;
    const found = yield* firstPlace(machine, retiring.sessionId);
    if (Option.isNone(found)) return false;
    const live = yield* liveRunner(machine, found.value, CODER.RUNNER_EXIT_READ);
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
export const retireWarmRunner = Effect.fn("web/retireWarmRunner")(function* (retiring: WarmRunner) {
  const machine = yield* deploymentLifecycle;
  return yield* holdingRunner(retiring.agentId, retiredHolding(machine, retiring));
});

/**
 * A warm runner a sweep found past its machine's window retired as
 * `retireWarmRunner` retires one, in whatever session its place runs now,
 * but only where no other call holds the agent's runner lease: whether the
 * line was written, or none at once where a call holds the lease, so the
 * sweep passes the agent by until its next minute rather than waiting out
 * `CODER.RUNNER_LEASE.WAIT` behind a send. A send that holds the lease
 * either took the runner, which then reads as at work, or found it gone and
 * relaunched.
 */
export const retireWarmRunnerIfFree = Effect.fn("web/retireWarmRunnerIfFree")(function* (
  retiring: Omit<WarmRunner, "running">,
) {
  const machine = yield* deploymentLifecycle;
  const found = yield* firstPlace(machine, retiring.sessionId);
  const running = Option.getOrUndefined(found)?.running;
  if (running === undefined) return Option.some(false);
  return yield* holdingRunnerIfFree(
    retiring.agentId,
    retiredHolding(machine, { ...retiring, running: running.running }),
  );
});

/** How a launch's end left its place. */
export const RUNNER_ENDED = {
  STOPPED: "stopped",
  /** A developer's Terminal holds the place, left up with every credential taken off, for its timeout to stop. */
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
 * A launch's end, as its END event tells it, for either harness: every
 * credential taken off the firewall, then the place stopped unless a
 * developer's Terminal holds it, which leaves it to its timeout; where a
 * message waits for the launch that hands it on, the place is left up with
 * only the credentials the ended runner alone sent (`RUNNER_SLOTS`) taken
 * off; and nothing for an END older than the launch its place runs now.
 * Decided and stopped under the agent's runner lease, read again once it is
 * held, so a `send` relaunching the runner either finishes first, and its
 * newer launch makes this END stale, or starts after the stop and resumes
 * the place; a message sent meanwhile is queued and handed on once the
 * lease is let go. Fails where the machine or the store could not be asked,
 * or the lease stayed held past its wait.
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
 * A device's launch's IDLE, its runner warm past the agent's turn: the
 * runner retired at once (`retireWarmRunner`) where its device last beat
 * that it waits to switch release (`HOST_UPDATE.WAITING`), so a host waiting
 * to update goes idle as its last turn ends. It otherwise stays warm for the
 * next message, and is retired past its window by the sweep
 * (`../../maintenance/device-warm-sweep.ts`) or by a message sent past it
 * (`sendHolding`). Retiring under the runner lease is what keeps a message
 * sent at the turn's end: one a send wrote first is taken by the runner,
 * which still reads its stdin, and one sent after finds the runner no
 * longer told of and relaunches. Nothing for a sandbox's runner, which is
 * launched to end at its turn's end rather than warm, nor for an IDLE older
 * than the launch its place runs now. Answers whether the retire line was
 * written.
 */
export const runnerIdled = Effect.fn("web/runnerIdled")(function* (idle: RunnerEnding) {
  const machine = yield* deploymentLifecycle;
  const found = yield* firstPlace(machine, idle.sessionId);
  if (Option.isNone(found) || found.value.machine !== AGENT_MACHINE.DEVICE) return false;
  const { agentId, launch, running } = found.value;
  if (agentId === undefined || running === undefined) return false;
  if (launch !== undefined && idle.sequence < launch.firstSequence) return false;
  if (!(yield* deviceAgentAwaitsUpdate(idle.target.userId, agentId))) return false;
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

/** The credentials only a runner sent (`RUNNER_SLOTS`) taken off a place its end leaves up. */
const runnerSlotsWithdrawn = (machine: MachineLifecycle, running: MachinePlace, userId: string) =>
  Effect.forEach(RUNNER_SLOTS, (slot) => machine.firewall.withdraw(running, userId, slot), {
    discard: true,
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
    // Note that credentials that would not come off are said and passed over, because the launch that
    // hands the lines on sets its own in their slots, and an END that failed would hand nothing on.
    yield* runnerSlotsWithdrawn(machine, running, ending.target.userId).pipe(
      Effect.catch((failure) =>
        Effect.logWarning(
          `an ended runner's credentials stayed on a place left up for its lines: ${keptFailureWords(failureWords(failure))}`,
        ),
      ),
    );
    return RUNNER_ENDED.LINES_WAITING;
  }
  // Every credential comes off first, and a place they would not come off is left up rather than
  // stopped with them: the call fails, and the place stops at its own timeout.
  yield* machine.firewall.clear(running);
  // Read last, just before the stop, so a developer who opened a Terminal during the turn keeps the
  // place, which its timeout then stops once nothing keeps it alive.
  if (yield* sandboxHeld(ending.target.conversationId, yield* DateTime.nowAsDate)) {
    return RUNNER_ENDED.HELD;
  }
  yield* machine.stop(running);
  return RUNNER_ENDED.STOPPED;
});
