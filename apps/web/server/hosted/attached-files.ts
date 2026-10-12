import {
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachment,
} from "@sidecar/hosted/coding-agent-wire";
import {
  type FileUIPart,
  isFileUIPart,
  isTextUIPart,
  type TextUIPart,
  type UIMessage,
  type UserContent,
} from "ai";
import type { MessageReceivedPart } from "eve/client";
import { UI_PART_STATE, UI_PART_TYPE } from "../core.js";
import { COALESCED_LINE_SEPARATOR } from "./store/message-reads.js";

/**
 * attached-files.ts -- the files a developer attached to a coding agent's message: as eve is handed them, as the journal keeps them, and as eve's receipt of them reads back.
 *
 * A message is words, files, or both. eve is handed the words first where
 * there are any, then each text file inlined as its own text part, headed
 * by its name and fenced, since no provider path takes a text file as a
 * file, then each image and PDF as a file part over a `data:` URL, which
 * eve stages in the sandbox where one is up. The journal keeps the words
 * as the row's first part, empty where there are none, and every file
 * after it as the SDK's file part over the same `data:` URL, a text file
 * under `text/plain`, so the transcript draws a thumbnail or a name for
 * each from the row alone. eve's receipt of a message flattens its files
 * into placeholders, so a line is matched by its parts instead: the words
 * and each text file as eve was handed them, and each image and PDF by its
 * name and type, joined by the separator eve joins coalesced steers with,
 * which is what eve's received parts join to whether the steers it
 * coalesced carried words, files, or both. A receipt the relay writes as a
 * row of its own, such as a task's, reads its text files back to file
 * parts by their heading, so the developer's bubble shows a name rather
 * than the file.
 */

/** What heads a text file inlined for the model, before its name. */
const ATTACHED_FILE_HEADING = "Attached file: ";

/** The shortest fence a text file is inlined in, as Markdown's is. */
const SHORTEST_FENCE = 3;

/** A text file as eve's receipt carries it: the heading's name, a fence, the file, and the same fence. */
const INLINED_FILE = /^Attached file: ([^\n]+)\n(`{3,})\n([\s\S]*)\n\2$/u;

/** An attachment's bytes as a `data:` URL, which both eve and the journal carry. */
function dataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

/** The base64 of a `data:` URL, or nothing where it is not one. */
function base64Of(url: string): string | undefined {
  const comma = url.indexOf(",");
  return url.startsWith("data:") && comma >= 0 ? url.slice(comma + 1) : undefined;
}

/** An image or a PDF as a line is matched by it: its name and its type, which a receipt lists it by whether eve staged it or not. */
function fileMark(filename: string | undefined, mediaType: string): string {
  return `[file: ${filename ?? ""} (${mediaType})]`;
}

/** A text file as the model reads it: its name, then the file in a fence longer than any run of backticks inside it. */
function inlinedFile(name: string, text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/gu), (run) => run[0].length));
  const fence = "`".repeat(Math.max(SHORTEST_FENCE, longest + 1));
  return `${ATTACHED_FILE_HEADING}${name}\n${fence}\n${text}\n${fence}`;
}

