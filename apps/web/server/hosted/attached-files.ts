import {
  dataUrl,
  fileMark,
  inlinedFile,
  isMentionedText,
  textOf,
} from "@luke/database/models/attached-file-parts";
import { COALESCED_LINE_SEPARATOR } from "@luke/database/models/message-reads";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import type { FileUIPart, UserContent } from "ai";
import type { MessageReceivedPart } from "eve/client";

/**
 * attached-files.ts -- the files a developer attached to a coding agent's message: as eve is handed them, and as eve's receipt of them reads back. How the journal keeps them is `@luke/database/models/attached-file-parts`.
 *
 * A message is words, files, or both. eve is handed the words first where
 * there are any, then each text file inlined as its own text part, headed
 * by its name and fenced, since no provider path takes a text file as a
 * file, then each image and PDF as a file part over a `data:` URL, which
 * eve stages in the sandbox, opening it to do so. The journal keeps the words
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

/** A text file as eve's receipt carries it: the heading's name, a fence, the file, and the same fence. */
const INLINED_FILE = /^Attached file: ([^\n]+)\n(`{3,})\n([\s\S]*)\n\2$/u;

/**
 * What eve is handed for a message: the words alone where nothing is
 * attached and nothing mentioned, as every message went before files, and
 * otherwise the words where there are any, what they mention that the agent
 * cannot read for itself (`mentioned-context.ts`), the text files inlined,
 * and the images and PDFs as file parts, so a model is never handed an
 * empty text part.
 */
export function eveContent(
  text: string,
  attachments: readonly CodingAgentAttachment[],
  mentioned?: string,
): string | UserContent {
  if (attachments.length === 0 && mentioned === undefined) return text;
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
  return [
    ...(text === "" ? [] : [{ type: "text" as const, text }]),
    ...(mentioned === undefined ? [] : [{ type: "text" as const, text: mentioned }]),
    ...texts,
    ...files,
  ];
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
 * bytes; eve stages every file a message carries, a task's included, so a
 * receipt's own row names each file and draws none.
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
  for (const [index, part] of received.parts.entries()) {
    if (part.type === "text") {
      texts.push(part.text);
      // The part a line's mentions were handed in matches the line, and is no
      // words of its own. Note that it always follows the words that named
      // them, so a first part spelled like it is the developer's words still.
      if (index > 0 && isMentionedText(part.text)) continue;
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
