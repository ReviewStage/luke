import { randomUUID } from "node:crypto";
import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import {
  PROVIDER_KEY_UNREADABLE,
  type ProviderKeyUnreadable,
} from "@luke/database/models/provider-key-seal";
import type {
  EarlierCallLine,
  HeldVoiceAgent,
  VoiceSessionRecord,
} from "@luke/database/models/voice-session-record";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { VOICE_SEGMENT_ROLE } from "@luke/database/voice-vocabulary";
import type { Task } from "@luke/features/task-wire";
import {
  callOpeningHistory,
  decodeLivePayload,
  developerSeedItem,
  type InitialItem,
  LIVE_INPUT_BOUNDS,
  LIVE_SESSION_OUTCOME,
  liveSessionConfig,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  seedItemTokens,
  startupPrefix,
  startupTokens,
  withinStartupBound,
} from "@luke/live";
import { Effect, Option, type Schema, type Scope } from "effect";
import type { WebSocket } from "ws";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  HTTP_STATUS,
  type SessionAttachedFrame,
  type SessionAttachFrame,
  type SessionCreatedFrame,
  type SessionCreateFrame,
  sessionOpeningFrameFromWire,
  VOICE_SERVICE_FRAME,
} from "../core.js";
import type { VoiceAccounts } from "./accounts.js";
import { type AgentCallHistory, agentCallHistory } from "./agent-history.js";
import { backendToolsOf, CALL_BACKEND } from "./call-backend.js";
import { LOG_EVENT } from "./log.js";
import type { LiveUpstream } from "./openai.js";
import { frameText, type VoiceSocket } from "./socket.js";

/**
 * What a socket's first frame opens: a WebRTC session created at OpenAI from
 * the Mac's offer and attached to over a sideband, or a fresh sideband to a
 * session that stands. Every path here authorizes and spends before it
 * creates, registers what it created to the account, and answers the
 * service one `Opened`: the session behind the socket, or the reason there
 * is none. The service stands the exchange and the relay on what this
 * answers; nothing here reads a frame past the opening one.
 */

/**
 * What a signed-in device may put into its session's `input`: the API's own
 * message bound, and a per-part bound for what the device composes under
 * bounds of its own. It is admitted by shape rather than trusted: an account
 * behind a request says who is asking, not how much of a prompt this
 * service will pay OpenAI to read.
 */
const SESSIONS_INPUT_BOUNDS = {
  MESSAGES: LIVE_INPUT_BOUNDS.MESSAGES,
  CHARS: 4_096,
} as const;

/** Who an upgrade admitted: a signed-in device, with the `Authorization` value it presented, resolved once its first frame is read. */
export interface Admission {
  bearer: string;
}

/** The account a device's handshake resolved to, the agent it names and that agent's task admitted and a session counted, or the reason it is refused. */
type AdmittedAccount =
  | {
      accountId: string;
      /** The task the agent is on, read as the account holds it; none for an agent with no task. */
      task: Task | undefined;
      /** The agent the call speaks into. */
      agent: HeldVoiceAgent;
      /** OpenAI on the caller's own key, which the call runs on. */
      upstream: LiveUpstream;
    }
  | Refusal;

/** A refusal as both `Opened` and `AdmittedAccount` state one: the reason. */
interface Refusal {
  refusal: HostedApiError;
}

/** A session standing behind a socket, with the frame that says so, or the reason it is not. */
type Opened =
  | {
      sessionId: string;
      /** The account the session is billed to. */
      accountId: string;
      /** The task the call is bound to: its agent's, shown the account holds, or the one a re-attach read off the session's row; none for a call into an agent with no task. */
      taskId: string | undefined;
      /** The agent the call speaks into, as the creation named it or the row reads it back. */
      agentId: string;
      /** This connection's own name on the session's row, which a detach it writes must still match. */
      attachId: string;
      /** The store's own id for the session's row, which its avatar rows name; none where the row is another account's. */
      voiceSessionId: string | undefined;
      /** The developer's time zone as this connection's opening frame named it; none from a desktop released before it was sent. */
      timeZone: string | undefined;
      /**
       * Whether the session is already running: false for one just created
       * from a WebRTC offer, whose peer has yet to connect; true for one
       * re-attached, which spoke its start to an earlier connection.
       */
      started: boolean;
      /** The sideband the service attached to the session, open and paused. */
      sideband: WebSocket;
      answer: SessionCreatedFrame | SessionAttachedFrame;
      logEvent: typeof LOG_EVENT.SESSION_CREATED | typeof LOG_EVENT.SESSION_ATTACHED;
    }
  | Refusal;

