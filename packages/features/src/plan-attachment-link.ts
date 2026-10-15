import { isLinkHome, LINK_HOME } from "./link-home.js";
import { encodeMention, MENTION_KIND } from "./mention-link.js";

/**
 * plan-attachment-link.ts -- a plan's picture as its address on tryluke.dev: written, read back, and found in a plan's text.
 *
 * A picture stands in a plan's Markdown as `![alt](<address> "caption")`,
 * its address the plan's own, `https://tryluke.dev/<workspace>/plan/<plan>`
 * (`mention-link.ts`), with `/files/<picture>` after it. The address is a
 * real one on purpose: opened in a browser it lands on the "Open in Luke"
 * page, which opens the plan and reveals nothing, and pasted anywhere else it
 * names a picture only the plan's readers can fetch, through the service
 * on their own sign-in. Nothing here reaches the bytes.
 */

/** The step the picture's id follows in its address. */
const FILES_STEP = "files";

/** An id as the service mints one: a UUID in lower case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Every picture address in a text, by either scheme, its plan's id and its own; a workspace
 * step is any run that holds no slash, space, or parenthesis, bounded, so
 * the scan stays linear over any text, and the picture's id ends the
 * address, so a broken one that only begins with an id names nothing.
 */
const ADDRESS_IN_TEXT = new RegExp(
  `(?:https|${LINK_HOME.APP_SCHEME}):\\/\\/${LINK_HOME.HOST.replaceAll(".", "\\.")}\\/[^\\s/()]{1,200}\\/plan\\/([0-9a-f-]{36})\\/files\\/([0-9a-f-]{36})(?![\\w-])`,
  "gu",
);

/** The most characters an address is read from; past this no picture's address is that long. */
const MAX_ADDRESS_CHARS = 512;

/** One picture of one plan. */
export interface PlanAttachmentRef {
  readonly planId: string;
  readonly attachmentId: string;
}

/** The address parsed, or nothing for text that is no URL; a constructor, since `URL.canParse` is missing from Safari before 17. */
function parsedUrl(address: string): URL | undefined {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
}

/** The picture's address, under the workspace the plan's own address names. */
export function planAttachmentAddress(ref: PlanAttachmentRef, workspace: string): string {
  const plan = encodeMention(
    { kind: MENTION_KIND.PLAN, planId: ref.planId },
    { workspace, repository: null },
  );
  return `${plan}/${FILES_STEP}/${ref.attachmentId}`;
}

/** The picture an address names, by either scheme; nothing for any other address, a plan's or a section's among them. */
export function planAttachmentOf(address: string): PlanAttachmentRef | undefined {
  const url = address.length > MAX_ADDRESS_CHARS ? undefined : parsedUrl(address);
  if (url === undefined || !isLinkHome(url)) return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  const [first, workspace, step, planId, files, attachmentId, ...rest] = url.pathname.split("/");
  const shaped =
    first === "" &&
    workspace !== undefined &&
    workspace !== "" &&
    step === "plan" &&
    files === FILES_STEP &&
    rest.length === 0;
  if (!shaped || planId === undefined || attachmentId === undefined) return undefined;
  if (!UUID.test(planId) || !UUID.test(attachmentId)) return undefined;
  return { planId, attachmentId };
}

/** The ids of the plan's own pictures its text names, in the order first named, each once. */
export function planAttachmentIdsIn(text: string, planId: string): readonly string[] {
  const named = new Set<string>();
  for (const [, plan, attachment] of text.matchAll(ADDRESS_IN_TEXT)) {
    if (plan === planId && attachment !== undefined && UUID.test(attachment)) named.add(attachment);
  }
  return [...named];
}
