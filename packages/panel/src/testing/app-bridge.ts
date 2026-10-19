/**
 * app-bridge.ts -- the bridge and act port a test's window reaches main through: fakes answering only the calls its test gives them.
 */

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