function refused(reason: HostedApiError): Refusal {
  return { refusal: reason };
}

/**
 * What one session's own effect may fail with: the `voice_sessions` writes
 * the service makes on the session's behalf, and nothing else — every other
 * refusal is a frame the device is answered with.
 */
export type SessionFailure = QueryError | Schema.SchemaError;

export type SessionEffect<A> = Effect.Effect<A, SessionFailure, DatabaseServices | Scope.Scope>;

/**
 * The Mac's input as the session is created with it: refused past the
 * message and part bounds, and held under the API's token bound by dropping
 * its oldest conversation lines, since a device seeding under an older or
 * looser estimate than this service's is owed a session that opens on its
 * newest lines rather than OpenAI's refusal of the whole creation.
 */
function sessionsInput(frame: SessionCreateFrame): readonly InitialItem[] | undefined {
  const admitted =
    frame.input.length <= SESSIONS_INPUT_BOUNDS.MESSAGES &&
    frame.input.every((item) =>
      item.content.every((part) => part.text.length <= SESSIONS_INPUT_BOUNDS.CHARS),
    );
  return admitted ? withinStartupBound(frame.input) : undefined;
}

/** What the plan seed opens with, so the voice reads it as the service's note rather than the developer's words. */
const TASK_SEED_MARKER = "[task]";

/**
 * Whether a plan is still as it was started: nobody has written it. Note that
 * its text is no mark of that, because it starts as the account's own
 * template, which holds whatever its developer wrote into it.
 */
function taskUntouched(task: Task): boolean {
  return task.lastEdit === undefined;
}

/** What the agent's own work opens with, read the same way as the plan seed. */
const AGENT_SEED_MARKER = "[agent]";

/**
 * The agent's work as one developer message, quoted rather than replayed as
 * turns for the reason the earlier calls are: the developer's newest typed
 * messages to it, then its last turn.
 */
function agentSeedText(history: AgentCallHistory): string {
  return [
    `${AGENT_SEED_MARKER} The agent this call speaks into is already at work. Your backend is that agent: what you delegate reaches it.`,
    ...(history.typed.length === 0
      ? []
      : ["", "What the developer last typed to it, oldest first:", ...history.typed]),
    ...(history.lastTurn === undefined ? [] : ["", "Its last turn:", history.lastTurn]),
  ].join("\n");
}

/** What the history of earlier calls opens with, read the same way as the plan seed. */
const EARLIER_CALLS_MARKER = "[earlier calls]";

/**
 * The tokens the plan seed keeps however much was said on earlier calls, so
 * a long conversation never crowds the document out; the plan takes more
 * wherever the history leaves room.
 */
const TASK_SEED_FLOOR_TOKENS = 5_000;

/**
 * The task a call is about, as one developer message: its name and
 * the saved document as the developer sees it. Note that the voice otherwise
 * opens knowing no plan at all and reads its role as a new task. The first
 * line says whether the task has just been started, is under way, or is
 * under way with earlier calls about it, because a voice told every task
 * continues one opened a brand-new task by looking for the progress it was
 * told stood.
 */
function taskSeedText(task: Task, talkedAbout: boolean, agentAtWork: boolean): string {
  const assumptions = task.document.assumptions.map((assumption) => `- ${assumption.text}`);
  const standing = talkedAbout
    ? "This call continues the task below, its saved plan, and the conversation about it after them. It is not a new task."
    : agentAtWork
      ? "This call is with the agent already at work on the task below; what it has done follows the plan. It is not a new task."
      : taskUntouched(task)
        ? "This call starts the new task below. Nothing in its plan is answered yet."
        : "This call continues the task below and its saved plan. It is not a new task.";
  return [
    `${TASK_SEED_MARKER} ${standing}`,
    `Name: ${task.name}`,
    "",
    task.document.body,
    ...(assumptions.length === 0 ? [] : ["", "Assumptions:", ...assumptions]),
  ].join("\n");
}

