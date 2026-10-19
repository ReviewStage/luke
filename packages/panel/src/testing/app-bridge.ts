/**
 * app-bridge.ts -- the bridge and act port a test's window reaches main through: fakes answering only the calls its test gives them.
 */

import {
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "@luke/host/acts";
import type { AppBridge } from "@luke/host/bridge";
import {
  ACT_ERROR,
  type ActPortClient,
  actContract,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
} from "@luke/host/contract";
import type { WireBoundaryInput } from "@luke/wire";
import { ORPCError } from "@orpc/client";
import { installActPortClient, installAppBridge } from "../app-bridge.js";

let answering: Partial<AppBridge> = {};
let answeringPort: Partial<FakeActPort> = {};

/** Installs a bridge answering only the calls given, in place of whatever the window held. */
export function fakeAppBridge(calls: Partial<AppBridge>): void {
  answering = calls;
  // SAFETY: a test's window makes only the calls its test answers, and any other is undefined and throws where it is made.
  installAppBridge(calls as AppBridge);
}

/** The calls the fake bridge answers now, for a test that answers one more beside them or puts them back. */
export function fakeAppBridgeCalls(): Partial<AppBridge> {
  return answering;
}

/**
 * Installs an act port answering only the procedures given, each by its
 * kind, as a test's window calls them.
 */
export function fakeActPort(procedures: Partial<FakeActPort>): void {
  answeringPort = procedures;
  // SAFETY: a test's window calls only the procedures its test answers, and any other is undefined and throws where it is called.
  installActPortClient(procedures as ActPortClient);
}

/** The procedures the fake act port answers now, for a test that answers one more beside them or puts them back. */
export function fakeActPortCalls(): Partial<FakeActPort> {
  return answeringPort;
}

/** A procedure's refusal as the act port answers it: the declared error, carrying `sentence`. */
export function refusedOnPort(sentence: string): ORPCError<string, unknown> {
  return new ORPCError(ACT_ERROR.REFUSED, { message: sentence });
}

/** Each port kind's procedure as a test answers it: its payload in, its answer or a rejection out. */
export type FakeActPort = {
  readonly [Kind in PortActKind]: (payload: PortActPayload<Kind>) => Promise<PortActResult<Kind>>;
};

/** One act as a window sent it on its act port: its kind, and its payload where it carries one. */
export type SentPortAct = { readonly kind: PortActKind; readonly payload?: WireBoundaryInput };

/**
 * Installs an act port answering every kind through `answer`, as a test
 * that writes down what its window sent, whichever kind it was, does.
 */
export function fakeActPortAnswering(
  answer: (request: SentPortAct) => Promise<WireBoundaryInput>,
): void {
  const procedures: Partial<FakeActPort> = {};
  // SAFETY: the contract's keys are exactly its kinds.
  for (const kind of Object.keys(actContract) as PortActKind[]) {
    // Note that each kind is answered alike, whatever its own answer is, so it is assigned rather than typed by the kind.
    Object.assign(procedures, {
      [kind]: (payload: WireBoundaryInput) =>
        answer(payload === undefined ? { kind } : { kind, payload }),
    });
  }
  fakeActPort(procedures);
}

/** One act a window sent on its act port, its payload typed by its kind, and absent where the kind carries none. */
type PortAct = {
  [Kind in PortActKind]: PortActPayload<Kind> extends undefined
    ? { readonly kind: Kind; readonly payload?: undefined }
    : { readonly kind: Kind; readonly payload: PortActPayload<Kind> };
}[PortActKind];

/** One act a test's window sent, on `app:act` or on its act port. */
export type AnyAct = Act | PortAct;

/** What a test answers any act with, in `app:act`'s outcome's shape, a port kind's value among them. */
export type AnyActOutcome =
  | ActOutcome
  | {
      readonly status: typeof ACT_OUTCOME_STATUS.DONE;
      readonly value: ActResultFor<ActKind> | PortActResult<PortActKind>;
    };

let answeringActs: ((request: AnyAct) => Promise<AnyActOutcome>) | undefined;

/** The answer {@link fakeActs} installed last, for a test that answers a kind more over it. */
export function fakeActsAnswer(): (request: AnyAct) => Promise<AnyActOutcome> {
  const answer = answeringActs;
  if (answer === undefined) throw new Error("No acts are answered in this test yet.");
  return answer;
}

/**
 * Installs a bridge and an act port both answered by `calls.act`, as a test
 * whose one switch answers kinds on either side does: on the port, a done
 * outcome is the kind's bare value, a refusal is the port's refusal in its
 * sentence, and a kind the switch does not know rejects, as the bridge
 * answers each. The bridge's other calls are the rest of `calls`.
 */
export function fakeActs(
  calls: Omit<Partial<AppBridge>, "act"> & {
    readonly act: (request: AnyAct) => Promise<AnyActOutcome>;
  },
): void {
  const answer = calls.act;
  answeringActs = answer;
  // SAFETY: the test's switch answers each `app:act` kind in that kind's own outcome.
  fakeAppBridge({ ...calls, act: answer as AppBridge["act"] });
  const procedures: Partial<FakeActPort> = {};
  // SAFETY: the contract's keys are exactly its kinds.
  for (const kind of Object.keys(actContract) as PortActKind[]) {
    // Note that each kind is answered alike, whatever its own answer is, so it is assigned rather than typed by the kind.
    Object.assign(procedures, {
      [kind]: async (payload: WireBoundaryInput) => {
        // SAFETY: the window paired this payload with this kind, as its own procedure takes it.
        const request = (payload === undefined ? { kind } : { kind, payload }) as PortAct;
        const outcome = await answer(request);
        if (outcome.status === ACT_OUTCOME_STATUS.DONE) return outcome.value;
        if (outcome.status === ACT_OUTCOME_STATUS.REFUSED) throw refusedOnPort(outcome.reason);
        throw new Error(`Luke does not know the act ${kind}.`);
      },
    });
  }
  fakeActPort(procedures);
}
