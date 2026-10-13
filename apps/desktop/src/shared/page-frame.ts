/**
 * page-frame.ts -- where a plan's page is drawn from: one version of one page, at its own `luke-page:` address.
 *
 * The window's process serves the scheme, reading the version from the
 * service on the account's own bearer, so the frame that draws a page holds
 * an address and never a credential. The address names the plan, the page,
 * and the version by the ids the service gave them, and nothing else: no
 * query, no fragment, and one host for every page, since the frame's sandbox
 * gives each page an opaque origin of its own whatever the address says.
 */

export const PAGE_SCHEME = "luke-page";

const PAGE_HOST = "page";

/** The page one address names. */
export interface FramedPage {
  readonly planId: string;
  readonly pageId: string;
  readonly version: number;
}

/** The address one version of one page is drawn from. */
export function pageFrameUrl(page: FramedPage): string {
  return `${PAGE_SCHEME}://${PAGE_HOST}/${page.planId}/${page.pageId}/${page.version}`;
}

/** The page an address names, where it names exactly one in the shape `pageFrameUrl` writes; nothing for any other. */
export function framedPageOf(url: string): FramedPage | undefined {
  const parsed = URL.parse(url);
  if (parsed === null || parsed.protocol !== `${PAGE_SCHEME}:` || parsed.host !== PAGE_HOST) {
    return undefined;
  }
  if (parsed.search !== "" || parsed.hash !== "") return undefined;
  const [planId, pageId, version, ...rest] = parsed.pathname.slice(1).split("/");
  const number = Number(version);
  if (planId === undefined || pageId === undefined || rest.length > 0) return undefined;
  if (planId === "" || pageId === "" || !Number.isSafeInteger(number) || number < 1) {
    return undefined;
  }
  return { planId, pageId, version: number };
}