/**
 * The note the earlier calls' transcript opens with. Note that the lines are
 * quoted inside this one developer message rather than replayed as the
 * developer's and Luke's own turns, because the history carries no
 * delegation: a voice seeded with Luke's lines as its own turns read a call
 * where every answer and the closing goodbye came with no delegation as how
 * it behaves, said "See you around" and "Sure thing" to two requests to end
 * the call, and delegated neither.
 */
const EARLIER_CALLS_NOTE = `${EARLIER_CALLS_MARKER} What was said on earlier calls, oldest first. This call picks up where the last one left off. Only the words are shown, not what was delegated to the backend, so delegate as your instructions say rather than as these lines look.`;

/** How the transcript names each speaker. */
const EARLIER_SPEAKER = {
  [VOICE_SEGMENT_ROLE.USER]: "Developer",
  [VOICE_SEGMENT_ROLE.ASSISTANT]: "Luke",
} as const satisfies Record<EarlierCallLine["role"], string>;

/** An earlier call's line as one line of the transcript: its speaker, then their words. */
function earlierLine(line: EarlierCallLine): string {
  return `${EARLIER_SPEAKER[line.role]}: ${line.text.trim()}`;
}

/**
 * The newest of the earlier lines that fit within the tokens given, oldest
 * first, each as one line of the transcript. The GPT Live guide's way to
 * continue a conversation in a new session is the saved text history at
 * startup, and the end of it is what the next words follow from, so the
 * oldest lines are the ones left out.
 */
function newestWithin(lines: readonly EarlierCallLine[], tokens: number): string[] {
  const kept: string[] = [];
  let spent = 0;
  for (const line of [...lines].reverse()) {
    if (line.text.trim().length === 0) continue;
    const text = earlierLine(line);
    const cost = startupTokens(`${text}\n`);
    if (spent + cost > tokens) {
      // Note that a newest line too long for the room is cut rather than
      // dropped, because one long stretch of talk would otherwise leave the
      // call with no history at all.
      const cut = kept.length === 0 ? startupPrefix(text, tokens) : "";
      if (cut.trim().length > 0) kept.push(cut);
      break;
    }
    kept.push(text);
    spent += cost;
  }
  return kept.reverse();
}

/**
 * The input a call is created with, under the API's bounds: the plan's seed
 * first, for an agent on a task, then, for a call into an agent that has worked, the agent's own
 * work, then what was said on its earlier calls as one quoted transcript,
 * then the device's own input, then the opening, last, so it is the newest
 * thing the session holds as it starts and Luke speaks first with no append
 * after the start. The opening's message and tokens are set aside before
 * anything optional is measured, so a long plan or a long history never
 * crowds it out; the device's input is kept whole, and the plan takes what
 * is left beside it down to `PLAN_SEED_FLOOR_TOKENS` when the history wants
 * the room, cut from its end so the name and the top of the document are
 * what a long plan keeps. The agent's work is kept whole where it fits and
 * left out where it does not, since its lines are already bounded; the
 * history takes the rest, newest lines first.
 * Nothing optional is added where there is no room, and the opening is left
 * out only where the device's input alone fills the bounds.
 */
function startupInput(
  input: readonly InitialItem[],
  task: Task | undefined,
  earlier: readonly EarlierCallLine[],
  agent: AgentCallHistory | undefined,
): readonly InitialItem[] {
  const opening = callOpeningHistory();
  const openingRoom = LIVE_INPUT_BOUNDS.TOKENS - seedItemTokens([opening]);
  if (input.length + 1 > LIVE_INPUT_BOUNDS.MESSAGES || seedItemTokens(input) > openingRoom) {
    return input;
  }
  if (input.length + 1 >= LIVE_INPUT_BOUNDS.MESSAGES) return [...input, opening];
  const agentAtWork = agent !== undefined;
  const room = openingRoom - seedItemTokens(input);
  // Note that an agent with no task has no plan to seed, so its own work and its calls take the whole room.
  const taskFloor =
    task === undefined
      ? 0
      : Math.min(
          room,
          TASK_SEED_FLOOR_TOKENS,
          startupTokens(taskSeedText(task, true, agentAtWork)),
        );
  // The plan's seed, the agent's work, and the transcript are one message each, and the plan's is kept first.
  // Note that the opening and a plan's seed, where there is a plan, are the messages counted before either.
  const fixed = input.length + (task === undefined ? 1 : 2);
  const agentItem = agent === undefined ? undefined : developerSeedItem(agentSeedText(agent));
  const agentItems =
    agentItem === undefined ||
    fixed + 1 > LIVE_INPUT_BOUNDS.MESSAGES ||
    seedItemTokens([agentItem]) > room - taskFloor
      ? []
      : [agentItem];
  const historyRoom = room - taskFloor - seedItemTokens(agentItems);
  const said =
    fixed + 1 + agentItems.length > LIVE_INPUT_BOUNDS.MESSAGES
      ? []
      : newestWithin(earlier, historyRoom - startupTokens(`${EARLIER_CALLS_NOTE}\n\n`));
  const history =
    said.length === 0 ? [] : [developerSeedItem(`${EARLIER_CALLS_NOTE}\n\n${said.join("\n")}`)];
  const seed =
    task === undefined
      ? ""
      : startupPrefix(
          taskSeedText(task, said.length > 0, agentAtWork),
          room - seedItemTokens(history) - seedItemTokens(agentItems),
        );
  const taskItems = seed.length <= TASK_SEED_MARKER.length ? [] : [developerSeedItem(seed)];
  return [...taskItems, ...agentItems, ...history, ...input, opening];
}

