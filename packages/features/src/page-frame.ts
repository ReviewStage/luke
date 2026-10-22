/**
 * page-frame.ts -- where a page is drawn from: one version of one page, at its own `luke-page:` address.
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
 */

export const PAGE_SCHEME = "luke-page";

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
