import type { UnreadableRow } from "@sidecar/session";
import { type CloudFetch, HTTP_METHOD, type UnparsedWireValue, unparsedWire } from "@sidecar/wire";
import {
  type AccountCall,
  accountBearer,
  callAnswered,
  createAccountCall,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  type ConversationClearAnswer,
  conversationClearAnswerSchema,
} from "./conversation-clear-wire.js";
import {
  type BrainTurnsAnswer,
  brainTurnsAnswerSchema,
  type ChangesAnswer,
  type ChangesRequest,
  type ConversationEventsAnswer,
  type ConversationMessagesAnswer,
  changesAnswerSchema,
  changesRequestSchema,
  conversationEventsAnswerSchema,
  conversationMessagesAnswerSchema,
  READ_QUERY,
  unreadableRowRefusalSchema,
} from "./reads-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

export interface HostedConversationClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  fetch?: CloudFetch;
  requestTimeoutMs?: number;
}

/** One page's ask: the cursor the previous answer handed back, or none for the beginning, and the page bound. */
export interface ReadPageQuery {
  readonly after?: string;
  readonly limit?: number;
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
  readonly #call: AccountCall;

  constructor(options: HostedConversationClientOptions) {
    this.#call = createAccountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      fetch: options.fetch,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  messages(page: ReadPageQuery = {}): Promise<ConversationReadResult<ConversationMessagesAnswer>> {
    return this.#read(HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES, page, (payload) =>
      conversationMessagesAnswerSchema.parse(payload),
    );
  }

  events(page: ReadPageQuery = {}): Promise<ConversationReadResult<ConversationEventsAnswer>> {
    return this.#read(HOSTED_SERVICE_PATH.CONVERSATION_EVENTS, page, (payload) =>
      conversationEventsAnswerSchema.parse(payload),
    );
  }

  turns(page: ReadPageQuery = {}): Promise<ConversationReadResult<BrainTurnsAnswer>> {
    return this.#read(HOSTED_SERVICE_PATH.BRAIN_TURNS, page, (payload) =>
      brainTurnsAnswerSchema.parse(payload),
    );
  }

  /** The soft delete of the account's main conversation; nothing on this Mac moves for it. */
  clear(): Promise<ConversationClearAnswer | undefined> {
    return this.#call.ask(
      { method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CONVERSATION_CLEAR },
      (payload) => conversationClearAnswerSchema.parse(payload),
    );
  }

  async #read<Answer>(
    path: string,
    page: ReadPageQuery,
    read: (payload: UnparsedWireValue) => Answer | undefined,
  ): Promise<ConversationReadResult<Answer>> {
    const answer = await this.#call.send({ method: HTTP_METHOD.GET, path: pagePath(path, page) });
    if (!callAnswered(answer)) return UNANSWERED;
    const payload = await answer.response.json().catch(() => undefined);
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
  }
}