/** The text a text file's base64 spells; the wire has already held it to UTF-8. */
function textOf(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * What eve is handed for a message: the words alone where nothing is
 * attached, as every message went before files, and otherwise the words
 * where there are any, the text files inlined, and the images and PDFs as
 * file parts, so a model is never handed an empty text part.
 */
export function eveContent(
  text: string,
  attachments: readonly CodingAgentAttachment[],
): string | UserContent {
  if (attachments.length === 0) return text;
  const texts = attachments.flatMap((file) =>
    file.mediaType === CODING_AGENT_ATTACHMENT_TYPE.TEXT
      ? [{ type: "text" as const, text: inlinedFile(file.name, textOf(file.data)) }]
      : [],
  );
  const files = attachments.flatMap((file) =>
    file.mediaType === CODING_AGENT_ATTACHMENT_TYPE.TEXT
      ? []
      : [
          {
            type: "file" as const,
            data: dataUrl(file.mediaType, file.data),
            mediaType: file.mediaType,
            filename: file.name,
          },
        ],
  );
  return [...(text === "" ? [] : [{ type: "text" as const, text }]), ...texts, ...files];
}

/** The parts the journal keeps for a developer's line: the words, then each file it carried, in the order attached. */
export function lineParts(
  text: string,
  attachments: readonly CodingAgentAttachment[],
): (TextUIPart | FileUIPart)[] {
  return [
    { type: UI_PART_TYPE.TEXT, text, state: UI_PART_STATE.DONE },
    ...attachments.map(
      (file): FileUIPart => ({
        type: "file",
        mediaType: file.mediaType,
        filename: file.name,
        url: dataUrl(file.mediaType, file.data),
      }),
    ),
  ];
}

/**
 * A line's parts as eve's receipt lists them, in the order eve was handed
 * them: the words where there are any, each text file inlined, then each
 * image and PDF by its mark; nothing for a row with no words part.
 */
export function receivedPartsOf(
  parts: readonly UIMessage["parts"][number][],
): readonly string[] | undefined {
  const [words, ...rest] = parts;
  if (words === undefined || !isTextUIPart(words)) return undefined;
  const files = rest.filter(isFileUIPart);
  const texts = files.flatMap((part) => {
    if (part.mediaType !== CODING_AGENT_ATTACHMENT_TYPE.TEXT) return [];
    const base64 = base64Of(part.url);
    return base64 === undefined ? [] : [inlinedFile(part.filename ?? "", textOf(base64))];
  });
  const marks = files.flatMap((part) =>
    part.mediaType === CODING_AGENT_ATTACHMENT_TYPE.TEXT
      ? []
      : [fileMark(part.filename, part.mediaType)],
  );
  return [...(words.text === "" ? [] : [words.text]), ...texts, ...marks];
}

/** A message eve received, read back: the parts a line is matched by, joined, and the words and files a receipt's own row keeps. */
export interface ReceivedMessage {
  readonly text: string;
  readonly words: string;
  readonly files: readonly FileUIPart[];
}

/** One text part of a receipt, read back as the text file it inlines, or nothing where it inlines none. */
function inlinedFileOf(text: string): FileUIPart | undefined {
  const inlined = INLINED_FILE.exec(text);
  if (inlined === null) return undefined;
  const [, name = "", , file = ""] = inlined;
  return {
    type: "file",
    mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
    filename: name,
    url: dataUrl(CODING_AGENT_ATTACHMENT_TYPE.TEXT, Buffer.from(file, "utf8").toString("base64")),
  };
}

/**
 * eve's receipt of a message read back. Its parts joined, each image and
 * PDF by its mark, are what a line is matched by; an eve that projects no
 * parts is read by its summary, which for words alone is the words. A text
 * part spelled as a text file's heading and fence is that file, and every
 * other is words, since a message may carry files with no words. A file
 * staged in the sandbox carries no URL, so its part keeps its name and no
 * bytes; a task's files are never staged, because eve stages against a
 * sandbox that is up and a coding agent's opens on its first sandbox tool
 * call, after the opening message was received.
 */
export function receivedMessage(received: {
  readonly message: string;
  readonly parts?: readonly MessageReceivedPart[] | undefined;
}): ReceivedMessage {
  if (received.parts === undefined) {
    return { text: received.message, words: received.message, files: [] };
  }
  const texts: string[] = [];
  const words: string[] = [];
  const files: FileUIPart[] = [];
  for (const part of received.parts) {
    if (part.type === "text") {
      texts.push(part.text);
      const inlined = inlinedFileOf(part.text);
      if (inlined === undefined) words.push(part.text);
      else files.push(inlined);
      continue;
    }
    texts.push(fileMark(part.filename, part.mediaType));
    files.push({
      type: "file",
      mediaType: part.mediaType,
      ...(part.filename === undefined ? undefined : { filename: part.filename }),
      url: part.url ?? "",
    });
  }
  return {
    text: texts.join(COALESCED_LINE_SEPARATOR),
    words: words.join(COALESCED_LINE_SEPARATOR),
    files,
  };
}
