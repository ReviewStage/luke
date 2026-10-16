import { isLinkHome, LINK_HOME } from "./link-home.js";
import { encodeMention, insideCode, MENTION_KIND } from "./mention-link.js";

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

/** An image's opening, `![`, whose `!` no backslash escapes: none, or an even run of them, stands before it. */
const PICTURE_OPENER = String.raw`(?<!(?<!\\)(?:\\\\)*\\)!\[`;

/** An image's alt text: escaped characters, bracketed phrases one level deep, and any other character but a line break, bounded as the address's steps are. */
const PICTURE_ALT = String.raw`(?:\\.|\[(?:\\.|[^\[\]\\\n]){0,1000}\]|[^\[\]\\\n]){0,1000}`;

/** What may follow an image's address before its link closes: a caption in either quote or in parentheses, as Markdown allows, then the `)`. */
const PICTURE_CLOSE = String.raw`(?:[ \t]+(?:"(?:\\.|[^"\\\n]){0,1000}"|'(?:\\.|[^'\\\n]){0,1000}'|\((?:\\.|[^()\\\n]){0,1000}\)))?[ \t]*\)`;

/**
 * Every picture a text draws by an address of a plan's picture, whole: its
 * unescaped opening, its alt text, the address, and its caption and close.
 * A line left open, or an image whose `!` is escaped, draws no picture and
 * is not one. The address is the first group.
 */
const PICTURE_IN_TEXT = new RegExp(
  `${PICTURE_OPENER}${PICTURE_ALT}\\]\\((${ADDRESS_IN_TEXT.source})${PICTURE_CLOSE}`,
  "gu",
);

/** The most characters an address is read from; past this no picture's address is that long. */
const MAX_ADDRESS_CHARS = 512;

/** One picture of one plan. */
export interface PlanAttachmentRef {
  readonly taskId: string;
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
  const task = encodeMention(
    { kind: MENTION_KIND.TASK, taskId: ref.taskId },
    { workspace, repository: null },
  );
  return `${task}/${FILES_STEP}/${ref.attachmentId}`;
}

/** The picture an address names, by either scheme; nothing for any other address, a plan's or a section's among them. */
export function planAttachmentOf(address: string): PlanAttachmentRef | undefined {
  const url = address.length > MAX_ADDRESS_CHARS ? undefined : parsedUrl(address);
  if (url === undefined || !isLinkHome(url)) return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  const [first, workspace, step, taskId, files, attachmentId, ...rest] = url.pathname.split("/");
  const shaped =
    first === "" &&
    workspace !== undefined &&
    workspace !== "" &&
    step === "plan" &&
    files === FILES_STEP &&
    rest.length === 0;
  if (!shaped || taskId === undefined || attachmentId === undefined) return undefined;
  if (!UUID.test(taskId) || !UUID.test(attachmentId)) return undefined;
  return { taskId, attachmentId };
}

/** The ids of the plan's own pictures its text names, in the order first named, each once. */
export function planAttachmentIdsIn(text: string, taskId: string): readonly string[] {
  const named = new Set<string>();
  for (const [, task, attachment] of text.matchAll(ADDRESS_IN_TEXT)) {
    if (task === taskId && attachment !== undefined && UUID.test(attachment)) named.add(attachment);
  }
  return [...named];
}

/** Words as one line, each run of whitespace a single space, since a picture's line breaks at none. */
function oneLine(words: string): string {
  return words.replace(/\s+/gu, " ").trim();
}

/**
 * A picture's line in a plan's text, `![alt](<address> "caption")`, the
 * caption left out where there is none: the alt text's backslashes and
 * brackets escaped, and the caption's backslashes and quotes, so neither
 * closes its part of the line early.
 */
export function taskPictureMarkdown(
  address: string,
  alt: string,
  caption?: string | undefined,
): string {
  const altText = oneLine(alt).replace(/[\\[\]]/gu, "\\$&");
  const title = caption === undefined ? "" : ` "${oneLine(caption).replace(/[\\"]/gu, "\\$&")}"`;
  return `![${altText}](${address}${title})`;
}

/**
 * The address of every picture a text draws, `![alt](<address>`, of any
 * plan, in order, each copy apart; an address standing as a link or as
 * bare words, or a picture's line standing in code, a fenced or indented
 * block or a code span, draws no picture and is not among them.
 */
export function taskPicturesIn(text: string): readonly string[] {
  return [...text.matchAll(PICTURE_IN_TEXT)].flatMap((match) => {
    const address = match[1];
    return address === undefined || insideCode(text, match.index) ? [] : [address];
  });
}
