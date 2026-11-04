/**
 * keyed-write.ts -- how a write sent under an idempotency key ended where the service did not answer what it wrote: refused, unanswered, or taken already under its key.
 *
 * A write a Mac may send again under its key (`IDEMPOTENCY_KEY`) reads its
 * failure three ways. The service refused it, or no credential could carry
 * it: sent again it never lands, so what it drew is taken back. No answer
 * came, through the network, the deadline, a server error, or an answer
 * that could not be read: it may have landed or not, and sent again under
 * its key it lands once. Or the service answers that it took the write
 * already under its key: it landed, and nothing more is sent.
 */

import { CALL_FAULT } from "./account-call.js";
import { FAILURE_FACT, type FailureFacts } from "./failure-facts.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/** How a keyed write ended where the service did not answer what it wrote. */
export const WRITE_UNTAKEN = {
  /** Refused, or carried by no credential: sent again it never lands. */
  REFUSED: "refused",
  /** No answer: sent again under its key, it lands once. */
  UNANSWERED: "unanswered",
  /** The service took it already, under its key. */
  ALREADY_WRITTEN: "already-written",
} as const;

export type WriteUntaken = (typeof WRITE_UNTAKEN)[keyof typeof WRITE_UNTAKEN];

/** The statuses a request is refused with as itself, which sending it again never mends. */
const CLIENT_ERROR = { FIRST: 400, LAST: 499 } as const;

/** How a keyed write ended, by the facts of its failure; refused where it carries none. */
export function writeUntakenOf(facts: FailureFacts | undefined): WriteUntaken {
  if (facts?._tag === FAILURE_FACT.HOSTED_REFUSED) {
    return facts.refusal === HOSTED_API_ERROR.ALREADY_WRITTEN
      ? WRITE_UNTAKEN.ALREADY_WRITTEN
      : WRITE_UNTAKEN.REFUSED;
  }
  if (facts?._tag !== FAILURE_FACT.HOSTED_UNANSWERED) return WRITE_UNTAKEN.REFUSED;
  if (facts.fault === CALL_FAULT.NO_CREDENTIAL || facts.fault === CALL_FAULT.HOLDER_CHANGED) {
    return WRITE_UNTAKEN.REFUSED;
  }
  const { status } = facts;
  const refused =
    status !== undefined && status >= CLIENT_ERROR.FIRST && status <= CLIENT_ERROR.LAST;
  return refused ? WRITE_UNTAKEN.REFUSED : WRITE_UNTAKEN.UNANSWERED;
}
