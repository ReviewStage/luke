import { CALL_FAULT } from "./account-call.js";
import { FAILURE_FACT, type FailureFacts } from "./failure-facts.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

export const WRITE_UNTAKEN = {
  REFUSED: "refused",
  UNANSWERED: "unanswered",
  ALREADY_WRITTEN: "already-written",
} as const;

export type WriteUntaken = (typeof WRITE_UNTAKEN)[keyof typeof WRITE_UNTAKEN];

const CLIENT_ERROR = { FIRST: 400, LAST: 499 } as const;

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
