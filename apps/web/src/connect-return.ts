/**
 * connect-return.ts -- the way back to Luke from a connect's landing page: the web app's tab that started it answering and the page closing, the address a same-tab connect left from offered, or the Mac app opened.
 *
 * A connect started in the web app opens its provider in a tab the app
 * opened itself and cut from it (`app/connect-tab.ts`), so no provider page
 * can reach the app's tab, and marks that tab with the connect's own
 * hand-off first, in the tab's session storage, which the tab keeps through
 * the provider and back; or, where the browser refused that tab, in the
 * app's own tab, which leaves the address it was at in its session storage
 * first. The landing page says once, on a broadcast channel the browser
 * delivers to this origin's pages alone, that it landed and which hand-off
 * its tab was marked with, and the app's tab that made that hand-off
 * answers it, and no other tab does, unless the connect was abandoned. The
 * page then closes, where the connect settled, or offers the way back,
 * where it did not and its words say why. A connect started on the Mac
 * lands with no mark, no tab to answer, and no address left, and the page
 * offers to open the Mac app, where the browser is on a Mac, and on any
 * other platform says its words alone. Every way back is offered in the
 * same words, Open Luke.
 */

import { LANDING_CLOSE_TAB, LANDING_TONE, type LandingWords } from "@luke/features/landing-outcome";
import type { LinkPlatform } from "@luke/features/link-open";
import type { AuthAction } from "@luke/ui";
import { Option, Schema } from "effect";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { PANEL_PATH } from "./app/web-address";
import { browserLinkPlatform } from "./link-platform";
import { OPEN_LUKE, openMacApp } from "./open-luke";

/** The broadcast channel a landing page and the app's tabs speak on. */
export const CONNECT_CHANNEL = "luke:connect";

/** What is said on the channel, each naming the landing it is about: a landing page that landed, and the app's tab that started its connect. */
export const CONNECT_SAID = { LANDED: "landed", MINE: "mine" } as const;

type ConnectSaid = (typeof CONNECT_SAID)[keyof typeof CONNECT_SAID];

/** Where, in a tab's session storage, a same-tab connect keeps the address it left from. */
const RETURN_KEY = "luke:connect-return";

/** Where, in the session storage of a tab the app opened for a connect, the app marks which hand-off the tab is. */
const HANDOFF_KEY = "luke:connect-handoff";

/** How long a connect stands for its landing, whether it left the app's tab or a tab of its own: one not back by then was abandoned. */
export const CONNECT_BOUND_MS = 30 * 60 * 1000;

/**
 * This page's own name on the channel, one for as long as it is loaded.
 * Note that a landing names itself, because every page on the channel hears
 * every answer.
 */
const LANDING = crypto.randomUUID();

/** How a landing page goes back to Luke. */
export const CONNECT_RETURN = {
  /** The app's tab that started the connect answered: this tab is its, and goes. */
  APP: "app",
  /** The app's tab came here itself: the address it left from is offered. */
  ADDRESS: "address",
  /** The Mac, or nothing answered: the Mac app opened, on a Mac. */
  ELSEWHERE: "elsewhere",
} as const;

export type ConnectReturn =
  | {
      readonly kind: typeof CONNECT_RETURN.APP | typeof CONNECT_RETURN.ADDRESS;
      readonly href: string;
    }
  | { readonly kind: typeof CONNECT_RETURN.ELSEWHERE };

/** One thing said on the channel: what it says, the landing it is about, and, from a landing whose tab the app marked, the hand-off that tab is. */
const saidSchema = Schema.Struct({
  kind: Schema.Literals(Object.values(CONNECT_SAID)),
  landing: Schema.String,
  handoff: Schema.optionalKey(Schema.String),
});

type Said = typeof saidSchema.Type;

const isSaid = Schema.is(saidSchema);

/** An address left, as session storage keeps it. */
const leftSchema = Schema.Struct({ address: Schema.String, at: Schema.Number });

const decodeLeft = Schema.decodeUnknownOption(Schema.fromJsonString(leftSchema));

/** What a message on the channel says, where it says `kind`; nothing where it says anything else. */
export function saying(event: MessageEvent, kind: ConnectSaid): Said | undefined {
  const data: unknown = event.data;
  return isSaid(data) && data.kind === kind ? data : undefined;
}

/** An address on this origin, as a path, or nothing for one that is not. */
function ownPath(address: string): string | undefined {
  if (!address.startsWith("/") || address.startsWith("//")) return undefined;
  const url = new URL(address, location.origin);
  return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : undefined;
}

/**
 * This tab's session storage, or nothing where the browser blocks the site's
 * storage, as it does for a site whose storage the person turned off: reading
 * the property then throws, and a connect simply keeps nothing in the tab.
 */