/**
 * How OpenAI's refusal to create or start a session is answered to the
 * device: a rate limit as the throttle it is, so a device can back off, and
 * everything else as the upstream's error, since which error is nothing a
 * device can act on and nothing this service repeats.
 */
function upstreamRefused(
  result: { outcome: typeof LIVE_SESSION_OUTCOME.HTTP_ERROR; status: number } | { outcome: string },
): Refusal {
  return refused(
    result.outcome === LIVE_SESSION_OUTCOME.HTTP_ERROR &&
      "status" in result &&
      result.status === HTTP_STATUS.TOO_MANY_REQUESTS
      ? HOSTED_API_ERROR.UPSTREAM_THROTTLED
      : HOSTED_API_ERROR.UPSTREAM_ERROR,
  );
}

export interface SessionOpenerOptions {
  readonly accounts: VoiceAccounts;
  readonly record: VoiceSessionRecord;
  /** A deployment-pinned model; `LIVE_DEFAULTS.MODEL` otherwise. */
  readonly model: string | undefined;
  /** How long a fresh socket has to send its opening frame before it is refused. */
  readonly firstFrameTimeoutMs: number;
  /**
   * OpenAI on the account's own OpenAI API key, read afresh for each opening;
   * nothing where it saved none, which refuses the call, since Luke spends no
   * key of its own on one.
   */
  readonly upstreamOf: (
    accountId: string,
  ) => Effect.Effect<
    LiveUpstream | ProviderKeyUnreadable | undefined,
    SessionFailure,
    DatabaseServices
  >;
}

export interface SessionOpener {
  /**
   * The session behind a socket's first frame: a `session.create` carrying
   * an offer, or a `session.attach`. A frame that was late, unreadable, or
   * neither shape is refused; a device gone by the time its frame was read is
   * refused the same way and answered nothing, since nothing is spent on a
   * caller who is not there.
   */
  open(admission: Admission, device: VoiceSocket): SessionEffect<Opened>;
}

