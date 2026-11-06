import { Schema as EffectSchema } from "effect";

export const PAGE_SCHEME = "app-page";

export const PAGE_SANDBOX_ORIGIN = "https://vespin.page";

export const PAGE_IN_MAC_APP_PATH = "/page-in-mac-app";

export const PAGE_FRAME_STATUS = 303;

export const pageFrameAnswerSchema = EffectSchema.Struct({
  status: EffectSchema.Literal(PAGE_FRAME_STATUS),
  headers: EffectSchema.Struct({
    location: EffectSchema.String,
    "referrer-policy": EffectSchema.Literal("no-referrer"),
  }),
});

export type PageFrameAnswer = typeof pageFrameAnswerSchema.Type;

const PAGE_HOST = "page";

const AGENT_STEP = "agent";

export type FramedPage =
  | { readonly taskId: string; readonly pageId: string; readonly version: number }
  | { readonly agentId: string; readonly pageId: string; readonly version: number };

export function pageFrameUrl(page: FramedPage): string {
  const owner = "agentId" in page ? `${AGENT_STEP}/${page.agentId}` : page.taskId;
  return `${PAGE_SCHEME}://${PAGE_HOST}/${owner}/${page.pageId}/${page.version}`;
}

export function hostedPageFramePath(page: FramedPage): string {
  return "agentId" in page
    ? `/api/agents/${page.agentId}/pages/${page.pageId}/versions/${page.version}/frame`
    : `/api/plans/${page.taskId}/pages/${page.pageId}/versions/${page.version}/frame`;
}

function versionOf(spelled: string | undefined): number | undefined {
  const number = Number(spelled);
  return String(number) === spelled && number >= 1 ? number : undefined;
}

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
