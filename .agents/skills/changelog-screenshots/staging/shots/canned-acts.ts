/**
 * canned-acts.ts -- the act seam: a shot answers the acts it stages from its own data, in place of main, which answers a fixture run's service reads with nothing.
 *
 * Throwaway (`README.md`). `act.ts`'s one door asks here first; an act the
 * shot does not answer goes to main as it would. Every answer is still read
 * through its kind's own guard by the door, so a canned value that the wire
 * would refuse is refused here too. A {@link NEVER} answer is a promise that
 * never settles, which is how a long-poll loop that asks again as soon as an
 * answer lands is answered once and then held.
 */

import { ACT_OUTCOME_STATUS, type Act, type ActKind, type ActOutcome } from "@luke/host/acts";
import { currentShot } from "./shot-profiles";
import { NEVER, type ShotAnswer } from "./shot-spec";

/** The one promise every held read is handed: it never settles. */
const HELD: Promise<ActOutcome> = new Promise<ActOutcome>(() => undefined);

/** The shot's answer to the act, or nothing where the act goes to main. */
export function cannedOutcome(request: Act): Promise<ActOutcome> | undefined {
  const answers = currentShot()?.answers;
  if (answers === undefined) return undefined;
  // SAFETY: the table is keyed by kind, each answer taking that kind's payload.
  const answer = answers[request.kind] as ShotAnswer<ActKind> | undefined;
  if (answer === undefined) return undefined;
  const payload = "payload" in request ? request.payload : undefined;
  // SAFETY: the payload is the one the request's kind declares.
  const value = answer(payload as never);
  if (value === undefined) return undefined;
  if (value === NEVER) return HELD;
  // SAFETY: the answer is the kind's own result; the door's guard reads it again.
  return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value } as ActOutcome);
}
