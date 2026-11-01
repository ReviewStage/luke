/**
 * canned-acts.ts -- the act seam: a shot answers the acts it stages from its own data, in place of main, which answers a fixture run's service reads with nothing.
 *
 * Throwaway (`README.md`). `act.ts`'s `portAct` asks here first; an act the
 * shot does not answer goes to main as it would. A {@link NEVER} answer is a
 * promise that never settles, which is how a long-poll loop that asks again
 * as soon as an answer lands is answered once and then held.
 */

import type { PortActKind, PortActPayload, PortActResult } from "@luke/host/contract";
import { currentShot } from "./shot-profiles";
import { NEVER, type ShotAnswer } from "./shot-spec";

/** The one promise every held read is handed: it never settles. */
const HELD: Promise<never> = new Promise<never>(() => undefined);

/** The shot's answer to the act, or nothing where the act goes to main. */
export function cannedResult(
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): Promise<PortActResult<PortActKind>> | undefined {
  const answers = currentShot()?.answers;
  if (answers === undefined) return undefined;
  // SAFETY: the table is keyed by kind, each answer taking that kind's payload.
  const answer = answers[kind] as ShotAnswer<PortActKind> | undefined;
  if (answer === undefined) return undefined;
  // SAFETY: the payload is the one the request's kind declares.
  const value = answer(payload as never);
  if (value === undefined) return undefined;
  if (value === NEVER) return HELD;
  return Promise.resolve(value);
}
