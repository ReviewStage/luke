import { randomUUID } from "node:crypto";
import { EMPTY_PLAN_FIELDS, planBody } from "@sidecar/hosted/plan-template";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { Effect, Option, type Schema, type Scope } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
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
import { VOICE_SEGMENT_ROLE } from "../db/voice-vocabulary.js";
import {
  decodeLivePayload,
  developerSeedItem,
  type InitialItem,
  LIVE_INPUT_BOUNDS,
  LIVE_SESSION_OUTCOME,
  liveSessionConfig,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  SEED_ROLE,
  seedItemTokens,
  spokenSeedItem,
  startupPrefix,
  startupTokens,
  withinStartupBound,
} from "../live.js";
import type { VoiceAccounts } from "./accounts.js";
import { LOG_EVENT } from "./log.js";
import type { LiveUpstream } from "./openai.js";
import type { EarlierCallLine, VoiceSessionRecord } from "./session-record.js";
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
export const SESSIONS_INPUT_BOUNDS = {
  MESSAGES: LIVE_INPUT_BOUNDS.MESSAGES,
  CHARS: 4_096,
} as const;

/** Who an upgrade admitted: a signed-in device, with the `Authorization` value it presented, resolved once its first frame is read. */
export interface Admission {
  bearer: string;
}

