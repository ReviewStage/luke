import { LANDING_CLOSE_TAB, LANDING_TONE, type LandingWords } from "@repo/features/landing-outcome";
import type { LinkPlatform } from "@repo/features/link-open";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { AuthAction } from "@repo/ui";
import { Option, Schema } from "effect";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { PANEL_PATH } from "./app/web-address";
import { browserLinkPlatform } from "./link-platform";
import { OPEN_APP, openMacApp } from "./open-app";

export const CONNECT_CHANNEL = "app:connect";

export const CONNECT_SAID = { LANDED: "landed", MINE: "mine" } as const;

type ConnectSaid = (typeof CONNECT_SAID)[keyof typeof CONNECT_SAID];

const RETURN_KEY = "app:connect-return";

const HANDOFF_KEY = "app:connect-handoff";

export const CONNECT_BOUND_MS = 30 * 60 * 1000;

const LANDING = crypto.randomUUID();

export const CONNECT_RETURN = {
  APP: "app",
  ADDRESS: "address",
  ELSEWHERE: "elsewhere",
} as const;

export type ConnectReturn =
  | {
      readonly kind: typeof CONNECT_RETURN.APP | typeof CONNECT_RETURN.ADDRESS;
      readonly href: string;
    }
  | { readonly kind: typeof CONNECT_RETURN.ELSEWHERE };

const saidSchema = Schema.Struct({
  kind: Schema.Literals(Object.values(CONNECT_SAID)),
  landing: Schema.String,
  handoff: Schema.optionalKey(Schema.String),
});

type Said = typeof saidSchema.Type;

const isSaid = Schema.is(saidSchema);

const leftSchema = Schema.Struct({ address: Schema.String, at: Schema.Number });

const decodeLeft = Schema.decodeUnknownOption(Schema.fromJsonString(leftSchema));

export function saying(event: MessageEvent, kind: ConnectSaid): Said | undefined {
  const data: unknown = event.data;
  return isSaid(data) && data.kind === kind ? data : undefined;
}

function ownPath(address: string): string | undefined {
  if (!address.startsWith("/") || address.startsWith("//")) return undefined;
  const url = new URL(address, location.origin);
  return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : undefined;
}

function tabSession(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function leftAddress(): string | undefined {
  const left = decodeLeft(tabSession()?.getItem(RETURN_KEY) ?? "");
  if (Option.isNone(left) || Date.now() - left.value.at > CONNECT_BOUND_MS) return undefined;
  return ownPath(left.value.address);
}

function markedHandoff(): string | undefined {
  return tabSession()?.getItem(HANDOFF_KEY) ?? undefined;
}

export function rememberReturn(address: string): void {
  tabSession()?.setItem(RETURN_KEY, JSON.stringify({ address, at: Date.now() }));
}

export function markHandoff(
  tab: { readonly sessionStorage: Pick<Storage, "setItem"> },
  handoff: string,
): void {
  try {
    tab.sessionStorage.setItem(HANDOFF_KEY, handoff);
  } catch {
    console.warn(
      `A connect's tab could not be marked; its landing will say to return to ${PRODUCT_NAME}.`,
    );
  }
}

export function forgetReturn(): void {
  const session = tabSession();
  session?.removeItem(RETURN_KEY);
  session?.removeItem(HANDOFF_KEY);
}

export function connectReturn(): ConnectReturn {
  const left = leftAddress();
  return left === undefined
    ? { kind: CONNECT_RETURN.ELSEWHERE }
    : { kind: CONNECT_RETURN.ADDRESS, href: left };
}

function closeToApp(event: MouseEvent<HTMLAnchorElement>): void {
  window.close();
  if (window.closed) event.preventDefault();
}

function openApp(back: ConnectReturn, platform: LinkPlatform): AuthAction | undefined {
  switch (back.kind) {
    case CONNECT_RETURN.APP:
      return { label: OPEN_APP, href: back.href, onClick: closeToApp };
    case CONNECT_RETURN.ADDRESS:
      return { label: OPEN_APP, href: back.href };
    case CONNECT_RETURN.ELSEWHERE:
      return openMacApp(platform);
  }
}

export function landingDescription(words: LandingWords, back: ConnectReturn): string | undefined {
  const closes = words.tone === LANDING_TONE.COMPLETE && back.kind !== CONNECT_RETURN.ADDRESS;
  const said = [words.line, closes ? LANDING_CLOSE_TAB : undefined].filter(
    (part): part is string => part !== undefined,
  );
  return said.length === 0 ? undefined : said.join(" ");
}

export interface LandingReturn {
  readonly back: ConnectReturn;
  readonly open: AuthAction | undefined;
}

export function useConnectReturn(state: {
  readonly landed: boolean;
  readonly settled: boolean;
}): LandingReturn {
  const { landed, settled } = state;
  const [read] = useState(connectReturn);
  const [answered, setAnswered] = useState(false);
  const said = useRef(false);
  useEffect(() => {
    if (!landed) return;
    const channel = new BroadcastChannel(CONNECT_CHANNEL);
    channel.onmessage = (event) => {
      if (saying(event, CONNECT_SAID.MINE)?.landing === LANDING) setAnswered(true);
    };
    if (!said.current) {
      said.current = true;
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
  return { back, open: openApp(back, browserLinkPlatform()) };
}
