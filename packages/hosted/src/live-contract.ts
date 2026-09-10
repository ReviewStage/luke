import {
  type InitialItem,
  LIVE_INPUT_BOUNDS,
  LIVE_VOICE_LIST,
  type LiveVoice,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
} from "@sidecar/live";
import { RECORD_EXTRA_KEYS, SCHEMA_REFUSAL, type Schema, s, TEXT_ENDS } from "@sidecar/wire";
import { type HostedQuota, hostedQuotaSchema } from "./service-wire.js";

/**
 * The desktop's contract with the hosted voice service: the two Vercel
 * Functions of Luke's own service that hold the GPT Live project key, create
 * the session at OpenAI (`POST /v1/live/sessions`), attach the trusted
 * sideband themselves, and then carry Live events between the desktop and
 * OpenAI untouched. The desktop reaches them over one WebSocket per function
 * connection, and what travels on that socket before the Live events do is
 * declared here, once, for both ends.
 */

/** The origin of Luke's own service, the same one every hosted call is addressed to. */
export const HOSTED_SERVICE_ORIGIN = "https://tryluke.dev";

const WEB_SOCKET_SCHEME = {
  "https:": "wss:",
  "http:": "ws:",
  "wss:": "wss:",
  "ws:": "ws:",
} as const;

function isWebSocketReachable(protocol: string): protocol is keyof typeof WEB_SOCKET_SCHEME {
  return protocol in WEB_SOCKET_SCHEME;
}

/**
 * The socket origin of an HTTP or socket origin, or nothing for an address
 * that is not an absolute URL on a scheme a socket can be opened over.
 */
export function webSocketOrigin(address: string): string | undefined {
  try {
    const url = new URL(address);
    if (!isWebSocketReachable(url.protocol)) return undefined;
    url.protocol = WEB_SOCKET_SCHEME[url.protocol];
    return url.origin === "null" ? undefined : url.origin;
  } catch {
    return undefined;
  }
}

/**
 * The one origin a hosted desktop opens a voice socket to: Luke's own
 * service, in its socket form. Pinned by the build and compared as an origin
 * — scheme, host, and port — so a path or query can never make another host
 * read as Luke's service. A development build may be pointed elsewhere
 * through {@link hostedVoiceServiceOrigin}; a packaged one may not.
 */
export const HOSTED_VOICE_SERVICE_ORIGIN = webSocketOrigin(HOSTED_SERVICE_ORIGIN) ?? "";

/** Whether an address is on the hosted voice service's origin, by `URL.origin` alone. */
export function isHostedVoiceServiceAddress(address: string, origin = HOSTED_VOICE_SERVICE_ORIGIN) {
  try {
    return new URL(address).origin === origin;
  } catch {
    return false;
  }
}

/**
 * The origin a build connects to: the pinned one, or — only where the caller
 * says the build is unpackaged and hands an override it read from its own
 * environment, the same mechanism the account service's development override
 * uses — that override reduced to its socket origin, so the account
 * service's own `http://localhost` override reaches the functions `vercel
 * dev` serves beside it. An override that is not an absolute URL is ignored
 * rather than reached.
 */
export function hostedVoiceServiceOrigin(options: {
  packaged: boolean;
  override: string | undefined;
}): string {
  if (options.packaged || options.override === undefined) return HOSTED_VOICE_SERVICE_ORIGIN;
  return webSocketOrigin(options.override) ?? HOSTED_VOICE_SERVICE_ORIGIN;
}

/**
 * The frames the desktop and the voice service exchange before Live events
 * flow. A socket opens with one of the desktop's two: `session.create` for a
 * new session, or `session.attach` for a session that stands already, because
 * the WebRTC session between the desktop and OpenAI outlives any one function
 * connection, which the platform closes at the function's maximum duration.
 */
export const VOICE_SERVICE_FRAME = {
  /** The desktop's opening frame for a new session: the offer, the voice, and the seed. */
  SESSION_CREATE: "session.create",
  /** The service's answer once OpenAI has created the session and the sideband stands. */
  SESSION_CREATED: "session.created",
  /** The desktop's opening frame on a fresh connection to a session this account created. */
  SESSION_ATTACH: "session.attach",
  /** The service's answer once its sideband stands on that session again. */
  SESSION_ATTACHED: "session.attached",
} as const;

/**
 * The character bounds of a `session.create` frame. The seed's message count
 * is the API's own, `LIVE_INPUT_BOUNDS.MESSAGES`; the bound per item's text is
 * the whole of the API's token budget for `input` at four characters a
 * token, so a frame the API would refuse is refused here before the service
 * spends a session on it. The offer bound is generous for an SDP, which is a
 * few kilobytes.
 */
export const SESSION_CREATE_BOUNDS = {
  ITEM_CHARS: LIVE_INPUT_BOUNDS.TOKENS * 4,
  SDP_CHARS: 65_536,
} as const;

/** What the service answered with: the session's opaque id and the SDP answer to set as the remote description. */
export interface LiveSessionCreated {
  sessionId: string;
  sdpAnswer: string;
}