/** The account a device's handshake resolved to, its plan admitted and a session counted, or the reason it is refused. */
type AdmittedAccount =
  | {
      accountId: string;
      /** The plan the call is about, read as the account holds it. */
      plan: Plan;
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
      /** The plan the call is bound to: the one its creation named and was shown the account holds, or the one a re-attach read off the session's row. */
      planId: string;
      /** This connection's own name on the session's row, which a detach it writes must still match. */
      attachId: string;
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
export type SessionFailure = SqlError | Schema.SchemaError;

export type SessionEffect<A> = Effect.Effect<A, SessionFailure, SqlClient.SqlClient | Scope.Scope>;

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
const PLAN_SEED_MARKER = "[plan]";

/**
 * Whether a plan is still as it was started: the untouched template, which
 * is what the store reads a never-saved body as, and no assumption.
 */
function planUntouched(plan: Plan): boolean {
  return (
    plan.document.assumptions.length === 0 &&
    plan.document.body === planBody({ name: plan.name }, EMPTY_PLAN_FIELDS)
  );
}

/** What the history of earlier calls opens with, read the same way as the plan seed. */
const EARLIER_CALLS_MARKER = "[earlier calls]";

/**
 * The tokens the plan seed keeps however much was said on earlier calls, so
 * a long conversation never crowds the document out; the plan takes more
 * wherever the history leaves room.
 */
const PLAN_SEED_FLOOR_TOKENS = 5_000;

/**
 * The plan a planning call is about, as one developer message: its name and
 * the saved document as the developer sees it. Note that the voice otherwise
 * opens knowing no plan at all and reads its role as a new task. The first
 * line says whether the plan has just been started, is under way, or is
 * under way with earlier calls about it, because a voice told every plan
 * continues one opened a brand-new plan by looking for the progress it was
 * told stood.
 */
function planSeedText(plan: Plan, talkedAbout: boolean): string {
  const assumptions = plan.document.assumptions.map((assumption) => `- ${assumption.text}`);
  const standing = talkedAbout
    ? "This call continues the saved plan below and the conversation about it after it. It is not a new plan."
    : planUntouched(plan)
      ? "This call starts the new plan below. Nothing in it is answered yet."
      : "This call continues the saved plan below. It is not a new plan.";
  return [
    `${PLAN_SEED_MARKER} ${standing}`,
    `Name: ${plan.name}`,
    "",
    plan.document.body,
    ...(assumptions.length === 0 ? [] : ["", "Assumptions:", ...assumptions]),
  ].join("\n");
}

const EARLIER_CALLS_NOTE = `${EARLIER_CALLS_MARKER} What was said on earlier calls about this plan, oldest first. This call picks up where the last one left off.`;

/** An earlier call's line as the history a session is created with: the developer's words as the user's, Luke's as the assistant's. */
function earlierItem(line: EarlierCallLine): InitialItem {
  return spokenSeedItem(
    line.role === VOICE_SEGMENT_ROLE.USER ? SEED_ROLE.USER : SEED_ROLE.ASSISTANT,
    line.text,
  );
}

/**
 * The newest of the earlier lines that fit within the tokens and messages
 * given, oldest first. The GPT Live guide's way to continue a conversation
 * in a new session is the saved text history at startup, and the end of it
 * is what the next words follow from, so the oldest lines are the ones left out.
 */
function newestWithin(
  lines: readonly EarlierCallLine[],
  tokens: number,
  messages: number,
): InitialItem[] {
  const kept: InitialItem[] = [];
  let spent = 0;
  for (const line of [...lines].reverse()) {
    if (kept.length >= messages) break;
    if (line.text.trim().length === 0) continue;
    const item = earlierItem(line);
    const cost = seedItemTokens([item]);
    if (spent + cost > tokens) {
      // Note that a newest line too long for the room is cut rather than
      // dropped, because one long stretch of talk would otherwise leave the
      // call with no history at all.
      const cut = kept.length === 0 ? startupPrefix(line.text, tokens) : "";
      if (cut.trim().length > 0) kept.push(earlierItem({ ...line, text: cut }));
      break;
    }
    kept.push(item);
    spent += cost;
  }
  return kept.reverse();
}

/**
 * The input a call is created with, under the API's bounds: the plan's seed
 * first, then what was said on its earlier calls, then the device's own
 * input. The device's input is kept whole, and the plan takes what is left
 * beside it down to `PLAN_SEED_FLOOR_TOKENS` when the history wants the
 * room, cut from its end so the name and the top of the document are what a
 * long plan keeps. The history takes the rest, newest lines first. Nothing
 * is added where there is no room.
 */
function startupInput(
  input: readonly InitialItem[],
  plan: Plan,
  earlier: readonly EarlierCallLine[],
): readonly InitialItem[] {
  if (input.length >= LIVE_INPUT_BOUNDS.MESSAGES) return input;
  const room = LIVE_INPUT_BOUNDS.TOKENS - seedItemTokens(input);
  const note = developerSeedItem(EARLIER_CALLS_NOTE);
  const planFloor = Math.min(room, PLAN_SEED_FLOOR_TOKENS, startupTokens(planSeedText(plan, true)));
  const said = newestWithin(
    earlier,
    room - planFloor - seedItemTokens([note]),
    LIVE_INPUT_BOUNDS.MESSAGES - input.length - 2,
  );
  const history = said.length === 0 ? [] : [note, ...said];
  const seed = startupPrefix(planSeedText(plan, said.length > 0), room - seedItemTokens(history));
  const planItems = seed.length <= PLAN_SEED_MARKER.length ? [] : [developerSeedItem(seed)];
  return [...planItems, ...history, ...input];
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
}

export interface SessionOpener {
  /**
   * The session behind a socket's first frame: a `session.create` carrying
   * an offer, or a `session.attach`. A frame that was late, unreadable, or
   * neither shape is refused; a device gone by the time its frame was read is
   * refused the same way and answered nothing, since nothing is spent on a
   * caller who is not there.
   */
  open(upstream: LiveUpstream, admission: Admission, device: VoiceSocket): SessionEffect<Opened>;
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

  /**
   * A handshake as an account, in the order the refusals are cheapest: the
   * bearer resolved, the plan it named read from the plans the account
   * holds, and only then a session counted. A plan the account does not hold
   * is refused before the count, so a claim on someone else's plan counts
   * nothing and creates nothing.
   */
  const admitAccount = (
    admission: Admission,
    planId: string,
  ): Effect.Effect<AdmittedAccount, SessionFailure, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const account = yield* accounts.resolveUserId(admission.bearer);
      if (Option.isNone(account)) return refused(HOSTED_API_ERROR.INVALID_TOKEN);
      const accountId = account.value;
      const plan = yield* record.heldPlan({ userId: accountId, planId });
      if (plan === undefined) return refused(HOSTED_API_ERROR.NOT_FOUND);
      yield* accounts.spend(accountId);
      return { accountId, plan };
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
  const openCreated = (
    upstream: LiveUpstream,
    admission: Admission,
    frame: SessionCreateFrame,
  ): SessionEffect<Opened> =>
    Effect.gen(function* () {
      const input = sessionsInput(frame);
      if (input === undefined) return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      const account = yield* admitAccount(admission, frame.planId);
      if ("refusal" in account) return account;
      const earlier = yield* record.earlierCalls({
        userId: account.accountId,
        planId: frame.planId,
      });
      const config = liveSessionConfig({
        model: options.model,
        voice: frame.voice,
        input: startupInput(input, account.plan, earlier),
        clientEvents: RENDERER_CLIENT_EVENTS,
        serverEvents: RENDERER_SERVER_EVENTS,
      });
      const created = yield* upstream.create(config, frame.sdp);
      if (created.outcome !== LIVE_SESSION_OUTCOME.SUCCEEDED) return upstreamRefused(created);
      const sessionId = created.answer.session.id;
      const attachId = randomUUID();
      // The store's id for the session's row rides the answer, so the device
      // can name its own rows.
      const voiceSessionId = yield* record.register({
        userId: account.accountId,
        sessionId,
        planId: frame.planId,
        attachId,
      });
      const sideband = yield* attach(upstream, sessionId);
      if (sideband === undefined) {
        // The session stands at OpenAI with no sideband to close it: stamped,
        // so the sweep ends it on Luke's key.
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
        planId: frame.planId,
        attachId,
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
   * bearer's own failure rather than as a hint that the id exists. The plan
   * the call is bound to is read off the same row, so the re-attached
   * exchange lands in the plan the session was created about.
   */
  const openAttached = (
    upstream: LiveUpstream,
    admission: Admission,
    frame: SessionAttachFrame,
  ): SessionEffect<Opened> =>
    Effect.gen(function* () {
      const account = yield* accounts.resolveUserId(admission.bearer);
      const owned = Option.isNone(account)
        ? undefined
        : yield* record.owned({ userId: account.value, sessionId: frame.sessionId });
      if (Option.isNone(account) || owned === undefined) {
        return refused(HOSTED_API_ERROR.INVALID_TOKEN);
      }
      // A session no plan was bound to is no call this service still runs.
      if (owned.planId === undefined) return refused(HOSTED_API_ERROR.INVALID_REQUEST);
      const accountId = account.value;
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
        planId: owned.planId,
        attachId,
        started: true,
        sideband,
        answer,
        logEvent: LOG_EVENT.SESSION_ATTACHED,
      };
    });

  return {
    open: (upstream, admission, device) =>
      Effect.gen(function* () {
        const frame = yield* firstFrame(device);
        if (frame === undefined || !(yield* device.isOpen)) {
          return refused(HOSTED_API_ERROR.INVALID_REQUEST);
        }
        return frame.type === VOICE_SERVICE_FRAME.SESSION_ATTACH
          ? yield* openAttached(upstream, admission, frame)
          : yield* openCreated(upstream, admission, frame);
      }),
  };
}
