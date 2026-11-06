import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";
import { openTargetOf } from "./open-address.js";
import { parsedUrl } from "./parsed-url.js";
import { PRODUCT_NAME } from "./product-name.js";

export const LINK_OPEN = {
  BROWSER: "browser",
  MAC_APP: "mac-app",
} as const;

export type LinkOpen = (typeof LINK_OPEN)[keyof typeof LINK_OPEN];

export const LINK_OPEN_LIST: readonly LinkOpen[] = [LINK_OPEN.BROWSER, LINK_OPEN.MAC_APP];

export const LINK_OPEN_LABEL = {
  [LINK_OPEN.BROWSER]: "Browser",
  [LINK_OPEN.MAC_APP]: `${PRODUCT_NAME} for Mac`,
} as const satisfies Record<LinkOpen, string>;

export const LINK_PLATFORM = {
  MAC: "mac",
  OTHER: "other",
} as const;

export type LinkPlatform = (typeof LINK_PLATFORM)[keyof typeof LINK_PLATFORM];

const STAY_ON_WEB = { QUERY: "stay", VALUE: "web" } as const;

export function stayingOnWeb(link: string): string {
  const url = new URL(link);
  url.searchParams.set(STAY_ON_WEB.QUERY, STAY_ON_WEB.VALUE);
  return url.href;
}

export function withoutStayOnWeb(address: string): string | undefined {
  const url = parsedUrl(address);
  if (url?.searchParams.get(STAY_ON_WEB.QUERY) !== STAY_ON_WEB.VALUE) return undefined;
  url.searchParams.delete(STAY_ON_WEB.QUERY);
  return url.href;
}

const readsLinkOpen = Schema.is(Schema.Literals(LINK_OPEN_LIST));

export function isLinkOpen(value: UnparsedWireValue): value is LinkOpen {
  return readsLinkOpen(value);
}

export function linkOpenTarget(
  preference: LinkOpen,
  platform: LinkPlatform,
  address: string,
): string | undefined {
  if (preference !== LINK_OPEN.MAC_APP || platform !== LINK_PLATFORM.MAC) return undefined;
  const url = parsedUrl(address);
  return url === undefined ? undefined : openTargetOf(url.pathname, url.hash, url.search)?.appLink;
}
