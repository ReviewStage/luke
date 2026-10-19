/**
 * app-bridge.ts -- the bridge and act port a test's window reaches main through: fakes answering only the calls its test gives them.
 */

import type { AppBridge } from "@luke/host/bridge";
import {
  ACT_ERROR,
  type ActPortClient,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  TASKS_ACT_KIND,
} from "@luke/host/contract";
import { ORPCError } from "@orpc/client";
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

/** A procedure's refusal as the act port answers it: the declared error, carrying `sentence`. */
export function refusedOnPort(sentence: string): ORPCError<string, unknown> {
  return new ORPCError(ACT_ERROR.REFUSED, { message: sentence });
}

/** A page a press opened in the browser, as the act that opened it. */
export interface OpenedLink {
  readonly kind: typeof TASKS_ACT_KIND.GITHUB_OPEN | typeof TASKS_ACT_KIND.WEB_OPEN;
  readonly payload: { readonly url: string };
}

/**
 * The act port's two link openers, each handing `opened` the page it opened
 * as the act it was, for a test to spread into its `fakeActPort`.
 */
export function openingLinks(
  opened: (link: OpenedLink) => void,
): Pick<FakeActPort, OpenedLink["kind"]> {
  return {
    [TASKS_ACT_KIND.GITHUB_OPEN]: ({ url }) => {
      opened({ kind: TASKS_ACT_KIND.GITHUB_OPEN, payload: { url } });
      return Promise.resolve();
    },
    [TASKS_ACT_KIND.WEB_OPEN]: ({ url }) => {
      opened({ kind: TASKS_ACT_KIND.WEB_OPEN, payload: { url } });
      return Promise.resolve();
    },
  };
}

/** Each port kind's procedure as a test answers it: its payload in, its answer or a rejection out. */
type FakeActPort = {
  readonly [Kind in PortActKind]: (payload: PortActPayload<Kind>) => Promise<PortActResult<Kind>>;
};
