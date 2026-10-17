/**
 * app-bridge.ts -- the bridge a test's window reaches main through: a fake answering only the calls its test gives it.
 */

import type { AppBridge } from "@luke/host/bridge";
import { installAppBridge } from "../renderer/app-bridge";

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
