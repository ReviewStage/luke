/**
 * page-frame.ts -- where a page is drawn from: one version of one page, at its own `app-page:` address on the Mac, and on the sandbox's own site on the web.
 *
 * The window's process serves the scheme, reading the version from the
 * service on the account's own bearer, so the frame that draws a page holds
 * an address and never a credential. The address names what the page stands
 * on, the page, and the version by the ids the service gave them, and
 * nothing else: no query, no fragment, and one host for every page, since
 * the frame's sandbox gives each page an opaque origin of its own whatever
 * the address says. A page on a task is `/<taskId>/<pageId>/<version>`, and
 * one a coding agent on no task showed is `/agent/<agentId>/<pageId>/<version>`;
 * a task's id is a uuid, so it is never the word `agent`.
 *
 * A browser has no scheme of our own, so the web draws a page from a site
 * of its own instead (`PAGE_SANDBOX_ORIGIN`). Its frame loads the version
 * through the service's same-origin answer, which sends it on to a link
 * minted for the account that asked, or to the page saying pages open in the
 * Mac app where the deployment has no sandbox (`PAGE_IN_MAC_APP_PATH`).
 */

import { Schema as EffectSchema } from "effect";

export const PAGE_SCHEME = "app-page";

/**
 * The sandbox's own site, where the web draws a page: a registrable domain
 * apart from the app's, so nothing a page runs shares a site with the app or
 * is sent its cookie. The deployment's routing (the root `vercel.json`) locks
 * this host to the page route and lets the app frame it, and the service
 * serves pages there only where `AGENT_PAGES_ORIGIN` names it.
 */
export const PAGE_SANDBOX_ORIGIN = "https://vespin.page";

/** What a page's frame shows on the web where the deployment has no sandbox: the site's page saying pages open in the Mac app. */
export const PAGE_IN_MAC_APP_PATH = "/page-in-mac-app.html";

/** The status a page frame's load is answered with: See Other, the address the version is drawn from. */
export const PAGE_FRAME_STATUS = 303;

/**
 * A page frame's load as the service answers it: sent on to the address the
 * version is drawn from, which no cache keeps and no referrer carries on,
 * since a link minted for one account stands in it.
 */
export const pageFrameAnswerSchema = EffectSchema.Struct({
  status: EffectSchema.Literal(PAGE_FRAME_STATUS),
  headers: EffectSchema.Struct({
    location: EffectSchema.String,
    "referrer-policy": EffectSchema.Literal("no-referrer"),
  }),
});

export type PageFrameAnswer = typeof pageFrameAnswerSchema.Type;

const PAGE_HOST = "page";

/** The step an agent's page is framed under, before the agent's id. */
const AGENT_STEP = "agent";

/** The page one address names: on a task, or on a coding agent with no task. */
export type FramedPage =
  | { readonly taskId: string; readonly pageId: string; readonly version: number }
  | { readonly agentId: string; readonly pageId: string; readonly version: number };

/** The address one version of one page is drawn from. */
export function pageFrameUrl(page: FramedPage): string {
  const owner = "agentId" in page ? `${AGENT_STEP}/${page.agentId}` : page.taskId;
  return `${PAGE_SCHEME}://${PAGE_HOST}/${owner}/${page.pageId}/${page.version}`;
}

/**
 * The path a browser's frame loads one version of one page through, on the
 * app's own origin: the service's frame of the version, which answers with
 * where the page is drawn from, so the frame's address holds no link of its
 * own and every load asks for a fresh one.
 */
export function hostedPageFramePath(page: FramedPage): string {
  return "agentId" in page
    ? `/api/agents/${page.agentId}/pages/${page.pageId}/versions/${page.version}/frame`
    : `/api/plans/${page.taskId}/pages/${page.pageId}/versions/${page.version}/frame`;
}

/** The version a frame's address spells, read only as `pageFrameUrl` spells it, so `02` or `2e0` names nothing. */
function versionOf(spelled: string | undefined): number | undefined {
  const number = Number(spelled);
  return String(number) === spelled && number >= 1 ? number : undefined;
}

/** The page an address names, where it names exactly one in the shape `pageFrameUrl` writes; nothing for any other. */
export function framedPageOf(url: string): FramedPage | undefined {
  const parsed = URL.parse(url);
  if (parsed === null || parsed.protocol !== `${PAGE_SCHEME}:` || parsed.host !== PAGE_HOST) {
    return undefined;
  }
  if (parsed.search !== "" || parsed.hash !== "") return undefined;
  const steps = parsed.pathname.slice(1).split("/");
  if (steps.some((step) => step === "")) return undefined;
  if (steps[0] === AGENT_STEP) {
    const [, agentId, pageId, spelled, ...rest] = steps;
    const version = versionOf(spelled);
    if (agentId === undefined || pageId === undefined || version === undefined) return undefined;
    return rest.length > 0 ? undefined : { agentId, pageId, version };
  }
  const [taskId, pageId, spelled, ...rest] = steps;
  const version = versionOf(spelled);
  if (taskId === undefined || pageId === undefined || version === undefined) return undefined;
  return rest.length > 0 ? undefined : { taskId, pageId, version };
}
