/**
 * connect-return.ts -- the way back to Luke from a connect's landing page: the web app's tab that started it answering and the page closing, the address a same-tab connect left from offered, or the words alone for the Mac.
 *
 * A connect started in the web app opens its provider in a tab the app
 * opened itself and cut from it (`app/connect-tab.ts`), so no provider page
 * can reach the app's tab; or, where the browser refused that tab, in the
 * app's own tab, which leaves the address it was at in this tab's session
 * storage first. The landing page says it landed on a broadcast channel,
 * which the browser delivers to this origin's pages alone, and the app's
 * tab that handed a connect off answers it; the page then closes, where the
 * connect settled, or offers the way back, where it did not and its words
 * say why. A connect started on the Mac lands with no tab to answer and no
 * address left, and the page says to return to Luke, as it always has.
 */

import { Option, Schema } from "effect";
import { type MouseEvent, useEffect, useState } from "react";

/** The broadcast channel a landing page and the app's tabs speak on. */
export const CONNECT_CHANNEL = "luke:connect";

/** What is said on the channel, each naming the landing it is about: a landing page that landed, and the app's tab that started its connect. */
export const CONNECT_SAID = { LANDED: "landed", MINE: "mine" } as const;

/** Where, in a tab's session storage, a same-tab connect keeps the address it left from. */
const RETURN_KEY = "luke:connect-return";

/** How long an address left stands for its landing: a connect not back by then was abandoned. */
const RETURN_BOUND_MS = 30 * 60 * 1000;

/**
 * This page's own name on the channel, one for as long as it is loaded.
 * Note that a landing names itself, because every page on the channel hears
 * every answer.
 */
const LANDING = crypto.randomUUID();

/** Where the web app's panel is served, the way back when no address was left. */
const APP_PATH = "/app";

/** The words every way back is offered in. */
export const BACK_TO_LUKE = "Back to Luke";

/** How a landing page goes back to Luke. */
export const CONNECT_RETURN = {
  /** The app's tab that started the connect answered: this tab is its, and goes. */
  APP: "app",
  /** The app's tab came here itself: the address it left from is offered. */
  ADDRESS: "address",
  /** The Mac, or nothing answered: the words alone. */
  ELSEWHERE: "elsewhere",
} as const;

export type ConnectReturn =
  | {
      readonly kind: typeof CONNECT_RETURN.APP | typeof CONNECT_RETURN.ADDRESS;
      readonly href: string;
    }
  | { readonly kind: typeof CONNECT_RETURN.ELSEWHERE };

/** One thing said on the channel. */
const isSaid = Schema.is(
  Schema.Struct({ kind: Schema.Literals(Object.values(CONNECT_SAID)), landing: Schema.String }),
);

/** An address left, as session storage keeps it. */
const leftSchema = Schema.Struct({ address: Schema.String, at: Schema.Number });

const decodeLeft = Schema.decodeUnknownOption(Schema.fromJsonString(leftSchema));

/** The landing a message on the channel names, where it says `kind`; nothing where it says anything else. */
export function landingSaying(
  event: MessageEvent,
  kind: (typeof CONNECT_SAID)[keyof typeof CONNECT_SAID],
): string | undefined {
  const data = event.data;
  return isSaid(data) && data.kind === kind ? data.landing : undefined;
}

/** An address on this origin, as a path, or nothing for one that is not. */
function ownPath(address: string): string | undefined {
  if (!address.startsWith("/") || address.startsWith("//")) return undefined;
  const url = new URL(address, location.origin);
  return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : undefined;
}

/** The address a same-tab connect left, where it is this origin's and its connect is not yet abandoned. */
function leftAddress(): string | undefined {
  const left = decodeLeft(sessionStorage.getItem(RETURN_KEY) ?? "");
  if (Option.isNone(left) || Date.now() - left.value.at > RETURN_BOUND_MS) return undefined;
  return ownPath(left.value.address);
}

/** Keeps the address the app's tab leaves from, for the landing page it comes back through. */
export function rememberReturn(address: string): void {
  sessionStorage.setItem(RETURN_KEY, JSON.stringify({ address, at: Date.now() }));
}

/** Lets go of an address left, as the app does once it stands in the tab again. */
export function forgetReturn(): void {
  sessionStorage.removeItem(RETURN_KEY);
}

/** How this landing page goes back to Luke before any tab has answered. */
export function connectReturn(): ConnectReturn {
  const left = leftAddress();
  return left === undefined
    ? { kind: CONNECT_RETURN.ELSEWHERE }
    : { kind: CONNECT_RETURN.ADDRESS, href: left };
}

/**
 * Back to Luke pressed in a tab the app opened: the tab closes, the app's
 * own standing behind it; where the browser keeps it open, the link opens
 * the app here.
 */
function closeToApp(event: MouseEvent<HTMLAnchorElement>): void {
  window.close();
  if (window.closed) event.preventDefault();
}

/** The way back as a landing page offers it, and what its press does first. */
export interface LandingReturn {
  readonly back: ConnectReturn;
  readonly onBack: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
}

/**
 * The way back, once the page is a landing: a page the connect only passes
 * through (`connect-github.tsx` before its link ends) says nothing yet. A
 * landing lets go of the address left, so it is offered by this landing
 * alone, and says it landed under its own name, so an answer to another
 * landing open beside it is not taken for its own. The app's tab answering
 * makes this tab the app's, which closes where the connect `settled` and
 * otherwise stays to say why, offering the way back.
 */
export function useConnectReturn(state: {
  readonly landed: boolean;
  readonly settled: boolean;
}): LandingReturn {
  const { landed, settled } = state;
  const [read] = useState(connectReturn);
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (!landed) return;
    forgetReturn();
    const channel = new BroadcastChannel(CONNECT_CHANNEL);
    channel.onmessage = (event) => {
      if (landingSaying(event, CONNECT_SAID.MINE) !== LANDING) return;
      setAnswered(true);
      if (settled) window.close();
    };
    channel.postMessage({ kind: CONNECT_SAID.LANDED, landing: LANDING });
    return () => channel.close();
  }, [landed, settled]);
  if (!landed) return { back: { kind: CONNECT_RETURN.ELSEWHERE }, onBack: undefined };
  if (answered) return { back: { kind: CONNECT_RETURN.APP, href: APP_PATH }, onBack: closeToApp };
  return { back: read, onBack: undefined };
}
