/**
 * app-bridge.ts -- the bridge and act port a test's window reaches main through: fakes answering only the calls its test gives them.
 */

import type { AppBridge } from "@luke/host/bridge";
import type {
  ActPortClient,
  PortActKind,
  PortActPayload,
  PortActResult,
} from "@luke/host/contract";
import { installActPortClient, installAppBridge } from "../app-bridge.js";

let answering: Partial<AppBridge> = {};

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
  // SAFETY: a test's window calls only the procedures its test answers, and any other is undefined and throws where it is called.
  installActPortClient(procedures as ActPortClient);
}

/** Each port kind's procedure as a test answers it: its payload in, its answer or a rejection out. */
type FakeActPort = {
  readonly [Kind in PortActKind]: (payload: PortActPayload<Kind>) => Promise<PortActResult<Kind>>;
};
