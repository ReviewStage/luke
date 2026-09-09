import { RECORD_EXTRA_KEYS, type Schema, s, type UnparsedWireValue } from "@sidecar/wire";
import {
  REALTIME_CALLS_PATH,
  type RealtimeConnection,
  realtimeCredentialIsUsable,
} from "./realtime-contract.js";
import { type HostedQuota, hostedQuotaSchema } from "./service-wire.js";

/**
 * What the two mint endpoints answer: one ephemeral Realtime credential, the
 * allowance it was spent against, and — for the phone's mint — the roster
 * context it forwards verbatim. A credential is validated field by field
 * rather than repaired, because a mis-answering service must read as a
 * malformed response and never as a call aimed somewhere else.
 */

/**
 * The one address a hosted credential may point a WebRTC call at. The
 * renderer's content-security policy only permits the canonical OpenAI host,
 * so a credential aimed anywhere else could not work — validating it here
 * means a mis-answering service reads as a malformed response rather than as
 * a call that dies mid-handshake.
 */
export const HOSTED_CALLS_URL = `https://api.openai.com/v1${REALTIME_CALLS_PATH}`;

/**
 * The build-pinned WebSocket base URL for OpenAI Realtime. The full endpoint
 * appends ?model=<model> and is validated field-by-field in the wire reader
 * the same way callsUrl is, so a mis-answering service cannot redirect a
 * mobile client's connection.
 */
export const HOSTED_WS_BASE_URL = "wss://api.openai.com/v1/realtime";

export interface HostedMintAnswer {
  connection: RealtimeConnection;
  quota?: HostedQuota;
}

/**
 * The `wsUrl` is the one field no per-field declaration can settle: it is
 * legal only for the model the same credential names, so it is read against
 * the record it arrived in.
 */
const connectionSchema: Schema<RealtimeConnection> = s.refine(
  s.record(
    {
      value: s.text(),
      expiresAt: s.number(),
      model: s.text(),
      callsUrl: s.literal(HOSTED_CALLS_URL),
      wsUrl: s.text(),
    },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
  (connection) => connection.wsUrl === `${HOSTED_WS_BASE_URL}?model=${connection.model}`,
);

/** What both mint answers carry: the credential, and the allowance it was spent against. */
const MINT_FIELDS = {
  connection: connectionSchema,
  quota: s.dropRefused(hostedQuotaSchema),
} as const;

/**
 * The shape of a hosted mint answer. Whether the credential it carries has
 * already expired is not a fact about its shape, so {@link hostedMintAnswerAt}
 * is where a moment in time meets it.
 */
export const hostedMintAnswerSchema: Schema<HostedMintAnswer> = s.record(MINT_FIELDS, {
  extraKeys: RECORD_EXTRA_KEYS.IGNORE,
});

/**
 * A mint answer read at a moment: anything without a usable, canonically
 * addressed credential is discarded rather than repaired, the same posture as
 * the OpenAI mint response reader.
 */
function mintAnswerAt<Answer extends HostedMintAnswer>(
  schema: Schema<Answer>,
): (value: UnparsedWireValue, now: number) => Answer | undefined {
  return (value, now) => {
    const answer = schema.parse(value);
    return answer && realtimeCredentialIsUsable(answer.connection, now) ? answer : undefined;
  };
}

export const hostedMintAnswerAt = mintAnswerAt(hostedMintAnswerSchema);

/**
 * One pre-serialized context item returned by the mobile mint endpoint. The
 * phone wraps `text` verbatim in a `conversation.item.create` event keyed by
 * `itemId` — it does not re-serialize, re-label, or re-validate the content.
 */
export interface RemoteVoiceContextItem {
  /** The item id the phone names the `conversation.item.create` event with. */
  itemId: string;
  /** The labeled context text, ready to drop into `content[0].text`. */
  text: string;
}

/** The pre-serialized context the mobile mint endpoint answers with. */
export interface RemoteVoiceContext {
  sessions: RemoteVoiceContextItem;
}

/** What the mobile mint endpoint returns on success. */
export interface RemoteMintAnswer extends HostedMintAnswer {
  context: RemoteVoiceContext;
}

/**
 * The mobile mint answer: the credential checks above, and additionally a
 * context with a sessions item. A malformed context is not repaired — the
 * phone has no fallback for context it cannot forward.
 */
export const remoteMintAnswerSchema: Schema<RemoteMintAnswer> = s.record(
  {
    ...MINT_FIELDS,
    context: s.record(
      {
        sessions: s.record(
          { itemId: s.text(), text: s.text() },
          { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
        ),
      },
      { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
    ),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

export const remoteMintAnswerAt = mintAnswerAt(remoteMintAnswerSchema);
