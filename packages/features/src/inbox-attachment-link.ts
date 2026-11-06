import { type LINK_PLACE, type LinkPlace, linkOf } from "./link-grammar.js";
import { isLinkHome, LINK_HOME_PATTERN } from "./link-home.js";
import { insideCode } from "./mention-link.js";
import { parsedUrl } from "./parsed-url.js";

const FILES_STEP = "files";

const HOLDER_STEPS: ReadonlySet<string> = new Set(["plan", "task", "agent"]);

const INBOX_STEP = "inbox";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const HOLDER_ID = /^[A-Za-z0-9_-]{1,200}$/u;

const ADDRESS_IN_TEXT = new RegExp(
  `${LINK_HOME_PATTERN}\\/[^\\s/()]{1,200}\\/(?:plan|task|agent)\\/[^\\s/()]{1,200}\\/${INBOX_STEP}\\/([0-9a-f-]{36})\\/${FILES_STEP}\\/([0-9a-f-]{36})(?![\\w-])`,
  "gu",
);

const MAX_ADDRESS_CHARS = 1_024;

export const INBOX_PICTURE_IN_WORDS =
  /(?<!\\)!\[((?:\\.|[^[\]\\\n]){0,1000})\]\([ \t]*(<[^<>\n]{1,1024}>|[^\s()<>]{1,1024})/gu;

const SCHEMED = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

export type InboxItemPlace = Extract<LinkPlace, { readonly kind: typeof LINK_PLACE.INBOX_ITEM }>;

export interface InboxAttachmentRef {
  readonly itemId: string;
  readonly attachmentId: string;
}

export function inboxAttachmentAddress(
  item: InboxItemPlace,
  attachmentId: string,
  workspace: string,
): string {
  return `${linkOf(item, workspace)}/${FILES_STEP}/${attachmentId}`;
}

export function inboxAttachmentOf(address: string): InboxAttachmentRef | undefined {
  const url = address.length > MAX_ADDRESS_CHARS ? undefined : parsedUrl(address);
  if (url === undefined || !isLinkHome(url)) return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  const [first, workspace, holder, holderId, inbox, itemId, files, attachmentId, ...rest] =
    url.pathname.split("/");
  const shaped =
    first === "" &&
    workspace !== undefined &&
    workspace !== "" &&
    holder !== undefined &&
    HOLDER_STEPS.has(holder) &&
    holderId !== undefined &&
    HOLDER_ID.test(holderId) &&
    inbox === INBOX_STEP &&
    files === FILES_STEP &&
    rest.length === 0;
  if (!shaped || itemId === undefined || attachmentId === undefined) return undefined;
  if (!UUID.test(itemId) || !UUID.test(attachmentId)) return undefined;
  return { itemId, attachmentId };
}

export function inboxAttachmentIdsIn(text: string, itemId: string): readonly string[] {
  const named = new Set<string>();
  for (const [, item, attachment] of text.matchAll(ADDRESS_IN_TEXT)) {
    if (item === itemId && attachment !== undefined && UUID.test(attachment)) named.add(attachment);
  }
  return [...named];
}

export function inboxPictureDestination(destination: string): string {
  return destination.startsWith("<") ? destination.slice(1, -1) : destination;
}

export function inboxSandboxPicturePaths(text: string): readonly string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(INBOX_PICTURE_IN_WORDS)) {
    const path = inboxPictureDestination(match[2] ?? "");
    if (path !== "" && !SCHEMED.test(path) && !insideCode(text, match.index)) paths.add(path);
  }
  return [...paths];
}
