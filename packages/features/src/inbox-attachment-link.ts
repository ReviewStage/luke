import { isLinkHome, LINK_HOME } from "./link-home.js";
import { type LINK_PLACE, type LinkPlace, linkOf } from "./luke-link.js";
import { insideCode } from "./mention-link.js";

/**
 * inbox-attachment-link.ts -- a picture in an Inbox item's Markdown as its address on tryluke.dev: written, read back, and found in the item's words.
 *
 * A message on an item's thread, its agent's or a member's, draws a picture
 * as a plan does, `![alt](<address> "caption")`, its address the item's own
 * link (`luke-link.ts`) with `/files/<attachment>` after it, as a plan's
 * picture stands under its plan's (`plan-attachment-link.ts`):
 * `https://tryluke.dev/<workspace>/plan/<task>/inbox/<item>/files/<attachment>`,
 * or `/agent/<agent>/inbox/<item>/files/<attachment>` for an item of an
 * agent with no task. The address is a real one on purpose: opened in a
 * browser it lands on the item, which opens to its readers alone, and
 * pasted anywhere else it names a picture only the item's readers can
 * fetch. The item and the attachment are what the picture is read by;
 * the workspace and the holder are the link's, read and never trusted.
 * Nothing here reaches the bytes. Before it is kept, the agent's picture
 * names a file in its sandbox by its path, which the post reads there and
 * writes as its address; a path is any destination naming no scheme.
 */

/** The step the picture's id follows in its address. */
const FILES_STEP = "files";

/** The steps a holder of an item is named under: a task, by either spelling, or an agent with no task. */
const HOLDER_STEPS: ReadonlySet<string> = new Set(["plan", "task", "agent"]);

/** The step an item's id follows. */
const INBOX_STEP = "inbox";

/** An id as the service mints one: a UUID in lower case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A holder's id, as a link spells one: letters, digits, `_`, and `-`. */
const HOLDER_ID = /^[A-Za-z0-9_-]{1,200}$/u;

/**
 * Every picture address of an item in a text, by either scheme, the item's
 * id and the picture's; each step before them any run that holds no slash,
 * space, or parenthesis, bounded, so the scan stays linear over any text,
 * and the picture's id ends the address.
 */
const ADDRESS_IN_TEXT = new RegExp(
  `(?:https|${LINK_HOME.APP_SCHEME}):\\/\\/${LINK_HOME.HOST.replaceAll(".", "\\.")}\\/[^\\s/()]{1,200}\\/(?:plan|task|agent)\\/[^\\s/()]{1,200}\\/${INBOX_STEP}\\/([0-9a-f-]{36})\\/${FILES_STEP}\\/([0-9a-f-]{36})(?![\\w-])`,
  "gu",
);

/** The most characters an address is read from; past this no picture's address is that long. */
const MAX_ADDRESS_CHARS = 1_024;

/**
 * A picture in a message's words, `![alt](destination`, its opening
 * unescaped: the alt text the first group, the destination, bare or in
 * angle brackets, the second; each bounded, so the scan stays linear.
 */
export const INBOX_PICTURE_IN_WORDS =
  /(?<!\\)!\[((?:\\.|[^[\]\\\n]){0,1000})\]\([ \t]*(<[^<>\n]{1,1024}>|[^\s()<>]{1,1024})/gu;

/** A destination that names a scheme, `https:`, `data:`, or Luke's own, and so no file in the agent's sandbox. */
const SCHEMED = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

/** An item of the Inbox as its link names it: under its task, or under its agent with no task. */
export type InboxItemPlace = Extract<LinkPlace, { readonly kind: typeof LINK_PLACE.INBOX_ITEM }>;

/** One picture of one Inbox item. */
export interface InboxAttachmentRef {
  readonly itemId: string;
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

/** The picture's address: the item's own link under the workspace given, its id after it. */
export function inboxAttachmentAddress(
  item: InboxItemPlace,
  attachmentId: string,
  workspace: string,
): string {
  return `${linkOf(item, workspace)}/${FILES_STEP}/${attachmentId}`;
}

/** The item's picture an address names, by either scheme; nothing for any other address, the item's own among them. */
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

/** The ids of the item's own pictures a text names, in the order first named, each once. */
export function inboxAttachmentIdsIn(text: string, itemId: string): readonly string[] {
  const named = new Set<string>();
  for (const [, item, attachment] of text.matchAll(ADDRESS_IN_TEXT)) {
    if (item === itemId && attachment !== undefined && UUID.test(attachment)) named.add(attachment);
  }
  return [...named];
}

/** A picture's destination as the path or address it names, out of its angle brackets. */
export function inboxPictureDestination(destination: string): string {
  return destination.startsWith("<") ? destination.slice(1, -1) : destination;
}

/**
 * The path in the agent's sandbox of every picture its words draw from a
 * file there, in the order first drawn, each once: a destination that
 * names no scheme, read as the post's own write reads it, so a picture in
 * code is none.
 */
export function inboxSandboxPicturePaths(text: string): readonly string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(INBOX_PICTURE_IN_WORDS)) {
    const path = inboxPictureDestination(match[2] ?? "");
    if (path !== "" && !SCHEMED.test(path) && !insideCode(text, match.index)) paths.add(path);
  }
  return [...paths];
}