/** The desktop's opening frame. */
export interface SessionCreateFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_CREATE;
  sdp: string;
  voice: LiveVoice;
  input: InitialItem[];
}

/** The service's answer, and the allowance the session was spent against. */
export interface SessionCreatedFrame extends LiveSessionCreated {
  type: typeof VOICE_SERVICE_FRAME.SESSION_CREATED;
  quota?: HostedQuota;
}

/** The desktop's opening frame on a connection to a session it already holds. */
export interface SessionAttachFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_ATTACH;
  sessionId: string;
}

/** The service's answer: the sideband stands again on the session named. */
export interface SessionAttachedFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_ATTACHED;
  sessionId: string;
}

/** Either frame a socket may open with. */
export type SessionOpeningFrame = SessionCreateFrame | SessionAttachFrame;

/**
 * An SDP is admitted as written: its lines are its syntax, and a reader that
 * trimmed or collapsed them would hand the peer something the other end did
 * not say. A seed item's text is kept the same way, for the reason the seed
 * wrote it.
 */
function verbatimText(max: number): Schema<string> {
  return s.refine(
    s.text({ ends: TEXT_ENDS.KEEP, allowEmpty: true, max }),
    (value) => value.trim().length > 0,
  );
}

const itemText = verbatimText(SESSION_CREATE_BOUNDS.ITEM_CHARS);

/**
 * Exactly one part, answered as the one-element tuple the seed type names
 * rather than as a list that happens to hold one. The list bound already
 * refuses any other count; the reader is what lets the type say so.
 */
function onlyPart<Part>(part: Schema<Part>): Schema<readonly [Part]> {
  const list = s.array(part, { minimum: 1, max: 1 });
  return s.reader({
    read: (value) => {
      const read = list.read(value);
      if (!read.ok) return read;
      const [only] = read.value;
      return only === undefined
        ? { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [] }
        : { ok: true, value: [only] };
    },
    jsonSchema: list.jsonSchema,
  });
}

/**
 * One history message as `@sidecar/live` seeds it: the `message` type, a
 * role, and exactly one text part of the type that role writes. The SDK's
 * `InitialItem` also allows an id, a status, and a plain `text` part; none
 * is admitted, because the service composes the request to OpenAI from this
 * frame and takes into it only what the desktop's seed has a reason to send.
 */
function seedMessage<
  Role extends InitialItem["role"],
  Part extends InitialItem["content"][0]["type"],
>(role: Role, part: Part) {
  return s.record({
    type: s.literal(SEED_ITEM_TYPE),
    role: s.literal(role),
    content: onlyPart(s.record({ type: s.literal(part), text: itemText })),
  });
}

const liveInitialItemSchema: Schema<InitialItem> = s.union([
  seedMessage(SEED_ROLE.DEVELOPER, SEED_CONTENT_TYPE.INPUT_TEXT),
  seedMessage(SEED_ROLE.USER, SEED_CONTENT_TYPE.INPUT_TEXT),
  seedMessage(SEED_ROLE.ASSISTANT, SEED_CONTENT_TYPE.OUTPUT_TEXT),
]);

export const sessionCreateFrameSchema: Schema<SessionCreateFrame> = s.record({
  type: s.literal(VOICE_SERVICE_FRAME.SESSION_CREATE),
  sdp: verbatimText(SESSION_CREATE_BOUNDS.SDP_CHARS),
  voice: s.enumOf(LIVE_VOICE_LIST),
  input: s.array(liveInitialItemSchema, { max: LIVE_INPUT_BOUNDS.MESSAGES }),
});

/** A GPT Live session id is opaque and short; the bound only refuses a document standing in for one. */
const SESSION_ID_CHARS = 256;

const sessionId = s.text({ max: SESSION_ID_CHARS });

export const sessionAttachFrameSchema: Schema<SessionAttachFrame> = s.record({
  type: s.literal(VOICE_SERVICE_FRAME.SESSION_ATTACH),
  sessionId,
});

export const sessionOpeningFrameSchema: Schema<SessionOpeningFrame> = s.union([
  sessionCreateFrameSchema,
  sessionAttachFrameSchema,
]);

export const sessionAttachedFrameSchema: Schema<SessionAttachedFrame> = s.record(
  { type: s.literal(VOICE_SERVICE_FRAME.SESSION_ATTACHED), sessionId },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

const CREATED_FIELDS = {
  sessionId,
  sdpAnswer: verbatimText(SESSION_CREATE_BOUNDS.SDP_CHARS),
} as const;

export const liveSessionCreatedSchema: Schema<LiveSessionCreated> = s.record(CREATED_FIELDS, {
  extraKeys: RECORD_EXTRA_KEYS.IGNORE,
});

export const sessionCreatedFrameSchema: Schema<SessionCreatedFrame> = s.record(
  {
    type: s.literal(VOICE_SERVICE_FRAME.SESSION_CREATED),
    ...CREATED_FIELDS,
    quota: s.dropRefused(hostedQuotaSchema),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