function tabSession(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The address a same-tab connect left, where it is this origin's and its connect is not yet abandoned. */
function leftAddress(): string | undefined {
  const left = decodeLeft(tabSession()?.getItem(RETURN_KEY) ?? "");
  if (Option.isNone(left) || Date.now() - left.value.at > CONNECT_BOUND_MS) return undefined;
  return ownPath(left.value.address);
}

/** The hand-off this tab was marked with, where the app opened it for a connect. */
function markedHandoff(): string | undefined {
  return tabSession()?.getItem(HANDOFF_KEY) ?? undefined;
}

/** Keeps the address the app's tab leaves from, for the landing page it comes back through. */
export function rememberReturn(address: string): void {
  tabSession()?.setItem(RETURN_KEY, JSON.stringify({ address, at: Date.now() }));
}

/**
 * Marks a tab the app opened for a connect as the hand-off given, in the
 * tab's own session storage, while the tab is still this origin's empty
 * page. A tab whose storage the browser refuses goes unmarked, so its
 * landing is answered by no tab and says to return to Luke.
 */
export function markHandoff(
  tab: { readonly sessionStorage: Pick<Storage, "setItem"> },
  handoff: string,
): void {
  try {
    tab.sessionStorage.setItem(HANDOFF_KEY, handoff);
  } catch {
    console.warn("A connect's tab could not be marked; its landing will say to return to Luke.");
  }
}

/** Lets go of what a connect left in this tab, the address it left from and the hand-off it was marked as, as the app does once it stands in the tab again. */
export function forgetReturn(): void {
  const session = tabSession();
  session?.removeItem(RETURN_KEY);
  session?.removeItem(HANDOFF_KEY);
}

/** How this landing page goes back to Luke before any tab has answered. */
export function connectReturn(): ConnectReturn {
  const left = leftAddress();
  return left === undefined
    ? { kind: CONNECT_RETURN.ELSEWHERE }
    : { kind: CONNECT_RETURN.ADDRESS, href: left };
}

/**
 * Open Luke pressed in a tab the app opened: the tab closes, the app's
 * own standing behind it; where the browser keeps it open, the link opens
 * the app here.
 */
function closeToApp(event: MouseEvent<HTMLAnchorElement>): void {
  window.close();
  if (window.closed) event.preventDefault();
}

/**
 * Open Luke as a page offers it on `platform`: closing this tab back to the
 * app's where that tab answered, the address a same-tab connect left from,
 * or, where neither, the Mac app at its home, on a Mac; nothing on any other
 * platform, where there is no app to open and the page's words stand alone.
 */
function openLuke(back: ConnectReturn, platform: LinkPlatform): AuthAction | undefined {
  switch (back.kind) {
    case CONNECT_RETURN.APP:
      return { label: OPEN_LUKE, href: back.href, onClick: closeToApp };
    case CONNECT_RETURN.ADDRESS:
      return { label: OPEN_LUKE, href: back.href };
    case CONNECT_RETURN.ELSEWHERE:
      return openMacApp(platform);
  }
}

/**
 * What a landing says under its title: the outcome's line, and, where the
 * outcome settled in a tab of its own, that the tab can go. A same-tab
 * connect's landing is the app's own tab, which says nothing of closing.
 */
export function landingDescription(words: LandingWords, back: ConnectReturn): string | undefined {
  const closes = words.tone === LANDING_TONE.SETTLED && back.kind !== CONNECT_RETURN.ADDRESS;
  const said = [words.line, closes ? LANDING_CLOSE_TAB : undefined].filter(
    (part): part is string => part !== undefined,
  );
  return said.length === 0 ? undefined : said.join(" ");
}

/** The way back as a landing page offers it: where it came from, and Open Luke, where there is one. */
export interface LandingReturn {
  readonly back: ConnectReturn;
  readonly open: AuthAction | undefined;
}

/**
 * The way back, once the page is a landing: a page the connect only passes
 * through (`connect-github.tsx` before its link ends) says nothing yet. A
 * landing lets go of what its connect left, so it is offered by this
 * landing alone, and says once that it landed, under its own name, so an
 * answer to another landing open beside it is not taken for its own, and
 * with the hand-off its tab was marked as, which only the app's tab that
 * made it answers. That answer makes this tab the app's, which closes where
 * the connect `settled` and otherwise stays to say why, offering the way
 * back. A page that has not landed offers none yet.
 */
export function useConnectReturn(state: {
  readonly landed: boolean;
  readonly settled: boolean;
}): LandingReturn {
  const { landed, settled } = state;
  const [read] = useState(connectReturn);
  const [answered, setAnswered] = useState(false);
  // Whether this page has said it landed, which it says once however often its channel opens.
  const said = useRef(false);
  useEffect(() => {
    if (!landed) return;
    const channel = new BroadcastChannel(CONNECT_CHANNEL);
    channel.onmessage = (event) => {
      if (saying(event, CONNECT_SAID.MINE)?.landing === LANDING) setAnswered(true);
    };
    if (!said.current) {
      said.current = true;
      // Note that the mark is read before it is let go of, because it names the one tab that answers.
      const handoff = markedHandoff();
      forgetReturn();
      const landedSaying: Said = { kind: CONNECT_SAID.LANDED, landing: LANDING };
      channel.postMessage(handoff === undefined ? landedSaying : { ...landedSaying, handoff });
    }
    return () => channel.close();
  }, [landed]);
  useEffect(() => {
    if (answered && settled) window.close();
  }, [answered, settled]);
  if (!landed) return { back: { kind: CONNECT_RETURN.ELSEWHERE }, open: undefined };
  const back: ConnectReturn = answered ? { kind: CONNECT_RETURN.APP, href: PANEL_PATH } : read;
  return { back, open: openLuke(back, browserLinkPlatform()) };
}
