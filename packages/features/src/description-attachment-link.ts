import { encodedStep } from "./link-grammar.js";
import { isLinkHome, LINK_HOME_PATTERN, LINK_ORIGIN } from "./link-home.js";
import { insideCode } from "./mention-link.js";
import { parsedUrl } from "./parsed-url.js";

const FILES_STEP = "files";

const TASK_STEP = {
  WRITTEN: "task",
  OLDER: "plan",
} as const;

const TASK_STEPS: ReadonlySet<string> = new Set(Object.values(TASK_STEP));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const ADDRESS_IN_TEXT = new RegExp(
  `${LINK_HOME_PATTERN}\\/[^\\s/()]{1,200}\\/(?:${TASK_STEP.WRITTEN}|${TASK_STEP.OLDER})\\/([0-9a-f-]{36})\\/files\\/([0-9a-f-]{36})(?![\\w-])`,
  "gu",
);

const PICTURE_OPENER = String.raw`(?<!(?<!\\)(?:\\\\)*\\)!\[`;

const PICTURE_ALT = String.raw`(?:\\.|\[(?:\\.|[^\[\]\\\n]){0,1000}\]|[^\[\]\\\n]){0,1000}`;

const PICTURE_CLOSE = String.raw`(?:[ \t]+(?:"(?:\\.|[^"\\\n]){0,1000}"|'(?:\\.|[^'\\\n]){0,1000}'|\((?:\\.|[^()\\\n]){0,1000}\)))?[ \t]*\)`;

const PICTURE_IN_TEXT = new RegExp(
  `${PICTURE_OPENER}${PICTURE_ALT}\\]\\((${ADDRESS_IN_TEXT.source})${PICTURE_CLOSE}`,
  "gu",
);

const MAX_ADDRESS_CHARS = 512;

export interface DescriptionAttachmentRef {
  readonly taskId: string;
  readonly attachmentId: string;
}

export function descriptionAttachmentAddress(
  ref: DescriptionAttachmentRef,
  workspace: string,
): string {
  const task = [
    LINK_ORIGIN,
    encodedStep(workspace),
    TASK_STEP.WRITTEN,
    encodedStep(ref.taskId),
  ].join("/");
  return `${task}/${FILES_STEP}/${ref.attachmentId}`;
}

export function descriptionAttachmentOf(address: string): DescriptionAttachmentRef | undefined {
  const url = address.length > MAX_ADDRESS_CHARS ? undefined : parsedUrl(address);
  if (url === undefined || !isLinkHome(url)) return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  const [first, workspace, step, taskId, files, attachmentId, ...rest] = url.pathname.split("/");
  const shaped =
    first === "" &&
    workspace !== undefined &&
    workspace !== "" &&
    step !== undefined &&
    TASK_STEPS.has(step) &&
    files === FILES_STEP &&
    rest.length === 0;
  if (!shaped || taskId === undefined || attachmentId === undefined) return undefined;
  if (!UUID.test(taskId) || !UUID.test(attachmentId)) return undefined;
  return { taskId, attachmentId };
}

export function descriptionAttachmentIdsIn(text: string, taskId: string): readonly string[] {
  const named = new Set<string>();
  for (const [, task, attachment] of text.matchAll(ADDRESS_IN_TEXT)) {
    if (task === taskId && attachment !== undefined && UUID.test(attachment)) named.add(attachment);
  }
  return [...named];
}

function oneLine(words: string): string {
  return words.replace(/\s+/gu, " ").trim();
}

export function taskPictureMarkdown(
  address: string,
  alt: string,
  caption?: string | undefined,
): string {
  const altText = oneLine(alt).replace(/[\\[\]]/gu, "\\$&");
  const title = caption === undefined ? "" : ` "${oneLine(caption).replace(/[\\"]/gu, "\\$&")}"`;
  return `![${altText}](${address}${title})`;
}

export function taskPicturesIn(text: string): readonly string[] {
  return [...text.matchAll(PICTURE_IN_TEXT)].flatMap((match) => {
    const address = match[1];
    return address === undefined || insideCode(text, match.index) ? [] : [address];
  });
}
