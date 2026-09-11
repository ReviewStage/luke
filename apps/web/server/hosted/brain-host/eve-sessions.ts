import {
  RECORD_EXTRA_KEYS,
  s,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "../../core.js";
import { BRAIN_HOST_HEADER, type BrainHostTurn } from "./bounds.js";

/**
 * The host's own calls into eve's HTTP API, made from a web function on the
 * developer's behalf: open the conversation's session with a first message,
 * follow up on the session it runs in, and cancel the turn under way. eve's
 * `Client` would make the same three requests, but its session handle keeps
 * the delivery id an accepted follow-up answers to itself, and that id is
 * what ties an ask to the turn eve later starts, so the requests are made
 * here as eve's own routes document them. The caller's bearer travels
 * unchanged: eve's door admits the same account against the same conversation
 * this route already admitted, so nothing dispatches that either door
 * refuses. The conversation and the kind of turn ride as the headers the door
 * reads them from. eve answers a follow-up to an unknown, terminal, or
 * not-yet-active session with one 409, so the code alone cannot tell a
 * session whose command inbox is still starting from one eve has retired;
 * the SDK's own client tries three more times, at 250, 500, and 1,000
 * milliseconds, and reads the session as terminal only after the last, and
 * the same schedule stands here. The retry is what makes a wrong "retired"
 * rare; it is not what makes one safe. That is the conversation row's
 * forward-only claim: an inbox slower than the last wait costs a session
 * opened for nothing, which the claim lets the older one lose, and never two
 * sessions writing one conversation. Reopening is never eve's: the host
 * decides it, under that claim.
 */

/** eve's session routes, as `door.ts` also spells them; a path is composed from these and nothing else. */
const EVE_SESSION_PATH = "/eve/v1/session";

function sessionPath(sessionId: string): string {
  return `${EVE_SESSION_PATH}/${encodeURIComponent(sessionId)}`;
}

/** The code eve's follow-up route answers for a session it does not run now, beside its 409. */
const EVE_SESSION_NOT_ACTIVE = "session_not_active";

/**
 * The waits before a not-active follow-up is tried again: a copy of the
 * schedule eve 0.53.1's own client keeps, not a number of ours to tune, so a
 * dependency bump is the moment to check the table still matches. A session
 * not active past the last wait is retired.
 */
const SESSION_NOT_ACTIVE_RETRY_MS = [250, 500, 1_000] as const;

const ACCEPTED_STATUS = 202;
const CONFLICT_STATUS = 409;

const openedSession = s.record({ sessionId: s.text() }, { extraKeys: RECORD_EXTRA_KEYS.IGNORE });
const acceptedDelivery = s.record(
  { sessionId: s.text(), deliveryId: s.text() },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
const refusedSend = s.record({ code: s.text() }, { extraKeys: RECORD_EXTRA_KEYS.IGNORE });

const EVE_CANCEL_STATUS = { ACCEPTED: "accepted", NO_ACTIVE_TURN: "no_active_turn" } as const;
const cancelAnswer = s.record(
  { status: s.enumOf(Object.values(EVE_CANCEL_STATUS)) },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** How eve answered a call: what it accepted, a session it no longer runs, or an answer this build cannot read as either. */
export const EVE_SEND_OUTCOME = {
  ACCEPTED: "accepted",
  /** eve does not run the session, and did not come to after the retry schedule; the conversation needs a new one. */
  RETIRED: "retired",
  /** eve refused or answered outside its documented shape; the status travels for the operator. */
  FAILED: "failed",
} as const;

type EveOpened =
  | { readonly outcome: typeof EVE_SEND_OUTCOME.ACCEPTED; readonly sessionId: string }
  | { readonly outcome: typeof EVE_SEND_OUTCOME.FAILED; readonly status: number };

type EveSent =
  | {
      readonly outcome: typeof EVE_SEND_OUTCOME.ACCEPTED;
      readonly sessionId: string;
      readonly deliveryId: string;
    }
  | { readonly outcome: typeof EVE_SEND_OUTCOME.RETIRED }
  | { readonly outcome: typeof EVE_SEND_OUTCOME.FAILED; readonly status: number };

/** How eve answered a cancel: its own two words, or an answer this build cannot read as either. */
export const EVE_CANCEL_OUTCOME = {
  ACCEPTED: EVE_CANCEL_STATUS.ACCEPTED,
  NO_ACTIVE_TURN: EVE_CANCEL_STATUS.NO_ACTIVE_TURN,
  FAILED: "failed",
} as const;

type EveCancelled =
  | { readonly outcome: typeof EVE_CANCEL_OUTCOME.ACCEPTED }
  | { readonly outcome: typeof EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN }
  | { readonly outcome: typeof EVE_CANCEL_OUTCOME.FAILED; readonly status: number };

interface EveMessage {
  readonly conversationId: string;
  readonly turn: BrainHostTurn;
  readonly message: string;
}

export interface EveSessions {
  /** Opens a session over the conversation with its first message; eve's answer names the session, whose first turn is the message's. */
  open(message: EveMessage): Promise<EveOpened>;
  /** Hands a message to the session the conversation runs in; eve's answer names the delivery its turn's events will carry. */
  send(sessionId: string, message: EveMessage): Promise<EveSent>;
  /** Asks eve to cancel the session's turn under way. */
  cancel(sessionId: string): Promise<EveCancelled>;
}

/** What the host posts to eve: the message a turn opens with, or nothing for a cancel. */
interface EvePostBody {
  readonly message?: string;
}

export interface EveSessionsOptions {
  /** The origin eve answers on; the deployment's own, where its rewrites carry `/eve/v1/*` into the eve service. */
  readonly origin: string;
  /** The caller's own `Authorization` value, forwarded so eve's door admits the same account. */
  readonly authorization: string;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The whole body as eve wrote it, or nothing for one that is not JSON. */
async function bodyOf(response: Response): Promise<UnparsedWireValue> {
  try {
    // SAFETY: eve's own JSON answer; the schema read that follows is what holds it to a shape.
    return unparsedWire((await response.json()) as WireBoundaryInput);
  } catch {
    return unparsedWire(undefined);
  }
}

export function eveSessions(options: EveSessionsOptions): EveSessions {
  const call = options.fetch ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const post = (path: string, headers: Readonly<Record<string, string>>, body: EvePostBody) =>
    call(new URL(path, options.origin), {
      method: "POST",
      headers: {
        authorization: options.authorization,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      redirect: "error",
    });
  const turnHeaders = (message: EveMessage) => ({
    [BRAIN_HOST_HEADER.CONVERSATION]: message.conversationId,
    [BRAIN_HOST_HEADER.TURN]: message.turn,
  });
  return {
    async open(message) {
      const response = await post(EVE_SESSION_PATH, turnHeaders(message), {
        message: message.message,
      });
      const opened = openedSession.read(await bodyOf(response));
      if (response.status !== ACCEPTED_STATUS || !opened.ok) {
        return { outcome: EVE_SEND_OUTCOME.FAILED, status: response.status };
      }
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: opened.value.sessionId };
    },
    async send(sessionId, message) {
      for (let attempt = 0; ; attempt += 1) {
        const response = await post(sessionPath(sessionId), turnHeaders(message), {
          message: message.message,
        });
        const body = await bodyOf(response);
        if (response.status === CONFLICT_STATUS) {
          const refused = refusedSend.read(body);
          if (refused.ok && refused.value.code === EVE_SESSION_NOT_ACTIVE) {
            const wait = SESSION_NOT_ACTIVE_RETRY_MS[attempt];
            if (wait === undefined) return { outcome: EVE_SEND_OUTCOME.RETIRED };
            await sleep(wait);
            continue;
          }
        }
        const accepted = acceptedDelivery.read(body);
        if (response.status !== ACCEPTED_STATUS || !accepted.ok) {
          return { outcome: EVE_SEND_OUTCOME.FAILED, status: response.status };
        }
        return {
          outcome: EVE_SEND_OUTCOME.ACCEPTED,
          sessionId: accepted.value.sessionId,
          deliveryId: accepted.value.deliveryId,
        };
      }
    },
    async cancel(sessionId) {
      const response = await post(`${sessionPath(sessionId)}/cancel`, {}, {});
      const answer = cancelAnswer.read(await bodyOf(response));
      if (!response.ok || !answer.ok) {
        return { outcome: EVE_CANCEL_OUTCOME.FAILED, status: response.status };
      }
      return answer.value.status === EVE_CANCEL_STATUS.ACCEPTED
        ? { outcome: EVE_CANCEL_OUTCOME.ACCEPTED }
        : { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN };
    },
  };
}
