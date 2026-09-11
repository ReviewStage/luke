import type * as HttpClient from "@effect/platform/HttpClient";
import type { UnreadableRow } from "@sidecar/session";
import {
  type CloudFetch,
  effectSchema,
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireRecord,
} from "@sidecar/wire";
import { layerFromCloudFetch } from "@sidecar/wire/effect";
import { Effect, type Layer } from "effect";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  type ConversationClearAnswer,
  conversationClearAnswerSchema,
} from "./conversation-clear-wire.js";
import {
  type HostedMessageRatingAnswer,
  type HostedMessageRatingRequest,
  hostedMessageRatingAnswerSchema,
  hostedMessageRatingRequestSchema,
} from "./rating-wire.js";
import {
  type BrainTurnsAnswer,
  brainTurnsAnswerSchema,
  type ConversationEventsAnswer,
  type ConversationMessagesAnswer,
  conversationEventsAnswerSchema,
  conversationMessagesAnswerSchema,
  READ_QUERY,
  unreadableRowRefusalSchema,
} from "./reads-wire.js";
import { conversationMessageRatingPath, HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR, hostedErrorSchema } from "./service-wire.js";

export interface HostedConversationClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  fetch?: CloudFetch;
  requestTimeoutMs?: number;
}

/** One page's ask: the cursor the previous answer handed back, or none for the beginning, and the page bound. */
export interface ReadPageQuery {
  readonly after?: string | undefined;
  readonly limit?: number | undefined;
}

/**
 * How a read ends short of an answer. A refusal, a fault, or a body outside
 * the contract are one word, because a device does the same thing about each
 * — keeps what it holds and asks again next poll. The unreadable row is the
 * one refusal a device has to act on differently: the service named a row it
 * could not read back and answered no page around it, so the device must not
 * draw the page as empty or advance past it.
 */
export const CONVERSATION_READ_FAILURE = {
  UNANSWERED: "unanswered",
  UNREADABLE_ROW: "unreadable-row",
} as const;

export type ConversationReadResult<Answer> =
  | { readonly ok: true; readonly answer: Answer }
  | { readonly ok: false; readonly failure: typeof CONVERSATION_READ_FAILURE.UNANSWERED }
  | {
      readonly ok: false;
      readonly failure: typeof CONVERSATION_READ_FAILURE.UNREADABLE_ROW;
      readonly row: UnreadableRow;
    };

const UNANSWERED: ConversationReadResult<never> = {
  ok: false,
  failure: CONVERSATION_READ_FAILURE.UNANSWERED,
};

/**
 * How a rating ends short of being recorded. The two the service names are
 * kept apart because a control does different things about each: a message
 * the account no longer holds is a row the thread has moved past, and one
 * that stands but is not Luke's is a control that should never have been
 * drawn. Everything else — a fault, a body outside the contract, a request
 * the wire's own schema refuses before it travels — is one word, because the
 * caller does the same thing about each: leaves the verdict as it was.
 */
export const CONVERSATION_RATE_REFUSAL = {
  UNANSWERED: "unanswered",
  NOT_FOUND: "not-found",
  NOT_RATEABLE: "not-rateable",
} as const;

export type ConversationRateRefusal =
  (typeof CONVERSATION_RATE_REFUSAL)[keyof typeof CONVERSATION_RATE_REFUSAL];

export type ConversationRateResult =
  | { readonly ok: true; readonly answer: HostedMessageRatingAnswer }
  | { readonly ok: false; readonly refusal: ConversationRateRefusal };

const RATE_UNANSWERED: ConversationRateResult = {
  ok: false,
  refusal: CONVERSATION_RATE_REFUSAL.UNANSWERED,
};

/** The request as a record for the schema to read, field by field; what travels is the value the schema admitted. */
function ratingRecord(request: HostedMessageRatingRequest): WireRecord {
  return {
    rating: request.rating,
    ...(request.note !== undefined ? { note: request.note } : undefined),
    deviceId: request.deviceId,
  };
}

function pagePath(path: string, page: ReadPageQuery): string {
  const query = new URLSearchParams();
  if (page.after !== undefined) query.set(READ_QUERY.AFTER, page.after);
  if (page.limit !== undefined) query.set(READ_QUERY.LIMIT, String(page.limit));
  const encoded = query.toString();
  return encoded === "" ? path : `${path}?${encoded}`;
}

/**
 * The desktop's side of the Conversation's per-resource reads and Clear; the
 * change signal between the reads is the changes client's, shared with the
 * device row's presence poll. Every ask is the shared account call — the
 * token read fresh per attempt, a 401 refreshed and retried once, every answer
 * validated by the shared wire contract — and nothing here holds a cursor or
 * a row: what a device keeps of the Conversation is its caller's, and this
 * client only carries one ask and reads one answer.
 */