export function sessionOpener(options: SessionOpenerOptions): SessionOpener {
  const { accounts, record } = options;

  /** The socket's first frame as the reader admits it, or nothing when it was late, closed, or not that shape. */
  const firstFrame = (
    device: VoiceSocket,
  ): Effect.Effect<SessionCreateFrame | SessionAttachFrame | undefined> =>
    device.next.pipe(
      Effect.map((frame) => {
        const text = Option.flatMapNullishOr(frame, frameText);
        if (Option.isNone(text)) return undefined;
        const payload = decodeLivePayload(text.value);
        return payload === undefined ? undefined : sessionOpeningFrameFromWire(payload);
      }),
      Effect.timeoutOrElse({
        duration: options.firstFrameTimeoutMs,
        orElse: () => Effect.succeed(undefined),
      }),
    );

  /** The task named as the account holds it, or the reason a call about it is refused: not held. */
  const admitTask = (
    userId: string,
    taskId: string,
  ): Effect.Effect<Task | Refusal, SessionFailure, DatabaseServices> =>
    Effect.map(record.heldTask({ userId, taskId }), (task) =>
      task === undefined ? refused(HOSTED_API_ERROR.NOT_FOUND) : task,
    );

  /**
   * A handshake as an account, in the order the refusals are cheapest: the
   * bearer resolved, a task it named read from the tasks the account holds,
   * the agent it named read from the agents the account reaches, the agent's
   * own task where it named none, and only then a session counted. The call
   * is keyed by its agent: a frame that names no task is a call into the
   * agent on its own task, or on none where it has none, as an automation's
   * run starts one. A task the account does not hold is refused before the
   * count, so a claim on someone else's task counts nothing and creates
   * nothing. An agent is refused as not found
   * where the account does not reach it, where it works on another task than
   * the one named, or where it is archived and so takes nothing; an agent on
   * a native harness (Claude Code or Codex) is refused by name, since a call
   * runs on eve alone; a teammate's agent the account reaches takes the
   * call, which runs on its starter's key as its every turn does. The call's
   * voice runs on the caller's own OpenAI key, and an account that saved none
   * is refused as missing one, last before the count.
   */
  const admitAccount = (
    admission: Admission,
    taskId: string | undefined,
    agentId: string,
  ): Effect.Effect<AdmittedAccount, SessionFailure, DatabaseServices> =>
    Effect.gen(function* () {
      const account = yield* accounts.resolveUserId(admission.bearer);
      if (Option.isNone(account)) return refused(HOSTED_API_ERROR.INVALID_TOKEN);
      const accountId = account.value;
      const named = taskId === undefined ? undefined : yield* admitTask(accountId, taskId);
      if (named !== undefined && "refusal" in named) return named;
      const agent = yield* record.heldAgent({ userId: accountId, agentId });
      if (agent === undefined || agent.archived) return refused(HOSTED_API_ERROR.NOT_FOUND);
      if (taskId !== undefined && agent.taskId !== taskId) {
        return refused(HOSTED_API_ERROR.NOT_FOUND);
      }
      // Note that a frame naming no task still binds the call to the agent's own task, read as a named one is.
      const task =
        named ?? (agent.taskId === null ? undefined : yield* admitTask(accountId, agent.taskId));
      if (task !== undefined && "refusal" in task) return task;
      // A call runs on eve alone: an agent on a native harness is refused before anything is
      // counted, so eve never answers its conversation beside the harness that does.
      if (agent.runtime !== CONVERSATION_RUNTIME.EVE) {
        return refused(HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE);
      }
      const upstream = yield* options.upstreamOf(accountId);
      if (upstream === undefined) return refused(HOSTED_API_ERROR.OPENAI_KEY_MISSING);
      if (upstream === PROVIDER_KEY_UNREADABLE) return refused(HOSTED_API_ERROR.UNAVAILABLE);
      yield* accounts.spend(accountId);
      return { accountId, task, agent, upstream };
    });

  /**
   * The sideband as the upstream hands it over: open and paused, since no
   * consumer listens yet and a frame the session speaks before the relay and
   * the exchange register would otherwise be emitted to nobody. The service
   * resumes it once every listener stands, and what arrived meanwhile is read
   * then, in order.
   */
  const attach = (
    upstream: LiveUpstream,
    sessionId: string,
  ): Effect.Effect<WebSocket | undefined, never, Scope.Scope> =>
    Effect.catch(upstream.attach(sessionId), () => Effect.succeed(undefined));

  /** A new WebRTC session: authorized and counted, created at OpenAI, registered to its account, and attached. */
  const openCreated = (admission: Admission, frame: SessionCreateFrame): SessionEffect<Opened> =>
    Effect.gen(function* () {
      const input = sessionsInput(frame);
      if (input === undefined) return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      const account = yield* admitAccount(admission, frame.planId, frame.agentId);
      if ("refusal" in account) return account;
      const { upstream } = account;
      const { agentId } = account.agent;
      const earlier = yield* record.earlierCalls({ agentId });
      const agentHistory = yield* agentCallHistory(account.agent.conversation);
      const config = liveSessionConfig({
        model: options.model,
        voice: frame.voice,
        backendTools: backendToolsOf(CALL_BACKEND),
        input: startupInput(input, account.task, earlier, agentHistory),
        clientEvents: RENDERER_CLIENT_EVENTS,
        serverEvents: RENDERER_SERVER_EVENTS,
      });
      const created = yield* upstream.create(config, frame.sdp);
      if (created.outcome !== LIVE_SESSION_OUTCOME.SUCCEEDED) return upstreamRefused(created);
      const sessionId = created.answer.session.id;
      const attachId = randomUUID();
      // The store's id for the session's row rides the answer, so the device
      // can name its own rows.
      const taskId = account.task?.id;
      const voiceSessionId = yield* record.register({
        userId: account.accountId,
        sessionId,
        taskId,
        agentId,
        attachId,
        model: config.model,
      });
      const sideband = yield* attach(upstream, sessionId);
      if (sideband === undefined) {
        // The session stands at OpenAI with no sideband to close it: stamped,
        // so the sweep ends it on the account's key.
        yield* record.detach({ sessionId, attachId });
        return refused(HOSTED_API_ERROR.UPSTREAM_ERROR);
      }
      const answer: SessionCreatedFrame = {
        type: VOICE_SERVICE_FRAME.SESSION_CREATED,
        sessionId,
        sdpAnswer: created.answer.transport.sdp,
        ...(voiceSessionId === undefined ? undefined : { voiceSessionId }),
      };
      return {
        sessionId,
        accountId: account.accountId,
        taskId,
        agentId,
        attachId,
        voiceSessionId,
        timeZone: frame.timeZone,
        started: false,
        sideband,
        answer,
        logEvent: LOG_EVENT.SESSION_CREATED,
      };
    });

  /**
   * A fresh connection to a session that stands: the bearer's account, and
   * only when the session named was created for that very account. A session
   * this deployment never created, or another account's, is refused as the
   * bearer's own failure rather than as a hint that the id exists. The task
   * and the agent the call is bound to are read off the same row, so the
   * re-attached exchange lands in the agent the session was created for; a
   * session that names no agent takes the call back no more, nor does a call about a task's own Luke from before
   * every call named one, or one whose agent was deleted since. A row that
   * names an agent and no task is a call into an agent with no task, and is
   * taken back as it was created.
   */
  const openAttached = (admission: Admission, frame: SessionAttachFrame): SessionEffect<Opened> =>
    Effect.gen(function* () {
      const account = yield* accounts.resolveUserId(admission.bearer);
      const owned = Option.isNone(account)
        ? undefined
        : yield* record.owned({ userId: account.value, sessionId: frame.sessionId });
      if (Option.isNone(account) || owned === undefined) {
        return refused(HOSTED_API_ERROR.INVALID_TOKEN);
      }
      // A session no agent was bound to is no call this service still runs.
      if (owned.agentId === undefined) return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      const accountId = account.value;
      // Note that the session was created on this account's key, so it is re-attached on its key now:
      // one replaced in Settings since reaches the session no more, which OpenAI's hour limit then ends.
      const upstream = yield* options.upstreamOf(accountId);
      if (upstream === undefined) return refused(HOSTED_API_ERROR.OPENAI_KEY_MISSING);
      if (upstream === PROVIDER_KEY_UNREADABLE) return refused(HOSTED_API_ERROR.UNAVAILABLE);
      const sideband = yield* attach(upstream, frame.sessionId);
      if (sideband === undefined) return refused(HOSTED_API_ERROR.UPSTREAM_ERROR);
      // A connection holds the session again, so the orphan sweep leaves it be
      // and a detach the connection it replaced writes late stamps nothing.
      const attachId = randomUUID();
      yield* record.attached({ sessionId: frame.sessionId, attachId });
      const answer: SessionAttachedFrame = {
        type: VOICE_SERVICE_FRAME.SESSION_ATTACHED,
        sessionId: frame.sessionId,
      };
      return {
        sessionId: frame.sessionId,
        accountId,
        taskId: owned.taskId,
        agentId: owned.agentId,
        attachId,
        voiceSessionId: owned.voiceSessionId,
        timeZone: frame.timeZone,
        started: true,
        sideband,
        answer,
        logEvent: LOG_EVENT.SESSION_ATTACHED,
      };
    });

  return {
    open: (admission, device) =>
      Effect.gen(function* () {
        const frame = yield* firstFrame(device);
        if (frame === undefined || !(yield* device.isOpen)) {
          return refused(HOSTED_API_ERROR.INVALID_REQUEST);
        }
        return frame.type === VOICE_SERVICE_FRAME.SESSION_ATTACH
          ? yield* openAttached(admission, frame)
          : yield* openCreated(admission, frame);
      }),
  };
}