export class HostedConversationClient {
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: HostedConversationClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = layerFromCloudFetch(options.fetch ?? ((input, init) => fetch(input, init)));
  }

  messages(page: ReadPageQuery = {}): Promise<ConversationReadResult<ConversationMessagesAnswer>> {
    return this.#run(
      this.#readEffect(HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES, page, (payload) =>
        conversationMessagesAnswerSchema.parse(payload),
      ),
    );
  }

  events(page: ReadPageQuery = {}): Promise<ConversationReadResult<ConversationEventsAnswer>> {
    return this.#run(
      this.#readEffect(HOSTED_SERVICE_PATH.CONVERSATION_EVENTS, page, (payload) =>
        conversationEventsAnswerSchema.parse(payload),
      ),
    );
  }

  turns(page: ReadPageQuery = {}): Promise<ConversationReadResult<BrainTurnsAnswer>> {
    return this.#run(
      this.#readEffect(HOSTED_SERVICE_PATH.BRAIN_TURNS, page, (payload) =>
        brainTurnsAnswerSchema.parse(payload),
      ),
    );
  }

  /** The soft delete of the account's main conversation; nothing on this Mac moves for it. */
  clear(): Promise<ConversationClearAnswer | undefined> {
    return this.#run(
      this.#call.ask(
        { method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CONVERSATION_CLEAR },
        effectSchema(conversationClearAnswerSchema),
      ),
    );
  }

  /**
   * The developer's verdict on one of Luke's messages, appended on the
   * service as a rating event beside the message and never an update: a
   * second verdict is a second event, and a read takes the newer. The request
   * is held to the wire's own schema before it travels, so one the service
   * would refuse by shape never does, and the answer is the event's id and
   * its place in the conversation's event sequence, which is what lets the
   * caller show the verdict before the next read carries it back.
   */
  rate(messageId: string, request: HostedMessageRatingRequest): Promise<ConversationRateResult> {
    return this.#run(this.#rateEffect(messageId, request));
  }

  #rateEffect(
    messageId: string,
    request: HostedMessageRatingRequest,
  ): Effect.Effect<ConversationRateResult, never, HttpClient.HttpClient> {
    const admitted = hostedMessageRatingRequestSchema.parse(ratingRecord(request));
    if (admitted === undefined) return Effect.succeed(RATE_UNANSWERED);
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({
        method: HTTP_METHOD.PUT,
        path: conversationMessageRatingPath(messageId),
        body: JSON.stringify(admitted),
      });
      if (!callAnswered(answer)) return RATE_UNANSWERED;
      const payload = yield* Effect.promise(() => answer.response.json().catch(() => undefined));
      if (payload === undefined) return RATE_UNANSWERED;
      const wire = unparsedWire(payload);
      if (answer.response.ok) {
        const recorded = hostedMessageRatingAnswerSchema.parse(wire);
        return recorded === undefined ? RATE_UNANSWERED : { ok: true, answer: recorded };
      }
      switch (hostedErrorSchema.parse(wire)) {
        case HOSTED_API_ERROR.NOT_FOUND:
          return { ok: false, refusal: CONVERSATION_RATE_REFUSAL.NOT_FOUND };
        case HOSTED_API_ERROR.NOT_RATEABLE:
          return { ok: false, refusal: CONVERSATION_RATE_REFUSAL.NOT_RATEABLE };
        default:
          return RATE_UNANSWERED;
      }
    });
  }

  #readEffect<Answer>(
    path: string,
    page: ReadPageQuery,
    read: (payload: UnparsedWireValue) => Answer | undefined,
  ): Effect.Effect<ConversationReadResult<Answer>, never, HttpClient.HttpClient> {
    const call = this.#call;
    return Effect.gen(function* () {
      const answer = yield* call.send({ method: HTTP_METHOD.GET, path: pagePath(path, page) });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = yield* Effect.promise(() => answer.response.json().catch(() => undefined));
      if (payload === undefined) return UNANSWERED;
      const wire = unparsedWire(payload);
      if (answer.response.ok) {
        const value = read(wire);
        return value === undefined ? UNANSWERED : { ok: true, answer: value };
      }
      const row = unreadableRowRefusalSchema.parse(wire);
      return row === undefined
        ? UNANSWERED
        : { ok: false, failure: CONVERSATION_READ_FAILURE.UNREADABLE_ROW, row };
    });
  }

  /**
   * @deprecated The promise face `messages`, `events`, `turns`, `clear`, and
   * `rate` keep while their caller still awaits a `Promise` rather than
   * holding a runtime edge of its own; deleted with `CloudFetch` in P12-04,
   * at which point the caller runs `#call.ask`/`#call.send` on its own
   * runtime instead.
   */
  #run<Answer>(effect: Effect.Effect<Answer, never, HttpClient.HttpClient>): Promise<Answer> {
    return Effect.runPromise(Effect.provide(effect, this.#client));
  }
}
